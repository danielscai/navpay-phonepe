import { getSystemConfigBool, getSystemConfigNumber } from "@/lib/system-config";
import type { RechargeChain } from "@/lib/recharge-hd-core";
import {
  RECHARGE_BSC_CONFIRM_KEY,
  RECHARGE_BSC_ENABLED_KEY,
  RECHARGE_BSC_NEXT_INDEX_KEY,
  RECHARGE_TRON_CONFIRM_KEY,
  RECHARGE_TRON_ENABLED_KEY,
  RECHARGE_TRON_NEXT_INDEX_KEY,
} from "@/lib/recharge-keys";

export {
  RECHARGE_TRON_ENABLED_KEY,
  RECHARGE_BSC_ENABLED_KEY,
  RECHARGE_TRON_CONFIRM_KEY,
  RECHARGE_BSC_CONFIRM_KEY,
  RECHARGE_TRON_NEXT_INDEX_KEY,
  RECHARGE_BSC_NEXT_INDEX_KEY,
} from "@/lib/recharge-keys";

export async function isRechargeChainEnabled(chain: RechargeChain): Promise<boolean> {
  if (chain === "tron") {
    return await getSystemConfigBool({ key: RECHARGE_TRON_ENABLED_KEY, defaultValue: true, description: "是否启用 Tron 充值监听/入账。" });
  }
  return await getSystemConfigBool({ key: RECHARGE_BSC_ENABLED_KEY, defaultValue: true, description: "是否启用 BSC 充值监听/入账。" });
}

export async function getRechargeConfirmationsRequired(chain: RechargeChain): Promise<number> {
  if (chain === "tron") {
    return await getSystemConfigNumber({ key: RECHARGE_TRON_CONFIRM_KEY, defaultValue: 15, min: 1, max: 200, description: "Tron 充值确认区块数（默认 15）。" });
  }
  return await getSystemConfigNumber({ key: RECHARGE_BSC_CONFIRM_KEY, defaultValue: 15, min: 1, max: 200, description: "BSC 充值确认区块数（默认 15）。" });
}

export async function getRechargeNextIndex(chain: RechargeChain): Promise<number> {
  if (chain === "tron") {
    return await getSystemConfigNumber({ key: RECHARGE_TRON_NEXT_INDEX_KEY, defaultValue: 0, min: 0, max: 10_000_000, description: "充值地址派生索引 next_index（tron，内部使用）。" });
  }
  return await getSystemConfigNumber({ key: RECHARGE_BSC_NEXT_INDEX_KEY, defaultValue: 0, min: 0, max: 10_000_000, description: "充值地址派生索引 next_index（bsc，内部使用）。" });
}

