import { describe, expect, it } from "vitest";
import {
  buildModelChoicesFromApi,
  chooseInitialModelForProvider,
  deriveProviderAwareModelConfig,
  evaluateOnboardingStatus,
  getProviderFallbackModels,
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
        fast: { provider: "zai", model: "glm-4.6" },
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

  it("snaps the selected model back to the chosen provider when the current model is from another stack", () => {
    const fallback = getProviderFallbackModels("zai");

    expect(chooseInitialModelForProvider("zai", "groq/llama-3.3-70b-versatile", fallback)).toBe(
      "zai/glm-5",
    );
  });

  it("tolerates malformed onboarding payload shapes without crashing helper logic", () => {
    const status = evaluateOnboardingStatus({
      authProfiles: undefined,
      modelConfig: {
        model: { primary: "openai/gpt-5.4-mini" },
        subagentModel: null,
        modelRouter: null,
      },
    });

    expect(status.valid).toBe(false);
    expect(
      chooseInitialModelForProvider(
        "openai",
        "openai/gpt-5.4-mini",
        undefined as unknown as ReturnType<typeof getProviderFallbackModels>,
      ),
    ).toBe("");
  });

  it("derives distinct zai router tiers from the available inventory", () => {
    const derived = deriveProviderAwareModelConfig({
      llmProvider: "zai",
      selectedModel: "zai/glm-5",
      availableModels: buildModelChoicesFromApi("zai", [
        { id: "zai/glm-4.6", model: "glm-4.6" },
        { id: "zai/glm-4.7", model: "glm-4.7" },
        { id: "zai/glm-5", model: "glm-5" },
        { id: "zai/glm-5.1", model: "glm-5.1" },
      ]),
    });

    expect(derived.modelRouter).toMatchObject({
      tiers: {
        fast: { provider: "zai", model: "glm-4.6" },
        balanced: { provider: "zai", model: "glm-5" },
        powerful: { provider: "zai", model: "glm-5.1" },
      },
    });
  });
});
