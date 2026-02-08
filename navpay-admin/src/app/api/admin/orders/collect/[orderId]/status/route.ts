import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { callbackTasks, collectOrders, merchants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";
import { getActiveMerchantSecret } from "@/lib/merchant-secret";
import { hmacSha256Base64 } from "@/lib/signature";
import { id } from "@/lib/id";
import { dec, money2 } from "@/lib/money";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";

const bodySchema = z.object({
  status: z.enum(["PENDING_PAY", "PAID", "SUCCESS", "FAILED", "EXPIRED"]),
  enqueueCallback: z.boolean().default(true),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { uid } = await requireApiPerm(req, "order.collect.write");
  const { orderId } = await ctx.params;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const row = await db.select().from(collectOrders).where(eq(collectOrders.id, orderId)).limit(1);
  const o = row[0];
  if (!o) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  // Disallow leaving SUCCESS once reached to avoid double-accounting in V1.
  if (o.status === "SUCCESS" && body.data.status !== "SUCCESS") {
    return NextResponse.json({ ok: false, error: "cannot_revert_success" }, { status: 400 });
  }

  await db
    .update(collectOrders)
    .set({ status: body.data.status, updatedAtMs: Date.now() })
    .where(eq(collectOrders.id, orderId));

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "collect.status_update",
    entityType: "collect_order",
    entityId: orderId,
    meta: { from: o.status, to: body.data.status },
  });

  if (o.status !== "SUCCESS" && body.data.status === "SUCCESS") {
    // settlement: merchant balance += amount - fee
    const mRow = await db.select().from(merchants).where(eq(merchants.id, o.merchantId)).limit(1);
    const m = mRow[0];
    if (m) {
      const newBal = money2(dec(m.balance).add(dec(o.amount)).sub(dec(o.fee)));
      await db
        .update(merchants)
        .set({ balance: newBal, updatedAtMs: Date.now() })
        .where(eq(merchants.id, m.id));
    }
  }

  if (body.data.enqueueCallback) {
    const secret = await getActiveMerchantSecret(o.merchantId);
    // V1: if misconfigured, still enqueue to allow operational visibility.

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

    await db.insert(callbackTasks).values({
      id: id("cb"),
      merchantId: o.merchantId,
      orderType: "collect",
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
