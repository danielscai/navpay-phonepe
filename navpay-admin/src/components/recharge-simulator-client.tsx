"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { orderStatusPill } from "@/lib/order-status";

type Merchant = { id: string; code: string; name: string };

type IntentRow = {
  id: string;
  merchantId: string;
  merchantCode?: string | null;
  merchantName?: string | null;
  merchantOrderNo: string;
  chain: string;
  amount: string;
  status: string;
  confirmations: number;
  confirmationsRequired: number;
  txHash?: string | null;
  createdAtMs: number;
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

function randomAmount(): string {
  const cents = Math.floor(1000 + Math.random() * 49000);
  return (cents / 100).toFixed(2);
}

export default function RechargeSimulatorClient() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState("");
  const [chain, setChain] = useState<"tron" | "bsc">("tron");
  const [amount, setAmount] = useState(() => randomAmount());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [rows, setRows] = useState<IntentRow[]>([]);
  const [timezone, setTimezone] = useState<string>("Asia/Shanghai");

  const merchantMap = useMemo(() => new Map(merchants.map((m) => [m.id, m])), [merchants]);
  const mch = merchantMap.get(merchantId);
  const fmt = (ms: number) => new Date(ms).toLocaleString("zh-CN", { timeZone: timezone, hour12: false });

  async function loadMerchants() {
    const r = await fetch("/api/admin/merchants");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return;
    const list = (j.rows ?? []).map((x: any) => ({ id: x.id, code: x.code, name: x.name }));
    setMerchants(list);
    if (!merchantId && list.length) setMerchantId(list[0].id);
  }

  async function loadRows() {
    setErr(null);
    const sp = new URLSearchParams({ page: "1", pageSize: "20" });
    const r = await fetch(`/api/admin/orders/recharge?${sp.toString()}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载失败");
      return;
    }
    setRows(j.rows ?? []);
  }

  useEffect(() => {
    loadMerchants();
    loadRows();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setTimezone(j.timezone);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createIntent() {
    if (!merchantId) return;
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/tools/recharge/intents", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ merchantId, chain, expectedAmount: amount }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.error === "deposit_not_configured" ? "HD 钱包未配置" : `创建失败${j?.error ? `：${j.error}` : ""}`);
        return;
      }
      setAmount(randomAmount());
      await loadRows();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="np-card p-4">
        <div className="text-xs text-[var(--np-faint)]">调试工具</div>
        <div className="mt-1 text-lg font-semibold tracking-tight">充值模拟器</div>
        <div className="mt-2 text-sm text-[var(--np-muted)]">
          第一步：模拟商户创建充值订单（不需要区块链确认）。第二步：打开订单页面模拟链上成功/失败/超时与确认推进。
        </div>

        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs text-[var(--np-faint)]">商户</span>
            <select className="np-input" value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-[var(--np-faint)]">链</span>
            <select className="np-input" value={chain} onChange={(e) => setChain(e.target.value as any)}>
              <option value="tron">TRON</option>
              <option value="bsc">BSC</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-[var(--np-faint)]">充值金额</span>
            <div className="flex flex-wrap gap-2">
              <input className="np-input font-mono flex-1 min-w-[160px]" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <button className="np-btn px-3 py-2 text-xs shrink-0" onClick={() => setAmount(randomAmount())} type="button">
                随机
              </button>
            </div>
          </label>
          <div className="flex items-end justify-end gap-2">
            <button className="np-btn px-3 py-2 text-sm" onClick={loadRows} disabled={busy}>
              刷新列表
            </button>
            <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={createIntent} disabled={busy || !merchantId}>
              {busy ? "处理中..." : "创建充值订单"}
            </button>
          </div>
        </div>

        <div className="mt-4 text-xs text-[var(--np-faint)]">
          当前：{mch ? `${mch.code} ${mch.name}` : "-"} · {chainLabel(chain)} · {amount}
        </div>
      </div>

      <div className="np-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">最近订单</div>
          <Link className="np-btn px-3 py-2 text-xs" href="/admin/orders/recharge" target="_blank">
            打开充值订单列表
          </Link>
        </div>

        {/* Mobile: card layout to avoid page-level horizontal overflow */}
        <div className="mt-3 grid gap-2 md:hidden">
          {rows.map((o) => {
            const mch = o.merchantCode ? `${o.merchantCode}${o.merchantName ? ` ${o.merchantName}` : ""}` : o.merchantId.slice(0, 8);
            const sv = orderStatusPill("recharge", o.status);
            return (
              <div key={o.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-[var(--np-faint)]">{mch}</div>
                    <div className="mt-1 font-mono text-xs text-[var(--np-muted)] break-all">{o.merchantOrderNo}</div>
                    <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)] break-all">tx {o.txHash ?? "-"}</div>
                  </div>
                  <div className="text-right">
                    <span className={sv.className}>{sv.label}</span>
                    <div className="mt-2 font-mono text-lg text-[var(--np-text)]">{o.amount}</div>
                    {o.status === "CONFIRMING" ? (
                      <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)]">
                        {o.confirmations}/{o.confirmationsRequired}
                      </div>
                    ) : null}
                    <Link className="mt-2 inline-flex np-btn px-2 py-1 text-xs" href={`/admin/tools/recharge-simulator/${o.id}`} target="_blank">
                      打开
                    </Link>
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-[var(--np-faint)]">创建 {fmt(o.createdAtMs)}</div>
              </div>
            );
          })}
          {!rows.length ? <div className="text-sm text-[var(--np-muted)]">暂无订单</div> : null}
        </div>

        {/* Desktop: table layout */}
        <div className="mt-3 hidden md:block overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
              <tr>
                <th className="px-3 py-2">订单号</th>
                <th className="px-3 py-2">商户</th>
                <th className="px-3 py-2">链</th>
                <th className="px-3 py-2">金额</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">确认</th>
                <th className="px-3 py-2">创建时间</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const mch = o.merchantCode ? `${o.merchantCode}${o.merchantName ? ` ${o.merchantName}` : ""}` : o.merchantId.slice(0, 8);
                const sv = orderStatusPill("recharge", o.status);
                return (
                  <tr key={o.id} className="border-t border-white/10">
                    <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">
                      <div className="break-all">{o.merchantOrderNo}</div>
                      <div className="mt-1 text-[11px] text-[var(--np-faint)] break-all">{o.id}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{mch}</td>
                    <td className="px-3 py-2 text-xs">{chainLabel(o.chain)}</td>
                    <td className="px-3 py-2">{o.amount}</td>
                    <td className="px-3 py-2">
                      <span className={sv.className}>{sv.label}</span>
                      <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)] break-all">tx {o.txHash ?? "-"}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">
                      {o.status === "CONFIRMING" ? `${o.confirmations}/${o.confirmationsRequired}` : "-"}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{fmt(o.createdAtMs)}</td>
                    <td className="px-3 py-2 text-right">
                      <Link className="np-btn px-2 py-1 text-xs" href={`/admin/tools/recharge-simulator/${o.id}`} target="_blank">
                        打开
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={8}>
                    暂无订单
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
