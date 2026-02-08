import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { merchants, webauthnCredentials } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export async function requireMerchantSessionUser() {
  const { session, user } = await requireSessionUser();
  if (!user.merchantId) redirect("/admin");

  const row = await db.select().from(merchants).where(eq(merchants.id, user.merchantId)).limit(1);
  const merchant = row[0];
  if (!merchant) redirect("/auth/login");
  if (!merchant.enabled) redirect("/auth/login");

  if (user.totpMustEnroll) {
    const passkey = await db
      .select({ id: webauthnCredentials.id })
      .from(webauthnCredentials)
      .where(and(eq(webauthnCredentials.userId, user.id), isNull(webauthnCredentials.revokedAtMs)))
      .limit(1);
    if (!passkey.length) redirect("/auth/2fa/enroll");
  }

  return { session, user, merchant };
}
