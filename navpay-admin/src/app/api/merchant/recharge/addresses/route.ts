import { NextResponse, type NextRequest } from "next/server";
import { requireApiMerchantUser } from "@/lib/api-merchant";
import { listMerchantDepositAddresses } from "@/lib/recharge-address";
import { isRechargeConfigured } from "@/lib/recharge-hd";

export async function GET(req: NextRequest) {
  const { merchantId } = await requireApiMerchantUser(req, { csrf: false });
  if (!isRechargeConfigured()) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  const rows = await listMerchantDepositAddresses(merchantId);
  return NextResponse.json({ ok: true, rows });
}

