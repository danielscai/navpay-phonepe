import "dotenv/config";
import { db, sqlite } from "@/lib/db";
import { merchantDepositAddresses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fetchIncomingTransfers, getHeadBlockNumber } from "@/lib/recharge-chain";
import { upsertRechargeFromTx, processRechargeConfirmations } from "@/lib/recharge";
import type { RechargeChain } from "@/lib/recharge-hd-core";

const TRON_CURSOR_KEY = "recharge.tron.scan_min_ts_ms";
const BSC_CURSOR_KEY = "recharge.bsc.scan_start_block";

function getCursor(key: string): number {
  const row = sqlite.prepare("SELECT value FROM system_configs WHERE key = ? LIMIT 1").get(key) as any;
  const n = Number(row?.value ?? NaN);
  return Number.isFinite(n) ? n : 0;
}

function setCursor(key: string, value: number, desc: string) {
  sqlite
    .prepare("INSERT INTO system_configs (key, value, description, updated_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, description=excluded.description, updated_at_ms=excluded.updated_at_ms")
    .run(key, String(Math.max(0, Math.floor(value))), desc, Date.now());
}

async function scanChain(chain: RechargeChain) {
  const addrs = await db.select().from(merchantDepositAddresses).where(eq(merchantDepositAddresses.chain, chain));
  if (!addrs.length) return;

  const head = await getHeadBlockNumber(chain);

  if (chain === "tron") {
    const now = Date.now();
    const last = getCursor(TRON_CURSOR_KEY) || now - 24 * 60 * 60 * 1000;
    // Overlap 5 minutes to avoid missing boundary events.
    const minTs = Math.max(0, last - 5 * 60 * 1000);
    for (const a of addrs as any[]) {
      const txs = await fetchIncomingTransfers({ chain, address: String(a.address), minTimestampMs: minTs });
      for (const t of txs) {
        await upsertRechargeFromTx({
          req: new Request("http://localhost/worker"),
          merchantId: String(a.merchantId),
          tx: { chain, txHash: t.txHash, address: String(a.address), fromAddress: t.fromAddress, toAddress: t.toAddress, amount: t.amount, blockNumber: t.blockNumber },
        });
      }
    }
    setCursor(TRON_CURSOR_KEY, now, "Tron 充值监听游标（min_timestamp ms，内部使用）。");
  } else {
    const last = getCursor(BSC_CURSOR_KEY);
    const startBlock = last > 0 ? last : Math.max(0, head - 10_000);
    for (const a of addrs as any[]) {
      const txs = await fetchIncomingTransfers({ chain, address: String(a.address), startBlock });
      for (const t of txs) {
        await upsertRechargeFromTx({
          req: new Request("http://localhost/worker"),
          merchantId: String(a.merchantId),
          tx: { chain, txHash: t.txHash, address: String(a.address), fromAddress: t.fromAddress, toAddress: t.toAddress, amount: t.amount, blockNumber: t.blockNumber },
        });
      }
    }
    // Keep some overlap to be safe.
    setCursor(BSC_CURSOR_KEY, Math.max(0, head - 50), "BSC 充值监听游标（start_block，内部使用）。");
  }

  await processRechargeConfirmations({ req: new Request("http://localhost/worker"), chain, headBlockNumber: head });
}

async function main() {
  const once = process.argv.includes("--once");
  const intervalSec = Number(process.env.RECHARGE_WORKER_INTERVAL_SEC ?? "20") || 20;

  do {
    try {
      await scanChain("tron");
    } catch (e) {
      console.error("[recharge-worker] tron scan error:", e);
    }
    try {
      await scanChain("bsc");
    } catch (e) {
      console.error("[recharge-worker] bsc scan error:", e);
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  } while (true);
}

main().catch((e) => {
  console.error("[recharge-worker] fatal:", e);
  process.exit(1);
});

