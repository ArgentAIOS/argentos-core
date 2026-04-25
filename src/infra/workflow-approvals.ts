import type { Sql } from "postgres";
import type { ApprovalRequest } from "./workflow-runner.js";
import type { StepRecord, WorkflowDefinition, WorkflowNode } from "./workflow-types.js";

export type DurableWorkflowApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "edited"
  | "escalated"
  | "timed_out";

export interface DurableWorkflowApprovalInput {
  workflow: WorkflowDefinition;
  node: WorkflowNode | undefined;
  request: ApprovalRequest;
}

export interface WorkflowApprovalDecisionInput {
  runId: string;
  nodeId: string;
  approved: boolean;
  reason?: string;
  approvedBy?: string;
}

const PREVIEW_TEXT_LIMIT = 2_000;

export function workflowApprovalId(runId: string, nodeId: string): string {
  return `approval-${runId}-${nodeId}`;
}

function truncateText(value: string): string {
  return value.length <= PREVIEW_TEXT_LIMIT ? value : `${value.slice(0, PREVIEW_TEXT_LIMIT)}...`;
}

export function previewWorkflowStepOutput(step?: StepRecord): Record<string, unknown> | null {
  if (!step) {
    return null;
  }

  const output = step.output;
  const rawPreview = output.items
    .slice(0, 3)
    .map((item) => item.text || JSON.stringify(item.json ?? {}))
    .filter(Boolean)
    .join("\n\n");

  return {
    nodeId: step.nodeId,
    nodeKind: step.nodeKind,
    status: step.status,
    itemCount: output.items.length,
    text: truncateText(rawPreview),
  };
}

function approvalTimeoutAt(request: ApprovalRequest): string | null {
  if (!request.timeoutMs || request.timeoutMs <= 0) {
    return null;
  }
  return new Date(request.requestedAt + request.timeoutMs).toISOString();
}

function sideEffectClassForNode(node?: WorkflowNode): string | null {
  if (!node) {
    return null;
  }
  if (node.kind === "action") {
    const actionType = node.config.actionType.type;
    if (actionType === "send_message" || actionType === "send_email") {
      return "outbound";
    }
    if (
      actionType === "webhook_call" ||
      actionType === "api_call" ||
      actionType === "run_script" ||
      actionType === "connector_action"
    ) {
      return "external_mutation";
    }
    return "write";
  }
  if (node.kind === "output") {
    return node.config.outputType === "docpanel" || node.config.outputType === "knowledge"
      ? "write"
      : "outbound";
  }
  if (node.kind === "gate") {
    return node.config?.gateType === "approval" ? "approval" : "control";
  }
  return null;
}

export function buildDurableWorkflowApproval(input: DurableWorkflowApprovalInput) {
  const rawLabel = input.node && "label" in input.node ? input.node.label : undefined;
  const nodeLabel =
    typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim() : input.node?.id;
  const timeoutAt = approvalTimeoutAt(input.request);
  const previousOutputPreview = input.request.showPreviousOutput
    ? previewWorkflowStepOutput(input.request.previousOutput)
    : null;

  return {
    id: workflowApprovalId(input.request.runId, input.request.nodeId),
    runId: input.request.runId,
    workflowId: input.workflow.id,
    workflowName: input.workflow.name,
    nodeId: input.request.nodeId,
    nodeLabel,
    message: input.request.message,
    sideEffectClass: sideEffectClassForNode(input.node),
    previousOutputPreview,
    approveAction: {
      method: "workflows.approve",
      params: { runId: input.request.runId, nodeId: input.request.nodeId },
    },
    denyAction: {
      method: "workflows.deny",
      params: { runId: input.request.runId, nodeId: input.request.nodeId },
    },
    timeoutAt,
    timeoutAction: input.request.timeoutAction ?? "deny",
    metadata: {
      requestedAtEpochMs: input.request.requestedAt,
      showPreviousOutput: input.request.showPreviousOutput,
    },
  };
}

export async function upsertDurableWorkflowApproval(sql: Sql, input: DurableWorkflowApprovalInput) {
  const approval = buildDurableWorkflowApproval(input);
  const [row] = await sql`
    INSERT INTO workflow_approvals (
      id, run_id, workflow_id, node_id, workflow_name, node_label,
      message, side_effect_class, previous_output_preview,
      approve_action, deny_action, timeout_at, timeout_action,
      status, requested_at, metadata
    ) VALUES (
      ${approval.id}, ${approval.runId}, ${approval.workflowId}, ${approval.nodeId},
      ${approval.workflowName}, ${approval.nodeLabel ?? null},
      ${approval.message}, ${approval.sideEffectClass},
      ${JSON.stringify(approval.previousOutputPreview)}::jsonb,
      ${JSON.stringify(approval.approveAction)}::jsonb,
      ${JSON.stringify(approval.denyAction)}::jsonb,
      ${approval.timeoutAt}::timestamptz,
      ${approval.timeoutAction},
      'pending',
      ${new Date(input.request.requestedAt).toISOString()}::timestamptz,
      ${JSON.stringify(approval.metadata)}::jsonb
    )
    ON CONFLICT (run_id, node_id) DO UPDATE SET
      workflow_name = EXCLUDED.workflow_name,
      node_label = EXCLUDED.node_label,
      message = EXCLUDED.message,
      side_effect_class = EXCLUDED.side_effect_class,
      previous_output_preview = EXCLUDED.previous_output_preview,
      approve_action = EXCLUDED.approve_action,
      deny_action = EXCLUDED.deny_action,
      timeout_at = EXCLUDED.timeout_at,
      timeout_action = EXCLUDED.timeout_action,
      metadata = workflow_approvals.metadata || EXCLUDED.metadata
    RETURNING *
  `;
  return row;
}

export async function markWorkflowApprovalNotified(
  sql: Sql,
  params: { approvalId: string; status: string; error?: string },
) {
  await sql`
    UPDATE workflow_approvals SET
      notification_status = ${params.status},
      notification_error = ${params.error ?? null}
    WHERE id = ${params.approvalId}
  `;
}

export async function resolveDurableWorkflowApproval(
  sql: Sql,
  input: WorkflowApprovalDecisionInput,
) {
  const status = input.approved ? "approved" : "denied";
  const [row] = await sql`
    UPDATE workflow_approvals SET
      status = ${status},
      resolved_at = NOW(),
      resolved_by = ${input.approvedBy ?? "operator"},
      resolution_note = ${input.reason ?? null}
    WHERE run_id = ${input.runId}
      AND node_id = ${input.nodeId}
      AND status = 'pending'
    RETURNING *
  `;
  return row;
}
