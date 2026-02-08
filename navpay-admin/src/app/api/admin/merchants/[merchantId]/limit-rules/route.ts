import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { merchantLimitRules } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { id } from "@/lib/id";
import { requireApiPerm } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const createSchema = z.object({
  type: z.enum(["collect", "payout"]),
  minAmount: z.string().default("0"),
  maxAmount: z.string().default("0"),
  dailyCountLimit: z.number().int().min(0).default(0),
  note: z.string().optional(),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ merchantId: string }> }) {
  await requireApiPerm(req, "merchant.read");
  const { merchantId } = await ctx.params;
  const rows = await db
    .select()
    .from(merchantLimitRules)
    .where(eq(merchantLimitRules.merchantId, merchantId))
    .orderBy(desc(merchantLimitRules.createdAtMs));

  // Enforce singleton rule rows per type: keep the newest row, delete others; create defaults if missing.
  const byType = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = String((r as any).type);
    const list = byType.get(key) ?? [];
    list.push(r);
    byType.set(key, list);
  }

  const keep: any[] = [];
  for (const t of ["collect", "payout"]) {
    const list = byType.get(t) ?? [];
    if (!list.length) {
      const rid = id("mlr");
      const row = {
        id: rid,
        merchantId,
        type: t,
        minAmount: "0",
        maxAmount: "0",
        dailyCountLimit: 0,
        enabled: true,
        note: null,
        createdAtMs: Date.now(),
      };
      await db.insert(merchantLimitRules).values(row as any);
      keep.push(row);
      continue;
    }
    const newest = list[0];
    // Limit rules are singleton and always enabled by design.
    if (!(newest as any).enabled) {
      await db
        .update(merchantLimitRules)
        .set({ enabled: true })
        .where(and(eq(merchantLimitRules.id, (newest as any).id), eq(merchantLimitRules.merchantId, merchantId)));
      (newest as any).enabled = true;
    }
    keep.push(newest);
    const extra = list.slice(1);
    if (extra.length) {
      // Delete extras to keep exactly one row per type.
      for (const x of extra) {
        await db.delete(merchantLimitRules).where(and(eq(merchantLimitRules.id, (x as any).id), eq(merchantLimitRules.merchantId, merchantId)));
      }
    }
  }

  return NextResponse.json({ ok: true, rows: keep });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ merchantId: string }> }) {
  const { uid } = await requireApiPerm(req, "merchant.write");
  const { merchantId } = await ctx.params;
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const existing = await db
    .select({ id: merchantLimitRules.id })
    .from(merchantLimitRules)
    .where(and(eq(merchantLimitRules.merchantId, merchantId), eq(merchantLimitRules.type, body.data.type)))
    .limit(1);
  if (existing.length) {
    return NextResponse.json({ ok: false, error: "singleton_rule_only" }, { status: 409 });
  }

  const ruleId = id("mlr");
  await db.insert(merchantLimitRules).values({
    id: ruleId,
    merchantId,
    type: body.data.type,
    minAmount: body.data.minAmount,
    maxAmount: body.data.maxAmount,
    dailyCountLimit: body.data.dailyCountLimit,
    enabled: true,
    note: body.data.note ?? null,
    createdAtMs: Date.now(),
  });

  // No-op: singleton rules are always enabled.

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "merchant.limit_rule_create",
    entityType: "merchant_limit_rule",
    entityId: ruleId,
    meta: { merchantId, ...body.data, enabled: true },
  });

  return NextResponse.json({ ok: true, id: ruleId });
}
