import { randomToken } from "@/lib/crypto";
import { validateStrongPassword } from "@/lib/password";

export function randomStrongPassword(): string {
  // Ensure policy: >=12, upper/lower/digit/symbol.
  // randomToken() is base64url so it already contains [A-Za-z0-9_-].
  for (let i = 0; i < 20; i++) {
    const pw = `Aa1!${randomToken(12)}`;
    if (validateStrongPassword(pw).ok) return pw;
  }
  // Fallback (should never happen).
  return `Aa1!${randomToken(24)}`;
}

