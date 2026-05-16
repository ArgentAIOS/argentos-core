/**
 * Argent Agent — Goal runner: the Ralph loop, state lifecycle, post-turn hook.
 *
 * Wires GoalState (`./goal-state.ts`) into Argent's existing
 * FollowupRun queue. The flow:
 *
 *   1. /goal <text> handler builds an initial GoalState, persists it on
 *      SessionEntry, and enqueues an immediate continuation FollowupRun
 *      so turn 1 fires without the user needing to send another message.
 *
 *   2. After every finalized assistant turn, `evaluateGoalAfterTurn`:
 *        - increments `turnsUsed`
 *        - calls the judge (`judgeGoal` in goal-judge.ts) — fail-open
 *        - on `done`: marks state `done`, returns a completion message
 *        - on parse-failure ≥ 3: auto-pauses with a judge-config hint
 *        - on `turnsUsed ≥ maxTurns`: auto-pauses with a /goal-resume hint
 *        - otherwise: emits a continuation prompt for the next turn
 *
 *   3. The post-turn hook `maybeEnqueueGoalContinuation` is the single
 *      integration point in `agent-runner.ts`. It loads the active goal
 *      (if any) from the session entry, runs `evaluateGoalAfterTurn`, and
 *      enqueues the next FollowupRun via the existing queue infrastructure.
 *
 *   4. Real user messages naturally preempt queued continuations because
 *      they enter the same inbound FIFO — no special wiring needed.
 *
 * No changes to `loop.ts` / `loop-v2.ts` — the goal loop is orthogonal to
 * the per-turn model+tool loop and rides on the cross-turn FollowupRun queue.
 *
 * Ported from Hermes Agent's `hermes_cli/goals.py:GoalManager` and from
 * Codex CLI's original /goal design by Eric Traut. See PR body for credits.
 */

import type { Provider } from "../argent-ai/types.js";
import type { FollowupRun, QueueSettings } from "../auto-reply/reply/queue.js";
import type { OriginatingChannelType } from "../auto-reply/templating.js";
import {
  createAnthropic,
  createGoogle,
  createInception,
  createMiniMax,
  createOpenAI,
  createOpenAICodex,
  createXAI,
  createZAI,
} from "../argent-agent/providers.js";
import { enqueueFollowupRun } from "../auto-reply/reply/queue.js";
import { type SessionEntry, updateSessionStoreEntry } from "../config/sessions.js";
import { defaultRuntime } from "../runtime.js";
import { judgeGoal, type JudgeResult } from "./goal-judge.js";
import {
  buildInitialGoalState,
  DEFAULT_MAX_CONSECUTIVE_PARSE_FAILURES,
  type GoalState,
  nextContinuationPrompt,
} from "./goal-state.js";

// ============================================================================
// State lifecycle (persisted via updateSessionStoreEntry)
// ============================================================================

export type SaveGoalParams = {
  storePath: string;
  sessionKey: string;
  state: GoalState | undefined;
};

/**
 * Write a GoalState into the session store. Pass `state: undefined` to clear
 * the field outright (rare — /goal clear marks it `cleared` instead). No-op
 * when storePath or sessionKey is missing.
 */
export async function persistGoalState(params: SaveGoalParams): Promise<void> {
  if (!params.storePath || !params.sessionKey) {
    return;
  }
  await updateSessionStoreEntry({
    storePath: params.storePath,
    sessionKey: params.sessionKey,
    update: async () => ({ goal: params.state }),
  });
}

/**
 * Resolve the goal status mid-run. Helpers below give command handlers a
 * single import surface.
 */
export function isGoalActive(state: GoalState | undefined): state is GoalState {
  return Boolean(state && state.status === "active");
}

export function hasLiveGoal(state: GoalState | undefined): state is GoalState {
  return Boolean(state && (state.status === "active" || state.status === "paused"));
}

// ============================================================================
// Mutators — used by the /goal command handler. Pure on GoalState, with a
// persistence helper at the end.
// ============================================================================

export type SetGoalParams = {
  goal: string;
  maxTurns?: number;
  now?: number;
};

export function buildSetGoalState(params: SetGoalParams): GoalState {
  return buildInitialGoalState(params);
}

export function buildPausedGoalState(state: GoalState, reason: string): GoalState {
  return { ...state, status: "paused", pausedReason: reason };
}

export function buildResumedGoalState(state: GoalState): GoalState {
  return {
    ...state,
    status: "active",
    pausedReason: undefined,
    turnsUsed: 0,
    consecutiveParseFailures: 0,
  };
}

export function buildClearedGoalState(state: GoalState): GoalState {
  return { ...state, status: "cleared" };
}

export function buildDoneGoalState(state: GoalState, reason: string): GoalState {
  return {
    ...state,
    status: "done",
    lastVerdict: "done",
    lastReason: reason,
  };
}

