import crypto from "node:crypto";

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function deriveKey(keyMaterial: string): Buffer {
  // Accept raw string; in production prefer 32-byte base64.
  // Normalize to 32 bytes via SHA-256.
  return crypto.createHash("sha256").update(keyMaterial, "utf8").digest();
}

export function encryptString(plaintext: string, keyMaterial: string): string {
  const key = deriveKey(keyMaterial);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // v1:<iv>:<tag>:<ciphertext> (base64)
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

export function decryptString(ciphertext: string, keyMaterial: string): string {
  const [v, ivB64, tagB64, dataB64] = ciphertext.split(":");
  if (v !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid ciphertext format");
  }
  const key = deriveKey(keyMaterial);
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

