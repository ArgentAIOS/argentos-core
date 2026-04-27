import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import type { OutboundSendDeps } from "./outbound/deliver.js";
import type {
  ErrorConfig,
  ItemSet,
  StepRecord,
  TriggerType,
  WorkflowDefinition,
} from "./workflow-types.js";
import { getAgentFamily } from "../data/agent-family.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  buildWorkflowApprovalOperatorAlertEvent,
  notifyWorkflowApprovalRequest,
} from "./workflow-approval-notifier.js";
import {
  markWorkflowApprovalNotified,
  upsertDurableWorkflowApproval,
} from "./workflow-approvals.js";
import {
  hasBlockingWorkflowIssues,
  normalizeWorkflow,
  type CanvasWorkflowLayout,
  type WorkflowIssue,
} from "./workflow-normalize.js";
import {
  CoreAgentDispatcher,
  executeWorkflow,
  type ActionExecutors,
  type WorkflowResumeOptions,
} from "./workflow-runner.js";

const log = createSubsystemLogger("workflow/execution-service");

export interface WorkflowRow {
  id: string;
  name: string;
  description?: string | null;
  version?: number | null;
  nodes?: unknown[];
  edges?: unknown[];
  canvas_layout?: unknown;
  default_on_error?: ErrorConfig | null;
  max_run_duration_ms?: number | null;
  max_run_cost_usd?: number | string | null;
  deployment_stage?: WorkflowDefinition["deploymentStage"] | null;
  [key: string]: unknown;
}

export interface NormalizedWorkflowRow {
  workflow: WorkflowDefinition;
  canvasLayout: CanvasWorkflowLayout;
  issues: WorkflowIssue[];
}

export type WorkflowBroadcast = (event: string, payload: unknown) => void;

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return undefined;
}

function timestampMsOrNow(value: unknown, fallback = Date.now()): number {
  const text = scalarText(value);
  if (!text) {
    return fallback;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function workflowFromRow(row: WorkflowRow): NormalizedWorkflowRow {
  return normalizeWorkflow({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    nodes: Array.isArray(row.nodes) ? row.nodes : [],
    edges: Array.isArray(row.edges) ? row.edges : [],
    canvasLayout: row.canvas_layout,
    defaultOnError: row.default_on_error ?? undefined,
    maxRunDurationMs: numberOrUndefined(row.max_run_duration_ms),
    maxRunCostUsd: numberOrUndefined(row.max_run_cost_usd),
    deploymentStage: row.deployment_stage ?? undefined,
  });
}

export function publicWorkflowRow(row: WorkflowRow) {
  const normalized = workflowFromRow(row);
  return {
    ...row,
    nodes: normalized.canvasLayout.nodes,
    edges: normalized.canvasLayout.edges,
    canvasLayout: normalized.canvasLayout,
    canvas_layout: normalized.canvasLayout,
    definition: normalized.workflow,
    validation: {
      ok: !hasBlockingWorkflowIssues(normalized.issues),
      issues: normalized.issues,
    },
  };
}

export async function createWorkflowRunRecord(
  sql: Sql,
  opts: {
    workflowId: string;
    workflowVersion: number;
    triggerType: string;
    triggerPayload?: Record<string, unknown>;
    runId?: string;
  },
) {
  const runId = opts.runId ?? randomUUID();
  const [run] = await sql`
    INSERT INTO workflow_runs (
      id, workflow_id, workflow_version, status,
      trigger_type, trigger_payload, variables
    ) VALUES (
      ${runId}, ${opts.workflowId}, ${opts.workflowVersion},
      'running', ${opts.triggerType},
      ${JSON.stringify(opts.triggerPayload ?? {})}::jsonb,
      '{}'::jsonb
    )
    RETURNING *
  `;
  return { runId, run };
}

export async function persistWorkflowStepRun(sql: Sql, runId: string, record: StepRecord) {
  await sql`
    INSERT INTO workflow_step_runs (
      id, run_id, node_id, node_kind, agent_id, idempotency_key,
      status, duration_ms, output_items, tokens_used, cost_usd, started_at, ended_at
    ) VALUES (
      ${randomUUID()}, ${runId}, ${record.nodeId}, ${record.nodeKind},
      ${record.agentId ?? null}, ${`${runId}:${record.nodeId}:${record.stepIndex}`},
      ${record.status}, ${record.durationMs},
      ${JSON.stringify(record.output)}::jsonb,
      ${record.tokensUsed ?? 0}, ${record.costUsd ?? 0},
      ${new Date(record.startedAt).toISOString()}::timestamptz,
      ${new Date(record.endedAt).toISOString()}::timestamptz
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET
      status = EXCLUDED.status,
      duration_ms = EXCLUDED.duration_ms,
      output_items = EXCLUDED.output_items,
      tokens_used = EXCLUDED.tokens_used,
      cost_usd = EXCLUDED.cost_usd,
      started_at = EXCLUDED.started_at,
      ended_at = EXCLUDED.ended_at,
      error = EXCLUDED.error
  `;
}

export async function finishWorkflowRun(
  sql: Sql,
  runId: string,
  status: string,
  steps: StepRecord[],
) {
  await sql`
    UPDATE workflow_runs SET
      status = ${status},
      total_tokens_used = ${steps.reduce((sum, step) => sum + (step.tokensUsed ?? 0), 0)},
      total_cost_usd = ${steps.reduce((sum, step) => sum + (step.costUsd ?? 0), 0)},
      ended_at = CASE
        WHEN ${status} IN ('waiting_approval', 'waiting_event', 'waiting_duration') THEN ended_at
        ELSE NOW()
      END
    WHERE id = ${runId}
  `;
}

export async function failWorkflowRun(sql: Sql, runId: string, error: string) {
  await sql`
    UPDATE workflow_runs SET status = 'failed', error = ${error}, ended_at = NOW()
    WHERE id = ${runId}
  `;
}

function getNodeLabelForHistory(workflow: WorkflowDefinition, nodeId: string): string {
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return nodeId;
  }
  if ("label" in node && typeof node.label === "string" && node.label.trim()) {
    return node.label;
  }
  return node.id;
}

function getNodeKindForHistory(kind: unknown): StepRecord["nodeKind"] {
  return kind === "trigger" ||
    kind === "agent" ||
    kind === "action" ||
    kind === "gate" ||
    kind === "output"
    ? kind
    : "action";
}

function getStepStatusForHistory(status: unknown): StepRecord["status"] {
  return status === "failed" || status === "skipped" ? status : "completed";
}

function itemSetFromStoredOutput(value: unknown): ItemSet {
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return value as ItemSet;
  }
  return { items: [] };
}

