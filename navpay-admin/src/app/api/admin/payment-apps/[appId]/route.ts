import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { paymentApps } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  packageName: z.string().min(2).optional(),
  versionCode: z.coerce.number().int().min(1).optional(),
  downloadUrl: z.string().min(4).optional(),
  iconUrl: z.string().url().optional().or(z.literal("")),
  minSupportedVersionCode: z.coerce.number().int().min(0).optional(),
  payoutEnabled: z.coerce.boolean().optional(),
  collectEnabled: z.coerce.boolean().optional(),
  promoted: z.coerce.boolean().optional(),
  enabled: z.coerce.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ appId: string }> }) {
  const { uid } = await requireApiPerm(req, "system.write");
  const { appId } = await ctx.params;
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const before = await db.select().from(paymentApps).where(eq(paymentApps.id, appId)).limit(1);
  const prev = before[0] ?? null;
  if (!prev) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const next: Record<string, any> = {};
  for (const [k, v] of Object.entries(body.data)) {
    if (v === undefined) continue;
    if (k === "iconUrl") next.iconUrl = String(v).trim() ? String(v).trim() : null;
    else next[k] = v;
  }

  await db.update(paymentApps).set(next).where(eq(paymentApps.id, appId));

  const changes: Record<string, { from: any; to: any }> = {};
  for (const [k, v] of Object.entries(next)) {
    changes[k] = { from: (prev as any)[k], to: v };
  }

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "system.payment_app_update",
    entityType: "payment_app",
    entityId: appId,
    meta: { changes },
  });

  const row = await db.select().from(paymentApps).where(eq(paymentApps.id, appId)).limit(1);
  return NextResponse.json({ ok: true, row: row[0] });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ appId: string }> }) {
  const { uid } = await requireApiPerm(req, "system.write");
  const { appId } = await ctx.params;

  const before = await db.select().from(paymentApps).where(eq(paymentApps.id, appId)).limit(1);
  const prev = before[0] ?? null;
  if (!prev) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  await db.delete(paymentApps).where(eq(paymentApps.id, appId));

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "system.payment_app_delete",
    entityType: "payment_app",
    entityId: appId,
    meta: { packageName: prev.packageName, name: prev.name },
  });

  return NextResponse.json({ ok: true });
}

