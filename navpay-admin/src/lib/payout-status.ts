import { db } from "@/lib/db";
import { callbackTasks, merchants, payoutOrders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getActiveMerchantSecret } from "@/lib/merchant-secret";
import { hmacSha256Base64 } from "@/lib/signature";
import { id } from "@/lib/id";
import { dec, money2 } from "@/lib/money";
import { writeAuditLog } from "@/lib/audit";
import { creditPaymentPersonOnce } from "@/lib/payment-person";
import { dispatchCallbackTaskImmediate, getCallbackMaxAttempts } from "@/lib/callback-dispatch";
import { settlePayoutOrderCommission } from "@/lib/channel-commission";

export type PayoutStatus =
  | "CREATED"
  | "REVIEW_PENDING"
  | "APPROVED"
  | "LOCKED"
  | "BANK_CONFIRMING"
  | "SUCCESS"
  | "FAILED"
  | "REJECTED"
  | "EXPIRED";

export async function setPayoutOrderStatus(opts: {
  req: Request;
  actorUserId?: string | null;
  orderId: string;
  toStatus: PayoutStatus;
  enqueueCallback: boolean;
  auditMeta?: Record<string, any>;
}): Promise<{ ok: boolean; error?: string }> {
  const row = await db.select().from(payoutOrders).where(eq(payoutOrders.id, opts.orderId)).limit(1);
  const o: any = row[0];
  if (!o) return { ok: false, error: "not_found" };

  if (o.status === "SUCCESS" && opts.toStatus !== "SUCCESS") {
    return { ok: false, error: "cannot_revert_success" };
  }

  await db
    .update(payoutOrders)
    .set({
      status: opts.toStatus,
      notifyStatus: "PENDING",
      lastNotifiedAtMs: null,
      successAtMs: opts.toStatus === "SUCCESS" && o.status !== "SUCCESS" ? Date.now() : (o.successAtMs ?? null),
      updatedAtMs: Date.now(),
    } as any)
    .where(eq(payoutOrders.id, opts.orderId));

  await writeAuditLog({
    req: opts.req as any,
    actorUserId: opts.actorUserId ?? null,
    action: "payout.status_update",
    entityType: "payout_order",
    entityId: opts.orderId,
    meta: { from: o.status, to: opts.toStatus, ...(opts.auditMeta ?? {}) },
  });

  // Frozen funds handling:
  // - On SUCCESS: release frozen (already deducted from balance at creation)
  // - On FAILED/REJECTED/EXPIRED: refund to balance and release frozen
  const total = dec(o.amount).add(dec(o.fee));
  if (opts.toStatus === "SUCCESS") {
    const mRow = await db.select().from(merchants).where(eq(merchants.id, o.merchantId)).limit(1);
    const m: any = mRow[0];
    if (m) {
      const newFrozen = money2(dec(m.payoutFrozen).sub(total));
      await db.update(merchants).set({ payoutFrozen: newFrozen, updatedAtMs: Date.now() } as any).where(eq(merchants.id, m.id));
    }
  }
  if (["FAILED", "REJECTED", "EXPIRED"].includes(opts.toStatus)) {
    const mRow = await db.select().from(merchants).where(eq(merchants.id, o.merchantId)).limit(1);
    const m: any = mRow[0];
    if (m) {
      const newBal = money2(dec(m.balance).add(total));
      const newFrozen = money2(dec(m.payoutFrozen).sub(total));
      await db.update(merchants).set({ balance: newBal, payoutFrozen: newFrozen, updatedAtMs: Date.now() } as any).where(eq(merchants.id, m.id));
    }
  }

  // Credit payment person when payout is successful (idempotent per order).
  if (opts.toStatus === "SUCCESS" && o.lockedPaymentPersonId) {
    await creditPaymentPersonOnce({
      personId: String(o.lockedPaymentPersonId),
      amount: String(o.amount),
      reason: "代付订单成功入账",
      refType: "payout_success",
      refId: String(o.id),
    });
    // Commission + multi-level rebates (idempotent per order via unique index).
    await settlePayoutOrderCommission({ orderId: String(o.id), nowMs: Date.now() });
  }

  if (opts.enqueueCallback) {
    const secret = await getActiveMerchantSecret(o.merchantId);
    const payload = {
      type: "payout",
      orderId: o.id,
      merchantId: o.merchantId,
      merchantOrderNo: o.merchantOrderNo,
      amount: o.amount,
      fee: o.fee,
      status: opts.toStatus,
      ts: Date.now(),
    };
    const payloadJson = JSON.stringify(payload);
    const signature = secret ? hmacSha256Base64(secret.secret, payloadJson) : "MISSING_SECRET";
    const maxAttempts = await getCallbackMaxAttempts();
    const taskId = id("cb");
    await db.insert(callbackTasks).values({
      id: taskId,
      merchantId: o.merchantId,
      orderType: "payout",
      orderId: o.id,
      url: o.notifyUrl,
      payloadJson,
      signature,
      status: "PENDING",
      attemptCount: 0,
      maxAttempts,
      nextAttemptAtMs: Date.now(),
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    } as any);

    if (["SUCCESS", "FAILED", "REJECTED", "EXPIRED"].includes(opts.toStatus)) {
      await dispatchCallbackTaskImmediate(taskId);
    }
  }

  return { ok: true };
}
