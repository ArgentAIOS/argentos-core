import { describe, expect, it } from "vitest";
import type { ModelRouterConfig } from "./types.js";
import { ModelHealthTracker } from "./model-health-tracker.js";
import { routeModel } from "./router.js";

/**
 * Tests for #281 — routing-suggestion engine de-prioritizes models with
 * recent empty-response failures (sliding-window threshold).
 */
function makeConfig(opts?: {
  fallbackProfile?: string;
  withFallbackProfiles?: boolean;
  contemplationFallbacks?: string[];
  contemplationModel?: { provider: string; model: string };
}): ModelRouterConfig {
  const profiles: NonNullable<ModelRouterConfig["profiles"]> = {
    primary: {
      tiers: {
        local: { provider: "zai", model: "glm-5-turbo" },
        fast: { provider: "zai", model: "glm-5-turbo" },
        balanced: { provider: "zai", model: "glm-5-turbo" },
        powerful: { provider: "zai", model: "glm-5-turbo" },
      },
      ...(opts?.fallbackProfile ? { fallbackProfile: opts.fallbackProfile } : {}),
      ...(opts?.contemplationModel
        ? {
            sessionOverrides: {
              contemplation: {
                provider: opts.contemplationModel.provider,
                model: opts.contemplationModel.model,
                ...(opts.contemplationFallbacks ? { fallbacks: opts.contemplationFallbacks } : {}),
              },
            },
          }
        : {}),
    },
  };
  if (opts?.withFallbackProfiles) {
    profiles.healthy = {
      tiers: {
        local: { provider: "zai", model: "glm-4.7" },
        fast: { provider: "zai", model: "glm-4.7" },
        balanced: { provider: "zai", model: "glm-4.7" },
        powerful: { provider: "zai", model: "glm-4.7" },
      },
    };
  }
  return {
    enabled: true,
    activeProfile: "primary",
    profiles,
  };
}

