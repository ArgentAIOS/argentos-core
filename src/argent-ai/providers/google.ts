/**
 * Argent AI — Google (Gemini) Provider
 *
 * Google Generative AI implementation using official SDK.
 * Supports streaming, tool calls (function calling), and usage tracking.
 *
 * Built for Argent Core - February 16, 2026
 */

import {
  GoogleGenerativeAI,
  type Content,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type GenerateContentResult,
  type Part,
} from "@google/generative-ai";
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

export interface GoogleProviderConfig {
  apiKey: string;
  defaultModel?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TOKENS = 8192;

// ============================================================================
// Provider Implementation
// ============================================================================

export class GoogleProvider implements Provider {
  readonly name = "google";
  private genAI: GoogleGenerativeAI;
  private config: GoogleProviderConfig;

  constructor(config: GoogleProviderConfig) {
    this.config = config;
    this.genAI = new GoogleGenerativeAI(config.apiKey);
  }

  /**
   * Execute a turn (non-streaming)
   */
  async execute(request: TurnRequest, modelConfig: ModelConfig): Promise<TurnResponse> {
    const model = this.genAI.getGenerativeModel({
      model: modelConfig.id,
      generationConfig: {
        maxOutputTokens: modelConfig.maxTokens || DEFAULT_MAX_TOKENS,
        ...(modelConfig.temperature !== undefined && { temperature: modelConfig.temperature }),
      },
      ...(request.systemPrompt && { systemInstruction: request.systemPrompt }),
      ...(request.tools &&
        request.tools.length > 0 && {
          tools: [{ functionDeclarations: this.convertTools(request.tools) }],
        }),
    });

    const contents = this.convertMessages(request.messages);
    const result: GenerateContentResult = await model.generateContent({ contents });
    return this.convertResponse(result, modelConfig);
  }

  /**
   * Execute a turn with streaming
   */
  async *stream(request: TurnRequest, modelConfig: ModelConfig): AsyncGenerator<StreamEvent> {
    const model = this.genAI.getGenerativeModel({
      model: modelConfig.id,
      generationConfig: {
        maxOutputTokens: modelConfig.maxTokens || DEFAULT_MAX_TOKENS,
        ...(modelConfig.temperature !== undefined && { temperature: modelConfig.temperature }),
      },
      ...(request.systemPrompt && { systemInstruction: request.systemPrompt }),
      ...(request.tools &&
        request.tools.length > 0 && {
          tools: [{ functionDeclarations: this.convertTools(request.tools) }],
        }),
    });

    const contents = this.convertMessages(request.messages);

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

    let textStarted = false;
    let toolCallIndex = 0;

    try {
      const result = await model.generateContentStream({ contents });

      yield { type: "start", partial };

      for await (const chunk of result.stream) {
        // Update usage from chunk metadata
        if (chunk.usageMetadata) {
          partial.usage.inputTokens = chunk.usageMetadata.promptTokenCount || 0;
          partial.usage.outputTokens = chunk.usageMetadata.candidatesTokenCount || 0;
          partial.usage.totalTokens = chunk.usageMetadata.totalTokenCount || 0;
        }

        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;

        // Map finish reason
        if (candidate.finishReason) {
          partial.stopReason = this.mapFinishReason(candidate.finishReason);
        }

        // Process content parts
        for (const part of candidate.content?.parts || []) {
          if (part.text !== undefined) {
            if (!textStarted) {
              textStarted = true;
              yield { type: "text_start", partial };
            }
            partial.text += part.text;
            yield { type: "text_delta", delta: part.text, partial };
          }

          if (part.functionCall) {
            const toolCall: ToolCall = {
              type: "toolCall",
              id: `call_${toolCallIndex++}`,
              name: part.functionCall.name,
              arguments: (part.functionCall.args as Record<string, unknown>) || {},
            };

            yield { type: "tool_call_start", partial };
            yield {
              type: "tool_call_delta",
              delta: JSON.stringify(toolCall.arguments),
              partial,
            };
            partial.toolCalls.push(toolCall);
            yield { type: "tool_call_end", toolCall, partial };
          }
        }
      }

      // Close text if open
      if (textStarted) {
        yield { type: "text_end", text: partial.text, partial };
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

  private convertMessages(messages: TurnRequest["messages"]): Content[] {
    const contents: Content[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        contents.push({
          role: "user",
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === "assistant") {
        const parts: Part[] = [];

        if (msg.text) {
          parts.push({ text: msg.text });
        }

        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            });
          }
        }

        if (parts.length > 0) {
          contents.push({ role: "model", parts });
        }
      } else if (msg.role === "tool") {
        // Tool results are function responses in Gemini
        contents.push({
          role: "function",
          parts: [
            {
              functionResponse: {
                name: msg.toolCallId || "unknown",
                response: { result: msg.content },
              },
            },
          ],
        });
      }
    }

    return contents;
  }

  private convertTools(tools: NonNullable<TurnRequest["tools"]>): FunctionDeclaration[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as FunctionDeclarationSchema,
    }));
  }

  private convertResponse(result: GenerateContentResult, modelConfig: ModelConfig): TurnResponse {
    const response = result.response;
    const candidate = response.candidates?.[0];
    let text = "";
    const toolCalls: ToolCall[] = [];
    let toolCallIndex = 0;

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text !== undefined) {
          text += part.text;
        }
        if (part.functionCall) {
          toolCalls.push({
            type: "toolCall",
            id: `call_${toolCallIndex++}`,
            name: part.functionCall.name,
            arguments: (part.functionCall.args as Record<string, unknown>) || {},
          });
        }
      }
    }

    return {
      text,
      toolCalls,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
      },
      stopReason: this.mapFinishReason(candidate?.finishReason),
      provider: this.name,
      model: modelConfig.id,
    };
  }

  private mapFinishReason(reason?: string): TurnResponse["stopReason"] {
    switch (reason) {
      case "STOP":
        return "stop";
      case "MAX_TOKENS":
        return "length";
      case "SAFETY":
        return "stop";
      case "RECITATION":
        return "stop";
      case "OTHER":
        return "stop";
      default:
        return "stop";
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createGoogleProvider(config: GoogleProviderConfig): GoogleProvider {
  return new GoogleProvider(config);
}
