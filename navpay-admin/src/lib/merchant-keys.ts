import { db } from "@/lib/db";
import { merchantApiKeys } from "@/db/schema";
import { id } from "@/lib/id";
import { encryptString, randomToken, sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { and, eq, isNull } from "drizzle-orm";

export async function createMerchantApiKey(merchantId: string): Promise<{ keyId: string; secret: string }> {
  const secret = "sk_" + randomToken(24);
  const keyId = "kid_" + randomToken(10);
  const secretEnc = encryptString(secret, env.APIKEY_ENCRYPTION_KEY);
  const secretHash = sha256Hex(secret);
  const secretPrefix = secret.slice(0, 6);
  await db.insert(merchantApiKeys).values({
    id: id("key"),
    merchantId,
    keyId,
    secretEnc,
    secretHash,
    secretPrefix,
    createdAtMs: Date.now(),
    revokedAtMs: null,
  });
  return { keyId, secret };
}

export async function revokeAllMerchantApiKeys(merchantId: string) {
  await db
    .update(merchantApiKeys)
    .set({ revokedAtMs: Date.now() })
    .where(and(eq(merchantApiKeys.merchantId, merchantId), isNull(merchantApiKeys.revokedAtMs)));
}

