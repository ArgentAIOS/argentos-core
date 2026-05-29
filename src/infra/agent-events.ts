import type { VerboseLevel } from "../auto-reply/thinking.js";

export type AgentEventStream = "lifecycle" | "tool" | "assistant" | "error" | (string & {});

export type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: AgentEventStream;
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
};

export type AgentRunContext = {
  sessionKey?: string;
  verboseLevel?: VerboseLevel;
  isHeartbeat?: boolean;
  timings?: Partial<{
    startedAt: number;
    firstModelActivityAt: number;
    firstAssistantMessageStartAt: number;
    firstPartialReplyAt: number;
    firstVisibleDeltaAt: number;
    completedAt: number;
    // Phase 0 operator fast path (grok/main-operator-evolution) — only populated when isPrimaryOperator
    operatorFastPathSelectedAt?: number;
    operatorLightToolsBuiltMs?: number;
    operatorPromptModeMinimalAt?: number;
    // Phase 3/4 measurement (grok/main-operator-evolution, wf-4): light surface size + self-extension activity counters
    // Covers curator + personal_skill (original) + skills/family (delegation) + workflow (operator-authored self-improvement flows)
    operatorLightToolsCount?: number;
    operatorCuratorActions?: number;
    operatorPersonalSkillActions?: number;
    operatorSkillsActions?: number;
    operatorFamilyActions?: number;
    operatorWorkflowActions?: number;
    // Phase 0.5 (Hermes Absorption): count of captured turn messages on the last operator
    // self-extension action — a hint for prefetch / richer-context consumption (count only).
    operatorLastTurnMessageCount?: number;
  }>;
};

// Keep per-run counters so streams stay strictly monotonic per runId.
const seqByRun = new Map<string, number>();
const listeners = new Set<(evt: AgentEventPayload) => void>();
const runContextById = new Map<string, AgentRunContext>();

export function registerAgentRunContext(runId: string, context: AgentRunContext) {
  if (!runId) {
    return;
  }
  const existing = runContextById.get(runId);
  if (!existing) {
    runContextById.set(runId, {
      ...context,
      timings: context.timings ? { ...context.timings } : undefined,
    });
    return;
  }
  if (context.sessionKey && existing.sessionKey !== context.sessionKey) {
    existing.sessionKey = context.sessionKey;
  }
  if (context.verboseLevel && existing.verboseLevel !== context.verboseLevel) {
    existing.verboseLevel = context.verboseLevel;
  }
  if (context.isHeartbeat !== undefined && existing.isHeartbeat !== context.isHeartbeat) {
    existing.isHeartbeat = context.isHeartbeat;
  }
  if (context.timings) {
    existing.timings = {
      ...(existing.timings ?? {}),
      ...context.timings,
    };
  }
}

export function recordAgentRunTiming(
  runId: string,
  key: NonNullable<AgentRunContext["timings"]> extends infer T
    ? T extends Record<string, unknown>
      ? keyof T
      : never
    : never,
  timestamp = Date.now(),
  opts?: { overwrite?: boolean },
) {
  const context = runContextById.get(runId);
  if (!context) {
    return;
  }
  const timings = (context.timings ??= {});
  const existing = timings[key];
  if (typeof existing === "number" && !opts?.overwrite) {
    return;
  }
  timings[key] = timestamp;
}

export function getAgentRunContext(runId: string) {
  return runContextById.get(runId);
}

export function clearAgentRunContext(runId: string) {
  runContextById.delete(runId);
}

export function resetAgentRunContextForTest() {
  runContextById.clear();
}

export function emitAgentEvent(event: Omit<AgentEventPayload, "seq" | "ts">) {
  const nextSeq = (seqByRun.get(event.runId) ?? 0) + 1;
  seqByRun.set(event.runId, nextSeq);
  const context = runContextById.get(event.runId);
  const sessionKey =
    typeof event.sessionKey === "string" && event.sessionKey.trim()
      ? event.sessionKey
      : context?.sessionKey;
  const enriched: AgentEventPayload = {
    ...event,
    sessionKey,
    seq: nextSeq,
    ts: Date.now(),
  };
  for (const listener of listeners) {
    try {
      listener(enriched);
    } catch {
      /* ignore */
    }
  }
}

