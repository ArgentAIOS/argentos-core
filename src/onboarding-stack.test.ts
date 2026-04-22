import { describe, expect, it } from "vitest";
import {
  deriveProviderAwareAgentSettingsPatch,
  deriveProviderAwareModelConfig,
} from "../dashboard/src/lib/onboardingStack.js";

describe("onboardingStack background defaults", () => {
  it("prefers a detected local runtime for background lanes and embeddings", () => {
    const patch = deriveProviderAwareAgentSettingsPatch({
      llmProvider: "minimax",
      selectedModel: "minimax/MiniMax-M2.5",
      availableModels: [
        {
          id: "minimax/MiniMax-M2.5",
          name: "MiniMax M2.5",
          description: "Flagship",
        },
        {
          id: "minimax/MiniMax-M2",
          name: "MiniMax M2",
          description: "Fast",
        },
      ],
      backgroundLocalRuntime: "lmstudio",
    });

    expect(patch.backgroundModels.kernel).toEqual({
      provider: "lmstudio",
      model: "qwen/qwen3.5-35b-a3b",
    });
    expect(patch.backgroundModels.executionWorker).toEqual({
      provider: "lmstudio",
      model: "qwen/qwen3.5-35b-a3b",
    });
    expect(patch.backgroundModels.embeddings).toEqual({
      provider: "lmstudio",
      model: "lmstudio/text-embedding-nomic-embed-text-v1.5",
      fallback: "none",
    });
    expect(patch.memory.memu.llm.provider).toBe("lmstudio");
    expect(patch.memory.memu.llm.model).toBe("qwen/qwen3.5-35b-a3b");
  });

  it("does not emit a top-level modelRouter.routingPolicy in onboarding defaults", () => {
    const derived = deriveProviderAwareModelConfig({
      llmProvider: "minimax",
      selectedModel: "minimax/MiniMax-M2.7-highspeed",
      availableModels: [
        {
          id: "minimax/MiniMax-M2.7-highspeed",
          name: "MiniMax M2.7 Highspeed",
          description: "Fast",
        },
      ],
    });

    expect(derived.modelRouter).toMatchObject({
      enabled: true,
      tiers: {
        fast: { provider: "minimax", model: "MiniMax-M2.7-highspeed" },
      },
    });
    expect((derived.modelRouter as { routingPolicy?: unknown }).routingPolicy).toBeUndefined();
  });
});
