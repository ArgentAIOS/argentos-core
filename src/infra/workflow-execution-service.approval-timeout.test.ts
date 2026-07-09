import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  denyWorkflowRunAfterApproval,
  resumeDueWorkflowWaits,
} from "./workflow-execution-service.js";

/**
 * Regression coverage for the durable-approval defects:
 *
 * 1. Approval timeouts were only enforced by an in-process setTimeout on the
 *    NON-durable path. Every gateway/cron run pauses durably, so the
 *    "auto-deny at <time>" advertised in the operator's Telegram message
 *    never fired — observed live 2026-07-02: 70 pending approvals, 61 past
 *    timeout_at, zero rows ever status='timed_out'. resumeDueWorkflowWaits
 *    now sweeps expired durable approvals.
 *
 * 2. There was no shared deny path for durable runs: the Telegram surfaces
 *    routed denials through resumeWorkflowRunAfterApproval, which re-executes
 *    the pipeline as APPROVED. denyWorkflowRunAfterApproval is the one deny
 *    path all surfaces must use.
 *
 * 3. The sweep fails CLOSED even for timeout_action='approve' — that flag is
 *    workflow-author-controlled (agents author workflows), so honoring it
 *    would auto-execute gated side effects with no operator involvement.
 *
 * 4. Approvals orphaned by runs that left waiting_approval through another
 *    path (cancel, fail) are swept to 'cancelled' so they stop polluting the
 *    pending list forever.
 */

type Row = Record<string, unknown>;

// Minimal tagged-template fake for the postgres client: routes each query by
// substring (first match wins, so order routes specific-first) and records
// what ran. A route may reject to simulate a DB failure.
function makeFakeSql(routes: Array<{ match: string; rows?: Row[]; reject?: string }>) {
  const executed: string[] = [];
  const sql = ((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join("$");
    executed.push(text);
    for (const route of routes) {
      if (text.includes(route.match)) {
        return route.reject
          ? Promise.reject(new Error(route.reject))
          : Promise.resolve(route.rows ?? []);
      }
    }
    return Promise.resolve([]);
  }) as unknown as Sql;
  return { sql, executed };
}

const EXPIRED_DENY_ROW = {
  id: "app-1",
  run_id: "run-1",
  node_id: "approval",
  timeout_action: "deny",
};

// Routes shared by sweep tests: no due duration/event waits, orphan query
// (distinguished by its terminal-status filter) empty unless overridden.
const BASE_ROUTES = [
  { match: "waiting_duration", rows: [] },
  { match: "waiting_event", rows: [] },
  { match: "IN ('cancelled', 'failed', 'completed')", rows: [] },
];

