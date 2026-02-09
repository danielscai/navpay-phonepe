"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { orderStatusPill } from "@/lib/order-status";

type Order = {
  id: string;
  merchantId: string;
  merchantCode?: string | null;
  merchantName?: string | null;
  merchantOrderNo: string;
  chain: string;
  asset: string;
  address: string;
  txHash?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  amount: string;
  status: string;
  expiresAtMs: number;
  blockNumber?: number | null;
  confirmations: number;
  confirmationsRequired: number;
  creditedAtMs?: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

function chainLabel(chain: string): string {
  if (chain === "tron") return "TRON";
  if (chain === "bsc") return "BSC";
  return chain.toUpperCase();
}

export default function RechargeOrderDetailClient(props: { orderId: string }) {
  const [o, setO] = useState<Order | null>(null);
  const [timezone, setTimezone] = useState<string>("Asia/Shanghai");
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    const r = await fetch(`/api/admin/orders/recharge/${props.orderId}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载失败");
      return;
    }
    setO(j.order ?? null);
  }

  useEffect(() => {
    load();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setTimezone(j.timezone);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (ms: number) => new Date(ms).toLocaleString("zh-CN", { timeZone: timezone, hour12: false });

  return (
    <div className="grid gap-4">
      <div className="np-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link className="np-btn px-3 py-2 text-sm" href="/admin/orders/recharge">
              ← 返回
            </Link>
            <div className="min-w-0">
              <div className="text-xs text-[var(--np-faint)]">充值订单详情</div>
              <div className="mt-1 font-mono text-xs text-[var(--np-muted)] break-all">{props.orderId}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="np-btn px-3 py-2 text-sm" onClick={load}>
              刷新
            </button>
          </div>
        </div>
        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
      </div>

      {o ? (
        <div className="np-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-[var(--np-faint)]">充值订单</div>
              <div className="mt-1 font-mono text-sm text-[var(--np-text)] break-all">{o.id}</div>
              <div className="mt-2 font-mono text-xs text-[var(--np-muted)] break-all">订单号 {o.merchantOrderNo}</div>
              <div className="mt-1 font-mono text-xs text-[var(--np-muted)] break-all">tx {o.txHash ?? "-"}</div>
            </div>
            <div className="text-right">
              {(() => {
                const sv = orderStatusPill("recharge", o.status);
                return <span className={sv.className}>{sv.label}</span>;
              })()}
              {o.status === "CONFIRMING" ? (
                <div className="mt-2 font-mono text-xs text-[var(--np-muted)]">
                  确认 {o.confirmations}/{o.confirmationsRequired}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">商户</div>
              <div className="mt-1 text-sm text-[var(--np-text)]">
                {(o.merchantCode ? o.merchantCode : o.merchantId.slice(0, 8)) + (o.merchantName ? ` ${o.merchantName}` : "")}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">链 / 资产</div>
              <div className="mt-1 text-sm text-[var(--np-text)]">
                {chainLabel(o.chain)} / {o.asset}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">充值地址</div>
              <div className="mt-1 font-mono text-xs text-[var(--np-muted)] break-all">{o.address}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">金额</div>
              <div className="mt-1 font-mono text-xl text-[var(--np-text)]">{o.amount}</div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">区块高度</div>
              <div className="mt-1 font-mono text-xs text-[var(--np-muted)]">{o.blockNumber ?? "-"}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">入账时间</div>
              <div className="mt-1 text-xs text-[var(--np-muted)]">{o.creditedAtMs ? fmt(Number(o.creditedAtMs)) : "-"}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">From</div>
              <div className="mt-1 font-mono text-xs text-[var(--np-muted)] break-all">{o.fromAddress ?? "-"}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">To</div>
              <div className="mt-1 font-mono text-xs text-[var(--np-muted)] break-all">{o.toAddress ?? "-"}</div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-xs text-[var(--np-faint)]">
            <div>创建 {fmt(o.createdAtMs)}</div>
            <div>更新 {fmt(o.updatedAtMs)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
