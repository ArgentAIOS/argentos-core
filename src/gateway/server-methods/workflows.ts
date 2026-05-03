import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import type { ArgentConfig } from "../../config/config.js";
import type { CronService } from "../../cron/service.js";
import type { CronJob, CronJobCreate, CronJobPatch } from "../../cron/types.js";
import type { StorageConfig } from "../../data/storage-config.js";
import type { WorkflowDefinition, WorkflowNode } from "../../infra/workflow-types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { createOutboundSendDeps } from "../../cli/deps.js";
import {
  parseConnectorManifest,
  enrichWithHealthProbe,
  type HealthProbeResult,
  type DoctorProbeResult,
} from "../../connectors/canvas-node-parser.js";
import {
  discoverConnectorCatalog,
  defaultRepoRoots,
  runConnectorCommandJson,
  type ConnectorCatalogEntry,
} from "../../connectors/catalog.js";
import { resolvePostgresUrl, resolveRuntimeStorageConfig } from "../../data/storage-resolver.js";
import {
  collectAppForgeWorkflowCapabilities,
  type AppForgeAppSummary,
  type AppForgeWorkflowCapability,
} from "../../infra/appforge-workflow-capabilities.js";
import {
  appForgeEventMatchesTriggerConfig,
  normalizeAppForgeWorkflowEvent,
  type NormalizedAppForgeWorkflowEvent,
} from "../../infra/appforge-workflow-events.js";
import {
  pgListServiceKeys,
  pgUpsertServiceKey,
  pgDeleteServiceKey,
  pgGetServiceKeyByVariable,
} from "../../infra/pg-secret-store.js";
import {
  getWorkflowActionCapability,
  WORKFLOW_ACTION_CAPABILITIES,
} from "../../infra/workflow-action-capabilities.js";
import { resolveDurableWorkflowApproval } from "../../infra/workflow-approvals.js";
import { draftWorkflowFromIntent } from "../../infra/workflow-builder.js";
import {
  connectorCommandExtraArgToCliArg,
  connectorCommandToCliArgs,
} from "../../infra/workflow-connector-command.js";
import {
  buildWorkflowRetryFromStepResumeOptions,
  createWorkflowRunRecord,
  executeWorkflowRunFromRow,
  parseWorkflowJsonColumn,
  publicWorkflowRow,
  resumeWorkflowRunsForEvent,
  resumeWorkflowRunAfterApproval,
  resumeWorkflowRunAfterWait,
  type WorkflowRow,
  workflowFromRow,
  workflowJsonFieldsFromRow,
} from "../../infra/workflow-execution-service.js";
import {
  hasBlockingWorkflowIssues,
  normalizeWorkflow,
  type WorkflowIssue,
} from "../../infra/workflow-normalize.js";
import { OWNER_OPERATOR_WORKFLOW_PACKAGES } from "../../infra/workflow-owner-operator-templates.js";
import {
  applyWorkflowPackageTestFixtures,
  importWorkflowPackage,
  parseWorkflowPackageText,
  type WorkflowPackage,
  type WorkflowPackageFormat,
  type WorkflowPackageLiveReadinessContext,
} from "../../infra/workflow-package.js";
import {
  buildWorkflowAgentSessionKey,
  topologicalSort,
  validateWorkflowAgentSessionIdentity,
} from "../../infra/workflow-runner.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { dashboardApiHeaders } from "../../utils/dashboard-api.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { buildWorkflowPersonalSkillCapabilities } from "./skills.js";
import { buildToolsStatusPayload } from "./tools.js";

const log = createSubsystemLogger("gateway/workflows");
const WORKFLOW_SCHEDULE_CRON_MARKER = "[workflow_schedule]";
export const WORKFLOWS_LIST_NO_LIVE_DATA_SNAPSHOT = "rust-parity-v1";

const WORKFLOW_PRIMITIVES = [
  { id: "trigger", label: "Trigger", description: "Start condition" },
  { id: "agentStep", label: "Agent Step", description: "ArgentOS agent handoff" },
  { id: "action", label: "Action", description: "Deterministic operation" },
  { id: "gate", label: "Gate", description: "Control flow and approvals" },
  { id: "output", label: "Output", description: "Deliver or persist results" },
  { id: "modelProvider", label: "Model", description: "Per-agent model override" },
  { id: "memorySource", label: "Memory", description: "Knowledge context binding" },
  { id: "toolGrant", label: "Tool", description: "Grant a runtime tool or connector" },
] as const;

const DASHBOARD_API = process.env.ARGENT_DASHBOARD_API || "http://localhost:9242";

type WorkflowOutputChannelTarget = {
  id: string;
  label: string;
  kind: "dm" | "group" | "channel" | "allowlist" | "custom";
};

type WorkflowOutputChannelOption = {
  id: string;
  label: string;
  defaultAccountId: string;
  accountIds: string[];
  deliveryMode: "direct" | "gateway" | "hybrid";
  configured: boolean;
  statusLabel?: string;
  targets?: WorkflowOutputChannelTarget[];
};

type WorkflowConnectorCapability = {
  id: string;
  name: string;
  category: string;
  categories: string[] | undefined;
  commands: Array<{
    id: string;
    summary: string | undefined;
    actionClass: string | undefined;
  }>;
  installState: string;
  statusOk: boolean;
  scaffoldOnly: boolean;
  readinessState: "blocked" | "setup_required" | "read_ready" | "write_ready";
};

function workflowConnectorReadinessState(
  connector: ConnectorCatalogEntry,
  scaffoldOnly: boolean,
): WorkflowConnectorCapability["readinessState"] {
  if (
    scaffoldOnly ||
    connector.installState === "repo-only" ||
    connector.installState === "error"
  ) {
    return "blocked";
  }
  if (connector.installState === "metadata-only") {
    return "read_ready";
  }
  if (connector.installState === "ready") {
    return connector.discovery.binaryPath ? "write_ready" : "read_ready";
  }
  return "setup_required";
}

function isWorkflowOutputConnectorCommand(command: {
  id: string;
  actionClass: string | undefined;
}): boolean {
  const actionClass = command.actionClass?.toLowerCase();
  if (actionClass === "read") {
    return false;
  }
  if (actionClass === "write" || actionClass === "destructive") {
    return true;
  }
  return /\.(send|post|create|update|delete|publish|schedule|reply|upload|append|trigger)\b/.test(
    command.id,
  );
}

// ── Postgres connection (lazy singleton) ────────────────────────────────────

let _sql: ReturnType<typeof postgres> | null = null;
let _initPromise: Promise<ReturnType<typeof postgres> | null> | null = null;

function jsonParam(sql: ReturnType<typeof postgres>, value: unknown) {
  return sql.json(value as postgres.JSONValue);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return stableJson(left ?? null) === stableJson(right ?? null);
}

function isPgBacked(env: NodeJS.ProcessEnv = process.env): boolean {
  const cfg = resolveRuntimeStorageConfig(env);
  return cfg.backend === "postgres" || cfg.backend === "dual";
}

type WorkflowBackendStatus = {
  ok: true;
  label: string;
  backend: StorageConfig["backend"];
  readFrom: StorageConfig["readFrom"];
  writeTo: StorageConfig["writeTo"];
  postgres: {
    requiredForSavedWorkflows: true;
    activeForRuntime: boolean;
    connectionSource: "env" | "config" | "default" | "not_applicable";
    status: "configured" | "not_configured";
  };
  dryRun: {
    graphPayloadAvailable: true;
    requiresPostgres: false;
    method: "workflows.dryRun";
    command: string;
    noLiveSideEffects: true;
    message: string;
  };
  savedWorkflows: {
    available: boolean;
    requiresPostgres: true;
    message: string;
  };
  scheduleCron: {
    available: boolean;
    requiresPostgres: true;
    status: "configured" | "skipped_no_postgres";
    message: string;
  };
  schedulerBoundary: {
    contractVersion: "rust-spine-scheduler-v1";
    schedulerAuthority: "node";
    rustScheduler: "shadow";
    workflowRunAuthority: "node";
    workflowSessionAuthority: "node";
    channelDeliveryAuthority: "node";
    authoritySwitchAllowed: false;
    localDryRunCompatible: true;
    leases: {
      requiredForLiveRuns: true;
      storage: "postgres";
      status: "configured" | "blocked_without_postgres";
      owner: "node-workflows";
      rustOwnership: "not_enabled";
      message: string;
    };
    wakeups: {
      owner: "node-cron";
      mode: "next-heartbeat";
      rustOwnership: "shadow";
      duplicatePrevention: string;
      message: string;
    };
    handoff: {
      runPayload: "cron payload kind=workflowRun workflowId";
      session: "isolated workflow agent session";
      dryRun: "canvas payload validation";
      liveRunRequiresPostgres: true;
      message: string;
    };
    runSessionHandoff: {
      contractVersion: "workflow-run-session-handoff-v1";
      dryRun: {
        authority: "node-workflows";
        input: "canvas payload";
        persistsWorkflowRun: false;
        requiresPostgres: false;
        duplicatePrevention: "not_applicable_no_saved_run";
      };
      liveRun: {
        authority: "node-workflows";
        input: "saved workflow row";
        payloadKind: "workflowRun";
        persistsWorkflowRun: true;
        requiresPostgres: true;
        sessionTarget: "isolated";
      };
      session: {
        owner: "node-workflow-runner";
        keyDerivation: "buildWorkflowAgentSessionKey(agentId, stepIndex)";
        isolation: "per agent step";
        rustOwnership: "not_enabled";
      };
      duplicatePrevention: {
        scheduleCron: "one workflowRun cron job per active schedule";
        duplicateWorkflow: "scheduled duplicates start inactive";
        staleCronCleanup: "extra workflowRun cron jobs are removed during reconciliation";
        rustOwnership: "shadow_observe_only";
      };
      rustPromotionBlockers: string[];
      message: string;
    };
    blockers: string[];
  };
  operatorMessages: string[];
};

function resolvePostgresConnectionSource(
  env: NodeJS.ProcessEnv,
  storage: StorageConfig,
): WorkflowBackendStatus["postgres"]["connectionSource"] {
  if (storage.backend !== "postgres" && storage.backend !== "dual") {
    return "not_applicable";
  }
  if (env.ARGENT_PG_URL?.trim() || env.PG_URL?.trim()) {
    return "env";
  }
  if (storage.postgres?.connectionString?.trim()) {
    return "config";
  }
  return "default";
}

export function buildWorkflowBackendStatus(options?: {
  env?: NodeJS.ProcessEnv;
  storage?: StorageConfig;
}): WorkflowBackendStatus {
  const env = options?.env ?? process.env;
  const storage = options?.storage ?? resolveRuntimeStorageConfig(env);
  const pgActive = storage.backend === "postgres" || storage.backend === "dual";
  const connectionSource = resolvePostgresConnectionSource(env, storage);
  const savedWorkflowsAvailable = pgActive;
  const dryRunMessage =
    "Canvas payload dry-runs can validate workflow shape and step readiness without PostgreSQL.";
  const savedMessage = savedWorkflowsAvailable
    ? "Saved workflow create/list/run paths are configured to use PostgreSQL at runtime."
    : "Saved workflow create/list/run paths require PostgreSQL; use canvas payload dry-run or configure storage.backend=postgres/dual.";
  const scheduleCronMessage = savedWorkflowsAvailable
    ? "Scheduled workflow cron reconciliation is configured for saved workflows."
    : "Scheduled workflow cron reconciliation is skipped without PostgreSQL; local/parity gateways can still validate dry-run readiness without running saved workflow schedules.";
  const leaseMessage = savedWorkflowsAvailable
    ? "Live workflow scheduler leases are owned by Node workflows and backed by PostgreSQL; Rust scheduler remains shadow-only."
    : "Live workflow scheduler leases require PostgreSQL and remain unavailable locally; Rust scheduler remains shadow-only.";
  const wakeupMessage =
    "Node cron owns workflow wakeups in next-heartbeat mode; duplicate prevention keeps one workflowRun cron job per active schedule and starts scheduled duplicates inactive.";
  const handoffMessage =
    "Node workflows own workflowRun payload handling and isolated workflow agent sessions; Rust may observe the contract but cannot take authority.";
  const runSessionHandoffMessage =
    "Dry-run validates canvas payloads without persisted runs; live workflowRun payloads and isolated agent sessions remain Node-owned with PostgreSQL-backed duplicate prevention.";
  const schedulerBlockers = savedWorkflowsAvailable
    ? ["rust_scheduler_shadow_only", "authority_switch_not_allowed"]
    : [
        "postgres_required_for_live_scheduler_leases",
        "rust_scheduler_shadow_only",
        "authority_switch_not_allowed",
      ];

  return {
    ok: true,
    label: savedWorkflowsAvailable
      ? "Saved workflows configured; dry-run also available without PostgreSQL"
      : "Dry-run available; saved workflows need PostgreSQL",
    backend: storage.backend,
    readFrom: storage.readFrom,
    writeTo: storage.writeTo,
    postgres: {
      requiredForSavedWorkflows: true,
      activeForRuntime: pgActive,
      connectionSource,
      status: pgActive ? "configured" : "not_configured",
    },
    dryRun: {
      graphPayloadAvailable: true,
      requiresPostgres: false,
      method: "workflows.dryRun",
      command: "argent gateway call workflows.dryRun --params '<canvas-payload-json>' --json",
      noLiveSideEffects: true,
      message: dryRunMessage,
    },
    savedWorkflows: {
      available: savedWorkflowsAvailable,
      requiresPostgres: true,
      message: savedMessage,
    },
    scheduleCron: {
      available: savedWorkflowsAvailable,
      requiresPostgres: true,
      status: savedWorkflowsAvailable ? "configured" : "skipped_no_postgres",
      message: scheduleCronMessage,
    },
    schedulerBoundary: {
      contractVersion: "rust-spine-scheduler-v1",
      schedulerAuthority: "node",
      rustScheduler: "shadow",
      workflowRunAuthority: "node",
      workflowSessionAuthority: "node",
      channelDeliveryAuthority: "node",
      authoritySwitchAllowed: false,
      localDryRunCompatible: true,
      leases: {
        requiredForLiveRuns: true,
        storage: "postgres",
        status: savedWorkflowsAvailable ? "configured" : "blocked_without_postgres",
        owner: "node-workflows",
        rustOwnership: "not_enabled",
        message: leaseMessage,
      },
      wakeups: {
        owner: "node-cron",
        mode: "next-heartbeat",
        rustOwnership: "shadow",
        duplicatePrevention:
          "one workflowRun cron job per active schedule; duplicate scheduled workflows start inactive",
        message: wakeupMessage,
      },
      handoff: {
        runPayload: "cron payload kind=workflowRun workflowId",
        session: "isolated workflow agent session",
        dryRun: "canvas payload validation",
        liveRunRequiresPostgres: true,
        message: handoffMessage,
      },
      runSessionHandoff: {
        contractVersion: "workflow-run-session-handoff-v1",
        dryRun: {
          authority: "node-workflows",
          input: "canvas payload",
          persistsWorkflowRun: false,
          requiresPostgres: false,
          duplicatePrevention: "not_applicable_no_saved_run",
        },
        liveRun: {
          authority: "node-workflows",
          input: "saved workflow row",
          payloadKind: "workflowRun",
          persistsWorkflowRun: true,
          requiresPostgres: true,
          sessionTarget: "isolated",
        },
        session: {
          owner: "node-workflow-runner",
          keyDerivation: "buildWorkflowAgentSessionKey(agentId, stepIndex)",
          isolation: "per agent step",
          rustOwnership: "not_enabled",
        },
        duplicatePrevention: {
          scheduleCron: "one workflowRun cron job per active schedule",
          duplicateWorkflow: "scheduled duplicates start inactive",
          staleCronCleanup: "extra workflowRun cron jobs are removed during reconciliation",
          rustOwnership: "shadow_observe_only",
        },
        rustPromotionBlockers: schedulerBlockers,
        message: runSessionHandoffMessage,
      },
      blockers: schedulerBlockers,
    },
    operatorMessages: [
      dryRunMessage,
      savedMessage,
      scheduleCronMessage,
      leaseMessage,
      wakeupMessage,
      handoffMessage,
      runSessionHandoffMessage,
    ],
  };
}

async function getSql(): Promise<ReturnType<typeof postgres>> {
  if (_sql) {
    return _sql;
  }
  if (_initPromise) {
    const result = await _initPromise;
    if (result) {
      return result;
    }
  }

  _initPromise = (async () => {
    if (!isPgBacked()) {
      throw new Error("Workflows require PostgreSQL backend");
    }
    const connectionString = resolvePostgresUrl();
    const sql = postgres(connectionString, {
      max: 3,
      idle_timeout: 10,
      connect_timeout: 5,
      prepare: false,
    });
    try {
      await sql`SELECT 1`;
      _sql = sql;
      log.info("workflows PG connection established");
      return sql;
    } catch (err) {
      log.warn(`workflows PG init failed: ${String(err)}`);
      throw err;
    }
  })();

  const result = await _initPromise;
  if (!result) {
    throw new Error("Workflows PG connection failed");
  }
  return result;
}

