"use client";

import { useEffect, useMemo, useState } from "react";

type Row = { id: string; ip: string; note?: string | null; enabled: boolean; createdAtMs: number };

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

export default function IpWhitelistClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [ip, setIp] = useState("");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setErr(null);
    const r = await fetch("/api/admin/system/ip-whitelist");
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

  async function add() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/system/ip-whitelist", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ ip, note: note || undefined, enabled: true }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(r.status === 403 ? "无权限修改" : "新增失败（可能重复）");
        return;
      }
      setIp("");
      setNote("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: Row) {
    const h = await csrfHeader();
    await fetch(`/api/admin/system/ip-whitelist/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...h },
      body: JSON.stringify({ enabled: !row.enabled }),
    });
    await load();
  }

  async function del(row: Row) {
    const h = await csrfHeader();
    await fetch(`/api/admin/system/ip-whitelist/${row.id}`, { method: "DELETE", headers: { ...h } });
    await load();
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.ip.toLowerCase().includes(s) || String(r.note ?? "").toLowerCase().includes(s));
  }, [q, rows]);

  return (
    <div className="grid gap-4 md:grid-cols-3">
        <div className="np-card p-4 md:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <input className="np-input w-full" placeholder="搜索 IP/备注" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="mt-2 text-xs text-[var(--np-faint)]">
            用于限制后台访问来源 IP。当前实现为精确匹配（不含 CIDR），上线前可扩展为 CIDR。
          </div>
          {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}

          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
                <tr>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">备注</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-white/10">
                    <td className="px-4 py-3 font-mono text-xs text-[var(--np-muted)]">{r.ip}</td>
                    <td className="px-4 py-3 text-xs text-[var(--np-muted)]">{r.note ?? ""}</td>
                    <td className="px-4 py-3">
                      <span className={["np-pill", r.enabled ? "np-pill-ok" : "np-pill-off"].join(" ")}>
                        {r.enabled ? "启用" : "停用"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button className="np-btn px-2 py-1 text-xs" onClick={() => toggle(r)}>
                          {r.enabled ? "停用" : "启用"}
                        </button>
                        <button className="np-btn px-2 py-1 text-xs" onClick={() => del(r)}>
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-[var(--np-muted)]" colSpan={4}>
                      暂无数据
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="np-card p-4">
          <div className="text-xs text-[var(--np-faint)]">新增</div>
          <div className="mt-3 grid gap-2">
            <input className="np-input" placeholder="IP (e.g. 1.2.3.4)" value={ip} onChange={(e) => setIp(e.target.value)} />
            <input className="np-input" placeholder="备注 (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="np-btn np-btn-primary mt-1" onClick={add} disabled={busy || !ip.trim()}>
              {busy ? "新增中..." : "新增"}
            </button>
            <div className="text-xs text-[var(--np-faint)]">需要 `system.write` 权限。</div>
          </div>
        </div>
    </div>
  );
}
