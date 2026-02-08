"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const TABS = [
  { href: "/admin/tools/order-simulator", label: "订单模拟器" },
  { href: "/admin/tools/webhook-simulator", label: "Webhook 模拟器" },
  { href: "/admin/tools/callback-worker", label: "回调 Worker" },
];

const KEY = "np_last_tool";

export default function ToolsTabs() {
  const pathname = usePathname();

  useEffect(() => {
    const isTool = TABS.some((t) => pathname === t.href || pathname.startsWith(t.href));
    if (isTool && typeof window !== "undefined") window.localStorage.setItem(KEY, pathname);
  }, [pathname]);

  return (
    <div className="np-card p-2">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={["np-btn px-3 py-2 text-sm", active ? "np-btn-primary" : ""].join(" ")}
              onClick={() => {
                if (typeof window !== "undefined") window.localStorage.setItem(KEY, t.href);
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
