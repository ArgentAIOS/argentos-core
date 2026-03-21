/**
 * Argent Agent — Core Agent Loop
 *
 * The complete agent system with SIS integration.
 *
 * Built for Argent Core - February 16, 2026
 */

// Agent loop
export { Agent, createAgent, type AgentConfig, type TurnInput, type TurnOutput } from "./agent.js";

// Agent loop (multi-turn with tool execution)
export { agentLoop, type LoopConfig } from "./loop.js";

// Agent loop v2 (enhanced with ToolExecutor, follow-ups, abort handling)
export { agentLoopV2, type LoopV2Config, type LoopV2Event } from "./loop-v2.js";

// Core loop (production — PG state, Redis events, SIS integration)
export {
  coreLoop,
  // Interfaces
  type CoreLoopConfig,
  type CoreEvent,
  type StateManager,
  type EventBus,
  type TurnRecord,
  type EpisodeRecord,
  type AgentLifecycleEvent,
  // In-memory implementations (testing/dev)
  InMemoryStateManager,
  InMemoryEventBus,
  NoopEventBus,
} from "./core-loop.js";

// Events
export type { AgentEvent } from "./events.js";
export { isStreamEvent, isToolEvent, isLoopEvent } from "./events.js";

// Tools (basic)
export { ToolRegistry, executeToolCall, type ToolHandler } from "./tools.js";

// Tool Executor (production — steering, follow-up, abort)
export {
  ToolExecutor,
  createToolExecutor,
  // Types
  type ExtendedToolHandler,
  type ToolExecutionContext,
  type ToolResult,
  type ToolFollowUp,
  type ToolProgressUpdate,
  type ToolPermission,
  type ToolCategory,
  type PolicyDecision,
  type ToolPolicy,
  type PreExecutionHook,
  type PreHookResult,
  type PostExecutionHook,
  type PostHookResult,
  type ToolExecutionEvent,
  type ToolExecutorConfig,
  // Built-in policies
  createAllowlistPolicy,
  createDenylistPolicy,
  createPermissionPolicy,
  createRateLimitPolicy,
  // Built-in hooks
  createAuditHook,
  createErrorRetryHook,
  createValidationHook,
} from "./tool-executor.js";

// Provider factories (auto-load keys from dashboard)
export {
  createAnthropic,
  createOpenAI,
  createInception,
  createGoogle,
  createXAI,
  createMiniMax,
  createZAI,
} from "./providers.js";

// Key management
export { KeyManager, getKeyManager, getProviderKey, getKey, type ServiceKey } from "./keys.js";

// SIS (Self-Improving System)
export * from "./sis/index.js";

// Session management
export { Session } from "./session.js";
export { SessionStore, type SessionEntry } from "./session-store.js";
export {
  compactMessages,
  needsCompaction,
  pruneHistory,
  type CompactionConfig,
  type CompactionResult,
  type PruneResult,
} from "./compaction.js";
export { estimateTextTokens, estimateMessageTokens, type SessionMessage } from "./tokenizer.js";

// Types
export type {
  Lesson,
  LessonHistory,
  InjectionContext,
  ConfidenceResult,
} from "./sis/confidence.js";

// Pi-compatible agent core types
export type {
  StreamFn,
  AgentThinkingLevel,
  CustomAgentMessages,
  AgentMessage,
  AgentToolResult,
  AgentToolUpdateCallback,
  AgentTool,
  AgentState,
  AgentContext,
  PiAgentEvent,
  AgentLoopConfig,
} from "./pi-types.js";

// Compat bridge (Pi ↔ Argent type converters)
export {
  createArgentStreamSimple,
  piModelToArgentConfig,
  piContextToArgentRequest,
  piMessageToArgentResponse,
  mapPiStopReasonToArgent,
} from "./compat.js";

// Skills system (Pi-compatible)
export {
  loadSkillsFromDir,
  loadSkills,
  formatSkillsForPrompt,
  type Skill,
  type SkillFrontmatter,
  type LoadSkillsResult,
  type LoadSkillsFromDirOptions,
  type LoadSkillsOptions,
  type ResourceDiagnostic,
} from "./skills.js";

