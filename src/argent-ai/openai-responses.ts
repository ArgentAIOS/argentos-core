/**
 * Argent AI — OpenAI Responses API Streaming
 *
 * Implements streaming for OpenAI's Responses API (newer format used by
 * GPT-5, o3, etc.). This is separate from the Chat Completions API.
 *
 * Key differences from Chat Completions:
 * - Uses `input` array instead of `messages`
 * - Input items have `type` field: "message", "reasoning", "function_call", "function_call_output"
 * - Reasoning items are replayed from previous turns (required by the API)
 * - Tool calls use function_call/function_call_output format
 * - SSE events use response.* prefixed event names
 *
 * This is an Argent-native replacement for Pi's `streamOpenAIResponses`.
 * Only 1 call site + 1 test file.
 *
 * @module argent-ai/openai-responses
 */

import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Message,
  Model,
  StreamOptions,
  StopReason,
  ToolCall,
  Usage,
} from "./types.js";
import { createAssistantMessageEventStream } from "./utils/event-stream.js";

// ============================================================================
// Types
// ============================================================================

export interface OpenAIResponsesOptions extends StreamOptions {
  /** Override API key */
  apiKey?: string;
}

/** An item in the OpenAI Responses API `input` array */
type InputItem =
  | { type: "message"; role: string; content: string | Array<{ type: string; text: string }> }
  | { type: "reasoning"; id: string; summary: Array<{ type: string; text: string }> }
  | {
      type: "function_call";
      id: string;
      call_id: string;
      name: string;
      arguments: string;
    }
  | { type: "function_call_output"; call_id: string; output: string };

/** Tool definition for the Responses API */
interface ResponsesToolDef {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ============================================================================
// Context → Input Conversion
// ============================================================================

/**
 * Convert Pi/Argent Context messages into Responses API `input` items.
 *
 * The critical behavior: reasoning items from previous assistant messages
 * must be replayed in the input (OpenAI requires this for context continuity).
 * Thinking content with a `thinkingSignature` is parsed as a JSON reasoning item.
 * Text content with a `textSignature` becomes a message item with that ID.
 */
function convertMessagesToInput(messages: Message[]): InputItem[] {
  const input: InputItem[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter(
                  (b): b is { type: "text"; text: string } => b.type === "text" && "text" in b,
                )
                .map((b) => b.text)
                .join("\n")
            : String(msg.content);
      input.push({ type: "message", role: "user", content });
    } else if (msg.role === "assistant") {
      // Process assistant content blocks — replay reasoning + text + tool calls
      const assistantMsg = msg as AssistantMessage;
      for (const block of assistantMsg.content) {
        if (block.type === "thinking" && block.thinkingSignature) {
          // Replay reasoning from thinkingSignature JSON
          try {
            const reasoning = JSON.parse(block.thinkingSignature) as {
              type: string;
              id: string;
              summary: Array<{ type: string; text: string }>;
            };
            if (reasoning.type === "reasoning") {
              input.push({
                type: "reasoning",
                id: reasoning.id,
                summary: reasoning.summary || [],
              });
            }
          } catch {
            // If thinkingSignature isn't valid JSON, skip the reasoning replay
          }
        } else if (block.type === "text") {
          // Text block → message item
          const textBlock = block as { type: "text"; text: string; textSignature?: string };
          input.push({
            type: "message",
            role: "assistant",
            content: textBlock.text,
          });
        } else if (block.type === "toolCall") {
          // Tool call → function_call item
          const toolCall = block as ToolCall;
          // Pi stores "call_id|fc_id" in the toolCall.id field
          const [callId, fcId] = splitToolCallId(toolCall.id);
          input.push({
            type: "function_call",
            id: fcId || callId,
            call_id: callId,
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          });
        }
      }
    } else if (msg.role === "toolResult") {
      // Tool result → function_call_output item
      const toolResult = msg as {
        role: "toolResult";
        toolCallId: string;
        content: Array<{ type: string; text?: string }>;
      };
      const [callId] = splitToolCallId(toolResult.toolCallId);
      const outputText = toolResult.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text" && "text" in b)
        .map((b) => b.text)
        .join("\n");
      input.push({
        type: "function_call_output",
        call_id: callId,
        output: outputText,
      });
    }
  }

  return input;
}

/**
 * Split a Pi-format tool call ID into [call_id, fc_id].
 * Pi stores these as "call_123|fc_123". If no pipe, use the whole ID for both.
 */
function splitToolCallId(id: string): [string, string] {
  const pipeIdx = id.indexOf("|");
  if (pipeIdx === -1) return [id, id];
  return [id.slice(0, pipeIdx), id.slice(pipeIdx + 1)];
}

/**
 * Convert tools to Responses API format.
 */
function convertTools(tools: NonNullable<Context["tools"]>): ResponsesToolDef[] {
  return tools.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as unknown as Record<string, unknown>,
  }));
}

// ============================================================================
// SSE Parser
// ============================================================================

interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Parse SSE text into individual events.
 */
