import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { collectOrders, merchantFees, merchants, paymentPersons } from "@/db/schema";
import { id } from "@/lib/id";
import { requireApiPerm } from "@/lib/api";
import { feeFromBps } from "@/lib/money";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";
import { sweepExpiredCollectOrders } from "@/lib/order-timeout";
import { pickPaymentPersonForAmount } from "@/lib/payment-person";

const createSchema = z.object({
  merchantId: z.string().min(1),
  merchantOrderNo: z.string().min(1),
  amount: z.string().min(1),
  notifyUrl: z.string().url(),
  remark: z.string().optional(),
});

const querySchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(10),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "order.collect.read");
  await sweepExpiredCollectOrders(Date.now());
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
  if (q) conds.push(or(like(collectOrders.merchantOrderNo, `%${q}%`), like(collectOrders.id, `%${q}%`), like(merchants.code, `%${q}%`)));
  const st = parsed.data.status?.trim();
  if (st) conds.push(eq(collectOrders.status, st));
  const where = conds.length ? and(...conds) : undefined;

  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(collectOrders)
    .leftJoin(merchants, eq(merchants.id, collectOrders.merchantId))
    .where(where as any);
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const rows = await db
    .select({
      id: collectOrders.id,
      merchantId: collectOrders.merchantId,
      merchantCode: merchants.code,
      merchantName: merchants.name,
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
    .leftJoin(merchants, eq(merchants.id, collectOrders.merchantId))
    .leftJoin(paymentPersons, eq(paymentPersons.id, collectOrders.assignedPaymentPersonId))
    .where(where as any)
    .orderBy(desc(collectOrders.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total, rows });
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

  // Best-effort: assign to a payment person who has sufficient balance.
  try {
    const p = await pickPaymentPersonForAmount(body.data.amount);
    if (p) {
      await db
        .update(collectOrders)
        .set({ assignedPaymentPersonId: p.id, assignedAtMs: Date.now(), updatedAtMs: Date.now() } as any)
        .where(eq(collectOrders.id, orderId));
    }
  } catch {
    // Ignore assignment errors in debug create.
  }

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
