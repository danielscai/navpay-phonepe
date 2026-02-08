import { NextResponse, type NextRequest } from "next/server";
import { requireApiUser } from "@/lib/api";
import { db } from "@/lib/db";
import { users, webauthnCredentials } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ passkeyId: string }> }) {
  const { uid } = await requireApiUser(req);
  const { passkeyId } = await ctx.params;

  const uRow = await db.select({ merchantId: users.merchantId }).from(users).where(eq(users.id, uid)).limit(1);
  const merchantId = uRow[0]?.merchantId ?? null;

  const row = await db
    .select()
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.id, passkeyId), eq(webauthnCredentials.userId, uid), isNull(webauthnCredentials.revokedAtMs)))
    .limit(1);
  const pk = row[0];
  if (!pk) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  await db
    .update(webauthnCredentials)
    .set({ revokedAtMs: Date.now() })
    .where(eq(webauthnCredentials.id, pk.id));

  await writeAuditLog({
    req,
    actorUserId: uid,
    merchantId,
    action: "account.passkey.revoke",
    entityType: "passkey",
    entityId: pk.id,
    meta: { deviceName: pk.deviceName ?? null },
  });

  return NextResponse.json({ ok: true });
}
