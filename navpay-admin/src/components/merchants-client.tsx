"use client";

import { useEffect, useMemo, useState } from "react";

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

type MerchantFees = {
  merchantId: string;
  collectFeeRateBps: number;
  payoutFeeRateBps: number;
  minFee: string;
  updatedAtMs: number;
};

type LimitRule = {
  id: string;
  merchantId: string;
  type: "collect" | "payout";
  minAmount: string;
  maxAmount: string;
  dailyCountLimit: number;
  enabled: boolean;
  note?: string | null;
  createdAtMs: number;
};

type Me = { perms: string[] };

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

  const [createOpen, setCreateOpen] = useState(false);
  const [createCode, setCreateCode] = useState("M" + String(Math.floor(Math.random() * 9000 + 1000)));
  const [createName, setCreateName] = useState("新商户");
  const [createBusy, setCreateBusy] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editMerchantId, setEditMerchantId] = useState<string | null>(null);
  const [editMerchant, setEditMerchant] = useState<MerchantRow | null>(null);
  const [editFees, setEditFees] = useState<MerchantFees | null>(null);
  const [editRules, setEditRules] = useState<LimitRule[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const [newRuleType, setNewRuleType] = useState<LimitRule["type"]>("collect");
  const [newRuleMin, setNewRuleMin] = useState("0");
  const [newRuleMax, setNewRuleMax] = useState("0");
  const [newRuleDaily, setNewRuleDaily] = useState("0");
  const [newRuleNote, setNewRuleNote] = useState("");

  async function load() {
    setErr(null);
    const r = await fetch("/api/admin/merchants");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载失败");
      return;
    }
    setRows(j.rows ?? []);
  }

  async function loadMe() {
    const r = await fetch("/api/admin/me");
    const j = await r.json().catch(() => null);
    if (r.ok && j?.ok) setMe({ perms: j.perms ?? [] });
  }

  useEffect(() => {
    load();
    loadMe();
  }, []);

  const canWrite = hasPerm(me?.perms, "merchant.write");

  async function createMerchant() {
    setCreateBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/merchants", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ code: createCode.trim(), name: createName.trim() }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr("创建失败（可能商户号重复）");
        return;
      }
      setCreateOpen(false);
      setCreateCode("M" + String(Math.floor(Math.random() * 9000 + 1000)));
      setCreateName("新商户");
      await load();
    } finally {
      setCreateBusy(false);
    }
  }

  async function openEdit(merchantId: string) {
    setEditOpen(true);
    setEditMerchantId(merchantId);
    setEditMerchant(null);
    setEditFees(null);
    setEditRules([]);
    setEditErr(null);
    try {
      const r = await fetch(`/api/admin/merchants/${merchantId}`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setEditErr("加载商户详情失败");
        return;
      }
      setEditMerchant(j.merchant ?? null);
      setEditFees(j.fees ?? null);

      const r2 = await fetch(`/api/admin/merchants/${merchantId}/limit-rules`);
      const j2 = await r2.json().catch(() => null);
      if (r2.ok && j2?.ok) setEditRules(j2.rows ?? []);
    } catch {
      setEditErr("加载失败");
    }
  }

  async function patchMerchant(merchantId: string, body: any) {
    const h = await csrfHeader();
    const r = await fetch(`/api/admin/merchants/${merchantId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...h },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.error ?? "patch_failed");
  }

  async function saveMerchant() {
    if (!editMerchantId || !editMerchant || !editFees) return;
    setEditBusy(true);
    setEditErr(null);
    try {
      await patchMerchant(editMerchantId, {
        name: editMerchant.name,
        enabled: editMerchant.enabled,
        collectFeeRateBps: Number(editFees.collectFeeRateBps),
        payoutFeeRateBps: Number(editFees.payoutFeeRateBps),
        minFee: String(editFees.minFee ?? "0"),
      });
      await load();
      await openEdit(editMerchantId);
    } catch {
      setEditErr("保存失败（请检查输入）");
    } finally {
      setEditBusy(false);
    }
  }

  async function toggleEnabled(m: MerchantRow) {
    if (!canWrite) return;
    setErr(null);
    try {
      await patchMerchant(m.id, { enabled: !m.enabled });
      await load();
    } catch {
      setErr("更新失败");
    }
  }

  async function addLimitRule() {
    if (!editMerchantId) return;
    setEditBusy(true);
    setEditErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/merchants/${editMerchantId}/limit-rules`, {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({
          type: newRuleType,
          minAmount: newRuleMin,
          maxAmount: newRuleMax,
          dailyCountLimit: Number(newRuleDaily || "0"),
          enabled: true,
          note: newRuleNote || undefined,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setEditErr("新增限额规则失败");
        return;
      }
      setNewRuleMin("0");
      setNewRuleMax("0");
      setNewRuleDaily("0");
      setNewRuleNote("");
      await openEdit(editMerchantId);
    } finally {
      setEditBusy(false);
    }
  }

  async function patchLimitRule(ruleId: string, body: any) {
    if (!editMerchantId) return;
    const h = await csrfHeader();
    const r = await fetch(`/api/admin/merchants/${editMerchantId}/limit-rules/${ruleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...h },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error("patch_rule_failed");
  }

  async function deleteLimitRule(ruleId: string) {
    if (!editMerchantId) return;
    setEditBusy(true);
    setEditErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch(`/api/admin/merchants/${editMerchantId}/limit-rules/${ruleId}`, {
        method: "DELETE",
        headers: { ...h },
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setEditErr("删除失败");
        return;
      }
      await openEdit(editMerchantId);
    } finally {
      setEditBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((m) => m.code.toLowerCase().includes(s) || m.name.toLowerCase().includes(s));
  }, [q, rows]);

  const enabledCount = useMemo(() => rows.filter((r) => r.enabled).length, [rows]);

  return (
    <div>
      <div className="np-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <input className="np-input w-full md:w-[320px]" placeholder="搜索商户号/名称" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="text-xs text-[var(--np-faint)]">
              共 {rows.length} 个，启用 {enabledCount} 个
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="np-btn px-3 py-2 text-sm" onClick={load}>
              刷新
            </button>
            {canWrite ? (
              <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={() => setCreateOpen(true)}>
                新增商户
              </button>
            ) : null}
          </div>
        </div>
        {err ? <div className="mt-3 text-sm text-[var(--np-danger)]">{err}</div> : null}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs text-[var(--np-faint)]">
            <tr>
              <th className="px-4 py-3">商户号</th>
              <th className="px-4 py-3">名称</th>
              <th className="px-4 py-3">余额</th>
              <th className="px-4 py-3">代付冻结</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
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
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button className="np-btn px-2 py-1 text-xs" onClick={() => openEdit(m.id)}>
                      管理
                    </button>
                    {canWrite ? (
                      <button className="np-btn px-2 py-1 text-xs" onClick={() => toggleEnabled(m)}>
                        {m.enabled ? "停用" : "启用"}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr>
                <td className="px-4 py-6 text-sm text-[var(--np-muted)]" colSpan={6}>
                  暂无数据
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

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
        open={editOpen}
        title="商户管理"
        onClose={() => {
          if (!editBusy) setEditOpen(false);
        }}
        maxWidthClass="max-w-[960px]"
      >
        {editErr ? <div className="mb-3 text-sm text-[var(--np-danger)]">{editErr}</div> : null}
        {!editMerchant || !editFees ? (
          <div className="text-sm text-[var(--np-muted)]">加载中...</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="np-card p-4">
              <div className="text-xs text-[var(--np-faint)]">基础信息</div>
              <div className="mt-3 grid gap-2">
                <div className="text-xs text-[var(--np-faint)]">商户号</div>
                <div className="font-mono text-xs text-[var(--np-muted)]">{editMerchant.code}</div>

                <div className="mt-2 text-xs text-[var(--np-faint)]">名称</div>
                <input
                  className="np-input"
                  value={editMerchant.name}
                  onChange={(e) => setEditMerchant({ ...editMerchant, name: e.target.value })}
                  disabled={!canWrite}
                />

                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xs text-[var(--np-faint)]">启用</div>
                  <button
                    className={["np-btn px-2 py-1 text-xs", editMerchant.enabled ? "np-btn-primary" : ""].join(" ")}
                    onClick={() => setEditMerchant({ ...editMerchant, enabled: !editMerchant.enabled })}
                    disabled={!canWrite}
                  >
                    {editMerchant.enabled ? "启用" : "停用"}
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-[var(--np-faint)]">余额</div>
                    <div className="mt-1 font-mono text-xs text-[var(--np-muted)]">{editMerchant.balance}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--np-faint)]">代付冻结</div>
                    <div className="mt-1 font-mono text-xs text-[var(--np-muted)]">{editMerchant.payoutFrozen}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="np-card p-4">
              <div className="text-xs text-[var(--np-faint)]">费率</div>
              <div className="mt-3 grid gap-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-[var(--np-faint)]">代收费率 (bps)</div>
                    <input
                      className="np-input mt-2"
                      value={String(editFees.collectFeeRateBps)}
                      onChange={(e) => setEditFees({ ...editFees, collectFeeRateBps: Number(e.target.value || "0") })}
                      disabled={!canWrite}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-[var(--np-faint)]">代付费率 (bps)</div>
                    <input
                      className="np-input mt-2"
                      value={String(editFees.payoutFeeRateBps)}
                      onChange={(e) => setEditFees({ ...editFees, payoutFeeRateBps: Number(e.target.value || "0") })}
                      disabled={!canWrite}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--np-faint)]">最低手续费</div>
                  <input
                    className="np-input mt-2"
                    value={editFees.minFee}
                    onChange={(e) => setEditFees({ ...editFees, minFee: e.target.value })}
                    disabled={!canWrite}
                  />
                </div>
              </div>
            </div>

            <div className="np-card p-4 md:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-[var(--np-faint)]">限额规则</div>
                {canWrite ? (
                  <button className="np-btn px-3 py-2 text-xs" onClick={() => editMerchantId && openEdit(editMerchantId)}>
                    刷新
                  </button>
                ) : null}
              </div>

              <div className="mt-3 grid gap-3">
                {editRules.map((r) => (
                  <div key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-[var(--np-faint)]">
                        {r.type === "collect" ? "代收" : "代付"} / {r.enabled ? "启用" : "停用"}
                      </div>
                      {canWrite ? (
                        <div className="flex gap-2">
                          <button
                            className="np-btn px-2 py-1 text-xs"
                            onClick={async () => {
                              setEditBusy(true);
                              setEditErr(null);
                              try {
                                await patchLimitRule(r.id, { enabled: !r.enabled });
                                await openEdit(editMerchantId!);
                              } catch {
                                setEditErr("更新失败");
                              } finally {
                                setEditBusy(false);
                              }
                            }}
                          >
                            {r.enabled ? "停用" : "启用"}
                          </button>
                          <button className="np-btn px-2 py-1 text-xs" onClick={() => deleteLimitRule(r.id)}>
                            删除
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-4">
                      <div>
                        <div className="text-xs text-[var(--np-faint)]">最小金额</div>
                        <input
                          className="np-input mt-2"
                          value={r.minAmount}
                          onChange={(e) =>
                            setEditRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, minAmount: e.target.value } : x)))
                          }
                          disabled={!canWrite}
                        />
                      </div>
                      <div>
                        <div className="text-xs text-[var(--np-faint)]">最大金额</div>
                        <input
                          className="np-input mt-2"
                          value={r.maxAmount}
                          onChange={(e) =>
                            setEditRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, maxAmount: e.target.value } : x)))
                          }
                          disabled={!canWrite}
                        />
                      </div>
                      <div>
                        <div className="text-xs text-[var(--np-faint)]">日笔数限制</div>
                        <input
                          className="np-input mt-2"
                          value={String(r.dailyCountLimit)}
                          onChange={(e) =>
                            setEditRules((prev) =>
                              prev.map((x) =>
                                x.id === r.id ? { ...x, dailyCountLimit: Number(e.target.value || "0") } : x,
                              ),
                            )
                          }
                          disabled={!canWrite}
                        />
                      </div>
                      <div className="md:col-span-1">
                        <div className="text-xs text-[var(--np-faint)]">备注</div>
                        <input
                          className="np-input mt-2"
                          value={r.note ?? ""}
                          onChange={(e) =>
                            setEditRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, note: e.target.value } : x)))
                          }
                          disabled={!canWrite}
                        />
                      </div>
                    </div>

                    {canWrite ? (
                      <div className="mt-3 flex justify-end">
                        <button
                          className="np-btn np-btn-primary px-3 py-2 text-xs"
                          onClick={async () => {
                            setEditBusy(true);
                            setEditErr(null);
                            try {
                              await patchLimitRule(r.id, {
                                minAmount: r.minAmount,
                                maxAmount: r.maxAmount,
                                dailyCountLimit: r.dailyCountLimit,
                                note: r.note ?? null,
                              });
                              await openEdit(editMerchantId!);
                            } catch {
                              setEditErr("保存失败");
                            } finally {
                              setEditBusy(false);
                            }
                          }}
                        >
                          保存本条
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}

                {canWrite ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-[var(--np-faint)]">新增限额规则</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-5">
                      <div>
                        <div className="text-xs text-[var(--np-faint)]">类型</div>
                        <select className="np-input mt-2" value={newRuleType} onChange={(e) => setNewRuleType(e.target.value as any)}>
                          <option value="collect">代收</option>
                          <option value="payout">代付</option>
                        </select>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--np-faint)]">最小金额</div>
                        <input className="np-input mt-2" value={newRuleMin} onChange={(e) => setNewRuleMin(e.target.value)} />
                      </div>
                      <div>
                        <div className="text-xs text-[var(--np-faint)]">最大金额</div>
                        <input className="np-input mt-2" value={newRuleMax} onChange={(e) => setNewRuleMax(e.target.value)} />
                      </div>
                      <div>
                        <div className="text-xs text-[var(--np-faint)]">日笔数限制</div>
                        <input className="np-input mt-2" value={newRuleDaily} onChange={(e) => setNewRuleDaily(e.target.value)} />
                      </div>
                      <div>
                        <div className="text-xs text-[var(--np-faint)]">备注</div>
                        <input className="np-input mt-2" value={newRuleNote} onChange={(e) => setNewRuleNote(e.target.value)} />
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button className="np-btn np-btn-primary px-3 py-2 text-xs" onClick={addLimitRule} disabled={editBusy}>
                        新增
                      </button>
                    </div>
                  </div>
                ) : null}

                {!editRules.length ? <div className="text-xs text-[var(--np-faint)]">暂无限额规则</div> : null}
              </div>
            </div>

            <div className="md:col-span-2 flex justify-end gap-2">
              {canWrite ? (
                <button className="np-btn np-btn-primary px-3 py-2 text-sm" onClick={saveMerchant} disabled={editBusy}>
                  {editBusy ? "保存中..." : "保存商户设置"}
                </button>
              ) : (
                <div className="text-xs text-[var(--np-faint)]">当前账号无 `merchant.write` 权限</div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
