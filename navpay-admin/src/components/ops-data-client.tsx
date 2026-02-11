"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  key: string;
  label: string;
  collectSuccessCount: number;
  collectSuccessAmount: number;
  collectFee: number;
  collectChannelFee: number;
  payoutSuccessCount: number;
  payoutSuccessAmount: number;
  payoutFee: number;
  payoutChannelFee: number;
  rechargeSuccessAmount: number;
};

function todayYmdInTz(tz: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return dtf.format(new Date());
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

export default function OpsDataClient() {
  const [tz, setTz] = useState("Asia/Shanghai");
  const [groupBy, setGroupBy] = useState<"day" | "merchant" | "payment_app">("day");
  const [dateFrom, setDateFrom] = useState("2026-02-10");
  const [dateTo, setDateTo] = useState("2026-02-10");
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      const nextTz = (j?.timezone as string) || "Asia/Shanghai";
      setTz(nextTz);
      const today = todayYmdInTz(nextTz);
      setDateFrom(today);
      setDateTo(today);
    })();
  }, []);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const u = new URL("/api/admin/ops/data", window.location.origin);
      u.searchParams.set("tz", tz);
      u.searchParams.set("groupBy", groupBy);
      if (dateFrom) u.searchParams.set("dateFrom", dateFrom);
      if (dateTo) u.searchParams.set("dateTo", dateTo);
      const r = await fetch(u.toString().replace(window.location.origin, ""));
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(r.status === 403 ? "无权限访问" : (j?.error ? `加载失败：${j.error}` : "加载失败"));
        return;
      }
      setRows(j.rows ?? []);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!tz) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tz]);

  const totals = useMemo(() => {
    let cAmt = 0, cFee = 0, cCh = 0, cCnt = 0;
    let pAmt = 0, pFee = 0, pCh = 0, pCnt = 0;
    let rAmt = 0;
    for (const x of rows) {
      cAmt += Number(x.collectSuccessAmount ?? 0);
      cFee += Number(x.collectFee ?? 0);
      cCh += Number(x.collectChannelFee ?? 0);
      cCnt += Number(x.collectSuccessCount ?? 0);
      pAmt += Number(x.payoutSuccessAmount ?? 0);
      pFee += Number(x.payoutFee ?? 0);
      pCh += Number(x.payoutChannelFee ?? 0);
      pCnt += Number(x.payoutSuccessCount ?? 0);
      rAmt += Number(x.rechargeSuccessAmount ?? 0);
    }
    return { cAmt, cFee, cCh, cCnt, pAmt, pFee, pCh, pCnt, rAmt };
  }, [rows]);

  return (
    <div className="grid gap-4">
      <div className="np-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">运营数据</div>
            <div className="mt-1 text-xs text-[var(--np-faint)]">
              说明：本页为“精简版”汇总视图（避免像旧后台那样一屏上百列）。默认按当前时区口径统计 SUCCESS（代收/代付按 `successAt`，充值按 `creditedAt`）。
            </div>
          </div>
          <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={load} disabled={busy}>
            {busy ? "加载中..." : "刷新"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-[var(--np-faint)]">代收 SUCCESS</div>
            <div className="mt-2 font-mono text-sm text-[var(--np-text)]">{String(totals.cCnt)} 单</div>
            <div className="mt-1 font-mono text-xs text-[var(--np-muted)]">金额 {fmtMoney(totals.cAmt)}</div>
            <div className="mt-1 font-mono text-xs text-[var(--np-muted)]">商户费 {fmtMoney(totals.cFee)} / 渠道费 {fmtMoney(totals.cCh)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-[var(--np-faint)]">代付 SUCCESS</div>
            <div className="mt-2 font-mono text-sm text-[var(--np-text)]">{String(totals.pCnt)} 单</div>
            <div className="mt-1 font-mono text-xs text-[var(--np-muted)]">金额 {fmtMoney(totals.pAmt)}</div>
            <div className="mt-1 font-mono text-xs text-[var(--np-muted)]">商户费 {fmtMoney(totals.pFee)} / 渠道费 {fmtMoney(totals.pCh)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-[var(--np-faint)]">充值 SUCCESS</div>
            <div className="mt-2 font-mono text-sm text-[var(--np-text)]">金额 {fmtMoney(totals.rAmt)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-[var(--np-faint)]">统计口径</div>
            <div className="mt-2 text-xs text-[var(--np-muted)]">时区：{tz}</div>
            <div className="mt-1 text-xs text-[var(--np-muted)]">维度：{groupBy}</div>
            <div className="mt-1 text-xs text-[var(--np-muted)]">区间：{dateFrom} ~ {dateTo}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="grid gap-1">
            <span className="text-xs text-[var(--np-faint)]">维度</span>
            <select className="np-input" value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}>
              <option value="day">按天</option>
              <option value="merchant">按商户</option>
              <option value="payment_app">按支付APP（仅代收有该维度）</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-[var(--np-faint)]">开始日期</span>
            <input className="np-input font-mono" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="YYYY-MM-DD" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-[var(--np-faint)]">结束日期</span>
            <input className="np-input font-mono" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="YYYY-MM-DD" />
          </label>
          <div className="flex items-end gap-2">
            <button className="np-btn px-3 py-2 text-sm" onClick={load} disabled={busy}>
              查询
            </button>
          </div>
        </div>

        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
      </div>

      <div className="np-card p-0 overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
              <tr>
                <th className="px-4 py-3 w-[240px]">{groupBy === "day" ? "日期" : "维度"}</th>
                <th className="px-4 py-3 w-[120px]">代收单数</th>
                <th className="px-4 py-3 w-[160px]">代收金额</th>
                <th className="px-4 py-3 w-[160px]">代收商户费</th>
                <th className="px-4 py-3 w-[160px]">代收渠道费</th>
                <th className="px-4 py-3 w-[120px]">代付单数</th>
                <th className="px-4 py-3 w-[160px]">代付金额</th>
                <th className="px-4 py-3 w-[160px]">代付商户费</th>
                <th className="px-4 py-3 w-[160px]">代付渠道费</th>
                <th className="px-4 py-3 w-[160px]">充值金额</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-white/10">
                  <td className="px-4 py-3">
                    <div className="truncate">{r.label}</div>
                    {groupBy !== "day" ? <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)] break-all">{r.key}</div> : null}
                  </td>
                  <td className="px-4 py-3 font-mono">{String(r.collectSuccessCount ?? 0)}</td>
                  <td className="px-4 py-3 font-mono">{fmtMoney(Number(r.collectSuccessAmount ?? 0))}</td>
                  <td className="px-4 py-3 font-mono">{fmtMoney(Number(r.collectFee ?? 0))}</td>
                  <td className="px-4 py-3 font-mono">{fmtMoney(Number(r.collectChannelFee ?? 0))}</td>
                  <td className="px-4 py-3 font-mono">{String(r.payoutSuccessCount ?? 0)}</td>
                  <td className="px-4 py-3 font-mono">{fmtMoney(Number(r.payoutSuccessAmount ?? 0))}</td>
                  <td className="px-4 py-3 font-mono">{fmtMoney(Number(r.payoutFee ?? 0))}</td>
                  <td className="px-4 py-3 font-mono">{fmtMoney(Number(r.payoutChannelFee ?? 0))}</td>
                  <td className="px-4 py-3 font-mono">{fmtMoney(Number(r.rechargeSuccessAmount ?? 0))}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-[var(--np-muted)]" colSpan={10}>
                    暂无数据
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

