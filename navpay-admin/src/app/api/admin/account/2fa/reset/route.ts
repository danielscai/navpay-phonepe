import { NextResponse, type NextRequest } from "next/server";
import { requireApiUser } from "@/lib/api";
import { db } from "@/lib/db";
import { users, webauthnCredentials } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const { uid } = await requireApiUser(req);

  const passkey = await db
    .select({ id: webauthnCredentials.id })
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, uid), isNull(webauthnCredentials.revokedAtMs)))
    .limit(1);

  await db
    .update(users)
    .set({
      totpEnabled: false,
      // If user already has a passkey, don't force MFA enrollment again.
      totpMustEnroll: passkey.length ? false : true,
      totpSecretEnc: null,
      totpBackupCodesHashJson: null,
      updatedAtMs: Date.now(),
    })
    .where(eq(users.id, uid));

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "account.reset_2fa",
    entityType: "user",
    entityId: uid,
    meta: {},
  });

  return NextResponse.json({ ok: true });
}
