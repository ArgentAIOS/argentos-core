import { describe, expect, it } from "vitest";
import type { ModelRouterConfig } from "./types.js";
import { routeModel } from "./router.js";

function makeConfig(routingPolicy?: {
  likelyToolUseMinTier?: "local" | "fast" | "balanced" | "powerful";
  likelyMemoryUseMinTier?: "local" | "fast" | "balanced" | "powerful";
}): ModelRouterConfig {
  return {
    enabled: true,
    activeProfile: "test-profile",
    profiles: {
      "test-profile": {
        tiers: {
          local: { provider: "test", model: "local-model" },
          fast: { provider: "test", model: "fast-model" },
          balanced: { provider: "test", model: "balanced-model" },
          powerful: { provider: "test", model: "powerful-model" },
        },
        ...(routingPolicy ? { routingPolicy } : {}),
      },
    },
  };
}

describe("routeModel routing policy", () => {
  it("keeps likely tool-use prompts on the fast tier when the profile floor is off", () => {
    const decision = routeModel({
      signals: {
        prompt: "Remember that I prefer concise status updates.",
        sessionType: "main",
      },
      config: makeConfig(),
      defaultProvider: "fallback",
      defaultModel: "fallback-model",
    });

    expect(decision.tier).toBe("fast");
    expect(decision.model).toBe("fast-model");
  });

  it("promotes likely tool-use prompts when the profile sets a minimum tier", () => {
    const decision = routeModel({
      signals: {
        prompt: "Remember that I prefer concise status updates.",
        sessionType: "main",
      },
      config: makeConfig({ likelyToolUseMinTier: "balanced" }),
      defaultProvider: "fallback",
      defaultModel: "fallback-model",
    });

    expect(decision.tier).toBe("balanced");
    expect(decision.model).toBe("balanced-model");
    expect(decision.reason).toContain("tool-likely floor");
  });

  it("promotes likely memory-use prompts only when the profile enables that floor", () => {
    const prompt = "Search memory for our earlier conversation about pizza.";
    const withoutFloor = routeModel({
      signals: {
        prompt,
        sessionType: "main",
      },
      config: makeConfig(),
      defaultProvider: "fallback",
      defaultModel: "fallback-model",
    });
    const withFloor = routeModel({
      signals: {
        prompt,
        sessionType: "main",
      },
      config: makeConfig({ likelyMemoryUseMinTier: "balanced" }),
      defaultProvider: "fallback",
      defaultModel: "fallback-model",
    });

    expect(withoutFloor.tier).toBe("fast");
    expect(withFloor.tier).toBe("balanced");
    expect(withFloor.reason).toContain("memory-likely floor");
  });
});
