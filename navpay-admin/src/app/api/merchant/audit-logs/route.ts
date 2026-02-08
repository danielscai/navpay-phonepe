import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import { auditLogs, users } from "@/db/schema";
import { db } from "@/lib/db";
import { requireApiMerchantUser } from "@/lib/api-merchant";

const querySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(10),
});

export async function GET(req: NextRequest) {
  const { merchantId, uid } = await requireApiMerchantUser(req, { csrf: false });
  const u = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: u.searchParams.get("q") ?? undefined,
    page: u.searchParams.get("page") ?? undefined,
    pageSize: u.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  // Merchant can only see:
  // - their own session-user actions (actorUserId=uid)
  // - API key actions for this merchant (merchantId=... AND actorUserId is NULL)
  const conds: any[] = [or(eq(auditLogs.actorUserId, uid), and(eq(auditLogs.merchantId, merchantId), isNull(auditLogs.actorUserId)))];
  const q = parsed.data.q?.trim();
  if (q) conds.push(or(like(auditLogs.action, `%${q}%`), like(auditLogs.entityType, `%${q}%`), like(auditLogs.entityId, `%${q}%`)));
  const where = and(...conds);

  const totalRow = await db.select({ c: sql<number>`count(*)` }).from(auditLogs).where(where as any);
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const rows = await db
    .select({
      id: auditLogs.id,
      actorUserId: auditLogs.actorUserId,
      actorUsername: users.username,
      actorDisplayName: users.displayName,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metaJson: auditLogs.metaJson,
      ip: auditLogs.ip,
      userAgent: auditLogs.userAgent,
      createdAtMs: auditLogs.createdAtMs,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(where as any)
    .orderBy(desc(auditLogs.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total, rows });
}
