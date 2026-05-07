import fsPromises from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "../../test/helpers/temp-home.js";
import {
  _resetArgentModelsOverrideCacheForTests,
  loadArgentModelsOverride,
} from "./argent-models-override.js";

describe("argent-models-override", () => {
  afterEach(() => {
    _resetArgentModelsOverrideCacheForTests();
  });

  it("registers gpt-5.5-chat-latest under the openai provider", () => {
    const override = loadArgentModelsOverride();

    expect(override).toHaveProperty("openai");
    const openai = override.openai;
    expect(openai).toBeDefined();
    expect(Array.isArray(openai?.models)).toBe(true);
    const ids = openai?.models.map((m) => m.id) ?? [];
    expect(ids).toContain("gpt-5.5-chat-latest");
  });

  it("returns a model entry shaped to mirror gpt-5.3-chat-latest from pi-ai's catalog", () => {
    const override = loadArgentModelsOverride();
    const model = override.openai?.models.find((m) => m.id === "gpt-5.5-chat-latest");

    expect(model).toBeDefined();
    if (!model) {
      return;
    }
    expect(model.name).toBe("GPT-5.5 Chat (latest)");
    expect(model.api).toBe("openai-responses");
    expect(model.reasoning).toBe(false);
    expect(model.input).toEqual(["text", "image"]);
    expect(model.contextWindow).toBe(128_000);
    expect(model.maxTokens).toBe(16_384);
    // Pricing mirrors gpt-5.3-chat-latest as a placeholder until OpenAI publishes
    // gpt-5.5-instant per-token rates (see PR body for the verification follow-up).
    expect(model.cost).toEqual({
      input: 1.75,
      output: 14,
      cacheRead: 0.175,
      cacheWrite: 0,
    });
  });

  it("memoizes the parsed override across calls", () => {
    const first = loadArgentModelsOverride();
    const second = loadArgentModelsOverride();

    expect(second).toBe(first);
  });

  it("returns equivalent override data after the test cache is reset", () => {
    // require() caches the JSON at the module level, so the parsed `providers`
    // object reference may be reused even after the in-memory cache is cleared.
    // The contract we care about is that the data round-trips identically.
    const first = loadArgentModelsOverride();
    _resetArgentModelsOverrideCacheForTests();
    const second = loadArgentModelsOverride();

    expect(second).toEqual(first);
  });

  it("flows into the per-agent models.json when other providers exist", async () => {
    // The override is intentionally gated behind the existing emptiness check —
    // it never forces a models.json on a fresh install with no provider auth.
    // So this integration test seeds a minimal explicit provider to exercise
    // the merge path.
    await withTempHome(
      async () => {
        vi.resetModules();
        _resetArgentModelsOverrideCacheForTests();
        const { ensureArgentModelsJson } = await import("./models-config.js");
        const { resolveArgentAgentDir } = await import("./agent-paths.js");

        const result = await ensureArgentModelsJson({
          models: {
            providers: {
              "custom-proxy": {
                baseUrl: "http://localhost:4000/v1",
                apiKey: "TEST_KEY",
                api: "openai-completions",
                models: [
                  {
                    id: "llama-3.1-8b",
                    name: "Llama 3.1 8B (Proxy)",
                    api: "openai-completions",
                    reasoning: false,
                    input: ["text"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 128_000,
                    maxTokens: 32_000,
                  },
                ],
              },
            },
          },
        });
        expect(result.wrote).toBe(true);

        const modelsPath = path.join(resolveArgentAgentDir(), "models.json");
        const raw = await fsPromises.readFile(modelsPath, "utf8");
        const parsed = JSON.parse(raw) as {
          providers: Record<string, { models?: Array<{ id: string; api?: string }> }>;
        };

        const openai = parsed.providers.openai;
        expect(openai).toBeDefined();
        const ids = openai?.models?.map((m) => m.id) ?? [];
        expect(ids).toContain("gpt-5.5-chat-latest");
        const entry = openai?.models?.find((m) => m.id === "gpt-5.5-chat-latest");
        expect(entry?.api).toBe("openai-responses");
      },
      { prefix: "argent-models-override-" },
    );
  });

  it("does NOT force a models.json when no other providers are configured", async () => {
    // Regression guard for `models-config.skips-writing-models-json-no-env-token`
    // — the override must never resurrect a models.json on an install that
    // would otherwise opt out.
    await withTempHome(
      async (home) => {
        vi.resetModules();
        _resetArgentModelsOverrideCacheForTests();
        const { ensureArgentModelsJson } = await import("./models-config.js");

        const agentDir = path.join(home, "agent-empty");
        const previous = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        try {
          const result = await ensureArgentModelsJson({ models: { providers: {} } }, agentDir);
          expect(result.wrote).toBe(false);
          await expect(fsPromises.stat(path.join(agentDir, "models.json"))).rejects.toThrow();
        } finally {
          if (previous === undefined) {
            delete process.env.OPENAI_API_KEY;
          } else {
            process.env.OPENAI_API_KEY = previous;
          }
        }
      },
      { prefix: "argent-models-override-empty-" },
    );
  });
});
