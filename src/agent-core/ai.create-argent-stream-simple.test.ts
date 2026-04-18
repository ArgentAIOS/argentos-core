import type {
  Provider as ProviderInterface,
  TurnResponse,
  TurnRequest,
  ModelConfig,
  StreamEvent,
} from "../argent-ai/types.js";
import type { AssistantMessage, Context, Model } from "./ai.js";
import { createAssistantMessageEventStream } from "../argent-ai/utils/event-stream.js";

type Provider = ProviderInterface;
import { describe, expect, it } from "vitest";
import { createArgentStreamSimple, hardenStreamSimple } from "./ai.js";

const mockModel: Model = {
  id: "mock-model",
  name: "Mock Model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://example.com",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 8_192,
};

const mockContext: Context = {
  messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
};

const makeBaseAssistant = (): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: "openai-completions",
  provider: "openai",
  model: "mock-model",
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
});

describe("createArgentStreamSimple", () => {
  it("converts provider stream exceptions into error events", async () => {
    const provider: Provider = {
      name: "mock",
      async execute(): Promise<never> {
        throw new Error("unused");
      },
      async *stream(_request: TurnRequest, _modelConfig: ModelConfig): AsyncGenerator<StreamEvent> {
        const partial = {
          text: "",
          toolCalls: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
          },
          stopReason: "stop" as const,
          provider: "openai",
          model: "mock-model",
        };
        yield { type: "start", partial };
        throw new Error("provider exploded");
      },
    };

    const stream = createArgentStreamSimple(provider)(mockModel, mockContext);
    const events: Array<{ type: string }> = [];
    for await (const event of stream) {
      events.push({ type: event.type });
    }

    const result = await stream.result();
    expect(events.map((e) => e.type)).toEqual(["start", "error"]);
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("provider exploded");
  });

  it("normalizes malformed tool-call arguments to an object", async () => {
    const provider: Provider = {
      name: "mock",
      async execute(): Promise<never> {
        throw new Error("unused");
      },
      async *stream(_request: TurnRequest, _modelConfig: ModelConfig): AsyncGenerator<StreamEvent> {
        const partial = {
          text: "",
          toolCalls: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
          },
          stopReason: "tool_use" as const,
          provider: "openai",
          model: "mock-model",
        };
        yield { type: "start", partial };
        yield { type: "tool_call_start", partial };
        yield {
          type: "tool_call_end",
          toolCall: {
            type: "toolCall",
            id: "tc_1",
            name: "test_tool",
            arguments: null as unknown as Record<string, unknown>,
          },
          partial: {
            ...partial,
            toolCalls: [
              {
                type: "toolCall",
                id: "tc_1",
                name: "test_tool",
                arguments: null as unknown as Record<string, unknown>,
              },
            ],
          },
        };
        yield {
          type: "done",
          response: {
            ...makeBaseAssistant(),
            toolCalls: [
              {
                type: "toolCall",
                id: "tc_1",
                name: "test_tool",
                arguments: null as unknown as Record<string, unknown>,
              },
            ],
            stopReason: "tool_use",
            provider: "openai",
            model: "mock-model",
            text: "",
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 0,
            },
          },
        };
      },
    };

    const stream = createArgentStreamSimple(provider)(mockModel, mockContext);
    let sawToolEnd = false;
    for await (const event of stream) {
      if (event.type === "toolcall_end") {
        sawToolEnd = true;
        expect(event.toolCall.arguments).toEqual({});
      }
    }

    const result = await stream.result();
    expect(sawToolEnd).toBe(true);
    const toolCall = result.content.find((b) => b.type === "toolCall");
    expect(toolCall?.type).toBe("toolCall");
    if (toolCall && toolCall.type === "toolCall") {
      expect(toolCall.arguments).toEqual({});
    }
  });

  it("recovers terminal assistant message when stream ends without done/error", async () => {
    const provider: Provider = {
      name: "mock",
      async execute(): Promise<TurnResponse> {
        return {
          text: "Recovered final answer",
          thinking: undefined,
          toolCalls: [],
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 2,
          },
          stopReason: "stop",
          provider: "openai",
          model: "mock-model",
        };
      },
      async *stream(_request: TurnRequest, _modelConfig: ModelConfig): AsyncGenerator<StreamEvent> {
        const partial = {
          text: "",
          toolCalls: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
          },
          stopReason: "stop" as const,
          provider: "openai",
          model: "mock-model",
        };
        yield { type: "start", partial };
      },
    };

    const stream = createArgentStreamSimple(provider)(mockModel, mockContext);
    const eventTypes: string[] = [];
    for await (const event of stream) {
      eventTypes.push(event.type);
    }

    const result = await stream.result();
    const textBlocks = result.content.filter(
      (block): block is Extract<typeof block, { type: "text" }> => block.type === "text",
    );
    expect(eventTypes).toContain("done");
    expect(textBlocks.map((block) => block.text).join("\n")).toContain("Recovered final answer");
  });
});

describe("hardenStreamSimple", () => {
  it("normalizes malformed assistant result content to an array", async () => {
    const streamFn = () => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        stream.push({
          type: "error",
          reason: "error",
          error: {
            ...makeBaseAssistant(),
            // Simulate provider/runtime returning malformed content.
            content: undefined as unknown as AssistantMessage["content"],
            stopReason: "error",
            errorMessage: "provider exploded",
          },
        });
        stream.end({
          ...makeBaseAssistant(),
          content: undefined as unknown as AssistantMessage["content"],
          stopReason: "error",
          errorMessage: "provider exploded",
        });
      })();
      return stream;
    };

    const stream = hardenStreamSimple(streamFn as any)(mockModel, mockContext);
    for await (const _event of stream) {
      // drain
    }
    const result = await stream.result();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "provider exploded" }]);
    expect(result.stopReason).toBe("error");
  });
});
