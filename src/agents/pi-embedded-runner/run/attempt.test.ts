import { describe, expect, it } from "vitest";
import type { ImageContent } from "../../../agent-core/ai.js";
import type { AgentMessage } from "../../../agent-core/core.js";
import {
  applyPiStreamFallbackPolicy,
  createPiStreamSimpleWithRuntimeApiKey,
  injectHistoryImagesIntoMessages,
  resolveRuntimeProviderApiKey,
  resolveArgentProviderBaseURL,
  resolveArgentProviderFallbackReason,
  resolveOpenAICodexTransport,
  resolveOpenAICodexVisionModelId,
  resolveEmbeddedAttemptRuntimePolicy,
} from "./attempt.js";

describe("injectHistoryImagesIntoMessages", () => {
  const image: ImageContent = { type: "image", data: "abc", mimeType: "image/png" };

  it("injects history images and converts string content", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: "See /tmp/photo.png",
      } as AgentMessage,
    ];

    const didMutate = injectHistoryImagesIntoMessages(messages, new Map([[0, [image]]]));

    expect(didMutate).toBe(true);
    expect(Array.isArray(messages[0]?.content)).toBe(true);
    const content = messages[0]?.content as Array<{ type: string; text?: string; data?: string }>;
    expect(content).toHaveLength(2);
    expect(content[0]?.type).toBe("text");
    expect(content[1]).toMatchObject({ type: "image", data: "abc" });
  });

  it("avoids duplicating existing image content", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "See /tmp/photo.png" }, { ...image }],
      } as AgentMessage,
    ];

    const didMutate = injectHistoryImagesIntoMessages(messages, new Map([[0, [image]]]));

    expect(didMutate).toBe(false);
    const first = messages[0];
    if (!first || !Array.isArray(first.content)) {
      throw new Error("expected array content");
    }
    expect(first.content).toHaveLength(2);
  });

  it("ignores non-user messages and out-of-range indices", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: "noop",
      } as AgentMessage,
    ];

    const didMutate = injectHistoryImagesIntoMessages(messages, new Map([[1, [image]]]));

    expect(didMutate).toBe(false);
    expect(messages[0]?.content).toBe("noop");
  });
});

describe("embedded runtime policy wiring", () => {
  it("does not pass MiniMax Anthropic-compatible base URL into the Argent-native provider", () => {
    expect(
      resolveArgentProviderBaseURL("minimax", "https://api.minimax.io/anthropic"),
    ).toBeUndefined();
    expect(
      resolveArgentProviderBaseURL("minimax", "https://api.minimax.io/anthropic/"),
    ).toBeUndefined();
    expect(
      resolveArgentProviderBaseURL("minimax", "https://api.minimax.chat/v1/text/chatcompletion_v2"),
    ).toBe("https://api.minimax.chat/v1/text/chatcompletion_v2");
    expect(resolveArgentProviderBaseURL("anthropic", "https://example.test")).toBe(
      "https://example.test",
    );
  });

  it("keeps MiniMax on the Pi adapter until the native adapter reaches parity", () => {
    expect(resolveArgentProviderFallbackReason("minimax")).toContain(
      "Anthropic-compatible adapter",
    );
    expect(resolveArgentProviderFallbackReason("MiniMax")).toContain(
      "Anthropic-compatible adapter",
    );
    expect(resolveArgentProviderFallbackReason("anthropic")).toBeUndefined();
  });

  it("resolves runtime provider keys through the public auth storage API", async () => {
    const authStorage = {
      runtimeOverrides: new Map([["minimax", "private-map-key"]]),
      getApiKey: async (provider: string, options?: { includeFallback?: boolean }) => {
        expect(provider).toBe("minimax");
        expect(options).toEqual({ includeFallback: false });
        return "profile-key";
      },
    };

    await expect(resolveRuntimeProviderApiKey(authStorage, "minimax")).resolves.toBe("profile-key");
  });

  it("keeps the runtime override fallback for older auth storage implementations", async () => {
    const authStorage = {
      runtimeOverrides: new Map([["minimax", "runtime-key"]]),
    };

    await expect(resolveRuntimeProviderApiKey(authStorage, "minimax")).resolves.toBe("runtime-key");
  });

  it("injects auth profile keys into Pi stream fallbacks", () => {
    let capturedOptions: { apiKey?: string; temperature?: number } | undefined;
    const streamFn = ((_model, _context, options) => {
      capturedOptions = options;
      return {} as ReturnType<typeof createPiStreamSimpleWithRuntimeApiKey>;
    }) as Parameters<typeof createPiStreamSimpleWithRuntimeApiKey>[0];

    const wrapped = createPiStreamSimpleWithRuntimeApiKey(streamFn, "profile-key");
    wrapped(
      { id: "MiniMax-M2.7", provider: "minimax", api: "openai-completions" } as never,
      { messages: [] },
      { temperature: 0.2 },
    );

    expect(capturedOptions).toEqual({ temperature: 0.2, apiKey: "profile-key" });
  });

  it("resolves legacy ARGENT_RUNTIME=true to fallback mode", () => {
    const policy = resolveEmbeddedAttemptRuntimePolicy({ ARGENT_RUNTIME: "true" });
    expect(policy.mode).toBe("argent_with_fallback");
    expect(policy.argentRuntimeEnabled).toBe(true);
    expect(policy.piFallbackAllowed).toBe(true);
  });

  it("resolves explicit strict mode and disables fallback", () => {
    const policy = resolveEmbeddedAttemptRuntimePolicy({
      ARGENT_RUNTIME_MODE: "argent_strict",
      ARGENT_RUNTIME: "true",
    });
    expect(policy.mode).toBe("argent_strict");
    expect(policy.argentRuntimeEnabled).toBe(true);
    expect(policy.piFallbackAllowed).toBe(false);
  });

  it("allows applying Pi fallback only in fallback mode", () => {
    let applied = false;
    applyPiStreamFallbackPolicy(
      "argent_with_fallback",
      "unit-test fallback path",
      () => {
        applied = true;
      },
      new Error("simulated"),
    );
    expect(applied).toBe(true);
  });

  it("throws in strict mode instead of silently falling back", () => {
    expect(() =>
      applyPiStreamFallbackPolicy("argent_strict", "unit-test strict path", () => {}),
    ).toThrow("Pi fallback blocked in argent_strict mode");
  });
});

