import "dotenv/config";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { webauthnCredentials } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireApiUser } from "@/lib/api";
import { readCookieFromHeader, buildSetCookie } from "@/lib/webauthn-cookie";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { webauthnOrigin, webauthnRpId } from "@/lib/webauthn";
import { STEPUP_COOKIE, STEPUP_TTL_MS } from "@/lib/stepup";

const bodySchema = z.object({
  credential: z.any(),
});

export async function POST(req: NextRequest) {
  const { uid } = await requireApiUser(req);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  let assertion: AuthenticationResponseJSON;
  try {
    assertion = body.data.credential as AuthenticationResponseJSON;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_credential" }, { status: 400 });
  }

  const cookieHeader = req.headers.get("cookie");
  const expectedChallenge = readCookieFromHeader(cookieHeader, "np_webauthn_stepup_chal");
  if (!expectedChallenge) return NextResponse.json({ ok: false, error: "missing_challenge" }, { status: 400 });

  const creds = await db
    .select()
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, uid), isNull(webauthnCredentials.revokedAtMs)));
  if (!creds.length) return NextResponse.json({ ok: false, error: "no_passkey" }, { status: 400 });

  const match = creds.find((c) => c.credentialId === assertion.id);
  if (!match) return NextResponse.json({ ok: false, error: "unknown_credential" }, { status: 400 });

  const verification = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge,
    expectedOrigin: webauthnOrigin(),
    expectedRPID: [webauthnRpId()],
    requireUserVerification: false,
    credential: {
      id: match.credentialId,
      publicKey: isoBase64URL.toBuffer(match.publicKey),
      counter: match.counter,
      transports: match.transportsJson ? (JSON.parse(match.transportsJson) as any) : undefined,
    },
  });

  if (!verification.verified || !verification.authenticationInfo) {
    return NextResponse.json({ ok: false, error: "verify_failed" }, { status: 400 });
  }

  const nextCounter = verification.authenticationInfo.newCounter;
  await db.update(webauthnCredentials).set({ counter: nextCounter, lastUsedAtMs: Date.now() }).where(eq(webauthnCredentials.id, match.id));

  const origin = webauthnOrigin();
  const untilMs = Date.now() + STEPUP_TTL_MS;
  const res = NextResponse.json({ ok: true, untilMs });
  res.headers.append(
    "Set-Cookie",
    buildSetCookie(STEPUP_COOKIE, String(untilMs), {
      httpOnly: true,
      secure: origin.startsWith("https://"),
      sameSite: "lax",
      maxAgeSec: Math.floor(STEPUP_TTL_MS / 1000),
    }),
  );
  // Best-effort clear challenge cookie.
  res.headers.append(
    "Set-Cookie",
    buildSetCookie("np_webauthn_stepup_chal", "", {
      httpOnly: true,
      secure: origin.startsWith("https://"),
      sameSite: "lax",
      maxAgeSec: 0,
    }),
  );
  return res;
}

