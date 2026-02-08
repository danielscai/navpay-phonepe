import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { payoutOrders, merchantFees, merchants, paymentPersons } from "@/db/schema";
import { id } from "@/lib/id";
import { requireApiPerm } from "@/lib/api";
import { feeFromBps, dec, money2 } from "@/lib/money";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";
import { sweepExpiredPayoutOrders } from "@/lib/order-timeout";
import { sweepExpiredPayoutLocks } from "@/lib/payout-lock";

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

const querySchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(10),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "order.payout.read");
  await sweepExpiredPayoutOrders(Date.now());
  await sweepExpiredPayoutLocks(Date.now());
  const u = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: u.searchParams.get("q") ?? undefined,
    status: u.searchParams.get("status") ?? undefined,
    page: u.searchParams.get("page") ?? undefined,
    pageSize: u.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const conds: any[] = [];
  const q = parsed.data.q?.trim();
  if (q) conds.push(or(like(payoutOrders.merchantOrderNo, `%${q}%`), like(payoutOrders.id, `%${q}%`), like(merchants.code, `%${q}%`)));
  const st = parsed.data.status?.trim();
  if (st) conds.push(eq(payoutOrders.status, st));
  const where = conds.length ? and(...conds) : undefined;

  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(payoutOrders)
    .leftJoin(merchants, eq(merchants.id, payoutOrders.merchantId))
    .where(where as any);
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const rows = await db
    .select({
      id: payoutOrders.id,
      merchantId: payoutOrders.merchantId,
      merchantCode: merchants.code,
      merchantName: merchants.name,
      merchantOrderNo: payoutOrders.merchantOrderNo,
      amount: payoutOrders.amount,
      fee: payoutOrders.fee,
      status: payoutOrders.status,
      notifyUrl: payoutOrders.notifyUrl,
      notifyStatus: payoutOrders.notifyStatus,
      lastNotifiedAtMs: payoutOrders.lastNotifiedAtMs,
      lockedPaymentPersonId: payoutOrders.lockedPaymentPersonId,
      lockMode: payoutOrders.lockMode,
      lockedAtMs: payoutOrders.lockedAtMs,
      lockExpiresAtMs: payoutOrders.lockExpiresAtMs,
      lockedPaymentPersonName: paymentPersons.name,
      beneficiaryName: payoutOrders.beneficiaryName,
      accountNo: payoutOrders.accountNo,
      ifsc: payoutOrders.ifsc,
      createdAtMs: payoutOrders.createdAtMs,
    })
    .from(payoutOrders)
    .leftJoin(merchants, eq(merchants.id, payoutOrders.merchantId))
    .leftJoin(paymentPersons, eq(paymentPersons.id, payoutOrders.lockedPaymentPersonId))
    .where(where as any)
    .orderBy(desc(payoutOrders.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total, rows });
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
