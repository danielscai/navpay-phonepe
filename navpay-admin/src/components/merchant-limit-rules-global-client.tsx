"use client";

import { useEffect, useMemo, useState } from "react";

type Merchant = { id: string; code: string; name: string };
type Rule = { id: string; merchantId: string; type: "collect" | "payout"; minAmount: string; maxAmount: string; dailyCountLimit: number; note?: string | null; enabled: boolean; createdAtMs: number };
type Row = { merchant: Merchant; rule: Rule };

function Modal(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="fixed inset-0 bg-black/60" aria-label="close" onClick={props.onClose} />
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[var(--np-surface)] shadow-xl">
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

export default function MerchantLimitRulesGlobalClient(props: { type: "collect" | "payout" }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [edit, setEdit] = useState<null | { row: Row; minAmount: string; maxAmount: string; dailyCountLimit: string; note: string }>(null);

  async function load() {
    setErr(null);
    const r = await fetch(`/api/admin/ops/merchant-limit-rules?type=${props.type}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr(r.status === 403 ? "无权限访问" : "加载失败");
      return;
    }
    setRows(j.rows ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.type]);

  async function save() {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/ops/merchant-limit-rules", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({
          merchantId: edit.row.merchant.id,
          type: props.type,
          minAmount: edit.minAmount,
          maxAmount: edit.maxAmount,
          dailyCountLimit: Number(edit.dailyCountLimit || "0"),
          note: edit.note.trim() ? edit.note.trim() : null,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("保存失败");
        return;
      }
      setEdit(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const title = props.type === "collect" ? "代收限额规则（按商户）" : "代付限额规则（按商户）";

  return (
    <div className="np-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{title}</div>
        <button className="np-btn px-3 py-2 text-sm" onClick={load} disabled={busy}>
          刷新
        </button>
      </div>
      <div className="mt-2 text-xs text-[var(--np-faint)]">说明：当前系统为“每个商户每种类型仅一条规则（singleton）”，所以此处为全局汇总编辑入口。</div>
      {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}

      <div className="mt-3 overflow-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-4 py-3 w-[220px]">商户</th>
              <th className="px-4 py-3 w-[140px]">最小提现金额</th>
              <th className="px-4 py-3 w-[140px]">最大提现金额</th>
              <th className="px-4 py-3 w-[140px]">当日次数限制</th>
              <th className="px-4 py-3">备注</th>
              <th className="px-4 py-3 w-[120px]">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.merchant.id} className="border-t border-white/10">
                <td className="px-4 py-3">
                  <div className="font-mono text-xs text-[var(--np-muted)]">{r.merchant.code}</div>
                  <div className="mt-1 text-sm">{r.merchant.name}</div>
                </td>
                <td className="px-4 py-3 font-mono">{r.rule.minAmount}</td>
                <td className="px-4 py-3 font-mono">{r.rule.maxAmount}</td>
                <td className="px-4 py-3 font-mono">{String(r.rule.dailyCountLimit ?? 0)}</td>
                <td className="px-4 py-3 text-xs text-[var(--np-muted)]">{r.rule.note ?? "-"}</td>
                <td className="px-4 py-3">
                  <button
                    className="np-btn px-3 py-2 text-xs"
                    onClick={() => setEdit({ row: r, minAmount: r.rule.minAmount, maxAmount: r.rule.maxAmount, dailyCountLimit: String(r.rule.dailyCountLimit ?? 0), note: r.rule.note ?? "" })}
                    disabled={busy}
                  >
                    编辑
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="px-4 py-6 text-sm text-[var(--np-muted)]" colSpan={6}>
                  暂无数据
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {edit ? (
        <Modal title={`编辑限额：${edit.row.merchant.code}`} onClose={() => setEdit(null)}>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">最小金额</span>
                <input className="np-input font-mono" value={edit.minAmount} onChange={(e) => setEdit((x) => (x ? { ...x, minAmount: e.target.value } : x))} placeholder="0" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--np-faint)]">最大金额</span>
                <input className="np-input font-mono" value={edit.maxAmount} onChange={(e) => setEdit((x) => (x ? { ...x, maxAmount: e.target.value } : x))} placeholder="0" />
              </label>
              <label className="grid gap-1 md:col-span-2">
                <span className="text-xs text-[var(--np-faint)]">当日次数限制</span>
                <input className="np-input font-mono" value={edit.dailyCountLimit} onChange={(e) => setEdit((x) => (x ? { ...x, dailyCountLimit: e.target.value } : x))} placeholder="0" />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">备注</span>
              <input className="np-input" value={edit.note} onChange={(e) => setEdit((x) => (x ? { ...x, note: e.target.value } : x))} placeholder="可选" />
            </label>

            <div className="flex items-center justify-end gap-2">
              <button className="np-btn px-3 py-2 text-sm" onClick={() => setEdit(null)} disabled={busy}>
                取消
              </button>
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={save} disabled={busy}>
                {busy ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

