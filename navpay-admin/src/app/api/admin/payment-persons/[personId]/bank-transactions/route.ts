import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { bankAccounts, bankTransactions } from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(20),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ personId: string }> }) {
  await requireApiPerm(req, "payout.channel.read");
  const { personId } = await ctx.params;
  const u = new URL(req.url);
  const parsed = querySchema.safeParse({
    page: u.searchParams.get("page") ?? undefined,
    pageSize: u.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const accounts = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.personId, personId)).limit(200);
  const accountIds = accounts.map((a: any) => String(a.id));
  if (!accountIds.length) return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total: 0, rows: [] });

  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(bankTransactions)
    .where(inArray(bankTransactions.accountId, accountIds as any));
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const rows = await db
    .select()
    .from(bankTransactions)
    .where(inArray(bankTransactions.accountId, accountIds as any))
    .orderBy(desc(bankTransactions.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total, rows });
}

