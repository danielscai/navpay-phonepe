import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword } from "@/lib/password";
import { decryptString, sha256Hex } from "@/lib/crypto";
import { verifyTotpCode } from "@/lib/totp";
import { webauthnCredentials } from "@/db/schema";
import { and, isNull } from "drizzle-orm";
import { readCookieFromHeader } from "@/lib/webauthn-cookie";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { webauthnOrigin, webauthnRpId } from "@/lib/webauthn";

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().optional(),
  totp: z.string().optional(),
  webauthn: z.string().optional(),
});

function isLikelyBackupCode(s: string): boolean {
  // Seeded backup codes are 8 chars A-Z0-9. We'll accept length >= 8 to be tolerant.
  return /^[A-Z0-9]{8,}$/.test(s);
}

export const authOptions: NextAuthOptions = {
  secret: env.AUTH_SECRET,
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
        totp: { label: "TOTP", type: "text" },
      },
      async authorize(raw, req) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { username, password, totp, webauthn } = parsed.data;

        const row = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);
        const u = row[0];
        if (!u) return null;

        const now = Date.now();
        if (u.lockUntilMs && u.lockUntilMs > now) return null;

        if (webauthn) {
          // Passkey login. Does not require password/TOTP.
          let assertion: AuthenticationResponseJSON;
          try {
            assertion = JSON.parse(webauthn) as AuthenticationResponseJSON;
          } catch {
            return null;
          }

          // Bind challenge to username to avoid replay with a different account.
          const cookieHeader =
            (req as any)?.headers?.cookie ??
            ((req as any)?.headers?.get ? (req as any).headers.get("cookie") : undefined);
          const expectedChallenge = readCookieFromHeader(cookieHeader, "np_webauthn_auth_chal");
          const expectedUser = readCookieFromHeader(cookieHeader, "np_webauthn_auth_user");
          if (!expectedChallenge || !expectedUser || expectedUser !== username) return null;

          const creds = await db
            .select()
            .from(webauthnCredentials)
            .where(and(eq(webauthnCredentials.userId, u.id), isNull(webauthnCredentials.revokedAtMs)));

          const credId = assertion.id;
          const match = creds.find((c) => c.credentialId === credId);
          if (!match) return null;

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

          if (!verification.verified || !verification.authenticationInfo) return null;

          const nextCounter = verification.authenticationInfo.newCounter;
          await db
            .update(webauthnCredentials)
            .set({ counter: nextCounter, lastUsedAtMs: Date.now() })
            .where(eq(webauthnCredentials.id, match.id));
        } else {
          if (!password) return null;
          const ok = await verifyPassword(u.passwordHash, password);
          if (!ok) return null;

          if (u.totpEnabled) {
            if (!totp) return null;
            const token = totp.trim().toUpperCase();

            // Allow backup-code login when user lost authenticator.
            if (isLikelyBackupCode(token) && u.totpBackupCodesHashJson) {
              let list: string[] = [];
              try {
                const parsed = JSON.parse(u.totpBackupCodesHashJson);
                if (Array.isArray(parsed)) list = parsed.map((x) => String(x));
              } catch {
                list = [];
              }
              const h = sha256Hex(token);
              const idx = list.indexOf(h);
              if (idx >= 0) {
                // Consume used code (one-time use).
                list.splice(idx, 1);
                await db
                  .update(users)
                  .set({ totpBackupCodesHashJson: JSON.stringify(list), updatedAtMs: Date.now() })
                  .where(eq(users.id, u.id));
              } else {
                return null;
              }
            } else {
              // TOTP token
              if (!u.totpSecretEnc) return null;
              const secret = decryptString(u.totpSecretEnc, env.TOTP_ENCRYPTION_KEY);
              const ok2 = verifyTotpCode(secret, token);
              if (!ok2) return null;
            }
          }
        }

        return {
          id: u.id,
          name: u.displayName,
          email: u.email ?? undefined,
        };
      },
    }),
  ],
  pages: {
    signIn: "/auth/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      (session as any).uid = token.uid;
      return session;
    },
  },
};
