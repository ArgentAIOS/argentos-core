import { describe, expect, it, vi } from "vitest";

vi.mock("../pi-model-discovery.js", () => ({
  discoverAuthStorage: vi.fn(() => ({ mocked: true })),
  discoverModels: vi.fn(() => ({ find: vi.fn(() => null) })),
}));

import type { ArgentConfig } from "../../config/config.js";
import { discoverModels } from "../pi-model-discovery.js";
import { buildInlineProviderModels, resolveModel } from "./model.js";

const makeModel = (id: string) => ({
  id,
  name: id,
  reasoning: false,
  input: ["text"] as const,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1,
  maxTokens: 1,
});

describe("buildInlineProviderModels", () => {
  it("attaches provider ids to inline models", () => {
    const providers = {
      " alpha ": { baseUrl: "http://alpha.local", models: [makeModel("alpha-model")] },
      beta: { baseUrl: "http://beta.local", models: [makeModel("beta-model")] },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toEqual([
      {
        ...makeModel("alpha-model"),
        provider: "alpha",
        baseUrl: "http://alpha.local",
        api: undefined,
      },
      {
        ...makeModel("beta-model"),
        provider: "beta",
        baseUrl: "http://beta.local",
        api: undefined,
      },
    ]);
  });

  it("inherits baseUrl from provider when model does not specify it", () => {
    const providers = {
      custom: {
        baseUrl: "http://localhost:8000",
        models: [makeModel("custom-model")],
      },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toHaveLength(1);
    expect(result[0].baseUrl).toBe("http://localhost:8000");
  });

  it("inherits api from provider when model does not specify it", () => {
    const providers = {
      custom: {
        baseUrl: "http://localhost:8000",
        api: "anthropic-messages",
        models: [makeModel("custom-model")],
      },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toHaveLength(1);
    expect(result[0].api).toBe("anthropic-messages");
  });

  it("model-level api takes precedence over provider-level api", () => {
    const providers = {
      custom: {
        baseUrl: "http://localhost:8000",
        api: "openai-responses",
        models: [{ ...makeModel("custom-model"), api: "anthropic-messages" as const }],
      },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toHaveLength(1);
    expect(result[0].api).toBe("anthropic-messages");
  });

  it("inherits both baseUrl and api from provider config", () => {
    const providers = {
      custom: {
        baseUrl: "http://localhost:10000",
        api: "anthropic-messages",
        models: [makeModel("claude-opus-4.5")],
      },
    };

    const result = buildInlineProviderModels(providers);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "custom",
      baseUrl: "http://localhost:10000",
      api: "anthropic-messages",
      name: "claude-opus-4.5",
    });
  });
});

describe("resolveModel", () => {
  it("does not block configured Bedrock models from Pi's catalog", () => {
    const bedrockModel = {
      ...makeModel("anthropic.claude-haiku-4-5-20251001-v1:0"),
      provider: "amazon-bedrock",
      api: "bedrock-converse-stream" as const,
      reasoning: true,
    };
    vi.mocked(discoverModels).mockReturnValueOnce({
      find: vi.fn((provider: string, id: string) =>
        provider === "amazon-bedrock" && id === bedrockModel.id ? bedrockModel : null,
      ),
    } as never);

    const result = resolveModel("amazon-bedrock", bedrockModel.id, "/tmp/agent", {});

    expect(result.error).toBeUndefined();
    expect(result.model?.provider).toBe("amazon-bedrock");
    expect(result.model?.id).toBe(bedrockModel.id);
  });

  it("uses the MiniMax anthropic-compatible endpoint from the built-in catalog", () => {
    const result = resolveModel("minimax", "MiniMax-M2.7-highspeed", "/tmp/agent", {});

    expect(result.error).toBeUndefined();
    expect(result.model?.provider).toBe("minimax");
    expect(result.model?.id).toBe("MiniMax-M2.7-highspeed");
    expect(result.model?.api).toBe("anthropic-messages");
    expect(result.model?.baseUrl).toBe("https://api.minimax.io/anthropic");
  });

  it("uses the built-in GLM-5-Turbo fallback when Pi's catalog does not have it yet", () => {
    const result = resolveModel("zai", "glm-5-turbo", "/tmp/agent", {});

    expect(result.error).toBeUndefined();
    expect(result.model?.provider).toBe("zai");
    expect(result.model?.id).toBe("glm-5-turbo");
    expect(result.model?.api).toBe("openai-completions");
    expect(result.model?.baseUrl).toBe("https://api.z.ai/api/paas/v4/chat/completions");
    expect(result.model?.reasoning).toBe(true);
  });

  it("repairs stale inline MiniMax OpenAI-compatible configs", () => {
    const cfg = {
      models: {
        providers: {
          minimax: {
            baseUrl: "https://api.minimaxi.chat/v1",
            api: "openai-completions",
            models: [
              {
                ...makeModel("MiniMax-M2.7-highspeed"),
                reasoning: true,
              },
            ],
          },
        },
      },
    } as ArgentConfig;

    const result = resolveModel("minimax", "MiniMax-M2.7-highspeed", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect(result.model?.provider).toBe("minimax");
    expect(result.model?.api).toBe("anthropic-messages");
    expect(result.model?.baseUrl).toBe("https://api.minimax.io/anthropic");
  });

  it("includes provider baseUrl in fallback model", () => {
    const cfg = {
      models: {
        providers: {
          custom: {
            baseUrl: "http://localhost:9000",
            models: [],
          },
        },
      },
    } as ArgentConfig;

    const result = resolveModel("custom", "missing-model", "/tmp/agent", cfg);

    expect(result.model?.baseUrl).toBe("http://localhost:9000");
    expect(result.model?.provider).toBe("custom");
    expect(result.model?.id).toBe("missing-model");
  });

  it("creates a dynamic lmstudio model from kernel runtime config", () => {
    const cfg = {
      agents: {
        defaults: {
          kernel: {
            localModel: "lmstudio/qwen/qwen3.5-35b-a3b",
          },
          memorySearch: {
            provider: "lmstudio",
            remote: {
              baseUrl: "http://127.0.0.1:1234/v1",
            },
          },
        },
      },
    } as ArgentConfig;

    const result = resolveModel("lmstudio", "qwen/qwen3.5-35b-a3b", "/tmp/agent", cfg);

    expect(result.error).toBeUndefined();
    expect(result.model?.provider).toBe("lmstudio");
    expect(result.model?.id).toBe("qwen/qwen3.5-35b-a3b");
    expect(result.model?.baseUrl).toBe("http://127.0.0.1:1234/v1");
    expect(result.model?.api).toBe("openai-completions");
  });
});
