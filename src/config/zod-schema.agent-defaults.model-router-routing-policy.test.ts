import { describe, expect, it } from "vitest";
import { AgentDefaultsSchema } from "./zod-schema.agent-defaults.js";

describe("AgentDefaultsSchema model router routingPolicy", () => {
  it("accepts per-profile routing policy floors", () => {
    const parsed = AgentDefaultsSchema.parse({
      modelRouter: {
        profiles: {
          custom: {
            tiers: {
              local: {
                provider: "groq",
                model: "llama-3.1-8b-instant",
              },
              fast: {
                provider: "anthropic",
                model: "claude-haiku-4-5",
              },
              balanced: {
                provider: "anthropic",
                model: "claude-sonnet-4-6",
              },
              powerful: {
                provider: "openai-codex",
                model: "gpt-5.3-codex",
              },
            },
            routingPolicy: {
              likelyToolUseMinTier: "balanced",
              likelyMemoryUseMinTier: "balanced",
            },
          },
        },
      },
    });

    expect(parsed.modelRouter?.profiles?.custom?.routingPolicy?.likelyToolUseMinTier).toBe(
      "balanced",
    );
    expect(parsed.modelRouter?.profiles?.custom?.routingPolicy?.likelyMemoryUseMinTier).toBe(
      "balanced",
    );
  });
});
