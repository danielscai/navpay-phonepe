"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

function chainLabel(chain: string): string {
  if (chain === "tron") return "TRON";
  if (chain === "bsc") return "BSC";
  return chain.toUpperCase();
}

function fmtRemain(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(t / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function RechargeIntentSimClient(props: { intentId: string }) {
  const [timezone, setTimezone] = useState<string>("Asia/Shanghai");
  const [o, setO] = useState<Order | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blockNumber, setBlockNumber] = useState(100);
  const [headBlockNumber, setHeadBlockNumber] = useState(100);

  const fmt = (ms: number) => new Date(ms).toLocaleString("zh-CN", { timeZone: timezone, hour12: false });

  async function refresh() {
    const r = await fetch(`/api/admin/orders/recharge/${props.intentId}`);
    const j = await r.json().catch(() => null);
    if (r.ok && j?.ok && j.order) {
      setO(j.order);
      if (typeof j.order?.blockNumber === "number") setBlockNumber(Number(j.order.blockNumber));
      if (typeof j.order?.blockNumber === "number" && typeof j.order?.confirmationsRequired === "number") {
        const bn = Number(j.order.blockNumber);
        setHeadBlockNumber(Math.max(headBlockNumber, bn + Number(j.order.confirmationsRequired) - 1));
      }
      return;
    }
    setErr("加载失败");
  }

  useEffect(() => {
    refresh();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setTimezone(j.timezone);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.intentId]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      refresh();
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.intentId]);

  const remainMs = (o?.expiresAtMs ?? 0) - nowMs;
  const expired = remainMs <= 0;
  const terminal = useMemo(() => ["SUCCESS", "FAILED", "EXPIRED"].includes(String(o?.status ?? "")), [o?.status]);

  async function setChainEvent(type: "SUCCESS" | "FAILED") {
    if (!o) return;
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/tools/recharge/intents/${o.id}/chain-event`, {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ type, blockNumber }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.error === "bad_state" ? "当前状态不允许该操作" : "操作失败");
        await refresh();
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function advanceConfirmations() {
    if (!o) return;
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/tools/recharge/intents/${o.id}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ headBlockNumber }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("操作失败");
        await refresh();
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function expireNow() {
    if (!o) return;
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/tools/recharge/intents/${o.id}/expire`, { method: "POST", headers: { ...h } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.error === "bad_state" ? "当前状态不允许超时" : "操作失败");
        await refresh();
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[820px] p-6">
      <div className="np-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-[var(--np-faint)]">充值页面（调试用）</div>
            <div className="mt-1 font-mono text-xs text-[var(--np-muted)] break-all">{props.intentId}</div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button className="np-btn px-3 py-2 text-sm" onClick={refresh} disabled={busy}>
              刷新
            </button>
            <Link className="np-btn px-3 py-2 text-sm" href="/admin/tools/recharge-simulator" target="_blank">
              打开充值模拟器
            </Link>
            <Link className="np-btn px-3 py-2 text-sm" href="/admin/orders/recharge" target="_blank">
              打开订单列表
            </Link>
          </div>
        </div>

        {o ? (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-[var(--np-faint)]">金额</div>
                <div className="mt-2 font-mono text-xl text-[var(--np-text)]">{o.amount}</div>
                <div className="mt-1 text-xs text-[var(--np-faint)]">{chainLabel(o.chain)} / {o.asset}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-[var(--np-faint)]">状态</div>
                <div className="mt-2">
                  {(() => {
                    const sv = orderStatusPill("recharge", String(o.status));
                    return <span className={sv.className}>{sv.label}</span>;
                  })()}
                </div>
                <div className="mt-2 text-xs text-[var(--np-faint)]">创建 {fmt(o.createdAtMs)}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-[var(--np-faint)]">确认</div>
                <div className="mt-2 font-mono text-xl text-[var(--np-text)]">{o.status === "CONFIRMING" ? `${o.confirmations}/${o.confirmationsRequired}` : "-"}</div>
                <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)] break-all">tx {o.txHash ?? "-"}</div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-[var(--np-faint)]">倒计时（超时后自动 EXPIRED）</div>
                <div className={["font-mono text-sm", expired ? "text-[var(--np-danger)]" : "text-[var(--np-text)]"].join(" ")}>
                  {fmtRemain(remainMs)}
                </div>
              </div>
              <div className="mt-2 text-xs text-[var(--np-faint)]">与是否打开页面无关，超时基于订单创建时间计算。</div>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">充值地址</div>
              <div className="mt-2 font-mono text-xs text-[var(--np-muted)] break-all">{o.address}</div>
              <div className="mt-2 text-xs text-[var(--np-faint)]">商户</div>
              <div className="mt-1 text-sm text-[var(--np-text)]">
                {(o.merchantCode ? o.merchantCode : o.merchantId.slice(0, 8)) + (o.merchantName ? ` ${o.merchantName}` : "")}
              </div>
              <div className="mt-2 text-xs text-[var(--np-faint)]">商户订单号</div>
              <div className="mt-1 font-mono text-xs text-[var(--np-muted)] break-all">{o.merchantOrderNo}</div>
            </div>

            <div className="mt-4 grid gap-2">
              <div className="text-xs text-[var(--np-faint)]">模拟区块链行为</div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-[var(--np-faint)]">
                  tx 区块
                  <input className="np-input w-[120px] font-mono text-xs" value={String(blockNumber)} onChange={(e) => setBlockNumber(Number(e.target.value || "0"))} />
                </label>
                <button className="np-btn px-3 py-2 text-sm" onClick={() => setChainEvent("SUCCESS")} disabled={busy || terminal || expired || o.status !== "CREATED"}>
                  链上已充值
                </button>
                <button className="np-btn px-3 py-2 text-sm" onClick={() => setChainEvent("FAILED")} disabled={busy || terminal || o.status !== "CREATED"}>
                  模拟失败
                </button>
                <button className="np-btn px-3 py-2 text-sm" onClick={expireNow} disabled={busy || terminal || o.status !== "CREATED"}>
                  模拟超时
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-[var(--np-faint)]">
                  head 区块
                  <input className="np-input w-[160px] font-mono text-xs" value={String(headBlockNumber)} onChange={(e) => setHeadBlockNumber(Number(e.target.value || "0"))} />
                </label>
                <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={advanceConfirmations} disabled={busy || terminal || o.status !== "CONFIRMING"}>
                  推进确认并入账
                </button>
              </div>
              <div className="text-xs text-[var(--np-faint)]">
                说明：先“链上已充值”进入确认中，再把 head 区块推进到满足确认数（默认 15）即可入账成功。
              </div>
            </div>
          </>
        ) : null}

        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
      </div>
    </div>
  );
}
