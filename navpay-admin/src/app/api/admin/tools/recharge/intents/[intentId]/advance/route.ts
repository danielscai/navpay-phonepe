import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { requireApiPerm } from "@/lib/api";
import { db } from "@/lib/db";
import { rechargeIntents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { processRechargeIntentConfirmations } from "@/lib/recharge-intent";

const bodySchema = z.object({
  headBlockNumber: z.coerce.number().min(0),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ intentId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  await requireApiPerm(req, "order.recharge.write");
  const { intentId } = await ctx.params;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const row = await db.select({ chain: rechargeIntents.chain }).from(rechargeIntents).where(eq(rechargeIntents.id, intentId)).limit(1);
  const chain = row[0]?.chain ? String((row[0] as any).chain) : null;
  if (!chain) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const out = await processRechargeIntentConfirmations({ req, chain: chain as any, headBlockNumber: Number(body.data.headBlockNumber) });
  return NextResponse.json({ ok: true, out });
}

