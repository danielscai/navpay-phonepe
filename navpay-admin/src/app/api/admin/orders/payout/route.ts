import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { payoutOrders, merchantFees, merchants } from "@/db/schema";
import { id } from "@/lib/id";
import { requireApiPerm } from "@/lib/api";
import { feeFromBps, dec, money2 } from "@/lib/money";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";

const createSchema = z.object({
  merchantId: z.string().min(1),
  merchantOrderNo: z.string().min(1),
  amount: z.string().min(1),
  notifyUrl: z.string().url(),
  beneficiaryName: z.string().min(1),
  bankName: z.string().optional(),
  accountNo: z.string().min(4),
  ifsc: z.string().min(4),
  remark: z.string().optional(),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "order.payout.read");
  const rows = await db.select().from(payoutOrders);
  rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: NextRequest) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { uid } = await requireApiPerm(req, "order.payout.write");
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const feeRow = await db
    .select()
    .from(merchantFees)
    .where(eq(merchantFees.merchantId, body.data.merchantId))
    .limit(1);
  const fees = feeRow[0] ?? { payoutFeeRateBps: 450, minFee: "0.00" };
  const { fee } = feeFromBps(body.data.amount, fees.payoutFeeRateBps, fees.minFee);

  // Freeze funds: amount + fee
  const mRow = await db.select().from(merchants).where(eq(merchants.id, body.data.merchantId)).limit(1);
  const m = mRow[0];
  if (!m) return NextResponse.json({ ok: false, error: "no_merchant" }, { status: 400 });
  const need = dec(body.data.amount).add(dec(fee));
  if (dec(m.balance).lt(need)) {
    return NextResponse.json({ ok: false, error: "insufficient_balance" }, { status: 400 });
  }
  const newBal = money2(dec(m.balance).sub(need));
  const newFrozen = money2(dec(m.payoutFrozen).add(need));
  await db.update(merchants).set({ balance: newBal, payoutFrozen: newFrozen, updatedAtMs: Date.now() }).where(eq(merchants.id, m.id));

  const orderId = id("po");
  await db.insert(payoutOrders).values({
    id: orderId,
    merchantId: body.data.merchantId,
    merchantOrderNo: body.data.merchantOrderNo,
    amount: body.data.amount,
    fee,
    status: "REVIEW_PENDING",
    notifyUrl: body.data.notifyUrl,
    remark: body.data.remark,
    beneficiaryName: body.data.beneficiaryName,
    bankName: body.data.bankName,
    accountNo: body.data.accountNo,
    ifsc: body.data.ifsc,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  });

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "payout.create",
    entityType: "payout_order",
    entityId: orderId,
    meta: { merchantId: body.data.merchantId, merchantOrderNo: body.data.merchantOrderNo, amount: body.data.amount },
  });

  return NextResponse.json({ ok: true, id: orderId });
}
