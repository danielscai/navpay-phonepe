import { env } from "@/lib/env";

function urlHost(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "localhost";
  }
}

export function webauthnRpId(): string {
  // For WebAuthn, rpID must be the effective domain (no scheme/port).
  return env.WEBAUTHN_RP_ID || urlHost(env.APP_BASE_URL);
}

export function webauthnOrigin(): string {
  // Origin must match browser origin exactly (scheme + host + optional port).
  return env.WEBAUTHN_ORIGIN || env.APP_BASE_URL;
}

