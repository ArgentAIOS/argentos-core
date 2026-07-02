/**
 * Worker grading rollups + promotion gate (WR2 D10).
 *
 * Pure math over append-only GradeEvents — no I/O. The gate INFORMS the
 * operator; it never auto-promotes (the operator flips the stage).
 *
 * Gate numbers LOCKED 2026-06-11 (Jason, calibrated in live Pi operation):
 * ≥95% correct over ≥50 graded decisions, sustained 2 weeks. Exact integer
 * math: `correct * 100 >= total * 95` — no floating point at the boundary.
 *
 * "Sustained" = the passing condition (both count and rate) became true at
 * some event and has remained true through every event since. Any event
 * that drops the rate below the bar resets the clock.
 */

import type { GradeEvent, GradeVerdict } from "../data/types.js";

export const PROMOTION_GATE = {
  minGraded: 50,
  minCorrectPct: 95,
  sustainDays: 14,
} as const;

const SUSTAIN_MS = PROMOTION_GATE.sustainDays * 24 * 60 * 60 * 1000;

export interface ScorecardRow {
  component: string;
  correct: number;
  needsChange: number;
  wrong: number;
  total: number;
  /** Integer percent, floored — matches the gate's exact-integer posture. */
  correctPct: number;
}

export interface Scorecard {
  totals: ScorecardRow;
  components: ScorecardRow[];
}

export interface PromotionGateStatus {
  eligible: boolean;
  /** Both thresholds currently satisfied (rate + count), regardless of sustain. */
  passingNow: boolean;
  gradedCount: number;
  correctCount: number;
  correctPct: number;
  /** Epoch ms when the current passing streak began; undefined when not passing. */
  sustainedSinceMs?: number;
  /** Epoch ms when the streak satisfies the sustain window; undefined when not passing. */
  eligibleAtMs?: number;
  gate: typeof PROMOTION_GATE;
  /** Operator-readable explanation of the current state. */
  reasons: string[];
}

function emptyRow(component: string): ScorecardRow {
  return { component, correct: 0, needsChange: 0, wrong: 0, total: 0, correctPct: 0 };
}

function tally(row: ScorecardRow, verdict: GradeVerdict): void {
  row.total++;
  if (verdict === "correct") row.correct++;
  else if (verdict === "needs_change") row.needsChange++;
  else row.wrong++;
  row.correctPct = row.total === 0 ? 0 : Math.floor((row.correct * 100) / row.total);
}

export function buildScorecard(events: GradeEvent[]): Scorecard {
  const totals = emptyRow("all");
  const byComponent = new Map<string, ScorecardRow>();
  for (const event of events) {
    tally(totals, event.verdict);
    let row = byComponent.get(event.component);
    if (!row) {
      row = emptyRow(event.component);
      byComponent.set(event.component, row);
    }
    tally(row, event.verdict);
  }
  const components = Array.from(byComponent.values()).sort((a, b) =>
    a.component.localeCompare(b.component),
  );
  return { totals, components };
}

function passes(correct: number, total: number): boolean {
  return total >= PROMOTION_GATE.minGraded && correct * 100 >= total * PROMOTION_GATE.minCorrectPct;
}

export function evaluatePromotionGate(events: GradeEvent[], nowMs: number): PromotionGateStatus {
  const ordered = [...events].sort((a, b) => a.createdAt - b.createdAt);
  let correct = 0;
  let total = 0;
  let sustainedSinceMs: number | undefined;
  for (const event of ordered) {
    total++;
    if (event.verdict === "correct") correct++;
    if (passes(correct, total)) {
      // Entering (or re-entering) the passing state starts the clock; while
      // already passing the original entry time stands.
      sustainedSinceMs ??= event.createdAt;
    } else {
      sustainedSinceMs = undefined;
    }
  }

  const passingNow = passes(correct, total);
  const correctPct = total === 0 ? 0 : Math.floor((correct * 100) / total);
  const eligibleAtMs =
    passingNow && sustainedSinceMs !== undefined ? sustainedSinceMs + SUSTAIN_MS : undefined;
  const eligible = eligibleAtMs !== undefined && nowMs >= eligibleAtMs;

  const reasons: string[] = [];
  if (total < PROMOTION_GATE.minGraded) {
    reasons.push(
      `needs ${PROMOTION_GATE.minGraded - total} more graded decisions (${total}/${PROMOTION_GATE.minGraded})`,
    );
  }
  if (total > 0 && correct * 100 < total * PROMOTION_GATE.minCorrectPct) {
    reasons.push(
      `correct rate ${correctPct}% is below the ${PROMOTION_GATE.minCorrectPct}% bar (${correct}/${total})`,
    );
  }
  if (passingNow && !eligible && eligibleAtMs !== undefined) {
    reasons.push(
      `passing — sustain until ${new Date(eligibleAtMs).toISOString()} (started ${new Date(sustainedSinceMs ?? nowMs).toISOString()})`,
    );
  }
  if (eligible) {
    reasons.push(
      `eligible for the next stage since ${new Date(eligibleAtMs ?? nowMs).toISOString()} — operator promotes via jobs.runs.review/jobs.assignments.update; the gate never auto-promotes`,
    );
  }

  return {
    eligible,
    passingNow,
    gradedCount: total,
    correctCount: correct,
    correctPct,
    sustainedSinceMs,
    eligibleAtMs,
    gate: PROMOTION_GATE,
    reasons,
  };
}

/**
 * Derive the gradable decision components of a run for one-click
 * approve-all (D10: feedback only, never executes anything).
 * Components: each distinct simulate-mode proposed_action tool, plus the
 * work report ("report") when the run carried one; a run with neither
 * grades as a single "run" component.
 */
export function gradableComponentsForRun(run: {
  events?: Array<{ type: string; detail?: Record<string, unknown> }>;
  summary?: string;
  metadata?: Record<string, unknown>;
}): string[] {
  const components = new Set<string>();
  for (const event of run.events ?? []) {
    if (event.type === "proposed_action") {
      const tool = typeof event.detail?.tool === "string" ? event.detail.tool : "unknown";
      components.add(`proposed_action:${tool}`);
    }
  }
  const hasReport =
    Boolean(run.summary) || Boolean((run.metadata as Record<string, unknown> | undefined)?.report);
  if (hasReport) {
    components.add("report");
  }
  if (components.size === 0) {
    components.add("run");
  }
  return Array.from(components).sort();
}
