/**
 * Argent AI — OpenAI Responses API Provider
 *
 * Native implementation of OpenAI's Responses API (the successor to Chat Completions).
 * Supports streaming, tool calls (function_call items), reasoning, and stateful conversations.
 *
 * Key differences from Chat Completions:
 *   - Uses `client.responses.create()` instead of `client.chat.completions.create()`
 *   - Input is `items` (typed output items) not `messages`
 *   - System prompt via `instructions` field
 *   - Reasoning as first-class output items with summaries
 *   - Stateful conversations via `previous_response_id`
 *   - Semantic streaming events (response.output_text.delta, etc.)
 *
 * Built for Argent Core — March 5, 2026
 */

import OpenAI from "openai";
import type {
  Provider,
  ModelConfig,
  TurnRequest,
  TurnResponse,
  StreamEvent,
  ToolCall,
} from "../types.js";

// ============================================================================
// Types
// ============================================================================

export interface OpenAIResponsesProviderConfig {
  apiKey: string;
  baseURL?: string;
  organization?: string;
  defaultModel?: string;
  /** Enable stateful conversation storage on OpenAI's side */
  store?: boolean;
  /** Include encrypted reasoning content for stateless workflows */
  includeEncryptedReasoning?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TOKENS = 8192;

// ============================================================================
// Provider Implementation
// ============================================================================

export class OpenAIResponsesProvider implements Provider {
  readonly name: string;
  private client: OpenAI;
  private config: OpenAIResponsesProviderConfig;

