/**
 * Argent AI — Core Module
 *
 * Unified LLM abstraction layer for ArgentOS.
 * Replaces pi-ai with a native PostgreSQL + Redis + multi-agent architecture.
 *
 * ## Architecture
 *
 *   Provider.stream() → AsyncGenerator<StreamEvent>
 *        ↓ (StreamAdapter)
 *   AssistantMessageEventStream → AsyncIterable<AssistantMessageEvent>
 *        ↓ (ArgentStreamAdapter)
 *   ArgentEventStream → AsyncIterable<ArgentEvent>
 *
 * ## Quick Start
 *
 * ```typescript
 * import { defaultRegistry, StreamAdapter, createAnthropicProvider } from 'argent-ai';
 *
 * // Register a provider
 * const anthropic = createAnthropicProvider({ apiKey: '...' });
 * defaultRegistry.register(anthropic);
 *
 * // Stream a response
 * const events = defaultRegistry.stream('anthropic', request, modelConfig);
 * for await (const event of events) { ... }
 *
 * // Or use the higher-level message stream
 * const messageStream = defaultRegistry.streamAsMessages('anthropic', request, modelConfig);
 * for await (const event of messageStream) { ... }
 * const result = await messageStream.result();
 *
 * // Or the full Argent event stream with agent lifecycle
 * const argentStream = defaultRegistry.streamAsArgent('anthropic', request, modelConfig, 'my-agent');
 * for await (const event of argentStream) { ... }
 * ```
 *
 * @module argent-ai
 */

// ── Types (primary API surface) ──
export type {
  // Providers
  KnownProvider,
  ProviderName,
  KnownApi,
  Api,
  // Model
  ModelCost,
  Model,
  // Content blocks
  TextContent,
  ThinkingContent,
  ImageContent,
  ToolCall,
  // Usage & stop reason
  Usage,
  StopReason,
  // Messages
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Message,
  // Tools
  Tool,
  // Context
  Context,
  // Options
  ThinkingLevel,
  ThinkingBudgets,
  CacheRetention,
  Transport,
  StreamOptions,
  SimpleStreamOptions,
  OpenAICompletionsOptions,
  // Events
  AssistantMessageEvent,
  AssistantMessageEventStream,
  StreamEvent,
  // Provider interface (new)
  Provider,
  ModelConfig,
  TurnRequest,
  TurnResponse,
  // Argent types
  ArgentModel,
  ArgentContext,
  ArgentStreamOptions,
  VisualPresenceEvent,
  ArgentAgentEvent,
  ArgentEvent,
  ArgentEventStream,
  // Stream function
  StreamFunction,
} from "./types.js";

// Re-export TypeBox for downstream consumers
export { Type } from "./types.js";
export type { TSchema, Static } from "./types.js";

// ── Stream Abstraction (core) ──
export {
  // Adapters
  StreamAdapter,
  ArgentStreamAdapter,
  // Registry
  ProviderRegistry,
  defaultRegistry,
  // Stream utilities
  collectStream,
  tapStream,
  filterStream,
  mapStream,
  collectText,
  collectResponse,
  textStream,
  // Legacy API provider bridge (backward compat)
  type LegacyApiProvider,
  registerLegacyApiProvider,
  getLegacyApiProvider,
  unregisterLegacyApiProviders,
  clearLegacyApiProviders,
  hasLegacyApiProvider,
  listLegacyRegisteredApis,
  // Backward-compat aliases
  registerLegacyApiProvider as registerApiProvider,
  getLegacyApiProvider as getApiProvider,
  unregisterLegacyApiProviders as unregisterApiProviders,
  clearLegacyApiProviders as clearApiProviders,
  hasLegacyApiProvider as hasApiProvider,
  listLegacyRegisteredApis as listRegisteredApis,
} from "./stream.js";

// ── Event Stream Utility ──
export {
  EventStream,
  createAssistantMessageEventStream,
  isDoneEvent,
  isErrorEvent,
  isTextDeltaEvent,
  isThinkingDeltaEvent,
  isToolCallEndEvent,
} from "./utils/event-stream.js";

// ── Completion Functions (pi-compat top-level API) ──
export { stream, streamSimple, complete, completeSimple } from "./complete.js";

// ── Providers ──
export {
  // Factory dispatch
  createProvider,
  // Individual providers
  AnthropicProvider,
  createAnthropicProvider,
  type AnthropicProviderConfig,
  OpenAIProvider,
  createOpenAIProvider,
  type OpenAIProviderConfig,
  OpenAIResponsesProvider,
  createOpenAIResponsesProvider,
  createCodexProvider,
  type OpenAIResponsesProviderConfig,
  GoogleProvider,
  createGoogleProvider,
  type GoogleProviderConfig,
  createXAIProvider,
  type XAIProviderConfig,
  MiniMaxProvider,
  createMiniMaxProvider,
  type MiniMaxProviderConfig,
  ZAIProvider,
  createZAIProvider,
  type ZAIProviderConfig,
} from "./providers/index.js";

// ── Model Database ──
export {
  MODELS,
  getModel,
  getProviders,
  getModels,
  calculateCost,
  supportsXhigh,
  modelsAreEqual,
} from "./models-db.js";
