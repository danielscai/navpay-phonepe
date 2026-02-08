import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { collectOrders } from "@/db/schema";
import { eq } from "drizzle-orm";
import CollectPayPageClient from "@/components/collect-pay-page-client";
import { getOrderTimeoutMs, sweepExpiredCollectOrders } from "@/lib/order-timeout";

export default async function CollectPayPage(ctx: { params: Promise<{ orderId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) notFound();
  const { orderId } = await ctx.params;

  const timeoutMs = await getOrderTimeoutMs();
  await sweepExpiredCollectOrders(Date.now());
  const row = await db.select().from(collectOrders).where(eq(collectOrders.id, orderId)).limit(1);
  const o: any = row[0];
  if (!o) notFound();

  return (
    <CollectPayPageClient
      order={{
        id: o.id,
        merchantOrderNo: o.merchantOrderNo,
        amount: o.amount,
        fee: o.fee,
        status: o.status,
        createdAtMs: o.createdAtMs,
      }}
      expiresAtMs={Number(o.createdAtMs) + timeoutMs}
    />
  );
}