function* parseSSE(text: string): Generator<SSEEvent> {
  const lines = text.split("\n");
  let currentEvent = "";
  let currentData = "";

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      currentData = line.slice(6);
    } else if (line === "" && (currentEvent || currentData)) {
      yield { event: currentEvent, data: currentData };
      currentEvent = "";
      currentData = "";
    }
  }

  // Handle last event if no trailing newline
  if (currentEvent || currentData) {
    yield { event: currentEvent, data: currentData };
  }
}

// ============================================================================
// Response Event Handling
// ============================================================================

/** Tracked state during streaming */
interface StreamState {
  contentIndex: number;
  text: string;
  thinking: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: StopReason;
  pendingFunctionCalls: Map<string, { callId: string; name: string; args: string }>;
  textStarted: boolean;
  thinkingStarted: boolean;
}

function createInitialState(): StreamState {
  return {
    contentIndex: 0,
    text: "",
    thinking: "",
    toolCalls: [],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    pendingFunctionCalls: new Map(),
    textStarted: false,
    thinkingStarted: false,
  };
}

function buildPartialMessage(state: StreamState, model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [
      ...(state.thinking ? [{ type: "thinking" as const, thinking: state.thinking }] : []),
      ...(state.text ? [{ type: "text" as const, text: state.text }] : []),
      ...state.toolCalls,
    ],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { ...state.usage },
    stopReason: state.stopReason,
    timestamp: Date.now(),
  };
}

/**
 * Process a single SSE event and emit the corresponding AssistantMessageEvents.
 */
function processSSEEvent(
  sseEvent: SSEEvent,
  state: StreamState,
  model: Model<Api>,
  stream: {
    push: (event: AssistantMessageEvent) => void;
  },
): void {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(sseEvent.data) as Record<string, unknown>;
  } catch {
    return; // Skip malformed data
  }

  const eventType = sseEvent.event;

  // Reasoning/thinking events
  if (eventType === "response.reasoning_summary_text.delta") {
    const delta = (parsed.delta as string) || "";
    if (!state.thinkingStarted) {
      state.thinkingStarted = true;
      stream.push({
        type: "thinking_start",
        contentIndex: state.contentIndex,
        partial: buildPartialMessage(state, model),
      });
    }
    state.thinking += delta;
    stream.push({
      type: "thinking_delta",
      contentIndex: state.contentIndex,
      delta,
      partial: buildPartialMessage(state, model),
    });
  } else if (eventType === "response.reasoning_summary_text.done") {
    if (state.thinkingStarted) {
      state.thinkingStarted = false;
      state.contentIndex++;
      stream.push({
        type: "thinking_end",
        contentIndex: state.contentIndex - 1,
        content: state.thinking,
        partial: buildPartialMessage(state, model),
      });
    }
  }

  // Text output events
  else if (eventType === "response.output_text.delta") {
    const delta = (parsed.delta as string) || "";
    if (state.thinkingStarted) {
      // Close thinking before starting text
      state.thinkingStarted = false;
      state.contentIndex++;
      stream.push({
        type: "thinking_end",
        contentIndex: state.contentIndex - 1,
        content: state.thinking,
        partial: buildPartialMessage(state, model),
      });
    }
    if (!state.textStarted) {
      state.textStarted = true;
      stream.push({
        type: "text_start",
        contentIndex: state.contentIndex,
        partial: buildPartialMessage(state, model),
      });
    }
    state.text += delta;
    stream.push({
      type: "text_delta",
      contentIndex: state.contentIndex,
      delta,
      partial: buildPartialMessage(state, model),
    });
  } else if (eventType === "response.output_text.done") {
    if (state.textStarted) {
      state.textStarted = false;
      state.contentIndex++;
      stream.push({
        type: "text_end",
        contentIndex: state.contentIndex - 1,
        content: state.text,
        partial: buildPartialMessage(state, model),
      });
    }
  }

  // Function call events
  else if (eventType === "response.output_item.added") {
    const itemType = parsed.type as string;
    if (itemType === "function_call") {
      const id = (parsed.id as string) || "";
      const callId = (parsed.call_id as string) || id;
      const name = (parsed.name as string) || "";
      state.pendingFunctionCalls.set(id, { callId, name, args: "" });
      stream.push({
        type: "toolcall_start",
        contentIndex: state.contentIndex,
        partial: buildPartialMessage(state, model),
      });
    }
  } else if (eventType === "response.function_call_arguments.delta") {
    const itemId = (parsed.item_id as string) || "";
    const delta = (parsed.delta as string) || "";
    const pending = state.pendingFunctionCalls.get(itemId);
    if (pending) {
      pending.args += delta;
      stream.push({
        type: "toolcall_delta",
        contentIndex: state.contentIndex,
        delta,
        partial: buildPartialMessage(state, model),
      });
    }
  } else if (eventType === "response.function_call_arguments.done") {
    const itemId = (parsed.item_id as string) || "";
    const pending = state.pendingFunctionCalls.get(itemId);
    if (pending) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(pending.args || (parsed.arguments as string) || "{}");
      } catch {
        // Keep empty
      }
      const toolCall: ToolCall = {
        type: "toolCall",
        id: `${pending.callId}|${itemId}`,
        name: pending.name,
        arguments: args,
      };
      state.toolCalls.push(toolCall);
      state.contentIndex++;
      stream.push({
        type: "toolcall_end",
        contentIndex: state.contentIndex - 1,
        toolCall,
        partial: buildPartialMessage(state, model),
      });
      state.pendingFunctionCalls.delete(itemId);
    }
  }

  // Completion events
  else if (eventType === "response.completed") {
    // Extract usage if present
    const usage = parsed.usage as
      | {
          input_tokens?: number;
          output_tokens?: number;
          input_tokens_details?: { cached_tokens?: number };
        }
      | undefined;
    if (usage) {
      state.usage.input = usage.input_tokens || 0;
      state.usage.output = usage.output_tokens || 0;
      state.usage.cacheRead = usage.input_tokens_details?.cached_tokens ?? 0;
      state.usage.cacheWrite = 0;
      state.usage.totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
    }

    // Determine stop reason from output items
    const output = parsed.output as Array<{ type: string }> | undefined;
    if (output?.some((item) => item.type === "function_call")) {
      state.stopReason = "toolUse";
    } else {
      state.stopReason = "stop";
    }
  }
}

