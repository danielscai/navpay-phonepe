"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import SystemRechargeClient from "@/components/system-recharge-client";
import PaymentAppsClient from "@/components/payment-apps-client";
import MerchantLimitRulesGlobalClient from "@/components/merchant-limit-rules-global-client";

type ConfigRow = { key: string; value: string; description?: string | null; updatedAtMs: number };

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

function pctToBps(pct: string): number | null {
  const raw = pct.trim().replace(/%/g, "");
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100); // 1% = 100 bps
}

function bpsToPctStr(bps: number): string {
  if (!Number.isFinite(bps)) return "0.00";
  return (bps / 100).toFixed(2);
}

export default function OpsSettingsClient() {
  const sp = useSearchParams();
  const tab = (sp.get("tab") ?? "channel_accounts") as string;
  const active = ["merchants", "collect", "payout", "recharge", "channel_accounts", "payment_apps"].includes(tab) ? tab : "channel_accounts";

  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [feePct, setFeePct] = useState("4.50");
  const [reb1Pct, setReb1Pct] = useState("0.50");
  const [reb2Pct, setReb2Pct] = useState("0.30");
  const [reb3Pct, setReb3Pct] = useState("0.10");

  async function load() {
    setErr(null);
    const r = await fetch("/api/admin/system/config");
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

  const configMap = useMemo(() => new Map(rows.map((r) => [r.key, r.value])), [rows]);
  useEffect(() => {
    const fee = Number(configMap.get("channel.fee_rate_bps") ?? "450");
    const l1 = Number(configMap.get("channel.rebate_l1_bps") ?? "50");
    const l2 = Number(configMap.get("channel.rebate_l2_bps") ?? "30");
    const l3 = Number(configMap.get("channel.rebate_l3_bps") ?? "10");
    setFeePct(bpsToPctStr(fee));
    setReb1Pct(bpsToPctStr(l1));
    setReb2Pct(bpsToPctStr(l2));
    setReb3Pct(bpsToPctStr(l3));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  async function upsertConfig(key: string, value: string, description?: string) {
    const h = await csrfHeader();
    const r = await fetch("/api/admin/system/config", {
      method: "POST",
      headers: { "content-type": "application/json", ...h },
      body: JSON.stringify({ key, value, description }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.error || "save_failed");
  }

  async function saveChannelAccountSettings() {
    const feeBps = pctToBps(feePct);
    const l1Bps = pctToBps(reb1Pct);
    const l2Bps = pctToBps(reb2Pct);
    const l3Bps = pctToBps(reb3Pct);
    if (feeBps === null || l1Bps === null || l2Bps === null || l3Bps === null) {
      setErr("请输入合法的百分比，例如 4.50 / 0.50");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await upsertConfig("channel.fee_rate_bps", String(feeBps), "渠道订单收益费率（bps，4.5% = 450）。用于渠道用户“今日收益”等统计。");
      await upsertConfig("channel.rebate_l1_bps", String(l1Bps), "团队返利：一级(直接上级)比例（bps，0.5% = 50）。实时结算。");
      await upsertConfig("channel.rebate_l2_bps", String(l2Bps), "团队返利：二级比例（bps，0.3% = 30）。实时结算。");
      await upsertConfig("channel.rebate_l3_bps", String(l3Bps), "团队返利：三级比例（bps，0.1% = 10）。实时结算。");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="np-card p-2" role="tablist" aria-label="ops-settings-tabs">
        <div className="flex flex-wrap gap-2">
          {[
            ["merchants", "商户设置"],
            ["collect", "代收设置"],
            ["payout", "代付设置"],
            ["recharge", "充值设置"],
            ["channel_accounts", "支付账户设置"],
            ["payment_apps", "支付APP管理"],
          ].map(([k, label]) => {
            const on = active === k;
            return (
              <Link
                key={k}
                href={`/admin/ops/settings?tab=${k}`}
                className={["np-btn px-3 py-2 text-sm inline-flex items-center leading-none", on ? "np-btn-primary" : ""].join(" ")}
                aria-selected={on}
                role="tab"
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      {err ? <div className="text-sm text-[var(--np-danger)]">{err}</div> : null}

      {active === "channel_accounts" ? (
        <div className="np-card p-4">
          <div className="text-sm font-semibold">支付账户设置（全局）</div>
          <div className="mt-1 text-xs text-[var(--np-faint)]">需要 `system.write` 权限。百分比会换算成 bps 保存（1% = 100 bps）。</div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">支付账户收益费率（%）</span>
              <input className="np-input font-mono" value={feePct} onChange={(e) => setFeePct(e.target.value)} placeholder="4.50" />
            </label>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-[var(--np-muted)]">
              用于“今日收益”统计（按订单 `amount * 费率` 计算为渠道收益 fee，写入订单 `channel_fee` 并用于汇总）。
            </div>

            <div className="grid gap-2">
              <div className="text-xs text-[var(--np-faint)]">团队返利（%）</div>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">返利一级</span>
                <input className="np-input font-mono" value={reb1Pct} onChange={(e) => setReb1Pct(e.target.value)} placeholder="0.50" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">返利二级</span>
                <input className="np-input font-mono" value={reb2Pct} onChange={(e) => setReb2Pct(e.target.value)} placeholder="0.30" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">返利三级</span>
                <input className="np-input font-mono" value={reb3Pct} onChange={(e) => setReb3Pct(e.target.value)} placeholder="0.10" />
              </label>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-[var(--np-muted)]">
              多级返利按订单 `amount * 返利比例` 实时结算，最多 3 级，幂等写入 `payment_person_commission_logs`。
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button className="np-btn px-3 py-2 text-sm" onClick={load} disabled={busy}>
              重新加载
            </button>
            <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={saveChannelAccountSettings} disabled={busy}>
              {busy ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      ) : null}

      {active === "recharge" ? <SystemRechargeClient /> : null}

      {active === "collect" ? (
        <MerchantLimitRulesGlobalClient type="collect" />
      ) : null}

      {active === "payout" ? (
        <MerchantLimitRulesGlobalClient type="payout" />
      ) : null}

      {active === "payment_apps" ? <PaymentAppsClient /> : null}

      {active === "merchants" ? (
        <div className="np-card p-4">
          <div className="text-sm font-semibold">商户设置</div>
          <div className="mt-2 text-sm text-[var(--np-muted)]">预留入口：后续会在此集中配置商户默认费率、代收/代付默认限额等运营参数。</div>
        </div>
      ) : null}
    </div>
  );
}