// ── Param helpers ───────────────────────────────────────────────────────────

function requireString(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`${key} is required and must be a non-empty string`);
  }
  return v.trim();
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  if (v === undefined || v === null) {
    return undefined;
  }
  if (typeof v !== "string") {
    throw new Error(`${key} must be a string`);
  }
  const trimmed = v.trim();
  return trimmed || undefined;
}

export async function resolveRunnableWorkflowRow(
  sql: ReturnType<typeof postgres>,
  params: Record<string, unknown>,
): Promise<
  | { ok: true; workflowId: string; workflowRow: WorkflowRow; resolvedBy: "id" | "name" }
  | { ok: false; error: string }
> {
  const requestedId = optionalString(params, "workflowId") ?? optionalString(params, "id");
  const requestedName =
    optionalString(params, "workflowName") ??
    optionalString(params, "name") ??
    optionalString(params, "workflow");

  if (!requestedId && !requestedName) {
    return { ok: false, error: "workflowId or workflowName is required" };
  }

  if (requestedId) {
    const [byId] = await sql`
      SELECT * FROM workflows WHERE id = ${requestedId} AND is_active = true LIMIT 1
    `;
    if (byId) {
      return {
        ok: true,
        workflowId: String(byId.id),
        workflowRow: byId as unknown as WorkflowRow,
        resolvedBy: "id",
      };
    }
  }

  const candidateName = requestedName ?? requestedId;
  if (!candidateName) {
    return { ok: false, error: "Workflow not found or inactive" };
  }

  const rows = await sql`
    SELECT * FROM workflows
    WHERE lower(name) = lower(${candidateName}) AND is_active = true
    ORDER BY updated_at DESC
    LIMIT 2
  `;
  if (rows.length > 1) {
    return {
      ok: false,
      error: `Multiple active workflows are named "${candidateName}". Use a workflow ID.`,
    };
  }
  const [byName] = rows;
  if (byName) {
    return {
      ok: true,
      workflowId: String(byName.id),
      workflowRow: byName as unknown as WorkflowRow,
      resolvedBy: "name",
    };
  }

  return {
    ok: false,
    error: requestedName
      ? `Workflow named "${candidateName}" was not found or is inactive`
      : "Workflow not found or inactive",
  };
}

export function workflowRowWithCanvasOverride(
  row: WorkflowRow,
  params: Record<string, unknown>,
): WorkflowRow {
  const jsonFields = workflowJsonFieldsFromRow(row);
  const payload = workflowGraphPayload(params, {
    nodes: jsonFields.nodes,
    edges: jsonFields.edges,
    canvasLayout: jsonFields.canvasLayout,
  });
  if (!payload.changed) {
    return row;
  }
  const deploymentStage =
    optionalDeploymentStage(params) ??
    workflowDeploymentStageFromDefinition(payload.definition) ??
    (typeof row.deployment_stage === "string" ? row.deployment_stage : undefined);
  const normalized = normalizeWorkflow({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    nodes: payload.nodes,
    edges: payload.edges,
    canvasLayout: payload.canvasLayout,
    defaultOnError: jsonFields.defaultOnError,
    maxRunDurationMs:
      typeof row.max_run_duration_ms === "number" ? row.max_run_duration_ms : undefined,
    maxRunCostUsd: typeof row.max_run_cost_usd === "number" ? row.max_run_cost_usd : undefined,
    deploymentStage,
  });
  return {
    ...row,
    nodes: normalized.workflow.nodes,
    edges: normalized.workflow.edges,
    canvas_layout: preserveWorkflowCanvasMetadata(normalized.canvasLayout, row.canvas_layout),
    default_on_error: normalized.workflow.defaultOnError,
    max_run_duration_ms: normalized.workflow.maxRunDurationMs ?? row.max_run_duration_ms,
    max_run_cost_usd: normalized.workflow.maxRunCostUsd ?? row.max_run_cost_usd,
    deployment_stage: normalized.workflow.deploymentStage ?? row.deployment_stage,
  };
}

function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  if (v === undefined || v === null) {
    return undefined;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`${key} must be a number`);
  }
  return v;
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const v = params[key];
  if (v === undefined || v === null) {
    return undefined;
  }
  if (typeof v !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return v;
}

function noLiveDataWorkflowRows(): WorkflowRow[] {
  const now = "2026-05-02T19:19:28.000Z";
  const baseNodes = [
    {
      id: "trigger-manual",
      kind: "trigger",
      label: "Synthetic trigger",
      config: { triggerType: "manual" },
    },
    {
      id: "output-doc",
      kind: "output",
      label: "Synthetic output",
      config: { outputType: "docpanel", target: "doc_panel" },
    },
  ];
  const baseEdges = [{ id: "trigger-output", source: "trigger-manual", target: "output-doc" }];
  const baseCanvas = {
    nodes: [
      {
        id: "trigger-manual",
        type: "trigger",
        position: { x: 0, y: 0 },
        data: { label: "Synthetic trigger", triggerType: "manual" },
      },
      {
        id: "output-doc",
        type: "output",
        position: { x: 240, y: 0 },
        data: { label: "Synthetic output", outputType: "docpanel", target: "doc_panel" },
      },
    ],
    edges: [{ id: "trigger-output", source: "trigger-manual", target: "output-doc" }],
  };

  return [
    {
      id: "wf-rust-parity-active",
      name: "Rust Parity Synthetic Active Workflow",
      description: "Synthetic no-live-data workflow row for Rust shadow parity.",
      version: 1,
      is_active: true,
      owner_agent_id: "rust-parity-agent",
      trigger_type: "manual",
      trigger_config: { fixture: true },
      nodes: baseNodes,
      edges: baseEdges,
      canvas_layout: baseCanvas,
      default_on_error: { strategy: "fail" },
      max_run_duration_ms: 300_000,
      max_run_cost_usd: "0",
      deployment_stage: "simulate",
      run_count: 0,
      created_at: now,
      updated_at: now,
    },
    {
      id: "wf-rust-parity-draft",
      name: "Rust Parity Synthetic Draft Workflow",
      description: "Inactive synthetic row for list filtering parity.",
      version: 1,
      is_active: false,
      owner_agent_id: "rust-parity-agent",
      trigger_type: "manual",
      trigger_config: { fixture: true },
      nodes: baseNodes,
      edges: baseEdges,
      canvas_layout: baseCanvas,
      default_on_error: { strategy: "fail" },
      max_run_duration_ms: 300_000,
      max_run_cost_usd: "0",
      deployment_stage: "simulate",
      run_count: 0,
      created_at: now,
      updated_at: now,
    },
  ] as WorkflowRow[];
}

export function workflowListNoLiveDataSnapshot(params: Record<string, unknown>) {
  const limit = optionalNumber(params, "limit") ?? 50;
  const offset = optionalNumber(params, "offset") ?? 0;
  const activeOnly = optionalBoolean(params, "activeOnly") ?? false;
  const ownerAgentId = optionalString(params, "ownerAgentId");
  const rows = noLiveDataWorkflowRows().filter((row) => {
    if (activeOnly && row.is_active !== true) {
      return false;
    }
    return !ownerAgentId || row.owner_agent_id === ownerAgentId;
  });

  return {
    workflows: rows
      .slice(offset, offset + limit)
      .map((row) => publicWorkflowRow(row as unknown as WorkflowRow)),
    total: rows.length,
    limit,
    offset,
    snapshot: {
      id: WORKFLOWS_LIST_NO_LIVE_DATA_SNAPSHOT,
      source: "synthetic",
      noLiveData: true,
      workflowExecution: false,
      workflowRunsMutated: false,
      authority: "node-live-rust-shadow",
    },
  };
}

function timestampIso(value: unknown): string | undefined {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return undefined;
}

function optionalObject(
  params: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return recordValue(params[key], key);
}

function publicWorkflowVersionRow(row: Record<string, unknown>) {
  const nodes = parseWorkflowJsonColumn(row.nodes);
  const edges = parseWorkflowJsonColumn(row.edges);
  return {
    id: row.id,
    workflowId: row.workflow_id,
    version: typeof row.version === "number" ? row.version : Number(row.version ?? 0),
    changedBy: typeof row.changed_by === "string" ? row.changed_by : undefined,
    changeSummary: typeof row.change_summary === "string" ? row.change_summary : undefined,
    createdAt: timestampIso(row.created_at),
    nodeCount: Array.isArray(nodes) ? nodes.length : 0,
    edgeCount: Array.isArray(edges) ? edges.length : 0,
  };
}

