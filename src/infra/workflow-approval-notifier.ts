import type { ArgentConfig } from "../config/config.js";
import type { OutboundDeliveryResult, OutboundSendDeps } from "./outbound/deliver.js";
import { loadConfig } from "../config/config.js";
import { isDeliverableMessageChannel, normalizeMessageChannel } from "../utils/message-channel.js";
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

function previewToText(preview: unknown): string | null {
  if (preview === undefined || preview === null) {
    return null;
  }
  if (typeof preview === "string") {
    return preview;
  }
  try {
    return JSON.stringify(preview, null, 2);
  } catch {
    return String(preview);
  }
}

function truncateLine(value: string, max = 900): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

export function buildWorkflowApprovalNotificationText(
  request: WorkflowApprovalNotificationRequest,
): string {
  const lines = ["Argent workflow approval needed."];
  lines.push("", `Workflow: ${request.workflowName || request.workflowId}`);
  lines.push(`Step: ${request.nodeLabel || request.nodeId}`);
  if (request.sideEffectClass) {
    lines.push(`Side effect: ${request.sideEffectClass}`);
  }
  lines.push("", request.message);

  const preview = previewToText(request.previousOutputPreview);
  if (preview) {
    lines.push("", "Previous output preview:", truncateLine(preview));
  }

  if (request.timeoutAt) {
    lines.push(
      "",
      `Timeout: ${request.timeoutAt} (${request.timeoutAction === "approve" ? "auto-approve" : "auto-deny"})`,
    );
  }

  lines.push(
    "",
    `Approve: workflows.approve runId=${request.runId} nodeId=${request.nodeId}`,
    `Deny: workflows.deny runId=${request.runId} nodeId=${request.nodeId}`,
    `Approval ID: ${request.approvalId}`,
  );
  return lines.join("\n");
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

  const text = buildWorkflowApprovalNotificationText(params.request);
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