describe("routeModel — recently-failed-empty weight (#281)", () => {
  it("returns the primary unchanged when no model is flaking", () => {
    const tracker = new ModelHealthTracker({ window: 10, threshold: 3 });
    const decision = routeModel({
      signals: { prompt: "hello", sessionType: "main" },
      config: makeConfig({
        contemplationFallbacks: ["zai/glm-4.7"],
        contemplationModel: { provider: "zai", model: "glm-5-turbo" },
      }),
      defaultProvider: "zai",
      defaultModel: "glm-5-turbo",
      healthTracker: tracker,
    });
    expect(decision.provider).toBe("zai");
    expect(decision.model).toBe("glm-5-turbo");
    expect(decision.reason).not.toContain("recent-empty");
  });

  it("does NOT swap primaries from a healthy model's per-tier choice when no fallbacks exist", () => {
    const tracker = new ModelHealthTracker({ window: 10, threshold: 3 });
    // Mark glm-5-turbo as flaking.
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    expect(tracker.isFlaking("zai", "glm-5-turbo")).toBe(true);

    const decision = routeModel({
      signals: { prompt: "hello", sessionType: "main" },
      config: makeConfig(),
      defaultProvider: "zai",
      defaultModel: "glm-5-turbo",
      healthTracker: tracker,
    });
    // No fallbacks available → primary stays (we never *block* a model),
    // but the decision reason annotates that it's flaking.
    expect(decision.provider).toBe("zai");
    expect(decision.model).toBe("glm-5-turbo");
    expect(decision.reason).toContain("recent-empty flaking");
  });

  it("promotes the first healthy sessionFallback when the contemplation primary is flaking", () => {
    const tracker = new ModelHealthTracker({ window: 10, threshold: 3 });
    for (let i = 0; i < 3; i++) tracker.recordOutcome("zai", "glm-5-turbo", "empty");

    const decision = routeModel({
      signals: { prompt: "deep reflection", sessionType: "contemplation" },
      config: makeConfig({
        contemplationModel: { provider: "zai", model: "glm-5-turbo" },
        contemplationFallbacks: ["zai/glm-4.7"],
      }),
      defaultProvider: "zai",
      defaultModel: "glm-5-turbo",
      healthTracker: tracker,
    });

    expect(decision.provider).toBe("zai");
    expect(decision.model).toBe("glm-4.7");
    expect(decision.reason).toContain("recent-empty deprioritized");
    // The original primary is demoted into the front of the fallback chain —
    // still selectable, just no longer first choice.
    expect(decision.fallbacks?.[0]).toBe("zai/glm-5-turbo");
  });

  it("promotes a profileFallback when sessionFallbacks are absent and primary is flaking", () => {
    const tracker = new ModelHealthTracker({ window: 10, threshold: 3 });
    for (let i = 0; i < 3; i++) tracker.recordOutcome("zai", "glm-5-turbo", "empty");

    const decision = routeModel({
      signals: { prompt: "hi", sessionType: "main" },
      config: makeConfig({ fallbackProfile: "healthy", withFallbackProfiles: true }),
      defaultProvider: "zai",
      defaultModel: "glm-5-turbo",
      healthTracker: tracker,
    });

    expect(decision.provider).toBe("zai");
    expect(decision.model).toBe("glm-4.7");
    expect(decision.reason).toContain("recent-empty deprioritized");
    // profileFallbacks should have lost the chosen entry — there were no others
    // to remain.
    expect(decision.profileFallbacks ?? []).toEqual([]);
  });

  it("falls through to next candidate when first fallback is also flaking", () => {
    const tracker = new ModelHealthTracker({ window: 10, threshold: 3 });
    for (let i = 0; i < 3; i++) tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    for (let i = 0; i < 3; i++) tracker.recordOutcome("zai", "glm-5", "empty");

    const decision = routeModel({
      signals: { prompt: "reflect", sessionType: "contemplation" },
      config: makeConfig({
        contemplationModel: { provider: "zai", model: "glm-5-turbo" },
        contemplationFallbacks: ["zai/glm-5", "zai/glm-4.7"],
      }),
      defaultProvider: "zai",
      defaultModel: "glm-5-turbo",
      healthTracker: tracker,
    });

    expect(decision.model).toBe("glm-4.7");
    expect(decision.reason).toContain("recent-empty deprioritized");
    // Only the chosen entry (glm-4.7) is removed; the still-flaking glm-5
    // stays in the chain but the original primary takes the front position.
    expect(decision.fallbacks).toEqual(["zai/glm-5-turbo", "zai/glm-5"]);
  });

  it("recovers immediately once the primary serves a non-empty response", () => {
    const tracker = new ModelHealthTracker({ window: 10, threshold: 3 });
    for (let i = 0; i < 3; i++) tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    expect(tracker.isFlaking("zai", "glm-5-turbo")).toBe(true);

    tracker.recordOutcome("zai", "glm-5-turbo", "ok");

    const decision = routeModel({
      signals: { prompt: "reflect", sessionType: "contemplation" },
      config: makeConfig({
        contemplationModel: { provider: "zai", model: "glm-5-turbo" },
        contemplationFallbacks: ["zai/glm-4.7"],
      }),
      defaultProvider: "zai",
      defaultModel: "glm-5-turbo",
      healthTracker: tracker,
    });

    expect(decision.model).toBe("glm-5-turbo");
    expect(decision.reason).not.toContain("recent-empty");
    expect(decision.fallbacks).toEqual(["zai/glm-4.7"]);
  });

  it("respects user override even when the requested model is flaking (#281 constraint)", () => {
    const tracker = new ModelHealthTracker({ window: 10, threshold: 3 });
    for (let i = 0; i < 3; i++) tracker.recordOutcome("zai", "glm-5-turbo", "empty");

    const decision = routeModel({
      signals: { prompt: "go", sessionType: "main" },
      config: makeConfig(),
      requestedProvider: "zai",
      requestedModel: "glm-5-turbo",
      defaultProvider: "zai",
      defaultModel: "glm-5-turbo",
      healthTracker: tracker,
    });

    // Explicit user pick is never overridden — only suggestions de-prioritize.
    expect(decision.provider).toBe("zai");
    expect(decision.model).toBe("glm-5-turbo");
    expect(decision.routed).toBe(false);
    expect(decision.reason).toBe("user override");
  });
});
