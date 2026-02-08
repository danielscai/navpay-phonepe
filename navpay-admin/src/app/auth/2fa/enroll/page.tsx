"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";

export default function Enroll2faPage() {
  const router = useRouter();
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [passkeyOk, setPasskeyOk] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function csrfHeaders() {
    const csrf = await fetch("/api/csrf").then((r) => r.json());
    const csrfToken = csrf?.token as string | undefined;
    const headers: Record<string, string> = {};
    if (csrfToken) headers["x-csrf-token"] = csrfToken;
    return headers;
  }

  useEffect(() => {
    (async () => {
      const headers = await csrfHeaders();

      const r = await fetch("/api/2fa/enroll/start", { method: "POST", headers });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(r.status === 401 ? "请先登录后再绑定 2FA" : "无法开始 2FA 绑定，请重试");
        return;
      }
      setOtpauth(j.otpauth);
      const dataUrl = await QRCode.toDataURL(j.otpauth, { margin: 1, scale: 6 });
      setQr(dataUrl);
    })();
  }, []);

  async function bindPasskey() {
    setErr(null);
    setBusy(true);
    try {
      const headers = await csrfHeaders();
      const r = await fetch("/api/webauthn/registration/options", { method: "POST", headers });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("无法开始 Passkey 绑定，请重试");
        return;
      }
      const credential = await startRegistration(j.options);
      const r2 = await fetch("/api/webauthn/registration/verify", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ credential, deviceName: passkeyName.trim() || undefined }),
      });
      const j2 = await r2.json().catch(() => null);
      if (!r2.ok || !j2?.ok) {
        setErr("Passkey 绑定失败，请重试");
        return;
      }
      setPasskeyOk(true);
      setPasskeyName("");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setErr(null);
    setBusy(true);
    try {
      const headers = { "content-type": "application/json", ...(await csrfHeaders()) };

      const r = await fetch("/api/2fa/enroll/confirm", {
        method: "POST",
        headers,
        body: JSON.stringify({ token }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("验证码错误，请重试");
        return;
      }
      setBackupCodes(j.backupCodes ?? []);
    } finally {
      setBusy(false);
    }
  }

  const codesBlock = useMemo(() => {
    if (!backupCodes) return null;
    return (
      <div className="mt-4 np-card p-4">
        <div className="text-sm font-semibold">备用恢复码（请妥善保存）</div>
        <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-sm text-[var(--np-muted)]">
          {backupCodes.map((c) => (
            <div key={c} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              {c}
            </div>
          ))}
        </div>
        <button className="np-btn np-btn-primary mt-4" onClick={() => router.push("/admin")}>
          进入后台
        </button>
      </div>
    );
  }, [backupCodes, router]);

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-xl">
        <div className="np-card p-8">
          <div className="np-badge">
            <span className="h-2 w-2 rounded-full bg-[var(--np-accent)]" />
            <span className="text-[var(--np-muted)]">安全设置</span>
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">绑定 Google Authenticator</h1>
          <p className="mt-2 text-sm text-[var(--np-muted)]">
            你需要至少绑定一种二次验证方式：Passkey 或 Google Authenticator。
          </p>

          {err ? <div className="mt-4 text-sm text-[var(--np-danger)]">{err}</div> : null}

          <div className="mt-6 np-card p-4">
            <div className="text-sm font-semibold">绑定 Passkey（推荐）</div>
            <div className="mt-2 text-sm text-[var(--np-muted)]">
              Passkey 由系统生物识别/安全密钥提供，可用于 mac 与非 mac 设备（取决于浏览器与系统支持）。
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <input
                className="np-input w-full"
                placeholder="设备名称（可选）例如：MacBook Touch ID"
                value={passkeyName}
                onChange={(e) => setPasskeyName(e.target.value)}
              />
              <button className="np-btn np-btn-primary px-4 py-2 text-sm" onClick={bindPasskey} disabled={busy}>
                {passkeyOk ? "已绑定" : "绑定 Passkey"}
              </button>
            </div>
            {passkeyOk ? (
              <div className="mt-3 flex justify-end">
                <button className="np-btn np-btn-primary px-4 py-2 text-sm" onClick={() => router.push("/admin")}>
                  进入后台
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="np-card p-4">
              <div className="text-xs text-[var(--np-faint)]">二维码</div>
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="2fa qr" src={qr} className="mt-3 w-full rounded-lg border border-white/10" />
              ) : (
                <div className="mt-3 h-48 rounded-lg border border-white/10 bg-white/5" />
              )}
            </div>
            <div className="np-card p-4">
              <div className="text-xs text-[var(--np-faint)]">手动密钥</div>
              <div className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-[var(--np-muted)] break-all">
                {otpauth ?? "加载中..."}
              </div>
              <div className="mt-4 text-xs text-[var(--np-faint)]">验证码</div>
              <label className="text-xs text-[var(--np-faint)]" htmlFor="enroll-token">
                验证码
              </label>
              <input
                id="enroll-token"
                className="np-input mt-2 w-full"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button className="np-btn np-btn-primary mt-3 w-full" onClick={confirm} disabled={busy}>
                {busy ? "校验中..." : "确认绑定"}
              </button>
            </div>
          </div>

          {codesBlock}
        </div>
      </div>
    </div>
  );
}
