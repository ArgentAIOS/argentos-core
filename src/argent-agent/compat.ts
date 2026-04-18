/**
 * Argent Agent — Pi ↔ Argent Compatibility Layer
 *
 * Converts between Pi runtime types and Argent-native types.
 * The key export is `createArgentStreamSimple()` which wraps an Argent
 * Provider as a Pi-compatible `streamSimple` function — enabling drop-in
 * replacement in `attempt.ts` without changing any consuming code.
 *
 * Built for Argent Core - February 16, 2026
 */

import type {
  Model,
  Api,
  Context,
  SimpleStreamOptions,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  UserMessage,
  ToolResultMessage,
  TextContent,
  ThinkingContent,
  ToolCall as PiToolCall,
  Usage,
  StopReason,
  Provider as ArgentProvider,
  TurnRequest,
  TurnResponse,
  StreamEvent,
  ModelConfig,
  ToolCall as ArgentToolCall,
} from "../argent-ai/types.js";
import { createAssistantMessageEventStream } from "../argent-ai/utils/event-stream.js";

// ============================================================================
// Pi Model → Argent ModelConfig
// ============================================================================

/**
 * Convert a Pi Model + SimpleStreamOptions into an Argent ModelConfig.
 */
export function piModelToArgentConfig(model: Model, options?: SimpleStreamOptions): ModelConfig {
  const thinkingLevel = resolveThinkingLevel(options);
  const thinkingEnabled = model.reasoning && thinkingLevel !== "off";
  return {
    id: model.id,
    maxTokens: options?.maxTokens ?? model.maxTokens,
    temperature: options?.temperature,
    thinking: thinkingEnabled,
    thinkingBudget:
      thinkingEnabled && thinkingLevel !== "off"
        ? options?.thinkingBudgets?.[thinkingLevel]
        : undefined,
  };
}

function resolveThinkingLevel(
  options?: SimpleStreamOptions,
): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" {
  if (!options) {
    return "medium";
  }
  if (options.reasoning) {
    return options.reasoning;
  }
  const thinkingLevel = (options as { thinkingLevel?: string }).thinkingLevel;
  if (
    thinkingLevel === "off" ||
    thinkingLevel === "minimal" ||
    thinkingLevel === "low" ||
    thinkingLevel === "medium" ||
    thinkingLevel === "high" ||
    thinkingLevel === "xhigh"
  ) {
    return thinkingLevel;
  }
  return "medium";
}

// ============================================================================
// Pi Context → Argent TurnRequest
// ============================================================================

/**
 * Convert a Pi Context into an Argent TurnRequest.
 */
export function piContextToArgentRequest(context: Context): TurnRequest {
  const messages: TurnRequest["messages"] = [];

  for (const msg of context.messages) {
    if (msg.role === "user") {
      const userMsg = msg as UserMessage;
      const userBlocks = Array.isArray(userMsg.content) ? userMsg.content : [];
      const text =
        typeof userMsg.content === "string"
          ? userMsg.content
          : userBlocks
              .filter((b): b is TextContent => b.type === "text")
              .map((b) => b.text)
              .join("");
      messages.push({ role: "user", content: text });
    } else if (msg.role === "assistant") {
      const assistantMsg = msg as AssistantMessage;
      const assistantBlocks = Array.isArray(assistantMsg.content) ? assistantMsg.content : [];
      const text = assistantBlocks
        .filter((b): b is TextContent => b.type === "text")
        .map((b) => b.text)
        .join("");
      const toolCalls = assistantBlocks
        .filter((b): b is PiToolCall => b.type === "toolCall")
        .map((tc) => ({
          type: "toolCall" as const,
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        }));
      // Skip empty assistant messages — these occur when tool blocks are stripped
      // during cross-provider history sanitization (e.g. Anthropic → MiniMax).
      // Sending empty { role: "assistant" } messages causes providers to return
      // empty responses or errors.
      if (!text && toolCalls.length === 0) {
        continue;
      }
      messages.push({
        role: "assistant",
        content: text,
        text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    } else if (msg.role === "toolResult") {
      const toolMsg = msg as ToolResultMessage;
      const toolBlocks = Array.isArray(toolMsg.content) ? toolMsg.content : [];
      const text = toolBlocks
        .filter((b): b is TextContent => b.type === "text")
        .map((b) => b.text)
        .join("");
      messages.push({
        role: "tool",
        content: text,
        toolCallId: toolMsg.toolCallId,
      });
    }
  }

  const tools = context.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as Record<string, unknown>,
  }));

  return {
    systemPrompt: context.systemPrompt,
    messages,
    tools: tools && tools.length > 0 ? tools : undefined,
  };
}

