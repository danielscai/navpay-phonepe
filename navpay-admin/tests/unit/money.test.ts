import { describe, expect, test } from "vitest";
import { feeFromBps } from "@/lib/money";

describe("money", () => {
  test("feeFromBps applies minFee and rounds to 2 decimals", () => {
    expect(feeFromBps("100.00", 300, "0.00").fee).toBe("3.00");
    expect(feeFromBps("0.10", 300, "0.00").fee).toBe("0.00");
    expect(feeFromBps("0.10", 300, "1.00").fee).toBe("1.00");
  });
});

