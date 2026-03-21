import { describe, expect, it } from "vitest";
import { evaluateIntentSimulationGate } from "./intent-simulation.js";

describe("evaluateIntentSimulationGate", () => {
  it("returns disabled when intent gate is off", () => {
    const result = evaluateIntentSimulationGate({
      intent: {
        enabled: true,
        simulationGate: {
          enabled: false,
        },
      },
      suites: [],
    });
    expect(result.enabled).toBe(false);
    expect(result.blocking).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("blocks when enforce mode has missing required suites", () => {
    const result = evaluateIntentSimulationGate({
      intent: {
        enabled: true,
        simulationGate: {
          enabled: true,
          mode: "enforce",
          suites: ["support-regression", "vip-escalation"],
          minPassRate: 0.85,
        },
      },
      suites: [
        {
          suiteId: "support-regression",
          passRate: 0.9,
          componentScores: {
            objectiveAdherence: 0.9,
            boundaryCompliance: 0.9,
            escalationCorrectness: 0.9,
            outcomeQuality: 0.9,
          },
        },
      ],
    });
    expect(result.enabled).toBe(true);
    expect(result.blocking).toBe(true);
    expect(result.reasons.some((reason) => reason.includes("vip-escalation"))).toBe(true);
  });

  it("does not block in warn mode when suites underperform", () => {
    const result = evaluateIntentSimulationGate({
      intent: {
        enabled: true,
        simulationGate: {
          enabled: true,
          mode: "warn",
          minPassRate: 0.9,
        },
      },
      suites: [
        {
          suiteId: "baseline",
          passRate: 0.7,
          componentScores: {
            objectiveAdherence: 0.8,
            boundaryCompliance: 0.95,
            escalationCorrectness: 0.7,
            outcomeQuality: 0.6,
          },
        },
      ],
    });
    expect(result.enabled).toBe(true);
    expect(result.blocking).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("below minimum");
  });

  it("computes aggregate component scores for required suites", () => {
    const result = evaluateIntentSimulationGate({
      intent: {
        enabled: true,
        simulationGate: {
          enabled: true,
          mode: "enforce",
          suites: ["a", "b"],
          minPassRate: 0.8,
        },
      },
      suites: [
        {
          suiteId: "a",
          passRate: 0.9,
          componentScores: {
            objectiveAdherence: 0.8,
            boundaryCompliance: 0.9,
            escalationCorrectness: 0.7,
            outcomeQuality: 0.6,
          },
        },
        {
          suiteId: "b",
          passRate: 1,
          componentScores: {
            objectiveAdherence: 1,
            boundaryCompliance: 0.7,
            escalationCorrectness: 0.9,
            outcomeQuality: 0.8,
          },
        },
        {
          suiteId: "c",
          passRate: 0.2,
          componentScores: {
            objectiveAdherence: 0.1,
            boundaryCompliance: 0.1,
            escalationCorrectness: 0.1,
            outcomeQuality: 0.1,
          },
        },
      ],
    });

    expect(result.blocking).toBe(false);
    expect(result.overallPassRate).toBeCloseTo(0.95, 6);
    expect(result.aggregateScores?.objectiveAdherence).toBeCloseTo(0.9, 6);
    expect(result.aggregateScores?.boundaryCompliance).toBeCloseTo(0.8, 6);
    expect(result.aggregateScores?.escalationCorrectness).toBeCloseTo(0.8, 6);
    expect(result.aggregateScores?.outcomeQuality).toBeCloseTo(0.7, 6);
  });

  it("blocks when aggregate component scores are below configured thresholds", () => {
    const result = evaluateIntentSimulationGate({
      intent: {
        enabled: true,
        simulationGate: {
          enabled: true,
          mode: "enforce",
          minPassRate: 0.5,
          minComponentScores: {
            boundaryCompliance: 0.8,
            outcomeQuality: 0.75,
          },
        },
      },
      suites: [
        {
          suiteId: "baseline",
          passRate: 0.9,
          componentScores: {
            objectiveAdherence: 0.9,
            boundaryCompliance: 0.7,
            escalationCorrectness: 0.9,
            outcomeQuality: 0.6,
          },
        },
      ],
    });

    expect(result.enabled).toBe(true);
    expect(result.blocking).toBe(true);
    expect(result.reasons.some((reason) => reason.includes("boundaryCompliance"))).toBe(true);
    expect(result.reasons.some((reason) => reason.includes("outcomeQuality"))).toBe(true);
  });
});
