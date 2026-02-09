"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Person = {
  id: string;
  userId?: string | null;
  username?: string | null;
  name: string;
  balance: string;
  enabled: boolean;
  inviteCode?: string | null;
  inviterPersonId?: string | null;
  inviter?: { id: string; name: string; username: string | null; inviteCode: string | null } | null;
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
  todayRebates?: { rebateL1: string; rebateL2: string; rebateL3: string; rebateTotal: string } | null;
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
  const [hierOpen, setHierOpen] = useState<null | { person: Person; upline: any[] }>(null);

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

  return (
    <div className="np-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">渠道账户列表</div>
        <div className="flex items-center gap-2">
          <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => setCreateOpen(true)} disabled={busy}>
            新增渠道账户
          </button>
        </div>
      </div>

      {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}

      <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-3 py-2">用户名</th>
              <th className="px-3 py-2">名称</th>
              <th className="px-3 py-2">邀请码</th>
              <th className="px-3 py-2">上级</th>
              <th className="px-3 py-2">余额</th>
              <th className="px-3 py-2">今日收益(费)</th>
              <th className="px-3 py-2">今日返利</th>
              <th className="px-3 py-2">直推下线</th>
              <th className="px-3 py-2">最近登录IP</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">更新时间</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-white/10">
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">
                  <Link className="underline" href={`/admin/payout/payment-persons/${p.id}?tab=account`}>
                    {p.username ?? "-"}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <div className="text-sm">{p.name}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{p.inviteCode ?? "-"}</td>
                <td className="px-3 py-2">
                  {p.inviter ? (
                    <button
                      className="np-btn px-2 py-1 text-xs"
                      onClick={async () => {
                        try {
                          const r = await fetch(`/api/admin/payment-persons/${p.id}`);
                          const j = await r.json().catch(() => null);
                          if (r.ok && j?.ok) setHierOpen({ person: p, upline: j.upline ?? (p.inviter ? [p.inviter] : []) });
                          else setHierOpen({ person: p, upline: p.inviter ? [p.inviter] : [] });
                        } catch {
                          setHierOpen({ person: p, upline: p.inviter ? [p.inviter] : [] });
                        }
                      }}
                    >
                      {p.inviter.name}
                    </button>
                  ) : (
                    <span className="text-xs text-[var(--np-faint)]">-</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-base text-[var(--np-text)]">{p.balance}</td>
                <td className="px-3 py-2">
                  <div className="font-mono text-xs text-[var(--np-text)]">{p.todayOrders?.totalFee ?? "0.00"}</div>
                  <div className="mt-1 text-[11px] text-[var(--np-faint)]">
                    代收 {p.todayOrders?.collectCount ?? 0}/{p.todayOrders?.collectFee ?? "0.00"}，代付 {p.todayOrders?.payoutCount ?? 0}/{p.todayOrders?.payoutFee ?? "0.00"}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{p.todayRebates?.rebateTotal ?? "0.00"}</td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{String(p.directDownlineCount ?? 0)}</td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{p.lastLogin?.ip ?? "-"}</td>
                <td className="px-3 py-2 text-xs">{p.enabled ? <span className="np-pill np-pill-ok">启用</span> : <span className="np-pill np-pill-off">停用</span>}</td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{new Date(p.updatedAtMs).toLocaleString("zh-CN", { hour12: false })}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                      <div className="text-[10px] text-[var(--np-faint)]">资金</div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <button className="np-btn px-2 py-1 text-xs" onClick={() => setAdjustOpen({ person: p, op: "credit" })}>
                          送钱
                        </button>
                        <button className="np-btn px-2 py-1 text-xs" onClick={() => setAdjustOpen({ person: p, op: "debit" })}>
                          扣钱
                        </button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                      <div className="text-[10px] text-[var(--np-faint)]">关系</div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <Link className="np-btn px-2 py-1 text-xs" href={`/admin/payout/payment-persons/${p.id}?tab=account`}>
                          详情
                        </Link>
                        <Link className="np-btn px-2 py-1 text-xs" href={`/admin/payout/payment-persons/${p.id}?tab=team`}>
                          下线
                        </Link>
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                      <div className="text-[10px] text-[var(--np-faint)]">导出</div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <a className="np-btn px-2 py-1 text-xs" href={`/api/admin/payment-persons/${p.id}/downlines/export`} target="_blank" rel="noreferrer">
                          导出下线
                        </a>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={12}>
                  暂无支付个人
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {createOpen ? (
        <Modal title="新增渠道账户" onClose={() => setCreateOpen(false)}>
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
        <Modal title="渠道账户已创建" onClose={() => setCreatedCreds(null)}>
          <div className="grid gap-3">
            <div className="text-sm text-[var(--np-muted)]">初始账号信息如下（仅展示一次，请及时发给渠道用户）。</div>
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

      {hierOpen ? (
        <Modal title={`上级链路：${hierOpen.person.username ?? hierOpen.person.name}`} onClose={() => setHierOpen(null)}>
          <div className="grid gap-2">
            {!hierOpen.upline.length ? (
              <div className="text-sm text-[var(--np-muted)]">暂无上级</div>
            ) : (
              hierOpen.upline.map((x: any, idx: number) => (
                <div key={x.id ?? idx} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs text-[var(--np-faint)]">L{idx + 1}</div>
                  <div className="mt-1 text-sm">{x.name}</div>
                  <div className="mt-1 font-mono text-xs text-[var(--np-muted)]">{x.username ?? "-"}</div>
                  <div className="mt-1 font-mono text-xs text-[var(--np-faint)]">邀请码 {x.inviteCode ?? "-"}</div>
                </div>
              ))
            )}
            <div className="flex items-center justify-end">
              <Link className="np-btn px-3 py-2 text-sm" href={`/admin/payout/payment-persons/${hierOpen.person.id}?tab=team`}>
                查看下线
              </Link>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
