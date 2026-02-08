"use client";

import { useEffect, useState } from "react";

type PersonRow = { id: string; name: string; username?: string | null; enabled: boolean };

export default function PersonalChannelSimulatorClient() {
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [token, setToken] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState<{ id: string; name: string; username?: string | null } | null>(null);
  const [syncInfo, setSyncInfo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [deviceCount, setDeviceCount] = useState(2);
  const [bankAccountCount, setBankAccountCount] = useState(1);
  const [txJson, setTxJson] = useState<string>(
    JSON.stringify(
      [
        { direction: "IN", amount: "100.00", ref: "SIM-IN-1", detailsJson: "{\"note\":\"demo\"}" },
        { direction: "OUT", amount: "20.00", ref: "SIM-OUT-1", detailsJson: "{\"note\":\"demo\"}" },
      ],
      null,
      2,
    ),
  );

  async function loadPersons() {
    setErr(null);
    const r = await fetch("/api/admin/payment-persons");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr(r.status === 403 ? "无权限访问" : "加载失败");
      return;
    }
    const list: PersonRow[] = (j.rows ?? []).map((p: any) => ({
      id: String(p.id),
      name: String(p.name),
      username: p.username ? String(p.username) : null,
      enabled: Boolean(p.enabled),
    }));
    setRows(list);
    if (!selected && list.length) {
      setSelected(list[0].id);
      setUsername(list[0].username ?? "");
    }
  }

  useEffect(() => {
    loadPersons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doLogin() {
    if (!username.trim() || !password) return;
    setBusy(true);
    setErr(null);
    setSyncInfo(null);
    try {
      const r = await fetch("/api/personal/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("登录失败（用户名/密码错误或账号未启用）");
        return;
      }
      setToken(String(j.token));
      setLoggedIn(j.person ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function doLogout() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/personal/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("登出失败");
        return;
      }
      setToken(null);
      setLoggedIn(null);
      setSyncInfo(null);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    if (!token || !loggedIn) return;
    setBusy(true);
    setErr(null);
    try {
      let txs: any[] | undefined = undefined;
      try {
        txs = JSON.parse(txJson);
        if (!Array.isArray(txs)) throw new Error("not_array");
      } catch {
        setErr("交易记录 JSON 格式不正确");
        return;
      }
      const r = await fetch("/api/personal/report/sync", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ deviceCount, appsPerDevice: 2, bankAccountCount, transactions: txs }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("上报失败");
        return;
      }
      setSyncInfo(j.synced ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="np-card p-4">
        <div className="text-xs text-[var(--np-faint)]">调试工具</div>
        <div className="mt-1 text-lg font-semibold tracking-tight">个人支付渠道</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs text-[var(--np-faint)]">账号</span>
            <select
              className="np-input"
              value={selected}
              onChange={(e) => {
                const id = e.target.value;
                setSelected(id);
                const p = rows.find((x) => x.id === id);
                setUsername(p?.username ?? "");
              }}
            >
              {rows.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.enabled}>
                  {(p.username ? p.username : p.name) + (p.enabled ? "" : " (禁用)")}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-[var(--np-faint)]">密码（真实登录）</span>
            <input className="np-input font-mono" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入该账号的密码" type="password" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {token ? (
            <button className="np-btn px-3 py-2 text-sm" onClick={doLogout} disabled={busy}>
              登出
            </button>
          ) : (
            <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={doLogin} disabled={busy || !username.trim() || !password}>
              {busy ? "处理中..." : "登录"}
            </button>
          )}
        </div>

        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}

        {loggedIn ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-[var(--np-faint)]">已登录</div>
                <div className="mt-1 truncate text-sm text-[var(--np-text)]">
                  {loggedIn.name}
                  {loggedIn.username ? <span className="ml-2 font-mono text-xs text-[var(--np-faint)]">({loggedIn.username})</span> : null}
                </div>
              </div>
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={sync} disabled={busy || !token}>
                上报模拟数据
              </button>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">手机台数</span>
                <input className="np-input font-mono" value={String(deviceCount)} onChange={(e) => setDeviceCount(Number(e.target.value || "2"))} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">网银账户数量</span>
                <input className="np-input font-mono" value={String(bankAccountCount)} onChange={(e) => setBankAccountCount(Number(e.target.value || "1"))} />
              </label>
            </div>
            <label className="mt-3 grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">自定义交易记录（JSON 数组）</span>
              <textarea className="np-input font-mono text-xs h-[160px]" value={txJson} onChange={(e) => setTxJson(e.target.value)} />
            </label>

            {syncInfo ? (
              <div className="mt-3 grid gap-2 text-xs text-[var(--np-muted)] md:grid-cols-5">
                <div className="rounded-lg border border-white/10 bg-white/5 p-2">手机 {syncInfo.devices ?? 0}</div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-2">App {syncInfo.apps ?? 0}</div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-2">安装 {syncInfo.installs ?? 0}</div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-2">网银 {syncInfo.accounts ?? 0}</div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-2">交易 {syncInfo.transactions ?? 0}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="np-card p-4">
        <div className="text-sm font-semibold">说明</div>
        <div className="mt-2 text-sm text-[var(--np-muted)]">
          该页面用于模拟“个人支付渠道”用户在手机 App 上的真实登录与数据上报：先用用户名/密码调用 `/api/personal/auth/login` 获取 token，
          再通过 `/api/personal/report/sync` 将手机/支付 App/网银账户/交易记录上报到服务端。
        </div>
      </div>
    </div>
  );
}
