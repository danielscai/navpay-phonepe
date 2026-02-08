import { NextResponse, type NextRequest } from "next/server";
import { merchantApiV1Endpoints } from "@/lib/merchant-api/v1/contract";
import { renderMerchantApiHtml } from "@/lib/merchant-api/v1/render";

export async function GET(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const baseUrlHint = host ? `${proto}://${host}` : undefined;

  const endpoints = merchantApiV1Endpoints.filter((e) => e.id === "payout_create");
  const html = renderMerchantApiHtml({ title: "代付下单 API 文档 (V1)", endpoints, baseUrlHint });
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

