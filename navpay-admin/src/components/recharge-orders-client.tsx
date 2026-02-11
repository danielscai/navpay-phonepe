"use client";

import { useEffect, useState } from "react";
import { ListPager, ListToolbar } from "@/components/list-kit";
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
  amount: string;
  status: string;
  expiresAtMs?: number | null;
  blockNumber?: number | null;
  confirmations: number;
  confirmationsRequired: number;
  creditedAtMs?: number | null;
  createdAtMs: number;
};

function chainLabel(chain: string): string {
  if (chain === "tron") return "TRON";
  if (chain === "bsc") return "BSC";
  return chain.toUpperCase();
}

function txExplorerUrl(chain: string, txHash: string): string | null {
  const h = txHash.trim();
  if (!h) return null;
  if (chain === "tron") return `https://tronscan.org/#/transaction/${h}`;
  if (chain === "bsc") return `https://bscscan.com/tx/${h}`;
  return null;
}

export default function RechargeOrdersClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [timezone, setTimezone] = useState<string>("Asia/Shanghai");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [chain, setChain] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  async function loadOrders() {
    setErr(null);
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (status.trim()) sp.set("status", status.trim());
    if (chain.trim()) sp.set("chain", chain.trim());
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    const r = await fetch(`/api/admin/orders/recharge?${sp.toString()}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载失败");
      return;
    }
    setOrders(j.rows ?? []);
    setTotal(Number(j.total ?? 0));
  }

  useEffect(() => {
    loadOrders();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setTimezone(j.timezone);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const fmt = (ms: number) => new Date(ms).toLocaleString("zh-CN", { timeZone: timezone, hour12: false });

  return (
    <div>
      <ListToolbar
        left={
          <div className="flex flex-wrap items-center gap-2">
            <input className="np-input w-full md:w-[320px]" placeholder="搜索订单号/txHash/地址/商户号" value={q} onChange={(e) => setQ(e.target.value)} />
            <input className="np-input w-full md:w-[160px]" placeholder="状态（可选）" value={status} onChange={(e) => setStatus(e.target.value)} />
            <input className="np-input w-full md:w-[140px]" placeholder="链（tron/bsc）" value={chain} onChange={(e) => setChain(e.target.value)} />
          </div>
        }
        right={
          <button
            className="np-btn px-3 py-2 text-sm"
            onClick={() => {
              setPage(1);
              loadOrders();
            }}
          >
            查询
          </button>
        }
        error={err}
      />

      <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-3 py-2">充值单号</th>
              <th className="px-3 py-2">商户</th>
              <th className="px-3 py-2">链</th>
              <th className="px-3 py-2">金额</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">确认</th>
              <th className="px-3 py-2">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const mch = o.merchantCode ? `${o.merchantCode}${o.merchantName ? ` ${o.merchantName}` : ""}` : o.merchantId.slice(0, 8);
              const sv = orderStatusPill("recharge", o.status);
              return (
                <tr key={o.id} className="border-t border-white/10">
                  <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">
                    <a className="underline" href={`/admin/orders/recharge/${o.id}`}>
                      {o.merchantOrderNo}
                    </a>
                    <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)] break-all">
                      tx{" "}
                      {o.txHash ? (
                        txExplorerUrl(o.chain, o.txHash) ? (
                          <a className="underline" href={txExplorerUrl(o.chain, o.txHash)!} target="_blank" rel="noreferrer">
                            {o.txHash}
                          </a>
                        ) : (
                          o.txHash
                        )
                      ) : (
                        "-"
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{mch}</td>
                  <td className="px-3 py-2 text-xs">{chainLabel(o.chain)}</td>
                  <td className="px-3 py-2">{o.amount}</td>
                  <td className="px-3 py-2">
                    <span className={sv.className}>{sv.label}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">
                    {o.status === "CONFIRMING" ? `${o.confirmations}/${o.confirmationsRequired}` : "-"}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{fmt(o.createdAtMs)}</td>
                </tr>
              );
            })}
            {!orders.length ? (
              <tr>
                <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={7}>
                  暂无订单
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ListPager
        page={page}
        pageSize={pageSize}
        total={total}
        onPage={(p) => setPage(p)}
        onPageSize={(ps) => {
          setPage(1);
          setPageSize(ps);
        }}
      />
    </div>
  );
}
