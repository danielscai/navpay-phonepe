"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ListPager } from "@/components/list-kit";
import { useRouter, useSearchParams } from "next/navigation";

type Person = {
  id: string;
  userId?: string | null;
  username?: string | null;
  name: string;
  balance: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
};

type BalanceLog = {
  id: string;
  personId: string;
  delta: string;
  balanceAfter: string;
  reason: string;
  refType?: string | null;
  refId?: string | null;
  createdAtMs: number;
};

type Device = {
  id: string;
  name: string;
  online: boolean;
  lastSeenAtMs?: number | null;
  updatedAtMs: number;
};

type DeviceApp = {
  id: string;
  deviceId: string;
  paymentAppId: string;
  appName?: string | null;
  packageName?: string | null;
  versionCode: number;
  updatedAtMs: number;
};

type BankAccount = {
  id: string;
  bankName: string;
  alias: string;
  accountLast4: string;
  ifsc?: string | null;
  enabled: boolean;
  updatedAtMs: number;
};

type Tx = {
  id: string;
  accountId: string;
  direction: string;
  amount: string;
  ref?: string | null;
  detailsJson?: string | null;
  createdAtMs: number;
};

export default function PaymentPersonDetailClient(props: { personId: string }) {
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [err, setErr] = useState<string | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceApps, setDeviceApps] = useState<DeviceApp[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [txRows, setTxRows] = useState<Tx[]>([]);
  const [txPage, setTxPage] = useState(1);
  const [txPageSize, setTxPageSize] = useState(20);
  const [txTotal, setTxTotal] = useState(0);

  const [balRows, setBalRows] = useState<BalanceLog[]>([]);
  const [balPage, setBalPage] = useState(1);
  const [balPageSize, setBalPageSize] = useState(20);
  const [balTotal, setBalTotal] = useState(0);

  const [loginRows, setLoginRows] = useState<any[]>([]);
  const [loginPage, setLoginPage] = useState(1);
  const [loginPageSize, setLoginPageSize] = useState(20);
  const [loginTotal, setLoginTotal] = useState(0);

  const [reportRows, setReportRows] = useState<any[]>([]);
  const [reportPage, setReportPage] = useState(1);
  const [reportPageSize, setReportPageSize] = useState(20);
  const [reportTotal, setReportTotal] = useState(0);

  const sp = useSearchParams();
  const router = useRouter();
  const activeTab = (sp.get("tab") ?? "account") as string;

  const fmt = (ms: number) => new Date(ms).toLocaleString("zh-CN", { timeZone: timezone, hour12: false });

  async function csrfHeader(): Promise<Record<string, string>> {
    const r = await fetch("/api/csrf");
    const j = await r.json().catch(() => null);
    const token = j?.token as string | undefined;
    return token ? { "x-csrf-token": token } : {};
  }

  async function load() {
    setErr(null);
    const r = await fetch(`/api/admin/payment-persons/${props.personId}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr(r.status === 404 ? "未找到支付个人" : "加载失败");
      return;
    }
    setPerson(j.person ?? null);
    setDevices(j.devices ?? []);
    setDeviceApps(j.deviceApps ?? []);
    setAccounts(j.accounts ?? []);
  }

  async function loadTx() {
    const sp = new URLSearchParams();
    sp.set("page", String(txPage));
    sp.set("pageSize", String(txPageSize));
    const r = await fetch(`/api/admin/payment-persons/${props.personId}/bank-transactions?${sp.toString()}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return;
    setTxRows(j.rows ?? []);
    setTxTotal(Number(j.total ?? 0));
  }

  async function loadBal() {
    const sp = new URLSearchParams();
    sp.set("page", String(balPage));
    sp.set("pageSize", String(balPageSize));
    const r = await fetch(`/api/admin/payment-persons/${props.personId}/balance-logs?${sp.toString()}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return;
    setBalRows(j.rows ?? []);
    setBalTotal(Number(j.total ?? 0));
  }

  async function loadLogin() {
    const sp = new URLSearchParams();
    sp.set("page", String(loginPage));
    sp.set("pageSize", String(loginPageSize));
    const r = await fetch(`/api/admin/payment-persons/${props.personId}/login-logs?${sp.toString()}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return;
    setLoginRows(j.rows ?? []);
    setLoginTotal(Number(j.total ?? 0));
  }

  async function loadReport() {
    const sp = new URLSearchParams();
    sp.set("page", String(reportPage));
    sp.set("pageSize", String(reportPageSize));
    const r = await fetch(`/api/admin/payment-persons/${props.personId}/report-logs?${sp.toString()}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return;
    setReportRows(j.rows ?? []);
    setReportTotal(Number(j.total ?? 0));
  }

  async function setEnabled(enabled: boolean) {
    setErr(null);
    const h = await csrfHeader();
    const r = await fetch(`/api/admin/payment-persons/${props.personId}/enabled`, {
      method: "POST",
      headers: { "content-type": "application/json", ...h },
      body: JSON.stringify({ enabled }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("操作失败");
      return;
    }
    await load();
  }

  useEffect(() => {
    load();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setTimezone(j.timezone);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.personId]);

  useEffect(() => {
    if (activeTab === "tx") loadTx();
    if (activeTab === "balance") loadBal();
    if (activeTab === "login") loadLogin();
    if (activeTab === "report") loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, txPage, txPageSize, balPage, balPageSize, loginPage, loginPageSize, reportPage, reportPageSize]);

  const appsByDevice = useMemo(() => {
    const m = new Map<string, DeviceApp[]>();
    for (const a of deviceApps) {
      const k = String(a.deviceId);
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    return m;
  }, [deviceApps]);

  // Ensure a stable default tab.
  useEffect(() => {
    const ok = ["account", "phones", "bank", "tx", "balance", "login", "report"].includes(activeTab);
    if (ok) return;
    const u = new URL(window.location.href);
    u.searchParams.set("tab", "account");
    router.replace(u.pathname + "?" + u.searchParams.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  return (
    <div className="grid gap-4 overflow-x-hidden">
      <div className="np-card p-2" role="tablist" aria-label="person-detail-tabs">
        <div className="flex flex-wrap gap-2">
          <Link className="np-btn px-3 py-2 text-sm" href="/admin/payout/channels" aria-label="back">
            <span className="inline-flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="font-mono text-sm text-[var(--np-text)] max-w-[220px] truncate">{person?.username ?? "返回"}</span>
            </span>
          </Link>
          {[
            ["account", "账户详情"],
            ["phones", "手机详情"],
            ["bank", "网银账户"],
            ["tx", "网银交易记录"],
            ["balance", "余额变动历史"],
            ["login", "登录记录"],
            ["report", "上报日志"],
          ].map(([key, label]) => {
            const on = activeTab === key;
            const href = `/admin/payout/payment-persons/${props.personId}?tab=${key}`;
            return (
              <Link key={key} href={href} className={["np-btn px-3 py-2 text-sm", on ? "np-btn-primary" : ""].join(" ")}>
                {label}
              </Link>
            );
          })}
        </div>
        {err ? <div className="mt-3 px-2 pb-1 text-sm text-[var(--np-danger)]">{err}</div> : null}
      </div>

      {activeTab === "account" && person ? (
        <div className="np-card p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">用户</div>
              <div className="mt-2 truncate text-sm text-[var(--np-text)]">{person.name}</div>
              <div className="mt-1 font-mono text-xs text-[var(--np-faint)] break-all">{person.username}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">手机</div>
              <div className="mt-2 font-mono text-2xl text-[var(--np-text)]">{devices.length}</div>
              <div className="mt-1 text-xs text-[var(--np-faint)]">台</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">网银账户</div>
              <div className="mt-2 font-mono text-2xl text-[var(--np-text)]">{accounts.length}</div>
              <div className="mt-1 text-xs text-[var(--np-faint)]">个</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">余额</div>
              <div className="mt-2 font-mono text-2xl text-[var(--np-text)]">{person.balance}</div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-[var(--np-faint)]">状态</div>
                  <div className="mt-2 text-xs">{person.enabled ? <span className="np-pill np-pill-ok">启用</span> : <span className="np-pill np-pill-off">停用</span>}</div>
                </div>
                <div className="flex items-center gap-2">
                  {person.enabled ? (
                    <button
                      className="np-btn px-3 py-2 text-xs"
                      onClick={() => {
                        if (!confirm("确认禁用该个人支付渠道？")) return;
                        setEnabled(false);
                      }}
                    >
                      禁用
                    </button>
                  ) : (
                    <button
                      className="np-btn np-btn-primary px-3 py-2 text-xs"
                      onClick={() => {
                        if (!confirm("确认启用该个人支付渠道？")) return;
                        setEnabled(true);
                      }}
                    >
                      启用
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 text-xs text-[var(--np-faint)]">更新 {fmt(person.updatedAtMs)}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">快速入口</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link className="np-btn px-2 py-1 text-xs" href="/admin/resources?tab=devices">
                  资源管理-手机
                </Link>
                <Link className="np-btn px-2 py-1 text-xs" href="/admin/resources?tab=bank_accounts">
                  资源管理-网银
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "phones" ? (
        <div className="np-card p-4">
          <div className="text-sm font-semibold">手机详情</div>
          <div className="mt-3 grid gap-3">
            {!devices.length ? <div className="text-sm text-[var(--np-muted)]">暂无绑定设备</div> : null}
            {devices.map((d) => {
              const apps = appsByDevice.get(String(d.id)) ?? [];
              return (
                <div key={d.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm">{d.name}</div>
                      <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)]">{String(d.id).slice(0, 12)}</div>
                    </div>
                    <div className="text-xs">
                      {d.online ? <span className="np-pill np-pill-ok">在线</span> : <span className="np-pill np-pill-off">离线</span>}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-[var(--np-faint)]">最后心跳 {d.lastSeenAtMs ? fmt(Number(d.lastSeenAtMs)) : "-"}</div>

                  <div className="mt-3 text-xs text-[var(--np-faint)]">已安装支付 App</div>
                  {!apps.length ? (
                    <div className="mt-2 text-sm text-[var(--np-muted)]">暂无安装信息</div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {apps.map((a) => (
                        <span key={a.id} className="np-pill np-pill-info">
                          {(a.appName ?? a.packageName ?? a.paymentAppId) + ` v${a.versionCode}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeTab === "bank" ? (
        <div className="np-card p-4">
          <div className="text-sm font-semibold">网银账户</div>
        {/* Mobile: cards to avoid any horizontal overflow */}
        <div className="mt-3 grid gap-2 md:hidden">
          {accounts.map((a) => (
            <div key={a.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm">{a.bankName}</div>
                  <div className="mt-1 text-xs text-[var(--np-muted)] break-all">{a.alias}</div>
                  <div className="mt-2 font-mono text-[11px] text-[var(--np-faint)]">**** {a.accountLast4}</div>
                </div>
                <div className="text-xs">{a.enabled ? <span className="np-pill np-pill-ok">启用</span> : <span className="np-pill np-pill-off">停用</span>}</div>
              </div>
              <div className="mt-2 text-xs text-[var(--np-faint)]">IFSC {a.ifsc ?? "-"}</div>
              <div className="mt-1 text-xs text-[var(--np-faint)]">更新 {fmt(a.updatedAtMs)}</div>
            </div>
          ))}
          {!accounts.length ? <div className="text-sm text-[var(--np-muted)]">暂无网银账户</div> : null}
        </div>

        {/* Desktop: table with internal scroll */}
        <div className="mt-3 hidden overflow-x-auto rounded-xl border border-white/10 md:block">
          <table className="w-full min-w-0 text-left text-sm table-fixed">
            <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
              <tr>
                <th className="px-3 py-2 w-[160px]">银行</th>
                <th className="px-3 py-2">账户</th>
                <th className="px-3 py-2 w-[160px]">IFSC</th>
                <th className="px-3 py-2 w-[120px]">状态</th>
                <th className="px-3 py-2 w-[180px]">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-white/10">
                  <td className="px-3 py-2">{a.bankName}</td>
                  <td className="px-3 py-2">
                    <div className="text-sm break-all">{a.alias}</div>
                    <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)]">**** {a.accountLast4}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)] break-all">{a.ifsc ?? "-"}</td>
                  <td className="px-3 py-2 text-xs">{a.enabled ? <span className="np-pill np-pill-ok">启用</span> : <span className="np-pill np-pill-off">停用</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{fmt(a.updatedAtMs)}</td>
                </tr>
              ))}
              {!accounts.length ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={5}>
                    暂无网银账户
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        </div>
      ) : null}

      {activeTab === "tx" ? (
        <div className="np-card p-4">
          <div className="text-sm font-semibold">网银交易记录</div>
        <div className="mt-3 grid gap-2 md:hidden">
          {txRows.map((t) => (
            <div key={t.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-[var(--np-muted)]">{fmt(t.createdAtMs)}</div>
                  <div className="mt-2 font-mono text-sm text-[var(--np-text)]">{t.amount}</div>
                  <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)] break-all">ref {t.ref ?? "-"}</div>
                </div>
                <div className="text-xs">{t.direction === "IN" ? <span className="np-pill np-pill-ok">入账</span> : <span className="np-pill np-pill-danger">出账</span>}</div>
              </div>
              <div className="mt-2 font-mono text-[11px] text-[var(--np-faint)] break-all whitespace-normal">
                {(t.detailsJson ?? "").slice(0, 180) || "-"}
              </div>
            </div>
          ))}
          {!txRows.length ? <div className="text-sm text-[var(--np-muted)]">暂无交易记录</div> : null}
        </div>

        <div className="mt-3 hidden overflow-x-auto rounded-xl border border-white/10 md:block">
          <table className="w-full min-w-0 text-left text-sm table-fixed">
            <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
              <tr>
                <th className="px-3 py-2 w-[180px]">时间</th>
                <th className="px-3 py-2 w-[110px]">方向</th>
                <th className="px-3 py-2 w-[140px]">金额</th>
                <th className="px-3 py-2 w-[220px]">Ref</th>
                <th className="px-3 py-2">详情</th>
              </tr>
            </thead>
            <tbody>
              {txRows.map((t) => (
                <tr key={t.id} className="border-t border-white/10">
                  <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{fmt(t.createdAtMs)}</td>
                  <td className="px-3 py-2 text-xs">{t.direction === "IN" ? <span className="np-pill np-pill-ok">入账</span> : <span className="np-pill np-pill-danger">出账</span>}</td>
                  <td className="px-3 py-2 font-mono">{t.amount}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)] break-all">{t.ref ?? "-"}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[var(--np-faint)] break-all whitespace-normal">
                    {(t.detailsJson ?? "").slice(0, 220) || "-"}
                  </td>
                </tr>
              ))}
              {!txRows.length ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={5}>
                    暂无交易记录
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <ListPager
          page={txPage}
          pageSize={txPageSize}
          total={txTotal}
          onPage={(p) => setTxPage(p)}
          onPageSize={(ps) => {
            setTxPage(1);
            setTxPageSize(ps);
          }}
        />
      </div>
      ) : null}

      {activeTab === "balance" ? (
        <div className="np-card p-4">
          <div className="text-sm font-semibold">余额变动历史</div>
        <div className="mt-3 grid gap-2 md:hidden">
          {balRows.map((l) => (
            <div key={l.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-[var(--np-muted)]">{fmt(l.createdAtMs)}</div>
                  <div className="mt-2 font-mono text-sm text-[var(--np-text)]">{l.delta}</div>
                  <div className="mt-1 font-mono text-[11px] text-[var(--np-faint)]">余额 {l.balanceAfter}</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-[var(--np-muted)] break-all">
                {l.reason}
                {l.refType && l.refId ? <span className="ml-2 font-mono text-[10px] text-[var(--np-faint)]">{l.refType}:{l.refId}</span> : null}
              </div>
            </div>
          ))}
          {!balRows.length ? <div className="text-sm text-[var(--np-muted)]">暂无记录</div> : null}
        </div>

        <div className="mt-3 hidden overflow-x-auto rounded-xl border border-white/10 md:block">
          <table className="w-full min-w-0 text-left text-sm table-fixed">
            <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
              <tr>
                <th className="px-3 py-2 w-[200px]">时间</th>
                <th className="px-3 py-2 w-[140px]">变动</th>
                <th className="px-3 py-2 w-[160px]">余额</th>
                <th className="px-3 py-2">原因</th>
              </tr>
            </thead>
            <tbody>
              {balRows.map((l) => (
                <tr key={l.id} className="border-t border-white/10">
                  <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{fmt(l.createdAtMs)}</td>
                  <td className="px-3 py-2 font-mono">{l.delta}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{l.balanceAfter}</td>
                  <td className="px-3 py-2 text-xs text-[var(--np-muted)] break-all whitespace-normal">
                    {l.reason}
                    {l.refType && l.refId ? <span className="ml-2 font-mono text-[10px] text-[var(--np-faint)]">{l.refType}:{l.refId}</span> : null}
                  </td>
                </tr>
              ))}
              {!balRows.length ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={4}>
                    暂无记录
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <ListPager
          page={balPage}
          pageSize={balPageSize}
          total={balTotal}
          onPage={(p) => setBalPage(p)}
          onPageSize={(ps) => {
            setBalPage(1);
            setBalPageSize(ps);
          }}
        />
      </div>
      ) : null}

      {activeTab === "login" ? (
        <div className="np-card p-4">
          <div className="text-sm font-semibold">登录记录</div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-0 text-left text-sm table-fixed">
              <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
                <tr>
                  <th className="px-3 py-2 w-[200px]">时间</th>
                  <th className="px-3 py-2 w-[120px]">事件</th>
                  <th className="px-3 py-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {loginRows.map((l: any) => (
                  <tr key={l.id} className="border-t border-white/10">
                    <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{fmt(Number(l.createdAtMs))}</td>
                    <td className="px-3 py-2 text-xs">{String(l.event)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--np-faint)] break-all">{l.ip ?? "-"}</td>
                  </tr>
                ))}
                {!loginRows.length ? (
                  <tr>
                    <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={3}>
                      暂无记录
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <ListPager
            page={loginPage}
            pageSize={loginPageSize}
            total={loginTotal}
            onPage={(p) => setLoginPage(p)}
            onPageSize={(ps) => {
              setLoginPage(1);
              setLoginPageSize(ps);
            }}
          />
        </div>
      ) : null}

      {activeTab === "report" ? (
        <div className="np-card p-4">
          <div className="text-sm font-semibold">上报日志</div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-0 text-left text-sm table-fixed">
              <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
                <tr>
                  <th className="px-3 py-2 w-[200px]">时间</th>
                  <th className="px-3 py-2 w-[180px]">类型</th>
                  <th className="px-3 py-2">Meta</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((l: any) => (
                  <tr key={l.id} className="border-t border-white/10">
                    <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{fmt(Number(l.createdAtMs))}</td>
                    <td className="px-3 py-2 text-xs font-mono text-[var(--np-muted)]">{String(l.type)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[var(--np-faint)] break-all whitespace-normal">{String(l.metaJson ?? "").slice(0, 240) || "-"}</td>
                  </tr>
                ))}
                {!reportRows.length ? (
                  <tr>
                    <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={3}>
                      暂无记录
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <ListPager
            page={reportPage}
            pageSize={reportPageSize}
            total={reportTotal}
            onPage={(p) => setReportPage(p)}
            onPageSize={(ps) => {
              setReportPage(1);
              setReportPageSize(ps);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
