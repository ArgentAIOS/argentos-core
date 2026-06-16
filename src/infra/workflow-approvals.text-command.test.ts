import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalTextCommandDeps, PendingWorkflowApprovalRow } from "./workflow-approvals.js";
import { runApprovalTextCommand, selectApprovalForTextCommand } from "./workflow-approvals.js";

function row(id: string, runId: string, name = "WF"): PendingWorkflowApprovalRow {
  return {
    id,
    run_id: runId,
    node_id: "approval",
    workflow_name: name,
    node_label: "Approve",
    message: "Approve?",
    requested_at: "2026-06-16T12:00:00.000Z",
  };
}

describe("selectApprovalForTextCommand", () => {
  it("no token, zero pending → none", () => {
    expect(selectApprovalForTextCommand([])).toEqual({ kind: "none" });
  });

  it("no token, exactly one pending → resolve it", () => {
    const r = row("approval-aaa-approval", "aaaaaaaa-1111");
    expect(selectApprovalForTextCommand([r])).toEqual({ kind: "resolve", row: r });
  });

  it("no token, many pending → ambiguous (lists them)", () => {
    const rows = [row("approval-a-approval", "aaaa1111"), row("approval-b-approval", "bbbb2222")];
    expect(selectApprovalForTextCommand(rows)).toEqual({ kind: "ambiguous", rows });
  });

  it("token matching a run-id prefix → resolve that one", () => {
    const rows = [row("approval-a-approval", "aaaa1111"), row("approval-b-approval", "bbbb2222")];
    expect(selectApprovalForTextCommand(rows, "bbbb")).toEqual({ kind: "resolve", row: rows[1] });
  });

  it("token matching an exact approval id → resolve that one", () => {
    const rows = [row("approval-a-approval", "aaaa1111"), row("approval-b-approval", "bbbb2222")];
    expect(selectApprovalForTextCommand(rows, "approval-b-approval")).toEqual({
      kind: "resolve",
      row: rows[1],
    });
  });

  it("token matching nothing → not-found", () => {
    const rows = [row("approval-a-approval", "aaaa1111")];
    expect(selectApprovalForTextCommand(rows, "zzzz")).toEqual({
      kind: "not-found",
      token: "zzzz",
    });
  });

  it("token matching multiple → ambiguous", () => {
    const rows = [row("approval-a-approval", "aaaa1111"), row("approval-a2-approval", "aaaa2222")];
    // both run_ids start with "aaaa"
    const result = selectApprovalForTextCommand(rows, "aaaa");
    expect(result.kind).toBe("ambiguous");
  });
});

const FAKE_SQL = {} as unknown as Sql;

function makeDeps(
  pending: PendingWorkflowApprovalRow[],
  overrides: Partial<ApprovalTextCommandDeps> = {},
): ApprovalTextCommandDeps {
  return {
    listPending: vi.fn(async () => pending),
    // mirrors resolveDurableWorkflowApprovalById: returns the row when it was
    // still pending (UPDATE ... SET status=approved/denied matched a row).
    resolveById: vi.fn(async (_sql, input) => ({
      run_id: pending.find((p) => p.id === input.approvalId)?.run_id ?? "run-x",
      node_id: "approval",
    })),
    hasPendingApproval: vi.fn(() => false),
    resolveInMemory: vi.fn(),
    resumeRun: vi.fn(),
    ...overrides,
  };
}

describe("runApprovalTextCommand (resolve + resume wiring)", () => {
  it("approve with exactly one pending → resolves (approved=true) and resumes the run", async () => {
    const pending = [row("approval-r1-approval", "run-1111", "Daily SaaS Radar")];
    const deps = makeDeps(pending);
    const result = await runApprovalTextCommand({
      sql: FAKE_SQL,
      approved: true,
      operatorLabel: "@jason",
      deps,
    });

    expect(result.outcome).toBe("resolved");
    expect(result.runId).toBe("run-1111");
    expect(result.reply).toContain("✅ Approved");
    // The DB transition: resolveById is the UPDATE ... SET status='approved'.
    expect(deps.resolveById).toHaveBeenCalledWith(
      FAKE_SQL,
      expect.objectContaining({ approvalId: "approval-r1-approval", approved: true }),
    );
    // Durable run (not in-memory) → resume path.
    expect(deps.resumeRun).toHaveBeenCalledWith("run-1111", "approval");
    expect(deps.resolveInMemory).not.toHaveBeenCalled();
  });

  it("deny is symmetric → resolves with approved=false", async () => {
    const pending = [row("approval-r1-approval", "run-1111")];
    const deps = makeDeps(pending);
    const result = await runApprovalTextCommand({
      sql: FAKE_SQL,
      approved: false,
      operatorLabel: "@jason",
      deps,
    });

    expect(result.outcome).toBe("resolved");
    expect(result.reply).toContain("❌ Denied");
    expect(deps.resolveById).toHaveBeenCalledWith(
      FAKE_SQL,
      expect.objectContaining({ approved: false }),
    );
    expect(deps.resumeRun).toHaveBeenCalledTimes(1);
  });

  it("in-process pending run → resolves in memory, no durable resume", async () => {
    const pending = [row("approval-r1-approval", "run-1111")];
    const deps = makeDeps(pending, { hasPendingApproval: vi.fn(() => true) });
    const result = await runApprovalTextCommand({
      sql: FAKE_SQL,
      approved: true,
      operatorLabel: "@jason",
      deps,
    });

    expect(result.outcome).toBe("resolved");
    expect(deps.resolveInMemory).toHaveBeenCalledWith("run-1111", "approval", true, undefined);
    expect(deps.resumeRun).not.toHaveBeenCalled();
  });

  it("multiple pending → lists choices, resolves nothing", async () => {
    const pending = [
      row("approval-a-approval", "aaaa1111"),
      row("approval-b-approval", "bbbb2222"),
    ];
    const deps = makeDeps(pending);
    const result = await runApprovalTextCommand({
      sql: FAKE_SQL,
      approved: true,
      operatorLabel: "@jason",
      deps,
    });

    expect(result.outcome).toBe("ambiguous");
    expect(result.reply).toContain("2 approvals are pending");
    expect(deps.resolveById).not.toHaveBeenCalled();
    expect(deps.resumeRun).not.toHaveBeenCalled();
  });

  it("zero pending → no-op reply, resolves nothing", async () => {
    const deps = makeDeps([]);
    const result = await runApprovalTextCommand({
      sql: FAKE_SQL,
      approved: true,
      operatorLabel: "@jason",
      deps,
    });

    expect(result.outcome).toBe("none");
    expect(result.reply).toContain("No workflow approvals are pending");
    expect(deps.resolveById).not.toHaveBeenCalled();
  });

  it("already-resolved between list and update → 'gone', no resume", async () => {
    const pending = [row("approval-r1-approval", "run-1111")];
    const deps = makeDeps(pending, { resolveById: vi.fn(async () => undefined) });
    const result = await runApprovalTextCommand({
      sql: FAKE_SQL,
      approved: true,
      operatorLabel: "@jason",
      deps,
    });

    expect(result.outcome).toBe("gone");
    expect(deps.resumeRun).not.toHaveBeenCalled();
  });
});
