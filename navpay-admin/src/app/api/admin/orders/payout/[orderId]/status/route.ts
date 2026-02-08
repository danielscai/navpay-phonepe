import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { callbackTasks, merchants, payoutOrders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiPerm, requireApiUser } from "@/lib/api";
import { getActiveMerchantSecret } from "@/lib/merchant-secret";
import { hmacSha256Base64 } from "@/lib/signature";
import { id } from "@/lib/id";
import { dec, money2 } from "@/lib/money";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";

const bodySchema = z.object({
  status: z.enum(["REVIEW_PENDING", "APPROVED", "BANK_CONFIRMING", "SUCCESS", "FAILED", "REJECTED", "EXPIRED"]),
  enqueueCallback: z.boolean().default(true),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  // High-risk statuses require different perms.
  const { orderId } = await ctx.params;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  if (["SUCCESS", "FAILED", "REJECTED"].includes(body.data.status)) {
    await requireApiPerm(req, "order.payout.finalize");
  } else if (["APPROVED"].includes(body.data.status)) {
    await requireApiPerm(req, "order.payout.review");
  } else {
    await requireApiPerm(req, "order.payout.read");
  }

  const row = await db.select().from(payoutOrders).where(eq(payoutOrders.id, orderId)).limit(1);
  const o = row[0];
  if (!o) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  if (o.status === "SUCCESS" && body.data.status !== "SUCCESS") {
    return NextResponse.json({ ok: false, error: "cannot_revert_success" }, { status: 400 });
  }

  await db.update(payoutOrders).set({ status: body.data.status, updatedAtMs: Date.now() }).where(eq(payoutOrders.id, orderId));

  // Best-effort audit (use a broad perm for actor resolution).
  const { uid } = await requireApiUser(req, { csrf: false });
  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "payout.status_update",
    entityType: "payout_order",
    entityId: orderId,
    meta: { from: o.status, to: body.data.status },
  });

  // Frozen funds handling:
  // - On SUCCESS: release frozen (already deducted from balance at creation)
  // - On FAILED/REJECTED/EXPIRED: refund to balance and release frozen
  const total = dec(o.amount).add(dec(o.fee));
  if (body.data.status === "SUCCESS") {
    const mRow = await db.select().from(merchants).where(eq(merchants.id, o.merchantId)).limit(1);
    const m = mRow[0];
    if (m) {
      const newFrozen = money2(dec(m.payoutFrozen).sub(total));
      await db.update(merchants).set({ payoutFrozen: newFrozen, updatedAtMs: Date.now() }).where(eq(merchants.id, m.id));
    }
  }
  if (["FAILED", "REJECTED", "EXPIRED"].includes(body.data.status)) {
    const mRow = await db.select().from(merchants).where(eq(merchants.id, o.merchantId)).limit(1);
    const m = mRow[0];
    if (m) {
      const newBal = money2(dec(m.balance).add(total));
      const newFrozen = money2(dec(m.payoutFrozen).sub(total));
      await db.update(merchants).set({ balance: newBal, payoutFrozen: newFrozen, updatedAtMs: Date.now() }).where(eq(merchants.id, m.id));
    }
  }

  if (body.data.enqueueCallback) {
    const secret = await getActiveMerchantSecret(o.merchantId);
    const payload = {
      type: "payout",
      orderId: o.id,
      merchantId: o.merchantId,
      merchantOrderNo: o.merchantOrderNo,
      amount: o.amount,
      fee: o.fee,
      status: body.data.status,
      ts: Date.now(),
    };
    const payloadJson = JSON.stringify(payload);
    const signature = secret ? hmacSha256Base64(secret.secret, payloadJson) : "MISSING_SECRET";
    await db.insert(callbackTasks).values({
      id: id("cb"),
      merchantId: o.merchantId,
      orderType: "payout",
      orderId: o.id,
      url: o.notifyUrl,
      payloadJson,
      signature,
      status: "PENDING",
      attemptCount: 0,
      maxAttempts: 5,
      nextAttemptAtMs: Date.now(),
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    });
  }

  return NextResponse.json({ ok: true });
}
