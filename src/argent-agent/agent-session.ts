/**
 * Argent Agent — Agent Session
 *
 * The AgentSession interface represents a fully-configured agent session that
 * bundles together the agent loop, session manager, settings, tool registry,
 * model, and event system into a single orchestration surface.
 *
 * This is the primary interface that higher-level code (attempt.ts, compact.ts)
 * interacts with. It wraps the lower-level Agent class with session persistence,
 * compaction, retry, tool management, and extension support.
 *
 * This is an Argent-native type definition matching Pi's AgentSession class shape,
 * covering ALL properties and methods the consuming code actually uses.
 *
 * @module argent-agent/agent-session
 */

import type { TextContent, ImageContent, StreamEvent, ModelConfig } from "../argent-ai/types.js";
import type { ArgentConfig } from "../config/config.js";
import type { ToolDefinition, ExtensionContext } from "./extension-types.js";
import type { AgentMessage, AgentTool, AgentToolResult } from "./pi-types.js";
import type {
  ArgentSessionManager,
  SessionContext,
  BranchSummaryEntry,
} from "./session-manager.js";
import type { ArgentSettingsManager, ThinkingLevel } from "./settings-manager.js";

// ============================================================================
// Agent (inner — the stream/tool executor)
// ============================================================================

/**
 * The inner Agent that owns the stream function, messages, and system prompt.
 * This is what `session.agent` exposes.
 */
export interface AgentSessionAgent {
  /** The streaming function used for LLM calls. Assignable for provider swapping. */
  streamFn: StreamFn;

  /** Replace the system prompt entirely. */
  setSystemPrompt(prompt: string): void;

  /** Replace the message history. Used for sanitization, limiting, image injection. */
  replaceMessages(messages: AgentMessage[]): void;

  /** Additional runtime parameters (provider-specific headers, etc.). */
  extraParams?: Record<string, unknown>;
}

/**
 * Signature of the streaming function. Pi's streamSimple / Argent's compat bridge.
 */
export type StreamFn = (
  model: unknown,
  context: unknown,
  options?: unknown,
) => AsyncIterable<unknown>;

// ============================================================================
// Session Events
// ============================================================================

export type AgentSessionEventType =
  | "text_delta"
  | "thinking_delta"
  | "tool_start"
  | "tool_end"
  | "turn_start"
  | "turn_end"
  | "error"
  | "usage"
  | "compaction_start"
  | "compaction_end"
  | "retry_start"
  | "retry_end";

export interface AgentSessionEvent {
  type: AgentSessionEventType;
  [key: string]: unknown;
}

export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

// ============================================================================
// Prompt Options
// ============================================================================

export interface PromptOptions {
  images?: ImageContent[];
}

// ============================================================================
// Compaction Result
// ============================================================================

export interface SessionCompactionResult {
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
  messagesRemoved: number;
}

// ============================================================================
// Model Cycle Result
// ============================================================================

export interface ModelCycleResult {
  model: unknown;
  thinkingLevel: ThinkingLevel;
}

// ============================================================================
// Context Usage
// ============================================================================

export interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

// ============================================================================
// Session Stats
// ============================================================================

export interface SessionStats {
  sessionFile?: string;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
}

// ============================================================================
// Prompt Template
// ============================================================================

export interface PromptTemplate {
  name: string;
  description?: string;
  content: string;
  path: string;
}

// ============================================================================
// Bash Result
// ============================================================================

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  interrupted?: boolean;
}

// ============================================================================
// Agent Session Config
// ============================================================================

export interface AgentSessionConfig {
  agent: AgentSessionAgent;
  sessionManager: ArgentSessionManager;
  settingsManager: ArgentSettingsManager;
  cwd: string;
  scopedModels?: ReadonlyArray<{ model: unknown; thinkingLevel: ThinkingLevel }>;
  resourceLoader?: unknown;
  customTools?: ToolDefinition[];
  modelRegistry?: unknown;
  initialActiveToolNames?: string[];
  baseToolsOverride?: Record<string, AgentTool>;
  extensionRunnerRef?: { current?: unknown };
}

// ============================================================================
// Create Agent Session Options / Result
// ============================================================================

export interface CreateAgentSessionOptions {
  cwd?: string;
  agentDir?: string;
  authStorage?: unknown;
  modelRegistry?: unknown;
  model?: unknown;
  config?: ArgentConfig;
  thinkingLevel?: ThinkingLevel;
  scopedModels?: Array<{ model: unknown; thinkingLevel: ThinkingLevel }>;
  tools?: AgentTool[];
  customTools?: ToolDefinition[];
  resourceLoader?: unknown;
  sessionManager?: ArgentSessionManager | unknown;
  settingsManager?: ArgentSettingsManager | unknown;
}

