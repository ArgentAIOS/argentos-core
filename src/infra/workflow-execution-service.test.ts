import { describe, expect, it } from "vitest";
import {
  publicWorkflowRow,
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
