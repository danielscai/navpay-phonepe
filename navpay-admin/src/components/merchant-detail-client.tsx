"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type MerchantRow = {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  balance: string;
  payoutFrozen: string;
  createdAtMs: number;
  updatedAtMs: number;
};

type MerchantFees = {
  merchantId: string;
  collectFeeRateBps: number;
  payoutFeeRateBps: number;
  minFee: string;
  updatedAtMs: number;
};

type LimitRule = {
  id: string;
  merchantId: string;
  type: "collect" | "payout";
  minAmount: string;
  maxAmount: string;
  dailyCountLimit: number;
  enabled: boolean;
  note?: string | null;
  createdAtMs: number;
};

type ApiKey = { keyId: string; secret: string | null; secretPrefix?: string; createdAtMs?: number; canDecrypt?: boolean };
type Me = { perms: string[] };
type Settings = { timezone: string };

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

function hasPerm(perms: string[] | undefined | null, key: string): boolean {
  const p = perms ?? [];
  return p.includes("admin.all") || p.includes(key);
}

export default function MerchantDetailClient() {
  const params = useParams();
  const raw = (params as Record<string, string | string[] | undefined>).merchantId;
  const merchantId = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

  const [me, setMe] = useState<Me | null>(null);
  const [settings, setSettings] = useState<Settings>({ timezone: "Asia/Shanghai" });

  const [merchant, setMerchant] = useState<MerchantRow | null>(null);
  const [fees, setFees] = useState<MerchantFees | null>(null);
  const [feesSnapshot, setFeesSnapshot] = useState<MerchantFees | null>(null);
  const [feesEditOpen, setFeesEditOpen] = useState(false);
  const [rules, setRules] = useState<LimitRule[]>([]);
  const [apiKey, setApiKey] = useState<ApiKey | null>(null);
  const [apiOpen, setApiOpen] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<null | "status" | "fees" | "name" | "collect" | "payout" | "apikey">(null);

  const [nameEditOpen, setNameEditOpen] = useState(false);
  const [nameSnapshot, setNameSnapshot] = useState<string | null>(null);
  const [editRuleType, setEditRuleType] = useState<null | "collect" | "payout">(null);
  const [ruleSnapshot, setRuleSnapshot] = useState<null | { minAmount: string; maxAmount: string; dailyCountLimit: number }>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("确认操作");
  const [confirmBody, setConfirmBody] = useState("");
  const [confirmOkText, setConfirmOkText] = useState("确认");
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null);

  const canWrite = hasPerm(me?.perms, "merchant.write");
  const canRotate = hasPerm(me?.perms, "merchant.secrets.rotate");

  const fmt = (ms: number) => new Date(ms).toLocaleString("zh-CN", { timeZone: settings.timezone, hour12: false });

  async function load() {
    if (!merchantId) return;
    setErr(null);
    const r = await fetch(`/api/admin/merchants/${merchantId}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr(r.status === 403 ? "无权限访问" : "加载失败");
      return;
    }
    setMerchant(j.merchant ?? null);
    setNameEditOpen(false);
    setNameSnapshot(null);
    setFees(j.fees ?? null);
    setFeesSnapshot(j.fees ?? null);
    setFeesEditOpen(false);

    const r2 = await fetch(`/api/admin/merchants/${merchantId}/limit-rules`);
    const j2 = await r2.json().catch(() => null);
    if (r2.ok && j2?.ok) setRules(j2.rows ?? []);
    setEditRuleType(null);
    setRuleSnapshot(null);

    const r3 = await fetch(`/api/admin/merchants/${merchantId}/api-key`);
    const j3 = await r3.json().catch(() => null);
    const k = j3?.apiKey as any;
    if (r3.ok && j3?.ok && k && typeof k.keyId === "string") {
      setApiKey({
        keyId: String(k.keyId),
        secret: typeof k.secret === "string" ? k.secret : null,
        secretPrefix: typeof k.secretPrefix === "string" ? k.secretPrefix : undefined,
        createdAtMs: typeof k.createdAtMs === "number" ? k.createdAtMs : undefined,
        canDecrypt: typeof k.canDecrypt === "boolean" ? k.canDecrypt : undefined,
      });
    } else if (r3.ok && j3?.ok) {
      setApiKey(null);
    }
  }

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/admin/me");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) setMe({ perms: j.perms ?? [] });
    })();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setSettings({ timezone: j.timezone });
    })();
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId]);

  const title = useMemo(() => {
    if (!merchant) return "商户设置";
    return `${merchant.code} ${merchant.name}`;
  }, [merchant]);

  async function patchMerchant(body: any) {
    const h = await csrfHeader();
    const r = await fetch(`/api/admin/merchants/${merchantId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...h },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.error ?? "patch_failed");
  }

  function openConfirm(opts: { title: string; body: string; okText?: string; action: () => Promise<void> }) {
    setConfirmTitle(opts.title);
    setConfirmBody(opts.body);
    setConfirmOkText(opts.okText ?? "确认");
    setConfirmAction(() => opts.action);
    setConfirmOpen(true);
  }

  async function saveFees() {
    if (!fees) return;
    setBusyKey("fees");
    setErr(null);
    try {
      await patchMerchant({
        collectFeeRateBps: Number(fees.collectFeeRateBps),
        payoutFeeRateBps: Number(fees.payoutFeeRateBps),
        minFee: String(fees.minFee ?? "0"),
      });
      await load();
      setFeesEditOpen(false);
    } catch {
      setErr("保存费率失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function saveName() {
    if (!merchant) return;
    setBusyKey("name");
    setErr(null);
    try {
      await patchMerchant({ name: merchant.name });
      await load();
      setNameEditOpen(false);
      setNameSnapshot(null);
    } catch {
      setErr("保存名称失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleMerchantEnabledImmediate(nextEnabled: boolean) {
    if (!merchant) return;
    setBusyKey("status");
    setErr(null);
    try {
      await patchMerchant({ enabled: nextEnabled });
      await load();
    } catch {
      setErr("更新状态失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function patchLimitRule(ruleId: string, body: any) {
    const h = await csrfHeader();
    const r = await fetch(`/api/admin/merchants/${merchantId}/limit-rules/${ruleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...h },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error("patch_rule_failed");
  }

  async function rotateApiKey() {
    if (!canRotate) return;
    setBusyKey("apikey");
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/merchants/${merchantId}/api-key`, { method: "POST", headers: { ...h } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("轮换失败（无权限或服务错误）");
        return;
      }
      setApiKey((j.apiKey ?? null) as any);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="np-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link className="np-btn px-3 py-2 text-sm" href="/admin/merchants">
              ← 返回
            </Link>
            <div>
	              <div className="text-xs text-[var(--np-faint)]">商户设置</div>
	              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
	                <div className="text-lg font-semibold tracking-tight">{merchant ? merchant.code : "商户设置"}</div>
	                {merchant ? <div className="text-sm font-semibold text-[var(--np-text)]">{merchant.name}</div> : null}
	                {merchant ? (
	                  <div className="hidden text-xs text-[var(--np-faint)] md:block">
	                    创建 {fmt(merchant.createdAtMs)} · 更新 {fmt(merchant.updatedAtMs)}
	                  </div>
	                ) : null}
	              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {merchant ? (
              <button
                className={["np-btn px-3 py-2 text-sm", merchant.enabled ? "np-btn-primary" : ""].join(" ")}
                onClick={() => {
                  const next = !merchant.enabled;
                  openConfirm({
                    title: next ? "确认启用商户" : "确认停用商户",
                    body: next
                      ? "启用后商户将恢复可用（仅对后台演示有效）。"
                      : "停用后商户将不可用（仅对后台演示有效）。确认继续？",
                    okText: next ? "启用" : "停用",
                    action: async () => toggleMerchantEnabledImmediate(next),
                  });
                }}
                disabled={!canWrite || busyKey === "status"}
              >
                {merchant.enabled ? "已启用" : "已停用"}
              </button>
            ) : null}
          </div>
        </div>

        {merchant ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">余额</div>
              <div className="mt-1 font-mono text-2xl font-semibold tracking-tight text-[var(--np-text)]">{merchant.balance}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">代付冻结</div>
              <div className="mt-2 font-mono text-xl text-[var(--np-muted)]">{merchant.payoutFrozen}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">商户号</div>
              <div className="mt-2 font-mono text-xs text-[var(--np-muted)] break-all">{merchant.code}</div>
            </div>
          </div>
        ) : null}
      </div>

      {err ? <div className="text-sm text-[var(--np-danger)]">{err}</div> : null}

        {!merchant || !fees ? (
          <div className="text-sm text-[var(--np-muted)]">加载中...</div>
        ) : (
          <>
	            <div className="grid gap-4 md:grid-cols-2">
	              <div className="np-card p-4">
	                <div className="flex flex-wrap items-center justify-between gap-3">
	                  <div className="text-xs text-[var(--np-faint)]">费率</div>
                  {canWrite ? (
                    feesEditOpen ? (
                      <div className="flex gap-2">
                        <button className="np-btn px-3 py-2 text-xs" onClick={() => { setFeesEditOpen(false); setFees(feesSnapshot); }} disabled={busyKey === "fees"}>
                          取消
                        </button>
                        <button className="np-btn np-btn-primary px-3 py-2 text-xs" onClick={saveFees} disabled={busyKey === "fees"}>
                          {busyKey === "fees" ? "保存中..." : "保存"}
                        </button>
                      </div>
                    ) : (
                      <button className="np-btn px-3 py-2 text-xs" onClick={() => { setFeesEditOpen(true); setFeesSnapshot(fees); }} disabled={busyKey === "fees"}>
                        修改
                      </button>
                    )
                  ) : null}
                </div>
                {feesEditOpen ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div>
                      <div className="text-xs text-[var(--np-faint)]">代收 bps</div>
                      <input
                        className="np-input mt-2 w-full max-w-[160px]"
                        value={String(fees.collectFeeRateBps)}
                        onChange={(e) => setFees({ ...fees, collectFeeRateBps: Number(e.target.value || "0") })}
                        disabled={!canWrite || busyKey === "fees"}
                        placeholder="例如 300"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-[var(--np-faint)]">代付 bps</div>
                      <input
                        className="np-input mt-2 w-full max-w-[160px]"
                        value={String(fees.payoutFeeRateBps)}
                        onChange={(e) => setFees({ ...fees, payoutFeeRateBps: Number(e.target.value || "0") })}
                        disabled={!canWrite || busyKey === "fees"}
                        placeholder="例如 450"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-[var(--np-faint)]">最低手续费</div>
                      <input
                        className="np-input mt-2 w-full max-w-[180px]"
                        value={fees.minFee}
                        onChange={(e) => setFees({ ...fees, minFee: e.target.value })}
                        disabled={!canWrite || busyKey === "fees"}
                        placeholder="例如 0.00"
                      />
                    </div>
                  </div>
	                ) : (
	                  <div className="mt-3 grid gap-3 md:grid-cols-3">
	                    <div>
	                      <div className="text-xs text-[var(--np-faint)]">代收 bps</div>
	                      <div className="mt-2 font-mono text-sm text-[var(--np-muted)]">{fees.collectFeeRateBps}</div>
	                    </div>
	                    <div>
	                      <div className="text-xs text-[var(--np-faint)]">代付 bps</div>
	                      <div className="mt-2 font-mono text-sm text-[var(--np-muted)]">{fees.payoutFeeRateBps}</div>
	                    </div>
	                    <div>
	                      <div className="text-xs text-[var(--np-faint)]">最低手续费</div>
	                      <div className="mt-2 font-mono text-sm text-[var(--np-muted)]">{fees.minFee}</div>
	                    </div>
	                  </div>
	                )}
	              </div>

	              <div className="np-card p-4">
	                <div className="flex flex-wrap items-center justify-between gap-3">
	                  <div className="text-xs text-[var(--np-faint)]">商户名称</div>
	                  {canWrite ? (
	                    nameEditOpen ? (
	                      <div className="flex gap-2">
	                        <button
	                          className="np-btn px-3 py-2 text-xs"
	                          onClick={() => {
	                            if (merchant && nameSnapshot !== null) setMerchant({ ...merchant, name: nameSnapshot });
	                            setNameEditOpen(false);
	                            setNameSnapshot(null);
	                          }}
	                          disabled={busyKey === "name"}
	                        >
	                          取消
	                        </button>
	                        <button className="np-btn np-btn-primary px-3 py-2 text-xs" onClick={saveName} disabled={busyKey === "name"}>
	                          {busyKey === "name" ? "保存中..." : "保存"}
	                        </button>
	                      </div>
	                    ) : (
	                      <button
	                        className="np-btn px-3 py-2 text-xs"
	                        onClick={() => {
	                          if (!merchant) return;
	                          setNameSnapshot(merchant.name);
	                          setNameEditOpen(true);
	                        }}
	                        disabled={busyKey === "name"}
	                      >
	                        修改
	                      </button>
	                    )
	                  ) : null}
	                </div>

	                {nameEditOpen ? (
	                  <div className="mt-3">
	                    <input
	                      className="np-input w-full max-w-[420px]"
	                      value={merchant.name}
	                      onChange={(e) => setMerchant({ ...merchant, name: e.target.value })}
	                      disabled={!canWrite || busyKey === "name"}
	                      placeholder="输入商户名称"
	                    />
	                  </div>
	                ) : (
	                  <div className="mt-3 font-mono text-sm text-[var(--np-muted)] break-all">{merchant.name}</div>
	                )}
	              </div>
	            </div>

	            <div className="grid gap-4 md:grid-cols-2">
	              {(["collect", "payout"] as const).map((t) => {
	                const r = rules.find((x) => x.type === t) ?? null;
	                const open = editRuleType === t;
	                return (
	                  <div key={t} className="np-card p-4">
	                    <div className="flex flex-wrap items-center justify-between gap-3">
	                      <div>
	                        <div className="text-xs text-[var(--np-faint)]">{t === "collect" ? "代收限额" : "代付限额"}</div>
	                      </div>
	                      {canWrite && r ? (
	                        open ? (
	                          <div className="flex gap-2">
	                            <button
	                              className="np-btn px-3 py-2 text-xs"
	                              onClick={() => {
	                                if (!ruleSnapshot) return;
	                                setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...ruleSnapshot } : x)));
	                                setEditRuleType(null);
	                                setRuleSnapshot(null);
	                              }}
	                              disabled={busyKey === t}
	                            >
	                              取消
	                            </button>
	                            <button
	                              className="np-btn np-btn-primary px-3 py-2 text-xs"
	                              disabled={busyKey === t}
	                              onClick={async () => {
	                                setBusyKey(t);
	                                setErr(null);
	                                try {
	                                  await patchLimitRule(r.id, {
	                                    minAmount: r.minAmount,
	                                    maxAmount: r.maxAmount,
	                                    dailyCountLimit: r.dailyCountLimit,
	                                  });
	                                  await load();
	                                } catch {
	                                  setErr("保存限额失败");
	                                } finally {
	                                  setBusyKey(null);
	                                }
	                              }}
	                            >
	                              {busyKey === t ? "保存中..." : "保存"}
	                            </button>
	                          </div>
	                        ) : (
	                          <button
	                            className="np-btn px-3 py-2 text-xs"
	                            onClick={() => {
	                              setRuleSnapshot({ minAmount: r.minAmount, maxAmount: r.maxAmount, dailyCountLimit: r.dailyCountLimit });
	                              setEditRuleType(t);
	                            }}
	                            disabled={busyKey === t || (editRuleType !== null && editRuleType !== t)}
	                          >
	                            修改
	                          </button>
	                        )
	                      ) : null}
	                    </div>

	                    {!r ? (
	                      <div className="mt-3 text-sm text-[var(--np-danger)]">缺少规则（请刷新或联系管理员修复）</div>
	                    ) : open ? (
	                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
	                        <div>
	                          <div className="text-xs text-[var(--np-faint)]">单笔最小</div>
	                          <input
	                            className="np-input mt-2 w-full md:max-w-[240px]"
	                            value={r.minAmount}
	                            onChange={(e) => setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, minAmount: e.target.value } : x)))}
	                            disabled={!canWrite || busyKey === t}
	                            placeholder="例如 0"
	                          />
	                        </div>
	                        <div>
	                          <div className="text-xs text-[var(--np-faint)]">单笔最大</div>
	                          <input
	                            className="np-input mt-2 w-full md:max-w-[240px]"
	                            value={r.maxAmount}
	                            onChange={(e) => setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, maxAmount: e.target.value } : x)))}
	                            disabled={!canWrite || busyKey === t}
	                            placeholder="0 表示不限"
	                          />
	                        </div>
	                        <div>
	                          <div className="text-xs text-[var(--np-faint)]">每日笔数</div>
	                          <input
	                            className="np-input mt-2 w-full md:max-w-[240px]"
	                            value={String(r.dailyCountLimit)}
	                            onChange={(e) =>
	                              setRules((prev) =>
	                                prev.map((x) => (x.id === r.id ? { ...x, dailyCountLimit: Number(e.target.value || "0") } : x)),
	                              )
	                            }
	                            disabled={!canWrite || busyKey === t}
	                            placeholder="0 表示不限"
	                          />
	                        </div>
	                      </div>
	                    ) : (
	                      <div className="mt-3 grid gap-3 md:grid-cols-3">
	                        <div>
	                          <div className="text-xs text-[var(--np-faint)]">单笔最小</div>
	                          <div className="mt-2 font-mono text-sm text-[var(--np-muted)]">{r.minAmount}</div>
	                        </div>
	                        <div>
	                          <div className="text-xs text-[var(--np-faint)]">单笔最大</div>
	                          <div className="mt-2 font-mono text-sm text-[var(--np-muted)]">{r.maxAmount}</div>
	                        </div>
	                        <div>
	                          <div className="text-xs text-[var(--np-faint)]">每日笔数</div>
	                          <div className="mt-2 font-mono text-sm text-[var(--np-muted)]">{r.dailyCountLimit}</div>
	                        </div>
	                      </div>
	                    )}
	                  </div>
	                );
	              })}
	            </div>

          <div className="np-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-[var(--np-faint)]">API Key</div>
                <div className="mt-1 text-sm text-[var(--np-muted)]">
                  状态：
                  <span className={["ml-2 np-pill", apiKey ? "np-pill-ok" : "np-pill-off"].join(" ")}>
                    {apiKey ? "已创建" : "未创建"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {apiKey ? (
                  <button className="np-btn px-3 py-2 text-xs" onClick={() => setApiOpen((v) => !v)}>
                    {apiOpen ? "收起" : "展开"}
                  </button>
                ) : null}
                {canRotate ? (
                  <button className="np-btn np-btn-primary px-3 py-2 text-xs" onClick={rotateApiKey} disabled={busyKey === "apikey"}>
                    轮换密钥
                  </button>
                ) : null}
              </div>
            </div>

            {apiKey && apiOpen ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs text-[var(--np-faint)]">Key ID</div>
                  <div className="mt-2 font-mono text-xs text-[var(--np-muted)] break-all">{apiKey.keyId}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs text-[var(--np-faint)]">Secret</div>
                  <div className="mt-2 font-mono text-xs text-[var(--np-muted)] break-all">
                    {apiKey.secret ? apiKey.secret : apiKey.canDecrypt === false ? "无法解密（请轮换密钥）" : "-"}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-label="close" onClick={() => setConfirmOpen(false)} />
          <div className="relative z-10 w-full max-w-[520px]">
            <div className="np-modal p-4">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div className="text-base font-semibold tracking-tight">{confirmTitle}</div>
                <button className="np-btn px-3 py-2 text-sm" onClick={() => setConfirmOpen(false)}>
                  关闭
                </button>
              </div>
              <div className="pt-4 text-sm text-[var(--np-muted)]">{confirmBody}</div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="np-btn px-3 py-2 text-sm" onClick={() => setConfirmOpen(false)} disabled={busyKey === "status"}>
                  取消
                </button>
                <button
                  className="np-btn np-btn-primary px-3 py-2 text-sm"
                  onClick={async () => {
                    const fn = confirmAction;
                    setConfirmOpen(false);
                    setConfirmAction(null);
                    if (fn) await fn();
                  }}
                  disabled={busyKey === "status"}
                >
                  {confirmOkText}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
