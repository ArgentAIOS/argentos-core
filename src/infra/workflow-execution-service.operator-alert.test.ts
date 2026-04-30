import type { Sql } from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "./workflow-runner.js";
import type { WorkflowDefinition } from "./workflow-types.js";
import {
  __operatorAlertRouterTesting,
  registerOperatorAlertSink,
} from "./operator-alert-router.js";
import { executeWorkflowRunFromRow } from "./workflow-execution-service.js";

const runnerMocks = vi.hoisted(() => ({
  executeWorkflow: vi.fn(),
}));

vi.mock("../data/agent-family.js", () => ({
  getAgentFamily: vi.fn(async () => ({
    getRedis: () => null,
  })),
}));

vi.mock("./workflow-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workflow-runner.js")>();
  return {
    ...actual,
    CoreAgentDispatcher: vi.fn(function CoreAgentDispatcherMock() {
      return {};
    }),
    executeWorkflow: runnerMocks.executeWorkflow,
  };
});

vi.mock("./workflow-approval-notifier.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workflow-approval-notifier.js")>();
  return {
    ...actual,
    notifyWorkflowApprovalRequest: vi.fn(async () => ({ status: "disabled" })),
  };
});

vi.mock("./workflow-approvals.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workflow-approvals.js")>();
  return {
    ...actual,
    upsertDurableWorkflowApproval: vi.fn(async () => ({
      id: "approval-run-1-approval",
      node_label: "Approve Send",
      side_effect_class: "outbound",
      previous_output_preview: { text: "Draft campaign" },
      timeout_at: null,
      approve_action: {
        method: "workflows.approve",
        params: { runId: "run-1", nodeId: "approval" },
      },
      deny_action: {
        method: "workflows.deny",
        params: { runId: "run-1", nodeId: "approval" },
      },
    })),
    markWorkflowApprovalNotified: vi.fn(async () => undefined),
  };
});

function workflow(): WorkflowDefinition {
  return {
    id: "wf-alert",
    name: "Approval Alert Workflow",
    nodes: [
      { kind: "trigger", id: "trigger", triggerType: "manual", config: {} },
      {
        kind: "gate",
        id: "approval",
        label: "Approve Send",
        config: {
          gateType: "approval",
          message: "Send the campaign?",
        },
      },
      {
        kind: "output",
        id: "output",
        label: "Output",
        config: { outputType: "docpanel" },
      },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "approval" },
      { id: "e2", source: "approval", target: "output" },
    ],
  };
}

function sqlMock(): Sql {
  const sql = vi.fn(async () => []) as unknown as Sql;
  return sql;
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was not reached");
}

describe("workflow execution operator alert routing", () => {
  afterEach(() => {
    runnerMocks.executeWorkflow.mockReset();
    __operatorAlertRouterTesting.clear();
  });

  it("routes workflow approval alerts through the shared operator alert router", async () => {
    const routed = vi.fn(() => ({ status: "sent" as const, message: "voice queued" }));
    registerOperatorAlertSink({ id: "test-sink", route: routed });
    const broadcast = vi.fn();

    runnerMocks.executeWorkflow.mockImplementationOnce(
      async (opts: {
        onApprovalRequested?: (nodeId: string, request: ApprovalRequest) => void;
      }) => {
        opts.onApprovalRequested?.("approval", {
          runId: "run-1",
          nodeId: "approval",
          message: "Send the campaign?",
          showPreviousOutput: true,
          timeoutAction: "deny",
          requestedAt: Date.parse("2026-04-27T18:00:00.000Z"),
        });
        return {
          status: "waiting_approval",
          steps: [],
        };
      },
    );

    await executeWorkflowRunFromRow({
      sql: sqlMock(),
      workflowRow: {
        ...workflow(),
        canvas_layout: { nodes: [], edges: [] },
      },
      runId: "run-1",
      triggerType: "manual",
      broadcast,
    });

    await waitFor(() => routed.mock.calls.length > 0);

    expect(broadcast).toHaveBeenCalledWith(
      "operator.alert.requested",
      expect.objectContaining({
        id: "operator-alert-approval-run-1-approval",
        source: "workflows",
        approval: expect.objectContaining({
          approvalId: "approval-run-1-approval",
        }),
      }),
    );
    expect(routed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "operator-alert-approval-run-1-approval",
        workflow: expect.objectContaining({
          workflowId: "wf-alert",
          runId: "run-1",
          nodeId: "approval",
        }),
      }),
      { source: "workflow.approval" },
    );
  });
});
