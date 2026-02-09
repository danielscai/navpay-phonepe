import { env } from "@/lib/env";
import { decryptString } from "@/lib/crypto";
import { deriveDepositAddressFromMnemonic, type RechargeChain } from "@/lib/recharge-hd-core";

export type { RechargeChain } from "@/lib/recharge-hd-core";

export function isRechargeConfigured(): boolean {
  return !!(env.DEPOSIT_MNEMONIC_ENC && env.DEPOSIT_MNEMONIC_ENCRYPTION_KEY);
}

export function getDepositMnemonic(): string {
  const enc = env.DEPOSIT_MNEMONIC_ENC;
  const key = env.DEPOSIT_MNEMONIC_ENCRYPTION_KEY;
  if (!enc || !key) throw new Error("deposit_not_configured");
  return decryptString(enc, key);
}

export function deriveDepositAddress(opts: { chain: RechargeChain; index: number }) {
  return deriveDepositAddressFromMnemonic({ mnemonic: getDepositMnemonic(), chain: opts.chain, index: opts.index });
}

