"use client";

import { useEffect, useState } from "react";
import PasskeyStepUpModal from "@/components/passkey-stepup-modal";

type Row = { id: string; ip: string; note?: string | null; enabled: boolean; createdAtMs: number };

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

export default function MerchantIpWhitelistClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [ip, setIp] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [afterStepUp, setAfterStepUp] = useState<null | (() => Promise<void>)>(null);

  async function load() {
    setErr(null);
    const r = await fetch("/api/merchant/ip-whitelist");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载失败");
      return;
    }
    setRows((j.rows ?? []) as Row[]);
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/merchant/ip-whitelist", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ ip: ip.trim(), note: note.trim() || undefined, enabled: true }),
      });
      const j = await r.json().catch(() => null);
      if (r.status === 403 && j?.error === "step_up_required") {
        setAfterStepUp(() => add);
        setStepUpOpen(true);
        return;
      }
      if (!r.ok || !j?.ok) {
        setErr(j?.error === "duplicate_ip" ? "IP 已存在" : "新增失败");
        return;
      }
      setIp("");
      setNote("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: any) {
    const h = await csrfHeader();
    const r = await fetch(`/api/merchant/ip-whitelist/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...h },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (r.status === 403 && j?.error === "step_up_required") {
      setAfterStepUp(() => async () => patch(id, body));
      setStepUpOpen(true);
      return;
    }
    if (!r.ok || !j?.ok) throw new Error("patch_failed");
  }

  async function del(id: string) {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/merchant/ip-whitelist/${id}`, { method: "DELETE", headers: { ...h } });
      const j = await r.json().catch(() => null);
      if (r.status === 403 && j?.error === "step_up_required") {
        setAfterStepUp(() => async () => del(id));
        setStepUpOpen(true);
        return;
      }
      if (!r.ok || !j?.ok) {
        setErr("删除失败");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      {err ? <div className="text-sm text-[var(--np-danger)]">{err}</div> : null}

      <div className="np-card p-4">
        <div className="text-xs text-[var(--np-faint)]">说明</div>
        <div className="mt-2 text-sm text-[var(--np-muted)]">
          当白名单中存在至少 1 条启用记录时，平台的 Merchant API（`/api/v1/*`）将只允许来自白名单 IP 的请求。
        </div>
      </div>

      <div className="np-card p-4">
        <div className="text-xs text-[var(--np-faint)]">新增 IP</div>
        <div className="mt-3 grid gap-3 md:grid-cols-[240px_1fr_auto]">
          <input className="np-input" placeholder="例如 1.2.3.4" value={ip} onChange={(e) => setIp(e.target.value)} />
          <input className="np-input" placeholder="备注（可选）" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="np-btn np-btn-primary px-4 py-2 text-sm" onClick={add} disabled={busy || !ip.trim()}>
            新增
          </button>
        </div>
      </div>

      <div className="np-card p-4">
        <div className="text-xs text-[var(--np-faint)]">当前白名单</div>
        <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
              <tr>
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">备注</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/10">
                  <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">{r.ip}</td>
                  <td className="px-3 py-2">
                    <input
                      className="np-input w-full"
                      value={r.note ?? ""}
                      onChange={(e) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, note: e.target.value } : x)))}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className={["np-pill", r.enabled ? "np-pill-ok" : "np-pill-off"].join(" ")}>{r.enabled ? "启用" : "停用"}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        className="np-btn px-2 py-1 text-xs"
                        onClick={async () => {
                          setBusy(true);
                          setErr(null);
                          try {
                            await patch(r.id, { enabled: !r.enabled });
                            await load();
                          } catch {
                            setErr("更新失败");
                          } finally {
                            setBusy(false);
                          }
                        }}
                        disabled={busy}
                      >
                        {r.enabled ? "停用" : "启用"}
                      </button>
                      <button
                        className="np-btn px-2 py-1 text-xs"
                        onClick={async () => {
                          setBusy(true);
                          setErr(null);
                          try {
                            const cur = rows.find((x) => x.id === r.id);
                            await patch(r.id, { note: (cur?.note ?? "").trim() || null });
                            await load();
                          } catch {
                            setErr("保存失败");
                          } finally {
                            setBusy(false);
                          }
                        }}
                        disabled={busy}
                      >
                        保存备注
                      </button>
                      <button className="np-btn px-2 py-1 text-xs" onClick={() => del(r.id)} disabled={busy}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={4}>
                    暂无数据
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <PasskeyStepUpModal
        open={stepUpOpen}
        onClose={() => {
          setStepUpOpen(false);
          setAfterStepUp(null);
        }}
        onVerified={async () => {
          const fn = afterStepUp;
          setAfterStepUp(null);
          if (fn) await fn();
        }}
        title="修改 IP 白名单"
        description="修改 IP 白名单属于敏感操作，需要验证 Passkey。"
      />
    </div>
  );
}
