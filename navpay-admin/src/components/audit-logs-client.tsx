"use client";

import { useEffect, useMemo, useState } from "react";
import { ListPager, ListToolbar } from "@/components/list-kit";

type Row = {
  id: string;
  actorUserId?: string | null;
  actorUsername?: string | null;
  actorDisplayName?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  metaJson?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAtMs: number;
};

type Settings = { timezone: string };

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    "merchant.create": "创建商户",
    "merchant.update": "更新商户配置",
    "merchant.enable": "启用商户",
    "merchant.disable": "停用商户",
    "merchant.secrets.rotate": "轮换商户 API Key",
    "merchant.limit_rule_create": "新增商户限额规则",
    "merchant.limit_rule_update": "修改商户限额规则",
    "merchant.limit_rule_delete": "删除商户限额规则",
    "collect.create": "创建代收订单",
    "collect.status_update": "更新代收订单状态",
    "payout.create": "创建代付订单",
    "payout.status_update": "更新代付订单状态",
    "payout.lock": "代付锁单（支付个人）",
    "payout.unlock": "代付解锁（支付个人）",
    "payment_person.enable": "启用个人支付渠道",
    "payment_person.disable": "禁用个人支付渠道",
    "callback.worker_run": "执行通知队列",
    "system.ip_whitelist_add": "新增 IP 白名单",
    "system.ip_whitelist_update": "修改 IP 白名单",
    "system.ip_whitelist_enable": "启用 IP 白名单",
    "system.ip_whitelist_disable": "停用 IP 白名单",
    "system.ip_whitelist_delete": "删除 IP 白名单",
    "system.config_upsert": "新增/更新系统参数",
    "tools.webhook_receiver_create": "创建 Webhook 接收器",
    "tools.webhook_receiver_delete": "删除 Webhook 接收器",
    "account.update_profile": "更新个人资料",
    "account.change_password": "修改密码",
    "account.reset_2fa": "重置 2FA（换绑）",
    "merchant.api_key.view": "商户查看 API Key（敏感）",
  };
  return map[action] ?? action;
}

function metaSummary(action: string, metaJson?: string | null): string {
  if (!metaJson) return "";
  let m: any = null;
  try {
    m = JSON.parse(metaJson);
  } catch {
    return "";
  }

  const changes = m?.changes as Record<string, { from: any; to: any }> | undefined;
  if (changes && typeof changes === "object") {
    const keys = Object.keys(changes);
    const parts = keys.slice(0, 4).map((k) => {
      const c = (changes as any)[k];
      const from = c?.from;
      const to = c?.to;
      const label =
        k === "enabled" ? "状态" :
        k === "name" ? "名称" :
        k === "collectFeeRateBps" ? "代收费率(bps)" :
        k === "payoutFeeRateBps" ? "代付费率(bps)" :
        k === "minFee" ? "最低手续费" :
        k === "value" ? "Value" :
        k;
      const fmt = (v: any) => (v === true ? "启用" : v === false ? "停用" : v === null || v === undefined ? "-" : String(v));
      return `${label}: ${fmt(from)} -> ${fmt(to)}`;
    });
    return parts.join("；");
  }

  const pick = (k: string) => (m && Object.prototype.hasOwnProperty.call(m, k) ? m[k] : undefined);
  const parts: string[] = [];

  if (action.startsWith("merchant.")) {
    const name = pick("name");
    const enabled = pick("enabled");
    const c = pick("collectFeeRateBps");
    const p = pick("payoutFeeRateBps");
    const minFee = pick("minFee");
    if (name !== undefined) parts.push(`名称=${String(name)}`);
    if (enabled !== undefined) parts.push(`状态=${enabled ? "启用" : "停用"}`);
    if (c !== undefined) parts.push(`代收费率(bps)=${String(c)}`);
    if (p !== undefined) parts.push(`代付费率(bps)=${String(p)}`);
    if (minFee !== undefined) parts.push(`最低手续费=${String(minFee)}`);
  }

  if (action.startsWith("merchant.limit_rule_")) {
    const type = pick("type");
    if (type) parts.push(`类型=${type === "collect" ? "代收" : "代付"}`);
    const minAmount = pick("minAmount");
    const maxAmount = pick("maxAmount");
    const dailyCountLimit = pick("dailyCountLimit");
    const enabled = pick("enabled");
    if (minAmount !== undefined) parts.push(`最小=${String(minAmount)}`);
    if (maxAmount !== undefined) parts.push(`最大=${String(maxAmount)}`);
    if (dailyCountLimit !== undefined) parts.push(`日笔数=${String(dailyCountLimit)}`);
    if (enabled !== undefined) parts.push(`启用=${enabled ? "是" : "否"}`);
  }

  if (action.startsWith("system.")) {
    const ip = pick("ip");
    if (ip) parts.push(`IP=${String(ip)}`);
    const key = pick("key");
    if (key) parts.push(`Key=${String(key)}`);
  }

  return parts.slice(0, 4).join("，");
}

