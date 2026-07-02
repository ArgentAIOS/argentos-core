import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  denyWorkflowRunAfterApproval,
  resumeDueWorkflowWaits,
} from "./workflow-execution-service.js";

/**
 * Regression coverage for two related defects:
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
 */

type Row = Record<string, unknown>;

// Minimal tagged-template fake for the postgres client: routes each query by
// substring and records what ran.
function makeFakeSql(routes: Array<{ match: string; rows: Row[] }>) {
  const executed: string[] = [];
  const sql = ((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join("$");
    executed.push(text);
    for (const route of routes) {
      if (text.includes(route.match)) {
        return Promise.resolve(route.rows);
      }
    }
    return Promise.resolve([]);
  }) as unknown as Sql;
  return { sql, executed };
}

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

  it("run no longer waiting_approval → denied:false, still no resume anywhere", async () => {
    const { sql } = makeFakeSql([{ match: "UPDATE workflow_runs", rows: [] }]);
    const result = await denyWorkflowRunAfterApproval({
      sql,
      runId: "run-gone",
      nodeId: "approval",
    });
    expect(result.denied).toBe(false);
  });
});

describe("resumeDueWorkflowWaits — expired durable approvals", () => {
  it("expired timeout_action=deny approval → claimed timed_out, run denied, counted as failed", async () => {
    const { sql, executed } = makeFakeSql([
      { match: "waiting_duration", rows: [] },
      { match: "waiting_event", rows: [] },
      {
        match: "FROM workflow_approvals a",
        rows: [{ id: "app-1", run_id: "run-1", node_id: "approval", timeout_action: "deny" }],
      },
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

  it("claim lost to a racing resolver → approval untouched, nothing denied", async () => {
    const { sql, executed } = makeFakeSql([
      { match: "waiting_duration", rows: [] },
      { match: "waiting_event", rows: [] },
      {
        match: "FROM workflow_approvals a",
        rows: [{ id: "app-1", run_id: "run-1", node_id: "approval", timeout_action: "deny" }],
      },
      { match: "'timed_out'", rows: [] }, // someone else resolved it first
    ]);
    const broadcast = vi.fn();

    const result = await resumeDueWorkflowWaits({ sql, broadcast });

    expect(result.failed).toBe(0);
    expect(result.resumed).toBe(0);
    expect(broadcast).not.toHaveBeenCalled();
    expect(executed.some((q) => q.includes("UPDATE workflow_runs"))).toBe(false);
  });

  it("no expired approvals → no-op", async () => {
    const { sql } = makeFakeSql([
      { match: "waiting_duration", rows: [] },
      { match: "waiting_event", rows: [] },
      { match: "FROM workflow_approvals a", rows: [] },
    ]);
    const broadcast = vi.fn();
    const result = await resumeDueWorkflowWaits({ sql, broadcast });
    expect(result).toEqual({ resumed: 0, failed: 0, errors: [] });
    expect(broadcast).not.toHaveBeenCalled();
  });
});
