import { NextResponse, type NextRequest } from "next/server";
import { requireApiPerm } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { createMerchantApiKey, revokeAllMerchantApiKeys } from "@/lib/merchant-keys";
import { getActiveMerchantApiKeyDisplay } from "@/lib/merchant-secret";

export async function GET(req: NextRequest, ctx: { params: Promise<{ merchantId: string }> }) {
  await requireApiPerm(req, "merchant.read");
  const { merchantId } = await ctx.params;

  const k = await getActiveMerchantApiKeyDisplay(merchantId);
  if (!k) return NextResponse.json({ ok: true, apiKey: null });
  return NextResponse.json({
    ok: true,
    apiKey: { keyId: k.keyId, secret: k.secret ?? null, secretPrefix: k.secretPrefix, createdAtMs: k.createdAtMs, canDecrypt: k.canDecrypt },
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ merchantId: string }> }) {
  const { uid } = await requireApiPerm(req, "merchant.secrets.rotate");
  const { merchantId } = await ctx.params;

  await revokeAllMerchantApiKeys(merchantId);
  const apiKey = await createMerchantApiKey(merchantId);

  await writeAuditLog({
    req,
    actorUserId: uid,
    merchantId,
    action: "merchant.secrets.rotate",
    entityType: "merchant",
    entityId: merchantId,
    meta: { keyId: apiKey.keyId, secretPrefix: apiKey.secret.slice(0, 6) },
  });

  return NextResponse.json({ ok: true, apiKey });
}
