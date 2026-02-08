import "dotenv/config";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { webauthnCredentials } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireApiUser } from "@/lib/api";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { webauthnOrigin, webauthnRpId } from "@/lib/webauthn";
import { buildSetCookie } from "@/lib/webauthn-cookie";

export async function POST(req: NextRequest) {
  // This is a step-up auth for an already logged-in user. Use session auth + CSRF.
  const { uid } = await requireApiUser(req);

  const creds = await db
    .select()
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, uid), isNull(webauthnCredentials.revokedAtMs)));

  if (!creds.length) return NextResponse.json({ ok: false, error: "no_passkey" }, { status: 400 });

  const rpID = webauthnRpId();
  const origin = webauthnOrigin();

  const options = await generateAuthenticationOptions({
    rpID,
    timeout: 60_000,
    userVerification: "preferred",
    allowCredentials: creds.map((c) => ({
      id: c.credentialId,
      transports: c.transportsJson ? (JSON.parse(c.transportsJson) as any) : undefined,
    })),
  });

  const res = NextResponse.json({ ok: true, options, rpID, origin });
  res.headers.append(
    "Set-Cookie",
    buildSetCookie("np_webauthn_stepup_chal", options.challenge, {
      httpOnly: true,
      secure: origin.startsWith("https://"),
      sameSite: "lax",
      maxAgeSec: 300,
    }),
  );
  return res;
}

