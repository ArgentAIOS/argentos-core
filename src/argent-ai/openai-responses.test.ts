import { Type } from "@sinclair/typebox";
import { describe, it, expect, afterEach } from "vitest";
import type { AssistantMessage, Model, ToolResultMessage } from "./types.js";
import { streamOpenAIResponses } from "./openai-responses.js";

function buildModel(): Model<"openai-responses"> {
  return {
    id: "gpt-5.2",
    name: "gpt-5.2",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
  };
}

/**
 * Replace global fetch with a spy that captures the request body and throws.
 * This lets us verify the request format without hitting real APIs.
 */
function installFailingFetchCapture() {
  const originalFetch = globalThis.fetch;
  let lastBody: unknown;

  const fetchImpl: typeof fetch = async (_input, init) => {
    const rawBody = init?.body;
    const bodyText = (() => {
      if (!rawBody) return "";
      if (typeof rawBody === "string") return rawBody;
      if (rawBody instanceof Uint8Array) return Buffer.from(rawBody).toString("utf8");
      if (rawBody instanceof ArrayBuffer)
        return Buffer.from(new Uint8Array(rawBody)).toString("utf8");
      return String(rawBody);
    })();
    lastBody = bodyText ? (JSON.parse(bodyText) as unknown) : undefined;
    throw new Error("intentional fetch abort (test)");
  };

  globalThis.fetch = fetchImpl;

  return {
    getLastBody: () => lastBody as Record<string, unknown> | undefined,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe("streamOpenAIResponses (Argent)", () => {
  let cap: ReturnType<typeof installFailingFetchCapture> | null = null;

  afterEach(() => {
    cap?.restore();
    cap = null;
  });

  it("sends model, input array, and stream:true to /responses endpoint", async () => {
    cap = installFailingFetchCapture();
    const model = buildModel();

    const stream = streamOpenAIResponses(
      model,
      {
        systemPrompt: "You are a helpful assistant.",
        messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
      },
      { apiKey: "test-key" },
    );

    // result() resolves (with error message) since fetch throws
    const result = await stream.result();
    expect(result.stopReason).toBe("error");

    const body = cap.getLastBody();
    expect(body).toBeDefined();
    expect(body!.model).toBe("gpt-5.2");
    expect(body!.stream).toBe(true);
    expect(Array.isArray(body!.input)).toBe(true);

    const input = body!.input as Array<Record<string, unknown>>;
    // System prompt + user message
    expect(input.length).toBe(2);
    expect(input[0].type).toBe("message");
    expect(input[0].role).toBe("system");
    expect(input[1].type).toBe("message");
    expect(input[1].role).toBe("user");
    expect(input[1].content).toBe("Hello");
  });

  it("replays reasoning items from assistant thinking content", async () => {
    cap = installFailingFetchCapture();
    const model = buildModel();

    const assistantWithThinking: AssistantMessage = {
      role: "assistant",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.2",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
      content: [
        {
          type: "thinking",
          thinking: "internal reasoning",
          thinkingSignature: JSON.stringify({
            type: "reasoning",
            id: "rs_test123",
            summary: [{ type: "summary_text", text: "I thought about it" }],
          }),
        },
        { type: "text", text: "Here is my answer" },
      ],
    };

    const stream = streamOpenAIResponses(
      model,
      {
        systemPrompt: "system",
        messages: [
          { role: "user", content: "Question", timestamp: Date.now() },
          assistantWithThinking,
          { role: "user", content: "Follow up", timestamp: Date.now() },
        ],
      },
      { apiKey: "test" },
    );

    await stream.result();

    const body = cap.getLastBody();
    const input = body!.input as Array<Record<string, unknown>>;
    const types = input.map((item) => item.type).filter(Boolean);

    // Should contain: system message, user, reasoning, assistant message, user
    expect(types).toContain("reasoning");
    expect(types).toContain("message");

    // Reasoning should appear in the input
    const reasoningItem = input.find((item) => item.type === "reasoning");
    expect(reasoningItem).toBeDefined();
    expect(reasoningItem!.id).toBe("rs_test123");
  });

  it("replays reasoning before function_call for tool-call-only turns", async () => {
    cap = installFailingFetchCapture();
    const model = buildModel();

    const assistantToolOnly: AssistantMessage = {
      role: "assistant",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.2",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: Date.now(),
      content: [
        {
          type: "thinking",
          thinking: "internal",
          thinkingSignature: JSON.stringify({
            type: "reasoning",
            id: "rs_abc",
            summary: [],
          }),
        },
        {
          type: "toolCall",
          id: "call_xyz|fc_xyz",
          name: "noop",
          arguments: {},
        },
      ],
    };

    const toolResult: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call_xyz|fc_xyz",
      toolName: "noop",
      content: [{ type: "text", text: "ok" }],
      isError: false,
      timestamp: Date.now(),
    };

    const stream = streamOpenAIResponses(
      model,
      {
        systemPrompt: "system",
        messages: [
          { role: "user", content: "Call noop.", timestamp: Date.now() },
          assistantToolOnly,
          toolResult,
          { role: "user", content: "Now reply.", timestamp: Date.now() },
        ],
        tools: [
          {
            name: "noop",
            description: "no-op",
            parameters: Type.Object({}, { additionalProperties: false }),
          },
        ],
      },
      { apiKey: "test" },
    );

    await stream.result();

    const body = cap.getLastBody();
    const input = body!.input as Array<Record<string, unknown>>;
    const types = input
      .map((item) => item.type as string)
      .filter((t): t is string => typeof t === "string");

    // Reasoning should appear before function_call
    expect(types).toContain("reasoning");
    expect(types).toContain("function_call");
    expect(types.indexOf("reasoning")).toBeLessThan(types.indexOf("function_call"));

    // function_call_output should appear after function_call
    expect(types).toContain("function_call_output");
    expect(types.indexOf("function_call")).toBeLessThan(types.indexOf("function_call_output"));
  });

  it("tolerates tool results with missing content blocks", async () => {
    cap = installFailingFetchCapture();
    const model = buildModel();

    const assistantToolOnly: AssistantMessage = {
      role: "assistant",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.2",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: Date.now(),
      content: [
        {
          type: "toolCall",
          id: "call_sparse|fc_sparse",
          name: "web_fetch",
          arguments: { url: "https://example.com" },
        },
      ],
    };

    const sparseToolResult = {
      role: "toolResult" as const,
      toolCallId: "call_sparse|fc_sparse",
      toolName: "web_fetch",
      timestamp: Date.now(),
    } as ToolResultMessage;

    const stream = streamOpenAIResponses(
      model,
      {
        systemPrompt: "system",
        messages: [
          { role: "user", content: "Fetch the page.", timestamp: Date.now() },
          assistantToolOnly,
          sparseToolResult,
          { role: "user", content: "Now continue.", timestamp: Date.now() },
        ],
        tools: [
          {
            name: "web_fetch",
            description: "fetch a page",
            parameters: Type.Object({ url: Type.String() }, { additionalProperties: false }),
          },
        ],
      },
      { apiKey: "test" },
    );

    const result = await stream.result();
    expect(result.stopReason).toBe("error");

    const body = cap.getLastBody();
    const input = body!.input as Array<Record<string, unknown>>;
    const functionOutput = input.find((item) => item.type === "function_call_output");
    expect(functionOutput).toBeDefined();
    expect(functionOutput!.call_id).toBe("call_sparse");
    expect(functionOutput!.output).toBe("");
  });

  it("tolerates assistant messages with missing content arrays", async () => {
    cap = installFailingFetchCapture();
    const model = buildModel();

    const malformedAssistant = {
      role: "assistant",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.2",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
      content: undefined,
    } as unknown as AssistantMessage;

    const stream = streamOpenAIResponses(
      model,
      {
        systemPrompt: "system",
        messages: [
          { role: "user", content: "Question", timestamp: Date.now() },
          malformedAssistant,
          { role: "user", content: "Follow up", timestamp: Date.now() },
        ],
      },
      { apiKey: "test" },
    );

    await stream.result();

    const body = cap.getLastBody();
    const input = body!.input as Array<Record<string, unknown>>;
    expect(input.some((item) => item.role === "assistant")).toBe(false);
    expect(input.some((item) => item.role === "user" && item.content === "Follow up")).toBe(true);
  });

  it("splits pipe-delimited tool call IDs into call_id and fc_id", async () => {
    cap = installFailingFetchCapture();
    const model = buildModel();

    const assistantMsg: AssistantMessage = {
      role: "assistant",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.2",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: Date.now(),
      content: [
        {
          type: "toolCall",
          id: "call_abc|fc_def",
          name: "test_tool",
          arguments: { key: "value" },
        },
      ],
    };

    const toolResult: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call_abc|fc_def",
      toolName: "test_tool",
      content: [{ type: "text", text: "result" }],
      isError: false,
      timestamp: Date.now(),
    };

    const stream = streamOpenAIResponses(
      model,
      {
        messages: [
          { role: "user", content: "test", timestamp: Date.now() },
          assistantMsg,
          toolResult,
        ],
      },
      { apiKey: "test" },
    );

    await stream.result();

    const body = cap.getLastBody();
    const input = body!.input as Array<Record<string, unknown>>;

    const fcItem = input.find((item) => item.type === "function_call");
    expect(fcItem).toBeDefined();
    expect(fcItem!.call_id).toBe("call_abc");
    expect(fcItem!.id).toBe("fc_def");
    expect(fcItem!.name).toBe("test_tool");
    expect(fcItem!.arguments).toBe('{"key":"value"}');

    const fcOutput = input.find((item) => item.type === "function_call_output");
    expect(fcOutput).toBeDefined();
    expect(fcOutput!.call_id).toBe("call_abc");
    expect(fcOutput!.output).toBe("result");
  });

  it("includes tools in the request body", async () => {
    cap = installFailingFetchCapture();
    const model = buildModel();

    const stream = streamOpenAIResponses(
      model,
      {
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
        tools: [
          {
            name: "calculator",
            description: "Does math",
            parameters: Type.Object({ expression: Type.String() }),
          },
        ],
      },
      { apiKey: "test" },
    );

    await stream.result();

    const body = cap.getLastBody();
    expect(body!.tools).toBeDefined();
    const tools = body!.tools as Array<Record<string, unknown>>;
    expect(tools.length).toBe(1);
    expect(tools[0].type).toBe("function");
    expect(tools[0].name).toBe("calculator");
  });

  it("returns an AssistantMessageEventStream with error on fetch failure", async () => {
    cap = installFailingFetchCapture();
    const model = buildModel();

    const stream = streamOpenAIResponses(
      model,
      { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
      { apiKey: "test" },
    );

    // Collect events
    const events: Array<{ type: string }> = [];
    for await (const event of stream) {
      events.push(event);
    }

    // Should have start + error events
    expect(events.some((e) => e.type === "start")).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(true);

    const result = await stream.result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("intentional fetch abort");
  });
});
