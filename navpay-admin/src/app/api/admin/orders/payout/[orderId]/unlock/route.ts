import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { payoutOrders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiPerm, requireApiUser } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  await requireApiPerm(req, "payout.channel.write");

  const { orderId } = await ctx.params;
  const row = await db.select().from(payoutOrders).where(eq(payoutOrders.id, orderId)).limit(1);
  const o: any = row[0];
  if (!o) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (String(o.status) !== "LOCKED") return NextResponse.json({ ok: false, error: "bad_state" }, { status: 400 });

  await db
    .update(payoutOrders)
    .set({
      status: "APPROVED",
      lockedPaymentPersonId: null as any,
      lockMode: "AUTO",
      lockedAtMs: null as any,
      lockExpiresAtMs: null as any,
      updatedAtMs: Date.now(),
    } as any)
    .where(eq(payoutOrders.id, orderId));

  const { uid } = await requireApiUser(req, { csrf: false });
  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "payout.unlock",
    entityType: "payout_order",
    entityId: orderId,
    meta: { from: "LOCKED", to: "APPROVED" },
  });

  return NextResponse.json({ ok: true });
}
