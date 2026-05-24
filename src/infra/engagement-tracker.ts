/**
 * Engagement tracker — Phase 3a of HANDOFF-kernel-fitness.md.
 *
 * Pure data-plane: append-only log of (a) surfaces the kernel emitted to the
 * operator and (b) outcomes the operator (or system) produced against them.
 * Lives at `{agentDir}/kernel/engagement-ledger.jsonl`.
 *
 * Phase 3a (this module): the primitives — record functions, outcome shapes,
 * and a window-bounded count helper that the fitness writer calls. Includes
 * an implicit-ignore sweep so unresolved surfaces older than the timeout
 * threshold count as `ignored` automatically (no separate sweeper job needed).
 *
 * Phase 3b (followup): integration with consciousness-kernel-notifier (so
 * real kernel-driven surfaces emit `surface_emitted` events), gateway-shutdown
 * hook for `system_unavailable`, dashboard ack/dismiss buttons that call
 * `recordEngagement`, and artifact-open fs.watch detection.
 *
 * Outcomes per HANDOFF Section 4.1 + Revision 2 locked decision #2:
 *   - `acted`              — operator engaged with the specific surface
 *   - `acked`              — operator dismissed without action
 *   - `ignored`            — N hours passed with no engagement AND gateway was up
 *   - `system_unavailable` — gateway went down before the timeout window elapsed.
 *                            Counted SEPARATELY from `ignored` so the engagement
 *                            rate denominator stays honest. Tracked but not
 *                            folded into the rate.
 */

import fs from "node:fs";

export type EngagementOutcome = "acted" | "acked" | "ignored" | "system_unavailable";

export type EngagementSource =
  | "dashboard_click"
  | "artifact_file_open"
  | "reply_in_conversation"
  | "timeout"
  | "gateway_shutdown";

/** Default N-hour cutoff after which an unresolved surface is implicitly `ignored`. */
export const DEFAULT_ENGAGEMENT_TIMEOUT_HOURS = 24;

export type EngagementLedgerEntry =
  | {
      type: "surface_emitted";
      surfaceId: string;
      agentId: string;
      ts: string;
      /** Optional opaque payload — kind/title/etc. — for debugging and future analytics. */
      payload?: Record<string, unknown>;
    }
  | {
      type: "outcome";
      surfaceId: string;
      outcome: EngagementOutcome;
      source: EngagementSource;
      ts: string;
      /** For `system_unavailable`, how long the surface was visible before shutdown. */
      aliveSeconds?: number;
    };

export type EngagementCounts = {
  acted: number;
  acked: number;
  ignored: number;
  systemUnavailable: number;
};

export function emptyEngagementCounts(): EngagementCounts {
  return { acted: 0, acked: 0, ignored: 0, systemUnavailable: 0 };
}

export function recordSurfaceEmitted(params: {
  ledgerPath: string;
  surfaceId: string;
  agentId: string;
  ts: string;
  payload?: Record<string, unknown>;
}): void {
  const entry: EngagementLedgerEntry = {
    type: "surface_emitted",
    surfaceId: params.surfaceId,
    agentId: params.agentId,
    ts: params.ts,
    payload: params.payload,
  };
  appendEngagementEntry(params.ledgerPath, entry);
}

export function recordEngagement(params: {
  ledgerPath: string;
  surfaceId: string;
  outcome: EngagementOutcome;
  source: EngagementSource;
  ts: string;
  aliveSeconds?: number;
}): void {
  const entry: EngagementLedgerEntry = {
    type: "outcome",
    surfaceId: params.surfaceId,
    outcome: params.outcome,
    source: params.source,
    ts: params.ts,
    aliveSeconds: params.aliveSeconds,
  };
  appendEngagementEntry(params.ledgerPath, entry);
}

export type ComputeEngagementOptions = {
  ledgerPath: string;
  windowStart: Date;
  windowEnd: Date;
  /**
   * Hours after which an unresolved surface implicitly counts as `ignored`.
   * Default 24 per HANDOFF Section 6 Phase 3. Set to 0 to disable implicit
   * ignore (only explicit outcomes count).
   */
  timeoutHours?: number;
  /** Clock for tests; production uses `() => new Date()`. */
  now?: () => Date;
};

