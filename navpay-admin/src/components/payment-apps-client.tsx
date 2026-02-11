"use client";

import { useEffect, useMemo, useState } from "react";

type PaymentApp = {
  id: string;
  name: string;
  packageName: string;
  versionCode: number;
  downloadUrl: string;
  iconUrl?: string | null;
  minSupportedVersionCode: number;
  payoutEnabled: boolean;
  collectEnabled: boolean;
  promoted: boolean;
  enabled: boolean;
  createdAtMs: number;
};

function Modal(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="fixed inset-0 bg-black/60" aria-label="close" onClick={props.onClose} />
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[var(--np-surface)] shadow-xl">
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

function boolLabel(v: boolean): string {
  return v ? "已启用" : "已停用";
}

export default function PaymentAppsClient() {
  const [rows, setRows] = useState<PaymentApp[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<null | PaymentApp>(null);

  const formInit = useMemo(
    () => ({
      name: "",
      packageName: "",
      versionCode: "1",
      downloadUrl: "",
      iconUrl: "",
      minSupportedVersionCode: "0",
      payoutEnabled: true,
      collectEnabled: true,
      promoted: false,
      enabled: true,
    }),
    [],
  );

  const [f, setF] = useState(formInit);

  function openCreate() {
    setF(formInit);
    setCreateOpen(true);
  }

  function openEdit(row: PaymentApp) {
    setF({
      name: row.name,
      packageName: row.packageName,
      versionCode: String(row.versionCode),
      downloadUrl: row.downloadUrl,
      iconUrl: row.iconUrl ?? "",
      minSupportedVersionCode: String(row.minSupportedVersionCode ?? 0),
      payoutEnabled: !!row.payoutEnabled,
      collectEnabled: !!row.collectEnabled,
      promoted: !!row.promoted,
      enabled: !!row.enabled,
    });
    setEdit(row);
  }

  async function load() {
    setErr(null);
    const r = await fetch("/api/admin/payment-apps");
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

  async function save(kind: "create" | "edit") {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const payload = {
        name: f.name.trim(),
        packageName: f.packageName.trim(),
        versionCode: f.versionCode,
        downloadUrl: f.downloadUrl.trim(),
        iconUrl: f.iconUrl.trim(),
        minSupportedVersionCode: f.minSupportedVersionCode,
        payoutEnabled: f.payoutEnabled,
        collectEnabled: f.collectEnabled,
        promoted: f.promoted,
        enabled: f.enabled,
      };

      const url = kind === "create" ? "/api/admin/payment-apps" : `/api/admin/payment-apps/${edit!.id}`;
      const method = kind === "create" ? "POST" : "PATCH";
      const r = await fetch(url, { method, headers: { "content-type": "application/json", ...h }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.error === "duplicate" ? "包名已存在" : "保存失败");
        return;
      }
      setCreateOpen(false);
      setEdit(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function del(row: PaymentApp) {
    if (!confirm(`确认删除支付APP：${row.name}（${row.packageName}）？`)) return;
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/payment-apps/${row.id}`, { method: "DELETE", headers: { ...h } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("删除失败");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: PaymentApp, key: "payoutEnabled" | "collectEnabled" | "enabled", next: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/payment-apps/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ [key]: next }),
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
    <div className="np-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">支付APP管理</div>
        <div className="flex items-center gap-2">
          <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={openCreate} disabled={busy}>
            新增支付APP
          </button>
        </div>
      </div>

      {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}

      {/* Mobile */}
      <div className="mt-3 grid gap-2 lg:hidden">
        {rows.map((a) => (
          <div key={a.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {a.iconUrl ? <img alt="icon" src={a.iconUrl} className="h-8 w-8 rounded-lg border border-white/10 object-cover" /> : <div className="h-8 w-8 rounded-lg border border-white/10 bg-white/10" />}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{a.name}</div>
                    <div className="mt-1 font-mono text-[11px] text-[var(--np-muted)] break-all">{a.packageName}</div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--np-muted)]">
                  <div>
                    <div className="text-[var(--np-faint)]">版本号</div>
                    <div className="mt-1 font-mono text-sm text-[var(--np-text)]">{String(a.versionCode)}</div>
                  </div>
                  <div>
                    <div className="text-[var(--np-faint)]">最小支持版本</div>
                    <div className="mt-1 font-mono text-sm text-[var(--np-text)]">{String(a.minSupportedVersionCode ?? 0)}</div>
                  </div>
                </div>
              </div>

              <div className="shrink-0 flex flex-col items-end gap-2">
                <button className={["np-btn px-3 py-2 text-xs", a.enabled ? "np-btn-primary" : ""].join(" ")} onClick={() => toggle(a, "enabled", !a.enabled)} disabled={busy}>
                  {boolLabel(!!a.enabled)}
                </button>
                <div className="flex gap-2">
                  <button className={["np-btn px-2 py-1 text-xs", a.payoutEnabled ? "np-btn-primary" : ""].join(" ")} onClick={() => toggle(a, "payoutEnabled", !a.payoutEnabled)} disabled={busy}>
                    代付
                  </button>
                  <button className={["np-btn px-2 py-1 text-xs", a.collectEnabled ? "np-btn-primary" : ""].join(" ")} onClick={() => toggle(a, "collectEnabled", !a.collectEnabled)} disabled={busy}>
                    代收
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <a className="np-btn px-3 py-2 text-xs" href={a.downloadUrl} target="_blank" rel="noreferrer">
                下载地址
              </a>
              <div className="flex gap-2">
                <button className="np-btn px-3 py-2 text-xs" onClick={() => openEdit(a)} disabled={busy}>
                  编辑
                </button>
                <button className="np-btn px-3 py-2 text-xs" onClick={() => del(a)} disabled={busy}>
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
        {!rows.length ? <div className="text-sm text-[var(--np-muted)]">暂无支付APP</div> : null}
      </div>

      {/* Desktop */}
      <div className="mt-3 hidden overflow-hidden rounded-xl border border-white/10 lg:block">
        <table className="w-full min-w-0 text-left text-sm table-fixed">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-3 py-2 w-[60px]">ID</th>
              <th className="px-3 py-2 w-[70px]">图标</th>
              <th className="px-3 py-2 w-[180px]">名称</th>
              <th className="px-3 py-2">包名</th>
              <th className="px-3 py-2 w-[80px]">版本</th>
              <th className="px-3 py-2 w-[120px]">最小支持</th>
              <th className="px-3 py-2 w-[90px]">启用</th>
              <th className="px-3 py-2 w-[90px]">启用代付</th>
              <th className="px-3 py-2 w-[90px]">启用代收</th>
              <th className="px-3 py-2 w-[160px]">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-white/10">
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{a.id.slice(-6)}</td>
                <td className="px-3 py-2">
                  {a.iconUrl ? <img alt="icon" src={a.iconUrl} className="h-8 w-8 rounded-lg border border-white/10 object-cover" /> : <div className="h-8 w-8 rounded-lg border border-white/10 bg-white/10" />}
                </td>
                <td className="px-3 py-2">
                  <div className="truncate font-semibold">{a.name}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)] break-all">{a.packageName}</td>
                <td className="px-3 py-2 font-mono">{String(a.versionCode)}</td>
                <td className="px-3 py-2 font-mono">{String(a.minSupportedVersionCode ?? 0)}</td>
                <td className="px-3 py-2">
                  <button className={["np-btn px-3 py-2 text-xs", a.enabled ? "np-btn-primary" : ""].join(" ")} onClick={() => toggle(a, "enabled", !a.enabled)} disabled={busy}>
                    {a.enabled ? "启用" : "停用"}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button className={["np-btn px-3 py-2 text-xs", a.payoutEnabled ? "np-btn-primary" : ""].join(" ")} onClick={() => toggle(a, "payoutEnabled", !a.payoutEnabled)} disabled={busy}>
                    {a.payoutEnabled ? "开启" : "关闭"}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button className={["np-btn px-3 py-2 text-xs", a.collectEnabled ? "np-btn-primary" : ""].join(" ")} onClick={() => toggle(a, "collectEnabled", !a.collectEnabled)} disabled={busy}>
                    {a.collectEnabled ? "开启" : "关闭"}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <a className="np-btn px-3 py-2 text-xs" href={a.downloadUrl} target="_blank" rel="noreferrer">
                      下载
                    </a>
                    <button className="np-btn px-3 py-2 text-xs" onClick={() => openEdit(a)} disabled={busy}>
                      编辑
                    </button>
                    <button className="np-btn px-3 py-2 text-xs" onClick={() => del(a)} disabled={busy}>
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={10}>
                  暂无支付APP
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {createOpen ? (
        <Modal title="新增支付APP" onClose={() => setCreateOpen(false)}>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">APP 名称</span>
                <input className="np-input" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} placeholder="例如: phonepe" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">APP 包名</span>
                <input className="np-input font-mono" value={f.packageName} onChange={(e) => setF((x) => ({ ...x, packageName: e.target.value }))} placeholder="例如: com.phonepe.app" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">版本号（versionCode）</span>
                <input className="np-input font-mono" value={f.versionCode} onChange={(e) => setF((x) => ({ ...x, versionCode: e.target.value }))} placeholder="例如: 38" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">最小支持版本（versionCode）</span>
                <input className="np-input font-mono" value={f.minSupportedVersionCode} onChange={(e) => setF((x) => ({ ...x, minSupportedVersionCode: e.target.value }))} placeholder="例如: 349" />
              </label>
            </div>

            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">下载地址</span>
              <input className="np-input font-mono" value={f.downloadUrl} onChange={(e) => setF((x) => ({ ...x, downloadUrl: e.target.value }))} placeholder="https://..." />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">图标 URL（可选）</span>
              <input className="np-input font-mono" value={f.iconUrl} onChange={(e) => setF((x) => ({ ...x, iconUrl: e.target.value }))} placeholder="https://.../icon.png" />
            </label>

            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-[var(--np-faint)]">开关</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className={["np-btn px-3 py-2 text-xs", f.enabled ? "np-btn-primary" : ""].join(" ")} onClick={() => setF((x) => ({ ...x, enabled: !x.enabled }))} type="button">
                    {f.enabled ? "启用" : "停用"}
                  </button>
                  <button className={["np-btn px-3 py-2 text-xs", f.payoutEnabled ? "np-btn-primary" : ""].join(" ")} onClick={() => setF((x) => ({ ...x, payoutEnabled: !x.payoutEnabled }))} type="button">
                    {`代付：${f.payoutEnabled ? "开启" : "关闭"}`}
                  </button>
                  <button className={["np-btn px-3 py-2 text-xs", f.collectEnabled ? "np-btn-primary" : ""].join(" ")} onClick={() => setF((x) => ({ ...x, collectEnabled: !x.collectEnabled }))} type="button">
                    {`代收：${f.collectEnabled ? "开启" : "关闭"}`}
                  </button>
                  <button className={["np-btn px-3 py-2 text-xs", f.promoted ? "np-btn-primary" : ""].join(" ")} onClick={() => setF((x) => ({ ...x, promoted: !x.promoted }))} type="button">
                    {`推荐：${f.promoted ? "是" : "否"}`}
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-[var(--np-muted)]">
                <div>说明：</div>
                <div className="mt-1">- “启用”控制是否对外可用/可分配。</div>
                <div className="mt-1">- “代收/代付”用于单独控制该 App 的业务通道开关。</div>
                <div className="mt-1">- “最小支持版本”用于校验客户端上报的 App 版本是否满足要求。</div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button className="np-btn px-3 py-2 text-sm" onClick={() => setCreateOpen(false)} disabled={busy}>
                取消
              </button>
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => save("create")} disabled={busy || !f.name.trim() || !f.packageName.trim() || !f.downloadUrl.trim()}>
                {busy ? "处理中..." : "创建"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {edit ? (
        <Modal title={`编辑支付APP：${edit.name}`} onClose={() => setEdit(null)}>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">APP 名称</span>
                <input className="np-input" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">APP 包名</span>
                <input className="np-input font-mono" value={f.packageName} onChange={(e) => setF((x) => ({ ...x, packageName: e.target.value }))} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">版本号（versionCode）</span>
                <input className="np-input font-mono" value={f.versionCode} onChange={(e) => setF((x) => ({ ...x, versionCode: e.target.value }))} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">最小支持版本（versionCode）</span>
                <input className="np-input font-mono" value={f.minSupportedVersionCode} onChange={(e) => setF((x) => ({ ...x, minSupportedVersionCode: e.target.value }))} />
              </label>
            </div>

            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">下载地址</span>
              <input className="np-input font-mono" value={f.downloadUrl} onChange={(e) => setF((x) => ({ ...x, downloadUrl: e.target.value }))} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">图标 URL（可选）</span>
              <input className="np-input font-mono" value={f.iconUrl} onChange={(e) => setF((x) => ({ ...x, iconUrl: e.target.value }))} />
            </label>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">开关</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className={["np-btn px-3 py-2 text-xs", f.enabled ? "np-btn-primary" : ""].join(" ")} onClick={() => setF((x) => ({ ...x, enabled: !x.enabled }))} type="button">
                  {f.enabled ? "启用" : "停用"}
                </button>
                <button className={["np-btn px-3 py-2 text-xs", f.payoutEnabled ? "np-btn-primary" : ""].join(" ")} onClick={() => setF((x) => ({ ...x, payoutEnabled: !x.payoutEnabled }))} type="button">
                  {`代付：${f.payoutEnabled ? "开启" : "关闭"}`}
                </button>
                <button className={["np-btn px-3 py-2 text-xs", f.collectEnabled ? "np-btn-primary" : ""].join(" ")} onClick={() => setF((x) => ({ ...x, collectEnabled: !x.collectEnabled }))} type="button">
                  {`代收：${f.collectEnabled ? "开启" : "关闭"}`}
                </button>
                <button className={["np-btn px-3 py-2 text-xs", f.promoted ? "np-btn-primary" : ""].join(" ")} onClick={() => setF((x) => ({ ...x, promoted: !x.promoted }))} type="button">
                  {`推荐：${f.promoted ? "是" : "否"}`}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button className="np-btn px-3 py-2 text-sm" onClick={() => setEdit(null)} disabled={busy}>
                取消
              </button>
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => save("edit")} disabled={busy || !f.name.trim() || !f.packageName.trim() || !f.downloadUrl.trim()}>
                {busy ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

