/**
 * Kernel-fitness types — Phase 2 of HANDOFF-kernel-fitness.md.
 *
 * The fitness writer emits one `FitnessLedgerEntry` per measurement window
 * (default 1 hour). Pure data-plane: no LLM, no side effects beyond writing
 * `{agentDir}/kernel/fitness-ledger.jsonl`.
 *
 * The `engagement_*` fields are reserved for Phase 3; Phase 2 emits them as
 * `null` so the ledger schema is stable from day one.
 */

export type FitnessLedgerStallComponents = {
  /**
   * Fraction of reflections in the window that returned "unchanged" (i.e. the
   * kernel produced the same signature as the previous tick). Range [0, 1].
   * Higher = stalled.
   */
  reflectionRepeatRate: number;

  /**
   * Fraction of ticks where the executive cycle did NOT produce an action.
   * Derived as `1 - (executive_actions / ticks)` since the executive runs
   * once per tick and only emits `executive-action` ledger entries when it
   * actually acts. Conflates cooldown skips with no-intent skips — both are
   * "wasn't useful this tick" from the operator's perspective. Range [0, 1].
   * Higher = stalled.
   */
  executiveInactionRate: number;
};

export type FitnessLedgerEntry = {
  /** ISO timestamp of window start (inclusive). */
  windowStart: string;
  /** ISO timestamp of window end (exclusive). */
  windowEnd: string;
  /** Window length in seconds. */
  windowSeconds: number;

  /**
   * Weighted composite of stall signals. Range [0, 1] (or `null` if the
   * window has fewer than `minReflectionsForValidWindow` reflections — sparse
   * windows make the rates too noisy to trust). Lower = better.
   *
   * v0 (Phase 2) formula:
   *   stall = 0.7 * reflectionRepeatRate + 0.3 * executiveInactionRate
   *
   * The handoff's original 3-input formula included a concern-persistence
   * component. That requires reading self-state history which isn't in the
   * ledgers; deferred to Phase 2.5 / Phase 3 when an in-band concern tracker
   * lands.
   */
  stallComposite: number | null;
  /** Reason the composite is null, when applicable. */
  stallCompositeReason?: "low_sample" | "missing_data";

  /** Raw component values for the composite. */
  components: FitnessLedgerStallComponents;

  /** Raw counts so consumers can reconstruct the composite with different weights. */
  tickCount: number;
  reflectionCount: number;
  reflectionRepeatCount: number;
  executiveActionCount: number;
  conversationSyncCount: number;
  startedCount: number;
  stoppedCount: number;

  /** Engagement-rate fields — Phase 3 will populate these; Phase 2 emits null. */
  engagementRate: number | null;
  engagementRateReason?: "low_sample" | "missing_data" | "not_yet_instrumented";
  engagementCounts: {
    acted: number;
    acked: number;
    ignored: number;
    /** [EMPIRICAL 2026-05-24, locked decision #2 in HANDOFF Section 13] */
    systemUnavailable: number;
  };

  /** Identifies the scaffold revision in force during this window. */
  scaffoldVersion: string | null;
};

/**
 * Fitness writer configuration. Persisted at
 * `{agentDir}/kernel/fitness-config.json`. The kernel runner does NOT have a
 * write path to this file — changes require operator action (edit + restart).
 *
 * Defaults match the Section 13 locked decisions in HANDOFF-kernel-fitness.md.
 */
export type KernelFitnessConfig = {
  /** Window size in seconds. Locked at 1h (3600). */
  windowSeconds: number;
  /** Minimum reflection count in a window for the composite to be valid. */
  minReflectionsForValidWindow: number;
  /** Minimum engagement-event count for engagement_rate to be valid (Phase 3). */
  mMin: number;
  /** Number of windows the judge waits before keep-or-discard (Phase 4). */
  kWindows: number;
  /** Improvement threshold for keep-or-discard (Phase 4). */
  delta: number;
  /** Component weights for the stall composite. Must sum to 1.0. */
  weights: {
    reflectionRepeat: number;
    executiveInaction: number;
  };
};

export const DEFAULT_KERNEL_FITNESS_CONFIG: KernelFitnessConfig = {
  windowSeconds: 3600,
  minReflectionsForValidWindow: 5,
  mMin: 3,
  kWindows: 10,
  delta: 0.05,
  weights: {
    reflectionRepeat: 0.7,
    executiveInaction: 0.3,
  },
};

/**
 * Shape of a single decision-ledger.jsonl line that the fitness writer cares
 * about. We don't import the kernel's own ledger types because the writer is
 * intentionally read-only and parses the ledger as untyped JSON to stay
 * decoupled from the kernel's internal structure.
 */
export type DecisionLedgerLine = {
  seq?: number;
  ts?: string;
  kind?: string;
  summary?: string;
  active?: boolean;
};
