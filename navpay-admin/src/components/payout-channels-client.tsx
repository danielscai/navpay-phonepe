"use client";

import { useMemo, useState } from "react";
import PaymentPersonsClient from "@/components/payment-persons-client";

type ChannelKey = "personal_netbank";

export default function PayoutChannelsClient() {
  const channels = useMemo(
    () => [{ key: "personal_netbank" as const, label: "渠道账户（个人）", enabled: true }],
    [],
  );
  const [active, setActive] = useState<ChannelKey>("personal_netbank");

  return (
    <div className="grid gap-4">
      {/* Tabs: match the style of "调试入口" tabs for consistency. */}
      <div className="np-card p-2" role="tablist" aria-label="channels">
        <div className="flex flex-wrap gap-2">
          {channels.map((c) => {
            const on = active === c.key;
            return (
              <button
                key={c.key}
                className={["np-btn px-3 py-2 text-sm inline-flex items-center leading-none", on ? "np-btn-primary" : ""].join(" ")}
                onClick={() => setActive(c.key)}
                disabled={!c.enabled}
                aria-selected={on}
                role="tab"
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* For now all channels share the same "payment persons" resource model. */}
      <PaymentPersonsClient />
    </div>
  );
}
