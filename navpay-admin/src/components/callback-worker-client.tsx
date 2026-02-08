"use client";

import { useEffect, useState } from "react";

type Task = {
  id: string;
  orderType: string;
  orderId: string;
  url: string;
  status: string;
  attemptCount: number;
  nextAttemptAtMs: number;
  lastError?: string | null;
  createdAtMs: number;
};

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

export default function CallbackWorkerClient() {
  const [rows, setRows] = useState<Task[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string>("Asia/Shanghai");

  async function load() {
    const r = await fetch("/api/admin/callbacks");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载失败");
      return;
    }
    setRows(j.rows ?? []);
  }

  useEffect(() => {
    load();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setTimezone(j.timezone);
    })();
  }, []);

  async function runWorker() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/callbacks/worker", { method: "POST", headers: { ...h } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("执行失败");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const fmt = (ms: number) => new Date(ms).toLocaleString("zh-CN", { timeZone: timezone, hour12: false });

  return (
    <div className="grid gap-4">
      <div className="np-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[var(--np-faint)]">回调 Worker</div>
          <div className="flex gap-2">
            <button className="np-btn px-3 py-2 text-sm" onClick={load} disabled={busy}>
              刷新
            </button>
            <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={runWorker} disabled={busy}>
              {busy ? "执行中..." : "执行 Worker"}
            </button>
          </div>
        </div>
        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-3 py-2">类型</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">创建时间</th>
              <th className="px-3 py-2">下次尝试</th>
              <th className="px-3 py-2">回调 URL</th>
              <th className="px-3 py-2">重试</th>
              <th className="px-3 py-2">错误</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-white/10">
                <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{t.orderType}</td>
                <td className="px-3 py-2">
                  <span className="np-badge">{t.status}</span>
                </td>
                <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{fmt(t.createdAtMs)}</td>
                <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{fmt(t.nextAttemptAtMs)}</td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)] break-all">{t.url}</td>
                <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{t.attemptCount}</td>
                <td className="px-3 py-2 text-xs text-[var(--np-danger)]">{t.lastError ?? ""}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={7}>
                  暂无任务
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

