import type { Sql } from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAppForgeWorkflowEvent } from "../../infra/appforge-workflow-events.js";
import {
  createWorkflowRunRecord,
  executeWorkflowRunFromRow,
} from "../../infra/workflow-execution-service.js";
import { startAppForgeEventTriggeredWorkflows } from "./workflows.js";

vi.mock("../../infra/workflow-execution-service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/workflow-execution-service.js")>();
  return {
    ...actual,
    createWorkflowRunRecord: vi.fn(),
    executeWorkflowRunFromRow: vi.fn(),
  };
});

const createWorkflowRunRecordMock = vi.mocked(createWorkflowRunRecord);
const executeWorkflowRunFromRowMock = vi.mocked(executeWorkflowRunFromRow);

function appForgeWorkflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "wf-appforge-review",
    name: "Review Complete Workflow",
    version: 2,
    is_active: true,
    trigger_type: null,
    trigger_config: null,
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        data: {
          triggerType: "appforge_event",
          appId: "forge-app-1",
          capabilityId: "review",
          eventType: "forge.review.completed",
          eventFilterJson: '{"decision":"approved"}',
        },
      },
      {
        id: "output",
        type: "output",
        data: {
          outputType: "docpanel",
        },
      },
    ],
    edges: [{ id: "edge-1", source: "trigger", target: "output" }],
    ...overrides,
  };
}

function fakeWorkflowSql(rows: unknown[]): Sql {
  const sql = vi.fn(async () => rows);
  return sql as unknown as Sql;
}

describe("startAppForgeEventTriggeredWorkflows", () => {
  beforeEach(() => {
    createWorkflowRunRecordMock.mockReset();
    executeWorkflowRunFromRowMock.mockReset();
    createWorkflowRunRecordMock.mockResolvedValue({
      runId: "run-appforge-1",
      run: { id: "run-appforge-1" },
    });
    executeWorkflowRunFromRowMock.mockResolvedValue(undefined);
  });

  it("starts matching appforge_event workflows", async () => {
    const event = normalizeAppForgeWorkflowEvent({
      eventType: "forge.review.completed",
      appId: "forge-app-1",
      capabilityId: "review",
      decision: "approved",
      reviewId: "review-1",
    });
    const broadcast = vi.fn();

    const result = await startAppForgeEventTriggeredWorkflows({
      sql: fakeWorkflowSql([appForgeWorkflowRow()]),
      event,
      broadcast,
    });

    expect(result).toEqual({ started: ["run-appforge-1"], errors: [] });
    expect(createWorkflowRunRecordMock).toHaveBeenCalledWith(expect.any(Function), {
      workflowId: "wf-appforge-review",
      workflowVersion: 2,
      triggerType: "appforge_event",
      triggerPayload: event.payload,
    });
    expect(executeWorkflowRunFromRowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-appforge-1",
        triggerType: "appforge_event",
        triggerPayload: event.payload,
        triggerSource: "appforge:event",
      }),
    );
    expect(broadcast).toHaveBeenCalledWith(
      "workflow.run.created",
      expect.objectContaining({
        runId: "run-appforge-1",
        workflowId: "wf-appforge-review",
        triggerType: "appforge_event",
        source: "appforge",
      }),
    );
  });

  it("does not start workflows when appforge event filters do not match", async () => {
    const event = normalizeAppForgeWorkflowEvent({
      eventType: "forge.review.completed",
      appId: "forge-app-1",
      capabilityId: "review",
      decision: "denied",
    });

    const result = await startAppForgeEventTriggeredWorkflows({
      sql: fakeWorkflowSql([appForgeWorkflowRow()]),
      event,
    });

    expect(result).toEqual({ started: [], errors: [] });
    expect(createWorkflowRunRecordMock).not.toHaveBeenCalled();
    expect(executeWorkflowRunFromRowMock).not.toHaveBeenCalled();
  });
});
