import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { requireSessionUser } from "@/lib/auth";
import { requirePerm } from "@/lib/rbac";
import OrderSimulatorClient from "@/components/order-simulator-client";

export default async function OrderSimulatorPage() {
  if (!env.ENABLE_DEBUG_TOOLS) notFound();
  const { user } = await requireSessionUser();
  await requirePerm(user.id, "tools.debug");
  return <OrderSimulatorClient />;
}

