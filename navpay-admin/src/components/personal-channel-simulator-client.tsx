"use client";

import { useEffect, useState } from "react";

type PersonRow = { id: string; name: string; username?: string | null; enabled: boolean };
type Me = { personId: string; name: string; username?: string | null; balance?: string | null };

type DebugSession = {
  sessionId: string;
  personId: string;
  username: string;
  name: string;
  token: string;
  createdAtMs: number;
  lastUsedAtMs: number;
};

type AvailPayout = {
  id: string;
  merchantOrderNo: string;
  amount: string;
  status: string;
  beneficiaryName: string;
  accountNo: string;
  ifsc: string;
  createdAtMs: number;
};

type LockedPayout = AvailPayout & { lockedAtMs?: number | null; lockExpiresAtMs?: number | null };

function fmtCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

const SESS_KEY = "np_debug_personal_sessions_v1";
const ACTIVE_SESS_KEY = "np_debug_personal_active_session_v1";

function loadSessionsFromStorage(): DebugSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SESS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x: any) => ({
        sessionId: String(x.sessionId ?? ""),
        personId: String(x.personId ?? ""),
        username: String(x.username ?? ""),
        name: String(x.name ?? ""),
        token: String(x.token ?? ""),
        createdAtMs: Number(x.createdAtMs ?? Date.now()),
        lastUsedAtMs: Number(x.lastUsedAtMs ?? Date.now()),
      }))
      .filter((s) => s.sessionId && s.personId && s.username && s.token);
  } catch {
    return [];
  }
}

function saveSessionsToStorage(sessions: DebugSession[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESS_KEY, JSON.stringify(sessions.slice(0, 20)));
  } catch {
    // ignore
  }
}

function loadActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(ACTIVE_SESS_KEY);
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

function saveActiveSessionId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (!id) window.localStorage.removeItem(ACTIVE_SESS_KEY);
    else window.localStorage.setItem(ACTIVE_SESS_KEY, id);
  } catch {
    // ignore
  }
}

