import { describe, expect, it } from "vitest";
import { dayRangeMsInTz } from "@/lib/day-range";

describe("dayRangeMsInTz", () => {
  it("includes now and returns a sane 24h window for Asia/Kolkata (no DST)", () => {
    const nowMs = Date.now();
    const { startMs, endMs } = dayRangeMsInTz({ nowMs, timeZone: "Asia/Kolkata" });
    expect(startMs).toBeLessThanOrEqual(nowMs);
    expect(endMs).toBeGreaterThan(nowMs);
    expect(endMs - startMs).toBe(86_400_000);
  });
});

