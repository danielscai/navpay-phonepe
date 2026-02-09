import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { merchants, rechargeIntents } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { sweepExpiredRechargeIntents } from "@/lib/recharge-intent";

const querySchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  chain: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(10),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "order.recharge.read");
  await sweepExpiredRechargeIntents(Date.now());
  const u = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: u.searchParams.get("q") ?? undefined,
    status: u.searchParams.get("status") ?? undefined,
    chain: u.searchParams.get("chain") ?? undefined,
    page: u.searchParams.get("page") ?? undefined,
    pageSize: u.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const conds: any[] = [];
  const q = parsed.data.q?.trim();
  if (q) {
    conds.push(
      or(
        like(rechargeIntents.txHash, `%${q}%`),
        like(rechargeIntents.merchantOrderNo, `%${q}%`),
        like(rechargeIntents.id, `%${q}%`),
        like(rechargeIntents.address, `%${q}%`),
        like(merchants.code, `%${q}%`),
      ),
    );
  }
  const st = parsed.data.status?.trim();
  if (st) conds.push(eq(rechargeIntents.status, st));
  const ch = parsed.data.chain?.trim();
  if (ch) conds.push(eq(rechargeIntents.chain, ch));
  const where = conds.length ? and(...conds) : undefined;

  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(rechargeIntents)
    .leftJoin(merchants, eq(merchants.id, rechargeIntents.merchantId))
    .where(where as any);
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const rows = await db
    .select({
      id: rechargeIntents.id,
      merchantId: rechargeIntents.merchantId,
      merchantCode: merchants.code,
      merchantName: merchants.name,
      merchantOrderNo: rechargeIntents.merchantOrderNo,
      chain: rechargeIntents.chain,
      asset: rechargeIntents.asset,
      address: rechargeIntents.address,
      txHash: rechargeIntents.txHash,
      amount: rechargeIntents.expectedAmount,
      status: rechargeIntents.status,
      expiresAtMs: rechargeIntents.expiresAtMs,
      blockNumber: rechargeIntents.blockNumber,
      confirmations: rechargeIntents.confirmations,
      confirmationsRequired: rechargeIntents.confirmationsRequired,
      creditedAtMs: rechargeIntents.creditedAtMs,
      createdAtMs: rechargeIntents.createdAtMs,
      updatedAtMs: rechargeIntents.updatedAtMs,
    })
    .from(rechargeIntents)
    .leftJoin(merchants, eq(merchants.id, rechargeIntents.merchantId))
    .where(where as any)
    .orderBy(desc(rechargeIntents.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total, rows });
}
