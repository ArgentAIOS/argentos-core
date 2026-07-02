import type { WorkReportOutcome } from "../agents/tools/work-report-tool.js";
/**
 * D5/P4 — work_report × telemetry cross-check, and the stale-report guard.
 *
 * The runner decides a job task's fate from the filed work_report, but a report is
 * only *accepted* when it is consistent with what the run actually did, and only
 * when the runner still owns the task. Both checks are pure so the contract is
 * unit-testable without the full runner.
 */
import { EXTERNAL_ARTIFACT_TOOLS } from "../agents/tool-claim-validation.js";

/** True if the tool produces an external/world-visible artifact (write-capable). */
export function isExternalArtifactTool(tool: string): boolean {
  return (EXTERNAL_ARTIFACT_TOOLS as ReadonlySet<string>).has(tool);
}

/**
 * True if any granted tool is write-capable — i.e. the role *could* touch the
 * world. Read-only roles (e.g. the conductor triage demo: tasks/memory_recall/
 * work_report) return false, so the telemetry cross-check below never
 * false-rejects a legitimate "done with zero external writes" on them.
 */
export function grantsAreWriteCapable(grants: Iterable<string>): boolean {
  for (const grant of grants) {
    if (isExternalArtifactTool(grant)) return true;
  }
  return false;
}

export type WorkReportCrossCheck =
  | { accepted: true }
  | { accepted: false; reason: "report_telemetry_mismatch"; detail: string };

/**
 * Reject a `done` report that contradicts the run's telemetry: a LIVE-mode,
 * write-capable role that claims completion while having executed zero external
 * tools did no observable work. Read-only roles (not write-capable) and
 * non-`done` outcomes are always consistent — nothing to cross-check.
 */
export function crossCheckWorkReport(params: {
  outcome: WorkReportOutcome;
  isLiveMode: boolean;
  grantsWriteCapable: boolean;
  externalToolCount: number;
}): WorkReportCrossCheck {
  if (
    params.outcome === "done" &&
    params.isLiveMode &&
    params.grantsWriteCapable &&
    params.externalToolCount === 0
  ) {
    return {
      accepted: false,
      reason: "report_telemetry_mismatch",
      detail: "work_report(done) on a live write-capable role with zero external tool executions",
    };
  }
  return { accepted: true };
}

/**
 * A work_report is stale — the runner must NOT mutate the board from it — when
 * the task it targets is gone, cancelled, or no longer claimed by this run.
 * Losing the claim covers supersession (runNow fresh), lease takeover, and
 * cancellation in one invariant: only the current claim holder may complete.
 */
export function isStaleWorkReport(params: {
  currentTask: { status: string; claimedBy?: string } | null | undefined;
  workerRunId: string;
}): boolean {
  const task = params.currentTask;
  if (!task) return true;
  if (task.status === "cancelled") return true;
  if (task.claimedBy !== params.workerRunId) return true;
  return false;
}

/**
 * D9 × simulate-tripwire: the "external tools executed in simulate" tripwire
 * must fire only for calls that ESCAPED the D9 recording stub. Stubbed calls
 * appear in executed-tool telemetry (the worker can't tell the difference —
 * by design) but executed nothing; counting them blocked every simulate run
 * that recorded a proposal (first live D9 run, 2026-07-02). In simulate every
 * write-capable tool is wrapped, so a proposed_action for a tool proves its
 * calls were diverted.
 */
export function detectSimulationViolation(params: {
  simulateMode: boolean;
  externalToolsExecuted: string[];
  proposedActions: Array<{ tool: string }>;
}): { violation: boolean; escapedTools: string[] } {
  const proposedTools = new Set(params.proposedActions.map((proposed) => proposed.tool));
  const escapedTools = params.externalToolsExecuted.filter((tool) => !proposedTools.has(tool));
  return { violation: params.simulateMode && escapedTools.length > 0, escapedTools };
}
