import { HDNodeWallet, Wallet } from "ethers";
import bs58check from "bs58check";

export type RechargeChain = "tron" | "bsc";

function tronBase58FromEvmHexAddress(evmAddress: string): string {
  // Tron address = base58check( 0x41 + last20bytes(evmAddress) ).
  const hex = evmAddress.toLowerCase().startsWith("0x") ? evmAddress.slice(2) : evmAddress;
  if (hex.length !== 40) throw new Error("bad_evm_address");
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(hex, "hex")]);
  return bs58check.encode(payload);
}

export function deriveDepositAddressFromMnemonic(opts: { mnemonic: string; chain: RechargeChain; index: number }): { chain: RechargeChain; index: number; path: string; address: string; evmAddress?: string } {
  if (!Number.isInteger(opts.index) || opts.index < 0) throw new Error("bad_index");
  const mnemonic = (opts.mnemonic ?? "").trim();
  if (!mnemonic) throw new Error("bad_mnemonic");

  const path =
    opts.chain === "tron"
      ? `m/44'/195'/0'/0/${opts.index}`
      : `m/44'/60'/0'/0/${opts.index}`;

  // ethers v6 HD derivation
  const node = HDNodeWallet.fromPhrase(mnemonic, undefined, path);
  const w = new Wallet(node.privateKey);
  const evmAddress = w.address;

  if (opts.chain === "bsc") {
    return { chain: opts.chain, index: opts.index, path, address: evmAddress, evmAddress };
  }
  return { chain: opts.chain, index: opts.index, path, address: tronBase58FromEvmHexAddress(evmAddress), evmAddress };
}

