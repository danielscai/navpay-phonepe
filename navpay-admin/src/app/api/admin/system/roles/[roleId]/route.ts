import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { permissions, rolePermissions, roles, userRoles } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { and, eq, inArray } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
});

const permsSchema = z.object({
  permissionKeys: z.array(z.string().min(1)),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ roleId: string }> }) {
  const { uid } = await requireApiPerm(req, "system.write");
  const { roleId } = await ctx.params;
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const before = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  const prev = before[0] ?? null;
  if (!prev) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const next: any = {};
  if (body.data.name !== undefined) next.name = body.data.name;
  if (body.data.description !== undefined) next.description = body.data.description || null;
  if (!Object.keys(next).length) return NextResponse.json({ ok: true });

  await db.update(roles).set(next).where(eq(roles.id, roleId));

  const changes: Record<string, { from: any; to: any }> = {};
  for (const [k, v] of Object.entries(next)) changes[k] = { from: (prev as any)[k], to: v };
  await writeAuditLog({ req, actorUserId: uid, action: "system.role_update", entityType: "role", entityId: roleId, meta: { changes } });

  const row = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  return NextResponse.json({ ok: true, role: row[0] });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ roleId: string }> }) {
  const { uid } = await requireApiPerm(req, "system.write");
  const { roleId } = await ctx.params;
  const body = permsSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const exists = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!exists.length) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const permRows = body.data.permissionKeys.length
    ? await db.select().from(permissions).where(inArray(permissions.key, body.data.permissionKeys))
    : [];
  const permIds = permRows.map((p) => p.id);

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  for (const pid of permIds) {
    await db.insert(rolePermissions).values({ roleId, permissionId: pid }).onConflictDoNothing();
  }

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "system.role_set_permissions",
    entityType: "role",
    entityId: roleId,
    meta: { permissionKeys: body.data.permissionKeys.sort() },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ roleId: string }> }) {
  const { uid } = await requireApiPerm(req, "system.write");
  const { roleId } = await ctx.params;

  const row = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  const role = row[0] ?? null;
  if (!role) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  // Prevent deleting roles that are still assigned to users.
  const assigned = await db.select().from(userRoles).where(eq(userRoles.roleId, roleId)).limit(1);
  if (assigned.length) return NextResponse.json({ ok: false, error: "role_in_use" }, { status: 409 });

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  await db.delete(roles).where(eq(roles.id, roleId));

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "system.role_delete",
    entityType: "role",
    entityId: roleId,
    meta: { name: role.name },
  });

  return NextResponse.json({ ok: true });
}

