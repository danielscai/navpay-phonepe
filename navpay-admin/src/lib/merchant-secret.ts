import { db } from "@/lib/db";
import { merchantApiKeys } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { decryptString } from "@/lib/crypto";
import { env } from "@/lib/env";

export type MerchantApiKeyDisplay = {
  keyId: string;
  secretPrefix: string;
  createdAtMs: number;
  secret?: string; // only when decrypt succeeds
  canDecrypt: boolean;
};

export async function getActiveMerchantApiKeyDisplay(merchantId: string): Promise<MerchantApiKeyDisplay | null> {
  const rows = await db
    .select()
    .from(merchantApiKeys)
    .where(and(eq(merchantApiKeys.merchantId, merchantId), isNull(merchantApiKeys.revokedAtMs)))
    .orderBy(merchantApiKeys.createdAtMs);
  const k = rows.at(-1);
  if (!k) return null;

  try {
    const secret = decryptString(k.secretEnc, env.APIKEY_ENCRYPTION_KEY);
    return { keyId: k.keyId, secretPrefix: k.secretPrefix, createdAtMs: k.createdAtMs, secret, canDecrypt: true };
  } catch {
    // Most common in dev: DB was seeded with a different APIKEY_ENCRYPTION_KEY.
    // Do not fail the entire request; merchant can ask admin to rotate key.
    return { keyId: k.keyId, secretPrefix: k.secretPrefix, createdAtMs: k.createdAtMs, canDecrypt: false };
  }
}

// Backwards-compatible helper used by callback-signing code.
export async function getActiveMerchantSecret(merchantId: string): Promise<{ keyId: string; secret: string } | null> {
  const k = await getActiveMerchantApiKeyDisplay(merchantId);
  if (!k?.canDecrypt || !k.secret) return null;
  return { keyId: k.keyId, secret: k.secret };
}
