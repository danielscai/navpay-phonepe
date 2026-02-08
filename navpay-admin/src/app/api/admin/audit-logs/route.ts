import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLogs, callbackTasks, collectOrders, ipWhitelist, merchants, payoutOrders, systemConfigs, users, webhookReceivers } from "@/db/schema";
import { and, desc, eq, gte, inArray, like, lte, sql } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";

const querySchema = z.object({
  q: z.string().optional(),
  actor: z.string().optional(),
  fromMs: z.coerce.number().optional(),
  toMs: z.coerce.number().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(10),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "audit.read");

  const u = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: u.searchParams.get("q") ?? undefined,
    actor: u.searchParams.get("actor") ?? undefined,
    fromMs: u.searchParams.get("fromMs") ?? undefined,
    toMs: u.searchParams.get("toMs") ?? undefined,
    page: u.searchParams.get("page") ?? undefined,
    pageSize: u.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const conds: any[] = [];
  if (parsed.data.q) conds.push(like(auditLogs.action, `%${parsed.data.q}%`));
  if (parsed.data.actor) conds.push(eq(auditLogs.actorUserId, parsed.data.actor));
  if (parsed.data.fromMs) conds.push(gte(auditLogs.createdAtMs, parsed.data.fromMs));
  if (parsed.data.toMs) conds.push(lte(auditLogs.createdAtMs, parsed.data.toMs));

  const where = conds.length ? and(...conds) : undefined;

  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(auditLogs)
    .where(where as any);
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

  // Build human-friendly entity labels (batch fetch by type).
  const byType = new Map<string, string[]>();
  for (const r of rows as any[]) {
    const t = String(r.entityType ?? "");
    const id = String(r.entityId ?? "");
    if (!t || !id) continue;
    const arr = byType.get(t) ?? [];
    arr.push(id);
    byType.set(t, arr);
  }

  const uniq = (xs: string[]) => Array.from(new Set(xs));
  const label: Record<string, Record<string, string>> = {};

  async function mapMerchants(ids: string[]) {
    const ms = await db.select({ id: merchants.id, code: merchants.code, name: merchants.name }).from(merchants).where(inArray(merchants.id, ids));
    label.merchant = Object.fromEntries(ms.map((m) => [m.id, `${m.code} ${m.name}`]));
  }
  async function mapCollect(ids: string[]) {
    const os = await db.select({ id: collectOrders.id, merchantOrderNo: collectOrders.merchantOrderNo, merchantId: collectOrders.merchantId }).from(collectOrders).where(inArray(collectOrders.id, ids));
    label.collect_order = Object.fromEntries(os.map((o) => [o.id, `代收 ${o.merchantOrderNo}`]));
  }
  async function mapPayout(ids: string[]) {
    const os = await db.select({ id: payoutOrders.id, merchantOrderNo: payoutOrders.merchantOrderNo, merchantId: payoutOrders.merchantId }).from(payoutOrders).where(inArray(payoutOrders.id, ids));
    label.payout_order = Object.fromEntries(os.map((o) => [o.id, `代付 ${o.merchantOrderNo}`]));
  }
  async function mapSystemConfig(keys: string[]) {
    const cs = await db.select({ key: systemConfigs.key }).from(systemConfigs).where(inArray(systemConfigs.key, keys));
    label.system_config = Object.fromEntries(cs.map((c) => [c.key, `参数 ${c.key}`]));
  }
  async function mapIp(ids: string[]) {
    const xs = await db.select({ id: ipWhitelist.id, ip: ipWhitelist.ip }).from(ipWhitelist).where(inArray(ipWhitelist.id, ids));
    label.ip_whitelist = Object.fromEntries(xs.map((x) => [x.id, `IP ${x.ip}`]));
  }
  async function mapWebhook(ids: string[]) {
    const xs = await db.select({ id: webhookReceivers.id, name: webhookReceivers.name }).from(webhookReceivers).where(inArray(webhookReceivers.id, ids));
    label.webhook_receiver = Object.fromEntries(xs.map((x) => [x.id, `Webhook ${x.name}`]));
  }
  async function mapCallback(ids: string[]) {
    const xs = await db.select({ id: callbackTasks.id, orderType: callbackTasks.orderType, orderId: callbackTasks.orderId }).from(callbackTasks).where(inArray(callbackTasks.id, ids));
    label.callback_task = Object.fromEntries(xs.map((x) => [x.id, `回调任务 ${x.orderType}:${x.orderId}`]));
  }

  const tasks: Promise<void>[] = [];
  for (const [t, ids0] of byType.entries()) {
    const ids = uniq(ids0);
    if (t === "merchant") tasks.push(mapMerchants(ids));
    if (t === "collect_order") tasks.push(mapCollect(ids));
    if (t === "payout_order") tasks.push(mapPayout(ids));
    if (t === "system_config") tasks.push(mapSystemConfig(ids));
    if (t === "ip_whitelist") tasks.push(mapIp(ids));
    if (t === "webhook_receiver") tasks.push(mapWebhook(ids));
    if (t === "callback_task") tasks.push(mapCallback(ids));
    // merchant_limit_rule not yet labeled (optional future enhancement).
  }
  await Promise.all(tasks);

  const rows2 = (rows as any[]).map((r) => {
    const t = String(r.entityType ?? "");
    const id = String(r.entityId ?? "");
    const entityLabel = t && id ? (label[t]?.[id] ?? `${t}:${id}`) : "";
    return { ...r, entityLabel };
  });

  return NextResponse.json({
    ok: true,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    total,
    rows: rows2,
  });
}
