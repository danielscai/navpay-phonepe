import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { requireSessionUser } from "@/lib/auth";
import { requirePerm } from "@/lib/rbac";
import CallbackWorkerClient from "@/components/callback-worker-client";

export default async function CallbackWorkerPage() {
  if (!env.ENABLE_DEBUG_TOOLS) notFound();
  const { user } = await requireSessionUser();
  await requirePerm(user.id, "tools.debug");
  return <CallbackWorkerClient />;
}

