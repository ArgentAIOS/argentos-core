import { describe, expect, it } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import { DEFAULT_TIER_MODELS } from "../models/builtin-profiles.js";
import {
  buildMemuLlmRunAttempts,
  detectInvalidMemuLlmConfig,
  validateMemuLlmSelection,
} from "./llm-config.js";

describe("buildMemuLlmRunAttempts", () => {
  it("builds primary + ollama fallback and pins provided model selection", () => {
    const cfg = {
      memory: {
        memu: {
          llm: {
            provider: "openai-codex",
            model: "gpt-5.3-codex-spark",
            thinkLevel: "medium",
            timeoutMs: 45_000,
          },
        },
      },
      agents: {
        defaults: {
          modelRouter: {
            activeProfile: "custom",
            profiles: {
              custom: {
                tiers: {
                  local: { provider: "ollama", model: "qwen3:14b" },
                },
              },
            },
          },
        },
      },
    } as unknown as ArgentConfig;

    const attempts = buildMemuLlmRunAttempts(cfg, { timeoutMs: 15_000 });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      label: "primary",
      provider: "openai-codex",
      model: "gpt-5.3-codex-spark",
      thinkLevel: "medium",
      timeoutMs: 45_000,
      respectProvidedModel: true,
    });
    expect(attempts[1]).toMatchObject({
      label: "ollama-fallback",
      provider: "ollama",
      model: "qwen3:14b",
      thinkLevel: "medium",
      timeoutMs: 45_000,
      respectProvidedModel: true,
    });
  });

  it("does not duplicate fallback when primary already targets same ollama model", () => {
    const cfg = {
      memory: {
        memu: {
          llm: {
            provider: "ollama",
            model: DEFAULT_TIER_MODELS.local.model,
            thinkLevel: "low",
          },
        },
      },
    } as unknown as ArgentConfig;

    const attempts = buildMemuLlmRunAttempts(cfg, { timeoutMs: 15_000 });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      label: "primary",
      provider: "ollama",
      model: DEFAULT_TIER_MODELS.local.model,
      respectProvidedModel: true,
    });
  });

  it("defaults memu primary to local ollama and avoids duplicate fallback when memu llm is unset", () => {
    const cfg = {} as ArgentConfig;
    const attempts = buildMemuLlmRunAttempts(cfg, { timeoutMs: 12_345 });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      label: "primary",
      provider: "ollama",
      model: DEFAULT_TIER_MODELS.local.model,
      thinkLevel: "low",
      timeoutMs: 12_345,
      respectProvidedModel: true,
    });
  });

  it("rejects embedding-only model at save-time validation", () => {
    const issue = validateMemuLlmSelection({
      provider: "openai",
      model: "text-embedding-3-small",
    });
    expect(issue).toMatchObject({
      code: "embedding-only-model",
      provider: "openai",
      model: "text-embedding-3-small",
    });
    expect(issue?.replacementGuidance).toContain("openai-codex/gpt-5.3-codex");
  });

  it("detects invalid saved config on load and falls back to ollama local model", () => {
    const cfg = {
      memory: {
        memu: {
          llm: {
            provider: "ollama",
            model: "nomic-embed-text",
            thinkLevel: "off",
            timeoutMs: 9_000,
          },
        },
      },
    } as unknown as ArgentConfig;

    const issue = detectInvalidMemuLlmConfig(cfg);
    expect(issue).toMatchObject({
      code: "embedding-only-model",
      provider: "ollama",
      model: "nomic-embed-text",
    });

    const attempts = buildMemuLlmRunAttempts(cfg, { timeoutMs: 15_000 });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      label: "primary",
      provider: "ollama",
      model: DEFAULT_TIER_MODELS.local.model,
      thinkLevel: "off",
      timeoutMs: 9_000,
      respectProvidedModel: true,
    });
  });
});
