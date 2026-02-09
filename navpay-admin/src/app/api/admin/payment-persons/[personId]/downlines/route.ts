import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiPerm } from "@/lib/api";
import { db } from "@/lib/db";
import { paymentPersons, users } from "@/db/schema";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { getTodayOrderStatsByPersonIds, getLastLoginByPersonIds } from "@/lib/payment-person-stats";

const querySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(20),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ personId: string }> }) {
  await requireApiPerm(req, "payout.channel.read");
  const { personId } = await ctx.params;

  const u = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: u.searchParams.get("q") ?? undefined,
    page: u.searchParams.get("page") ?? undefined,
    pageSize: u.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const conds: any[] = [eq(paymentPersons.inviterPersonId, personId)];
  const q = parsed.data.q?.trim();
  if (q) {
    conds.push(or(like(paymentPersons.name, `%${q}%`), like(users.username, `%${q}%`), like(paymentPersons.inviteCode, `%${q}%`)));
  }
  const where = and(...conds);

  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(paymentPersons)
    .leftJoin(users, eq(users.id, paymentPersons.userId))
    .where(where as any);
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const rows = await db
    .select({
      id: paymentPersons.id,
      userId: paymentPersons.userId,
      username: users.username,
      name: paymentPersons.name,
      balance: paymentPersons.balance,
      enabled: paymentPersons.enabled,
      inviteCode: paymentPersons.inviteCode,
      createdAtMs: paymentPersons.createdAtMs,
      updatedAtMs: paymentPersons.updatedAtMs,
    })
    .from(paymentPersons)
    .leftJoin(users, eq(users.id, paymentPersons.userId))
    .where(where as any)
    .orderBy(desc(paymentPersons.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  const ids = (rows as any[]).map((r) => String(r.id));
  const nowMs = Date.now();
  const [todayOrders, lastLogin] = await Promise.all([
    getTodayOrderStatsByPersonIds({ personIds: ids, nowMs }),
    getLastLoginByPersonIds(ids),
  ]);

  const merged = (rows as any[]).map((r) => {
    const pid = String(r.id);
    return { ...r, todayOrders: todayOrders[pid] ?? null, lastLogin: lastLogin[pid] ?? null };
  });

  return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total, rows: merged });
}