// ============================================================================
// Post-turn evaluator — pure on (state, judge result), returns next state +
// caller decision dict. Easy to unit-test without mocking a Provider.
// ============================================================================

export type GoalEvaluationDecision = {
  /** New goal state (caller persists). */
  nextState: GoalState;
  /** Whether to enqueue another continuation turn. */
  shouldContinue: boolean;
  /** The continuation prompt for the next turn, or undefined when stopping. */
  continuationPrompt: string | undefined;
  verdict: JudgeResult["verdict"] | "inactive";
  reason: string;
  /** One-liner the caller surfaces back to the user. */
  message: string;
};

/**
 * Apply a judge result to a GoalState and decide whether to continue. Pure —
 * no side effects, no I/O.
 */
export function applyJudgeResultToGoalState(params: {
  state: GoalState;
  judge: JudgeResult;
  now?: number;
  maxConsecutiveParseFailures?: number;
}): GoalEvaluationDecision {
  const { state, judge } = params;
  const now = params.now ?? Date.now();
  const maxParseFailures =
    params.maxConsecutiveParseFailures ?? DEFAULT_MAX_CONSECUTIVE_PARSE_FAILURES;

  const next: GoalState = {
    ...state,
    turnsUsed: state.turnsUsed + 1,
    lastTurnAt: now,
    lastVerdict: judge.verdict,
    lastReason: judge.reason,
    consecutiveParseFailures: judge.parseFailed ? state.consecutiveParseFailures + 1 : 0,
  };

  if (judge.verdict === "done") {
    next.status = "done";
    return {
      nextState: next,
      shouldContinue: false,
      continuationPrompt: undefined,
      verdict: "done",
      reason: judge.reason,
      message: `✓ Goal achieved: ${judge.reason}`,
    };
  }

  if (next.consecutiveParseFailures >= maxParseFailures) {
    next.status = "paused";
    next.pausedReason = `judge model returned unparseable output ${next.consecutiveParseFailures} turns in a row`;
    return {
      nextState: next,
      shouldContinue: false,
      continuationPrompt: undefined,
      verdict: judge.verdict,
      reason: judge.reason,
      message:
        `⏸ Goal paused — the judge model (${next.consecutiveParseFailures} turns) isn't ` +
        "returning the required JSON verdict. Route the judge to a stricter model " +
        "(planned: `judge.model` config knob in v1.1). Then /goal resume to continue.",
    };
  }

  if (next.turnsUsed >= next.maxTurns) {
    next.status = "paused";
    next.pausedReason = `turn budget exhausted (${next.turnsUsed}/${next.maxTurns})`;
    return {
      nextState: next,
      shouldContinue: false,
      continuationPrompt: undefined,
      verdict: judge.verdict,
      reason: judge.reason,
      message:
        `⏸ Goal paused — ${next.turnsUsed}/${next.maxTurns} turns used. ` +
        "Use /goal resume to keep going, or /goal clear to stop.",
    };
  }

  const continuation = nextContinuationPrompt(next);
  return {
    nextState: next,
    shouldContinue: continuation !== undefined,
    continuationPrompt: continuation,
    verdict: judge.verdict,
    reason: judge.reason,
    message: `↻ Continuing toward goal (${next.turnsUsed}/${next.maxTurns}): ${judge.reason}`,
  };
}

// ============================================================================
// Post-turn hook called from agent-runner / followup-runner
// ============================================================================

export type GoalContinuationContext = {
  /** Used to build the FollowupRun for the next turn. */
  followupRunTemplate: FollowupRun;
  /** Queue settings (already resolved upstream). */
  resolvedQueue: QueueSettings;
  /** Queue key — usually sessionKey. */
  queueKey: string;
  /** Routing context — preserved so continuation replies go back to the
   * originating gateway, not a stale lastChannel. */
  originatingChannel?: OriginatingChannelType;
  originatingTo?: string;
  originatingAccountId?: string;
  originatingThreadId?: string | number;
  originatingChatType?: string;
};

export type MaybeEnqueueGoalContinuationParams = {
  sessionKey: string;
  storePath: string;
  sessionEntry: SessionEntry | undefined;
  /** The agent's most recent finalized assistant text (post-turn). */
  lastAssistantText: string;
  /** Provider+model the judge runs against (v1: session's main). */
  judgeProvider: Provider;
  judgeModelId: string;
  judgeMaxTokens?: number;
  judgeTimeoutMs?: number;
  /** Routing + run context for the next continuation. */
  continuation: GoalContinuationContext;
};

export type MaybeEnqueueGoalContinuationResult = {
  /** True when we enqueued a continuation. */
  enqueued: boolean;
  /** The decision the evaluator returned (for logging / surfacing). */
  decision?: GoalEvaluationDecision;
  /** A one-line note for the caller to optionally surface to the user. */
  message?: string;
};

/**
 * Post-turn hook. Loads the active goal off `sessionEntry`, runs the judge,
 * updates state, and enqueues the next continuation FollowupRun when
 * appropriate. Fail-open at every layer.
 */
