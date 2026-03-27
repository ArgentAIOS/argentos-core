import { describe, expect, it, vi } from "vitest";
import type { MemoryAdapter } from "../../data/adapter.js";
import {
  computeKnowledgeObservationFreshness,
  isKnowledgeObservationRevalidationDue,
  resolveKnowledgeObservationRevalidationDays,
  sweepKnowledgeObservationRevalidation,
} from "./revalidation.js";

describe("knowledge observation revalidation", () => {
  it("uses per-kind default day windows", () => {
    expect(resolveKnowledgeObservationRevalidationDays({ kind: "operator_preference" })).toBe(45);
    expect(resolveKnowledgeObservationRevalidationDays({ kind: "tooling_state" })).toBe(7);
  });

  it("decays freshness faster for stale tooling facts", () => {
    const recent = computeKnowledgeObservationFreshness({
      kind: "tooling_state",
      lastSupportedAt: "2026-03-08T00:00:00Z",
      now: new Date("2026-03-10T00:00:00Z"),
    });
    const stale = computeKnowledgeObservationFreshness({
      kind: "tooling_state",
      lastSupportedAt: "2026-02-10T00:00:00Z",
      now: new Date("2026-03-10T00:00:00Z"),
    });
    expect(recent.freshness).toBeGreaterThan(stale.freshness);
  });

  it("marks project_state and relationship_fact observations due when their windows expire", () => {
    expect(
      isKnowledgeObservationRevalidationDue({
        observation: {
          kind: "project_state",
          status: "active",
          revalidationDueAt: "2026-03-04T00:00:00Z",
          lastSupportedAt: "2026-03-01T00:00:00Z",
          lastContradictedAt: null,
        },
        now: new Date("2026-03-10T00:00:00Z"),
      }),
    ).toBe(true);

    expect(
      isKnowledgeObservationRevalidationDue({
        observation: {
          kind: "relationship_fact",
          status: "active",
          revalidationDueAt: "2026-03-25T00:00:00Z",
          lastSupportedAt: "2026-03-01T00:00:00Z",
          lastContradictedAt: null,
        },
        now: new Date("2026-03-10T00:00:00Z"),
      }),
    ).toBe(false);
  });

  it("sweeps due project_state and relationship_fact observations to stale", async () => {
    const markKnowledgeObservationStale = vi.fn(async () => {});
    const memory = {
      listKnowledgeObservations: vi.fn(async () => [
        {
          id: "obs-project",
          kind: "project_state",
          status: "active",
          revalidationDueAt: "2026-03-03T00:00:00Z",
          lastSupportedAt: "2026-03-01T00:00:00Z",
          lastContradictedAt: null,
        },
        {
          id: "obs-relationship",
          kind: "relationship_fact",
          status: "active",
          revalidationDueAt: "2026-03-05T00:00:00Z",
          lastSupportedAt: "2026-03-01T00:00:00Z",
          lastContradictedAt: null,
        },
        {
          id: "obs-fresh",
          kind: "relationship_fact",
          status: "active",
          revalidationDueAt: "2026-04-05T00:00:00Z",
          lastSupportedAt: "2026-03-20T00:00:00Z",
          lastContradictedAt: null,
        },
      ]),
      markKnowledgeObservationStale,
    };

    const result = await sweepKnowledgeObservationRevalidation({
      memory: memory as unknown as MemoryAdapter,
      now: new Date("2026-03-10T00:00:00Z"),
      kinds: ["project_state", "relationship_fact"],
    });

    expect(result.scanned).toBe(3);
    expect(result.markedStale).toBe(2);
    expect(result.staleIds).toEqual(["obs-project", "obs-relationship"]);
    expect(markKnowledgeObservationStale).toHaveBeenCalledTimes(2);
  });
});
