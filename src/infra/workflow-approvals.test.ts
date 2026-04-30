import { describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../config/config.js";
import type { StepRecord, WorkflowDefinition } from "./workflow-types.js";
import {
  buildWorkflowApprovalOperatorAlertEvent,
  buildWorkflowApprovalNotificationText,
  notifyWorkflowApprovalRequest,
} from "./workflow-approval-notifier.js";
import {
  buildDurableWorkflowApproval,
  previewWorkflowStepOutput,
  workflowApprovalId,
} from "./workflow-approvals.js";

function workflow(): WorkflowDefinition {
  return {
    id: "wf-vip-alert",
    name: "VIP Email Alert",
    nodes: [
      { kind: "trigger", id: "trigger-1", triggerType: "manual", config: {} },
      {
        kind: "gate",
        id: "approval-1",
        label: "Approve Telegram Alert",
        config: {
          gateType: "approval",
          approvers: ["operator"],
          channels: ["dashboard", "telegram"],
          message: "Send VIP alert?",
          showPreviousOutput: true,
          allowEdit: false,
          timeoutAction: "deny",
        },
      },
    ],
    edges: [{ id: "e1", source: "trigger-1", target: "approval-1" }],
    defaultOnError: { strategy: "fail" },
  };
}

function step(): StepRecord {
  return {
    nodeId: "agent-1",
    nodeKind: "agent",
    nodeLabel: "Classify Email",
    stepIndex: 1,
    status: "completed",
    durationMs: 12,
    startedAt: 1,
    endedAt: 13,
    output: {
      items: [
        {
          text: "VIP customer email matched high-priority policy.",
          json: { priority: "high" },
        },
      ],
    },
  };
}

function config(): ArgentConfig {
  return {
    agents: {
      defaults: {
        kernel: {
          enabled: true,
          mode: "shadow",
          operatorNotifications: {
            enabled: true,
            targets: [{ channel: "telegram", to: "123456789" }],
          },
        },
      },
    },
  } as ArgentConfig;
}

describe("workflow approvals", () => {
  it("builds durable approval records with action payloads and output previews", () => {
    const wf = workflow();
    const record = buildDurableWorkflowApproval({
      workflow: wf,
      node: wf.nodes[1],
      request: {
        runId: "run-1",
        nodeId: "approval-1",
        message: "Send VIP alert?",
        previousOutput: step(),
        showPreviousOutput: true,
        timeoutMs: 60_000,
        timeoutAction: "deny",
        requestedAt: Date.parse("2026-04-25T18:00:00.000Z"),
      },
    });

    expect(record.id).toBe(workflowApprovalId("run-1", "approval-1"));
    expect(record.workflowName).toBe("VIP Email Alert");
    expect(record.nodeLabel).toBe("Approve Telegram Alert");
    expect(record.previousOutputPreview).toMatchObject({
      nodeId: "agent-1",
      itemCount: 1,
      text: expect.stringContaining("VIP customer email"),
    });
    expect(record.approveAction).toMatchObject({
      method: "workflows.approve",
      params: { runId: "run-1", nodeId: "approval-1" },
    });
    expect(record.timeoutAt).toBe("2026-04-25T18:01:00.000Z");
  });

  it("truncates step previews before persistence and notification", () => {
    const largeStep = step();
    largeStep.output.items[0].text = "x".repeat(3_000);

    const preview = previewWorkflowStepOutput(largeStep);

    expect(String(preview?.text).length).toBeLessThanOrEqual(2_003);
    expect(String(preview?.text)).toMatch(/\.\.\.$/);
  });

  it("sends workflow approval notifications to configured operator targets", async () => {
    const deliver = vi.fn().mockResolvedValue([{ channel: "telegram", messageId: "m1" }]);

    const result = await notifyWorkflowApprovalRequest({
      cfg: config(),
      request: {
        approvalId: "approval-run-1-node-1",
        runId: "run-1",
        workflowId: "wf-vip-alert",
        workflowName: "VIP Email Alert",
        nodeId: "approval-1",
        nodeLabel: "Approve Telegram Alert",
        message: "Send VIP alert?",
        sideEffectClass: "approval",
        previousOutputPreview: { text: "VIP customer email" },
        timeoutAt: "2026-04-25T18:01:00.000Z",
        timeoutAction: "deny",
      },
      deps: { deliver },
    });

    expect(result.status).toBe("sent");
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        to: "123456789",
        payloads: [
          expect.objectContaining({
            text: expect.stringContaining("Workflow: VIP Email Alert"),
          }),
        ],
      }),
    );
  });

  it("renders approve and deny actions in notification text", () => {
    const text = buildWorkflowApprovalNotificationText({
      approvalId: "approval-1",
      runId: "run-1",
      workflowId: "wf-1",
      nodeId: "approval-1",
      message: "Approve send?",
    });

    expect(text).toContain("workflows.approve runId=run-1 nodeId=approval-1");
    expect(text).toContain("workflows.deny runId=run-1 nodeId=approval-1");
  });

  it("builds a shared operator alert event for workflow approvals", () => {
    const event = buildWorkflowApprovalOperatorAlertEvent({
      approvalId: "approval-1",
      runId: "run-1",
      workflowId: "wf-1",
      workflowName: "Morning Brief",
      nodeId: "approval-1",
      nodeLabel: "Approve Telegram Send",
      message: "Send the brief?",
      sideEffectClass: "outbound",
      previousOutputPreview: { text: "Draft brief" },
      timeoutAt: "2026-04-25T18:01:00.000Z",
      timeoutAction: "deny",
      requestedAt: Date.parse("2026-04-25T18:00:00.000Z"),
    });

    expect(event).toMatchObject({
      schemaVersion: 1,
      id: "operator-alert-approval-1",
      type: "workflow.approval.requested",
      source: "workflows",
      severity: "action_required",
      privacy: "sensitive",
      workflow: {
        workflowId: "wf-1",
        workflowName: "Morning Brief",
        runId: "run-1",
        nodeId: "approval-1",
        nodeLabel: "Approve Telegram Send",
      },
      approval: {
        approvalId: "approval-1",
        sideEffectClass: "outbound",
        previousOutputPreview: { text: "Draft brief" },
      },
      timeout: {
        at: "2026-04-25T18:01:00.000Z",
        action: "deny",
        label: "auto-deny",
      },
      audit: {
        requestedAt: "2026-04-25T18:00:00.000Z",
        requestedBy: "workflow",
        requiresOperatorDecision: true,
      },
    });
    expect(event.actions).toEqual([
      expect.objectContaining({
        id: "approve",
        method: "workflows.approve",
        params: { runId: "run-1", nodeId: "approval-1" },
      }),
      expect.objectContaining({
        id: "deny",
        method: "workflows.deny",
        params: { runId: "run-1", nodeId: "approval-1" },
        destructive: true,
      }),
    ]);
  });
});
