"use client";

import { useEffect, useMemo, useState } from "react";

type Perm = { id: string; key: string; description?: string | null };
type RoleRow = { id: string; name: string; description?: string | null; createdAtMs: number; permissionKeys: string[] };

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

export default function SystemRolesClient() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const [editPerms, setEditPerms] = useState<null | { role: RoleRow; keys: Set<string>; q: string }>(null);
  const [renameRole, setRenameRole] = useState<null | { role: RoleRow; name: string; description: string }>(null);

  async function load() {
    setErr(null);
    const r = await fetch("/api/admin/system/roles");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr(r.status === 403 ? "无权限访问" : "加载失败");
      return;
    }
    setRoles(j.roles ?? []);
    setPerms(j.permissions ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  const permGroups = useMemo(() => {
    // Group by prefix: merchant.*, order.*, system.*, etc.
    const groups = new Map<string, Perm[]>();
    for (const p of perms) {
      const prefix = String(p.key).split(".")[0] ?? "other";
      const list = groups.get(prefix) ?? [];
      list.push(p);
      groups.set(prefix, list);
    }
    for (const list of groups.values()) list.sort((a, b) => a.key.localeCompare(b.key));
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [perms]);

  async function createRole() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/system/roles", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined, permissionKeys: [] }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("创建失败");
        return;
      }
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveRolePerms() {
    if (!editPerms) return;
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/system/roles/${editPerms.role.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ permissionKeys: Array.from(editPerms.keys).sort() }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.error === "role_in_use" ? "角色正在使用中，不能操作" : "保存失败");
        return;
      }
      setEditPerms(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveRename() {
    if (!renameRole) return;
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/system/roles/${renameRole.role.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ name: renameRole.name.trim(), description: renameRole.description.trim() || "" }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("保存失败");
        return;
      }
      setRenameRole(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function delRole(role: RoleRow) {
    if (!confirm(`确认删除角色：${role.name}？（角色正在被用户使用时将禁止删除）`)) return;
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/system/roles/${role.id}`, { method: "DELETE", headers: { ...h } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        if (j?.error === "role_in_use") setErr("角色正在被用户使用，不能删除");
        else setErr("删除失败");
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">角色权限</div>
          <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => setCreateOpen(true)} disabled={busy}>
            新增角色
          </button>
        </div>
        <div className="mt-2 text-xs text-[var(--np-faint)]">需要 `system.read/system.write` 权限。</div>
        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
      </div>

      <div className="np-card p-0 overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
              <tr>
                <th className="px-4 py-3 w-[160px]">角色</th>
                <th className="px-4 py-3">描述</th>
                <th className="px-4 py-3 w-[110px]">权限数</th>
                <th className="px-4 py-3 w-[260px]">操作</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id} className="border-t border-white/10">
                  <td className="px-4 py-3 font-semibold">{r.name}</td>
                  <td className="px-4 py-3 text-[var(--np-muted)]">{r.description ?? "-"}</td>
                  <td className="px-4 py-3 font-mono">{String(r.permissionKeys?.length ?? 0)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button className="np-btn px-3 py-2 text-xs" onClick={() => setEditPerms({ role: r, keys: new Set(r.permissionKeys ?? []), q: "" })} disabled={busy}>
                        设置权限
                      </button>
                      <button className="np-btn px-3 py-2 text-xs" onClick={() => setRenameRole({ role: r, name: r.name, description: r.description ?? "" })} disabled={busy}>
                        编辑
                      </button>
                      <button className="np-btn px-3 py-2 text-xs" onClick={() => delRole(r)} disabled={busy}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!roles.length ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-[var(--np-muted)]" colSpan={4}>
                    暂无角色
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen ? (
        <Modal title="新增角色" onClose={() => setCreateOpen(false)}>
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">角色名</span>
              <input className="np-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如：审核" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">描述（可选）</span>
              <input className="np-input" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="例如：仅代付审核" />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button className="np-btn px-3 py-2 text-sm" onClick={() => setCreateOpen(false)} disabled={busy}>
                取消
              </button>
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={createRole} disabled={busy || !newName.trim()}>
                {busy ? "处理中..." : "创建"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {renameRole ? (
        <Modal title={`编辑角色：${renameRole.role.name}`} onClose={() => setRenameRole(null)}>
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">角色名</span>
              <input className="np-input" value={renameRole.name} onChange={(e) => setRenameRole((x) => (x ? { ...x, name: e.target.value } : x))} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">描述</span>
              <input className="np-input" value={renameRole.description} onChange={(e) => setRenameRole((x) => (x ? { ...x, description: e.target.value } : x))} />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button className="np-btn px-3 py-2 text-sm" onClick={() => setRenameRole(null)} disabled={busy}>
                取消
              </button>
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={saveRename} disabled={busy || !renameRole.name.trim()}>
                {busy ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {editPerms ? (
        <Modal title={`设置权限：${editPerms.role.name}`} onClose={() => setEditPerms(null)}>
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <input
                className="np-input w-full md:w-[420px]"
                value={editPerms.q}
                onChange={(e) => setEditPerms((x) => (x ? { ...x, q: e.target.value } : x))}
                placeholder="搜索权限 key/描述…"
              />
              <div className="text-xs text-[var(--np-faint)]">
                已选 <span className="font-mono">{String(editPerms.keys.size)}</span>
              </div>
            </div>

            <div className="max-h-[55vh] overflow-auto rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="grid gap-4">
                {permGroups.map(([prefix, list]) => {
                  const filtered = list.filter((p) => {
                    const q = editPerms.q.trim().toLowerCase();
                    if (!q) return true;
                    return p.key.toLowerCase().includes(q) || String(p.description ?? "").toLowerCase().includes(q);
                  });
                  if (!filtered.length) return null;
                  return (
                    <div key={prefix}>
                      <div className="text-xs font-semibold text-[var(--np-text)]">{prefix}</div>
                      <div className="mt-2 grid gap-2">
                        {filtered.map((p) => {
                          const on = editPerms.keys.has(p.key);
                          return (
                            <label key={p.id} className="flex items-start gap-2 rounded-lg border border-white/10 bg-[var(--np-surface)] p-2">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={(e) => {
                                  const next = new Set(editPerms.keys);
                                  if (e.target.checked) next.add(p.key);
                                  else next.delete(p.key);
                                  setEditPerms((x) => (x ? { ...x, keys: next } : x));
                                }}
                              />
                              <div className="min-w-0">
                                <div className="font-mono text-xs break-all">{p.key}</div>
                                <div className="mt-1 text-xs text-[var(--np-muted)]">{p.description ?? "-"}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button className="np-btn px-3 py-2 text-sm" onClick={() => setEditPerms(null)} disabled={busy}>
                取消
              </button>
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={saveRolePerms} disabled={busy}>
                {busy ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

