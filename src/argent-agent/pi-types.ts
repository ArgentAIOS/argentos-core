/**
 * Argent Agent — Pi-Compatible Agent Core Types
 *
 * These types match the exact shapes exported by the legacy upstream agent core.
 * They enable consuming code to import from agent-core/ and get Argent-native
 * types without changing any import paths.
 *
 * Reference: legacy upstream dist type declarations.
 *
 * @module argent-agent/pi-types
 */

import type { Static, TSchema } from "@sinclair/typebox";
import type {
  AssistantMessageEvent,
  AssistantMessageEventStream,
  ImageContent,
  Message,
  Model,
  Api,
  SimpleStreamOptions,
  TextContent,
  Tool,
  ToolResultMessage,
} from "../argent-ai/types.js";

// ============================================================================
// STREAM FUNCTION
// ============================================================================

/**
 * Stream function type — can return sync or Promise for async config lookup.
 * Matches Pi's StreamFn exactly.
 */
export type StreamFn = (
  model: Model<Api>,
  context: import("../argent-ai/types.js").Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

// ============================================================================
// THINKING LEVEL
// ============================================================================

/**
 * Thinking/reasoning level for models that support it.
 * Pi's version includes "off" which Argent's argent-ai ThinkingLevel lacks.
 */
export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

// ============================================================================
// CUSTOM AGENT MESSAGES
// ============================================================================

/**
 * Extensible interface for custom app messages.
 * Apps can extend via declaration merging:
 *
 * @example
 * ```typescript
 * declare module "../argent-agent/pi-types.js" {
 *   interface CustomAgentMessages {
 *     artifact: ArtifactMessage;
 *     notification: NotificationMessage;
 *   }
 * }
 * ```
 */
export interface CustomAgentMessages {}

/**
 * AgentMessage: Union of LLM messages + custom messages.
 * This abstraction allows apps to add custom message types while maintaining
 * type safety and compatibility with the base LLM messages.
 */
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

// ============================================================================
// TOOL TYPES
// ============================================================================

/**
 * Result from an agent tool execution.
 * Contains content blocks and tool-specific details.
 */
export interface AgentToolResult<T = unknown> {
  /** Content blocks returned by the tool */
  content: (TextContent | ImageContent)[];
  /** Tool-specific details for logging/display */
  details: T;
}

/**
 * Callback for tool progress updates during execution.
 */
export type AgentToolUpdateCallback<T = unknown> = (partialResult: AgentToolResult<T>) => void;

/**
 * Agent tool definition with execution capability.
 * Extends the base Tool with a label and execute function.
 *
 * Used by 104 files in the codebase — this is THE tool interface.
 */
export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
> extends Tool<TParameters> {
  /** Human-readable label for UI display */
  label: string;
  /** Execute the tool with given parameters */
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}

// ============================================================================
// AGENT STATE
// ============================================================================

/**
 * Agent state containing all configuration and conversation data.
 */
export interface AgentState {
  systemPrompt: string;
  model: Model<Api>;
  thinkingLevel: AgentThinkingLevel;
  tools: AgentTool<TSchema, unknown>[];
  messages: AgentMessage[];
  isStreaming: boolean;
  streamMessage: AgentMessage | null;
  pendingToolCalls: Set<string>;
  error?: string;
}

// ============================================================================
// AGENT CONTEXT
// ============================================================================

/**
 * Agent context for a conversation.
 */
export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: AgentTool<TSchema, unknown>[];
}

// ============================================================================
// AGENT EVENTS
// ============================================================================

/**
 * Events emitted by the Agent for UI updates.
 * These events provide fine-grained lifecycle information for
 * messages, turns, and tool executions.
 *
 * Used by 58 files in the codebase.
 */
export type PiAgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    };

// ============================================================================
// AGENT LOOP CONFIG
// ============================================================================

/**
 * Configuration for the agent loop.
 */
export interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<Api>;

  /**
   * Converts AgentMessage[] to LLM-compatible Message[] before each LLM call.
   */
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  /**
   * Optional transform applied to the context before convertToLlm.
   */
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

  /**
   * Resolves an API key dynamically for each LLM call.
   */
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

  /**
   * Returns steering messages to inject mid-run.
   */
  getSteeringMessages?: () => Promise<AgentMessage[]>;

  /**
   * Returns follow-up messages after agent would otherwise stop.
   */
  getFollowUpMessages?: () => Promise<AgentMessage[]>;
}
