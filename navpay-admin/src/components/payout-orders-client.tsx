"use client";

import { useEffect, useMemo, useState } from "react";

type Merchant = { id: string; code: string; name: string };
type Order = {
  id: string;
  merchantId: string;
  merchantOrderNo: string;
  amount: string;
  fee: string;
  status: string;
  notifyUrl: string;
  beneficiaryName: string;
  accountNo: string;
  ifsc: string;
  createdAtMs: number;
};

export default function PayoutOrdersClient() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [timezone, setTimezone] = useState<string>("Asia/Shanghai");

  async function loadMerchants() {
    const r = await fetch("/api/admin/merchants");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return;
    const rows = (j.rows ?? []).map((x: any) => ({ id: x.id, code: x.code, name: x.name }));
    setMerchants(rows);
  }

  async function loadOrders() {
    const r = await fetch("/api/admin/orders/payout");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return;
    setOrders(j.rows ?? []);
  }

  useEffect(() => {
    loadMerchants();
    loadOrders();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setTimezone(j.timezone);
    })();
  }, []);

  const merchantMap = useMemo(() => new Map(merchants.map((m) => [m.id, m])), [merchants]);
  const fmt = (ms: number) =>
    new Date(ms).toLocaleString("zh-CN", { timeZone: timezone, hour12: false });

  return (
    <div className="np-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[var(--np-faint)]">订单列表</div>
        <button className="np-btn px-3 py-2 text-xs" onClick={loadOrders}>
          刷新
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-3 py-2">商户</th>
              <th className="px-3 py-2">订单号</th>
              <th className="px-3 py-2">金额</th>
              <th className="px-3 py-2">创建时间</th>
              <th className="px-3 py-2">状态</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const m = merchantMap.get(o.merchantId);
              return (
                <tr key={o.id} className="border-t border-white/10">
                  <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{m ? m.code : o.merchantId.slice(0, 8)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{o.merchantOrderNo}</td>
                  <td className="px-3 py-2">{o.amount}</td>
                  <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{fmt(o.createdAtMs)}</td>
                  <td className="px-3 py-2">
                    <span className="np-badge">{o.status}</span>
                  </td>
                </tr>
              );
            })}
            {!orders.length ? (
              <tr>
                <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={5}>
                  暂无订单
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
