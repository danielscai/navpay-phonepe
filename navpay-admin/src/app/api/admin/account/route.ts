import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit";

const patchSchema = z.object({
  displayName: z.string().min(2).max(64),
});

export async function GET(req: NextRequest) {
  const { uid } = await requireApiUser(req, { csrf: false });
  const row = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  const u = row[0];
  if (!u) return NextResponse.json({ ok: false, error: "no_user" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    account: {
      username: u.username,
      displayName: u.displayName,
      email: u.email,
      totpEnabled: !!u.totpEnabled,
      totpMustEnroll: !!u.totpMustEnroll,
      passwordUpdatedAtMs: u.passwordUpdatedAtMs,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const { uid } = await requireApiUser(req);
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  await db.update(users).set({ displayName: body.data.displayName, updatedAtMs: Date.now() }).where(eq(users.id, uid));

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "account.update_profile",
    entityType: "user",
    entityId: uid,
    meta: { displayName: body.data.displayName },
  });

  return NextResponse.json({ ok: true });
}

