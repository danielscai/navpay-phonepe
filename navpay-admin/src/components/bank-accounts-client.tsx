"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  personId: string;
  username?: string | null;
  personName?: string | null;
  bankName: string;
  alias: string;
  accountLast4: string;
  ifsc?: string | null;
  enabled: boolean;
  updatedAtMs: number;
};

export default function BankAccountsClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Accounts are registered by clients; admin UI is read-only.

  async function load() {
    setErr(null);
    const r = await fetch("/api/admin/resources/bank-accounts");
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
        <div className="mt-1 text-lg font-semibold tracking-tight">网银账户</div>
        <div className="mt-2 text-sm text-[var(--np-muted)]">账户由 App/客户端注册上报，后台仅展示与管理状态。</div>
        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
      </div>

      <div className="np-card p-4 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-3 py-2">归属</th>
              <th className="px-3 py-2">银行</th>
              <th className="px-3 py-2">账户</th>
              <th className="px-3 py-2">IFSC</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">更新时间</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-white/10">
                <td className="px-3 py-2 text-xs text-[var(--np-muted)]">{a.username ? `${a.username}${a.personName ? ` (${a.personName})` : ""}` : a.personId.slice(0, 8)}</td>
                <td className="px-3 py-2">{a.bankName}</td>
                <td className="px-3 py-2">
                  <div className="text-sm">{a.alias}</div>
                  <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)]">**** {a.accountLast4}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{a.ifsc ?? "-"}</td>
                <td className="px-3 py-2 text-xs">{a.enabled ? <span className="np-pill np-pill-ok">启用</span> : <span className="np-pill np-pill-off">停用</span>}</td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{new Date(a.updatedAtMs).toLocaleString("zh-CN", { hour12: false })}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={6}>
                  暂无网银账户
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
