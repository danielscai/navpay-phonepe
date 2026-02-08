import "dotenv/config";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, webauthnCredentials } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireCsrf } from "@/lib/csrf";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { webauthnOrigin, webauthnRpId } from "@/lib/webauthn";
import { buildSetCookie } from "@/lib/webauthn-cookie";

const bodySchema = z.object({
  username: z.string().min(1).max(64),
});

export async function POST(req: NextRequest) {
  requireCsrf(req);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const row = await db.select().from(users).where(eq(users.username, body.data.username)).limit(1);
  const u = row[0];
  if (!u) return NextResponse.json({ ok: false, error: "no_user" }, { status: 404 });

  const creds = await db
    .select()
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, u.id), isNull(webauthnCredentials.revokedAtMs)));

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
    buildSetCookie("np_webauthn_auth_chal", options.challenge, {
      httpOnly: true,
      secure: origin.startsWith("https://"),
      sameSite: "lax",
      maxAgeSec: 300,
    }),
  );
  res.headers.append(
    "Set-Cookie",
    buildSetCookie("np_webauthn_auth_user", u.username, {
      httpOnly: true,
      secure: origin.startsWith("https://"),
      sameSite: "lax",
      maxAgeSec: 300,
    }),
  );
  return res;
}
