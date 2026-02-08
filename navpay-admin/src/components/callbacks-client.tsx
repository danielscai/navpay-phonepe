"use client";

import { useEffect, useState } from "react";
import { ListPager, ListToolbar } from "@/components/list-kit";

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

export default function CallbacksClient() {
  const [rows, setRows] = useState<Task[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string>("Asia/Shanghai");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);

  async function query() {
    setErr(null);
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (status.trim()) sp.set("status", status.trim());
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    const r = await fetch(`/api/admin/callbacks?${sp.toString()}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载失败");
      return;
    }
    setRows(j.rows ?? []);
    setTotal(Number(j.total ?? 0));
  }

  useEffect(() => {
    query();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setTimezone(j.timezone);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  return (
    <div>
      <ListToolbar
        left={
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="np-input w-full md:w-[320px]"
              placeholder="搜索 URL/订单ID/类型"
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
              query();
            }}
          >
            查询
          </button>
        }
        error={err}
      />

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
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
            {rows.map((t) => {
              const fmt = (ms: number) =>
                new Date(ms).toLocaleString("zh-CN", { timeZone: timezone, hour12: false });
              return (
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
              );
            })}
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