function createWorkflowActionExecutors(): ActionExecutors {
  return {
    saveToDocPanel: async (title, content, format) => {
      const { dashboardApiHeaders } = await import("../utils/dashboard-api.js");
      const dashboardApi = process.env.ARGENT_DASHBOARD_API || "http://localhost:9242";
      const docId = `wfdoc-${randomUUID()}`;
      const res = await fetch(`${dashboardApi}/api/canvas/save`, {
        method: "POST",
        headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          doc: {
            id: docId,
            title,
            content,
            type: format || "markdown",
            autoRouted: true,
          },
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "unknown error");
        throw new Error(`DocPanel save failed: HTTP ${res.status} - ${errBody}`);
      }
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        ok: true,
        docId: typeof data.id === "string" && data.id.trim() ? data.id : docId,
      };
    },
  };
}

function workflowOrderMap(workflow: WorkflowDefinition): Map<string, number> {
  return new Map(workflow.nodes.map((node, index) => [node.id, index]));
}

function workflowStepRowToRecord(
  row: Record<string, unknown>,
  workflow: WorkflowDefinition,
  order: Map<string, number>,
): StepRecord {
  const nodeId = scalarText(row.node_id) ?? "";
  const startedAt = timestampMsOrNow(row.started_at);
  const endedAt = timestampMsOrNow(row.ended_at, startedAt);
  return {
    nodeId,
    nodeKind: getNodeKindForHistory(row.node_kind),
    nodeLabel: getNodeLabelForHistory(workflow, nodeId),
    agentId: typeof row.agent_id === "string" ? row.agent_id : undefined,
    stepIndex: order.get(nodeId) ?? 0,
    status: getStepStatusForHistory(row.status),
    durationMs: typeof row.duration_ms === "number" ? row.duration_ms : 0,
    output: itemSetFromStoredOutput(row.output_items),
    tokensUsed: typeof row.tokens_used === "number" ? row.tokens_used : undefined,
    costUsd: numberOrUndefined(row.cost_usd),
    startedAt,
    endedAt,
  };
}

