import PaymentPersonDetailClient from "@/components/payment-person-detail-client";

export default async function PaymentPersonDetailPage(ctx: { params: Promise<{ personId: string }> }) {
  const { personId } = await ctx.params;
  return <PaymentPersonDetailClient personId={personId} />;
}

