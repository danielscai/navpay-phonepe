import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { merchantLimitRules } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const patchSchema = z.object({
  minAmount: z.string().optional(),
  maxAmount: z.string().optional(),
  dailyCountLimit: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
  note: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ merchantId: string; ruleId: string }> }) {
  const { uid } = await requireApiPerm(req, "merchant.write");
  const { merchantId, ruleId } = await ctx.params;
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const before = await db
    .select()
    .from(merchantLimitRules)
    .where(and(eq(merchantLimitRules.id, ruleId), eq(merchantLimitRules.merchantId, merchantId)))
    .limit(1);
  const prev = before[0] ?? null;

  await db
    .update(merchantLimitRules)
    .set({
      ...(body.data.minAmount !== undefined ? { minAmount: body.data.minAmount } : {}),
      ...(body.data.maxAmount !== undefined ? { maxAmount: body.data.maxAmount } : {}),
      ...(body.data.dailyCountLimit !== undefined ? { dailyCountLimit: body.data.dailyCountLimit } : {}),
      ...(body.data.enabled !== undefined ? { enabled: body.data.enabled } : {}),
      ...(body.data.note !== undefined ? { note: body.data.note } : {}),
    })
    .where(and(eq(merchantLimitRules.id, ruleId), eq(merchantLimitRules.merchantId, merchantId)));

  const changes: Record<string, { from: any; to: any }> = {};
  if (body.data.minAmount !== undefined) changes.minAmount = { from: prev?.minAmount ?? null, to: body.data.minAmount };
  if (body.data.maxAmount !== undefined) changes.maxAmount = { from: prev?.maxAmount ?? null, to: body.data.maxAmount };
  if (body.data.dailyCountLimit !== undefined) changes.dailyCountLimit = { from: prev?.dailyCountLimit ?? null, to: body.data.dailyCountLimit };
  if (body.data.enabled !== undefined) changes.enabled = { from: prev?.enabled ?? null, to: body.data.enabled };
  if (body.data.note !== undefined) changes.note = { from: prev?.note ?? null, to: body.data.note };

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "merchant.limit_rule_update",
    entityType: "merchant_limit_rule",
    entityId: ruleId,
    meta: { merchantId, changes },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ merchantId: string; ruleId: string }> }) {
  const { uid } = await requireApiPerm(req, "merchant.write");
  const { merchantId, ruleId } = await ctx.params;

  await db
    .delete(merchantLimitRules)
    .where(and(eq(merchantLimitRules.id, ruleId), eq(merchantLimitRules.merchantId, merchantId)));

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "merchant.limit_rule_delete",
    entityType: "merchant_limit_rule",
    entityId: ruleId,
    meta: { merchantId },
  });

  return NextResponse.json({ ok: true });
}