describe("resolveOpenAICodexTransport", () => {
  it("keeps websocket transport for text-only turns", () => {
    expect(
      resolveOpenAICodexTransport({
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      }),
    ).toBe("websocket");
  });

  it("switches to sse transport when the context includes prompt images", () => {
    expect(
      resolveOpenAICodexTransport({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe this" },
              { type: "image", data: "abc", mimeType: "image/png" },
            ],
          },
        ],
      }),
    ).toBe("sse");
  });

  it("switches to sse transport when tool-result images are present", () => {
    expect(
      resolveOpenAICodexTransport({
        messages: [
          {
            role: "toolResult",
            content: [
              { type: "text", text: "screenshot" },
              { type: "image", data: "abc", mimeType: "image/png" },
            ],
          },
        ],
      }),
    ).toBe("sse");
  });
});

describe("resolveOpenAICodexVisionModelId", () => {
  const makeRegistry = (
    models: Array<{ id: string; provider: string; input: string[] }>,
  ): {
    find: (provider: string, modelId: string) => (typeof models)[number] | null;
    getAll: () => typeof models;
  } => ({
    find: (provider, modelId) =>
      models.find((model) => model.provider === provider && model.id === modelId) ?? null,
    getAll: () => models,
  });

  it("returns undefined when the turn has no inline images", () => {
    const registry = makeRegistry([
      { id: "gpt-5.4", provider: "openai-codex", input: ["text", "image"] },
    ]);

    expect(
      resolveOpenAICodexVisionModelId({
        model: { id: "gpt-5.3-codex", provider: "openai-codex", input: ["text"] },
        context: { messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] },
        modelRegistry: registry,
      }),
    ).toBeUndefined();
  });

  it("keeps the current model when it already declares image input", () => {
    const registry = makeRegistry([
      { id: "gpt-5.4", provider: "openai-codex", input: ["text", "image"] },
    ]);

    expect(
      resolveOpenAICodexVisionModelId({
        model: { id: "gpt-5.4", provider: "openai-codex", input: ["text", "image"] },
        context: {
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "describe this" },
                { type: "image", data: "abc", mimeType: "image/png" },
              ],
            },
          ],
        },
        modelRegistry: registry,
      }),
    ).toBe("gpt-5.4");
  });

  it("switches text-only gpt-5.3-codex turns to gpt-5.4 for inline images", () => {
    const registry = makeRegistry([
      { id: "gpt-5.4", provider: "openai-codex", input: ["text", "image"] },
      { id: "gpt-5.2", provider: "openai-codex", input: ["text", "image"] },
      { id: "gpt-5.3-codex", provider: "openai-codex", input: ["text"] },
    ]);

    expect(
      resolveOpenAICodexVisionModelId({
        model: { id: "gpt-5.3-codex", provider: "openai-codex", input: ["text"] },
        context: {
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "describe this" },
                { type: "image", data: "abc", mimeType: "image/png" },
              ],
            },
          ],
        },
        modelRegistry: registry,
      }),
    ).toBe("gpt-5.4");
  });

  it("prefers the matching base model when a codex variant lacks image input", () => {
    const registry = makeRegistry([
      { id: "gpt-5.2", provider: "openai-codex", input: ["text", "image"] },
      { id: "gpt-5.2-codex", provider: "openai-codex", input: ["text"] },
    ]);

    expect(
      resolveOpenAICodexVisionModelId({
        model: { id: "gpt-5.2-codex", provider: "openai-codex", input: ["text"] },
        context: {
          messages: [
            {
              role: "toolResult",
              content: [
                { type: "text", text: "screenshot" },
                { type: "image", data: "abc", mimeType: "image/png" },
              ],
            },
          ],
        },
        modelRegistry: registry,
      }),
    ).toBe("gpt-5.2");
  });
});
