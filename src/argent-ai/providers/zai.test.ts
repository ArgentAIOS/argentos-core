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
});
