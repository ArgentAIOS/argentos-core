import { describe, expect, it } from "vitest";
import { publicWorkflowRun } from "./workflows.js";

describe("publicWorkflowRun", () => {
  it("returns a canonical run detail with steps, approvals, and timeline", () => {
    const result = publicWorkflowRun(
      {
        id: "run-1",
        workflow_id: "wf-1",
        workflow_name: "VIP Email Alert",
        workflow_version: 3,
        status: "waiting_approval",
        trigger_type: "webhook",
        trigger_payload: { id: "evt-1" },
        current_node_id: "approval-1",
        started_at: "2026-04-25T14:00:00.000Z",
        total_tokens_used: 42,
        total_cost_usd: "0.013",
        variables: { topic: "vip" },
        workflow_nodes: [
          { id: "agent-1", label: "Classify sender" },
          { id: "approval-1", data: { label: "Approve Telegram alert" } },
        ],
      },
      {
        nowMs: Date.parse("2026-04-25T14:01:00.000Z"),
        steps: [
          {
            id: "step-1",
            node_id: "agent-1",
            node_kind: "agent",
            status: "completed",
            started_at: "2026-04-25T14:00:05.000Z",
            ended_at: "2026-04-25T14:00:15.000Z",
            duration_ms: 10000,
            output_items: { items: [{ text: "VIP email" }] },
            tokens_used: 42,
            cost_usd: "0.013",
          },
          {
            id: "step-2",
            node_id: "approval-1",
            node_kind: "gate",
            status: "running",
            started_at: "2026-04-25T14:00:16.000Z",
            approval_status: "pending",
          },
        ],
        approvals: [
          {
            id: "approval-run-1-approval-1",
            run_id: "run-1",
            workflow_id: "wf-1",
            node_id: "approval-1",
            node_label: "Approve Telegram alert",
            message: "Send VIP alert?",
            side_effect_class: "external_write",
            requested_at: "2026-04-25T14:00:16.000Z",
            timeout_at: "2026-04-25T14:15:16.000Z",
            status: "pending",
            notification_status: "sent",
          },
        ],
      },
    );

    expect(result).toMatchObject({
      runId: "run-1",
      workflowId: "wf-1",
      workflowName: "VIP Email Alert",
      workflowVersion: 3,
      status: "waiting_approval",
      triggerType: "webhook",
      currentNodeId: "approval-1",
      durationMs: 60000,
      totalTokensUsed: 42,
      totalCostUsd: 0.013,
    });
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({
      nodeId: "agent-1",
      nodeName: "Classify sender",
      status: "completed",
      output: { items: [{ text: "VIP email" }] },
    });
    expect(result.steps[1]).toMatchObject({
      nodeId: "approval-1",
      nodeName: "Approve Telegram alert",
      approvalStatus: "pending",
    });
    expect(result.approvals[0]).toMatchObject({
      approvalId: "approval-run-1-approval-1",
      sideEffectClass: "external_write",
      notificationStatus: "sent",
    });
    expect(result.timeline.map((event) => event.type)).toEqual([
      "run_started",
      "step_started",
      "step_completed",
      "step_started",
      "approval_requested",
    ]);
  });
});
