"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"passkey" | "password">("passkey");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("NavPay@123456!");
  const [totp, setTotp] = useState("");
  const [needsOtp, setNeedsOtp] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function redirectAfterLogin() {
    try {
      const r = await fetch("/api/admin/me");
      const j = await r.json().catch(() => null);
      const merchantId = j?.user?.merchantId as string | null | undefined;
      router.push(merchantId ? "/merchant" : "/admin");
    } catch {
      router.push("/admin");
    }
  }

  useEffect(() => {
    // If user changes credentials, restart flow.
    setNeedsOtp(false);
    setTotp("");
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, password]);

  async function passkeyLogin() {
    setErr(null);
    setBusy(true);
    try {
      if (!username.trim()) {
        setErr("请输入用户名");
        return;
      }
      const csrf = await fetch("/api/csrf").then((r) => r.json());
      const csrfToken = csrf?.token as string | undefined;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;

      const r = await fetch("/api/webauthn/authentication/options", {
        method: "POST",
        headers,
        body: JSON.stringify({ username }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        const msg =
          j?.error === "no_passkey" ? "该账号尚未绑定 Passkey，请先使用密码登录后在个人设置绑定。" : "无法开始 Passkey 登录";
        setErr(msg);
        return;
      }

      const assertion = await startAuthentication(j.options);
      const res = await signIn("credentials", {
        redirect: false,
        username,
        webauthn: JSON.stringify(assertion),
      });
      if (res?.ok) await redirectAfterLogin();
      else setErr("Passkey 登录失败");
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "Passkey 登录失败";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const csrf = await fetch("/api/csrf").then((r) => r.json());
      const csrfToken = csrf?.token as string | undefined;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (csrfToken) headers["x-csrf-token"] = csrfToken;

      if (!needsOtp) {
        // Step 1: verify username/password, then decide whether to:
        // - force 2FA enrollment (first login)
        // - require TOTP (already enabled)
        // - or log in directly (no 2FA)
        const r = await fetch("/api/preauth", {
          method: "POST",
          headers,
          body: JSON.stringify({ username, password }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) {
          setErr("用户名或密码错误，或账号被锁定");
          return;
        }

        if (j.mustEnroll2fa) {
          // Password-only login is allowed here so the user can enter and bind 2FA.
          const res = await signIn("credentials", {
            redirect: false,
            username,
            password,
          });
          if (res?.ok) router.push("/auth/2fa/enroll");
          else setErr("登录失败");
          return;
        }

        if (j.totpEnabled) {
          // Show OTP step after password is verified. Do not fail the first step.
          setNeedsOtp(true);
          return;
        }

        // No 2FA: log in directly.
        const res = await signIn("credentials", {
          redirect: false,
          username,
          password,
        });
        if (res?.ok) await redirectAfterLogin();
        else setErr("登录失败");
        return;
      }

      // Step 2: NextAuth credentials sign-in with TOTP/backup code.
      if (!totp.trim()) {
        setErr("请输入 Google Authenticator 验证码或备用恢复码");
        return;
      }
      const res = await signIn("credentials", {
        redirect: false,
        username,
        password,
        totp: totp.trim() || undefined,
      });
      if (res?.ok) await redirectAfterLogin();
      else setErr("登录失败：验证码/恢复码错误");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-md">
        <div className="np-card p-8">
          <div className="np-badge">
            <span className="h-2 w-2 rounded-full bg-[var(--np-accent)]" />
            <span className="text-[var(--np-muted)]">NavPay Admin</span>
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">登录</h1>
          <p className="mt-2 text-sm text-[var(--np-muted)]">
            默认账号将强制启用 Google Authenticator 二次验证。
          </p>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-1">
            <div className="grid grid-cols-2 gap-1">
              <button
                className={[
                  "rounded-2xl px-4 py-2 text-sm transition-colors",
                  tab === "passkey" ? "bg-white/10 text-[var(--np-text)]" : "text-[var(--np-faint)] hover:bg-white/5",
                ].join(" ")}
                onClick={() => {
                  setTab("passkey");
                  setErr(null);
                }}
                type="button"
              >
                Passkey 登录
              </button>
              <button
                className={[
                  "rounded-2xl px-4 py-2 text-sm transition-colors",
                  tab === "password" ? "bg-white/10 text-[var(--np-text)]" : "text-[var(--np-faint)] hover:bg-white/5",
                ].join(" ")}
                onClick={() => {
                  setTab("password");
                  setErr(null);
                }}
                type="button"
              >
                密码登录
              </button>
            </div>
          </div>

          {tab === "passkey" ? (
            <div className="mt-5 grid gap-3">
              <label className="text-xs text-[var(--np-faint)]" htmlFor="username">
                用户名
              </label>
              <input id="username" className="np-input" value={username} onChange={(e) => setUsername(e.target.value)} />

              <div className="text-xs text-[var(--np-faint)]">
                Passkey 登录只需要用户名，不需要密码。若账号尚未绑定 Passkey，可切换到“密码登录”进入后台后在个人设置绑定。
              </div>

              {err ? <div className="text-sm text-[var(--np-danger)]">{err}</div> : null}

              <button className="np-btn np-btn-primary mt-1" type="button" onClick={passkeyLogin} disabled={busy}>
                {busy ? "处理中..." : "使用 Passkey 登录"}
              </button>
            </div>
          ) : (
            <form className="mt-5 flex flex-col gap-3" onSubmit={handleSubmit}>
              <label className="text-xs text-[var(--np-faint)]" htmlFor="username2">
                用户名
              </label>
              <input id="username2" className="np-input" value={username} onChange={(e) => setUsername(e.target.value)} />

              <label className="text-xs text-[var(--np-faint)]" htmlFor="password">
                密码
              </label>
              <input id="password" className="np-input" value={password} type="password" onChange={(e) => setPassword(e.target.value)} />

              {needsOtp ? (
                <>
                  <label className="text-xs text-[var(--np-faint)]" htmlFor="totp">
                    Google Authenticator 验证码 / 备用恢复码
                  </label>
                  <input id="totp" className="np-input" value={totp} onChange={(e) => setTotp(e.target.value)} />
                  <div className="text-xs text-[var(--np-faint)]">
                    没有验证码时可输入备用恢复码（8 位，大写字母/数字）。没有恢复码请联系管理员重置 2FA。
                  </div>
                </>
              ) : null}

              {err ? <div className="text-sm text-[var(--np-danger)]">{err}</div> : null}

              <button className="np-btn np-btn-primary mt-2" type="submit" disabled={busy}>
                {busy ? "处理中..." : needsOtp ? "验证并登录" : "下一步"}
              </button>
            </form>
          )}
        </div>

        <div className="mt-4 text-xs text-[var(--np-faint)]">
          安全：强密码、登录限速/锁定、CSRF、防护头、2FA。
        </div>
      </div>
    </div>
  );
}
