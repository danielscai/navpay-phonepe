import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { requireSessionUser } from "@/lib/auth";
import { requirePerm } from "@/lib/rbac";
import ToolsTabs from "@/components/tools-tabs";

export default async function ToolsLayout({ children }: { children: React.ReactNode }) {
  if (!env.ENABLE_DEBUG_TOOLS) notFound();
  const { user } = await requireSessionUser();
  await requirePerm(user.id, "tools.debug");

  return (
    <div className="grid gap-4">
      <ToolsTabs />
      <div>{children}</div>
    </div>
  );
}
