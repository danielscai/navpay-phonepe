import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { userRoles, users } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { and, eq, isNull } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit";

const patchSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  email: z.string().email().optional().or(z.literal("")),
  totpMustEnroll: z.coerce.boolean().optional(),
  roleIds: z.array(z.string().min(1)).optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const { uid } = await requireApiPerm(req, "system.write");
  const { userId } = await ctx.params;
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const before = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.merchantId))).limit(1);
  const prev = before[0] ?? null;
  if (!prev) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const next: any = {};
  if (body.data.displayName !== undefined) next.displayName = body.data.displayName.trim();
  if (body.data.email !== undefined) next.email = body.data.email.trim() ? body.data.email.trim() : null;
  if (body.data.totpMustEnroll !== undefined) next.totpMustEnroll = body.data.totpMustEnroll;
  if (Object.keys(next).length) {
    next.updatedAtMs = Date.now();
    await db.update(users).set(next).where(eq(users.id, userId));
  }

  let rolesChanged = false;
  if (body.data.roleIds) {
    rolesChanged = true;
    await db.delete(userRoles).where(eq(userRoles.userId, userId));
    for (const rid of body.data.roleIds) {
      await db.insert(userRoles).values({ userId, roleId: rid }).onConflictDoNothing();
    }
  }

  const changes: Record<string, { from: any; to: any }> = {};
  for (const [k, v] of Object.entries(next)) changes[k] = { from: (prev as any)[k], to: v };
  if (rolesChanged) changes.roleIds = { from: "?", to: body.data.roleIds };

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "system.user_update",
    entityType: "user",
    entityId: userId,
    meta: { changes },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const { uid } = await requireApiPerm(req, "system.write");
  const { userId } = await ctx.params;

  const row = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.merchantId))).limit(1);
  const u = row[0] ?? null;
  if (!u) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (u.id === uid) return NextResponse.json({ ok: false, error: "cannot_delete_self" }, { status: 400 });

  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  await db.delete(users).where(eq(users.id, userId));

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "system.user_delete",
    entityType: "user",
    entityId: userId,
    meta: { username: u.username, displayName: u.displayName },
  });

  return NextResponse.json({ ok: true });
}

