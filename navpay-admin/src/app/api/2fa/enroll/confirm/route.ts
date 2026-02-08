import "dotenv/config";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptString, sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { verifyTotpCode } from "@/lib/totp";
import { requireApiUser } from "@/lib/api";

const bodySchema = z.object({
  token: z.string().min(6),
});

function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 8 chars
    codes.push(Math.random().toString(36).slice(2, 10).toUpperCase());
  }
  return codes;
}

export async function POST(req: NextRequest) {
  const { uid: userId } = await requireApiUser(req);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const row = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = row[0];
  if (!u || !u.totpSecretEnc) return NextResponse.json({ ok: false, error: "no_secret" }, { status: 400 });
  if (u.totpEnabled) return NextResponse.json({ ok: false, error: "already_enabled" }, { status: 400 });

  const secret = decryptString(u.totpSecretEnc, env.TOTP_ENCRYPTION_KEY);
  const ok = verifyTotpCode(secret, body.data.token);
  if (!ok) return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 400 });

  const backupCodes = generateBackupCodes();
  const hashed = backupCodes.map((x) => sha256Hex(x));

  await db
    .update(users)
    .set({
      totpEnabled: true,
      totpMustEnroll: false,
      totpBackupCodesHashJson: JSON.stringify(hashed),
      updatedAtMs: Date.now(),
    })
    .where(eq(users.id, userId));

  return NextResponse.json({ ok: true, backupCodes });
}
