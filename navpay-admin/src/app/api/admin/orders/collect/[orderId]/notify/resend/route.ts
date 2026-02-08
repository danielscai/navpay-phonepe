import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { callbackTasks, collectOrders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { requireApiPerm } from "@/lib/api";
import { getActiveMerchantSecret } from "@/lib/merchant-secret";
import { hmacSha256Base64 } from "@/lib/signature";
import { id } from "@/lib/id";
import { dispatchCallbackTaskImmediate, getCallbackMaxAttempts } from "@/lib/callback-dispatch";

export async function POST(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  await requireApiPerm(req, "callback.retry");
  const { orderId } = await ctx.params;

  const row = await db.select().from(collectOrders).where(eq(collectOrders.id, orderId)).limit(1);
  const o: any = row[0];
  if (!o) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  // Only allow resend on terminal states.
  if (!["SUCCESS", "FAILED", "EXPIRED"].includes(String(o.status))) {
    return NextResponse.json({ ok: false, error: "not_terminal" }, { status: 400 });
  }

  const secret = await getActiveMerchantSecret(o.merchantId);
  const payload = {
    type: "collect",
    orderId: o.id,
    merchantId: o.merchantId,
    merchantOrderNo: o.merchantOrderNo,
    amount: o.amount,
    fee: o.fee,
    status: o.status,
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
  } as any);

  // Set order notify to pending again.
  await db.update(collectOrders).set({ notifyStatus: "PENDING", lastNotifiedAtMs: null, updatedAtMs: Date.now() } as any).where(eq(collectOrders.id, o.id));

  await dispatchCallbackTaskImmediate(taskId);
  return NextResponse.json({ ok: true, taskId });
}

