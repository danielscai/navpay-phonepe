"use client";

import { useEffect, useState } from "react";

type Row = { chain: string; index: number; address: string; confirmationsRequired: number };

function chainLabel(chain: string): string {
  if (chain === "tron") return "TRON";
  if (chain === "bsc") return "BSC";
  return chain.toUpperCase();
}

export default function MerchantRechargeAddressesClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    const r = await fetch("/api/merchant/recharge/addresses");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      if (j?.error === "not_configured") setErr("充值功能未配置（HD 钱包助记词未设置）");
      else setErr("加载失败");
      return;
    }
    setRows(j.rows ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="grid gap-4">
      {err ? <div className="text-sm text-[var(--np-danger)]">{err}</div> : null}

      <div className="np-card p-4">
        <div className="text-sm font-semibold">我的充值地址</div>
        <div className="mt-2 text-sm text-[var(--np-muted)]">每条链都有独立地址。充值需等待 {rows.find((r) => r.chain === "tron")?.confirmationsRequired ?? 15} 个区块确认后入账。</div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <div key={r.chain} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-[var(--np-faint)]">链</div>
                  <div className="mt-1 text-sm text-[var(--np-text)]">{chainLabel(r.chain)}</div>
                </div>
                <button
                  className="np-btn px-3 py-2 text-xs"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(r.address);
                    } catch {
                      // ignore
                    }
                  }}
                >
                  复制
                </button>
              </div>
              <div className="mt-3 text-xs text-[var(--np-faint)]">地址</div>
              <div className="mt-1 font-mono text-xs text-[var(--np-muted)] break-all">{r.address}</div>
              <div className="mt-3 text-xs text-[var(--np-faint)]">确认数</div>
              <div className="mt-1 font-mono text-xs text-[var(--np-muted)]">{`>= ${r.confirmationsRequired}`}</div>
            </div>
          ))}
          {!rows.length ? <div className="text-sm text-[var(--np-muted)]">暂无地址</div> : null}
        </div>
      </div>
    </div>
  );
}