async function buildWorkflowResumeOptions(params: {
  sql: Sql;
  runId: string;
  resumeNodeId: string;
  workflow: WorkflowDefinition;
  runRow: Record<string, unknown>;
  resumeStepOutput: ItemSet;
  triggerSource: string;
}): Promise<WorkflowResumeOptions> {
  const order = workflowOrderMap(params.workflow);
  const resumeNode = params.workflow.nodes.find((node) => node.id === params.resumeNodeId);

  const rows = await params.sql`
    SELECT *
    FROM workflow_step_runs
    WHERE run_id = ${params.runId}
      AND status IN ('completed', 'failed', 'skipped')
    ORDER BY started_at NULLS LAST, ended_at NULLS LAST
  `;
  const resumeOrder = order.get(params.resumeNodeId) ?? Number.MAX_SAFE_INTEGER;
  const byNode = new Map<string, StepRecord>();
  for (const row of rows as Record<string, unknown>[]) {
    const record = workflowStepRowToRecord(row, params.workflow, order);
    const position = order.get(record.nodeId) ?? Number.MAX_SAFE_INTEGER;
    if (position <= resumeOrder) {
      byNode.set(record.nodeId, record);
    }
  }

  if (!byNode.has(params.resumeNodeId)) {
    byNode.set(params.resumeNodeId, {
      nodeId: params.resumeNodeId,
      nodeKind: "gate",
      nodeLabel: resumeNode
        ? getNodeLabelForHistory(params.workflow, resumeNode.id)
        : params.resumeNodeId,
      stepIndex: resumeOrder,
      status: "completed",
      durationMs: 0,
      output: params.resumeStepOutput,
      startedAt: Date.now(),
      endedAt: Date.now(),
    });
  }

  const triggerPayload =
    params.runRow.trigger_payload && typeof params.runRow.trigger_payload === "object"
      ? (params.runRow.trigger_payload as Record<string, unknown>)
      : {};
  const startedAt = timestampMsOrNow(params.runRow.started_at);

  return {
    afterNodeId: params.resumeNodeId,
    history: [...byNode.values()].toSorted((a, b) => a.stepIndex - b.stepIndex),
    trigger: {
      triggerType: (params.runRow.trigger_type as TriggerType | undefined) ?? "manual",
      firedAt: startedAt,
      payload: triggerPayload,
      source: params.triggerSource,
    },
    variables:
      params.runRow.variables && typeof params.runRow.variables === "object"
        ? (params.runRow.variables as Record<string, unknown>)
        : {},
  };
}

export async function buildWorkflowRetryFromStepResumeOptions(params: {
  sql: Sql;
  sourceRunId: string;
  fromStepNodeId: string;
  workflow: WorkflowDefinition;
  triggerSource: string;
}): Promise<WorkflowResumeOptions> {
  const order = workflowOrderMap(params.workflow);
  const fromOrder = order.get(params.fromStepNodeId);
  if (fromOrder === undefined) {
    throw new Error(`Workflow node ${params.fromStepNodeId} not found`);
  }

  const [sourceRun] = await params.sql`
    SELECT *
    FROM workflow_runs
    WHERE id = ${params.sourceRunId}
      AND workflow_id = ${params.workflow.id}
  `;
  if (!sourceRun) {
    throw new Error(`Source workflow run ${params.sourceRunId} not found`);
  }

  const rows = await params.sql`
    SELECT *
    FROM workflow_step_runs
    WHERE run_id = ${params.sourceRunId}
      AND status IN ('completed', 'skipped')
    ORDER BY started_at NULLS LAST, ended_at NULLS LAST
  `;
  const history = (rows as Record<string, unknown>[])
    .map((row) => workflowStepRowToRecord(row, params.workflow, order))
    .filter((record) => (order.get(record.nodeId) ?? Number.MAX_SAFE_INTEGER) < fromOrder)
    .toSorted((a, b) => a.stepIndex - b.stepIndex);

  const triggerPayload =
    sourceRun.trigger_payload && typeof sourceRun.trigger_payload === "object"
      ? (sourceRun.trigger_payload as Record<string, unknown>)
      : {};
  const startedAt = timestampMsOrNow(sourceRun.started_at);

  return {
    afterNodeId: history.at(-1)?.nodeId ?? "__workflow_start__",
    history,
    trigger: {
      triggerType: (sourceRun.trigger_type as TriggerType | undefined) ?? "manual",
      firedAt: startedAt,
      payload: triggerPayload,
      source: params.triggerSource,
    },
    variables:
      sourceRun.variables && typeof sourceRun.variables === "object"
        ? (sourceRun.variables as Record<string, unknown>)
        : {},
  };
}

