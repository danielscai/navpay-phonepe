import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requirePersonalToken } from "@/lib/personal-auth";
import { db } from "@/lib/db";
import { payoutOrders, paymentPersonReportLogs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { setPayoutOrderStatus } from "@/lib/payout-status";
import { id } from "@/lib/id";

const bodySchema = z.object({
  result: z.enum(["SUCCESS", "FAILED"]),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const { personId } = await requirePersonalToken(req as any);
  const { orderId } = await ctx.params;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const row = await db.select().from(payoutOrders).where(eq(payoutOrders.id, orderId)).limit(1);
  const o: any = row[0];
  if (!o) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (String(o.status) !== "LOCKED") return NextResponse.json({ ok: false, error: "bad_state" }, { status: 400 });
  if (String(o.lockedPaymentPersonId) !== String(personId)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const out = await setPayoutOrderStatus({
    req,
    actorUserId: null,
    orderId,
    toStatus: body.data.result as any,
    enqueueCallback: true,
    auditMeta: { via: "personal" },
  });
  if (!out.ok) return NextResponse.json({ ok: false, error: out.error ?? "bad_request" }, { status: 400 });

  await db.insert(paymentPersonReportLogs).values({
    id: id("pprlog"),
    personId,
    type: "PAYOUT_COMPLETE",
    entityType: "payout_order",
    entityId: orderId,
    metaJson: JSON.stringify({ result: body.data.result }),
    createdAtMs: Date.now(),
  } as any);

  return NextResponse.json({ ok: true });
}

