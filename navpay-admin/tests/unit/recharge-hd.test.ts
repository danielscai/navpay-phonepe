import { describe, expect, test } from "vitest";
import { deriveDepositAddressFromMnemonic } from "@/lib/recharge-hd-core";

// BIP39 test mnemonic (public).
const MN = "test test test test test test test test test test test junk";

describe("recharge hd", () => {
  test("bsc address derivation is deterministic per index", () => {
    const a0 = deriveDepositAddressFromMnemonic({ mnemonic: MN, chain: "bsc", index: 0 });
    const a0b = deriveDepositAddressFromMnemonic({ mnemonic: MN, chain: "bsc", index: 0 });
    const a1 = deriveDepositAddressFromMnemonic({ mnemonic: MN, chain: "bsc", index: 1 });
    expect(a0.address).toBe(a0b.address);
    expect(a0.address).not.toBe(a1.address);
    expect(a0.address.startsWith("0x")).toBe(true);
  });

  test("tron address derivation produces base58 address and is deterministic", () => {
    const t0 = deriveDepositAddressFromMnemonic({ mnemonic: MN, chain: "tron", index: 0 });
    const t0b = deriveDepositAddressFromMnemonic({ mnemonic: MN, chain: "tron", index: 0 });
    const t1 = deriveDepositAddressFromMnemonic({ mnemonic: MN, chain: "tron", index: 1 });
    expect(t0.address).toBe(t0b.address);
    expect(t0.address).not.toBe(t1.address);
    // Tron base58 addresses are typically 34 chars and start with 'T'.
    expect(t0.address[0]).toBe("T");
  });
});

