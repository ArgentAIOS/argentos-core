/**
 * Argent AI — OpenAI Provider
 *
 * OpenAI-compatible implementation using official SDK.
 * Supports streaming, tool calls, reasoning (o-series), and usage tracking.
 *
 * Built for Argent Core - February 16, 2026
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

export interface OpenAIProviderConfig {
  apiKey: string;
  baseURL?: string;
  organization?: string;
  defaultModel?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TOKENS = 8192;

// ============================================================================
// Provider Implementation
// ============================================================================

export class OpenAIProvider implements Provider {
  readonly name: string;
  private client: OpenAI;
  private config: OpenAIProviderConfig;

  constructor(config: OpenAIProviderConfig, providerName = "openai") {
    this.name = providerName;
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      organization: config.organization,
    });
  }

  /**
   * Execute a turn (non-streaming)
   */
  async execute(request: TurnRequest, modelConfig: ModelConfig): Promise<TurnResponse> {
    const messages = this.convertMessages(request);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const params: OpenAI.Chat.ChatCompletionCreateParams = {
      model: modelConfig.id,
      messages,
      max_tokens: modelConfig.maxTokens || DEFAULT_MAX_TOKENS,
      ...(tools && tools.length > 0 && { tools }),
      ...(modelConfig.temperature !== undefined && { temperature: modelConfig.temperature }),
    };

    // Add reasoning effort for o-series models
    if (modelConfig.thinking && modelConfig.effort) {
      (params as unknown as Record<string, unknown>).reasoning_effort = modelConfig.effort;
    }

    const response = await this.client.chat.completions.create(params);
    return this.convertResponse(response, modelConfig);
  }

  /**
   * Execute a turn with streaming
   */
  async *stream(request: TurnRequest, modelConfig: ModelConfig): AsyncGenerator<StreamEvent> {
    const messages = this.convertMessages(request);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const params: OpenAI.Chat.ChatCompletionCreateParams = {
      model: modelConfig.id,
      messages,
      max_tokens: modelConfig.maxTokens || DEFAULT_MAX_TOKENS,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools && tools.length > 0 && { tools }),
      ...(modelConfig.temperature !== undefined && { temperature: modelConfig.temperature }),
    };

    // Add reasoning effort for o-series models
    if (modelConfig.thinking && modelConfig.effort) {
      (params as unknown as Record<string, unknown>).reasoning_effort = modelConfig.effort;
    }

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

    // Track tool calls by index
    const pendingToolCalls = new Map<number, { id: string; name: string; argsJson: string }>();

    let textStarted = false;
    let thinkingStarted = false;

    try {
      const stream = await this.client.chat.completions.create(params);

      yield { type: "start", partial };

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];

        // Usage comes in the final chunk (choices may be empty)
        if (chunk.usage) {
          partial.usage.inputTokens = chunk.usage.prompt_tokens;
          partial.usage.outputTokens = chunk.usage.completion_tokens;
          const usageDetails = (
            chunk.usage as unknown as {
              prompt_tokens_details?: { cached_tokens?: number };
            }
          ).prompt_tokens_details;
          partial.usage.cacheReadTokens = usageDetails?.cached_tokens ?? 0;
          partial.usage.cacheWriteTokens = 0;
          partial.usage.totalTokens = chunk.usage.total_tokens;
        }

        if (!choice) continue;

        const delta = choice.delta;

        // Handle finish reason
        if (choice.finish_reason) {
          partial.stopReason = this.mapStopReason(choice.finish_reason);
        }

        // Handle reasoning/thinking content (o-series models)
        if (
          delta &&
          "reasoning_content" in delta &&
          (delta as Record<string, unknown>).reasoning_content
        ) {
          const thinkingDelta = (delta as Record<string, unknown>).reasoning_content as string;
          if (!thinkingStarted) {
            thinkingStarted = true;
            yield { type: "thinking_start", partial };
          }
          partial.thinking += thinkingDelta;
          yield { type: "thinking_delta", delta: thinkingDelta, partial };
        }

        // Handle text content
        if (delta?.content) {
          if (thinkingStarted && partial.thinking) {
            thinkingStarted = false;
            yield { type: "thinking_end", thinking: partial.thinking!, partial };
          }
          if (!textStarted) {
            textStarted = true;
            yield { type: "text_start", partial };
          }
          partial.text += delta.content;
          yield { type: "text_delta", delta: delta.content, partial };
        }

        // Handle tool calls
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;

            if (tc.id) {
              // Tool call start
              pendingToolCalls.set(idx, {
                id: tc.id,
                name: tc.function?.name || "",
                argsJson: tc.function?.arguments || "",
              });
              yield { type: "tool_call_start", partial };
            } else {
              // Tool call delta
              const pending = pendingToolCalls.get(idx);
              if (pending) {
                if (tc.function?.name) pending.name += tc.function.name;
                if (tc.function?.arguments) {
                  pending.argsJson += tc.function.arguments;
                  yield { type: "tool_call_delta", delta: tc.function.arguments, partial };
                }
              }
            }
          }
        }

        // When finished, close open blocks and emit tool_call_end
        if (choice.finish_reason) {
          if (textStarted) {
            yield { type: "text_end", text: partial.text, partial };
            textStarted = false;
          }
          if (thinkingStarted) {
            yield { type: "thinking_end", thinking: partial.thinking!, partial };
            thinkingStarted = false;
          }

          for (const [, pending] of pendingToolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(pending.argsJson);
            } catch {
              // Keep empty if invalid JSON
            }
            const toolCall: ToolCall = {
              type: "toolCall",
              id: pending.id,
              name: pending.name,
              arguments: args,
            };
            partial.toolCalls.push(toolCall);
            yield { type: "tool_call_end", toolCall, partial };
          }
          pendingToolCalls.clear();
        }
      }

      yield { type: "done", response: partial };
    } catch (error) {
      partial.stopReason = "error";
      partial.errorMessage = error instanceof Error ? error.message : String(error);
      yield { type: "error", error: partial };
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private convertMessages(request: TurnRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (request.systemPrompt) {
      result.push({ role: "system", content: request.systemPrompt });
    }

    for (const msg of request.messages) {
      if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
          role: "assistant",
        };

        if (msg.text) {
          assistantMsg.content = msg.text;
        }

        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }

        result.push(assistantMsg);
      } else if (msg.role === "tool") {
        result.push({
          role: "tool",
          tool_call_id: msg.toolCallId || "",
          content: msg.content,
        });
      }
    }

    return result;
  }

  private convertTools(tools: NonNullable<TurnRequest["tools"]>): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as OpenAI.FunctionParameters,
      },
    }));
  }

  private convertResponse(
    response: OpenAI.Chat.ChatCompletion,
    modelConfig: ModelConfig,
  ): TurnResponse {
    const choice = response.choices[0];
    const toolCalls: ToolCall[] = [];

    if (choice?.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        if (tc.type !== "function") {
          continue;
        }
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          // Keep empty
        }
        toolCalls.push({
          type: "toolCall",
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        });
      }
    }

    return {
      text: choice?.message.content || "",
      thinking:
        ((choice?.message as unknown as { reasoning_content?: string } | undefined)
          ?.reasoning_content as string | undefined) || "",
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        cacheReadTokens:
          (
            (response.usage as unknown as { prompt_tokens_details?: { cached_tokens?: number } }) ??
            {}
          ).prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      stopReason: this.mapStopReason(choice?.finish_reason || "stop"),
      provider: this.name,
      model: modelConfig.id,
    };
  }

  private mapStopReason(reason: string): TurnResponse["stopReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "tool_calls":
        return "tool_use";
      case "content_filter":
        return "stop";
      default:
        return "stop";
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createOpenAIProvider(config: OpenAIProviderConfig): OpenAIProvider {
  return new OpenAIProvider(config);
}
