"use client";

import { useEffect, useMemo, useState } from "react";

type Merchant = { id: string; code: string; name: string };

type CollectOrder = {
  id: string;
  merchantId: string;
  merchantOrderNo: string;
  amount: string;
  fee: string;
  status: string;
  notifyUrl: string;
  createdAtMs: number;
};

type PayoutOrder = {
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

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

export default function OrderSimulatorClient() {
  const [mode, setMode] = useState<"collect" | "payout">("collect");
  const [timezone, setTimezone] = useState<string>("Asia/Shanghai");
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState<string>("");
  const [notifyUrl, setNotifyUrl] = useState("");

  const [collectOrders, setCollectOrders] = useState<CollectOrder[]>([]);
  const [payoutOrders, setPayoutOrders] = useState<PayoutOrder[]>([]);

  const [merchantOrderNo, setMerchantOrderNo] = useState("");
  const [amount, setAmount] = useState("100.00");
  const [beneficiaryName, setBeneficiaryName] = useState("Jack");
  const [accountNo, setAccountNo] = useState("6217001234567890");
  const [ifsc, setIfsc] = useState("ABCD0123456");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const merchantMap = useMemo(() => new Map(merchants.map((m) => [m.id, m])), [merchants]);
  const fmt = (ms: number) => new Date(ms).toLocaleString("zh-CN", { timeZone: timezone, hour12: false });

  async function loadMerchants() {
    const r = await fetch("/api/admin/merchants");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return;
    const rows = (j.rows ?? []).map((x: any) => ({ id: x.id, code: x.code, name: x.name }));
    setMerchants(rows);
    if (!merchantId && rows.length) setMerchantId(rows[0].id);
  }

  async function loadOrders() {
    const r1 = await fetch("/api/admin/orders/collect");
    const j1 = await r1.json().catch(() => null);
    if (r1.ok && j1?.ok) setCollectOrders(j1.rows ?? []);

    const r2 = await fetch("/api/admin/orders/payout");
    const j2 = await r2.json().catch(() => null);
    if (r2.ok && j2?.ok) setPayoutOrders(j2.rows ?? []);
  }

  useEffect(() => {
    loadMerchants();
    loadOrders();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setTimezone(j.timezone);
    })();
    if (typeof window !== "undefined") {
      setNotifyUrl(`${window.location.origin}/api/webhook/receive/RECEIVER_ID`);
    }
  }, []);

  useEffect(() => {
    if (!merchantOrderNo) {
      setMerchantOrderNo((mode === "collect" ? "CO_" : "PO_") + Date.now());
    }
  }, [mode, merchantOrderNo]);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      if (mode === "collect") {
        const r = await fetch("/api/admin/orders/collect", {
          method: "POST",
          headers: { "content-type": "application/json", ...h },
          body: JSON.stringify({ merchantId, merchantOrderNo, amount, notifyUrl, remark: "" }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) {
          setErr("创建代收订单失败");
          return;
        }
      } else {
        const r = await fetch("/api/admin/orders/payout", {
          method: "POST",
          headers: { "content-type": "application/json", ...h },
          body: JSON.stringify({
            merchantId,
            merchantOrderNo,
            amount,
            notifyUrl,
            beneficiaryName,
            accountNo,
            ifsc,
            bankName: "ICICI",
            remark: "",
          }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) {
          setErr("创建代付订单失败");
          return;
        }
      }
      setMerchantOrderNo((mode === "collect" ? "CO_" : "PO_") + Date.now());
      await loadOrders();
    } finally {
      setBusy(false);
    }
  }

  async function setCollectStatus(orderId: string, status: string) {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/orders/collect/${orderId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ status, enqueueCallback: true }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("更新状态失败");
        return;
      }
      await loadOrders();
    } finally {
      setBusy(false);
    }
  }

  async function setPayoutStatus(orderId: string, status: string) {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/orders/payout/${orderId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ status, enqueueCallback: true }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("更新状态失败");
        return;
      }
      await loadOrders();
    } finally {
      setBusy(false);
    }
  }

  const list = mode === "collect" ? collectOrders : payoutOrders;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="np-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-[var(--np-faint)]">订单模拟</div>
          <div className="flex gap-2">
            <button className={["np-btn px-2 py-1 text-xs", mode === "collect" ? "np-btn-primary" : ""].join(" ")} onClick={() => setMode("collect")}>
              代收
            </button>
            <button className={["np-btn px-2 py-1 text-xs", mode === "payout" ? "np-btn-primary" : ""].join(" ")} onClick={() => setMode("payout")}>
              代付
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          <label className="text-xs text-[var(--np-faint)]" htmlFor="sim-merchant">
            商户
          </label>
          <select id="sim-merchant" className="np-input" value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} - {m.name}
              </option>
            ))}
          </select>

          <label className="text-xs text-[var(--np-faint)]">商户订单号</label>
          <input
            id="sim-order-no"
            className="np-input"
            value={merchantOrderNo}
            onChange={(e) => setMerchantOrderNo(e.target.value)}
          />

          <label className="text-xs text-[var(--np-faint)]">金额</label>
          <input className="np-input" value={amount} onChange={(e) => setAmount(e.target.value)} />

          {mode === "payout" ? (
            <>
              <label className="text-xs text-[var(--np-faint)]">收款人</label>
              <input className="np-input" value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} />
              <label className="text-xs text-[var(--np-faint)]">账号</label>
              <input className="np-input" value={accountNo} onChange={(e) => setAccountNo(e.target.value)} />
              <label className="text-xs text-[var(--np-faint)]">IFSC</label>
              <input className="np-input" value={ifsc} onChange={(e) => setIfsc(e.target.value)} />
            </>
          ) : null}

          <label className="text-xs text-[var(--np-faint)]">回调地址</label>
          <input id="sim-notify-url" className="np-input" value={notifyUrl} onChange={(e) => setNotifyUrl(e.target.value)} />

          <button className="np-btn np-btn-primary mt-2" onClick={create} disabled={busy}>
            {busy ? "处理中..." : "创建订单"}
          </button>
          {err ? <div className="text-xs text-[var(--np-danger)]">{err}</div> : null}
        </div>
      </div>

      <div className="np-card p-4 md:col-span-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-[var(--np-faint)]">订单列表</div>
          <button className="np-btn px-3 py-2 text-xs" onClick={loadOrders} disabled={busy}>
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
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 50).map((o: any) => {
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
                    <td className="px-3 py-2">
                      {mode === "collect" ? (
                        <div className="flex flex-wrap gap-2">
                          <button className="np-btn px-2 py-1 text-xs" onClick={() => setCollectStatus(o.id, "PENDING_PAY")} disabled={busy}>
                            待支付
                          </button>
                          <button className="np-btn px-2 py-1 text-xs" onClick={() => setCollectStatus(o.id, "PAID")} disabled={busy}>
                            已支付
                          </button>
                          <button className="np-btn px-2 py-1 text-xs" onClick={() => setCollectStatus(o.id, "SUCCESS")} disabled={busy}>
                            完成
                          </button>
                          <button className="np-btn px-2 py-1 text-xs" onClick={() => setCollectStatus(o.id, "FAILED")} disabled={busy}>
                            失败
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button className="np-btn px-2 py-1 text-xs" onClick={() => setPayoutStatus(o.id, "APPROVED")} disabled={busy}>
                            审核通过
                          </button>
                          <button className="np-btn px-2 py-1 text-xs" onClick={() => setPayoutStatus(o.id, "BANK_CONFIRMING")} disabled={busy}>
                            银行确认
                          </button>
                          <button className="np-btn px-2 py-1 text-xs" onClick={() => setPayoutStatus(o.id, "SUCCESS")} disabled={busy}>
                            成功
                          </button>
                          <button className="np-btn px-2 py-1 text-xs" onClick={() => setPayoutStatus(o.id, "REJECTED")} disabled={busy}>
                            拒绝
                          </button>
                          <button className="np-btn px-2 py-1 text-xs" onClick={() => setPayoutStatus(o.id, "FAILED")} disabled={busy}>
                            失败
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!list.length ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={6}>
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
