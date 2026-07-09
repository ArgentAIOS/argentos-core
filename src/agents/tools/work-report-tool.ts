/**
 * work_report — the execution-worker completion contract (Worker Runtime v2
 * D5, #443/#407).
 *
 * Workers prove progress by FILING A REPORT, not by mutating the task board:
 * the worker ends its turn with one work_report call, the execution-worker
 * runner reads the report and updates the board itself. This keeps read-only
 * SOPs honest ("zero board mutations") and gives small local models a single
 * well-known call to finish with.
 *
 * Reports land in an in-process registry keyed by run id; the runner takes
 * (and clears) the entry right after the agent turn returns. Reports filed
 * outside a worker run are accepted but never consumed — the registry is
 * capped so they age out.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { jsonResult } from "./common.js";

const log = createSubsystemLogger("tools/work-report");

export type WorkReportOutcome = "done" | "blocked" | "need_input";

export type WorkReport = {
  outcome: WorkReportOutcome;
  summary: string;
  evidence: string[];
  filedAt: number;
};

const MAX_PENDING_REPORTS = 50;

// The execution-worker runner is a standalone tsdown entry, so this module
// gets DUPLICATED across bundles — a plain module-level Map would give the
// tool and the runner separate registries. Anchor the store on globalThis
// (Symbol.for is process-wide) so every bundle copy shares one Map.
const REGISTRY_KEY = Symbol.for("argentos.workReportRegistry");

function registry(): Map<string, WorkReport> {
  const holder = globalThis as { [REGISTRY_KEY]?: Map<string, WorkReport> };
  holder[REGISTRY_KEY] ??= new Map<string, WorkReport>();
  return holder[REGISTRY_KEY];
}

function rememberReport(key: string, report: WorkReport) {
  const pending = registry();
  // Refresh insertion order so the cap evicts the oldest unconsumed entry.
  pending.delete(key);
  pending.set(key, report);
  while (pending.size > MAX_PENDING_REPORTS) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    pending.delete(oldest);
  }
}

/** Take (and clear) the report filed under this run key, if any. */
export function takeWorkReport(key: string | undefined): WorkReport | undefined {
  if (!key) {
    return undefined;
  }
  const pending = registry();
  const report = pending.get(key);
  pending.delete(key);
  return report;
}

/** Drop any stale report under this run key (runner calls before dispatch). */
export function clearWorkReport(key: string | undefined): void {
  if (key) {
    registry().delete(key);
  }
}

const WorkReportSchema = Type.Object({
  outcome: Type.Union([Type.Literal("done"), Type.Literal("blocked"), Type.Literal("need_input")], {
    description:
      '"done" = the assigned work is finished. "blocked" = you cannot proceed (say why in summary). "need_input" = a human decision is required before continuing.',
  }),
  summary: Type.String({
    description:
      "The deliverable. Everything the operator should read: what you did, what you found, your full output (e.g. the triage log and reply drafts). Be complete — this is the record of the run.",
  }),
  evidence: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Short concrete evidence items backing the summary (task ids you examined, counts, key facts).",
    }),
  ),
});

export function createWorkReportTool(opts?: {
  /** Run id of the agent turn — the key the execution worker consumes. */
  runId?: string;
  /** Session key fallback when no run id is available. */
  sessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Work Report",
    name: "work_report",
    description:
      "File your end-of-run work report. REQUIRED final step of every execution-worker run: " +
      "call this exactly once when your assigned work is done (or blocked), with the complete " +
      "results in `summary`. Do NOT modify your own task on the board — filing this report IS " +
      "how the run completes.",
    parameters: WorkReportSchema,
    execute: async (_toolCallId, params) => {
      // Never throw: a thrown tool error reads as "tool unavailable" to small
      // local models. Missing fields get an instructive retry message instead.
      const args = (params ?? {}) as Record<string, unknown>;
      const outcomeRaw = typeof args.outcome === "string" ? args.outcome.trim() : "";
      const outcome: WorkReportOutcome =
        outcomeRaw === "blocked" || outcomeRaw === "need_input" ? outcomeRaw : "done";
      const summary = typeof args.summary === "string" ? args.summary.trim() : "";
      if (!summary) {
        log.warn("work_report called without a summary; asking the model to retry");
        return jsonResult({
          ok: false,
          error:
            "summary is required. Call work_report again with your COMPLETE results (the full deliverable) in the summary field.",
        });
      }
      const evidence = Array.isArray(args.evidence)
        ? args.evidence.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
        : [];
      // File under EVERY key this tool instance knows: cached agent sessions
      // can hold a stale runId closure from the run that created the session,
      // so the session key is the reliable rendezvous with the runner.
      const keys = [opts?.runId?.trim(), opts?.sessionKey?.trim()].filter(
        (value): value is string => Boolean(value),
      );
      const report: WorkReport = { outcome, summary, evidence, filedAt: Date.now() };
      for (const key of keys) {
        rememberReport(key, report);
      }
      log.info(
        `work_report filed: outcome=${outcome} keys=[${keys.join(", ")}] summaryChars=${summary.length}`,
      );
      return jsonResult({
        ok: true,
        recorded: keys.length > 0,
        outcome,
        note: "Report filed. Do not modify the task board — the runner records the outcome.",
      });
    },
  };
}
