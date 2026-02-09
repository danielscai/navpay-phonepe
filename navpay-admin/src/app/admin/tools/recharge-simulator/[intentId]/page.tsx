import RechargeIntentSimClient from "@/components/recharge-intent-sim-client";

export default async function RechargeIntentSimPage(ctx: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await ctx.params;
  return <RechargeIntentSimClient intentId={intentId} />;
}

