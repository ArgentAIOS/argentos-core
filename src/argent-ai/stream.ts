/**
 * Argent AI — Unified Stream Abstraction
 *
 * Bridges provider-level StreamEvent generators into the higher-level
 * AssistantMessageEventStream and ArgentEventStream interfaces.
 *
 * Architecture:
 *   Provider.stream() → AsyncGenerator<StreamEvent>
 *        ↓ (StreamAdapter)
 *   AssistantMessageEventStream → AsyncIterable<AssistantMessageEvent>
 *        ↓ (ArgentStreamAdapter)
 *   ArgentEventStream → AsyncIterable<ArgentEvent>
 *
 * Also includes the ProviderRegistry (unified model→provider→stream dispatch)
 * and stream utility functions (collect, tap, filter, merge).
 *
 * The ProviderRegistry serves as the single registry for both:
 *   1. New Provider interface (TurnRequest/ModelConfig) — used by argent-ai providers
 *   2. Legacy ApiProvider interface (Model/Context) — used by complete.ts / pi-compat layer
 *
 * Built for Argent Core — March 5, 2026
 */

import type {
  Provider,
  ModelConfig,
  TurnRequest,
  TurnResponse,
  StreamEvent,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  ArgentEvent,
  ArgentAgentEvent,
  ArgentEventStream,
  ArgentStreamOptions,
  VisualPresenceEvent,
  ToolCall,
  TextContent,
  ThinkingContent,
  Api,
  Model,
  Context,
  SimpleStreamOptions,
  StreamOptions,
  Usage,
} from "./types.js";

// ============================================================================
// STREAM ADAPTER: StreamEvent → AssistantMessageEvent
// ============================================================================

/**
 * Adapts a provider's StreamEvent async generator into an AssistantMessageEventStream.
 * This bridges the simplified provider interface to the richer pi-ai compatible event stream.
 */
export class StreamAdapter implements AssistantMessageEventStream {
  private generator: AsyncGenerator<StreamEvent>;
  private finalMessage: AssistantMessage | null = null;
  private contentIndex = 0;
  private providerName: string;
  private modelId: string;
  private api: Api;

  constructor(
    generator: AsyncGenerator<StreamEvent>,
    providerName: string,
    modelId: string,
    api: Api = "anthropic-messages",
  ) {
    this.generator = generator;
    this.providerName = providerName;
    this.modelId = modelId;
    this.api = api;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    const partial = this.createPartialMessage();

    for await (const event of this.generator) {
      switch (event.type) {
        case "start":
          yield { type: "start", partial };
          break;

        case "text_start":
          yield { type: "text_start", contentIndex: this.contentIndex, partial };
          break;

        case "text_delta":
          // Accumulate text into the partial message
          this.appendText(partial, event.delta);
          yield {
            type: "text_delta",
            contentIndex: this.contentIndex,
            delta: event.delta,
            partial,
          };
          break;

        case "text_end":
          yield {
            type: "text_end",
            contentIndex: this.contentIndex,
            content: event.text,
            partial,
          };
          this.contentIndex++;
          break;

        case "thinking_start":
          yield { type: "thinking_start", contentIndex: this.contentIndex, partial };
          break;

        case "thinking_delta":
          this.appendThinking(partial, event.delta);
          yield {
            type: "thinking_delta",
            contentIndex: this.contentIndex,
            delta: event.delta,
            partial,
          };
          break;

        case "thinking_end":
          yield {
            type: "thinking_end",
            contentIndex: this.contentIndex,
            content: event.thinking,
            partial,
          };
          this.contentIndex++;
          break;

        case "tool_call_start":
          yield { type: "toolcall_start", contentIndex: this.contentIndex, partial };
          break;

        case "tool_call_delta":
          yield {
            type: "toolcall_delta",
            contentIndex: this.contentIndex,
            delta: event.delta,
            partial,
          };
          break;

        case "tool_call_end":
          partial.content.push(event.toolCall);
          yield {
            type: "toolcall_end",
            contentIndex: this.contentIndex,
            toolCall: event.toolCall,
            partial,
          };
          this.contentIndex++;
          break;

        case "done": {
          const finalPartial = event.response;
          this.finalMessage = this.turnResponseToMessage(finalPartial);
          const stopReason = this.mapStopReason(finalPartial.stopReason);
          yield {
            type: "done",
            reason: stopReason as "stop" | "length" | "toolUse",
            message: this.finalMessage,
          };
          break;
        }

        case "error": {
          const errPartial = event.error as TurnResponse;
          this.finalMessage = this.turnResponseToMessage(errPartial);
          yield {
            type: "error",
            reason: "error" as const,
            error: this.finalMessage,
          };
          break;
        }
      }
    }
  }

