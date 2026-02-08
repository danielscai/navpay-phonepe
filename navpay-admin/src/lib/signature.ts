import crypto from "node:crypto";

export function hmacSha256Base64(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("base64");
}