export async function executeWorkflowRunFromRow(opts: {
  sql: Sql;
  workflowRow: WorkflowRow;
  runId: string;
  triggerType: string;
  triggerPayload?: Record<string, unknown>;
  triggerSource?: string;
  broadcast?: WorkflowBroadcast;
  outboundDeps?: OutboundSendDeps;
  resume?: WorkflowResumeOptions;
  stopAfterNodeId?: string;
}) {
  const { workflow, issues } = workflowFromRow(opts.workflowRow);
  if (hasBlockingWorkflowIssues(issues)) {
    const message = `Workflow validation failed: ${issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.message)
      .join("; ")}`;
    await failWorkflowRun(opts.sql, opts.runId, message);
    opts.broadcast?.("workflow.run.completed", {
      runId: opts.runId,
      workflowId: workflow.id,
      status: "failed",
      error: message,
    });
    return;
  }

  const dispatcher = new CoreAgentDispatcher();
  let redis: import("ioredis").default | null = null;
  try {
    const family = await getAgentFamily();
    redis = family.getRedis();
  } catch {
    /* Redis optional */
  }

  await executeWorkflow({
    workflow,
    runId: opts.runId,
    dispatcher,
    actions: createWorkflowActionExecutors(),
    triggerPayload: opts.triggerPayload,
    triggerSource: opts.triggerSource ?? opts.triggerType,
    stopAfterNodeId: opts.stopAfterNodeId,
    resume: opts.resume,
    redis,
    pgSql: opts.sql,
    onApprovalRequested: (nodeId, request) => {
      const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
      void (async () => {
        try {
          const row = await upsertDurableWorkflowApproval(opts.sql, {
            workflow,
            node,
            request,
          });
          opts.broadcast?.("workflow.approval.requested", {
            approvalId: row.id,
            runId: request.runId,
            workflowId: workflow.id,
            workflowName: workflow.name,
            nodeId: request.nodeId,
            nodeLabel: row.node_label,
            message: request.message,
            sideEffectClass: row.side_effect_class,
            previousOutputPreview: row.previous_output_preview,
            timeoutAt: row.timeout_at,
            timeoutAction: request.timeoutAction,
            requestedAt: request.requestedAt,
            approveAction: row.approve_action,
            denyAction: row.deny_action,
          });

          const approvalNotificationRequest = {
            approvalId: String(row.id),
            runId: request.runId,
            workflowId: workflow.id,
            workflowName: workflow.name,
            nodeId: request.nodeId,
            nodeLabel: typeof row.node_label === "string" ? row.node_label : null,
            message: request.message,
            sideEffectClass:
              typeof row.side_effect_class === "string" ? row.side_effect_class : null,
            previousOutputPreview: row.previous_output_preview,
            timeoutAt: row.timeout_at
              ? new Date(row.timeout_at as string | number | Date).toISOString()
              : null,
            timeoutAction: request.timeoutAction,
            requestedAt: request.requestedAt,
          };
          opts.broadcast?.(
            "operator.alert.requested",
            buildWorkflowApprovalOperatorAlertEvent(approvalNotificationRequest),
          );

          const notification = await notifyWorkflowApprovalRequest({
            request: approvalNotificationRequest,
            deps: { outboundDeps: opts.outboundDeps },
          });
          await markWorkflowApprovalNotified(opts.sql, {
            approvalId: row.id,
            status: notification.status,
            error:
              "errors" in notification && notification.errors.length
                ? notification.errors.join("; ")
                : undefined,
          });
        } catch (err) {
          log.warn(`failed to publish workflow approval request: ${String(err)}`);
          opts.broadcast?.("workflow.approval.requested", {
            runId: request.runId,
            workflowId: workflow.id,
            workflowName: workflow.name,
            nodeId: request.nodeId,
            message: request.message,
            previousOutput: request.showPreviousOutput ? request.previousOutput : undefined,
            timeoutMs: request.timeoutMs,
            timeoutAction: request.timeoutAction,
            requestedAt: request.requestedAt,
          });
        }
      })();
    },
    onStepStart: (nodeId, node) => {
      opts.broadcast?.("workflow.step.started", {
        runId: opts.runId,
        workflowId: workflow.id,
        nodeId,
        nodeKind: node.kind,
      });
    },
    onStepComplete: (nodeId, record) => {
      void persistWorkflowStepRun(opts.sql, opts.runId, record).catch((err: unknown) => {
        log.warn(`failed to persist workflow step: ${String(err)}`);
      });
      opts.broadcast?.("workflow.step.completed", {
        runId: opts.runId,
        workflowId: workflow.id,
        nodeId,
        status: record.status,
        durationMs: record.durationMs,
        tokensUsed: record.tokensUsed,
      });
    },
    onRunComplete: (status, steps) => {
      void finishWorkflowRun(opts.sql, opts.runId, status, steps).catch((err: unknown) => {
        log.warn(`failed to finish workflow run: ${String(err)}`);
      });
      opts.broadcast?.("workflow.run.completed", {
        runId: opts.runId,
        workflowId: workflow.id,
        status,
        stepCount: steps.length,
      });
    },
  }).catch((err: unknown) => {
    const message = String(err);
    log.error(`workflow execution failed: runId=${opts.runId} error=${message}`);
    void failWorkflowRun(opts.sql, opts.runId, message).catch(() => {});
    opts.broadcast?.("workflow.run.completed", {
      runId: opts.runId,
      workflowId: workflow.id,
      status: "failed",
      error: message,
    });
  });
}

