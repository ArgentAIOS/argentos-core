/**
 * Kernel-fitness writer — Phase 2 of HANDOFF-kernel-fitness.md.
 *
 * Pure data-plane code (no LLM, no kernel-side mutations). Reads the existing
 * kernel ledgers and emits one `FitnessLedgerEntry` per measurement window
 * to `{agentDir}/kernel/fitness-ledger.jsonl`.
 *
 * Structural rules (from the handoff):
 *   - The writer can ONLY write to `fitness-ledger.jsonl`. It does not touch
 *     self-state, the decision ledger, the scaffold, or any other kernel
 *     state. This is enforced by convention: the writer module's surface
 *     does not expose any non-fitness-ledger I/O.
 *   - Wired as a separate worker registration in the gateway, NOT as a hook
 *     inside the kernel main loop. This keeps fitness measurement decoupled
 *     from kernel ticking and prevents the kernel from accidentally seeing
 *     the fitness number (which would violate the "fitness never appears
 *     in the inner-loop prompt" rule).
 *   - Sparse windows emit `stallComposite: null` with reason `"low_sample"`
 *     so the kernel can't game the metric by reducing reflection volume.
 *
 * v0 stall composite formula (handoff Section 4.2's 3-input formula deferred
 * because concern-persistence requires self-state time-series which doesn't
 * exist in the ledgers yet):
 *
 *   stall = 0.7 * reflectionRepeatRate + 0.3 * executiveInactionRate
 *
 *   reflectionRepeatRate = (reflections with "unchanged" in summary)
 *                          / (total reflections in window)
 *   executiveInactionRate = 1 - (executive-action count / tick count)
 *
 * All raw counts are emitted in the ledger entry so future analysis can
 * reconstruct the composite with different weights or extended inputs.
 */

import fs from "node:fs";
import type {
  DecisionLedgerLine,
  FitnessLedgerEntry,
  KernelFitnessConfig,
} from "./kernel-fitness-types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { loadKernelFitnessConfig } from "./kernel-fitness-config.js";

const log = createSubsystemLogger("gateway/consciousness-kernel/fitness-writer");

const REPEAT_SUMMARY_PATTERN = /unchanged/i;

export type FitnessWriterPaths = {
  kernelRootDir: string;
  decisionLogPath: string;
  fitnessLedgerPath: string;
  innerLoopPromptPath: string;
};

export type FitnessWriterHandle = {
  stop: () => void;
  /**
   * Trigger an out-of-band window computation + write. Intended for tests and
   * for debugging; production code relies on the internal timer.
   */
  forceTick: () => void;
};

export type StartFitnessWriterOptions = {
  paths: FitnessWriterPaths;
  /**
   * Config override for tests. Production reads from `fitness-config.json`.
   */
  configOverride?: KernelFitnessConfig;
  /**
   * Clock for tests; production uses `() => new Date()`.
   */
  now?: () => Date;
};

/**
 * Start the fitness writer. Returns a handle the caller can use to stop it
 * (e.g. on gateway shutdown).
 *
 * The writer emits one entry every `windowSeconds` (default 3600). Each entry
 * covers the sliding window `[now - windowSeconds, now)`. v0 does not
 * back-fill missed windows after a restart — the next entry just starts
 * fresh from the new "now".
 */
export function startKernelFitnessWriter(opts: StartFitnessWriterOptions): FitnessWriterHandle {
  const now = opts.now ?? (() => new Date());
  const config = opts.configOverride ?? loadKernelFitnessConfig(opts.paths.kernelRootDir);

  const tick = () => {
    try {
      const endTime = now();
      const startTime = new Date(endTime.getTime() - config.windowSeconds * 1000);
      const entry = computeFitnessEntry({
        paths: opts.paths,
        config,
        windowStart: startTime,
        windowEnd: endTime,
      });
      appendFitnessEntry(opts.paths.fitnessLedgerPath, entry);
      log.info("fitness: emitted ledger entry", {
        windowStart: entry.windowStart,
        windowEnd: entry.windowEnd,
        stallComposite: entry.stallComposite,
        reflectionCount: entry.reflectionCount,
        tickCount: entry.tickCount,
      });
    } catch (err) {
      log.error(`fitness: tick failed: ${String(err)}`);
    }
  };

  const intervalMs = config.windowSeconds * 1000;
  const handle = setInterval(tick, intervalMs);
  // Allow the process to exit even if the writer is still scheduled.
  handle.unref?.();

  return {
    stop: () => clearInterval(handle),
    forceTick: tick,
  };
}

export type ComputeFitnessEntryOptions = {
  paths: Pick<FitnessWriterPaths, "decisionLogPath" | "innerLoopPromptPath">;
  config: KernelFitnessConfig;
  windowStart: Date;
  windowEnd: Date;
};

