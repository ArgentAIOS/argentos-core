/**
 * Argent Agent — Core Loop
 *
 * The production agent orchestrator that ties together:
 *   - PostgreSQL state persistence (turns, episodes, tool results)
 *   - Redis event publishing (agent lifecycle, family coordination)
 *   - SIS lesson injection (confidence-scored, context-aware)
 *   - ToolExecutor integration (policies, hooks, abort)
 *   - Session management (compaction, token budgets)
 *
 * This is the top-level class that consuming code (gateway, sessions, etc.)
 * interacts with. It delegates to:
 *   - agentLoopV2() for the mechanical turn/tool loop
 *   - ToolExecutor for production tool execution
 *   - SIS LessonInjector for prompt enhancement
 *   - StateManager for PG persistence
 *   - EventBus for Redis event publishing
 *
 * Architecture:
 *   User Input → AgentCore.run()
 *     → SIS lesson injection (enhance system prompt)
 *     → StateManager.saveTurnStart()
 *     → agentLoopV2() (provider + tools)
 *       → Redis: publish stream events
 *       → StateManager.saveToolResult() (per tool call)
 *     → StateManager.saveTurnEnd()
 *     → SIS outcome recording
 *     → Redis: publish turn_complete
 *     → Yield CoreEvent (superset of AgentEvent)
 *
 * Built for Argent Core — March 5, 2026
 */

import type {
  Provider,
  ModelConfig,
  TurnRequest,
  TurnResponse,
  ToolCall,
} from "../argent-ai/types.js";
import type { AgentEvent } from "./events.js";
import type { InjectionContext } from "./sis/confidence.js";
import type { LessonExtractor, Episode, ExtractionResult } from "./sis/extraction.js";
import type { LessonInjector, InjectionCandidate, InjectionResult } from "./sis/injection.js";
import type { LessonStorage } from "./sis/storage.js";
import type { ToolExecutor, ToolResult, ToolExecutionEvent } from "./tool-executor.js";
import type { ToolRegistry } from "./tools.js";
import { agentLoopV2, type LoopV2Config, type LoopV2Event } from "./loop-v2.js";

// ============================================================================
// STATE MANAGER (PostgreSQL Persistence)
// ============================================================================

/**
 * Turn record persisted to PostgreSQL.
 */
export interface TurnRecord {
  id: string;
  sessionId: string;
  agentId: string;
  episodeId: string;
  iteration: number;
  /** 'user' | 'assistant' | 'system' */
  role: string;
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ toolCallId: string; result: string; isError: boolean; durationMs: number }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
  };
  stopReason?: string;
  /** Lessons that were injected this turn */
  injectedLessons?: Array<{ id: number; text: string; confidence: number }>;
  /** Emotional valence at turn start */
  preValence?: number;
  /** Emotional valence at turn end */
  postValence?: number;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Episode record persisted to PostgreSQL.
 */
export interface EpisodeRecord {
  id: string;
  sessionId: string;
  agentId: string;
  type: string;
  startedAt: Date;
  completedAt?: Date;
  turnCount: number;
  totalTokens: number;
  preValence?: number;
  postValence?: number;
  outcome?: string;
  metadata?: Record<string, unknown>;
}

/**
 * State persistence interface.
 * Implementations can use PostgreSQL (production), SQLite (dev), or in-memory (test).
 */
export interface StateManager {
  /** Save the start of a turn */
  saveTurnStart(turn: TurnRecord): Promise<void>;

  /** Save the completion of a turn */
  saveTurnEnd(turnId: string, updates: Partial<TurnRecord>): Promise<void>;

  /** Save a tool execution result within a turn */
  saveToolResult(
    turnId: string,
    toolCallId: string,
    result: string,
    isError: boolean,
    durationMs: number,
  ): Promise<void>;

  /** Create an episode */
  createEpisode(episode: EpisodeRecord): Promise<void>;

  /** Complete an episode */
  completeEpisode(episodeId: string, updates: Partial<EpisodeRecord>): Promise<void>;