export default function PersonalChannelSimulatorClient() {
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [token, setToken] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState<{ id: string; name: string; username?: string | null } | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [syncInfo, setSyncInfo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sessions, setSessions] = useState<DebugSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [tab, setTab] = useState<"report" | "payout">("payout");
  const [nowMs, setNowMs] = useState(() => Date.now());

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

  const [availPage, setAvailPage] = useState(1);
  const [availTotal, setAvailTotal] = useState(0);
  const [availRows, setAvailRows] = useState<AvailPayout[]>([]);

  const [minePage, setMinePage] = useState(1);
  const [mineTotal, setMineTotal] = useState(0);
  const [mineRows, setMineRows] = useState<LockedPayout[]>([]);

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

  function persistSessions(next: DebugSession[]) {
    // Sort newest used first for convenience.
    const sorted = [...next].sort((a, b) => (b.lastUsedAtMs ?? 0) - (a.lastUsedAtMs ?? 0));
    setSessions(sorted);
    saveSessionsToStorage(sorted);
  }

  async function activateSession(sess: DebugSession | null) {
    if (!sess) {
      setActiveSessionId(null);
      saveActiveSessionId(null);
      setToken(null);
      setLoggedIn(null);
      setMe(null);
      setAvailRows([]);
      setAvailTotal(0);
      setMineRows([]);
      setMineTotal(0);
      return;
    }
    setActiveSessionId(sess.sessionId);
    saveActiveSessionId(sess.sessionId);
    setToken(sess.token);
    setLoggedIn({ id: sess.personId, name: sess.name, username: sess.username });
    await loadMe(sess.token);
    await loadAvailablePayouts(sess.token, 1);
    await loadMinePayouts(sess.token, 1);
    setAvailPage(1);
    setMinePage(1);
  }

  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [token]);

  useEffect(() => {
    loadPersons();
    // Restore sessions across refreshes.
    const restored = loadSessionsFromStorage();
    setSessions(restored);
    const activeId = loadActiveSessionId();
    const picked =
      (activeId ? restored.find((s) => s.sessionId === activeId) : null) ??
      (restored.length ? restored.slice().sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs)[0] : null);
    if (picked) {
      // Best-effort auto-restore without showing "loading" states everywhere.
      activateSession(picked);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMe(t: string) {
    const r = await fetch("/api/personal/me", { headers: { authorization: `Bearer ${t}` } });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.ok) setMe(j.me ?? null);
  }

  async function loadAvailablePayouts(t: string, page = availPage) {
    const sp = new URLSearchParams({ page: String(page), pageSize: "10" });
    const r = await fetch(`/api/personal/payout/orders/available?${sp.toString()}`, { headers: { authorization: `Bearer ${t}` } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return;
    setAvailRows((j.rows ?? []) as any);
    setAvailTotal(Number(j.total ?? 0));
  }

  async function loadMinePayouts(t: string, page = minePage) {
    const sp = new URLSearchParams({ page: String(page), pageSize: "10" });
    const r = await fetch(`/api/personal/payout/orders/mine?${sp.toString()}`, { headers: { authorization: `Bearer ${t}` } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return;
    setMineRows((j.rows ?? []) as any);
    setMineTotal(Number(j.total ?? 0));
  }

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
        setErr(j?.error === "disabled" ? "登录失败：账号已禁用" : "登录失败（用户名/密码错误）");
        return;
      }
      const t = String(j.token);
      const p = j.person ?? null;
      const personId = String(p?.id ?? "");
      const uname = String(p?.username ?? username.trim());
      const nm = String(p?.name ?? uname);
      const sid = `ps_${personId || uname}`;
      const now = Date.now();
      const next: DebugSession[] = [
        // replace if same sessionId
        ...sessions.filter((s) => s.sessionId !== sid),
        { sessionId: sid, personId: personId || sid, username: uname, name: nm, token: t, createdAtMs: now, lastUsedAtMs: now },
      ];
      persistSessions(next);
      await activateSession(next.find((s) => s.sessionId === sid) ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function doLogout(opts?: { keepLocal?: boolean }) {
    if (!token || !activeSessionId) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/personal/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) setErr("登出失败");
      if (!opts?.keepLocal) {
        const next = sessions.filter((s) => s.sessionId !== activeSessionId);
        persistSessions(next);
        await activateSession(next.length ? next[0] : null);
      }
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
        setErr(j?.error ? `上报失败：${j.error}` : "上报失败");
        return;
      }
      setSyncInfo(j.synced ?? null);
      await loadMe(token);
    } finally {
      setBusy(false);
    }
  }

  async function claim(orderId: string) {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/personal/payout/orders/${orderId}/claim`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.error ? `抢单失败：${j.error}` : "抢单失败");
        return;
      }
      await loadAvailablePayouts(token, availPage);
      await loadMinePayouts(token, minePage);
    } finally {
      setBusy(false);
    }
  }

  async function complete(orderId: string, result: "SUCCESS" | "FAILED") {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/personal/payout/orders/${orderId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ result }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.error ? `操作失败：${j.error}` : "操作失败");
        return;
      }
      await loadMe(token);
      await loadAvailablePayouts(token, availPage);
      await loadMinePayouts(token, minePage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="np-card p-4">
        <div className="text-xs text-[var(--np-faint)]">调试工具</div>
        <div className="mt-1 text-lg font-semibold tracking-tight">个人支付渠道</div>
        {sessions.length ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-[var(--np-faint)]">已登录会话（刷新后会保留）</div>
              <button
                className="np-btn px-3 py-2 text-xs"
                onClick={async () => {
                  if (!token || !activeSessionId) return;
                  setBusy(true);
                  setErr(null);
                  try {
                    await loadMe(token);
                    await loadAvailablePayouts(token, availPage);
                    await loadMinePayouts(token, minePage);
                    const now = Date.now();
                    persistSessions(
                      sessions.map((s) => (s.sessionId === activeSessionId ? { ...s, lastUsedAtMs: now } : s)),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy || !token}
              >
                刷新数据
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {sessions.map((s) => {
                const on = s.sessionId === activeSessionId;
                return (
                  <div key={s.sessionId} className={["flex items-center gap-1 rounded-xl border px-2 py-1", on ? "border-white/20 bg-white/10" : "border-white/10 bg-white/5"].join(" ")}>
                    <button
                      className={["text-xs font-mono", on ? "text-[var(--np-text)]" : "text-[var(--np-muted)]"].join(" ")}
                      onClick={async () => {
                        setBusy(true);
                        setErr(null);
                        try {
                          const now = Date.now();
                          persistSessions(sessions.map((x) => (x.sessionId === s.sessionId ? { ...x, lastUsedAtMs: now } : x)));
                          await activateSession({ ...s, lastUsedAtMs: now });
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy}
                      title={s.name}
                    >
                      {s.username}
                    </button>
                    <button
                      className="np-btn px-2 py-1 text-[11px]"
                      onClick={async () => {
                        // Remove from local immediately; best-effort remote logout only if it's the active session.
                        const next = sessions.filter((x) => x.sessionId !== s.sessionId);
                        persistSessions(next);
                        if (s.sessionId === activeSessionId) {
                          await doLogout({ keepLocal: true });
                          await activateSession(next.length ? next[0] : null);
                        }
                      }}
                      disabled={busy}
                      aria-label="remove-session"
                    >
                      移除
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-xs text-[var(--np-faint)]">
              提示：你可以打开多个浏览器标签页，分别选择不同会话，实现“同时调试”多个用户。
            </div>
          </div>
        ) : null}
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
            <button className="np-btn px-3 py-2 text-sm" onClick={() => void doLogout()} disabled={busy}>
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
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {[
                ["payout", "代付抢单"],
                ["report", "上报数据"],
              ].map(([k, label]) => {
                const on = tab === (k as any);
                return (
                  <button key={k} className={["np-btn px-3 py-2 text-sm", on ? "np-btn-primary" : ""].join(" ")} onClick={() => setTab(k as any)}>
                    {label}
                  </button>
                );
              })}
              <div className="ml-auto flex items-center gap-2">
                <div className="text-xs text-[var(--np-faint)]">
                  余额 <span className="ml-1 font-mono text-sm text-[var(--np-text)]">{me?.balance ?? "-"}</span>
                </div>
              </div>
            </div>

            {tab === "report" ? (
              <div className="mt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-[var(--np-faint)]">模拟设备/网银/交易记录上报</div>
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

            {tab === "payout" ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">可抢代付订单</div>
                    <button
                      className="np-btn px-3 py-2 text-xs"
                      onClick={async () => {
                        if (!token) return;
                        setBusy(true);
                        setErr(null);
                        try {
                          await loadAvailablePayouts(token, availPage);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy}
                    >
                      刷新
                    </button>
                  </div>

                  <div className="mt-2 grid gap-2">
                    {availRows.map((o) => (
                      <div key={o.id} className="rounded-xl border border-white/10 bg-[var(--np-surface)] p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-mono text-xs text-[var(--np-muted)] break-all">{o.id}</div>
                            <div className="mt-1 font-mono text-sm text-[var(--np-text)] break-all">{o.merchantOrderNo}</div>
                            <div className="mt-1 text-xs text-[var(--np-faint)] truncate">
                              {o.beneficiaryName} · ****{String(o.accountNo).slice(-4)} · {o.ifsc}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-lg text-[var(--np-text)]">{o.amount}</div>
                            <button className="mt-2 np-btn np-btn-primary px-3 py-2 text-xs" onClick={() => claim(o.id)} disabled={busy}>
                              抢单
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {!availRows.length ? <div className="text-sm text-[var(--np-muted)]">暂无可抢订单（需要管理员先将订单审核为 APPROVED）</div> : null}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">我锁定的订单</div>
                    <button
                      className="np-btn px-3 py-2 text-xs"
                      onClick={async () => {
                        if (!token) return;
                        setBusy(true);
                        setErr(null);
                        try {
                          await loadMinePayouts(token, minePage);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy}
                    >
                      刷新
                    </button>
                  </div>

                  <div className="mt-2 grid gap-2">
                    {mineRows.map((o) => {
                      const expires = Number(o.lockExpiresAtMs ?? 0);
                      const left = expires ? Math.max(0, expires - nowMs) : 0;
                      return (
                        <div key={o.id} className="rounded-xl border border-white/10 bg-[var(--np-surface)] p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-mono text-xs text-[var(--np-muted)] break-all">{o.id}</div>
                              <div className="mt-1 font-mono text-sm text-[var(--np-text)] break-all">{o.merchantOrderNo}</div>
                              <div className="mt-1 text-xs text-[var(--np-faint)] truncate">
                                {o.beneficiaryName} · ****{String(o.accountNo).slice(-4)} · {o.ifsc}
                              </div>
                              {expires ? (
                                <div className="mt-2 text-xs text-[var(--np-faint)]">
                                  倒计时 <span className="ml-1 font-mono text-sm text-[var(--np-text)]">{fmtCountdown(left)}</span>
                                </div>
                              ) : null}
                            </div>
                            <div className="text-right">
                              <div className="font-mono text-lg text-[var(--np-text)]">{o.amount}</div>
                              <div className="mt-2 flex flex-col gap-2">
                                <button className="np-btn np-btn-primary px-3 py-2 text-xs" onClick={() => complete(o.id, "SUCCESS")} disabled={busy}>
                                  模拟成功
                                </button>
                                <button className="np-btn px-3 py-2 text-xs" onClick={() => complete(o.id, "FAILED")} disabled={busy}>
                                  模拟失败
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {!mineRows.length ? <div className="text-sm text-[var(--np-muted)]">暂无锁定订单</div> : null}
                  </div>
                </div>
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
        <div className="mt-2 text-sm text-[var(--np-muted)]">
          同时提供代付抢单模拟：通过 `/api/personal/payout/orders/available` 获取可抢订单，调用 `/api/personal/payout/orders/:id/claim` 抢单并锁定，
          然后通过 `/api/personal/payout/orders/:id/complete` 模拟成功/失败，成功会触发余额入账与回调通知。
        </div>
      </div>
    </div>
  );
}