function recordValue(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalRecordValue(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseWorkflowJsonColumn(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return undefined;
}

function optionalArray(params: Record<string, unknown>, key: string): unknown[] | undefined {
  const v = params[key];
  if (v === undefined || v === null) {
    return undefined;
  }
  if (!Array.isArray(v)) {
    throw new Error(`${key} must be an array`);
  }
  return v;
}

function arrayValue(value: unknown, label: string): unknown[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number`);
  }
  return value;
}

function optionalStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function workflowDefinitionParam(params: Record<string, unknown>) {
  return optionalObject(params, "definition") ?? optionalObject(params, "workflowDefinition");
}

function preserveWorkflowCanvasMetadata(canvasLayout: unknown, fallbackCanvasLayout: unknown) {
  const fallback = optionalRecordValue(fallbackCanvasLayout);
  if (!fallback || !("importReport" in fallback)) {
    return canvasLayout;
  }
  const next = optionalRecordValue(canvasLayout) ?? {};
  if ("importReport" in next) {
    return canvasLayout;
  }
  return { ...next, importReport: fallback.importReport };
}

function workflowDeploymentStageFromDefinition(
  definition: Record<string, unknown> | undefined,
): WorkflowDefinition["deploymentStage"] | undefined {
  const stage = optionalStringValue(definition?.deploymentStage);
  if (!stage) {
    return undefined;
  }
  if (stage === "simulate" || stage === "shadow" || stage === "limited_live" || stage === "live") {
    return stage;
  }
  throw new Error("definition.deploymentStage must be simulate, shadow, limited_live, or live");
}

function workflowGraphPayload(
  params: Record<string, unknown>,
  fallback?: { nodes?: unknown[]; edges?: unknown[]; canvasLayout?: unknown },
) {
  const canvasData = optionalObject(params, "canvasData");
  const explicitCanvasLayout = optionalObject(params, "canvasLayout");
  const definition = workflowDefinitionParam(params);
  const definitionCanvasLayout = recordValue(definition?.canvasLayout, "definition.canvasLayout");
  const nodes =
    optionalArray(params, "nodes") ??
    arrayValue(canvasData?.nodes, "canvasData.nodes") ??
    arrayValue(definition?.nodes, "definition.nodes") ??
    fallback?.nodes ??
    [];
  const edges =
    optionalArray(params, "edges") ??
    arrayValue(canvasData?.edges, "canvasData.edges") ??
    arrayValue(definition?.edges, "definition.edges") ??
    fallback?.edges ??
    [];
  const canvasLayout =
    explicitCanvasLayout ?? canvasData ?? definitionCanvasLayout ?? fallback?.canvasLayout ?? {};
  return {
    nodes,
    edges,
    canvasLayout,
    definition,
    changed:
      Boolean(explicitCanvasLayout) ||
      Boolean(canvasData) ||
      Boolean(definition) ||
      params.nodes !== undefined ||
      params.edges !== undefined,
  };
}

export function derivedWorkflowTrigger(workflow: WorkflowDefinition) {
  const trigger = workflow.nodes.find(
    (node): node is Extract<WorkflowNode, { kind: "trigger" }> => {
      return node.kind === "trigger";
    },
  );
  if (!trigger) {
    return { triggerType: undefined, triggerConfig: undefined };
  }
  return {
    triggerType: trigger.triggerType,
    triggerConfig: trigger.config,
  };
}

function stringField(source: unknown, keys: string[]): string | undefined {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function workflowRunCronJobs(jobs: CronJob[], workflowId: string): CronJob[] {
  return jobs.filter(
    (job) => job.payload.kind === "workflowRun" && job.payload.workflowId === workflowId,
  );
}

function resolveWorkflowSchedule(row: WorkflowRow): { expr: string; timezone?: string } | null {
  const triggerType = typeof row.trigger_type === "string" ? row.trigger_type : undefined;
  if (triggerType !== "schedule" && triggerType !== "cron") {
    return null;
  }
  const triggerConfig = row.trigger_config;
  const expr = stringField(triggerConfig, [
    "cronExpression",
    "cronExpr",
    "scheduleCron",
    "expr",
    "cron",
  ]);
  if (!expr) {
    return null;
  }
  const timezone = stringField(triggerConfig, ["timezone", "timeZone", "tz"]);
  return { expr, timezone };
}

function workflowScheduleCronDescription(row: WorkflowRow): string {
  const description =
    typeof row.description === "string" && row.description.trim()
      ? row.description.trim()
      : "Workflow schedule trigger";
  return `${WORKFLOW_SCHEDULE_CRON_MARKER}\nworkflowId=${row.id}\n${description}`;
}

export function duplicatedWorkflowShouldStartActive(source: WorkflowRow): boolean {
  return !resolveWorkflowSchedule(source);
}

function workflowScheduleCronSpec(row: WorkflowRow, schedule: { expr: string; timezone?: string }) {
  return {
    name: `Workflow: ${row.name}`,
    description: workflowScheduleCronDescription(row),
    enabled: row.is_active === true,
    schedule: {
      kind: "cron" as const,
      expr: schedule.expr,
      ...(schedule.timezone ? { tz: schedule.timezone } : {}),
    },
    sessionTarget: "isolated" as const,
    wakeMode: "next-heartbeat" as const,
    payload: {
      kind: "workflowRun" as const,
      workflowId: row.id,
      triggerPayload: {
        source: "workflow_schedule",
        workflowId: row.id,
        triggerType: row.trigger_type ?? "schedule",
      },
    },
    delivery: { mode: "none" as const },
  };
}

async function setWorkflowNextFireAt(
  sql: ReturnType<typeof postgres>,
  workflowId: string,
  nextRunAtMs: number | undefined,
) {
  const nextFireAt = typeof nextRunAtMs === "number" ? new Date(nextRunAtMs).toISOString() : null;
  await sql`
    UPDATE workflows
    SET next_fire_at = ${nextFireAt}::timestamptz
    WHERE id = ${workflowId}
  `;
}

export async function syncWorkflowScheduleCronJob(params: {
  sql: ReturnType<typeof postgres>;
  cron: CronService;
  workflow: WorkflowRow;
}) {
  const { sql, cron, workflow } = params;
  const existing = workflowRunCronJobs(await cron.list({ includeDisabled: true }), workflow.id);
  const schedule = resolveWorkflowSchedule(workflow);

  if (!schedule || workflow.is_active !== true) {
    for (const job of existing) {
      await cron.remove(job.id);
    }
    await setWorkflowNextFireAt(sql, workflow.id, undefined);
    return { action: existing.length > 0 ? "removed" : "none", jobId: null, nextRunAtMs: null };
  }

  const spec = workflowScheduleCronSpec(workflow, schedule);
  const [primary, ...duplicates] = existing;
  for (const duplicate of duplicates) {
    await cron.remove(duplicate.id);
  }

  const job = primary
    ? await cron.update(primary.id, spec as CronJobPatch)
    : await cron.add(spec as CronJobCreate);
  await setWorkflowNextFireAt(sql, workflow.id, job.state.nextRunAtMs);
  return {
    action: primary ? "updated" : "added",
    jobId: job.id,
    nextRunAtMs: job.state.nextRunAtMs ?? null,
  };
}

export async function reconcileWorkflowScheduleCronJobs(
  cron: CronService,
  options?: { env?: NodeJS.ProcessEnv; storage?: StorageConfig },
) {
  const storage = options?.storage ?? resolveRuntimeStorageConfig(options?.env ?? process.env);
  if (storage.backend !== "postgres" && storage.backend !== "dual") {
    const message =
      "workflow schedule cron reconciliation skipped: saved workflow schedules require PostgreSQL; local/parity gateways can still use workflow dry-run readiness.";
    log.info(message);
    return {
      reconciled: [],
      skipped: true,
      reason: "postgres_not_configured" as const,
      message,
    };
  }
  const sql = await getSql();
  const rows = await sql`SELECT * FROM workflows`;
  const scheduledWorkflowIds = new Set<string>();
  const results: Array<{ workflowId: string; action: string; jobId: string | null }> = [];

  for (const row of rows) {
    const workflow = row as unknown as WorkflowRow;
    const schedule = resolveWorkflowSchedule(workflow);
    if (schedule && workflow.is_active === true) {
      scheduledWorkflowIds.add(workflow.id);
    }
    const result = await syncWorkflowScheduleCronJob({ sql, cron, workflow });
    if (result.action !== "none") {
      results.push({ workflowId: workflow.id, action: result.action, jobId: result.jobId });
    }
  }

  const jobs = await cron.list({ includeDisabled: true });
  for (const job of jobs) {
    if (job.payload.kind !== "workflowRun") {
      continue;
    }
    const workflowId = job.payload.workflowId;
    if (!scheduledWorkflowIds.has(workflowId)) {
      await cron.remove(job.id);
      results.push({ workflowId, action: "removed-stale", jobId: job.id });
    }
  }

  if (results.length > 0) {
    log.info(`workflow schedule cron reconciliation: ${JSON.stringify(results)}`);
  }
  return { reconciled: results };
}

export async function activeWorkflowScheduleConflictIssues(params: {
  sql: ReturnType<typeof postgres>;
  workflow: WorkflowRow;
}): Promise<WorkflowIssue[]> {
  const schedule = resolveWorkflowSchedule(params.workflow);
  if (!schedule || params.workflow.is_active !== true) {
    return [];
  }

  const peers = await params.sql`
    SELECT id, name, trigger_type, trigger_config
    FROM workflows
    WHERE id <> ${params.workflow.id}
      AND is_active = true
      AND trigger_type IN ('schedule', 'cron')
  `;

  const conflictingPeers = peers.filter((row) => {
    const peerSchedule = resolveWorkflowSchedule(row as unknown as WorkflowRow);
    if (!peerSchedule) {
      return false;
    }
    return (
      peerSchedule.expr === schedule.expr &&
      (peerSchedule.timezone ?? "") === (schedule.timezone ?? "")
    );
  });

  if (conflictingPeers.length === 0) {
    return [];
  }

  const peerNames = conflictingPeers
    .map((row) => (typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Untitled"))
    .slice(0, 3);
  const remainder =
    conflictingPeers.length > peerNames.length
      ? ` and ${conflictingPeers.length - peerNames.length} more`
      : "";

  return [
    {
      severity: "warning",
      code: "schedule_conflict_active_workflow",
      category: "runtime",
      message: `This workflow shares the active schedule ${schedule.expr}${
        schedule.timezone ? ` (${schedule.timezone})` : ""
      } with ${peerNames.join(", ")}${remainder}. All of them will appear in Workloads and all of them will run unless you pause the extra copies.`,
    },
  ];
}

function optionalWorkflowPackageFormat(
  params: Record<string, unknown>,
): WorkflowPackageFormat | undefined {
  const v = optionalString(params, "format");
  if (!v) {
    return undefined;
  }
  if (v !== "json" && v !== "yaml") {
    throw new Error('format must be "json" or "yaml"');
  }
  return v;
}

function optionalDeploymentStage(params: Record<string, unknown>) {
  const stage = optionalString(params, "deploymentStage");
  if (!stage) {
    return undefined;
  }
  if (stage === "simulate" || stage === "shadow" || stage === "limited_live" || stage === "live") {
    return stage;
  }
  throw new Error("deploymentStage must be simulate, shadow, limited_live, or live");
}

type WorkflowImportReportLike = {
  packageName?: string;
  packageSlug?: string;
  okForImport?: boolean;
  okForPinnedTestRun?: boolean;
  liveReadiness?: {
    okForLive?: boolean;
    status?: string;
    label?: string;
    reasons?: Array<{ code?: string; id?: string; label?: string; message?: string }>;
  };
  requirements?: Array<{
    key?: string;
    id?: string;
    label?: string;
    requiredForLive?: boolean;
  }>;
  bindings?: Record<string, { value?: string }>;
};

export type WorkflowLiveRunGateResult =
  | { ok: true }
  | { ok: false; message: string; codes: string[] };

function importReportFromWorkflowRow(row: WorkflowRow): WorkflowImportReportLike | undefined {
  const canvas = optionalRecordValue(row.canvas_layout);
  const report = canvas?.importReport ?? row.importReport;
  if (report && typeof report === "object" && !Array.isArray(report)) {
    return report as WorkflowImportReportLike;
  }
  return undefined;
}

function missingRequiredLiveBindingLabels(report: WorkflowImportReportLike): string[] {
  const requirements = Array.isArray(report.requirements) ? report.requirements : [];
  return requirements
    .filter((requirement) => requirement.requiredForLive !== false)
    .filter((requirement) => {
      const key = requirement.key;
      return !key || !report.bindings?.[key]?.value;
    })
    .map(
      (requirement) => requirement.label ?? requirement.id ?? requirement.key ?? "required item",
    );
}

function workflowStageRequiresLiveReadiness(stage: WorkflowDefinition["deploymentStage"]) {
  return stage === "live" || stage === "limited_live";
}

export function evaluateWorkflowLiveRunGate(args: {
  deploymentStage?: WorkflowDefinition["deploymentStage"];
  importReport?: WorkflowImportReportLike;
}): WorkflowLiveRunGateResult {
  if (!workflowStageRequiresLiveReadiness(args.deploymentStage)) {
    return { ok: true };
  }
  const report = args.importReport;
  if (!report) {
    return { ok: true };
  }
  const codes: string[] = [];
  const messages: string[] = [];
  const missingBindings = missingRequiredLiveBindingLabels(report);
  if (missingBindings.length > 0) {
    codes.push("missing_live_bindings");
    messages.push(
      `Missing required live bindings: ${missingBindings.slice(0, 6).join(", ")}${
        missingBindings.length > 6 ? ` and ${missingBindings.length - 6} more` : ""
      }.`,
    );
  }
  if (report.liveReadiness?.okForLive !== true) {
    const reasons = report.liveReadiness?.reasons ?? [];
    for (const reason of reasons) {
      if (reason.code) {
        codes.push(reason.code);
      }
    }
    if (reasons.length > 0) {
      messages.push(
        `Live readiness is not satisfied: ${reasons
          .slice(0, 6)
          .map((reason) => reason.message ?? reason.label ?? reason.code ?? "readiness blocker")
          .join("; ")}${reasons.length > 6 ? `; and ${reasons.length - 6} more` : ""}.`,
      );
    } else {
      codes.push("live_readiness_not_proven");
      messages.push("Live readiness has not been proven for this imported workflow.");
    }
  }
  if (messages.length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    message: `Live workflow run blocked. ${messages.join(" ")}`,
    codes: [...new Set(codes)],
  };
}

function workflowTemplateSummary(
  workflowPackage: WorkflowPackage,
  liveContext?: WorkflowPackageLiveReadinessContext,
) {
  const imported = importWorkflowPackage(workflowPackage, liveContext);
  return {
    id: workflowPackage.id,
    slug: workflowPackage.slug,
    name: workflowPackage.name,
    description: workflowPackage.description,
    scenario: workflowPackage.scenario,
    credentialCount: workflowPackage.credentials?.required.length ?? 0,
    dependencyCount: workflowPackage.dependencies?.length ?? 0,
    nodeCount: workflowPackage.workflow.nodes.length,
    edgeCount: workflowPackage.workflow.edges.length,
    okForImport: imported.readiness.okForImport,
    okForPinnedTestRun: imported.readiness.okForPinnedTestRun,
    liveRequirements: imported.readiness.liveRequirements,
    dryRunEvidence: imported.readiness.dryRunEvidence,
    liveReadiness: imported.readiness.liveReadiness,
    notes: workflowPackage.notes ?? [],
  };
}

function workflowPackagePreviewPayload(
  workflowPackage: WorkflowPackage,
  liveContext?: WorkflowPackageLiveReadinessContext,
) {
  const imported = importWorkflowPackage(workflowPackage, liveContext);
  return {
    package: workflowPackage,
    workflow: applyWorkflowPackageTestFixtures(workflowPackage),
    canvasLayout: imported.normalized.canvasLayout,
    readiness: imported.readiness,
    validation: {
      ok: imported.readiness.okForImport,
      issues: imported.normalized.issues,
    },
  };
}

async function buildWorkflowPackageLiveReadinessContext(): Promise<WorkflowPackageLiveReadinessContext> {
  try {
    const catalog = await discoverConnectorCatalog();
    return { connectors: catalog.connectors };
  } catch (err) {
    log.warn(`workflow template live readiness connector discovery failed: ${String(err)}`);
    return { connectors: [] };
  }
}

type WorkflowRunPublicStep = {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeKind: string;
  status: string;
  agentId?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs: number;
  error?: string;
  tokensUsed: number;
  costUsd: number;
  retryCount: number;
  approvalStatus?: string;
  approvalNote?: string;
  input?: unknown;
  output?: unknown;
};

type WorkflowRunPublicApproval = {
  approvalId: string;
  runId: string;
  workflowId: string;
  nodeId: string;
  nodeLabel?: string;
  message: string;
  sideEffectClass?: string;
  previousOutputPreview?: unknown;
  timeoutAt?: string;
  timeoutAction?: string;
  status: string;
  requestedAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
  notificationStatus?: string;
  notificationError?: string;
};

function isoString(value: unknown): string | undefined {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  }
  return undefined;
}

function numericValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return fallback;
}

function elapsedMs(start: unknown, end: unknown, nowMs = Date.now()): number {
  const startIso = isoString(start);
  if (!startIso) {
    return 0;
  }
  const startMs = Date.parse(startIso);
  const endIso = isoString(end);
  const endMs = endIso ? Date.parse(endIso) : nowMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 0;
  }
  return endMs - startMs;
}

function buildNodeLabelMap(nodes: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  if (!Array.isArray(nodes)) {
    return labels;
  }
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }
    const record = node as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : undefined;
    if (!id) {
      continue;
    }
    const data =
      record.data && typeof record.data === "object"
        ? (record.data as Record<string, unknown>)
        : {};
    const label =
      (typeof record.label === "string" && record.label.trim()
        ? record.label
        : typeof data.label === "string" && data.label.trim()
          ? data.label
          : undefined) ?? id;
    labels.set(id, label);
  }
  return labels;
}

export function publicWorkflowRunStep(
  row: Record<string, unknown>,
  nodeLabels: Map<string, string> = new Map(),
): WorkflowRunPublicStep {
  const nodeId = stringValue(row.node_id ?? row.nodeId);
  const startedAt = isoString(row.started_at ?? row.startedAt);
  const endedAt = isoString(row.ended_at ?? row.endedAt);
  return {
    id: stringValue(row.id),
    nodeId,
    nodeName: nodeLabels.get(nodeId) ?? nodeId,
    nodeKind: stringValue(row.node_kind ?? row.nodeKind, "action"),
    status: stringValue(row.status, "pending"),
    agentId:
      typeof row.agent_id === "string"
        ? row.agent_id
        : typeof row.agentId === "string"
          ? row.agentId
          : undefined,
    startedAt,
    endedAt,
    durationMs: numericValue(row.duration_ms ?? row.durationMs, elapsedMs(startedAt, endedAt)),
    error: typeof row.error === "string" && row.error.trim() ? String(row.error) : undefined,
    tokensUsed: numericValue(row.tokens_used ?? row.tokensUsed),
    costUsd: numericValue(row.cost_usd ?? row.costUsd),
    retryCount: numericValue(row.retry_count ?? row.retryCount),
    approvalStatus:
      typeof row.approval_status === "string"
        ? row.approval_status
        : typeof row.approvalStatus === "string"
          ? row.approvalStatus
          : undefined,
    approvalNote:
      typeof row.approval_note === "string"
        ? row.approval_note
        : typeof row.approvalNote === "string"
          ? row.approvalNote
          : undefined,
    input: row.input_context ?? row.inputContext,
    output: row.output_items ?? row.outputItems,
  };
}

export function publicWorkflowApproval(row: Record<string, unknown>): WorkflowRunPublicApproval {
  return {
    approvalId: stringValue(row.id ?? row.approval_id),
    runId: stringValue(row.run_id ?? row.runId),
    workflowId: stringValue(row.workflow_id ?? row.workflowId),
    nodeId: stringValue(row.node_id ?? row.nodeId),
    nodeLabel:
      typeof row.node_label === "string"
        ? row.node_label
        : typeof row.nodeLabel === "string"
          ? row.nodeLabel
          : undefined,
    message: stringValue(row.message, "Review required before continuing"),
    sideEffectClass:
      typeof row.side_effect_class === "string"
        ? row.side_effect_class
        : typeof row.sideEffectClass === "string"
          ? row.sideEffectClass
          : undefined,
    previousOutputPreview: row.previous_output_preview ?? row.previousOutputPreview,
    timeoutAt: isoString(row.timeout_at ?? row.timeoutAt),
    timeoutAction:
      typeof row.timeout_action === "string"
        ? row.timeout_action
        : typeof row.timeoutAction === "string"
          ? row.timeoutAction
          : undefined,
    status: stringValue(row.status, "pending"),
    requestedAt: isoString(row.requested_at ?? row.requestedAt),
    resolvedAt: isoString(row.resolved_at ?? row.resolvedAt),
    resolvedBy:
      typeof row.resolved_by === "string"
        ? row.resolved_by
        : typeof row.resolvedBy === "string"
          ? row.resolvedBy
          : undefined,
    resolutionNote:
      typeof row.resolution_note === "string"
        ? row.resolution_note
        : typeof row.resolutionNote === "string"
          ? row.resolutionNote
          : undefined,
    notificationStatus:
      typeof row.notification_status === "string"
        ? row.notification_status
        : typeof row.notificationStatus === "string"
          ? row.notificationStatus
          : undefined,
    notificationError:
      typeof row.notification_error === "string"
        ? row.notification_error
        : typeof row.notificationError === "string"
          ? row.notificationError
          : undefined,
  };
}

export function publicWorkflowRun(
  row: Record<string, unknown>,
  opts: {
    steps?: Record<string, unknown>[];
    approvals?: Record<string, unknown>[];
    workflowNodes?: unknown;
    nowMs?: number;
  } = {},
) {
  const nodeLabels = buildNodeLabelMap(opts.workflowNodes ?? row.workflow_nodes);
  const steps = (opts.steps ?? []).map((step) => publicWorkflowRunStep(step, nodeLabels));
  const approvals = (opts.approvals ?? []).map(publicWorkflowApproval);
  const startedAt = isoString(row.started_at ?? row.startedAt);
  const endedAt = isoString(row.ended_at ?? row.endedAt);
  const nowMs = opts.nowMs ?? Date.now();
  const rawTimeline = [
    startedAt
      ? {
          at: startedAt,
          type: "run_started",
          label: "Run started",
          status: row.status,
        }
      : null,
    ...steps.flatMap((step) => [
      step.startedAt
        ? {
            at: step.startedAt,
            type: "step_started",
            nodeId: step.nodeId,
            label: `${step.nodeName} started`,
            status: step.status,
          }
        : null,
      step.endedAt
        ? {
            at: step.endedAt,
            type: step.status === "failed" ? "step_failed" : "step_completed",
            nodeId: step.nodeId,
            label:
              step.status === "failed" ? `${step.nodeName} failed` : `${step.nodeName} completed`,
            status: step.status,
            error: step.error,
          }
        : null,
    ]),
    ...approvals.flatMap((approval) => [
      approval.requestedAt
        ? {
            at: approval.requestedAt,
            type: "approval_requested",
            nodeId: approval.nodeId,
            label: `${approval.nodeLabel ?? approval.nodeId} requested approval`,
            status: approval.status,
          }
        : null,
      approval.resolvedAt
        ? {
            at: approval.resolvedAt,
            type: "approval_resolved",
            nodeId: approval.nodeId,
            label: `${approval.nodeLabel ?? approval.nodeId} approval ${approval.status}`,
            status: approval.status,
            note: approval.resolutionNote,
          }
        : null,
    ]),
    endedAt
      ? {
          at: endedAt,
          type: "run_finished",
          label: `Run ${stringValue(row.status, "finished")}`,
          status: row.status,
          error: typeof row.error === "string" ? row.error : undefined,
        }
      : null,
  ];
  const timeline = rawTimeline
    .filter((event): event is NonNullable<typeof event> => event !== null)
    .toSorted((a, b) => String(a.at).localeCompare(String(b.at)));

  return {
    id: stringValue(row.id),
    runId: stringValue(row.id),
    workflowId: stringValue(row.workflow_id ?? row.workflowId),
    workflowName:
      typeof row.workflow_name === "string"
        ? row.workflow_name
        : typeof row.workflowName === "string"
          ? row.workflowName
          : undefined,
    workflowVersion: numericValue(row.workflow_version ?? row.workflowVersion),
    status: stringValue(row.status, "created"),
    triggerType: stringValue(row.trigger_type ?? row.triggerType),
    triggerPayload: row.trigger_payload ?? row.triggerPayload,
    currentNodeId:
      typeof row.current_node_id === "string"
        ? row.current_node_id
        : typeof row.currentNodeId === "string"
          ? row.currentNodeId
          : undefined,
    startedAt: startedAt ?? "",
    endedAt,
    finishedAt: endedAt,
    durationMs: numericValue(
      row.duration_ms ?? row.durationMs,
      elapsedMs(startedAt, endedAt, nowMs),
    ),
    totalTokensUsed: numericValue(row.total_tokens_used ?? row.totalTokensUsed),
    totalCostUsd: numericValue(row.total_cost_usd ?? row.totalCostUsd),
    error: typeof row.error === "string" && row.error.trim() ? row.error : undefined,
    metadata: row.metadata,
    variables: row.variables,
    steps,
    approvals,
    timeline,
  };
}

async function buildWorkflowAppForgeCapabilities(): Promise<{
  apps: AppForgeAppSummary[];
  capabilities: AppForgeWorkflowCapability[];
}> {
  const response = await fetch(`${DASHBOARD_API}/api/apps`, {
    headers: dashboardApiHeaders(),
  });
  if (!response.ok) {
    throw new Error(`AppForge API returned ${response.status}`);
  }
  const payload = (await response.json()) as { apps?: unknown[] };
  const apps = (payload.apps ?? [])
    .filter((app): app is Record<string, unknown> => Boolean(app && typeof app === "object"))
    .map((app) => ({
      id: stringValue(app.id),
      name: stringValue(app.name, "Untitled App"),
      description: typeof app.description === "string" ? app.description : undefined,
      version: typeof app.version === "number" ? app.version : undefined,
      metadata: app.metadata,
    }))
    .filter((app) => app.id);
  return {
    apps,
    capabilities: collectAppForgeWorkflowCapabilities(apps),
  };
}

function collectRecordKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.keys(value as Record<string, unknown>).filter((key) => key.trim());
}

function collectStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function workflowOutputTarget(
  id: string,
  kind: WorkflowOutputChannelTarget["kind"],
  labelPrefix?: string,
): WorkflowOutputChannelTarget {
  return {
    id,
    kind,
    label: labelPrefix ? `${labelPrefix}: ${id}` : id,
  };
}

function uniqueWorkflowOutputTargets(
  targets: WorkflowOutputChannelTarget[],
): WorkflowOutputChannelTarget[] {
  const seen = new Set<string>();
  const unique: WorkflowOutputChannelTarget[] = [];
  for (const target of targets) {
    const key = `${target.kind}:${target.id}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(target);
  }
  return unique;
}

function collectWorkflowOutputChannelTargets(
  channelId: string,
  cfg: ArgentConfig,
): WorkflowOutputChannelTarget[] {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const raw = channels?.[channelId];
  const channel = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  switch (channelId) {
    case "telegram":
      return uniqueWorkflowOutputTargets([
        ...collectRecordKeys(channel.groups).map((id) =>
          workflowOutputTarget(id, "group", "Group"),
        ),
        ...collectRecordKeys(channel.dms).map((id) => workflowOutputTarget(id, "dm", "DM")),
        ...collectStringList(channel.allowFrom).map((id) =>
          workflowOutputTarget(id, "allowlist", "Allowed"),
        ),
      ]);
    case "discord":
      return uniqueWorkflowOutputTargets([
        ...collectRecordKeys(channel.channels).map((id) =>
          workflowOutputTarget(id, "channel", "Channel"),
        ),
        ...collectStringList(channel.allowFrom).map((id) =>
          workflowOutputTarget(id, "allowlist", "Allowed"),
        ),
      ]);
    case "slack":
      return uniqueWorkflowOutputTargets([
        ...collectRecordKeys(channel.channels).map((id) =>
          workflowOutputTarget(id, "channel", "Channel"),
        ),
        ...collectStringList(channel.allowFrom).map((id) =>
          workflowOutputTarget(id, "allowlist", "Allowed"),
        ),
      ]);
    case "whatsapp":
      return uniqueWorkflowOutputTargets([
        ...collectRecordKeys(channel.groups).map((id) =>
          workflowOutputTarget(id, "group", "Group"),
        ),
        ...collectStringList(channel.allowFrom).map((id) =>
          workflowOutputTarget(id, "allowlist", "Allowed"),
        ),
      ]);
    default:
      return uniqueWorkflowOutputTargets([
        ...collectRecordKeys((channel as { channels?: unknown }).channels).map((id) =>
          workflowOutputTarget(id, "channel", "Channel"),
        ),
        ...collectStringList((channel as { allowFrom?: unknown }).allowFrom).map((id) =>
          workflowOutputTarget(id, "allowlist", "Allowed"),
        ),
      ]);
  }
}

async function collectWorkflowOutputChannelTargetsWithAccounts(
  channelId: string,
  cfg: ArgentConfig,
  accountIds: string[],
): Promise<WorkflowOutputChannelTarget[]> {
  const baseTargets = collectWorkflowOutputChannelTargets(channelId, cfg);
  const accountTargets: WorkflowOutputChannelTarget[] = [];
  const uniqueAccountIds = [...new Set(accountIds.filter(Boolean))];

  try {
    const directory = await import("../../channels/plugins/directory-config.js");
    for (const accountId of uniqueAccountIds) {
      switch (channelId) {
        case "telegram": {
          const [groups, peers] = await Promise.all([
            directory.listTelegramDirectoryGroupsFromConfig({ cfg, accountId }),
            directory.listTelegramDirectoryPeersFromConfig({ cfg, accountId }),
          ]);
          accountTargets.push(
            ...groups.map((entry) => workflowOutputTarget(entry.id, "group", "Group")),
            ...peers.map((entry) => workflowOutputTarget(entry.id, "dm", "DM")),
          );
          break;
        }
        case "discord": {
          const [groups, peers] = await Promise.all([
            directory.listDiscordDirectoryGroupsFromConfig({ cfg, accountId }),
            directory.listDiscordDirectoryPeersFromConfig({ cfg, accountId }),
          ]);
          accountTargets.push(
            ...groups.map((entry) => workflowOutputTarget(entry.id, "channel", "Channel")),
            ...peers.map((entry) => workflowOutputTarget(entry.id, "dm", "DM")),
          );
          break;
        }
        case "slack": {
          const [groups, peers] = await Promise.all([
            directory.listSlackDirectoryGroupsFromConfig({ cfg, accountId }),
            directory.listSlackDirectoryPeersFromConfig({ cfg, accountId }),
          ]);
          accountTargets.push(
            ...groups.map((entry) => workflowOutputTarget(entry.id, "channel", "Channel")),
            ...peers.map((entry) => workflowOutputTarget(entry.id, "dm", "DM")),
          );
          break;
        }
        case "whatsapp": {
          const [groups, peers] = await Promise.all([
            directory.listWhatsAppDirectoryGroupsFromConfig({ cfg, accountId }),
            directory.listWhatsAppDirectoryPeersFromConfig({ cfg, accountId }),
          ]);
          accountTargets.push(
            ...groups.map((entry) => workflowOutputTarget(entry.id, "group", "Group")),
            ...peers.map((entry) => workflowOutputTarget(entry.id, "dm", "DM")),
          );
          break;
        }
      }
    }
  } catch (err) {
    log.debug("workflow output channel account target discovery unavailable", {
      channelId,
      error: String(err),
    });
  }

  return uniqueWorkflowOutputTargets([...baseTargets, ...accountTargets]);
}

export async function buildWorkflowOutputChannels(): Promise<WorkflowOutputChannelOption[]> {
  const [
    { loadConfig },
    { listChatChannels },
    { DEFAULT_ACCOUNT_ID },
    { listTelegramAccountIds, resolveTelegramAccount },
    { listDiscordAccountIds, resolveDiscordAccount },
    { listSlackAccountIds, resolveSlackAccount },
    { listWhatsAppAccountIds, hasAnyWhatsAppAuth },
  ] = await Promise.all([
    import("../../config/config.js"),
    import("../../channels/registry.js"),
    import("../../routing/session-key.js"),
    import("../../telegram/accounts.js"),
    import("../../discord/accounts.js"),
    import("../../slack/accounts.js"),
    import("../../web/accounts.js"),
  ]);
  const cfg = loadConfig();
  const outputChannels = new Map<string, WorkflowOutputChannelOption>();

  try {
    const { listChannelPlugins } = await import("../../channels/plugins/index.js");
    for (const plugin of listChannelPlugins()) {
      const outbound = plugin.outbound;
      if (!outbound) {
        continue;
      }
      if (outbound.deliveryMode !== "gateway" && (!outbound.sendText || !outbound.sendMedia)) {
        continue;
      }

      const accountIds = plugin.config.listAccountIds(cfg);
      const defaultAccountId =
        plugin.config.defaultAccountId?.(cfg) ?? accountIds[0] ?? DEFAULT_ACCOUNT_ID;
      const configuredAccountIds = [];
      const candidates = accountIds.length > 0 ? accountIds : [defaultAccountId];
      for (const accountId of candidates) {
        const account = plugin.config.resolveAccount(cfg, accountId);
        const enabled = plugin.config.isEnabled
          ? plugin.config.isEnabled(account, cfg)
          : !account ||
            typeof account !== "object" ||
            (account as { enabled?: boolean }).enabled !== false;
        const configured = plugin.config.isConfigured
          ? await plugin.config.isConfigured(account, cfg)
          : true;
        if (enabled && configured) {
          configuredAccountIds.push(accountId);
        }
      }

      if (configuredAccountIds.length === 0) {
        continue;
      }

      outputChannels.set(plugin.id, {
        id: plugin.id,
        label: plugin.meta.selectionLabel ?? plugin.meta.label ?? plugin.id,
        defaultAccountId,
        accountIds: configuredAccountIds,
        deliveryMode: outbound.deliveryMode,
        configured: true,
        statusLabel: "Configured",
        targets: await collectWorkflowOutputChannelTargetsWithAccounts(
          plugin.id,
          cfg,
          configuredAccountIds,
        ),
      });
    }
  } catch (err) {
    log.debug("workflow output channel plugin registry unavailable", { error: String(err) });
  }

  const channelsConfig =
    cfg.channels && typeof cfg.channels === "object"
      ? (cfg.channels as Record<string, unknown>)
      : {};
  const configuredCoreChannels: Record<
    string,
    { accountIds: string[]; defaultAccountId: string; configured: boolean; statusLabel: string }
  > = {
    telegram: (() => {
      const accountIds = listTelegramAccountIds(cfg).filter((accountId) => {
        const account = resolveTelegramAccount({ cfg, accountId });
        return account.enabled && account.tokenSource !== "none";
      });
      return {
        accountIds,
        defaultAccountId: accountIds[0] ?? DEFAULT_ACCOUNT_ID,
        configured: accountIds.length > 0,
        statusLabel: accountIds.length > 0 ? "Configured" : "Needs Telegram bot token",
      };
    })(),
    discord: (() => {
      const accountIds = listDiscordAccountIds(cfg).filter((accountId) => {
        const account = resolveDiscordAccount({ cfg, accountId });
        return account.enabled && account.tokenSource !== "none";
      });
      return {
        accountIds,
        defaultAccountId: accountIds[0] ?? DEFAULT_ACCOUNT_ID,
        configured: accountIds.length > 0,
        statusLabel: accountIds.length > 0 ? "Configured" : "Needs Discord bot token",
      };
    })(),
    slack: (() => {
      const accountIds = listSlackAccountIds(cfg).filter((accountId) => {
        const account = resolveSlackAccount({ cfg, accountId });
        return account.enabled && account.botTokenSource !== "none";
      });
      return {
        accountIds,
        defaultAccountId: accountIds[0] ?? DEFAULT_ACCOUNT_ID,
        configured: accountIds.length > 0,
        statusLabel: accountIds.length > 0 ? "Configured" : "Needs Slack bot token",
      };
    })(),
    whatsapp: (() => {
      const accountIds = hasAnyWhatsAppAuth(cfg) ? listWhatsAppAccountIds(cfg) : [];
      return {
        accountIds,
        defaultAccountId: accountIds[0] ?? DEFAULT_ACCOUNT_ID,
        configured: accountIds.length > 0,
        statusLabel: accountIds.length > 0 ? "Configured" : "Needs WhatsApp login",
      };
    })(),
  };

  for (const channel of listChatChannels()) {
    const existing = outputChannels.get(channel.id);
    const channelConfig = channelsConfig[channel.id];
    const core = configuredCoreChannels[channel.id];
    const configured =
      core?.configured ||
      Boolean(channelConfig && typeof channelConfig === "object" && outputChannels.has(channel.id));
    if (!configured) {
      continue;
    }
    const accountIds = existing?.accountIds?.length
      ? existing.accountIds
      : (core?.accountIds ?? []);
    const targets = await collectWorkflowOutputChannelTargetsWithAccounts(
      channel.id,
      cfg,
      accountIds,
    );
    outputChannels.set(channel.id, {
      id: channel.id,
      label: existing?.label ?? channel.selectionLabel ?? channel.label ?? channel.id,
      defaultAccountId: existing?.defaultAccountId ?? core?.defaultAccountId ?? DEFAULT_ACCOUNT_ID,
      accountIds,
      deliveryMode: existing?.deliveryMode ?? "direct",
      configured: true,
      statusLabel: existing?.statusLabel ?? core?.statusLabel ?? "Configured in channel settings",
      targets: targets.length > 0 ? targets : existing?.targets,
    });
  }

  return [...outputChannels.values()];
}

export async function buildWorkflowConnectorCapabilities(): Promise<WorkflowConnectorCapability[]> {
  const catalog = await discoverConnectorCatalog();
  return catalog.connectors.map((c: ConnectorCatalogEntry) => {
    let scaffoldOnly = false;
    for (const root of defaultRepoRoots()) {
      const mPath = path.join(root, c.tool, "connector.json");
      if (fs.existsSync(mPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(mPath, "utf-8")) as Record<string, unknown>;
          const scope =
            raw.scope && typeof raw.scope === "object"
              ? (raw.scope as Record<string, unknown>)
              : {};
          scaffoldOnly = scope.scaffold_only === true;
        } catch {
          /* ignore */
        }
        break;
      }
    }
    const readinessState = workflowConnectorReadinessState(c, scaffoldOnly);
    return {
      id: c.tool,
      name: c.label || c.tool.replace(/^aos-/, "").replace(/-/g, " "),
      category: c.category ?? "general",
      categories: c.categories,
      commands: c.commands.map((cmd) => ({
        id: cmd.id,
        summary: cmd.summary,
        actionClass: cmd.actionClass,
      })),
      installState: c.installState,
      statusOk: c.status.ok,
      scaffoldOnly,
      readinessState,
    };
  });
}

