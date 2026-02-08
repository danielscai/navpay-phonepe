import { db } from "@/lib/db";
import { merchantApiKeys } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { decryptString } from "@/lib/crypto";
import { env } from "@/lib/env";

export async function getActiveMerchantSecret(merchantId: string): Promise<{ keyId: string; secret: string } | null> {
  const rows = await db
    .select()
    .from(merchantApiKeys)
    .where(and(eq(merchantApiKeys.merchantId, merchantId), isNull(merchantApiKeys.revokedAtMs)))
    .orderBy(merchantApiKeys.createdAtMs);
  const k = rows.at(-1);
  if (!k) return null;
  const secret = decryptString(k.secretEnc, env.APIKEY_ENCRYPTION_KEY);
  return { keyId: k.keyId, secret };
}

