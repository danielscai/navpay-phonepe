import { NextResponse, type NextRequest } from "next/server";
import { requirePersonalToken } from "@/lib/personal-auth";
import { db } from "@/lib/db";
import { payoutOrders, paymentPersonReportLogs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getPayoutLockTimeoutMinutes, sweepExpiredPayoutLocks } from "@/lib/payout-lock";
import { id } from "@/lib/id";

export async function POST(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const { personId } = await requirePersonalToken(req as any);
  const { orderId } = await ctx.params;

  await sweepExpiredPayoutLocks(Date.now());
  const now = Date.now();
  const mins = await getPayoutLockTimeoutMinutes();
  const expires = now + mins * 60_000;

  const row = await db.select().from(payoutOrders).where(eq(payoutOrders.id, orderId)).limit(1);
  const o: any = row[0];
  if (!o) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (String(o.status) !== "APPROVED") return NextResponse.json({ ok: false, error: "bad_state" }, { status: 400 });

  await db
    .update(payoutOrders)
    .set({
      status: "LOCKED",
      lockedPaymentPersonId: personId,
      lockMode: "AUTO",
      lockedAtMs: now,
      lockExpiresAtMs: expires,
      updatedAtMs: now,
    } as any)
    .where(and(eq(payoutOrders.id, orderId), eq(payoutOrders.status, "APPROVED")));

  await db.insert(paymentPersonReportLogs).values({
    id: id("pprlog"),
    personId,
    type: "PAYOUT_CLAIM",
    entityType: "payout_order",
    entityId: orderId,
    metaJson: JSON.stringify({ lockExpiresAtMs: expires }),
    createdAtMs: now,
  } as any);

  return NextResponse.json({ ok: true, lockExpiresAtMs: expires });
}