export async function buildWorkflowConnectorCapabilitiesSafely(): Promise<
  WorkflowConnectorCapability[]
> {
  try {
    return await buildWorkflowConnectorCapabilities();
  } catch (err) {
    log.warn(`workflow connector capabilities unavailable: ${String(err)}`);
    return [];
  }
}

export async function validateWorkflowRuntimeCapabilities(
  workflow: WorkflowDefinition,
): Promise<WorkflowIssue[]> {
  const issues: WorkflowIssue[] = [];
  const [outputChannels, connectors] = await Promise.all([
    buildWorkflowOutputChannels().catch((err) => {
      log.warn(`workflow runtime channel validation unavailable: ${String(err)}`);
      return [];
    }),
    buildWorkflowConnectorCapabilitiesSafely(),
  ]);
  const availableChannels = new Set(
    outputChannels
      .filter((channel) => channel.configured)
      .map((channel) => channel.id.toLowerCase()),
  );
  const availableConnectors = new Set(
    connectors
      .filter((connector) => !connector.scaffoldOnly && connector.readinessState === "write_ready")
      .map((connector) => connector.id),
  );
  const outputConnectorOperations = new Set(
    connectors
      .filter((connector) => !connector.scaffoldOnly && connector.readinessState === "write_ready")
      .flatMap((connector) =>
        connector.commands
          .filter(isWorkflowOutputConnectorCommand)
          .map((command) => `${connector.id}:${command.id}`),
      ),
  );
  const channelLabel = outputChannels.length
    ? outputChannels.map((channel) => channel.label).join(", ")
    : "none";

  for (const node of workflow.nodes) {
    if (node.kind === "action") {
      const actionType = node.config.actionType;
      if (
        actionType.type === "send_message" &&
        actionType.channelType.trim() &&
        !availableChannels.has(actionType.channelType.toLowerCase())
      ) {
        issues.push({
          severity: "error",
          code: "workflow_action_channel_unavailable",
          nodeId: node.id,
          message: `Message action uses "${actionType.channelType}", but that channel is not configured for workflow delivery. Active channels: ${channelLabel}.`,
        });
      }
      if (
        actionType.type === "connector_action" &&
        actionType.connectorId.trim() &&
        !availableConnectors.has(actionType.connectorId)
      ) {
        issues.push({
          severity: "error",
          code: "workflow_action_connector_unavailable",
          nodeId: node.id,
          message: `Connector action uses "${actionType.connectorId}", but that connector is not currently runnable.`,
        });
      }
    }

    if (node.kind === "output") {
      const config = node.config;
      if (
        config.outputType === "channel" &&
        config.channelType.trim() &&
        !availableChannels.has(config.channelType.toLowerCase())
      ) {
        issues.push({
          severity: "error",
          code: "workflow_output_channel_unavailable",
          nodeId: node.id,
          message: `Output uses "${config.channelType}", but that channel is not configured for workflow delivery. Active channels: ${channelLabel}.`,
        });
      }
      if (
        config.outputType === "connector_action" &&
        config.connectorId.trim() &&
        !availableConnectors.has(config.connectorId)
      ) {
        issues.push({
          severity: "error",
          code: "workflow_output_connector_unavailable",
          nodeId: node.id,
          message: `Output uses connector "${config.connectorId}", but that connector is not currently runnable.`,
        });
      }
      if (
        config.outputType === "connector_action" &&
        config.connectorId.trim() &&
        config.operation.trim() &&
        availableConnectors.has(config.connectorId) &&
        !outputConnectorOperations.has(`${config.connectorId}:${config.operation}`)
      ) {
        issues.push({
          severity: "error",
          code: "workflow_output_connector_operation_unavailable",
          nodeId: node.id,
          message: `Output uses "${config.operation}" on "${config.connectorId}", but that operation is not advertised as a write/delivery operation.`,
        });
      }
    }
  }

  return issues;
}

