import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { paymentPersonBalanceLogs } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
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

  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(paymentPersonBalanceLogs)
    .where(eq(paymentPersonBalanceLogs.personId, personId));
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const rows = await db
    .select()
    .from(paymentPersonBalanceLogs)
    .where(eq(paymentPersonBalanceLogs.personId, personId))
    .orderBy(desc(paymentPersonBalanceLogs.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total, rows });
}

