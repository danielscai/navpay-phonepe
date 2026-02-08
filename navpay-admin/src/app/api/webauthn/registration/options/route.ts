import "dotenv/config";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, webauthnCredentials } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireApiUser } from "@/lib/api";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { webauthnOrigin, webauthnRpId } from "@/lib/webauthn";
import { buildSetCookie } from "@/lib/webauthn-cookie";

export async function POST(req: NextRequest) {
  // Options endpoint does not modify state. Keep it CSRF-free to avoid clients being blocked by CSRF cookie sync issues.
  const { uid } = await requireApiUser(req, { csrf: false });

  try {
    const row = await db.select().from(users).where(eq(users.id, uid)).limit(1);
    const u = row[0];
    if (!u) return NextResponse.json({ ok: false, error: "no_user" }, { status: 404 });

    const creds = await db
      .select()
      .from(webauthnCredentials)
      .where(and(eq(webauthnCredentials.userId, uid), isNull(webauthnCredentials.revokedAtMs)));

    const rpID = webauthnRpId();
    const origin = webauthnOrigin();

    const options = await generateRegistrationOptions({
      rpName: "NavPay",
      rpID,
      userID: new TextEncoder().encode(u.id),
      userName: u.username,
      userDisplayName: u.displayName,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      timeout: 60_000,
      excludeCredentials: creds.map((c) => ({
        id: c.credentialId,
        transports: c.transportsJson ? (JSON.parse(c.transportsJson) as any) : undefined,
      })),
    });

    const res = NextResponse.json({ ok: true, options, rpID, origin });
    res.headers.append(
      "Set-Cookie",
      buildSetCookie("np_webauthn_reg_chal", options.challenge, {
        httpOnly: true,
        secure: origin.startsWith("https://"),
        sameSite: "lax",
        maxAgeSec: 300,
      }),
    );
    return res;
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "";
    if (msg.includes("no such table: webauthn_credentials")) {
      return NextResponse.json(
        {
          ok: false,
          error: "db_not_migrated",
          message: "数据库缺少 Passkey 表，请先运行 yarn db:migrate（开发库）",
        },
        { status: 500 },
      );
    }
    throw e;
  }
}
