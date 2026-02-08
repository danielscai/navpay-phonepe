"use client";

import { useEffect, useMemo, useState } from "react";
import { knownOrderStatuses, notifyStatusPill, orderStatusFlow, orderStatusPill, type OrderType } from "@/lib/order-status";
import StatusFlowRag from "@/components/status-flow-rag";

type Merchant = { id: string; code: string; name: string };
type Receiver = { id: string; name: string; createdAtMs: number };

type CollectOrder = {
  id: string;
  merchantId: string;
  merchantOrderNo: string;
  amount: string;
  fee: string;
  status: string;
  notifyStatus?: string;
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
  notifyStatus?: string;
  notifyUrl: string;
  beneficiaryName: string;
  accountNo: string;
  ifsc: string;
  createdAtMs: number;
};

function randomAmount(): string {
  // Keep it simple for debugging: 10.00 ~ 500.00
  const cents = Math.floor(1000 + Math.random() * 49000); // 1000..49999
  return (cents / 100).toFixed(2);
}

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
  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [notifyPreset, setNotifyPreset] = useState<string>(""); // "" => manual, otherwise receiverId
  const [createOpen, setCreateOpen] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);

  const [collectOrders, setCollectOrders] = useState<CollectOrder[]>([]);
  const [payoutOrders, setPayoutOrders] = useState<PayoutOrder[]>([]);

  const [merchantOrderNo, setMerchantOrderNo] = useState("");
  const [amount, setAmount] = useState(() => randomAmount());
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
    (async () => {
      const r = await fetch("/api/admin/webhooks/receivers");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) setReceivers(j.rows ?? []);
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isPlaceholder = notifyUrl.includes("/api/webhook/receive/RECEIVER_ID");
    if (notifyPreset) {
      setNotifyUrl(`${window.location.origin}/api/webhook/receive/${notifyPreset}`);
      return;
    }
    // Best-effort default: pick a webhook receiver when available (for debugging convenience).
    if ((isPlaceholder || !notifyUrl) && receivers.length) {
      setNotifyPreset(receivers[0].id);
      setNotifyUrl(`${window.location.origin}/api/webhook/receive/${receivers[0].id}`);
      return;
    }
    if (!notifyUrl) setNotifyUrl(`${window.location.origin}/api/webhook/receive/RECEIVER_ID`);
  }, [receivers, notifyPreset, notifyUrl]);

  useEffect(() => {
    if (!merchantOrderNo) {
      setMerchantOrderNo((mode === "collect" ? "CO_" : "PO_") + Date.now());
    }
  }, [mode, merchantOrderNo]);

  function openCreate() {
    setAmount(randomAmount());
    setCreateOpen(true);
  }

  async function create(): Promise<boolean> {
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
          return false;
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
          return false;
        }
      }
      setMerchantOrderNo((mode === "collect" ? "CO_" : "PO_") + Date.now());
      setAmount(randomAmount());
      await loadOrders();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const list = mode === "collect" ? collectOrders : payoutOrders;
  const flow = orderStatusFlow(mode as OrderType);
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of knownOrderStatuses(mode as OrderType)) m.set(String(s), 0);
    for (const o of list) m.set(String(o.status), (m.get(String(o.status)) ?? 0) + 1);
    return m;
  }, [list, mode]);

  return (
    <div className="grid gap-4">
      <div className="np-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[var(--np-faint)]">订单模拟器</div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-2">
              <button
                className={["np-btn px-2 py-1 text-xs", mode === "collect" ? "np-btn-primary" : ""].join(" ")}
                onClick={() => setMode("collect")}
              >
                代收
              </button>
              <button
                className={["np-btn px-2 py-1 text-xs", mode === "payout" ? "np-btn-primary" : ""].join(" ")}
                onClick={() => setMode("payout")}
              >
                代付
              </button>
            </div>
            <button className="np-btn px-3 py-2 text-xs" onClick={() => setFlowOpen(true)}>
              状态流转
            </button>
            <button className="np-btn np-btn-primary px-3 py-2 text-xs" onClick={openCreate} disabled={busy}>
              新建订单
            </button>
            <button className="np-btn px-3 py-2 text-xs" onClick={loadOrders} disabled={busy}>
              刷新
            </button>
          </div>
        </div>
        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}

        {/* Mobile: card layout to avoid any horizontal overflow */}
        <div className="mt-3 grid gap-2 md:hidden">
          {list.slice(0, 50).map((o: any) => {
            const m = merchantMap.get(o.merchantId);
            const sv = orderStatusPill(mode as OrderType, o.status);
            const personName =
              mode === "collect" ? (o.assignedPaymentPersonName as string | undefined) : (o.lockedPaymentPersonName as string | undefined);
            return (
              <div key={o.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-[var(--np-faint)]">{m ? m.code : o.merchantId.slice(0, 8)}</div>
                    <a className="mt-1 block font-mono text-xs text-[var(--np-muted)] underline break-all" href={`/admin/orders/${mode}/${o.id}`} target="_blank" rel="noreferrer">
                      {o.merchantOrderNo}
                    </a>
                  </div>
                  <div className="text-right">
                    <span className={sv.className}>{sv.label}</span>
                    {personName ? <div className="mt-1 text-[11px] text-[var(--np-faint)]">支付个人: {personName}</div> : null}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--np-muted)]">
                  <div>
                    <div className="text-[var(--np-faint)]">金额</div>
                    <div className="mt-1 font-mono text-sm text-[var(--np-text)]">{o.amount}</div>
                  </div>
                  <div>
                    <div className="text-[var(--np-faint)]">创建时间</div>
                    <div className="mt-1 font-mono text-xs">{fmt(o.createdAtMs)}</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  {(() => {
                    const nv = notifyStatusPill((o as any).notifyStatus);
                    return <span className={nv.className}>{nv.label}</span>;
                  })()}
                  {mode === "collect" ? (
                    <a className="np-btn px-2 py-1 text-xs" href={`/pay/collect/${o.id}`} target="_blank" rel="noreferrer">
                      支付页
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
          {!list.length ? <div className="text-sm text-[var(--np-muted)]">暂无订单</div> : null}
        </div>

        {/* Desktop/tablet: table layout with internal horizontal scroll (never page-level overflow). */}
        <div className="mt-3 hidden overflow-x-auto rounded-xl border border-white/10 md:block">
          <table className="w-full min-w-full table-auto text-left text-sm">
            <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
              <tr>
                <th className="px-3 py-2 whitespace-nowrap">商户</th>
                <th className="px-3 py-2 whitespace-nowrap">订单号</th>
                <th className="px-3 py-2 whitespace-nowrap">金额</th>
                <th className="px-3 py-2 hidden lg:table-cell whitespace-nowrap">创建时间</th>
                <th className="px-3 py-2 whitespace-nowrap">状态</th>
                <th className="px-3 py-2 sticky right-0 z-10 bg-white/5 whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 50).map((o: any) => {
                const m = merchantMap.get(o.merchantId);
                const sv = orderStatusPill(mode as OrderType, o.status);
                const personName =
                  mode === "collect" ? (o.assignedPaymentPersonName as string | undefined) : (o.lockedPaymentPersonName as string | undefined);
                return (
                  <tr key={o.id} className="border-t border-white/10">
                    <td className="px-3 py-2 text-xs text-[var(--np-muted)] whitespace-nowrap">{m ? m.code : o.merchantId.slice(0, 8)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">
                      <a className="block max-w-[360px] truncate underline" href={`/admin/orders/${mode}/${o.id}`}>
                        {o.merchantOrderNo}
                      </a>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{o.amount}</td>
                    <td className="px-3 py-2 text-xs text-[var(--np-muted)] hidden lg:table-cell">{fmt(o.createdAtMs)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div>
                        <span className={sv.className}>{sv.label}</span>
                        {personName ? <div className="mt-1 text-[11px] text-[var(--np-faint)]">支付个人: {personName}</div> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 sticky right-0 z-10 bg-[rgba(15,26,47,0.92)]">
                      <div className="flex items-center justify-end gap-2">
                        {(() => {
                          const nv = notifyStatusPill((o as any).notifyStatus);
                          return <span className={nv.className}>{nv.label}</span>;
                        })()}
                        {mode === "collect" ? (
                          <a className="np-btn px-2 py-1 text-xs" href={`/pay/collect/${o.id}`} target="_blank" rel="noreferrer">
                            支付页
                          </a>
                        ) : null}
                      </div>
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

      {flowOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-label="close" onClick={() => setFlowOpen(false)} />
          <div className="relative z-10 w-full max-w-[980px]">
            <div className="np-modal p-4">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div className="text-base font-semibold tracking-tight">状态流转（{mode === "collect" ? "代收" : "代付"}）</div>
                <button className="np-btn px-3 py-2 text-sm" onClick={() => setFlowOpen(false)}>
                  关闭
                </button>
              </div>

              <div className="pt-4 grid gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {flow.main.map((s) => {
                    const sv = orderStatusPill(mode as OrderType, s);
                    const c = statusCounts.get(String(s)) ?? 0;
                    return (
                      <span key={s} className={sv.className}>
                        {sv.label}
                        <span className="ml-2 font-mono text-[11px] opacity-80">{c}</span>
                      </span>
                    );
                  })}
                  {flow.terminal.length ? <span className="text-[var(--np-faint)]">终态:</span> : null}
                  {flow.terminal.map((s) => {
                    const sv = orderStatusPill(mode as OrderType, s);
                    const c = statusCounts.get(String(s)) ?? 0;
                    return (
                      <span key={s} className={sv.className}>
                        {sv.label}
                        <span className="ml-2 font-mono text-[11px] opacity-80">{c}</span>
                      </span>
                    );
                  })}
                </div>

                <StatusFlowRag orderType={mode as OrderType} counts={statusCounts} />
                <div className="text-xs text-[var(--np-faint)]">提示：达到“成功”后不可回退。超时与是否打开支付页无关。</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            aria-label="close"
            onClick={() => setCreateOpen(false)}
          />
          <div className="relative z-10 w-full max-w-[720px]">
            <div className="np-modal p-4">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div className="text-base font-semibold tracking-tight">新建{mode === "collect" ? "代收" : "代付"}订单</div>
                <button className="np-btn px-3 py-2 text-sm" onClick={() => setCreateOpen(false)} disabled={busy}>
                  关闭
                </button>
              </div>

              <div className="pt-4 grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <div className="text-xs text-[var(--np-faint)]">商户</div>
                  <select id="sim-merchant" className="np-input mt-2 w-full" value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
                    {merchants.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code} - {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <div className="text-xs text-[var(--np-faint)]">商户订单号</div>
                  <input id="sim-order-no" className="np-input mt-2 w-full" value={merchantOrderNo} onChange={(e) => setMerchantOrderNo(e.target.value)} />
                </div>

                <div>
                  <div className="text-xs text-[var(--np-faint)]">金额</div>
                  <input className="np-input mt-2 w-full" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>

                {mode === "payout" ? (
                  <>
                    <div>
                      <div className="text-xs text-[var(--np-faint)]">收款人</div>
                      <input className="np-input mt-2 w-full" value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} />
                    </div>
                    <div>
                      <div className="text-xs text-[var(--np-faint)]">账号</div>
                      <input className="np-input mt-2 w-full" value={accountNo} onChange={(e) => setAccountNo(e.target.value)} />
                    </div>
                    <div className="md:col-span-2">
                      <div className="text-xs text-[var(--np-faint)]">IFSC</div>
                      <input className="np-input mt-2 w-full" value={ifsc} onChange={(e) => setIfsc(e.target.value)} />
                    </div>
                  </>
                ) : null}

                <div className="md:col-span-2">
                  <div className="text-xs text-[var(--np-faint)]">回调地址</div>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    <select
                      className="np-input w-full md:col-span-1"
                      value={notifyPreset}
                      onChange={(e) => {
                        const v = e.target.value;
                        setNotifyPreset(v);
                        if (!v) return;
                        if (typeof window !== "undefined") setNotifyUrl(`${window.location.origin}/api/webhook/receive/${v}`);
                      }}
                      disabled={busy}
                    >
                      <option value="">手动填写</option>
                      {receivers.map((r) => (
                        <option key={r.id} value={r.id}>
                          Webhook: {r.name}
                        </option>
                      ))}
                    </select>
                    <input
                      id="sim-notify-url"
                      className="np-input w-full md:col-span-2"
                      value={notifyUrl}
                      onChange={(e) => {
                        setNotifyPreset("");
                        setNotifyUrl(e.target.value);
                      }}
                      disabled={busy}
                      placeholder="https://example.com/webhook"
                    />
                  </div>
                </div>

                <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2">
                  <button className="np-btn px-3 py-2 text-sm" onClick={() => setCreateOpen(false)} disabled={busy}>
                    取消
                  </button>
                  <button
                    className="np-btn np-btn-primary px-3 py-2 text-sm"
                    onClick={async () => {
                      const ok = await create();
                      if (ok) setCreateOpen(false);
                    }}
                    disabled={busy}
                  >
                    {busy ? "处理中..." : "创建订单"}
                  </button>
                </div>
              </div>
              {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
