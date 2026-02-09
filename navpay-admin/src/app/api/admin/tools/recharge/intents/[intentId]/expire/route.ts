import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { requireApiPerm } from "@/lib/api";
import { db } from "@/lib/db";
import { rechargeIntents } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest, ctx: { params: Promise<{ intentId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  await requireApiPerm(req, "order.recharge.write");
  const { intentId } = await ctx.params;

  const row = await db.select({ status: rechargeIntents.status }).from(rechargeIntents).where(eq(rechargeIntents.id, intentId)).limit(1);
  const st = String((row[0] as any)?.status ?? "");
  if (!st) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (st !== "CREATED") return NextResponse.json({ ok: false, error: "bad_state" }, { status: 400 });

  await db.update(rechargeIntents).set({ status: "EXPIRED", updatedAtMs: Date.now() } as any).where(eq(rechargeIntents.id, intentId));
  return NextResponse.json({ ok: true });
}

