import { afterEach, describe, expect, it } from "vitest";
import type { Context, Model, SimpleStreamOptions } from "../agent-core/ai.js";
import type { StreamFn } from "../agent-core/core.js";
import { AssistantMessageEventStream } from "../agent-core/ai.js";
import { applyExtraParamsToAgent, resolveExtraParams } from "./pi-embedded-runner.js";

describe("resolveExtraParams", () => {
  it("returns undefined with no model config", () => {
    const result = resolveExtraParams({
      cfg: undefined,
      provider: "zai",
      modelId: "glm-4.7",
    });

    expect(result).toBeUndefined();
  });

  it("returns params for exact provider/model key", () => {
    const result = resolveExtraParams({
      cfg: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-4": {
                params: {
                  temperature: 0.7,
                  maxTokens: 2048,
                },
              },
            },
          },
        },
      },
      provider: "openai",
      modelId: "gpt-4",
    });

    expect(result).toEqual({
      temperature: 0.7,
      maxTokens: 2048,
    });
  });

  it("ignores unrelated model entries", () => {
    const result = resolveExtraParams({
      cfg: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-4": {
                params: {
                  temperature: 0.7,
                },
              },
            },
          },
        },
      },
      provider: "openai",
      modelId: "gpt-4.1-mini",
    });

    expect(result).toBeUndefined();
  });
});

describe("applyExtraParamsToAgent", () => {
  const previousRuntimeMode = process.env.ARGENT_RUNTIME_MODE;

  afterEach(() => {
    if (previousRuntimeMode === undefined) {
      delete process.env.ARGENT_RUNTIME_MODE;
    } else {
      process.env.ARGENT_RUNTIME_MODE = previousRuntimeMode;
    }
  });

  it("adds OpenRouter attribution headers to stream options", () => {
    const calls: Array<SimpleStreamOptions | undefined> = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      calls.push(options);
      return new AssistantMessageEventStream();
    };
    const agent = { streamFn: baseStreamFn };

    applyExtraParamsToAgent(agent, undefined, "openrouter", "openrouter/auto");

    const model = {
      api: "openai-completions",
      provider: "openrouter",
      id: "openrouter/auto",
    } as Model<"openai-completions">;
    const context: Context = { messages: [] };

    void agent.streamFn?.(model, context, { headers: { "X-Custom": "1" } });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toEqual({
      "HTTP-Referer": "https://argentos.ai",
      "X-Title": "ArgentOS",
      "X-Custom": "1",
    });
  });

  it("throws in argent_strict when wrapper would default to Pi stream fallback", () => {
    process.env.ARGENT_RUNTIME_MODE = "argent_strict";
    const agent: { streamFn?: StreamFn } = {};

    expect(() =>
      applyExtraParamsToAgent(agent, undefined, "openrouter", "openrouter/auto"),
    ).toThrow("Pi fallback blocked in argent_strict mode");
  });

  it("keeps behavior in pi_only when streamFn is missing", () => {
    process.env.ARGENT_RUNTIME_MODE = "pi_only";
    const agent: { streamFn?: StreamFn } = {};

    expect(() =>
      applyExtraParamsToAgent(agent, undefined, "openrouter", "openrouter/auto"),
    ).not.toThrow();
    expect(typeof agent.streamFn).toBe("function");
  });

  it("maps model params thinking=adaptive to anthropic adaptive reasoning defaults", () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      calls.push(options as Record<string, unknown> | undefined);
      return new AssistantMessageEventStream();
    };
    const agent = { streamFn: baseStreamFn };
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-6": {
              params: {
                thinking: "adaptive",
              },
            },
          },
        },
      },
    };

    applyExtraParamsToAgent(agent, cfg as never, "anthropic", "claude-opus-4-6");

    const model = {
      api: "anthropic-messages",
      provider: "anthropic",
      id: "claude-opus-4-6",
    } as Model<"anthropic-messages">;
    const context: Context = { messages: [] };

    void agent.streamFn?.(model, context);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.reasoning).toBe("medium");
    expect(calls[0]?.thinkingEnabled).toBe(true);
    expect(calls[0]?.effort).toBe("medium");
  });

  it("maps model params thinking=off to disable thinking", () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      calls.push(options as Record<string, unknown> | undefined);
      return new AssistantMessageEventStream();
    };
    const agent = { streamFn: baseStreamFn };
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-6": {
              params: {
                thinking: "off",
                reasoning: "high",
              },
            },
          },
        },
      },
    };

    applyExtraParamsToAgent(agent, cfg as never, "anthropic", "claude-opus-4-6");

    const model = {
      api: "anthropic-messages",
      provider: "anthropic",
      id: "claude-opus-4-6",
    } as Model<"anthropic-messages">;
    const context: Context = { messages: [] };

    void agent.streamFn?.(model, context);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.reasoning).toBeUndefined();
    expect(calls[0]?.thinkingEnabled).toBe(false);
  });

  it("passes object-style thinking config through for google providers", () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      calls.push(options as Record<string, unknown> | undefined);
      return new AssistantMessageEventStream();
    };
    const agent = { streamFn: baseStreamFn };
    const cfg = {
      agents: {
        defaults: {
          models: {
            "google/gemini-3-pro-preview": {
              params: {
                thinking: {
                  enabled: true,
                  budgetTokens: 2048,
                },
              },
            },
          },
        },
      },
    };

    applyExtraParamsToAgent(agent, cfg as never, "google", "gemini-3-pro-preview");

    const model = {
      api: "google-generative-ai",
      provider: "google",
      id: "gemini-3-pro-preview",
    } as Model<"google-generative-ai">;
    const context: Context = { messages: [] };

    void agent.streamFn?.(model, context);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.thinking).toEqual({
      enabled: true,
      budgetTokens: 2048,
    });
  });
});
