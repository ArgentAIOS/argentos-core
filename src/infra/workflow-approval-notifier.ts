import type { ArgentConfig } from "../config/config.js";
import type { OperatorAlertEvent } from "./operator-alerts.js";
import type { OutboundDeliveryResult, OutboundSendDeps } from "./outbound/deliver.js";
import { loadConfig } from "../config/config.js";
import { isDeliverableMessageChannel, normalizeMessageChannel } from "../utils/message-channel.js";
import { formatOperatorAlertEventText } from "./operator-alerts.js";
import { deliverOutboundPayloads } from "./outbound/deliver.js";

export interface WorkflowApprovalNotificationRequest {
  approvalId: string;
  runId: string;
  workflowId: string;
  workflowName?: string | null;
  nodeId: string;
  nodeLabel?: string | null;
  message: string;
  sideEffectClass?: string | null;
  previousOutputPreview?: unknown;
  timeoutAt?: string | null;
  timeoutAction?: "approve" | "deny" | null;
  requestedAt?: number | string | null;
  approveAction?: { method: string; params?: Record<string, unknown> } | null;
  denyAction?: { method: string; params?: Record<string, unknown> } | null;
}

export type WorkflowApprovalNotificationResult =
  | { status: "disabled" }
  | { status: "no-targets" }
  | {
      status: "sent";
      delivered: OutboundDeliveryResult[];
      errors: string[];
    }
  | { status: "failed"; errors: string[] };

export type WorkflowApprovalNotificationDeps = {
  deliver?: typeof deliverOutboundPayloads;
  outboundDeps?: OutboundSendDeps;
};

function toIso(value: number | string | null | undefined): string {
  const fallback = new Date().toISOString();
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
  }
  return fallback;
}

export function buildWorkflowApprovalOperatorAlertEvent(
  request: WorkflowApprovalNotificationRequest,
): OperatorAlertEvent {
  const approveAction = request.approveAction ?? {
    method: "workflows.approve",
    params: { runId: request.runId, nodeId: request.nodeId },
  };
  const denyAction = request.denyAction ?? {
    method: "workflows.deny",
    params: { runId: request.runId, nodeId: request.nodeId },
  };
  const workflowName = request.workflowName || request.workflowId;
  const nodeLabel = request.nodeLabel || request.nodeId;

  return {
    schemaVersion: 1,
    id: `operator-alert-${request.approvalId}`,
    type: "workflow.approval.requested",
    source: "workflows",
    createdAt: toIso(request.requestedAt),
    severity: "action_required",
    privacy: "sensitive",
    title: "Argent workflow approval needed",
    summary: `${workflowName}: ${nodeLabel}`,
    body: request.message,
    workflow: {
      workflowId: request.workflowId,
      workflowName: request.workflowName,
      runId: request.runId,
      nodeId: request.nodeId,
      nodeLabel: request.nodeLabel,
    },
    approval: {
      approvalId: request.approvalId,
      sideEffectClass: request.sideEffectClass,
      previousOutputPreview: request.previousOutputPreview,
    },
    actions: [
      {
        id: "approve",
        label: "Approve",
        kind: "approve",
        method: approveAction.method,
        params: approveAction.params,
      },
      {
        id: "deny",
        label: "Deny",
        kind: "deny",
        method: denyAction.method,
        params: denyAction.params,
        destructive: true,
      },
    ],
    timeout: request.timeoutAt
      ? {
          at: request.timeoutAt,
          action: request.timeoutAction ?? "deny",
          label: request.timeoutAction === "approve" ? "auto-approve" : "auto-deny",
        }
      : null,
    audit: {
      requestedAt: toIso(request.requestedAt),
      requestedBy: "workflow",
      requiresOperatorDecision: true,
    },
  };
}

export function buildWorkflowApprovalNotificationText(
  request: WorkflowApprovalNotificationRequest,
): string {
  return formatOperatorAlertEventText(buildWorkflowApprovalOperatorAlertEvent(request));
}

export async function notifyWorkflowApprovalRequest(params: {
  request: WorkflowApprovalNotificationRequest;
  cfg?: ArgentConfig;
  deps?: WorkflowApprovalNotificationDeps;
}): Promise<WorkflowApprovalNotificationResult> {
  const cfg = params.cfg ?? loadConfig();
  const config = cfg.agents?.defaults?.kernel?.operatorNotifications;
  if (config?.enabled !== true) {
    return { status: "disabled" };
  }

  const targets = (config.targets ?? []).filter((target) => target.channel && target.to);
  if (targets.length === 0) {
    return { status: "no-targets" };
  }

  const event = buildWorkflowApprovalOperatorAlertEvent(params.request);
  const text = formatOperatorAlertEventText(event);
  const deliver = params.deps?.deliver ?? deliverOutboundPayloads;
  const delivered: OutboundDeliveryResult[] = [];
  const errors: string[] = [];

  for (const target of targets) {
    const channel = normalizeMessageChannel(target.channel);
    if (!channel || !isDeliverableMessageChannel(channel)) {
      errors.push(`Unsupported workflow approval notification channel: ${target.channel}`);
      continue;
    }

    try {
      delivered.push(
        ...(await deliver({
          cfg,
          channel,
          to: target.to,
          accountId: target.accountId,
          threadId: target.threadId,
          payloads: [{ text }],
          deps: params.deps?.outboundDeps,
          bestEffort: true,
        })),
      );
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (delivered.length === 0) {
    return { status: "failed", errors };
  }

  return { status: "sent", delivered, errors };
}
