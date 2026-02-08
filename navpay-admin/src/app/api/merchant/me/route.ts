import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { merchantFees, merchantLimitRules, merchants } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireApiMerchantUser } from "@/lib/api-merchant";
import { getActiveMerchantApiKeyDisplay } from "@/lib/merchant-secret";

export async function GET(req: NextRequest) {
  const { merchantId, uid, user } = await requireApiMerchantUser(req, { csrf: false });

  const mRow = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  const fRow = await db.select().from(merchantFees).where(eq(merchantFees.merchantId, merchantId)).limit(1);
  const rules = await db
    .select()
    .from(merchantLimitRules)
    .where(eq(merchantLimitRules.merchantId, merchantId))
    .orderBy(desc(merchantLimitRules.createdAtMs));

  const key = await getActiveMerchantApiKeyDisplay(merchantId);

  return NextResponse.json({
    ok: true,
    uid,
    user: { id: user.id, username: user.username, displayName: user.displayName },
    merchant: mRow[0] ?? null,
    fees: fRow[0] ?? null,
    limitRules: rules ?? [],
    apiKey: key
      ? {
          keyId: key.keyId,
          secretPrefix: key.secretPrefix,
          secret: key.secret ?? null,
          canDecrypt: key.canDecrypt,
        }
      : null,
  });
}