/**
 * Count engagement outcomes that resolved (or implicitly resolved via timeout)
 * within the window. The "resolution time" is the outcome timestamp for
 * explicit outcomes, or `emission_ts + timeoutHours` for implicit ignores.
 *
 * Surfaces with multiple recorded outcomes use the FIRST (earliest) outcome —
 * operators can't un-act on a surface. system_unavailable from gateway
 * shutdown is still counted even when emitted after another outcome, because
 * the system being down is its own signal that needs to be tracked.
 *
 * Implicit-ignore logic: if a surface was emitted, has no explicit outcome,
 * AND `emission_ts + timeoutHours <= now`, it counts as `ignored` resolved
 * at `emission_ts + timeoutHours`. This avoids needing a separate sweeper
 * job — counting time IS the sweep.
 */
export function computeEngagementCountsInWindow(opts: ComputeEngagementOptions): EngagementCounts {
  const counts = emptyEngagementCounts();
  if (!fs.existsSync(opts.ledgerPath)) {
    return counts;
  }
  const timeoutMs = (opts.timeoutHours ?? DEFAULT_ENGAGEMENT_TIMEOUT_HOURS) * 60 * 60 * 1000;
  const now = (opts.now ?? (() => new Date()))().getTime();
  const startMs = opts.windowStart.getTime();
  const endMs = opts.windowEnd.getTime();

  const emissions = new Map<string, number>(); // surfaceId -> emission ts (ms)
  const outcomes = new Map<string, { outcome: EngagementOutcome; tsMs: number }>();
  const systemUnavailableExtras: { surfaceId: string; tsMs: number }[] = [];

  for (const entry of readEngagementEntries(opts.ledgerPath)) {
    const tsMs = entry.ts ? Date.parse(entry.ts) : Number.NaN;
    if (!Number.isFinite(tsMs)) continue;
    if (entry.type === "surface_emitted") {
      // Keep the earliest emission timestamp per surfaceId; duplicates are
      // odd but defensively tolerated.
      const existing = emissions.get(entry.surfaceId);
      if (existing === undefined || tsMs < existing) {
        emissions.set(entry.surfaceId, tsMs);
      }
    } else if (entry.type === "outcome") {
      const existing = outcomes.get(entry.surfaceId);
      if (entry.outcome === "system_unavailable") {
        // Track system_unavailable as a separate signal — it counts even if
        // an earlier outcome already exists (operator might have acked then
        // gateway went down before further interaction).
        systemUnavailableExtras.push({ surfaceId: entry.surfaceId, tsMs });
      } else if (!existing || tsMs < existing.tsMs) {
        outcomes.set(entry.surfaceId, { outcome: entry.outcome, tsMs });
      }
    }
  }

  // Explicit outcomes that resolved within the window.
  for (const [surfaceId, { outcome, tsMs }] of outcomes) {
    if (tsMs < startMs || tsMs >= endMs) continue;
    if (outcome === "acted") counts.acted++;
    else if (outcome === "acked") counts.acked++;
    else if (outcome === "ignored") counts.ignored++;
    // system_unavailable handled separately below; outcome can't be it here
    // because we filtered it out above.
    void surfaceId;
  }

  // Implicit-ignore: surfaces emitted but never explicitly resolved whose
  // timeout deadline falls within this window.
  if (timeoutMs > 0) {
    for (const [surfaceId, emissionMs] of emissions) {
      if (outcomes.has(surfaceId)) continue;
      const deadlineMs = emissionMs + timeoutMs;
      // Only count if the deadline has already passed by `now` AND falls in
      // the window.
      if (deadlineMs > now) continue;
      if (deadlineMs < startMs || deadlineMs >= endMs) continue;
      counts.ignored++;
    }
  }

  // system_unavailable counted separately, not folded into the engagement_rate
  // denominator.
  for (const { tsMs } of systemUnavailableExtras) {
    if (tsMs < startMs || tsMs >= endMs) continue;
    counts.systemUnavailable++;
  }

  return counts;
}

function readEngagementEntries(ledgerPath: string): EngagementLedgerEntry[] {
  try {
    const raw = fs.readFileSync(ledgerPath, "utf-8");
    const entries: EngagementLedgerEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line) as EngagementLedgerEntry);
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function appendEngagementEntry(ledgerPath: string, entry: EngagementLedgerEntry): void {
  fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, "utf-8");
}