// Extension types (Pi-compatible)
export {
  CURRENT_SESSION_VERSION,
  type ToolDefinition,
  type ToolInfo,
  type ExtensionContext,
  type ExtensionCommandContext,
  type ExtensionAPI,
  type RegisteredCommand,
  type ExtensionShortcut,
  type ExtensionFlag,
  type ProviderConfig,
  type ProviderModelConfig,
  type ContextEvent,
  type ContextEventResult,
  type FileOperations,
  type ExtensionFactory,
  type LoadedExtension,
} from "./extension-types.js";

// OAuth types (Pi-compatible)
export type { OAuthCredentials, OAuthProvider } from "./oauth-types.js";

// Session Manager (Argent-native — Pi-compatible tree-structured JSONL)
export {
  ArgentSessionManager,
  buildSessionContext,
  SESSION_FORMAT_VERSION,
  type SessionHeader,
  type SessionMessageEntry,
  type ThinkingLevelChangeEntry,
  type ModelChangeEntry,
  type CompactionEntry as SessionCompactionEntry,
  type BranchSummaryEntry,
  type CustomEntry as SessionCustomEntry,
  type CustomMessageEntry,
  type LabelEntry,
  type SessionInfoEntry,
  type SessionEntry as SessionManagerEntry,
  type SessionContext,
  type SessionInfo,
  type SessionTreeNode,
} from "./session-manager.js";

// Settings Manager (Argent-native — two-layer config persistence)
export {
  ArgentSettingsManager,
  type Settings,
  type CompactionSettings as SettingsCompaction,
  type BranchSummarySettings as SettingsBranchSummary,
  type RetrySettings as SettingsRetry,
  type TerminalSettings,
  type ImageSettings,
  type ThinkingBudgetsSettings,
  type MarkdownSettings,
  type PackageSource,
} from "./settings-manager.js";

// Re-export ThinkingLevel from settings-manager (canonical Argent source)
export type { ThinkingLevel } from "./settings-manager.js";

// Agent Session interface (Argent-native — Pi-compatible orchestration surface)
export type {
  AgentSession,
  AgentSessionAgent,
  AgentSessionEvent,
  AgentSessionEventListener,
  AgentSessionEventType,
  AgentSessionConfig,
  CreateAgentSessionOptions,
  CreateAgentSessionResult,
  PromptOptions,
  SessionCompactionResult,
  ModelCycleResult,
  ContextUsage,
  SessionStats,
  PromptTemplate,
  BashResult,
} from "./agent-session.js";

// createAgentSession factory (Argent-native — wires agent + session + tools + events)
export { createArgentAgentSession } from "./create-agent-session.js";

// File tools (Argent-native implementations)
export {
  createReadTool as createArgentReadTool,
  createWriteTool as createArgentWriteTool,
  createEditTool as createArgentEditTool,
  createBashTool as createArgentBashTool,
  createCodingTools as createArgentCodingTools,
  codingTools as argentCodingToolDefaults,
  readTool as argentReadToolDefault,
  type ReadOperations,
  type ReadToolOptions,
  type WriteOperations,
  type WriteToolOptions,
  type EditOperations,
  type EditToolOptions,
  type BashOperations,
  type BashToolOptions,
} from "./file-tools.js";

// Proxy stream (Argent-native — replaces pi-agent-core streamProxy)
export {
  streamProxy,
  type ProxyAssistantMessageEvent,
  type ProxyStreamOptions,
} from "./proxy-stream.js";

// Compaction utilities (Argent-native — replaces pi-coding-agent estimateTokens/generateSummary)
export { estimateTokens, generateSummary } from "./compaction-utils.js";

// Model discovery (delegates to pi-coding-agent — isolated seam)
// Import from this module directly, NOT from the barrel, to avoid ESM cycles.
// export { AuthStorage, ModelRegistry } from "./model-discovery.js";
