import { describe, expect, it } from "vitest";
import {
  publicWorkflowRow,
  resumeWorkflowRunAfterEvent,
  workflowFromRow,
  type WorkflowRow,
} from "./workflow-execution-service.js";

describe("workflow execution service row decoding", () => {
  it("normalizes legacy workflow rows whose JSONB graph columns were stored as strings", () => {
    const row = {
      id: "wf-legacy-json-string",
      name: "Legacy JSON String Workflow",
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
      default_on_error: JSON.stringify({ strategy: "fail", notifyOnError: true }),
      deployment_stage: "live",
    } as unknown as WorkflowRow;

    const normalized = workflowFromRow(row);

    expect(normalized.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(normalized.workflow.nodes.map((node) => node.kind)).toEqual(["trigger", "output"]);
    expect(normalized.workflow.edges).toEqual([{ id: "e1", source: "trigger", target: "out" }]);
    expect(normalized.canvasLayout.nodes).toHaveLength(2);

    const publicRow = publicWorkflowRow(row);
    expect(publicRow.validation.ok).toBe(true);
    expect(publicRow.nodes).toHaveLength(2);
    expect(publicRow.definition.nodes).toHaveLength(2);
  });
});

describe("workflow event resume claims", () => {
  it("fails before resume when another worker already claimed the waiting event run", async () => {
    const calls: string[] = [];
    const responses = [
      [
        {
          id: "run-1",
          workflow_id: "wf-1",
          status: "waiting_event",
          trigger_type: "manual",
          trigger_payload: {},
        },
      ],
      [
        {
          id: "wf-1",
          name: "Event wait workflow",
          nodes: [
            { id: "trigger", kind: "trigger", triggerType: "manual", config: {} },
            {
              id: "wait",
              kind: "gate",
              label: "Wait",
              config: {
                gateType: "wait_event",
                eventType: "forge.record.created",
                timeoutAction: "fail",
              },
            },
          ],
          edges: [{ id: "e-trigger-wait", source: "trigger", target: "wait" }],
          default_on_error: { strategy: "fail" },
          deployment_stage: "simulate",
        },
      ],
      [
        {
          input_context: {
            eventType: "forge.record.created",
            eventFilter: { appId: "app-1" },
          },
        },
      ],
      [],
    ];
    const sql = (async (strings: TemplateStringsArray) => {
      calls.push(strings.join("?"));
      return responses.shift() ?? [];
    }) as unknown as ReturnType<typeof import("postgres").default>;

    await expect(
      resumeWorkflowRunAfterEvent({
        sql,
        runId: "run-1",
        nodeId: "wait",
        eventType: "forge.record.created",
        eventPayload: { appId: "app-1" },
      }),
    ).rejects.toThrow(/already claimed/);

    expect(calls).toHaveLength(4);
    expect(calls[3]).toContain("UPDATE workflow_runs");
    expect(calls.some((call) => call.includes("UPDATE workflow_step_runs"))).toBe(false);
  });
});
