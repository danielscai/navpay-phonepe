"use client";

import { useEffect, useMemo, useState } from "react";

type Role = { id: string; name: string; description?: string | null };
type UserRow = {
  id: string;
  username: string;
  email?: string | null;
  displayName: string;
  totpEnabled: boolean;
  totpMustEnroll: boolean;
  roleIds: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

function Modal(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="fixed inset-0 bg-black/60" aria-label="close" onClick={props.onClose} />
      <div className="relative z-10 w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[var(--np-surface)] shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">{props.title}</div>
          <button className="np-btn px-2 py-1 text-xs" onClick={props.onClose}>
            关闭
          </button>
        </div>
        <div className="p-4">{props.children}</div>
      </div>
    </div>
  );
}

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

export default function SystemUsersClient() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [newU, setNewU] = useState({ username: "", displayName: "", email: "", password: "", totpMustEnroll: true, roleIds: [] as string[] });
  const [created, setCreated] = useState<null | { username: string; password: string }>(null);

  const [edit, setEdit] = useState<null | UserRow>(null);
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);

  async function load() {
    setErr(null);
    const u = new URL("/api/admin/system/users", window.location.origin);
    if (q.trim()) u.searchParams.set("q", q.trim());
    u.searchParams.set("page", "1");
    u.searchParams.set("pageSize", "200");
    const r = await fetch(u.toString().replace(window.location.origin, ""));
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr(r.status === 403 ? "无权限访问" : "加载失败");
      return;
    }
    setRows(j.users ?? []);
    setRoles(j.roles ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  async function doCreate() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/system/users", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({
          username: newU.username.trim(),
          displayName: newU.displayName.trim(),
          email: newU.email.trim(),
          password: newU.password.trim(),
          roleIds: newU.roleIds,
          totpMustEnroll: newU.totpMustEnroll,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(typeof j?.error === "string" ? String(j.error) : "创建失败");
        return;
      }
      setCreateOpen(false);
      setCreated({ username: newU.username.trim(), password: String(j.password ?? "") });
      setNewU({ username: "", displayName: "", email: "", password: "", totpMustEnroll: true, roleIds: [] });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveUserRoles() {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/system/users/${edit.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ roleIds: editRoleIds }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("保存失败");
        return;
      }
      setEdit(null);
      setEditRoleIds([]);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function del(u: UserRow) {
    if (!confirm(`确认删除平台用户：${u.username}（${u.displayName}）？`)) return;
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/system/users/${u.id}`, { method: "DELETE", headers: { ...h } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.error === "cannot_delete_self" ? "不能删除自己" : "删除失败");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 min-w-0">
      <div className="np-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">平台用户</div>
          <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => setCreateOpen(true)} disabled={busy}>
            新增平台用户
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input className="np-input w-full md:w-[360px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索 username / displayName / email" />
          <button className="np-btn px-3 py-2 text-sm" onClick={load} disabled={busy}>
            查询
          </button>
        </div>
        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
      </div>

      {/* Mobile: cards to avoid horizontal scrolling */}
      <div className="grid gap-2 lg:hidden">
        {rows.map((u) => {
          const roleNames = (u.roleIds ?? []).map((rid) => roleById.get(rid)?.name ?? rid);
          return (
            <div key={u.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-[var(--np-muted)] break-all">{u.username}</div>
                  <div className="mt-1 text-sm font-semibold truncate">{u.displayName}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--np-muted)]">
                    {roleNames.length ? roleNames.slice(0, 3).map((n) => <span key={n} className="np-pill">{n}</span>) : <span className="text-[var(--np-faint)]">未分配角色</span>}
                    {roleNames.length > 3 ? <span className="np-pill">+{roleNames.length - 3}</span> : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {u.totpEnabled ? <span className="np-pill np-pill-ok">2FA 已启用</span> : <span className="np-pill np-pill-off">2FA 未启用</span>}
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <button className="np-btn px-3 py-2 text-xs" onClick={() => { setEdit(u); setEditRoleIds(u.roleIds ?? []); }} disabled={busy}>
                      设置角色
                    </button>
                    <button className="np-btn px-3 py-2 text-xs" onClick={() => del(u)} disabled={busy}>
                      删除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {!rows.length ? <div className="text-sm text-[var(--np-muted)]">暂无平台用户</div> : null}
      </div>

      {/* Desktop: fixed table that fits viewport (no page-level horizontal scroll) */}
      <div className="hidden overflow-hidden rounded-xl border border-white/10 lg:block">
        <table className="w-full min-w-0 table-fixed text-left text-sm">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-4 py-3 w-[220px]">用户名</th>
              <th className="px-4 py-3 w-[220px]">显示名</th>
              <th className="px-4 py-3">角色</th>
              <th className="px-4 py-3 w-[140px]">2FA</th>
              <th className="px-4 py-3 w-[220px]">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const roleNames = (u.roleIds ?? []).map((rid) => roleById.get(rid)?.name ?? rid);
              return (
                <tr key={u.id} className="border-t border-white/10">
                  <td className="px-4 py-3 font-mono text-xs text-[var(--np-muted)]">
                    <div className="truncate">{u.username}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="truncate">{u.displayName}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--np-muted)]">
                    <div className="flex flex-wrap gap-2">
                      {roleNames.length ? roleNames.slice(0, 2).map((n) => <span key={n} className="np-pill">{n}</span>) : <span className="text-[var(--np-faint)]">未分配</span>}
                      {roleNames.length > 2 ? <span className="np-pill">+{roleNames.length - 2}</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {u.totpEnabled ? <span className="np-pill np-pill-ok">已启用</span> : <span className="np-pill np-pill-off">未启用</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button className="np-btn px-3 py-2 text-xs" onClick={() => { setEdit(u); setEditRoleIds(u.roleIds ?? []); }} disabled={busy}>
                        设置角色
                      </button>
                      <button className="np-btn px-3 py-2 text-xs" onClick={() => del(u)} disabled={busy}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td className="px-4 py-6 text-sm text-[var(--np-muted)]" colSpan={5}>
                  暂无平台用户
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {createOpen ? (
        <Modal title="新增平台用户" onClose={() => setCreateOpen(false)}>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">用户名</span>
                <input className="np-input font-mono" value={newU.username} onChange={(e) => setNewU((x) => ({ ...x, username: e.target.value }))} placeholder="例如：ops_01" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">显示名</span>
                <input className="np-input" value={newU.displayName} onChange={(e) => setNewU((x) => ({ ...x, displayName: e.target.value }))} placeholder="例如：运营01" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">Email（可选）</span>
                <input className="np-input font-mono" value={newU.email} onChange={(e) => setNewU((x) => ({ ...x, email: e.target.value }))} placeholder="xxx@example.com" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">初始密码（可选，不填随机生成强密码）</span>
                <input className="np-input font-mono" value={newU.password} onChange={(e) => setNewU((x) => ({ ...x, password: e.target.value }))} placeholder="留空则自动生成" />
              </label>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">角色</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {roles.map((r) => {
                  const on = newU.roleIds.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      className={["np-btn px-3 py-2 text-xs justify-start", on ? "np-btn-primary" : ""].join(" ")}
                      type="button"
                      onClick={() => {
                        setNewU((x) => {
                          const set = new Set(x.roleIds);
                          if (set.has(r.id)) set.delete(r.id);
                          else set.add(r.id);
                          return { ...x, roleIds: Array.from(set) };
                        });
                      }}
                    >
                      {r.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={newU.totpMustEnroll} onChange={(e) => setNewU((x) => ({ ...x, totpMustEnroll: e.target.checked }))} />
              <span>首次登录必须绑定 2FA</span>
            </label>

            <div className="flex items-center justify-end gap-2">
              <button className="np-btn px-3 py-2 text-sm" onClick={() => setCreateOpen(false)} disabled={busy}>
                取消
              </button>
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={doCreate} disabled={busy || !newU.username.trim() || !newU.displayName.trim()}>
                {busy ? "处理中..." : "创建"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {created ? (
        <Modal title="平台用户已创建" onClose={() => setCreated(null)}>
          <div className="grid gap-3">
            <div className="text-sm text-[var(--np-muted)]">初始账号信息如下（仅展示一次，请及时记录）。</div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">用户名</div>
              <div className="mt-1 font-mono text-sm text-[var(--np-text)] break-all">{created.username}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">初始密码</div>
              <div className="mt-1 font-mono text-sm text-[var(--np-text)] break-all">{created.password || "-"}</div>
            </div>
            <div className="flex items-center justify-end">
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => setCreated(null)}>
                我已记录
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {edit ? (
        <Modal title={`设置角色：${edit.username}`} onClose={() => setEdit(null)}>
          <div className="grid gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">用户</div>
              <div className="mt-1 font-mono text-sm text-[var(--np-text)]">{edit.username}</div>
              <div className="mt-1 text-sm text-[var(--np-muted)]">{edit.displayName}</div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">角色</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {roles.map((r) => {
                  const on = editRoleIds.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      className={["np-btn px-3 py-2 text-xs justify-start", on ? "np-btn-primary" : ""].join(" ")}
                      type="button"
                      onClick={() => {
                        setEditRoleIds((cur) => {
                          const set = new Set(cur);
                          if (set.has(r.id)) set.delete(r.id);
                          else set.add(r.id);
                          return Array.from(set);
                        });
                      }}
                    >
                      {r.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button className="np-btn px-3 py-2 text-sm" onClick={() => setEdit(null)} disabled={busy}>
                取消
              </button>
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={saveUserRoles} disabled={busy}>
                {busy ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
