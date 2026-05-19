/**
 * Argent Agent — Persistent Session Goals (state)
 *
 * Ports the design popularized by Codex CLI's `/goal` (Eric Traut, OpenAI)
 * and the implementation shape of Nous Research's Hermes Agent
 * (`hermes_cli/goals.py`) into Argent.
 *
 * A goal is a free-form user objective that stays active across turns. After
 * each finalized turn the post-turn hook runs a small "judge" call asking
 * whether the goal is satisfied; if not, a canonical continuation prompt is
 * re-entered through the existing FollowupRun queue. The loop terminates on
 * `done`, on turn-budget exhaustion, on 3 consecutive judge parse failures,
 * on user pause / clear, or when a real user message preempts the queued
 * continuation.
 *
 * State lives on `SessionEntry.goal` and rides through Argent's existing
 * atomic-write session store (`src/config/sessions/store.ts:219-222`). No
 * new persistence machinery is introduced.
 */

export const DEFAULT_GOAL_MAX_TURNS = 20;
export const DEFAULT_JUDGE_MAX_TOKENS = 4096;
export const DEFAULT_JUDGE_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_CONSECUTIVE_PARSE_FAILURES = 3;
export const JUDGE_RESPONSE_SNIPPET_CHARS = 4000;

export type GoalStatus = "active" | "paused" | "done" | "cleared";
export type GoalVerdict = "done" | "continue" | "skipped";

/**
 * Per-session standing goal. Persisted on `SessionEntry.goal` so it survives
 * /resume, restart, and compaction.
 */
export type GoalState = {
  goal: string;
  status: GoalStatus;
  turnsUsed: number;
  maxTurns: number;
  /** ms since epoch. */
  createdAt: number;
  /** ms since epoch of the last turn that was judged. 0 until first turn. */
  lastTurnAt: number;
  lastVerdict?: GoalVerdict;
  lastReason?: string;
  /** Why the loop auto-paused (turn budget, parse failures, user). */
  pausedReason?: string;
  /** Consecutive judge replies that couldn't be parsed as JSON. */
  consecutiveParseFailures: number;
  /**
   * Optional user-added criteria appended via /subgoal. Stretch feature —
   * the continuation prompt and judge prompt both include them when present.
   * Backwards-compatible: defaults to empty so older session stores load
   * unchanged.
   */
  subgoals: string[];
};

export const CONTINUATION_PROMPT_TEMPLATE = (goal: string): string =>
  [
    "[Continuing toward your standing goal]",
    `Goal: ${goal}`,
    "",
    "Continue working toward this goal. Take the next concrete step. " +
      "If you believe the goal is complete, state so explicitly and stop. " +
      "If you are blocked and need input from the user, say so clearly and stop.",
  ].join("\n");

export const CONTINUATION_PROMPT_WITH_SUBGOALS_TEMPLATE = (
  goal: string,
  subgoalsBlock: string,
): string =>
  [
    "[Continuing toward your standing goal]",
    `Goal: ${goal}`,
    "",
    "Additional criteria the user added mid-loop:",
    subgoalsBlock,
    "",
    "Continue working toward the goal AND all additional criteria. Take " +
      "the next concrete step. If you believe the goal and every " +
      "additional criterion are complete, state so explicitly and stop. " +
      "If you are blocked and need input from the user, say so clearly and stop.",
  ].join("\n");

export const JUDGE_SYSTEM_PROMPT = [
  "You are a strict judge evaluating whether an autonomous agent has achieved a user's stated goal.",
  "You receive the goal text and the agent's most recent response.",
  "Your only job is to decide whether the goal is fully satisfied based on that response.",
  "",
  "A goal is DONE only when:",
  "- The response explicitly confirms the goal was completed, OR",
  "- The response clearly shows the final deliverable was produced, OR",
  "- The response explains the goal is unachievable / blocked / needs user input (treat this as DONE with reason describing the block).",
  "",
  "Otherwise the goal is NOT done — CONTINUE.",
  "",
  "Reply ONLY with a single JSON object on one line:",
  '{"done": <true|false>, "reason": "<one-sentence rationale>"}',
].join("\n");

