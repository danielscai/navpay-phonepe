import { hash as argon2hash, verify as argon2verify } from "@node-rs/argon2";

export async function hashPassword(password: string): Promise<string> {
  return argon2hash(password);
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  return argon2verify(hash, password);
}

export function validateStrongPassword(pw: string): { ok: boolean; reason?: string } {
  // Simple strong policy for admin:
  // - length >= 12
  // - at least 1 upper, 1 lower, 1 digit, 1 symbol
  if (pw.length < 12) return { ok: false, reason: "密码长度至少 12 位" };
  if (!/[a-z]/.test(pw)) return { ok: false, reason: "需包含小写字母" };
  if (!/[A-Z]/.test(pw)) return { ok: false, reason: "需包含大写字母" };
  if (!/[0-9]/.test(pw)) return { ok: false, reason: "需包含数字" };
  if (!/[^a-zA-Z0-9]/.test(pw)) return { ok: false, reason: "需包含符号" };
  return { ok: true };
}