export function onAgentEvent(listener: (evt: AgentEventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ============================================================================
// Phase 3/4: Lightweight Operator Visibility Helpers (grok/main-operator-evolution)
// Flag-gated: callers only invoke on isPrimaryOperator / fast path (via createLightOperatorTools).
// Makes "fast path active + curator / skills / personal_skill / family (goal-driven parallel delegations) / workflow (operator self-improvement authoring)"
// obvious in logs + AgentEvent stream (lifecycle + tool) + end-of-turn [tony-stark]/[turn-latency] summaries.
// wf-4 specifically extends coverage for workflows + goal-driven parallel delegations with direct runId correlation.
// ============================================================================

/**
 * Record the final count of the curated light tool surface for the primary operator.
 * Safe to call multiple times; last write wins.
 */
export function recordOperatorLightToolsCount(runId: string, count: number): void {
  if (!runId || typeof count !== "number") return;
  const context = runContextById.get(runId);
  if (!context) return;
  const timings = (context.timings ??= {});
  timings.operatorLightToolsCount = count;
}

/**
 * Emit a structured lifecycle event marking that the primary operator
 * fast path was selected (prompt profile + light tools + prefetch).
 * Listeners (dashboards, tracers, log aggregators) can surface this cleanly.
 */
export function emitOperatorFastPathEvent(runId: string, data: Record<string, unknown> = {}): void {
  if (!runId) return;
  emitAgentEvent({
    runId,
    stream: "lifecycle",
    data: {
      kind: "operator_fast_path",
      phase: "selected",
      ...data,
    },
  });
}

/**
 * Record a self-extension action taken by the primary operator via its
 * curated light tool surface (curator.*, personal_skill.*, skills.*, family.* for delegations,
 * workflow_builder.* for operator-owned workflows).
 *
 * - Increments the per-run counter in timings (for end-of-turn summaries + dashboards)
 * - Emits a "tool" stream AgentEvent (kind=operator_self_extension) so it appears in all event listeners
 *   with direct runId correlation to the originating fast-path turn.
 * - Falls back to a distinctive console tag ([operator-self-ext]) so even raw logs clearly show
 *   operator self-extension activity (including workflow authoring + goal-driven family parallel delegations)
 *   correlated to the run via surrounding [turn-latency] / [tony-stark] lines.
 *
 * Only call this from code paths that are exclusively reachable via the
 * operator light tool surface (i.e. isPrimaryOperator fast path in createLightOperatorTools).
 * Strictly no impact on full surface or non-primary agents.
 *
 * wf-4 extension: full support for "workflow" (operator self-improvement workflow authoring)
 * and "family" (goal-driven parallel delegations via dispatch/dispatch_contracted/spawn + handoff publish/message).
 */
export function recordOperatorSelfExtensionAction(
  runId: string | undefined,
  tool: "curator" | "personal_skill" | "skills" | "family" | "workflow",
  action: string,
  details: Record<string, unknown> = {},
  /**
   * Optional richer turn context (Hermes-aligned). The operator fast path may pass the
   * captured turn messages (messagesSnapshot) so memory/curator consumption can use them.
   * Only the lightweight count is recorded here (visibility + prefetch hint); deep MemU/SIS
   * consumption of the messages themselves is a follow-on slice.
   */
  turnMessages?: readonly unknown[],
): void {
  const safeDetails = { ...details };
  const turnMessageCount = Array.isArray(turnMessages) ? turnMessages.length : undefined;
  if (turnMessageCount !== undefined) {
    safeDetails.turnMessageCount = turnMessageCount;
  }

  if (!runId) {
    // Fallback: still highly visible in terminal / container logs.
    // Correlates via surrounding [turn-latency] / [tony-stark] lines that carry runId.
    console.info(
      `[operator-self-ext] tool=${tool} action=${action}` +
        (Object.keys(safeDetails).length > 0
          ? ` details=${JSON.stringify(safeDetails).slice(0, 280)}`
          : ""),
    );
    return;
  }

  const context = runContextById.get(runId);
  if (context) {
    const timings = (context.timings ??= {});
    if (turnMessageCount !== undefined) {
      timings.operatorLastTurnMessageCount = turnMessageCount;
    }
    if (tool === "curator") {
      timings.operatorCuratorActions = ((timings.operatorCuratorActions as number) ?? 0) + 1;
    } else if (tool === "personal_skill") {
      timings.operatorPersonalSkillActions =
        ((timings.operatorPersonalSkillActions as number) ?? 0) + 1;
    } else if (tool === "skills") {
      timings.operatorSkillsActions = ((timings.operatorSkillsActions as number) ?? 0) + 1;
    } else if (tool === "family") {
      timings.operatorFamilyActions = ((timings.operatorFamilyActions as number) ?? 0) + 1;
    } else if (tool === "workflow") {
      timings.operatorWorkflowActions = ((timings.operatorWorkflowActions as number) ?? 0) + 1;
    }
  }

  emitAgentEvent({
    runId,
    stream: "tool",
    data: {
      kind: "operator_self_extension",
      tool,
      action,
      ...safeDetails,
    },
  });
}