describe("denyWorkflowRunAfterApproval", () => {
  it("fails the run, denies the step, broadcasts completion", async () => {
    const { sql, executed } = makeFakeSql([
      { match: "UPDATE workflow_runs", rows: [{ workflow_id: "wf-1" }] },
    ]);
    const broadcast = vi.fn();

    const result = await denyWorkflowRunAfterApproval({
      sql,
      runId: "run-1",
      nodeId: "approval",
      reason: "Denied via Telegram inline button",
      broadcast,
    });

    expect(result).toEqual({
      denied: true,
      reason: "Denied via Telegram inline button",
      workflowId: "wf-1",
    });
    expect(executed.some((q) => q.includes("UPDATE workflow_runs") && q.includes("'failed'"))).toBe(
      true,
    );
    expect(
      executed.some((q) => q.includes("UPDATE workflow_step_runs") && q.includes("'denied'")),
    ).toBe(true);
    expect(broadcast).toHaveBeenCalledWith(
      "workflow.run.completed",
      expect.objectContaining({ runId: "run-1", status: "failed" }),
    );
  });

  it("run no longer waiting_approval → denied:false and NO completion broadcast", async () => {
    const { sql } = makeFakeSql([{ match: "UPDATE workflow_runs", rows: [] }]);
    const broadcast = vi.fn();
    const result = await denyWorkflowRunAfterApproval({
      sql,
      runId: "run-gone",
      nodeId: "approval",
      broadcast,
    });
    expect(result.denied).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe("resumeDueWorkflowWaits — expired durable approvals", () => {
  it("expired approval → claimed timed_out, run denied, counted as failed", async () => {
    const { sql, executed } = makeFakeSql([
      ...BASE_ROUTES,
      { match: "FROM workflow_approvals a", rows: [EXPIRED_DENY_ROW] },
      { match: "'timed_out'", rows: [{ id: "app-1" }] },
      { match: "UPDATE workflow_runs", rows: [{ workflow_id: "wf-1" }] },
    ]);
    const broadcast = vi.fn();

    const result = await resumeDueWorkflowWaits({ sql, broadcast });

    expect(result.failed).toBe(1);
    expect(result.resumed).toBe(0);
    expect(result.errors).toEqual([]);
    // The claim must be an atomic pending → timed_out transition.
    expect(
      executed.some((q) => q.includes("'timed_out'") && q.includes("status = 'pending'")),
    ).toBe(true);
    expect(broadcast).toHaveBeenCalledWith(
      "workflow.approval.resolved",
      expect.objectContaining({ approvalId: "app-1", approved: false, timedOut: true }),
    );
    expect(broadcast).toHaveBeenCalledWith(
      "workflow.run.completed",
      expect.objectContaining({ runId: "run-1", status: "failed" }),
    );
  });

  it("timeout_action='approve' fails CLOSED: denied, never resumed", async () => {
    const { sql, executed } = makeFakeSql([
      ...BASE_ROUTES,
      {
        match: "FROM workflow_approvals a",
        rows: [{ ...EXPIRED_DENY_ROW, timeout_action: "approve" }],
      },
      { match: "'timed_out'", rows: [{ id: "app-1" }] },
      { match: "UPDATE workflow_runs", rows: [{ workflow_id: "wf-1" }] },
    ]);
    const broadcast = vi.fn();

    const result = await resumeDueWorkflowWaits({ sql, broadcast });

    expect(result.failed).toBe(1);
    expect(result.resumed).toBe(0);
    // The resume path re-marks the run 'running' — it must never execute here.
    expect(executed.some((q) => q.includes("SET status = 'running'"))).toBe(false);
    expect(broadcast).toHaveBeenCalledWith(
      "workflow.approval.resolved",
      expect.objectContaining({ approvalId: "app-1", approved: false, timedOut: true }),
    );
  });

  it("deny failure after the claim → claim is compensated back to pending", async () => {
    const { sql, executed } = makeFakeSql([
      ...BASE_ROUTES,
      { match: "FROM workflow_approvals a", rows: [EXPIRED_DENY_ROW] },
      { match: "resolved_by = NULL", rows: [] }, // the un-claim (before generic timed_out match)
      { match: "'timed_out'", rows: [{ id: "app-1" }] },
      { match: "UPDATE workflow_runs", reject: "db exploded" },
    ]);
    const broadcast = vi.fn();

    const result = await resumeDueWorkflowWaits({ sql, broadcast });

    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("db exploded");
    // Compensation: status flipped back so the next sweep (or the operator)
    // can still act — otherwise the run is stranded in waiting_approval with
    // a terminal approval row no surface can touch.
    expect(executed.some((q) => q.includes("resolved_by = NULL"))).toBe(true);
    expect(broadcast).not.toHaveBeenCalledWith("workflow.approval.resolved", expect.anything());
  });

  it("claim lost to a racing resolver → approval untouched, nothing denied", async () => {
    const { sql, executed } = makeFakeSql([
      ...BASE_ROUTES,
      { match: "FROM workflow_approvals a", rows: [EXPIRED_DENY_ROW] },
      { match: "'timed_out'", rows: [] }, // someone else resolved it first
    ]);
    const broadcast = vi.fn();

    const result = await resumeDueWorkflowWaits({ sql, broadcast });

    expect(result.failed).toBe(0);
    expect(result.resumed).toBe(0);
    expect(broadcast).not.toHaveBeenCalled();
    expect(executed.some((q) => q.includes("UPDATE workflow_runs"))).toBe(false);
  });

  it("orphaned pending approvals (run already terminal) are swept to cancelled", async () => {
    const { sql, executed } = makeFakeSql([
      ...BASE_ROUTES.slice(0, 2),
      {
        match: "IN ('cancelled', 'failed', 'completed')",
        rows: [{ id: "app-orphan", run_id: "run-dead" }],
      },
      { match: "FROM workflow_approvals a", rows: [] },
    ]);
    const result = await resumeDueWorkflowWaits({ sql });

    expect(result.errors).toEqual([]);
    expect(
      executed.some(
        (q) =>
          q.includes("UPDATE workflow_approvals") &&
          q.includes("'cancelled'") &&
          q.includes("orphan"),
      ),
    ).toBe(true);
  });

  it("no expired approvals → no-op", async () => {
    const { sql } = makeFakeSql([...BASE_ROUTES, { match: "FROM workflow_approvals a", rows: [] }]);
    const broadcast = vi.fn();
    const result = await resumeDueWorkflowWaits({ sql, broadcast });
    expect(result).toEqual({ resumed: 0, failed: 0, errors: [] });
    expect(broadcast).not.toHaveBeenCalled();
  });
});
