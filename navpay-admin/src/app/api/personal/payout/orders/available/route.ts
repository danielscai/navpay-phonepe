import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requirePersonalToken } from "@/lib/personal-auth";
import { db } from "@/lib/db";
import { payoutOrders } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { sweepExpiredPayoutLocks } from "@/lib/payout-lock";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(10),
});

export async function GET(req: NextRequest) {
  await requirePersonalToken(req as any);
  await sweepExpiredPayoutLocks(Date.now());

  const u = new URL(req.url);
  const parsed = querySchema.safeParse({
    page: u.searchParams.get("page") ?? undefined,
    pageSize: u.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(payoutOrders)
    .where(eq(payoutOrders.status, "APPROVED"));
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const rows = await db
    .select({
      id: payoutOrders.id,
      merchantOrderNo: payoutOrders.merchantOrderNo,
      amount: payoutOrders.amount,
      status: payoutOrders.status,
      beneficiaryName: payoutOrders.beneficiaryName,
      accountNo: payoutOrders.accountNo,
      ifsc: payoutOrders.ifsc,
      createdAtMs: payoutOrders.createdAtMs,
    })
    .from(payoutOrders)
    .where(eq(payoutOrders.status, "APPROVED"))
    .orderBy(desc(payoutOrders.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total, rows });
}

