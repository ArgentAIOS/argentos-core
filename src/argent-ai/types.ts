/**
 * Argent AI Core Types
 *
 * This module defines the core types for the ArgentOS LLM abstraction layer.
 * These types are designed to be drop-in compatible with pi-ai while enabling
 * ArgentOS-specific features like PostgreSQL state and Redis events.
 *
 * @module argent-ai/types
 */

import type { TSchema, Static } from "@sinclair/typebox";

// Re-export TypeBox for downstream consumers
export type { TSchema, Static } from "@sinclair/typebox";
export { Type } from "@sinclair/typebox";

// ============================================================================
// PROVIDERS
// ============================================================================

/**
 * Known LLM providers with built-in support.
 */
export type KnownProvider =
  | "anthropic"
  | "openai"
  | "openai-codex"
  | "azure-openai"
  | "google"
  | "google-vertex"
  | "google-gemini-cli"
  | "amazon-bedrock"
  | "github-copilot"
  | "groq"
  | "cerebras"
  | "xai"
  | "mistral"
  | "minimax"
  | "openrouter"
  | "vercel-ai-gateway"
  | "nvidia";

/**
 * Provider identifier. Can be a known provider or any custom string.
 */
export type ProviderName = KnownProvider | (string & {});

/**
 * Known API protocols.
 */
export type KnownApi =
  | "anthropic-messages"
  | "openai-completions"
  | "openai-responses"
  | "azure-openai-responses"
  | "google-generative-ai"
  | "google-vertex"
  | "google-gemini-cli"
  | "bedrock-converse-stream";

/**
 * API protocol identifier. Can be a known API or any custom string.
 */
export type Api = KnownApi | (string & {});

// ============================================================================
// MODEL
// ============================================================================

/**
 * Model cost structure (per million tokens).
 */
export interface ModelCost {
  /** Cost per million input tokens */
  input: number;
  /** Cost per million output tokens */
  output: number;
  /** Cost per million cached input tokens read */
  cacheRead: number;
  /** Cost per million cached input tokens written */
  cacheWrite: number;
}

/**
 * Model definition with capabilities and pricing.
 */
export interface Model<TApi extends Api = Api> {
  /** Unique model identifier (e.g., "claude-sonnet-4-20250514") */
  id: string;
  /** Human-readable model name */
  name: string;
  /** API protocol this model uses */
  api: TApi;
  /** Provider that serves this model */
  provider: ProviderName;
  /** Base URL for API requests */
  baseUrl: string;
  /** Whether the model supports reasoning/thinking */
  reasoning: boolean;
  /** Supported input modalities */
  input: ("text" | "image")[];
  /** Token pricing */
  cost: ModelCost;
  /** Maximum context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxTokens: number;
  /** Custom headers to include in requests */
  headers?: Record<string, string>;
}

// ============================================================================
// CONTENT BLOCKS
// ============================================================================

/**
 * Text content block.
 */
export interface TextContent {
  type: "text";
  /** The text content */
  text: string;
  /** Optional signature for caching/verification */
  textSignature?: string;
}

/**
 * Thinking/reasoning content block (extended thinking).
 */
export interface ThinkingContent {
  type: "thinking";
  /** The thinking content */
  thinking: string;
  /** Signature for thought continuity (provider-specific) */
  thinkingSignature?: string;
}

/**
 * Image content block.
 */
export interface ImageContent {
  type: "image";
  /** Base64-encoded image data */
  data: string;
  /** MIME type (e.g., "image/jpeg", "image/png") */
  mimeType: string;
}

/**
 * Tool call content block.
 */
export interface ToolCall {
  type: "toolCall";
  /** Unique identifier for this tool call */
  id: string;
  /** Name of the tool being called */
  name: string;
  /** Arguments passed to the tool */
  arguments: Record<string, unknown>;
  /** Provider-specific signature for thought context */
  thoughtSignature?: string;
}

// ============================================================================
// USAGE & STOP REASON
// ============================================================================

/**
 * Token usage and cost breakdown.
 */
