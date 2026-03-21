import { describe, expect, it, vi } from "vitest";
import {
  buildCogneeSupplement,
  isCogneeStructuralQuery,
  resolveCogneeSearchModes,
  resolveCogneeTrigger,
  runCogneeSearch,
} from "./cognee.js";

describe("cognee retrieval gating", () => {
  it("detects structural queries", () => {
    expect(isCogneeStructuralQuery("How does X connect to Y?")).toBe(true);
    expect(isCogneeStructuralQuery("relationship between cache and latency")).toBe(true);
    expect(isCogneeStructuralQuery("what is Jason's timezone")).toBe(false);
  });

  it("does not trigger when cognee retrieval is disabled", () => {
    const trigger = resolveCogneeTrigger({
      config: { memory: { cognee: { enabled: false, retrieval: { enabled: false } } } } as never,
      query: "How does X connect to Y?",
      sufficiencyFailed: true,
    });
    expect(trigger).toBeNull();
  });

  it("triggers on sufficiency fail when enabled", () => {
    const trigger = resolveCogneeTrigger({
      config: { memory: { cognee: { enabled: true, retrieval: { enabled: true } } } } as never,
      query: "plain factual query",
      sufficiencyFailed: true,
    });
    expect(trigger).toBe("sufficiency_fail");
  });

  it("triggers on structural query when enabled", () => {
    const trigger = resolveCogneeTrigger({
      config: { memory: { cognee: { enabled: true, retrieval: { enabled: true } } } } as never,
      query: "How does system A connect to system B?",
      sufficiencyFailed: false,
    });
    expect(trigger).toBe("structural_query");
  });

  it("normalizes configured search modes and drops invalid values", () => {
    const modes = resolveCogneeSearchModes({
      memory: {
        cognee: {
          retrieval: {
            searchModes: ["insights", "SIMILARITY", "INVALID_MODE"] as never,
          },
        },
      },
    } as never);
    expect(modes).toEqual(["INSIGHTS", "SIMILARITY"]);
  });
});

describe("runCogneeSearch", () => {
  it("keeps feature fully off when trigger is not active", async () => {
    const runner = vi.fn();
    const result = await runCogneeSearch({
      config: { memory: { cognee: { enabled: false, retrieval: { enabled: false } } } } as never,
      query: "what is this",
      sufficiencyFailed: false,
      commandRunner: runner,
    });
    expect(result).toEqual({ used: false, results: [] });
    expect(runner).not.toHaveBeenCalled();
  });

  it("uses AOS contract args and parses success envelopes", async () => {
    const query = "How does A connect to B?";
    const runner = vi.fn(async () =>
      JSON.stringify({
        ok: true,
        tool: "aos-cognee",
        command: "search",
        data: {
          results: [
            { summary: "Graph insight A", score: 0.91, source: "vault", vaultPath: "notes/a.md" },
            { content: "Graph insight B", score: 0.73, sourceVaultPath: "notes/b.md" },
          ],
        },
      }),
    );

    const result = await runCogneeSearch({
      config: {
        memory: {
          cognee: {
            enabled: true,
            retrieval: {
              enabled: true,
              searchModes: ["GRAPH_COMPLETION"],
              maxResultsPerQuery: 5,
            },
          },
        },
      } as never,
      query,
      sufficiencyFailed: false,
      commandRunner: runner,
    });

    expect(result.used).toBe(true);
    expect(result.mode).toBe("GRAPH_COMPLETION");
    expect(result.trigger).toBe("structural_query");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.summary).toBe("Graph insight A");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      "aos-cognee",
      ["--json", "--mode", "readonly", "search", query, "--search-mode", "GRAPH_COMPLETION"],
      4000,
    );
  });

  it("falls back to legacy invocation when AOS contract flags are unsupported", async () => {
    const query = "How does A connect to B?";
    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes("--search-mode")) {
        throw new Error("unknown option --search-mode");
      }
      return JSON.stringify({
        results: [{ summary: "Legacy graph hit", score: 0.6, source: "vault" }],
      });
    });

    const result = await runCogneeSearch({
      config: {
        memory: {
          cognee: {
            enabled: true,
            retrieval: {
              enabled: true,
              searchModes: ["GRAPH_COMPLETION"],
            },
          },
        },
      } as never,
      query,
      sufficiencyFailed: false,
      commandRunner: runner,
    });

    expect(result.used).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.summary).toBe("Legacy graph hit");
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0]?.[1]).toEqual([
      "--json",
      "--mode",
      "readonly",
      "search",
      query,
      "--search-mode",
      "GRAPH_COMPLETION",
    ]);
    expect(runner.mock.calls[1]?.[1]).toEqual([
      "search",
      query,
      "--mode",
      "GRAPH_COMPLETION",
      "--json",
    ]);
  });

  it("surfaces AOS envelope errors without throwing", async () => {
    const runner = vi.fn(async () =>
      JSON.stringify({
        ok: false,
        tool: "aos-cognee",
        command: "search",
        error: {
          code: "PERMISSION_DENIED",
          message: "Command requires mode=full",
        },
      }),
    );

    const result = await runCogneeSearch({
      config: {
        memory: {
          cognee: {
            enabled: true,
            retrieval: {
              enabled: true,
              searchModes: ["GRAPH_COMPLETION"],
            },
          },
        },
      } as never,
      query: "How does A connect to B?",
      sufficiencyFailed: false,
      commandRunner: runner,
    });

    expect(result.used).toBe(false);
    expect(result.error).toContain("PERMISSION_DENIED");
    expect(result.error).toContain("mode=full");
    expect(result.results).toEqual([]);
  });

  it("returns safe fallback when command errors", async () => {
    const runner = vi.fn(async () => {
      throw new Error("spawn aos-cognee ENOENT");
    });

    const result = await runCogneeSearch({
      config: {
        memory: {
          cognee: {
            enabled: true,
            retrieval: {
              enabled: true,
              searchModes: ["GRAPH_COMPLETION"],
            },
          },
        },
      } as never,
      query: "How does A connect to B?",
      sufficiencyFailed: false,
      commandRunner: runner,
    });

    expect(result.used).toBe(false);
    expect(result.error).toContain("ENOENT");
    expect(result.error).toContain("legacy fallback failed");
    expect(result.results).toEqual([]);
    expect(runner).toHaveBeenCalledTimes(2);
  });
});

describe("buildCogneeSupplement", () => {
  it("ranks supplemental hits by normalized score and memu overlap", () => {
    const supplement = buildCogneeSupplement({
      memuSummaries: ["Sun-Tech Electric uses MikroTik failover and Rack Canary alerts"],
      cogneeHits: [
        { summary: "MikroTik failover links to Sun-Tech network path", score: 0.6 },
        { summary: "Unrelated sales insight for another client", score: 0.9 },
      ],
      limit: 5,
    });

    expect(supplement).toHaveLength(2);
    expect(supplement[0]?.summary).toContain("MikroTik");
    expect(supplement[0]?.mergedScore).toBeGreaterThan(0);
    expect(supplement[0]?.overlapScore).toBeGreaterThan(0);
  });

  it("returns empty list when there are no cognee hits", () => {
    const supplement = buildCogneeSupplement({
      memuSummaries: ["anything"],
      cogneeHits: [],
      limit: 5,
    });
    expect(supplement).toEqual([]);
  });
});
