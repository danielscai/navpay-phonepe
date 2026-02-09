import { NextResponse, type NextRequest } from "next/server";
import { requireApiPerm } from "@/lib/api";
import { isRechargeConfigured } from "@/lib/recharge-hd";

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "system.read");
  return NextResponse.json({ ok: true, configured: isRechargeConfigured() });
}