// ============================================================================
// Main Streaming Function
// ============================================================================

/**
 * Stream a response using the OpenAI Responses API.
 *
 * This function converts Pi/Argent message format into the Responses API
 * `input` array format, handling:
 * - Reasoning item replay from previous assistant thinking
 * - Function call/output conversion from tool calls/results
 * - SSE streaming of the response with event mapping
 *
 * @param model - Model with api: "openai-responses"
 * @param context - System prompt, messages, and tools
 * @param options - API key and other stream options
 * @returns AssistantMessageEventStream
 */
export function streamOpenAIResponses(
  model: Model<"openai-responses">,
  context: Context,
  options?: OpenAIResponsesOptions,
): AssistantMessageEventStream {
  const eventStream = createAssistantMessageEventStream();

  // Kick off the async streaming work
  (async () => {
    const state = createInitialState();

    try {
      // Build the request body
      const input = convertMessagesToInput(context.messages);

      // Add system prompt as the first message
      if (context.systemPrompt) {
        input.unshift({
          type: "message",
          role: "system",
          content: context.systemPrompt,
        });
      }

      const body: Record<string, unknown> = {
        model: model.id,
        input,
        stream: true,
      };

      // Add tools if present
      if (context.tools && context.tools.length > 0) {
        body.tools = convertTools(context.tools);
      }

      // Add optional parameters
      if (options?.maxTokens) {
        body.max_output_tokens = options.maxTokens;
      }
      if (options?.temperature !== undefined) {
        body.temperature = options.temperature;
      }

      // Determine the API URL
      const baseUrl = model.baseUrl || "https://api.openai.com/v1";
      const url = `${baseUrl}/responses`;

      // Resolve API key
      const apiKey = options?.apiKey || process.env.OPENAI_API_KEY || "";

      // Build headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
        ...(model.headers || {}),
        ...(options?.headers || {}),
      };

      // Fire onPayload callback if present
      options?.onPayload?.(body);

      // Emit start event
      eventStream.push({
        type: "start",
        partial: buildPartialMessage(state, model),
      });

      // Make the request
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI Responses API error (${response.status}): ${text}`);
      }

      if (!response.body) {
        throw new Error("No response body from OpenAI Responses API");
      }

      // Read the SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (double newline separated)
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;
          for (const sseEvent of parseSSE(part + "\n\n")) {
            processSSEEvent(sseEvent, state, model, eventStream);
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        for (const sseEvent of parseSSE(buffer)) {
          processSSEEvent(sseEvent, state, model, eventStream);
        }
      }

      // Close any open blocks
      if (state.thinkingStarted) {
        eventStream.push({
          type: "thinking_end",
          contentIndex: state.contentIndex,
          content: state.thinking,
          partial: buildPartialMessage(state, model),
        });
      }
      if (state.textStarted) {
        eventStream.push({
          type: "text_end",
          contentIndex: state.contentIndex,
          content: state.text,
          partial: buildPartialMessage(state, model),
        });
      }

      // Emit done
      const finalMessage = buildPartialMessage(state, model);
      eventStream.push({
        type: "done",
        reason: state.stopReason === "toolUse" ? "toolUse" : "stop",
        message: finalMessage,
      });
      eventStream.end(finalMessage);
    } catch (err) {
      // Build error message
      const errorMsg = buildPartialMessage(state, model);
      errorMsg.stopReason = "error";
      errorMsg.errorMessage = err instanceof Error ? err.message : String(err);

      eventStream.push({
        type: "error",
        reason: "error",
        error: errorMsg,
      });
      eventStream.end(errorMsg);
    }
  })();

  return eventStream;
}
