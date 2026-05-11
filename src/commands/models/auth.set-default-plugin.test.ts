/**
 * Tests for GH #190: `argent models auth login --set-default` must be honored
 * for plugin-backed providers, not just `openai-codex`.
 *
 * Covers the three semantics of the new design (Option A — `recommendedModel`
 * declared on the plugin manifest):
 *   1. Plugin declares `recommendedModel` with a tier → routing profile updated.
 *   2. Plugin declares `recommendedModel` without a tier → `agents.defaults.model.primary` set.
 *   3. Plugin declares no `recommendedModel` AND auth.run returned no `defaultModel`
 *      → `resolveRecommendedModel` returns `null` so the dispatch can emit a clear warning.
 *   4. Legacy backward-compat: plugin doesn't declare on manifest but auth.run returns
 *      `defaultModel` → falls back to that (no tier).
 */
import { describe, expect, it } from "vitest";
import type { ArgentConfig } from "../../config/config.js";
import type { ProviderAuthResult, ProviderPlugin } from "../../plugins/types.js";
import { applyDefaultModel, applyTieredRecommendedModel, resolveRecommendedModel } from "./auth.js";

function makePlugin(overrides: Partial<ProviderPlugin> = {}): ProviderPlugin {
  return {
    id: "qwen-portal",
    label: "Qwen",
    auth: [],
    ...overrides,
  };
}

function makeResult(overrides: Partial<ProviderAuthResult> = {}): ProviderAuthResult {
  return {
    profiles: [],
    ...overrides,
  };
}

describe("resolveRecommendedModel — GH #190 plugin --set-default", () => {
  it("returns the plugin manifest recommendation when declared", () => {
    const plugin = makePlugin({
      recommendedModel: { id: "qwen-portal/coder-model", tier: "balanced" },
    });
    expect(resolveRecommendedModel(plugin, makeResult())).toEqual({
      id: "qwen-portal/coder-model",
      tier: "balanced",
    });
  });

  it("prefers manifest recommendation over legacy auth.run defaultModel", () => {
    const plugin = makePlugin({
      recommendedModel: { id: "qwen-portal/coder-model", tier: "balanced" },
    });
    const result = makeResult({ defaultModel: "qwen-portal/some-other-model" });
    // Manifest wins.
    expect(resolveRecommendedModel(plugin, result)).toEqual({
      id: "qwen-portal/coder-model",
      tier: "balanced",
    });
  });

  it("falls back to legacy auth.run defaultModel when manifest declares nothing", () => {
    const plugin = makePlugin();
    const result = makeResult({ defaultModel: "qwen-portal/coder-model" });
    expect(resolveRecommendedModel(plugin, result)).toEqual({
      id: "qwen-portal/coder-model",
    });
  });

  it("returns null when neither manifest nor auth.run declare a recommendation", () => {
    expect(resolveRecommendedModel(makePlugin(), makeResult())).toBeNull();
  });
});

describe("applyDefaultModel — bare primary write (tier-less)", () => {
  it("writes the model into agents.defaults.model.primary", () => {
    const cfg = {} as ArgentConfig;
    const next = applyDefaultModel(cfg, "qwen-portal/coder-model");
    expect(next.agents?.defaults?.model).toEqual({ primary: "qwen-portal/coder-model" });
    expect(next.agents?.defaults?.models?.["qwen-portal/coder-model"]).toEqual({});
  });

  it("preserves an existing fallbacks list on the primary model entry", () => {
    const cfg: ArgentConfig = {
      agents: {
        defaults: {
          model: { primary: "old", fallbacks: ["backup1", "backup2"] },
        },
      },
    } as ArgentConfig;
    const next = applyDefaultModel(cfg, "qwen-portal/coder-model");
    expect(next.agents?.defaults?.model).toEqual({
      primary: "qwen-portal/coder-model",
      fallbacks: ["backup1", "backup2"],
    });
  });
});

describe("applyTieredRecommendedModel — routing-profile write", () => {
  it("writes to top-level modelRouter.tiers.<tier> when no activeProfile is set", () => {
    const cfg = {} as ArgentConfig;
    const next = applyTieredRecommendedModel(
      cfg,
      "qwen-portal",
      "qwen-portal/coder-model",
      "balanced",
    );
    expect(next.agents?.defaults?.modelRouter?.tiers?.balanced).toEqual({
      provider: "qwen-portal",
      model: "coder-model",
    });
    // Also keeps primary in sync for non-router consumers.
    expect(next.agents?.defaults?.model?.primary).toBe("qwen-portal/coder-model");
  });

  it("writes to the active profile's tiers when activeProfile is set", () => {
    const cfg: ArgentConfig = {
      agents: {
        defaults: {
          modelRouter: {
            activeProfile: "default",
            profiles: {
              default: { tiers: { fast: { provider: "openai", model: "gpt-mini" } } },
            },
          },
        },
      },
    } as ArgentConfig;
    const next = applyTieredRecommendedModel(
      cfg,
      "qwen-portal",
      "qwen-portal/coder-model",
      "balanced",
    );
    expect(next.agents?.defaults?.modelRouter?.profiles?.default?.tiers).toEqual({
      fast: { provider: "openai", model: "gpt-mini" },
      balanced: { provider: "qwen-portal", model: "coder-model" },
    });
  });

  it("handles unqualified model ids (no slash) by using the plugin id as provider", () => {
    const cfg = {} as ArgentConfig;
    const next = applyTieredRecommendedModel(cfg, "minimax-portal", "MiniMax-M2.1", "balanced");
    expect(next.agents?.defaults?.modelRouter?.tiers?.balanced).toEqual({
      provider: "minimax-portal",
      model: "MiniMax-M2.1",
    });
  });

  it("preserves other tiers when writing one tier", () => {
    const cfg: ArgentConfig = {
      agents: {
        defaults: {
          modelRouter: {
            tiers: {
              fast: { provider: "anthropic", model: "claude-haiku-4.5" },
              powerful: { provider: "anthropic", model: "claude-opus-4.5" },
            },
          },
        },
      },
    } as ArgentConfig;
    const next = applyTieredRecommendedModel(
      cfg,
      "qwen-portal",
      "qwen-portal/coder-model",
      "balanced",
    );
    expect(next.agents?.defaults?.modelRouter?.tiers).toEqual({
      fast: { provider: "anthropic", model: "claude-haiku-4.5" },
      powerful: { provider: "anthropic", model: "claude-opus-4.5" },
      balanced: { provider: "qwen-portal", model: "coder-model" },
    });
  });
});
