import crypto from "node:crypto";
import { env } from "@/lib/env";

// Pre-auth token to allow 2FA enrollment before full session exists.
// Stored as an encrypted+signed blob in an HttpOnly cookie.

type PreauthPayload = {
  userId: string;
  expMs: number;
};

function key(): Buffer {
  return crypto.createHash("sha256").update(env.AUTH_SECRET, "utf8").digest();
}

export function sealPreauth(payload: PreauthPayload): string {
  const k = key();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.from(JSON.stringify(payload), "utf8");
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function openPreauth(token: string): PreauthPayload {
  const [v, ivB64, tagB64, dataB64] = token.split(":");
  if (v !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("bad token");
  const k = key();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  const payload = JSON.parse(dec.toString("utf8")) as PreauthPayload;
  if (!payload?.userId || !payload?.expMs) throw new Error("bad payload");
  if (payload.expMs < Date.now()) throw new Error("expired");
  return payload;
}

