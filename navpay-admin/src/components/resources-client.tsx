"use client";

import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import DevicesClient from "@/components/devices-client";
import BankAccountsClient from "@/components/bank-accounts-client";

type TabKey = "devices" | "bank_accounts";

export default function ResourcesClient() {
  const sp = useSearchParams();
  const router = useRouter();
  const initial = (sp.get("tab") as TabKey | null) ?? "devices";
  const [tab, setTab] = useState<TabKey>(initial === "bank_accounts" ? "bank_accounts" : "devices");

  const tabs = useMemo(
    () => [
      { key: "devices" as const, label: "手机设备" },
      { key: "bank_accounts" as const, label: "网银账户" },
    ],
    [],
  );

  function select(next: TabKey) {
    setTab(next);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", next);
    router.replace(u.pathname + "?" + u.searchParams.toString());
  }

  return (
    <div className="grid gap-4">
      <div className="np-card p-4">
        <div className="text-xs text-[var(--np-faint)]">系统</div>
        <div className="mt-1 text-lg font-semibold tracking-tight">资源管理</div>
        <div className="mt-3 np-card p-2" role="tablist" aria-label="resources">
          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  className={["np-btn px-3 py-2 text-sm", on ? "np-btn-primary" : ""].join(" ")}
                  onClick={() => select(t.key)}
                  aria-selected={on}
                  role="tab"
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {tab === "devices" ? <DevicesClient /> : <BankAccountsClient />}
    </div>
  );
}

