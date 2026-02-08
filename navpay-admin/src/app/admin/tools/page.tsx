import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { requireSessionUser } from "@/lib/auth";
import { requirePerm } from "@/lib/rbac";
import ToolsHomeRedirect from "@/components/tools-home-redirect";

export default async function ToolsHome() {
  if (!env.ENABLE_DEBUG_TOOLS) notFound();
  const { user } = await requireSessionUser();
  await requirePerm(user.id, "tools.debug");

  return <ToolsHomeRedirect />;
}
