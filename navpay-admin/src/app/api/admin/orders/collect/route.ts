import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { collectOrders, merchantFees } from "@/db/schema";
import { id } from "@/lib/id";
import { requireApiPerm } from "@/lib/api";
import { feeFromBps } from "@/lib/money";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";

const createSchema = z.object({
  merchantId: z.string().min(1),
  merchantOrderNo: z.string().min(1),
  amount: z.string().min(1),
  notifyUrl: z.string().url(),
  remark: z.string().optional(),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "order.collect.read");
  const rows = await db.select().from(collectOrders);
  rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: NextRequest) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { uid } = await requireApiPerm(req, "order.collect.write");
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const feeRow = await db
    .select()
    .from(merchantFees)
    .where(eq(merchantFees.merchantId, body.data.merchantId))
    .limit(1);
  const fees = feeRow[0] ?? { collectFeeRateBps: 300, minFee: "0.00" };
  const { fee } = feeFromBps(body.data.amount, fees.collectFeeRateBps, fees.minFee);

  const orderId = id("co");
  await db.insert(collectOrders).values({
    id: orderId,
    merchantId: body.data.merchantId,
    merchantOrderNo: body.data.merchantOrderNo,
    amount: body.data.amount,
    fee,
    status: "CREATED",
    notifyUrl: body.data.notifyUrl,
    remark: body.data.remark,
    channelType: "h5",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  });

  // Best-effort audit
  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "collect.create",
    entityType: "collect_order",
    entityId: orderId,
    meta: { merchantId: body.data.merchantId, merchantOrderNo: body.data.merchantOrderNo, amount: body.data.amount },
  });

  return NextResponse.json({ ok: true, id: orderId });
}
