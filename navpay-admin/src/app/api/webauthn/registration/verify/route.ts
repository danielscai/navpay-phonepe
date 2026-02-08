import "dotenv/config";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, webauthnCredentials } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiUser } from "@/lib/api";
import { id } from "@/lib/id";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { webauthnOrigin, webauthnRpId } from "@/lib/webauthn";

const bodySchema = z.object({
  credential: z.any(),
  deviceName: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
  const { uid } = await requireApiUser(req);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const expectedChallenge = req.cookies.get("np_webauthn_reg_chal")?.value;
  if (!expectedChallenge) return NextResponse.json({ ok: false, error: "missing_challenge" }, { status: 400 });

  const row = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  const u = row[0];
  if (!u) return NextResponse.json({ ok: false, error: "no_user" }, { status: 404 });

  const rpID = webauthnRpId();
  const origin = webauthnOrigin();

  const credential = body.data.credential as RegistrationResponseJSON;
  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ ok: false, error: "not_verified" }, { status: 400 });
  }

  const cred = verification.registrationInfo.credential;
  const credentialIdB64Url = cred.id;
  const publicKeyB64Url = isoBase64URL.fromBuffer(cred.publicKey);
  const counter = cred.counter;
  const transports = cred.transports ?? (credential.response as any)?.transports;

  await db.insert(webauthnCredentials).values({
    id: id("passkey"),
    userId: uid,
    credentialId: credentialIdB64Url,
    publicKey: publicKeyB64Url,
    counter,
    transportsJson: transports ? JSON.stringify(transports) : null,
    deviceName: body.data.deviceName ?? null,
    createdAtMs: Date.now(),
  });

  // Satisfy "must enroll MFA" once a passkey is created.
  if (u.totpMustEnroll) {
    await db.update(users).set({ totpMustEnroll: false, updatedAtMs: Date.now() }).where(eq(users.id, uid));
  }

  return NextResponse.json({ ok: true });
}
