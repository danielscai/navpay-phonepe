import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { merchantLimitRules, merchants } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { and, asc, eq } from "drizzle-orm";
import { id } from "@/lib/id";
import { writeAuditLog } from "@/lib/audit";

const querySchema = z.object({
  type: z.enum(["collect", "payout"]),
});

const patchSchema = z.object({
  merchantId: z.string().min(1),
  type: z.enum(["collect", "payout"]),
  minAmount: z.string().optional(),
  maxAmount: z.string().optional(),
  dailyCountLimit: z.coerce.number().int().min(0).optional(),
  note: z.string().nullable().optional(),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "merchant.read");
  const u = new URL(req.url);
  const parsed = querySchema.safeParse({ type: u.searchParams.get("type") ?? undefined });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  // Ensure each merchant has a singleton rule row for this type; create missing ones.
  const mchRows = await db.select({ id: merchants.id, code: merchants.code, name: merchants.name }).from(merchants).orderBy(asc(merchants.code));
  const rules = await db.select().from(merchantLimitRules).where(eq(merchantLimitRules.type, parsed.data.type));
  const ruleByMerchantId = new Map(rules.map((r) => [r.merchantId, r]));

  for (const m of mchRows) {
    if (ruleByMerchantId.has(m.id)) continue;
    const rid = id("mlr");
    const row = {
      id: rid,
      merchantId: m.id,
      type: parsed.data.type,
      minAmount: "0",
      maxAmount: "0",
      dailyCountLimit: 0,
      enabled: true,
      note: null,
      createdAtMs: Date.now(),
    } as any;
    await db.insert(merchantLimitRules).values(row);
    ruleByMerchantId.set(m.id, row);
  }

  return NextResponse.json({
    ok: true,
    type: parsed.data.type,
    rows: mchRows.map((m) => ({
      merchant: m,
      rule: ruleByMerchantId.get(m.id),
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const { uid } = await requireApiPerm(req, "merchant.write");
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const existing = await db
    .select()
    .from(merchantLimitRules)
    .where(and(eq(merchantLimitRules.merchantId, body.data.merchantId), eq(merchantLimitRules.type, body.data.type)))
    .limit(1);
  const prev = existing[0] ?? null;
  if (!prev) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const next: any = {};
  if (body.data.minAmount !== undefined) next.minAmount = body.data.minAmount;
  if (body.data.maxAmount !== undefined) next.maxAmount = body.data.maxAmount;
  if (body.data.dailyCountLimit !== undefined) next.dailyCountLimit = body.data.dailyCountLimit;
  if (body.data.note !== undefined) next.note = body.data.note;
  next.enabled = true; // singleton rules are always enabled

  await db.update(merchantLimitRules).set(next).where(eq(merchantLimitRules.id, prev.id));

  const changes: Record<string, { from: any; to: any }> = {};
  for (const [k, v] of Object.entries(next)) changes[k] = { from: (prev as any)[k], to: v };
  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "merchant.limit_rule_update",
    entityType: "merchant_limit_rule",
    entityId: prev.id,
    meta: { merchantId: body.data.merchantId, type: body.data.type, changes },
  });

  return NextResponse.json({ ok: true });
}
