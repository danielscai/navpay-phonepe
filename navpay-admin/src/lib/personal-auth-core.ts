import { sha256Hex } from "@/lib/crypto";

export function tokenHash(token: string): string {
  return sha256Hex(token);
}