/**
 * Pure-function fitness-entry computation. Reads the decision ledger and
 * optionally inspects the inner-loop-prompt file mtime to derive
 * `scaffoldVersion`. Exposed for tests.
 */
export function computeFitnessEntry(opts: ComputeFitnessEntryOptions): FitnessLedgerEntry {
  const { windowStart, windowEnd, config } = opts;
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();

  const counts = countDecisionLedgerKindsInWindow(opts.paths.decisionLogPath, startMs, endMs);

  const reflectionRepeatRate =
    counts.reflection > 0 ? counts.reflectionRepeat / counts.reflection : 0;
  const executiveInactionRate =
    counts.tick > 0 ? 1 - Math.min(counts.executiveAction, counts.tick) / counts.tick : 0;

  const validSample = counts.reflection >= config.minReflectionsForValidWindow;
  let stallComposite: number | null;
  let stallCompositeReason: FitnessLedgerEntry["stallCompositeReason"];

  if (!validSample) {
    stallComposite = null;
    stallCompositeReason = "low_sample";
  } else {
    stallComposite =
      config.weights.reflectionRepeat * reflectionRepeatRate +
      config.weights.executiveInaction * executiveInactionRate;
    // Clamp to [0, 1] defensively. With well-behaved weights summing to 1 and
    // rates already in [0, 1], the composite is naturally in [0, 1], but if
    // an operator sets pathological weights we don't want to surface nonsense.
    stallComposite = Math.max(0, Math.min(1, stallComposite));
  }

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    windowSeconds: config.windowSeconds,
    stallComposite,
    stallCompositeReason,
    components: {
      reflectionRepeatRate,
      executiveInactionRate,
    },
    tickCount: counts.tick,
    reflectionCount: counts.reflection,
    reflectionRepeatCount: counts.reflectionRepeat,
    executiveActionCount: counts.executiveAction,
    conversationSyncCount: counts.conversationSync,
    startedCount: counts.started,
    stoppedCount: counts.stopped,
    engagementRate: null,
    engagementRateReason: "not_yet_instrumented",
    engagementCounts: { acted: 0, acked: 0, ignored: 0, systemUnavailable: 0 },
    scaffoldVersion: resolveScaffoldVersion(opts.paths.innerLoopPromptPath),
  };
}

type LedgerKindCounts = {
  tick: number;
  reflection: number;
  reflectionRepeat: number;
  executiveAction: number;
  conversationSync: number;
  started: number;
  stopped: number;
};

function emptyCounts(): LedgerKindCounts {
  return {
    tick: 0,
    reflection: 0,
    reflectionRepeat: 0,
    executiveAction: 0,
    conversationSync: 0,
    started: 0,
    stopped: 0,
  };
}

function countDecisionLedgerKindsInWindow(
  decisionLogPath: string,
  startMs: number,
  endMs: number,
): LedgerKindCounts {
  const counts = emptyCounts();
  if (!fs.existsSync(decisionLogPath)) {
    return counts;
  }
  // Read the full file. The kernel emits a few entries per tick — at the
  // default 2-minute cadence that's ~30 entries per hour, ~720 per day. Even
  // a year of data is well under 1MB. If this ever grows past 10MB, switch
  // to a streaming tail read.
  const raw = fs.readFileSync(decisionLogPath, "utf-8");
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line) continue;
    let parsed: DecisionLedgerLine;
    try {
      parsed = JSON.parse(line) as DecisionLedgerLine;
    } catch {
      continue;
    }
    if (typeof parsed.ts !== "string") continue;
    const ts = Date.parse(parsed.ts);
    if (!Number.isFinite(ts) || ts < startMs || ts >= endMs) continue;
    switch (parsed.kind) {
      case "tick":
        counts.tick++;
        break;
      case "reflection":
        counts.reflection++;
        if (typeof parsed.summary === "string" && REPEAT_SUMMARY_PATTERN.test(parsed.summary)) {
          counts.reflectionRepeat++;
        }
        break;
      case "executive-action":
        counts.executiveAction++;
        break;
      case "conversation-sync":
        counts.conversationSync++;
        break;
      case "started":
        counts.started++;
        break;
      case "stopped":
        counts.stopped++;
        break;
      default:
        // Other kinds (contemplation-dispatch, sis-dispatch, etc.) are
        // intentionally ignored in v0. Future versions can fold them in.
        break;
    }
  }
  return counts;
}

function resolveScaffoldVersion(innerLoopPromptPath: string): string | null {
  try {
    const stat = fs.statSync(innerLoopPromptPath);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

function appendFitnessEntry(ledgerPath: string, entry: FitnessLedgerEntry): void {
  fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, "utf-8");
}
