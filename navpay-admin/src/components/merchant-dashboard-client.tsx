"use client";

import { useEffect, useState } from "react";

type Merchant = { id: string; code: string; name: string; balance: string; payoutFrozen: string; enabled: boolean };
type Fees = { collectFeeRateBps: number; payoutFeeRateBps: number; minFee: string };

export default function MerchantDashboardClient() {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [fees, setFees] = useState<Fees | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setErr(null);
      const r = await fetch("/api/merchant/me");
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("加载失败");
        return;
      }
      setMerchant(j.merchant ?? null);
      setFees(j.fees ?? null);
    })();
  }, []);

  return (
    <div className="grid gap-4">
      {err ? <div className="text-sm text-[var(--np-danger)]">{err}</div> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="np-card p-4">
          <div className="text-xs text-[var(--np-faint)]">余额</div>
          <div className="mt-2 font-mono text-xl">{merchant?.balance ?? "-"}</div>
          <div className="mt-2 text-xs text-[var(--np-muted)]">可用余额</div>
        </div>
        <div className="np-card p-4">
          <div className="text-xs text-[var(--np-faint)]">代付冻结</div>
          <div className="mt-2 font-mono text-xl">{merchant?.payoutFrozen ?? "-"}</div>
          <div className="mt-2 text-xs text-[var(--np-muted)]">审核中/处理中代付占用</div>
        </div>
        <div className="np-card p-4">
          <div className="text-xs text-[var(--np-faint)]">费率</div>
          <div className="mt-2 grid gap-1 text-sm text-[var(--np-muted)]">
            <div>代收: {fees ? `${fees.collectFeeRateBps} bps` : "-"}</div>
            <div>代付: {fees ? `${fees.payoutFeeRateBps} bps` : "-"}</div>
            <div>最低手续费: {fees?.minFee ?? "-"}</div>
          </div>
        </div>
      </div>

      <div className="np-card p-4">
        <div className="text-xs text-[var(--np-faint)]">快速入口</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="np-btn px-3 py-2 text-sm" href="/merchant/api">查看 API Key</a>
          <a className="np-btn px-3 py-2 text-sm" href="/merchant/security/ip-whitelist">设置 IP 白名单</a>
          <a className="np-btn px-3 py-2 text-sm" href="/docs/merchant-api">打开 API 文档</a>
        </div>
      </div>
    </div>
  );
}