export async function resumeWorkflowRunAfterApproval(opts: {
  sql: Sql;
  runId: string;
  nodeId: string;
  triggerSource?: string;
  broadcast?: WorkflowBroadcast;
  outboundDeps?: OutboundSendDeps;
}) {
  const [runRow] = await opts.sql`
    SELECT *
    FROM workflow_runs
    WHERE id = ${opts.runId}
      AND status IN ('waiting_approval', 'running')
  `;
  if (!runRow) {
    throw new Error(`Workflow run ${opts.runId} is not resumable`);
  }

  const [workflowRow] = await opts.sql`
    SELECT *
    FROM workflows
    WHERE id = ${runRow.workflow_id}
  `;
  if (!workflowRow) {
    throw new Error(`Workflow ${runRow.workflow_id} not found for run ${opts.runId}`);
  }

  const { workflow, issues } = workflowFromRow(workflowRow as unknown as WorkflowRow);
  if (hasBlockingWorkflowIssues(issues)) {
    throw new Error(
      `Workflow validation failed: ${issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  const approvalOutput: ItemSet = {
    items: [
      {
        json: { gateType: "approval", approved: true, resumed: true },
        text: "Approval granted - pipeline resumed",
      },
    ],
  };
  await opts.sql`
    UPDATE workflow_step_runs SET
      status = 'completed',
      approval_status = 'approved',
      output_items = ${JSON.stringify(approvalOutput)}::jsonb,
      ended_at = COALESCE(ended_at, NOW()),
      duration_ms = COALESCE(duration_ms, 0)
    WHERE run_id = ${opts.runId}
      AND node_id = ${opts.nodeId}
  `;
  await opts.sql`
    UPDATE workflow_runs SET status = 'running', current_node_id = NULL
    WHERE id = ${opts.runId}
  `;

  const resume = await buildWorkflowResumeOptions({
    sql: opts.sql,
    runId: opts.runId,
    resumeNodeId: opts.nodeId,
    workflow,
    runRow: runRow as Record<string, unknown>,
    resumeStepOutput: approvalOutput,
    triggerSource: opts.triggerSource ?? "gateway:approval_resume",
  });

  opts.broadcast?.("workflow.run.resumed", {
    runId: opts.runId,
    workflowId: workflow.id,
    nodeId: opts.nodeId,
    resumedAfterNodeId: opts.nodeId,
  });

  await executeWorkflowRunFromRow({
    sql: opts.sql,
    workflowRow: workflowRow as unknown as WorkflowRow,
    runId: opts.runId,
    triggerType: String(runRow.trigger_type ?? "manual"),
    triggerPayload:
      runRow.trigger_payload && typeof runRow.trigger_payload === "object"
        ? (runRow.trigger_payload as Record<string, unknown>)
        : {},
    triggerSource: opts.triggerSource ?? "gateway:approval_resume",
    broadcast: opts.broadcast,
    outboundDeps: opts.outboundDeps,
    resume,
  });
}

export async function resumeWorkflowRunAfterWait(opts: {
  sql: Sql;
  runId: string;
  nodeId: string;
  force?: boolean;
  triggerSource?: string;
  broadcast?: WorkflowBroadcast;
  outboundDeps?: OutboundSendDeps;
}) {
  const [runRow] = await opts.sql`
    SELECT *
    FROM workflow_runs
    WHERE id = ${opts.runId}
      AND status IN ('waiting_duration', 'running')
  `;
  if (!runRow) {
    throw new Error(`Workflow run ${opts.runId} is not waiting for a duration`);
  }

  const [workflowRow] = await opts.sql`
    SELECT *
    FROM workflows
    WHERE id = ${runRow.workflow_id}
  `;
  if (!workflowRow) {
    throw new Error(`Workflow ${runRow.workflow_id} not found for run ${opts.runId}`);
  }

  const [stepRow] = await opts.sql`
    SELECT *
    FROM workflow_step_runs
    WHERE run_id = ${opts.runId}
      AND node_id = ${opts.nodeId}
    ORDER BY started_at DESC
    LIMIT 1
  `;
  const inputContext =
    stepRow?.input_context && typeof stepRow.input_context === "object"
      ? (stepRow.input_context as Record<string, unknown>)
      : {};
  const resumeAt = typeof inputContext.waitResumeAt === "string" ? inputContext.waitResumeAt : null;
  if (!opts.force && resumeAt) {
    const resumeAtMs = Date.parse(resumeAt);
    if (Number.isFinite(resumeAtMs) && Date.now() < resumeAtMs) {
      throw new Error(`Workflow wait is not due until ${resumeAt}`);
    }
  }

  const { workflow, issues } = workflowFromRow(workflowRow as unknown as WorkflowRow);
  if (hasBlockingWorkflowIssues(issues)) {
    throw new Error(
      `Workflow validation failed: ${issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  const waitOutput: ItemSet = {
    items: [
      {
        json: {
          gateType: "wait_duration",
          waited: true,
          resumed: true,
          resumeAt,
        },
        text: resumeAt ? `Wait complete - resumed after ${resumeAt}` : "Wait complete - resumed",
      },
    ],
  };
  await opts.sql`
    UPDATE workflow_step_runs SET
      status = 'completed',
      output_items = ${JSON.stringify(waitOutput)}::jsonb,
      ended_at = COALESCE(ended_at, NOW()),
      duration_ms = COALESCE(duration_ms, 0)
    WHERE run_id = ${opts.runId}
      AND node_id = ${opts.nodeId}
  `;
  await opts.sql`
    UPDATE workflow_runs SET status = 'running', current_node_id = NULL
    WHERE id = ${opts.runId}
  `;

  const resume = await buildWorkflowResumeOptions({
    sql: opts.sql,
    runId: opts.runId,
    resumeNodeId: opts.nodeId,
    workflow,
    runRow: runRow as Record<string, unknown>,
    resumeStepOutput: waitOutput,
    triggerSource: opts.triggerSource ?? "gateway:wait_resume",
  });

  opts.broadcast?.("workflow.run.resumed", {
    runId: opts.runId,
    workflowId: workflow.id,
    nodeId: opts.nodeId,
    resumedAfterNodeId: opts.nodeId,
  });

  await executeWorkflowRunFromRow({
    sql: opts.sql,
    workflowRow: workflowRow as unknown as WorkflowRow,
    runId: opts.runId,
    triggerType: String(runRow.trigger_type ?? "manual"),
    triggerPayload:
      runRow.trigger_payload && typeof runRow.trigger_payload === "object"
        ? (runRow.trigger_payload as Record<string, unknown>)
        : {},
    triggerSource: opts.triggerSource ?? "gateway:wait_resume",
    broadcast: opts.broadcast,
    outboundDeps: opts.outboundDeps,
    resume,
  });
}

function getEventValue(event: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(event, key)) {
    return event[key];
  }
  const payload = event.payload;
  if (
    payload &&
    typeof payload === "object" &&
    Object.prototype.hasOwnProperty.call(payload, key)
  ) {
    return (payload as Record<string, unknown>)[key];
  }
  return undefined;
}

function eventMatchesFilter(
  event: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    if (expected === undefined || expected === null || expected === "") {
      continue;
    }
    if (getEventValue(event, key) !== expected) {
      return false;
    }
  }
  return true;
}

export async function resumeWorkflowRunAfterEvent(opts: {
  sql: Sql;
  runId: string;
  nodeId: string;
  eventType: string;
  eventPayload?: Record<string, unknown>;
  triggerSource?: string;
  broadcast?: WorkflowBroadcast;
  outboundDeps?: OutboundSendDeps;
}) {
  const [runRow] = await opts.sql`
    SELECT *
    FROM workflow_runs
    WHERE id = ${opts.runId}
      AND status IN ('waiting_event', 'running')
  `;
  if (!runRow) {
    throw new Error(`Workflow run ${opts.runId} is not waiting for an event`);
  }

  const [workflowRow] = await opts.sql`
    SELECT *
    FROM workflows
    WHERE id = ${runRow.workflow_id}
  `;
  if (!workflowRow) {
    throw new Error(`Workflow ${runRow.workflow_id} not found for run ${opts.runId}`);
  }

  const [stepRow] = await opts.sql`
    SELECT *
    FROM workflow_step_runs
    WHERE run_id = ${opts.runId}
      AND node_id = ${opts.nodeId}
    ORDER BY started_at DESC
    LIMIT 1
  `;
  const inputContext =
    stepRow?.input_context && typeof stepRow.input_context === "object"
      ? (stepRow.input_context as Record<string, unknown>)
      : {};
  const expectedType =
    typeof inputContext.eventType === "string" && inputContext.eventType.trim()
      ? inputContext.eventType.trim()
      : "";
  if (expectedType && expectedType !== opts.eventType) {
    throw new Error(`Workflow wait expects event ${expectedType}, got ${opts.eventType}`);
  }
  const eventFilter =
    inputContext.eventFilter && typeof inputContext.eventFilter === "object"
      ? (inputContext.eventFilter as Record<string, unknown>)
      : {};
  const eventEnvelope = {
    type: opts.eventType,
    ...opts.eventPayload,
    payload: opts.eventPayload ?? {},
  };
  if (!eventMatchesFilter(eventEnvelope, eventFilter)) {
    throw new Error(`Workflow event ${opts.eventType} did not match wait filter`);
  }

  const { workflow, issues } = workflowFromRow(workflowRow as unknown as WorkflowRow);
  if (hasBlockingWorkflowIssues(issues)) {
    throw new Error(
      `Workflow validation failed: ${issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  const eventOutput: ItemSet = {
    items: [
      {
        json: {
          gateType: "wait_event",
          eventType: opts.eventType,
          matched: true,
          event: opts.eventPayload ?? {},
        },
        text: `Event received: ${opts.eventType}`,
      },
    ],
  };
  await opts.sql`
    UPDATE workflow_step_runs SET
      status = 'completed',
      output_items = ${JSON.stringify(eventOutput)}::jsonb,
      ended_at = COALESCE(ended_at, NOW()),
      duration_ms = COALESCE(duration_ms, 0)
    WHERE run_id = ${opts.runId}
      AND node_id = ${opts.nodeId}
  `;
  await opts.sql`
    UPDATE workflow_runs SET status = 'running', current_node_id = NULL
    WHERE id = ${opts.runId}
  `;

  const resume = await buildWorkflowResumeOptions({
    sql: opts.sql,
    runId: opts.runId,
    resumeNodeId: opts.nodeId,
    workflow,
    runRow: runRow as Record<string, unknown>,
    resumeStepOutput: eventOutput,
    triggerSource: opts.triggerSource ?? "gateway:event_resume",
  });

  opts.broadcast?.("workflow.run.resumed", {
    runId: opts.runId,
    workflowId: workflow.id,
    nodeId: opts.nodeId,
    eventType: opts.eventType,
    resumedAfterNodeId: opts.nodeId,
  });

  await executeWorkflowRunFromRow({
    sql: opts.sql,
    workflowRow: workflowRow as unknown as WorkflowRow,
    runId: opts.runId,
    triggerType: String(runRow.trigger_type ?? "manual"),
    triggerPayload:
      runRow.trigger_payload && typeof runRow.trigger_payload === "object"
        ? (runRow.trigger_payload as Record<string, unknown>)
        : {},
    triggerSource: opts.triggerSource ?? "gateway:event_resume",
    broadcast: opts.broadcast,
    outboundDeps: opts.outboundDeps,
    resume,
  });
}

export async function resumeWorkflowRunsForEvent(opts: {
  sql: Sql;
  eventType: string;
  eventPayload?: Record<string, unknown>;
  runId?: string;
  nodeId?: string;
  limit?: number;
  broadcast?: WorkflowBroadcast;
  outboundDeps?: OutboundSendDeps;
}) {
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 100));
  const rows =
    opts.runId && opts.nodeId
      ? await opts.sql`
          SELECT r.id AS run_id, r.current_node_id
          FROM workflow_runs r
          WHERE r.id = ${opts.runId}
            AND r.current_node_id = ${opts.nodeId}
            AND r.status = 'waiting_event'
          LIMIT 1
        `
      : await opts.sql`
          SELECT r.id AS run_id, r.current_node_id
          FROM workflow_runs r
          JOIN workflow_step_runs s
            ON s.run_id = r.id
           AND s.node_id = r.current_node_id
          WHERE r.status = 'waiting_event'
            AND r.current_node_id IS NOT NULL
            AND COALESCE(s.input_context->>'eventType', '') IN (${opts.eventType}, '')
          ORDER BY s.started_at ASC NULLS LAST
          LIMIT ${limit}
        `;

  const errors: string[] = [];
  let resumed = 0;
  for (const row of rows as Array<{ run_id?: string; current_node_id?: string }>) {
    if (!row.run_id || !row.current_node_id) {
      continue;
    }
    try {
      await resumeWorkflowRunAfterEvent({
        sql: opts.sql,
        runId: row.run_id,
        nodeId: row.current_node_id,
        eventType: opts.eventType,
        eventPayload: opts.eventPayload,
        triggerSource: "gateway:workflow_event",
        broadcast: opts.broadcast,
        outboundDeps: opts.outboundDeps,
      });
      resumed++;
    } catch (err) {
      errors.push(`run=${row.run_id} node=${row.current_node_id}: ${String(err)}`);
    }
  }

  return { resumed, errors };
}

export async function resumeDueWorkflowWaits(opts: {
  sql: Sql;
  now?: Date;
  limit?: number;
  broadcast?: WorkflowBroadcast;
  outboundDeps?: OutboundSendDeps;
}) {
  const now = opts.now ?? new Date();
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 100));
  const durationRows = await opts.sql`
    SELECT r.id AS run_id, r.workflow_id, r.current_node_id, s.input_context
    FROM workflow_runs r
    JOIN workflow_step_runs s
      ON s.run_id = r.id
     AND s.node_id = r.current_node_id
    WHERE r.status = 'waiting_duration'
      AND r.current_node_id IS NOT NULL
      AND s.input_context ? 'waitResumeAt'
      AND (s.input_context->>'waitResumeAt')::timestamptz <= ${now.toISOString()}::timestamptz
    ORDER BY (s.input_context->>'waitResumeAt')::timestamptz ASC
    LIMIT ${limit}
  `;

  const errors: string[] = [];
  let resumed = 0;
  let failed = 0;
  for (const row of durationRows as Array<{ run_id?: string; current_node_id?: string }>) {
    if (!row.run_id || !row.current_node_id) {
      continue;
    }
    try {
      await resumeWorkflowRunAfterWait({
        sql: opts.sql,
        runId: row.run_id,
        nodeId: row.current_node_id,
        triggerSource: "cron:workflow_wait_resume",
        broadcast: opts.broadcast,
        outboundDeps: opts.outboundDeps,
        force: true,
      });
      resumed++;
    } catch (err) {
      errors.push(`run=${row.run_id} node=${row.current_node_id}: ${String(err)}`);
    }
  }

  const eventLimit = Math.max(1, limit - resumed);
  const eventRows = await opts.sql`
    SELECT r.id AS run_id, r.workflow_id, r.current_node_id, s.input_context
    FROM workflow_runs r
    JOIN workflow_step_runs s
      ON s.run_id = r.id
     AND s.node_id = r.current_node_id
    WHERE r.status = 'waiting_event'
      AND r.current_node_id IS NOT NULL
      AND s.input_context ? 'waitResumeAt'
      AND (s.input_context->>'waitResumeAt')::timestamptz <= ${now.toISOString()}::timestamptz
    ORDER BY (s.input_context->>'waitResumeAt')::timestamptz ASC
    LIMIT ${eventLimit}
  `;

  for (const row of eventRows as Array<{
    run_id?: string;
    workflow_id?: string;
    current_node_id?: string;
    input_context?: Record<string, unknown>;
  }>) {
    if (!row.run_id || !row.current_node_id) {
      continue;
    }
    const inputContext =
      row.input_context && typeof row.input_context === "object" ? row.input_context : {};
    const eventType =
      typeof inputContext.eventType === "string" && inputContext.eventType.trim()
        ? inputContext.eventType.trim()
        : "workflow.event";
    const timeoutAction = inputContext.timeoutAction === "continue" ? "continue" : "fail";
    try {
      if (timeoutAction === "fail") {
        const message = `Timed out waiting for event ${eventType}`;
        await opts.sql`
          UPDATE workflow_step_runs SET
            status = 'failed',
            error = ${message},
            ended_at = COALESCE(ended_at, NOW())
          WHERE run_id = ${row.run_id}
            AND node_id = ${row.current_node_id}
        `;
        await failWorkflowRun(opts.sql, row.run_id, message);
        opts.broadcast?.("workflow.run.completed", {
          runId: row.run_id,
          workflowId: row.workflow_id,
          status: "failed",
          error: message,
        });
        failed++;
        continue;
      }

      const [runRow] = await opts.sql`
        SELECT *
        FROM workflow_runs
        WHERE id = ${row.run_id}
      `;
      if (!runRow) {
        throw new Error(`Workflow run ${row.run_id} could not be loaded for event timeout`);
      }
      const [workflowRow] = await opts.sql`
        SELECT *
        FROM workflows
        WHERE id = ${runRow.workflow_id}
      `;
      if (!workflowRow) {
        throw new Error(`Workflow run ${row.run_id} could not be loaded for event timeout`);
      }
      const { workflow, issues } = workflowFromRow(workflowRow as unknown as WorkflowRow);
      if (hasBlockingWorkflowIssues(issues)) {
        throw new Error(
          `Workflow validation failed: ${issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.message)
            .join("; ")}`,
        );
      }
      const timeoutOutput: ItemSet = {
        items: [
          {
            json: {
              gateType: "wait_event",
              eventType,
              timedOut: true,
              timeoutAction,
            },
            text: `Event wait timed out: ${eventType}`,
          },
        ],
      };
      await opts.sql`
        UPDATE workflow_step_runs SET
          status = 'completed',
          output_items = ${JSON.stringify(timeoutOutput)}::jsonb,
          ended_at = COALESCE(ended_at, NOW()),
          duration_ms = COALESCE(duration_ms, 0)
        WHERE run_id = ${row.run_id}
          AND node_id = ${row.current_node_id}
      `;
      await opts.sql`
        UPDATE workflow_runs SET status = 'running', current_node_id = NULL
        WHERE id = ${row.run_id}
      `;
      const resume = await buildWorkflowResumeOptions({
        sql: opts.sql,
        runId: row.run_id,
        resumeNodeId: row.current_node_id,
        workflow,
        runRow: runRow as Record<string, unknown>,
        resumeStepOutput: timeoutOutput,
        triggerSource: "cron:workflow_event_timeout",
      });
      opts.broadcast?.("workflow.run.resumed", {
        runId: row.run_id,
        workflowId: workflow.id,
        nodeId: row.current_node_id,
        eventType,
        timedOut: true,
        resumedAfterNodeId: row.current_node_id,
      });
      await executeWorkflowRunFromRow({
        sql: opts.sql,
        workflowRow: workflowRow as unknown as WorkflowRow,
        runId: row.run_id,
        triggerType: String(runRow.trigger_type ?? "manual"),
        triggerPayload:
          runRow.trigger_payload && typeof runRow.trigger_payload === "object"
            ? (runRow.trigger_payload as Record<string, unknown>)
            : {},
        triggerSource: "cron:workflow_event_timeout",
        broadcast: opts.broadcast,
        outboundDeps: opts.outboundDeps,
        resume,
      });
      resumed++;
    } catch (err) {
      errors.push(`run=${row.run_id} node=${row.current_node_id}: ${String(err)}`);
    }
  }

  return { resumed, failed, errors };
}
