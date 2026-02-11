"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type ConfigRow = { key: string; value: string; description?: string | null; updatedAtMs: number };

type Activity = {
  id: string;
  name: string; // 活动名称
  appDisplayName?: string; // App展示名称
  platform?: string; // 平台
  type?: string; // 活动类型
  range?: string; // 区间
  metric?: string; // 任务指标
  rewardAmount?: string; // 奖励金额
  sort?: number;
  enabled?: boolean;
};

type Leaderboard = {
  id: string;
  templateName: string; // 模板名称
  validFrom?: string; // YYYY-MM-DD
  validTo?: string; // YYYY-MM-DD
  openAt?: string; // HH:mm or ISO string
  enabled?: boolean;
};

function Modal(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="fixed inset-0 bg-black/60" aria-label="close" onClick={props.onClose} />
      <div className="relative z-10 w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[var(--np-surface)] shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">{props.title}</div>
          <button className="np-btn px-2 py-1 text-xs" onClick={props.onClose}>
            关闭
          </button>
        </div>
        <div className="p-4">{props.children}</div>
      </div>
    </div>
  );
}

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const KEY_ACT = "ops.activities_json";
const KEY_LB = "ops.leaderboards_json";

export default function OpsActivitiesClient() {
  const sp = useSearchParams();
  const tab = (sp.get("tab") ?? "activities") as string;
  const active = ["activities", "leaderboards"].includes(tab) ? tab : "activities";

  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const configMap = useMemo(() => new Map(rows.map((r) => [r.key, r.value])), [rows]);
  const activities = useMemo(() => safeJson<Activity[]>(configMap.get(KEY_ACT) ?? "[]", []), [configMap]);
  const leaderboards = useMemo(() => safeJson<Leaderboard[]>(configMap.get(KEY_LB) ?? "[]", []), [configMap]);

  const [editAct, setEditAct] = useState<null | Activity>(null);
  const [editLb, setEditLb] = useState<null | Leaderboard>(null);

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

  async function saveActivities(next: Activity[]) {
    setBusy(true);
    setErr(null);
    try {
      await upsertConfig(KEY_ACT, JSON.stringify(next), "活动配置（JSON）。用于运营侧活动/任务配置与展示。");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveLeaderboards(next: Leaderboard[]) {
    setBusy(true);
    setErr(null);
    try {
      await upsertConfig(KEY_LB, JSON.stringify(next), "排行榜配置（JSON）。用于运营侧排行榜展示/结算配置。");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="np-card p-2" role="tablist" aria-label="activities-tabs">
        <div className="flex flex-wrap gap-2">
          {[
            ["activities", "活动配置"],
            ["leaderboards", "排行榜配置"],
          ].map(([k, label]) => {
            const on = active === k;
            return (
              <Link
                key={k}
                href={`/admin/ops/activities?tab=${k}`}
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

      {active === "activities" ? (
        <div className="np-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">活动配置</div>
            <button
              className="np-btn np-btn-primary px-3 py-2 text-sm"
              onClick={() =>
                setEditAct({
                  id: `act_${Date.now()}`,
                  name: "",
                  appDisplayName: "",
                  platform: "平台",
                  type: "充值金额",
                  range: "-",
                  metric: "-",
                  rewardAmount: "0",
                  sort: activities.length + 1,
                  enabled: true,
                })
              }
              disabled={busy}
            >
              新增活动
            </button>
          </div>
          <div className="mt-2 text-xs text-[var(--np-faint)]">当前为配置闭环（存储在系统参数 JSON）。等你确认活动字段与结算逻辑后再接入实际业务。</div>

          <div className="mt-3 overflow-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
                <tr>
                  <th className="px-4 py-3 w-[90px]">ID</th>
                  <th className="px-4 py-3 w-[180px]">活动名称</th>
                  <th className="px-4 py-3 w-[200px]">App展示名称</th>
                  <th className="px-4 py-3 w-[120px]">所属平台</th>
                  <th className="px-4 py-3 w-[140px]">活动类型</th>
                  <th className="px-4 py-3 w-[120px]">区间</th>
                  <th className="px-4 py-3 w-[140px]">任务指标</th>
                  <th className="px-4 py-3 w-[120px]">奖励金额</th>
                  <th className="px-4 py-3 w-[80px]">排序</th>
                  <th className="px-4 py-3 w-[120px]">状态</th>
                  <th className="px-4 py-3 w-[160px]">操作</th>
                </tr>
              </thead>
              <tbody>
                {activities
                  .slice()
                  .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
                  .map((a) => (
                    <tr key={a.id} className="border-t border-white/10">
                      <td className="px-4 py-3 font-mono text-xs text-[var(--np-muted)]">{a.id}</td>
                      <td className="px-4 py-3">{a.name || "-"}</td>
                      <td className="px-4 py-3 text-[var(--np-muted)]">{a.appDisplayName || "-"}</td>
                      <td className="px-4 py-3">{a.platform || "-"}</td>
                      <td className="px-4 py-3">{a.type || "-"}</td>
                      <td className="px-4 py-3">{a.range || "-"}</td>
                      <td className="px-4 py-3">{a.metric || "-"}</td>
                      <td className="px-4 py-3 font-mono">{a.rewardAmount ?? "-"}</td>
                      <td className="px-4 py-3 font-mono">{String(a.sort ?? 0)}</td>
                      <td className="px-4 py-3 text-xs">{a.enabled ? <span className="np-pill np-pill-ok">启用</span> : <span className="np-pill np-pill-off">停用</span>}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button className="np-btn px-3 py-2 text-xs" onClick={() => setEditAct(a)} disabled={busy}>
                            编辑
                          </button>
                          <button
                            className="np-btn px-3 py-2 text-xs"
                            onClick={() => {
                              if (!confirm(`确认删除活动：${a.name || a.id}？`)) return;
                              saveActivities(activities.filter((x) => x.id !== a.id));
                            }}
                            disabled={busy}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                {!activities.length ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-[var(--np-muted)]" colSpan={11}>
                      暂无活动配置
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {active === "leaderboards" ? (
        <div className="np-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">排行榜配置</div>
            <button
              className="np-btn np-btn-primary px-3 py-2 text-sm"
              onClick={() =>
                setEditLb({
                  id: `lb_${Date.now()}`,
                  templateName: "",
                  validFrom: "",
                  validTo: "",
                  openAt: "00:00",
                  enabled: true,
                })
              }
              disabled={busy}
            >
              新增排行榜
            </button>
          </div>
          <div className="mt-2 text-xs text-[var(--np-faint)]">当前为配置闭环（存储在系统参数 JSON）。后续可接入实际排行计算/定时结算。</div>

          <div className="mt-3 overflow-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
                <tr>
                  <th className="px-4 py-3 w-[120px]">ID</th>
                  <th className="px-4 py-3">模板名称</th>
                  <th className="px-4 py-3 w-[220px]">活动有效期</th>
                  <th className="px-4 py-3 w-[120px]">开启时间</th>
                  <th className="px-4 py-3 w-[120px]">状态</th>
                  <th className="px-4 py-3 w-[180px]">操作</th>
                </tr>
              </thead>
              <tbody>
                {leaderboards.map((l) => (
                  <tr key={l.id} className="border-t border-white/10">
                    <td className="px-4 py-3 font-mono text-xs text-[var(--np-muted)]">{l.id}</td>
                    <td className="px-4 py-3">{l.templateName || "-"}</td>
                    <td className="px-4 py-3 text-[var(--np-muted)]">{(l.validFrom || "-") + " ~ " + (l.validTo || "-")}</td>
                    <td className="px-4 py-3 font-mono">{l.openAt || "-"}</td>
                    <td className="px-4 py-3 text-xs">{l.enabled ? <span className="np-pill np-pill-ok">启用</span> : <span className="np-pill np-pill-off">停用</span>}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button className="np-btn px-3 py-2 text-xs" onClick={() => setEditLb(l)} disabled={busy}>
                          编辑
                        </button>
                        <button
                          className="np-btn px-3 py-2 text-xs"
                          onClick={() => {
                            if (!confirm(`确认删除排行榜：${l.templateName || l.id}？`)) return;
                            saveLeaderboards(leaderboards.filter((x) => x.id !== l.id));
                          }}
                          disabled={busy}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!leaderboards.length ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-[var(--np-muted)]" colSpan={6}>
                      暂无排行榜配置
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {editAct ? (
        <Modal title={`编辑活动：${editAct.name || editAct.id}`} onClose={() => setEditAct(null)}>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">活动名称</span>
                <input className="np-input" value={editAct.name} onChange={(e) => setEditAct((x) => (x ? { ...x, name: e.target.value } : x))} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">App展示名称</span>
                <input className="np-input" value={editAct.appDisplayName ?? ""} onChange={(e) => setEditAct((x) => (x ? { ...x, appDisplayName: e.target.value } : x))} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">所属平台</span>
                <input className="np-input" value={editAct.platform ?? ""} onChange={(e) => setEditAct((x) => (x ? { ...x, platform: e.target.value } : x))} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">活动类型</span>
                <input className="np-input" value={editAct.type ?? ""} onChange={(e) => setEditAct((x) => (x ? { ...x, type: e.target.value } : x))} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">区间</span>
                <input className="np-input" value={editAct.range ?? ""} onChange={(e) => setEditAct((x) => (x ? { ...x, range: e.target.value } : x))} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">任务指标</span>
                <input className="np-input" value={editAct.metric ?? ""} onChange={(e) => setEditAct((x) => (x ? { ...x, metric: e.target.value } : x))} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">奖励金额</span>
                <input className="np-input font-mono" value={editAct.rewardAmount ?? ""} onChange={(e) => setEditAct((x) => (x ? { ...x, rewardAmount: e.target.value } : x))} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">排序</span>
                <input className="np-input font-mono" value={String(editAct.sort ?? 0)} onChange={(e) => setEditAct((x) => (x ? { ...x, sort: Number(e.target.value || 0) } : x))} />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!editAct.enabled} onChange={(e) => setEditAct((x) => (x ? { ...x, enabled: e.target.checked } : x))} />
              <span>启用</span>
            </label>

            <div className="flex items-center justify-end gap-2">
              <button className="np-btn px-3 py-2 text-sm" onClick={() => setEditAct(null)} disabled={busy}>
                取消
              </button>
              <button
                className="np-btn np-btn-primary px-3 py-2 text-sm"
                onClick={() => {
                  const next = activities.slice();
                  const idx = next.findIndex((x) => x.id === editAct.id);
                  if (idx >= 0) next[idx] = editAct;
                  else next.push(editAct);
                  setEditAct(null);
                  saveActivities(next);
                }}
                disabled={busy || !editAct.name.trim()}
              >
                {busy ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {editLb ? (
        <Modal title={`编辑排行榜：${editLb.templateName || editLb.id}`} onClose={() => setEditLb(null)}>
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">模板名称</span>
              <input className="np-input" value={editLb.templateName} onChange={(e) => setEditLb((x) => (x ? { ...x, templateName: e.target.value } : x))} />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">有效期开始（YYYY-MM-DD）</span>
                <input className="np-input font-mono" value={editLb.validFrom ?? ""} onChange={(e) => setEditLb((x) => (x ? { ...x, validFrom: e.target.value } : x))} placeholder="2026-02-10" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">有效期结束（YYYY-MM-DD）</span>
                <input className="np-input font-mono" value={editLb.validTo ?? ""} onChange={(e) => setEditLb((x) => (x ? { ...x, validTo: e.target.value } : x))} placeholder="2026-02-28" />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">开启时间（HH:mm 或 ISO）</span>
              <input className="np-input font-mono" value={editLb.openAt ?? ""} onChange={(e) => setEditLb((x) => (x ? { ...x, openAt: e.target.value } : x))} placeholder="00:00" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!editLb.enabled} onChange={(e) => setEditLb((x) => (x ? { ...x, enabled: e.target.checked } : x))} />
              <span>启用</span>
            </label>

            <div className="flex items-center justify-end gap-2">
              <button className="np-btn px-3 py-2 text-sm" onClick={() => setEditLb(null)} disabled={busy}>
                取消
              </button>
              <button
                className="np-btn np-btn-primary px-3 py-2 text-sm"
                onClick={() => {
                  const next = leaderboards.slice();
                  const idx = next.findIndex((x) => x.id === editLb.id);
                  if (idx >= 0) next[idx] = editLb;
                  else next.push(editLb);
                  setEditLb(null);
                  saveLeaderboards(next);
                }}
                disabled={busy || !editLb.templateName.trim()}
              >
                {busy ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