  async result(): Promise<AssistantMessage> {
    if (this.finalMessage) return this.finalMessage;

    // If result() is called before iteration, consume the stream
    for await (const _ of this) {
      // consume
    }

    if (!this.finalMessage) {
      throw new Error("Stream ended without producing a final message");
    }

    return this.finalMessage;
  }

  // ── Helpers ──

  private createPartialMessage(): AssistantMessage {
    return {
      role: "assistant",
      content: [],
      api: this.api,
      provider: this.providerName,
      model: this.modelId,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };
  }

  private appendText(msg: AssistantMessage, delta: string): void {
    const lastBlock = msg.content[msg.content.length - 1];
    if (lastBlock && lastBlock.type === "text") {
      (lastBlock as TextContent).text += delta;
    } else {
      msg.content.push({ type: "text", text: delta });
    }
  }

  private appendThinking(msg: AssistantMessage, delta: string): void {
    const lastBlock = msg.content[msg.content.length - 1];
    if (lastBlock && lastBlock.type === "thinking") {
      (lastBlock as ThinkingContent).thinking += delta;
    } else {
      msg.content.push({ type: "thinking", thinking: delta });
    }
  }

  private turnResponseToMessage(resp: TurnResponse): AssistantMessage {
    const content: AssistantMessage["content"] = [];

    if (resp.thinking) {
      content.push({ type: "thinking", thinking: resp.thinking });
    }
    if (resp.text) {
      content.push({ type: "text", text: resp.text });
    }
    for (const tc of resp.toolCalls) {
      content.push(tc);
    }

    return {
      role: "assistant",
      content,
      api: this.api,
      provider: resp.provider || this.providerName,
      model: resp.model || this.modelId,
      usage: {
        input: resp.usage.inputTokens,
        output: resp.usage.outputTokens,
        cacheRead: resp.usage.cacheReadTokens,
        cacheWrite: resp.usage.cacheWriteTokens,
        totalTokens: resp.usage.totalTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: this.mapStopReason(resp.stopReason),
      errorMessage: resp.errorMessage,
      timestamp: Date.now(),
    };
  }

  private mapStopReason(reason: string): AssistantMessage["stopReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "tool_use":
        return "toolUse";
      case "error":
        return "error";
      default:
        return "stop";
    }
  }
}

// ============================================================================
// ARGENT STREAM ADAPTER: AssistantMessageEvent + Agent Events → ArgentEvent
// ============================================================================

/**
 * Wraps an AssistantMessageEventStream with agent lifecycle events and
 * visual presence hooks to produce an ArgentEventStream.
 */
export class ArgentStreamAdapter implements ArgentEventStream {
  private inner: AssistantMessageEventStream;
  private collectedAgentEvents: ArgentAgentEvent[] = [];
  private options: ArgentStreamOptions;
  private agentId: string;

