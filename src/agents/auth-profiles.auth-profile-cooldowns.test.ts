import { describe, expect, it } from "vitest";
import { calculateAuthProfileCooldownMs } from "./auth-profiles.js";

describe("auth profile cooldowns", () => {
  it("applies exponential backoff with a 40s cap", () => {
    // Formula: min(40s, 5s * 2^min(n-1, 3))
    expect(calculateAuthProfileCooldownMs(1)).toBe(5_000);
    expect(calculateAuthProfileCooldownMs(2)).toBe(10_000);
    expect(calculateAuthProfileCooldownMs(3)).toBe(20_000);
    expect(calculateAuthProfileCooldownMs(4)).toBe(40_000);
    expect(calculateAuthProfileCooldownMs(5)).toBe(40_000);
  });
});
