"use client";

import { useEffect, useState } from "react";
import PasskeyStepUpModal from "@/components/passkey-stepup-modal";

type LimitRule = {
  id: string;
  type: "collect" | "payout";
  minAmount: string;
  maxAmount: string;
  dailyCountLimit: number;
  enabled: boolean;
  note?: string | null;
};

type MeResp = {
  ok: boolean;
  apiKey: { keyId: string; secretPrefix?: string; secret: string | null; canDecrypt?: boolean } | null;
  limitRules: LimitRule[];
};

export default function MerchantApiClient() {
  const [apiKey, setApiKey] = useState<MeResp["apiKey"]>(null);
  const [rules, setRules] = useState<LimitRule[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [secretErr, setSecretErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setErr(null);
      const r = await fetch("/api/merchant/me");
      const j = (await r.json().catch(() => null)) as MeResp | null;
      if (!r.ok || !j?.ok) {
        setErr("加载失败");
        return;
      }
      setApiKey(j.apiKey ?? null);
      setRules((j.limitRules ?? []) as LimitRule[]);
    })();
  }, []);

  async function loadSecret() {
    setSecretErr(null);
    const r = await fetch("/api/merchant/api-key");
    const j = await r.json().catch(() => null);
    if (r.status === 403 && j?.error === "step_up_required") {
      setStepUpOpen(true);
      return;
    }
    if (!r.ok || !j?.ok) {
      setSecretErr("加载 Secret 失败");
      return;
    }
    const s = j?.apiKey?.secret as string | null | undefined;
    const canDecrypt = j?.apiKey?.canDecrypt as boolean | undefined;
    if (!s) {
      setSecretErr(canDecrypt === false ? "无法解密（请联系管理员轮换密钥）" : "暂无 Secret");
      setSecret(null);
      return;
    }
    setSecret(s);
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      setCopied("复制失败");
      setTimeout(() => setCopied(null), 1200);
    }
  }

  return (
    <div className="grid gap-4">
      {err ? <div className="text-sm text-[var(--np-danger)]">{err}</div> : null}

      <div className="np-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--np-faint)]">API Key</div>
            <div className="mt-1 text-sm text-[var(--np-muted)]">用于调用平台下单 API（代收/代付）。</div>
          </div>
          <a className="np-btn px-3 py-2 text-sm" href="/docs/merchant-api" target="_blank" rel="noreferrer">
            打开 API 文档
          </a>
        </div>

        {apiKey ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">Key ID</div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="min-w-0 truncate font-mono text-xs text-[var(--np-muted)]">{apiKey.keyId}</div>
                <button className="np-btn px-2 py-1 text-xs" onClick={() => copy(apiKey.keyId, "Key ID")}>
                  复制
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">Secret</div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="min-w-0 truncate font-mono text-xs text-[var(--np-muted)]">
                  {secret ? secret : "敏感信息：需 Passkey 验证后查看"}
                </div>
                {secret ? (
                  <button className="np-btn px-2 py-1 text-xs" onClick={() => copy(secret, "Secret")}>
                    复制
                  </button>
                ) : (
                  <button className="np-btn np-btn-primary px-2 py-1 text-xs" onClick={loadSecret}>
                    验证查看
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 text-sm text-[var(--np-muted)]">未配置 API Key，请联系平台管理员。</div>
        )}

        {secretErr ? <div className="mt-3 text-xs text-[var(--np-danger)]">{secretErr}</div> : null}
        {copied ? <div className="mt-3 text-xs text-[var(--np-muted)]">已复制：{copied}</div> : null}
      </div>

      <div className="np-card p-4">
        <div className="text-xs text-[var(--np-faint)]">限额规则（只读）</div>
        <div className="mt-2 text-sm text-[var(--np-muted)]">限额由平台侧配置，商户侧不可修改。</div>
        <div className="mt-3 grid gap-2">
          {rules.map((r) => (
            <div key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">{r.type === "collect" ? "代收" : "代付"}</div>
                <span className={["np-pill", r.enabled ? "np-pill-ok" : "np-pill-off"].join(" ")}>{r.enabled ? "启用" : "停用"}</span>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-[var(--np-muted)] md:grid-cols-4">
                <div>
                  <div className="text-[var(--np-faint)]">最小</div>
                  <div className="font-mono">{r.minAmount}</div>
                </div>
                <div>
                  <div className="text-[var(--np-faint)]">最大</div>
                  <div className="font-mono">{r.maxAmount}</div>
                </div>
                <div>
                  <div className="text-[var(--np-faint)]">日笔数</div>
                  <div className="font-mono">{r.dailyCountLimit}</div>
                </div>
                <div>
                  <div className="text-[var(--np-faint)]">备注</div>
                  <div className="font-mono">{r.note ?? "-"}</div>
                </div>
              </div>
            </div>
          ))}
          {!rules.length ? <div className="text-sm text-[var(--np-muted)]">暂无限额规则</div> : null}
        </div>
      </div>

      <PasskeyStepUpModal
        open={stepUpOpen}
        onClose={() => setStepUpOpen(false)}
        onVerified={async () => {
          await loadSecret();
        }}
        title="查看 API Secret"
        description="查看 API Secret 属于敏感操作，需要验证 Passkey。验证成功后将允许在短时间内完成相关操作。"
      />
    </div>
  );
}
