import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { merchants, rechargeIntents } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { eq } from "drizzle-orm";
import { sweepExpiredRechargeIntents } from "@/lib/recharge-intent";

export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  await requireApiPerm(req, "order.recharge.read");
  await sweepExpiredRechargeIntents(Date.now());
  const { orderId } = await ctx.params;
  const rows = await db
    .select({
      id: rechargeIntents.id,
      merchantId: rechargeIntents.merchantId,
      merchantCode: merchants.code,
      merchantName: merchants.name,
      merchantOrderNo: rechargeIntents.merchantOrderNo,
      chain: rechargeIntents.chain,
      asset: rechargeIntents.asset,
      address: rechargeIntents.address,
      txHash: rechargeIntents.txHash,
      fromAddress: rechargeIntents.fromAddress,
      toAddress: rechargeIntents.toAddress,
      amount: rechargeIntents.expectedAmount,
      status: rechargeIntents.status,
      expiresAtMs: rechargeIntents.expiresAtMs,
      blockNumber: rechargeIntents.blockNumber,
      confirmations: rechargeIntents.confirmations,
      confirmationsRequired: rechargeIntents.confirmationsRequired,
      creditedAtMs: rechargeIntents.creditedAtMs,
      createdAtMs: rechargeIntents.createdAtMs,
      updatedAtMs: rechargeIntents.updatedAtMs,
    })
    .from(rechargeIntents)
    .leftJoin(merchants, eq(merchants.id, rechargeIntents.merchantId))
    .where(eq(rechargeIntents.id, orderId))
    .limit(1);
  const o: any = rows[0];
  if (!o) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, order: o });
}
