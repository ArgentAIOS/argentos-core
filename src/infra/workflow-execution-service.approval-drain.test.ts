import type { Sql } from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "./workflow-runner.js";
import type { WorkflowDefinition } from "./workflow-types.js";
import { executeWorkflowRunFromRow } from "./workflow-execution-service.js";

// Regression coverage for the cron-approval-buttons fix: the approval
// notification (notifyWorkflowApprovalRequest + markWorkflowApprovalNotified)
// is dispatched fire-and-forget from onApprovalRequested. The cron runner
// closes its SQL connection the instant executeWorkflowRunFromRow returns
// (cron/service/timer.ts), so the notification work MUST be drained before this
// function resolves — otherwise markWorkflowApprovalNotified runs against a
// closed connection and the operator never gets the inline-button message.

const runnerMocks = vi.hoisted(() => ({
  executeWorkflow: vi.fn(),
}));

const approvalMocks = vi.hoisted(() => ({
  notifyWorkflowApprovalRequest: vi.fn(),
  markWorkflowApprovalNotified: vi.fn(),
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
    notifyWorkflowApprovalRequest: approvalMocks.notifyWorkflowApprovalRequest,
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
      deny_action: { method: "workflows.deny", params: { runId: "run-1", nodeId: "approval" } },
    })),
    markWorkflowApprovalNotified: approvalMocks.markWorkflowApprovalNotified,
  };
});

function workflow(): WorkflowDefinition {
  return {
    id: "wf-drain",
    name: "Approval Drain Workflow",
    nodes: [
      { kind: "trigger", id: "trigger", triggerType: "cron", config: {} },
      {
        kind: "gate",
        id: "approval",
        label: "Approve Send",
        config: { gateType: "approval", message: "Send the campaign?" },
      },
      { kind: "output", id: "output", label: "Output", config: { outputType: "docpanel" } },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "approval" },
      { id: "e2", source: "approval", target: "output" },
    ],
  };
}

function sqlMock(): Sql {
  return vi.fn(async () => []) as unknown as Sql;
}

describe("executeWorkflowRunFromRow approval-notification drain", () => {
  afterEach(() => {
    runnerMocks.executeWorkflow.mockReset();
    approvalMocks.notifyWorkflowApprovalRequest.mockReset();
    approvalMocks.markWorkflowApprovalNotified.mockReset();
  });

  it("awaits the approval notification (notify + markNotified) before returning, even when notify is slow", async () => {
    // Simulate a real Telegram send taking time. If the function returned before
    // draining, markWorkflowApprovalNotified would not yet have run.
    approvalMocks.notifyWorkflowApprovalRequest.mockImplementationOnce(
      async () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ status: "sent", delivered: [], errors: [] }), 25),
        ),
    );
    approvalMocks.markWorkflowApprovalNotified.mockResolvedValue(undefined);

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
          requestedAt: Date.parse("2026-06-16T12:00:00.000Z"),
        });
        return { status: "waiting_approval", steps: [] };
      },
    );

    await executeWorkflowRunFromRow({
      sql: sqlMock(),
      workflowRow: { ...workflow(), canvas_layout: { nodes: [], edges: [] } },
      runId: "run-1",
      triggerType: "cron",
      broadcast: vi.fn(),
    });

    // No waitFor — the drain must have completed both calls before resolving.
    expect(approvalMocks.notifyWorkflowApprovalRequest).toHaveBeenCalledTimes(1);
    expect(approvalMocks.markWorkflowApprovalNotified).toHaveBeenCalledTimes(1);
    expect(approvalMocks.markWorkflowApprovalNotified).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ approvalId: "approval-run-1-approval", status: "sent" }),
    );
  });
});
