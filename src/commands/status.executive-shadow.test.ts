import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

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
      getReadiness: vi.fn(async () => ({
        mode: "shadow-readiness",
        authoritySwitchAllowed: false,
        promotionStatus: "blocked",
        currentAuthority: {
          gateway: "node",
          scheduler: "node",
          workflows: "node",
          channels: "node",
          sessions: "node",
          executive: "shadow-only",
        },
        nodeResponsibilities: ["gateway live authority", "scheduler live authority"],
        rustResponsibilities: ["executive shadow state"],
        persistenceModel: {
          snapshotFile: "executive-state.json",
          journalFile: "executive.journal.jsonl",
          restartRecovery: "snapshot-plus-journal-replay",
          leaseRecovery: "tick-expiry-before-promotion",
        },
        promotionGates: [
          {
            id: "authority-boundary",
            status: "blocked",
            owner: "master-operator",
            requiredProof: ["no authority switch"],
          },
          {
            id: "restart-and-lease-recovery",
            status: "proven",
            owner: "aos",
            requiredProof: ["restart test"],
          },
        ],
      })),
    });

    const { getExecutiveShadowSummary } = await import("./status.executive-shadow.js");
    const summary = await getExecutiveShadowSummary();

    expect(summary).toEqual({
      reachable: true,
      kernelStatus: "fail-closed",
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
      readiness: {
        status: "fail-closed",
        mode: "shadow-readiness",
        authoritySwitchAllowed: false,
        promotionStatus: "blocked",
        failClosed: true,
        currentAuthority: {
          gateway: "node",
          scheduler: "node",
          workflows: "node",
          channels: "node",
          sessions: "node",
          executive: "shadow-only",
        },
        nodeResponsibilities: ["gateway live authority", "scheduler live authority"],
        rustResponsibilities: ["executive shadow state"],
        persistenceModel: {
          snapshotFile: "executive-state.json",
          journalFile: "executive.journal.jsonl",
          restartRecovery: "snapshot-plus-journal-replay",
          leaseRecovery: "tick-expiry-before-promotion",
        },
        promotionGates: [
          {
            id: "authority-boundary",
            status: "blocked",
            owner: "master-operator",
            requiredProof: ["no authority switch"],
          },
          {
            id: "restart-and-lease-recovery",
            status: "proven",
            owner: "aos",
            requiredProof: ["restart test"],
          },
        ],
        gateCounts: { blocked: 1, proven: 1 },
        error: null,
      },
      error: null,
    });
  });

  it("keeps health visible when Kernel readiness is unsafe", async () => {
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
        recentEvents: [],
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
      getReadiness: vi.fn(async () => {
        throw new ZodError([
          {
            code: "invalid_value",
            values: [false],
            path: ["authoritySwitchAllowed"],
            message: "Invalid input: expected false",
          },
        ]);
      }),
    });

    const { getExecutiveShadowSummary } = await import("./status.executive-shadow.js");
    const summary = await getExecutiveShadowSummary();

    expect(summary.reachable).toBe(true);
    expect(summary.kernelStatus).toBe("unsafe");
    expect(summary.readiness).toMatchObject({
      status: "unsafe",
      promotionStatus: "blocked",
      authoritySwitchAllowed: false,
      failClosed: false,
    });
    expect(summary.readiness?.error).toContain("expected false");
  });

  it("distinguishes readiness endpoint unavailability from unsafe payloads", async () => {
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
        recentEvents: [],
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
      getReadiness: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    });

    const { getExecutiveShadowSummary } = await import("./status.executive-shadow.js");
    const summary = await getExecutiveShadowSummary();

    expect(summary.reachable).toBe(true);
    expect(summary.kernelStatus).toBe("unavailable");
    expect(summary.readiness).toMatchObject({
      status: "unavailable",
      promotionStatus: "blocked",
      authoritySwitchAllowed: false,
      failClosed: false,
    });
    expect(summary.readiness?.error).toContain("ECONNREFUSED");
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
      getReadiness: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    });

    const { getExecutiveShadowSummary } = await import("./status.executive-shadow.js");
    const summary = await getExecutiveShadowSummary();

    expect(summary.reachable).toBe(false);
    expect(summary.kernelStatus).toBe("unavailable");
    expect(summary.error).toContain("ECONNREFUSED");
  });
});
