import { NextResponse, type NextRequest } from "next/server";
import { merchantApiV1Endpoints } from "@/lib/merchant-api/v1/contract";
import { renderMerchantApiHtml } from "@/lib/merchant-api/v1/render";

export async function GET(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const baseUrlHint = host ? `${proto}://${host}` : undefined;

  const endpoints = merchantApiV1Endpoints.filter((e) => e.id === "payout_create");
  const html = renderMerchantApiHtml({ title: "代付下单 API 文档 (V1)", endpoints, baseUrlHint });

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdfBuf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
    });
    await browser.close();

    return new NextResponse(new Uint8Array(pdfBuf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=\"navpay-merchant-api-payout-v1.pdf\"",
      },
    });
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "pdf_generate_failed";
    return NextResponse.json(
      { ok: false, error: "pdf_generate_failed", message: msg, hint: "If playwright browsers are missing, run: npx playwright install chromium" },
      { status: 501 },
    );
  }
}
