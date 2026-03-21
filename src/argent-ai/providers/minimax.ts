/**
 * Argent AI — MiniMax Provider
 *
 * Native fetch-based SSE implementation for MiniMax API.
 * Supports streaming, tool calls, and usage tracking.
 *
 * Built for Argent Core - February 16, 2026
 */

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

export interface MiniMaxProviderConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

interface MiniMaxMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface MiniMaxTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface MiniMaxStreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: "function";
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
}

interface MiniMaxStreamChunk {
  id: string;
  object: string;
  choices: MiniMaxStreamChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface MiniMaxNonStreamChoice {
  index: number;
  message: {
    role: string;
    content?: string;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: string;
}

interface MiniMaxNonStreamResponse {
  id: string;
  object: string;
  choices: MiniMaxNonStreamChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BASE_URL = "https://api.minimax.chat/v1/text/chatcompletion_v2";
const DEFAULT_MAX_TOKENS = 8192;

// ============================================================================
// Provider Implementation
// ============================================================================

export class MiniMaxProvider implements Provider {
  readonly name = "minimax";
  private config: MiniMaxProviderConfig;

  constructor(config: MiniMaxProviderConfig) {
    this.config = config;
  }

  /**
   * Execute a turn (non-streaming)
   */
  async execute(request: TurnRequest, modelConfig: ModelConfig): Promise<TurnResponse> {
    const body = this.buildRequestBody(request, modelConfig, false);
    const response = await fetch(this.getBaseURL(), {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as MiniMaxNonStreamResponse;
    return this.convertNonStreamResponse(data, modelConfig);
  }

  /**
   * Execute a turn with streaming
   */
  async *stream(request: TurnRequest, modelConfig: ModelConfig): AsyncGenerator<StreamEvent> {
    const body = this.buildRequestBody(request, modelConfig, true);

    const partial: TurnResponse = {
      text: "",
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

    const pendingToolCalls = new Map<number, { id: string; name: string; argsJson: string }>();
    let textStarted = false;

    try {
      const response = await fetch(this.getBaseURL(), {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`MiniMax API error ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error("No response body for streaming");
      }

      yield { type: "start", partial };

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;

          let chunk: MiniMaxStreamChunk;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }

          // Update usage
          if (chunk.usage) {
            partial.usage.inputTokens = chunk.usage.prompt_tokens;
            partial.usage.outputTokens = chunk.usage.completion_tokens;
            partial.usage.totalTokens = chunk.usage.total_tokens;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          // Handle finish reason
          if (choice.finish_reason) {
            partial.stopReason = this.mapStopReason(choice.finish_reason);
          }

          // Handle text content
          if (choice.delta.content) {
            if (!textStarted) {
              textStarted = true;
              yield { type: "text_start", partial };
            }
            partial.text += choice.delta.content;
            yield { type: "text_delta", delta: choice.delta.content, partial };
          }

          // Handle tool calls
          if (choice.delta.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              const idx = tc.index;

              if (tc.id) {
                pendingToolCalls.set(idx, {
                  id: tc.id,
                  name: tc.function?.name || "",
                  argsJson: tc.function?.arguments || "",
                });
                yield { type: "tool_call_start", partial };
              } else {
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

          // Finalize on finish
          if (choice.finish_reason) {
            if (textStarted) {
              yield { type: "text_end", text: partial.text, partial };
              textStarted = false;
            }

            for (const [, pending] of pendingToolCalls) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(pending.argsJson);
              } catch {
                // Keep empty
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

  private getBaseURL(): string {
    return this.config.baseURL || DEFAULT_BASE_URL;
  }

  private getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  private buildRequestBody(
    request: TurnRequest,
    modelConfig: ModelConfig,
    stream: boolean,
  ): Record<string, unknown> {
    const messages = this.convertMessages(request);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    return {
      model: modelConfig.id,
      messages,
      max_tokens: modelConfig.maxTokens || DEFAULT_MAX_TOKENS,
      stream,
      ...(stream && { stream_options: { include_usage: true } }),
      ...(tools && tools.length > 0 && { tools }),
      ...(modelConfig.temperature !== undefined && { temperature: modelConfig.temperature }),
    };
  }

  private convertMessages(request: TurnRequest): MiniMaxMessage[] {
    const result: MiniMaxMessage[] = [];

    if (request.systemPrompt) {
      result.push({ role: "system", content: request.systemPrompt });
    }

    for (const msg of request.messages) {
      if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        const assistantMsg: MiniMaxMessage = { role: "assistant" };

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
          content: msg.content,
          tool_call_id: msg.toolCallId || "",
        });
      }
    }

    return result;
  }

  private convertTools(tools: NonNullable<TurnRequest["tools"]>): MiniMaxTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private convertNonStreamResponse(
    data: MiniMaxNonStreamResponse,
    modelConfig: ModelConfig,
  ): TurnResponse {
    const choice = data.choices?.[0];
    const toolCalls: ToolCall[] = [];

    if (choice?.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
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
      toolCalls,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: data.usage?.total_tokens || 0,
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
      default:
        return "stop";
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createMiniMaxProvider(config: MiniMaxProviderConfig): MiniMaxProvider {
  return new MiniMaxProvider(config);
}
