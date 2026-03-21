/**
 * Argent AI — Anthropic Provider
 *
 * Native Anthropic implementation using official SDK.
 * Supports streaming, tool calls, thinking, prompt caching, and OAuth token auth.
 *
 * Auth modes:
 *   - API key: Standard x-api-key header (apiKey config)
 *   - OAuth token: Bearer token auth (oauthToken config, e.g. Claude Code/Max subscriptions)
 *
 * Built for Argent Core - February 16, 2026
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  Provider,
  ModelConfig,
  TurnRequest,
  TurnResponse,
  StreamEvent,
  ToolCall,
  Usage,
} from "../types.js";

// ============================================================================
// Types
// ============================================================================

export interface AnthropicProviderConfig {
  /** API key for standard authentication (x-api-key header) */
  apiKey: string;
  /** OAuth token for Bearer auth (Claude Code / Max subscription users).
   *  When provided, overrides apiKey and uses Authorization: Bearer header instead. */
  oauthToken?: string;
  baseURL?: string;
  defaultModel?: string;
  cacheRetention?: "none" | "short" | "long";
}

export interface AnthropicModelOptions {
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
  thinkingBudget?: number;
  effort?: "low" | "medium" | "high" | "max";
  toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
}

// ============================================================================
// Constants
// ============================================================================

const BETA_FEATURES = ["fine-grained-tool-streaming-2025-05-14", "interleaved-thinking-2025-05-14"];

const DEFAULT_MAX_TOKENS = 8192;

