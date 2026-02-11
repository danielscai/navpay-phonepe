import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { permissions, rolePermissions, roles } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { asc, eq, inArray } from "drizzle-orm";
import { id } from "@/lib/id";
import { writeAuditLog } from "@/lib/audit";

const createSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  permissionKeys: z.array(z.string().min(1)).default([]),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "system.read");
  const roleRows = await db.select().from(roles).orderBy(asc(roles.name));
  const permRows = await db.select().from(permissions).orderBy(asc(permissions.key));

  const rp = await db.select().from(rolePermissions);
  const permById = new Map(permRows.map((p) => [p.id, p.key]));
  const keysByRoleId = new Map<string, string[]>();
  for (const x of rp) {
    const k = permById.get(x.permissionId);
    if (!k) continue;
    const list = keysByRoleId.get(x.roleId) ?? [];
    list.push(k);
    keysByRoleId.set(x.roleId, list);
  }
  for (const [rid, list] of keysByRoleId) list.sort();

  return NextResponse.json({
    ok: true,
    roles: roleRows.map((r) => ({ ...r, permissionKeys: keysByRoleId.get(r.id) ?? [] })),
    permissions: permRows,
  });
}

export async function POST(req: NextRequest) {
  const { uid } = await requireApiPerm(req, "system.write");
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const roleId = id("role");
  await db.insert(roles).values({ id: roleId, name: body.data.name, description: body.data.description ?? null, createdAtMs: Date.now() } as any);

  const permRows = body.data.permissionKeys.length
    ? await db.select().from(permissions).where(inArray(permissions.key, body.data.permissionKeys))
    : [];
  for (const p of permRows) {
    await db.insert(rolePermissions).values({ roleId, permissionId: p.id }).onConflictDoNothing();
  }

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "system.role_create",
    entityType: "role",
    entityId: roleId,
    meta: { name: body.data.name, permissionKeys: body.data.permissionKeys },
  });

  const row = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  return NextResponse.json({ ok: true, role: { ...row[0], permissionKeys: body.data.permissionKeys.sort() } });
}

