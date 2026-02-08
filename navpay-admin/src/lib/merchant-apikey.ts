import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { merchants, merchantApiKeys, merchantIpWhitelist } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { sha256Hex } from "@/lib/crypto";
import { getClientIp } from "@/lib/http";
import crypto from "node:crypto";

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export async function requireMerchantApiKey(req: NextRequest): Promise<{ merchantId: string; keyId: string }> {
  const keyId = req.headers.get("x-navpay-key-id")?.trim() ?? "";
  const secret = req.headers.get("x-navpay-secret")?.trim() ?? "";
  if (!keyId || !secret) {
    const e = new Error("unauthorized");
    (e as any).status = 401;
    throw e;
  }

  const rows = await db
    .select()
    .from(merchantApiKeys)
    .where(and(eq(merchantApiKeys.keyId, keyId), isNull(merchantApiKeys.revokedAtMs)))
    .limit(1);
  const k = rows[0];
  if (!k) {
    const e = new Error("unauthorized");
    (e as any).status = 401;
    throw e;
  }

  const presentedHash = sha256Hex(secret);
  if (!safeEqualHex(presentedHash, k.secretHash)) {
    const e = new Error("unauthorized");
    (e as any).status = 401;
    throw e;
  }

  const m = await db.select().from(merchants).where(eq(merchants.id, k.merchantId)).limit(1);
  if (!m[0] || !m[0].enabled) {
    const e = new Error("forbidden");
    (e as any).status = 403;
    throw e;
  }

  const enabledIps = await db
    .select({ ip: merchantIpWhitelist.ip })
    .from(merchantIpWhitelist)
    .where(and(eq(merchantIpWhitelist.merchantId, k.merchantId), eq(merchantIpWhitelist.enabled, true)));
  if (enabledIps.length) {
    const ip = getClientIp(req);
    if (!ip || !enabledIps.some((x) => x.ip === ip)) {
      const e = new Error("ip_not_allowed");
      (e as any).status = 403;
      throw e;
    }
  }

  return { merchantId: k.merchantId, keyId: k.keyId };
}

