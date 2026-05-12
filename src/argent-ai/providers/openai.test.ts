import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAIProvider } from "./openai.js";

/**
 * Tests for the openai-completions adapter's reasoning-only safety net (#280).
 *
 * Some OpenAI-compatible providers (notably Z.AI's GLM-5 series in thinking-on
 * mode) can return an empty `content` alongside non-empty `reasoning_content`.
 * The adapter now surfaces the reasoning as visible text in that case, so
 * downstream consumers don't see an empty assistant payload.
 *
 * The conditional is shape-based (not provider/model-based), so OpenAI-proper
 * responses — which always include `content` — are unaffected.
 */

describe("OpenAIProvider — reasoning-only safety net (#280)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces reasoning_content as text when content is empty (non-streaming)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl-reasoning-only",
            object: "chat.completion",
            created: 0,
            model: "glm-5-turbo",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "",
                  reasoning_content: "Here is the answer hiding in reasoning.",
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAIProvider({
      apiKey: "test-key",
      baseURL: "https://api.z.ai/api/paas/v4",
    });

    const response = await provider.execute(
      { messages: [{ role: "user", content: "Hello" }] },
      { id: "glm-5-turbo", thinking: true, maxTokens: 256 },
    );

    expect(response.text).toBe("Here is the answer hiding in reasoning.");
    expect(response.thinking).toBe("Here is the answer hiding in reasoning.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not override visible content when both content and reasoning_content are present (non-streaming)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl-normal",
            object: "chat.completion",
            created: 0,
            model: "glm-5-turbo",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "Visible answer.",
                  reasoning_content: "internal reasoning",
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAIProvider({
      apiKey: "test-key",
      baseURL: "https://api.z.ai/api/paas/v4",
    });

    const response = await provider.execute(
      { messages: [{ role: "user", content: "Hello" }] },
      { id: "glm-5-turbo", thinking: true, maxTokens: 256 },
    );

    expect(response.text).toBe("Visible answer.");
    expect(response.thinking).toBe("internal reasoning");
  });

  it("does not surface reasoning when content is empty but tool calls are present (non-streaming)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl-tools",
            object: "chat.completion",
            created: 0,
            model: "glm-5-turbo",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "",
                  reasoning_content: "should not leak into text",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "get_weather", arguments: '{"city":"Austin"}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAIProvider({
      apiKey: "test-key",
      baseURL: "https://api.z.ai/api/paas/v4",
    });

    const response = await provider.execute(
      { messages: [{ role: "user", content: "Weather?" }] },
      { id: "glm-5-turbo", thinking: true, maxTokens: 256 },
    );

    expect(response.text).toBe("");
    expect(response.thinking).toBe("should not leak into text");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]?.name).toBe("get_weather");
  });

  it("leaves OpenAI-proper responses (no reasoning_content) unchanged (non-streaming)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl-openai",
            object: "chat.completion",
            created: 0,
            model: "gpt-4o",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Plain answer." },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAIProvider({
      apiKey: "test-key",
      baseURL: "https://api.openai.com/v1",
    });

    const response = await provider.execute(
      { messages: [{ role: "user", content: "Hi" }] },
      { id: "gpt-4o", maxTokens: 256 },
    );

    expect(response.text).toBe("Plain answer.");
    expect(response.thinking).toBe("");
  });

  it("surfaces reasoning_content as text when streaming ends with no visible content", async () => {
    const encoder = new TextEncoder();
    const sseLines = [
      `data: ${JSON.stringify({
        id: "chatcmpl-stream-reasoning",
        object: "chat.completion.chunk",
        created: 0,
        model: "glm-5-turbo",
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: "chatcmpl-stream-reasoning",
        object: "chat.completion.chunk",
        created: 0,
        model: "glm-5-turbo",
        choices: [
          { index: 0, delta: { reasoning_content: "Reasoned reply, " }, finish_reason: null },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: "chatcmpl-stream-reasoning",
        object: "chat.completion.chunk",
        created: 0,
        model: "glm-5-turbo",
        choices: [
          { index: 0, delta: { reasoning_content: "no content emitted." }, finish_reason: null },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: "chatcmpl-stream-reasoning",
        object: "chat.completion.chunk",
        created: 0,
        model: "glm-5-turbo",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 8, total_tokens: 12 },
      })}\n\n`,
      `data: [DONE]\n\n`,
    ];

    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const line of sseLines) {
                controller.enqueue(encoder.encode(line));
              }
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAIProvider({
      apiKey: "test-key",
      baseURL: "https://api.z.ai/api/paas/v4",
    });

    let doneResponse: { text: string; thinking?: string } | null = null;
    for await (const event of provider.stream(
      { messages: [{ role: "user", content: "Hello" }] },
      { id: "glm-5-turbo", thinking: true, maxTokens: 256 },
    )) {
      if (event.type === "done") {
        doneResponse = event.response;
      }
    }

    expect(doneResponse).not.toBeNull();
    expect(doneResponse!.thinking).toBe("Reasoned reply, no content emitted.");
    expect(doneResponse!.text).toBe("Reasoned reply, no content emitted.");
  });
});
