import { afterEach, describe, expect, it, vi } from "vitest";
import { createZAIProvider } from "./zai.js";

describe("ZAIProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends thinking mode and reads reasoning content", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body.model).toBe("glm-5-turbo");
      expect(body.thinking).toEqual({ type: "enabled" });
      expect(body.max_tokens).toBe(4096);

      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                reasoning_content: "checked the documents",
                content: "Here is the summary.",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createZAIProvider({
      apiKey: "zai-test",
      baseURL: "https://api.z.ai/api/paas/v4/chat/completions",
    });

    const response = await provider.execute(
      { messages: [{ role: "user", content: "Summarize this." }] },
      { id: "glm-5-turbo", thinking: true, maxTokens: 4096 },
    );

    expect(response.text).toBe("Here is the summary.");
    expect(response.thinking).toBe("checked the documents");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries reasoning-only non-stream responses with thinking disabled", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

      if (fetchMock.mock.calls.length === 1) {
        expect(body.thinking).toEqual({ type: "enabled" });
        return new Response(
          JSON.stringify({
            id: "chatcmpl-reasoning-only",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  reasoning_content: "This should not be the visible reply.",
                  content: "",
                },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      expect(body.thinking).toEqual({ type: "disabled" });
      return new Response(
        JSON.stringify({
          id: "chatcmpl-recovered",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Recovered visible answer.",
              },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createZAIProvider({
      apiKey: "zai-test",
      baseURL: "https://api.z.ai/api/paas/v4/chat/completions",
    });

    const response = await provider.execute(
      { messages: [{ role: "user", content: "Summarize this." }] },
      { id: "glm-5.1", thinking: true, maxTokens: 4096 },
    );

    expect(response.text).toBe("Recovered visible answer.");
    expect(response.thinking).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries reasoning-only streaming responses with thinking disabled", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

      if (fetchMock.mock.calls.length === 1) {
        expect(body.stream).toBe(true);
        expect(body.thinking).toEqual({ type: "enabled" });
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    id: "chatcmpl-stream-reasoning",
                    object: "chat.completion.chunk",
                    choices: [
                      {
                        index: 0,
                        delta: { reasoning_content: "Hidden-only payload." },
                      },
                    ],
                  })}\n\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    id: "chatcmpl-stream-reasoning",
                    object: "chat.completion.chunk",
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                  })}\n\n`,
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }

      expect(body.stream).toBe(false);
      expect(body.thinking).toEqual({ type: "disabled" });
      return new Response(
        JSON.stringify({
          id: "chatcmpl-stream-recovered",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Recovered streamed answer.",
              },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createZAIProvider({
      apiKey: "zai-test",
      baseURL: "https://api.z.ai/api/paas/v4/chat/completions",
    });

    const events = [];
    for await (const event of provider.stream(
      { messages: [{ role: "user", content: "Summarize this." }] },
      { id: "glm-5.1", thinking: true, maxTokens: 4096 },
    )) {
      events.push(event);
    }

    expect(
      events.some(
        (event) => event.type === "text_delta" && event.delta === "Recovered streamed answer.",
      ),
    ).toBe(true);
    const done = events.find((event) => event.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.response.text).toBe("Recovered streamed answer.");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
