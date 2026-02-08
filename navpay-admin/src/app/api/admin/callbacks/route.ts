import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { callbackTasks } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";

const querySchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(10),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "callback.read");
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
  if (q) conds.push(or(like(callbackTasks.url, `%${q}%`), like(callbackTasks.orderId, `%${q}%`), like(callbackTasks.orderType, `%${q}%`)));
  const st = parsed.data.status?.trim();
  if (st) conds.push(eq(callbackTasks.status, st));
  const where = conds.length ? and(...conds) : undefined;

  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(callbackTasks)
    .where(where as any);
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const rows = await db
    .select()
    .from(callbackTasks)
    .where(where as any)
    .orderBy(desc(callbackTasks.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total, rows });
}