export async function maybeEnqueueGoalContinuation(
  params: MaybeEnqueueGoalContinuationParams,
): Promise<MaybeEnqueueGoalContinuationResult> {
  const goal = params.sessionEntry?.goal;
  if (!isGoalActive(goal)) {
    return { enqueued: false };
  }

  let judge: JudgeResult;
  try {
    judge = await judgeGoal({
      goal: goal.goal,
      lastResponse: params.lastAssistantText,
      provider: params.judgeProvider,
      model: { id: params.judgeModelId },
      subgoals: goal.subgoals,
      maxTokens: params.judgeMaxTokens,
      timeoutMs: params.judgeTimeoutMs,
    });
  } catch (err) {
    // judgeGoal itself fails open; this branch should be unreachable, but
    // belt-and-suspenders: treat unexpected throws as `continue`.
    const name = err instanceof Error ? err.name : "Error";
    judge = { verdict: "continue", reason: `judge error: ${name}`, parseFailed: false };
  }

  const decision = applyJudgeResultToGoalState({
    state: goal,
    judge,
  });

  try {
    await persistGoalState({
      storePath: params.storePath,
      sessionKey: params.sessionKey,
      state: decision.nextState,
    });
  } catch (err) {
    defaultRuntime.error?.(
      `goal: failed to persist state for ${params.sessionKey}: ${String(err)}`,
    );
  }

  if (!decision.shouldContinue || !decision.continuationPrompt) {
    return { enqueued: false, decision, message: decision.message };
  }

  const nextRun: FollowupRun = {
    prompt: decision.continuationPrompt,
    summaryLine: `goal continuation (${decision.nextState.turnsUsed}/${decision.nextState.maxTurns})`,
    enqueuedAt: Date.now(),
    originatingChannel: params.continuation.originatingChannel,
    originatingTo: params.continuation.originatingTo,
    originatingAccountId: params.continuation.originatingAccountId,
    originatingThreadId: params.continuation.originatingThreadId,
    originatingChatType: params.continuation.originatingChatType,
    run: params.continuation.followupRunTemplate.run,
  };

  let enqueued = false;
  try {
    enqueued = enqueueFollowupRun(
      params.continuation.queueKey,
      nextRun,
      params.continuation.resolvedQueue,
      "none",
    );
  } catch (err) {
    defaultRuntime.error?.(
      `goal: failed to enqueue continuation for ${params.sessionKey}: ${String(err)}`,
    );
  }

  return {
    enqueued,
    decision,
    message: decision.message,
  };
}

/**
 * Resolve a Provider instance for the judge call by provider name. v1 uses
 * the session's main provider (so it auto-loads keys via the same factory
 * the agent-runtime uses). Returns null for unknown providers; the caller
 * fail-opens.
 *
 * v1.1 TODO: honor a `goals.judge.provider` / `goals.judge.model` config
 * knob so operators can route the judge to a cheap/fast model.
 */
export async function resolveJudgeProvider(providerName: string): Promise<Provider | null> {
  try {
    switch (providerName) {
      case "anthropic":
        return await createAnthropic();
      case "openai":
      case "azure-openai":
        return await createOpenAI();
      case "google":
      case "google-vertex":
        return await createGoogle();
      case "xai":
        return await createXAI();
      case "minimax":
        return await createMiniMax();
      case "zai":
      case "zai-coding":
        return await createZAI();
      case "inception":
        return await createInception();
      case "openai-codex":
        return await createOpenAICodex();
      case "nvidia":
      case "ollama":
        return await createOpenAI();
      default:
        return null;
    }
  } catch (err) {
    defaultRuntime.error?.(
      `goal: could not resolve judge provider "${providerName}": ${String(err)}`,
    );
    return null;
  }
}

/**
 * Build the FollowupRun for the kick-off (turn 1 of a new /goal). The /goal
 * command handler calls this immediately after persisting the initial state
 * so the user doesn't need to send a second message.
 */
export function buildGoalKickoffFollowupRun(params: {
  state: GoalState;
  runTemplate: FollowupRun;
  originatingChannel?: OriginatingChannelType;
  originatingTo?: string;
  originatingAccountId?: string;
  originatingThreadId?: string | number;
  originatingChatType?: string;
}): FollowupRun {
  const prompt = nextContinuationPrompt(params.state);
  if (!prompt) {
    throw new Error("buildGoalKickoffFollowupRun: state is not active");
  }
  return {
    prompt,
    summaryLine: `goal kick-off: ${params.state.goal}`,
    enqueuedAt: Date.now(),
    originatingChannel: params.originatingChannel,
    originatingTo: params.originatingTo,
    originatingAccountId: params.originatingAccountId,
    originatingThreadId: params.originatingThreadId,
    originatingChatType: params.originatingChatType,
    run: params.runTemplate.run,
  };
}
