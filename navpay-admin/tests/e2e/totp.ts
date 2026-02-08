export function parseSecretFromOtpAuth(otpauth: string): string {
  const u = new URL(otpauth);
  const secret = u.searchParams.get("secret");
  if (!secret) throw new Error("missing secret in otpauth");
  return secret;
}

function base32Decode(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function toBigEndian8(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  let x = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return buf;
}

async function hmacSha1(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, msg);
  return new Uint8Array(sig);
}

export async function totpToken(secretBase32: string, timeMs = Date.now()): Promise<string> {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timeMs / 1000 / 30);
  const msg = toBigEndian8(counter);
  const digest = await hmacSha1(key, msg);
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const otp = (bin % 1_000_000).toString().padStart(6, "0");
  return otp;
}

