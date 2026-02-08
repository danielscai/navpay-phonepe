"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";

type Account = {
  username: string;
  displayName: string;
  email?: string | null;
  totpEnabled: boolean;
  totpMustEnroll: boolean;
  passwordUpdatedAtMs: number;
};

type Passkey = {
  id: string;
  deviceName?: string | null;
  createdAtMs: number;
  lastUsedAtMs?: number | null;
  revokedAtMs?: number | null;
};

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

export default function AccountClient() {
  const router = useRouter();
  const [acct, setAcct] = useState<Account | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");

  const [passkeyName, setPasskeyName] = useState("");

  const fmt = (ms: number) => new Date(ms).toLocaleString("zh-CN", { hour12: false });

  async function load() {
    setErr(null);
    const r = await fetch("/api/admin/account");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载失败");
      return;
    }
    setAcct(j.account as Account);
    setDisplayName(String(j.account?.displayName ?? ""));

    const r2 = await fetch("/api/admin/account/passkeys");
    const j2 = await r2.json().catch(() => null);
    if (r2.ok && j2?.ok) setPasskeys((j2.passkeys ?? []) as Passkey[]);
  }

  useEffect(() => {
    load();
  }, []);

  async function saveProfile() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/account", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ displayName }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("保存失败");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/account/password", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        const reason = j?.error === "bad_old_password" ? "原密码错误" : j?.message ? String(j.message) : "修改失败";
        setErr(reason);
        return;
      }
      setOldPw("");
      setNewPw("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function reset2fa() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/account/2fa/reset", { method: "POST", headers: { ...h } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("重置失败");
        return;
      }
      router.push("/auth/2fa/enroll");
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/webauthn/registration/options", { method: "POST", headers: { ...h } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        if (j?.error === "db_not_migrated") {
          setErr("无法开始 Passkey 绑定：数据库未迁移。请在服务端执行 `yarn db:migrate` 后重试。");
        } else {
          const extra = j?.error ? `（${String(j.error)}）` : `（HTTP ${r.status}）`;
          setErr(`无法开始 Passkey 绑定${extra}`);
        }
        return;
      }
      const credential = await startRegistration(j.options);
      const r2 = await fetch("/api/webauthn/registration/verify", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ credential, deviceName: passkeyName.trim() || undefined }),
      });
      const j2 = await r2.json().catch(() => null);
      if (!r2.ok || !j2?.ok) {
        const extra = j2?.error ? `（${String(j2.error)}）` : `（HTTP ${r2.status}）`;
        setErr(`Passkey 绑定失败，请重试${extra}`);
        return;
      }
      setPasskeyName("");
      await load();
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "Passkey 绑定失败";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  async function revokePasskey(passkeyId: string) {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/account/passkeys/${passkeyId}`, { method: "DELETE", headers: { ...h } });
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

  return (
    <div className="grid gap-4">
      <div className="np-card p-4">
        <div className="text-xs text-[var(--np-faint)]">账户信息</div>
        {acct ? (
          <div className="mt-3 grid gap-2 text-sm">
            <div>
              <span className="text-[var(--np-faint)]">用户名：</span>
              <span className="font-mono text-[var(--np-muted)]">{acct.username}</span>
            </div>
            <div>
              <span className="text-[var(--np-faint)]">邮箱：</span>
              <span className="text-[var(--np-muted)]">{acct.email ?? "-"}</span>
            </div>
            <div className="pt-2">
              <div className="text-xs text-[var(--np-faint)]">显示名</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input className="np-input w-full md:w-[320px]" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                <button className="np-btn np-btn-primary px-4 py-2 text-sm" onClick={saveProfile} disabled={busy || !acct}>
                  保存
                </button>
              </div>
            </div>
            <div>
              <span className="text-[var(--np-faint)]">2FA：</span>
              <span className={["np-pill", acct.totpEnabled ? "np-pill-ok" : "np-pill-off"].join(" ")}>
                {acct.totpEnabled ? "已启用" : "未启用"}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-2 text-sm text-[var(--np-muted)]">加载中...</div>
        )}
        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
      </div>

      <div className="np-card p-4">
        <div className="text-xs text-[var(--np-faint)]">安全</div>
        <div className="mt-3 grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-sm font-semibold">修改密码</div>
            <div className="mt-3 grid gap-2">
              <input className="np-input" type="password" placeholder="原密码" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
              <input className="np-input" type="password" placeholder="新密码（强密码策略）" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              <button className="np-btn np-btn-primary mt-1 px-4 py-2 text-sm" onClick={changePassword} disabled={busy || !oldPw || !newPw}>
                修改密码
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-sm font-semibold">2FA 换绑</div>
            <div className="mt-2 text-sm text-[var(--np-muted)]">
              将清空当前 2FA，并在下次进入后台前要求重新绑定（Google Authenticator）。
            </div>
            <button className="np-btn np-btn-primary mt-3 px-4 py-2 text-sm" onClick={reset2fa} disabled={busy || !acct}>
              重新绑定 2FA
            </button>
          </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-sm font-semibold">Passkey</div>
            <div className="mt-2 text-sm text-[var(--np-muted)]">
              Passkey 基于系统生物识别/安全密钥（WebAuthn），可在 mac 与非 mac 设备使用（取决于浏览器与系统支持）。
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="text-xs text-[var(--np-faint)]">设备名称（可选）</div>
                <input
                  className="np-input mt-2 w-full"
                  value={passkeyName}
                  onChange={(e) => setPasskeyName(e.target.value)}
                  placeholder="例如：MacBook Touch ID / YubiKey"
                />
              </div>
              <div className="flex items-end justify-end">
                <button className="np-btn np-btn-primary px-4 py-2 text-sm" onClick={addPasskey} disabled={busy || !acct}>
                  添加 Passkey
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5 text-left text-xs text-[var(--np-faint)]">
                  <tr>
                    <th className="px-3 py-2">名称</th>
                    <th className="px-3 py-2">创建时间</th>
                    <th className="px-3 py-2">最近使用</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {passkeys.length ? (
                    passkeys.map((p) => (
                      <tr key={p.id} className="border-t border-white/10">
                        <td className="px-3 py-2">{p.deviceName || "未命名 Passkey"}</td>
                        <td className="px-3 py-2 text-[var(--np-muted)]">{fmt(p.createdAtMs)}</td>
                        <td className="px-3 py-2 text-[var(--np-muted)]">{p.lastUsedAtMs ? fmt(p.lastUsedAtMs) : "-"}</td>
                        <td className="px-3 py-2 text-right">
                          <button className="np-btn px-3 py-1 text-xs" onClick={() => revokePasskey(p.id)} disabled={busy}>
                            删除
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-3 py-4 text-[var(--np-muted)]" colSpan={4}>
                        暂无 Passkey
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
