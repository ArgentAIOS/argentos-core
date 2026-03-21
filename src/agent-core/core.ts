/**
 * Agent Core — Core Types & Infrastructure
 *
 * SEAM SWAP COMPLETE: All exports point to Argent-native implementations.
 * No remaining @mariozechner/pi-* imports in this file.
 *
 * Downstream consumers import from here:
 *   import { AgentMessage, StreamFn, AgentToolResult } from '../agent-core/core.js';
 *
 * These resolve to Argent-native types from ../argent-agent/.
 */

// ============================================================================
// PRIMARY EXPORTS (Argent-native — these are the canonical types)
// ============================================================================

/**
 * Agent, loop, session, and tool infrastructure.
 * All backed by argent-agent.
 */
export {
  // Agent
  Agent,
  createAgent,
  type AgentConfig,
  type TurnInput,
  type TurnOutput,

  // Loop (v1 basic)
  agentLoop,
  type LoopConfig,

  // Loop (v2 with ToolExecutor, follow-ups, abort)
  agentLoopV2,
  type LoopV2Config,
  type LoopV2Event,

  // Core loop (production — PG state, Redis events, SIS)
  coreLoop,
  type CoreLoopConfig,
  type CoreEvent,
  type StateManager,
  type EventBus,
  type TurnRecord,
  type EpisodeRecord,
  type AgentLifecycleEvent,
  InMemoryStateManager,
  InMemoryEventBus,
  NoopEventBus,

  // Events
  type AgentEvent,
  isStreamEvent,
  isToolEvent,
  isLoopEvent,

  // Tools (basic)
  ToolRegistry,
  executeToolCall,
  type ToolHandler,

  // Tool Executor (production)
  ToolExecutor,
  createToolExecutor,
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
  createAllowlistPolicy,
  createDenylistPolicy,
  createPermissionPolicy,
  createRateLimitPolicy,
  createAuditHook,
  createErrorRetryHook,
  createValidationHook,

  // Session
  Session,
  SessionStore,
  type SessionEntry,
  compactMessages,
  needsCompaction,
  type CompactionConfig,
  type CompactionResult,
  estimateTextTokens,
  estimateMessageTokens,
  type SessionMessage,
} from "../argent-agent/index.js";

// ============================================================================
// PI-COMPAT TYPES (Argent-native implementations matching Pi shapes)
// ============================================================================

/**
 * These match the exact shapes from pi-agent-core, backed by Argent-native code.
 * Downstream code that used Pi's AgentMessage, StreamFn, etc. now gets
 * these Argent implementations transparently.
 */
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
} from "../argent-agent/pi-types.js";

/**
 * ThinkingLevel — canonical source is now argent-agent.
 */
export type { ThinkingLevel } from "../argent-agent/settings-manager.js";

// ============================================================================
// PROXY STREAMING (Argent-native)
// ============================================================================

/**
 * Proxy stream for apps that route LLM calls through a server.
 * Argent-native implementation — replaces pi-agent-core streamProxy.
 */
export {
  streamProxy,
  type ProxyAssistantMessageEvent,
  type ProxyStreamOptions,
} from "../argent-agent/proxy-stream.js";
