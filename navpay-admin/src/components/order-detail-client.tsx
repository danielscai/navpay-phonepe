"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { notifyStatusPill, orderStatusPill } from "@/lib/order-status";

type Attempt = {
  id: string;
  taskId: string;
  responseCode?: number | null;
  responseBody?: string | null;
  error?: string | null;
  durationMs?: number | null;
  createdAtMs: number;
};

type Task = {
  id: string;
  url: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAtMs: number;
  lastError?: string | null;
  createdAtMs: number;
};

export default function OrderDetailClient(props: { orderType: "collect" | "payout"; orderId: string }) {
  const [timezone, setTimezone] = useState<string>("Asia/Shanghai");
  const [order, setOrder] = useState<any>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [attemptsByTask, setAttemptsByTask] = useState<Record<string, Attempt[]>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentPersons, setPaymentPersons] = useState<Array<{ id: string; name: string }>>([]);
  const [lockPersonId, setLockPersonId] = useState<string>("");
  const [lockMode, setLockMode] = useState<"AUTO" | "MANUAL">("AUTO");

  const fmt = (ms: number) => new Date(ms).toLocaleString("zh-CN", { timeZone: timezone, hour12: false });

  async function load() {
    setErr(null);
    const r = await fetch(`/api/admin/orders/${props.orderType}/${props.orderId}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr(r.status === 403 ? "无权限访问" : "加载失败");
      return;
    }
    setOrder(j.order ?? null);
    setTasks(j.tasks ?? []);
    setAttemptsByTask(j.attemptsByTaskId ?? {});
  }

  useEffect(() => {
    load();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setTimezone(j.timezone);
    })();
    (async () => {
      const r = await fetch("/api/admin/payment-persons");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        const list = (j.rows ?? []).map((x: any) => ({ id: String(x.id), name: String(x.name) }));
        setPaymentPersons(list);
        if (list.length && !lockPersonId) setLockPersonId(list[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.orderType, props.orderId]);

  const terminal = useMemo(() => {
    const st = String(order?.status ?? "");
    if (props.orderType === "collect") return ["SUCCESS", "FAILED", "EXPIRED"].includes(st);
    return ["SUCCESS", "FAILED", "REJECTED", "EXPIRED"].includes(st);
  }, [order?.status, props.orderType]);

  async function resend() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/orders/${props.orderType}/${props.orderId}/notify/resend`, { method: "POST" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("补发失败");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function lockPayout() {
    if (props.orderType !== "payout") return;
    if (!lockPersonId) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/orders/payout/${props.orderId}/lock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentPersonId: lockPersonId, mode: lockMode }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("锁单失败");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function unlockPayout() {
    if (props.orderType !== "payout") return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/orders/payout/${props.orderId}/unlock`, { method: "POST" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("解锁失败");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function setPayoutStatus(status: string) {
    if (props.orderType !== "payout") return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/orders/payout/${props.orderId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, enqueueCallback: true }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("操作失败");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="np-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link className="np-btn px-3 py-2 text-sm" href={`/admin/orders/${props.orderType}`}>
              ← 返回
            </Link>
            <div className="min-w-0">
              <div className="text-xs text-[var(--np-faint)]">订单详情（{props.orderType === "collect" ? "代收" : "代付"}）</div>
              <div className="mt-1 font-mono text-xs text-[var(--np-muted)] break-all">{props.orderId}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="np-btn px-3 py-2 text-sm" onClick={load} disabled={busy}>
              刷新
            </button>
          </div>
        </div>
        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
      </div>

      {order ? (
        <div className="np-card p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">订单号</div>
              <div className="mt-2 font-mono text-xs text-[var(--np-muted)] break-all">{order.merchantOrderNo}</div>
              <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)] break-all">{order.id}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">状态</div>
              <div className="mt-2">
                {(() => {
                  const sv = orderStatusPill(props.orderType, String(order.status));
                  return <span className={sv.className}>{sv.label}</span>;
                })()}
              </div>
              <div className="mt-2 text-xs text-[var(--np-faint)]">创建 {fmt(order.createdAtMs)}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">通知状态</div>
              <div className="mt-2">
                {(() => {
                  const nv = notifyStatusPill(order.notifyStatus);
                  return <span className={nv.className}>{nv.label}</span>;
                })()}
              </div>
              <div className="mt-2 text-xs text-[var(--np-faint)]">
                最后通知 {order.lastNotifiedAtMs ? fmt(Number(order.lastNotifiedAtMs)) : "-"}
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">金额</div>
              <div className="mt-2 font-mono text-lg text-[var(--np-text)]">{order.amount}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">手续费</div>
              <div className="mt-2 font-mono text-lg text-[var(--np-muted)]">{order.fee}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">回调地址</div>
              <div className="mt-2 font-mono text-xs text-[var(--np-muted)] break-all">{order.notifyUrl}</div>
            </div>
          </div>

          {props.orderType === "collect" ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">支付个人</div>
              <div className="mt-2 text-sm text-[var(--np-text)]">{order.assignedPaymentPersonName ?? "-"}</div>
              <div className="mt-1 text-xs text-[var(--np-faint)]">
                分配时间 {order.assignedAtMs ? fmt(Number(order.assignedAtMs)) : "-"}
              </div>
            </div>
          ) : null}

          {props.orderType === "payout" ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-[var(--np-faint)]">支付个人锁单</div>
                <div className="flex items-center gap-2">
                  {String(order.status) === "APPROVED" ? (
                    <>
                      <select className="np-input h-[34px] text-sm" value={lockPersonId} onChange={(e) => setLockPersonId(e.target.value)}>
                        {paymentPersons.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <select className="np-input h-[34px] text-sm" value={lockMode} onChange={(e) => setLockMode(e.target.value as any)}>
                        <option value="AUTO">自动锁单</option>
                        <option value="MANUAL">手动锁单</option>
                      </select>
                      <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={lockPayout} disabled={busy || !lockPersonId}>
                        锁单
                      </button>
                    </>
                  ) : null}
                  {String(order.status) === "LOCKED" ? (
                    <>
                      <button className="np-btn px-3 py-2 text-sm" onClick={unlockPayout} disabled={busy}>
                        解锁
                      </button>
                      <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => setPayoutStatus("SUCCESS")} disabled={busy}>
                        模拟成功
                      </button>
                      <button className="np-btn px-3 py-2 text-sm" onClick={() => setPayoutStatus("FAILED")} disabled={busy}>
                        模拟失败
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-sm">
                <div>
                  <span className="text-[var(--np-faint)]">当前锁定: </span>
                  <span className="text-[var(--np-text)]">{order.lockedPaymentPersonName ?? "-"}</span>
                </div>
                <div className="text-xs text-[var(--np-faint)]">
                  模式 {order.lockMode ?? "-"} · 锁定时间 {order.lockedAtMs ? fmt(Number(order.lockedAtMs)) : "-"} · 到期{" "}
                  {order.lockExpiresAtMs ? fmt(Number(order.lockExpiresAtMs)) : "-"}
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={resend} disabled={busy || !terminal}>
              {busy ? "处理中..." : "手动补发通知"}
            </button>
          </div>
          {!terminal ? <div className="mt-2 text-xs text-[var(--np-faint)]">提示：仅终态订单（成功/失败/过期等）允许补发通知。</div> : null}
        </div>
      ) : null}

      <div className="np-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-[var(--np-faint)]">通知历史</div>
          <div className="text-xs text-[var(--np-faint)]">按任务分组显示重试</div>
        </div>

        {!tasks.length ? (
          <div className="mt-3 text-sm text-[var(--np-muted)]">暂无通知任务</div>
        ) : (
          <div className="mt-3 grid gap-3">
            {tasks.map((t) => {
              const attempts = attemptsByTask[t.id] ?? [];
              return (
                <div key={t.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-[var(--np-muted)] break-all">{t.id}</div>
                      <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)] break-all">{t.url}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="np-pill">{t.status}</span>
                      <span className="np-pill">
                        {t.attemptCount}/{t.maxAttempts}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white/5 text-[11px] text-[var(--np-faint)]">
                        <tr>
                          <th className="px-3 py-2">时间</th>
                          <th className="px-3 py-2">HTTP</th>
                          <th className="px-3 py-2">耗时</th>
                          <th className="px-3 py-2">错误</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attempts.map((a) => (
                          <tr key={a.id} className="border-t border-white/10">
                            <td className="px-3 py-2 font-mono text-[11px] text-[var(--np-muted)]">{fmt(a.createdAtMs)}</td>
                            <td className="px-3 py-2 font-mono text-[11px] text-[var(--np-muted)]">{a.responseCode ?? "-"}</td>
                            <td className="px-3 py-2 font-mono text-[11px] text-[var(--np-muted)]">{a.durationMs ?? "-"}ms</td>
                            <td className="px-3 py-2 text-[11px] text-[var(--np-danger)]">{a.error ?? ""}</td>
                          </tr>
                        ))}
                        {!attempts.length ? (
                          <tr>
                            <td className="px-3 py-3 text-xs text-[var(--np-muted)]" colSpan={4}>
                              暂无发送记录
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
