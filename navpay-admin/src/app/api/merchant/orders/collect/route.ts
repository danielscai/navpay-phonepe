import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { collectOrders, paymentPersons } from "@/db/schema";
import { db } from "@/lib/db";
import { requireApiMerchantUser } from "@/lib/api-merchant";
import { sweepExpiredCollectOrders } from "@/lib/order-timeout";

const querySchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(10),
});

export async function GET(req: NextRequest) {
  const { merchantId } = await requireApiMerchantUser(req, { csrf: false });
  await sweepExpiredCollectOrders(Date.now());
  const u = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: u.searchParams.get("q") ?? undefined,
    status: u.searchParams.get("status") ?? undefined,
    page: u.searchParams.get("page") ?? undefined,
    pageSize: u.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const conds: any[] = [eq(collectOrders.merchantId, merchantId)];
  const q = parsed.data.q?.trim();
  if (q) conds.push(or(like(collectOrders.merchantOrderNo, `%${q}%`), like(collectOrders.id, `%${q}%`)));
  const st = parsed.data.status?.trim();
  if (st) conds.push(eq(collectOrders.status, st));
  const where = and(...conds);

  const totalRow = await db.select({ c: sql<number>`count(*)` }).from(collectOrders).where(where as any);
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const rows = await db
    .select({
      id: collectOrders.id,
      merchantOrderNo: collectOrders.merchantOrderNo,
      amount: collectOrders.amount,
      fee: collectOrders.fee,
      status: collectOrders.status,
      notifyUrl: collectOrders.notifyUrl,
      notifyStatus: collectOrders.notifyStatus,
      lastNotifiedAtMs: collectOrders.lastNotifiedAtMs,
      assignedPaymentPersonId: collectOrders.assignedPaymentPersonId,
      assignedAtMs: collectOrders.assignedAtMs,
      assignedPaymentPersonName: paymentPersons.name,
      createdAtMs: collectOrders.createdAtMs,
    })
    .from(collectOrders)
    .leftJoin(paymentPersons, eq(paymentPersons.id, collectOrders.assignedPaymentPersonId))
    .where(where as any)
    .orderBy(desc(collectOrders.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total, rows });
}