  /** Get turn history for a session */
  getTurnHistory(sessionId: string, limit?: number): Promise<TurnRecord[]>;

  /** Get episode by ID */
  getEpisode(episodeId: string): Promise<EpisodeRecord | null>;
}

// ============================================================================
// EVENT BUS (Redis Publishing)
// ============================================================================

/**
 * Agent lifecycle events published to Redis.
 * These follow the namespace schema from the specification:
 *   org:{orgId}:events:agent:{sessionId}
 */
export type AgentLifecycleEvent =
  | {
      type: "agent:turn_start";
      agentId: string;
      sessionId: string;
      episodeId: string;
      iteration: number;
      timestamp: number;
    }
  | {
      type: "agent:turn_complete";
      agentId: string;
      sessionId: string;
      episodeId: string;
      iteration: number;
      text: string;
      toolCallCount: number;
      usage: { inputTokens: number; outputTokens: number; totalTokens: number };
      stopReason: string;
      durationMs: number;
      timestamp: number;
    }
  | {
      type: "agent:tool_execute";
      agentId: string;
      sessionId: string;
      toolName: string;
      toolCallId: string;
      isError: boolean;
      durationMs: number;
      timestamp: number;
    }
  | {
      type: "agent:episode_start";
      agentId: string;
      sessionId: string;
      episodeId: string;
      episodeType: string;
      timestamp: number;
    }
  | {
      type: "agent:episode_complete";
      agentId: string;
      sessionId: string;
      episodeId: string;
      turnCount: number;
      totalTokens: number;
      outcome?: string;
      durationMs: number;
      timestamp: number;
    }
  | {
      type: "agent:lesson_injected";
      agentId: string;
      sessionId: string;
      lessonCount: number;
      avgConfidence: number;
      context: string;
      timestamp: number;
    }
  | {
      type: "agent:error";
      agentId: string;
      sessionId: string;
      error: string;
      timestamp: number;
    }
  | {
      type: "agent:heartbeat";
      agentId: string;
      status: "active" | "idle" | "busy";
      load: number;
      timestamp: number;
    };

/**
 * Event bus interface for publishing agent events.
 * Production implementation uses Redis pub/sub + streams.
 * Test/dev can use in-memory or noop.
 */
export interface EventBus {
  /** Publish an event to the agent's event channel */
  publish(event: AgentLifecycleEvent): Promise<void>;

  /** Publish to the family event channel */
  publishFamily(event: AgentLifecycleEvent): Promise<void>;

  /** Close the event bus */
  close(): Promise<void>;
}

// ============================================================================
// CORE LOOP CONFIGURATION
// ============================================================================

export interface CoreLoopConfig {
  /** Agent identifier */
  agentId: string;

  /** Session identifier */
  sessionId: string;

  /** LLM provider */
  provider: Provider;

  /** Model configuration */
  model: ModelConfig;

  /** System prompt (base — SIS lessons prepended automatically) */
  systemPrompt: string;

  /** Tool executor (production) or basic registry (simple) */
  toolExecutor?: ToolExecutor;

  /** Fallback basic tool registry */
  tools?: ToolRegistry;

  /** State persistence */
  state?: StateManager;

  /** Event publishing */
  events?: EventBus;

  /** SIS components (optional) */
  sis?: {
    injector: LessonInjector;
    extractor?: LessonExtractor;
    storage?: LessonStorage;
    /** Override injection context */
    defaultContext?: InjectionContext;
  };

  /** Maximum loop iterations per run (default: 10) */
  maxIterations?: number;

  /** Abort signal for the entire run */
  signal?: AbortSignal;

  /** Parallel tool execution (default: true) */
  parallelTools?: boolean;

  /** Steering message provider */
  getSteeringMessages?: () => Array<{ role: "user"; content: string }>;

  /** Pre-valence for SIS tracking */
  preValence?: number;
}

// ============================================================================
// CORE EVENTS
// ============================================================================

/**
 * CoreEvent is the top-level event type emitted by the core loop.
 * Superset of LoopV2Event with state persistence and SIS events.
 */
