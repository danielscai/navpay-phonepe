"use client";

import { useEffect, useMemo, useState } from "react";

type Receiver = { id: string; name: string; createdAtMs: number };
type EventRow = { id: string; headersJson: string; body: string; createdAtMs: number };

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

export default function WebhookSimulatorClient() {
  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [name, setName] = useState("Demo Receiver");
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function loadReceivers() {
    const r = await fetch("/api/admin/webhooks/receivers");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载失败");
      return;
    }
    setReceivers(j.rows ?? []);
    if (!selected && j.rows?.length) setSelected(j.rows[0].id);
  }

  async function loadEvents(receiverId: string) {
    const r = await fetch(`/api/admin/webhooks/receivers/${receiverId}/events`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载事件失败");
      return;
    }
    setEvents(j.rows ?? []);
  }

  useEffect(() => {
    loadReceivers();
  }, []);

  useEffect(() => {
    if (selected) loadEvents(selected);
  }, [selected]);

  async function createReceiver() {
    setErr(null);
    const h = await csrfHeader();
    const r = await fetch("/api/admin/webhooks/receivers", {
      method: "POST",
      headers: { "content-type": "application/json", ...h },
      body: JSON.stringify({ name }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("创建失败");
      return;
    }
    await loadReceivers();
    setSelected(j.id);
  }

  const receiveUrl = useMemo(() => {
    if (!selected) return null;
    return `${location.origin}/api/webhook/receive/${selected}`;
  }, [selected]);

  async function deleteReceiver(receiverId: string) {
    if (!confirm("确认删除该 Webhook 接收器？将同时删除其事件记录。")) return;
    setErr(null);
    const h = await csrfHeader();
    const r = await fetch(`/api/admin/webhooks/receivers/${receiverId}`, { method: "DELETE", headers: { ...h } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("删除失败");
      return;
    }
    setSelected(null);
    setEvents([]);
    await loadReceivers();
  }

  return (
    <div>
      {err ? <div className="mt-4 text-sm text-[var(--np-danger)]">{err}</div> : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="np-card p-4">
          <div className="text-xs text-[var(--np-faint)]">说明</div>
          <div className="mt-2 text-sm text-[var(--np-muted)]">
            用于模拟商户回调接收端。订单回调可以配置到接收 URL，并在此查看收到的 payload。
          </div>
          <div className="mt-4 text-xs text-[var(--np-faint)]">创建接收器</div>
          <input className="np-input mt-2 w-full" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="np-btn np-btn-primary mt-3 w-full" onClick={createReceiver}>
            创建
          </button>
        </div>

        <div className="np-card p-4 md:col-span-2">
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-[var(--np-faint)]">接收器</div>
            <div className="flex items-center gap-2">
              {selected ? (
                <button className="np-btn px-3 py-2 text-xs" onClick={() => deleteReceiver(selected)}>
                  删除
                </button>
              ) : null}
              <button className="np-btn px-3 py-2 text-xs" onClick={() => selected && loadEvents(selected)}>
                刷新事件
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {receivers.map((r) => (
              <button
                key={r.id}
                className={["np-btn text-xs", selected === r.id ? "np-btn-primary" : ""].join(" ")}
                onClick={() => setSelected(r.id)}
              >
                {r.name}
              </button>
            ))}
            {!receivers.length ? (
              <div className="text-sm text-[var(--np-muted)]">暂无接收器</div>
            ) : null}
          </div>

          {receiveUrl ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 font-mono text-xs text-[var(--np-muted)] break-all">
              {receiveUrl}
            </div>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
                <tr>
                  <th className="px-3 py-2">时间</th>
                  <th className="px-3 py-2">Body</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-white/10">
                    <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)]">
                      {new Date(e.createdAtMs).toISOString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--np-muted)] break-all">
                      {e.body.slice(0, 260)}
                    </td>
                  </tr>
                ))}
                {!events.length ? (
                  <tr>
                    <td className="px-3 py-4 text-sm text-[var(--np-muted)]" colSpan={2}>
                      暂无事件
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
