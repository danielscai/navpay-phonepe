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
  const [createdCreds, setCreatedCreds] = useState<{ username: string; password: string } | null>(null);

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
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        if (j?.error === "username_taken") setErr("用户名已存在");
        else if (typeof j?.error === "string" && j.error.includes("密码")) setErr(j.error);
        else setErr("创建失败");
        return;
      }
      setCreateOpen(false);
      setCreatedCreds({ username: String(j.username ?? ""), password: String(j.password ?? "") });
      setNewName("");
      setNewBalance("0.00");
      setNewUsername("");
      setNewPassword("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="np-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">个人支付渠道列表</div>
        <div className="flex items-center gap-2">
          <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => setCreateOpen(true)} disabled={busy}>
            新增个人支付渠道
          </button>
        </div>
      </div>

      {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}

      <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-3 py-2">用户名</th>
              <th className="px-3 py-2">名称</th>
              <th className="px-3 py-2">余额</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">更新时间</th>
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
                <td className="px-3 py-2 font-mono text-base text-[var(--np-text)]">{p.balance}</td>
                <td className="px-3 py-2 text-xs">{p.enabled ? <span className="np-pill np-pill-ok">启用</span> : <span className="np-pill np-pill-off">停用</span>}</td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{new Date(p.updatedAtMs).toLocaleString("zh-CN", { hour12: false })}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={5}>
                  暂无支付个人
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {createOpen ? (
        <Modal title="新增支付个人" onClose={() => setCreateOpen(false)}>
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">名称</span>
              <input className="np-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如: 张三" />
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
              <input className="np-input font-mono" value={newBalance} onChange={(e) => setNewBalance(e.target.value)} placeholder="0.00" />
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
        <Modal title="支付个人账号已创建" onClose={() => setCreatedCreds(null)}>
          <div className="grid gap-3">
            <div className="text-sm text-[var(--np-muted)]">初始账号信息如下（仅展示一次，请及时发给支付个人）。</div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">用户名</div>
              <div className="mt-1 font-mono text-sm text-[var(--np-text)] break-all">{createdCreds.username || "-"}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-[var(--np-faint)]">初始密码</div>
              <div className="mt-1 font-mono text-sm text-[var(--np-text)] break-all">{createdCreds.password || "-"}</div>
            </div>
            <div className="flex items-center justify-end">
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => setCreatedCreds(null)}>
                我已记录
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
