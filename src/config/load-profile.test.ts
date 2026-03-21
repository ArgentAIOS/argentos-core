import { describe, expect, it } from "vitest";
import { applyRuntimeLoadProfile, resolveRuntimeLoadProfile } from "./load-profile.js";

describe("runtime load profiles", () => {
  it("resolves balanced laptop defaults", () => {
    const resolved = resolveRuntimeLoadProfile({ active: "balanced-laptop" });
    expect(resolved.pollingMultiplier).toBe(2);
    expect(resolved.patch.executionWorker?.enabled).toBe(false);
    expect(resolved.patch.maxConcurrent).toBe(2);
  });

  it("applies preset patch and persisted overrides", () => {
    const effective = applyRuntimeLoadProfile({
      agents: {
        defaults: {
          maxConcurrent: 6,
          heartbeat: { every: "20m", enabled: true },
          contemplation: { enabled: true, every: "15m", maxCyclesPerHour: 5 },
          subagents: { maxConcurrent: 8 },
          loadProfile: {
            active: "balanced-laptop",
            overrides: {
              heartbeat: { every: "30m" },
              maxConcurrent: 3,
            },
          },
        },
      },
    });

    expect(effective.agents?.defaults?.heartbeat?.every).toBe("30m");
    expect(effective.agents?.defaults?.contemplation?.every).toBe("2h");
    expect(effective.agents?.defaults?.executionWorker?.enabled).toBe(false);
    expect(effective.agents?.defaults?.maxConcurrent).toBe(3);
    expect(effective.agents?.defaults?.subagents?.maxConcurrent).toBe(1);
  });
});
