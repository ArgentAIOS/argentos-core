import { describe, expect, it } from "vitest";
import { buildMemoryHealthSummaryFromSignals, classifyMemoryLaneStatus } from "./health.js";

describe("classifyMemoryLaneStatus", () => {
  const nowMs = Date.parse("2026-03-05T12:00:00.000Z");

  it("returns green for fresh successful lane with no failures", () => {
    const lane = classifyMemoryLaneStatus({
      lastSuccessAt: "2026-03-05T11:30:00.000Z",
      failureCount24h: 0,
      nowMs,
      yellowAfterHours: 2,
      redAfterHours: 8,
    });
    expect(lane.status).toBe("green");
    expect(lane.staleHours).toBeLessThan(1);
  });

  it("returns yellow when stale beyond yellow threshold", () => {
    const lane = classifyMemoryLaneStatus({
      lastSuccessAt: "2026-03-05T08:30:00.000Z",
      failureCount24h: 0,
      nowMs,
      yellowAfterHours: 2,
      redAfterHours: 8,
    });
    expect(lane.status).toBe("yellow");
    expect(lane.staleHours).toBeGreaterThanOrEqual(3);
  });

  it("returns red when last success is missing", () => {
    const lane = classifyMemoryLaneStatus({
      lastSuccessAt: null,
      failureCount24h: 0,
      nowMs,
      yellowAfterHours: 2,
      redAfterHours: 8,
    });
    expect(lane.status).toBe("red");
    expect(lane.staleHours).toBeNull();
  });
});

describe("buildMemoryHealthSummaryFromSignals", () => {
  const nowMs = Date.parse("2026-03-05T12:00:00.000Z");

  it("maps missing data to red lanes and clamps negative counters", () => {
    const summary = buildMemoryHealthSummaryFromSignals(
      {
        lastMemuExtractionAt: null,
        lastContemplationAt: null,
        lastSisConsolidationAt: null,
        lastRagIngestionAt: null,
        memuParseFailures24h: -3,
        sisParseFailures24h: -1,
        memuProvider: "ollama",
        memuModel: "qwen3:14b",
      },
      nowMs,
    );

    expect(summary.lanes.memuExtraction.status).toBe("red");
    expect(summary.lanes.contemplation.status).toBe("red");
    expect(summary.lanes.sisConsolidation.status).toBe("red");
    expect(summary.lanes.ragIngestion.status).toBe("red");
    expect(summary.failures24h.memuParse).toBe(0);
    expect(summary.failures24h.sisParse).toBe(0);
  });

  it("keeps memu extraction green for low fallback volume", () => {
    const summary = buildMemoryHealthSummaryFromSignals(
      {
        lastMemuExtractionAt: "2026-03-05T11:30:00.000Z",
        lastContemplationAt: "2026-03-05T11:30:00.000Z",
        lastSisConsolidationAt: "2026-03-05T11:30:00.000Z",
        lastRagIngestionAt: "2026-03-05T11:30:00.000Z",
        memuParseFailures24h: 2,
        sisParseFailures24h: 0,
        memuProvider: "ollama",
        memuModel: "qwen3:14b",
      },
      nowMs,
    );

    expect(summary.lanes.memuExtraction.status).toBe("green");
    expect(summary.lanes.memuExtraction.failureCount24h).toBe(2);
  });
});
