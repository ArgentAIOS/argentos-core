import { describe, expect, it } from "vitest";
import { OWNER_OPERATOR_WORKFLOW_PACKAGES } from "../../infra/workflow-owner-operator-templates.js";
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

  it("preserves Morning Brief dry-run step ledger and DocPanel artifacts", () => {
    const morningBrief = OWNER_OPERATOR_WORKFLOW_PACKAGES.find(
      (pkg) => pkg.slug === "ai-morning-brief-podcast",
    );
    expect(morningBrief).toBeDefined();
    if (!morningBrief) {
      return;
    }

    const runId = "morning-brief-run-detail-smoke";
    const startedAt = Date.parse("2026-05-02T21:30:00.000Z");
    const steps = morningBrief.workflow.nodes.map((node, index) => ({
      id: `step-${index + 1}`,
      run_id: runId,
      workflow_id: morningBrief.workflow.id,
      node_id: node.id,
      node_kind: node.kind,
      status: "completed",
      started_at: new Date(startedAt + index * 1000).toISOString(),
      ended_at: new Date(startedAt + index * 1000 + 500).toISOString(),
      duration_ms: 500,
      output_items: {
        items:
          node.kind === "output" && node.config.outputType === "docpanel"
            ? [
                {
                  text: `${node.label}: dry-run DocPanel artifact`,
                  artifacts: [
                    {
                      type: "docpanel",
                      title: node.config.title,
                      docId: `doc-${node.id}`,
                    },
                  ],
                },
              ]
            : [{ text: `${"label" in node ? node.label : node.id}: dry-run result` }],
      },
    }));

    const detail = publicWorkflowRun(
      {
        id: runId,
        workflow_id: morningBrief.workflow.id,
        workflow_name: morningBrief.workflow.name,
        workflow_version: 1,
        status: "completed",
        trigger_type: "manual_test",
        trigger_payload: morningBrief.testFixtures?.triggerPayload,
        started_at: new Date(startedAt).toISOString(),
        ended_at: new Date(startedAt + steps.length * 1000).toISOString(),
        workflow_nodes: morningBrief.workflow.nodes,
        metadata: {
          dryRunOnly: true,
          noLiveSideEffects: true,
          liveReadinessStatus: "dry_run_only",
          blockers: [
            "missing_connector",
            "missing_credentials",
            "missing_channel",
            "canary_required",
          ],
        },
      },
      { steps },
    );

    expect(detail).toMatchObject({
      runId,
      workflowName: "AI Morning Brief Podcast",
      status: "completed",
      metadata: {
        dryRunOnly: true,
        noLiveSideEffects: true,
        liveReadinessStatus: "dry_run_only",
        blockers: expect.arrayContaining([
          "missing_connector",
          "missing_credentials",
          "missing_channel",
          "canary_required",
        ]),
      },
    });
    expect(detail.steps).toHaveLength(12);
    expect(detail.steps.map((step) => step.status)).toEqual(Array(12).fill("completed"));
    expect(detail.steps.map((step) => step.nodeId)).toEqual([
      "trigger",
      "github-scout",
      "frontier-scout",
      "thought-scout",
      "synthesize-brief",
      "brief-doc",
      "podcast-script",
      "podcast-plan",
      "approve-podcast-render",
      "podcast-generate",
      "delivery-status",
      "run-ledger",
    ]);
    expect(detail.steps.find((step) => step.nodeId === "brief-doc")).toMatchObject({
      nodeName: "AI Morning Brief — {{context.runId}}",
      output: {
        items: [
          {
            artifacts: [expect.objectContaining({ type: "docpanel", docId: "doc-brief-doc" })],
          },
        ],
      },
    });
    expect(detail.steps.find((step) => step.nodeId === "run-ledger")).toMatchObject({
      nodeName: "AI Morning Brief Run Ledger — {{context.runId}}",
      output: {
        items: [
          {
            artifacts: [expect.objectContaining({ type: "docpanel", docId: "doc-run-ledger" })],
          },
        ],
      },
    });
    expect(detail.timeline.at(-1)).toMatchObject({
      type: "run_finished",
      status: "completed",
    });
  });
});
