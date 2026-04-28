import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  derivedWorkflowTrigger,
  resolveRunnableWorkflowRow,
  workflowRowWithCanvasOverride,
} from "./workflows.js";

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

    const next = workflowRowWithCanvasOverride(
      row as unknown as Parameters<typeof workflowRowWithCanvasOverride>[0],
      {
        canvasData: {
          nodes: [
            { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
            { id: "out", type: "output", data: { target: "doc_panel", title: "Result" } },
          ],
          edges: [{ id: "e1", source: "trigger", target: "out" }],
        },
        deploymentStage: "simulate",
      },
    );

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

  it("uses a canonical definition payload when save params do not include flat nodes", () => {
    const row = {
      id: "wf-empty",
      name: "Empty Saved Workflow",
      nodes: [],
      edges: [],
      canvas_layout: { nodes: [], edges: [] },
      deployment_stage: "live" as const,
    };

    const next = workflowRowWithCanvasOverride(row, {
      definition: {
        nodes: [
          { id: "trigger", kind: "trigger", triggerType: "manual", config: {} },
          {
            id: "agent",
            kind: "agent",
            label: "Research",
            config: {
              agentId: "argent",
              rolePrompt: "Research businesses in the 712 area code.",
              timeoutMs: 300000,
              evidenceRequired: true,
            },
          },
          {
            id: "out",
            kind: "output",
            label: "Results",
            config: { outputType: "docpanel", title: "Results" },
          },
        ],
        edges: [
          { id: "e-trigger-agent", source: "trigger", target: "agent" },
          { id: "e-agent-out", source: "agent", target: "out" },
        ],
        deploymentStage: "live",
      },
      canvasLayout: {
        nodes: [
          { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
          { id: "agent", type: "agentStep", data: { prompt: "Research businesses." } },
          { id: "out", type: "output", data: { target: "doc_panel", title: "Results" } },
        ],
        edges: [
          { id: "e-trigger-agent", source: "trigger", target: "agent" },
          { id: "e-agent-out", source: "agent", target: "out" },
        ],
      },
    });

    expect(next.nodes?.map((node) => (node as { kind?: string }).kind)).toEqual([
      "trigger",
      "agent",
      "output",
    ]);
    expect(next.edges).toHaveLength(2);
    expect(next.canvas_layout).toMatchObject({
      nodes: [
        { id: "trigger", type: "trigger" },
        { id: "agent", type: "agentStep" },
        { id: "out", type: "output" },
      ],
      edges: [
        { id: "e-trigger-agent", source: "trigger", target: "agent" },
        { id: "e-agent-out", source: "agent", target: "out" },
      ],
    });
  });

  it("uses legacy JSON-string graph columns as fallback data for same-click overrides", () => {
    const row = {
      id: "wf-string-graph",
      name: "String Graph Workflow",
      nodes: JSON.stringify([
        { id: "trigger", kind: "trigger", triggerType: "manual", config: {} },
        {
          id: "out",
          kind: "output",
          label: "Results",
          config: { outputType: "docpanel", title: "Results" },
        },
      ]),
      edges: JSON.stringify([{ id: "e1", source: "trigger", target: "out" }]),
      canvas_layout: JSON.stringify({
        nodes: [
          { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
          { id: "out", type: "output", data: { target: "doc_panel", title: "Results" } },
        ],
        edges: [{ id: "e1", source: "trigger", target: "out" }],
      }),
      deployment_stage: "live" as const,
    };

    const next = workflowRowWithCanvasOverride(row, {
      canvasLayout: {
        nodes: [
          { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
          { id: "out", type: "output", data: { target: "doc_panel", title: "Results" } },
        ],
        edges: [{ id: "e1", source: "trigger", target: "out" }],
      },
    });

    expect(next.nodes?.map((node) => (node as { kind?: string }).kind)).toEqual([
      "trigger",
      "output",
    ]);
    expect(next.edges).toHaveLength(1);
  });

  it("derives trigger persistence metadata from the normalized workflow", () => {
    expect(
      derivedWorkflowTrigger({
        id: "wf-scheduled",
        name: "Scheduled",
        defaultOnError: { strategy: "fail", notifyOnError: true },
        nodes: [
          {
            id: "trigger",
            kind: "trigger",
            triggerType: "schedule",
            config: { cronExpr: "0 8 * * *", timezone: "America/Chicago" },
          },
          {
            id: "out",
            kind: "output",
            label: "Results",
            config: { outputType: "docpanel", title: "Results" },
          },
        ],
        edges: [{ id: "e1", source: "trigger", target: "out" }],
      }),
    ).toEqual({
      triggerType: "schedule",
      triggerConfig: { cronExpr: "0 8 * * *", timezone: "America/Chicago" },
    });
  });
});
