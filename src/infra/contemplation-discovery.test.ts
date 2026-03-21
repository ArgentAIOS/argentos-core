import { describe, expect, it, vi } from "vitest";
import { runDiscoveryPhase, shouldRunDiscoveryPhase } from "./contemplation-discovery.js";

function makeMemoryAdapter(overrides?: Partial<any>) {
  const nowIso = new Date("2026-03-12T00:00:00.000Z").toISOString();
  return {
    listItems: vi.fn(async (filter?: { memoryType?: string; limit?: number }) => {
      if (filter?.memoryType === "episode") {
        return [{ id: "ep-1" }, { id: "ep-2" }, { id: "ep-3" }, { id: "ep-4" }, { id: "ep-5" }];
      }
      return [
        {
          id: "item-1",
          summary: "Sun-Tech Electric outage review and network dependency mapping",
          happenedAt: nowIso,
          createdAt: nowIso,
        },
      ];
    }),
    searchByKeyword: vi.fn(async () => []),
    createItem: vi.fn(async () => ({ id: "disc-1" })),
    ...overrides,
  };
}

describe("shouldRunDiscoveryPhase", () => {
  it("skips when disabled", () => {
    const result = shouldRunDiscoveryPhase({
      config: {
        agents: { defaults: { contemplation: { discoveryPhase: { enabled: false } } } },
      } as never,
      episodeCount: 10,
    });
    expect(result.run).toBe(false);
    expect(result.reason).toBe("disabled");
  });

  it("enforces everyEpisodes gate", () => {
    const result = shouldRunDiscoveryPhase({
      config: {
        agents: {
          defaults: { contemplation: { discoveryPhase: { enabled: true, everyEpisodes: 5 } } },
        },
      } as never,
      episodeCount: 6,
    });
    expect(result.run).toBe(false);
    expect(result.reason).toBe("episode-gate");
  });
});

describe("runDiscoveryPhase", () => {
  it("creates discovery knowledge items when enabled and gated", async () => {
    const memory = makeMemoryAdapter();
    const result = await runDiscoveryPhase({
      config: {
        agents: {
          defaults: { contemplation: { discoveryPhase: { enabled: true, everyEpisodes: 5 } } },
        },
        memory: { cognee: { enabled: true, retrieval: { enabled: true } } },
      } as never,
      memory: memory as never,
      nowMs: Date.parse("2026-03-12T00:00:00.000Z"),
      cogneeRunner: async () => ({
        used: true,
        trigger: "sufficiency_fail",
        mode: "GRAPH_COMPLETION",
        results: [{ summary: "MikroTik failover relates to Sun-Tech incident", score: 0.9 }],
      }),
    });

    expect(result.status).toBe("completed");
    expect(result.created).toBeGreaterThan(0);
    expect(memory.createItem).toHaveBeenCalled();
  });

  it("returns timeout when budget is exceeded", async () => {
    const memory = makeMemoryAdapter();
    let now = Date.parse("2026-03-12T00:00:00.000Z");
    const currentMs = () => now;
    const slowRunner = async () => {
      now += 200;
      return {
        used: true,
        trigger: "sufficiency_fail" as const,
        mode: "GRAPH_COMPLETION" as const,
        results: [{ summary: "Slow discovery hit", score: 0.8 }],
      };
    };
    const result = await runDiscoveryPhase({
      config: {
        agents: {
          defaults: {
            contemplation: {
              discoveryPhase: { enabled: true, everyEpisodes: 5, maxDurationMs: 1 },
            },
          },
        },
        memory: { cognee: { enabled: true, retrieval: { enabled: true } } },
      } as never,
      memory: memory as never,
      nowMs: now,
      currentMs,
      cogneeRunner: slowRunner,
    });

    expect(result.status).toBe("timeout");
  });

  it("skips when no recent topics are available", async () => {
    const memory = makeMemoryAdapter({
      listItems: vi.fn(async (filter?: { memoryType?: string }) => {
        if (filter?.memoryType === "episode") {
          return [{ id: "ep-1" }, { id: "ep-2" }, { id: "ep-3" }, { id: "ep-4" }, { id: "ep-5" }];
        }
        return [];
      }),
    });
    const result = await runDiscoveryPhase({
      config: {
        agents: {
          defaults: { contemplation: { discoveryPhase: { enabled: true, everyEpisodes: 5 } } },
        },
        memory: { cognee: { enabled: true, retrieval: { enabled: true } } },
      } as never,
      memory: memory as never,
      nowMs: Date.parse("2026-03-12T00:00:00.000Z"),
      cogneeRunner: async () => ({ used: true, mode: "GRAPH_COMPLETION", results: [] }),
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("no-recent-topics");
  });
});
