"use client";

import { useEffect, useMemo, useState } from "react";
import { RECHARGE_BSC_CONFIRM_KEY, RECHARGE_BSC_ENABLED_KEY, RECHARGE_BSC_NEXT_INDEX_KEY, RECHARGE_TRON_CONFIRM_KEY, RECHARGE_TRON_ENABLED_KEY, RECHARGE_TRON_NEXT_INDEX_KEY } from "@/lib/recharge-keys";

type Row = { key: string; value: string; description?: string | null; updatedAtMs?: number };

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

function boolStr(v: boolean): string {
  return v ? "true" : "false";
}

function toBool(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(s);
}

export default function SystemRechargeClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [configured, setConfigured] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tronConfEdit, setTronConfEdit] = useState("15");
  const [bscConfEdit, setBscConfEdit] = useState("15");

  async function load() {
    setErr(null);
    const r1 = await fetch("/api/admin/system/recharge/status");
    const j1 = await r1.json().catch(() => null);
    if (r1.ok && j1?.ok) setConfigured(Boolean(j1.configured));

    const r = await fetch("/api/admin/system/config");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      setErr("加载失败");
      return;
    }
    setRows(j.rows ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const getVal = (k: string, d = "") => (byKey.get(k)?.value ?? d) as string;

  const tronEnabled = toBool(getVal(RECHARGE_TRON_ENABLED_KEY, "true"));
  const bscEnabled = toBool(getVal(RECHARGE_BSC_ENABLED_KEY, "true"));
  const tronConf = getVal(RECHARGE_TRON_CONFIRM_KEY, "15");
  const bscConf = getVal(RECHARGE_BSC_CONFIRM_KEY, "15");
  const tronNext = getVal(RECHARGE_TRON_NEXT_INDEX_KEY, "0");
  const bscNext = getVal(RECHARGE_BSC_NEXT_INDEX_KEY, "0");

  async function saveKey(key: string, value: string, description?: string) {
    setBusy(true);
    setErr(null);
    try {
      const h = await csrfHeader();
      const r = await fetch("/api/admin/system/config", {
        method: "POST",
        headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ key, value, description }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.error ? `保存失败：${j.error}` : "保存失败");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setTronConfEdit(tronConf);
    setBscConfEdit(bscConf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tronConf, bscConf]);

  return (
    <div className="grid gap-4">
      {err ? <div className="text-sm text-[var(--np-danger)]">{err}</div> : null}

      <div className="np-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-[var(--np-faint)]">系统</div>
            <div className="mt-1 text-lg font-semibold tracking-tight">充值管理</div>
          </div>
          <div className="text-xs">{configured ? <span className="np-pill np-pill-ok">HD 钱包已配置</span> : <span className="np-pill np-pill-danger">HD 钱包未配置</span>}</div>
        </div>
        <div className="mt-2 text-sm text-[var(--np-muted)]">
          助记词仅存在于服务端配置（环境变量）且加密存储，后台页面不会展示助记词内容。每个商户每条链分配 1 个地址（HD 派生），充值需达到确认数后才入账。
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="np-card p-4">
          <div className="text-sm font-semibold">TRON</div>
          <div className="mt-3 grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-[var(--np-faint)]">启用</div>
              <button
                className={["np-btn px-3 py-2 text-xs", tronEnabled ? "np-btn-primary" : ""].join(" ")}
                onClick={() => saveKey(RECHARGE_TRON_ENABLED_KEY, boolStr(!tronEnabled), "是否启用 Tron 充值监听/入账。")}
                disabled={busy}
              >
                {tronEnabled ? "已启用（点击禁用）" : "已禁用（点击启用）"}
              </button>
            </div>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">确认区块数</span>
              <div className="flex gap-2">
                <input className="np-input w-[140px] font-mono" value={tronConfEdit} onChange={(e) => setTronConfEdit(e.target.value)} />
                <button
                  className="np-btn px-3 py-2 text-xs"
                  onClick={() => saveKey(RECHARGE_TRON_CONFIRM_KEY, tronConfEdit.trim() || "15", "Tron 充值确认区块数（默认 15）。")}
                  disabled={busy}
                >
                  保存
                </button>
              </div>
              <div className="text-[11px] text-[var(--np-faint)]">修改后立即生效。</div>
            </label>
            <div className="text-xs text-[var(--np-faint)]">
              next_index <span className="ml-2 font-mono text-xs text-[var(--np-muted)]">{tronNext}</span>
            </div>
          </div>
        </div>

        <div className="np-card p-4">
          <div className="text-sm font-semibold">BSC</div>
          <div className="mt-3 grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-[var(--np-faint)]">启用</div>
              <button
                className={["np-btn px-3 py-2 text-xs", bscEnabled ? "np-btn-primary" : ""].join(" ")}
                onClick={() => saveKey(RECHARGE_BSC_ENABLED_KEY, boolStr(!bscEnabled), "是否启用 BSC 充值监听/入账。")}
                disabled={busy}
              >
                {bscEnabled ? "已启用（点击禁用）" : "已禁用（点击启用）"}
              </button>
            </div>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--np-faint)]">确认区块数</span>
              <div className="flex gap-2">
                <input className="np-input w-[140px] font-mono" value={bscConfEdit} onChange={(e) => setBscConfEdit(e.target.value)} />
                <button
                  className="np-btn px-3 py-2 text-xs"
                  onClick={() => saveKey(RECHARGE_BSC_CONFIRM_KEY, bscConfEdit.trim() || "15", "BSC 充值确认区块数（默认 15）。")}
                  disabled={busy}
                >
                  保存
                </button>
              </div>
              <div className="text-[11px] text-[var(--np-faint)]">修改后立即生效。</div>
            </label>
            <div className="text-xs text-[var(--np-faint)]">
              next_index <span className="ml-2 font-mono text-xs text-[var(--np-muted)]">{bscNext}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="np-card p-4">
        <div className="text-sm font-semibold">注意事项</div>
        <div className="mt-2 text-sm text-[var(--np-muted)]">
          1. 每个商户每条链固定 1 个充值地址（由 HD 助记词 + 索引派生），索引记录在商户数据库记录中。
        </div>
        <div className="mt-1 text-sm text-[var(--np-muted)]">2. 监听到交易后先进入“确认中”，达到确认数（默认 15）才会真实入账到商户余额。</div>
      </div>
    </div>
  );
}
