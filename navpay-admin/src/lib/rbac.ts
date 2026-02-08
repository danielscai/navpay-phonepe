import { db } from "@/lib/db";
import { permissions, rolePermissions, roles, userRoles } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function getUserPermissionKeys(userId: string): Promise<Set<string>> {
  const ur = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  const roleIds = ur.map((r) => r.roleId);
  if (!roleIds.length) return new Set();

  const rp = await db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds));
  const permIds = rp.map((x) => x.permissionId);
  if (!permIds.length) return new Set();

  const ps = await db.select().from(permissions).where(inArray(permissions.id, permIds));
  return new Set(ps.map((p) => p.key));
}

export async function requirePerm(userId: string, perm: string) {
  const keys = await getUserPermissionKeys(userId);
  if (keys.has("admin.all")) return;
  if (!keys.has(perm)) {
    const e = new Error("forbidden");
    (e as any).status = 403;
    throw e;
  }
}

