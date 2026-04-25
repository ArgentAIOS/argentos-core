import { describe, expect, it } from "vitest";
import { inspectExecutiveShadowAgainstKernel } from "./executive-shadow-kernel-inspector.js";

describe("inspectExecutiveShadowAgainstKernel", () => {
  it("reports alignment when kernel lane matches executive shadow lane", async () => {
    const result = await inspectExecutiveShadowAgainstKernel({
      getKernelSnapshot: () =>
        ({
          activeLane: "operator",
          effectiveFocus: "stabilize substrate",
          currentFocus: "stabilize substrate",
        }) as any,
      getExecutiveSummary: async () => ({
        reachable: true,
        activeLane: "operator",
        tickCount: 4,
        bootCount: 2,
        journalEventCount: 8,
        nextTickDueAtMs: 12345,
        laneCounts: { idle: 1, pending: 1, active: 1 },
        highestPendingPriority: 20,
        nextLeaseExpiryAtMs: 13000,
        lastEventSummary: "lane operator activated (lease expires at 13000)",
        lastEventType: "lane_activated",
        stateDir: "/tmp/executive",
        error: null,
      }),
    });

    expect(result.comparable).toBe(true);
    expect(result.laneMatch).toBe(true);
    expect(result.notes).toContain("active lane aligned");
  });

  it("reports unavailability cleanly when kernel snapshot is missing", async () => {
    const result = await inspectExecutiveShadowAgainstKernel({
      getKernelSnapshot: () => null,
      getExecutiveSummary: async () => ({
        reachable: true,
        activeLane: "operator",
        tickCount: 4,
        bootCount: 2,
        journalEventCount: 8,
        nextTickDueAtMs: 12345,
        laneCounts: { idle: 1, pending: 1, active: 1 },
        highestPendingPriority: 20,
        nextLeaseExpiryAtMs: 13000,
        lastEventSummary: "lane operator activated (lease expires at 13000)",
        lastEventType: "lane_activated",
        stateDir: "/tmp/executive",
        error: null,
      }),
    });

    expect(result.kernelAvailable).toBe(false);
    expect(result.comparable).toBe(false);
    expect(result.notes).toContain("kernel snapshot unavailable");
  });
});
