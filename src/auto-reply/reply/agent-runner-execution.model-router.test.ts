import { describe, expect, it } from "vitest";
import type { ArgentConfig } from "../../config/config.js";
import { shouldLetEmbeddedRouterSelectDefault } from "./agent-runner-execution.js";

function cfg(): ArgentConfig {
  return {
    agents: {
      defaults: {
        model: {
          primary: "groq/llama-3.3-70b-versatile",
        },
        modelRouter: {
          enabled: true,
          activeProfile: "minimax-mix",
          profiles: {
            "minimax-mix": {
              tiers: {
                local: { provider: "ollama", model: "qwen3" },
                fast: { provider: "minimax", model: "MiniMax-M2.7" },
                balanced: { provider: "minimax", model: "MiniMax-M2.7-highspeed" },
                powerful: { provider: "minimax", model: "MiniMax-M2.7-highspeed" },
              },
            },
          },
        },
      },
    },
  };
}

describe("shouldLetEmbeddedRouterSelectDefault", () => {
  it("lets the embedded router handle the configured default model", () => {
    expect(
      shouldLetEmbeddedRouterSelectDefault({
        cfg: cfg(),
        provider: "groq",
        model: "llama-3.3-70b-versatile",
      }),
    ).toBe(true);
  });

  it("keeps explicit session model overrides pinned", () => {
    expect(
      shouldLetEmbeddedRouterSelectDefault({
        cfg: cfg(),
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        sessionEntry: {
          modelOverride: "llama-3.3-70b-versatile",
          providerOverride: "groq",
        },
      }),
    ).toBe(false);
  });

  it("keeps non-default fallback candidates pinned", () => {
    expect(
      shouldLetEmbeddedRouterSelectDefault({
        cfg: cfg(),
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      }),
    ).toBe(false);
  });
});