type WorkflowDryRunTraceStep = {
  nodeId: string;
  nodeKind: string;
  label: string;
  status: "passed" | "warning" | "failed";
  message: string;
  details?: Record<string, unknown>;
};

export async function buildWorkflowDryRunTrace(workflow: WorkflowDefinition): Promise<{
  ok: boolean;
  steps: WorkflowDryRunTraceStep[];
  issues: WorkflowIssue[];
}> {
  const runtimeIssues = await validateWorkflowRuntimeCapabilities(workflow);
  const issues =
    workflow.deploymentStage === "simulate"
      ? runtimeIssues.map((issue) => ({
          ...issue,
          severity: "warning" as const,
          message: `${issue.message} Local simulate dry-run continues; live execution remains gated.`,
        }))
      : runtimeIssues;
  const steps: WorkflowDryRunTraceStep[] = [];

  try {
    const order = topologicalSort(workflow.nodes, workflow.edges);
    steps.push({
      nodeId: "__graph__",
      nodeKind: "graph",
      label: "Execution order",
      status: "passed",
      message: `Graph sorts into ${order.length} executable node${order.length === 1 ? "" : "s"}.`,
      details: { order: order.map((node) => node.id) },
    });

    for (const node of order) {
      const label = "label" in node && typeof node.label === "string" ? node.label : node.id;
      if (node.kind === "agent") {
        const sessionKey = buildWorkflowAgentSessionKey(node.config.agentId, 1);
        const identity = validateWorkflowAgentSessionIdentity(node.config.agentId, sessionKey);
        const missingPrompt = !node.config.rolePrompt.trim();
        steps.push({
          nodeId: node.id,
          nodeKind: node.kind,
          label,
          status: !identity.ok ? "failed" : missingPrompt ? "warning" : "passed",
          message: !identity.ok
            ? identity.message
            : missingPrompt
              ? `Agent "${node.config.agentId}" can dispatch, but its prompt is empty.`
              : `Agent "${node.config.agentId}" can dispatch with an isolated workflow session.`,
          details: {
            agentId: node.config.agentId,
            sessionKey,
            sessionAgentId: identity.sessionAgentId,
            timeoutMs: node.config.timeoutMs,
          },
        });
        continue;
      }

      if (node.kind === "action") {
        const capability = getWorkflowActionCapability(node.config.actionType.type);
        steps.push({
          nodeId: node.id,
          nodeKind: node.kind,
          label,
          status: "passed",
          message: capability
            ? `Action "${capability.label}" dry-runs as ${capability.sideEffect}; live run approval=${capability.requiresOperatorApproval ? "required" : "not required"}.`
            : `Action "${node.config.actionType.type}" is structurally reachable.`,
          details: {
            actionType: node.config.actionType.type,
            capability,
            dryRunOnly: true,
          },
        });
        continue;
      }

      steps.push({
        nodeId: node.id,
        nodeKind: node.kind,
        label,
        status: "passed",
        message:
          node.kind === "trigger"
            ? `Trigger "${node.triggerType}" is configured for dry run.`
            : `${node.kind} node is structurally reachable.`,
      });
    }
  } catch (err) {
    steps.push({
      nodeId: "__graph__",
      nodeKind: "graph",
      label: "Execution order",
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  for (const issue of issues) {
    steps.push({
      nodeId: issue.nodeId ?? "__workflow__",
      nodeKind: "validation",
      label: issue.nodeId ?? "Workflow validation",
      status: issue.severity === "error" ? "failed" : "warning",
      message: issue.message,
      details: { code: issue.code },
    });
  }

  return {
    ok: !steps.some((step) => step.status === "failed"),
    steps,
    issues,
  };
}

export async function startAppForgeEventTriggeredWorkflows(opts: {
  sql: ReturnType<typeof postgres>;
  event: NormalizedAppForgeWorkflowEvent;
  broadcast?: (event: string, payload: unknown) => void;
  outboundDeps?: ReturnType<typeof createOutboundSendDeps>;
}) {
  const rows = await opts.sql`
    SELECT *
    FROM workflows
    WHERE is_active = true
      AND (
        trigger_type = 'appforge_event'
        OR nodes::text ILIKE '%appforge_event%'
      )
    ORDER BY updated_at DESC
    LIMIT 50
  `;

  const started: string[] = [];
  const errors: string[] = [];

  for (const row of rows as unknown as WorkflowRow[]) {
    try {
      const normalized = workflowFromRow(row);
      if (hasBlockingWorkflowIssues(normalized.issues)) {
        errors.push(
          `workflow=${row.id}: validation failed: ${normalized.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.message)
            .join("; ")}`,
        );
        continue;
      }

      const triggerNode = normalized.workflow.nodes.find((node) => node.kind === "trigger");
      const nodeMatches =
        triggerNode?.kind === "trigger" &&
        triggerNode.triggerType === "appforge_event" &&
        appForgeEventMatchesTriggerConfig(opts.event, triggerNode.config);
      const rowMatches =
        row.trigger_type === "appforge_event" &&
        appForgeEventMatchesTriggerConfig(opts.event, row.trigger_config);
      if (!nodeMatches && !rowMatches) {
        continue;
      }

      const { runId } = await createWorkflowRunRecord(opts.sql, {
        workflowId: row.id,
        workflowVersion: typeof row.version === "number" ? row.version : 1,
        triggerType: "appforge_event",
        triggerPayload: opts.event.payload,
      });
      started.push(runId);
      opts.broadcast?.("workflow.run.created", {
        runId,
        workflowId: row.id,
        status: "running",
        triggerType: "appforge_event",
        source: "appforge",
      });

      void executeWorkflowRunFromRow({
        sql: opts.sql,
        workflowRow: row,
        runId,
        triggerType: "appforge_event",
        triggerPayload: opts.event.payload,
        triggerSource: "appforge:event",
        broadcast: opts.broadcast,
        outboundDeps: opts.outboundDeps,
      }).catch((err: unknown) => {
        log.warn(`AppForge-triggered workflow ${runId} failed: ${String(err)}`);
      });
    } catch (err) {
      errors.push(`workflow=${String(row.id ?? "unknown")}: ${String(err)}`);
    }
  }

  return { started, errors };
}

// ── Handlers ────────────────────────────────────────────────────────────────

export const workflowsHandlers: GatewayRequestHandlers = {
  "workflows.backendStatus": async ({ respond }) => {
    try {
      respond(true, buildWorkflowBackendStatus());
    } catch (err) {
      log.warn(`workflows.backendStatus failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Import / Export ───────────────────────────────────────────────────────

  "workflows.templates.list": async ({ params, respond }) => {
    try {
      const department = optionalString(params, "department");
      const runPattern = optionalString(params, "runPattern");
      const query = optionalString(params, "query")?.toLowerCase();
      const liveContext = await buildWorkflowPackageLiveReadinessContext();
      const templates = OWNER_OPERATOR_WORKFLOW_PACKAGES.filter((workflowPackage) => {
        if (department && workflowPackage.scenario.department !== department) {
          return false;
        }
        if (runPattern && workflowPackage.scenario.runPattern !== runPattern) {
          return false;
        }
        if (query) {
          const haystack = [
            workflowPackage.name,
            workflowPackage.description,
            workflowPackage.scenario.department,
            workflowPackage.scenario.runPattern,
            workflowPackage.scenario.summary,
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        }
        return true;
      }).map((workflowPackage) => workflowTemplateSummary(workflowPackage, liveContext));
      respond(true, { templates });
    } catch (err) {
      log.warn(`workflows.templates.list failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "workflows.templates.get": async ({ params, respond }) => {
    try {
      const slugOrId = optionalString(params, "slug") ?? optionalString(params, "id");
      if (!slugOrId) {
        throw new Error("slug or id is required");
      }
      const workflowPackage = OWNER_OPERATOR_WORKFLOW_PACKAGES.find(
        (candidate) => candidate.slug === slugOrId || candidate.id === slugOrId,
      );
      if (!workflowPackage) {
        throw new Error(`Workflow template not found: ${slugOrId}`);
      }
      const liveContext = await buildWorkflowPackageLiveReadinessContext();
      respond(true, workflowPackagePreviewPayload(workflowPackage, liveContext));
    } catch (err) {
      log.warn(`workflows.templates.get failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "workflows.importPreview": async ({ params, respond }) => {
    try {
      const text = requireString(params, "text");
      const format = optionalWorkflowPackageFormat(params);
      const workflowPackage = parseWorkflowPackageText(text, format);
      const liveContext = await buildWorkflowPackageLiveReadinessContext();
      respond(true, workflowPackagePreviewPayload(workflowPackage, liveContext));
    } catch (err) {
      log.warn(`workflows.importPreview failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  // ── CRUD ──────────────────────────────────────────────────────────────────

  "workflows.create": async ({ params, respond, context }) => {
    try {
      const sql = await getSql();
      const id =
        optionalString(params, "id") ?? optionalString(params, "workflowId") ?? randomUUID();
      const name = requireString(params, "name");
      const description = optionalString(params, "description") ?? null;
      const ownerAgentId = optionalString(params, "ownerAgentId") ?? "argent";
      const graph = workflowGraphPayload(params);
      const defaultOnError = optionalObject(params, "defaultOnError") ??
        recordValue(graph.definition?.defaultOnError, "definition.defaultOnError") ?? {
          strategy: "fail",
          notifyOnError: true,
        };
      const maxRunDurationMs =
        optionalNumber(params, "maxRunDurationMs") ??
        numberValue(graph.definition?.maxRunDurationMs, "definition.maxRunDurationMs") ??
        3600000;
      const maxRunCostUsd =
        optionalNumber(params, "maxRunCostUsd") ??
        numberValue(graph.definition?.maxRunCostUsd, "definition.maxRunCostUsd") ??
        null;
      const deploymentStage =
        optionalDeploymentStage(params) ??
        workflowDeploymentStageFromDefinition(graph.definition) ??
        "live";
      const normalized = normalizeWorkflow({
        id,
        name,
        description: description ?? undefined,
        nodes: graph.nodes,
        edges: graph.edges,
        canvasLayout: graph.canvasLayout,
        defaultOnError:
          defaultOnError as unknown as import("../../infra/workflow-types.js").ErrorConfig,
        maxRunDurationMs,
        maxRunCostUsd: maxRunCostUsd ?? undefined,
        deploymentStage,
      });
      const derivedTrigger = derivedWorkflowTrigger(normalized.workflow);
      const triggerType =
        optionalString(params, "triggerType") ?? derivedTrigger.triggerType ?? null;
      const triggerConfig =
        optionalObject(params, "triggerConfig") ?? derivedTrigger.triggerConfig ?? null;

      const [row] = await sql`
        INSERT INTO workflows (
          id, name, description, owner_agent_id, version, is_active,
          nodes, edges, canvas_layout,
          default_on_error, max_run_duration_ms, max_run_cost_usd,
          trigger_type, trigger_config, deployment_stage
        ) VALUES (
          ${id}, ${name}, ${description}, ${ownerAgentId}, 1, true,
          ${jsonParam(sql, normalized.workflow.nodes)}::jsonb,
          ${jsonParam(sql, normalized.workflow.edges)}::jsonb,
          ${jsonParam(sql, normalized.canvasLayout)}::jsonb,
          ${jsonParam(sql, normalized.workflow.defaultOnError)}::jsonb, ${maxRunDurationMs},
          ${maxRunCostUsd}, ${triggerType}, ${triggerConfig ? jsonParam(sql, triggerConfig) : null}::jsonb,
          ${deploymentStage}
        )
        RETURNING *
      `;

      await syncWorkflowScheduleCronJob({
        sql,
        cron: context.cron,
        workflow: row as unknown as WorkflowRow,
      });
      log.info(`workflow created: ${id} "${name}"`);
      respond(true, publicWorkflowRow(row as unknown as WorkflowRow));
    } catch (err) {
      log.warn(`workflows.create failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.update": async ({ params, respond, context }) => {
    try {
      const sql = await getSql();
      // Accept both "id" and "workflowId" (dashboard sends workflowId)
      const id =
        typeof params.id === "string" && params.id.trim()
          ? params.id.trim()
          : requireString(params, "workflowId");

      // Fetch current workflow for versioning
      const [existing] = await sql`SELECT * FROM workflows WHERE id = ${id}`;
      if (!existing) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Workflow not found"));
        return;
      }

      const existingJson = workflowJsonFieldsFromRow(existing as unknown as WorkflowRow);

      // Build SET clause dynamically
      // Dashboard may send { canvasData: { nodes, edges } } and agent tools may send
      // canonical { definition: { nodes, edges } }; both are valid persistence sources.
      const graph = workflowGraphPayload(params, {
        nodes: existingJson.nodes,
        edges: existingJson.edges,
        canvasLayout: existingJson.canvasLayout,
      });

      const name = optionalString(params, "name");
      const description = optionalString(params, "description");
      const triggerType = optionalString(params, "triggerType");
      const triggerConfig = optionalObject(params, "triggerConfig");
      const defaultOnError =
        optionalObject(params, "defaultOnError") ??
        recordValue(graph.definition?.defaultOnError, "definition.defaultOnError");
      const maxRunDurationMs =
        optionalNumber(params, "maxRunDurationMs") ??
        numberValue(graph.definition?.maxRunDurationMs, "definition.maxRunDurationMs");
      const maxRunCostUsd =
        optionalNumber(params, "maxRunCostUsd") ??
        numberValue(graph.definition?.maxRunCostUsd, "definition.maxRunCostUsd");
      const deploymentStage =
        optionalDeploymentStage(params) ?? workflowDeploymentStageFromDefinition(graph.definition);
      const isActive = optionalBoolean(params, "isActive");
      const nextFireAt = optionalString(params, "nextFireAt");

      const normalized = graph.changed
        ? normalizeWorkflow({
            id,
            name: name ?? (existing.name as string),
            description: description ?? (existing.description as string | undefined),
            nodes: graph.nodes,
            edges: graph.edges,
            canvasLayout: graph.canvasLayout,
            defaultOnError:
              (defaultOnError as unknown as import("../../infra/workflow-types.js").ErrorConfig) ??
              (existing.default_on_error as unknown as import("../../infra/workflow-types.js").ErrorConfig),
            maxRunDurationMs: maxRunDurationMs ?? (existing.max_run_duration_ms as number),
            maxRunCostUsd:
              maxRunCostUsd ??
              (typeof existing.max_run_cost_usd === "number"
                ? existing.max_run_cost_usd
                : undefined),
            deploymentStage:
              deploymentStage ??
              workflowDeploymentStageFromDefinition({
                deploymentStage: existing.deployment_stage,
              }) ??
              "live",
          })
        : null;
      const derivedTrigger = normalized ? derivedWorkflowTrigger(normalized.workflow) : null;
      const nextTriggerType = triggerType ?? derivedTrigger?.triggerType;
      const nextTriggerConfig = triggerConfig ?? derivedTrigger?.triggerConfig;
      const graphChanged = Boolean(
        normalized &&
        (!jsonEqual(normalized.workflow.nodes, existingJson.nodes) ||
          !jsonEqual(normalized.workflow.edges, existingJson.edges) ||
          !jsonEqual(normalized.canvasLayout, existingJson.canvasLayout)),
      );
      const defaultOnErrorChanged =
        defaultOnError !== undefined && !jsonEqual(defaultOnError, existing.default_on_error);
      const changed =
        graphChanged ||
        (name !== undefined && name !== existing.name) ||
        (description !== undefined && description !== existing.description) ||
        (nextTriggerType !== undefined && nextTriggerType !== existing.trigger_type) ||
        (nextTriggerConfig !== undefined &&
          !jsonEqual(nextTriggerConfig, existing.trigger_config)) ||
        defaultOnErrorChanged ||
        (maxRunDurationMs !== undefined && maxRunDurationMs !== existing.max_run_duration_ms) ||
        (maxRunCostUsd !== undefined && maxRunCostUsd !== existing.max_run_cost_usd) ||
        (deploymentStage !== undefined && deploymentStage !== existing.deployment_stage) ||
        (isActive !== undefined && isActive !== existing.is_active) ||
        (nextFireAt !== undefined &&
          new Date(nextFireAt).toISOString() !==
            (existing.next_fire_at
              ? new Date(existing.next_fire_at as string | number | Date).toISOString()
              : null));

      if (!changed) {
        log.info(`workflow update ignored as no-op: ${id}`);
        respond(true, publicWorkflowRow(existing as unknown as WorkflowRow));
        return;
      }

      const newVersion = (existing.version as number) + 1;
      const versionId = randomUUID();
      await sql`
        INSERT INTO workflow_versions (id, workflow_id, version, nodes, edges, canvas_layout, changed_by, change_summary)
        VALUES (
          ${versionId}, ${id}, ${existing.version},
          ${jsonParam(sql, existingJson.nodes)}::jsonb,
          ${jsonParam(sql, existingJson.edges)}::jsonb,
          ${jsonParam(sql, existingJson.canvasLayout)}::jsonb,
          ${optionalString(params, "changedBy") ?? "operator"},
          ${optionalString(params, "changeSummary") ?? null}
        )
      `;

      const [updated] = await sql`
        UPDATE workflows SET
          version = ${newVersion},
          name = COALESCE(${name ?? null}, name),
          description = COALESCE(${description ?? null}, description),
          nodes = COALESCE(${normalized ? jsonParam(sql, normalized.workflow.nodes) : null}::jsonb, nodes),
          edges = COALESCE(${normalized ? jsonParam(sql, normalized.workflow.edges) : null}::jsonb, edges),
          canvas_layout = COALESCE(${normalized ? jsonParam(sql, normalized.canvasLayout) : null}::jsonb, canvas_layout),
          trigger_type = COALESCE(${nextTriggerType ?? null}, trigger_type),
          trigger_config = COALESCE(${nextTriggerConfig ? jsonParam(sql, nextTriggerConfig) : null}::jsonb, trigger_config),
          default_on_error = COALESCE(${normalized ? jsonParam(sql, normalized.workflow.defaultOnError) : defaultOnError ? jsonParam(sql, defaultOnError) : null}::jsonb, default_on_error),
          max_run_duration_ms = COALESCE(${maxRunDurationMs ?? null}, max_run_duration_ms),
          max_run_cost_usd = COALESCE(${maxRunCostUsd ?? null}, max_run_cost_usd),
          deployment_stage = COALESCE(${deploymentStage ?? null}, deployment_stage),
          is_active = COALESCE(${isActive ?? null}, is_active),
          next_fire_at = COALESCE(${nextFireAt ?? null}::timestamptz, next_fire_at),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      await syncWorkflowScheduleCronJob({
        sql,
        cron: context.cron,
        workflow: updated as unknown as WorkflowRow,
      });
      log.info(`workflow updated: ${id} → v${newVersion}`);
      respond(true, publicWorkflowRow(updated as unknown as WorkflowRow));
    } catch (err) {
      log.warn(`workflows.update failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.get": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const id = requireString(params, "id");

      const [row] = await sql`SELECT * FROM workflows WHERE id = ${id}`;
      if (!row) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Workflow not found"));
        return;
      }

      respond(true, publicWorkflowRow(row as unknown as WorkflowRow));
    } catch (err) {
      log.warn(`workflows.get failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.versions.list": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const workflowId = optionalString(params, "workflowId") ?? requireString(params, "id");
      const limit = optionalNumber(params, "limit") ?? 25;
      const offset = optionalNumber(params, "offset") ?? 0;

      const rows = await sql`
        SELECT *
        FROM workflow_versions
        WHERE workflow_id = ${workflowId}
        ORDER BY version DESC, created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      const [countRow] = await sql`
        SELECT COUNT(*)::int AS total
        FROM workflow_versions
        WHERE workflow_id = ${workflowId}
      `;
      respond(true, {
        versions: rows.map((row: Record<string, unknown>) => publicWorkflowVersionRow(row)),
        total: countRow?.total ?? 0,
        limit,
        offset,
      });
    } catch (err) {
      log.warn(`workflows.versions.list failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.versions.restore": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const workflowId = optionalString(params, "workflowId") ?? requireString(params, "id");
      const version = optionalNumber(params, "version");
      if (version == null) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "version is required"));
        return;
      }

      const [existing] = await sql`SELECT * FROM workflows WHERE id = ${workflowId}`;
      if (!existing) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Workflow not found"));
        return;
      }

      const [snapshot] = await sql`
        SELECT *
        FROM workflow_versions
        WHERE workflow_id = ${workflowId} AND version = ${version}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (!snapshot) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Version not found"));
        return;
      }

      const newVersion = (existing.version as number) + 1;
      const currentJson = workflowJsonFieldsFromRow(existing as unknown as WorkflowRow);
      await sql`
        INSERT INTO workflow_versions (id, workflow_id, version, nodes, edges, canvas_layout, changed_by, change_summary)
        VALUES (
          ${randomUUID()}, ${workflowId}, ${existing.version},
          ${jsonParam(sql, currentJson.nodes)}::jsonb,
          ${jsonParam(sql, currentJson.edges)}::jsonb,
          ${jsonParam(sql, currentJson.canvasLayout)}::jsonb,
          ${optionalString(params, "changedBy") ?? "operator"},
          ${optionalString(params, "changeSummary") ?? `Before restoring v${version}`}
        )
        ON CONFLICT (workflow_id, version) DO NOTHING
      `;

      const snapshotJson = workflowJsonFieldsFromRow(snapshot as unknown as WorkflowRow);
      const normalized = normalizeWorkflow({
        id: workflowId,
        name: existing.name as string,
        description: existing.description as string | undefined,
        nodes: snapshotJson.nodes,
        edges: snapshotJson.edges,
        canvasLayout: snapshotJson.canvasLayout,
        defaultOnError:
          currentJson.defaultOnError ??
          (existing.default_on_error as unknown as import("../../infra/workflow-types.js").ErrorConfig),
        maxRunDurationMs:
          optionalNumber(params, "maxRunDurationMs") ?? (existing.max_run_duration_ms as number),
        maxRunCostUsd:
          typeof existing.max_run_cost_usd === "number" ? existing.max_run_cost_usd : undefined,
        deploymentStage:
          workflowDeploymentStageFromDefinition({ deploymentStage: existing.deployment_stage }) ??
          "live",
      });
      const derivedTrigger = derivedWorkflowTrigger(normalized.workflow);
      const restoredTriggerType = derivedTrigger.triggerType ?? "manual";

      const [updated] = await sql`
        UPDATE workflows SET
          version = ${newVersion},
          nodes = ${jsonParam(sql, normalized.workflow.nodes)}::jsonb,
          edges = ${jsonParam(sql, normalized.workflow.edges)}::jsonb,
          canvas_layout = ${jsonParam(sql, normalized.canvasLayout)}::jsonb,
          trigger_type = ${restoredTriggerType},
          trigger_config = ${derivedTrigger.triggerConfig ? jsonParam(sql, derivedTrigger.triggerConfig) : null}::jsonb,
          updated_at = NOW()
        WHERE id = ${workflowId}
        RETURNING *
      `;

      log.info(`workflow restored: ${workflowId} v${version} → v${newVersion}`);
      respond(true, {
        restored: true,
        restoredFromVersion: version,
        workflow: publicWorkflowRow(updated as unknown as WorkflowRow),
      });
    } catch (err) {
      log.warn(`workflows.versions.restore failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.list": async ({ params, respond }) => {
    try {
      const snapshot = optionalString(params, "snapshot");
      if (snapshot) {
        if (snapshot !== WORKFLOWS_LIST_NO_LIVE_DATA_SNAPSHOT) {
          throw new Error(`Unsupported workflows.list snapshot "${snapshot}"`);
        }
        respond(true, workflowListNoLiveDataSnapshot(params));
        return;
      }

      const sql = await getSql();
      const limit = optionalNumber(params, "limit") ?? 50;
      const offset = optionalNumber(params, "offset") ?? 0;
      const activeOnly = optionalBoolean(params, "activeOnly") ?? false;
      const ownerAgentId = optionalString(params, "ownerAgentId");

      let rows;
      if (activeOnly && ownerAgentId) {
        rows = await sql`
          SELECT w.*, COALESCE(rc.run_count, 0)::int AS run_count
          FROM workflows w
          LEFT JOIN (
            SELECT workflow_id, COUNT(*)::int AS run_count
            FROM workflow_runs
            GROUP BY workflow_id
          ) rc ON rc.workflow_id = w.id
          WHERE w.is_active = true AND w.owner_agent_id = ${ownerAgentId}
          ORDER BY w.updated_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (activeOnly) {
        rows = await sql`
          SELECT w.*, COALESCE(rc.run_count, 0)::int AS run_count
          FROM workflows w
          LEFT JOIN (
            SELECT workflow_id, COUNT(*)::int AS run_count
            FROM workflow_runs
            GROUP BY workflow_id
          ) rc ON rc.workflow_id = w.id
          WHERE w.is_active = true
          ORDER BY w.updated_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (ownerAgentId) {
        rows = await sql`
          SELECT w.*, COALESCE(rc.run_count, 0)::int AS run_count
          FROM workflows w
          LEFT JOIN (
            SELECT workflow_id, COUNT(*)::int AS run_count
            FROM workflow_runs
            GROUP BY workflow_id
          ) rc ON rc.workflow_id = w.id
          WHERE w.owner_agent_id = ${ownerAgentId}
          ORDER BY w.updated_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        rows = await sql`
          SELECT w.*, COALESCE(rc.run_count, 0)::int AS run_count
          FROM workflows w
          LEFT JOIN (
            SELECT workflow_id, COUNT(*)::int AS run_count
            FROM workflow_runs
            GROUP BY workflow_id
          ) rc ON rc.workflow_id = w.id
          ORDER BY w.updated_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      }

      // Get total count for pagination
      const [countRow] = activeOnly
        ? await sql`SELECT COUNT(*)::int AS total FROM workflows WHERE is_active = true`
        : await sql`SELECT COUNT(*)::int AS total FROM workflows`;

      respond(true, {
        workflows: rows.map((row: Record<string, unknown>) =>
          publicWorkflowRow(row as unknown as WorkflowRow),
        ),
        total: countRow?.total ?? 0,
        limit,
        offset,
      });
    } catch (err) {
      log.warn(`workflows.list failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.delete": async ({ params, respond, context }) => {
    try {
      const sql = await getSql();
      const id =
        typeof params.id === "string" && params.id.trim()
          ? params.id.trim()
          : requireString(params, "workflowId");

      // Cascading delete — workflow_runs and workflow_step_runs are ON DELETE CASCADE
      const [deleted] = await sql`
        DELETE FROM workflows WHERE id = ${id} RETURNING id, name
      `;

      if (!deleted) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Workflow not found"));
        return;
      }

      const jobs = workflowRunCronJobs(await context.cron.list({ includeDisabled: true }), id);
      for (const job of jobs) {
        await context.cron.remove(job.id);
      }
      log.info(`workflow deleted: ${id} "${deleted.name}"`);
      respond(true, { deleted: true, id });
    } catch (err) {
      log.warn(`workflows.delete failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.duplicate": async ({ params, respond, context }) => {
    try {
      const sql = await getSql();
      const sourceId = requireString(params, "id");
      const newName = optionalString(params, "name");

      const [source] = await sql`SELECT * FROM workflows WHERE id = ${sourceId}`;
      if (!source) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Source workflow not found"),
        );
        return;
      }

      const newId = randomUUID();
      const name = newName ?? `${source.name} (copy)`;
      const sourceJson = workflowJsonFieldsFromRow(source as unknown as WorkflowRow);
      const duplicateStartsActive = duplicatedWorkflowShouldStartActive(
        source as unknown as WorkflowRow,
      );

      const [row] = await sql`
        INSERT INTO workflows (
          id, name, description, owner_agent_id, version, is_active,
          nodes, edges, canvas_layout,
          default_on_error, max_run_duration_ms, max_run_cost_usd,
          trigger_type, trigger_config, deployment_stage
        ) VALUES (
          ${newId}, ${name}, ${source.description},
          ${source.owner_agent_id}, 1, ${duplicateStartsActive},
          ${jsonParam(sql, sourceJson.nodes)}::jsonb,
          ${jsonParam(sql, sourceJson.edges)}::jsonb,
          ${jsonParam(sql, sourceJson.canvasLayout)}::jsonb,
          ${jsonParam(sql, sourceJson.defaultOnError ?? {})}::jsonb,
          ${source.max_run_duration_ms},
          ${source.max_run_cost_usd},
          ${source.trigger_type},
          ${source.trigger_config ? jsonParam(sql, source.trigger_config) : null}::jsonb,
          'live'
        )
        RETURNING *
      `;

      await syncWorkflowScheduleCronJob({
        sql,
        cron: context.cron,
        workflow: row as unknown as WorkflowRow,
      });
      log.info(`workflow duplicated: ${sourceId} → ${newId} "${name}"`);
      respond(true, publicWorkflowRow(row as unknown as WorkflowRow));
    } catch (err) {
      log.warn(`workflows.duplicate failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.validate": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const id = optionalString(params, "id") ?? optionalString(params, "workflowId");
      if (id) {
        const [row] = await sql`SELECT * FROM workflows WHERE id = ${id}`;
        if (!row) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Workflow not found"));
          return;
        }
        const normalized = workflowFromRow(row as unknown as WorkflowRow);
        const runtimeIssues = [
          ...(await validateWorkflowRuntimeCapabilities(normalized.workflow)),
          ...(await activeWorkflowScheduleConflictIssues({
            sql,
            workflow: row as unknown as WorkflowRow,
          })),
        ];
        const issues = [...normalized.issues, ...runtimeIssues];
        respond(true, {
          ok: !hasBlockingWorkflowIssues(issues),
          issues,
          definition: normalized.workflow,
          canvasLayout: normalized.canvasLayout,
        });
        return;
      }

      const name = optionalString(params, "name") ?? "Untitled workflow";
      const graph = workflowGraphPayload(params);
      const normalized = normalizeWorkflow({
        id: optionalString(params, "workflowId") ?? "draft",
        name,
        description: optionalString(params, "description"),
        nodes: graph.nodes,
        edges: graph.edges,
        canvasLayout: graph.canvasLayout,
        defaultOnError: (recordValue(
          graph.definition?.defaultOnError,
          "definition.defaultOnError",
        ) ?? undefined) as unknown as import("../../infra/workflow-types.js").ErrorConfig,
        maxRunDurationMs: numberValue(
          graph.definition?.maxRunDurationMs,
          "definition.maxRunDurationMs",
        ),
        maxRunCostUsd: numberValue(graph.definition?.maxRunCostUsd, "definition.maxRunCostUsd"),
        deploymentStage:
          optionalDeploymentStage(params) ??
          workflowDeploymentStageFromDefinition(graph.definition) ??
          "live",
      });
      const runtimeIssues = await validateWorkflowRuntimeCapabilities(normalized.workflow);
      const issues = [...normalized.issues, ...runtimeIssues];
      respond(true, {
        ok: !hasBlockingWorkflowIssues(issues),
        issues,
        definition: normalized.workflow,
        canvasLayout: normalized.canvasLayout,
      });
    } catch (err) {
      log.warn(`workflows.validate failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.dryRun": async ({ params, respond }) => {
    try {
      const id = optionalString(params, "id") ?? optionalString(params, "workflowId");
      let normalized;
      if (id) {
        const sql = await getSql();
        const [row] = await sql`SELECT * FROM workflows WHERE id = ${id}`;
        if (!row) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Workflow not found"));
          return;
        }
        normalized = workflowFromRow(
          workflowRowWithCanvasOverride(row as unknown as WorkflowRow, params),
        );
      } else {
        const graph = workflowGraphPayload(params);
        normalized = normalizeWorkflow({
          id: "dry-run",
          name: optionalString(params, "name") ?? "Untitled workflow",
          description: optionalString(params, "description"),
          nodes: graph.nodes,
          edges: graph.edges,
          canvasLayout: graph.canvasLayout,
          deploymentStage:
            optionalDeploymentStage(params) ??
            workflowDeploymentStageFromDefinition(graph.definition) ??
            "live",
        });
      }

      const trace = await buildWorkflowDryRunTrace(normalized.workflow);
      respond(true, {
        ok: trace.ok && !hasBlockingWorkflowIssues([...normalized.issues, ...trace.issues]),
        steps: trace.steps,
        issues: [...normalized.issues, ...trace.issues],
        definition: normalized.workflow,
        canvasLayout: normalized.canvasLayout,
      });
    } catch (err) {
      log.warn(`workflows.dryRun failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.draft": async ({ params, respond }) => {
    try {
      const requestedAgentId =
        optionalString(params, "preferredAgentId") ?? optionalString(params, "ownerAgentId");
      const toolStatus = buildToolsStatusPayload(
        requestedAgentId ? { agentId: requestedAgentId } : {},
      );
      const skillCapabilities = await buildWorkflowPersonalSkillCapabilities(params).catch(() => ({
        agentId: toolStatus.agentId,
        personalSkills: [],
        promotedTools: [],
        tools: [],
      }));
      const appForge = await buildWorkflowAppForgeCapabilities().catch(() => ({
        apps: [],
        capabilities: [],
      }));
      const draft = draftWorkflowFromIntent({
        id: optionalString(params, "id") ?? optionalString(params, "workflowId"),
        name: optionalString(params, "name"),
        description: optionalString(params, "description"),
        intent: requireString(params, "intent"),
        ownerAgentId: optionalString(params, "ownerAgentId") ?? toolStatus.agentId,
        preferredAgentId: optionalString(params, "preferredAgentId") ?? toolStatus.agentId,
        preferredAgentName: optionalString(params, "preferredAgentName"),
        triggerType: optionalString(params, "triggerType"),
        scheduleCron: optionalString(params, "scheduleCron"),
        timezone: optionalString(params, "timezone"),
        preferredTools: optionalArray(params, "preferredTools")?.filter(
          (tool): tool is string => typeof tool === "string" && tool.trim().length > 0,
        ),
        capabilities: [
          ...toolStatus.tools,
          ...skillCapabilities.personalSkills,
          ...skillCapabilities.promotedTools,
          ...appForge.capabilities,
        ],
      });
      respond(true, {
        ok: !hasBlockingWorkflowIssues(draft.issues),
        name: draft.name,
        description: draft.description,
        nodes: draft.nodes,
        edges: draft.edges,
        definition: draft.workflow,
        canvasLayout: draft.canvasLayout,
        issues: draft.issues,
        reviewNotes: draft.reviewNotes,
        assumptions: draft.assumptions,
        agentId: toolStatus.agentId,
      });
    } catch (err) {
      log.warn(`workflows.draft failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.cancel": async ({ params, respond, context }) => {
    try {
      const sql = await getSql();
      const runId = requireString(params, "runId");
      const reason = optionalString(params, "reason") ?? "Cancelled by operator";
      const [row] = await sql`
        UPDATE workflow_runs SET
          status = 'cancelled',
          error = ${reason},
          ended_at = COALESCE(ended_at, NOW())
        WHERE id = ${runId}
          AND status IN ('created', 'running', 'waiting_approval', 'waiting_event', 'waiting_duration')
        RETURNING id, workflow_id, status
      `;
      if (!row) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Run not found or not cancellable"),
        );
        return;
      }
      context?.broadcast?.("workflow.run.completed", {
        runId,
        workflowId: row.workflow_id,
        status: "cancelled",
        error: reason,
      });
      respond(true, { ok: true, runId, status: "cancelled" });
    } catch (err) {
      log.warn(`workflows.cancel failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.resume": async ({ params, respond, context }) => {
    try {
      const sql = await getSql();
      const runId = requireString(params, "runId");
      const nodeId = optionalString(params, "nodeId");
      const force = optionalBoolean(params, "force") ?? false;
      const [run] = await sql`
        SELECT id, workflow_id, current_node_id, status
        FROM workflow_runs
        WHERE id = ${runId}
      `;
      const resumeNodeId = nodeId ?? (run?.current_node_id as string | undefined);
      if (!run || !resumeNodeId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Run not found or missing resume node"),
        );
        return;
      }
      if (run.status === "waiting_duration") {
        void resumeWorkflowRunAfterWait({
          sql,
          runId,
          nodeId: resumeNodeId,
          force,
          triggerSource: "gateway:manual_wait_resume",
          broadcast: context?.broadcast,
          outboundDeps: context?.deps ? createOutboundSendDeps(context.deps) : undefined,
        }).catch((err: unknown) => {
          log.warn(`workflow wait resume failed: ${String(err)}`);
          context?.broadcast?.("workflow.run.completed", {
            runId,
            workflowId: run.workflow_id,
            status: "failed",
            error: String(err),
          });
        });
        respond(true, { ok: true, queued: true, runId, nodeId: resumeNodeId });
        return;
      }
      const [approval] = await sql`
        SELECT id, status
        FROM workflow_approvals
        WHERE run_id = ${runId}
          AND node_id = ${resumeNodeId}
        ORDER BY requested_at DESC
        LIMIT 1
      `;
      if (!approval || approval.status !== "approved") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Run is not approved for resume"),
        );
        return;
      }

      void resumeWorkflowRunAfterApproval({
        sql,
        runId,
        nodeId: resumeNodeId,
        triggerSource: "gateway:manual_resume",
        broadcast: context?.broadcast,
        outboundDeps: context?.deps ? createOutboundSendDeps(context.deps) : undefined,
      }).catch((err: unknown) => {
        log.warn(`workflow manual resume failed: ${String(err)}`);
        context?.broadcast?.("workflow.run.completed", {
          runId,
          workflowId: run.workflow_id,
          status: "failed",
          error: String(err),
        });
      });

      respond(true, { ok: true, queued: true, runId, nodeId: resumeNodeId });
    } catch (err) {
      log.warn(`workflows.resume failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Execution ─────────────────────────────────────────────────────────────

  "workflows.run": async ({ params, respond, context }) => {
    try {
      const sql = await getSql();
      const resolution = await resolveRunnableWorkflowRow(sql, params);
      if (!resolution.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, resolution.error));
        return;
      }
      const workflowId = resolution.workflowId;
      const wf = workflowRowWithCanvasOverride(resolution.workflowRow, params);
      const triggerPayload = optionalObject(params, "triggerPayload") ?? {};
      const fromStepId = optionalString(params, "fromStepId");
      const sourceRunId = optionalString(params, "sourceRunId");
      const stopAfterNodeId = optionalString(params, "stopAfterNodeId");
      const normalizedForRun = workflowFromRow(wf);
      const runtimeIssues = await validateWorkflowRuntimeCapabilities(normalizedForRun.workflow);
      const runIssues = [...normalizedForRun.issues, ...runtimeIssues];
      if (hasBlockingWorkflowIssues(runIssues)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `Workflow validation failed: ${runIssues
              .filter((issue) => issue.severity === "error")
              .map((issue) => issue.message)
              .join("; ")}`,
          ),
        );
        return;
      }
      const liveGate = evaluateWorkflowLiveRunGate({
        deploymentStage: normalizedForRun.workflow.deploymentStage,
        importReport: importReportFromWorkflowRow(wf),
      });
      if (!liveGate.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, liveGate.message, {
            details: { codes: liveGate.codes },
          }),
        );
        return;
      }

      let resume;
      if (fromStepId) {
        if (!sourceRunId) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "sourceRunId is required with fromStepId"),
          );
          return;
        }
        resume = await buildWorkflowRetryFromStepResumeOptions({
          sql,
          sourceRunId,
          fromStepNodeId: fromStepId,
          workflow: normalizedForRun.workflow,
          triggerSource: "gateway:retry_from_step",
        });
      }

      const runTriggerPayload = {
        ...triggerPayload,
        ...(fromStepId && sourceRunId ? { retry: { sourceRunId, fromStepId } } : {}),
        ...(stopAfterNodeId ? { partial: { stopAfterNodeId } } : {}),
      };

      const { runId, run } = await createWorkflowRunRecord(sql, {
        workflowId,
        workflowVersion: wf.version as number,
        triggerType: "manual",
        triggerPayload: runTriggerPayload,
      });

      log.info(`workflow run created: ${runId} for workflow ${workflowId} v${wf.version}`);

      // Broadcast run creation for live subscribers
      if (context?.broadcast) {
        context.broadcast("workflow.run.created", {
          runId,
          workflowId,
          status: "running",
        });
      }

      // Respond immediately with runId — execution happens in background
      respond(true, { ...run, status: "running" });

      void executeWorkflowRunFromRow({
        sql,
        workflowRow: wf as unknown as WorkflowRow,
        runId,
        triggerType: "manual",
        triggerPayload: runTriggerPayload,
        triggerSource: fromStepId
          ? "gateway:retry_from_step"
          : stopAfterNodeId
            ? "gateway:manual_partial"
            : "gateway:manual",
        broadcast: context?.broadcast,
        outboundDeps: context?.deps ? createOutboundSendDeps(context.deps) : undefined,
        resume,
        stopAfterNodeId,
      });
    } catch (err) {
      log.warn(`workflows.run failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Run History ───────────────────────────────────────────────────────────

  "workflows.runs.list": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const workflowId = optionalString(params, "workflowId");
      const limit = optionalNumber(params, "limit") ?? 25;
      const offset = optionalNumber(params, "offset") ?? 0;
      const status = optionalString(params, "status");

      let rows;
      if (workflowId && status) {
        rows = await sql`
          SELECT r.*, w.name AS workflow_name
          FROM workflow_runs r
          JOIN workflows w ON w.id = r.workflow_id
          WHERE r.workflow_id = ${workflowId} AND r.status = ${status}
          ORDER BY r.started_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (workflowId) {
        rows = await sql`
          SELECT r.*, w.name AS workflow_name
          FROM workflow_runs r
          JOIN workflows w ON w.id = r.workflow_id
          WHERE r.workflow_id = ${workflowId}
          ORDER BY r.started_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (status) {
        rows = await sql`
          SELECT r.*, w.name AS workflow_name
          FROM workflow_runs r
          JOIN workflows w ON w.id = r.workflow_id
          WHERE r.status = ${status}
          ORDER BY r.started_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        rows = await sql`
          SELECT r.*, w.name AS workflow_name
          FROM workflow_runs r
          JOIN workflows w ON w.id = r.workflow_id
          ORDER BY r.started_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      }

      respond(true, { runs: rows.map((row) => publicWorkflowRun(row)), limit, offset });
    } catch (err) {
      log.warn(`workflows.runs.list failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.runs.get": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const runId = requireString(params, "runId");

      const [run] = await sql`
        SELECT r.*, w.name AS workflow_name, w.nodes AS workflow_nodes
        FROM workflow_runs r
        JOIN workflows w ON w.id = r.workflow_id
        WHERE r.id = ${runId}
      `;
      if (!run) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Run not found"));
        return;
      }

      // Fetch step runs for this run
      const steps = await sql`
        SELECT * FROM workflow_step_runs
        WHERE run_id = ${runId}
        ORDER BY started_at ASC NULLS LAST
      `;
      const approvals = await sql`
        SELECT *
        FROM workflow_approvals
        WHERE run_id = ${runId}
        ORDER BY requested_at ASC NULLS LAST
      `;

      const detail = publicWorkflowRun(run, {
        steps: steps as Record<string, unknown>[],
        approvals: approvals as Record<string, unknown>[],
        workflowNodes: (run as Record<string, unknown>).workflow_nodes,
      });

      respond(true, { ...detail, run: detail });
    } catch (err) {
      log.warn(`workflows.runs.get failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Live Updates ──────────────────────────────────────────────────────────

  "workflows.connectors": async ({ respond }) => {
    try {
      const catalog = await discoverConnectorCatalog();
      const connectors = catalog.connectors.map((c: ConnectorCatalogEntry) => {
        // Read the manifest to check scaffold_only flag
        let scaffoldOnly = false;
        for (const root of defaultRepoRoots()) {
          const mPath = path.join(root, c.tool, "connector.json");
          if (fs.existsSync(mPath)) {
            try {
              const raw = JSON.parse(fs.readFileSync(mPath, "utf-8")) as Record<string, unknown>;
              const scope =
                raw.scope && typeof raw.scope === "object"
                  ? (raw.scope as Record<string, unknown>)
                  : {};
              scaffoldOnly = scope.scaffold_only === true;
            } catch {
              /* ignore */
            }
            break;
          }
        }

        const readinessState = workflowConnectorReadinessState(c, scaffoldOnly);

        return {
          id: c.tool,
          name: c.label || c.tool.replace(/^aos-/, "").replace(/-/g, " "),
          category: c.category ?? "general",
          categories: c.categories,
          commands: c.commands.map((cmd) => ({
            id: cmd.id,
            summary: cmd.summary,
            actionClass: cmd.actionClass,
          })),
          installState: c.installState,
          statusOk: c.status.ok,
          scaffoldOnly,
          readinessState,
        };
      });
      respond(true, { connectors });
    } catch (err) {
      log.warn(`workflows.connectors failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.capabilities": async ({ params, respond }) => {
    try {
      const toolStatus = buildToolsStatusPayload(params);
      const skillCapabilities = await buildWorkflowPersonalSkillCapabilities(params).catch(
        (err) => {
          log.warn(`workflow personal skill capabilities unavailable: ${String(err)}`);
          return {
            agentId: toolStatus.agentId,
            personalSkills: [],
            promotedTools: [],
            tools: [],
          };
        },
      );
      const appForge = await buildWorkflowAppForgeCapabilities().catch((err) => {
        log.warn(`workflow AppForge capabilities unavailable: ${String(err)}`);
        return { apps: [], capabilities: [] };
      });
      const outputChannels = await buildWorkflowOutputChannels().catch((err) => {
        log.warn(`workflow output channel capabilities unavailable: ${String(err)}`);
        return [];
      });
      const connectors = await buildWorkflowConnectorCapabilitiesSafely();
      const toolsByName = new Map<string, unknown>();
      for (const tool of toolStatus.tools) {
        toolsByName.set(tool.name, tool);
      }
      for (const tool of skillCapabilities.tools) {
        if (!toolsByName.has(tool.name)) {
          toolsByName.set(tool.name, tool);
        }
      }
      for (const capability of appForge.capabilities) {
        if (!toolsByName.has(capability.name)) {
          toolsByName.set(capability.name, capability);
        }
      }
      respond(true, {
        primitives: WORKFLOW_PRIMITIVES,
        actions: WORKFLOW_ACTION_CAPABILITIES,
        actionCapabilities: WORKFLOW_ACTION_CAPABILITIES,
        tools: Array.from(toolsByName.values()),
        personalSkills: skillCapabilities.personalSkills,
        promotedTools: skillCapabilities.promotedTools,
        appForgeApps: appForge.apps,
        appForgeCapabilities: appForge.capabilities,
        outputChannels,
        connectors,
        policy: toolStatus.policy,
        agentId: toolStatus.agentId,
        sessionKey: toolStatus.sessionKey,
      });
    } catch (err) {
      log.warn(`workflows.capabilities failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.subscribe": async ({ params, respond, client }) => {
    try {
      const workflowId = optionalString(params, "workflowId");
      const runId = optionalString(params, "runId");

      if (!workflowId && !runId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "workflowId or runId required"),
        );
        return;
      }

      // Subscription tracking is handled by the WebSocket layer.
      // The client receives workflow.run.* events via broadcast.
      // This handler acknowledges the subscription request.
      log.info(
        `workflow subscribe: connId=${client?.connId ?? "?"} workflow=${workflowId ?? "*"} run=${runId ?? "*"}`,
      );

      respond(true, {
        subscribed: true,
        workflowId: workflowId ?? null,
        runId: runId ?? null,
      });
    } catch (err) {
      log.warn(`workflows.subscribe failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.emitEvent": async ({ params, respond, context }) => {
    try {
      const sql = await getSql();
      const eventType = requireString(params, "eventType");
      const payload = optionalObject(params, "payload") ?? {};
      const appId = optionalString(params, "appId");
      const capabilityId = optionalString(params, "capabilityId");
      const runId = optionalString(params, "runId") ?? optionalString(params, "workflowRunId");
      const nodeId = optionalString(params, "nodeId");
      const eventPayload = {
        ...payload,
        ...(appId ? { appId } : {}),
        ...(capabilityId ? { capabilityId } : {}),
      };

      context?.broadcast?.("workflow.event.received", {
        eventType,
        runId: runId ?? null,
        nodeId: nodeId ?? null,
        appId: appId ?? null,
        capabilityId: capabilityId ?? null,
      });

      const result = await resumeWorkflowRunsForEvent({
        sql,
        eventType,
        eventPayload,
        runId,
        nodeId,
        broadcast: context?.broadcast,
        outboundDeps: context?.deps ? createOutboundSendDeps(context.deps) : undefined,
      });

      respond(true, {
        ok: true,
        eventType,
        resumed: result.resumed,
        errors: result.errors,
      });
    } catch (err) {
      log.warn(`workflows.emitEvent failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.emitAppForgeEvent": async ({ params, respond, context }) => {
    try {
      const sql = await getSql();
      const event = normalizeAppForgeWorkflowEvent(params);

      context?.broadcast?.("appforge.event.emitted", {
        eventType: event.eventType,
        appId: event.appId,
        capabilityId: event.capabilityId ?? null,
        runId: event.workflowRunId ?? null,
        nodeId: event.nodeId ?? null,
      });
      context?.broadcast?.("workflow.event.received", {
        source: "appforge",
        eventType: event.eventType,
        runId: event.workflowRunId ?? null,
        nodeId: event.nodeId ?? null,
        appId: event.appId,
        capabilityId: event.capabilityId ?? null,
      });

      const result = await resumeWorkflowRunsForEvent({
        sql,
        eventType: event.eventType,
        eventPayload: event.payload,
        runId: event.workflowRunId,
        nodeId: event.nodeId,
        broadcast: context?.broadcast,
        outboundDeps: context?.deps ? createOutboundSendDeps(context.deps) : undefined,
      });
      const triggered = event.workflowRunId
        ? { started: [], errors: [] }
        : await startAppForgeEventTriggeredWorkflows({
            sql,
            event,
            broadcast: context?.broadcast,
            outboundDeps: context?.deps ? createOutboundSendDeps(context.deps) : undefined,
          });

      respond(true, {
        ok: true,
        source: "appforge",
        eventType: event.eventType,
        appId: event.appId,
        capabilityId: event.capabilityId ?? null,
        runId: event.workflowRunId ?? null,
        nodeId: event.nodeId ?? null,
        resumed: result.resumed,
        started: triggered.started.length,
        startedRunIds: triggered.started,
        errors: result.errors,
        triggerErrors: triggered.errors,
      });
    } catch (err) {
      log.warn(`workflows.emitAppForgeEvent failed: ${String(err)}`);
      const message = String(err);
      const code = message.includes("required")
        ? ErrorCodes.INVALID_REQUEST
        : ErrorCodes.UNAVAILABLE;
      respond(false, undefined, errorShape(code, message));
    }
  },

  // ── Approval Gate ───────────────────────────────────────────────────────────

  "workflows.approve": async ({ params, respond, context }) => {
    try {
      const sql = await getSql();
      const runId = requireString(params, "runId");
      const nodeId = requireString(params, "nodeId");
      const reason = optionalString(params, "reason");
      const approvedBy = optionalString(params, "approvedBy") ?? "operator";

      const { resolveApproval, hasPendingApproval } =
        await import("../../infra/workflow-runner.js");

      const durable = await resolveDurableWorkflowApproval(sql, {
        runId,
        nodeId,
        approved: true,
        reason,
        approvedBy,
      });

      if (!hasPendingApproval(runId, nodeId)) {
        if (durable) {
          void resumeWorkflowRunAfterApproval({
            sql,
            runId,
            nodeId,
            triggerSource: "gateway:approval_resume",
            broadcast: context?.broadcast,
            outboundDeps: context?.deps ? createOutboundSendDeps(context.deps) : undefined,
          }).catch((err: unknown) => {
            log.warn(`workflow approval resume failed: ${String(err)}`);
            context?.broadcast?.("workflow.run.completed", {
              runId,
              workflowId: durable.workflow_id,
              status: "failed",
              error: String(err),
            });
          });
          context?.broadcast?.("workflow.approval.resolved", {
            approvalId: durable.id,
            runId,
            nodeId,
            approved: true,
            resumed: true,
          });
          respond(true, {
            ok: true,
            resumed: true,
            approvalId: durable.id,
            queued: true,
          });
          return;
        }
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "No pending approval for this run/node"),
        );
        return;
      }

      const resolved = resolveApproval(runId, nodeId, true, reason);
      if (!resolved) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Failed to resolve approval"),
        );
        return;
      }

      log.info(`workflow approval granted: runId=${runId} nodeId=${nodeId}`);

      if (context?.broadcast) {
        context.broadcast("workflow.approval.resolved", {
          approvalId: durable?.id,
          runId,
          nodeId,
          approved: true,
        });
      }

      respond(true, { ok: true, resumed: true, approvalId: durable?.id });
    } catch (err) {
      log.warn(`workflows.approve failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.deny": async ({ params, respond, context }) => {
    try {
      const sql = await getSql();
      const runId = requireString(params, "runId");
      const nodeId = requireString(params, "nodeId");
      const reason = optionalString(params, "reason") ?? "Denied by operator";
      const approvedBy = optionalString(params, "approvedBy") ?? "operator";

      const { resolveApproval, hasPendingApproval } =
        await import("../../infra/workflow-runner.js");

      const durable = await resolveDurableWorkflowApproval(sql, {
        runId,
        nodeId,
        approved: false,
        reason,
        approvedBy,
      });

      if (!hasPendingApproval(runId, nodeId)) {
        if (durable) {
          await sql`
            UPDATE workflow_runs SET status = 'failed', current_node_id = NULL,
              error = ${reason},
              ended_at = NOW()
            WHERE id = ${runId}
              AND status = 'waiting_approval'
          `;
          await sql`
            UPDATE workflow_step_runs SET
              approval_status = 'denied',
              approval_note = ${reason},
              ended_at = NOW(),
              status = 'failed'
            WHERE run_id = ${runId}
              AND node_id = ${nodeId}
              AND approval_status = 'pending'
          `;
          context?.broadcast?.("workflow.approval.resolved", {
            approvalId: durable.id,
            runId,
            nodeId,
            approved: false,
            denied: true,
            reason,
          });
          context?.broadcast?.("workflow.run.completed", {
            runId,
            workflowId: durable.workflow_id,
            status: "failed",
            error: reason,
          });
          respond(true, { ok: true, denied: true, reason, approvalId: durable.id });
          return;
        }
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "No pending approval for this run/node"),
        );
        return;
      }

      const resolved = resolveApproval(runId, nodeId, false, reason);
      if (!resolved) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Failed to resolve denial"),
        );
        return;
      }

      log.info(`workflow approval denied: runId=${runId} nodeId=${nodeId} reason="${reason}"`);

      if (context?.broadcast) {
        context.broadcast("workflow.approval.resolved", {
          approvalId: durable?.id,
          runId,
          nodeId,
          approved: false,
          reason,
        });
      }

      respond(true, { ok: true, denied: true, reason, approvalId: durable?.id });
    } catch (err) {
      log.warn(`workflows.deny failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "workflows.pendingApprovals": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const workflowId = optionalString(params, "workflowId");

      let rows;
      if (workflowId) {
        rows = await sql`
          SELECT a.*, r.status AS run_status, r.current_node_id
          FROM workflow_approvals a
          JOIN workflow_runs r ON r.id = a.run_id
          WHERE a.status = 'pending' AND a.workflow_id = ${workflowId}
          ORDER BY a.requested_at DESC
        `;
      } else {
        rows = await sql`
          SELECT a.*, r.status AS run_status, r.current_node_id
          FROM workflow_approvals a
          JOIN workflow_runs r ON r.id = a.run_id
          WHERE a.status = 'pending'
          ORDER BY a.requested_at DESC
        `;
      }

      respond(true, { approvals: rows });
    } catch (err) {
      log.warn(`workflows.pendingApprovals failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Credential Management ──────────────────────────────────────────────────

  "credentials.list": async ({ respond }) => {
    try {
      const sql = await getSql();
      const allKeys = await pgListServiceKeys(sql);
      // Filter to workflow credentials (category = "workflow-credential") and strip secret values
      const credentials = allKeys
        .filter((k) => k.category === "workflow-credential")
        .map((k) => ({
          id: k.id,
          name: k.name,
          type: k.service ?? "unknown",
          connectorId: k.source ?? undefined,
          createdAt: k.createdAt,
          updatedAt: k.updatedAt,
        }));
      respond(true, { credentials });
    } catch (err) {
      log.warn(`credentials.list failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "credentials.create": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const name = requireString(params, "name");
      const type = requireString(params, "type");
      const connectorId = requireString(params, "connectorId");
      const secrets = params.secrets;
      if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "secrets must be a non-null object"),
        );
        return;
      }

      // Store all secrets as a JSON blob encrypted in a single service key record
      const id = `wfcred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const variable = `WORKFLOW_CRED_${id}`;

      await pgUpsertServiceKey(sql, {
        id,
        variable,
        value: JSON.stringify(secrets),
        name,
        service: type,
        category: "workflow-credential",
        source: connectorId,
      });

      log.info(`credential created: ${id} "${name}" for connector ${connectorId}`);
      respond(true, { id, name, type, connectorId });
    } catch (err) {
      log.warn(`credentials.create failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "credentials.delete": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const credentialId = requireString(params, "credentialId");
      const variable = `WORKFLOW_CRED_${credentialId}`;

      // Check if credential is referenced by any active workflow node configs
      const usedBy = await sql`
        SELECT id, name FROM workflows
        WHERE is_active = true
          AND nodes::text LIKE ${`%${credentialId}%`}
      `;

      if (usedBy.length > 0) {
        const names = usedBy.map((w) => `"${w.name}"`).join(", ");
        log.warn(`credential ${credentialId} is used by active workflows: ${names}`);
        // Warn but still allow deletion — the caller can decide
        const deleted = await pgDeleteServiceKey(sql, variable);
        if (!deleted) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Credential not found"));
          return;
        }
        respond(true, {
          deleted: true,
          id: credentialId,
          warning: `Credential was used by active workflows: ${names}`,
        });
        return;
      }

      const deleted = await pgDeleteServiceKey(sql, variable);
      if (!deleted) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Credential not found"));
        return;
      }

      log.info(`credential deleted: ${credentialId}`);
      respond(true, { deleted: true, id: credentialId });
    } catch (err) {
      log.warn(`credentials.delete failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "credentials.validate": async ({ params, respond }) => {
    try {
      const sql = await getSql();
      const credentialId = requireString(params, "credentialId");
      const variable = `WORKFLOW_CRED_${credentialId}`;

      // Load credential
      const key = await pgGetServiceKeyByVariable(sql, variable);
      if (!key) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Credential not found"));
        return;
      }

      const connectorId = key.source;
      if (!connectorId) {
        respond(true, { valid: false, message: "Credential has no associated connector" });
        return;
      }

      // Find the connector binary
      const catalog = await discoverConnectorCatalog();
      const connector = catalog.connectors.find((c) => c.tool === connectorId);
      if (!connector?.discovery.binaryPath) {
        respond(true, {
          valid: false,
          message: `Connector "${connectorId}" not found or has no runnable binary`,
        });
        return;
      }

      // Parse stored secrets and inject into env for the health check
      let secretsEnv: Record<string, string> = {};
      try {
        const parsed = JSON.parse(key.value);
        if (parsed && typeof parsed === "object") {
          secretsEnv = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k, v as string]),
          );
        }
      } catch {
        respond(true, { valid: false, message: "Failed to parse stored credential secrets" });
        return;
      }

      // Run connector's health command with credential secrets in env
      const result = await runConnectorCommandJson({
        binaryPath: connector.discovery.binaryPath,
        args: ["--json", "health"],
        cwd: connector.discovery.harnessDir,
        timeoutMs: 8_000,
        env: secretsEnv,
      });

      if (result.ok) {
        const data =
          result.data && typeof result.data === "object"
            ? (result.data as Record<string, unknown>)
            : {};
        const status = typeof data.status === "string" ? data.status.toLowerCase() : "healthy";
        if (status === "healthy" || status === "ok") {
          respond(true, { valid: true, message: "Credential validated successfully" });
        } else {
          respond(true, { valid: false, message: `Connector health status: ${status}` });
        }
      } else {
        respond(true, { valid: false, message: result.detail || "Health check failed" });
      }
    } catch (err) {
      log.warn(`credentials.validate failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Connector Manifest ─────────────────────────────────────────────────────

  "workflows.manifest": async ({ params, respond }) => {
    try {
      const connectorId = requireString(params, "connectorId");

      // Search repo roots for the connector directory and read its connector.json
      const roots = defaultRepoRoots();
      let manifest: Record<string, unknown> | null = null;

      for (const root of roots) {
        const manifestPath = path.join(root, connectorId, "connector.json");
        if (fs.existsSync(manifestPath)) {
          try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<
              string,
              unknown
            >;
            break;
          } catch {
            // Try next root
          }
        }
      }

      if (!manifest) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `Connector manifest not found for "${connectorId}"`,
          ),
        );
        return;
      }

      // Step 1: Normalize raw manifest into ConnectorNodeDefinition
      const normalized = parseConnectorManifest(connectorId, manifest);

      // Step 2: Runtime readiness enrichment via health/doctor probes
      // Only probe harness-backed connectors (manifest-only stay blocked)
      if (normalized.status === "harness_backed") {
        try {
          const catalog = await discoverConnectorCatalog();
          const entry = catalog.connectors.find((c) => c.tool === connectorId);
          if (entry?.discovery.binaryPath) {
            const binaryPath = entry.discovery.binaryPath;

            // Run health and doctor in parallel (3s timeout each — fast probes)
            const [healthRes, doctorRes] = await Promise.allSettled([
              runConnectorCommandJson({
                binaryPath,
                args: ["health", "--json"],
                timeoutMs: 3000,
              }),
              runConnectorCommandJson({
                binaryPath,
                args: ["doctor", "--json"],
                timeoutMs: 3000,
              }),
            ]);

            const healthData =
              healthRes.status === "fulfilled" && healthRes.value.ok
                ? ((healthRes.value.envelope as HealthProbeResult | null) ??
                  (healthRes.value.data as HealthProbeResult | null))
                : null;

            const doctorData =
              doctorRes.status === "fulfilled" && doctorRes.value.ok
                ? ((doctorRes.value.envelope as DoctorProbeResult | null) ??
                  (doctorRes.value.data as DoctorProbeResult | null))
                : null;

            enrichWithHealthProbe(normalized, healthData, doctorData);
          }
        } catch (probeErr) {
          // Probe failure is non-fatal — manifest readiness stands
          log.debug(`Health probe failed for ${connectorId}: ${String(probeErr)}`);
        }
      }

      respond(true, normalized);
    } catch (err) {
      log.warn(`workflows.manifest failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Connector Command (DynamicPicker) ───────────────────────────────────────

  "workflows.connectorCommand": async ({ params, respond }) => {
    try {
      const connectorId = requireString(params, "connectorId");
      const command = requireString(params, "command");
      const credentialId = optionalString(params, "credentialId");
      const args = optionalArray(params, "args") ?? [];

      // Find the connector binary
      const catalog = await discoverConnectorCatalog();
      const connector = catalog.connectors.find((c) => c.tool === connectorId);
      if (!connector?.discovery.binaryPath) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `Connector "${connectorId}" not found or has no runnable binary`,
          ),
        );
        return;
      }

      // Resolve credential secrets if provided
      let secretsEnv: Record<string, string> = {};
      if (credentialId) {
        const sql = await getSql();
        const variable = `WORKFLOW_CRED_${credentialId}`;
        const key = await pgGetServiceKeyByVariable(sql, variable);
        if (!key) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, `Credential "${credentialId}" not found`),
          );
          return;
        }
        try {
          const parsed = JSON.parse(key.value);
          if (parsed && typeof parsed === "object") {
            secretsEnv = Object.fromEntries(
              Object.entries(parsed as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string")
                .map(([k, v]) => [k, v as string]),
            );
          }
        } catch {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "Failed to parse stored credential secrets"),
          );
          return;
        }
      }

      // Build CLI args: --json <resource> <operation> [extra args...]
      const cliArgs = ["--json", ...connectorCommandToCliArgs(command)];
      for (const arg of args) {
        const cliArg = connectorCommandExtraArgToCliArg(arg);
        if (cliArg !== undefined) {
          cliArgs.push(cliArg);
        }
      }

      // Execute connector command
      const result = await runConnectorCommandJson({
        binaryPath: connector.discovery.binaryPath,
        args: cliArgs,
        cwd: connector.discovery.harnessDir,
        timeoutMs: 15_000,
        env: secretsEnv,
      });

      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, result.detail || "Command failed"),
        );
        return;
      }

      // Return parsed data or raw output
      let data: unknown = null;
      if (result.data && typeof result.data === "object") {
        data = result.data;
      } else if (result.envelope && typeof result.envelope === "object") {
        data = result.envelope;
      } else if (typeof result.data === "string") {
        try {
          data = JSON.parse(result.data);
        } catch {
          data = { raw: result.data };
        }
      }

      respond(true, { connectorId, command, data });
    } catch (err) {
      log.warn(`workflows.connectorCommand failed: ${String(err)}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};

/** Expose the lazy PG connection for the workflow webhook HTTP handler. */
export function getWorkflowsSql(): Promise<ReturnType<typeof postgres>> {
  return getSql();
}
