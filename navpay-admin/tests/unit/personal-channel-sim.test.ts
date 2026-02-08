import { describe, expect, test } from "vitest";
import { buildPersonalChannelInitialPlan } from "@/lib/personal-channel-sim";

describe("personal channel simulator plan", () => {
  test("creates 2 devices, 2 apps, 4 installs", () => {
    const plan = buildPersonalChannelInitialPlan({ nowMs: 1700000000000, personLabel: "pp_demo" });
    expect(plan.devices).toHaveLength(2);
    expect(plan.apps).toHaveLength(2);
    expect(plan.installs).toHaveLength(4);
    const pairs = new Set(plan.installs.map((x) => `${x.deviceIndex}:${x.appIndex}`));
    expect(pairs.size).toBe(4);
  });
});

