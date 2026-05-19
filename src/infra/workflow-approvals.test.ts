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
  resolveDurableWorkflowApprovalById,
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

  it("does not attach telegram channelData for non-telegram targets (#351)", async () => {
    const deliver = vi.fn().mockResolvedValue([{ channel: "discord", messageId: "m1" }]);
    const cfg = {
      agents: {
        defaults: {
          kernel: {
            enabled: true,
            mode: "shadow",
            operatorNotifications: {
              enabled: true,
              targets: [{ channel: "discord", to: "channel-id" }],
            },
          },
        },
      },
    } as ArgentConfig;

    await notifyWorkflowApprovalRequest({
      cfg,
      request: {
        approvalId: "abc-123",
        runId: "run-2",
        workflowId: "wf-2",
        nodeId: "approval-2",
        message: "Send?",
      },
      deps: { deliver },
    });

    const call = deliver.mock.calls[0][0] as {
      payloads: Array<{ text: string; channelData?: unknown }>;
    };
    expect(call.payloads[0].channelData).toBeUndefined();
  });

  it("resolveDurableWorkflowApprovalById updates by approval id and returns the row (#351)", async () => {
    const calls: string[] = [];
    const fakeRow = {
      id: "abc-id",
      run_id: "run-9",
      node_id: "approval-9",
      status: "approved",
    };
    const sql = (async (strings: TemplateStringsArray) => {
      calls.push(strings.join("?"));
      return [fakeRow];
    }) as unknown as ReturnType<typeof import("postgres").default>;

    const row = await resolveDurableWorkflowApprovalById(sql, {
      approvalId: "abc-id",
      approved: true,
      approvedBy: "@operator",
    });

    expect(row).toEqual(fakeRow);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("UPDATE workflow_approvals");
    expect(calls[0]).toContain("WHERE id =");
    // Guard against accidentally matching arbitrary rows
    expect(calls[0]).toContain("status = 'pending'");
  });

  it("attaches Telegram inline approve/deny buttons to the notification payload (#351)", async () => {
    const deliver = vi.fn().mockResolvedValue([{ channel: "telegram", messageId: "m1" }]);

    await notifyWorkflowApprovalRequest({
      cfg: config(),
      request: {
        approvalId: "11111111-2222-3333-4444-555555555555",
        runId: "run-1",
        workflowId: "wf-vip-alert",
        nodeId: "approval-1",
        message: "Send VIP alert?",
      },
      deps: { deliver },
    });

    expect(deliver).toHaveBeenCalledTimes(1);
    const call = deliver.mock.calls[0][0] as {
      channel: string;
      payloads: Array<{
        text: string;
        channelData?: {
          telegram?: { buttons?: Array<Array<{ text: string; callback_data: string }>> };
        };
      }>;
    };
    expect(call.channel).toBe("telegram");
    const buttons = call.payloads[0].channelData?.telegram?.buttons;
    expect(buttons).toBeDefined();
    expect(buttons).toHaveLength(1);
    expect(buttons?.[0]).toHaveLength(2);
    expect(buttons?.[0][0]).toMatchObject({
      text: expect.stringContaining("Approve"),
      callback_data: "wf_app:11111111-2222-3333-4444-555555555555",
    });
    expect(buttons?.[0][1]).toMatchObject({
      text: expect.stringContaining("Deny"),
      callback_data: "wf_dny:11111111-2222-3333-4444-555555555555",
    });
    // Telegram callback_data is capped at 64 bytes
    expect(buttons?.[0][0].callback_data.length).toBeLessThanOrEqual(64);
    expect(buttons?.[0][1].callback_data.length).toBeLessThanOrEqual(64);
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
