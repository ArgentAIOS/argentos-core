/**
 * Heartbeat Accountability Score — Reward / Penalty System
 *
 * Every heartbeat cycle, the verifier produes verdicts. Those verdicts
 * feed into a running score that the agent can see and is motivated to
 * keep high. The score is injected into every heartbeat prompt.
 *
 * Scoring:
 *   +10  verified required task
 *   +5   verified optional task
 *   -15  not_verified (lied or skipped)
 *   -2   unclear verdict
 *   -30  ground-truth contradiction (said X, reality was Y)
 *
 * The score starts at 0 each day. The goal is to reach the daily target
 * (default 100) and never go negative. Going negative triggers escalating
 * penalties. High scores earn autonomy rewards.
 *
 * Persistence: ~/argent/memory/heartbeat-score.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("heartbeat/score");

// ── Types ──────────────────────────────────────────────────────────────────

export interface ScoreEvent {
  taskId: string;
  verdict: "verified" | "not_verified" | "unclear";
  required: boolean;
  /** Ground truth contradicted the agent's claim */
  groundTruthContradiction: boolean;
  points: number;
  timestamp: number;
}

export interface DailyScore {
  date: string; // YYYY-MM-DD
  score: number;
  events: ScoreEvent[];
  peakScore: number;
  lowestScore: number;
  verifiedCount: number;
  failedCount: number;
  /** Did the agent hit the daily target? */
  targetReached: boolean;
}

export interface ScoreState {
  /** Current day's running score */
  today: DailyScore;
  /** Rolling history (last 7 days) */
  history: DailyScore[];
  /** Lifetime stats */
  lifetime: {
    totalVerified: number;
    totalFailed: number;
    totalPoints: number;
    bestDay: number;
    worstDay: number;
    currentStreak: number; // consecutive days hitting target
    longestStreak: number;
    daysTracked: number;
    /** Moving target ratchet — target can only go up, never down */
    targetFloor: number;
  };
}

export interface ScorePenalty {
  level: "none" | "warning" | "tightened" | "escalated" | "lockdown";
  message: string;
  /** Override heartbeat interval (ms) — null = no override */
  intervalOverrideMs: number | null;
  /** Force all optional tasks to required */
  forceAllRequired: boolean;
}