  constructor(
    inner: AssistantMessageEventStream,
    agentId: string,
    options: ArgentStreamOptions = {},
  ) {
    this.inner = inner;
    this.agentId = agentId;
    this.options = options;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ArgentEvent> {
    const sessionKey = this.options.sessionKey ?? "default";

    // Emit agent start if lifecycle events enabled
    if (this.options.emitLifecycleEvents) {
      const startEvent: ArgentAgentEvent = {
        type: "agent:start",
        agentId: this.agentId,
        sessionKey,
      };
      this.collectedAgentEvents.push(startEvent);
      yield startEvent;
    }

    let turnIndex = 0;
    let hasError = false;

    try {
      for await (const event of this.inner) {
        // Emit turn_start on first content
        if (
          this.options.emitLifecycleEvents &&
          turnIndex === 0 &&
          (event.type === "text_start" ||
            event.type === "thinking_start" ||
            event.type === "toolcall_start")
        ) {
          const turnStart: ArgentAgentEvent = {
            type: "agent:turn_start",
            agentId: this.agentId,
            turnIndex,
          };
          this.collectedAgentEvents.push(turnStart);
          yield turnStart;
          turnIndex++;
        }

        // Visual presence hooks
        if (this.options.enableVisualPresence) {
          const vpEvent = this.deriveVisualPresence(event);
          if (vpEvent) {
            if (this.options.onVisualPresence) {
              this.options.onVisualPresence(vpEvent);
            }
            yield vpEvent;
          }
        }

        // Pass through the message event
        yield event;

        // Track errors
        if (event.type === "error") {
          hasError = true;
        }
      }
    } catch (err) {
      hasError = true;
      if (this.options.emitLifecycleEvents) {
        const errorEvent: ArgentAgentEvent = {
          type: "agent:error",
          agentId: this.agentId,
          error: err instanceof Error ? err.message : String(err),
        };
        this.collectedAgentEvents.push(errorEvent);
        yield errorEvent;
      }
      throw err;
    } finally {
      // Emit turn_complete and agent stop
      if (this.options.emitLifecycleEvents) {
        if (turnIndex > 0) {
          const turnComplete: ArgentAgentEvent = {
            type: "agent:turn_complete",
            agentId: this.agentId,
            turnIndex: turnIndex - 1,
            success: !hasError,
          };
          this.collectedAgentEvents.push(turnComplete);
          yield turnComplete;
        }

        const stopEvent: ArgentAgentEvent = {
          type: "agent:stop",
          agentId: this.agentId,
          reason: hasError ? "error" : "complete",
        };
        this.collectedAgentEvents.push(stopEvent);
        yield stopEvent;
      }
    }
  }

  async result(): Promise<AssistantMessage> {
    return this.inner.result();
  }

  async agentEvents(): Promise<ArgentAgentEvent[]> {
    return [...this.collectedAgentEvents];
  }

  /**
   * Derive visual presence events from message stream events.
   */
  private deriveVisualPresence(event: AssistantMessageEvent): VisualPresenceEvent | null {
    switch (event.type) {
      case "start":
        return { type: "gesture", gesture: "brighten", intensity: 0.5 };
      case "thinking_start":
        return { type: "gesture", gesture: "pulse", intensity: 0.6 };
      case "thinking_end":
        return { type: "gesture", gesture: "soften", intensity: 0.4 };
      case "text_start":
        return { type: "gesture", gesture: "expand", intensity: 0.5 };
      case "toolcall_start":
        return { type: "gesture", gesture: "sharpen", intensity: 0.7 };
      case "toolcall_end":
        return { type: "gesture", gesture: "still", intensity: 0.3 };
      case "done":
        return { type: "gesture", gesture: "warm_up", intensity: 0.6 };
      case "error":
        return { type: "gesture", gesture: "dim", intensity: 0.8 };
      default:
        return null;
    }
  }
}

// ============================================================================
// PROVIDER REGISTRY (Unified model → provider → stream dispatch)
// ============================================================================

/**
 * Registered provider entry
 */
interface RegisteredProvider {
  provider: Provider;
  sourceId?: string;
  priority: number;
}

/**
 * Unified Provider Registry
 *
 * Central dispatch for routing model requests to the correct provider.
 * Supports registration by provider name with priority ordering,
 * model-specific overrides, and source tracking for plugin cleanup.
 */
export class ProviderRegistry {
  private providers = new Map<string, RegisteredProvider>();
  private modelOverrides = new Map<string, string>(); // modelId → providerName

  /**
   * Register a provider.
   *
   * @param provider - Provider instance
   * @param options - Registration options
   */
  register(provider: Provider, options?: { sourceId?: string; priority?: number }): void {
    const existing = this.providers.get(provider.name);
    const priority = options?.priority ?? 0;

    // Higher priority wins, or first registration if equal
    if (!existing || priority >= existing.priority) {
      this.providers.set(provider.name, {
        provider,
        sourceId: options?.sourceId,
        priority,
      });
    }
  }

  /**
   * Unregister a specific provider by name.
   */
  unregister(name: string): boolean {
    return this.providers.delete(name);
  }

