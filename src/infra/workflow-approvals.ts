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

export interface PendingWorkflowApprovalRow {
  id: string;
  run_id: string;
  node_id: string;
  workflow_name: string | null;
  node_label: string | null;
  message: string;
  requested_at: string;
}

// Lists currently-pending workflow approvals, newest first. Used by text-reply
// approval surfaces (Telegram "approve"/"deny") that carry no approval id and
// must discover what is awaiting the operator.
export async function listPendingWorkflowApprovals(
  sql: Sql,
  opts?: { limit?: number },
): Promise<PendingWorkflowApprovalRow[]> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 20, 100));
  const rows = await sql`
    SELECT id, run_id, node_id, workflow_name, node_label, message, requested_at
    FROM workflow_approvals
    WHERE status = 'pending'
    ORDER BY requested_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as PendingWorkflowApprovalRow[];
}

export type ApprovalTextSelection =
  | { kind: "none" }
  | { kind: "resolve"; row: PendingWorkflowApprovalRow }
  | { kind: "ambiguous"; rows: PendingWorkflowApprovalRow[] }
  | { kind: "not-found"; token: string };

// Pure decision for the text-reply approval surface ("approve"/"deny", with an
// optional id/run-id token): given the pending approvals, decide which one a
// bare command resolves. No token + exactly one pending → resolve it; no token
// + many → ambiguous (caller lists them); a token narrows by approval id or
// run id (exact, then prefix). Extracted from the Telegram handler so the
// branching is unit-testable without standing up the bot.
export function selectApprovalForTextCommand(
  pending: PendingWorkflowApprovalRow[],
  token?: string,
): ApprovalTextSelection {
  const trimmed = token?.trim();
  if (trimmed) {
    const lower = trimmed.toLowerCase();
    const exact = pending.filter(
      (row) => row.id.toLowerCase() === lower || row.run_id.toLowerCase() === lower,
    );
    const matches =
      exact.length > 0
        ? exact
        : pending.filter(
            (row) =>
              row.id.toLowerCase().includes(lower) || row.run_id.toLowerCase().startsWith(lower),
          );
    if (matches.length === 0) {
      return { kind: "not-found", token: trimmed };
    }
    if (matches.length === 1) {
      return { kind: "resolve", row: matches[0] };
    }
    return { kind: "ambiguous", rows: matches };
  }
  if (pending.length === 0) {
    return { kind: "none" };
  }
  if (pending.length === 1) {
    return { kind: "resolve", row: pending[0] };
  }
  return { kind: "ambiguous", rows: pending };
}

export interface ApprovalTextCommandDeps {
  listPending: (sql: Sql) => Promise<PendingWorkflowApprovalRow[]>;
  resolveById: (
    sql: Sql,
    input: { approvalId: string; approved: boolean; reason?: string; approvedBy?: string },
  ) => Promise<{ run_id?: unknown; node_id?: unknown } | undefined>;
  /** True when the run is still pending in the current process (in-memory). */
  hasPendingApproval: (runId: string, nodeId: string) => boolean;
  /** Resolve an in-process pending approval (no durable resume needed). */
  resolveInMemory: (runId: string, nodeId: string, approved: boolean, reason?: string) => void;
  /** Resume a durable (e.g. cron / post-restart) run after an APPROVAL. */
  resumeRun: (runId: string, nodeId: string) => void;
  /** Fail a durable run after a DENIAL — resuming would execute it as approved. */
  denyRun: (runId: string, nodeId: string, reason?: string) => void;
}

export interface ApprovalTextCommandResult {
  outcome: "none" | "not-found" | "ambiguous" | "gone" | "resolved";
  reply: string;
  approved: boolean;
  runId?: string;
}

// Orchestrates the Telegram text-reply approval surface end to end: list pending
// → select → resolve (durable) → resume or in-memory-resolve → reply text. All
// I/O is injected so the branching (including the resolve+resume wiring) is
// unit-testable without standing up the bot or a live gateway. The Telegram
// handler is a thin caller that just sends `result.reply`.
export async function runApprovalTextCommand(opts: {
  sql: Sql;
  approved: boolean;
  token?: string;
  operatorLabel: string;
  deps: ApprovalTextCommandDeps;
}): Promise<ApprovalTextCommandResult> {
  const { sql, approved, token, operatorLabel, deps } = opts;
  const pending = await deps.listPending(sql);
  const selection = selectApprovalForTextCommand(pending, token);

  if (selection.kind === "none") {
    return { outcome: "none", approved, reply: "No workflow approvals are pending right now." };
  }
  if (selection.kind === "not-found") {
    return {
      outcome: "not-found",
      approved,
      reply: `No pending approval matches "${selection.token}".`,
    };
  }
  if (selection.kind === "ambiguous") {
    const verb = approved ? "approve" : "deny";
    const list = selection.rows
      .map((r) => `• ${r.workflow_name ?? r.run_id} — reply "${verb} ${r.run_id.slice(0, 8)}"`)
      .join("\n");
    return {
      outcome: "ambiguous",
      approved,
      reply: `${selection.rows.length} approvals are pending — which one?\n${list}`,
    };
  }

  const row = selection.row;
  const resolved = await deps.resolveById(sql, {
    approvalId: row.id,
    approved,
    approvedBy: operatorLabel,
    reason: approved ? undefined : "Denied via Telegram text reply",
  });
  if (!resolved) {
    return { outcome: "gone", approved, reply: "That approval is no longer pending." };
  }
  const runId = String(resolved.run_id);
  const nodeId = String(resolved.node_id);
  if (deps.hasPendingApproval(runId, nodeId)) {
    deps.resolveInMemory(runId, nodeId, approved, approved ? undefined : "Denied via Telegram");
  } else if (approved) {
    deps.resumeRun(runId, nodeId);
  } else {
    deps.denyRun(runId, nodeId, "Denied via Telegram text reply");
  }
  const icon = approved ? "✅" : "❌";
  const verb = approved ? "Approved" : "Denied";
  return {
    outcome: "resolved",
    approved,
    runId,
    reply: `${icon} ${verb} by ${operatorLabel}.\nWorkflow: ${row.workflow_name ?? runId}\nRun: ${runId}`,
  };
}

// Resolves a workflow approval by its primary-key id. Used by callback-driven
// surfaces (Telegram inline buttons) where the caller only carries the
// approval id, not run/node. Atomically transitions pending → approved/denied
// in a single statement and returns the row so callers can drive the run-
// resume or read run_id/node_id without a second query.
export async function resolveDurableWorkflowApprovalById(
  sql: Sql,
  input: { approvalId: string; approved: boolean; reason?: string; approvedBy?: string },
) {
  const status = input.approved ? "approved" : "denied";
  const [row] = await sql`
    UPDATE workflow_approvals SET
      status = ${status},
      resolved_at = NOW(),
      resolved_by = ${input.approvedBy ?? "operator"},
      resolution_note = ${input.reason ?? null}
    WHERE id = ${input.approvalId}
      AND status = 'pending'
    RETURNING *
  `;
  return row;
}
