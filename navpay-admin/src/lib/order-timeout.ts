import { db } from "@/lib/db";
import { callbackTasks, collectOrders, merchants, payoutOrders } from "@/db/schema";
import { and, eq, inArray, lt } from "drizzle-orm";
import { getSystemConfigNumber } from "@/lib/system-config";
import { id } from "@/lib/id";
import { getActiveMerchantSecret } from "@/lib/merchant-secret";
import { hmacSha256Base64 } from "@/lib/signature";
import { dec, money2 } from "@/lib/money";
import { dispatchCallbackTaskImmediate, getCallbackMaxAttempts } from "@/lib/callback-dispatch";

export const ORDER_TIMEOUT_MINUTES_KEY = "order.timeout_minutes";

export async function getOrderTimeoutMs(): Promise<number> {
  const minutes = await getSystemConfigNumber({
    key: ORDER_TIMEOUT_MINUTES_KEY,
    defaultValue: 10,
    min: 1,
    max: 24 * 60,
    description: "订单超时分钟数（代收/代付通用）。超过该时间未成功则进入 EXPIRED。",
  });
  return minutes * 60_000;
}

function isCollectTerminal(status: string): boolean {
  return ["SUCCESS", "FAILED", "EXPIRED"].includes(status);
}

function isPayoutTerminal(status: string): boolean {
  return ["SUCCESS", "FAILED", "REJECTED", "EXPIRED"].includes(status);
}

export async function sweepExpiredCollectOrders(nowMs: number): Promise<number> {
  const timeoutMs = await getOrderTimeoutMs();
  const cutoff = nowMs - timeoutMs;
  const rows = await db
    .select()
    .from(collectOrders)
    .where(and(lt(collectOrders.createdAtMs, cutoff), inArray(collectOrders.status, ["CREATED", "PENDING_PAY", "PAID"] as any)));

  let changed = 0;
  for (const o of rows as any[]) {
    if (isCollectTerminal(o.status)) continue;
    await db.update(collectOrders).set({ status: "EXPIRED", updatedAtMs: nowMs }).where(eq(collectOrders.id, o.id));
    await db.update(collectOrders).set({ notifyStatus: "PENDING", lastNotifiedAtMs: null, updatedAtMs: nowMs } as any).where(eq(collectOrders.id, o.id));
    changed++;

    // Enqueue callback for operational visibility.
    const secret = await getActiveMerchantSecret(o.merchantId);
    const payload = {
      type: "collect",
      orderId: o.id,
      merchantId: o.merchantId,
      merchantOrderNo: o.merchantOrderNo,
      amount: o.amount,
      fee: o.fee,
      status: "EXPIRED",
      ts: nowMs,
    };
    const payloadJson = JSON.stringify(payload);
    const signature = secret ? hmacSha256Base64(secret.secret, payloadJson) : "MISSING_SECRET";
    const maxAttempts = await getCallbackMaxAttempts();
    const taskId = id("cb");
    await db.insert(callbackTasks).values({
      id: taskId,
      merchantId: o.merchantId,
      orderType: "collect",
      orderId: o.id,
      url: o.notifyUrl,
      payloadJson,
      signature,
      status: "PENDING",
      attemptCount: 0,
      maxAttempts,
      nextAttemptAtMs: nowMs,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    } as any);
    await dispatchCallbackTaskImmediate(taskId);
  }
  return changed;
}

export async function sweepExpiredPayoutOrders(nowMs: number): Promise<number> {
  const timeoutMs = await getOrderTimeoutMs();
  const cutoff = nowMs - timeoutMs;
  const rows = await db
    .select()
    .from(payoutOrders)
    .where(
      and(
        lt(payoutOrders.createdAtMs, cutoff),
        inArray(payoutOrders.status, ["CREATED", "REVIEW_PENDING", "APPROVED", "LOCKED", "BANK_CONFIRMING"] as any),
      ),
    );

  let changed = 0;
  for (const o of rows as any[]) {
    if (isPayoutTerminal(o.status)) continue;

    await db
      .update(payoutOrders)
      .set({
        status: "EXPIRED",
        lockedPaymentPersonId: null as any,
        lockMode: "AUTO",
        lockedAtMs: null as any,
        lockExpiresAtMs: null as any,
        updatedAtMs: nowMs,
      } as any)
      .where(eq(payoutOrders.id, o.id));
    await db.update(payoutOrders).set({ notifyStatus: "PENDING", lastNotifiedAtMs: null, updatedAtMs: nowMs } as any).where(eq(payoutOrders.id, o.id));
    changed++;

    // Refund + release frozen (same semantics as the admin status endpoint).
    const total = dec(o.amount).add(dec(o.fee));
    const mRow = await db.select().from(merchants).where(eq(merchants.id, o.merchantId)).limit(1);
    const m = (mRow as any[])[0];
    if (m) {
      const newBal = money2(dec(m.balance).add(total));
      const newFrozen = money2(dec(m.payoutFrozen).sub(total));
      await db.update(merchants).set({ balance: newBal, payoutFrozen: newFrozen, updatedAtMs: nowMs }).where(eq(merchants.id, m.id));
    }

    const secret = await getActiveMerchantSecret(o.merchantId);
    const payload = {
      type: "payout",
      orderId: o.id,
      merchantId: o.merchantId,
      merchantOrderNo: o.merchantOrderNo,
      amount: o.amount,
      fee: o.fee,
      status: "EXPIRED",
      ts: nowMs,
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
      nextAttemptAtMs: nowMs,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    } as any);
    await dispatchCallbackTaskImmediate(taskId);
  }
  return changed;
}

export async function ensureOrderNotExpired(opts: { orderType: "collect" | "payout"; createdAtMs: number; status: string; orderId: string }): Promise<{ expired: boolean; timeoutMs: number; expiresAtMs: number }> {
  const timeoutMs = await getOrderTimeoutMs();
  const expiresAtMs = opts.createdAtMs + timeoutMs;
  const nowMs = Date.now();
  if (nowMs < expiresAtMs) return { expired: false, timeoutMs, expiresAtMs };
  const terminal = opts.orderType === "collect" ? isCollectTerminal(opts.status) : isPayoutTerminal(opts.status);
  if (terminal) return { expired: false, timeoutMs, expiresAtMs };

  if (opts.orderType === "collect") await sweepExpiredCollectOrders(nowMs);
  else await sweepExpiredPayoutOrders(nowMs);

  return { expired: true, timeoutMs, expiresAtMs };
}
