"use client";

import { useEffect, useState } from "react";
import { ListPager, ListToolbar } from "@/components/list-kit";
import { notifyStatusPill, orderStatusPill } from "@/lib/order-status";

type Order = {
  id: string;
  merchantId: string;
  merchantCode?: string | null;
  merchantName?: string | null;
  merchantOrderNo: string;
  amount: string;
  fee: string;
  status: string;
  notifyStatus?: string;
  lastNotifiedAtMs?: number | null;
  notifyUrl: string;
  lockedPaymentPersonId?: string | null;
  lockMode?: string | null;
  lockedAtMs?: number | null;
  lockExpiresAtMs?: number | null;
  lockedPaymentPersonName?: string | null;
  beneficiaryName: string;
  accountNo: string;
  ifsc: string;
  createdAtMs: number;
};

export default function PayoutOrdersClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [timezone, setTimezone] = useState<string>("Asia/Shanghai");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  async function loadOrders() {
    setErr(null);
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (status.trim()) sp.set("status", status.trim());
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    const r = await fetch(`/api/admin/orders/payout?${sp.toString()}`);
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

  const fmt = (ms: number) =>
    new Date(ms).toLocaleString("zh-CN", { timeZone: timezone, hour12: false });

  return (
    <div>
      <ListToolbar
        left={
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="np-input w-full md:w-[320px]"
              placeholder="搜索订单号/商户号/ID"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <input
              className="np-input w-full md:w-[180px]"
              placeholder="状态（可选）"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            />
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
	              <th className="px-3 py-2">订单号</th>
	              <th className="px-3 py-2">商户</th>
	              <th className="px-3 py-2">金额</th>
	              <th className="px-3 py-2">创建时间</th>
	              <th className="px-3 py-2">状态</th>
	              <th className="px-3 py-2">通知</th>
	            </tr>
	          </thead>
	          <tbody>
	            {orders.map((o) => {
	              const mch = o.merchantCode ? `${o.merchantCode}${o.merchantName ? ` ${o.merchantName}` : ""}` : o.merchantId.slice(0, 8);
	              return (
	                <tr key={o.id} className="border-t border-white/10">
	                  <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">
	                    <a className="underline" href={`/admin/orders/payout/${o.id}`}>
	                      {o.merchantOrderNo}
	                    </a>
	                  </td>
	                  <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{mch}</td>
	                  <td className="px-3 py-2">{o.amount}</td>
	                  <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{fmt(o.createdAtMs)}</td>
	                  <td className="px-3 py-2">
	                    {(() => {
	                      const sv = orderStatusPill("payout", o.status);
	                      return (
	                        <div>
	                          <span className={sv.className}>{sv.label}</span>
	                          {o.lockedPaymentPersonName ? (
	                            <div className="mt-1 text-[11px] text-[var(--np-faint)]">
	                              支付个人: {o.lockedPaymentPersonName}
	                              {o.lockExpiresAtMs ? ` · 锁定至 ${fmt(Number(o.lockExpiresAtMs))}` : ""}
	                            </div>
	                          ) : null}
	                        </div>
	                      );
	                    })()}
	                  </td>
	                  <td className="px-3 py-2 text-xs">
	                    {(() => {
	                      const nv = notifyStatusPill(o.notifyStatus);
	                      return <span className={nv.className}>{nv.label}</span>;
	                    })()}
	                  </td>
	                </tr>
	              );
	            })}
            {!orders.length ? (
              <tr>
	                <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={6}>
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
