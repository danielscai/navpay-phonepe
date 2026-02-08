import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { paymentPersonBalanceLogs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";

export async function GET(req: NextRequest, ctx: { params: Promise<{ personId: string }> }) {
  await requireApiPerm(req, "payout.channel.read");
  const { personId } = await ctx.params;
  const rows = await db
    .select()
    .from(paymentPersonBalanceLogs)
    .where(eq(paymentPersonBalanceLogs.personId, personId))
    .orderBy(desc(paymentPersonBalanceLogs.createdAtMs))
    .limit(200);
  return NextResponse.json({ ok: true, rows });
}
