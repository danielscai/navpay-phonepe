import type { RechargeChain } from "@/lib/recharge-hd-core";
import { fromTokenUnits } from "@/lib/token-units";

export type ChainTransfer = {
  chain: RechargeChain;
  txHash: string;
  fromAddress?: string | null;
  toAddress: string;
  amount: string;
  blockNumber: number;
};

function mustEnv(name: string, fallback?: string): string {
  const v = (process.env as any)?.[name];
  const s = typeof v === "string" ? v.trim() : "";
  if (s) return s;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing_env:${name}`);
}

function optEnv(name: string): string | undefined {
  const v = (process.env as any)?.[name];
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}

export async function getHeadBlockNumber(chain: RechargeChain): Promise<number> {
  if (chain === "tron") {
    const base = mustEnv("TRON_API_BASE", "https://api.trongrid.io");
    const apiKey = optEnv("TRON_API_KEY");
    const r = await fetch(`${base}/wallet/getnowblock`, { headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : undefined });
    const j = await r.json().catch(() => null);
    const n = Number(j?.block_header?.raw_data?.number ?? NaN);
    if (!Number.isFinite(n)) throw new Error("tron_head_block_failed");
    return n;
  }

  const base = mustEnv("BSCSCAN_API_BASE", "https://api.bscscan.com/api");
  const apiKey = optEnv("BSCSCAN_API_KEY");
  const sp = new URLSearchParams({ module: "proxy", action: "eth_blockNumber" });
  if (apiKey) sp.set("apikey", apiKey);
  const r = await fetch(`${base}?${sp.toString()}`);
  const j = await r.json().catch(() => null);
  const hex = String(j?.result ?? "");
  const n = hex.startsWith("0x") ? parseInt(hex.slice(2), 16) : Number(hex);
  if (!Number.isFinite(n)) throw new Error("bsc_head_block_failed");
  return n;
}

// v1 assumes USDT transfers:
// - Tron: TRC20 USDT contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`
// - BSC: BEP20 USDT contract `0x55d398326f99059ff775485246999027b3197955`
export async function fetchIncomingTransfers(opts: { chain: RechargeChain; address: string; startBlock?: number; minTimestampMs?: number }): Promise<ChainTransfer[]> {
  if (opts.chain === "tron") {
    const base = mustEnv("TRON_API_BASE", "https://api.trongrid.io");
    const apiKey = optEnv("TRON_API_KEY");
    const usdtContract = (process.env.TRON_USDT_CONTRACT ?? "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t").trim();
    const decimals = Math.max(0, Math.floor(Number(process.env.TRON_USDT_DECIMALS ?? "6") || 6));
    const sp = new URLSearchParams({ limit: "200", contract_address: usdtContract, only_confirmed: "false" });
    if (opts.minTimestampMs) sp.set("min_timestamp", String(opts.minTimestampMs));
    const r = await fetch(`${base}/v1/accounts/${opts.address}/transactions/trc20?${sp.toString()}`, {
      headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : undefined,
    });
    const j = await r.json().catch(() => null);
    const data = Array.isArray(j?.data) ? j.data : [];
    const out: ChainTransfer[] = [];
    for (const it of data) {
      const to = String(it?.to ?? "");
      if (!to || to.toLowerCase() !== opts.address.toLowerCase()) continue;
      const txHash = String(it?.transaction_id ?? "");
      const from = it?.from ? String(it.from) : null;
      const rawVal = String(it?.value ?? "");
      let amount = rawVal;
      try {
        amount = fromTokenUnits({ value: rawVal, decimals });
      } catch {
        // keep raw
      }
      const blockNumber = Number(it?.block_number ?? NaN);
      if (!txHash || !amount || !Number.isFinite(blockNumber)) continue;
      out.push({ chain: "tron", txHash, fromAddress: from, toAddress: to, amount, blockNumber });
    }
    return out;
  }

  const base = mustEnv("BSCSCAN_API_BASE", "https://api.bscscan.com/api");
  const apiKey = optEnv("BSCSCAN_API_KEY");
  const usdtContract = (process.env.BSC_USDT_CONTRACT ?? "0x55d398326f99059ff775485246999027b3197955").trim();
  const decimals = Math.max(0, Math.floor(Number(process.env.BSC_USDT_DECIMALS ?? "18") || 18));
  const sp = new URLSearchParams({
    module: "account",
    action: "tokentx",
    contractaddress: usdtContract,
    address: opts.address,
    startblock: String(opts.startBlock ?? 0),
    endblock: "99999999",
    sort: "asc",
  });
  if (apiKey) sp.set("apikey", apiKey);
  const r = await fetch(`${base}?${sp.toString()}`);
  const j = await r.json().catch(() => null);
  const res = Array.isArray(j?.result) ? j.result : [];
  const out: ChainTransfer[] = [];
  for (const it of res) {
    const to = String(it?.to ?? "");
    if (!to || to.toLowerCase() !== opts.address.toLowerCase()) continue;
    const txHash = String(it?.hash ?? "");
    const from = it?.from ? String(it.from) : null;
    const rawVal = String(it?.value ?? "");
    let amount = rawVal;
    try {
      amount = fromTokenUnits({ value: rawVal, decimals });
    } catch {
      // keep raw
    }
    const blockNumber = Number(it?.blockNumber ?? NaN);
    if (!txHash || !amount || !Number.isFinite(blockNumber)) continue;
    out.push({ chain: "bsc", txHash, fromAddress: from, toAddress: to, amount, blockNumber });
  }
  return out;
}
