import { describe, expect, it, vi } from "vitest";
import {
  createExecutiveShadowClient,
  ExecutiveShadowClientError,
  EXECUTIVE_SHADOW_DEFAULT_BASE_URL,
} from "./executive-shadow-client.js";

const kernelShadow = {
  reachable: true,
  status: "fail-closed",
  authority: "shadow",
  wakefulness: "active",
  agenda: {
    activeLane: "operator",
    pendingLanes: [],
    focus: "interactive",
  },
  focus: "interactive",
  ticks: {
    count: 4,
    lastTickAtMs: 12222,
    nextTickDueAtMs: 12345,
    intervalMs: 5000,
  },
  reflectionQueue: {
    status: "shadow-only",
    depth: 0,
    items: [],
  },
  persistedAt: 12222,
  restartRecovery: {
    model: "snapshot-plus-journal-replay",
    status: "recovered",
    bootCount: 2,
    lastRecoveredAtMs: 11111,
    journalEventCount: 8,
    snapshotFile: "executive.state.json",
    journalFile: "executive.journal.jsonl",
  },
};

describe("ExecutiveShadowClient", () => {
  it("reads health from the default base URL", async () => {
    let seenUrl = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(
        JSON.stringify({
          status: "ok",
          uptimeSeconds: 1,
          bootCount: 1,
          tickCount: 2,
          activeLane: null,
          journalEventCount: 3,
          stateDir: "/tmp/exec",
          nextTickDueAtMs: 123,
        }),
        { status: 200 },
      );
    });

    const client = createExecutiveShadowClient({ fetchImpl });
    const health = await client.getHealth();

    expect(seenUrl).toBe(`${EXECUTIVE_SHADOW_DEFAULT_BASE_URL}/health`);
    expect(health.tickCount).toBe(2);
  });

  it("normalizes trailing slashes in baseUrl", async () => {
    let seenUrl = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const client = createExecutiveShadowClient({
      baseUrl: "http://127.0.0.1:18809///",
      fetchImpl,
    });
    await client.getJournal(5);

    expect(seenUrl).toBe("http://127.0.0.1:18809/v1/executive/journal?limit=5");
  });

  it("reads metrics from the dedicated metrics endpoint", async () => {
    let seenUrl = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(
        JSON.stringify({
          activeLane: "operator",
          laneCounts: { idle: 1, pending: 1, active: 1 },
          bootCount: 2,
          tickCount: 4,
          journalEventCount: 9,
          nextTickDueAtMs: 123,
          lastTickAtMs: 100,
          lastRecoveredAtMs: 99,
          nextLeaseExpiryAtMs: 150,
          highestPendingPriority: 50,
        }),
        { status: 200 },
      );
    });

    const client = createExecutiveShadowClient({ fetchImpl });
    const metrics = await client.getMetrics();

    expect(seenUrl).toBe(`${EXECUTIVE_SHADOW_DEFAULT_BASE_URL}/v1/executive/metrics`);
    expect(metrics.laneCounts.active).toBe(1);
    expect(metrics.highestPendingPriority).toBe(50);
  });

  it("reads readiness from the fail-closed Kernel readiness endpoint", async () => {
    let seenUrl = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(
        JSON.stringify({
          mode: "shadow-readiness",
          authoritySwitchAllowed: false,
          promotionStatus: "blocked",
          kernelShadow,
          currentAuthority: {
            gateway: "node",
            scheduler: "node",
            workflows: "node",
            channels: "node",
            sessions: "node",
            executive: "shadow-only",
          },
          nodeResponsibilities: ["gateway live authority"],
          rustResponsibilities: ["executive shadow state"],
          persistenceModel: {
            snapshotFile: "executive.state.json",
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
          ],
        }),
        { status: 200 },
      );
    });

    const client = createExecutiveShadowClient({ fetchImpl });
    const readiness = await client.getReadiness();

    expect(seenUrl).toBe(`${EXECUTIVE_SHADOW_DEFAULT_BASE_URL}/v1/executive/readiness`);
    expect(readiness.authoritySwitchAllowed).toBe(false);
    expect(readiness.promotionStatus).toBe("blocked");
  });

  it("fails closed when readiness implies authority promotion", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            mode: "shadow-readiness",
            authoritySwitchAllowed: true,
            promotionStatus: "ready",
            kernelShadow,
            currentAuthority: {
              gateway: "rust",
              scheduler: "node",
              workflows: "node",
              channels: "node",
              sessions: "node",
              executive: "shadow-only",
            },
            nodeResponsibilities: [],
            rustResponsibilities: [],
            persistenceModel: {
              snapshotFile: "executive.state.json",
              journalFile: "executive.journal.jsonl",
              restartRecovery: "snapshot-plus-journal-replay",
              leaseRecovery: "tick-expiry-before-promotion",
            },
            promotionGates: [],
          }),
          { status: 200 },
        ),
    );
    const client = createExecutiveShadowClient({ fetchImpl });

    await expect(client.getReadiness()).rejects.toThrow();
  });

  it("fails closed when readiness moves Gateway off Node live authority", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            mode: "shadow-readiness",
            authoritySwitchAllowed: false,
            promotionStatus: "blocked",
            kernelShadow,
            currentAuthority: {
              gateway: "rust",
              scheduler: "node",
              workflows: "node",
              channels: "node",
              sessions: "node",
              executive: "shadow-only",
            },
            nodeResponsibilities: [],
            rustResponsibilities: [],
            persistenceModel: {
              snapshotFile: "executive.state.json",
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
            ],
          }),
          { status: 200 },
        ),
    );
    const client = createExecutiveShadowClient({ fetchImpl });

    await expect(client.getReadiness()).rejects.toThrow(
      "Executive shadow readiness is not fail-closed",
    );
  });

  it("reads compact timeline summaries", async () => {
    let seenUrl = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(
        JSON.stringify({
          activeLane: "operator",
          journalEventCount: 9,
          recentEvents: [
            {
              seq: 9,
              atMs: 12345,
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
          lastActivationAtMs: 12345,
          lastReleaseAtMs: null,
          lastReleaseOutcome: null,
        }),
        { status: 200 },
      );
    });

    const client = createExecutiveShadowClient({ fetchImpl });
    const timeline = await client.getTimeline(5);

    expect(seenUrl).toBe(`${EXECUTIVE_SHADOW_DEFAULT_BASE_URL}/v1/executive/timeline?limit=5`);
    expect(timeline.recentEvents[0]?.type).toBe("lane_activated");
    expect(timeline.counts.tick).toBe(4);
  });

  it("blocks write calls unless experimentalWrites is enabled", async () => {
    const fetchImpl = vi.fn();
    const client = createExecutiveShadowClient({ fetchImpl });

    await expect(client.experimentalRequestLane({ lane: "operator" })).rejects.toThrow(
      /experimentalWrites=true/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends JSON request bodies for experimental writes", async () => {
    let seenInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenInit = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const client = createExecutiveShadowClient({
      fetchImpl,
      experimentalWrites: true,
    });
    await client.experimentalRequestLane({
      lane: "operator",
      priority: 95,
      reason: "interactive",
      leaseMs: 8000,
    });

    expect(seenInit?.method).toBe("POST");
    expect(seenInit?.headers).toEqual({ "Content-Type": "application/json" });
    expect(seenInit?.body).toBe(
      JSON.stringify({
        lane: "operator",
        priority: 95,
        reason: "interactive",
        leaseMs: 8000,
      }),
    );
  });

  it("throws a typed error on non-ok responses", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "missing lane" }), { status: 400 }),
    );
    const client = createExecutiveShadowClient({
      fetchImpl,
      experimentalWrites: true,
    });

    await expect(client.experimentalReleaseLane({ lane: "" })).rejects.toBeInstanceOf(
      ExecutiveShadowClientError,
    );
  });

  it("rejects malformed success payloads", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "ok",
            uptimeSeconds: "not-a-number",
          }),
          { status: 200 },
        ),
    );
    const client = createExecutiveShadowClient({ fetchImpl });

    await expect(client.getHealth()).rejects.toThrow();
  });
});
