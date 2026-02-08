import "dotenv/config";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encryptString } from "@/lib/crypto";
import { env } from "@/lib/env";
import { buildOtpAuthUrl, generateTotpSecret } from "@/lib/totp";
import { requireCsrf } from "@/lib/csrf";
import { requireApiUser } from "@/lib/api";

export async function POST(req: NextRequest) {
  requireCsrf(req);
  const { uid: userId } = await requireApiUser(req);

  const row = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = row[0];
  if (!u) return NextResponse.json({ ok: false, error: "no_user" }, { status: 404 });
  if (u.totpEnabled) return NextResponse.json({ ok: false, error: "already_enabled" }, { status: 400 });

  // Create new secret and store encrypted; user must confirm with a token before enabling.
  const secret = generateTotpSecret();
  const secretEnc = encryptString(secret, env.TOTP_ENCRYPTION_KEY);

  await db
    .update(users)
    .set({
      totpSecretEnc: secretEnc,
      // keep totpEnabled false until confirm
      updatedAtMs: Date.now(),
    })
    .where(eq(users.id, userId));

  const accountName = u.email ?? u.username;
  const otpauth = buildOtpAuthUrl({ issuer: "NavPay", accountName, secret });

  return NextResponse.json({ ok: true, otpauth });
}