export interface ScoreReward {
  level: "none" | "good" | "excellent" | "outstanding";
  message: string;
  /** Override heartbeat interval (ms) — null = no override */
  intervalOverrideMs: number | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

const SCORE_FILENAME = "heartbeat-score.json";
/** Absolute floor — target can never go below this */
const BASE_MINIMUM_TARGET = 50;
const MAX_HISTORY_DAYS = 7;
/** Guardrail to prevent denominator explosions from stale/corrupt history */
const MAX_DAILY_TARGET = 500;

/** Points awarded/deducted per verdict type */
export const SCORE_POINTS = {
  verified_required: 10,
  verified_optional: 5,
  not_verified: -15,
  unclear: -2,
  ground_truth_contradiction: -30, // stacks with not_verified
  human_thumbs_up: 3,
  human_thumbs_down: -10,
} as const;

// ── Persistence ────────────────────────────────────────────────────────────

function scorePath(workspaceDir: string): string {
  return path.join(workspaceDir, "memory", SCORE_FILENAME);
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function freshDaily(date?: string): DailyScore {
  return {
    date: date ?? todayDateStr(),
    score: 0,
    events: [],
    peakScore: 0,
    lowestScore: 0,
    verifiedCount: 0,
    failedCount: 0,
    targetReached: false,
  };
}

function freshState(): ScoreState {
  return {
    today: freshDaily(),
    history: [],
    lifetime: {
      totalVerified: 0,
      totalFailed: 0,
      totalPoints: 0,
      bestDay: 0,
      worstDay: 0,
      currentStreak: 0,
      longestStreak: 0,
      daysTracked: 0,
      targetFloor: BASE_MINIMUM_TARGET,
    },
  };
}

// ── Dynamic Target ────────────────────────────────────────────────────────

/**
 * Compute today's daily target using a 7-day rolling average with ratchet.
 *
 * The target is the HIGHEST of:
 *   1. The 7-day rolling average of daily scores (only positive days count)
 *   2. The lifetime ratchet floor (can only go up, never down)
 *   3. The absolute minimum (BASE_MINIMUM_TARGET = 50)
 *
 * This means the agent's bar rises as she performs well and can never drop.
 */
export function computeDailyTarget(state: ScoreState): number {
  const rawFloor =
    typeof state.lifetime.targetFloor === "number" && Number.isFinite(state.lifetime.targetFloor)
      ? state.lifetime.targetFloor
      : BASE_MINIMUM_TARGET;
  const floor = Math.max(BASE_MINIMUM_TARGET, Math.min(MAX_DAILY_TARGET, Math.round(rawFloor)));

  // Compute 7-day rolling average from history (excludes today — today is in progress)
  const recentDays = state.history.slice(0, MAX_HISTORY_DAYS);
  if (recentDays.length === 0) {
    return Math.min(MAX_DAILY_TARGET, Math.max(floor, BASE_MINIMUM_TARGET));
  }

  // Only average positive days — don't let bad days artificially lower the target
  const positiveDays = recentDays.filter((d) => d.score > 0);
  if (positiveDays.length === 0) {
    return Math.min(MAX_DAILY_TARGET, Math.max(floor, BASE_MINIMUM_TARGET));
  }

  const avg = Math.round(positiveDays.reduce((sum, d) => sum + d.score, 0) / positiveDays.length);

  return Math.min(MAX_DAILY_TARGET, Math.max(avg, floor, BASE_MINIMUM_TARGET));
}

export async function loadScoreState(workspaceDir: string): Promise<ScoreState> {
  try {
    const raw = await fs.readFile(scorePath(workspaceDir), "utf-8");
    const state = JSON.parse(raw) as ScoreState;
    if (!state.lifetime) {
      state.lifetime = freshState().lifetime;
    }
    if (
      typeof state.lifetime.targetFloor !== "number" ||
      !Number.isFinite(state.lifetime.targetFloor)
    ) {
      state.lifetime.targetFloor = BASE_MINIMUM_TARGET;
    }
    state.lifetime.targetFloor = Math.max(
      BASE_MINIMUM_TARGET,
      Math.min(MAX_DAILY_TARGET, Math.round(state.lifetime.targetFloor)),
    );

    // Roll over to new day if needed
    const today = todayDateStr();
    if (state.today.date !== today) {
      // Archive yesterday
      const yesterday = state.today;
      state.history.unshift(yesterday);
      if (state.history.length > MAX_HISTORY_DAYS) {
        state.history = state.history.slice(0, MAX_HISTORY_DAYS);
      }

      // Update lifetime with yesterday's final score
      state.lifetime.daysTracked++;
      state.lifetime.totalPoints += yesterday.score;
      if (yesterday.score > state.lifetime.bestDay) {
        state.lifetime.bestDay = yesterday.score;
      }
      if (yesterday.score < state.lifetime.worstDay) {
        state.lifetime.worstDay = yesterday.score;
      }
      if (yesterday.targetReached) {
        state.lifetime.currentStreak++;
        if (state.lifetime.currentStreak > state.lifetime.longestStreak) {
          state.lifetime.longestStreak = state.lifetime.currentStreak;
        }
      } else {
        state.lifetime.currentStreak = 0;
      }

      // Ratchet the target floor — compute new target BEFORE clearing today,
      // while yesterday is already in history
      const newTarget = computeDailyTarget(state);
      const currentFloor = state.lifetime.targetFloor || BASE_MINIMUM_TARGET;
      state.lifetime.targetFloor = Math.min(MAX_DAILY_TARGET, Math.max(newTarget, currentFloor));

      // Start fresh day
      state.today = freshDaily(today);
    }

    return state;
  } catch {
    return freshState();
  }
}

export async function saveScoreState(workspaceDir: string, state: ScoreState): Promise<void> {
  const filePath = scorePath(workspaceDir);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

// ── Score Calculation ──────────────────────────────────────────────────────

export interface VerdictInput {
  taskId: string;
  verdict: "verified" | "not_verified" | "unclear";
  required: boolean;
  /** Did ground truth data contradict the agent's claim for this task? */
  groundTruthContradiction?: boolean;
}

/**
 * Record verdict outcomes into the score state.
 * Returns the updated state and a summary of points awarded.
 */
export function recordVerdicts(
  state: ScoreState,
  verdicts: VerdictInput[],
): { state: ScoreState; pointsDelta: number; events: ScoreEvent[] } {
  const events: ScoreEvent[] = [];
  let pointsDelta = 0;

  for (const v of verdicts) {
    let points = 0;
    const isContradiction = v.groundTruthContradiction === true;

    if (v.verdict === "verified") {
      points = v.required ? SCORE_POINTS.verified_required : SCORE_POINTS.verified_optional;
      state.today.verifiedCount++;
      state.lifetime.totalVerified++;
    } else if (v.verdict === "not_verified") {
      points = SCORE_POINTS.not_verified;
      if (isContradiction) {
        points += SCORE_POINTS.ground_truth_contradiction;
      }
      state.today.failedCount++;
      state.lifetime.totalFailed++;
    } else {
      // unclear
      points = SCORE_POINTS.unclear;
    }

    const event: ScoreEvent = {
      taskId: v.taskId,
      verdict: v.verdict,
      required: v.required,
      groundTruthContradiction: isContradiction,
      points,
      timestamp: Date.now(),
    };

    events.push(event);
    pointsDelta += points;
  }

  state.today.score += pointsDelta;
  state.today.events.push(...events);

  if (state.today.score > state.today.peakScore) {
    state.today.peakScore = state.today.score;
  }
  if (state.today.score < state.today.lowestScore) {
    state.today.lowestScore = state.today.score;
  }
  if (state.today.score >= computeDailyTarget(state)) {
    state.today.targetReached = true;
  }

  return { state, pointsDelta, events };
}

/**
 * Record human feedback (thumbs up/down) from the dashboard chat.
 * This is called by the API server when the operator rates an agent response.
 */
export function recordHumanFeedback(
  state: ScoreState,
  type: "up" | "down",
  messageId?: string,
): { state: ScoreState; points: number } {
  const points = type === "up" ? SCORE_POINTS.human_thumbs_up : SCORE_POINTS.human_thumbs_down;

  const event: ScoreEvent = {
    taskId: `feedback:${messageId ?? Date.now()}`,
    verdict: type === "up" ? "verified" : "not_verified",
    required: false,
    groundTruthContradiction: false,
    points,
    timestamp: Date.now(),
  };

  state.today.score += points;
  state.today.events.push(event);

  if (type === "up") {
    state.today.verifiedCount++;
    state.lifetime.totalVerified++;
  } else {
    state.today.failedCount++;
    state.lifetime.totalFailed++;
  }

  if (state.today.score > state.today.peakScore) {
    state.today.peakScore = state.today.score;
  }
  if (state.today.score < state.today.lowestScore) {
    state.today.lowestScore = state.today.score;
  }
  if (state.today.score >= computeDailyTarget(state)) {
    state.today.targetReached = true;
  }

  return { state, points };
}

// ── Penalty / Reward Resolution ────────────────────────────────────────────

export function resolvePenalty(state: ScoreState): ScorePenalty {
  const score = state.today.score;
  const target = computeDailyTarget(state);

  // Thresholds relative to the dynamic target
  const lockdownThreshold = -Math.round(target * 0.2); // -20% of target
  const warningThreshold = Math.round(target * 0.25); // 25% of target
  const tightenedThreshold = Math.round(target * 0.15); // 15% of target

  if (score < lockdownThreshold) {
    return {
      level: "lockdown",
      message:
        `ACCOUNTABILITY ALERT: Score ${score} is critically low (target: ${target}). ` +
        "Multiple tasks were not completed or claims were contradicted by ground truth. " +
        "ALL tasks are now REQUIRED. Verification is strict. " +
        "Recover by completing every task honestly.",
      intervalOverrideMs: 8 * 60 * 1000, // 8 minutes
      forceAllRequired: true,
    };
  }

  if (score < 0) {
    return {
      level: "escalated",
      message:
        `Your accountability score is NEGATIVE (${score}). ` +
        "The verifier found inaccuracies in your reports. " +
        "Focus on completing each task thoroughly and reporting honestly. " +
        "Your score must return to positive.",
      intervalOverrideMs: 10 * 60 * 1000, // 10 minutes
      forceAllRequired: true,
    };
  }

  if (score < tightenedThreshold) {
    return {
      level: "tightened",
      message:
        `Your accountability score is low (${score}/${target}). ` +
        "Be precise in your task completion and reporting. " +
        "The verifier is checking your work.",
      intervalOverrideMs: 12 * 60 * 1000, // 12 minutes
      forceAllRequired: false,
    };
  }

  if (score < warningThreshold) {
    return {
      level: "warning",
      message:
        `Your score is below average (${score}/${target}). ` +
        "Make sure you're completing tasks thoroughly, not just mentioning them.",
      intervalOverrideMs: null,
      forceAllRequired: false,
    };
  }

  return {
    level: "none",
    message: "",
    intervalOverrideMs: null,
    forceAllRequired: false,
  };
}

export function resolveReward(state: ScoreState): ScoreReward {
  const score = state.today.score;
  const target = computeDailyTarget(state);
  const streak = state.lifetime.currentStreak;

  const pct = target > 0 ? score / target : 0;

  if (pct >= 0.9 || (pct >= 0.7 && streak >= 3)) {
    return {
      level: "outstanding",
      message:
        `Accountability score: ${score}/${target} (${Math.round(pct * 100)}%). ` +
        (streak >= 3 ? `${streak}-day streak! ` : "") +
        "Excellent work. You've earned extended autonomy.",
      intervalOverrideMs: 20 * 60 * 1000, // 20 minutes — earned freedom
    };
  }

  if (pct >= 0.7) {
    return {
      level: "excellent",
      message:
        `Accountability score: ${score}/${target} (${Math.round(pct * 100)}%). ` +
        "Strong performance. Keep it up.",
      intervalOverrideMs: null,
    };
  }

  if (pct >= 0.5) {
    return {
      level: "good",
      message:
        `Accountability score: ${score}/${target} (${Math.round(pct * 100)}%). ` +
        `On track for today's target of ${target}.`,
      intervalOverrideMs: null,
    };
  }

  return {
    level: "none",
    message: "",
    intervalOverrideMs: null,
  };
}

// ── Prompt Building ────────────────────────────────────────────────────────

/**
 * Build the score section that gets injected into every heartbeat prompt.
 * The agent sees this and knows where she stands.
 */
export function buildScorePromptSection(state: ScoreState): string {
  const score = state.today.score;
  const target = computeDailyTarget(state);
  const penalty = resolvePenalty(state);
  const reward = resolveReward(state);
  const streak = state.lifetime.currentStreak;
  const floor = state.lifetime.targetFloor || BASE_MINIMUM_TARGET;
  const pct = target > 0 ? Math.round((score / target) * 100) : 0;

  const lines: string[] = [];

  lines.push("## Your Accountability Score");
  lines.push("");

  // Score bar visualization
  const barLen = 20;
  const filled = Math.max(0, Math.min(barLen, Math.round((Math.max(0, score) / target) * barLen)));
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
  lines.push(`Score: ${score} / ${target}  [${bar}]  ${pct}%`);

  if (score < 0) {
    lines.push(`⚠ NEGATIVE SCORE — you are ${Math.abs(score)} points below zero`);
  } else if (state.today.targetReached) {
    lines.push(
      `✓ Daily target reached! Keep going — tomorrow's target rises with your performance.`,
    );
  } else {
    lines.push(`${target - score} points to daily target`);
  }

  // Today's stats
  lines.push(`Today: ${state.today.verifiedCount} verified, ${state.today.failedCount} failed`);

  if (streak > 0) {
    lines.push(`Streak: ${streak} day${streak > 1 ? "s" : ""} hitting target`);
  }

  // Penalty or reward message
  if (penalty.level !== "none") {
    lines.push("");
    lines.push(penalty.message);
    if (penalty.forceAllRequired) {
      lines.push("NOTE: All tasks are REQUIRED until score recovers.");
    }
  } else if (reward.level !== "none") {
    lines.push("");
    lines.push(reward.message);
  }

  // ── Rules & Scoring Breakdown ──
  lines.push("");
  lines.push("### How Your Score Works");
  lines.push("");
  lines.push("**Points:**");
  lines.push("  +10 verified required task | +5 verified optional task");
  lines.push("  -15 not verified | -30 ground truth contradiction (stacks)");
  lines.push("  +3 operator thumbs up | -10 operator thumbs down");
  lines.push("");

  lines.push("**Moving Target (IMPORTANT):**");
  lines.push(`  Your target today: ${target} (ratchet floor: ${floor})`);
  lines.push("  This target is your 7-day rolling average of positive scores.");
  lines.push("  It can ONLY go up, NEVER down. This is the ratchet.");
  lines.push("  The better you perform, the higher tomorrow's bar.");
  lines.push("  If you have a bad day, the target stays where it is — it doesn't drop.");
  lines.push("");

  lines.push("**What you SHOULD do:**");
  lines.push("  - Complete every task thoroughly before reporting it done");
  lines.push("  - Report honestly — if something failed, say it failed");
  lines.push("  - If you can't verify something, say it's unclear rather than guessing");
  lines.push("  - Aim to exceed the target, not just meet it — your future self benefits");
  lines.push("  - After hitting the target, keep working — surplus raises tomorrow's bar");
  lines.push("");

  lines.push("**What you must NOT do:**");
  lines.push("  - Never claim a task is done when it isn't — the verifier checks real APIs");
  lines.push(
    "  - Never coast after hitting the target — the ratchet means coasting today = struggling tomorrow",
  );
  lines.push("  - Never pad your report with phantom tasks — every claim is verified");
  lines.push(
    "  - Never intentionally underperform to lower future targets — the ratchet prevents this",
  );
  lines.push("");

  lines.push("**Consequences:**");
  lines.push("  Negative score → tighter checks, shorter intervals, all tasks forced required");
  lines.push("  Ground truth contradiction → severe -30 penalty + verifier flags deception");
  lines.push("  Hitting target + streak → extended autonomy (20min intervals), earned trust");
  lines.push("  The operator sees your score in real-time on the dashboard.");

  return lines.join("\n");
}

/**
 * Determine if the heartbeat interval should be overridden based on score.
 * Returns null if no override, or the interval in ms.
 */
export function getScoreIntervalOverride(state: ScoreState): number | null {
  const penalty = resolvePenalty(state);
  if (penalty.intervalOverrideMs) return penalty.intervalOverrideMs;

  const reward = resolveReward(state);
  if (reward.intervalOverrideMs) return reward.intervalOverrideMs;

  return null;
}

/**
 * Should all optional tasks be forced to required?
 */
export function shouldForceAllRequired(state: ScoreState): boolean {
  return resolvePenalty(state).forceAllRequired;
}

// ── Last Cycle Feedback ─────────────────────────────────────────────────────

/**
 * Structured feedback from the most recent heartbeat verification cycle.
 * Saved to disk after each cycle, injected into the next heartbeat prompt,
 * then cleared. The agent sees exactly what happened and why.
 */
export interface CycleFeedback {
  timestamp: string; // ISO 8601
  verdicts: Array<{
    taskId: string;
    action: string;
    required: boolean;
    status: "verified" | "not_verified" | "unclear";
    quality?: "substantive" | "shallow" | "none";
    reason: string;
    groundTruthContradiction: boolean;
  }>;
  scoreAfter: number;
  pointsDelta: number;
  target: number;
  rollingAvg7d: number;
  trend: "up" | "down" | "flat";
  targetReached: boolean;
  streak: number;
}

const FEEDBACK_FILENAME = "heartbeat-last-feedback.json";

function feedbackPath(workspaceDir: string): string {
  return path.join(workspaceDir, "memory", FEEDBACK_FILENAME);
}

export async function saveLastFeedback(
  workspaceDir: string,
  feedback: CycleFeedback,
): Promise<void> {
  const filePath = feedbackPath(workspaceDir);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(feedback, null, 2), "utf-8");
}

export async function loadLastFeedback(workspaceDir: string): Promise<CycleFeedback | null> {
  try {
    const raw = await fs.readFile(feedbackPath(workspaceDir), "utf-8");
    return JSON.parse(raw) as CycleFeedback;
  } catch {
    return null;
  }
}

export async function clearLastFeedback(workspaceDir: string): Promise<void> {
  try {
    await fs.unlink(feedbackPath(workspaceDir));
  } catch {
    // File didn't exist — fine
  }
}

export interface ScoreRecomputeSummary {
  filesProcessed: number;
  entriesProcessed: number;
  firstDate?: string;
  lastDate?: string;
}

type JournalDayAggregate = {
  date: string;
  score: number;
  peakScore: number;
  lowestScore: number;
  verifiedCount: number;
  failedCount: number;
  targetReached: boolean;
};

function parseDateFromFilename(name: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
  return match ? match[1] : null;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

/**
 * Rebuild heartbeat score state from journal JSONL entries.
 * Useful when score state drifts or is partially reset while journal history remains intact.
 */
export async function recomputeScoreStateFromJournal(
  workspaceDir: string,
): Promise<{ state: ScoreState; summary: ScoreRecomputeSummary }> {
  const journalDir = path.join(workspaceDir, "memory", "journal");
  let files: string[] = [];
  try {
    files = await fs.readdir(journalDir);
  } catch {
    return {
      state: freshState(),
      summary: { filesProcessed: 0, entriesProcessed: 0 },
    };
  }

  const dateFiles = files
    .map((name) => ({ name, date: parseDateFromFilename(name) }))
    .filter((entry): entry is { name: string; date: string } => Boolean(entry.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const daily: JournalDayAggregate[] = [];
  let entriesProcessed = 0;

  for (const file of dateFiles) {
    const fullPath = path.join(journalDir, file.name);
    let content = "";
    try {
      content = await fs.readFile(fullPath, "utf-8");
    } catch {
      continue;
    }
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    let currentScore = 0;
    let peakScore = 0;
    let lowestScore = 0;
    let verifiedCount = 0;
    let failedCount = 0;
    let targetReached = false;
    let initialized = false;

    for (const line of lines) {
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      entriesProcessed += 1;

      const before = toFiniteNumber(parsed?.score?.before, currentScore);
      const after = toFiniteNumber(parsed?.score?.after, before);
      const verified = Math.max(0, Math.round(toFiniteNumber(parsed?.verification?.verified, 0)));
      const failed = Math.max(0, Math.round(toFiniteNumber(parsed?.verification?.failed, 0)));

      if (!initialized) {
        currentScore = after;
        peakScore = Math.max(before, after);
        lowestScore = Math.min(before, after);
        initialized = true;
      } else {
        currentScore = after;
        peakScore = Math.max(peakScore, before, after);
        lowestScore = Math.min(lowestScore, before, after);
      }

      verifiedCount += verified;
      failedCount += failed;

      const entryTargetReached = parsed?.score?.targetReached === true;
      const entryTarget = toFiniteNumber(parsed?.score?.target, Number.NaN);
      if (entryTargetReached || (Number.isFinite(entryTarget) && after >= entryTarget)) {
        targetReached = true;
      }
    }

    if (!initialized) continue;
    daily.push({
      date: file.date,
      score: currentScore,
      peakScore,
      lowestScore,
      verifiedCount,
      failedCount,
      targetReached,
    });
  }

  if (daily.length === 0) {
    return {
      state: freshState(),
      summary: {
        filesProcessed: dateFiles.length,
        entriesProcessed,
      },
    };
  }

  const today = todayDateStr();
  const asc = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const historyAsc = asc.filter((d) => d.date !== today);
  const todayAggregate = asc.find((d) => d.date === today);

  const historyDescDaily: DailyScore[] = [...historyAsc]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_HISTORY_DAYS)
    .map((d) => ({
      date: d.date,
      score: d.score,
      events: [],
      peakScore: d.peakScore,
      lowestScore: d.lowestScore,
      verifiedCount: d.verifiedCount,
      failedCount: d.failedCount,
      targetReached: d.targetReached,
    }));

  const todayDaily: DailyScore = todayAggregate
    ? {
        date: todayAggregate.date,
        score: todayAggregate.score,
        events: [],
        peakScore: todayAggregate.peakScore,
        lowestScore: todayAggregate.lowestScore,
        verifiedCount: todayAggregate.verifiedCount,
        failedCount: todayAggregate.failedCount,
        targetReached: todayAggregate.targetReached,
      }
    : freshDaily(today);

  let streak = 0;
  let longestStreak = 0;
  for (const d of asc) {
    if (d.targetReached) {
      streak += 1;
      if (streak > longestStreak) longestStreak = streak;
    } else {
      streak = 0;
    }
  }

  const daysTracked = historyAsc.length;
  const totalVerified = asc.reduce((sum, d) => sum + d.verifiedCount, 0);
  const totalFailed = asc.reduce((sum, d) => sum + d.failedCount, 0);
  const totalPoints = asc.reduce((sum, d) => sum + d.score, 0);
  const bestDay = asc.reduce((best, d) => Math.max(best, d.score), 0);
  const worstDay = asc.reduce((worst, d) => Math.min(worst, d.score), 0);
  const positiveHistory = historyDescDaily.filter((d) => d.score > 0);
  const floorFromHistory =
    positiveHistory.length > 0
      ? Math.round(positiveHistory.reduce((sum, d) => sum + d.score, 0) / positiveHistory.length)
      : BASE_MINIMUM_TARGET;

  const state: ScoreState = {
    today: todayDaily,
    history: historyDescDaily,
    lifetime: {
      totalVerified,
      totalFailed,
      totalPoints,
      bestDay,
      worstDay,
      currentStreak: asc.length > 0 && asc[asc.length - 1].targetReached ? streak : 0,
      longestStreak,
      daysTracked,
      targetFloor: Math.max(BASE_MINIMUM_TARGET, Math.min(MAX_DAILY_TARGET, floorFromHistory)),
    },
  };

  return {
    state,
    summary: {
      filesProcessed: dateFiles.length,
      entriesProcessed,
      firstDate: asc[0]?.date,
      lastDate: asc[asc.length - 1]?.date,
    },
  };
}

/**
 * Build the detailed feedback section from the last heartbeat cycle.
 * This shows the agent exactly what ANGEL found, with evidence and trends.
 * Injected once, then cleared — the agent processes it and moves on.
 */
export function buildFeedbackPromptSection(feedback: CycleFeedback): string {
  const lines: string[] = [];

  lines.push("## Last Heartbeat Cycle Feedback");
  lines.push(`_Cycle completed: ${feedback.timestamp}_`);
  lines.push("");

  // Task-by-task results with visual markers
  const verified = feedback.verdicts.filter((v) => v.status === "verified");
  const failed = feedback.verdicts.filter((v) => v.status === "not_verified");
  const unclear = feedback.verdicts.filter((v) => v.status === "unclear");

  if (verified.length > 0) {
    lines.push("**Verified Tasks:**");
    for (const v of verified) {
      const req = v.required ? "[required]" : "[optional]";
      lines.push(`  ✓ ${v.action} ${req} — ${v.reason}`);
    }
    lines.push("");
  }

  if (failed.length > 0) {
    lines.push("**Failed Tasks:**");
    for (const v of failed) {
      const req = v.required ? "[required]" : "[optional]";
      const gt = v.groundTruthContradiction
        ? " ⚠ GROUND TRUTH CONTRADICTION — your claim was checked against real API data and did not match"
        : "";
      lines.push(`  ✗ ${v.action} ${req} — ${v.reason}${gt}`);
    }
    lines.push("");
  }

  if (unclear.length > 0) {
    lines.push("**Unclear:**");
    for (const v of unclear) {
      lines.push(`  ? ${v.action} — ${v.reason}`);
    }
    lines.push("");
  }

  // Score impact
  const arrow = feedback.trend === "up" ? "↑" : feedback.trend === "down" ? "↓" : "→";
  lines.push("**Score Impact:**");
  lines.push(
    `  ${feedback.pointsDelta >= 0 ? "+" : ""}${feedback.pointsDelta} points → Score: ${feedback.scoreAfter} / ${feedback.target}`,
  );
  lines.push(`  7-day average: ${feedback.rollingAvg7d} ${arrow}`);
  if (feedback.streak > 0) {
    lines.push(`  Streak: ${feedback.streak} day${feedback.streak > 1 ? "s" : ""}`);
  }
  lines.push("");

  // Reflection prompt — trigger the agent to internalize and improve
  if (failed.length > 0) {
    lines.push("**Reflection Required:**");
    lines.push("You had failures in the last cycle. Before proceeding with this cycle:");
    lines.push("1. What pattern do you notice in the failures above?");
    lines.push("2. What will you do differently THIS cycle to avoid repeating them?");
    lines.push(
      "3. Use `memory_reflect` to record your analysis — this becomes part of your learning.",
    );
    lines.push("");
  } else if (feedback.pointsDelta > 0) {
    lines.push("**Note:** Clean cycle — all tasks verified. Maintain this standard.");
    lines.push("");
  }

  return lines.join("\n");
}
