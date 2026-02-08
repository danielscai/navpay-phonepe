"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  personId?: string | null;
  username?: string | null;
  personName?: string | null;
  name: string;
  online: boolean;
  lastSeenAtMs?: number | null;
  updatedAtMs: number;
};

export default function DevicesClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setErr(null);
    const r = await fetch("/api/admin/resources/devices");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr(r.status === 403 ? "无权限访问" : "加载失败");
      return;
    }
    setRows(j.rows ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="grid gap-4">
      <div className="np-card p-4">
        <div className="text-xs text-[var(--np-faint)]">资源管理</div>
        <div className="mt-1 text-lg font-semibold tracking-tight">手机设备</div>
        <div className="mt-2 text-sm text-[var(--np-muted)]">设备由 App/客户端注册上报，后台仅展示与管理状态。</div>
        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
      </div>

      <div className="np-card p-4 overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-3 py-2">设备名</th>
              <th className="px-3 py-2">归属</th>
              <th className="px-3 py-2">在线</th>
              <th className="px-3 py-2">最后心跳</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-t border-white/10">
                <td className="px-3 py-2">
                  <div className="text-sm">{d.name}</div>
                  <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)]">{d.id.slice(0, 12)}</div>
                </td>
                <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{d.username ? `${d.username}${d.personName ? ` (${d.personName})` : ""}` : "-"}</td>
                <td className="px-3 py-2 text-xs">
                  {d.online ? <span className="np-pill np-pill-ok">在线</span> : <span className="np-pill np-pill-off">离线</span>}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{d.lastSeenAtMs ? new Date(d.lastSeenAtMs).toLocaleString("zh-CN", { hour12: false }) : "-"}</td>
                <td className="px-3 py-2 text-right text-xs text-[var(--np-faint)]">-</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={5}>
                  暂无设备
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
