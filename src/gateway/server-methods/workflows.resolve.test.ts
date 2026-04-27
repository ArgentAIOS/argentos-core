import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { resolveRunnableWorkflowRow, workflowRowWithCanvasOverride } from "./workflows.js";

type WorkflowSql = ReturnType<typeof postgres>;

function fakeWorkflowSql(results: unknown[][]): WorkflowSql {
  const sql = vi.fn(async () => results.shift() ?? []);
  return sql as unknown as WorkflowSql;
}

describe("resolveRunnableWorkflowRow", () => {
  it("resolves an active workflow by id before trying names", async () => {
    const sql = fakeWorkflowSql([[{ id: "wf-1", name: "Daily Summary", is_active: true }]]);

    const result = await resolveRunnableWorkflowRow(sql, { workflowId: "wf-1" });

    expect(result).toMatchObject({
      ok: true,
      workflowId: "wf-1",
      resolvedBy: "id",
    });
    expect(vi.mocked(sql)).toHaveBeenCalledTimes(1);
  });

  it("falls back to exact workflow name when workflowId is a human name", async () => {
    const sql = fakeWorkflowSql([[], [{ id: "wf-daily", name: "Daily Summary", is_active: true }]]);

    const result = await resolveRunnableWorkflowRow(sql, { workflowId: "Daily Summary" });

    expect(result).toMatchObject({
      ok: true,
      workflowId: "wf-daily",
      resolvedBy: "name",
    });
    expect(vi.mocked(sql)).toHaveBeenCalledTimes(2);
  });

  it("accepts workflowName without a workflowId", async () => {
    const sql = fakeWorkflowSql([[{ id: "wf-vip", name: "VIP Email Alert", is_active: true }]]);

    const result = await resolveRunnableWorkflowRow(sql, { workflowName: "VIP Email Alert" });

    expect(result).toMatchObject({
      ok: true,
      workflowId: "wf-vip",
      resolvedBy: "name",
    });
    expect(vi.mocked(sql)).toHaveBeenCalledTimes(1);
  });

  it("rejects ambiguous active workflow names", async () => {
    const sql = fakeWorkflowSql([
      [
        { id: "wf-1", name: "Daily Summary", is_active: true },
        { id: "wf-2", name: "Daily Summary", is_active: true },
      ],
    ]);

    const result = await resolveRunnableWorkflowRow(sql, { workflowName: "Daily Summary" });

    expect(result).toEqual({
      ok: false,
      error: 'Multiple active workflows are named "Daily Summary". Use a workflow ID.',
    });
  });

  it("returns a user-facing error when no id or name is provided", async () => {
    const sql = fakeWorkflowSql([]);

    const result = await resolveRunnableWorkflowRow(sql, {});

    expect(result).toEqual({
      ok: false,
      error: "workflowId or workflowName is required",
    });
    expect(vi.mocked(sql)).not.toHaveBeenCalled();
  });
});

describe("workflowRowWithCanvasOverride", () => {
  it("uses the fresh canvas payload for same-click run validation", () => {
    const row = {
      id: "wf-stale",
      name: "Stale Workflow",
      nodes: [],
      edges: [],
      canvas_layout: { nodes: [], edges: [] },
      deployment_stage: "simulate" as const,
    };

    const next = workflowRowWithCanvasOverride(row, {
      canvasData: {
        nodes: [
          { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
          { id: "out", type: "output", data: { target: "doc_panel", title: "Result" } },
        ],
        edges: [{ id: "e1", source: "trigger", target: "out" }],
      },
      deploymentStage: "simulate",
    });

    expect(next.nodes?.map((node) => (node as { kind?: string }).kind)).toEqual([
      "trigger",
      "output",
    ]);
    expect(next.canvas_layout).toMatchObject({
      nodes: [
        { id: "trigger", type: "trigger" },
        { id: "out", type: "output" },
      ],
    });
  });
});
