import crypto from "node:crypto";

export function id(prefix?: string): string {
  const v = crypto.randomUUID();
  return prefix ? `${prefix}_${v}` : v;
}

