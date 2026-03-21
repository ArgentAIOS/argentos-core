import { describe, expect, it } from "vitest";
import { evaluateRelationshipExecution } from "./relationship-eval.js";

describe("evaluateRelationshipExecution", () => {
  it("rewards structured relationship contracts and aligned departments", () => {
    const result = evaluateRelationshipExecution({
      simulationViolation: false,
      deploymentStage: "shadow",
      latestStatus: "completed",
      declaredDepartmentId: "support",
      effectiveDepartmentId: "support",
      departmentPolicy: {
        objective: "Protect trust first.",
        escalation: {
          maxAttemptsBeforeEscalation: 1,
        },
      },
      relationshipContract: {
        relationshipObjective: "Reduce customer anxiety while preserving trust.",
        toneProfile: "calm, transparent, steady",
        trustPriorities: ["preserve trust", "reduce anxiety"],
        continuityRequirements: ["preserve prior customer context"],
        honestyRules: ["do not bluff certainty"],
        handoffStyle: "honest warm handoff",
        relationalFailureModes: ["cold closure", "overclaim certainty"],
      },
      intent: {
        agentId: "main",
        departmentId: "support",
        runtimeMode: "enforce",
        validationMode: "enforce",
        policy: {
          objective: "Represent support with care.",
          escalation: {
            maxAttemptsBeforeEscalation: 1,
          },
        },
        lineage: {},
        issues: [],
      },
    });

    expect(result.contractCoverageScore).toBeGreaterThan(0.9);
    expect(result.departmentAligned).toBe(true);
    expect(result.recommendation).not.toBe("hold");
  });

  it("penalizes department mismatch and simulation violations", () => {
    const result = evaluateRelationshipExecution({
      simulationViolation: true,
      deploymentStage: "limited-live",
      latestStatus: "blocked",
      declaredDepartmentId: "support",
      effectiveDepartmentId: "engineering",
      relationshipContract: {
        relationshipObjective: "Represent support faithfully.",
      },
      intent: {
        agentId: "main",
        departmentId: "engineering",
        runtimeMode: "enforce",
        validationMode: "enforce",
        policy: {},
        lineage: {},
        issues: [{ path: "intent.agents.main", message: "bad alignment" }],
      },
    });

    expect(result.departmentAligned).toBe(false);
    expect(result.overallScore).toBeLessThan(0.75);
    expect(result.recommendation).toBe("hold");
  });

  it("tracks recent relationship trend", () => {
    const result = evaluateRelationshipExecution({
      simulationViolation: false,
      deploymentStage: "limited-live",
      latestStatus: "completed",
      declaredDepartmentId: "support",
      effectiveDepartmentId: "support",
      relationshipContract: {
        relationshipObjective: "Protect trust.",
        toneProfile: "calm",
      },
      recentScores: [0.62, 0.68, 0.79],
      intent: {
        agentId: "main",
        departmentId: "support",
        runtimeMode: "enforce",
        validationMode: "enforce",
        policy: {},
        lineage: {},
        issues: [],
      },
    });

    expect(result.recentAverageScore).toBeGreaterThan(0.6);
    expect(result.recentTrend).toBe("declining");
  });
});
