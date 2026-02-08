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
  metaJson?: string | null;
  ip?: string | null;
  createdAtMs: number;
};

type Settings = { timezone: string };

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    "merchant_api.collect.create": "API 创建代收订单",
    "merchant_api.payout.create": "API 创建代付订单",
    "merchant.api_key.view": "查看 API Key（敏感）",
    "merchant.ip_whitelist_add": "新增 IP 白名单",
    "merchant.ip_whitelist_update": "修改 IP 白名单",
    "merchant.ip_whitelist_enable": "启用 IP 白名单",
    "merchant.ip_whitelist_disable": "停用 IP 白名单",
    "merchant.ip_whitelist_delete": "删除 IP 白名单",
    "account.update_profile": "更新个人资料",
    "account.change_password": "修改密码",
    "account.reset_2fa": "重置 2FA（换绑）",
  };
  return map[action] ?? action;
}

function metaSummary(metaJson?: string | null): string {
  if (!metaJson) return "";
  try {
    const m = JSON.parse(metaJson);
    const parts: string[] = [];
    if (m?.merchantOrderNo) parts.push(`订单号=${String(m.merchantOrderNo)}`);
    if (m?.amount) parts.push(`金额=${String(m.amount)}`);
    if (m?.ip) parts.push(`IP=${String(m.ip)}`);
    if (m?.changes && typeof m.changes === "object") parts.push("变更=" + Object.keys(m.changes).join(","));
    return parts.slice(0, 4).join("，");
  } catch {
    return "";
  }
}

export default function MerchantAuditLogsClient() {
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
    const r = await fetch(`/api/merchant/audit-logs?${sp.toString()}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载失败");
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
  const actorLabel = (r: Row) => {
    if (r.actorDisplayName || r.actorUsername) return `${(r.actorDisplayName ?? "").trim()}${r.actorUsername ? ` (${r.actorUsername})` : ""}`.trim();
    return r.actorUserId ? `user:${r.actorUserId.slice(0, 8)}` : "API Key";
  };

  return (
    <div>
      <ListToolbar
        left={
          <input className="np-input w-full md:w-[420px]" placeholder="搜索动作/对象（模糊）" value={q} onChange={(e) => setQ(e.target.value)} />
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
              <th className="px-4 py-3">来源</th>
              <th className="px-4 py-3">动作</th>
              <th className="px-4 py-3">详情</th>
              <th className="px-4 py-3">对象</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {compact.map((r) => (
              <tr key={r.id} className="border-t border-white/10">
                <td className="px-4 py-3 font-mono text-xs text-[var(--np-muted)]">{fmt(r.createdAtMs)}</td>
                <td className="px-4 py-3 text-xs text-[var(--np-muted)]">
                  <span className="font-mono">{actorLabel(r)}</span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--np-muted)]">{actionLabel(r.action)}</td>
                <td className="px-4 py-3 text-xs text-[var(--np-faint)]">{metaSummary(r.metaJson)}</td>
                <td className="px-4 py-3 text-xs text-[var(--np-muted)]">
                  <span className="font-mono text-[var(--np-faint)]">{(r.entityType ?? "") + (r.entityId ? `:${r.entityId}` : "")}</span>
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
