import RechargeOrderDetailClient from "@/components/recharge-order-detail-client";

export default async function RechargeOrderDetailPage(ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  return <RechargeOrderDetailClient orderId={orderId} />;
}

