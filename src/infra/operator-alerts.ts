export type OperatorAlertSource = "workflows" | "kernel" | "system";

export type OperatorAlertSeverity = "info" | "warning" | "action_required" | "critical";

export type OperatorAlertPrivacy = "private" | "sensitive";

export type OperatorAlertActionKind = "approve" | "deny" | "open" | "dismiss";

export interface OperatorAlertAction {
  id: string;
  label: string;
  kind: OperatorAlertActionKind;
  method?: string;
  params?: Record<string, unknown>;
  destructive?: boolean;
}

export interface OperatorAlertTimeout {
  at: string;
  action: "approve" | "deny";
  label: string;
}

export interface OperatorAlertWorkflowContext {
  workflowId: string;
  workflowName?: string | null;
  runId: string;
  nodeId: string;
  nodeLabel?: string | null;
}

export interface OperatorAlertApprovalContext {
  approvalId: string;
  sideEffectClass?: string | null;
  previousOutputPreview?: unknown;
}

export interface OperatorAlertAuditContext {
  requestedAt?: string | null;
  requestedBy: "workflow" | "system" | "operator";
  requiresOperatorDecision: boolean;
}

export interface OperatorAlertEvent {
  schemaVersion: 1;
  id: string;
  type: "workflow.approval.requested";
  source: OperatorAlertSource;
  createdAt: string;
  severity: OperatorAlertSeverity;
  privacy: OperatorAlertPrivacy;
  title: string;
  summary: string;
  body: string;
  workflow?: OperatorAlertWorkflowContext;
  approval?: OperatorAlertApprovalContext;
  actions: OperatorAlertAction[];
  timeout?: OperatorAlertTimeout | null;
  audit: OperatorAlertAuditContext;
}

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
    return "[unserializable preview]";
  }
}

function truncateLine(value: string, max = 900): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

export function formatOperatorAlertEventText(event: OperatorAlertEvent): string {
  const lines = [event.title, "", event.summary];

  if (event.workflow) {
    lines.push("", `Workflow: ${event.workflow.workflowName || event.workflow.workflowId}`);
    lines.push(`Step: ${event.workflow.nodeLabel || event.workflow.nodeId}`);
  }

  if (event.approval?.sideEffectClass) {
    lines.push(`Side effect: ${event.approval.sideEffectClass}`);
  }

  lines.push("", event.body);

  const preview = previewToText(event.approval?.previousOutputPreview);
  if (preview) {
    lines.push("", "Previous output preview:", truncateLine(preview));
  }

  if (event.timeout) {
    lines.push("", `Timeout: ${event.timeout.at} (${event.timeout.label})`);
  }

  if (event.actions.length > 0) {
    lines.push("", "Actions:");
    for (const action of event.actions) {
      const target =
        action.method && action.params
          ? ` ${action.method} ${Object.entries(action.params)
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(" ")}`
          : "";
      lines.push(`${action.label}:${target}`);
    }
  }

  if (event.approval?.approvalId) {
    lines.push(`Approval ID: ${event.approval.approvalId}`);
  }

  return lines.join("\n");
}
