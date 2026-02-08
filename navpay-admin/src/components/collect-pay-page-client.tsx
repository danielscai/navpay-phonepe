"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { orderStatusPill } from "@/lib/order-status";

type Order = {
  id: string;
  merchantOrderNo: string;
  amount: string;
  fee: string;
  status: string;
  createdAtMs: number;
};

function fmtRemain(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(t / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function CollectPayPageClient(props: { order: Order; expiresAtMs: number }) {
  const [order, setOrder] = useState<Order>(props.order);
  const [expiresAtMs, setExpiresAtMs] = useState<number>(props.expiresAtMs);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const remainMs = expiresAtMs - nowMs;
  const expired = remainMs <= 0;
  const terminal = useMemo(() => ["SUCCESS", "FAILED", "EXPIRED"].includes(order.status), [order.status]);

  async function refresh() {
    const r = await fetch(`/api/pay/collect/${order.id}`);
    const j = await r.json().catch(() => null);
    if (r.ok && j?.ok && j.order) {
      setOrder((prev) => ({ ...prev, ...j.order }));
      if (typeof j.expiresAtMs === "number") setExpiresAtMs(j.expiresAtMs);
      if (typeof j.nowMs === "number") setNowMs(j.nowMs);
      return;
    }
  }

  async function setStatus(next: "PENDING_PAY" | "PAID" | "SUCCESS" | "FAILED" | "EXPIRED") {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/pay/collect/${order.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next, enqueueCallback: true }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.error === "expired" ? "订单已超时" : "操作失败");
        await refresh();
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // Simulate "user opened pay page": CREATED -> PENDING_PAY
    (async () => {
      await fetch(`/api/pay/collect/${order.id}/open`, { method: "POST" }).catch(() => null);
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Poll server state so countdown/timeout is accurate even if config changes or order is expired server-side.
    const t = setInterval(() => {
      refresh();
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  return (
    <div className="mx-auto w-full max-w-[720px] p-6">
      <div className="np-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--np-faint)]">支付页面（调试用）</div>
            <div className="mt-1 font-mono text-xs text-[var(--np-muted)] break-all">{order.id}</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="np-btn px-3 py-2 text-sm" onClick={refresh} disabled={busy}>
              刷新
            </button>
            <Link className="np-btn px-3 py-2 text-sm" href="/admin/tools/order-simulator" target="_blank">
              打开订单模拟器
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-[var(--np-faint)]">金额</div>
            <div className="mt-2 font-mono text-xl text-[var(--np-text)]">{order.amount}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-[var(--np-faint)]">手续费</div>
            <div className="mt-2 font-mono text-xl text-[var(--np-muted)]">{order.fee}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-[var(--np-faint)]">状态</div>
            <div className="mt-2">
              {(() => {
                const sv = orderStatusPill("collect", order.status);
                return <span className={sv.className}>{sv.label}</span>;
              })()}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-[var(--np-faint)]">倒计时（超时后自动 EXPIRED）</div>
            <div className={["font-mono text-sm", expired ? "text-[var(--np-danger)]" : "text-[var(--np-text)]"].join(" ")}>
              {fmtRemain(remainMs)}
            </div>
          </div>
          <div className="mt-2 text-xs text-[var(--np-faint)]">与是否打开支付页无关，超时基于订单创建时间计算。</div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-xs text-[var(--np-faint)]">商户订单号</div>
          <div className="mt-2 font-mono text-xs text-[var(--np-muted)] break-all">{order.merchantOrderNo}</div>
        </div>

        <div className="mt-4 grid gap-2">
          <div className="text-xs text-[var(--np-faint)]">模拟用户行为</div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="np-btn px-3 py-2 text-sm" onClick={() => setStatus("PENDING_PAY")} disabled={busy || terminal}>
              支付中
            </button>
            <button className="np-btn px-3 py-2 text-sm" onClick={() => setStatus("PAID")} disabled={busy || terminal || expired}>
              已支付（待确认）
            </button>
            <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => setStatus("SUCCESS")} disabled={busy || terminal || expired}>
              {busy ? "处理中..." : "支付成功"}
            </button>
            <button className="np-btn px-3 py-2 text-sm" onClick={() => setStatus("FAILED")} disabled={busy || terminal}>
              模拟失败
            </button>
            <button className="np-btn px-3 py-2 text-sm" onClick={() => setStatus("EXPIRED")} disabled={busy || terminal}>
              模拟超时
            </button>
          </div>
        </div>

        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
        <div className="mt-3 text-xs text-[var(--np-faint)]">
          提示：成功/失败/超时都会更新订单状态并触发回调任务（如果订单配置了 notifyUrl）。
        </div>
      </div>
    </div>
  );
}
