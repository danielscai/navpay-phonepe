import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { payoutOrders, paymentPersons } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireApiPerm, requireApiUser } from "@/lib/api";
import { getPayoutLockTimeoutMinutes, sweepExpiredPayoutLocks } from "@/lib/payout-lock";
import { writeAuditLog } from "@/lib/audit";

const schema = z.object({
  paymentPersonId: z.string().min(1),
  mode: z.enum(["AUTO", "MANUAL"]).default("AUTO"),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  await requireApiPerm(req, "payout.channel.write");

  const { orderId } = await ctx.params;
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  await sweepExpiredPayoutLocks(Date.now());

  const p = await db
    .select({ id: paymentPersons.id })
    .from(paymentPersons)
    .where(and(eq(paymentPersons.id, body.data.paymentPersonId), eq(paymentPersons.enabled, true)))
    .limit(1);
  if (!p.length) return NextResponse.json({ ok: false, error: "no_payment_person" }, { status: 400 });

  const row = await db.select().from(payoutOrders).where(eq(payoutOrders.id, orderId)).limit(1);
  const o: any = row[0];
  if (!o) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (String(o.status) !== "APPROVED") return NextResponse.json({ ok: false, error: "bad_state" }, { status: 400 });

  const mins = await getPayoutLockTimeoutMinutes();
  const now = Date.now();
  const lockExpiresAtMs = now + mins * 60_000;
  await db
    .update(payoutOrders)
    .set({
      status: "LOCKED",
      lockedPaymentPersonId: body.data.paymentPersonId,
      lockMode: body.data.mode,
      lockedAtMs: now,
      lockExpiresAtMs,
      updatedAtMs: now,
    } as any)
    .where(eq(payoutOrders.id, orderId));

  const { uid } = await requireApiUser(req, { csrf: false });
  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "payout.lock",
    entityType: "payout_order",
    entityId: orderId,
    meta: { paymentPersonId: body.data.paymentPersonId, mode: body.data.mode, lockExpiresAtMs },
  });

  return NextResponse.json({ ok: true, lockExpiresAtMs });
}
