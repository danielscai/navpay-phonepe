import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { requireApiPerm } from "@/lib/api";
import { simulateChainEvent } from "@/lib/recharge-intent";
import { randomToken } from "@/lib/crypto";

const bodySchema = z.object({
  type: z.enum(["SUCCESS", "FAILED"]),
  txHash: z.string().optional(),
  blockNumber: z.coerce.number().min(0).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ intentId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  await requireApiPerm(req, "order.recharge.write");
  const { intentId } = await ctx.params;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const txHash = body.data.type === "SUCCESS" ? (body.data.txHash?.trim() || "SIM_" + randomToken(18)) : undefined;
  const out = await simulateChainEvent({
    req,
    intentId,
    type: body.data.type,
    txHash,
    blockNumber: body.data.blockNumber ?? 0,
    fromAddress: "SIM_FROM",
  });
  if (!out.ok) return NextResponse.json({ ok: false, error: out.error ?? "bad_request" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