  constructor(config: OpenAIResponsesProviderConfig, providerName = "openai-responses") {
    this.name = providerName;
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      organization: config.organization,
    });
  }

  /**
   * Execute a turn (non-streaming) using the Responses API
   */
  async execute(request: TurnRequest, modelConfig: ModelConfig): Promise<TurnResponse> {
    const input = this.convertInput(request);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const params: Record<string, unknown> = {
      model: modelConfig.id,
      input,
      max_output_tokens: modelConfig.maxTokens || DEFAULT_MAX_TOKENS,
      store: this.config.store ?? false,
    };

    if (request.systemPrompt) {
      params.instructions = request.systemPrompt;
    }

    if (tools && tools.length > 0) {
      params.tools = tools;
    }

    if (modelConfig.temperature !== undefined) {
      params.temperature = modelConfig.temperature;
    }

    // Reasoning configuration
    if (modelConfig.thinking) {
      params.reasoning = {
        effort: modelConfig.effort ?? "medium",
      };

      if (this.config.includeEncryptedReasoning) {
        params.include = ["reasoning.encrypted_content"];
      }
    }

    const response = await (this.client.responses as any).create(params);
    return this.convertResponse(response, modelConfig);
  }

  /**
   * Execute a turn with streaming using the Responses API
   */
  async *stream(request: TurnRequest, modelConfig: ModelConfig): AsyncGenerator<StreamEvent> {
    const input = this.convertInput(request);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const params: Record<string, unknown> = {
      model: modelConfig.id,
      input,
      max_output_tokens: modelConfig.maxTokens || DEFAULT_MAX_TOKENS,
      stream: true,
      store: this.config.store ?? false,
    };

    if (request.systemPrompt) {
      params.instructions = request.systemPrompt;
    }

    if (tools && tools.length > 0) {
      params.tools = tools;
    }

    if (modelConfig.temperature !== undefined) {
      params.temperature = modelConfig.temperature;
    }

    // Reasoning configuration
    if (modelConfig.thinking) {
      params.reasoning = {
        effort: modelConfig.effort ?? "medium",
      };

      if (this.config.includeEncryptedReasoning) {
        params.include = ["reasoning.encrypted_content"];
      }
    }

    // Accumulate partial response
    const partial: TurnResponse = {
      text: "",
      thinking: "",
      toolCalls: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
      stopReason: "stop",
      provider: this.name,
      model: modelConfig.id,
    };

    // Track function calls by item ID
    const pendingFunctionCalls = new Map<
      string,
      { id: string; callId: string; name: string; argsJson: string }
    >();

    let textStarted = false;
    let thinkingStarted = false;

    try {
      const stream = await (this.client.responses as any).create(params);

      for await (const event of stream) {
        const eventType: string = event.type ?? "";

        // ── Response lifecycle events ──

        if (eventType === "response.created") {
          yield { type: "start", partial };
          continue;
        }

        if (eventType === "response.completed") {
          // Extract usage from the completed response
          const resp = event.response;
          if (resp?.usage) {
            partial.usage.inputTokens = resp.usage.input_tokens ?? 0;
            partial.usage.outputTokens = resp.usage.output_tokens ?? 0;
            partial.usage.totalTokens = resp.usage.total_tokens ?? 0;

            // Cache tokens from input_tokens_details
            if (resp.usage.input_tokens_details) {
              partial.usage.cacheReadTokens = resp.usage.input_tokens_details.cached_tokens ?? 0;
            }

            // Reasoning tokens from output_tokens_details
            if (resp.usage.output_tokens_details?.reasoning_tokens) {
              // Track reasoning tokens (not directly in our schema but informational)
            }
          }

          // Close any open blocks
          if (textStarted) {
            yield { type: "text_end", text: partial.text, partial };
            textStarted = false;
          }
          if (thinkingStarted) {
            yield { type: "thinking_end", thinking: partial.thinking!, partial };
            thinkingStarted = false;
          }

          // Emit any pending function calls
          for (const [, pending] of pendingFunctionCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(pending.argsJson);
            } catch {
              /* keep empty */
            }
            const toolCall: ToolCall = {
              type: "toolCall",
              id: pending.callId || pending.id,
              name: pending.name,
              arguments: args,
            };
            partial.toolCalls.push(toolCall);
            yield { type: "tool_call_end", toolCall, partial };
          }
          pendingFunctionCalls.clear();

          // Determine stop reason
          const status = resp?.status;
          if (status === "completed") {
            partial.stopReason = partial.toolCalls.length > 0 ? "tool_use" : "stop";
          } else if (status === "incomplete") {
            partial.stopReason = "length";
          } else if (status === "failed") {
            partial.stopReason = "error";
            partial.errorMessage = resp?.error?.message ?? "Response failed";
          }

          yield { type: "done", response: partial };
          continue;
        }

        if (eventType === "response.failed") {
          partial.stopReason = "error";
          partial.errorMessage = event.response?.error?.message ?? "Response failed";
          yield { type: "error", error: partial };
          continue;
        }

        // ── Text output events ──

        if (eventType === "response.output_text.delta") {
          if (thinkingStarted && partial.thinking) {
            thinkingStarted = false;
            yield { type: "thinking_end", thinking: partial.thinking!, partial };
          }
          if (!textStarted) {
            textStarted = true;
            yield { type: "text_start", partial };
          }
          const delta: string = event.delta ?? "";
          partial.text += delta;
          yield { type: "text_delta", delta, partial };
          continue;
        }

        if (eventType === "response.output_text.done") {
          if (textStarted) {
            yield { type: "text_end", text: partial.text, partial };
            textStarted = false;
          }
          continue;
        }

        // ── Reasoning events ──

        if (eventType === "response.reasoning_text.delta") {
          if (!thinkingStarted) {
            thinkingStarted = true;
            yield { type: "thinking_start", partial };
          }
          const delta: string = event.delta ?? "";
          partial.thinking += delta;
          yield { type: "thinking_delta", delta, partial };
          continue;
        }

        if (eventType === "response.reasoning_text.done") {
          if (thinkingStarted) {
            yield { type: "thinking_end", thinking: partial.thinking!, partial };
            thinkingStarted = false;
          }
          continue;
        }

        // Also handle reasoning summary events
        if (eventType === "response.reasoning_summary_text.delta") {
          // Reasoning summaries — treat as thinking content
          if (!thinkingStarted) {
            thinkingStarted = true;
            yield { type: "thinking_start", partial };
          }
          const delta: string = event.delta ?? "";
          partial.thinking += delta;
          yield { type: "thinking_delta", delta, partial };
          continue;
        }

        if (eventType === "response.reasoning_summary_text.done") {
          if (thinkingStarted) {
            yield { type: "thinking_end", thinking: partial.thinking!, partial };
            thinkingStarted = false;
          }
          continue;
        }

        // ── Function call events ──

        if (eventType === "response.output_item.added") {
          const item = event.item;
          if (item?.type === "function_call") {
            const itemId = item.id ?? `fc_${Date.now()}`;
            pendingFunctionCalls.set(itemId, {
              id: itemId,
              callId: item.call_id ?? itemId,
              name: item.name ?? "",
              argsJson: "",
            });
            yield { type: "tool_call_start", partial };
          }
          continue;
        }

        if (eventType === "response.function_call_arguments.delta") {
          const delta: string = event.delta ?? "";
          // Find the pending function call — use item_id if available
          const itemId = event.item_id ?? event.output_index;
          let pending: { id: string; callId: string; name: string; argsJson: string } | undefined;

          if (itemId && pendingFunctionCalls.has(itemId)) {
            pending = pendingFunctionCalls.get(itemId);
          } else {
            // Fallback: get the last pending one
            const entries = Array.from(pendingFunctionCalls.values());
            pending = entries[entries.length - 1];
          }

          if (pending) {
            pending.argsJson += delta;
            yield { type: "tool_call_delta", delta, partial };
          }
          continue;
        }

        if (eventType === "response.function_call_arguments.done") {
          const itemId = event.item_id ?? event.output_index;
          let pending: { id: string; callId: string; name: string; argsJson: string } | undefined;

          if (itemId && pendingFunctionCalls.has(itemId)) {
            pending = pendingFunctionCalls.get(itemId);
          } else {
            const entries = Array.from(pendingFunctionCalls.values());
            pending = entries[entries.length - 1];
          }

          if (pending) {
            // Override argsJson with the final full arguments if provided
            if (event.arguments) {
              pending.argsJson = event.arguments;
            }

            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(pending.argsJson);
            } catch {
              /* keep empty */
            }

            const toolCall: ToolCall = {
              type: "toolCall",
              id: pending.callId || pending.id,
              name: pending.name,
              arguments: args,
            };
            partial.toolCalls.push(toolCall);
            yield { type: "tool_call_end", toolCall, partial };

            pendingFunctionCalls.delete(pending.id);
          }
          continue;
        }

        // ── Output item done — can also carry function call data ──

        if (eventType === "response.output_item.done") {
          const item = event.item;
          if (item?.type === "function_call" && item.id) {
            // If we haven't processed this yet, do it now
            if (pendingFunctionCalls.has(item.id)) {
              const pending = pendingFunctionCalls.get(item.id)!;
              const finalArgs = item.arguments ?? pending.argsJson ?? "";

              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(finalArgs);
              } catch {
                /* keep empty */
              }

              const toolCall: ToolCall = {
                type: "toolCall",
                id: item.call_id ?? pending.callId ?? pending.id,
                name: item.name ?? pending.name,
                arguments: args,
              };
              partial.toolCalls.push(toolCall);
              yield { type: "tool_call_end", toolCall, partial };
              pendingFunctionCalls.delete(item.id);
            }
          }
          continue;
        }

        // Other event types (content_part_added, etc.) — skip silently
      }

      // Safety: if stream ended without response.completed, emit done
      if (partial.stopReason === "stop" && !textStarted && !thinkingStarted) {
        // Already emitted done in response.completed handler
      }
    } catch (error) {
      partial.stopReason = "error";
      partial.errorMessage = error instanceof Error ? error.message : String(error);
      yield { type: "error", error: partial };
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Convert TurnRequest messages to Responses API input items
   */
  private convertInput(request: TurnRequest): Array<Record<string, unknown>> {
    const items: Array<Record<string, unknown>> = [];

    for (const msg of request.messages) {
      if (msg.role === "user") {
        items.push({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: msg.content }],
        });
      } else if (msg.role === "assistant") {
        // Assistant messages with text
        if (msg.text) {
          items.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: msg.text }],
          });
        }

        // Tool calls become function_call items
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            items.push({
              type: "function_call",
              id: tc.id || `fc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              call_id: tc.id,
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            });
          }
        }
      } else if (msg.role === "tool") {
        // Tool results become function_call_output items
        items.push({
          type: "function_call_output",
          call_id: msg.toolCallId || "",
          output: msg.content,
        });
      }
    }

    return items;
  }

  /**
   * Convert tools to Responses API function tool format
   */
  private convertTools(tools: NonNullable<TurnRequest["tools"]>): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * Convert a non-streaming Responses API response to TurnResponse
   */
  private convertResponse(response: any, modelConfig: ModelConfig): TurnResponse {
    let text = "";
    let thinking = "";
    const toolCalls: ToolCall[] = [];

    // Extract from output items
    const output = response.output ?? [];
    for (const item of output) {
      if (item.type === "message") {
        for (const content of item.content ?? []) {
          if (content.type === "output_text") {
            text += content.text ?? "";
          }
        }
      } else if (item.type === "reasoning") {
        // Reasoning items may have summary
        for (const summaryPart of item.summary ?? []) {
          if (summaryPart.type === "summary_text" || summaryPart.type === "reasoning_text") {
            thinking += summaryPart.text ?? "";
          }
        }
      } else if (item.type === "function_call") {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(item.arguments ?? "{}");
        } catch {
          /* keep empty */
        }
        toolCalls.push({
          type: "toolCall",
          id: item.call_id ?? item.id,
          name: item.name ?? "",
          arguments: args,
        });
      }
    }

    // Also check output_text shortcut
    if (!text && response.output_text) {
      text = response.output_text;
    }

    // Usage
    const usage = response.usage ?? {};
    const inputDetails = usage.input_tokens_details ?? {};
    const outputDetails = usage.output_tokens_details ?? {};

    // Determine stop reason
    let stopReason: TurnResponse["stopReason"] = "stop";
    if (response.status === "incomplete") {
      stopReason = "length";
    } else if (response.status === "failed") {
      stopReason = "error";
    } else if (toolCalls.length > 0) {
      stopReason = "tool_use";
    }

    return {
      text,
      thinking,
      toolCalls,
      usage: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: inputDetails.cached_tokens ?? 0,
        cacheWriteTokens: 0,
        totalTokens: usage.total_tokens ?? 0,
      },
      stopReason,
      provider: this.name,
      model: modelConfig.id,
      ...(response.status === "failed" && {
        errorMessage: response.error?.message ?? "Response failed",
      }),
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createOpenAIResponsesProvider(
  config: OpenAIResponsesProviderConfig,
): OpenAIResponsesProvider {
  return new OpenAIResponsesProvider(config);
}

/**
 * Create an OpenAI Codex provider (uses Responses API with Codex models)
 */
export function createCodexProvider(
  config: Omit<OpenAIResponsesProviderConfig, "store"> & { store?: boolean },
): OpenAIResponsesProvider {
  return new OpenAIResponsesProvider({ ...config, store: config.store ?? true }, "openai-codex");
}
