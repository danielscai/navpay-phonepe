"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SystemConfigClient from "@/components/system-config-client";
import IpWhitelistClient from "@/components/ip-whitelist-client";

export default function SystemConfigTabsClient() {
  const sp = useSearchParams();
  const tab = (sp.get("tab") ?? "config") as string;
  const active = tab === "ip_whitelist" ? "ip_whitelist" : "config";

  return (
    <div className="grid gap-4">
      <div className="np-card p-2" role="tablist" aria-label="system-config-tabs">
        <div className="flex flex-wrap gap-2">
          {[
            ["config", "系统参数"],
            ["ip_whitelist", "IP 白名单"],
          ].map(([k, label]) => {
            const on = active === k;
            return (
              <Link
                key={k}
                href={`/admin/system/config?tab=${k}`}
                className={["np-btn px-3 py-2 text-sm inline-flex items-center leading-none", on ? "np-btn-primary" : ""].join(" ")}
                aria-selected={on}
                role="tab"
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      {active === "config" ? <SystemConfigClient /> : <IpWhitelistClient />}
    </div>
  );
}

