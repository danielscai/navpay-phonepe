import { describe, expect, test } from "vitest";
import { tokenHash } from "@/lib/personal-auth-core";

describe("personal auth", () => {
  test("tokenHash is deterministic", () => {
    expect(tokenHash("abc")).toBe(tokenHash("abc"));
    expect(tokenHash("abc")).not.toBe(tokenHash("abcd"));
  });
});
