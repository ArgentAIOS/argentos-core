import { describe, expect, it } from "vitest";
import { computeKnowledgeObservationConfidence } from "./confidence.js";

describe("knowledge observation confidence", () => {
  it("increases with supporting evidence and diversity", () => {
    const weak = computeKnowledgeObservationConfidence({
      sourceCount: 1,
      sourceDiversity: 1,
      supportWeight: 1,
      contradictionWeight: 0,
      lastSupportedAt: "2026-03-01T00:00:00Z",
      now: new Date("2026-03-10T00:00:00Z"),
    });
    const strong = computeKnowledgeObservationConfidence({
      sourceCount: 4,
      sourceDiversity: 3,
      supportWeight: 3,
      contradictionWeight: 0,
      lastSupportedAt: "2026-03-08T00:00:00Z",
      now: new Date("2026-03-10T00:00:00Z"),
    });
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
  });

  it("penalizes contradictions and boosts operator-confirmed evidence", () => {
    const contradicted = computeKnowledgeObservationConfidence({
      sourceCount: 3,
      sourceDiversity: 2,
      supportWeight: 3,
      contradictionWeight: 2,
      now: new Date("2026-03-10T00:00:00Z"),
    });
    const confirmed = computeKnowledgeObservationConfidence({
      sourceCount: 3,
      sourceDiversity: 2,
      supportWeight: 3,
      contradictionWeight: 0,
      operatorConfirmed: true,
      now: new Date("2026-03-10T00:00:00Z"),
    });
    expect(confirmed.confidence).toBeGreaterThan(contradicted.confidence);
    expect(confirmed.components.operatorConfirmedBoost).toBeGreaterThan(0);
  });
});
