import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ipWhitelist } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  note: z.string().max(200).optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { uid } = await requireApiPerm(req, "system.write");
  const { id } = await ctx.params;
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const before = await db.select().from(ipWhitelist).where(eq(ipWhitelist.id, id)).limit(1);
  const prev = before[0] ?? null;

  await db
    .update(ipWhitelist)
    .set({
      enabled: body.data.enabled ?? undefined,
      note: body.data.note ?? undefined,
    })
    .where(eq(ipWhitelist.id, id));

  const keys = Object.keys(body.data);
  const onlyEnabled = keys.length === 1 && keys[0] === "enabled";
  const changes: Record<string, { from: any; to: any }> = {};
  if (body.data.enabled !== undefined) changes.enabled = { from: prev?.enabled ?? null, to: body.data.enabled };
  if (body.data.note !== undefined) changes.note = { from: prev?.note ?? null, to: body.data.note };

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: onlyEnabled ? (body.data.enabled ? "system.ip_whitelist_enable" : "system.ip_whitelist_disable") : "system.ip_whitelist_update",
    entityType: "ip_whitelist",
    entityId: id,
    meta: { changes },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { uid } = await requireApiPerm(req, "system.write");
  const { id } = await ctx.params;

  await db.delete(ipWhitelist).where(eq(ipWhitelist.id, id));

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "system.ip_whitelist_delete",
    entityType: "ip_whitelist",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
