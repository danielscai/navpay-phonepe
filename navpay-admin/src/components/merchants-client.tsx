"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ListPager, ListToolbar } from "@/components/list-kit";

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

type Me = { perms: string[] };
type ApiKey = { keyId: string; secret: string; secretPrefix?: string; createdAtMs?: number };
type MerchantUserCred = { username: string; password: string };

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
      <div className={["relative z-10 w-full", maxWidthClass ?? "max-w-[900px]"].join(" ")}>
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

export default function MerchantsClient() {
  const [rows, setRows] = useState<MerchantRow[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [createCode, setCreateCode] = useState("M" + String(Math.floor(Math.random() * 9000 + 1000)));
  const [createName, setCreateName] = useState("新商户");
  const [createMerchantUsername, setCreateMerchantUsername] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<ApiKey | null>(null);
  const [createdMerchantUser, setCreatedMerchantUser] = useState<MerchantUserCred | null>(null);

  async function load() {
    setErr(null);
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    const r = await fetch(`/api/admin/merchants?${sp.toString()}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载失败");
      return;
    }
    setRows(j.rows ?? []);
    setTotal(Number(j.total ?? 0));
  }

  async function loadMe() {
    const r = await fetch("/api/admin/me");
    const j = await r.json().catch(() => null);
    if (r.ok && j?.ok) setMe({ perms: j.perms ?? [] });
  }

  useEffect(() => {
    load();
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const canWrite = hasPerm(me?.perms, "merchant.write");

  async function createMerchant() {
    setCreateBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/merchants", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({
          code: createCode.trim(),
          name: createName.trim(),
          ...(createMerchantUsername.trim() ? { merchantUsername: createMerchantUsername.trim() } : {}),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.error === "duplicate_merchant_username" ? "创建失败：商户登录用户名已存在" : "创建失败（可能商户号重复）");
        return;
      }
      const k = j?.apiKey as any;
      setCreatedApiKey(k && typeof k.keyId === "string" && typeof k.secret === "string" ? { keyId: k.keyId, secret: k.secret } : null);
      const u = j?.merchantUser as any;
      setCreatedMerchantUser(u && typeof u.username === "string" && typeof u.password === "string" ? { username: u.username, password: u.password } : null);
      setCreateOpen(false);
      setCreateCode("M" + String(Math.floor(Math.random() * 9000 + 1000)));
      setCreateName("新商户");
      setCreateMerchantUsername("");
      await load();
    } finally {
      setCreateBusy(false);
    }
  }

  async function toggleEnabled(m: MerchantRow) {
    if (!canWrite) return;
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/merchants/${m.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ enabled: !m.enabled }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error("patch_failed");
      await load();
    } catch {
      setErr("更新失败");
    }
  }

  const enabledCount = useMemo(() => rows.filter((r) => r.enabled).length, [rows]);

  return (
    <div>
      <ListToolbar
        left={
          <div className="flex flex-wrap items-center gap-3">
            <input
              className="np-input w-full md:w-[320px]"
              placeholder="搜索商户号/名称"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="text-xs text-[var(--np-faint)]">当前页 {rows.length} 个，启用 {enabledCount} 个</div>
          </div>
        }
        right={
          <>
            <button
              className="np-btn px-3 py-2 text-sm"
              onClick={() => {
                setPage(1);
                load();
              }}
            >
              查询
            </button>
            {canWrite ? (
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => setCreateOpen(true)}>
                新增商户
              </button>
            ) : null}
          </>
        }
        error={err}
      />

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-4 py-3">商户号</th>
              <th className="px-4 py-3">名称</th>
              <th className="px-4 py-3">余额</th>
              <th className="px-4 py-3">代付冻结</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-white/10">
                <td className="px-4 py-3 font-mono text-xs text-[var(--np-muted)]">{m.code}</td>
                <td className="px-4 py-3">{m.name}</td>
                <td className="px-4 py-3">{m.balance}</td>
                <td className="px-4 py-3">{m.payoutFrozen}</td>
                <td className="px-4 py-3">
                  <span className={["np-pill", m.enabled ? "np-pill-ok" : "np-pill-off"].join(" ")}>
                    {m.enabled ? "启用" : "停用"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Link className="np-btn px-2 py-1 text-xs" href={`/admin/merchants/${m.id}`}>
                      管理
                    </Link>
                    {canWrite ? (
                      <button className="np-btn px-2 py-1 text-xs" onClick={() => toggleEnabled(m)}>
                        {m.enabled ? "停用" : "启用"}
                      </button>
                    ) : null}
                  </div>
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

      <Modal
        open={createOpen}
        title="新增商户"
        onClose={() => {
          if (!createBusy) setCreateOpen(false);
        }}
        maxWidthClass="max-w-[520px]"
      >
        <div className="np-card p-4">
          <div className="text-sm font-semibold">基础信息</div>
          <div className="mt-1 text-sm text-[var(--np-muted)]">创建后可在“管理”中配置费率与限额规则。</div>
          <div className="mt-4 grid gap-3">
            <div>
              <div className="text-xs text-[var(--np-faint)]">商户号</div>
              <div className="mt-2 flex flex-nowrap gap-2">
                <input
                  className="np-input min-w-0 w-full"
                  value={createCode}
                  onChange={(e) => setCreateCode(e.target.value)}
                  placeholder="如 M1001"
                />
                <button
                  className="np-btn shrink-0 px-3 py-2 text-sm"
                  onClick={() => setCreateCode("M" + String(Math.floor(Math.random() * 9000 + 1000)))}
                  type="button"
                >
                  <span className="inline-flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M20 12a8 8 0 1 1-2.34-5.66"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <path
                        d="M20 4v6h-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    随机
                  </span>
                </button>
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--np-faint)]">商户名称</div>
              <input
                className="np-input mt-2 w-full"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="如 某某商户"
              />
            </div>
            <div>
              <div className="text-xs text-[var(--np-faint)]">商户后台用户名（可选）</div>
              <div className="mt-1 text-xs text-[var(--np-faint)]">不填则自动使用商户号作为用户名。</div>
              <input
                className="np-input mt-2 w-full"
                value={createMerchantUsername}
                onChange={(e) => setCreateMerchantUsername(e.target.value)}
                placeholder="例如 mch_M1001 / merchant_xxx"
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="np-btn px-3 py-2 text-sm" onClick={() => setCreateOpen(false)} disabled={createBusy}>
            取消
          </button>
          <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={createMerchant} disabled={createBusy}>
            {createBusy ? "创建中..." : "创建"}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!createdApiKey || !!createdMerchantUser}
        title="商户已创建：请保存登录账号与 API Key（仅此处展示）"
        onClose={() => {
          setCreatedApiKey(null);
          setCreatedMerchantUser(null);
        }}
        maxWidthClass="max-w-[720px]"
      >
        <div className="np-card p-4">
          <div className="text-sm text-[var(--np-muted)]">请将以下信息交付给商户：用于登录商户后台 + 调用 Merchant API。</div>

          {createdMerchantUser ? (
            <div className="mt-4">
              <div className="text-xs text-[var(--np-faint)]">商户后台登录</div>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs text-[var(--np-faint)]">用户名</div>
                  <div className="mt-2 font-mono text-xs text-[var(--np-muted)] break-all">{createdMerchantUser.username}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs text-[var(--np-faint)]">随机密码</div>
                  <div className="mt-2 font-mono text-xs text-[var(--np-muted)] break-all">{createdMerchantUser.password}</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-[var(--np-faint)]">商户首次登录会强制绑定 2FA。</div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">Key ID</div>
              <div className="mt-2 font-mono text-xs text-[var(--np-muted)] break-all">{createdApiKey?.keyId ?? ""}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">Secret</div>
              <div className="mt-2 font-mono text-xs text-[var(--np-muted)] break-all">{createdApiKey?.secret ?? ""}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-[var(--np-faint)]">建议商户同时配置 IP 白名单提升安全性。</div>
        </div>
      </Modal>
    </div>
  );
}
