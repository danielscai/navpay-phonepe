import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { merchantIpWhitelist } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireApiMerchantUser } from "@/lib/api-merchant";
import { writeAuditLog } from "@/lib/audit";
import { isStepUpSatisfied } from "@/lib/stepup";

const patchSchema = z.object({
  note: z.string().max(128).nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { uid, merchantId } = await requireApiMerchantUser(req);
  if (!isStepUpSatisfied(req)) return NextResponse.json({ ok: false, error: "step_up_required" }, { status: 403 });
  const { id } = await ctx.params;
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const before = await db
    .select()
    .from(merchantIpWhitelist)
    .where(and(eq(merchantIpWhitelist.id, id), eq(merchantIpWhitelist.merchantId, merchantId)))
    .limit(1);
  if (!before[0]) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  await db
    .update(merchantIpWhitelist)
    .set({
      ...(body.data.note !== undefined ? { note: body.data.note } : {}),
      ...(body.data.enabled !== undefined ? { enabled: body.data.enabled } : {}),
    })
    .where(and(eq(merchantIpWhitelist.id, id), eq(merchantIpWhitelist.merchantId, merchantId)));

  const onlyEnabled = Object.keys(body.data).length === 1 && Object.keys(body.data)[0] === "enabled";

  await writeAuditLog({
    req,
    actorUserId: uid,
    merchantId,
    action: onlyEnabled
      ? body.data.enabled
        ? "merchant.ip_whitelist_enable"
        : "merchant.ip_whitelist_disable"
      : "merchant.ip_whitelist_update",
    entityType: "merchant_ip_whitelist",
    entityId: id,
    meta: { changes: { ...(body.data.note !== undefined ? { note: { from: before[0].note, to: body.data.note } } : {}), ...(body.data.enabled !== undefined ? { enabled: { from: before[0].enabled, to: body.data.enabled } } : {}) } },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { uid, merchantId } = await requireApiMerchantUser(req);
  if (!isStepUpSatisfied(req)) return NextResponse.json({ ok: false, error: "step_up_required" }, { status: 403 });
  const { id } = await ctx.params;

  const before = await db
    .select()
    .from(merchantIpWhitelist)
    .where(and(eq(merchantIpWhitelist.id, id), eq(merchantIpWhitelist.merchantId, merchantId)))
    .limit(1);
  if (!before[0]) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  await db.delete(merchantIpWhitelist).where(and(eq(merchantIpWhitelist.id, id), eq(merchantIpWhitelist.merchantId, merchantId)));

  await writeAuditLog({
    req,
    actorUserId: uid,
    merchantId,
    action: "merchant.ip_whitelist_delete",
    entityType: "merchant_ip_whitelist",
    entityId: id,
    meta: { ip: before[0].ip },
  });

  return NextResponse.json({ ok: true });
}
