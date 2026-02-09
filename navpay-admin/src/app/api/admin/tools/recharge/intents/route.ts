import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { requireApiPerm } from "@/lib/api";
import { createRechargeIntent } from "@/lib/recharge-intent";

const bodySchema = z.object({
  merchantId: z.string().min(1),
  chain: z.enum(["tron", "bsc"]),
  expectedAmount: z.string().min(1),
});

export async function POST(req: NextRequest) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  await requireApiPerm(req, "order.recharge.write");
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  let out: { ok: boolean; id?: string; error?: string };
  try {
    out = await createRechargeIntent({
      req,
      merchantId: body.data.merchantId,
      chain: body.data.chain,
      expectedAmount: body.data.expectedAmount,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (msg === "deposit_not_configured") return NextResponse.json({ ok: false, error: "deposit_not_configured" }, { status: 503 });
    return NextResponse.json({ ok: false, error: "create_failed" }, { status: 400 });
  }
  if (!out.ok) return NextResponse.json({ ok: false, error: out.error ?? "create_failed" }, { status: 400 });
  return NextResponse.json({ ok: true, id: out.id });
}
