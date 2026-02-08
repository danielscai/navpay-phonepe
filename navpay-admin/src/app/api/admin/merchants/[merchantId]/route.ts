import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { merchants, merchantFees } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  enabled: z.boolean().optional(),
  collectFeeRateBps: z.number().int().min(0).max(5000).optional(),
  payoutFeeRateBps: z.number().int().min(0).max(5000).optional(),
  minFee: z.string().optional(),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ merchantId: string }> }) {
  await requireApiPerm(req, "merchant.read");
  const { merchantId } = await ctx.params;
  const m = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  const f = await db.select().from(merchantFees).where(eq(merchantFees.merchantId, merchantId)).limit(1);
  return NextResponse.json({ ok: true, merchant: m[0] ?? null, fees: f[0] ?? null });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ merchantId: string }> }) {
  const { uid } = await requireApiPerm(req, "merchant.write");
  const { merchantId } = await ctx.params;
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const beforeM = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  const beforeF = await db.select().from(merchantFees).where(eq(merchantFees.merchantId, merchantId)).limit(1);
  const prevM = beforeM[0] ?? null;
  const prevF = beforeF[0] ?? null;

  const { name, enabled, collectFeeRateBps, payoutFeeRateBps, minFee } = body.data;
  if (name !== undefined || enabled !== undefined) {
    await db
      .update(merchants)
      .set({ ...(name !== undefined ? { name } : {}), ...(enabled !== undefined ? { enabled } : {}), updatedAtMs: Date.now() })
      .where(eq(merchants.id, merchantId));
  }

  if (collectFeeRateBps !== undefined || payoutFeeRateBps !== undefined || minFee !== undefined) {
    await db
      .update(merchantFees)
      .set({
        ...(collectFeeRateBps !== undefined ? { collectFeeRateBps } : {}),
        ...(payoutFeeRateBps !== undefined ? { payoutFeeRateBps } : {}),
        ...(minFee !== undefined ? { minFee } : {}),
        updatedAtMs: Date.now(),
      })
      .where(eq(merchantFees.merchantId, merchantId));
  }

  const keys = Object.keys(body.data);
  const onlyEnabled = keys.length === 1 && keys[0] === "enabled";

  const changes: Record<string, { from: any; to: any }> = {};
  if (name !== undefined) changes.name = { from: prevM?.name ?? null, to: name };
  if (enabled !== undefined) changes.enabled = { from: prevM?.enabled ?? null, to: enabled };
  if (collectFeeRateBps !== undefined) changes.collectFeeRateBps = { from: prevF?.collectFeeRateBps ?? null, to: collectFeeRateBps };
  if (payoutFeeRateBps !== undefined) changes.payoutFeeRateBps = { from: prevF?.payoutFeeRateBps ?? null, to: payoutFeeRateBps };
  if (minFee !== undefined) changes.minFee = { from: prevF?.minFee ?? null, to: minFee };

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: onlyEnabled ? (enabled ? "merchant.enable" : "merchant.disable") : "merchant.update",
    entityType: "merchant",
    entityId: merchantId,
    meta: { changes },
  });

  return NextResponse.json({ ok: true });
}