// ============================================================================
// Argent StreamEvent → Pi AssistantMessageEvent
// ============================================================================

/**
 * Build an AssistantMessage shell from a partial TurnResponse.
 * Used to satisfy Pi's event format which carries the full message object.
 */
function buildPartialAssistantMessage(
  partial: TurnResponse,
  contentIndex: number,
  api: Api,
): AssistantMessage {
  const content: (TextContent | ThinkingContent | PiToolCall)[] = [];

  if (partial.text) {
    content.push({ type: "text", text: partial.text });
  }
  if (partial.thinking) {
    content.push({ type: "thinking", thinking: partial.thinking });
  }
  for (const tc of partial.toolCalls) {
    content.push({
      type: "toolCall",
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    });
  }

  return {
    role: "assistant",
    content,
    api,
    provider: partial.provider,
    model: partial.model,
    usage: {
      input: partial.usage.inputTokens,
      output: partial.usage.outputTokens,
      cacheRead: partial.usage.cacheReadTokens,
      cacheWrite: partial.usage.cacheWriteTokens,
      totalTokens: partial.usage.totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: mapArgentStopReasonToPi(partial.stopReason),
    errorMessage: partial.errorMessage,
    timestamp: Date.now(),
  };
}

/**
 * Map Argent stop reason → Pi stop reason.
 */
function mapArgentStopReasonToPi(reason: TurnResponse["stopReason"]): StopReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_use":
      return "toolUse";
    case "error":
      return "error";
    default:
      return "stop";
  }
}

/**
 * Map Pi stop reason → Argent stop reason.
 */
export function mapPiStopReasonToArgent(reason: StopReason): TurnResponse["stopReason"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "toolUse":
      return "tool_use";
    case "error":
      return "error";
    case "aborted":
      return "error";
    default:
      return "stop";
  }
}

// ============================================================================
// Core Bridge: Argent Provider → Pi streamSimple
// ============================================================================

/**
 * Wrap an Argent Provider as a Pi-compatible streamSimple function.
 *
 * This is the key bridge — it lets `attempt.ts` use an Argent provider
 * exactly where it currently uses Pi's `streamSimple`:
 *
 *   import { createArgentStreamSimple } from "../agent-core/ai.js";
 *   const argentStream = createArgentStreamSimple(argentProvider);
 *   activeSession.agent.streamFn = argentStream;
 *
 * The returned function has the same signature as Pi's streamSimple:
 *   (model: Model, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream
 */
