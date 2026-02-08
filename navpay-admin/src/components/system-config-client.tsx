"use client";

import { useEffect, useMemo, useState } from "react";

type Row = { key: string; value: string; description?: string | null; updatedAtMs: number };

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

export default function SystemConfigClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setErr(null);
    const r = await fetch("/api/admin/system/config");
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

  async function upsert() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/system/config", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ key, value, description: description || undefined }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(r.status === 403 ? "无权限修改" : "保存失败");
        return;
      }
      setEditingKey(null);
      setKey("");
      setValue("");
      setDescription("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.key.toLowerCase().includes(s) || String(r.description ?? "").toLowerCase().includes(s));
  }, [q, rows]);

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="np-card p-4 md:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <input className="np-input w-full" placeholder="搜索 key/描述" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
                <tr>
                  <th className="px-4 py-3">Key</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="px-4 py-3">描述</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.key} className="border-t border-white/10">
                    <td className="px-4 py-3 font-mono text-xs text-[var(--np-muted)]">{r.key}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--np-muted)]">{r.value}</td>
                    <td className="px-4 py-3 text-xs text-[var(--np-muted)]">{r.description ?? ""}</td>
                    <td className="px-4 py-3">
                      <button
                        className="np-btn px-2 py-1 text-xs"
                        onClick={() => {
                          setEditingKey(r.key);
                          setKey(r.key);
                          setValue(r.value);
                          setDescription(r.description ?? "");
                        }}
                      >
                        编辑
                      </button>
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
          <div className="text-xs text-[var(--np-faint)]">{editingKey ? "编辑参数" : "新增参数"}</div>
          <div className="mt-3 grid gap-2">
            <input className="np-input" placeholder="key" value={key} onChange={(e) => setKey(e.target.value)} disabled={!!editingKey} />
            <input className="np-input" placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
            <input
              className="np-input"
              placeholder="描述（可选）"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <button className="np-btn np-btn-primary mt-1" onClick={upsert} disabled={busy || !key.trim()}>
              {busy ? "保存中..." : "保存"}
            </button>
            {editingKey ? (
              <button
                className="np-btn mt-1"
                onClick={() => {
                  setEditingKey(null);
                  setKey("");
                  setValue("");
                  setDescription("");
                }}
              >
                取消编辑
              </button>
            ) : null}
            <div className="text-xs text-[var(--np-faint)]">需要 `system.write` 权限。</div>
          </div>
        </div>
      </div>
    </div>
  );
}