export interface Usage {
  /** Input tokens consumed */
  input: number;
  /** Output tokens generated */
  output: number;
  /** Cached input tokens read */
  cacheRead: number;
  /** Cached input tokens written */
  cacheWrite: number;
  /** Total tokens (input + output + cache) */
  totalTokens: number;
  /** Cost breakdown */
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

/**
 * Reason the model stopped generating.
 */
export type StopReason =
  | "stop" // Natural end of response
  | "length" // Hit max tokens
  | "toolUse" // Stopped to call tools
  | "error" // Error occurred
  | "aborted"; // Request was aborted

// ============================================================================
// MESSAGES
// ============================================================================

/**
 * User message.
 */
export interface UserMessage {
  role: "user";
  /** Text string or array of content blocks */
  content: string | (TextContent | ImageContent)[];
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/**
 * Assistant message.
 */
export interface AssistantMessage {
  role: "assistant";
  /** Content blocks (text, thinking, tool calls) */
  content: (TextContent | ThinkingContent | ToolCall)[];
  /** API protocol used */
  api: Api;
  /** Provider that generated this message */
  provider: ProviderName;
  /** Model ID that generated this message */
  model: string;
  /** Token usage statistics */
  usage: Usage;
  /** Why the model stopped */
  stopReason: StopReason;
  /** Error message if stopReason is "error" */
  errorMessage?: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/**
 * Tool result message.
 */
export interface ToolResultMessage<TDetails = unknown> {
  role: "toolResult";
  /** ID of the tool call this is responding to */
  toolCallId: string;
  /** Name of the tool that was called */
  toolName: string;
  /** Result content (text and/or images) */
  content: (TextContent | ImageContent)[];
  /** Additional details for logging/display */
  details?: TDetails;
  /** Whether the tool execution failed */
  isError: boolean;
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/**
 * Any message type.
 */
export type Message = UserMessage | AssistantMessage | ToolResultMessage;

// ============================================================================
// TOOLS
// ============================================================================

/**
 * Tool definition with TypeBox parameter schema.
 */
export interface Tool<TParameters extends TSchema = TSchema> {
  /** Tool name (used in function calls) */
  name: string;
  /** Human-readable description for the model */
  description: string;
  /** TypeBox schema defining parameters */
  parameters: TParameters;
}

// ============================================================================
// CONTEXT
// ============================================================================

/**
 * Conversation context for LLM requests.
 */
export interface Context {
  /** System prompt (instructions for the model) */
  systemPrompt?: string;
  /** Conversation history */
  messages: Message[];
  /** Available tools */
  tools?: Tool[];
}

// ============================================================================
// OPTIONS
// ============================================================================

/**
 * Thinking/reasoning level.
 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Token budgets for each thinking level.
 */
export interface ThinkingBudgets {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
  xhigh?: number;
}

/**
 * Cache retention preference.
 */
export type CacheRetention = "none" | "short" | "long";

/**
 * Transport preference.
 */
export type Transport = "sse" | "websocket" | "auto";

/**
 * Base streaming options.
 */
export interface StreamOptions {
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** API key override */
  apiKey?: string;
  /** Preferred transport protocol */
  transport?: Transport;
  /** Cache retention preference */
  cacheRetention?: CacheRetention;
  /** Session ID for provider caching */
  sessionId?: string;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Max delay for server-requested retries */
  maxRetryDelayMs?: number;
  /** Metadata for providers (e.g., user_id) */
  metadata?: Record<string, unknown>;
  /** Callback to inspect request payload */
  onPayload?: (payload: unknown) => void;
}

/**
 * Simple streaming options with reasoning support.
 */
export interface SimpleStreamOptions extends StreamOptions {
  /** Thinking/reasoning level */
  reasoning?: ThinkingLevel;
  /** Custom token budgets for thinking levels */
  thinkingBudgets?: ThinkingBudgets;
}

/**
 * OpenAI Chat Completions API options.
 * Extends StreamOptions with OpenAI-specific parameters.
 */
export interface OpenAICompletionsOptions extends StreamOptions {
  /** Tool choice strategy: "auto", "none", "required", or specific tool name */
  toolChoice?: "auto" | "none" | "required" | string;
}

// ============================================================================
// EVENTS
// ============================================================================

/**
 * Events emitted during assistant message streaming.
 */
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | {
      type: "done";
      reason: Extract<StopReason, "stop" | "length" | "toolUse">;
      message: AssistantMessage;
    }
  | { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };

// ============================================================================
// STREAM INTERFACE
// ============================================================================

/**
 * Async iterator that yields assistant message events.
 * Call result() to get the final message after iteration.
 */
export interface AssistantMessageEventStream extends AsyncIterable<AssistantMessageEvent> {
  /**
   * Get the final assistant message after streaming completes.
   * Must be called after iterating through all events.
   */
  result(): Promise<AssistantMessage>;
}

// ============================================================================
// STREAM FUNCTION
// ============================================================================

/**
 * Function signature for streaming LLM responses.
 */
export type StreamFunction<
  TApi extends Api = Api,
  TOptions extends StreamOptions = StreamOptions,
> = (model: Model<TApi>, context: Context, options?: TOptions) => AssistantMessageEventStream;

// ============================================================================
// PROVIDER INTERFACE (Simplified for argent-ai providers)
// ============================================================================

/**
 * Model configuration for a turn
 */
export interface ModelConfig {
  id: string;
  maxTokens?: number;
  temperature?: number;
  thinking?: boolean;
  thinkingBudget?: number;
  effort?: "low" | "medium" | "high" | "max";
}

/**
 * Turn request from agent to provider
 */
export interface TurnRequest {
  systemPrompt?: string;
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
    text?: string;
  }>;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

/**
 * Turn response from provider
 */
export interface TurnResponse {
  text: string;
  thinking?: string;
  toolCalls: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
  };
  stopReason: "stop" | "length" | "tool_use" | "error";
  provider: string;
  model: string;
  errorMessage?: string;
}

/**
 * Streaming events
 */
export type StreamEvent =
  | { type: "start"; partial: TurnResponse }
  | { type: "text_start"; partial: TurnResponse }
  | { type: "text_delta"; delta: string; partial: TurnResponse }
  | { type: "text_end"; text: string; partial: TurnResponse }
  | { type: "thinking_start"; partial: TurnResponse }
  | { type: "thinking_delta"; delta: string; partial: TurnResponse }
  | { type: "thinking_end"; thinking: string; partial: TurnResponse }
  | { type: "tool_call_start"; partial: TurnResponse }
  | { type: "tool_call_delta"; delta: string; partial: TurnResponse }
  | { type: "tool_call_end"; toolCall: ToolCall; partial: TurnResponse }
  | { type: "done"; response: TurnResponse }
  | { type: "error"; error: TurnResponse };

/**
 * Provider interface (simplified)
 */
export interface Provider {
  readonly name: string;
  execute(request: TurnRequest, modelConfig: ModelConfig): Promise<TurnResponse>;
  stream(request: TurnRequest, modelConfig: ModelConfig): AsyncGenerator<StreamEvent>;
}

// ============================================================================
// ARGENT SPECIFIC TYPES (Public API Surface)
// ============================================================================

/**
 * ArgentModel - The primary model type for ArgentOS LLM operations.
 * This is the main entry point for model selection in ArgentOS.
 *
 * Extends the base Model type with Argent-specific defaults and metadata.
 */
export type ArgentModel = Model;

/**
 * ArgentContext - Conversation context tailored for ArgentOS agents.
 * Includes additional fields for SIS (Self-Improving System) integration,
 * memory context, and agent-specific metadata.
 */
export interface ArgentContext extends Context {
  /** Optional session ID for conversation continuity */
  sessionId?: string;
  /** Agent identifier for multi-agent coordination */
  agentId?: string;
  /** Family ID for family-aware context */
  familyId?: string;
  /** Whether to enable SIS lesson injection */
  enableLessons?: boolean;
  /** Custom metadata for agent-specific use */
  metadata?: Record<string, unknown>;
}

/**
 * ArgentStreamOptions - Streaming options for ArgentOS agent operations.
 * Includes Argent-specific features like thinking budgets, visual presence control,
 * and event routing.
 */
export interface ArgentStreamOptions extends SimpleStreamOptions {
  /** Enable visual presence updates during streaming */
  enableVisualPresence?: boolean;
  /** Callback for visual presence events */
  onVisualPresence?: (event: VisualPresenceEvent) => void;
  /** Agent session key for event routing */
  sessionKey?: string;
  /** Whether to emit agent lifecycle events */
  emitLifecycleEvents?: boolean;
  /** Custom thinking budget override for this specific call */
  thinkingBudget?: number;
  /** Priority level for queue management */
  priority?: "low" | "normal" | "high" | "urgent";
}

/**
 * Visual presence events for avatar/orb control
 */
export type VisualPresenceEvent =
  | { type: "gesture"; gesture: string; intensity?: number }
  | { type: "mood"; mood: string }
  | { type: "formation"; text: string; duration?: number }
  | { type: "symbol"; symbol: string };

/**
 * Argent-specific events for agent lifecycle and coordination
 */
export type ArgentAgentEvent =
  | { type: "agent:start"; agentId: string; sessionKey: string }
  | { type: "agent:turn_start"; agentId: string; turnIndex: number }
  | { type: "agent:turn_complete"; agentId: string; turnIndex: number; success: boolean }
  | { type: "agent:error"; agentId: string; error: string }
  | { type: "agent:stop"; agentId: string; reason?: string }
  | { type: "lesson:inject"; lessonId: string; confidence: number; triggered: boolean }
  | { type: "lesson:applied"; lessonId: string; success: boolean; feedback?: string }
  | { type: "memory:recall"; query: string; resultsCount: number }
  | { type: "memory:store"; key: string; significance: string };

/**
 * Complete event union for ArgentOS streaming
 */
export type ArgentEvent = AssistantMessageEvent | ArgentAgentEvent | VisualPresenceEvent;

/**
 * Stream that emits Argent-specific events including agent lifecycle
 */
export interface ArgentEventStream extends AsyncIterable<ArgentEvent> {
  /**
   * Get the final assistant message after streaming completes.
   */
  result(): Promise<AssistantMessage>;

  /**
   * Get all agent events that occurred during the stream.
   */
  agentEvents(): Promise<ArgentAgentEvent[]>;
}