export type CoreEvent =
  | LoopV2Event
  | { type: "core:episode_start"; episodeId: string; agentId: string }
  | { type: "core:episode_complete"; episodeId: string; turnCount: number; totalTokens: number }
  | { type: "core:turn_persisted"; turnId: string; iteration: number }
  | { type: "core:sis_injection"; result: InjectionResult }
  | { type: "core:sis_extraction"; lessonsExtracted: number }
  | { type: "core:state_error"; error: string; operation: string }
  | { type: "core:event_error"; error: string; eventType: string };

// ============================================================================
// CORE LOOP
// ============================================================================

/**
 * The production agent core loop.
 *
 * Orchestrates a complete agent run: episode creation → SIS injection →
 * provider streaming → tool execution → state persistence → event publishing →
 * SIS outcome recording → episode completion.
 */
export async function* coreLoop(config: CoreLoopConfig): AsyncGenerator<CoreEvent> {
  const {
    agentId,
    sessionId,
    provider,
    model,
    systemPrompt: baseSystemPrompt,
    state,
    events,
    sis,
    signal,
  } = config;

  const episodeId = crypto.randomUUID();
  const startTime = Date.now();
  let turnCount = 0;
  let totalTokens = 0;
  let injectionResult: InjectionResult | null = null;
  let lastResponse: TurnResponse | null = null;

  // ── 1. Episode Start ──
  if (state) {
    try {
      await state.createEpisode({
        id: episodeId,
        sessionId,
        agentId,
        type: "conversation",
        startedAt: new Date(),
        turnCount: 0,
        totalTokens: 0,
        preValence: config.preValence,
      });
    } catch (error) {
      yield {
        type: "core:state_error",
        error: formatError(error),
        operation: "createEpisode",
      };
    }
  }

  if (events) {
    await safePublish(events, {
      type: "agent:episode_start",
      agentId,
      sessionId,
      episodeId,
      episodeType: "conversation",
      timestamp: Date.now(),
    });
  }

  yield { type: "core:episode_start", episodeId, agentId };

  // ── 2. SIS Lesson Injection ──
  let enhancedSystemPrompt = baseSystemPrompt;

  if (sis?.injector) {
    try {
      const context = sis.defaultContext ?? "general";
      injectionResult = await sis.injector.selectLessonsForTurn({ context, episodeId });

      if (injectionResult.injected.length > 0) {
        enhancedSystemPrompt = `${injectionResult.promptSection}\n\n${baseSystemPrompt}`;

        yield { type: "core:sis_injection", result: injectionResult };

        if (events) {
          const avgConf =
            injectionResult.injected.reduce((s, c) => s + c.confidence.score, 0) /
            injectionResult.injected.length;
          await safePublish(events, {
            type: "agent:lesson_injected",
            agentId,
            sessionId,
            lessonCount: injectionResult.injected.length,
            avgConfidence: avgConf,
            context: sis.defaultContext ?? "general",
            timestamp: Date.now(),
          });
        }
      }
    } catch (error) {
      // SIS failure is non-fatal — continue with base prompt
      yield {
        type: "core:state_error",
        error: formatError(error),
        operation: "sis_injection",
      };
    }
  }

  // ── 3. Run the agent loop ──
  const loopConfig: LoopV2Config = {
    provider,
    model,
    systemPrompt: enhancedSystemPrompt,
    messages: config.getSteeringMessages?.()?.map((m) => ({ ...m })) ?? [],
    toolExecutor: config.toolExecutor,
    tools: config.tools,
    maxIterations: config.maxIterations,
    signal,
    agentId,
    parallelTools: config.parallelTools,
    getSteeringMessages: config.getSteeringMessages,
  };

  // We intercept loop events for state persistence and Redis publishing
  for await (const event of agentLoopV2(loopConfig)) {
    // Check abort
    if (signal?.aborted) break;

    // ── Persist & publish based on event type ──
    switch (event.type) {
      case "loop_start": {
        turnCount = event.iteration;

        if (events) {
          await safePublish(events, {
            type: "agent:turn_start",
            agentId,
            sessionId,
            episodeId,
            iteration: event.iteration,
            timestamp: Date.now(),
          });
        }

        if (state) {
          try {
            await state.saveTurnStart({
              id: `${episodeId}-turn-${event.iteration}`,
              sessionId,
              agentId,
              episodeId,
              iteration: event.iteration,
              role: "assistant",
              content: "",
              startedAt: new Date(),
              injectedLessons: injectionResult?.injected.map((c) => ({
                id: c.lesson.id,
                text: c.lesson.text,
                confidence: c.confidence.score,
              })),
              preValence: config.preValence,
            });
          } catch (error) {
            yield {
              type: "core:state_error",
              error: formatError(error),
              operation: "saveTurnStart",
            };
          }
        }
        break;
      }

      case "done": {
        lastResponse = event.response;

        if (lastResponse) {
          totalTokens += lastResponse.usage.totalTokens;

          const turnId = `${episodeId}-turn-${turnCount}`;

          if (state) {
            try {
              await state.saveTurnEnd(turnId, {
                content: lastResponse.text,
                toolCalls: lastResponse.toolCalls,
                usage: lastResponse.usage,
                stopReason: lastResponse.stopReason,
                completedAt: new Date(),
                durationMs: Date.now() - startTime,
              });
              yield { type: "core:turn_persisted", turnId, iteration: turnCount };
            } catch (error) {
              yield {
                type: "core:state_error",
                error: formatError(error),
                operation: "saveTurnEnd",
              };
            }
          }

          if (events) {
            await safePublish(events, {
              type: "agent:turn_complete",
              agentId,
              sessionId,
              episodeId,
              iteration: turnCount,
              text: lastResponse.text.substring(0, 200),
              toolCallCount: lastResponse.toolCalls.length,
              usage: {
                inputTokens: lastResponse.usage.inputTokens,
                outputTokens: lastResponse.usage.outputTokens,
                totalTokens: lastResponse.usage.totalTokens,
              },
              stopReason: lastResponse.stopReason,
              durationMs: Date.now() - startTime,
              timestamp: Date.now(),
            });
          }
        }
        break;
      }

      case "tool_end": {
        const toolEvent = event as Extract<LoopV2Event, { type: "tool_end" }>;

        if (state) {
          try {
            await state.saveToolResult(
              `${episodeId}-turn-${turnCount}`,
              toolEvent.toolCall.id,
              toolEvent.result,
              toolEvent.isError,
              0, // durationMs not available from basic event
            );
          } catch (error) {
            yield {
              type: "core:state_error",
              error: formatError(error),
              operation: "saveToolResult",
            };
          }
        }

        if (events) {
          await safePublish(events, {
            type: "agent:tool_execute",
            agentId,
            sessionId,
            toolName: toolEvent.toolCall.name,
            toolCallId: toolEvent.toolCall.id,
            isError: toolEvent.isError,
            durationMs: 0,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case "error": {
        if (events) {
          const errorEvent = event as Extract<LoopV2Event, { type: "error" }>;
          const errorMsg = (errorEvent as any).error?.errorMessage ?? "Unknown error";
          await safePublish(events, {
            type: "agent:error",
            agentId,
            sessionId,
            error: errorMsg,
            timestamp: Date.now(),
          });
        }
        break;
      }
    }

    // Pass through all events
    yield event;
  }

  // ── 4. SIS Outcome Recording ──
  if (sis?.injector && injectionResult && injectionResult.injected.length > 0) {
    try {
      await sis.injector.recordInjections(
        injectionResult.injected,
        episodeId,
        config.preValence ?? 0,
      );
    } catch (error) {
      yield {
        type: "core:state_error",
        error: formatError(error),
        operation: "sis_recordInjections",
      };
    }
  }

  // ── 5. SIS Lesson Extraction (from episode) ──
  if (sis?.extractor && lastResponse) {
    try {
      const episode: Episode = {
        id: episodeId,
        type: "conversation",
        content: lastResponse.text,
        lesson: undefined,
        selfInsights: [],
        patterns: [],
        valence: config.preValence ?? 0,
        arousal: 0.5,
        createdAt: new Date(startTime),
      };

      const extraction = await sis.extractor.extractFromEpisode(episode);
      if (extraction.candidates.length > 0) {
        yield {
          type: "core:sis_extraction",
          lessonsExtracted: extraction.candidates.filter((c) => c.promoted).length,
        };
      }
    } catch (error) {
      yield {
        type: "core:state_error",
        error: formatError(error),
        operation: "sis_extraction",
      };
    }
  }

  // ── 6. Episode Complete ──
  const totalDuration = Date.now() - startTime;

  if (state) {
    try {
      await state.completeEpisode(episodeId, {
        completedAt: new Date(),
        turnCount,
        totalTokens,
        outcome: lastResponse?.stopReason ?? "unknown",
      });
    } catch (error) {
      yield {
        type: "core:state_error",
        error: formatError(error),
        operation: "completeEpisode",
      };
    }
  }

  if (events) {
    await safePublish(events, {
      type: "agent:episode_complete",
      agentId,
      sessionId,
      episodeId,
      turnCount,
      totalTokens,
      outcome: lastResponse?.stopReason,
      durationMs: totalDuration,
      timestamp: Date.now(),
    });
  }

  yield {
    type: "core:episode_complete",
    episodeId,
    turnCount,
    totalTokens,
  };
}

// ============================================================================
// IN-MEMORY IMPLEMENTATIONS (for testing & dev)
// ============================================================================

/**
 * In-memory StateManager for testing.
 */
export class InMemoryStateManager implements StateManager {
  turns = new Map<string, TurnRecord>();
  episodes = new Map<string, EpisodeRecord>();

  async saveTurnStart(turn: TurnRecord): Promise<void> {
    this.turns.set(turn.id, { ...turn });
  }

  async saveTurnEnd(turnId: string, updates: Partial<TurnRecord>): Promise<void> {
    const turn = this.turns.get(turnId);
    if (turn) {
      Object.assign(turn, updates);
    }
  }

  async saveToolResult(
    turnId: string,
    toolCallId: string,
    result: string,
    isError: boolean,
    durationMs: number,
  ): Promise<void> {
    const turn = this.turns.get(turnId);
    if (turn) {
      if (!turn.toolResults) turn.toolResults = [];
      turn.toolResults.push({ toolCallId, result, isError, durationMs });
    }
  }

  async createEpisode(episode: EpisodeRecord): Promise<void> {
    this.episodes.set(episode.id, { ...episode });
  }

  async completeEpisode(episodeId: string, updates: Partial<EpisodeRecord>): Promise<void> {
    const ep = this.episodes.get(episodeId);
    if (ep) {
      Object.assign(ep, updates);
    }
  }

  async getTurnHistory(sessionId: string, limit = 50): Promise<TurnRecord[]> {
    return Array.from(this.turns.values())
      .filter((t) => t.sessionId === sessionId)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .slice(-limit);
  }

  async getEpisode(episodeId: string): Promise<EpisodeRecord | null> {
    return this.episodes.get(episodeId) ?? null;
  }
}

/**
 * In-memory EventBus for testing.
 */
export class InMemoryEventBus implements EventBus {
  published: AgentLifecycleEvent[] = [];
  familyPublished: AgentLifecycleEvent[] = [];

  async publish(event: AgentLifecycleEvent): Promise<void> {
    this.published.push(event);
  }

  async publishFamily(event: AgentLifecycleEvent): Promise<void> {
    this.familyPublished.push(event);
  }

  async close(): Promise<void> {
    // noop
  }
}

/**
 * No-op EventBus (production default when Redis is unavailable).
 */
export class NoopEventBus implements EventBus {
  async publish(): Promise<void> {}
  async publishFamily(): Promise<void> {}
  async close(): Promise<void> {}
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Safe event publish — never throws.
 */
async function safePublish(bus: EventBus, event: AgentLifecycleEvent): Promise<void> {
  try {
    await bus.publish(event);
  } catch {
    // Event publishing failure is non-fatal
  }
}

/**
 * Format an error to string.
 */
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