export const JUDGE_USER_PROMPT_TEMPLATE = (goal: string, response: string): string =>
  ["Goal:", goal, "", "Agent's most recent response:", response, "", "Is the goal satisfied?"].join(
    "\n",
  );

export const JUDGE_USER_PROMPT_WITH_SUBGOALS_TEMPLATE = (
  goal: string,
  subgoalsBlock: string,
  response: string,
): string =>
  [
    "Goal:",
    goal,
    "",
    "Additional criteria the user added mid-loop (all must also be satisfied for the goal to be DONE):",
    subgoalsBlock,
    "",
    "Agent's most recent response:",
    response,
    "",
    "Decision: For each numbered criterion above, find concrete evidence in the agent's response that the criterion is satisfied. Do not accept generic phrases like 'all requirements met' or 'implying it was done' — require specific evidence (a file contents excerpt, an output line, a command result). If ANY criterion lacks specific evidence in the response, the goal is NOT done — return CONTINUE.",
    "",
    "Is the goal AND every additional criterion satisfied?",
  ].join("\n");

/**
 * Render `state.subgoals` as a numbered "- N. text" block. Returns "" when
 * no subgoals exist.
 */
export function renderSubgoalsBlock(state: GoalState): string {
  if (!state.subgoals || state.subgoals.length === 0) {
    return "";
  }
  return state.subgoals.map((text, idx) => `- ${idx + 1}. ${text}`).join("\n");
}

/**
 * Build the canonical continuation prompt for an active goal. Returns
 * `undefined` for non-active states.
 */
export function nextContinuationPrompt(state: GoalState): string | undefined {
  if (state.status !== "active") {
    return undefined;
  }
  if (state.subgoals && state.subgoals.length > 0) {
    return CONTINUATION_PROMPT_WITH_SUBGOALS_TEMPLATE(state.goal, renderSubgoalsBlock(state));
  }
  return CONTINUATION_PROMPT_TEMPLATE(state.goal);
}

/**
 * Build a fresh GoalState for `/goal <text>`. Caller persists via
 * `updateSessionStoreEntry`.
 */
export function buildInitialGoalState(params: {
  goal: string;
  maxTurns?: number;
  now?: number;
}): GoalState {
  const goal = params.goal.trim();
  if (!goal) {
    throw new Error("goal text is empty");
  }
  const maxTurns =
    typeof params.maxTurns === "number" && params.maxTurns > 0
      ? Math.floor(params.maxTurns)
      : DEFAULT_GOAL_MAX_TURNS;
  const createdAt = params.now ?? Date.now();
  return {
    goal,
    status: "active",
    turnsUsed: 0,
    maxTurns,
    createdAt,
    lastTurnAt: 0,
    consecutiveParseFailures: 0,
    subgoals: [],
  };
}

/**
 * Format a one-line status string for `/goal status`. Mirrors the Hermes
 * surface so operators reading both see identical UX.
 */
export function formatGoalStatusLine(state: GoalState | undefined): string {
  if (!state || state.status === "cleared") {
    return "No active goal. Set one with /goal <text>.";
  }
  const turns = `${state.turnsUsed}/${state.maxTurns} turns`;
  const subCount = state.subgoals?.length ?? 0;
  const sub = subCount > 0 ? `, ${subCount} subgoal${subCount === 1 ? "" : "s"}` : "";
  if (state.status === "active") {
    return `⊙ Goal (active, ${turns}${sub}): ${state.goal}`;
  }
  if (state.status === "paused") {
    const extra = state.pausedReason ? ` — ${state.pausedReason}` : "";
    return `⏸ Goal (paused, ${turns}${sub}${extra}): ${state.goal}`;
  }
  if (state.status === "done") {
    return `✓ Goal done (${turns}${sub}): ${state.goal}`;
  }
  return `Goal (${state.status}, ${turns}${sub}): ${state.goal}`;
}
