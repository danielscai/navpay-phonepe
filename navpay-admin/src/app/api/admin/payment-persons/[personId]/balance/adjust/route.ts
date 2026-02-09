import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiPerm } from "@/lib/api";
import { adjustPaymentPersonBalance } from "@/lib/payment-person";
import { id } from "@/lib/id";

const bodySchema = z.object({
  op: z.enum(["credit", "debit"]),
  amount: z.string().trim().min(1).max(32),
  reason: z.string().trim().min(1).max(120),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ personId: string }> }) {
  try {
    await requireApiPerm(req, "payout.channel.write");
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? "forbidden") }, { status: Number(e?.status ?? 500) });
  }

  const { personId } = await ctx.params;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const raw = body.data.amount.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,8})?$/.test(raw)) return NextResponse.json({ ok: false, error: "bad_amount" }, { status: 400 });
  const delta = body.data.op === "credit" ? raw : `-${raw}`;

  const out = await adjustPaymentPersonBalance({
    personId,
    delta,
    reason: body.data.reason,
    refType: "admin_manual",
    refId: id("adj"),
  });

  if (!out.ok) {
    if (out.error === "not_found") return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    if (out.error === "insufficient_balance") return NextResponse.json({ ok: false, error: "insufficient_balance" }, { status: 400 });
    return NextResponse.json({ ok: false, error: "failed" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, balanceAfter: out.balanceAfter });
}