  /**
   * Unregister all providers from a specific source (e.g., a plugin).
   */
  unregisterBySource(sourceId: string): number {
    let removed = 0;
    for (const [name, entry] of this.providers.entries()) {
      if (entry.sourceId === sourceId) {
        this.providers.delete(name);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get a provider by name.
   */
  get(name: string): Provider | undefined {
    return this.providers.get(name)?.provider;
  }

  /**
   * Set a model-specific provider override.
   * When streaming with this model, the specified provider will be used
   * regardless of the model's default provider field.
   */
  setModelOverride(modelId: string, providerName: string): void {
    this.modelOverrides.set(modelId, providerName);
  }

  /**
   * Remove a model-specific provider override.
   */
  removeModelOverride(modelId: string): boolean {
    return this.modelOverrides.delete(modelId);
  }

  /**
   * Resolve the provider for a given model ID and optional provider hint.
   * Priority: model override → explicit provider name → first registered
   */
  resolve(modelId: string, providerHint?: string): Provider | undefined {
    // Check model-specific overrides first
    const override = this.modelOverrides.get(modelId);
    if (override) {
      const provider = this.providers.get(override)?.provider;
      if (provider) return provider;
    }

    // Use provider hint
    if (providerHint) {
      const provider = this.providers.get(providerHint)?.provider;
      if (provider) return provider;
    }

    return undefined;
  }

  /**
   * Execute a non-streaming turn against a provider.
   */
  async execute(
    providerName: string,
    request: TurnRequest,
    modelConfig: ModelConfig,
  ): Promise<TurnResponse> {
    const provider = this.resolve(modelConfig.id, providerName);
    if (!provider) {
      throw new Error(`No provider found for model "${modelConfig.id}" (hint: "${providerName}")`);
    }
    return provider.execute(request, modelConfig);
  }

  /**
   * Stream a turn from a provider, returning the raw StreamEvent generator.
   */
  stream(
    providerName: string,
    request: TurnRequest,
    modelConfig: ModelConfig,
  ): AsyncGenerator<StreamEvent> {
    const provider = this.resolve(modelConfig.id, providerName);
    if (!provider) {
      throw new Error(`No provider found for model "${modelConfig.id}" (hint: "${providerName}")`);
    }
    return provider.stream(request, modelConfig);
  }

  /**
   * Stream a turn and wrap it in an AssistantMessageEventStream.
   */
  streamAsMessages(
    providerName: string,
    request: TurnRequest,
    modelConfig: ModelConfig,
    api: Api = "anthropic-messages",
  ): AssistantMessageEventStream {
    const gen = this.stream(providerName, request, modelConfig);
    return new StreamAdapter(gen, providerName, modelConfig.id, api);
  }

  /**
   * Stream a turn and wrap it in a full ArgentEventStream with agent lifecycle events.
   */
  streamAsArgent(
    providerName: string,
    request: TurnRequest,
    modelConfig: ModelConfig,
    agentId: string,
    options?: ArgentStreamOptions,
    api?: Api,
  ): ArgentEventStream {
    const messageStream = this.streamAsMessages(providerName, request, modelConfig, api);
    return new ArgentStreamAdapter(messageStream, agentId, options);
  }

  /**
   * List all registered provider names.
   */
  list(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is registered.
   */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Get the count of registered providers.
   */
  get size(): number {
    return this.providers.size;
  }

  /**
   * Clear all providers and overrides. Primarily for testing.
   */
  clear(): void {
    this.providers.clear();
    this.modelOverrides.clear();
  }
}

// ============================================================================
// LEGACY API PROVIDER BRIDGE
// ============================================================================

/**
 * Legacy ApiProvider interface (from registry.ts).
 * Used by complete.ts stream()/streamSimple()/complete()/completeSimple().
 *
 * The bridge allows legacy code that uses Model+Context to route through
 * the unified ProviderRegistry without changes to calling code.
 */
export interface LegacyApiProvider {
  api: Api;
  stream: (model: Model, context: Context, options?: StreamOptions) => AssistantMessageEventStream;
  streamSimple: (
    model: Model,
    context: Context,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream;
}

/**
 * Registry for legacy ApiProvider implementations.
 *
 * This is the backing store for registerApiProvider/getApiProvider compatibility.
 * New code should use ProviderRegistry directly; this exists so complete.ts
 * and the pi-compat layer continue working without modification.
 */
const legacyApiProviderRegistry = new Map<
  string,
  { provider: LegacyApiProvider; sourceId?: string }
>();

/**
 * Register a legacy API provider.
 * This maintains backward compat with registry.ts registerApiProvider().
 */
export function registerLegacyApiProvider(provider: LegacyApiProvider, sourceId?: string): void {
  legacyApiProviderRegistry.set(provider.api, { provider, sourceId });
}

/**
 * Get a legacy API provider by API protocol.
 */
export function getLegacyApiProvider(api: Api): LegacyApiProvider | undefined {
  return legacyApiProviderRegistry.get(api)?.provider;
}

/**
 * Unregister legacy API providers from a source.
 */
export function unregisterLegacyApiProviders(sourceId: string): void {
  for (const [api, entry] of legacyApiProviderRegistry.entries()) {
    if (entry.sourceId === sourceId) {
      legacyApiProviderRegistry.delete(api);
    }
  }
}

/**
 * Clear all legacy API providers (for testing).
 */
export function clearLegacyApiProviders(): void {
  legacyApiProviderRegistry.clear();
}

/**
 * Check if a legacy API provider is registered.
 */
export function hasLegacyApiProvider(api: Api): boolean {
  return legacyApiProviderRegistry.has(api);
}

/**
 * List registered legacy API protocols.
 */
export function listLegacyRegisteredApis(): Api[] {
  return Array.from(legacyApiProviderRegistry.keys());
}

// ============================================================================
// STREAM UTILITIES
// ============================================================================

/**
 * Collect all events from a stream into an array.
 * Useful for testing and logging.
 */
export async function collectStream<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

/**
 * Tap into a stream without modifying it.
 * The callback receives each event for side effects (logging, metrics, etc.).
 */
export async function* tapStream<T>(
  stream: AsyncIterable<T>,
  callback: (event: T) => void | Promise<void>,
): AsyncGenerator<T> {
  for await (const event of stream) {
    await callback(event);
    yield event;
  }
}

/**
 * Filter stream events by predicate.
 */
export async function* filterStream<T>(
  stream: AsyncIterable<T>,
  predicate: (event: T) => boolean,
): AsyncGenerator<T> {
  for await (const event of stream) {
    if (predicate(event)) {
      yield event;
    }
  }
}

/**
 * Map stream events through a transform function.
 */
export async function* mapStream<T, U>(
  stream: AsyncIterable<T>,
  transform: (event: T) => U | Promise<U>,
): AsyncGenerator<U> {
  for await (const event of stream) {
    yield await transform(event);
  }
}

/**
 * Collect only text deltas from a StreamEvent generator into a string.
 */
export async function collectText(stream: AsyncIterable<StreamEvent>): Promise<string> {
  let text = "";
  for await (const event of stream) {
    if (event.type === "text_delta") {
      text += event.delta;
    }
  }
  return text;
}

/**
 * Collect the final TurnResponse from a StreamEvent generator.
 */
export async function collectResponse(
  stream: AsyncIterable<StreamEvent>,
): Promise<TurnResponse | null> {
  let response: TurnResponse | null = null;
  for await (const event of stream) {
    if (event.type === "done") {
      response = event.response;
    } else if (event.type === "error") {
      response = event.error as TurnResponse;
    }
  }
  return response;
}

/**
 * Create a text-only callback stream that yields text as it arrives.
 */
export async function* textStream(stream: AsyncIterable<StreamEvent>): AsyncGenerator<string> {
  for await (const event of stream) {
    if (event.type === "text_delta") {
      yield event.delta;
    }
  }
}

// ============================================================================
// DEFAULT REGISTRY SINGLETON
// ============================================================================

/**
 * Default global provider registry.
 * Import and use directly, or create your own with `new ProviderRegistry()`.
 */
export const defaultRegistry = new ProviderRegistry();

// ============================================================================
// BACKWARD-COMPAT ALIASES (registry.ts drop-in replacements)
// ============================================================================

/**
 * These re-export the legacy bridge functions with names matching registry.ts
 * so that importers of the old module can switch to stream.ts seamlessly.
 *
 * Usage in complete.ts:
 *   import { registerApiProvider, getApiProvider } from './stream.js';
 *
 * Or keep importing from registry.ts which re-exports from here.
 */
export {
  registerLegacyApiProvider as registerApiProvider,
  getLegacyApiProvider as getApiProvider,
  unregisterLegacyApiProviders as unregisterApiProviders,
  clearLegacyApiProviders as clearApiProviders,
  hasLegacyApiProvider as hasApiProvider,
  listLegacyRegisteredApis as listRegisteredApis,
};
