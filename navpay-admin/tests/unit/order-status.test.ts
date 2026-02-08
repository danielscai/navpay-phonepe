import { describe, expect, test } from "vitest";
import { orderStatusPill, orderStatusFlow, payoutStatuses } from "@/lib/order-status";

describe("orderStatusPill", () => {
  test("collect PENDING_PAY is 支付中 and warn", () => {
    const v = orderStatusPill("collect", "PENDING_PAY");
    expect(v.label).toBe("支付中");
    expect(v.className).toContain("np-pill-warn");
  });

  test("payout APPROVED is 待抢单", () => {
    const v = orderStatusPill("payout", "APPROVED");
    expect(v.label).toBe("待抢单");
  });

  test("payout LOCKED exists and is warn", () => {
    expect(payoutStatuses.includes("LOCKED" as any)).toBe(true);
    const v = orderStatusPill("payout", "LOCKED");
    expect(v.className).toContain("np-pill-warn");
  });
});

describe("orderStatusFlow", () => {
  test("payout flow includes LOCKED <-> APPROVED edges", () => {
    const f = orderStatusFlow("payout");
    const edge = (from: string, to: string) => f.edges.some((e) => e.from === from && e.to === to);
    expect(edge("APPROVED", "LOCKED")).toBe(true);
    expect(edge("LOCKED", "APPROVED")).toBe(true);
  });
});

