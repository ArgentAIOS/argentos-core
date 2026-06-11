import { beforeEach, describe, expect, it, vi } from "vitest";

const evaluateIntentSimulationGateSpy = vi.fn();

vi.mock("./intent-runtime-gate.js", () => ({
  evaluateIntentSimulationGateForConfig: evaluateIntentSimulationGateSpy,
}));

describe("optional intent simulation gate cache", () => {
  beforeEach(() => {
    vi.resetModules();
    evaluateIntentSimulationGateSpy.mockReset();
  });

  it("reuses cached evaluations for identical inputs", async () => {
    const mod = await import("./optional-intent.js");
    mod.clearIntentSimulationGateCache();
    evaluateIntentSimulationGateSpy.mockResolvedValue({
      evaluation: {
        enabled: true,
        mode: "warn",
        minPassRate: 0.8,
        minComponentScores: {},
        requiredSuites: [],
        overallPassRate: 1,
        aggregateScores: null,
        blocking: false,
        reasons: [],
      },
      warnings: [],
    });

    const params = {
      agentId: "main",
      workspaceDir: "/tmp/workspace",
      intent: { runtimeMode: "advisory" as const },
    };

    const first = await mod.evaluateIntentSimulationGateForConfigIfAvailable(params);
    const second = await mod.evaluateIntentSimulationGateForConfigIfAvailable(params);

    expect(first).toEqual(second);
    expect(evaluateIntentSimulationGateSpy).toHaveBeenCalledTimes(1);
  });

  it("runs again after the cache is cleared", async () => {
    const mod = await import("./optional-intent.js");
    mod.clearIntentSimulationGateCache();
    evaluateIntentSimulationGateSpy
      .mockResolvedValueOnce({
        evaluation: {
          enabled: true,
          mode: "warn",
          minPassRate: 0.8,
          minComponentScores: {},
          requiredSuites: [],
          overallPassRate: 1,
          aggregateScores: null,
          blocking: false,
          reasons: [],
        },
        warnings: [],
      })
      .mockResolvedValueOnce({
        evaluation: {
          enabled: true,
          mode: "warn",
          minPassRate: 0.8,
          minComponentScores: {},
          requiredSuites: [],
          overallPassRate: 0.9,
          aggregateScores: null,
          blocking: false,
          reasons: ["changed"],
        },
        warnings: ["changed"],
      });

    const params = {
      agentId: "main",
      workspaceDir: "/tmp/workspace",
      intent: { runtimeMode: "advisory" as const },
    };

    const first = await mod.evaluateIntentSimulationGateForConfigIfAvailable(params);
    mod.clearIntentSimulationGateCache();
    const second = await mod.evaluateIntentSimulationGateForConfigIfAvailable(params);

    expect(first).not.toEqual(second);
    expect(evaluateIntentSimulationGateSpy).toHaveBeenCalledTimes(2);
  });
});
