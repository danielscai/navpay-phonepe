import WebhookSimulatorClient from "@/components/webhook-simulator-client";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { requireSessionUser } from "@/lib/auth";
import { requirePerm } from "@/lib/rbac";

export default async function WebhookSimulatorPage() {
  if (!env.ENABLE_DEBUG_TOOLS) notFound();
  const { user } = await requireSessionUser();
  await requirePerm(user.id, "tools.debug");
  return <WebhookSimulatorClient />;
}
