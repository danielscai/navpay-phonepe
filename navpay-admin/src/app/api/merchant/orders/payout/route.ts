import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { payoutOrders, paymentPersons } from "@/db/schema";
import { db } from "@/lib/db";
import { requireApiMerchantUser } from "@/lib/api-merchant";
import { sweepExpiredPayoutOrders } from "@/lib/order-timeout";
import { sweepExpiredPayoutLocks } from "@/lib/payout-lock";

const querySchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(10),
});

export async function GET(req: NextRequest) {
  const { merchantId } = await requireApiMerchantUser(req, { csrf: false });
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

  const conds: any[] = [eq(payoutOrders.merchantId, merchantId)];
  const q = parsed.data.q?.trim();
  if (q) conds.push(or(like(payoutOrders.merchantOrderNo, `%${q}%`), like(payoutOrders.id, `%${q}%`)));
  const st = parsed.data.status?.trim();
  if (st) conds.push(eq(payoutOrders.status, st));
  const where = and(...conds);

  const totalRow = await db.select({ c: sql<number>`count(*)` }).from(payoutOrders).where(where as any);
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const rows = await db
    .select({
      id: payoutOrders.id,
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
    .leftJoin(paymentPersons, eq(paymentPersons.id, payoutOrders.lockedPaymentPersonId))
    .where(where as any)
    .orderBy(desc(payoutOrders.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total, rows });
}
