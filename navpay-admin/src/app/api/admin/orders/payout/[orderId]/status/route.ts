import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { payoutOrders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiPerm, requireApiUser } from "@/lib/api";
import { env } from "@/lib/env";
import { setPayoutOrderStatus } from "@/lib/payout-status";

const bodySchema = z.object({
  status: z.enum(["REVIEW_PENDING", "APPROVED", "LOCKED", "BANK_CONFIRMING", "SUCCESS", "FAILED", "REJECTED", "EXPIRED"]),
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

  const { uid } = await requireApiUser(req, { csrf: false });
  const out = await setPayoutOrderStatus({
    req,
    actorUserId: uid,
    orderId,
    toStatus: body.data.status as any,
    enqueueCallback: body.data.enqueueCallback,
  });
  if (!out.ok) return NextResponse.json({ ok: false, error: out.error ?? "bad_request" }, { status: 400 });

  return NextResponse.json({ ok: true });
}