export function createArgentStreamSimple(
  provider: ArgentProvider,
): (model: Model, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream {
  return (model: Model, context: Context, options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream();

    // Convert Pi types → Argent types
    const modelConfig = piModelToArgentConfig(model, options);
    const request = piContextToArgentRequest(context);

    // Run the Argent provider in the background and pipe events to the Pi stream
    void (async () => {
      let contentIndex = 0;
      let sawTerminalEvent = false;
      let lastPartial: TurnResponse | null = null;

      try {
        for await (const event of provider.stream(request, modelConfig)) {
          if ("partial" in event && event.partial) {
            lastPartial = event.partial;
          }
          if (event.type === "done") {
            sawTerminalEvent = true;
          }
          if (event.type === "error") {
            sawTerminalEvent = true;
          }
          const piEvent = convertStreamEventToPi(event, contentIndex, model.api);
          if (piEvent) {
            stream.push(piEvent);
          }

          // Track content block indices
          if (
            event.type === "text_start" ||
            event.type === "thinking_start" ||
            event.type === "tool_call_start"
          ) {
            contentIndex++;
          }
        }

        if (!sawTerminalEvent) {
          // Some providers can finish streaming without emitting a terminal event.
          // Guarantee a terminal assistant message for Pi session state by falling
          // back to execute() (or the last known partial response).
          let recovered: TurnResponse | null = null;
          try {
            recovered = await provider.execute(request, modelConfig);
          } catch {
            recovered = lastPartial;
          }
          if (recovered) {
            const recoveredDone = convertStreamEventToPi(
              { type: "done", response: recovered },
              contentIndex,
              model.api,
            );
            if (recoveredDone) {
              stream.push(recoveredDone);
            }
          }
        }

        stream.end();
      } catch (error) {
        const errMsg = buildProviderErrorMessage(model, error);
        stream.push({ type: "error", reason: "error", error: errMsg });
        stream.end(errMsg);
      }
    })();

    return stream;
  };
}

/**
 * Convert a single Argent StreamEvent → Pi AssistantMessageEvent.
 */
function convertStreamEventToPi(
  event: StreamEvent,
  contentIndex: number,
  api: Api,
): AssistantMessageEvent | null {
  switch (event.type) {
    case "start":
      return {
        type: "start",
        partial: buildPartialAssistantMessage(event.partial, contentIndex, api),
      };

    case "text_start":
      return {
        type: "text_start",
        contentIndex,
        partial: buildPartialAssistantMessage(event.partial, contentIndex, api),
      };

    case "text_delta":
      return {
        type: "text_delta",
        contentIndex,
        delta: event.delta,
        partial: buildPartialAssistantMessage(event.partial, contentIndex, api),
      };

    case "text_end":
      return {
        type: "text_end",
        contentIndex,
        content: event.text,
        partial: buildPartialAssistantMessage(event.partial, contentIndex, api),
      };

    case "thinking_start":
      return {
        type: "thinking_start",
        contentIndex,
        partial: buildPartialAssistantMessage(event.partial, contentIndex, api),
      };

    case "thinking_delta":
      return {
        type: "thinking_delta",
        contentIndex,
        delta: event.delta,
        partial: buildPartialAssistantMessage(event.partial, contentIndex, api),
      };

    case "thinking_end":
      return {
        type: "thinking_end",
        contentIndex,
        content: event.thinking,
        partial: buildPartialAssistantMessage(event.partial, contentIndex, api),
      };

    case "tool_call_start":
      return {
        type: "toolcall_start",
        contentIndex,
        partial: buildPartialAssistantMessage(event.partial, contentIndex, api),
      };

    case "tool_call_delta":
      return {
        type: "toolcall_delta",
        contentIndex,
        delta: event.delta,
        partial: buildPartialAssistantMessage(event.partial, contentIndex, api),
      };

    case "tool_call_end":
      return {
        type: "toolcall_end",
        contentIndex,
        toolCall: {
          type: "toolCall",
          id: event.toolCall.id,
          name: event.toolCall.name,
          arguments: event.toolCall.arguments,
        },
        partial: buildPartialAssistantMessage(event.partial, contentIndex, api),
      };

    case "done": {
      const msg = buildPartialAssistantMessage(event.response, contentIndex, api);
      const reason = msg.stopReason;
      if (reason === "stop" || reason === "length" || reason === "toolUse") {
        return { type: "done", reason, message: msg };
      }
      return { type: "done", reason: "stop", message: msg };
    }

    case "error": {
      const errMsg = buildPartialAssistantMessage(event.error, contentIndex, api);
      const errReason = errMsg.stopReason;
      if (errReason === "aborted" || errReason === "error") {
        return { type: "error", reason: errReason, error: errMsg };
      }
      return { type: "error", reason: "error", error: errMsg };
    }

    default:
      return null;
  }
}

function buildProviderErrorMessage(model: Model, error: unknown): AssistantMessage {
  const message = error instanceof Error ? error.message : String(error);
  const now = Date.now();
  const usage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  return {
    role: "assistant",
    content: [{ type: "text", text: message.trim() || "(error)" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: "error",
    errorMessage: message,
    timestamp: now,
  };
}

// ============================================================================
// Reverse: Pi AssistantMessage → Argent TurnResponse
// ============================================================================

/**
 * Convert a Pi AssistantMessage to an Argent TurnResponse.
 * Useful for round-trip testing and interop.
 */
export function piMessageToArgentResponse(msg: AssistantMessage): TurnResponse {
  const content = Array.isArray(msg.content) ? msg.content : [];
  const text = content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("");

  const thinking = content
    .filter((b): b is ThinkingContent => b.type === "thinking")
    .map((b) => b.thinking)
    .join("");

  const toolCalls = content
    .filter((b): b is PiToolCall => b.type === "toolCall")
    .map((tc) => ({
      type: "toolCall" as const,
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    }));

  return {
    text,
    thinking: thinking || undefined,
    toolCalls,
    usage: {
      inputTokens: msg.usage.input,
      outputTokens: msg.usage.output,
      cacheReadTokens: msg.usage.cacheRead,
      cacheWriteTokens: msg.usage.cacheWrite,
      totalTokens: msg.usage.totalTokens,
    },
    stopReason: mapPiStopReasonToArgent(msg.stopReason),
    provider: msg.provider,
    model: msg.model,
    errorMessage: msg.errorMessage,
  };
}