// ============================================================================
// Provider Implementation
// ============================================================================

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private client: Anthropic;
  private config: AnthropicProviderConfig;

  constructor(config: AnthropicProviderConfig) {
    this.config = config;

    // Support both API key and OAuth token authentication
    const clientConfig: Record<string, unknown> = {
      baseURL: config.baseURL,
      defaultHeaders: {
        "anthropic-beta": BETA_FEATURES.join(","),
      },
    };

    if (config.oauthToken) {
      // OAuth token auth: use Bearer token via Authorization header
      // Used by Claude Code, Max subscription users, and third-party OAuth flows
      clientConfig.apiKey = "placeholder"; // SDK requires a non-empty value
      (clientConfig.defaultHeaders as Record<string, string>)["Authorization"] =
        `Bearer ${config.oauthToken}`;
      // Remove the default x-api-key header that the SDK would set
      (clientConfig.defaultHeaders as Record<string, string>)["x-api-key"] = "";
    } else {
      clientConfig.apiKey = config.apiKey;
    }

    this.client = new Anthropic(clientConfig as any);
  }

  /**
   * Execute a turn (non-streaming)
   */
  async execute(request: TurnRequest, modelConfig: ModelConfig): Promise<TurnResponse> {
    const messages = this.convertMessages(request.messages);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const params: Anthropic.MessageCreateParams = {
      model: modelConfig.id,
      messages,
      max_tokens: modelConfig.maxTokens || DEFAULT_MAX_TOKENS,
      ...(request.systemPrompt && { system: this.buildSystemPrompt(request.systemPrompt) }),
      ...(tools && { tools }),
      ...(modelConfig.temperature !== undefined && { temperature: modelConfig.temperature }),
    };

    // Add thinking configuration
    if (modelConfig.thinking) {
      if (this.supportsAdaptiveThinking(modelConfig.id) && modelConfig.effort) {
        params.thinking = {
          type: "enabled",
          budget_tokens: this.mapEffortToBudget(modelConfig.effort),
        };
      } else {
        params.thinking = {
          type: "enabled",
          budget_tokens: modelConfig.thinkingBudget || 1024,
        };
      }
    }

    const response = await this.client.messages.create(params);

    return this.convertResponse(response, modelConfig);
  }

  /**
   * Execute a turn with streaming
   */
  async *stream(request: TurnRequest, modelConfig: ModelConfig): AsyncGenerator<StreamEvent> {
    const messages = this.convertMessages(request.messages);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const params: Anthropic.MessageCreateParams = {
      model: modelConfig.id,
      messages,
      max_tokens: modelConfig.maxTokens || DEFAULT_MAX_TOKENS,
      ...(request.systemPrompt && { system: this.buildSystemPrompt(request.systemPrompt) }),
      ...(tools && { tools }),
      ...(modelConfig.temperature !== undefined && { temperature: modelConfig.temperature }),
      stream: true,
    };

    // Add thinking configuration
    if (modelConfig.thinking) {
      if (this.supportsAdaptiveThinking(modelConfig.id) && modelConfig.effort) {
        params.thinking = {
          type: "enabled",
          budget_tokens: this.mapEffortToBudget(modelConfig.effort),
        };
      } else {
        params.thinking = {
          type: "enabled",
          budget_tokens: modelConfig.thinkingBudget || 1024,
        };
      }
    }

    const stream = await this.client.messages.stream(params);

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

    // Track content blocks by index
    const contentBlocks: Array<{ type: string; index: number; data: any }> = [];

    try {
      for await (const event of stream) {
        if (event.type === "message_start") {
          // Capture initial usage
          partial.usage.inputTokens = event.message.usage.input_tokens;
          partial.usage.cacheReadTokens = event.message.usage.cache_read_input_tokens || 0;
          partial.usage.cacheWriteTokens = event.message.usage.cache_creation_input_tokens || 0;

          yield { type: "start", partial };
        } else if (event.type === "content_block_start") {
          const block = { type: event.content_block.type, index: event.index, data: {} };

          if (event.content_block.type === "text") {
            block.data = { text: "" };
            contentBlocks.push(block);
            yield { type: "text_start", partial };
          } else if (event.content_block.type === "thinking") {
            block.data = { thinking: "" };
            contentBlocks.push(block);
            yield { type: "thinking_start", partial };
          } else if (event.content_block.type === "tool_use") {
            block.data = {
              id: event.content_block.id,
              name: event.content_block.name,
              input: {},
              partialJson: "",
            };
            contentBlocks.push(block);
            yield { type: "tool_call_start", partial };
          }
        } else if (event.type === "content_block_delta") {
          const block = contentBlocks.find((b) => b.index === event.index);
          if (!block) continue;

          if (event.delta.type === "text_delta") {
            block.data.text += event.delta.text;
            partial.text += event.delta.text;
            yield { type: "text_delta", delta: event.delta.text, partial };
          } else if (event.delta.type === "thinking_delta") {
            block.data.thinking += event.delta.thinking;
            partial.thinking += event.delta.thinking;
            yield { type: "thinking_delta", delta: event.delta.thinking, partial };
          } else if (event.delta.type === "input_json_delta") {
            block.data.partialJson += event.delta.partial_json;
            try {
              block.data.input = JSON.parse(block.data.partialJson);
            } catch {
              // Incomplete JSON, will complete on block_stop
            }
            yield { type: "tool_call_delta", delta: event.delta.partial_json, partial };
          }
        } else if (event.type === "content_block_stop") {
          const block = contentBlocks.find((b) => b.index === event.index);
          if (!block) continue;

          if (block.type === "text") {
            yield { type: "text_end", text: block.data.text, partial };
          } else if (block.type === "thinking") {
            yield { type: "thinking_end", thinking: block.data.thinking, partial };
          } else if (block.type === "tool_use") {
            const toolCall: ToolCall = {
              type: "toolCall",
              id: block.data.id,
              name: block.data.name,
              arguments: normalizeToolCallInput(block.data.input),
            };
            partial.toolCalls.push(toolCall);
            yield { type: "tool_call_end", toolCall, partial };
          }
        } else if (event.type === "message_delta") {
          if (event.delta.stop_reason) {
            partial.stopReason = this.mapStopReason(event.delta.stop_reason);
          }

          // Update usage
          if (event.usage.output_tokens != null) {
            partial.usage.outputTokens = event.usage.output_tokens;
          }

          partial.usage.totalTokens =
            partial.usage.inputTokens +
            partial.usage.outputTokens +
            partial.usage.cacheReadTokens +
            partial.usage.cacheWriteTokens;
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

  private supportsAdaptiveThinking(modelId: string): boolean {
    return modelId.includes("opus-4-6") || modelId.includes("opus-4.6");
  }

  private mapEffortToBudget(effort: NonNullable<ModelConfig["effort"]>): number {
    switch (effort) {
      case "low":
        return 1024;
      case "medium":
        return 2048;
      case "high":
        return 4096;
      case "max":
        return 8192;
      default:
        return 2048;
    }
  }

  private buildSystemPrompt(text: string): Anthropic.Messages.TextBlockParam[] {
    const cacheControl = this.getCacheControl();

    return [
      {
        type: "text",
        text,
        ...(cacheControl && { cache_control: cacheControl }),
      },
    ];
  }

  private getCacheControl(): { type: "ephemeral"; ttl?: "1h" | "5m" } | undefined {
    const retention = this.config.cacheRetention || "short";

    if (retention === "none") {
      return undefined;
    }

    // Use 1h TTL for long retention on production API
    const ttl: "1h" | undefined = retention === "long" ? "1h" : undefined;

    return {
      type: "ephemeral",
      ...(ttl && { ttl }),
    };
  }

  private convertMessages(messages: TurnRequest["messages"]): Anthropic.Messages.MessageParam[] {
    return messages.map((msg) => {
      if (msg.role === "user") {
        return {
          role: "user",
          content: msg.content,
        };
      }

      if (msg.role === "assistant") {
        const content: Anthropic.Messages.ContentBlockParam[] = [];

        if (msg.text) {
          content.push({ type: "text", text: msg.text });
        }

        if (msg.toolCalls) {
          for (const toolCall of msg.toolCalls) {
            content.push({
              type: "tool_use",
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.arguments,
            });
          }
        }

        return {
          role: "assistant",
          content,
        };
      }

      if (msg.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId || "",
              content: msg.content,
            },
          ],
        };
      }

      throw new Error(`Unknown message role: ${(msg as any).role}`);
    });
  }

  private convertTools(tools: TurnRequest["tools"]): Anthropic.Messages.Tool[] {
    return tools!.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: normalizeToolInputSchema(tool.parameters),
    }));
  }

  private convertResponse(response: Anthropic.Message, modelConfig: ModelConfig): TurnResponse {
    let text = "";
    let thinking = "";
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "thinking") {
        thinking += block.thinking;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          type: "toolCall",
          id: block.id,
          name: block.name,
          arguments: normalizeToolCallInput(block.input),
        });
      }
    }

    return {
      text,
      thinking,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens || 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens || 0,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      stopReason: this.mapStopReason(response.stop_reason),
      provider: this.name,
      model: modelConfig.id,
    };
  }

  private mapStopReason(reason: string | null): TurnResponse["stopReason"] {
    switch (reason) {
      case "end_turn":
        return "stop";
      case "max_tokens":
        return "length";
      case "tool_use":
        return "tool_use";
      case "stop_sequence":
        return "stop";
      default:
        return "stop";
    }
  }
}

function normalizeToolInputSchema(
  schema: Record<string, unknown>,
): Anthropic.Messages.Tool.InputSchema {
  if (typeof schema.type === "string") {
    return schema as Anthropic.Messages.Tool.InputSchema;
  }
  return {
    type: "object",
    ...schema,
  } as Anthropic.Messages.Tool.InputSchema;
}

function normalizeToolCallInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

// ============================================================================
// Factory
// ============================================================================

export function createAnthropicProvider(config: AnthropicProviderConfig): AnthropicProvider {
  return new AnthropicProvider(config);
}
