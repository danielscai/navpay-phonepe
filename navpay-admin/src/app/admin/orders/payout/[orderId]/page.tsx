import OrderDetailClient from "@/components/order-detail-client";

export default async function PayoutOrderDetailPage(ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  return <OrderDetailClient orderType="payout" orderId={orderId} />;
}

