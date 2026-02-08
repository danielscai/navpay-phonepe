import OrderDetailClient from "@/components/order-detail-client";

export default async function CollectOrderDetailPage(ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  return <OrderDetailClient orderType="collect" orderId={orderId} />;
}

