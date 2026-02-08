import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { callbackTasks, collectOrders, merchants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { getActiveMerchantSecret } from "@/lib/merchant-secret";
import { hmacSha256Base64 } from "@/lib/signature";
import { id } from "@/lib/id";
import { dec, money2 } from "@/lib/money";
import { getOrderTimeoutMs, sweepExpiredCollectOrders } from "@/lib/order-timeout";
import { dispatchCallbackTaskImmediate, getCallbackMaxAttempts } from "@/lib/callback-dispatch";

const bodySchema = z.object({
  status: z.enum(["PENDING_PAY", "PAID", "SUCCESS", "FAILED", "EXPIRED"]),
  enqueueCallback: z.boolean().default(true),
});

// Public debug-only endpoint for the demo "pay page".
export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { orderId } = await ctx.params;
  const timeoutMs = await getOrderTimeoutMs();
  await sweepExpiredCollectOrders(Date.now());
  const row = await db.select().from(collectOrders).where(eq(collectOrders.id, orderId)).limit(1);
  const o: any = row[0];
  if (!o) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expiresAtMs = Number(o.createdAtMs) + timeoutMs;
  return NextResponse.json({
    ok: true,
    nowMs: Date.now(),
    timeoutMs,
    expiresAtMs,
    order: {
      id: o.id,
      merchantOrderNo: o.merchantOrderNo,
      amount: o.amount,
      fee: o.fee,
      status: o.status,
      createdAtMs: o.createdAtMs,
    },
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { orderId } = await ctx.params;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const timeoutMs = await getOrderTimeoutMs();
  await sweepExpiredCollectOrders(Date.now());
  const row = await db.select().from(collectOrders).where(eq(collectOrders.id, orderId)).limit(1);
  const o = row[0];
  if (!o) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expiresAtMs = Number((o as any).createdAtMs) + timeoutMs;
  if (!["SUCCESS", "FAILED", "EXPIRED"].includes(String((o as any).status)) && Date.now() >= expiresAtMs) {
    // If the order has timed out, do not allow "pay success" etc. Any further attempts should see EXPIRED.
    await sweepExpiredCollectOrders(Date.now());
    return NextResponse.json({ ok: false, error: "expired" }, { status: 400 });
  }

  // Disallow leaving SUCCESS once reached to avoid double-accounting in V1.
  if (o.status === "SUCCESS" && body.data.status !== "SUCCESS") {
    return NextResponse.json({ ok: false, error: "cannot_revert_success" }, { status: 400 });
  }

  await db
    .update(collectOrders)
    .set({ status: body.data.status, notifyStatus: "PENDING", lastNotifiedAtMs: null, updatedAtMs: Date.now() } as any)
    .where(eq(collectOrders.id, orderId));

  if (o.status !== "SUCCESS" && body.data.status === "SUCCESS") {
    // settlement: merchant balance += amount - fee
    const mRow = await db.select().from(merchants).where(eq(merchants.id, o.merchantId)).limit(1);
    const m = mRow[0];
    if (m) {
      const newBal = money2(dec(m.balance).add(dec(o.amount)).sub(dec(o.fee)));
      await db.update(merchants).set({ balance: newBal, updatedAtMs: Date.now() }).where(eq(merchants.id, m.id));
    }
  }

  if (body.data.enqueueCallback) {
    const secret = await getActiveMerchantSecret(o.merchantId);
    const payload = {
      type: "collect",
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
      nextAttemptAtMs: Date.now(),
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    });
    if (["SUCCESS", "FAILED", "EXPIRED"].includes(body.data.status)) {
      await dispatchCallbackTaskImmediate(taskId);
    }
  }

  return NextResponse.json({ ok: true });
}
