import { describe, expect, it } from "vitest";
import {
  buildModelChoicesFromApi,
  deriveProviderAwareModelConfig,
  evaluateOnboardingStatus,
} from "../../dashboard/src/lib/onboardingStack.js";

describe("dashboard onboarding stack helpers", () => {
  it("flags stale anthropic router defaults when non-anthropic auth is configured", () => {
    const status = evaluateOnboardingStatus({
      authProfiles: [{ key: "minimax:default", provider: "minimax" }],
      modelConfig: {
        model: { primary: "minimax/MiniMax-M2.5" },
        subagentModel: "minimax/MiniMax-M2.5",
        modelRouter: null,
      },
    });

    expect(status.valid).toBe(false);
    expect(status.missingProviders).toContain("anthropic");
  });

  it("derives router and subagent defaults from the selected provider instead of anthropic", () => {
    const derived = deriveProviderAwareModelConfig({
      llmProvider: "zai",
      selectedModel: "zai/glm-5",
    });

    expect(derived.model).toEqual({ primary: "zai/glm-5" });
    expect(derived.subagentModel).toBe("zai/glm-5");
    expect(derived.modelRouter).toMatchObject({
      tiers: {
        fast: { provider: "zai", model: "glm-5" },
        balanced: { provider: "zai", model: "glm-5" },
        powerful: { provider: "zai", model: "glm-5" },
      },
    });
  });

  it("keeps curated fallback models even when the live inventory is sparse", () => {
    const choices = buildModelChoicesFromApi("zai", [{ id: "zai/glm-5", model: "glm-5" }]);

    expect(choices.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["zai/glm-5", "zai/glm-4.7", "zai/glm-4.6"]),
    );
  });
});
