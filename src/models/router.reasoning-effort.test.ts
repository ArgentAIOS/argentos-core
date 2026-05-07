/**
 * GH #186: per-routing-slot `reasoningEffort` override.
 *
 * Concrete user story: pick `gpt-5.5` in all four slots but configure
 * FAST=low, BALANCED=medium, POWERFUL=high — runner honors the per-slot
 * setting at request time. These tests cover the routing decision plumbing.
 * Runner-side propagation (over model.extraParams.reasoningEffort) is
 * verified by `pi-embedded-runner-extraparams.test.ts` and the wiring in
 * `pi-embedded-runner/run/attempt.ts`.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { Context, Model, SimpleStreamOptions } from "../agent-core/ai.js";
import type { StreamFn } from "../agent-core/core.js";
import type { ModelRouterConfig, TierModelMapping } from "./types.js";
import { AssistantMessageEventStream } from "../agent-core/ai.js";
import { applyExtraParamsToAgent } from "../agents/pi-embedded-runner.js";
import { routeModel } from "./router.js";

// Helpers below intentionally accept `string` for `reasoningEffort` so we can
// drive the "garbage value" graceful no-op test through the same fixture.
// `normalizeTierReasoningEffort()` in the router rejects invalid strings.
function tierSlot(reasoningEffort?: string): TierModelMapping {
  const base: TierModelMapping = { provider: "openai-codex", model: "gpt-5.5" };
  return reasoningEffort
    ? { ...base, reasoningEffort: reasoningEffort as TierModelMapping["reasoningEffort"] }
    : base;
}

function makeConfig(overrides?: {
  fast?: { reasoningEffort?: string };
  balanced?: { reasoningEffort?: string };
  powerful?: { reasoningEffort?: string };
}): ModelRouterConfig {
  return {
    enabled: true,
    activeProfile: "test-profile",
    profiles: {
      "test-profile": {
        tiers: {
          local: tierSlot(),
          fast: tierSlot(overrides?.fast?.reasoningEffort),
          balanced: tierSlot(overrides?.balanced?.reasoningEffort),
          powerful: tierSlot(overrides?.powerful?.reasoningEffort),
        },
      },
    },
  };
}

describe("router — per-tier reasoningEffort schema parsing", () => {
  it("loads a config with reasoningEffort present on every tier without throwing", () => {
    const config = makeConfig({
      fast: { reasoningEffort: "low" },
      balanced: { reasoningEffort: "medium" },
      powerful: { reasoningEffort: "high" },
    });
    // Trivial sanity probe: routing must still produce a decision.
    const decision = routeModel({
      signals: { prompt: "hi", sessionType: "main" },
      config,
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.5",
    });
    expect(decision.routed).toBe(true);
    // Existing argent.json files load without migration: a minimal config
    // (no reasoningEffort anywhere) routes fine — covered by the absent case
    // in the existing routing-policy test suite.
  });

  it("ignores garbage reasoningEffort values (graceful no-op)", () => {
    const config = makeConfig({ powerful: { reasoningEffort: "ULTRA-MEGA" } });
    const decision = routeModel({
      signals: {
        prompt: "Design a sharded eventually-consistent index",
        sessionType: "main",
        forceMaxTier: true,
      },
      config,
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.5",
    });
    expect(decision.tier).toBe("powerful");
    expect(decision.reasoningEffort).toBeUndefined();
  });
});

describe("router — per-tier reasoningEffort propagation", () => {
  it("returns the FAST slot's reasoningEffort on a fast-tier decision", () => {
    const config = makeConfig({ fast: { reasoningEffort: "low" } });
    const decision = routeModel({
      signals: {
        prompt: "Remember that I prefer concise status updates.",
        sessionType: "main",
      },
      config,
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.5",
    });
    expect(decision.tier).toBe("fast");
    expect(decision.reasoningEffort).toBe("low");
  });

  it("returns the POWERFUL slot's reasoningEffort under forceMaxTier (deep think)", () => {
    const config = makeConfig({
      fast: { reasoningEffort: "low" },
      powerful: { reasoningEffort: "high" },
    });
    const decision = routeModel({
      signals: { prompt: "easy q", sessionType: "main", forceMaxTier: true },
      config,
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.5",
    });
    expect(decision.tier).toBe("powerful");
    expect(decision.reasoningEffort).toBe("high");
  });

  it("returns the tier's reasoningEffort for tool-override decisions", () => {
    const config: ModelRouterConfig = {
      ...makeConfig({ balanced: { reasoningEffort: "medium" } }),
      toolOverrides: { web_search: "balanced" },
    };
    const decision = routeModel({
      signals: { prompt: "doesnt matter", sessionType: "main", toolName: "web_search" },
      config,
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.5",
    });
    expect(decision.tier).toBe("balanced");
    expect(decision.reasoningEffort).toBe("medium");
  });

  it("yields no reasoningEffort when the slot omits the field (model-level fallback path)", () => {
    const config = makeConfig({ powerful: { reasoningEffort: "high" } });
    // Routes to FAST tier (no override on that slot) — decision must not
    // leak the powerful slot's value.
    const decision = routeModel({
      signals: {
        prompt: "Remember that I prefer concise status updates.",
        sessionType: "main",
      },
      config,
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.5",
    });
    expect(decision.tier).toBe("fast");
    expect(decision.reasoningEffort).toBeUndefined();
  });

  it("defaults to absent when no reasoningEffort is configured anywhere", () => {
    const config = makeConfig();
    const decision = routeModel({
      signals: {
        prompt: "Remember that I prefer concise status updates.",
        sessionType: "main",
      },
      config,
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.5",
    });
    expect(decision.reasoningEffort).toBeUndefined();
  });
});

describe("runner integration — slot override > model-level extraParams.reasoningEffort", () => {
  const previousRuntimeMode = process.env.ARGENT_RUNTIME_MODE;

  afterEach(() => {
    if (previousRuntimeMode === undefined) {
      delete process.env.ARGENT_RUNTIME_MODE;
    } else {
      process.env.ARGENT_RUNTIME_MODE = previousRuntimeMode;
    }
  });

  function captureStreamCall(
    extraOverrides: Record<string, unknown> | undefined,
    cfg: Parameters<typeof applyExtraParamsToAgent>[1],
    provider: string,
    modelId: string,
  ): Record<string, unknown> | undefined {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      calls.push(options as Record<string, unknown> | undefined);
      return new AssistantMessageEventStream();
    };
    const agent: { streamFn?: StreamFn } = { streamFn: baseStreamFn };

    applyExtraParamsToAgent(agent, cfg, provider, modelId, extraOverrides);

    const model = {
      api: "openai-completions",
      provider,
      id: modelId,
    } as Model<"openai-completions">;
    const context: Context = { messages: [] };
    void agent.streamFn?.(model, context, undefined as unknown as SimpleStreamOptions);

    return calls[0];
  }

  it("per-tier override wins over model-level extraParams.reasoningEffort", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "openai-codex/gpt-5.5": { params: { reasoningEffort: "minimal" } },
          },
        },
      },
    } as never;
    const seen = captureStreamCall({ reasoningEffort: "high" }, cfg, "openai-codex", "gpt-5.5");
    expect(seen?.reasoningEffort).toBe("high");
  });

  it("falls back to model-level extraParams.reasoningEffort when no slot override is supplied", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "openai-codex/gpt-5.5": { params: { reasoningEffort: "medium" } },
          },
        },
      },
    } as never;
    const seen = captureStreamCall(undefined, cfg, "openai-codex", "gpt-5.5");
    expect(seen?.reasoningEffort).toBe("medium");
  });

  it("yields no reasoningEffort when neither slot nor model-level config provides one", () => {
    const seen = captureStreamCall(undefined, undefined, "openai-codex", "gpt-5.5");
    // No streamFn wrapper is created when there's nothing to apply — the
    // capture returns undefined options for the base streamFn call.
    expect(seen).toBeUndefined();
  });

  it("propagates the override even on non-reasoning models (graceful no-op at provider layer)", () => {
    // The dashboard hides the selector for non-reasoning models, but the
    // backend must not throw or strip the field if a hand-edited argent.json
    // sets it on, e.g., a Groq Llama slot. The provider's stream call simply
    // ignores reasoningEffort — that's the existing graceful behavior.
    const seen = captureStreamCall(
      { reasoningEffort: "low" },
      undefined,
      "groq",
      "llama-3.1-8b-instant",
    );
    expect(seen?.reasoningEffort).toBe("low");
  });
});
