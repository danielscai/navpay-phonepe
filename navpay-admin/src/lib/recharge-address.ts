import { sqlite, db } from "@/lib/db";
import { merchantDepositAddresses } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { id } from "@/lib/id";
import { deriveDepositAddress, type RechargeChain, isRechargeConfigured } from "@/lib/recharge-hd";
import {
  RECHARGE_BSC_NEXT_INDEX_KEY,
  RECHARGE_TRON_NEXT_INDEX_KEY,
  getRechargeConfirmationsRequired,
} from "@/lib/recharge-config.server";

function nextIndexKey(chain: RechargeChain): string {
  return chain === "tron" ? RECHARGE_TRON_NEXT_INDEX_KEY : RECHARGE_BSC_NEXT_INDEX_KEY;
}

function ensureSystemConfigRow(key: string, value: string, description: string) {
  sqlite
    .prepare("INSERT OR IGNORE INTO system_configs (key, value, description, updated_at_ms) VALUES (?, ?, ?, ?)")
    .run(key, value, description, Date.now());
}

function getSystemConfigValue(key: string): string | null {
  const row = sqlite.prepare("SELECT value FROM system_configs WHERE key = ? LIMIT 1").get(key) as any;
  return row?.value ? String(row.value) : null;
}

function setSystemConfigValue(key: string, value: string) {
  sqlite.prepare("UPDATE system_configs SET value = ?, updated_at_ms = ? WHERE key = ?").run(value, Date.now(), key);
}

export async function ensureMerchantDepositAddress(opts: { merchantId: string; chain: RechargeChain }): Promise<{ merchantId: string; chain: RechargeChain; index: number; address: string }> {
  const chain = opts.chain;
  if (!isRechargeConfigured()) throw new Error("deposit_not_configured");

  // If already allocated, return the persisted address row.
  const existing = await db
    .select()
    .from(merchantDepositAddresses)
    .where(and(eq(merchantDepositAddresses.merchantId, opts.merchantId), eq(merchantDepositAddresses.chain, chain)))
    .limit(1);
  const e: any = existing[0];
  if (e) return { merchantId: opts.merchantId, chain, index: Number(e.addrIndex), address: String(e.address) };

  const tx = sqlite.transaction(() => {
    // Re-check inside transaction.
    const erow = sqlite
      .prepare("SELECT addr_index as idx, address FROM merchant_deposit_addresses WHERE merchant_id = ? AND chain = ? LIMIT 1")
      .get(opts.merchantId, chain) as any;
    if (erow) return { index: Number(erow.idx), address: String(erow.address) };

    const key = nextIndexKey(chain);
    ensureSystemConfigRow(key, "0", `充值地址派生索引 next_index（${chain}，内部使用）。`);
    const raw = getSystemConfigValue(key) ?? "0";
    const idx = Math.max(0, Math.floor(Number(raw) || 0));
    setSystemConfigValue(key, String(idx + 1));

    const d = deriveDepositAddress({ chain, index: idx });

    // Persist index on merchant for auditability (requirement: store offset in merchant record).
    const col = chain === "tron" ? "deposit_index_tron" : "deposit_index_bsc";
    sqlite.prepare(`UPDATE merchants SET ${col} = COALESCE(${col}, ?), updated_at_ms = ? WHERE id = ?`).run(idx, Date.now(), opts.merchantId);

    sqlite
      .prepare("INSERT OR IGNORE INTO merchant_deposit_addresses (id, merchant_id, chain, addr_index, address, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id("mda"), opts.merchantId, chain, idx, d.address, Date.now());

    return { index: idx, address: d.address };
  });

  const out = tx();
  return { merchantId: opts.merchantId, chain, index: out.index, address: out.address };
}

export async function listMerchantDepositAddresses(merchantId: string): Promise<{ chain: RechargeChain; index: number; address: string; confirmationsRequired: number }[]> {
  const chains: RechargeChain[] = ["tron", "bsc"];
  const out: { chain: RechargeChain; index: number; address: string; confirmationsRequired: number }[] = [];
  for (const c of chains) {
    try {
      const row = await ensureMerchantDepositAddress({ merchantId, chain: c });
      out.push({ chain: c, index: row.index, address: row.address, confirmationsRequired: await getRechargeConfirmationsRequired(c) });
    } catch {
      // If not configured, hide addresses.
    }
  }
  return out;
}