export default function AuditLogsClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({ timezone: "Asia/Shanghai" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);

  async function load() {
    setErr(null);
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    const r = await fetch(`/api/admin/audit-logs?${sp.toString()}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr(r.status === 403 ? "无权限访问" : "加载失败");
      return;
    }
    setRows(j.rows ?? []);
    setTotal(Number(j.total ?? 0));
  }

  useEffect(() => {
    load();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setSettings({ timezone: j.timezone });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const compact = useMemo(() => rows.slice(0, 200), [rows]);
  const fmt = (ms: number) => new Date(ms).toLocaleString("zh-CN", { timeZone: settings.timezone, hour12: false });
  return (
    <div>
      <ListToolbar
        left={
          <input
            className="np-input w-full md:w-[420px]"
            placeholder="搜索动作/对象（模糊）"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
        right={
          <button
            className="np-btn px-3 py-2 text-sm"
            onClick={() => {
              setPage(1);
              load();
            }}
          >
            查询
          </button>
        }
        error={err}
      />

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-4 py-3">时间</th>
              <th className="px-4 py-3">操作者</th>
              <th className="px-4 py-3">动作</th>
              <th className="px-4 py-3">详情</th>
              <th className="px-4 py-3">对象</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {compact.map((r) => (
              <tr key={r.id} className="border-t border-white/10">
                <td className="px-4 py-3 font-mono text-xs text-[var(--np-muted)]">
                  {fmt(r.createdAtMs)}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--np-muted)]">
                  {r.actorDisplayName || r.actorUsername ? (
                    <span className="font-mono">
                      {(r.actorDisplayName ?? "").trim()}
                      {r.actorUsername ? ` (${r.actorUsername})` : ""}
                    </span>
                  ) : (
                    <span className="font-mono text-[var(--np-faint)]">{r.actorUserId ?? ""}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--np-muted)]">{actionLabel(r.action)}</td>
                <td className="px-4 py-3 text-xs text-[var(--np-faint)]">{metaSummary(r.action, r.metaJson)}</td>
                <td className="px-4 py-3 text-xs text-[var(--np-muted)]">
                  {r.entityLabel ? <span className="font-mono">{r.entityLabel}</span> : <span className="font-mono text-[var(--np-faint)]">{(r.entityType ?? "") + (r.entityId ? `:${r.entityId}` : "")}</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--np-muted)]">{r.ip ?? ""}</td>
              </tr>
            ))}
            {!compact.length ? (
              <tr>
                <td className="px-4 py-6 text-sm text-[var(--np-muted)]" colSpan={6}>
                  暂无数据
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ListPager
        page={page}
        pageSize={pageSize}
        total={total}
        onPage={(p) => setPage(p)}
        onPageSize={(ps) => {
          setPage(1);
          setPageSize(ps);
        }}
      />
    </div>
  );
}
