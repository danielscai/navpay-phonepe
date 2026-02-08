import { NextResponse, type NextRequest } from "next/server";
import { requireApiMerchantUser } from "@/lib/api-merchant";
import { isStepUpSatisfied } from "@/lib/stepup";
import { getActiveMerchantApiKeyDisplay } from "@/lib/merchant-secret";
import { writeAuditLog } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const { uid, merchantId } = await requireApiMerchantUser(req, { csrf: false });
  if (!isStepUpSatisfied(req)) {
    return NextResponse.json({ ok: false, error: "step_up_required" }, { status: 403 });
  }

  const k = await getActiveMerchantApiKeyDisplay(merchantId);

  await writeAuditLog({
    req,
    actorUserId: uid,
    merchantId,
    action: "merchant.api_key.view",
    entityType: "merchant",
    entityId: merchantId,
    meta: { keyId: k?.keyId ?? null, canDecrypt: k?.canDecrypt ?? null },
  });

  return NextResponse.json({
    ok: true,
    apiKey: k
      ? { keyId: k.keyId, secretPrefix: k.secretPrefix, secret: k.secret ?? null, canDecrypt: k.canDecrypt, createdAtMs: k.createdAtMs }
      : null,
  });
}