export interface CreateAgentSessionResult {
  session: AgentSession;
  extensionsResult: { loaded: string[]; failed: string[] };
  modelFallbackMessage?: string;
}

// ============================================================================
// Agent Session Interface
// ============================================================================

/**
 * The full Agent Session interface — the orchestration surface that higher-level
 * code interacts with.
 *
 * This matches Pi's AgentSession class shape. Properties and methods below are
 * grouped by what the consuming code actually calls.
 */
export interface AgentSession {
  // -- Inner agent (stream function, messages, system prompt) --
  readonly agent: AgentSessionAgent;

  // -- Session identity --
  readonly sessionId: string;
  readonly sessionManager: ArgentSessionManager;
  readonly settingsManager: ArgentSettingsManager;

  // -- State flags --
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly isRetrying: boolean;
  readonly isBashRunning: boolean;
  readonly hasPendingBashMessages: boolean;
  readonly autoCompactionEnabled: boolean;
  readonly autoRetryEnabled: boolean;

  // -- Getters --
  readonly model: unknown | undefined;
  readonly thinkingLevel: ThinkingLevel;
  readonly systemPrompt: string;
  readonly retryAttempt: number;
  readonly steeringMode: "all" | "one-at-a-time";
  readonly followUpMode: "all" | "one-at-a-time";
  readonly sessionFile: string | undefined;
  readonly sessionName: string | undefined;
  readonly scopedModels: ReadonlyArray<{ model: unknown; thinkingLevel: ThinkingLevel }>;
  readonly promptTemplates: ReadonlyArray<PromptTemplate>;
  readonly state: unknown;
  readonly messages: AgentMessage[];
  readonly pendingMessageCount: number;

  // -- Event subscription --
  subscribe(listener: AgentSessionEventListener): () => void;

  // -- Core execution --
  prompt(text: string, options?: PromptOptions): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;

  // -- Session management --
  newSession(options?: {
    parentSession?: string;
    setup?: (sm: ArgentSessionManager) => Promise<void>;
  }): Promise<boolean>;
  switchSession(sessionPath: string): Promise<boolean>;
  reload(): Promise<void>;

  // -- Model / thinking --
  setModel(model: unknown): Promise<void>;
  cycleModel(direction?: "forward" | "backward"): Promise<ModelCycleResult | undefined>;
  setThinkingLevel(level: ThinkingLevel): void;
  cycleThinkingLevel(): ThinkingLevel | undefined;
  getAvailableThinkingLevels(): ThinkingLevel[];
  supportsThinking(): boolean;
  supportsXhighThinking(): boolean;

  // -- Message queuing --
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  clearQueue(): { steering: string[]; followUp: string[] };

  // -- Custom messages --
  sendCustomMessage<T = unknown>(
    message: {
      customType: string;
      content: string | (TextContent | ImageContent)[];
      display: boolean;
      details?: T;
    },
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): Promise<void>;
  sendUserMessage(
    content: string | (TextContent | ImageContent)[],
    options?: { deliverAs?: "steer" | "followUp" },
  ): Promise<void>;

  // -- Tool management --
  getActiveToolNames(): string[];
  getAllTools(): Array<{ name: string; description: string }>;
  setActiveToolsByName(toolNames: string[]): void;

  // -- Compaction & retry --
  compact(customInstructions?: string): Promise<SessionCompactionResult>;
  abortCompaction(): void;
  abortBranchSummary(): void;
  setAutoCompactionEnabled(enabled: boolean): void;
  abortRetry(): void;
  setAutoRetryEnabled(enabled: boolean): void;

  // -- Bash --
  executeBash(
    command: string,
    onChunk?: (chunk: string) => void,
    options?: { excludeFromContext?: boolean; operations?: unknown },
  ): Promise<BashResult>;
  recordBashResult(
    command: string,
    result: BashResult,
    options?: { excludeFromContext?: boolean },
  ): void;
  abortBash(): void;

  // -- Modes --
  setSteeringMode(mode: "all" | "one-at-a-time"): void;
  setFollowUpMode(mode: "all" | "one-at-a-time"): void;
  setSessionName(name: string): void;

  // -- Tree navigation --
  fork(entryId: string): Promise<{ selectedText: string; cancelled: boolean }>;
  navigateTree(
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ): Promise<{
    editorText?: string;
    cancelled: boolean;
    aborted?: boolean;
    summaryEntry?: BranchSummaryEntry;
  }>;

  // -- Utilities --
  waitForIdle(): Promise<void>;
  getSessionStats(): SessionStats;
  getContextUsage(): ContextUsage | undefined;
  getUserMessagesForForking(): Array<{ entryId: string; text: string }>;
  getLastAssistantText(): string | undefined;
  exportToHtml(outputPath?: string): Promise<string>;
  hasExtensionHandlers(eventType: string): boolean;
}
