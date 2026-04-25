import { describe, expect, it } from "vitest";
import type { Api, Model } from "../agent-core/ai.js";
import { normalizeModelCompat } from "./model-compat.js";

const baseModel = (): Model<Api> =>
  ({
    id: "glm-4.7",
    name: "GLM-4.7",
    api: "openai-completions",
    provider: "zai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
  }) as Model<Api>;

describe("normalizeModelCompat", () => {
  it("forces supportsDeveloperRole off for z.ai models", () => {
    const model = baseModel();
    delete (model as { compat?: unknown }).compat;
    const normalized = normalizeModelCompat(model);
    expect(normalized.compat?.supportsDeveloperRole).toBe(false);
  });

  it("moves stale z.ai catalog entries to the coding endpoint", () => {
    const model = {
      ...baseModel(),
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    };

    const normalized = normalizeModelCompat(model);

    expect(normalized.baseUrl).toBe("https://api.z.ai/api/coding/paas/v4/chat/completions");
  });

  it("preserves live z.ai catalog entries on the general endpoint", () => {
    const model = {
      ...baseModel(),
      id: "glm-5-turbo",
      name: "GLM-5-Turbo",
      baseUrl: "https://api.z.ai/api/paas/v4",
    };

    const normalized = normalizeModelCompat(model);

    expect(normalized.baseUrl).toBe("https://api.z.ai/api/paas/v4/chat/completions");
  });

  it("preserves explicit z.ai coding endpoints for GLM-5 models", () => {
    const model = {
      ...baseModel(),
      id: "glm-5-turbo",
      name: "GLM-5-Turbo",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
    };

    const normalized = normalizeModelCompat(model);

    expect(normalized.baseUrl).toBe("https://api.z.ai/api/coding/paas/v4/chat/completions");
  });

  it("moves stale GLM-5 catalog entries to the coding endpoint", () => {
    const model = {
      ...baseModel(),
      id: "glm-5-turbo",
      name: "GLM-5-Turbo",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    };

    const normalized = normalizeModelCompat(model);

    expect(normalized.baseUrl).toBe("https://api.z.ai/api/coding/paas/v4/chat/completions");
  });

  it("leaves non-zai models untouched", () => {
    const model = {
      ...baseModel(),
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
    };
    delete (model as { compat?: unknown }).compat;
    const normalized = normalizeModelCompat(model);
    expect(normalized.compat).toBeUndefined();
  });

  it("does not override explicit z.ai compat false", () => {
    const model = baseModel();
    model.compat = { supportsDeveloperRole: false };
    const normalized = normalizeModelCompat(model);
    expect(normalized.compat?.supportsDeveloperRole).toBe(false);
  });

  it("routes stale MiniMax M2 OpenAI-compatible configs to the Anthropic endpoint", () => {
    const model = {
      ...baseModel(),
      id: "MiniMax-M2.7-highspeed",
      name: "MiniMax-M2.7-highspeed",
      provider: "minimax",
      baseUrl: "https://api.minimaxi.chat/v1",
      api: "openai-completions",
    } as Model<Api>;

    const normalized = normalizeModelCompat(model);

    expect(normalized.provider).toBe("minimax");
    expect(normalized.id).toBe("MiniMax-M2.7-highspeed");
    expect(normalized.api).toBe("anthropic-messages");
    expect(normalized.baseUrl).toBe("https://api.minimax.io/anthropic");
  });

  it("disables developer role for non-M2 MiniMax OpenAI-compatible configs", () => {
    const model = {
      ...baseModel(),
      id: "legacy-minimax",
      name: "legacy-minimax",
      provider: "minimax",
      baseUrl: "https://api.minimax.chat/v1",
      api: "openai-completions",
    } as Model<Api>;

    const normalized = normalizeModelCompat(model);

    expect(normalized.api).toBe("openai-completions");
    expect(normalized.compat?.supportsDeveloperRole).toBe(false);
  });
});
