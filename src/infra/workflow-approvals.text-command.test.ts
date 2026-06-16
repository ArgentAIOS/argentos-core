import { describe, expect, it } from "vitest";
import type { PendingWorkflowApprovalRow } from "./workflow-approvals.js";
import { selectApprovalForTextCommand } from "./workflow-approvals.js";

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
