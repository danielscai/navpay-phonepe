"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

function Modal({
  open,
  title,
  onClose,
  children,
  maxWidthClass,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClass?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-label="close" onClick={onClose} />
      <div className={["relative z-10 w-full", maxWidthClass ?? "max-w-[560px]"].join(" ")}>
        <div className="np-modal max-h-[calc(100vh-3rem)] overflow-auto p-4">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div className="text-base font-semibold tracking-tight">{title}</div>
            <button className="np-btn px-3 py-2 text-sm" onClick={onClose}>
              关闭
            </button>
          </div>
          <div className="pt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function PasskeyStepUpModal(opts: {
  open: boolean;
  onClose: () => void;
  onVerified: () => Promise<void> | void;
  title?: string;
  description?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/webauthn/stepup/options", { method: "POST", headers: { ...h } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        if (j?.error === "no_passkey") {
          setErr("该账号尚未绑定 Passkey，请先到“个人设置”绑定。");
        } else {
          setErr("无法开始 Passkey 验证");
        }
        return;
      }

      const assertion = await startAuthentication(j.options);
      const r2 = await fetch("/api/webauthn/stepup/verify", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ credential: assertion }),
      });
      const j2 = await r2.json().catch(() => null);
      if (!r2.ok || !j2?.ok) {
        setErr("Passkey 验证失败，请重试");
        return;
      }
      await opts.onVerified();
      opts.onClose();
    } catch (e: unknown) {
      const msg = typeof (e as any)?.message === "string" ? String((e as any).message) : "Passkey 验证失败";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={opts.open}
      title={opts.title ?? "敏感操作：请验证 Passkey"}
      onClose={() => {
        if (!busy) opts.onClose();
      }}
    >
      <div className="np-card p-4">
        <div className="text-sm text-[var(--np-muted)]">
          {opts.description ?? "为保证安全，本操作需要进行一次 Passkey 验证（有效期约 5 分钟）。"}
        </div>
        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button className="np-btn px-3 py-2 text-sm" onClick={opts.onClose} disabled={busy}>
            取消
          </button>
          <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={verify} disabled={busy}>
            {busy ? "验证中..." : "验证 Passkey"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
