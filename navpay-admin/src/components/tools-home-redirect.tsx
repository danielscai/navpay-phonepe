"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_TOOL = "/admin/tools/order-simulator";
const KEY = "np_last_tool";

export default function ToolsHomeRedirect() {
  const router = useRouter();

  useEffect(() => {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    const next = v && v.startsWith("/admin/tools/") ? v : DEFAULT_TOOL;
    router.replace(next);
  }, [router]);

  return (
    <div className="np-card p-4">
      <div className="text-sm text-[var(--np-muted)]">正在打开上一次使用的调试工具...</div>
    </div>
  );
}

