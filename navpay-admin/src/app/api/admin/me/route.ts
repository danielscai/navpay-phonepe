import { NextResponse, type NextRequest } from "next/server";
import { requireApiUser } from "@/lib/api";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserPermissionKeys } from "@/lib/rbac";
import { env } from "@/lib/env";

export async function GET(req: NextRequest) {
  const { uid } = await requireApiUser(req, { csrf: false });
  const row = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  const u = row[0];
  if (!u) return NextResponse.json({ ok: false, error: "no_user" }, { status: 404 });

  const perms = Array.from(await getUserPermissionKeys(uid)).sort();

  return NextResponse.json({
    ok: true,
    user: { id: u.id, username: u.username, displayName: u.displayName },
    perms,
    debugToolsEnabled: env.ENABLE_DEBUG_TOOLS,
  });
}

