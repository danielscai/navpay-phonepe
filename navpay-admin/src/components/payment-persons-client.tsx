"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";

type Person = {
  id: string;
  userId?: string | null;
  username?: string | null;
  name: string;
  balance: string;
  enabled: boolean;
  directDownlineCount?: number;
  lastLogin?: { ip: string | null; atMs: number } | null;
  todayOrders?: {
    collectCount: number;
    collectFee: string;
    payoutCount: number;
    payoutFee: string;
    totalCount: number;
    totalFee: string;
  } | null;
  createdAtMs: number;
  updatedAtMs: number;
};

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

export default function PaymentPersonsClient() {
  const [rows, setRows] = useState<Person[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("0.00");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newInviterCode, setNewInviterCode] = useState("");
  const [createdCreds, setCreatedCreds] = useState<{ username: string; password: string; inviteCode: string } | null>(null);

  const [adjustOpen, setAdjustOpen] = useState<null | { person: Person; op: "credit" | "debit" }>(null);
  const [adjustAmount, setAdjustAmount] = useState("0.00");
  const [adjustReason, setAdjustReason] = useState("");
  const [actionOpenId, setActionOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [desktopMenu, setDesktopMenu] = useState<
    | null
    | {
        person: Person;
        anchor: { left: number; top: number; right: number; bottom: number };
        top: number;
        left: number;
        maxH: number;
      }
  >(null);

  useLayoutEffect(() => {
    if (!desktopMenu) return;
    const el = menuRef.current;
    if (!el) return;
    const menuW = 260;
    const pad = 8;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const maxH = Math.max(160, vh - pad * 2);
    const h = Math.min(el.getBoundingClientRect().height, maxH);

    // Prefer opening below; if it would overflow, flip above; otherwise clamp.
    const down = desktopMenu.anchor.bottom + gap;
    const up = desktopMenu.anchor.top - gap - h;
    let top = down;
    if (down + h + pad > vh) {
      top = up >= pad ? up : Math.max(pad, vh - h - pad);
    }

    // Align to the button's left edge; clamp into viewport.
    let left = desktopMenu.anchor.left;
    left = Math.min(Math.max(pad, left), vw - menuW - pad);

    // Avoid endless re-render loops.
    if (top === desktopMenu.top && left === desktopMenu.left && maxH === desktopMenu.maxH) return;
    setDesktopMenu((cur) => (cur ? { ...cur, top, left, maxH } : cur));
  }, [desktopMenu?.person.id, desktopMenu?.anchor.left, desktopMenu?.anchor.top, desktopMenu?.anchor.right, desktopMenu?.anchor.bottom]);

  useEffect(() => {
    if (!desktopMenu) return;
    const close = () => setDesktopMenu(null);
    window.addEventListener("resize", close);
    // If the user scrolls, the stored anchor rect becomes stale; close instead of mis-positioning.
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [desktopMenu]);

  async function load() {
    setErr(null);
    const r = await fetch("/api/admin/payment-persons");
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

  async function doCreate() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/payment-persons", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({
          name: newName,
          balance: newBalance,
          username: newUsername.trim() ? newUsername.trim() : undefined,
          password: newPassword.trim() ? newPassword.trim() : undefined,
          inviterCode: newInviterCode.trim() ? newInviterCode.trim().toUpperCase() : undefined,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        if (j?.error === "username_taken") setErr("用户名已存在");
        else if (j?.error === "invalid_invite_code") setErr("邀请码无效");
        else if (typeof j?.error === "string" && j.error.includes("密码")) setErr(j.error);
        else setErr("创建失败");
        return;
      }
      setCreateOpen(false);
      setCreatedCreds({ username: String(j.username ?? ""), password: String(j.password ?? ""), inviteCode: String(j.inviteCode ?? "") });
      setNewName("");
      setNewBalance("0.00");
      setNewUsername("");
      setNewPassword("");
      setNewInviterCode("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function doAdjust() {
    if (!adjustOpen) return;
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/payment-persons/${adjustOpen.person.id}/balance/adjust`, {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({
          op: adjustOpen.op,
          amount: adjustAmount,
          reason: adjustReason,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        if (j?.error === "insufficient_balance") setErr("余额不足，不能扣到负数");
        else setErr("操作失败");
        return;
      }
      setAdjustOpen(null);
      setAdjustAmount("0.00");
      setAdjustReason("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const canPortal = typeof document !== "undefined";

  return (
    <div className="np-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">支付账户列表</div>
        <div className="flex items-center gap-2">
          <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => setCreateOpen(true)} disabled={busy}>
            新增支付账户
          </button>
        </div>
      </div>

      {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}

      {/* Mobile: cards to avoid horizontal overflow */}
      <div className="mt-3 grid gap-2 lg:hidden">
        {rows.map((p) => (
          <div key={p.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link className="block font-mono text-xs text-[var(--np-muted)] underline break-all" href={`/admin/payout/payment-persons/${p.id}?tab=account`}>
                  {p.username ?? "-"}
                </Link>
                <div className="mt-1 text-sm">{p.name}</div>
              </div>
              <div className="text-right">
                {p.enabled ? <span className="np-pill np-pill-ok">启用</span> : <span className="np-pill np-pill-off">停用</span>}
                <div className="mt-2">
                  <button
                    className="np-btn px-3 py-2 text-xs"
                    onClick={() => setActionOpenId((v) => (v === p.id ? null : p.id))}
                    aria-haspopup="menu"
                    aria-expanded={actionOpenId === p.id}
                  >
                    操作
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--np-muted)]">
              <div>
                <div className="text-[var(--np-faint)]">余额</div>
                <div className="mt-1 font-mono text-sm text-[var(--np-text)]">{p.balance}</div>
              </div>
              <div>
                <div className="text-[var(--np-faint)]">今日收益(India)</div>
                <div className="mt-1 font-mono text-sm text-[var(--np-text)]">{p.todayOrders?.totalFee ?? "0.00"}</div>
              </div>
              <div>
                <div className="text-[var(--np-faint)]">直推下线</div>
                <div className="mt-1 font-mono text-sm">{String(p.directDownlineCount ?? 0)}</div>
              </div>
            </div>

            {actionOpenId === p.id ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-[var(--np-surface)] p-3" role="menu">
                <div className="grid gap-2">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    <div className="text-[10px] text-[var(--np-faint)]">资金</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className="np-btn px-2 py-1 text-xs" onClick={() => { setActionOpenId(null); setAdjustOpen({ person: p, op: "credit" }); }}>
                        送钱
                      </button>
                      <button className="np-btn px-2 py-1 text-xs" onClick={() => { setActionOpenId(null); setAdjustOpen({ person: p, op: "debit" }); }}>
                        扣钱
                      </button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    <div className="text-[10px] text-[var(--np-faint)]">关系</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link className="np-btn px-2 py-1 text-xs" href={`/admin/payout/payment-persons/${p.id}?tab=account`} onClick={() => setActionOpenId(null)}>
                        详情
                      </Link>
                      <Link className="np-btn px-2 py-1 text-xs" href={`/admin/payout/payment-persons/${p.id}?tab=team`} onClick={() => setActionOpenId(null)}>
                        下线
                      </Link>
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    <div className="text-[10px] text-[var(--np-faint)]">导出</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <a className="np-btn px-2 py-1 text-xs" href={`/api/admin/payment-persons/${p.id}/downlines/export`} target="_blank" rel="noreferrer" onClick={() => setActionOpenId(null)}>
                        导出下线
                      </a>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button className="np-btn px-3 py-2 text-xs" onClick={() => setActionOpenId(null)}>
                      收起
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {!rows.length ? <div className="text-sm text-[var(--np-muted)]">暂无支付账户</div> : null}
      </div>

      {/* Desktop: compact table. Keep within viewport; no "min-w" that forces body overflow. */}
      <div className="mt-3 hidden overflow-hidden rounded-xl border border-white/10 lg:block">
        <table className="w-full min-w-0 text-left text-sm table-fixed">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-3 py-2 w-[160px]">用户名</th>
              <th className="px-3 py-2">名称</th>
              <th className="px-3 py-2 w-[96px]">余额</th>
              <th className="px-3 py-2 w-[110px]">今日收益</th>
              <th className="px-3 py-2 w-[80px]">下线</th>
              <th className="px-3 py-2 w-[80px]">状态</th>
              <th className="px-3 py-2 w-[80px]">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-white/10">
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">
                  <Link className="underline break-all" href={`/admin/payout/payment-persons/${p.id}?tab=account`}>
                    {p.username ?? "-"}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <div className="truncate">{p.name}</div>
                </td>
                <td className="px-3 py-2 font-mono">{p.balance}</td>
                <td className="px-3 py-2 font-mono">{p.todayOrders?.totalFee ?? "0.00"}</td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{String(p.directDownlineCount ?? 0)}</td>
                <td className="px-3 py-2 text-xs">{p.enabled ? <span className="np-pill np-pill-ok">启用</span> : <span className="np-pill np-pill-off">停用</span>}</td>
                <td className="px-3 py-2">
                  <div className="relative z-20 inline-block">
                    <button
                      className="np-btn px-3 py-2 text-xs"
                      onClick={(e) => {
                        const el = e.currentTarget as HTMLButtonElement;
                        const r = el.getBoundingClientRect();
                        const menuW = 260;
                        const pad = 8;
                        const left = Math.min(Math.max(pad, r.left), window.innerWidth - menuW - pad);
                        const top = r.bottom + 8;
                        setDesktopMenu((cur) =>
                          cur?.person.id === p.id
                            ? null
                            : {
                                person: p,
                                anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
                                top,
                                left,
                                maxH: Math.max(160, window.innerHeight - pad * 2),
                              },
                        );
                      }}
                      aria-haspopup="menu"
                      aria-expanded={desktopMenu?.person.id === p.id}
                    >
                      操作
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={7}>
                  暂无支付账户
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {desktopMenu && canPortal
        ? createPortal(
            <>
              <button
                className="fixed inset-0 z-40 cursor-default bg-transparent"
                aria-label="close-desktop-menu"
                onClick={() => setDesktopMenu(null)}
              />
              <div
                className="fixed z-50 w-[260px] overflow-hidden rounded-xl border border-white/10 bg-[var(--np-surface)] shadow-lg"
                role="menu"
                style={{ top: desktopMenu.top, left: desktopMenu.left, maxHeight: desktopMenu.maxH }}
                ref={menuRef}
              >
                <div className="p-2 grid gap-2 overflow-auto">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    <div className="text-[10px] text-[var(--np-faint)]">资金</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        className="np-btn px-2 py-1 text-xs"
                        onClick={() => {
                          const p = desktopMenu.person;
                          setDesktopMenu(null);
                          setAdjustOpen({ person: p, op: "credit" });
                        }}
                      >
                        送钱
                      </button>
                      <button
                        className="np-btn px-2 py-1 text-xs"
                        onClick={() => {
                          const p = desktopMenu.person;
                          setDesktopMenu(null);
                          setAdjustOpen({ person: p, op: "debit" });
                        }}
                      >
                        扣钱
                      </button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    <div className="text-[10px] text-[var(--np-faint)]">关系</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link
                        className="np-btn px-2 py-1 text-xs"
                        href={`/admin/payout/payment-persons/${desktopMenu.person.id}?tab=account`}
                        onClick={() => setDesktopMenu(null)}
                      >
                        详情
                      </Link>
                      <Link
                        className="np-btn px-2 py-1 text-xs"
                        href={`/admin/payout/payment-persons/${desktopMenu.person.id}?tab=team`}
                        onClick={() => setDesktopMenu(null)}
                      >
                        下线
                      </Link>
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    <div className="text-[10px] text-[var(--np-faint)]">导出</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <a
                        className="np-btn px-2 py-1 text-xs"
                        href={`/api/admin/payment-persons/${desktopMenu.person.id}/downlines/export`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setDesktopMenu(null)}
                      >
                        导出下线
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </>,
            document.body,
          )
        : null}

      {createOpen ? (
        <Modal title="新增支付账户" onClose={() => setCreateOpen(false)}>
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">名称</span>
              <input id="pp-create-name" className="np-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如: 张三" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">上级邀请码（可选）</span>
              <input id="pp-create-inviter" className="np-input font-mono uppercase" value={newInviterCode} onChange={(e) => setNewInviterCode(e.target.value)} placeholder="例如: A1B2C3" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">用户名（可选，不填随机生成）</span>
              <input className="np-input font-mono" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="例如: pp_zhangsan" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">密码（可选，不填随机生成）</span>
              <input className="np-input font-mono" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="留空则自动生成强密码" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">初始余额</span>
              <input id="pp-create-balance" className="np-input font-mono" value={newBalance} onChange={(e) => setNewBalance(e.target.value)} placeholder="0.00" />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button className="np-btn px-3 py-2 text-sm" onClick={() => setCreateOpen(false)} disabled={busy}>
                取消
              </button>
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={doCreate} disabled={busy || !newName.trim()}>
                {busy ? "处理中..." : "创建"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {createdCreds ? (
        <Modal title="支付账户已创建" onClose={() => setCreatedCreds(null)}>
          <div className="grid gap-3">
            <div className="text-sm text-[var(--np-muted)]">初始账号信息如下（仅展示一次，请及时记录并交付给该支付账户用户）。</div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">用户名</div>
              <div className="mt-1 font-mono text-sm text-[var(--np-text)] break-all">{createdCreds.username || "-"}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">初始密码</div>
              <div className="mt-1 font-mono text-sm text-[var(--np-text)] break-all">{createdCreds.password || "-"}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">邀请码（给下线注册/绑定用）</div>
              <div className="mt-1 font-mono text-sm text-[var(--np-text)] break-all">{createdCreds.inviteCode || "-"}</div>
            </div>
            <div className="flex items-center justify-end">
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => setCreatedCreds(null)}>
                我已记录
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {adjustOpen ? (
        <Modal
          title={`${adjustOpen.op === "credit" ? "送钱" : "扣钱"}：${adjustOpen.person.username ?? adjustOpen.person.name}`}
          onClose={() => setAdjustOpen(null)}
        >
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">金额</span>
              <input className="np-input font-mono" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder="例如: 10.00" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">原因（必填，会记录）</span>
              <input className="np-input" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="例如: 手工补差" />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button className="np-btn px-3 py-2 text-sm" onClick={() => setAdjustOpen(null)} disabled={busy}>
                取消
              </button>
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={doAdjust} disabled={busy || !adjustReason.trim() || !adjustAmount.trim()}>
                {busy ? "处理中..." : "确认"}
              </button>
            </div>
            <div className="text-xs text-[var(--np-faint)]">扣钱不允许扣到负数。</div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
