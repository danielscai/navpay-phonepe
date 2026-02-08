"use client";

import { useEffect, useState } from "react";
import { ListPager, ListToolbar } from "@/components/list-kit";
import { notifyStatusPill, orderStatusPill } from "@/lib/order-status";

type Order = {
  id: string;
  merchantOrderNo: string;
  amount: string;
  fee: string;
  status: string;
  notifyStatus?: string;
  lastNotifiedAtMs?: number | null;
  notifyUrl: string;
  assignedPaymentPersonId?: string | null;
  assignedAtMs?: number | null;
  assignedPaymentPersonName?: string | null;
  createdAtMs: number;
};

export default function MerchantCollectOrdersClient() {
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
    const r = await fetch(`/api/merchant/orders/collect?${sp.toString()}`);
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
            <input className="np-input w-full md:w-[320px]" placeholder="搜索订单号/ID" value={q} onChange={(e) => setQ(e.target.value)} />
            <input className="np-input w-full md:w-[180px]" placeholder="状态（可选）" value={status} onChange={(e) => setStatus(e.target.value)} />
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
	              <th className="px-3 py-2">金额</th>
	              <th className="px-3 py-2">手续费</th>
	              <th className="px-3 py-2">创建时间</th>
	              <th className="px-3 py-2">状态</th>
	              <th className="px-3 py-2">通知</th>
	            </tr>
	          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-white/10">
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{o.merchantOrderNo}</td>
                <td className="px-3 py-2">{o.amount}</td>
                <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{o.fee}</td>
	                <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{fmt(o.createdAtMs)}</td>
	                <td className="px-3 py-2">
	                  {(() => {
	                    const sv = orderStatusPill("collect", o.status);
	                    return (
	                      <div>
	                        <span className={sv.className}>{sv.label}</span>
	                        {o.assignedPaymentPersonName ? (
	                          <div className="mt-1 text-[11px] text-[var(--np-faint)]">支付个人: {o.assignedPaymentPersonName}</div>
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
	            ))}
            {!orders.length ? (
              <tr>
	                <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={6}>
	                  暂无数据
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
