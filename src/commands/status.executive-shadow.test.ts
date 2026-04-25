import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExecutiveShadowClient: vi.fn(),
}));

vi.mock("../infra/executive-shadow-client.js", () => ({
  createExecutiveShadowClient: mocks.createExecutiveShadowClient,
}));

describe("getExecutiveShadowSummary", () => {
  it("returns a read-only executive shadow summary when reachable", async () => {
    mocks.createExecutiveShadowClient.mockReturnValue({
      getHealth: vi.fn(async () => ({
        status: "ok",
        uptimeSeconds: 12,
        bootCount: 2,
        tickCount: 4,
        activeLane: "operator",
        journalEventCount: 8,
        stateDir: "/tmp/executive",
        nextTickDueAtMs: 12345,
      })),
      getMetrics: vi.fn(async () => ({
        activeLane: "operator",
        laneCounts: { idle: 1, pending: 2, active: 1 },
        bootCount: 2,
        tickCount: 4,
        journalEventCount: 8,
        nextTickDueAtMs: 12345,
        lastTickAtMs: 12222,
        lastRecoveredAtMs: 11111,
        nextLeaseExpiryAtMs: 12456,
        highestPendingPriority: 50,
      })),
      getTimeline: vi.fn(async () => ({
        activeLane: "operator",
        journalEventCount: 8,
        recentEvents: [
          {
            seq: 8,
            atMs: 12456,
            type: "lane_activated",
            lane: "operator",
            summary: "lane operator activated (lease expires at 13000)",
          },
        ],
        counts: {
          booted: 1,
          recovered: 1,
          tick: 4,
          lane_requested: 2,
          lane_activated: 1,
          lane_released: 0,
        },
        lastRequestAtMs: 12000,
        lastActivationAtMs: 12456,
        lastReleaseAtMs: null,
        lastReleaseOutcome: null,
      })),
    });

    const { getExecutiveShadowSummary } = await import("./status.executive-shadow.js");
    const summary = await getExecutiveShadowSummary();

    expect(summary).toEqual({
      reachable: true,
      activeLane: "operator",
      tickCount: 4,
      bootCount: 2,
      journalEventCount: 8,
      nextTickDueAtMs: 12345,
      laneCounts: { idle: 1, pending: 2, active: 1 },
      highestPendingPriority: 50,
      nextLeaseExpiryAtMs: 12456,
      lastEventSummary: "lane operator activated (lease expires at 13000)",
      lastEventType: "lane_activated",
      stateDir: "/tmp/executive",
      error: null,
    });
  });

  it("returns an unavailable summary when the shadow daemon errors", async () => {
    mocks.createExecutiveShadowClient.mockReturnValue({
      getHealth: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
      getMetrics: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
      getTimeline: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    });

    const { getExecutiveShadowSummary } = await import("./status.executive-shadow.js");
    const summary = await getExecutiveShadowSummary();

    expect(summary.reachable).toBe(false);
    expect(summary.error).toContain("ECONNREFUSED");
  });
});
