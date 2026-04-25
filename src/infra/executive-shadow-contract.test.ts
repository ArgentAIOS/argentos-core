import { describe, expect, it } from "vitest";
import {
  executiveShadowHealthSchema,
  executiveShadowJournalSchema,
  executiveShadowMetricsSchema,
  executiveShadowOkSchema,
  executiveShadowStateEnvelopeSchema,
} from "./executive-shadow-contract.js";

describe("executive shadow contract schemas", () => {
  it("accepts a valid health payload", () => {
    const payload = executiveShadowHealthSchema.parse({
      status: "ok",
      uptimeSeconds: 12,
      bootCount: 2,
      tickCount: 4,
      activeLane: "operator",
      journalEventCount: 8,
      stateDir: "/tmp/executive",
      nextTickDueAtMs: 12345,
    });
    expect(payload.activeLane).toBe("operator");
  });

  it("accepts a valid metrics payload", () => {
    const payload = executiveShadowMetricsSchema.parse({
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
    });
    expect(payload.laneCounts.pending).toBe(2);
  });

  it("accepts a valid state envelope", () => {
    const payload = executiveShadowStateEnvelopeSchema.parse({
      config: {
        bindAddr: "127.0.0.1:18809",
        stateDir: "/tmp/executive",
      },
      state: {
        schema_version: 1,
        boot_count: 2,
        last_seq: 9,
        tick_count: 4,
        active_lane: "operator",
        last_started_at_ms: 1000,
        last_recovered_at_ms: 1100,
        last_tick_at_ms: 1200,
        next_tick_due_at_ms: 1300,
        tick_interval_ms: 5000,
        default_lease_ms: 30000,
        lanes: {
          operator: {
            name: "operator",
            status: "active",
            priority: 95,
            reason: "interactive",
            requested_at_ms: 1010,
            started_at_ms: 1020,
            completed_at_ms: null,
            lease_expires_at_ms: 1500,
            last_outcome: null,
          },
        },
      },
    });
    expect(payload.state.lanes.operator.status).toBe("active");
  });

  it("accepts a valid journal payload", () => {
    const payload = executiveShadowJournalSchema.parse([
      { seq: 1, at_ms: 1000, event: { type: "booted", boot_count: 1 } },
      {
        seq: 2,
        at_ms: 1010,
        event: {
          type: "lane_requested",
          lane: "operator",
          priority: 95,
          reason: "interactive",
          lease_ms: 8000,
        },
      },
      {
        seq: 3,
        at_ms: 1020,
        event: {
          type: "lane_activated",
          lane: "operator",
          lease_expires_at_ms: 9000,
        },
      },
    ]);
    expect(payload).toHaveLength(3);
  });

  it("accepts the generic ok response", () => {
    const payload = executiveShadowOkSchema.parse({ ok: true });
    expect(payload.ok).toBe(true);
  });

  it("rejects malformed state payloads", () => {
    expect(() =>
      executiveShadowStateEnvelopeSchema.parse({
        config: {
          bindAddr: "127.0.0.1:18809",
          stateDir: "/tmp/executive",
        },
        state: {
          schema_version: 1,
          boot_count: 2,
        },
      }),
    ).toThrow();
  });
});
