/**
 * WorkflowsWidget — Visual Multi-Agent Pipeline Builder (Sprint 2)
 *
 * React Flow canvas for building multi-agent workflows with
 * five primitives: Trigger, Agent, Action, Gate, Output. Drag from the
 * sidebar palette onto the canvas, connect nodes, and configure
 * properties in the right dock panel.
 *
 * Sprint 2: Live canvas highlighting during runs, run history panel,
 * PG persistence via gateway CRUD (localStorage fallback).
 * Sprint 3: Error handling — retry badge on nodes, error display in
 * run history, retry-from-step support.
 */

import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type OnConnect,
  type NodeProps,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useState, useEffect, useCallback, useRef, useMemo, type DragEvent } from "react";
import "@xyflow/react/dist/style.css";
import { useGateway } from "../../hooks/useGateway";
import { ConnectorNodePanel } from "../workflows/ConnectorNodePanel";
import { CredentialSelector } from "../workflows/CredentialSelector";

// ── Types ───────────────────────────────────────────────────────────

interface FamilyMember {
  id: string;
  name: string;
  role?: string;
  team?: string;
  status?: string;
  alive?: boolean;
  color?: string;
}

type TriggerTypeValue =
  | "manual"
  | "schedule"
  | "webhook"
  | "form_submitted"
  | "record_created"
  | "record_updated"
  | "email_engaged"
  | "payment_received"
  | "appointment_booked"
  | "ticket_created"
  | "channel_message"
  | "email_received"
  | "task_completed"
  | "workflow_done"
  | "agent_event"
  | "timer_elapsed"
  | "appforge_event";

interface TriggerNodeData {
  label: string;
  triggerType: TriggerTypeValue;
  cronExpression: string;
  execState?: NodeExecState;
  retryCount?: number;
  /** Connector ID for service-connected triggers */
  connectorId?: string;
  /** Credential for authenticating with the trigger service */
  credentialId?: string;
  [key: string]: unknown;
}

interface AgentStepNodeData {
  label: string;
  agentId: string;
  agentName: string;
  agentColor: string;
  rolePrompt: string;
  timeout: number;
  evidenceRequired: boolean;
  execState?: NodeExecState;
  retryCount?: number;
  [key: string]: unknown;
}

interface OutputNodeData {
  label: string;
  target:
    | "doc_panel"
    | "channel"
    | "discord"
    | "telegram"
    | "email"
    | "webhook"
    | "variable"
    | "knowledge"
    | "task_update"
    | "next_workflow"
    | "connector_action";
  format: string;
  execState?: NodeExecState;
  retryCount?: number;
  [key: string]: unknown;
}

type ActionTypeValue =
  | "connector_action"
  | "send_message"
  | "send_email"
  | "save_to_docpanel"
  | "webhook_call"
  | "api_call"
  | "run_script"
  | "create_task"
  | "store_memory"
  | "store_knowledge"
  | "generate_image"
  | "generate_audio";

interface ActionNodeData {
  label: string;
  actionType: ActionTypeValue;
  config: Record<string, unknown>;
  timeoutMs: number;
  execState?: NodeExecState;
  retryCount?: number;
  [key: string]: unknown;
}

type GateTypeValue =
  | "condition"
  | "switch"
  | "parallel"
  | "join"
  | "wait_duration"
  | "wait_event"
  | "loop"
  | "error_handler"
  | "sub_workflow"
  | "approval";

interface GateNodeData {
  label: string;
  gateType: GateTypeValue;
  /** For condition gates: simple field/operator/value */
  conditionField: string;
  conditionOperator: string;
  conditionValue: string;
  /** For parallel/switch: number of output branches */
  branchCount: number;
  /** For loop: max iterations */
  maxIterations: number;
  /** For wait_duration: ms */
  durationMs: number;
  /** For approval gate */
  approvalMessage: string;
  showPreviousOutput: boolean;
  timeoutMinutes: number;
  timeoutAction: "deny" | "approve";
  execState?: NodeExecState;
  retryCount?: number;
  [key: string]: unknown;
}

interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  createdAt: string;
  updatedAt: string;
  version?: number;
  isActive?: boolean;
  runCount?: number;
  triggerType?: string;
  triggerConfig?: Record<string, unknown>;
  definition?: unknown;
  canvasLayout?: { nodes?: Node[]; edges?: Edge[]; [key: string]: unknown };
  validation?: { ok: boolean; issues?: unknown[] };
  importReport?: WorkflowImportReport;
}

interface WorkflowVersionRecord {
  id: string;
  workflowId: string;
  version: number;
  changedBy?: string;
  changeSummary?: string;
  createdAt?: string;
  nodeCount: number;
  edgeCount: number;
}

interface WorkflowValidationIssue {
  severity: "error" | "warning";
  code?: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

interface WorkflowImportReport {
  packageName: string;
  packageSlug?: string;
  okForImport: boolean;
  okForPinnedTestRun: boolean;
  liveRequirements: string[];
  blockers: WorkflowValidationIssue[];
  requirements: WorkflowBindingRequirement[];
  bindings?: Record<string, WorkflowBindingValue>;
}

type WorkflowDeploymentStage = "simulate" | "shadow" | "limited_live" | "live";

type WorkflowBindingRequirementKind =
  | "credential"
  | "connector"
  | "channel"
  | "appforge_base"
  | "knowledge_collection"
  | "agent";

interface WorkflowBindingRequirement {
  key: string;
  kind: WorkflowBindingRequirementKind;
  id: string;
  label: string;
  provider?: string;
  purpose?: string;
  requiredForLive: boolean;
}

interface WorkflowBindingValue {
  value: string;
  target?: string;
  label?: string;
}

interface AppForgeBasePickerOption {
  id: string;
  name: string;
  appId?: string;
  revision?: number;
  activeTableId?: string;
  tableCount?: number;
  tables?: AppForgeTablePickerOption[];
}

interface AppForgeTablePickerOption {
  id: string;
  name: string;
  revision?: number;
  fieldCount?: number;
  recordCount?: number;
  fields?: Array<{ id?: string; name?: string; type?: string }>;
}

interface WorkflowImportPreviewResponse {
  package?: unknown;
  workflow?: unknown;
  canvasLayout?: { nodes?: unknown[]; edges?: unknown[]; [key: string]: unknown };
  readiness?: {
    okForImport?: boolean;
    okForPinnedTestRun?: boolean;
    liveRequirements?: unknown[];
    blockers?: unknown[];
  };
  validation?: { ok?: boolean; issues?: unknown[] };
}

interface WorkflowPackageTemplateSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  scenario?: {
    audience?: string;
    department?: string;
    runPattern?: string;
    summary?: string;
    appForgeTables?: string[];
  };
  credentialCount?: number;
  dependencyCount?: number;
  nodeCount?: number;
  okForImport?: boolean;
  okForPinnedTestRun?: boolean;
  liveRequirements?: string[];
}

interface WorkflowCronJob {
  id: string;
  name?: string;
  enabled?: boolean;
  payload?: {
    kind?: string;
    workflowId?: string;
  };
}

function normalizeValidationIssue(raw: unknown): WorkflowValidationIssue | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const issue = raw as Record<string, unknown>;
  const severity = issue.severity === "warning" ? "warning" : "error";
  const message = typeof issue.message === "string" ? issue.message : "";
  if (!message) {
    return null;
  }
  return {
    severity,
    code: typeof issue.code === "string" ? issue.code : undefined,
    message,
    nodeId: typeof issue.nodeId === "string" ? issue.nodeId : undefined,
    edgeId: typeof issue.edgeId === "string" ? issue.edgeId : undefined,
  };
}

function normalizeValidationIssues(raw: unknown): WorkflowValidationIssue[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((issue) => normalizeValidationIssue(issue))
    .filter((issue): issue is WorkflowValidationIssue => Boolean(issue));
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => isRecord(entry))
    : [];
}

function safeJson(value: unknown, fallback = "{}"): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return fallback;
  }
}

function compactWorkflowId(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function importedNodeType(node: Record<string, unknown>): string {
  const kind = stringValue(node.kind);
  if (kind === "agent") {
    return "agentStep";
  }
  if (kind === "gate") {
    const config = isRecord(node.config) ? node.config : {};
    const gateType = stringValue(config.gateType);
    return gateType === "approval" ? "approval" : gateType || "gate";
  }
  return kind || "action";
}

function importedNodeLabel(node: Record<string, unknown>): string {
  const config = isRecord(node.config) ? node.config : {};
  return stringValue(node.label ?? config.title ?? config.subject, stringValue(node.id, "Node"));
}

function importedNodeData(node: Record<string, unknown>): Record<string, unknown> {
  const kind = stringValue(node.kind);
  const config = isRecord(node.config) ? node.config : {};
  const label = importedNodeLabel(node);
  if (kind === "trigger") {
    return {
      ...createDefaultTriggerData(),
      ...config,
      label,
      triggerType: stringValue(node.triggerType ?? config.triggerType, "manual"),
      cronExpression: stringValue(config.cronExpr ?? config.cronExpression),
    };
  }
  if (kind === "agent") {
    return {
      ...createDefaultAgentStepData(),
      label,
      agentId: stringValue(config.agentId, "argent"),
      agentName: stringValue(config.agentName ?? config.agentId, "Argent"),
      rolePrompt: stringValue(config.rolePrompt, "Complete this workflow step."),
      timeout: Math.max(1, Math.round(numberValue(config.timeoutMs, 300_000) / 60_000)),
      evidenceRequired: Boolean(config.evidenceRequired),
      toolsAllow: stringArray(config.toolsAllow),
      toolsDeny: stringArray(config.toolsDeny),
      modelTier: stringValue(config.modelTierHint),
    };
  }
  if (kind === "action") {
    const actionType = isRecord(config.actionType) ? config.actionType : {};
    return {
      ...createDefaultActionData(),
      label,
      actionType: stringValue(actionType.type, "api_call"),
      timeoutMs: numberValue(config.timeoutMs, 30_000),
      config: {
        ...actionType,
        ...(isRecord(actionType.parameters) ? actionType.parameters : {}),
        parametersJson: safeJson(actionType.parameters),
      },
    };
  }
  if (kind === "gate") {
    const gateType = stringValue(config.gateType, "condition");
    const expression = isRecord(config.expression) ? config.expression : {};
    return {
      ...createDefaultGateData(),
      ...config,
      label,
      gateType,
      conditionField: stringValue(expression.field, ""),
      conditionOperator: stringValue(expression.operator, "=="),
      conditionValue:
        expression.value === undefined || expression.value === null ? "" : String(expression.value),
      approvalMessage: stringValue(config.message ?? config.approvalMessage),
      timeoutMinutes: Math.max(0, Math.round(numberValue(config.timeoutMs, 0) / 60_000)),
    };
  }
  if (kind === "output") {
    const outputType = stringValue(config.outputType, "docpanel");
    const target = outputType === "docpanel" ? "doc_panel" : outputType;
    return {
      ...createDefaultOutputData(),
      ...config,
      label,
      target,
      format: stringValue(config.format, "markdown"),
      title: stringValue(config.title, label),
      recipient: stringValue(config.to),
      webhookUrl: stringValue(config.url),
      parametersJson: safeJson(config.parameters, '{\n  "text": "{{previous.text}}"\n}'),
      parameters: safeJson(config.parameters, '{\n  "text": "{{previous.text}}"\n}'),
    };
  }
  return { label };
}

function importedCanvasNodes(workflow: unknown, canvasLayout: unknown): Node[] {
  const workflowRecord = isRecord(workflow) ? workflow : {};
  const layout = isRecord(canvasLayout) ? canvasLayout : {};
  const layoutById = new Map(
    objectArray(layout.nodes).map((node) => [stringValue(node.id), node] as const),
  );
  return objectArray(workflowRecord.nodes).map((node, index) => {
    const id = stringValue(node.id, `node-${index + 1}`);
    const layoutNode = layoutById.get(id) ?? {};
    const position = isRecord(layoutNode.position)
      ? {
          x: numberValue(layoutNode.position.x, 140 + index * 320),
          y: numberValue(layoutNode.position.y, 140),
        }
      : { x: 140 + (index % 4) * 320, y: 140 + Math.floor(index / 4) * 220 };
    return {
      id,
      type: stringValue(layoutNode.type, importedNodeType(node)),
      position,
      data: {
        ...(isRecord(layoutNode.data) ? layoutNode.data : {}),
        ...importedNodeData(node),
      },
    };
  });
}

function importedCanvasEdges(workflow: unknown, canvasLayout: unknown): Edge[] {
  const workflowRecord = isRecord(workflow) ? workflow : {};
  const layout = isRecord(canvasLayout) ? canvasLayout : {};
  const sourceEdges = objectArray(layout.edges).length
    ? objectArray(layout.edges)
    : objectArray(workflowRecord.edges);
  return sourceEdges.map((edge, index) => {
    const source = stringValue(edge.source);
    const target = stringValue(edge.target);
    return {
      id: stringValue(edge.id, source && target ? `${source}->${target}` : `edge-${index + 1}`),
      source,
      target,
      sourceHandle: typeof edge.sourceHandle === "string" ? edge.sourceHandle : undefined,
      targetHandle: typeof edge.targetHandle === "string" ? edge.targetHandle : undefined,
    };
  });
}

function placeholderIds(value: unknown, prefix: string): string[] {
  let text = "";
  try {
    text = JSON.stringify(value);
  } catch {
    return [];
  }
  const ids = new Set<string>();
  const pattern = new RegExp(`\\{\\{${prefix}\\.([a-zA-Z0-9_-]+)(?:\\.[^}]*)?\\}\\}`, "g");
  for (const match of text.matchAll(pattern)) {
    if (match[1]) {
      ids.add(match[1]);
    }
  }
  return [...ids];
}

function importReportFromPreview(response: WorkflowImportPreviewResponse): WorkflowImportReport {
  const pkg = isRecord(response.package) ? response.package : {};
  const readiness = response.readiness ?? {};
  const credentials = isRecord(pkg.credentials) ? objectArray(pkg.credentials.required) : [];
  const dependencies = objectArray(pkg.dependencies);
  const dependencyKeys = new Set(
    dependencies.map(
      (dependency) => `${stringValue(dependency.kind)}:${stringValue(dependency.id)}`,
    ),
  );
  const derivedChannelDependencies = placeholderIds(pkg, "channels").map((id) => ({
    kind: "channel",
    id,
    label: `${id[0]?.toUpperCase() ?? ""}${id.slice(1)} channel`,
    requiredForLive: true,
  }));
  const requirements: WorkflowBindingRequirement[] = [
    ...credentials.map((credential) => ({
      key: `credential:${stringValue(credential.id)}`,
      kind: "credential" as const,
      id: stringValue(credential.id),
      label: stringValue(credential.label, stringValue(credential.id, "Credential")),
      provider: stringValue(credential.provider) || undefined,
      purpose: stringValue(credential.purpose) || undefined,
      requiredForLive: credential.requiredForLive !== false,
    })),
    ...[...dependencies, ...derivedChannelDependencies]
      .map((dependency) => {
        const kind = stringValue(dependency.kind) as WorkflowBindingRequirementKind;
        if (
          !["connector", "channel", "appforge_base", "knowledge_collection", "agent"].includes(kind)
        ) {
          return null;
        }
        if (kind === "channel" && dependencyKeys.has(`channel:${stringValue(dependency.id)}`)) {
          return null;
        }
        return {
          key: `${kind}:${stringValue(dependency.id)}`,
          kind,
          id: stringValue(dependency.id),
          label: stringValue(dependency.label, stringValue(dependency.id, kind)),
          requiredForLive: dependency.requiredForLive !== false,
        } satisfies WorkflowBindingRequirement;
      })
      .filter((requirement): requirement is WorkflowBindingRequirement => Boolean(requirement)),
  ].filter((requirement) => Boolean(requirement.id));
  return {
    packageName: stringValue(pkg.name, "Imported workflow"),
    packageSlug: stringValue(pkg.slug) || undefined,
    okForImport: readiness.okForImport !== false,
    okForPinnedTestRun: readiness.okForPinnedTestRun !== false,
    liveRequirements: Array.isArray(readiness.liveRequirements)
      ? readiness.liveRequirements.map((entry) => String(entry))
      : [],
    blockers: normalizeValidationIssues(readiness.blockers),
    requirements,
  };
}

function workflowFromImportPreview(response: WorkflowImportPreviewResponse): WorkflowDefinition {
  const pkg = isRecord(response.package) ? response.package : {};
  const workflow = isRecord(response.workflow) ? response.workflow : {};
  const id = stringValue(workflow.id, `wf-import-${Date.now()}`);
  const nodes = importedCanvasNodes(workflow, response.canvasLayout);
  const edges = importedCanvasEdges(workflow, response.canvasLayout);
  const readiness = response.readiness ?? {};
  const existingStage = stringValue(workflow.deploymentStage);
  const deploymentStage =
    existingStage === "simulate" ||
    existingStage === "shadow" ||
    existingStage === "limited_live" ||
    existingStage === "live"
      ? existingStage
      : readiness.okForPinnedTestRun !== false
        ? "simulate"
        : undefined;
  const definition = deploymentStage ? { ...workflow, deploymentStage } : workflow;
  return {
    id,
    name: `${stringValue(workflow.name ?? pkg.name, "Imported workflow")} (imported)`,
    nodes,
    edges,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    definition,
    canvasLayout: { ...(response.canvasLayout ?? {}), nodes, edges },
    validation: response.validation
      ? { ok: response.validation.ok !== false, issues: response.validation.issues }
      : undefined,
    importReport: importReportFromPreview(response),
  };
}

function workflowDeploymentStage(workflow: WorkflowDefinition | null): WorkflowDeploymentStage {
  const definition = isRecord(workflow?.definition) ? workflow.definition : {};
  const stage = stringValue(definition.deploymentStage);
  return stage === "simulate" || stage === "shadow" || stage === "limited_live" || stage === "live"
    ? stage
    : "live";
}

function withWorkflowDeploymentStage(
  workflow: WorkflowDefinition,
  stage: WorkflowDeploymentStage,
): WorkflowDefinition {
  const definition = isRecord(workflow.definition) ? workflow.definition : {};
  return {
    ...workflow,
    definition: { ...definition, deploymentStage: stage },
    updatedAt: new Date().toISOString(),
  };
}

function legacyWorkflowFromJson(text: string): WorkflowDefinition {
  const data = JSON.parse(text) as unknown;
  if (!isRecord(data) || data.format !== "argent-workflow") {
    throw new Error("Invalid workflow file format");
  }
  const workflow = isRecord(data.workflow) ? data.workflow : {};
  const layout = isRecord(workflow.canvasLayout) ? workflow.canvasLayout : {};
  const nodes = objectArray(layout.nodes).length
    ? (objectArray(layout.nodes) as unknown as Node[])
    : (objectArray(workflow.nodes) as unknown as Node[]);
  const edges = objectArray(layout.edges).length
    ? (objectArray(layout.edges) as unknown as Edge[])
    : (objectArray(workflow.edges) as unknown as Edge[]);
  return {
    id: `wf-${Date.now()}`,
    name: `${stringValue(workflow.name, "Imported workflow")} (imported)`,
    nodes,
    edges,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    definition: workflow.definition,
    canvasLayout: workflow.canvasLayout as WorkflowDefinition["canvasLayout"],
  };
}

// ── Run History Types ────────────────────────────────────────────────

type RunStatus =
  | "created"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_approval"
  | "waiting_event"
  | "waiting_duration";
type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

interface RunStepRecord {
  id?: string;
  nodeId: string;
  nodeName: string;
  nodeKind?: string;
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs: number;
  error?: string;
  tokensUsed?: number;
  costUsd?: number;
  retryCount?: number;
  approvalStatus?: string;
  approvalNote?: string;
  input?: unknown;
  output?: unknown;
}

interface RunRecord {
  id?: string;
  runId: string;
  workflowId: string;
  workflowName?: string;
  workflowVersion?: number;
  status: RunStatus;
  triggerType?: string;
  triggerPayload?: unknown;
  currentNodeId?: string;
  startedAt: string;
  endedAt?: string;
  finishedAt?: string;
  durationMs: number;
  totalTokensUsed?: number;
  totalCostUsd?: number;
  error?: string;
  steps: RunStepRecord[];
  approvals?: Array<{
    approvalId: string;
    nodeId: string;
    nodeLabel?: string;
    message: string;
    status: string;
    sideEffectClass?: string;
    requestedAt?: string;
    resolvedAt?: string;
    notificationStatus?: string;
  }>;
  timeline?: Array<{
    at?: string;
    type?: string;
    nodeId?: string;
    label?: string;
    status?: string;
    error?: string;
    note?: string;
  }>;
}

// ── Node Execution State (for highlighting) ─────────────────────────

type NodeExecState = "active" | "completed" | "failed" | "pending" | "waiting";

// ── Agent Filtering ─────────────────────────────────────────────────

const EXCLUDED_IDS = new Set(["main", "dumbo", "argent"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

function isOperational(a: { id: string; role?: string }): boolean {
  if (EXCLUDED_IDS.has(a.id.toLowerCase())) return false;
  if (a.id.startsWith("test-") || a.id.startsWith("test_")) return false;
  if (UUID_RE.test(a.id)) return false;
  if (a.role === "think_tank_panelist") return false;
  if (!a.role) return false;
  return true;
}

// ── Storage (localStorage fallback) ─────────────────────────────────

const STORAGE_KEY = "argent-workflows";

function loadWorkflowsLocal(): WorkflowDefinition[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(raw)
      ? raw
          .map((workflow) => normalizeWorkflowDefinition(workflow))
          .filter((workflow): workflow is WorkflowDefinition => Boolean(workflow))
      : [];
  } catch {
    return [];
  }
}

function saveWorkflowsLocal(workflows: WorkflowDefinition[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
  } catch {
    // QuotaExceededError — localStorage is full. Clear stale data and retry once.
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
    } catch {
      // Still full — silently fail. PG is the primary store anyway.
      console.warn("[Workflows] localStorage quota exceeded, using PG only");
    }
  }
}

function timestampString(value: unknown, fallback = new Date().toISOString()): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return fallback;
}

function normalizeWorkflowDefinition(raw: unknown): WorkflowDefinition | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const name = typeof row.name === "string" && row.name.trim() ? row.name : "Untitled workflow";
  if (!id) {
    return null;
  }
  const canvasLayout = isRecord(row.canvasLayout)
    ? row.canvasLayout
    : isRecord(row.canvas_layout)
      ? row.canvas_layout
      : undefined;
  const nodes = Array.isArray(row.nodes)
    ? (row.nodes as Node[])
    : Array.isArray(canvasLayout?.nodes)
      ? (canvasLayout.nodes as Node[])
      : [];
  const edges = Array.isArray(row.edges)
    ? (row.edges as Edge[])
    : Array.isArray(canvasLayout?.edges)
      ? (canvasLayout.edges as Edge[])
      : [];
  const runCount =
    typeof row.runCount === "number"
      ? row.runCount
      : typeof row.run_count === "number"
        ? row.run_count
        : Number(row.run_count ?? 0);
  const version =
    typeof row.version === "number"
      ? row.version
      : Number.isFinite(Number(row.version))
        ? Number(row.version)
        : 1;
  return {
    ...(row as Partial<WorkflowDefinition>),
    id,
    name,
    nodes,
    edges,
    createdAt: timestampString(row.createdAt ?? row.created_at),
    updatedAt: timestampString(row.updatedAt ?? row.updated_at),
    version,
    isActive: typeof row.isActive === "boolean" ? row.isActive : row.is_active !== false,
    runCount: Number.isFinite(runCount) ? runCount : 0,
    triggerType:
      typeof row.triggerType === "string"
        ? row.triggerType
        : typeof row.trigger_type === "string"
          ? row.trigger_type
          : undefined,
    triggerConfig: isRecord(row.triggerConfig)
      ? row.triggerConfig
      : isRecord(row.trigger_config)
        ? row.trigger_config
        : undefined,
    canvasLayout: canvasLayout as WorkflowDefinition["canvasLayout"],
  };
}

function normalizeWorkflowVersions(raw: unknown): WorkflowVersionRecord[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : "";
      const workflowId = typeof row.workflowId === "string" ? row.workflowId : "";
      const version = typeof row.version === "number" ? row.version : Number(row.version ?? 0);
      if (!id || !workflowId || !Number.isFinite(version)) {
        return null;
      }
      return {
        id,
        workflowId,
        version,
        changedBy: typeof row.changedBy === "string" ? row.changedBy : undefined,
        changeSummary: typeof row.changeSummary === "string" ? row.changeSummary : undefined,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
        nodeCount: typeof row.nodeCount === "number" ? row.nodeCount : 0,
        edgeCount: typeof row.edgeCount === "number" ? row.edgeCount : 0,
      };
    })
    .filter((entry): entry is WorkflowVersionRecord => Boolean(entry));
}

// ── CSS Keyframes (injected once) ───────────────────────────────────

let stylesInjected = false;
function injectWorkflowStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes wf-pulse-active {
      0%   { box-shadow: 0 0 4px #00aaff; }
      50%  { box-shadow: 0 0 14px #00aaff; }
      100% { box-shadow: 0 0 4px #00aaff; }
    }
    @keyframes wf-pulse-waiting {
      0%   { box-shadow: 0 0 4px #f59e0b; }
      50%  { box-shadow: 0 0 14px #f59e0b; }
      100% { box-shadow: 0 0 4px #f59e0b; }
    }
    .wf-node-active  { animation: wf-pulse-active 1.2s ease-in-out infinite; border-color: #00aaff !important; }
    .wf-node-waiting { animation: wf-pulse-waiting 1.5s ease-in-out infinite; border-color: #f59e0b !important; }
    .wf-node-completed { border-color: #00ffcc !important; }
    .wf-node-failed    { border-color: #ff3d57 !important; }
    .workflow-canvas .react-flow__node-output {
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
      padding: 0 !important;
      width: auto !important;
    }
    /* Dark theme overrides for React Flow controls */
    .react-flow__controls button { background: hsl(var(--card)); color: hsl(var(--foreground)); border-color: hsl(var(--border)); fill: hsl(var(--foreground)); }
    .react-flow__controls button:hover { background: hsl(var(--muted)); }
    .react-flow__controls button svg { fill: hsl(var(--foreground)); }
  `;
  document.head.appendChild(style);
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatShortDate(value?: string): string {
  if (!value) {
    return "unsaved";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unsaved";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatWorkflowDetailDate(value?: string): string {
  if (!value) {
    return "Not saved yet";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not saved yet";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getStringField(source: unknown, keys: string[]): string | undefined {
  if (!isRecord(source)) {
    return undefined;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function workflowDescription(workflow: WorkflowDefinition): string {
  return (
    getStringField(workflow.definition, ["description", "summary", "intent"]) ??
    getStringField(workflow.canvasLayout, ["description", "summary", "intent"]) ??
    "No description stored yet."
  );
}

function workflowCategory(workflow: WorkflowDefinition): string {
  return (
    getStringField(workflow.definition, ["category", "lane", "domain"]) ??
    getStringField(workflow.importReport, ["packageSlug", "packageName"]) ??
    "Uncategorized"
  );
}

function workflowClass(workflow: WorkflowDefinition): string {
  return (
    getStringField(workflow.definition, ["class", "workflowClass", "kind", "type"]) ??
    getStringField(workflow.triggerConfig, ["class", "workflowClass"]) ??
    "Not set"
  );
}

function workflowState(
  workflow: WorkflowDefinition,
  runs: RunRecord[],
): "running" | "active" | "paused" {
  const running = runs.some(
    (run) =>
      run.workflowId === workflow.id &&
      ["running", "waiting_approval", "waiting_event", "waiting_duration"].includes(run.status),
  );
  if (running) {
    return "running";
  }
  return workflow.isActive === false ? "paused" : "active";
}

function normalizeRunStepRecord(raw: unknown): RunStepRecord | null {
  if (!isRecord(raw)) {
    return null;
  }
  const nodeId =
    typeof raw.nodeId === "string"
      ? raw.nodeId
      : typeof raw.node_id === "string"
        ? raw.node_id
        : undefined;
  if (!nodeId) {
    return null;
  }
  const durationMs =
    typeof raw.durationMs === "number"
      ? raw.durationMs
      : typeof raw.duration_ms === "number"
        ? raw.duration_ms
        : 0;
  return {
    id: typeof raw.id === "string" ? raw.id : undefined,
    nodeId,
    nodeName:
      typeof raw.nodeName === "string"
        ? raw.nodeName
        : typeof raw.node_name === "string"
          ? raw.node_name
          : nodeId,
    nodeKind:
      typeof raw.nodeKind === "string"
        ? raw.nodeKind
        : typeof raw.node_kind === "string"
          ? raw.node_kind
          : undefined,
    status: String(raw.status ?? "pending") as StepStatus,
    startedAt:
      typeof raw.startedAt === "string"
        ? raw.startedAt
        : typeof raw.started_at === "string"
          ? raw.started_at
          : undefined,
    endedAt:
      typeof raw.endedAt === "string"
        ? raw.endedAt
        : typeof raw.ended_at === "string"
          ? raw.ended_at
          : undefined,
    durationMs,
    error: typeof raw.error === "string" ? raw.error : undefined,
    tokensUsed:
      typeof raw.tokensUsed === "number"
        ? raw.tokensUsed
        : typeof raw.tokens_used === "number"
          ? raw.tokens_used
          : undefined,
    costUsd:
      typeof raw.costUsd === "number"
        ? raw.costUsd
        : typeof raw.cost_usd === "number"
          ? raw.cost_usd
          : undefined,
    retryCount:
      typeof raw.retryCount === "number"
        ? raw.retryCount
        : typeof raw.retry_count === "number"
          ? raw.retry_count
          : undefined,
    approvalStatus:
      typeof raw.approvalStatus === "string"
        ? raw.approvalStatus
        : typeof raw.approval_status === "string"
          ? raw.approval_status
          : undefined,
    approvalNote:
      typeof raw.approvalNote === "string"
        ? raw.approvalNote
        : typeof raw.approval_note === "string"
          ? raw.approval_note
          : undefined,
    input: raw.input ?? raw.input_context,
    output: raw.output ?? raw.output_items,
  };
}

function normalizeRunRecord(raw: unknown): RunRecord | null {
  if (!isRecord(raw)) {
    return null;
  }
  const runId =
    typeof raw.runId === "string" ? raw.runId : typeof raw.id === "string" ? raw.id : undefined;
  const workflowId =
    typeof raw.workflowId === "string"
      ? raw.workflowId
      : typeof raw.workflow_id === "string"
        ? raw.workflow_id
        : undefined;
  if (!runId || !workflowId) {
    return null;
  }
  return {
    id: typeof raw.id === "string" ? raw.id : runId,
    runId,
    workflowId,
    workflowName:
      typeof raw.workflowName === "string"
        ? raw.workflowName
        : typeof raw.workflow_name === "string"
          ? raw.workflow_name
          : undefined,
    workflowVersion:
      typeof raw.workflowVersion === "number"
        ? raw.workflowVersion
        : typeof raw.workflow_version === "number"
          ? raw.workflow_version
          : undefined,
    status: String(raw.status ?? "created") as RunStatus,
    triggerType:
      typeof raw.triggerType === "string"
        ? raw.triggerType
        : typeof raw.trigger_type === "string"
          ? raw.trigger_type
          : undefined,
    triggerPayload: raw.triggerPayload ?? raw.trigger_payload,
    currentNodeId:
      typeof raw.currentNodeId === "string"
        ? raw.currentNodeId
        : typeof raw.current_node_id === "string"
          ? raw.current_node_id
          : undefined,
    startedAt:
      typeof raw.startedAt === "string"
        ? raw.startedAt
        : typeof raw.started_at === "string"
          ? raw.started_at
          : "",
    endedAt:
      typeof raw.endedAt === "string"
        ? raw.endedAt
        : typeof raw.ended_at === "string"
          ? raw.ended_at
          : undefined,
    finishedAt:
      typeof raw.finishedAt === "string"
        ? raw.finishedAt
        : typeof raw.ended_at === "string"
          ? raw.ended_at
          : undefined,
    durationMs:
      typeof raw.durationMs === "number"
        ? raw.durationMs
        : typeof raw.duration_ms === "number"
          ? raw.duration_ms
          : 0,
    totalTokensUsed:
      typeof raw.totalTokensUsed === "number"
        ? raw.totalTokensUsed
        : typeof raw.total_tokens_used === "number"
          ? raw.total_tokens_used
          : undefined,
    totalCostUsd:
      typeof raw.totalCostUsd === "number"
        ? raw.totalCostUsd
        : typeof raw.total_cost_usd === "number"
          ? raw.total_cost_usd
          : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
    steps: Array.isArray(raw.steps)
      ? raw.steps
          .map((step) => normalizeRunStepRecord(step))
          .filter((step): step is RunStepRecord => Boolean(step))
      : [],
    approvals: Array.isArray(raw.approvals) ? (raw.approvals as RunRecord["approvals"]) : undefined,
    timeline: Array.isArray(raw.timeline) ? (raw.timeline as RunRecord["timeline"]) : undefined,
  };
}

function normalizeRunRecords(raw: unknown[] | undefined): RunRecord[] {
  return (raw ?? [])
    .map((run) => normalizeRunRecord(run))
    .filter((run): run is RunRecord => Boolean(run));
}

// ── Exec State Helpers ──────────────────────────────────────────────

function execStateClass(state?: NodeExecState): string {
  if (state === "active") return "wf-node-active";
  if (state === "waiting") return "wf-node-waiting";
  if (state === "completed") return "wf-node-completed";
  if (state === "failed") return "wf-node-failed";
  return "";
}

function stripExecState(data: Node["data"] | undefined): Record<string, unknown> {
  const cleanData = { ...((data ?? {}) as Record<string, unknown>) };
  delete cleanData.execState;
  delete cleanData.validationIssues;
  return cleanData;
}

function ExecOverlay({ state }: { state?: NodeExecState }) {
  if (state === "completed") {
    return (
      <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#00ffcc] flex items-center justify-center text-[8px] text-black font-bold z-20">
        &#10003;
      </div>
    );
  }
  if (state === "failed") {
    return (
      <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#ff3d57] flex items-center justify-center text-[8px] text-white font-bold z-20">
        &#10005;
      </div>
    );
  }
  if (state === "waiting") {
    return (
      <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-[8px] text-black font-bold z-20 animate-pulse">
        &#9208;
      </div>
    );
  }
  return null;
}

function PinnedDataBadge({ active }: { active?: boolean }) {
  if (!active) {
    return null;
  }
  return (
    <div className="absolute -top-1.5 left-2 rounded-full border border-cyan-400/40 bg-cyan-400/15 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-cyan-200">
      Pinned
    </div>
  );
}

function RetryBadge({ retryCount }: { retryCount?: number }) {
  if (!retryCount || retryCount <= 0) return null;
  return (
    <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 rounded-full text-[8px] text-black font-bold flex items-center justify-center z-20">
      {retryCount}
    </div>
  );
}

function NodeIssueBadge({ issues }: { issues?: WorkflowValidationIssue[] }) {
  if (!issues?.length) return null;
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const isError = errorCount > 0;
  const count = isError ? errorCount : issues.length;
  return (
    <div
      className={`absolute -top-1.5 -left-1.5 min-w-4 h-4 px-1 rounded-full flex items-center justify-center text-[8px] font-bold z-20 ${
        isError ? "bg-red-500 text-white" : "bg-amber-500 text-black"
      }`}
      title={issues.map((issue) => issue.message).join("\n")}
    >
      {count}
    </div>
  );
}

// ── HelpTip Component ───────────────────────────────────────────────

function HelpTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="w-4 h-4 rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] text-[10px] flex items-center justify-center hover:bg-[hsl(var(--primary))]/20 hover:text-[hsl(var(--primary))] transition-colors cursor-help"
      >
        ?
      </button>
      {show && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 w-56 p-2.5 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-lg text-[11px] text-[hsl(var(--foreground))] leading-relaxed">
          {text}
        </div>
      )}
    </span>
  );
}

// ── Tool Picker Component ───────────────────────────────────────────

const AVAILABLE_TOOLS: readonly ToolPaletteEntry[] = [
  { id: "web_search", name: "Web Search", desc: "Search the internet", category: "Research" },
  {
    id: "web_fetch",
    name: "Read Web Pages",
    desc: "Read and extract content from URLs",
    category: "Research",
  },
  {
    id: "memory_store",
    name: "Save to Memory",
    desc: "Remember facts for later",
    category: "Memory",
  },
  {
    id: "memory_recall",
    name: "Recall Memory",
    desc: "Look up saved information",
    category: "Memory",
  },
  {
    id: "doc_panel",
    name: "Create Document",
    desc: "Write to the document panel",
    category: "Documents",
  },
  {
    id: "tasks",
    name: "Manage Tasks",
    desc: "Create, update, or complete tasks",
    category: "Tasks",
  },
  {
    id: "message",
    name: "Send Message",
    desc: "Post to Discord, Slack, etc.",
    category: "Communication",
  },
  {
    id: "image_generation",
    name: "Generate Images",
    desc: "Create images with AI",
    category: "Media",
  },
  { id: "tts", name: "Text to Speech", desc: "Generate audio from text", category: "Media" },
  {
    id: "family",
    name: "Family Agents",
    desc: "Communicate with other agents",
    category: "Agents",
  },
  {
    id: "sessions_spawn",
    name: "Spawn Sub-agent",
    desc: "Create a new agent session",
    category: "Agents",
  },
  {
    id: "knowledge_search",
    name: "Search Knowledge",
    desc: "Query the knowledge library",
    category: "Knowledge",
  },
  { id: "exec", name: "Run Commands", desc: "Execute terminal commands", category: "System" },
  { id: "read", name: "Read Files", desc: "Read files from disk", category: "System" },
  { id: "write", name: "Write Files", desc: "Write files to disk", category: "System" },
  { id: "browser", name: "Browse Web", desc: "Control a web browser", category: "System" },
] as const;

interface ToolPaletteEntry {
  id: string;
  name: string;
  desc?: string;
  category: string;
  source?: "core" | "plugin" | "connector" | "skill" | "promoted-cli" | "appforge";
}

type ToolCapabilitySource = NonNullable<ToolPaletteEntry["source"]>;

interface AppForgeEventOption {
  value: string;
  label: string;
  appId?: string;
  capabilityId?: string;
}

interface OutputChannelOption {
  id: string;
  label: string;
  defaultAccountId?: string;
  accountIds?: string[];
  deliveryMode?: "direct" | "gateway" | "hybrid";
  configured?: boolean;
  statusLabel?: string;
  targets?: Array<{
    id: string;
    label: string;
    kind?: "dm" | "group" | "channel" | "allowlist" | "custom";
  }>;
}

interface KnowledgeCollectionOption {
  collection: string;
  collectionTag?: string;
  collectionId?: string;
  ownerAgentId?: string | null;
  canRead?: boolean;
  canWrite?: boolean;
  isOwner?: boolean;
}

function toolCapabilitySourceLabel(source?: ToolPaletteEntry["source"]): string {
  switch (source) {
    case "connector":
      return "Connector";
    case "plugin":
      return "Plugin";
    case "skill":
      return "Skill";
    case "promoted-cli":
      return "Custom Tool";
    case "appforge":
      return "AppForge";
    case "core":
      return "Built-in";
    default:
      return "Primitive";
  }
}

function toolCapabilitySourceClass(source?: ToolPaletteEntry["source"]): string {
  switch (source) {
    case "connector":
      return "border-cyan-400/30 bg-cyan-400/10 text-cyan-200";
    case "plugin":
      return "border-violet-400/30 bg-violet-400/10 text-violet-200";
    case "skill":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
    case "promoted-cli":
      return "border-amber-400/30 bg-amber-400/10 text-amber-200";
    case "appforge":
      return "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200";
    case "core":
      return "border-sky-400/30 bg-sky-400/10 text-sky-200";
    default:
      return "border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 text-[hsl(var(--muted-foreground))]";
  }
}

function CapabilitySourceBadge({
  source,
  className = "",
}: {
  source?: ToolPaletteEntry["source"];
  className?: string;
}) {
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide ${toolCapabilitySourceClass(
        source,
      )} ${className}`}
    >
      {toolCapabilitySourceLabel(source)}
    </span>
  );
}

function groupToolsBySource(tools: ToolPaletteEntry[]): Array<{
  source?: ToolPaletteEntry["source"];
  label: string;
  tools: ToolPaletteEntry[];
}> {
  const order: Array<ToolPaletteEntry["source"]> = [
    "appforge",
    "promoted-cli",
    "skill",
    "plugin",
    "core",
    undefined,
  ];
  const grouped = new Map<ToolPaletteEntry["source"], ToolPaletteEntry[]>();
  for (const tool of tools) {
    const source = tool.source ?? undefined;
    const bucket = grouped.get(source) ?? [];
    bucket.push(tool);
    grouped.set(source, bucket);
  }
  return order
    .filter((source) => grouped.has(source))
    .map((source) => ({
      source,
      label: toolCapabilitySourceLabel(source),
      tools: [...(grouped.get(source) ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

function ToolPicker({
  selected,
  onChange,
  mode,
  tools,
}: {
  selected: string[];
  onChange: (tools: string[]) => void;
  mode: "allow" | "deny";
  tools?: ToolPaletteEntry[];
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const palette = tools && tools.length > 0 ? tools : AVAILABLE_TOOLS;

  const filtered = palette.filter(
    (t) =>
      !selected.includes(t.id) &&
      (t.name.toLowerCase().includes(search.toLowerCase()) || t.id.includes(search.toLowerCase())),
  );

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider flex items-center gap-1">
        {mode === "allow" ? "What can this agent use?" : "What should this agent NOT use?"}
        <HelpTip
          text={
            mode === "allow"
              ? "Pick the tools this agent is allowed to use. If none are selected, the agent can use all its default tools."
              : "Pick tools to block. The agent can use everything except these."
          }
        />
      </label>

      {/* Selected tags */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const tool = palette.find((t) => t.id === id);
            return (
              <span
                key={id}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] border border-[hsl(var(--primary))]/30"
              >
                {tool?.name ?? id}
                <CapabilitySourceBadge source={tool?.source} className="ml-0.5" />
                <button
                  onClick={() => onChange(selected.filter((s) => s !== id))}
                  className="hover:text-red-400"
                >
                  &#215;
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Search + dropdown */}
      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search tools..."
        className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-xs text-[hsl(var(--foreground))] focus:outline-none focus:border-[hsl(var(--primary))] transition-colors"
      />
      {open && filtered.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          {filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onChange([...selected, t.id]);
                setSearch("");
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium text-[hsl(var(--foreground))]">{t.name}</span>
                  <span className="text-[hsl(var(--muted-foreground))] ml-2">{t.desc}</span>
                </span>
                <CapabilitySourceBadge source={t.source} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Trigger Type Definitions ────────────────────────────────────────

const TRIGGER_TYPES: Array<{ value: TriggerTypeValue; label: string; icon: string }> = [
  { value: "manual", label: "Manual (click Run)", icon: "\uD83D\uDD18" },
  { value: "schedule", label: "Schedule (runs on a timer)", icon: "\u23F0" },
  { value: "webhook", label: "Webhook (another app triggers it)", icon: "\uD83D\uDD17" },
  { value: "form_submitted", label: "Form Submitted", icon: "\uD83D\uDCDD" },
  { value: "record_created", label: "New Database Record", icon: "\uD83D\uDDC4\uFE0F" },
  { value: "record_updated", label: "Database Record Changed", icon: "\uD83D\uDD04" },
  { value: "email_engaged", label: "Email Opened or Clicked", icon: "\uD83D\uDCEC" },
  { value: "payment_received", label: "Payment Received", icon: "\uD83D\uDCB0" },
  { value: "appointment_booked", label: "Appointment Booked", icon: "\uD83D\uDCC5" },
  { value: "ticket_created", label: "New Support Ticket", icon: "\uD83C\uDFAB" },
  { value: "channel_message", label: "Chat Message Received", icon: "\uD83D\uDCAC" },
  { value: "email_received", label: "Email Received", icon: "\uD83D\uDCE7" },
  { value: "task_completed", label: "Task Completed", icon: "\u2705" },
  { value: "workflow_done", label: "Another Workflow Finished", icon: "\uD83D\uDD17" },
  { value: "agent_event", label: "Agent Had an Insight", icon: "\uD83D\uDCA1" },
  { value: "appforge_event", label: "AppForge Event", icon: "\uD83E\uDDE9" },
  { value: "timer_elapsed", label: "Time Since Last Event", icon: "\u23F3" },
];

// ── Workflow Templates ──────────────────────────────────────────────

interface WorkflowTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
}

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "article-pipeline",
    name: "Weekly Article Pipeline",
    icon: "\uD83D\uDCDD",
    description: "AI writes, reviews, and publishes a blog post weekly",
  },
  {
    id: "daily-brief",
    name: "Daily Intel Brief",
    icon: "\uD83D\uDCF0",
    description: "Morning research summary delivered to your inbox",
  },
  {
    id: "email-drip",
    name: "Email Drip Funnel",
    icon: "\uD83D\uDCE7",
    description: "Personalized email sequence for new signups",
  },
  {
    id: "competitor-watch",
    name: "Competitor Watch",
    icon: "\uD83D\uDD0D",
    description: "Weekly competitor analysis report",
  },
  {
    id: "social-listening",
    name: "Social Listening",
    icon: "\uD83C\uDFA7",
    description: "Monitor mentions and auto-draft responses",
  },
  {
    id: "client-onboarding",
    name: "Client Onboarding",
    icon: "\uD83C\uDFE2",
    description: "Automate new client setup",
  },
  {
    id: "incident-response",
    name: "Incident Response",
    icon: "\uD83D\uDEA8",
    description: "Triage, investigate, and report incidents",
  },
];

// ── New Workflow Modal ──────────────────────────────────────────────

function NewWorkflowModal({
  open,
  onClose,
  onCreateBlank,
  onCreateFromIntent,
  onImportWorkflowText,
  onSelectTemplate,
  packageTemplates,
  packageTemplatesLoading,
  onSelectPackageTemplate,
}: {
  open: boolean;
  onClose: () => void;
  onCreateBlank: (name?: string) => void;
  onCreateFromIntent: (intent: string, name?: string) => Promise<void>;
  onImportWorkflowText: (text: string, name?: string) => Promise<void>;
  onSelectTemplate: (template: WorkflowTemplate) => void;
  packageTemplates: WorkflowPackageTemplateSummary[];
  packageTemplatesLoading: boolean;
  onSelectPackageTemplate: (template: WorkflowPackageTemplateSummary) => Promise<void>;
}) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [workflowName, setWorkflowName] = useState("Untitled workflow");
  const [intent, setIntent] = useState("");
  const [importText, setImportText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedPackageSlug, setSelectedPackageSlug] = useState<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      return;
    }
    setShowTemplates(false);
    setShowImport(false);
    setIntent("");
    setImportText("");
    setGenerationError(null);
    setImportError(null);
    setSelectedPackageSlug(null);
  }, [open]);

  if (!open) {
    return null;
  }

  const createFromIntent = async () => {
    if (!intent.trim() || generating) {
      return;
    }
    setGenerating(true);
    setGenerationError(null);
    try {
      await onCreateFromIntent(intent.trim(), workflowName.trim() || undefined);
      setShowTemplates(false);
      setIntent("");
      onClose();
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const importPastedWorkflow = async () => {
    if (!importText.trim() || importing) {
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      await onImportWorkflowText(importText.trim(), workflowName.trim() || undefined);
      setImportText("");
      setShowImport(false);
      setShowTemplates(false);
      onClose();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const importSelectedWorkflowFile = async (file: File | null | undefined) => {
    if (!file || importing) {
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      await onImportWorkflowText(await file.text(), workflowName.trim() || undefined);
      setImportText("");
      setShowImport(false);
      setShowTemplates(false);
      onClose();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      if (importFileInputRef.current) {
        importFileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="max-h-[92vh] w-[min(560px,94vw)] overflow-y-auto bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
            Create New Workflow
          </h2>
          <button
            onClick={() => {
              onClose();
            }}
            className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            &#10005;
          </button>
        </div>

        <div className="mb-4 space-y-1.5">
          <label className={DOCK_LABEL}>Workflow name</label>
          <input
            autoFocus
            className={DOCK_INPUT}
            value={workflowName}
            onChange={(event) => setWorkflowName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onCreateBlank(workflowName);
                onClose();
              }
            }}
            placeholder="Daily research summary"
          />
        </div>

        <div className="mb-3 rounded-lg border border-cyan-400/30 bg-cyan-400/5 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-lg">&#10024;</span>
            <div>
              <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
                AI draft from description
              </div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">
                Type the outcome you want; Argent creates the first canvas for review.
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>What should this workflow do?</label>
            <textarea
              className={DOCK_INPUT + " resize-y"}
              rows={4}
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              placeholder="Example: Every weekday morning, have Argent research new AI voice model news, summarize it, ask me to approve, then send it to Telegram."
            />
          </div>
          {generationError && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-200">
              {generationError}
            </div>
          )}
          <button
            onClick={() => {
              void createFromIntent();
            }}
            disabled={!intent.trim() || generating}
            className="w-full rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-40"
          >
            {generating ? "Building AI draft..." : "Generate AI draft canvas"}
          </button>
        </div>

        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
          Or choose a starting point
        </div>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => {
              onCreateBlank(workflowName);
              onClose();
            }}
            className="p-6 rounded-xl border border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50 transition-colors text-left"
          >
            <div className="text-2xl mb-2">&#10024;</div>
            <div className="text-sm font-semibold text-[hsl(var(--foreground))]">Blank canvas</div>
            <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              Start with one trigger and drag in every node yourself
            </div>
          </button>

          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="p-6 rounded-xl border border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/50 transition-colors text-left"
          >
            <div className="text-2xl mb-2">&#128203;</div>
            <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
              Template gallery
            </div>
            <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              Import a tested owner-operator workflow and customize it
            </div>
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/60 p-3">
          <button
            type="button"
            onClick={() => {
              setShowImport(!showImport);
              setShowTemplates(false);
            }}
            className="flex w-full items-center justify-between text-left"
          >
            <span>
              <span className="block text-sm font-semibold text-[hsl(var(--foreground))]">
                Import JSON/YAML
              </span>
              <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                Paste an Argent workflow package or legacy workflow export
              </span>
            </span>
            <span className="text-xs text-cyan-200">{showImport ? "Hide" : "Paste"}</span>
          </button>
          {showImport && (
            <div className="mt-3 space-y-2">
              <textarea
                className={DOCK_INPUT + " min-h-[130px] resize-y font-mono text-[11px]"}
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder={'{\n  "kind": "argent.workflow.package",\n  ...\n}'}
              />
              {importError && (
                <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-200">
                  {importError}
                </div>
              )}
              <input
                ref={importFileInputRef}
                type="file"
                accept=".json,.yaml,.yml,.argent-workflow.json,.argent-workflow.yaml,.argent-workflow.yml,application/json,text/yaml,text/x-yaml"
                className="hidden"
                onChange={(event) => {
                  void importSelectedWorkflowFile(event.currentTarget.files?.[0]);
                }}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!importText.trim() || importing}
                  onClick={() => {
                    void importPastedWorkflow();
                  }}
                  className="rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-40"
                >
                  {importing ? "Importing..." : "Import pasted workflow"}
                </button>
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => importFileInputRef.current?.click()}
                  className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-xs font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-40"
                >
                  Choose workflow file
                </button>
              </div>
            </div>
          )}
        </div>

        {showTemplates && (
          <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
            {packageTemplates.length > 0 || packageTemplatesLoading ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className={DOCK_LABEL}>Owner-operator packages</div>
                  {packageTemplatesLoading && (
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                      Loading...
                    </span>
                  )}
                </div>
                {packageTemplates.map((template) => {
                  const running = selectedPackageSlug === template.slug;
                  return (
                    <button
                      key={template.slug}
                      onClick={() => {
                        setSelectedPackageSlug(template.slug);
                        void onSelectPackageTemplate(template)
                          .then(() => {
                            setShowTemplates(false);
                            setIntent("");
                            onClose();
                          })
                          .catch((err) => {
                            setGenerationError(err instanceof Error ? err.message : String(err));
                          })
                          .finally(() => {
                            setSelectedPackageSlug(null);
                          });
                      }}
                      disabled={running}
                      className="w-full rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3 text-left transition-colors hover:border-cyan-300/50 disabled:opacity-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-[hsl(var(--foreground))]">
                            {template.name}
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-[10px] text-[hsl(var(--muted-foreground))]">
                            {template.description}
                          </div>
                        </div>
                        <span className="shrink-0 rounded border border-cyan-300/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-cyan-200">
                          {template.scenario?.department ?? "workflow"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] text-[hsl(var(--muted-foreground))]">
                        <span className="rounded bg-[hsl(var(--muted))]/40 px-1.5 py-0.5">
                          {template.scenario?.runPattern ?? "manual"}
                        </span>
                        <span className="rounded bg-[hsl(var(--muted))]/40 px-1.5 py-0.5">
                          {template.nodeCount ?? 0} nodes
                        </span>
                        <span className="rounded bg-[hsl(var(--muted))]/40 px-1.5 py-0.5">
                          {(template.credentialCount ?? 0) + (template.dependencyCount ?? 0)}{" "}
                          bindings
                        </span>
                        {template.okForPinnedTestRun && (
                          <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-emerald-200">
                            fixture-ready
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="pt-2">
              <div className={DOCK_LABEL}>Simple starters</div>
            </div>
            {WORKFLOW_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  onSelectTemplate(t);
                  onClose();
                }}
                className="w-full text-left p-3 rounded-lg border border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/30 transition-colors"
              >
                <div className="text-xs font-semibold text-[hsl(var(--foreground))]">
                  {t.icon} {t.name}
                </div>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  {t.description}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Custom Nodes ────────────────────────────────────────────────────

function TriggerNode({ data, selected }: NodeProps<Node<TriggerNodeData>>) {
  return (
    <div
      className={`relative px-4 py-3 rounded-lg border min-w-[160px] transition-shadow ${execStateClass(data.execState)} ${
        selected
          ? "border-[hsl(var(--primary))] shadow-[0_0_12px_hsl(var(--primary)/0.4)]"
          : data.execState
            ? ""
            : "border-[hsl(var(--border))]"
      }`}
      style={{ background: "hsl(var(--card))" }}
    >
      <ExecOverlay state={data.execState} />
      <PinnedDataBadge active={data.pinnedOutput != null} />
      <RetryBadge retryCount={data.retryCount} />
      <NodeIssueBadge issues={data.validationIssues as WorkflowValidationIssue[] | undefined} />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">&#9889;</span>
        <span className="text-xs font-semibold text-[hsl(var(--foreground))]">Trigger</span>
      </div>
      <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
        {data.triggerType === "schedule"
          ? (() => {
              const parsed = parseCronToSchedule(data.cronExpression);
              if (parsed) {
                return generateScheduleSummary(
                  parsed.type,
                  parsed.hour,
                  parsed.minute,
                  parsed.ampm,
                  parsed.days,
                  parsed.dayOfMonth,
                  ((data as Record<string, unknown>).timezone as string) ?? "America/Chicago",
                );
              }
              return data.cronExpression || "No schedule";
            })()
          : (TRIGGER_TYPES.find((t) => t.value === data.triggerType)?.label ?? data.triggerType)}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-[hsl(var(--primary))] !border-2 !border-[hsl(var(--card))]"
      />
    </div>
  );
}

function AgentStepNode({ data, selected }: NodeProps<Node<AgentStepNodeData>>) {
  const color = data.agentColor || "hsl(var(--primary))";
  const stepLabel =
    data.label && data.label !== "Agent Step"
      ? data.label
      : data.rolePrompt?.trim()
        ? "Instructions configured"
        : "Add instructions";
  return (
    <div
      className={`relative px-4 py-3 rounded-lg border min-w-[180px] transition-shadow ${execStateClass(data.execState)} ${
        selected ? "shadow-[0_0_12px_hsl(var(--primary)/0.4)]" : ""
      }`}
      style={{
        background: "hsl(var(--card))",
        borderColor: data.execState ? undefined : selected ? color : "hsl(var(--border))",
        borderWidth: 1,
      }}
    >
      <ExecOverlay state={data.execState} />
      <PinnedDataBadge active={data.pinnedOutput != null} />
      <RetryBadge retryCount={data.retryCount} />
      <NodeIssueBadge issues={data.validationIssues as WorkflowValidationIssue[] | undefined} />
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-[hsl(var(--primary))] !border-2 !border-[hsl(var(--card))]"
      />
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-xs font-semibold text-[hsl(var(--foreground))] truncate">
          {data.agentName || "Select Agent"}
        </span>
      </div>
      <div className="max-w-[220px] truncate text-[10px] text-[hsl(var(--muted-foreground))]">
        {stepLabel}
      </div>
      {data.evidenceRequired && (
        <div className="text-[10px] text-amber-400 mt-1">Evidence required</div>
      )}
      {/* Main output handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="output"
        className="!w-3 !h-3 !bg-[hsl(var(--primary))] !border-2 !border-[hsl(var(--card))]"
      />
      {/* Sub-port handles — Model / Memory / Tools */}
      <Handle
        type="target"
        position={Position.Bottom}
        id="model"
        className="!w-2.5 !h-2.5 !bg-violet-400 !border-2 !border-[hsl(var(--card))] !-bottom-1"
        style={{ left: "25%" }}
        title="Model"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="memory"
        className="!w-2.5 !h-2.5 !bg-cyan-400 !border-2 !border-[hsl(var(--card))] !-bottom-1"
        style={{ left: "50%" }}
        title="Memory"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="tools"
        className="!w-2.5 !h-2.5 !bg-amber-400 !border-2 !border-[hsl(var(--card))] !-bottom-1"
        style={{ left: "75%" }}
        title="Tools"
      />
      {/* Sub-port labels */}
      <div className="absolute -bottom-4 left-0 right-0 flex justify-between px-4 pointer-events-none">
        <span className="text-[7px] text-violet-400 font-medium" style={{ marginLeft: "18%" }}>
          M
        </span>
        <span className="text-[7px] text-cyan-400 font-medium">K</span>
        <span className="text-[7px] text-amber-400 font-medium" style={{ marginRight: "18%" }}>
          T
        </span>
      </div>
    </div>
  );
}

// ── Sub-Port Node Types (Model / Memory / Tool) ──────────────────

interface SubPortNodeData extends Record<string, unknown> {
  subPortType: "model_provider" | "memory_source" | "tool_grant";
  label: string;
  config: Record<string, unknown>;
  execState?: string;
}

function ModelProviderNode({ data, selected }: NodeProps<Node<SubPortNodeData>>) {
  const model = (data.config?.model as string) || "Select model...";
  const provider = (data.config?.provider as string) || "";
  return (
    <div
      className={`relative px-3 py-2 rounded-lg border min-w-[140px] transition-shadow ${
        selected ? "shadow-[0_0_10px_rgba(139,92,246,0.4)]" : ""
      }`}
      style={{
        background: "hsl(var(--card))",
        borderColor: selected ? "#8b5cf6" : "hsl(var(--border))",
        borderWidth: 1,
        borderStyle: "dashed",
      }}
    >
      <NodeIssueBadge issues={data.validationIssues as WorkflowValidationIssue[] | undefined} />
      <Handle
        type="source"
        position={Position.Top}
        className="!w-2.5 !h-2.5 !bg-violet-400 !border-2 !border-[hsl(var(--card))]"
      />
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-xs">🧠</span>
        <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider">
          Model
        </span>
      </div>
      <div className="text-[11px] text-[hsl(var(--foreground))] font-medium truncate">{model}</div>
      {provider && <div className="text-[9px] text-[hsl(var(--muted-foreground))]">{provider}</div>}
    </div>
  );
}

function MemorySourceNode({ data, selected }: NodeProps<Node<SubPortNodeData>>) {
  const sourceType = (data.config?.sourceType as string) || "knowledge_collection";
  const label = data.label || sourceType.replace(/_/g, " ");
  return (
    <div
      className={`relative px-3 py-2 rounded-lg border min-w-[140px] transition-shadow ${
        selected ? "shadow-[0_0_10px_rgba(34,211,238,0.4)]" : ""
      }`}
      style={{
        background: "hsl(var(--card))",
        borderColor: selected ? "#22d3ee" : "hsl(var(--border))",
        borderWidth: 1,
        borderStyle: "dashed",
      }}
    >
      <NodeIssueBadge issues={data.validationIssues as WorkflowValidationIssue[] | undefined} />
      <Handle
        type="source"
        position={Position.Top}
        className="!w-2.5 !h-2.5 !bg-cyan-400 !border-2 !border-[hsl(var(--card))]"
      />
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-xs">📚</span>
        <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider">
          Memory
        </span>
      </div>
      <div className="text-[11px] text-[hsl(var(--foreground))] font-medium truncate">{label}</div>
      <div className="text-[9px] text-[hsl(var(--muted-foreground))]">
        {sourceType.replace(/_/g, " ")}
      </div>
    </div>
  );
}

function ToolGrantNode({ data, selected }: NodeProps<Node<SubPortNodeData>>) {
  const toolName =
    (data.config?.connectorId as string) || (data.config?.toolName as string) || "Select tool...";
  const grantType = (data.config?.grantType as string) || "connector";
  return (
    <div
      className={`relative px-3 py-2 rounded-lg border min-w-[140px] transition-shadow ${
        selected ? "shadow-[0_0_10px_rgba(251,191,36,0.4)]" : ""
      }`}
      style={{
        background: "hsl(var(--card))",
        borderColor: selected ? "#fbbf24" : "hsl(var(--border))",
        borderWidth: 1,
        borderStyle: "dashed",
      }}
    >
      <NodeIssueBadge issues={data.validationIssues as WorkflowValidationIssue[] | undefined} />
      <Handle
        type="source"
        position={Position.Top}
        className="!w-2.5 !h-2.5 !bg-amber-400 !border-2 !border-[hsl(var(--card))]"
      />
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-xs">🔧</span>
        <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">
          Tool
        </span>
      </div>
      <div className="text-[11px] text-[hsl(var(--foreground))] font-medium truncate">
        {toolName}
      </div>
      <div className="text-[9px] text-[hsl(var(--muted-foreground))]">{grantType}</div>
    </div>
  );
}

function compactNodeText(value: unknown, fallback: string, maxLength = 34): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return raw.length <= maxLength ? raw : `${raw.slice(0, maxLength - 1)}…`;
}

function outputNodeTargetLabel(data: OutputNodeData): string {
  const record = data as Record<string, unknown>;
  const targetLabels: Record<string, string> = {
    doc_panel: "DocPanel",
    channel: "Channel",
    discord: "Discord",
    telegram: "Telegram",
    email: "Email",
    webhook: "Webhook",
    variable: "Variable",
    knowledge: "Knowledge",
    task_update: "Task Manager",
    next_workflow: "Next Workflow",
    connector_action: "Connector Action",
  };
  const channelType =
    typeof data.channelType === "string" && data.channelType.trim()
      ? data.channelType.trim()
      : data.target === "discord" || data.target === "telegram"
        ? data.target
        : "";
  if (data.target === "channel" && channelType) {
    const destination = typeof record.channelId === "string" ? record.channelId.trim() : "";
    return destination
      ? `${compactNodeText(channelType, "Channel", 18)} / ${compactNodeText(destination, "target", 18)}`
      : compactNodeText(channelType, "Channel");
  }
  if (data.target === "connector_action") {
    const connectorName =
      typeof data.connectorName === "string" && data.connectorName.trim()
        ? data.connectorName.trim()
        : typeof record.connectorId === "string"
          ? record.connectorId
          : "";
    const operation = typeof record.operation === "string" ? record.operation.trim() : "";
    return operation
      ? `${compactNodeText(connectorName, "Connector", 18)} / ${compactNodeText(operation, "operation", 18)}`
      : compactNodeText(connectorName, "Connector Action");
  }
  if (data.target === "email") {
    return compactNodeText(record.recipient ?? record.to, "Email");
  }
  if (data.target === "webhook") {
    return compactNodeText(record.webhookUrl ?? record.url, "Webhook");
  }
  if (data.target === "next_workflow") {
    return compactNodeText(record.workflowId, "Next Workflow");
  }
  if (data.target === "knowledge") {
    return compactNodeText(record.collectionId, "Knowledge");
  }
  return targetLabels[data.target] || data.target;
}

function outputNodeSourceLabel(data: OutputNodeData): string {
  const record = data as Record<string, unknown>;
  const sourceMode = typeof record.sourceMode === "string" ? record.sourceMode : "previous";
  if (sourceMode === "summary") {
    return "Workflow summary";
  }
  if (sourceMode === "custom") {
    return "Custom payload";
  }
  if (sourceMode === "node") {
    return compactNodeText(record.sourceNodeId, "Selected node");
  }
  return "Previous result";
}

function OutputNode({ data, selected }: NodeProps<Node<OutputNodeData>>) {
  const record = data as Record<string, unknown>;
  const outputName = compactNodeText(record.title ?? data.label, "Output", 30);
  const targetLabel = outputNodeTargetLabel(data);
  const sourceLabel = outputNodeSourceLabel(data);
  return (
    <div
      className={`relative px-4 py-3 rounded-lg border w-[220px] transition-shadow ${execStateClass(data.execState)} ${
        selected
          ? "border-[hsl(var(--primary))] shadow-[0_0_12px_hsl(var(--primary)/0.4)]"
          : data.execState
            ? ""
            : "border-[hsl(var(--border))]"
      }`}
      style={{ background: "hsl(var(--card))" }}
    >
      <ExecOverlay state={data.execState} />
      <PinnedDataBadge active={data.pinnedOutput != null} />
      <RetryBadge retryCount={data.retryCount} />
      <NodeIssueBadge issues={data.validationIssues as WorkflowValidationIssue[] | undefined} />
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-[hsl(var(--primary))] !border-2 !border-[hsl(var(--card))]"
      />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">&#128228;</span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[hsl(var(--foreground))]">
          {outputName}
        </span>
      </div>
      <div className="truncate text-[10px] font-medium text-cyan-200">{targetLabel}</div>
      <div className="truncate text-[9px] text-[hsl(var(--muted-foreground))]">{sourceLabel}</div>
    </div>
  );
}

const ACTION_ICONS: Record<ActionTypeValue, string> = {
  connector_action: "\uD83D\uDD0C",
  send_message: "\uD83D\uDCAC",
  send_email: "\u2709\uFE0F",
  save_to_docpanel: "\uD83D\uDCC4",
  webhook_call: "\uD83C\uDF10",
  api_call: "\uD83D\uDD17",
  run_script: "\u25B6\uFE0F",
  create_task: "\u2705",
  store_memory: "\uD83E\uDDE0",
  store_knowledge: "\uD83D\uDCDA",
  generate_image: "\uD83D\uDDBC\uFE0F",
  generate_audio: "\uD83C\uDFA7",
};

const ACTION_LABELS: Record<ActionTypeValue, string> = {
  connector_action: "Connector Action",
  send_message: "Send Message",
  send_email: "Send Email",
  save_to_docpanel: "Save to DocPanel",
  webhook_call: "Webhook Call",
  api_call: "API Call",
  run_script: "Run Script",
  create_task: "Create Task",
  store_memory: "Store Memory",
  store_knowledge: "Store Knowledge",
  generate_image: "Generate Image",
  generate_audio: "Generate Audio",
};

function ActionNode({ data, selected }: NodeProps<Node<ActionNodeData>>) {
  const cfg = data.config ?? {};
  const connectorId = typeof cfg.connectorId === "string" ? cfg.connectorId : "";
  const connectorName = typeof cfg.connectorName === "string" ? cfg.connectorName : connectorId;
  const connectorCategory =
    typeof cfg.connectorCategory === "string" ? cfg.connectorCategory : "general";
  const connectorOperation = typeof cfg.operation === "string" ? cfg.operation : "";
  const isConnectorAction = Boolean(connectorId) || data.actionType === "connector_action";
  const icon = isConnectorAction
    ? connectorIcon(connectorCategory)
    : ACTION_ICONS[data.actionType] || "\u2699\uFE0F";
  const label = isConnectorAction
    ? connectorName || "Connector Action"
    : ACTION_LABELS[data.actionType] || data.actionType;
  const detail = isConnectorAction
    ? connectorOperation || "Select operation"
    : ACTION_LABELS[data.actionType] || data.actionType;
  return (
    <div
      className={`relative px-4 py-3 rounded-lg border min-w-[170px] transition-shadow ${execStateClass(data.execState)} ${
        selected ? "shadow-[0_0_12px_rgba(255,171,0,0.4)]" : ""
      }`}
      style={{
        background: "hsl(var(--card))",
        borderColor: data.execState ? undefined : selected ? "#ffab00" : "hsl(var(--border))",
        borderWidth: 1,
      }}
    >
      <ExecOverlay state={data.execState} />
      <PinnedDataBadge active={data.pinnedOutput != null} />
      <RetryBadge retryCount={data.retryCount} />
      <NodeIssueBadge issues={data.validationIssues as WorkflowValidationIssue[] | undefined} />
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-[#ffab00] !border-2 !border-[hsl(var(--card))]"
      />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold text-[hsl(var(--foreground))]">
          {isConnectorAction ? "Connector" : "Action"}
        </span>
        {isConnectorAction && <CapabilitySourceBadge source="connector" />}
      </div>
      <div className="text-[11px] text-[#ffab00] font-medium truncate">{label}</div>
      <div className="text-[9px] text-[hsl(var(--muted-foreground))] truncate">{detail}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-[#ffab00] !border-2 !border-[hsl(var(--card))]"
      />
    </div>
  );
}

const GATE_LABELS: Record<GateTypeValue, string> = {
  condition: "Condition",
  switch: "Switch",
  parallel: "Parallel",
  join: "Join",
  wait_duration: "Wait",
  wait_event: "Wait Event",
  loop: "Loop",
  error_handler: "Error Handler",
  sub_workflow: "Sub-Workflow",
  approval: "Approval",
};

const GATE_ICONS: Record<GateTypeValue, string> = {
  condition: "\u2753",
  switch: "\uD83D\uDD00",
  parallel: "\u2194\uFE0F",
  join: "\u2935\uFE0F",
  wait_duration: "\u23F3",
  wait_event: "\uD83D\uDD14",
  loop: "\uD83D\uDD01",
  error_handler: "\uD83D\uDEE1\uFE0F",
  sub_workflow: "\uD83D\uDCC2",
  approval: "\u23F8\uFE0F",
};

/** Number of output handles for each gate type */
function gateOutputCount(gateType: GateTypeValue, branchCount: number): number {
  switch (gateType) {
    case "condition":
      return 2;
    case "switch":
    case "parallel":
      return Math.max(2, branchCount);
    default:
      return 1;
  }
}

/** Whether this gate type accepts multiple inputs (join) */
function gateMultiInput(gateType: GateTypeValue): boolean {
  return gateType === "join";
}

function GateNode({ data, selected }: NodeProps<Node<GateNodeData>>) {
  const label = GATE_LABELS[data.gateType] || data.gateType;
  const icon = GATE_ICONS[data.gateType] || "\u25C6";
  const outputs = gateOutputCount(data.gateType, data.branchCount ?? 2);
  const multiIn = gateMultiInput(data.gateType);

  const outputLabels: string[] = [];
  if (data.gateType === "condition") {
    outputLabels.push("true", "false");
  } else if (data.gateType === "loop") {
    outputLabels.push("exit");
  }

  const execBorder =
    data.execState === "waiting"
      ? "#f59e0b"
      : data.execState === "active"
        ? "#00aaff"
        : data.execState === "completed"
          ? "#00ffcc"
          : data.execState === "failed"
            ? "#ff3d57"
            : undefined;

  return (
    <div
      className={`relative transition-shadow ${execStateClass(data.execState)} ${
        selected ? "drop-shadow-[0_0_12px_rgba(0,204,204,0.5)]" : ""
      }`}
      style={{ width: 140, height: 90 }}
    >
      <ExecOverlay state={data.execState} />
      <PinnedDataBadge active={data.pinnedOutput != null} />
      <RetryBadge retryCount={data.retryCount} />
      <NodeIssueBadge issues={data.validationIssues as WorkflowValidationIssue[] | undefined} />
      {/* Diamond shape */}
      <div
        className="absolute inset-0 border-2"
        style={{
          background: "hsl(var(--card))",
          borderColor: execBorder ?? (selected ? "#00cccc" : "hsl(var(--border))"),
          clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
        }}
      />
      {/* Content centered inside diamond */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
        <span className="text-sm leading-none">
          {data.execState === "waiting" ? "\u23F8\uFE0F" : icon}
        </span>
        <span
          className={`text-[10px] font-semibold mt-0.5 ${
            data.execState === "waiting" ? "text-amber-400" : "text-[#00cccc]"
          }`}
        >
          {data.execState === "waiting" ? "Waiting..." : label}
        </span>
      </div>

      {/* Input handle(s) */}
      {multiIn ? (
        <>
          <Handle
            type="target"
            position={Position.Top}
            id="in-0"
            className="!w-3 !h-3 !bg-[#00cccc] !border-2 !border-[hsl(var(--card))]"
            style={{ left: "35%" }}
          />
          <Handle
            type="target"
            position={Position.Top}
            id="in-1"
            className="!w-3 !h-3 !bg-[#00cccc] !border-2 !border-[hsl(var(--card))]"
            style={{ left: "65%" }}
          />
        </>
      ) : (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-[#00cccc] !border-2 !border-[hsl(var(--card))]"
        />
      )}

      {/* Output handles - spread across bottom */}
      {Array.from({ length: outputs }, (_, i) => {
        const pct = outputs === 1 ? 50 : 20 + (60 * i) / (outputs - 1);
        return (
          <Handle
            key={`out-${i}`}
            type="source"
            position={Position.Bottom}
            id={`out-${i}`}
            className="!w-3 !h-3 !bg-[#00cccc] !border-2 !border-[hsl(var(--card))]"
            style={{ left: `${pct}%` }}
          />
        );
      })}
      {/* Output labels for condition branches */}
      {outputLabels.length > 0 && (
        <div className="absolute -bottom-3.5 left-0 right-0 flex justify-between px-2 pointer-events-none z-10">
          {outputLabels.map((lbl) => (
            <span key={lbl} className="text-[8px] text-[#00cccc]/70 font-medium">
              {lbl}
            </span>
          ))}
        </div>
      )}
      {/* Loop body handle on the right side */}
      {data.gateType === "loop" && (
        <Handle
          type="source"
          position={Position.Right}
          id="loop-body"
          className="!w-3 !h-3 !bg-[#00cccc] !border-2 !border-[hsl(var(--card))]"
        />
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  agentStep: AgentStepNode,
  output: OutputNode,
  action: ActionNode,
  gate: GateNode,
  // Sub-port nodes (connect to Agent node's M/K/T handles)
  modelProvider: ModelProviderNode,
  memorySource: MemorySourceNode,
  toolGrant: ToolGrantNode,
};

const WORKFLOW_DEFAULT_EDGE_OPTIONS = {
  style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
  animated: true,
};

const WORKFLOW_REACT_FLOW_STYLE = { background: "hsl(var(--background))" };
const WORKFLOW_MINIMAP_STYLE = {
  backgroundColor: "hsl(var(--background))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
};
const WORKFLOW_CONTROLS_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
};
const WORKFLOW_MINIMAP_NODE_COLOR = () => "hsl(var(--primary))";
const WORKFLOW_PRO_OPTIONS = { hideAttribution: true };

// ── Node Kind Label ──────────────────────────────────────────────────

function nodeKindLabel(node: Node): string {
  switch (node.type) {
    case "trigger":
      return "Trigger Node";
    case "agentStep":
      return "Agent Step";
    case "action":
      return "Action Node";
    case "gate":
      return "Gate / Control Flow";
    case "output":
      return "Output Node";
    default:
      return node.type || "Node";
  }
}

// ── Right Dock Property Forms ────────────────────────────────────────

const DOCK_INPUT =
  "w-full px-2.5 py-2 rounded-lg text-xs bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] focus:outline-none focus:border-[hsl(var(--primary))] transition-colors";
const DOCK_LABEL =
  "text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider";

const OUTPUT_TEMPLATE_TOKENS = [
  { label: "Previous text", value: "{{previous.text}}" },
  { label: "Previous JSON", value: "{{previous.json}}" },
  { label: "Run ID", value: "{{run.id}}" },
  { label: "Workflow", value: "{{workflow.name}}" },
] as const;

type OutputPayloadPreset = {
  id: string;
  label: string;
  template: string;
  targets: OutputNodeData["target"][];
};

const OUTPUT_PAYLOAD_PRESETS: OutputPayloadPreset[] = [
  {
    id: "brief",
    label: "Brief",
    template: "## {{workflow.name}}\n\n{{previous.text}}\n\nRun: {{run.id}}",
    targets: ["doc_panel", "knowledge", "email", "channel"],
  },
  {
    id: "approval-summary",
    label: "Approval summary",
    template:
      "Review the workflow output from {{source.label}}:\n\n{{previous.text}}\n\nApprove or deny before delivery.",
    targets: ["doc_panel", "email", "channel"],
  },
  {
    id: "webhook-json",
    label: "Webhook JSON",
    template:
      '{\n  "workflow": "{{workflow.name}}",\n  "runId": "{{run.id}}",\n  "payload": {{previous.json}}\n}',
    targets: ["webhook", "connector_action"],
  },
  {
    id: "task-note",
    label: "Task note",
    template: "Workflow {{workflow.name}} completed from {{source.label}}.\n\n{{previous.text}}",
    targets: ["task_update", "next_workflow"],
  },
];

type ScheduleType = "daily" | "weekly" | "monthly" | "custom";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DOW_CRON = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const MINUTE_OPTIONS = ["00", "15", "30", "45"] as const;
const TIMEZONE_OPTIONS = [
  { value: "America/Chicago", label: "Central (CST/CDT)" },
  { value: "America/New_York", label: "Eastern (EST/EDT)" },
  { value: "America/Los_Angeles", label: "Pacific (PST/PDT)" },
  { value: "America/Denver", label: "Mountain (MST/MDT)" },
  { value: "UTC", label: "UTC" },
] as const;

/**
 * Parse an existing cron expression into schedule builder state.
 * Returns null if the expression can't be parsed into a visual mode.
 */
function parseCronToSchedule(cron: string): {
  type: ScheduleType;
  hour: number;
  minute: string;
  ampm: "AM" | "PM";
  days: number[];
  dayOfMonth: number;
} | null {
  if (!cron || !cron.trim()) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minStr, hourStr, dom, , dow] = parts;
  const minute = minStr.padStart(2, "0");
  const hour24 = parseInt(hourStr, 10);
  if (isNaN(hour24)) return null;

  const ampm: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;

  // Weekly: dom=* dow!=*
  if (dom === "*" && dow !== "*") {
    const dayNames = dow.split(",");
    const days = dayNames
      .map((d) => DOW_CRON.indexOf(d.toUpperCase() as (typeof DOW_CRON)[number]))
      .filter((i) => i >= 0);
    if (days.length > 0) {
      return { type: "weekly", hour, minute, ampm, days, dayOfMonth: 1 };
    }
  }

  // Monthly: dom!=* dow=*
  if (dom !== "*" && dow === "*") {
    const dayOfMonth = parseInt(dom, 10);
    if (!isNaN(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31) {
      return { type: "monthly", hour, minute, ampm, days: [], dayOfMonth };
    }
  }

  // Daily: dom=* dow=*
  if (dom === "*" && dow === "*") {
    return { type: "daily", hour, minute, ampm, days: [], dayOfMonth: 1 };
  }

  return null;
}

function generateCronFromSchedule(
  scheduleType: ScheduleType,
  hour: number,
  minute: string,
  ampm: "AM" | "PM",
  selectedDays: number[],
  dayOfMonth: number,
  rawCron: string,
): string {
  if (scheduleType === "custom") return rawCron;

  let hour24 = hour % 12;
  if (ampm === "PM") hour24 += 12;

  switch (scheduleType) {
    case "daily":
      return `${parseInt(minute, 10)} ${hour24} * * *`;
    case "weekly": {
      if (selectedDays.length === 0) return "";
      const days = selectedDays.map((d) => DOW_CRON[d]).join(",");
      return `${parseInt(minute, 10)} ${hour24} * * ${days}`;
    }
    case "monthly":
      return `${parseInt(minute, 10)} ${hour24} ${dayOfMonth} * *`;
    default:
      return rawCron;
  }
}

function generateScheduleSummary(
  scheduleType: ScheduleType,
  hour: number,
  minute: string,
  ampm: "AM" | "PM",
  selectedDays: number[],
  dayOfMonth: number,
  timezone: string,
): string {
  const timeStr = `${hour}:${minute} ${ampm}`;
  const tz = TIMEZONE_OPTIONS.find((t) => t.value === timezone)?.label.split(" ")[0] ?? timezone;

  switch (scheduleType) {
    case "daily":
      return `Every day at ${timeStr} ${tz}`;
    case "weekly": {
      if (selectedDays.length === 0) return "Select days";
      if (selectedDays.length === 7) return `Every day at ${timeStr} ${tz}`;
      const dayStr = selectedDays.map((d) => DAY_LABELS[d]).join(", ");
      return `Every ${dayStr} at ${timeStr} ${tz}`;
    }
    case "monthly":
      return `Monthly on the ${dayOfMonth}${ordinalSuffix(dayOfMonth)} at ${timeStr} ${tz}`;
    case "custom":
      return "Custom schedule expression";
  }
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/** Map trigger provider selections to AOS connector IDs for credential binding */
const TRIGGER_PROVIDER_CONNECTOR_MAP: Record<string, string> = {
  stripe: "aos-stripe",
  square: "aos-square",
  paypal: "aos-paypal",
  zendesk: "aos-zendesk",
  freshdesk: "aos-freshdesk",
  linear: "aos-linear",
  jira: "aos-jira",
  intercom: "aos-intercom",
  calendly: "aos-calendly",
  google_calendar: "aos-google",
  outlook: "aos-m365",
  cal_com: "aos-cal",
  sendgrid: "aos-sendgrid",
  mailgun: "aos-mailgun",
  postmark: "aos-postmark",
  airtable: "aos-airtable",
  notion: "aos-notion",
  supabase: "aos-supabase",
  google_sheets: "aos-google",
  typeform: "aos-typeform",
  discord: "aos-discord-workflow",
  slack: "aos-slack",
  telegram: "aos-telegram",
};

function TriggerForm({
  data,
  onUpdate,
  nodeId,
  gateway,
  appForgeEventOptions,
  workflows,
}: {
  data: TriggerNodeData;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  nodeId: string;
  gateway: ReturnType<typeof useGateway>;
  appForgeEventOptions: AppForgeEventOption[];
  workflows: WorkflowDefinition[];
}) {
  const update = (field: string, value: unknown) => {
    onUpdate(nodeId, { ...data, [field]: value });
  };

  // Resolve connector ID from provider selection for credential binding
  const resolvedConnectorId = useMemo(() => {
    const providerFields = [
      data.paymentProvider,
      data.ticketProvider,
      data.calendarProvider,
      data.emailProvider,
      data.formProvider,
      data.dbConnector,
      data.channelType,
    ] as (string | undefined)[];
    for (const p of providerFields) {
      if (p && TRIGGER_PROVIDER_CONNECTOR_MAP[p]) return TRIGGER_PROVIDER_CONNECTOR_MAP[p];
    }
    return data.connectorId;
  }, [data]);

  // Parse existing cron into visual schedule state
  const parsed = useMemo(() => parseCronToSchedule(data.cronExpression), [data.cronExpression]);

  const [scheduleType, setScheduleType] = useState<ScheduleType>(parsed?.type ?? "weekly");
  const [selectedDays, setSelectedDays] = useState<number[]>(parsed?.days ?? [1, 3, 5]);
  const [hour, setHour] = useState(parsed?.hour ?? 9);
  const [minute, setMinute] = useState(parsed?.minute ?? "00");
  const [ampm, setAmpm] = useState<"AM" | "PM">(parsed?.ampm ?? "AM");
  const [dayOfMonth, setDayOfMonth] = useState(parsed?.dayOfMonth ?? 1);
  const [timezone, setTimezone] = useState(
    ((data as Record<string, unknown>).timezone as string) ?? "America/Chicago",
  );
  const [rawCron, setRawCron] = useState(data.cronExpression || "");

  // Sync visual state -> cron expression
  const syncCron = useCallback(() => {
    const cron = generateCronFromSchedule(
      scheduleType,
      hour,
      minute,
      ampm,
      selectedDays,
      dayOfMonth,
      rawCron,
    );
    if (cron !== data.cronExpression) {
      onUpdate(nodeId, { ...data, cronExpression: cron, timezone });
    }
  }, [
    scheduleType,
    hour,
    minute,
    ampm,
    selectedDays,
    dayOfMonth,
    rawCron,
    timezone,
    data,
    nodeId,
    onUpdate,
  ]);

  useEffect(() => {
    if (data.triggerType === "schedule") {
      syncCron();
    }
  }, [
    scheduleType,
    hour,
    minute,
    ampm,
    selectedDays,
    dayOfMonth,
    rawCron,
    timezone,
    data.triggerType,
    syncCron,
  ]);

  const toggleDay = (dayIdx: number) => {
    setSelectedDays((prev) =>
      prev.includes(dayIdx) ? prev.filter((d) => d !== dayIdx) : [...prev, dayIdx].sort(),
    );
  };

  return (
    <>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL + " flex items-center gap-1"}>
          What starts this workflow?
          <HelpTip text="What starts this workflow? A schedule runs it automatically. Manual means you click Run." />
        </label>
        <select
          className={DOCK_INPUT}
          value={data.triggerType}
          onChange={(e) => update("triggerType", e.target.value)}
        >
          {TRIGGER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.icon} {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Event-based trigger config fields */}
      {data.triggerType === "webhook" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL + " flex items-center gap-1"}>
            Webhook URL
            <HelpTip text="A unique URL that other apps can call to start this workflow." />
          </label>
          <input
            className={DOCK_INPUT}
            value={((data as Record<string, unknown>).webhookUrl as string) || ""}
            onChange={(e) => update("webhookUrl", e.target.value)}
            placeholder="Auto-generated on save"
            readOnly
          />
          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
            This URL will be generated when the workflow is saved
          </p>
        </div>
      )}

      {data.triggerType === "form_submitted" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Form Provider</label>
            <select
              className={DOCK_INPUT}
              value={((data as Record<string, unknown>).formProvider as string) || ""}
              onChange={(e) => update("formProvider", e.target.value)}
            >
              <option value="">Select provider...</option>
              <option value="typeform">Typeform</option>
              <option value="google_forms">Google Forms</option>
              <option value="jotform">JotForm</option>
              <option value="custom">Custom / Webhook</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Form ID</label>
            <input
              className={DOCK_INPUT}
              value={((data as Record<string, unknown>).formId as string) || ""}
              onChange={(e) => update("formId", e.target.value)}
              placeholder="form-123"
            />
          </div>
        </>
      )}

      {(data.triggerType === "record_created" || data.triggerType === "record_updated") && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Connector</label>
            <select
              className={DOCK_INPUT}
              value={((data as Record<string, unknown>).dbConnector as string) || ""}
              onChange={(e) => update("dbConnector", e.target.value)}
            >
              <option value="">Select connector...</option>
              <option value="airtable">Airtable</option>
              <option value="notion">Notion</option>
              <option value="postgres">PostgreSQL</option>
              <option value="supabase">Supabase</option>
              <option value="google_sheets">Google Sheets</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Table / Database Name</label>
            <input
              className={DOCK_INPUT}
              value={((data as Record<string, unknown>).tableName as string) || ""}
              onChange={(e) => update("tableName", e.target.value)}
              placeholder="customers"
            />
          </div>
        </>
      )}

      {data.triggerType === "email_engaged" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Email Provider</label>
            <select
              className={DOCK_INPUT}
              value={((data as Record<string, unknown>).emailProvider as string) || ""}
              onChange={(e) => update("emailProvider", e.target.value)}
            >
              <option value="">Select provider...</option>
              <option value="sendgrid">SendGrid</option>
              <option value="mailgun">Mailgun</option>
              <option value="postmark">Postmark</option>
              <option value="ses">Amazon SES</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Engagement Type</label>
            <select
              className={DOCK_INPUT}
              value={((data as Record<string, unknown>).engagementType as string) || "opened"}
              onChange={(e) => update("engagementType", e.target.value)}
            >
              <option value="opened">Opened</option>
              <option value="clicked">Clicked</option>
              <option value="replied">Replied</option>
              <option value="bounced">Bounced</option>
            </select>
          </div>
        </>
      )}

      {data.triggerType === "payment_received" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Payment Provider</label>
            <select
              className={DOCK_INPUT}
              value={((data as Record<string, unknown>).paymentProvider as string) || ""}
              onChange={(e) => update("paymentProvider", e.target.value)}
            >
              <option value="">Select provider...</option>
              <option value="stripe">Stripe</option>
              <option value="square">Square</option>
              <option value="paypal">PayPal</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Event</label>
            <select
              className={DOCK_INPUT}
              value={
                ((data as Record<string, unknown>).paymentEvent as string) || "payment_succeeded"
              }
              onChange={(e) => update("paymentEvent", e.target.value)}
            >
              <option value="payment_succeeded">Payment Succeeded</option>
              <option value="subscription_created">Subscription Created</option>
              <option value="invoice_paid">Invoice Paid</option>
              <option value="refund_issued">Refund Issued</option>
            </select>
          </div>
        </>
      )}

      {data.triggerType === "appointment_booked" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Calendar Provider</label>
          <select
            className={DOCK_INPUT}
            value={((data as Record<string, unknown>).calendarProvider as string) || ""}
            onChange={(e) => update("calendarProvider", e.target.value)}
          >
            <option value="">Select provider...</option>
            <option value="calendly">Calendly</option>
            <option value="google_calendar">Google Calendar</option>
            <option value="outlook">Outlook</option>
            <option value="cal_com">Cal.com</option>
          </select>
        </div>
      )}

      {data.triggerType === "ticket_created" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Ticketing System</label>
          <select
            className={DOCK_INPUT}
            value={((data as Record<string, unknown>).ticketProvider as string) || ""}
            onChange={(e) => update("ticketProvider", e.target.value)}
          >
            <option value="">Select provider...</option>
            <option value="zendesk">Zendesk</option>
            <option value="freshdesk">Freshdesk</option>
            <option value="intercom">Intercom</option>
            <option value="linear">Linear</option>
            <option value="jira">Jira</option>
          </select>
        </div>
      )}

      {data.triggerType === "channel_message" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Channel</label>
          <select
            className={DOCK_INPUT}
            value={((data as Record<string, unknown>).channelType as string) || ""}
            onChange={(e) => update("channelType", e.target.value)}
          >
            <option value="">Select channel...</option>
            <option value="discord">Discord</option>
            <option value="slack">Slack</option>
            <option value="telegram">Telegram</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="webchat">Web Chat</option>
          </select>
        </div>
      )}

      {data.triggerType === "email_received" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Filter (from address or subject)</label>
          <input
            className={DOCK_INPUT}
            value={((data as Record<string, unknown>).emailFilter as string) || ""}
            onChange={(e) => update("emailFilter", e.target.value)}
            placeholder="*@example.com or subject:invoice"
          />
        </div>
      )}

      {data.triggerType === "workflow_done" && (
        <WorkflowPicker
          label="Upstream workflow"
          value={((data as Record<string, unknown>).upstreamWorkflowId as string) || ""}
          onChange={(value) => update("upstreamWorkflowId", value)}
          workflows={workflows}
          placeholder="Select workflow..."
        />
      )}

      {data.triggerType === "appforge_event" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>App ID</label>
            <input
              className={DOCK_INPUT}
              value={((data as Record<string, unknown>).appId as string) || ""}
              onChange={(e) => update("appId", e.target.value)}
              placeholder="app_..."
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Capability ID</label>
            <input
              className={DOCK_INPUT}
              value={((data as Record<string, unknown>).capabilityId as string) || ""}
              onChange={(e) => update("capabilityId", e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Event Type</label>
            <input
              className={DOCK_INPUT}
              list="workflow-appforge-trigger-events"
              value={((data as Record<string, unknown>).eventType as string) || ""}
              onChange={(e) => update("eventType", e.target.value)}
              placeholder="forge.review.completed"
            />
            <datalist id="workflow-appforge-trigger-events">
              {appForgeEventOptions.map((event) => (
                <option
                  key={`${event.value}:${event.appId ?? ""}:${event.capabilityId ?? ""}`}
                  value={event.value}
                >
                  {event.label}
                </option>
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Event Filter (JSON)</label>
            <textarea
              className={DOCK_INPUT + " font-mono text-[11px] resize-y"}
              rows={3}
              value={((data as Record<string, unknown>).eventFilterJson as string) || ""}
              onChange={(e) => update("eventFilterJson", e.target.value)}
              placeholder='{"decision":"approved"}'
            />
          </div>
        </>
      )}

      {data.triggerType === "timer_elapsed" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Time Since Last Event (minutes)</label>
          <input
            type="number"
            className={DOCK_INPUT}
            value={((data as Record<string, unknown>).timerMinutes as number) || 60}
            onChange={(e) => update("timerMinutes", parseInt(e.target.value) || 60)}
            min={1}
            max={43200}
          />
        </div>
      )}

      {/* Credential binding for service-connected triggers */}
      {resolvedConnectorId &&
        data.triggerType !== "schedule" &&
        data.triggerType !== "manual" &&
        data.triggerType !== "webhook" &&
        data.triggerType !== "appforge_event" && (
          <div className="space-y-1.5">
            <CredentialSelector
              connectorId={resolvedConnectorId}
              authKind="service-key"
              requiredSecrets={[]}
              selectedCredentialId={data.credentialId || undefined}
              onChange={(id) => update("credentialId", id ?? "")}
              gatewayRequest={gateway.request}
              gatewayConnected={gateway.connected}
            />
            {!data.credentialId && (
              <p className="text-[10px] text-amber-400">
                Connect your account to enable this trigger
              </p>
            )}
          </div>
        )}

      {data.triggerType === "schedule" && (
        <div className="space-y-3">
          {/* Schedule Type */}
          <div className="space-y-1.5">
            <label className={DOCK_LABEL + " flex items-center gap-1"}>
              Schedule
              <HelpTip text="Pick which days and what time this should run." />
            </label>
            <select
              className={DOCK_INPUT}
              value={scheduleType}
              onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* Weekly: Day Picker */}
          {scheduleType === "weekly" && (
            <div className="space-y-1.5">
              <label className={DOCK_LABEL}>Days</label>
              <div className="flex gap-1">
                {DAY_LABELS.map((day, i) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`w-10 h-10 rounded-lg text-xs font-medium transition-colors ${
                      selectedDays.includes(i)
                        ? "bg-[hsl(var(--primary))] text-white"
                        : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/80"
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Monthly: Day of Month */}
          {scheduleType === "monthly" && (
            <div className="space-y-1.5">
              <label className={DOCK_LABEL}>Day of Month</label>
              <select
                className={DOCK_INPUT}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(parseInt(e.target.value, 10))}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Time Picker (for all visual modes) */}
          {scheduleType !== "custom" && (
            <div className="space-y-1.5">
              <label className={DOCK_LABEL}>Time</label>
              <div className="flex gap-2">
                <select
                  className={DOCK_INPUT + " flex-1"}
                  value={hour}
                  onChange={(e) => setHour(parseInt(e.target.value, 10))}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <select
                  className={DOCK_INPUT + " flex-1"}
                  value={minute}
                  onChange={(e) => setMinute(e.target.value)}
                >
                  {MINUTE_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  className={DOCK_INPUT + " flex-1"}
                  value={ampm}
                  onChange={(e) => setAmpm(e.target.value as "AM" | "PM")}
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
          )}

          {/* Timezone (for all visual modes) */}
          {scheduleType !== "custom" && (
            <div className="space-y-1.5">
              <label className={DOCK_LABEL}>Timezone</label>
              <select
                className={DOCK_INPUT}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Custom: Raw cron input */}
          {scheduleType === "custom" && (
            <div className="space-y-1.5">
              <label className={DOCK_LABEL}>Schedule Expression</label>
              <input
                className={DOCK_INPUT}
                value={rawCron}
                onChange={(e) => setRawCron(e.target.value)}
                placeholder="0 9 * * MON"
              />
              <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                min hour dom month dow
              </p>
            </div>
          )}

          {/* Human-readable summary */}
          {scheduleType !== "custom" && (
            <div className="text-sm text-[hsl(var(--primary))] font-medium">
              {generateScheduleSummary(
                scheduleType,
                hour,
                minute,
                ampm,
                selectedDays,
                dayOfMonth,
                timezone,
              )}
            </div>
          )}

          {/* Schedule expression preview */}
          <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
            schedule: {data.cronExpression || "(none)"}
          </div>
        </div>
      )}
    </>
  );
}

function AgentForm({
  data,
  agents,
  availableTools,
  onUpdate,
  nodeId,
  gateway,
}: {
  data: AgentStepNodeData;
  agents: FamilyMember[];
  availableTools: ToolPaletteEntry[];
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  nodeId: string;
  gateway: ReturnType<typeof useGateway>;
}) {
  const [enhancing, setEnhancing] = useState(false);
  const update = (field: string, value: unknown) => {
    onUpdate(nodeId, { ...data, [field]: value });
  };

  const handleAIEnhance = async () => {
    if (!data.rolePrompt.trim()) return;
    setEnhancing(true);
    try {
      const result = await gateway.request<{ text?: string }>("agent", {
        message: `You are a workflow prompt engineer. Improve this agent role prompt to be more specific, actionable, and results-oriented. Keep it concise but clear. Include what evidence/artifacts the agent should produce.\n\nOriginal prompt: "${data.rolePrompt}"\n\nReturn ONLY the improved prompt, nothing else.`,
        model: "claude-haiku-4-5",
        sessionKey: "workflow-copilot",
      });
      if (result?.text) {
        onUpdate(nodeId, { ...data, rolePrompt: result.text });
      }
    } catch (err) {
      console.error("[Workflows] AI enhance failed:", err);
    } finally {
      setEnhancing(false);
    }
  };

  const rawToolsAllow = (data as Record<string, unknown>).toolsAllow;
  const rawToolsDeny = (data as Record<string, unknown>).toolsDeny;

  // Parse existing comma-separated tools into arrays
  const toolsAllow: string[] = useMemo(() => {
    const raw = rawToolsAllow;
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === "string" && raw.trim())
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return [];
  }, [rawToolsAllow]);

  const toolsDeny: string[] = useMemo(() => {
    const raw = rawToolsDeny;
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === "string" && raw.trim())
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return [];
  }, [rawToolsDeny]);

  return (
    <>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL + " flex items-center gap-1"}>
          Step label
          <HelpTip text="Short name shown on the canvas. Keep the full prompt below." />
        </label>
        <input
          className={DOCK_INPUT}
          value={data.label || ""}
          onChange={(e) => update("label", e.target.value)}
          placeholder="Research summary, Draft email, Review lead"
        />
      </div>

      <div className="space-y-1.5">
        <label className={DOCK_LABEL + " flex items-center gap-1"}>
          Agent
          <HelpTip text="Which team member does this work?" />
        </label>
        <select
          className={DOCK_INPUT}
          value={data.agentId}
          onChange={(e) => {
            const agent = agents.find((a) => a.id === e.target.value);
            onUpdate(nodeId, {
              ...data,
              agentId: e.target.value,
              agentName: agent?.name || e.target.value,
              agentColor: agent?.color || "#64748b",
            });
          }}
        >
          <option value="">Select agent...</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} {a.role ? `(${a.role})` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Role Prompt — chat-style editor */}
      <div className="space-y-1.5">
        <label className={DOCK_LABEL + " flex items-center gap-1"}>
          Instructions for the agent
          <HelpTip text="Tell the agent what to do in plain English. Be specific about what result you want." />
        </label>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]">
          <textarea
            value={data.rolePrompt}
            onChange={(e) => update("rolePrompt", e.target.value)}
            placeholder="Describe what this agent should do..."
            className="w-full min-h-[120px] p-3 bg-transparent text-sm text-[hsl(var(--foreground))] resize-y outline-none"
          />
          <div className="flex items-center justify-between px-3 py-2 border-t border-[hsl(var(--border))]">
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {data.rolePrompt.length} chars
            </span>
            <button
              onClick={handleAIEnhance}
              disabled={enhancing || !data.rolePrompt.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/25 disabled:opacity-40 transition-colors"
              title="Argent will rewrite your prompt to be clearer and more actionable."
            >
              {enhancing ? (
                <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <span>&#10024;</span>
              )}
              {enhancing ? "Enhancing..." : "AI Enhance"}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className={DOCK_LABEL + " flex items-center gap-1"}>
          Maximum time for this step
          <HelpTip text="Maximum time this step can take. If it takes longer, it stops and moves on." />
        </label>
        <input
          type="number"
          className={DOCK_INPUT}
          value={data.timeout}
          onChange={(e) => update("timeout", parseInt(e.target.value) || 5)}
          min={1}
          max={120}
        />
        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">minutes</p>
      </div>

      <div className="space-y-1.5">
        <label className={DOCK_LABEL + " flex items-center gap-1"}>
          AI Speed vs Quality
          <HelpTip text="Balance speed vs quality. 'Fast' is quick but simpler. 'Powerful' is thorough but slower and costs more." />
        </label>
        <select
          className={DOCK_INPUT}
          value={((data as Record<string, unknown>).modelTier as string) || ""}
          onChange={(e) => update("modelTier", e.target.value || undefined)}
        >
          <option value="">Auto (router decides)</option>
          <option value="local">Local (Ollama)</option>
          <option value="fast">Fast (Haiku)</option>
          <option value="balanced">Balanced (Sonnet)</option>
          <option value="powerful">Powerful (Opus)</option>
        </select>
      </div>

      <ToolPicker
        selected={toolsAllow}
        onChange={(tools) => update("toolsAllow", tools)}
        mode="allow"
        tools={availableTools}
      />

      <ToolPicker
        selected={toolsDeny}
        onChange={(tools) => update("toolsDeny", tools)}
        mode="deny"
        tools={availableTools}
      />

      <div className="flex items-center gap-2.5">
        <input
          type="checkbox"
          id="evidence-check"
          checked={data.evidenceRequired}
          onChange={(e) => update("evidenceRequired", e.target.checked)}
          className="accent-[hsl(var(--primary))] w-4 h-4"
        />
        <label
          htmlFor="evidence-check"
          className="text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-1"
        >
          Must produce a document or file
          <HelpTip text="When turned on, the agent MUST create a document, image, or file to prove it did the work. The evidence appears in your run history and can be reviewed." />
        </label>
      </div>
    </>
  );
}

function ActionForm({
  data,
  onUpdate,
  nodeId,
  gateway,
  connectors,
  knowledgeCollections,
  agents,
  outputChannels,
}: {
  data: ActionNodeData;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  nodeId: string;
  gateway: ReturnType<typeof useGateway>;
  connectors: ConnectorEntry[];
  knowledgeCollections: KnowledgeCollectionOption[];
  agents: FamilyMember[];
  outputChannels: OutputChannelOption[];
}) {
  const update = (field: string, value: unknown) => {
    onUpdate(nodeId, { ...data, [field]: value });
  };
  const cfg = (data.config ?? {}) as Record<string, unknown>;
  const cfgValue = (field: string, fallback: string | number = ""): string | number => {
    const value = cfg[field];
    return typeof value === "string" || typeof value === "number" ? value : fallback;
  };
  const cfgUpdate = (field: string, value: unknown) => {
    update("config", { ...cfg, [field]: value });
  };
  const actionTypes: ActionTypeValue[] = [
    "connector_action",
    "send_message",
    "send_email",
    "save_to_docpanel",
    "webhook_call",
    "api_call",
    "run_script",
    "create_task",
    "store_memory",
    "store_knowledge",
    "generate_image",
    "generate_audio",
  ];
  const runnableConnectors = connectors.filter((connector) => !connector.scaffoldOnly);
  const selectedActionChannelType = String(cfgValue("channelType", "internal_chat"));
  const selectedActionChannel = outputChannels.find(
    (channel) => channel.id === selectedActionChannelType,
  );
  const selectedActionChannelTargets = selectedActionChannel?.targets ?? [];
  const selectedActionChannelTargetIds = new Set(
    selectedActionChannelTargets.map((target) => target.id),
  );
  const selectedActionTargetValue =
    typeof cfg.channelId === "string" && selectedActionChannelTargetIds.has(cfg.channelId)
      ? cfg.channelId
      : "__custom";
  const legacyActionChannelSelected = Boolean(
    selectedActionChannelType &&
    selectedActionChannelType !== "internal_chat" &&
    !selectedActionChannel,
  );
  const selectConnectorAction = (connectorId: string) => {
    const connector = runnableConnectors.find((entry) => entry.id === connectorId);
    onUpdate(nodeId, {
      ...data,
      label: connector?.name ?? data.label,
      actionType: "connector_action",
      config: {
        connectorId,
        connectorName: connector?.name ?? connectorId,
        connectorCategory: connector?.category ?? "general",
      },
    });
  };
  return (
    <>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL + " flex items-center gap-1"}>
          What should happen?
          <HelpTip text="What should happen? Send an email, post a message, call an API, etc." />
        </label>
        <select
          className={DOCK_INPUT}
          value={data.actionType}
          onChange={(e) => {
            const actionType = e.target.value as ActionTypeValue;
            if (actionType === "connector_action") {
              onUpdate(nodeId, {
                ...data,
                actionType,
                config: {
                  connectorId: (data.config?.connectorId as string | undefined) ?? "",
                },
              });
              return;
            }
            update("actionType", actionType);
          }}
        >
          {actionTypes.map((t) => (
            <option key={t} value={t}>
              {ACTION_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {data.actionType === "connector_action" && !cfg.connectorId && (
        <div className="space-y-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2">
          <div className="text-xs text-cyan-100">
            Choose a connector to turn this into a manifest-driven connector action.
          </div>
          <select
            className={DOCK_INPUT}
            value=""
            onChange={(e) => selectConnectorAction(e.target.value)}
          >
            <option value="">Select connector...</option>
            {runnableConnectors.map((connector) => (
              <option key={connector.id} value={connector.id}>
                {connector.name} ({connector.category})
                {connector.readinessState === "setup_required" ? " - needs setup" : ""}
              </option>
            ))}
          </select>
          {runnableConnectors.length === 0 && (
            <div className="text-[10px] text-cyan-100/70">
              No runnable connector manifests are available yet.
            </div>
          )}
        </div>
      )}

      {/* Type-specific config fields — matches what workflow-runner.ts reads from node.config */}
      {data.actionType === "send_message" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Channel</label>
            <select
              className={DOCK_INPUT}
              value={selectedActionChannelType}
              onChange={(e) => cfgUpdate("channelType", e.target.value)}
            >
              <option value="internal_chat">Internal Chat</option>
              {outputChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.label}
                  {channel.configured === false ? " (needs setup)" : ""}
                </option>
              ))}
              {legacyActionChannelSelected && (
                <option value={selectedActionChannelType}>
                  {selectedActionChannelType} (not configured)
                </option>
              )}
            </select>
          </div>
          {outputChannels.length === 0 && selectedActionChannelType !== "internal_chat" && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              No configured chat channels were discovered. Pick Internal Chat or configure a channel
              before sending externally.
            </div>
          )}
          {/* Credential for external channels */}
          {selectedActionChannelType !== "internal_chat" && (
            <CredentialSelector
              connectorId={
                TRIGGER_PROVIDER_CONNECTOR_MAP[selectedActionChannelType] ||
                `aos-${selectedActionChannelType}`
              }
              authKind="service-key"
              requiredSecrets={[]}
              selectedCredentialId={(cfg.credentialId as string) || undefined}
              onChange={(id) => cfgUpdate("credentialId", id ?? "")}
              gatewayRequest={gateway.request}
              gatewayConnected={gateway.connected}
            />
          )}
          {selectedActionChannelTargets.length > 0 && (
            <div className="space-y-1.5">
              <label className={DOCK_LABEL}>Destination</label>
              <select
                className={DOCK_INPUT}
                value={selectedActionTargetValue}
                onChange={(e) => {
                  if (e.target.value !== "__custom") {
                    cfgUpdate("channelId", e.target.value);
                  }
                }}
              >
                {selectedActionChannelTargets.map((target) => (
                  <option key={`${target.kind ?? "target"}:${target.id}`} value={target.id}>
                    {target.label}
                  </option>
                ))}
                <option value="__custom">Custom destination...</option>
              </select>
            </div>
          )}
          {(selectedActionChannelTargets.length === 0 ||
            selectedActionTargetValue === "__custom") && (
            <div className="space-y-1.5">
              <label className={DOCK_LABEL}>Destination</label>
              <input
                className={DOCK_INPUT}
                value={cfgValue("channelId")}
                onChange={(e) => cfgUpdate("channelId", e.target.value)}
                placeholder="chat id, channel id, @handle, or configured alias"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Message Template</label>
            <textarea
              className={DOCK_INPUT + " resize-y"}
              rows={3}
              value={cfgValue("template")}
              onChange={(e) => cfgUpdate("template", e.target.value)}
              placeholder="Hello {{ $json.name }}!"
            />
          </div>
        </>
      )}

      {data.actionType === "send_email" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Provider</label>
            <select
              className={DOCK_INPUT}
              value={cfgValue("provider", "resend")}
              onChange={(e) => cfgUpdate("provider", e.target.value)}
            >
              <option value="resend">Resend</option>
              <option value="mailgun">Mailgun</option>
              <option value="sendgrid">SendGrid</option>
              <option value="smtp">SMTP</option>
            </select>
          </div>
          {/* Credential for email provider */}
          {cfg.provider && (
            <CredentialSelector
              connectorId={
                TRIGGER_PROVIDER_CONNECTOR_MAP[cfg.provider as string] || `aos-${cfg.provider}`
              }
              authKind="service-key"
              requiredSecrets={[]}
              selectedCredentialId={(cfg.credentialId as string) || undefined}
              onChange={(id) => cfgUpdate("credentialId", id ?? "")}
              gatewayRequest={gateway.request}
              gatewayConnected={gateway.connected}
            />
          )}
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>To</label>
            <input
              className={DOCK_INPUT}
              value={cfgValue("to")}
              onChange={(e) => cfgUpdate("to", e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Subject</label>
            <input
              className={DOCK_INPUT}
              value={cfgValue("subject")}
              onChange={(e) => cfgUpdate("subject", e.target.value)}
              placeholder="Re: {{ $json.topic }}"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Body</label>
            <textarea
              className={DOCK_INPUT + " resize-y"}
              rows={4}
              value={cfgValue("bodyTemplate")}
              onChange={(e) => cfgUpdate("bodyTemplate", e.target.value)}
              placeholder="Email body (supports {{ expressions }})"
            />
          </div>
        </>
      )}

      {data.actionType === "create_task" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Title</label>
            <input
              className={DOCK_INPUT}
              value={cfgValue("title")}
              onChange={(e) => cfgUpdate("title", e.target.value)}
              placeholder="Follow up with {{ $json.name }}"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Description</label>
            <textarea
              className={DOCK_INPUT + " resize-y"}
              rows={3}
              value={cfgValue("description")}
              onChange={(e) => cfgUpdate("description", e.target.value)}
              placeholder="Task details..."
            />
          </div>
          <AgentPicker
            label="Assignee"
            value={String(cfgValue("assignee"))}
            onChange={(value) => cfgUpdate("assignee", value)}
            agents={agents}
            placeholder="Select assignee..."
          />
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Priority</label>
            <select
              className={DOCK_INPUT}
              value={cfgValue("priority", "normal")}
              onChange={(e) => cfgUpdate("priority", e.target.value)}
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Project</label>
            <input
              className={DOCK_INPUT}
              value={cfgValue("project")}
              onChange={(e) => cfgUpdate("project", e.target.value)}
              placeholder="Project name"
            />
          </div>
        </>
      )}

      {data.actionType === "store_memory" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Content</label>
            <textarea
              className={DOCK_INPUT + " resize-y"}
              rows={4}
              value={cfgValue("content")}
              onChange={(e) => cfgUpdate("content", e.target.value)}
              placeholder="Memory content or {{ $json.summary }}"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Memory Type</label>
            <select
              className={DOCK_INPUT}
              value={cfgValue("memoryType", "observation")}
              onChange={(e) => cfgUpdate("memoryType", e.target.value)}
            >
              <option value="observation">Observation</option>
              <option value="knowledge">Knowledge</option>
              <option value="interaction">Interaction</option>
              <option value="episode">Episode</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Significance (1-10)</label>
            <input
              type="number"
              className={DOCK_INPUT}
              value={cfgValue("significance", 5)}
              onChange={(e) => cfgUpdate("significance", Number(e.target.value))}
              min={1}
              max={10}
            />
          </div>
        </>
      )}

      {data.actionType === "store_knowledge" && (
        <>
          <KnowledgeCollectionPicker
            label="Collection"
            value={String(cfgValue("collectionId"))}
            onChange={(value) => cfgUpdate("collectionId", value)}
            collections={knowledgeCollections}
            requireWrite
          />
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Content</label>
            <textarea
              className={DOCK_INPUT + " resize-y"}
              rows={4}
              value={cfgValue("content")}
              onChange={(e) => cfgUpdate("content", e.target.value)}
              placeholder="Knowledge to store..."
            />
          </div>
        </>
      )}

      {data.actionType === "generate_image" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Prompt</label>
            <textarea
              className={DOCK_INPUT + " resize-y"}
              rows={3}
              value={cfgValue("prompt")}
              onChange={(e) => cfgUpdate("prompt", e.target.value)}
              placeholder="A futuristic city skyline at sunset"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Model</label>
            <select
              className={DOCK_INPUT}
              value={cfgValue("model", "dall-e-3")}
              onChange={(e) => cfgUpdate("model", e.target.value)}
            >
              <option value="dall-e-3">DALL-E 3</option>
              <option value="dall-e-2">DALL-E 2</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Size</label>
            <select
              className={DOCK_INPUT}
              value={cfgValue("size", "1024x1024")}
              onChange={(e) => cfgUpdate("size", e.target.value)}
            >
              <option value="1024x1024">1024 x 1024</option>
              <option value="1792x1024">1792 x 1024 (wide)</option>
              <option value="1024x1792">1024 x 1792 (tall)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Style</label>
            <select
              className={DOCK_INPUT}
              value={cfgValue("style", "vivid")}
              onChange={(e) => cfgUpdate("style", e.target.value)}
            >
              <option value="vivid">Vivid</option>
              <option value="natural">Natural</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Quality</label>
            <select
              className={DOCK_INPUT}
              value={cfgValue("quality", "standard")}
              onChange={(e) => cfgUpdate("quality", e.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="hd">HD</option>
            </select>
          </div>
        </>
      )}

      {data.actionType === "generate_audio" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Text</label>
            <textarea
              className={DOCK_INPUT + " resize-y"}
              rows={3}
              value={cfgValue("text")}
              onChange={(e) => cfgUpdate("text", e.target.value)}
              placeholder="Text to speak..."
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Voice</label>
            <input
              className={DOCK_INPUT}
              value={cfgValue("voice")}
              onChange={(e) => cfgUpdate("voice", e.target.value)}
              placeholder="Jessica, Lily, alloy..."
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Output Format</label>
            <select
              className={DOCK_INPUT}
              value={cfgValue("format", "mp3")}
              onChange={(e) => cfgUpdate("format", e.target.value)}
            >
              <option value="mp3">MP3</option>
              <option value="wav">WAV</option>
              <option value="ogg">OGG</option>
            </select>
          </div>
        </>
      )}

      {data.actionType === "save_to_docpanel" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Title</label>
            <input
              className={DOCK_INPUT}
              value={cfgValue("title")}
              onChange={(e) => cfgUpdate("title", e.target.value)}
              placeholder="Document title"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Content</label>
            <textarea
              className={DOCK_INPUT + " resize-y"}
              rows={4}
              value={cfgValue("content")}
              onChange={(e) => cfgUpdate("content", e.target.value)}
              placeholder="Document content or {{ $json.report }}"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Format</label>
            <select
              className={DOCK_INPUT}
              value={cfgValue("format", "markdown")}
              onChange={(e) => cfgUpdate("format", e.target.value)}
            >
              <option value="markdown">Markdown</option>
              <option value="html">HTML</option>
              <option value="text">Plain Text</option>
            </select>
          </div>
        </>
      )}

      {(data.actionType === "webhook_call" || data.actionType === "api_call") && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Method</label>
            <select
              className={DOCK_INPUT}
              value={cfgValue("method", "POST")}
              onChange={(e) => cfgUpdate("method", e.target.value)}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>URL</label>
            <input
              className={DOCK_INPUT}
              value={cfgValue("url", cfgValue("endpoint"))}
              onChange={(e) =>
                cfgUpdate(data.actionType === "webhook_call" ? "url" : "endpoint", e.target.value)
              }
              placeholder="https://api.example.com/endpoint"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Headers (JSON)</label>
            <textarea
              className={DOCK_INPUT + " font-mono text-[11px] resize-y"}
              rows={3}
              value={cfgValue("headers")}
              onChange={(e) => cfgUpdate("headers", e.target.value)}
              placeholder='{"Content-Type": "application/json"}'
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Body</label>
            <textarea
              className={DOCK_INPUT + " font-mono text-[11px] resize-y"}
              rows={4}
              value={cfgValue("body")}
              onChange={(e) => cfgUpdate("body", e.target.value)}
              placeholder='{"key": "{{ $json.value }}"}'
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Auth Type</label>
            <select
              className={DOCK_INPUT}
              value={cfgValue("authType", "none")}
              onChange={(e) => cfgUpdate("authType", e.target.value)}
            >
              <option value="none">None</option>
              <option value="bearer">Bearer Token</option>
              <option value="basic">Basic Auth</option>
              <option value="api_key">API Key Header</option>
            </select>
          </div>
          {cfg.authType && cfg.authType !== "none" && (
            <div className="space-y-1.5">
              <label className={DOCK_LABEL}>
                {cfg.authType === "basic" ? "Credentials (user:pass)" : "Token / Key"}
              </label>
              <input
                className={DOCK_INPUT}
                value={cfgValue("authValue")}
                onChange={(e) => cfgUpdate("authValue", e.target.value)}
                placeholder={cfg.authType === "basic" ? "user:password" : "sk-..."}
              />
            </div>
          )}
        </>
      )}

      {data.actionType === "run_script" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Command</label>
            <textarea
              className={DOCK_INPUT + " font-mono text-[11px] resize-y"}
              rows={3}
              value={cfgValue("command")}
              onChange={(e) => cfgUpdate("command", e.target.value)}
              placeholder="node script.js"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Sandboxed</label>
            <select
              className={DOCK_INPUT}
              value={cfg.sandboxed === false ? "false" : "true"}
              onChange={(e) => cfgUpdate("sandboxed", e.target.value === "true")}
            >
              <option value="true">Yes (required)</option>
              <option value="false" disabled>
                No (blocked)
              </option>
            </select>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <label className={DOCK_LABEL + " flex items-center gap-1"}>
          Maximum time for this step
          <HelpTip text="How long to wait for a response before giving up." />
        </label>
        <input
          type="number"
          className={DOCK_INPUT}
          value={Math.round((data.timeoutMs || 30000) / 1000)}
          onChange={(e) => update("timeoutMs", (parseInt(e.target.value) || 30) * 1000)}
          min={1}
          max={300}
        />
        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">seconds</p>
      </div>
    </>
  );
}

function GateForm({
  data,
  onUpdate,
  nodeId,
  appForgeEventOptions,
}: {
  data: GateNodeData;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  nodeId: string;
  appForgeEventOptions: AppForgeEventOption[];
}) {
  const update = (field: string, value: unknown) => {
    onUpdate(nodeId, { ...data, [field]: value });
  };
  const gateTypes: GateTypeValue[] = [
    "condition",
    "switch",
    "parallel",
    "join",
    "wait_duration",
    "wait_event",
    "loop",
    "error_handler",
    "sub_workflow",
    "approval",
  ];
  return (
    <>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL + " flex items-center gap-1"}>
          Flow control
          <HelpTip text="Control the flow. 'If/Then' makes a decision. 'Wait' pauses. 'Approval' asks you to review." />
        </label>
        <select
          className={DOCK_INPUT}
          value={data.gateType}
          onChange={(e) => update("gateType", e.target.value)}
        >
          {gateTypes.map((t) => (
            <option key={t} value={t}>
              {GATE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {/* Condition expression editor */}
      {data.gateType === "condition" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL + " flex items-center gap-1"}>
              Condition Field
              <HelpTip text="What data should we check? Use the name of a field from the previous step." />
            </label>
            <input
              className={DOCK_INPUT}
              value={data.conditionField || ""}
              onChange={(e) => update("conditionField", e.target.value)}
              placeholder="steps.agent1.output.score"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Operator</label>
            <select
              className={DOCK_INPUT}
              value={data.conditionOperator || "=="}
              onChange={(e) => update("conditionOperator", e.target.value)}
            >
              <option value="==">==</option>
              <option value="!=">!=</option>
              <option value=">">&gt;</option>
              <option value="<">&lt;</option>
              <option value=">=">&gt;=</option>
              <option value="<=">&lt;=</option>
              <option value="contains">contains</option>
              <option value="matches">matches</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL + " flex items-center gap-1"}>
              Value
              <HelpTip text="What are we comparing against?" />
            </label>
            <input
              className={DOCK_INPUT}
              value={data.conditionValue || ""}
              onChange={(e) => update("conditionValue", e.target.value)}
              placeholder="true"
            />
          </div>
        </>
      )}

      {/* Branch count for parallel/switch */}
      {(data.gateType === "parallel" || data.gateType === "switch") && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Branches</label>
          <input
            type="number"
            className={DOCK_INPUT}
            value={data.branchCount || 2}
            onChange={(e) => update("branchCount", Math.max(2, parseInt(e.target.value) || 2))}
            min={2}
            max={10}
          />
        </div>
      )}

      {/* Loop config */}
      {data.gateType === "loop" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Max Iterations</label>
          <input
            type="number"
            className={DOCK_INPUT}
            value={data.maxIterations || 10}
            onChange={(e) => update("maxIterations", Math.max(1, parseInt(e.target.value) || 10))}
            min={1}
            max={100}
          />
        </div>
      )}

      {/* Wait duration config */}
      {data.gateType === "wait_duration" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Duration (seconds)</label>
          <input
            type="number"
            className={DOCK_INPUT}
            value={Math.round((data.durationMs || 60000) / 1000)}
            onChange={(e) => update("durationMs", (parseInt(e.target.value) || 60) * 1000)}
            min={1}
            max={86400}
          />
        </div>
      )}

      {/* Wait event config */}
      {data.gateType === "wait_event" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Event Type</label>
            <input
              className={DOCK_INPUT}
              list="workflow-appforge-wait-events"
              value={((data as Record<string, unknown>).eventType as string) || "workflow.event"}
              onChange={(e) => update("eventType", e.target.value)}
              placeholder="appforge.review.completed"
            />
            <datalist id="workflow-appforge-wait-events">
              {appForgeEventOptions.map((event) => (
                <option
                  key={`${event.value}:${event.appId ?? ""}:${event.capabilityId ?? ""}`}
                  value={event.value}
                >
                  {event.label}
                </option>
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Event Filter (JSON)</label>
            <textarea
              className={DOCK_INPUT + " font-mono text-[11px] resize-y"}
              rows={3}
              value={((data as Record<string, unknown>).eventFilterJson as string) || ""}
              onChange={(e) => update("eventFilterJson", e.target.value)}
              placeholder='{"status":"approved"}'
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Timeout (minutes, 0 = no timeout)</label>
            <input
              type="number"
              className={DOCK_INPUT}
              value={data.timeoutMinutes || 0}
              onChange={(e) => update("timeoutMinutes", Math.max(0, parseInt(e.target.value) || 0))}
              min={0}
              max={1440}
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>On Timeout</label>
            <select
              className={DOCK_INPUT}
              value={
                (((data as Record<string, unknown>).timeoutAction as string) || "fail") ===
                "continue"
                  ? "continue"
                  : "fail"
              }
              onChange={(e) => update("timeoutAction", e.target.value)}
            >
              <option value="fail">Fail workflow</option>
              <option value="continue">Continue anyway</option>
            </select>
          </div>
        </>
      )}

      {/* Approval gate config */}
      {data.gateType === "approval" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Review Message</label>
            <textarea
              className={DOCK_INPUT}
              rows={3}
              value={data.approvalMessage || ""}
              onChange={(e) => update("approvalMessage", e.target.value)}
              placeholder="What should the operator review?"
            />
          </div>
          <div className="space-y-1.5 flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.showPreviousOutput ?? true}
              onChange={(e) => update("showPreviousOutput", e.target.checked)}
              className="accent-[#00cccc]"
            />
            <label className={DOCK_LABEL}>Show Previous Output</label>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Timeout (minutes, 0 = no timeout)</label>
            <input
              type="number"
              className={DOCK_INPUT}
              value={data.timeoutMinutes || 0}
              onChange={(e) => update("timeoutMinutes", Math.max(0, parseInt(e.target.value) || 0))}
              min={0}
              max={1440}
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>On Timeout</label>
            <select
              className={DOCK_INPUT}
              value={data.timeoutAction || "deny"}
              onChange={(e) => update("timeoutAction", e.target.value)}
            >
              <option value="deny">Deny &amp; stop pipeline</option>
              <option value="approve">Auto-approve &amp; continue</option>
            </select>
          </div>
        </>
      )}
    </>
  );
}

function appendOutputToken(current: string, token: string): string {
  if (!current.trim()) {
    return token;
  }
  const separator = current.endsWith(" ") || current.endsWith("\n") ? "" : " ";
  return `${current}${separator}${token}`;
}

function outputPayloadPresets(target: OutputNodeData["target"]) {
  return OUTPUT_PAYLOAD_PRESETS.filter((preset) => preset.targets.includes(target));
}

function outputSourceLabel(
  sourceMode: string,
  selectedSourceNodeId: string,
  sourceNodeOptions: Array<{ id: string; label: string; type: string }>,
): string {
  if (sourceMode === "summary") {
    return "Workflow summary";
  }
  if (sourceMode === "custom") {
    return "Custom template";
  }
  if (sourceMode === "node") {
    const selected = sourceNodeOptions.find((node) => node.id === selectedSourceNodeId);
    return selected ? selected.label : "Specific node";
  }
  return "Previous node";
}

function outputDestinationLabel(
  data: OutputNodeData,
  selectedChannel?: OutputChannelOption,
): string {
  const record = data as Record<string, unknown>;
  switch (data.target) {
    case "channel":
    case "discord":
    case "telegram": {
      const channel = selectedChannel?.label ?? record.channelType ?? data.target;
      const target = typeof record.channelId === "string" && record.channelId.trim();
      return target ? `${channel} / ${target}` : String(channel);
    }
    case "email":
      return record.to || record.recipient ? `Email / ${record.to || record.recipient}` : "Email";
    case "webhook":
      return record.url || record.webhookUrl
        ? `Webhook / ${record.url || record.webhookUrl}`
        : "Webhook";
    case "knowledge":
      return record.collectionId ? `Knowledge / ${record.collectionId}` : "Knowledge";
    case "task_update":
      return record.taskId ? `Task update / ${record.taskId}` : "Task update";
    case "next_workflow":
      return record.workflowId ? `Workflow / ${record.workflowId}` : "Start workflow";
    case "connector_action":
      return record.connectorName || record.connectorId
        ? `Connector / ${record.connectorName || record.connectorId}`
        : "Connector action";
    case "variable":
      return "Variable";
    case "doc_panel":
    default:
      return record.title ? `DocPanel / ${record.title}` : "DocPanel";
  }
}

function outputPreviewText(
  template: string,
  sourceMode: string,
  selectedSourceLabel: string,
): string {
  const base =
    template.trim() ||
    (sourceMode === "custom"
      ? ""
      : sourceMode === "summary"
        ? "Workflow completed with summarized step outputs."
        : "{{previous.text}}");
  if (!base.trim()) {
    return "No payload template yet.";
  }
  return base
    .replaceAll("{{previous.text}}", "Example result from the previous step.")
    .replaceAll("{{previous.json}}", '{"status":"ready","items":3}')
    .replaceAll("{{run.id}}", "run_123")
    .replaceAll("{{workflow.name}}", "Workflow name")
    .replaceAll("{{source.label}}", selectedSourceLabel)
    .replaceAll(/\{\{steps\.([^}]+)\}\}/g, "Example step value");
}

function stringifyOutputJson(value: unknown, fallback = "{}"): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function ExecutionDataPanel({
  node,
  latestStep,
  onUpdate,
  onTestToNode,
  testing,
}: {
  node: Node;
  latestStep?: RunStepRecord;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onTestToNode?: (nodeId: string) => void;
  testing?: boolean;
}) {
  const nodeData = node.data as Record<string, unknown>;
  const pinnedOutput = nodeData.pinnedOutput;
  const [draft, setDraft] = useState(() => stringifyOutputJson(pinnedOutput, ""));
  const [error, setError] = useState<string | null>(null);

  const applyPinnedOutput = (value: unknown) => {
    onUpdate(node.id, { ...nodeData, pinnedOutput: value });
  };

  const saveDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onUpdate(node.id, { ...nodeData, pinnedOutput: undefined });
      setError(null);
      return;
    }
    try {
      applyPinnedOutput(JSON.parse(trimmed));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pinLatest = () => {
    if (!latestStep?.output) {
      return;
    }
    const next = latestStep.output;
    setDraft(stringifyOutputJson(next, ""));
    applyPinnedOutput(next);
    setError(null);
  };

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Execution data
          </div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
            Pinned data is used for manual tests so you can build downstream steps without repeating
            expensive or mutating work.
          </div>
        </div>
        {pinnedOutput != null && (
          <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-cyan-200">
            Pinned
          </span>
        )}
      </div>

      <div className="space-y-2">
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Latest run data
          </div>
          {latestStep ? (
            <div className="grid gap-1">
              <RunStepDataPreview label="Input" value={latestStep.input} />
              <RunStepDataPreview label="Output" value={latestStep.output} />
              {!hasRunValue(latestStep.input) && !hasRunValue(latestStep.output) && (
                <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/15 p-2 text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                  This run did not record input or output for this node.
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/15 p-2 text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
              Run or select a run to inspect data.
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Pinned output JSON
          </div>
          <textarea
            className={DOCK_INPUT + " min-h-[96px] resize-y font-mono text-[11px]"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder='{"items":[{"json":{"result":"sample"},"text":"Sample output"}]}'
          />
          {error && <div className="mt-1 text-[10px] text-red-400">Invalid JSON: {error}</div>}
        </div>

        <div className="flex flex-wrap gap-2">
          {onTestToNode && (
            <button
              type="button"
              onClick={() => onTestToNode(node.id)}
              disabled={testing}
              className="rounded-md border border-emerald-400/35 bg-emerald-400/10 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {testing ? "Testing..." : "Test to this node"}
            </button>
          )}
          <button
            type="button"
            onClick={pinLatest}
            disabled={!latestStep?.output}
            className="rounded-md border border-cyan-400/35 bg-cyan-400/10 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Pin latest
          </button>
          <button
            type="button"
            onClick={saveDraft}
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/25 px-2.5 py-1.5 text-[10px] font-semibold text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))]/50"
          >
            Save pinned data
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft("");
              setError(null);
              onUpdate(node.id, { ...nodeData, pinnedOutput: undefined });
            }}
            disabled={pinnedOutput == null && !draft.trim()}
            className="rounded-md border border-[hsl(var(--border))] px-2.5 py-1.5 text-[10px] font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

function KnowledgeCollectionPicker({
  label = "Knowledge collection",
  value,
  onChange,
  collections,
  requireWrite = false,
  placeholder = "Select collection...",
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  collections: KnowledgeCollectionOption[];
  requireWrite?: boolean;
  placeholder?: string;
}) {
  const [customValue, setCustomValue] = useState<string | null>(null);
  const availableCollections = collections.filter((collection) =>
    requireWrite
      ? collection.canWrite || collection.isOwner
      : collection.canRead || collection.isOwner,
  );
  const selectedKnown = availableCollections.some((collection) => collection.collection === value);
  const customMode = customValue !== null && customValue === value;
  const selectValue = customMode || (value && !selectedKnown) ? "__custom" : value;
  const showCustomInput =
    customMode || selectValue === "__custom" || availableCollections.length === 0;

  return (
    <div className="space-y-1.5">
      <label className={DOCK_LABEL}>{label}</label>
      <select
        className={DOCK_INPUT}
        value={selectValue}
        onChange={(event) => {
          if (event.target.value === "__custom") {
            setCustomValue(value);
            return;
          }
          setCustomValue(null);
          onChange(event.target.value);
        }}
      >
        <option value="">{placeholder}</option>
        {availableCollections.map((collection) => (
          <option
            key={collection.collectionId ?? collection.collection}
            value={collection.collection}
          >
            {collection.collection}
            {collection.canWrite || collection.isOwner ? "" : " (read only)"}
          </option>
        ))}
        {value && !selectedKnown && <option value="__custom">Saved custom: {value}</option>}
        <option value="__custom">Custom collection...</option>
      </select>
      {showCustomInput && (
        <input
          className={DOCK_INPUT}
          value={value}
          onChange={(event) => {
            setCustomValue(event.target.value);
            onChange(event.target.value);
          }}
          placeholder="collection name"
        />
      )}
      {availableCollections.length === 0 && (
        <div className="text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
          No {requireWrite ? "writable " : ""}knowledge collections were discovered. You can enter a
          collection name manually for now.
        </div>
      )}
    </div>
  );
}

function bindingKindLabel(kind: WorkflowBindingRequirementKind): string {
  switch (kind) {
    case "credential":
      return "Credential";
    case "connector":
      return "Connector";
    case "channel":
      return "Channel";
    case "appforge_base":
      return "AppForge base";
    case "knowledge_collection":
      return "Knowledge";
    case "agent":
      return "Agent";
  }
}

function requirementMatchesConnector(
  requirement: WorkflowBindingRequirement,
  connector: ConnectorEntry,
): boolean {
  const id = requirement.provider ?? requirement.id;
  return (
    connector.id === requirement.id ||
    connector.id === id ||
    connector.id.includes(id) ||
    connector.name.toLowerCase().includes(id.toLowerCase())
  );
}

function replaceBindingTokens(
  text: string,
  requirement: WorkflowBindingRequirement,
  value: string,
) {
  const tokens = [
    `{{${requirement.id}}}`,
    `{{${requirement.key}}}`,
    `{{credentials.${requirement.id}}}`,
    `{{credentials.${requirement.id}.primary}}`,
    `{{channels.${requirement.id}}}`,
    `{{appforge.${requirement.id}}}`,
  ];
  return tokens.reduce((next, token) => next.split(token).join(value), text);
}

function normalizeAppForgeTablePickerOption(value: unknown): AppForgeTablePickerOption | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  if (!id) {
    return null;
  }
  const fields: Array<{ id?: string; name?: string; type?: string }> = [];
  for (const field of objectArray(value.fields)) {
    if (!isRecord(field)) {
      continue;
    }
    fields.push({
      id: stringValue(field.id) || undefined,
      name: stringValue(field.name) || undefined,
      type: stringValue(field.type) || undefined,
    });
  }
  return {
    id,
    name: stringValue(value.name, id),
    revision: typeof value.revision === "number" ? value.revision : undefined,
    fieldCount:
      typeof value.fieldCount === "number"
        ? value.fieldCount
        : fields.length > 0
          ? fields.length
          : undefined,
    recordCount: typeof value.recordCount === "number" ? value.recordCount : undefined,
    fields,
  };
}

function normalizeAppForgeBasePickerOption(value: unknown): AppForgeBasePickerOption | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  if (!id) {
    return null;
  }
  const tables = objectArray(value.tables)
    .map(normalizeAppForgeTablePickerOption)
    .filter((table): table is AppForgeTablePickerOption => Boolean(table));
  return {
    id,
    name: stringValue(value.name, id),
    appId: stringValue(value.appId) || undefined,
    revision: typeof value.revision === "number" ? value.revision : undefined,
    activeTableId: stringValue(value.activeTableId) || undefined,
    tableCount:
      typeof value.tableCount === "number"
        ? value.tableCount
        : tables.length > 0
          ? tables.length
          : undefined,
    tables,
  };
}

function applyBindingToUnknown(
  value: unknown,
  requirement: WorkflowBindingRequirement,
  binding: WorkflowBindingValue,
): unknown {
  if (typeof value === "string") {
    return replaceBindingTokens(value, requirement, binding.target ?? binding.value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => applyBindingToUnknown(entry, requirement, binding));
  }
  if (!isRecord(value)) {
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = applyBindingToUnknown(entry, requirement, binding);
  }

  if (requirement.kind === "credential") {
    const connectorId = stringValue(next.connectorId);
    const provider = requirement.provider ?? requirement.id.split(".")[0] ?? requirement.id;
    if (
      connectorId === requirement.id ||
      connectorId.includes(provider) ||
      stringValue(next.provider).includes(provider)
    ) {
      next.credentialId = binding.value;
    }
  }
  if (requirement.kind === "connector" && stringValue(next.connectorId) === requirement.id) {
    next.connectorId = binding.value;
    if (binding.label) {
      next.connectorName = binding.label;
    }
  }
  if (requirement.kind === "channel") {
    if (stringValue(next.channelType) === requirement.id) {
      next.channelType = binding.value;
    }
    if (binding.target && !stringValue(next.channelId)) {
      next.channelId = binding.target;
    }
  }
  if (requirement.kind === "appforge_base") {
    if (stringValue(next.appId) === requirement.id) {
      next.appId = binding.value;
    }
    if (stringValue(next.base) === requirement.label || stringValue(next.base) === requirement.id) {
      next.base = binding.value;
    }
    if (!stringValue(next.baseId) || stringValue(next.baseId) === requirement.id) {
      next.baseId = binding.value;
    }
    if (
      binding.target &&
      (!stringValue(next.tableId) || stringValue(next.tableId) === requirement.id)
    ) {
      next.tableId = binding.target;
    }
  }
  if (requirement.kind === "knowledge_collection") {
    if (stringValue(next.collectionId) === requirement.id || !stringValue(next.collectionId)) {
      next.collectionId = binding.value;
    }
  }
  if (requirement.kind === "agent") {
    if (stringValue(next.agentId) === requirement.id || !stringValue(next.agentId)) {
      next.agentId = binding.value;
    }
  }
  return next;
}

function BindingWizard({
  workflow,
  nodes,
  connectors,
  outputChannels,
  knowledgeCollections,
  agents,
  gateway,
  onClose,
  onApply,
}: {
  workflow: WorkflowDefinition;
  nodes: Node[];
  connectors: ConnectorEntry[];
  outputChannels: OutputChannelOption[];
  knowledgeCollections: KnowledgeCollectionOption[];
  agents: FamilyMember[];
  gateway: ReturnType<typeof useGateway>;
  onClose: () => void;
  onApply: (bindings: Record<string, WorkflowBindingValue>) => void;
}) {
  const requirements = workflow.importReport?.requirements ?? [];
  const existingBindings = workflow.importReport?.bindings ?? {};
  const [bindings, setBindings] = useState<Record<string, WorkflowBindingValue>>(existingBindings);
  const updateBinding = (key: string, patch: Partial<WorkflowBindingValue>) => {
    setBindings((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { value: "" }), ...patch },
    }));
  };
  const completeCount = requirements.filter(
    (requirement) => bindings[requirement.key]?.value,
  ).length;
  const hasAppForgeRequirements = requirements.some(
    (requirement) => requirement.kind === "appforge_base",
  );
  const [appForgeBases, setAppForgeBases] = useState<AppForgeBasePickerOption[]>([]);
  const [appForgeTablesByBase, setAppForgeTablesByBase] = useState<
    Record<string, AppForgeTablePickerOption[]>
  >({});
  const [appForgePickerError, setAppForgePickerError] = useState<string | null>(null);
  const appForgeBaseOptions = Array.from(
    new Set(
      nodes
        .flatMap((node) => {
          const record = node.data as Record<string, unknown>;
          return [record.appId, record.appForgeAppId, record.base].filter(
            (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
          );
        })
        .map((entry) => entry.trim()),
    ),
  );
  const loadAppForgeTables = useCallback(
    async (baseId: string) => {
      if (!baseId || !gateway.connected || appForgeTablesByBase[baseId]) {
        return;
      }
      try {
        const res = await gateway.request<{ tables?: unknown[] }>("appforge.tables.list", {
          baseId,
        });
        setAppForgeTablesByBase((prev) => ({
          ...prev,
          [baseId]: (res?.tables ?? [])
            .map(normalizeAppForgeTablePickerOption)
            .filter((table): table is AppForgeTablePickerOption => Boolean(table)),
        }));
      } catch (err) {
        setAppForgePickerError(err instanceof Error ? err.message : String(err));
      }
    },
    [appForgeTablesByBase, gateway],
  );

  useEffect(() => {
    if (!gateway.connected || !hasAppForgeRequirements) {
      return;
    }
    let cancelled = false;
    void gateway
      .request<{ bases?: unknown[] }>("appforge.bases.list", {})
      .then((res) => {
        if (cancelled) {
          return;
        }
        const bases = (res?.bases ?? [])
          .map(normalizeAppForgeBasePickerOption)
          .filter((base): base is AppForgeBasePickerOption => Boolean(base));
        setAppForgeBases(bases);
        setAppForgePickerError(null);
        const tables: Record<string, AppForgeTablePickerOption[]> = {};
        for (const base of bases) {
          if (base.tables?.length) {
            tables[base.id] = base.tables;
          }
        }
        if (Object.keys(tables).length > 0) {
          setAppForgeTablesByBase((prev) => ({ ...tables, ...prev }));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAppForgePickerError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gateway, hasAppForgeRequirements]);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-[min(760px,95vw)] flex-col overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[hsl(var(--border))] px-5 py-4">
          <div>
            <div className="text-base font-semibold text-[hsl(var(--foreground))]">
              Binding wizard
            </div>
            <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              {workflow.importReport?.packageName ?? workflow.name} · {completeCount}/
              {requirements.length} ready for live promotion
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {requirements.length === 0 ? (
            <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-4 text-sm text-emerald-100">
              This package did not declare external live dependencies.
            </div>
          ) : (
            <div className="space-y-3">
              {requirements.map((requirement) => {
                const binding = bindings[requirement.key] ?? { value: "" };
                return (
                  <div
                    key={requirement.key}
                    className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
                          {requirement.label}
                        </div>
                        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                          {bindingKindLabel(requirement.kind)}
                          {requirement.purpose ? ` · ${requirement.purpose}` : ""}
                        </div>
                      </div>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          binding.value
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {binding.value ? "Bound" : "Needs binding"}
                      </span>
                    </div>

                    {requirement.kind === "credential" && (
                      <CredentialSelector
                        connectorId={requirement.provider ?? requirement.id.split(".")[0]}
                        authKind="service-key"
                        requiredSecrets={[]}
                        selectedCredentialId={binding.value}
                        onChange={(credentialId) =>
                          updateBinding(requirement.key, { value: credentialId ?? "" })
                        }
                        gatewayRequest={gateway.request}
                        gatewayConnected={gateway.connected}
                      />
                    )}

                    {requirement.kind === "connector" && (
                      <select
                        className={DOCK_INPUT}
                        value={binding.value}
                        onChange={(event) => {
                          const connector = connectors.find(
                            (entry) => entry.id === event.target.value,
                          );
                          updateBinding(requirement.key, {
                            value: event.target.value,
                            label: connector?.name,
                          });
                        }}
                      >
                        <option value="">Select connector...</option>
                        {connectors
                          .filter((connector) => !connector.scaffoldOnly)
                          .map((connector) => (
                            <option key={connector.id} value={connector.id}>
                              {connector.name}
                              {requirementMatchesConnector(requirement, connector)
                                ? " (match)"
                                : ""}
                            </option>
                          ))}
                      </select>
                    )}

                    {requirement.kind === "channel" && (
                      <div className="grid gap-2 md:grid-cols-2">
                        <select
                          className={DOCK_INPUT}
                          value={binding.value}
                          onChange={(event) => {
                            const channel = outputChannels.find(
                              (entry) => entry.id === event.target.value,
                            );
                            updateBinding(requirement.key, {
                              value: event.target.value,
                              label: channel?.label,
                              target: channel?.targets?.[0]?.id,
                            });
                          }}
                        >
                          <option value="">Select channel...</option>
                          {outputChannels.map((channel) => (
                            <option key={channel.id} value={channel.id}>
                              {channel.label}
                            </option>
                          ))}
                        </select>
                        <select
                          className={DOCK_INPUT}
                          value={binding.target ?? ""}
                          onChange={(event) =>
                            updateBinding(requirement.key, { target: event.target.value })
                          }
                        >
                          <option value="">Default target...</option>
                          {outputChannels
                            .find((channel) => channel.id === binding.value)
                            ?.targets?.map((target) => (
                              <option key={target.id} value={target.id}>
                                {target.label}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {requirement.kind === "knowledge_collection" && (
                      <KnowledgeCollectionPicker
                        label="Knowledge collection"
                        value={binding.value}
                        onChange={(value) => updateBinding(requirement.key, { value })}
                        collections={knowledgeCollections}
                        requireWrite
                      />
                    )}

                    {requirement.kind === "agent" && (
                      <AgentPicker
                        label="Agent"
                        value={binding.value}
                        onChange={(value) => updateBinding(requirement.key, { value })}
                        agents={agents}
                      />
                    )}

                    {requirement.kind === "appforge_base" && (
                      <div className="space-y-1.5">
                        <select
                          className={DOCK_INPUT}
                          value={binding.value}
                          onChange={(event) => {
                            const base = appForgeBases.find(
                              (candidate) => candidate.id === event.target.value,
                            );
                            const firstTableId = base?.activeTableId || base?.tables?.[0]?.id;
                            updateBinding(requirement.key, {
                              value: event.target.value,
                              label: base?.name,
                              target: firstTableId,
                            });
                            if (event.target.value) {
                              void loadAppForgeTables(event.target.value);
                            }
                          }}
                        >
                          <option value="">Select AppForge base...</option>
                          {appForgeBases.map((base) => (
                            <option key={base.id} value={base.id}>
                              {base.name}
                              {base.tableCount ? ` (${base.tableCount} tables)` : ""}
                            </option>
                          ))}
                          {appForgeBaseOptions.map((base) => (
                            <option key={base} value={base}>
                              {base} (canvas value)
                            </option>
                          ))}
                          {binding.value &&
                            !appForgeBaseOptions.includes(binding.value) &&
                            !appForgeBases.some((base) => base.id === binding.value) && (
                              <option value={binding.value}>Saved custom: {binding.value}</option>
                            )}
                        </select>
                        {binding.value && (
                          <select
                            className={DOCK_INPUT}
                            value={binding.target ?? ""}
                            onChange={(event) =>
                              updateBinding(requirement.key, { target: event.target.value })
                            }
                          >
                            <option value="">Default/active table...</option>
                            {(appForgeTablesByBase[binding.value] ?? [])
                              .concat(
                                appForgeBases.find((base) => base.id === binding.value)?.tables ??
                                  [],
                              )
                              .filter(
                                (table, index, all) =>
                                  all.findIndex((candidate) => candidate.id === table.id) === index,
                              )
                              .map((table) => (
                                <option key={table.id} value={table.id}>
                                  {table.name}
                                  {table.fieldCount ? ` (${table.fieldCount} fields)` : ""}
                                </option>
                              ))}
                            {binding.target &&
                              !(appForgeTablesByBase[binding.value] ?? []).some(
                                (table) => table.id === binding.target,
                              ) && (
                                <option value={binding.target}>
                                  Saved table: {binding.target}
                                </option>
                              )}
                          </select>
                        )}
                        <input
                          className={DOCK_INPUT}
                          value={binding.value}
                          onChange={(event) =>
                            updateBinding(requirement.key, { value: event.target.value })
                          }
                          placeholder="Base name or id"
                        />
                        <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                          {appForgePickerError
                            ? `AppForge picker unavailable: ${appForgePickerError}. Manual base binding remains available.`
                            : "AppForge bases and tables load from the gateway picker contract. Manual base binding remains available for empty or legacy states."}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--border))] px-5 py-4">
          <div className="text-xs text-[hsl(var(--muted-foreground))]">
            Applying bindings updates canvas fields and keeps the package in fixture mode until you
            explicitly promote it.
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-2 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
            >
              Close
            </button>
            <button
              onClick={() => onApply(bindings)}
              className="rounded-md bg-[hsl(var(--primary))]/20 px-3 py-2 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/30"
            >
              Apply bindings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentPicker({
  label,
  value,
  onChange,
  agents,
  placeholder = "Select agent...",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  agents: FamilyMember[];
  placeholder?: string;
}) {
  const [customValue, setCustomValue] = useState<string | null>(null);
  const selectedKnown = agents.some((agent) => agent.id === value);
  const customMode = customValue !== null && customValue === value;
  const selectValue = customMode || (value && !selectedKnown) ? "__custom" : value;
  const showCustomInput = customMode || selectValue === "__custom" || agents.length === 0;

  return (
    <div className="space-y-1.5">
      <label className={DOCK_LABEL}>{label}</label>
      <select
        className={DOCK_INPUT}
        value={selectValue}
        onChange={(event) => {
          if (event.target.value === "__custom") {
            setCustomValue(value);
            return;
          }
          setCustomValue(null);
          onChange(event.target.value);
        }}
      >
        <option value="">{placeholder}</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
            {agent.role ? ` (${agent.role})` : ""}
          </option>
        ))}
        {value && !selectedKnown && <option value="__custom">Saved custom: {value}</option>}
        <option value="__custom">Custom agent...</option>
      </select>
      {showCustomInput && (
        <input
          className={DOCK_INPUT}
          value={value}
          onChange={(event) => {
            setCustomValue(event.target.value);
            onChange(event.target.value);
          }}
          placeholder="agent name or id"
        />
      )}
    </div>
  );
}

function WorkflowPicker({
  label,
  value,
  onChange,
  workflows,
  placeholder = "Select workflow...",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  workflows: WorkflowDefinition[];
  placeholder?: string;
}) {
  const [customValue, setCustomValue] = useState<string | null>(null);
  const selectedKnown = workflows.some((workflow) => workflow.id === value);
  const customMode = customValue !== null && customValue === value;
  const selectValue = customMode || (value && !selectedKnown) ? "__custom" : value;
  const showCustomInput = customMode || selectValue === "__custom" || workflows.length === 0;

  return (
    <div className="space-y-1.5">
      <label className={DOCK_LABEL}>{label}</label>
      <select
        className={DOCK_INPUT}
        value={selectValue}
        onChange={(event) => {
          if (event.target.value === "__custom") {
            setCustomValue(value);
            return;
          }
          setCustomValue(null);
          onChange(event.target.value);
        }}
      >
        <option value="">{placeholder}</option>
        {workflows.map((workflow) => (
          <option key={workflow.id} value={workflow.id}>
            {workflow.name || workflow.id}
          </option>
        ))}
        {value && !selectedKnown && <option value="__custom">Saved custom: {value}</option>}
        <option value="__custom">Custom workflow...</option>
      </select>
      {showCustomInput && (
        <input
          className={DOCK_INPUT}
          value={value}
          onChange={(event) => {
            setCustomValue(event.target.value);
            onChange(event.target.value);
          }}
          placeholder="workflow id"
        />
      )}
    </div>
  );
}

function outputSideEffectLabel(target: OutputNodeData["target"]): string {
  switch (target) {
    case "channel":
    case "discord":
    case "telegram":
    case "email":
    case "webhook":
    case "task_update":
    case "next_workflow":
    case "connector_action":
      return "Approval gate required";
    case "knowledge":
    case "doc_panel":
      return "Argent write";
    default:
      return "Not executable";
  }
}

function OutputForm({
  data,
  onUpdate,
  nodeId,
  outputChannels,
  nodes,
  connectors,
  knowledgeCollections,
  workflows,
}: {
  data: OutputNodeData;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  nodeId: string;
  outputChannels: OutputChannelOption[];
  nodes: Node[];
  connectors: ConnectorEntry[];
  knowledgeCollections: KnowledgeCollectionOption[];
  workflows: WorkflowDefinition[];
}) {
  const update = (field: string, value: unknown) => {
    onUpdate(nodeId, { ...data, [field]: value });
  };
  const record = data as Record<string, unknown>;
  const selectedChannelId =
    typeof data.channelType === "string" && data.channelType.trim()
      ? data.channelType.trim()
      : data.target === "discord" || data.target === "telegram"
        ? data.target
        : "";
  const selectValue =
    data.target === "channel" || data.target === "discord" || data.target === "telegram"
      ? selectedChannelId
        ? `channel:${selectedChannelId}`
        : "channel:"
      : data.target === "connector_action" && typeof record.connectorId === "string"
        ? `connector:${record.connectorId}`
        : data.target;
  const selectedChannel = outputChannels.find((channel) => channel.id === selectedChannelId);
  const selectedChannelTargets = selectedChannel?.targets ?? [];
  const selectedChannelTargetIds = new Set(selectedChannelTargets.map((target) => target.id));
  const selectedChannelTargetValue =
    typeof record.channelId === "string" && selectedChannelTargetIds.has(record.channelId)
      ? record.channelId
      : "__custom";
  const selectedChannelNeedsSetup = Boolean(
    selectedChannel && selectedChannel.configured === false,
  );
  const legacyChannelSelected =
    Boolean(selectedChannelId) &&
    (data.target === "channel" || data.target === "discord" || data.target === "telegram") &&
    !selectedChannel;
  const runnableConnectors = connectors.filter(
    (connector) =>
      !connector.scaffoldOnly &&
      connector.readinessState !== "blocked" &&
      connectorOutputCommands(connector).length > 0,
  );
  const selectedConnector =
    typeof record.connectorId === "string"
      ? runnableConnectors.find((connector) => connector.id === record.connectorId)
      : undefined;
  const connectorCommands = connectorOutputCommands(selectedConnector);
  const legacyVariableSelected = data.target === "variable";
  const sourceMode = typeof record.sourceMode === "string" ? record.sourceMode : "previous";
  const sourceNodeOptions = nodes
    .filter((node) => {
      if (node.id === nodeId) {
        return false;
      }
      return ["trigger", "agentStep", "action", "gate", "output"].includes(node.type ?? "");
    })
    .map((node) => {
      const nodeData = node.data as Record<string, unknown>;
      const label =
        typeof nodeData.label === "string" && nodeData.label.trim()
          ? nodeData.label.trim()
          : node.id;
      return {
        id: node.id,
        label,
        type: node.type ?? "node",
      };
    });
  const selectedSourceNodeId = typeof record.sourceNodeId === "string" ? record.sourceNodeId : "";
  const payloadValue =
    data.target === "connector_action"
      ? stringifyOutputJson(
          record.parametersJson ?? record.parameters,
          '{\n  "text": "{{previous.text}}"\n}',
        )
      : sourceMode === "custom" && typeof record.contentTemplate !== "string"
        ? ""
        : data.target === "channel" || data.target === "discord" || data.target === "telegram"
          ? typeof record.template === "string"
            ? record.template
            : typeof record.contentTemplate === "string"
              ? record.contentTemplate
              : "{{previous.text}}"
          : data.target === "email" || data.target === "webhook"
            ? typeof record.bodyTemplate === "string"
              ? record.bodyTemplate
              : typeof record.contentTemplate === "string"
                ? record.contentTemplate
                : data.target === "webhook"
                  ? "{{previous.json}}"
                  : "{{previous.text}}"
            : typeof record.contentTemplate === "string"
              ? record.contentTemplate
              : "{{previous.text}}";
  const selectedSourceLabel = outputSourceLabel(
    sourceMode,
    selectedSourceNodeId,
    sourceNodeOptions,
  );
  const sourceStepTokens =
    sourceMode === "node" && selectedSourceNodeId
      ? [
          { label: "Source text", value: `{{steps.${selectedSourceNodeId}.text}}` },
          { label: "Source JSON", value: `{{steps.${selectedSourceNodeId}.json}}` },
          { label: "Source output text", value: `{{steps.${selectedSourceNodeId}.output.text}}` },
          { label: "Source output JSON", value: `{{steps.${selectedSourceNodeId}.output.json}}` },
        ]
      : [];
  const selectedDestinationLabel = outputDestinationLabel(data, selectedChannel);
  const previewText = outputPreviewText(payloadValue, sourceMode, selectedSourceLabel);
  const sideEffectLabel = outputSideEffectLabel(data.target);
  const payloadPresets = outputPayloadPresets(data.target);
  const activeChannelSummary =
    outputChannels.length > 0
      ? outputChannels.map((channel) => channel.label).join(", ")
      : "No active chat channels detected";
  const connectorDestinationSummary =
    runnableConnectors.length > 0
      ? `${runnableConnectors.length} connector${runnableConnectors.length === 1 ? "" : "s"} available`
      : "No connector action destinations";
  const updatePayload = (value: string) => {
    if (data.target === "connector_action") {
      onUpdate(nodeId, { ...data, parametersJson: value, parameters: value });
      return;
    }
    if (data.target === "channel" || data.target === "discord" || data.target === "telegram") {
      onUpdate(nodeId, { ...data, template: value, contentTemplate: value });
      return;
    }
    if (data.target === "email" || data.target === "webhook") {
      onUpdate(nodeId, { ...data, bodyTemplate: value, contentTemplate: value });
      return;
    }
    update("contentTemplate", value);
  };
  const updateTarget = (value: string) => {
    if (value.startsWith("channel:")) {
      const channelType = value.slice("channel:".length);
      const nextChannel = outputChannels.find((channel) => channel.id === channelType);
      const firstTarget = nextChannel?.targets?.[0]?.id;
      onUpdate(nodeId, {
        ...data,
        target: "channel",
        channelType,
        ...(firstTarget && !(record.channelId as string | undefined)
          ? { channelId: firstTarget }
          : {}),
      });
      return;
    }
    if (value.startsWith("connector:")) {
      const connectorId = value.slice("connector:".length);
      const connector = runnableConnectors.find((entry) => entry.id === connectorId);
      const firstCommand = connectorOutputCommands(connector)[0];
      onUpdate(nodeId, {
        ...data,
        target: "connector_action",
        connectorId,
        connectorName: connector?.name ?? connectorId,
        connectorCategory: connector?.category ?? "general",
        resource: firstCommand?.id?.split(".")[0] ?? "message",
        operation: firstCommand?.id ?? "",
        parametersJson:
          typeof record.parametersJson === "string"
            ? record.parametersJson
            : '{\n  "text": "{{previous.text}}"\n}',
        parameters:
          typeof record.parametersJson === "string"
            ? record.parametersJson
            : '{\n  "text": "{{previous.text}}"\n}',
      });
      return;
    }
    onUpdate(nodeId, { ...data, target: value });
  };
  return (
    <>
      <div className="rounded-lg border border-cyan-400/25 bg-cyan-400/5 p-3">
        <div className="grid grid-cols-[74px_1fr] gap-x-3 gap-y-1.5 text-[11px] leading-relaxed">
          <span className="text-[hsl(var(--muted-foreground))]">Source</span>
          <span className="truncate font-medium text-[hsl(var(--foreground))]">
            {selectedSourceLabel}
          </span>
          <span className="text-[hsl(var(--muted-foreground))]">Payload</span>
          <span className="truncate font-medium text-[hsl(var(--foreground))]">
            {payloadValue.trim() ? "Template rendered at run time" : "No payload"}
          </span>
          <span className="text-[hsl(var(--muted-foreground))]">Destination</span>
          <span className="truncate font-medium text-[hsl(var(--foreground))]">
            {selectedDestinationLabel}
          </span>
          <span className="text-[hsl(var(--muted-foreground))]">Policy</span>
          <span className="font-medium text-amber-200">{sideEffectLabel}</span>
          <span className="text-[hsl(var(--muted-foreground))]">Active channels</span>
          <span className="truncate font-medium text-[hsl(var(--foreground))]">
            {activeChannelSummary}
          </span>
          <span className="text-[hsl(var(--muted-foreground))]">Connector actions</span>
          <span className="truncate font-medium text-[hsl(var(--foreground))]">
            {connectorDestinationSummary}
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className={DOCK_LABEL + " flex items-center gap-1"}>
          Source
          <HelpTip text="Which upstream data should become this output payload." />
        </label>
        <select
          className={DOCK_INPUT}
          value={sourceMode}
          onChange={(e) => update("sourceMode", e.target.value)}
        >
          <option value="previous">Previous node result</option>
          <option value="summary">Full workflow summary</option>
          <option value="node">Specific node result</option>
          <option value="custom">Custom template only</option>
        </select>
      </div>

      {sourceMode === "node" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Source node</label>
          <select
            className={DOCK_INPUT}
            value={selectedSourceNodeId}
            onChange={(e) => update("sourceNodeId", e.target.value)}
          >
            <option value="">Select a node...</option>
            {sourceNodeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} ({option.type})
              </option>
            ))}
            {selectedSourceNodeId &&
              !sourceNodeOptions.some((option) => option.id === selectedSourceNodeId) && (
                <option value={selectedSourceNodeId}>{selectedSourceNodeId} (missing)</option>
              )}
          </select>
        </div>
      )}

      <div className="space-y-1.5">
        <label className={DOCK_LABEL + " flex items-center gap-1"}>
          Destination
          <HelpTip text="Where the rendered output payload should be delivered or stored." />
        </label>
        <select
          className={DOCK_INPUT}
          value={selectValue}
          onChange={(e) => updateTarget(e.target.value)}
        >
          <optgroup label="Local">
            <option value="doc_panel">DocPanel</option>
            <option value="knowledge">Knowledge</option>
            <option value="task_update">Task Manager</option>
            <option value="next_workflow">Start another workflow</option>
          </optgroup>
          {legacyVariableSelected && (
            <option value="variable" disabled>
              Variable (not executable yet)
            </option>
          )}
          {outputChannels.length > 0 ? (
            <optgroup label="Configured channels">
              {outputChannels.map((channel) => (
                <option key={channel.id} value={`channel:${channel.id}`}>
                  {channel.label}
                  {channel.configured === false ? " (needs setup)" : ""}
                </option>
              ))}
            </optgroup>
          ) : (
            <option value="__no_channels" disabled>
              No configured chat channels
            </option>
          )}
          {legacyChannelSelected && (
            <option value={`channel:${selectedChannelId}`} disabled>
              {selectedChannelId} (not configured)
            </option>
          )}
          {runnableConnectors.length > 0 && (
            <optgroup label="Connector actions">
              {runnableConnectors.map((connector) => (
                <option key={connector.id} value={`connector:${connector.id}`}>
                  {connector.name}
                  {connector.readinessState === "setup_required" ? " (needs setup)" : ""}
                  {` - ${connectorOutputCommands(connector).length} action${connectorOutputCommands(connector).length === 1 ? "" : "s"}`}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Manual endpoints">
            <option value="email">Email</option>
            <option value="webhook">Webhook</option>
          </optgroup>
        </select>
      </div>

      {(legacyChannelSelected || selectedChannelNeedsSetup) && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {selectedChannel?.statusLabel ||
            `${selectedChannelId} is not currently configured as a workflow output channel.`}
        </div>
      )}

      {data.target === "email" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Recipient</label>
            <input
              className={DOCK_INPUT}
              value={(record.recipient as string) || (record.to as string) || ""}
              onChange={(e) => {
                update("recipient", e.target.value);
              }}
              placeholder="user@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Subject</label>
            <input
              className={DOCK_INPUT}
              value={(record.subject as string) || ""}
              onChange={(e) => update("subject", e.target.value)}
              placeholder="Workflow output"
            />
          </div>
        </>
      )}
      {data.target === "webhook" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Webhook URL</label>
            <input
              className={DOCK_INPUT}
              value={(record.webhookUrl as string) || (record.url as string) || ""}
              onChange={(e) => update("webhookUrl", e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Method</label>
            <select
              className={DOCK_INPUT}
              value={(record.method as string) || "POST"}
              onChange={(e) => update("method", e.target.value)}
            >
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="GET">GET</option>
            </select>
          </div>
        </>
      )}
      {(data.target === "channel" || data.target === "discord" || data.target === "telegram") && (
        <>
          {selectedChannelTargets.length > 0 && (
            <div className="space-y-1.5">
              <label className={DOCK_LABEL}>
                {(selectedChannel?.label ?? selectedChannelId) || "Channel"} destination
              </label>
              <select
                className={DOCK_INPUT}
                value={selectedChannelTargetValue}
                onChange={(e) => {
                  if (e.target.value !== "__custom") {
                    update("channelId", e.target.value);
                  }
                }}
              >
                {selectedChannelTargets.map((target) => (
                  <option key={`${target.kind ?? "target"}:${target.id}`} value={target.id}>
                    {target.label}
                  </option>
                ))}
                <option value="__custom">Custom target...</option>
              </select>
            </div>
          )}
          {(selectedChannelTargets.length === 0 || selectedChannelTargetValue === "__custom") && (
            <div className="space-y-1.5">
              <label className={DOCK_LABEL}>
                {(selectedChannel?.label ?? selectedChannelId) || "Channel"} target
              </label>
              <input
                className={DOCK_INPUT}
                value={(record.channelId as string) || ""}
                onChange={(e) => update("channelId", e.target.value)}
                placeholder="chat id, channel id, @handle, or configured alias"
              />
            </div>
          )}
        </>
      )}

      {data.target === "connector_action" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Connector</label>
            <select
              className={DOCK_INPUT}
              value={(record.connectorId as string) || ""}
              onChange={(e) => updateTarget(`connector:${e.target.value}`)}
            >
              <option value="">Select connector...</option>
              {runnableConnectors.map((connector) => (
                <option key={connector.id} value={connector.id}>
                  {connector.name} ({connector.category})
                  {` - ${connectorOutputCommands(connector).length} action${connectorOutputCommands(connector).length === 1 ? "" : "s"}`}
                </option>
              ))}
            </select>
          </div>
          {selectedConnector?.readinessState === "setup_required" && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {selectedConnector.name} is available to design with, but it still needs operator
              setup before a live run can deliver through it.
            </div>
          )}
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Operation</label>
            <select
              className={DOCK_INPUT}
              value={(record.operation as string) || ""}
              onChange={(e) => {
                const operation = e.target.value;
                onUpdate(nodeId, {
                  ...data,
                  operation,
                  ...(!record.resource && operation.includes(".")
                    ? { resource: operation.split(".")[0] }
                    : {}),
                });
              }}
            >
              <option value="">Select operation...</option>
              {connectorCommands.map((command) => (
                <option key={command.id} value={command.id}>
                  {connectorCommandLabel(command)}
                </option>
              ))}
            </select>
          </div>
          {connectorCommands.length === 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              This connector is visible but has no manifest command surfaced for workflow output
              delivery yet.
            </div>
          )}
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Resource</label>
            <input
              className={DOCK_INPUT}
              value={(record.resource as string) || ""}
              onChange={(e) => update("resource", e.target.value)}
              placeholder="message"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL + " flex items-center gap-1"}>
              Credential ID
              <HelpTip text="Optional workflow credential record. Operator service keys remain the preferred connector auth path." />
            </label>
            <input
              className={DOCK_INPUT}
              value={(record.credentialId as string) || ""}
              onChange={(e) => update("credentialId", e.target.value)}
              placeholder="optional"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL + " flex items-center gap-1"}>
              Output mapping
              <HelpTip text="Optional JSON object mapping workflow output fields to connector response paths." />
            </label>
            <textarea
              className={DOCK_INPUT + " font-mono text-[11px] resize-y"}
              rows={3}
              value={stringifyOutputJson(record.outputMappingJson ?? record.outputMapping, "")}
              onChange={(e) => {
                onUpdate(nodeId, {
                  ...data,
                  outputMappingJson: e.target.value,
                  outputMapping: e.target.value,
                });
              }}
              placeholder='{"messageId": "json.id"}'
            />
          </div>
        </>
      )}

      {data.target === "knowledge" && (
        <KnowledgeCollectionPicker
          label="Collection"
          value={(record.collectionId as string) || ""}
          onChange={(value) => update("collectionId", value)}
          collections={knowledgeCollections}
          requireWrite
          placeholder="Select output collection..."
        />
      )}

      {data.target === "task_update" && (
        <>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Task ID</label>
            <input
              className={DOCK_INPUT}
              value={(record.taskId as string) || ""}
              onChange={(e) => update("taskId", e.target.value)}
              placeholder="task id or {{previous.json.taskId}}"
            />
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Status</label>
            <select
              className={DOCK_INPUT}
              value={(record.status as string) || "completed"}
              onChange={(e) => update("status", e.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="blocked">Blocked</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={DOCK_LABEL}>Evidence template</label>
            <textarea
              className={DOCK_INPUT + " resize-y"}
              rows={3}
              value={(record.evidence as string) || payloadValue}
              onChange={(e) => update("evidence", e.target.value)}
              placeholder="{{previous.text}}"
            />
          </div>
        </>
      )}

      {data.target === "next_workflow" && (
        <>
          <WorkflowPicker
            label="Workflow"
            value={(record.workflowId as string) || ""}
            onChange={(value) => update("workflowId", value)}
            workflows={workflows}
          />
          <div className="space-y-1.5">
            <label className={DOCK_LABEL + " flex items-center gap-1"}>
              Input mapping
              <HelpTip text="Optional JSON object mapping next workflow input fields to previous output paths." />
            </label>
            <textarea
              className={DOCK_INPUT + " font-mono text-[11px] resize-y"}
              rows={3}
              value={(record.inputMapping as string) || ""}
              onChange={(e) => update("inputMapping", e.target.value)}
              placeholder='{"brief": "text", "score": "json.score"}'
            />
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <label className={DOCK_LABEL + " flex items-center gap-1"}>
          Payload template
          <HelpTip text="This is the actual content delivered by the output node. Use {{previous.text}} for the prior step or choose a source above." />
        </label>
        {payloadPresets.length > 0 && (
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/15 p-2">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Payload presets
            </div>
            <div className="flex flex-wrap gap-1.5">
              {payloadPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="rounded-md border border-cyan-400/25 bg-cyan-400/5 px-2 py-1 text-[10px] font-medium text-cyan-200 hover:bg-cyan-400/10"
                  onClick={() => updatePayload(preset.template)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {[...OUTPUT_TEMPLATE_TOKENS, ...sourceStepTokens].map((token) => (
            <button
              key={token.value}
              type="button"
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/25 px-2 py-1 text-[10px] font-medium text-[hsl(var(--muted-foreground))] hover:border-cyan-400/60 hover:text-cyan-200"
              onClick={() => updatePayload(appendOutputToken(payloadValue, token.value))}
            >
              {token.label}
            </button>
          ))}
        </div>
        <textarea
          className={DOCK_INPUT + " resize-y"}
          rows={4}
          value={payloadValue}
          onChange={(e) => updatePayload(e.target.value)}
          placeholder="{{previous.text}}"
        />
      </div>

      <div className="space-y-1.5">
        <label className={DOCK_LABEL}>Rendered preview</label>
        <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-2 text-[11px] leading-relaxed text-[hsl(var(--foreground))]">
          {previewText}
        </pre>
      </div>

      {(data.target === "doc_panel" || data.target === "knowledge") && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Format</label>
          <select
            className={DOCK_INPUT}
            value={data.format || "markdown"}
            onChange={(e) => update("format", e.target.value)}
          >
            <option value="markdown">Markdown</option>
            <option value="text">Plain text</option>
            <option value="json">JSON</option>
          </select>
        </div>
      )}

      {data.target === "doc_panel" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Document title</label>
          <input
            className={DOCK_INPUT}
            value={(record.title as string) || ""}
            onChange={(e) =>
              onUpdate(nodeId, { ...data, title: e.target.value, label: e.target.value })
            }
            placeholder="Workflow output"
          />
        </div>
      )}

      {data.target !== "doc_panel" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Output name</label>
          <input
            className={DOCK_INPUT}
            value={(record.title as string) || ""}
            onChange={(e) =>
              onUpdate(nodeId, { ...data, title: e.target.value, label: e.target.value })
            }
            placeholder="Delivery step"
          />
        </div>
      )}
    </>
  );
}

// ── Sub-Port Forms ──────────────────────────────────────────────────

function ModelProviderForm({
  data,
  onUpdate,
  nodeId,
}: {
  data: SubPortNodeData;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  nodeId: string;
}) {
  const cfg = data.config ?? {};
  const update = (field: string, value: unknown) => {
    onUpdate(nodeId, { ...data, config: { ...cfg, [field]: value } });
  };
  return (
    <>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL}>Provider</label>
        <select
          className={DOCK_INPUT}
          value={(cfg.provider as string) || "anthropic"}
          onChange={(e) => update("provider", e.target.value)}
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama (Local)</option>
          <option value="google">Google</option>
          <option value="minimax">MiniMax</option>
          <option value="zai">Z.AI</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL}>Model</label>
        <input
          className={DOCK_INPUT}
          value={(cfg.model as string) || ""}
          onChange={(e) => update("model", e.target.value)}
          placeholder="claude-sonnet-4-6"
        />
      </div>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL}>Temperature</label>
        <input
          type="number"
          className={DOCK_INPUT}
          value={cfg.temperature != null ? Number(cfg.temperature) : ""}
          onChange={(e) =>
            update("temperature", e.target.value === "" ? undefined : Number(e.target.value))
          }
          placeholder="0.7"
          min={0}
          max={2}
          step={0.1}
        />
      </div>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL}>Max Tokens</label>
        <input
          type="number"
          className={DOCK_INPUT}
          value={cfg.maxTokens != null ? Number(cfg.maxTokens) : ""}
          onChange={(e) =>
            update("maxTokens", e.target.value === "" ? undefined : Number(e.target.value))
          }
          placeholder="4096"
        />
      </div>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL}>Thinking Level</label>
        <select
          className={DOCK_INPUT}
          value={(cfg.thinkingLevel as string) || "none"}
          onChange={(e) => update("thinkingLevel", e.target.value)}
        >
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
    </>
  );
}

function MemorySourceForm({
  data,
  onUpdate,
  nodeId,
  knowledgeCollections,
  agents,
}: {
  data: SubPortNodeData;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  nodeId: string;
  knowledgeCollections: KnowledgeCollectionOption[];
  agents: FamilyMember[];
}) {
  const cfg = data.config ?? {};
  const update = (field: string, value: unknown) => {
    onUpdate(nodeId, { ...data, config: { ...cfg, [field]: value } });
  };
  return (
    <>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL}>Source Type</label>
        <select
          className={DOCK_INPUT}
          value={(cfg.sourceType as string) || "knowledge_collection"}
          onChange={(e) => update("sourceType", e.target.value)}
        >
          <option value="knowledge_collection">Knowledge Collection</option>
          <option value="conversation_history">Conversation History</option>
          <option value="agent_memory">Agent Memory</option>
          <option value="custom_context">Custom Context</option>
        </select>
      </div>
      {cfg.sourceType === "knowledge_collection" && (
        <KnowledgeCollectionPicker
          label="Collection"
          value={(cfg.collectionId as string) || ""}
          onChange={(value) => update("collectionId", value)}
          collections={knowledgeCollections}
          placeholder="Select knowledge base..."
        />
      )}
      {cfg.sourceType === "agent_memory" && (
        <AgentPicker
          label="Agent"
          value={(cfg.agentId as string) || ""}
          onChange={(value) => update("agentId", value)}
          agents={agents}
        />
      )}
      <div className="space-y-1.5">
        <label className={DOCK_LABEL}>Search Query</label>
        <input
          className={DOCK_INPUT}
          value={(cfg.searchQuery as string) || ""}
          onChange={(e) => update("searchQuery", e.target.value)}
          placeholder="Optional filter query..."
        />
      </div>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL}>Max Items</label>
        <input
          type="number"
          className={DOCK_INPUT}
          value={cfg.maxItems != null ? Number(cfg.maxItems) : ""}
          onChange={(e) =>
            update("maxItems", e.target.value === "" ? undefined : Number(e.target.value))
          }
          placeholder="10"
        />
      </div>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL}>Time Range</label>
        <select
          className={DOCK_INPUT}
          value={(cfg.timeRange as string) || "all"}
          onChange={(e) => update("timeRange", e.target.value)}
        >
          <option value="last_24h">Last 24 hours</option>
          <option value="last_7d">Last 7 days</option>
          <option value="last_30d">Last 30 days</option>
          <option value="all">All time</option>
        </select>
      </div>
    </>
  );
}

function ToolGrantForm({
  data,
  onUpdate,
  nodeId,
  connectors,
  availableTools,
}: {
  data: SubPortNodeData;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  nodeId: string;
  connectors: ConnectorEntry[];
  availableTools: ToolPaletteEntry[];
}) {
  const cfg = data.config ?? {};
  const runnableTools = availableTools.filter((tool) => tool.source !== "connector");
  const groupedRunnableTools = groupToolsBySource(runnableTools);
  const selectedConnector = connectors.find((connector) => connector.id === cfg.connectorId);
  const selectedTool = runnableTools.find((tool) => tool.id === cfg.toolName);
  const update = (field: string, value: unknown) => {
    onUpdate(nodeId, { ...data, config: { ...cfg, [field]: value } });
  };
  const updateGrantType = (grantType: string) => {
    onUpdate(nodeId, {
      ...data,
      config: {
        grantType,
        permissions: cfg.permissions ?? "readonly",
      },
    });
  };
  const updateConnectorGrant = (connectorId: string) => {
    const connector = connectors.find((entry) => entry.id === connectorId);
    onUpdate(nodeId, {
      ...data,
      config: {
        ...cfg,
        connectorId,
        capabilityId: connectorId,
        name: connector?.name ?? connectorId,
        source: "connector",
      },
    });
  };
  const updateToolGrant = (toolName: string) => {
    const tool = runnableTools.find((entry) => entry.id === toolName);
    onUpdate(nodeId, {
      ...data,
      config: {
        ...cfg,
        toolName,
        capabilityId: toolName,
        name: tool?.name ?? toolName,
        source: tool?.source ?? "core",
      },
    });
  };
  return (
    <>
      <div className="space-y-1.5">
        <label className={DOCK_LABEL}>Grant Type</label>
        <select
          className={DOCK_INPUT}
          value={(cfg.grantType as string) || "connector"}
          onChange={(e) => updateGrantType(e.target.value)}
        >
          <option value="connector">Connector Action</option>
          <option value="builtin_tool">Agent Tool</option>
          <option value="tool_set">Tool Set Preset</option>
        </select>
      </div>
      {cfg.grantType === "connector" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Connector</label>
          <select
            className={DOCK_INPUT}
            value={(cfg.connectorId as string) || ""}
            onChange={(e) => updateConnectorGrant(e.target.value)}
          >
            <option value="">Select connector...</option>
            {connectors
              .filter((c) => !c.scaffoldOnly)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.category})
                </option>
              ))}
          </select>
          {selectedConnector && (
            <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium text-[hsl(var(--foreground))]">
                  {selectedConnector.name}
                </span>
                <CapabilitySourceBadge source="connector" />
              </div>
              <div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                {selectedConnector.category}
                {selectedConnector.readinessState === "setup_required" && " · needs setup"}
                {selectedConnector.scaffoldOnly && " · contract only"}
              </div>
            </div>
          )}
        </div>
      )}
      {cfg.grantType === "builtin_tool" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Tool Name</label>
          <select
            className={DOCK_INPUT}
            value={(cfg.toolName as string) || ""}
            onChange={(e) => updateToolGrant(e.target.value)}
          >
            <option value="">Select tool...</option>
            {groupedRunnableTools.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.tools.map((tool) => (
                  <option key={tool.id} value={tool.id}>
                    {tool.name}
                    {tool.desc ? ` — ${tool.desc}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {selectedTool && (
            <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium text-[hsl(var(--foreground))]">
                  {selectedTool.name}
                </span>
                <CapabilitySourceBadge source={selectedTool.source} />
              </div>
              {selectedTool.desc && (
                <div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                  {selectedTool.desc}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {cfg.grantType === "tool_set" && (
        <div className="space-y-1.5">
          <label className={DOCK_LABEL}>Preset</label>
          <select
            className={DOCK_INPUT}
            value={(cfg.toolSetPreset as string) || ""}
            onChange={(e) => update("toolSetPreset", e.target.value)}
          >
            <option value="">Select preset...</option>
            <option value="web_search">Web Search</option>
            <option value="code_execution">Code Execution</option>
            <option value="file_management">File Management</option>
          </select>
        </div>
      )}
      <div className="space-y-1.5">
        <label className={DOCK_LABEL}>Permissions</label>
        <select
          className={DOCK_INPUT}
          value={(cfg.permissions as string) || "readonly"}
          onChange={(e) => update("permissions", e.target.value)}
        >
          <option value="readonly">Read Only</option>
          <option value="readwrite">Read + Write</option>
        </select>
      </div>
    </>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────────

interface ConnectorEntry {
  id: string;
  name: string;
  category: string;
  categories: string[];
  commands: Array<{ id: string; summary?: string; actionClass?: string }>;
  installState: string;
  statusOk: boolean;
  scaffoldOnly?: boolean;
  readinessState?: "blocked" | "setup_required" | "read_ready" | "write_ready";
}

function connectorIcon(category: string): string {
  const icons: Record<string, string> = {
    inbox: "\uD83D\uDCE7",
    "ticket-queue": "\uD83D\uDCCB",
    "alert-stream": "\uD83D\uDD14",
    "files-docs": "\uD83D\uDCC4",
    calendar: "\uD83D\uDCC5",
    crm: "\uD83D\uDC65",
    "social-publishing": "\uD83D\uDCF1",
    accounting: "\uD83D\uDCB0",
    table: "\uD83D\uDCCA",
    general: "\uD83D\uDD0C",
  };
  return icons[category] ?? "\uD83D\uDD0C";
}

function isConnectorOutputCommand(command: { id: string; actionClass?: string }): boolean {
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

function connectorOutputCommands(connector?: ConnectorEntry) {
  const commands = connector?.commands.filter(isConnectorOutputCommand) ?? [];
  return [...commands].sort((a, b) => a.id.localeCompare(b.id));
}

function connectorCommandLabel(command: { id: string; summary?: string; actionClass?: string }) {
  const summary = stringValue(command.summary);
  if (summary) {
    return `${command.id} - ${summary}`;
  }
  return command.actionClass ? `${command.id} (${command.actionClass})` : command.id;
}

function hasRunValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length > 0;
  }
  return true;
}

function truncateInline(value: string, maxLength = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
}

function runValueSummary(value: unknown): string {
  if (!hasRunValue(value)) {
    return "No data";
  }
  if (typeof value === "string") {
    return truncateInline(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const first = value[0];
    const suffix = value.length === 1 ? "item" : "items";
    return first === undefined
      ? `${value.length} ${suffix}`
      : `${value.length} ${suffix}: ${runValueSummary(first)}`;
  }
  if (isRecord(value)) {
    const items = Array.isArray(value.items) ? value.items : undefined;
    if (items && items.length > 0) {
      return runValueSummary(items);
    }
    const text = stringValue(value.text);
    if (text) {
      return truncateInline(text);
    }
    if (isRecord(value.json)) {
      return runValueSummary(value.json);
    }
    const keys = Object.keys(value);
    const json = truncateInline(safeJson(value), 180);
    return json || keys.join(", ");
  }
  return truncateInline(String(value));
}

function runValueDetail(value: unknown): string {
  const detail = typeof value === "string" ? value : safeJson(value);
  return detail.length > 4000 ? `${detail.slice(0, 4000)}...` : detail;
}

function RunStepDataPreview({ label, value }: { label: string; value: unknown }) {
  if (!hasRunValue(value)) {
    return null;
  }
  return (
    <div
      className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 px-1.5 py-1"
      title={runValueDetail(value)}
    >
      <div className="text-[8px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {label}
      </div>
      <div className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-[hsl(var(--foreground))]">
        {runValueSummary(value)}
      </div>
    </div>
  );
}

interface SidebarProps {
  workflows: WorkflowDefinition[];
  activeWorkflowId: string | null;
  onSelectWorkflow: (id: string) => void;
  onNewWorkflow: () => void;
  onDuplicateWorkflow: (id: string) => void | Promise<void>;
  onToggleWorkflowActive: (id: string, isActive: boolean) => void | Promise<void>;
  onDeleteWorkflow: (id: string) => void;
  onExportWorkflow: (workflow: WorkflowDefinition) => void;
  onImportWorkflowFile: (file: File) => void | Promise<void>;
  runs: RunRecord[];
  onSelectRun: (run: RunRecord) => void;
  onRetryFromStep?: (workflowId: string, runId: string, fromStepNodeId: string) => void;
  connectors: ConnectorEntry[];
}

function Sidebar({
  workflows,
  activeWorkflowId,
  onSelectWorkflow,
  onNewWorkflow,
  onDuplicateWorkflow,
  onToggleWorkflowActive,
  onDeleteWorkflow,
  onExportWorkflow,
  onImportWorkflowFile,
  runs,
  onSelectRun,
  onRetryFromStep,
  connectors,
}: SidebarProps) {
  const [runHistoryOpen, setRunHistoryOpen] = useState(true);
  const [workflowQuery, setWorkflowQuery] = useState("");
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const onDragStart = (event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept =
      ".json,.yaml,.yml,.argent-workflow.json,.argent-workflow.yaml,.argent-workflow.yml";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      void onImportWorkflowFile(file);
    };
    input.click();
  };

  const paletteItems = [
    { type: "trigger", icon: "\u26A1", label: "Trigger", desc: "Start condition" },
    { type: "agentStep", icon: "\uD83E\uDD16", label: "Agent Step", desc: "Agent does work" },
    { type: "action", icon: "\u2699\uFE0F", label: "Action", desc: "Deterministic op" },
    { type: "gate", icon: "\u25C6", label: "Gate", desc: "Control flow" },
    { type: "output", icon: "\uD83D\uDCE4", label: "Output", desc: "Deliver results" },
  ];
  const activeWorkflow = workflows.find((workflow) => workflow.id === activeWorkflowId);
  const filteredWorkflows = workflows.filter((workflow) =>
    workflow.name.toLowerCase().includes(workflowQuery.trim().toLowerCase()),
  );

  const subPortPaletteItems = [
    { type: "modelProvider", icon: "\uD83E\uDDE0", label: "Model", desc: "Override LLM model" },
    { type: "memorySource", icon: "\uD83D\uDCDA", label: "Memory", desc: "Knowledge context" },
    { type: "toolGrant", icon: "\uD83D\uDD27", label: "Tool", desc: "Grant tool/connector" },
  ];

  return (
    <div
      className="w-[200px] flex-shrink-0 border-r border-[hsl(var(--border))] flex flex-col overflow-hidden"
      style={{ background: "hsl(var(--card))" }}
    >
      {/* Node palette */}
      <div className="p-3 border-b border-[hsl(var(--border))]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
            Nodes
          </div>
          <CapabilitySourceBadge />
        </div>
        <div className="flex flex-col gap-1.5">
          {paletteItems.map((item) => (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => onDragStart(e, item.type)}
              className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-[hsl(var(--border))] cursor-grab active:cursor-grabbing hover:border-[hsl(var(--primary))]/50 transition-colors"
              style={{ background: "hsl(var(--background))" }}
            >
              <span className="text-sm">{item.icon}</span>
              <div>
                <div className="text-[11px] font-medium text-[hsl(var(--foreground))]">
                  {item.label}
                </div>
                <div className="text-[9px] text-[hsl(var(--muted-foreground))]">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Configuration — sub-port nodes for Agent */}
      <div className="p-3 border-b border-[hsl(var(--border))]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
            Configuration
          </div>
          <span className="text-[9px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Agent bindings
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {subPortPaletteItems.map((item) => (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => onDragStart(e, item.type)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-dashed border-[hsl(var(--border))] cursor-grab active:cursor-grabbing hover:border-[hsl(var(--primary))]/50 transition-colors"
              style={{ background: "hsl(var(--background))" }}
            >
              <span className="text-sm">{item.icon}</span>
              <div>
                <div className="text-[11px] font-medium text-[hsl(var(--foreground))]">
                  {item.label}
                </div>
                <div className="text-[9px] text-[hsl(var(--muted-foreground))]">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Connectors — auto-populated from catalog */}
      {connectors.length > 0 && (
        <div className="p-3 border-b border-[hsl(var(--border))]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
              Connectors
            </div>
            <CapabilitySourceBadge source="connector" />
          </div>
          <div className="flex flex-col gap-1">
            {connectors.map((c) => {
              const isBlocked = c.readinessState === "blocked" || c.scaffoldOnly;
              return (
                <div
                  key={c.id}
                  draggable={!isBlocked}
                  onDragStart={(e) => {
                    if (isBlocked) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData("application/reactflow", "action");
                    e.dataTransfer.setData(
                      "application/reactflow-connector",
                      JSON.stringify({
                        id: c.id,
                        name: c.name,
                        category: c.category,
                      }),
                    );
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors ${
                    isBlocked
                      ? "opacity-40 cursor-not-allowed"
                      : "cursor-grab active:cursor-grabbing hover:bg-[hsl(var(--muted))]/30"
                  }`}
                  title={
                    isBlocked
                      ? `${c.name} — contract only (no runtime)`
                      : `${c.name} (${c.installState})`
                  }
                >
                  <span className="text-sm">{connectorIcon(c.category)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium text-[hsl(var(--foreground))] capitalize truncate flex items-center gap-1">
                      {c.name}
                      {isBlocked && (
                        <span className="text-[8px] font-semibold text-red-400 bg-red-500/10 px-1 py-0.5 rounded uppercase leading-none">
                          No Runtime
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-[hsl(var(--muted-foreground))]">
                      {c.category}
                      {!isBlocked && c.readinessState === "setup_required" && " \u2022 needs setup"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Saved workflows */}
      <div className="flex-1 overflow-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
            Workflows
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleImport}
              className="text-[10px] px-1.5 py-0.5 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/50 transition-colors"
              title="Import workflow"
            >
              Import
            </button>
            <button
              onClick={onNewWorkflow}
              className="text-[10px] px-1.5 py-0.5 rounded text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 transition-colors"
            >
              + New
            </button>
          </div>
        </div>
        <input
          className="mb-2 w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-[11px] text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))]/70"
          value={workflowQuery}
          onChange={(e) => setWorkflowQuery(e.target.value)}
          placeholder="Search workflows..."
        />
        {workflows.length === 0 ? (
          <div className="text-[10px] text-[hsl(var(--muted-foreground))] italic">
            No workflows yet
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="text-[10px] text-[hsl(var(--muted-foreground))] italic">
            No matching workflows
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filteredWorkflows.map((wf) => (
              <div
                key={wf.id}
                className={`group rounded-md px-2 py-1.5 text-[11px] cursor-pointer transition-colors ${
                  activeWorkflowId === wf.id
                    ? "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]"
                    : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/30"
                }`}
                onClick={() => onSelectWorkflow(wf.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{wf.name}</span>
                  <span
                    className={`rounded px-1 py-0.5 text-[8px] font-semibold uppercase leading-none ${
                      wf.isActive === false
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-emerald-500/15 text-emerald-300"
                    }`}
                  >
                    {wf.isActive === false ? "Paused" : "Active"}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-[hsl(var(--muted-foreground))]">
                  <span>v{wf.version ?? 1}</span>
                  <span>{wf.runCount ?? 0} runs</span>
                  <span title={wf.updatedAt}>{formatShortDate(wf.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeWorkflow && (
          <div className="mt-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))]/60 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[11px] font-semibold text-[hsl(var(--foreground))]">
                  {activeWorkflow.name}
                </div>
                <div className="text-[9px] text-[hsl(var(--muted-foreground))]">
                  v{activeWorkflow.version ?? 1} / {activeWorkflow.runCount ?? 0} runs
                </div>
              </div>
              <button
                onClick={() =>
                  void onToggleWorkflowActive(activeWorkflow.id, activeWorkflow.isActive === false)
                }
                className={`rounded px-2 py-1 text-[10px] font-semibold ${
                  activeWorkflow.isActive === false
                    ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                    : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                }`}
                title={
                  activeWorkflow.isActive === false ? "Make workflow active" : "Pause workflow"
                }
              >
                {activeWorkflow.isActive === false ? "Activate" : "Pause"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => void onDuplicateWorkflow(activeWorkflow.id)}
                className="rounded bg-[hsl(var(--muted))]/40 px-2 py-1 text-[10px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/70"
              >
                Duplicate
              </button>
              <button
                onClick={() => onExportWorkflow(activeWorkflow)}
                className="rounded bg-[hsl(var(--muted))]/40 px-2 py-1 text-[10px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/70"
              >
                Export
              </button>
              <button
                onClick={() => onSelectWorkflow(activeWorkflow.id)}
                className="rounded bg-[hsl(var(--muted))]/40 px-2 py-1 text-[10px] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/70"
              >
                Reload
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete workflow "${activeWorkflow.name}"?`)) {
                    onDeleteWorkflow(activeWorkflow.id);
                  }
                }}
                className="rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/20"
              >
                Delete
              </button>
            </div>
          </div>
        )}

        {activeWorkflow?.importReport && (
          <div className="mt-3 rounded-md border border-cyan-400/25 bg-cyan-400/5 p-2 text-[10px] text-[hsl(var(--muted-foreground))]">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold uppercase tracking-wide text-cyan-200">Import</span>
              <span
                className={
                  activeWorkflow.importReport.okForPinnedTestRun
                    ? "text-emerald-300"
                    : "text-amber-300"
                }
              >
                {activeWorkflow.importReport.okForPinnedTestRun ? "Fixture-ready" : "Needs setup"}
              </span>
            </div>
            <div className="truncate font-medium text-[hsl(var(--foreground))]">
              {activeWorkflow.importReport.packageName}
            </div>
            {activeWorkflow.importReport.blockers.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {activeWorkflow.importReport.blockers.slice(0, 3).map((blocker, index) => (
                  <div key={`${blocker.code ?? "blocker"}-${index}`} className="text-red-300">
                    {blocker.message}
                  </div>
                ))}
              </div>
            )}
            {activeWorkflow.importReport.liveRequirements.length > 0 && (
              <div className="mt-1">
                <div className="font-medium text-amber-200">Live requirements</div>
                <div
                  className="truncate"
                  title={activeWorkflow.importReport.liveRequirements.join(", ")}
                >
                  {activeWorkflow.importReport.liveRequirements.slice(0, 3).join(", ")}
                  {activeWorkflow.importReport.liveRequirements.length > 3 ? "..." : ""}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Run History */}
        {activeWorkflowId && (
          <div className="mt-3 pt-3 border-t border-[hsl(var(--border))]">
            <button
              onClick={() => setRunHistoryOpen(!runHistoryOpen)}
              className="flex items-center justify-between w-full text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2"
            >
              <span>Run History</span>
              <span className="text-[9px]">{runHistoryOpen ? "\u25BC" : "\u25B6"}</span>
            </button>
            {runHistoryOpen && (
              <div className="flex flex-col gap-1">
                {runs.length === 0 ? (
                  <div className="text-[10px] text-[hsl(var(--muted-foreground))] italic">
                    No runs yet
                  </div>
                ) : (
                  runs.map((run) => {
                    const statusIcon =
                      run.status === "completed"
                        ? "\u2705"
                        : run.status === "failed"
                          ? "\u274C"
                          : run.status === "running"
                            ? "\u23F3"
                            : "\u23F8\uFE0F";
                    const isExpanded = expandedRunId === run.runId;
                    return (
                      <div key={run.runId}>
                        <div
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] cursor-pointer hover:bg-[hsl(var(--muted))]/30 transition-colors"
                          onClick={() => {
                            setExpandedRunId(isExpanded ? null : run.runId);
                            onSelectRun(run);
                          }}
                        >
                          <span>{statusIcon}</span>
                          <span className="flex-1 truncate text-[hsl(var(--foreground))]">
                            Run #{run.runId.slice(-4)} — {run.status}
                          </span>
                          <span className="text-[hsl(var(--muted-foreground))]">
                            {formatDuration(run.durationMs)}
                          </span>
                        </div>
                        {isExpanded && run.steps.length > 0 && (
                          <div className="ml-4 pl-2 border-l border-[hsl(var(--border))] flex flex-col gap-0.5 mb-1">
                            {run.steps.map((step, i) => {
                              const stepIcon =
                                step.status === "completed"
                                  ? "\u2705"
                                  : step.status === "failed"
                                    ? "\u274C"
                                    : step.status === "running"
                                      ? "\u23F3"
                                      : step.status === "skipped"
                                        ? "\u23ED\uFE0F"
                                        : "\u2B1C";
                              return (
                                <div key={`${run.runId}-step-${i}`} className="flex flex-col">
                                  <div className="flex items-center gap-1 text-[9px] text-[hsl(var(--muted-foreground))]">
                                    <span>{stepIcon}</span>
                                    <span className="flex-1 truncate">{step.nodeName}</span>
                                    <span>{formatDuration(step.durationMs)}</span>
                                  </div>
                                  {step.error && (
                                    <div
                                      className="text-[9px] text-red-400 truncate mt-0.5 ml-4"
                                      title={step.error}
                                    >
                                      {step.error}
                                    </div>
                                  )}
                                  {(hasRunValue(step.input) || hasRunValue(step.output)) && (
                                    <div className="ml-4 mt-1 grid grid-cols-1 gap-1">
                                      <RunStepDataPreview label="Input" value={step.input} />
                                      <RunStepDataPreview label="Output" value={step.output} />
                                    </div>
                                  )}
                                  {step.status === "failed" &&
                                    onRetryFromStep &&
                                    activeWorkflowId && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onRetryFromStep(activeWorkflowId, run.runId, step.nodeId);
                                        }}
                                        className="ml-4 mt-0.5 self-start text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors"
                                      >
                                        Retry from here
                                      </button>
                                    )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {isExpanded && (
                          <div className="ml-4 pl-2 border-l border-[hsl(var(--border))] mb-2 space-y-1">
                            {(run.totalTokensUsed ?? 0) > 0 || (run.totalCostUsd ?? 0) > 0 ? (
                              <div className="text-[9px] text-[hsl(var(--muted-foreground))]">
                                {run.totalTokensUsed ?? 0} tokens
                                {(run.totalCostUsd ?? 0) > 0
                                  ? ` \u2022 $${(run.totalCostUsd ?? 0).toFixed(4)}`
                                  : ""}
                              </div>
                            ) : null}
                            {run.error && (
                              <div className="text-[9px] text-red-400 truncate" title={run.error}>
                                {run.error}
                              </div>
                            )}
                            {run.approvals && run.approvals.length > 0 && (
                              <div className="space-y-0.5">
                                {run.approvals.map((approval) => (
                                  <div
                                    key={approval.approvalId}
                                    className="text-[9px] text-amber-300/90 truncate"
                                    title={approval.message}
                                  >
                                    Approval: {approval.nodeLabel ?? approval.nodeId} —{" "}
                                    {approval.status}
                                  </div>
                                ))}
                              </div>
                            )}
                            {run.timeline && run.timeline.length > 0 && (
                              <div className="space-y-0.5 pt-1">
                                {run.timeline.slice(-4).map((event, index) => (
                                  <div
                                    key={`${run.runId}-event-${index}`}
                                    className="text-[9px] text-[hsl(var(--muted-foreground))] truncate"
                                    title={event.label}
                                  >
                                    {event.label ?? event.type}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface WorkflowManagerModalProps {
  open: boolean;
  workflows: WorkflowDefinition[];
  activeWorkflowId: string | null;
  runs: RunRecord[];
  loading?: boolean;
  onClose: () => void;
  onNewWorkflow: () => void;
  onSelectWorkflow: (id: string) => void | Promise<void>;
  onDuplicateWorkflow: (id: string) => void | Promise<void>;
  onToggleWorkflowActive: (id: string, isActive: boolean) => void | Promise<void>;
  onDeleteWorkflow: (id: string) => void;
  onExportWorkflow: (workflow: WorkflowDefinition) => void;
}

function WorkflowManagerModal({
  open,
  workflows,
  activeWorkflowId,
  runs,
  loading = false,
  onClose,
  onNewWorkflow,
  onSelectWorkflow,
  onDuplicateWorkflow,
  onToggleWorkflowActive,
  onDeleteWorkflow,
  onExportWorkflow,
}: WorkflowManagerModalProps) {
  const [query, setQuery] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    activeWorkflowId ?? workflows[0]?.id ?? null,
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedWorkflowId((current) =>
      current && workflows.some((workflow) => workflow.id === current)
        ? current
        : (activeWorkflowId ?? workflows[0]?.id ?? null),
    );
  }, [activeWorkflowId, open, workflows]);

  const filteredWorkflows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return workflows;
    }
    return workflows.filter((workflow) => {
      const haystack = [
        workflow.name,
        workflowDescription(workflow),
        workflowCategory(workflow),
        workflowClass(workflow),
        workflow.triggerType ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, workflows]);

  const selectedWorkflow =
    workflows.find((workflow) => workflow.id === selectedWorkflowId) ??
    filteredWorkflows[0] ??
    workflows[0] ??
    null;
  const selectedState = selectedWorkflow ? workflowState(selectedWorkflow, runs) : null;
  const selectedIsOpen = Boolean(selectedWorkflow && selectedWorkflow.id === activeWorkflowId);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-[hsl(var(--border))] px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-[hsl(var(--foreground))]">
              Manage Workflows
            </div>
            <div className="text-xs text-[hsl(var(--muted-foreground))]">
              {loading
                ? "Refreshing saved workflows..."
                : `${workflows.length} saved ${workflows.length === 1 ? "workflow" : "workflows"}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onNewWorkflow();
                onClose();
              }}
              className="rounded-lg border border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/10 px-3 py-1.5 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/20"
            >
              New workflow
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            >
              Close
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-b border-[hsl(var(--border))] lg:border-b-0 lg:border-r">
            <div className="border-b border-[hsl(var(--border))] p-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))]/70"
                placeholder="Search workflows..."
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {filteredWorkflows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--muted-foreground))]">
                  {loading ? "Loading saved workflows..." : "No workflows match this search."}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredWorkflows.map((workflow) => {
                    const state = workflowState(workflow, runs);
                    const isSelected = selectedWorkflow?.id === workflow.id;
                    const isOpen = workflow.id === activeWorkflowId;
                    return (
                      <button
                        key={workflow.id}
                        onClick={() => setSelectedWorkflowId(workflow.id)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          isSelected
                            ? "border-[hsl(var(--primary))]/70 bg-[hsl(var(--primary))]/10"
                            : "border-[hsl(var(--border))] bg-[hsl(var(--background))]/55 hover:border-[hsl(var(--primary))]/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                              {workflow.name}
                            </div>
                            <div className="mt-1 line-clamp-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                              {workflowDescription(workflow)}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                              state === "running"
                                ? "bg-cyan-500/15 text-cyan-300"
                                : state === "paused"
                                  ? "bg-amber-500/15 text-amber-300"
                                  : "bg-emerald-500/15 text-emerald-300"
                            }`}
                          >
                            {state}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                          <span className="rounded bg-[hsl(var(--muted))]/40 px-1.5 py-0.5">
                            {workflowCategory(workflow)}
                          </span>
                          <span className="rounded bg-[hsl(var(--muted))]/40 px-1.5 py-0.5">
                            v{workflow.version ?? 1}
                          </span>
                          <span className="rounded bg-[hsl(var(--muted))]/40 px-1.5 py-0.5">
                            {workflow.runCount ?? 0} runs
                          </span>
                          {isOpen && (
                            <span className="rounded bg-[hsl(var(--primary))]/15 px-1.5 py-0.5 text-[hsl(var(--primary))]">
                              open
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-5">
            {!selectedWorkflow ? (
              <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
                No workflow selected.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xl font-semibold text-[hsl(var(--foreground))]">
                      {selectedWorkflow.name}
                    </div>
                    <div className="mt-1 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                      {workflowDescription(selectedWorkflow)}
                    </div>
                  </div>
                  <span
                    className={`rounded px-2 py-1 text-[10px] font-semibold uppercase ${
                      selectedState === "running"
                        ? "bg-cyan-500/15 text-cyan-300"
                        : selectedState === "paused"
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-emerald-500/15 text-emerald-300"
                    }`}
                  >
                    {selectedState}
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    ["Category", workflowCategory(selectedWorkflow)],
                    ["Class", workflowClass(selectedWorkflow)],
                    ["Open in canvas", selectedIsOpen ? "Yes" : "No"],
                    ["Trigger", selectedWorkflow.triggerType ?? "Not set"],
                    ["Version", `v${selectedWorkflow.version ?? 1}`],
                    ["Run count", String(selectedWorkflow.runCount ?? 0)],
                    ["Nodes", String(selectedWorkflow.nodes.length)],
                    ["Edges", String(selectedWorkflow.edges.length)],
                    ["Updated", formatWorkflowDetailDate(selectedWorkflow.updatedAt)],
                    ["Created", formatWorkflowDetailDate(selectedWorkflow.createdAt)],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/50 p-3"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        {label}
                      </div>
                      <div className="mt-1 break-words text-sm text-[hsl(var(--foreground))]">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 border-t border-[hsl(var(--border))] pt-4">
                  <button
                    onClick={() => {
                      void onSelectWorkflow(selectedWorkflow.id);
                      onClose();
                    }}
                    className="rounded-lg bg-[hsl(var(--primary))]/15 px-3 py-2 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/25"
                  >
                    Open in canvas
                  </button>
                  <button
                    onClick={() =>
                      void onToggleWorkflowActive(
                        selectedWorkflow.id,
                        selectedWorkflow.isActive === false,
                      )
                    }
                    className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                      selectedWorkflow.isActive === false
                        ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                        : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                    }`}
                  >
                    {selectedWorkflow.isActive === false ? "Activate" : "Pause"}
                  </button>
                  <button
                    onClick={() => void onDuplicateWorkflow(selectedWorkflow.id)}
                    className="rounded-lg bg-[hsl(var(--muted))]/45 px-3 py-2 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/75"
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={() => onExportWorkflow(selectedWorkflow)}
                    className="rounded-lg bg-[hsl(var(--muted))]/45 px-3 py-2 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/75"
                  >
                    Export
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete workflow "${selectedWorkflow.name}"?`)) {
                        onDeleteWorkflow(selectedWorkflow.id);
                      }
                    }}
                    className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Default Node Data Factories ─────────────────────────────────────

function createDefaultTriggerData(): TriggerNodeData {
  return { label: "Trigger", triggerType: "manual", cronExpression: "" };
}

function createDefaultAgentStepData(): AgentStepNodeData {
  return {
    label: "Agent Step",
    agentId: "",
    agentName: "",
    agentColor: "#64748b",
    rolePrompt: "",
    timeout: 5,
    evidenceRequired: false,
  };
}

function createDefaultOutputData(): OutputNodeData {
  return {
    label: "Output",
    target: "doc_panel",
    format: "markdown",
    sourceMode: "previous",
    contentTemplate: "{{previous.text}}",
    title: "Workflow output",
  };
}

function createDefaultActionData(): ActionNodeData {
  return {
    label: "Action",
    actionType: "send_message",
    config: {},
    timeoutMs: 30000,
  };
}

function createDefaultGateData(): GateNodeData {
  return {
    label: "Gate",
    gateType: "condition",
    conditionField: "",
    conditionOperator: "==",
    conditionValue: "",
    branchCount: 2,
    maxIterations: 10,
    durationMs: 60000,
    approvalMessage: "",
    showPreviousOutput: true,
    timeoutMinutes: 0,
    timeoutAction: "deny",
  };
}

// ── Exported Widget ─────────────────────────────────────────────────

export function WorkflowsWidget() {
  const gateway = useGateway();
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>(loadWorkflowsLocal);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(() => {
    const wfs = loadWorkflowsLocal();
    return wfs.length > 0 ? wfs[0].id : null;
  });
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [connectors, setConnectors] = useState<ConnectorEntry[]>([]);
  const [packageTemplates, setPackageTemplates] = useState<WorkflowPackageTemplateSummary[]>([]);
  const [packageTemplatesLoading, setPackageTemplatesLoading] = useState(false);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);

  // Inject CSS keyframes once
  useEffect(() => {
    injectWorkflowStyles();
  }, []);

  // ── Gateway CRUD with localStorage fallback ───────────────────────

  const loadWorkflowsFromGateway = useCallback(async (): Promise<WorkflowDefinition[]> => {
    if (!gateway.connected) {
      return loadWorkflowsLocal();
    }
    setWorkflowsLoading(true);
    try {
      const res = await gateway.request<{ workflows?: WorkflowDefinition[] }>("workflows.list", {});
      const loaded = (res?.workflows ?? [])
        .map((workflow) => normalizeWorkflowDefinition(workflow))
        .filter((workflow): workflow is WorkflowDefinition => Boolean(workflow));
      setWorkflows(loaded);
      saveWorkflowsLocal(loaded);
      setActiveWorkflowId((current) =>
        current && loaded.some((workflow) => workflow.id === current)
          ? current
          : (loaded[0]?.id ?? null),
      );
      return loaded;
    } catch {
      return loadWorkflowsLocal();
    } finally {
      setWorkflowsLoading(false);
    }
  }, [gateway]);

  // Load workflows from gateway on connect
  useEffect(() => {
    if (!gateway.connected) {
      return;
    }
    let cancelled = false;
    void loadWorkflowsFromGateway().then((loaded) => {
      if (cancelled) {
        return;
      }
      if (loaded.length === 0) {
        setActiveWorkflowId(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [gateway.connected, loadWorkflowsFromGateway]);

  // Load connector catalog
  useEffect(() => {
    if (!gateway.connected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await gateway.request<{ connectors?: ConnectorEntry[] }>(
          "workflows.connectors",
          {},
        );
        if (!cancelled && res?.connectors) {
          setConnectors(res.connectors);
        }
      } catch {
        /* connector catalog unavailable — sidebar just stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Gateway request identity can change during handshake; reload on connection changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway.connected]);

  // Load tested owner-operator workflow packages for the template gallery.
  useEffect(() => {
    if (!gateway.connected) return;
    let cancelled = false;
    setPackageTemplatesLoading(true);
    (async () => {
      try {
        const res = await gateway.request<{ templates?: WorkflowPackageTemplateSummary[] }>(
          "workflows.templates.list",
          {},
        );
        if (!cancelled) {
          setPackageTemplates(res?.templates ?? []);
        }
      } catch {
        if (!cancelled) {
          setPackageTemplates([]);
        }
      } finally {
        if (!cancelled) {
          setPackageTemplatesLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Gateway request identity can change during handshake; reload on connection changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway.connected]);

  // Load run history when active workflow changes
  useEffect(() => {
    if (!gateway.connected || !activeWorkflowId) {
      setRuns([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await gateway.request<{ runs?: unknown[] }>("workflows.runs.list", {
          workflowId: activeWorkflowId,
        });
        if (!cancelled && res?.runs) {
          setRuns(normalizeRunRecords(res.runs));
        }
      } catch {
        if (!cancelled) {
          setRuns([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Gateway request identity can change during handshake; run history reloads on connection/workflow changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway.connected, activeWorkflowId]);

  const persistWorkflows = useCallback((next: WorkflowDefinition[]) => {
    saveWorkflowsLocal(next);
    // Fire-and-forget PG sync (individual workflow updates happen in canvas inner)
  }, []);

  const upsertWorkflow = useCallback(
    (workflow: WorkflowDefinition) => {
      setWorkflows((prev) => {
        const exists = prev.some((candidate) => candidate.id === workflow.id);
        const next = exists
          ? prev.map((candidate) => (candidate.id === workflow.id ? workflow : candidate))
          : [...prev, workflow];
        saveWorkflowsLocal(next);
        return next;
      });
    },
    [setWorkflows],
  );

  const handleSelectWorkflow = useCallback(
    async (id: string) => {
      setActiveWorkflowId(id);
      if (!gateway.connected) {
        return;
      }
      try {
        const res = await gateway.request("workflows.get", { id });
        const workflow = normalizeWorkflowDefinition(res);
        if (workflow) {
          upsertWorkflow(workflow);
        }
      } catch (err) {
        console.warn("[Workflows] Authoritative workflow load failed:", err);
      }
    },
    [gateway, upsertWorkflow],
  );

  const [newWorkflowModalOpen, setNewWorkflowModalOpen] = useState(false);
  const [workflowManagerOpen, setWorkflowManagerOpen] = useState(false);

  const handleManageWorkflows = useCallback(() => {
    setWorkflowManagerOpen(true);
    void loadWorkflowsFromGateway();
  }, [loadWorkflowsFromGateway]);

  const createWorkflow = useCallback(
    async (
      name: string,
      templateNodes: Node[] = [],
      templateEdges: Edge[] = [],
      extra: Pick<WorkflowDefinition, "definition" | "canvasLayout" | "validation"> = {},
    ) => {
      const id = `wf-${Date.now()}`;
      const nodes =
        templateNodes.length > 0
          ? templateNodes
          : [
              {
                id: `trigger-${Date.now()}`,
                type: "trigger",
                position: { x: 140, y: 120 },
                data: createDefaultTriggerData(),
              },
            ];
      const newWf: WorkflowDefinition = {
        id,
        name,
        nodes,
        edges: templateEdges,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...extra,
      };
      const next = [...workflows, newWf];
      setWorkflows(next);
      persistWorkflows(next);
      setActiveWorkflowId(id);
      setNewWorkflowModalOpen(false);
      // Persist to PG
      if (gateway.connected) {
        try {
          const created = await gateway.request("workflows.create", {
            name: newWf.name,
            workflowId: newWf.id,
            canvasData: { nodes: newWf.nodes, edges: newWf.edges },
            canvasLayout: newWf.canvasLayout,
            definition: newWf.definition,
            deploymentStage: workflowDeploymentStage(newWf),
          });
          const normalized = normalizeWorkflowDefinition(created);
          if (normalized) {
            upsertWorkflow(normalized);
          }
        } catch {
          /* localStorage fallback already saved */
        }
      }
    },
    [workflows, persistWorkflows, gateway, upsertWorkflow],
  );

  const handleNew = useCallback(() => {
    setNewWorkflowModalOpen(true);
  }, []);

  const handleCreateBlank = useCallback(
    (name?: string) => {
      const trimmed = name?.trim();
      void createWorkflow(trimmed || `Workflow ${workflows.length + 1}`);
    },
    [createWorkflow, workflows.length],
  );

  const handleSelectTemplate = useCallback(
    (template: WorkflowTemplate) => {
      // Create a workflow with the template name; nodes are empty since templates
      // are structural starting points that users customize via drag-and-drop
      void createWorkflow(template.name);
    },
    [createWorkflow],
  );

  const handleCreateFromIntent = useCallback(
    async (intent: string, name?: string) => {
      if (!gateway.connected) {
        throw new Error("Gateway is not connected.");
      }
      const draft = await gateway.request<{
        name?: string;
        nodes?: Node[];
        edges?: Edge[];
        definition?: unknown;
        canvasLayout?: { nodes?: Node[]; edges?: Edge[]; [key: string]: unknown };
        ok?: boolean;
        issues?: unknown[];
      }>("workflows.draft", {
        intent,
        name,
      });
      const nodes = draft.canvasLayout?.nodes ?? draft.nodes ?? [];
      const edges = draft.canvasLayout?.edges ?? draft.edges ?? [];
      await createWorkflow(draft.name ?? name ?? "Generated workflow", nodes, edges, {
        definition: draft.definition,
        canvasLayout: draft.canvasLayout,
        validation: { ok: draft.ok !== false, issues: draft.issues },
      });
    },
    [createWorkflow, gateway],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const next = workflows.filter((w) => w.id !== id);
      setWorkflows(next);
      persistWorkflows(next);
      if (activeWorkflowId === id) {
        setActiveWorkflowId(next.length > 0 ? next[0].id : null);
      }
      if (gateway.connected) {
        try {
          await gateway.request("workflows.delete", { workflowId: id });
        } catch {
          /* localStorage already updated */
        }
      }
    },
    [workflows, activeWorkflowId, persistWorkflows, gateway],
  );

  const handleDuplicateWorkflow = useCallback(
    async (id: string) => {
      const source = workflows.find((workflow) => workflow.id === id);
      if (!source) {
        return;
      }
      if (gateway.connected) {
        try {
          const duplicated = await gateway.request("workflows.duplicate", {
            id,
            name: `${source.name} (copy)`,
          });
          const normalized = normalizeWorkflowDefinition(duplicated);
          if (normalized) {
            upsertWorkflow(normalized);
            setActiveWorkflowId(normalized.id);
            return;
          }
        } catch (err) {
          console.warn("[Workflows] Gateway duplicate failed, using local copy:", err);
        }
      }
      const now = new Date().toISOString();
      const localCopy: WorkflowDefinition = {
        ...source,
        id: `wf-${Date.now()}`,
        name: `${source.name} (copy)`,
        createdAt: now,
        updatedAt: now,
        version: 1,
        runCount: 0,
      };
      const next = [...workflows, localCopy];
      setWorkflows(next);
      persistWorkflows(next);
      setActiveWorkflowId(localCopy.id);
    },
    [gateway, persistWorkflows, upsertWorkflow, workflows],
  );

  const handleToggleWorkflowActive = useCallback(
    async (id: string, isActive: boolean) => {
      setWorkflows((prev) => {
        const next = prev.map((workflow) =>
          workflow.id === id
            ? { ...workflow, isActive, updatedAt: new Date().toISOString() }
            : workflow,
        );
        saveWorkflowsLocal(next);
        return next;
      });
      if (!gateway.connected) {
        return;
      }
      try {
        const updated = await gateway.request("workflows.update", {
          workflowId: id,
          isActive,
          changeSummary: isActive ? "Activated by operator" : "Paused by operator",
        });
        const normalized = normalizeWorkflowDefinition(updated);
        if (normalized) {
          upsertWorkflow(normalized);
        }
      } catch (err) {
        console.warn("[Workflows] Active state update failed:", err);
      }
    },
    [gateway, upsertWorkflow],
  );

  const handleExportWorkflow = useCallback((workflow: WorkflowDefinition) => {
    const exportData = {
      format: "argent-workflow" as const,
      version: 1,
      exportedAt: new Date().toISOString(),
      workflow: {
        name: workflow.name,
        description: "",
        definition: workflow.definition,
        canvasLayout: workflow.canvasLayout ?? { nodes: workflow.nodes, edges: workflow.edges },
        nodes: workflow.nodes,
        edges: workflow.edges,
      },
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflow.name.replace(/[^a-zA-Z0-9-_]/g, "-")}.argent-workflow.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // Replay run highlighting on canvas when a historical run is clicked
  const [replayRun, setReplayRun] = useState<RunRecord | null>(null);

  // Retry a workflow from a specific failed step
  const handleRetryFromStep = useCallback(
    async (workflowId: string, runId: string, fromStepNodeId: string) => {
      if (!gateway.connected) {
        return;
      }
      try {
        await gateway.request("workflows.run", {
          workflowId,
          sourceRunId: runId,
          fromStepId: fromStepNodeId,
        });
        // Refresh run history after retry
        const res = await gateway.request<{ runs?: unknown[] }>("workflows.runs.list", {
          workflowId,
        });
        if (res?.runs) {
          setRuns(normalizeRunRecords(res.runs));
        }
      } catch (err) {
        console.error("[Workflows] Retry from step failed:", err);
      }
    },
    [gateway],
  );

  const saveImportedWorkflow = useCallback(
    async (imported: WorkflowDefinition) => {
      const next = [...workflows, imported];
      setWorkflows(next);
      persistWorkflows(next);
      setActiveWorkflowId(imported.id);
      if (gateway.connected) {
        try {
          await gateway.request("workflows.create", {
            name: imported.name,
            workflowId: imported.id,
            description:
              isRecord(imported.definition) && typeof imported.definition.description === "string"
                ? imported.definition.description
                : undefined,
            nodes:
              isRecord(imported.definition) && Array.isArray(imported.definition.nodes)
                ? imported.definition.nodes
                : imported.nodes,
            edges:
              isRecord(imported.definition) && Array.isArray(imported.definition.edges)
                ? imported.definition.edges
                : imported.edges,
            canvasLayout: imported.canvasLayout ?? { nodes: imported.nodes, edges: imported.edges },
            deploymentStage:
              isRecord(imported.definition) &&
              typeof imported.definition.deploymentStage === "string"
                ? imported.definition.deploymentStage
                : "simulate",
            maxRunDurationMs:
              isRecord(imported.definition) &&
              typeof imported.definition.maxRunDurationMs === "number"
                ? imported.definition.maxRunDurationMs
                : undefined,
            maxRunCostUsd:
              isRecord(imported.definition) && typeof imported.definition.maxRunCostUsd === "number"
                ? imported.definition.maxRunCostUsd
                : undefined,
          });
        } catch {
          /* localStorage fallback already saved */
        }
      }
    },
    [workflows, persistWorkflows, gateway, setWorkflows],
  );

  const importWorkflowText = useCallback(
    async (text: string, options: { displayName?: string; name?: string } = {}) => {
      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error("Workflow import text is empty.");
      }
      let imported: WorkflowDefinition;
      if (gateway.connected) {
        const label = options.displayName ?? "";
        const format =
          /\.(ya?ml|argent-workflow\.ya?ml)$/i.test(label) || !trimmed.startsWith("{")
            ? "yaml"
            : "json";
        const preview = await gateway.request<WorkflowImportPreviewResponse>(
          "workflows.importPreview",
          { text: trimmed, format },
        );
        imported = workflowFromImportPreview(preview);
      } else {
        imported = legacyWorkflowFromJson(trimmed);
      }
      const requestedName = options.name?.trim();
      await saveImportedWorkflow(
        requestedName
          ? {
              ...imported,
              name: requestedName,
              updatedAt: new Date().toISOString(),
            }
          : imported,
      );
    },
    [gateway, saveImportedWorkflow],
  );

  const handleImportWorkflowFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        await importWorkflowText(text, { displayName: file.name });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        alert(`Failed to import workflow: ${message}`);
      }
    },
    [importWorkflowText],
  );

  const handleImportWorkflowText = useCallback(
    async (text: string, name?: string) => {
      await importWorkflowText(text, { name });
    },
    [importWorkflowText],
  );

  const handleSelectPackageTemplate = useCallback(
    async (template: WorkflowPackageTemplateSummary) => {
      if (!gateway.connected) {
        throw new Error("Gateway is not connected.");
      }
      const preview = await gateway.request<WorkflowImportPreviewResponse>(
        "workflows.templates.get",
        { slug: template.slug },
      );
      await saveImportedWorkflow(workflowFromImportPreview(preview));
    },
    [gateway, saveImportedWorkflow],
  );

  const handleSelectRun = useCallback(
    (run: RunRecord) => {
      setReplayRun(run);
      if (!gateway.connected) {
        return;
      }
      void gateway
        .request<{ run?: unknown }>("workflows.runs.get", { runId: run.runId })
        .then((res) => {
          const detail = normalizeRunRecord(res?.run);
          if (!detail) {
            return;
          }
          setReplayRun(detail);
          setRuns((prev) =>
            prev.map((candidate) => (candidate.runId === detail.runId ? detail : candidate)),
          );
        })
        .catch((err) => {
          console.warn("[Workflows] Run detail unavailable:", err);
        });
    },
    [gateway],
  );

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <NewWorkflowModal
        open={newWorkflowModalOpen}
        onClose={() => setNewWorkflowModalOpen(false)}
        onCreateBlank={handleCreateBlank}
        onCreateFromIntent={handleCreateFromIntent}
        onImportWorkflowText={handleImportWorkflowText}
        onSelectTemplate={handleSelectTemplate}
        packageTemplates={packageTemplates}
        packageTemplatesLoading={packageTemplatesLoading}
        onSelectPackageTemplate={handleSelectPackageTemplate}
      />
      <WorkflowManagerModal
        open={workflowManagerOpen}
        workflows={workflows}
        activeWorkflowId={activeWorkflowId}
        runs={runs}
        loading={workflowsLoading}
        onClose={() => setWorkflowManagerOpen(false)}
        onNewWorkflow={handleNew}
        onSelectWorkflow={handleSelectWorkflow}
        onDuplicateWorkflow={handleDuplicateWorkflow}
        onToggleWorkflowActive={handleToggleWorkflowActive}
        onDeleteWorkflow={handleDelete}
        onExportWorkflow={handleExportWorkflow}
      />
      <ReactFlowProvider>
        <Sidebar
          workflows={workflows}
          activeWorkflowId={activeWorkflowId}
          onSelectWorkflow={(id) => void handleSelectWorkflow(id)}
          onNewWorkflow={handleNew}
          onDuplicateWorkflow={handleDuplicateWorkflow}
          onToggleWorkflowActive={handleToggleWorkflowActive}
          onDeleteWorkflow={handleDelete}
          onExportWorkflow={handleExportWorkflow}
          onImportWorkflowFile={handleImportWorkflowFile}
          runs={runs}
          onSelectRun={handleSelectRun}
          onRetryFromStep={handleRetryFromStep}
          connectors={connectors}
        />
        <WorkflowCanvasInner
          activeWorkflowId={activeWorkflowId}
          workflows={workflows}
          setWorkflows={setWorkflows}
          onNewWorkflow={handleNew}
          onManageWorkflows={handleManageWorkflows}
          connectors={connectors}
          setConnectors={setConnectors}
          replayRun={replayRun}
          onRunsChanged={setRuns}
          onImportWorkflowFile={handleImportWorkflowFile}
        />
      </ReactFlowProvider>
    </div>
  );
}

// ── Inner Canvas (must be inside ReactFlowProvider) ─────────────────

function WorkflowCanvasInner({
  activeWorkflowId,
  workflows,
  setWorkflows,
  onNewWorkflow,
  onManageWorkflows,
  connectors,
  setConnectors,
  replayRun,
  onRunsChanged,
  onImportWorkflowFile,
}: {
  activeWorkflowId: string | null;
  workflows: WorkflowDefinition[];
  setWorkflows: React.Dispatch<React.SetStateAction<WorkflowDefinition[]>>;
  onNewWorkflow: () => void;
  onManageWorkflows: () => void;
  connectors: ConnectorEntry[];
  setConnectors: React.Dispatch<React.SetStateAction<ConnectorEntry[]>>;
  replayRun: RunRecord | null;
  onRunsChanged: (runs: RunRecord[]) => void;
  onImportWorkflowFile: (file: File) => void | Promise<void>;
}) {
  const gateway = useGateway();
  const { screenToFlowPosition, setCenter } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [agents, setAgents] = useState<FamilyMember[]>([]);
  const [availableTools, setAvailableTools] = useState<ToolPaletteEntry[]>([...AVAILABLE_TOOLS]);
  const [appForgeEventOptions, setAppForgeEventOptions] = useState<AppForgeEventOption[]>([]);
  const [outputChannels, setOutputChannels] = useState<OutputChannelOption[]>([]);
  const [knowledgeCollections, setKnowledgeCollections] = useState<KnowledgeCollectionOption[]>([]);
  const [bindingWizardOpen, setBindingWizardOpen] = useState(false);
  const lastAutoOpenedImportIdRef = useRef<string | null>(null);

  // ── Run State ─────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [lastSaveStatus, setLastSaveStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [partialRunningNodeId, setPartialRunningNodeId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [, setCompletedNodeIds] = useState<Set<string>>(new Set());
  const [, setFailedNodeIds] = useState<Set<string>>(new Set());

  // ── Approval State ─────────────────────────────────────────────────
  interface PendingApproval {
    approvalId?: string;
    runId: string;
    nodeId: string;
    workflowName?: string;
    nodeLabel?: string;
    sideEffectClass?: string;
    message: string;
    previousOutput?: { text?: string; json?: Record<string, unknown>; nodeLabel?: string };
    timeoutMs?: number;
    timeoutAt?: string;
    timeoutAction?: string;
    requestedAt: number;
  }
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [validationIssues, setValidationIssues] = useState<WorkflowValidationIssue[]>([]);
  const [validationCheckedAt, setValidationCheckedAt] = useState<string | null>(null);
  const [validationStatus, setValidationStatus] = useState<"idle" | "checking" | "error">("idle");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<WorkflowVersionRecord[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionActionBusy, setVersionActionBusy] = useState<number | null>(null);

  const normalizePendingApproval = useCallback(
    (raw: Record<string, unknown>): PendingApproval | null => {
      const runId = typeof raw.runId === "string" ? raw.runId : (raw.run_id as string | undefined);
      const nodeId =
        typeof raw.nodeId === "string"
          ? raw.nodeId
          : ((raw.node_id ?? raw.current_node_id) as string | undefined);
      if (!runId || !nodeId) {
        return null;
      }

      const preview = (raw.previousOutputPreview ?? raw.previous_output_preview) as
        | Record<string, unknown>
        | undefined;
      const text = typeof preview?.text === "string" ? preview.text : undefined;
      const nodeLabel =
        typeof preview?.nodeLabel === "string"
          ? preview.nodeLabel
          : typeof preview?.node_id === "string"
            ? preview.node_id
            : undefined;

      return {
        approvalId:
          typeof raw.approvalId === "string"
            ? raw.approvalId
            : typeof raw.id === "string"
              ? raw.id
              : undefined,
        runId,
        nodeId,
        workflowName:
          typeof raw.workflowName === "string"
            ? raw.workflowName
            : typeof raw.workflow_name === "string"
              ? raw.workflow_name
              : undefined,
        nodeLabel:
          typeof raw.nodeLabel === "string"
            ? raw.nodeLabel
            : typeof raw.node_label === "string"
              ? raw.node_label
              : undefined,
        sideEffectClass:
          typeof raw.sideEffectClass === "string"
            ? raw.sideEffectClass
            : typeof raw.side_effect_class === "string"
              ? raw.side_effect_class
              : undefined,
        message:
          typeof raw.message === "string" ? raw.message : "Review required before continuing",
        previousOutput: preview
          ? {
              text,
              json:
                preview.json && typeof preview.json === "object"
                  ? (preview.json as Record<string, unknown>)
                  : undefined,
              nodeLabel,
            }
          : undefined,
        timeoutMs: typeof raw.timeoutMs === "number" ? raw.timeoutMs : undefined,
        timeoutAt:
          typeof raw.timeoutAt === "string"
            ? raw.timeoutAt
            : typeof raw.timeout_at === "string"
              ? raw.timeout_at
              : undefined,
        timeoutAction:
          typeof raw.timeoutAction === "string"
            ? raw.timeoutAction
            : typeof raw.timeout_action === "string"
              ? raw.timeout_action
              : undefined,
        requestedAt:
          typeof raw.requestedAt === "number"
            ? raw.requestedAt
            : typeof raw.requested_at === "string"
              ? Date.parse(raw.requested_at)
              : Date.now(),
      };
    },
    [],
  );

  const gatewayRef = useRef(gateway);

  useEffect(() => {
    gatewayRef.current = gateway;
  }, [gateway]);

  const refreshPendingApprovals = useCallback(async () => {
    const currentGateway = gatewayRef.current;
    if (!currentGateway.connected) {
      return;
    }
    try {
      const res = await currentGateway.request<{ approvals?: Record<string, unknown>[] }>(
        "workflows.pendingApprovals",
        activeWorkflowId ? { workflowId: activeWorkflowId } : {},
      );
      setPendingApprovals(
        (res?.approvals ?? [])
          .map((approval) => normalizePendingApproval(approval))
          .filter((approval): approval is PendingApproval => Boolean(approval)),
      );
    } catch (err) {
      console.warn("[Workflows] Pending approvals unavailable:", err);
    }
  }, [activeWorkflowId, normalizePendingApproval]);

  useEffect(() => {
    void refreshPendingApprovals();
    if (!gateway.connected) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshPendingApprovals();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [gateway.connected, refreshPendingApprovals]);

  useEffect(() => {
    if (!gateway.connected) {
      setAvailableTools([...AVAILABLE_TOOLS]);
      setAppForgeEventOptions([]);
      setOutputChannels([]);
      setKnowledgeCollections([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const merged = new Map<string, ToolPaletteEntry>();
      for (const tool of AVAILABLE_TOOLS) {
        merged.set(tool.id, tool);
      }
      try {
        const capabilities = await gateway.request<{
          tools?: Array<{
            name: string;
            label?: string;
            description?: string;
            source?: ToolCapabilitySource;
          }>;
          appForgeCapabilities?: Array<{
            label?: string;
            appId?: string;
            appName?: string;
            capabilityId?: string;
            eventTypes?: string[];
          }>;
          connectors?: ConnectorEntry[];
          outputChannels?: OutputChannelOption[];
        }>("workflows.capabilities", {});
        if (capabilities?.connectors) {
          setConnectors(capabilities.connectors);
        }
        setOutputChannels(capabilities?.outputChannels ?? []);
        const appForgeEvents = new Map<string, AppForgeEventOption>();
        for (const capability of capabilities?.appForgeCapabilities ?? []) {
          for (const eventType of capability.eventTypes ?? []) {
            if (!eventType) {
              continue;
            }
            const key = `${eventType}:${capability.appId ?? ""}:${capability.capabilityId ?? ""}`;
            appForgeEvents.set(key, {
              value: eventType,
              label: [eventType, capability.appName, capability.label ?? capability.capabilityId]
                .filter(Boolean)
                .join(" / "),
              appId: capability.appId,
              capabilityId: capability.capabilityId,
            });
          }
        }
        setAppForgeEventOptions(
          [...appForgeEvents.values()].sort((a, b) => a.label.localeCompare(b.label)),
        );
        for (const tool of capabilities?.tools ?? []) {
          merged.set(tool.name, {
            id: tool.name,
            name: tool.label ?? tool.name,
            desc: tool.description,
            category:
              tool.source === "connector"
                ? "Connector"
                : tool.source === "plugin"
                  ? "Plugin"
                  : tool.source === "appforge"
                    ? "AppForge"
                    : "Core",
            source: tool.source,
          });
        }
      } catch {
        setOutputChannels([]);
        try {
          const status = await gateway.request<{
            tools?: Array<{
              name: string;
              label?: string;
              description?: string;
              source?: ToolCapabilitySource;
            }>;
          }>("tools.status", {});
          for (const tool of status?.tools ?? []) {
            merged.set(tool.name, {
              id: tool.name,
              name: tool.label ?? tool.name,
              desc: tool.description,
              category:
                tool.source === "connector"
                  ? "Connector"
                  : tool.source === "plugin"
                    ? "Plugin"
                    : tool.source === "appforge"
                      ? "AppForge"
                      : "Core",
              source: tool.source,
            });
          }
        } catch {
          /* Dynamic capability status unavailable; keep static defaults. */
        }
      }
      try {
        const personal = await gateway.request<{
          rows?: Array<{
            id: string;
            title: string;
            summary?: string;
            state?: string;
            executionReady?: boolean;
            relatedTools?: string[];
          }>;
        }>("skills.personal", {});
        for (const skill of personal?.rows ?? []) {
          if (skill.state !== "promoted" || !skill.executionReady) {
            continue;
          }
          merged.set(`skill:${skill.id}`, {
            id: `skill:${skill.id}`,
            name: skill.title,
            desc: skill.summary,
            category: "Skill",
            source: "skill",
          });
          for (const relatedTool of skill.relatedTools ?? []) {
            if (!merged.has(relatedTool)) {
              merged.set(relatedTool, {
                id: relatedTool,
                name: relatedTool,
                desc: "Promoted operator tool",
                category: "Promoted",
                source: "promoted-cli",
              });
            }
          }
        }
      } catch {
        /* Personal skills unavailable; keep discovered tools. */
      }
      if (!cancelled) {
        setAvailableTools([...merged.values()].sort((a, b) => a.name.localeCompare(b.name)));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Gateway request identity can change during handshake; capability discovery reloads on connection changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway.connected]);

  useEffect(() => {
    if (!gateway.connected) {
      setKnowledgeCollections([]);
      return;
    }
    let cancelled = false;
    void gateway
      .request<{ collections?: KnowledgeCollectionOption[] }>("knowledge.collections.list", {})
      .then((res) => {
        if (!cancelled) {
          setKnowledgeCollections(res?.collections ?? []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setKnowledgeCollections([]);
        }
        console.warn("[Workflows] Knowledge collections unavailable:", err);
      });
    return () => {
      cancelled = true;
    };
    // Gateway object identity is unstable while connecting; collections reload on connection changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway.connected]);

  const handleApprove = useCallback(
    async (runId: string, nodeId: string) => {
      if (!gateway.connected) return;
      try {
        await gateway.request("workflows.approve", { runId, nodeId });
        setPendingApprovals((prev) =>
          prev.filter((a) => !(a.runId === runId && a.nodeId === nodeId)),
        );
      } catch (err) {
        console.error("[Workflows] Approve failed:", err);
      }
    },
    [gateway],
  );

  const handleDeny = useCallback(
    async (runId: string, nodeId: string) => {
      if (!gateway.connected) return;
      try {
        await gateway.request("workflows.deny", { runId, nodeId, reason: "Denied by operator" });
        setPendingApprovals((prev) =>
          prev.filter((a) => !(a.runId === runId && a.nodeId === nodeId)),
        );
      } catch (err) {
        console.error("[Workflows] Deny failed:", err);
      }
    },
    [gateway],
  );

  // Fetch family members for agent dropdown
  useEffect(() => {
    if (!gateway.connected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await gateway.request<{ members?: FamilyMember[] }>("family.members");
        if (!cancelled && res?.members) {
          setAgents(res.members.filter(isOperational));
        }
      } catch {
        /* silent — agents just won't populate the dropdown */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Gateway request identity can change during handshake; agent discovery reloads on connection changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway.connected]);

  // ── Apply exec state to nodes ──────────────────────────────────────

  const applyExecState = useCallback(
    (active: string | null, completed: Set<string>, failed: Set<string>) => {
      setNodes((nds) =>
        nds.map((n) => {
          let execState: NodeExecState = "pending";
          if (n.id === active) execState = "active";
          else if (completed.has(n.id)) execState = "completed";
          else if (failed.has(n.id)) execState = "failed";
          if (n.data.execState === execState) return n;
          return { ...n, data: { ...n.data, execState } };
        }),
      );
    },
    [setNodes],
  );

  // Clear exec state when not running and no replay
  const clearExecState = useCallback(() => {
    setActiveNodeId(null);
    setCompletedNodeIds(new Set());
    setFailedNodeIds(new Set());
    setNodes((nds) =>
      nds.map((n) => (n.data.execState ? { ...n, data: { ...n.data, execState: undefined } } : n)),
    );
  }, [setNodes]);

  const applyValidationIssuesToCanvas = useCallback(
    (issues: WorkflowValidationIssue[]) => {
      const issuesByNode = new Map<string, WorkflowValidationIssue[]>();
      for (const issue of issues) {
        if (!issue.nodeId) continue;
        const nodeIssues = issuesByNode.get(issue.nodeId) ?? [];
        nodeIssues.push(issue);
        issuesByNode.set(issue.nodeId, nodeIssues);
      }

      setNodes((nds) =>
        nds.map((node) => {
          const nextIssues = issuesByNode.get(node.id);
          const hasCurrentIssues = Boolean((node.data as Record<string, unknown>).validationIssues);
          if (!nextIssues && !hasCurrentIssues) {
            return node;
          }
          const nextData = { ...(node.data as Record<string, unknown>) };
          if (nextIssues) {
            nextData.validationIssues = nextIssues;
          } else {
            delete nextData.validationIssues;
          }
          return { ...node, data: nextData };
        }),
      );

      setSelectedNode((prev) => {
        if (!prev) return prev;
        const nextIssues = issuesByNode.get(prev.id);
        const nextData = { ...(prev.data as Record<string, unknown>) };
        if (nextIssues) {
          nextData.validationIssues = nextIssues;
        } else {
          delete nextData.validationIssues;
        }
        return { ...prev, data: nextData };
      });
    },
    [setNodes],
  );

  const clearValidationIssuesFromCanvas = useCallback(() => {
    setNodes((nds) =>
      nds.map((node) => {
        if (!(node.data as Record<string, unknown>).validationIssues) {
          return node;
        }
        const nextData = { ...(node.data as Record<string, unknown>) };
        delete nextData.validationIssues;
        return { ...node, data: nextData };
      }),
    );
    setSelectedNode((prev) => {
      if (!prev || !(prev.data as Record<string, unknown>).validationIssues) {
        return prev;
      }
      const nextData = { ...(prev.data as Record<string, unknown>) };
      delete nextData.validationIssues;
      return { ...prev, data: nextData };
    });
  }, [setNodes]);

  // ── Gateway live step events ──────────────────────────────────────

  useEffect(() => {
    if (!gateway.connected) return;

    const unsubStepStarted = gateway.on("workflow.step.started", (payload: unknown) => {
      const p = payload as { nodeId?: string };
      if (p.nodeId) {
        setActiveNodeId(p.nodeId);
        // Apply immediately
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === p.nodeId)
              return { ...n, data: { ...n.data, execState: "active" as NodeExecState } };
            if (n.data.execState === "active")
              return { ...n, data: { ...n.data, execState: "pending" as NodeExecState } };
            return n;
          }),
        );
      }
    });

    const unsubStepCompleted = gateway.on("workflow.step.completed", (payload: unknown) => {
      const p = payload as { nodeId?: string; status?: string; error?: string };
      if (!p.nodeId) return;
      const isFailed = p.status === "failed" || !!p.error;
      if (isFailed) {
        setFailedNodeIds((prev) => new Set([...prev, p.nodeId!]));
      } else {
        setCompletedNodeIds((prev) => new Set([...prev, p.nodeId!]));
      }
      if (activeNodeId === p.nodeId) setActiveNodeId(null);
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === p.nodeId) {
            return {
              ...n,
              data: { ...n.data, execState: (isFailed ? "failed" : "completed") as NodeExecState },
            };
          }
          return n;
        }),
      );
    });

    const unsubRunCompleted = gateway.on("workflow.run.completed", (payload: unknown) => {
      const p = payload as { workflowId?: string; runId?: string };
      setRunning(false);
      setPartialRunningNodeId(null);
      setActiveNodeId(null);
      setPendingApprovals([]);
      console.log("[Workflows] Run completed:", p);
      // Refresh run history
      if (activeWorkflowId) {
        gateway
          .request<{ runs?: unknown[] }>("workflows.runs.list", { workflowId: activeWorkflowId })
          .then((res) => {
            if (res?.runs) {
              onRunsChanged(normalizeRunRecords(res.runs));
            }
          })
          .catch(() => {});
      }
    });

    const unsubApprovalRequested = gateway.on("workflow.approval.requested", (payload: unknown) => {
      const p = payload as {
        approvalId?: string;
        runId?: string;
        workflowName?: string;
        nodeId?: string;
        nodeLabel?: string;
        sideEffectClass?: string;
        message?: string;
        previousOutputPreview?: Record<string, unknown>;
        previousOutput?: {
          output?: { items?: Array<{ text?: string; json?: Record<string, unknown> }> };
          nodeLabel?: string;
        };
        timeoutMs?: number;
        timeoutAction?: string;
        requestedAt?: number;
      };
      if (!p.runId || !p.nodeId) return;
      // Set the gate node to "waiting" state
      setNodes((nds) =>
        nds.map((n) =>
          n.id === p.nodeId
            ? { ...n, data: { ...n.data, execState: "waiting" as NodeExecState } }
            : n,
        ),
      );
      setPendingApprovals((prev) => [
        ...prev.filter((a) => !(a.runId === p.runId && a.nodeId === p.nodeId)),
        {
          approvalId: p.approvalId,
          runId: p.runId!,
          nodeId: p.nodeId!,
          workflowName: p.workflowName,
          nodeLabel: p.nodeLabel,
          sideEffectClass: p.sideEffectClass,
          message: p.message || "Review required before continuing",
          previousOutput: p.previousOutputPreview
            ? {
                text:
                  typeof p.previousOutputPreview.text === "string"
                    ? p.previousOutputPreview.text
                    : undefined,
                json:
                  p.previousOutputPreview.json && typeof p.previousOutputPreview.json === "object"
                    ? (p.previousOutputPreview.json as Record<string, unknown>)
                    : undefined,
                nodeLabel:
                  typeof p.previousOutputPreview.nodeLabel === "string"
                    ? p.previousOutputPreview.nodeLabel
                    : typeof p.previousOutputPreview.nodeId === "string"
                      ? p.previousOutputPreview.nodeId
                      : undefined,
              }
            : p.previousOutput
              ? {
                  text: p.previousOutput.output?.items?.[0]?.text,
                  json: p.previousOutput.output?.items?.[0]?.json,
                  nodeLabel: p.previousOutput.nodeLabel,
                }
              : undefined,
          timeoutMs: p.timeoutMs,
          timeoutAction: p.timeoutAction,
          requestedAt: p.requestedAt || Date.now(),
        },
      ]);
    });

    const unsubApprovalResolved = gateway.on("workflow.approval.resolved", (payload: unknown) => {
      const p = payload as { runId?: string; nodeId?: string; approved?: boolean };
      if (!p.runId || !p.nodeId) return;
      setPendingApprovals((prev) =>
        prev.filter((a) => !(a.runId === p.runId && a.nodeId === p.nodeId)),
      );
      // Update node state based on resolution
      const nextState = p.approved ? "completed" : "failed";
      setNodes((nds) =>
        nds.map((n) =>
          n.id === p.nodeId
            ? { ...n, data: { ...n.data, execState: nextState as NodeExecState } }
            : n,
        ),
      );
    });

    return () => {
      unsubStepStarted();
      unsubStepCompleted();
      unsubRunCompleted();
      unsubApprovalRequested();
      unsubApprovalResolved();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway.connected, gateway.on, activeWorkflowId, setNodes]);

  // ── Replay historical run on canvas ───────────────────────────────

  useEffect(() => {
    if (!replayRun) {
      if (!running) clearExecState();
      return;
    }
    const newCompleted = new Set<string>();
    const newFailed = new Set<string>();
    for (const step of replayRun.steps) {
      if (step.status === "completed") newCompleted.add(step.nodeId);
      else if (step.status === "failed") newFailed.add(step.nodeId);
    }
    setActiveNodeId(null);
    setCompletedNodeIds(newCompleted);
    setFailedNodeIds(newFailed);
    applyExecState(null, newCompleted, newFailed);
  }, [replayRun, running, clearExecState, applyExecState]);

  const cleanWorkflowNodes = useCallback(
    () =>
      nodes.map((n) => {
        return { ...n, data: stripExecState(n.data) };
      }),
    [nodes],
  );

  const saveCurrentWorkflow = useCallback(
    async (changeSummary = "Saved workflow from canvas toolbar"): Promise<boolean> => {
      if (!activeWorkflowId) {
        return false;
      }
      const workflow = workflows.find((candidate) => candidate.id === activeWorkflowId);
      const cleanNodes = cleanWorkflowNodes();
      const updatedAt = new Date().toISOString();
      setSaving(true);
      setLastSaveStatus(null);
      setWorkflows((prev) => {
        const next = prev.map((w) =>
          w.id === activeWorkflowId
            ? {
                ...w,
                name: workflow?.name ?? w.name,
                nodes: cleanNodes,
                edges,
                updatedAt,
              }
            : w,
        );
        saveWorkflowsLocal(next);
        return next;
      });

      try {
        if (gateway.connected) {
          await gateway.request("workflows.update", {
            workflowId: activeWorkflowId,
            name: workflow?.name,
            canvasData: { nodes: cleanNodes, edges },
            deploymentStage: workflowDeploymentStage(workflow ?? null),
            changeSummary,
          });
        }
        setLastSaveStatus(`Saved ${new Date(updatedAt).toLocaleTimeString()}`);
        return true;
      } catch (err) {
        console.error("[Workflows] Save failed:", err);
        setLastSaveStatus("Saved locally");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [activeWorkflowId, cleanWorkflowNodes, edges, gateway, setWorkflows, workflows],
  );

  const validateCurrentWorkflow = useCallback(async (): Promise<boolean> => {
    if (!activeWorkflowId || !gateway.connected) {
      setValidationIssues([]);
      setValidationCheckedAt(null);
      clearValidationIssuesFromCanvas();
      return true;
    }
    setValidationStatus("checking");
    try {
      const workflow = workflows.find((candidate) => candidate.id === activeWorkflowId);
      const res = await gateway.request<{ ok?: boolean; issues?: unknown[] }>(
        "workflows.validate",
        {
          name: workflow?.name ?? "Untitled workflow",
          canvasData: { nodes: cleanWorkflowNodes(), edges },
          deploymentStage: workflowDeploymentStage(workflow ?? null),
        },
      );
      const issues = normalizeValidationIssues(res?.issues);
      setValidationIssues(issues);
      applyValidationIssuesToCanvas(issues);
      setValidationCheckedAt(new Date().toISOString());
      setValidationStatus("idle");
      return res?.ok !== false && !issues.some((issue) => issue.severity === "error");
    } catch (err) {
      clearValidationIssuesFromCanvas();
      setValidationStatus("error");
      setValidationCheckedAt(new Date().toISOString());
      setValidationIssues([
        {
          severity: "error",
          code: "validation_unavailable",
          message: `Could not validate workflow: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
      return false;
    }
  }, [
    activeWorkflowId,
    applyValidationIssuesToCanvas,
    cleanWorkflowNodes,
    clearValidationIssuesFromCanvas,
    edges,
    gateway,
    workflows,
  ]);

  // ── Run Handler ───────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    if (!activeWorkflowId || running) return;
    const workflow = workflows.find((candidate) => candidate.id === activeWorkflowId) ?? null;
    const stage = workflowDeploymentStage(workflow);
    const report = workflow?.importReport;
    const missingRequiredBindings =
      report?.requirements.filter(
        (requirement) => requirement.requiredForLive && !report.bindings?.[requirement.key]?.value,
      ) ?? [];
    if (stage === "live" && missingRequiredBindings.length > 0) {
      setBindingWizardOpen(true);
      setRunError(
        `Complete ${missingRequiredBindings.length} required live binding${
          missingRequiredBindings.length === 1 ? "" : "s"
        } before running live.`,
      );
      return;
    }
    try {
      setRunning(true);
      setPartialRunningNodeId(null);
      setRunError(null);
      clearExecState();
      const saved = await saveCurrentWorkflow("Saved workflow before run");
      if (!saved) {
        setRunning(false);
        return;
      }
      const valid = await validateCurrentWorkflow();
      if (!valid) {
        setRunning(false);
        return;
      }
      const result = await gateway.request("workflows.run", {
        workflowId: activeWorkflowId,
        canvasData: { nodes: cleanWorkflowNodes(), edges },
        deploymentStage: stage,
      });
      console.log("[Workflows] Run started:", result);
      // Subscribe to live updates
      await gateway.request("workflows.subscribe", { workflowId: activeWorkflowId });
    } catch (err) {
      console.error("[Workflows] Run failed:", err);
      setRunError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }, [
    activeWorkflowId,
    running,
    gateway,
    clearExecState,
    cleanWorkflowNodes,
    edges,
    saveCurrentWorkflow,
    validateCurrentWorkflow,
    workflows,
  ]);

  const handleTestToNode = useCallback(
    async (nodeId: string) => {
      if (!activeWorkflowId || running) return;
      try {
        setRunning(true);
        setPartialRunningNodeId(nodeId);
        setRunError(null);
        clearExecState();
        const saved = await saveCurrentWorkflow("Saved workflow before partial node test");
        if (!saved) {
          setRunning(false);
          setPartialRunningNodeId(null);
          return;
        }
        const valid = await validateCurrentWorkflow();
        if (!valid) {
          setRunning(false);
          setPartialRunningNodeId(null);
          return;
        }
        await gateway.request("workflows.run", {
          workflowId: activeWorkflowId,
          stopAfterNodeId: nodeId,
        });
        await gateway.request("workflows.subscribe", { workflowId: activeWorkflowId });
      } catch (err) {
        console.error("[Workflows] Partial node test failed:", err);
        setRunError(err instanceof Error ? err.message : String(err));
        setRunning(false);
        setPartialRunningNodeId(null);
      }
    },
    [
      activeWorkflowId,
      running,
      gateway,
      clearExecState,
      saveCurrentWorkflow,
      validateCurrentWorkflow,
    ],
  );

  const handleSchedule = useCallback(async () => {
    if (!activeWorkflowId || scheduling || !gateway.connected) return;
    const workflow = workflows.find((candidate) => candidate.id === activeWorkflowId);
    const scheduleTrigger = nodes.find((node) => {
      if (node.type !== "trigger") return false;
      const data = node.data as Record<string, unknown>;
      return data.triggerType === "schedule";
    });
    const triggerData = scheduleTrigger?.data as Record<string, unknown> | undefined;
    const cronExpression =
      typeof triggerData?.cronExpression === "string" ? triggerData.cronExpression.trim() : "";
    const timezone = typeof triggerData?.timezone === "string" ? triggerData.timezone : undefined;
    if (!cronExpression) {
      alert("Set the trigger to Schedule and choose a schedule before creating the cron job.");
      return;
    }

    setScheduling(true);
    try {
      const valid = await validateCurrentWorkflow();
      if (!valid) {
        return;
      }

      const cleanNodes = cleanWorkflowNodes();
      await gateway.request("workflows.update", {
        workflowId: activeWorkflowId,
        name: workflow?.name,
        canvasData: { nodes: cleanNodes, edges },
        triggerType: "schedule",
        triggerConfig: { cronExpression, timezone },
        changeSummary: "Saved workflow schedule from canvas toolbar",
      });

      const cronList = await gateway.request<{ jobs?: WorkflowCronJob[] }>("cron.list", {
        includeDisabled: true,
      });
      const existing = (cronList?.jobs ?? []).find(
        (job) => job.payload?.kind === "workflowRun" && job.payload.workflowId === activeWorkflowId,
      );
      const cronPatch = {
        name: `Workflow: ${workflow?.name ?? activeWorkflowId}`,
        enabled: true,
        schedule: { kind: "cron", expr: cronExpression, ...(timezone ? { tz: timezone } : {}) },
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        payload: { kind: "workflowRun", workflowId: activeWorkflowId },
        delivery: { mode: "none" },
      };
      if (existing) {
        await gateway.request("cron.update", { id: existing.id, patch: cronPatch });
      } else {
        await gateway.request("cron.add", cronPatch);
      }
      alert(`Scheduled ${workflow?.name ?? "workflow"} with ${cronExpression}.`);
    } catch (err) {
      console.error("[Workflows] Schedule failed:", err);
      alert(`Could not schedule workflow: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScheduling(false);
    }
  }, [
    activeWorkflowId,
    cleanWorkflowNodes,
    edges,
    gateway,
    nodes,
    scheduling,
    validateCurrentWorkflow,
    workflows,
  ]);

  // Load active workflow into canvas
  const activeWorkflow = useMemo(
    () => workflows.find((w) => w.id === activeWorkflowId) ?? null,
    [workflows, activeWorkflowId],
  );
  const bindingRequirementCount = activeWorkflow?.importReport?.requirements.length ?? 0;
  const boundRequirementCount =
    activeWorkflow?.importReport?.requirements.filter(
      (requirement) => activeWorkflow.importReport?.bindings?.[requirement.key]?.value,
    ).length ?? 0;
  const activeDeploymentStage = workflowDeploymentStage(activeWorkflow);
  const requiredLiveBindings =
    activeWorkflow?.importReport?.requirements.filter(
      (requirement) => requirement.requiredForLive,
    ) ?? [];
  const missingLiveBindings = requiredLiveBindings.filter(
    (requirement) => !activeWorkflow?.importReport?.bindings?.[requirement.key]?.value,
  );
  const importedFixtureReady = activeWorkflow?.importReport?.okForPinnedTestRun === true;
  const livePromotionReady =
    Boolean(activeWorkflow?.importReport) &&
    activeWorkflow?.importReport?.okForImport !== false &&
    missingLiveBindings.length === 0;

  const loadVersionHistory = useCallback(async () => {
    if (!activeWorkflowId || !gateway.connected) {
      setVersions([]);
      return;
    }
    setVersionsLoading(true);
    try {
      const res = await gateway.request<{ versions?: unknown[] }>("workflows.versions.list", {
        workflowId: activeWorkflowId,
      });
      setVersions(normalizeWorkflowVersions(res?.versions));
    } catch (err) {
      console.warn("[Workflows] Version history unavailable:", err);
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }, [activeWorkflowId, gateway]);

  useEffect(() => {
    if (versionHistoryOpen) {
      void loadVersionHistory();
    }
  }, [loadVersionHistory, versionHistoryOpen]);

  const handleRestoreVersion = useCallback(
    async (version: number) => {
      if (!activeWorkflowId || !gateway.connected) return;
      if (
        !confirm(`Restore workflow to version ${version}? The current version will be saved first.`)
      ) {
        return;
      }
      setVersionActionBusy(version);
      try {
        const res = await gateway.request<{ workflow?: unknown }>("workflows.versions.restore", {
          workflowId: activeWorkflowId,
          version,
          changeSummary: `Restored from version ${version}`,
        });
        const restored = normalizeWorkflowDefinition(res?.workflow);
        if (restored) {
          setWorkflows((prev) => {
            const next = prev.map((workflow) =>
              workflow.id === restored.id ? restored : workflow,
            );
            saveWorkflowsLocal(next);
            return next;
          });
          setNodes(restored.nodes);
          setEdges(restored.edges);
        }
        await loadVersionHistory();
      } catch (err) {
        alert(`Could not restore version: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setVersionActionBusy(null);
      }
    },
    [activeWorkflowId, gateway, loadVersionHistory, setEdges, setNodes, setWorkflows],
  );

  useEffect(() => {
    if (!activeWorkflow?.importReport || missingLiveBindings.length === 0) {
      return;
    }
    if (lastAutoOpenedImportIdRef.current === activeWorkflow.id) {
      return;
    }
    lastAutoOpenedImportIdRef.current = activeWorkflow.id;
    setBindingWizardOpen(true);
  }, [activeWorkflow?.id, activeWorkflow?.importReport, missingLiveBindings.length]);

  const applyWorkflowBindings = useCallback(
    (bindings: Record<string, WorkflowBindingValue>) => {
      if (!activeWorkflow || !activeWorkflow.importReport) {
        setBindingWizardOpen(false);
        return;
      }
      const requirements = activeWorkflow.importReport.requirements;
      const applyAll = (value: unknown) =>
        requirements.reduce((next, requirement) => {
          const binding = bindings[requirement.key];
          if (!binding?.value) {
            return next;
          }
          return applyBindingToUnknown(next, requirement, binding);
        }, value);
      const nextNodes = nodes.map((node) => ({
        ...node,
        data: applyAll(node.data) as Record<string, unknown>,
      }));
      const nextDefinition = activeWorkflow.definition
        ? applyAll(activeWorkflow.definition)
        : undefined;
      const nextReport = { ...activeWorkflow.importReport, bindings };
      const updatedAt = new Date().toISOString();
      setNodes(nextNodes);
      setSelectedNode((prev) =>
        prev ? (nextNodes.find((node) => node.id === prev.id) ?? prev) : prev,
      );
      setWorkflows((prev) => {
        const next = prev.map((workflow) =>
          workflow.id === activeWorkflow.id
            ? {
                ...workflow,
                nodes: nextNodes,
                edges,
                definition: nextDefinition,
                importReport: nextReport,
                updatedAt,
              }
            : workflow,
        );
        saveWorkflowsLocal(next);
        return next;
      });
      setLastSaveStatus("Bindings applied");
      setBindingWizardOpen(false);
    },
    [activeWorkflow, edges, nodes, setNodes, setWorkflows],
  );

  const setWorkflowDeploymentStage = useCallback(
    async (stage: WorkflowDeploymentStage) => {
      if (!activeWorkflow || !activeWorkflowId) {
        return;
      }
      if (stage === "live" && missingLiveBindings.length > 0) {
        setBindingWizardOpen(true);
        setLastSaveStatus(`Bind ${missingLiveBindings.length} required item(s) before live`);
        return;
      }
      const cleanNodes = cleanWorkflowNodes();
      const nextWorkflow = withWorkflowDeploymentStage(
        { ...activeWorkflow, nodes: cleanNodes, edges },
        stage,
      );
      setWorkflows((prev) => {
        const next = prev.map((workflow) =>
          workflow.id === activeWorkflowId ? nextWorkflow : workflow,
        );
        saveWorkflowsLocal(next);
        return next;
      });
      setLastSaveStatus(
        stage === "live"
          ? "Live mode selected"
          : stage === "simulate"
            ? "Fixture mode selected"
            : `${stage.replace("_", " ")} mode selected`,
      );
      if (gateway.connected) {
        await gateway.request("workflows.update", {
          workflowId: activeWorkflowId,
          canvasData: { nodes: cleanNodes, edges },
          deploymentStage: stage,
          changeSummary: `Set workflow deployment stage to ${stage}`,
        });
      }
      if (stage === "live") {
        void validateCurrentWorkflow();
      }
    },
    [
      activeWorkflow,
      activeWorkflowId,
      cleanWorkflowNodes,
      edges,
      gateway,
      missingLiveBindings.length,
      setWorkflows,
      validateCurrentWorkflow,
    ],
  );

  useEffect(() => {
    if (activeWorkflow) {
      setNodes(activeWorkflow.nodes);
      setEdges(activeWorkflow.edges);
    } else {
      setNodes([]);
      setEdges([]);
    }
    setSelectedNode(null);
    setValidationIssues([]);
    setValidationCheckedAt(null);
    setValidationStatus("idle");
    setRunError(null);
    setBindingWizardOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkflowId]);

  // Auto-save local drafts while editing. Explicit Save is the durable PG write.
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeWorkflowId) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setWorkflows((prev) => {
        const next = prev.map((w) =>
          w.id === activeWorkflowId
            ? { ...w, nodes, edges, updatedAt: new Date().toISOString() }
            : w,
        );
        saveWorkflowsLocal(next);
        return next;
      });
    }, 500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [nodes, edges, activeWorkflowId, setWorkflows]);

  // Connect edges
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      // Sub-port connections get dashed style
      const isSubPort =
        connection.targetHandle === "model" ||
        connection.targetHandle === "memory" ||
        connection.targetHandle === "tools";
      const edgeStyle = isSubPort
        ? {
            stroke:
              connection.targetHandle === "model"
                ? "#8b5cf6"
                : connection.targetHandle === "memory"
                  ? "#22d3ee"
                  : "#fbbf24",
            strokeWidth: 1.5,
            strokeDasharray: "5 3",
          }
        : { stroke: "hsl(var(--primary))", strokeWidth: 2 };

      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            style: edgeStyle,
            animated: !isSubPort,
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  // Drop from palette
  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes("Files") ? "copy" : "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (file) {
        void onImportWorkflowFile(file);
        return;
      }
      if (!activeWorkflowId) {
        onNewWorkflow();
        return;
      }
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type) {
        return;
      }

      let position: { x: number; y: number };
      try {
        position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
      } catch {
        // Fallback: use raw client coordinates offset by canvas bounds
        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
        position = {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        };
      }

      // Check if this is a connector drop
      const connectorRaw = event.dataTransfer.getData("application/reactflow-connector");
      if (connectorRaw && type === "action") {
        try {
          const connector = JSON.parse(connectorRaw) as {
            id: string;
            name: string;
            category: string;
          };
          const data: ActionNodeData = {
            label: connector.name,
            actionType: "connector_action",
            config: {
              connectorId: connector.id,
              connectorName: connector.name,
              connectorCategory: connector.category,
            },
            timeoutMs: 30000,
          };
          setNodes((nds) => [
            ...nds,
            { id: `action-${Date.now()}`, type: "action", position, data },
          ]);
          return;
        } catch {
          /* fall through to normal action */
        }
      }

      let data: Record<string, unknown>;
      switch (type) {
        case "trigger":
          data = createDefaultTriggerData();
          break;
        case "agentStep":
          data = createDefaultAgentStepData();
          break;
        case "output":
          data = createDefaultOutputData();
          break;
        case "action":
          data = createDefaultActionData();
          break;
        case "gate":
          data = createDefaultGateData();
          break;
        case "modelProvider":
          data = {
            subPortType: "model_provider",
            label: "Model",
            config: { provider: "anthropic", model: "claude-sonnet-4-6" },
          };
          break;
        case "memorySource":
          data = {
            subPortType: "memory_source",
            label: "Knowledge",
            config: { sourceType: "knowledge_collection" },
          };
          break;
        case "toolGrant":
          data = { subPortType: "tool_grant", label: "Tool", config: { grantType: "connector" } };
          break;
        default:
          return;
      }

      setNodes((nds) => [...nds, { id: `${type}-${Date.now()}`, type, position, data }]);
    },
    [activeWorkflowId, onImportWorkflowFile, onNewWorkflow, screenToFlowPosition, setNodes],
  );

  // Selection
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);
  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  // Delete via keyboard
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.key === "Delete" || event.key === "Backspace") && selectedNode) {
        const tag = (event.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

        setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
        setEdges((eds) =>
          eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id),
        );
        setSelectedNode(null);
      }
    },
    [selectedNode, setNodes, setEdges],
  );

  // Update node data from properties panel
  const onUpdateNodeData = useCallback(
    (id: string, data: Record<string, unknown>) => {
      const nextData = { ...data };
      delete nextData.validationIssues;
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: nextData } : n)));
      setSelectedNode((prev) => (prev && prev.id === id ? { ...prev, data: nextData } : prev));
      setValidationIssues((prev) => prev.filter((issue) => issue.nodeId !== id));
    },
    [setNodes],
  );

  // Rename workflow
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");

  const startRename = () => {
    if (activeWorkflow) {
      setDraftName(activeWorkflow.name);
      setEditingName(true);
    }
  };

  const commitRename = () => {
    if (activeWorkflowId && draftName.trim()) {
      setWorkflows((prev) => {
        const next = prev.map((w) =>
          w.id === activeWorkflowId ? { ...w, name: draftName.trim() } : w,
        );
        saveWorkflowsLocal(next);
        return next;
      });
      if (gateway.connected) {
        gateway
          .request("workflows.update", {
            workflowId: activeWorkflowId,
            name: draftName.trim(),
            changeSummary: "Renamed workflow from canvas toolbar",
          })
          .catch(() => {
            /* localStorage is already updated */
          });
      }
    }
    setEditingName(false);
  };

  const validationErrorCount = validationIssues.filter(
    (issue) => issue.severity === "error",
  ).length;
  const validationWarningCount = validationIssues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const selectedNodeIssues = selectedNode
    ? validationIssues.filter((issue) => issue.nodeId === selectedNode.id)
    : [];
  const selectedNodeLatestStep = selectedNode
    ? [...(replayRun?.steps ?? [])].reverse().find((step) => step.nodeId === selectedNode.id)
    : undefined;
  const testDisabledReason = !activeWorkflowId
    ? "Create a workflow before testing."
    : !gateway.connected
      ? "Connect to the gateway before testing live wiring."
      : validationStatus === "checking"
        ? "Workflow validation is already running."
        : "";
  const saveDisabledReason = !activeWorkflowId
    ? "Create a workflow before saving."
    : saving
      ? "Workflow is already saving."
      : "";
  const runDisabledReason = !activeWorkflowId
    ? "Create a workflow before running."
    : activeWorkflow?.isActive === false
      ? "Activate this workflow before running it."
      : running
        ? "Workflow is already running."
        : saving
          ? "Wait for the save to finish before running."
          : validationStatus === "checking"
            ? "Wait for validation to finish before running."
            : !gateway.connected
              ? "Connect to the gateway before running workflows."
              : activeDeploymentStage === "live" && missingLiveBindings.length > 0
                ? `Bind ${missingLiveBindings.length} required item${
                    missingLiveBindings.length === 1 ? "" : "s"
                  } before running live.`
                : "";
  const scheduleDisabledReason = !activeWorkflowId
    ? "Create a workflow before scheduling."
    : scheduling
      ? "Workflow scheduling is already in progress."
      : !gateway.connected
        ? "Connect to the gateway before scheduling workflows."
        : "";
  const focusValidationIssue = useCallback(
    (issue: WorkflowValidationIssue) => {
      if (!issue.nodeId) return;
      const node = nodes.find((candidate) => candidate.id === issue.nodeId);
      if (!node) return;
      setSelectedNode(node);
      setCenter(node.position.x + 90, node.position.y + 45, { zoom: 1, duration: 250 });
    },
    [nodes, setCenter],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-3">
          {activeWorkflow ? (
            <input
              className="min-w-[220px] max-w-[360px] rounded border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-[hsl(var(--foreground))] outline-none hover:border-[hsl(var(--border))] focus:border-[hsl(var(--primary))] focus:bg-[hsl(var(--background))]"
              value={editingName ? draftName : activeWorkflow.name}
              onFocus={startRename}
              onChange={(e) => {
                if (!editingName) setEditingName(true);
                setDraftName(e.target.value);
              }}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  setEditingName(false);
                  setDraftName(activeWorkflow.name);
                  e.currentTarget.blur();
                }
              }}
              aria-label="Workflow name"
              title="Workflow name"
            />
          ) : (
            <button
              onClick={onNewWorkflow}
              className="rounded-lg border border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/10 px-3 py-1.5 text-sm font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/20"
            >
              New workflow
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onManageWorkflows}
            className="px-3 py-1 rounded text-[11px] font-semibold bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 transition-colors"
            title="Browse and manage saved workflows"
          >
            Manage Workflows
          </button>
          {bindingRequirementCount > 0 && (
            <button
              disabled={!activeWorkflowId}
              onClick={() => setBindingWizardOpen(true)}
              className="rounded px-3 py-1 text-[11px] font-medium bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-40 transition-colors"
              title="Bind imported workflow dependencies"
            >
              Bind {boundRequirementCount}/{bindingRequirementCount}
            </button>
          )}
          <button
            onClick={onNewWorkflow}
            className="px-3 py-1 rounded text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
            title="Create workflow"
          >
            New
          </button>
          <button
            disabled={!activeWorkflowId || !gateway.connected || validationStatus === "checking"}
            onClick={() => {
              void validateCurrentWorkflow();
            }}
            className="px-3 py-1 rounded text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 transition-colors"
            title={testDisabledReason || "Validate workflow wiring and runtime connectivity"}
          >
            {validationStatus === "checking" ? "Validating..." : "Validate"}
          </button>
          <button
            disabled={!activeWorkflowId || saving}
            onClick={() => {
              void saveCurrentWorkflow().then((saved) => {
                if (saved) {
                  void validateCurrentWorkflow();
                }
              });
            }}
            className="px-3 py-1 rounded text-[11px] font-medium bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/25 disabled:opacity-40 transition-colors"
            title={saveDisabledReason || "Save workflow"}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {lastSaveStatus && (
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {lastSaveStatus}
            </span>
          )}
          <button
            disabled={!activeWorkflowId}
            onClick={() => {
              if (!activeWorkflow) return;
              const cleanNodes = nodes.map((n) => ({
                ...n,
                position: n.position,
                data: stripExecState(n.data),
              }));
              const cleanEdges = edges.map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: e.sourceHandle,
                targetHandle: e.targetHandle,
              }));
              const workflowDefinition = isRecord(activeWorkflow.definition)
                ? activeWorkflow.definition
                : {
                    id: activeWorkflow.id,
                    name: activeWorkflow.name,
                    description: "",
                    defaultOnError: { strategy: "fail", notifyOnError: true },
                  };
              const exportData = {
                kind: "argent.workflow.package" as const,
                schemaVersion: 1,
                id: `pkg-${activeWorkflow.id}`,
                slug: compactWorkflowId(activeWorkflow.name.toLowerCase()) || activeWorkflow.id,
                name: activeWorkflow.name,
                description:
                  typeof workflowDefinition.description === "string"
                    ? workflowDefinition.description
                    : "",
                scenario: {
                  audience: "both",
                  department: "operations",
                  runPattern: "manual",
                  summary: "Exported from the ArgentOS workflow canvas.",
                },
                workflow: {
                  ...workflowDefinition,
                  id: activeWorkflow.id,
                  name: activeWorkflow.name,
                  nodes: cleanNodes,
                  edges: cleanEdges,
                  deploymentStage: activeDeploymentStage,
                },
                canvasLayout: {
                  ...(activeWorkflow.canvasLayout ?? {}),
                  nodes: cleanNodes,
                  edges: cleanEdges,
                },
                notes: ["Exported from the ArgentOS workflow canvas."],
              };
              const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${activeWorkflow.name.replace(/[^a-zA-Z0-9-_]/g, "-")}.argent-workflow.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="px-3 py-1 rounded text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 transition-colors"
            title="Export workflow"
          >
            Export
          </button>
          <button
            disabled={!activeWorkflowId || !gateway.connected}
            onClick={() => setVersionHistoryOpen((open) => !open)}
            className="px-3 py-1 rounded text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 transition-colors"
            title="Show workflow version history"
          >
            Versions
          </button>
          <button
            disabled={
              !activeWorkflowId ||
              activeWorkflow?.isActive === false ||
              running ||
              saving ||
              validationStatus === "checking" ||
              !gateway.connected ||
              (activeDeploymentStage === "live" && missingLiveBindings.length > 0)
            }
            onClick={handleRun}
            className={`px-3 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-40 ${
              running
                ? "bg-yellow-500/15 text-yellow-400"
                : "bg-green-500/15 text-green-400 hover:bg-green-500/25"
            }`}
            title={runDisabledReason || "Run workflow"}
          >
            {running ? "Running..." : activeDeploymentStage === "simulate" ? "Run fixture" : "Run"}
          </button>
          <button
            disabled={!activeWorkflowId || scheduling || !gateway.connected}
            onClick={() => {
              void handleSchedule();
            }}
            className="px-3 py-1 rounded text-[11px] font-medium bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-40 transition-colors"
            title={scheduleDisabledReason || "Schedule workflow"}
          >
            {scheduling ? "Scheduling..." : "Schedule"}
          </button>
        </div>
      </div>

      {versionHistoryOpen && activeWorkflowId && (
        <div className="flex-shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-[hsl(var(--foreground))]">
                Version History
              </div>
              <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                Current v{activeWorkflow?.version ?? 1}. Restores save the current graph first.
              </div>
            </div>
            <button
              onClick={() => void loadVersionHistory()}
              disabled={versionsLoading}
              className="rounded px-2 py-1 text-[10px] font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-40"
            >
              {versionsLoading ? "Loading..." : "Refresh"}
            </button>
          </div>
          {versions.length === 0 ? (
            <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {versionsLoading ? "Loading saved versions..." : "No prior versions yet."}
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {versions.map((version) => (
                <div
                  key={version.id}
                  className="min-w-[180px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[hsl(var(--foreground))]">
                      v{version.version}
                    </span>
                    <span className="text-[9px] text-[hsl(var(--muted-foreground))]">
                      {formatShortDate(version.createdAt)}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[10px] text-[hsl(var(--muted-foreground))]">
                    {version.changeSummary || "Saved version"}
                  </div>
                  <div className="mt-1 text-[9px] text-[hsl(var(--muted-foreground))]">
                    {version.nodeCount} nodes / {version.edgeCount} edges
                  </div>
                  <button
                    onClick={() => void handleRestoreVersion(version.version)}
                    disabled={versionActionBusy != null}
                    className="mt-2 w-full rounded bg-[hsl(var(--primary))]/15 px-2 py-1 text-[10px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/25 disabled:opacity-40"
                  >
                    {versionActionBusy === version.version ? "Restoring..." : "Restore"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeWorkflow?.importReport && (
        <div className="flex-shrink-0 border-b border-cyan-400/20 bg-cyan-400/5 px-4 py-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    activeDeploymentStage === "live"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-cyan-500/15 text-cyan-300"
                  }`}
                >
                  {activeDeploymentStage === "simulate" ? "fixture mode" : activeDeploymentStage}
                </span>
                <span className="truncate text-xs font-semibold text-[hsl(var(--foreground))]">
                  {activeWorkflow.importReport.packageName}
                </span>
                {importedFixtureReady && activeDeploymentStage !== "live" && (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    safe test data pinned
                  </span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                {activeDeploymentStage === "live"
                  ? "Live runs use configured credentials, channels, and connectors."
                  : "Fixture runs use pinned sample data so no external side effects fire while you configure the workflow."}
                {missingLiveBindings.length > 0
                  ? ` ${missingLiveBindings.length} required binding${missingLiveBindings.length === 1 ? "" : "s"} still needed for live.`
                  : " Required live bindings are complete."}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setBindingWizardOpen(true)}
                className="rounded border border-cyan-400/30 px-2.5 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-400/10"
              >
                Bind {boundRequirementCount}/{bindingRequirementCount}
              </button>
              {activeDeploymentStage !== "simulate" && (
                <button
                  type="button"
                  onClick={() => {
                    void setWorkflowDeploymentStage("simulate");
                  }}
                  className="rounded border border-[hsl(var(--border))] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                >
                  Back to fixture
                </button>
              )}
              {activeDeploymentStage !== "live" && (
                <button
                  type="button"
                  disabled={!gateway.connected || !livePromotionReady}
                  onClick={() => {
                    void setWorkflowDeploymentStage("live");
                  }}
                  className="rounded bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
                  title={
                    livePromotionReady
                      ? "Promote this workflow to live execution"
                      : "Complete required bindings before live promotion"
                  }
                >
                  Promote live
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {runError && (
        <div className="flex-shrink-0 border-b border-red-500/30 bg-red-500/10 px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-red-200">
              <span className="font-semibold">Run failed:</span>{" "}
              <span className="break-words">{runError}</span>
            </div>
            <button
              type="button"
              onClick={() => setRunError(null)}
              className="rounded px-2 py-1 text-[11px] font-medium text-red-200 hover:bg-red-500/15"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {(validationIssues.length > 0 || validationStatus === "error") && (
        <div
          className={`flex-shrink-0 border-b px-4 py-2 ${
            validationErrorCount > 0
              ? "border-red-500/30 bg-red-500/10"
              : "border-amber-500/30 bg-amber-500/10"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div
                className={`text-xs font-semibold ${
                  validationErrorCount > 0 ? "text-red-300" : "text-amber-300"
                }`}
              >
                {validationErrorCount > 0
                  ? `${validationErrorCount} workflow error${validationErrorCount === 1 ? "" : "s"}`
                  : `${validationWarningCount} workflow warning${validationWarningCount === 1 ? "" : "s"}`}
              </div>
              {validationCheckedAt && (
                <div className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                  Checked {new Date(validationCheckedAt).toLocaleTimeString()}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              {validationIssues.slice(0, 4).map((issue, index) => (
                <button
                  key={`${issue.code ?? "issue"}-${issue.nodeId ?? issue.edgeId ?? index}`}
                  type="button"
                  disabled={!issue.nodeId}
                  onClick={() => focusValidationIssue(issue)}
                  className="block w-full truncate rounded text-left text-[11px] text-[hsl(var(--foreground))] disabled:cursor-default disabled:opacity-100 enabled:hover:bg-[hsl(var(--background))]/50"
                  title={issue.message}
                >
                  {issue.nodeId && (
                    <span className="mr-1 font-mono text-[hsl(var(--muted-foreground))]">
                      {issue.nodeId}
                    </span>
                  )}
                  {issue.message}
                </button>
              ))}
              {validationIssues.length > 4 && (
                <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  +{validationIssues.length - 4} more
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Canvas + Right Dock */}
      <div className="flex-1 min-h-0 relative">
        {bindingWizardOpen && activeWorkflow && (
          <BindingWizard
            workflow={activeWorkflow}
            nodes={nodes}
            connectors={connectors}
            outputChannels={outputChannels}
            knowledgeCollections={knowledgeCollections}
            agents={agents}
            gateway={gateway}
            onClose={() => setBindingWizardOpen(false)}
            onApply={applyWorkflowBindings}
          />
        )}

        {/* Approval Request Banner */}
        {pendingApprovals.length > 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2">
            {pendingApprovals.map((approval) => (
              <div
                key={`${approval.runId}-${approval.nodeId}`}
                className="bg-amber-500/15 border border-amber-500/30 rounded-xl px-6 py-4 shadow-lg max-w-md backdrop-blur-sm"
              >
                <div className="text-sm font-semibold text-amber-400 mb-2">
                  Pipeline Paused -- Review Required
                </div>
                <div className="text-[11px] text-[hsl(var(--muted-foreground))] mb-2">
                  {approval.workflowName && <span>{approval.workflowName}</span>}
                  {approval.workflowName && approval.nodeLabel && <span> / </span>}
                  {approval.nodeLabel && <span>{approval.nodeLabel}</span>}
                  {approval.sideEffectClass && (
                    <span className="ml-2 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] uppercase text-amber-300">
                      {approval.sideEffectClass}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[hsl(var(--foreground))] mb-3">{approval.message}</div>
                {approval.previousOutput &&
                  (approval.previousOutput.text || approval.previousOutput.json) && (
                    <div className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--background))] rounded-lg p-3 mb-3 max-h-32 overflow-y-auto">
                      {approval.previousOutput.nodeLabel && (
                        <div className="font-medium text-[hsl(var(--foreground))] mb-1">
                          From: {approval.previousOutput.nodeLabel}
                        </div>
                      )}
                      {approval.previousOutput.text ||
                        JSON.stringify(approval.previousOutput.json, null, 2)}
                    </div>
                  )}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(approval.runId, approval.nodeId)}
                    className="px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-colors"
                  >
                    Approve &amp; Continue
                  </button>
                  <button
                    onClick={() => handleDeny(approval.runId, approval.nodeId)}
                    className="px-4 py-2 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors"
                  >
                    Deny &amp; Stop
                  </button>
                </div>
                {approval.timeoutMs && approval.timeoutMs > 0 && (
                  <div className="text-[10px] text-[hsl(var(--muted-foreground))] mt-2">
                    Auto-{approval.timeoutAction || "deny"} in{" "}
                    {Math.round(approval.timeoutMs / 60000)}m
                  </div>
                )}
                {!approval.timeoutMs && approval.timeoutAt && (
                  <div className="text-[10px] text-[hsl(var(--muted-foreground))] mt-2">
                    Timeout: {new Date(approval.timeoutAt).toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="absolute inset-0 dark" onKeyDown={onKeyDown} tabIndex={0}>
          <ReactFlow
            className="workflow-canvas"
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            defaultEdgeOptions={WORKFLOW_DEFAULT_EDGE_OPTIONS}
            proOptions={WORKFLOW_PRO_OPTIONS}
            style={WORKFLOW_REACT_FLOW_STYLE}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="hsl(var(--muted-foreground) / 0.15)"
            />
            <MiniMap
              nodeStrokeColor="hsl(var(--border))"
              nodeColor={WORKFLOW_MINIMAP_NODE_COLOR}
              maskColor="rgba(0, 0, 0, 0.5)"
              style={WORKFLOW_MINIMAP_STYLE}
            />
            <Controls showInteractive={false} style={WORKFLOW_CONTROLS_STYLE} />
          </ReactFlow>
          {!activeWorkflowId && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[hsl(var(--background))]/65 backdrop-blur-[1px]">
              <div className="max-w-[360px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 text-center shadow-2xl">
                <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
                  Create a workflow to start building
                </div>
                <div className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                  Workflows need a name before nodes can be saved, validated, or run.
                </div>
                <button
                  onClick={onNewWorkflow}
                  className="mt-4 rounded-lg bg-[hsl(var(--primary))]/15 px-4 py-2 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/25"
                >
                  New workflow
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right dock — slides out when a node is selected */}
        <div
          className="absolute top-0 right-0 h-full w-[380px] bg-[hsl(var(--card))] border-l border-[hsl(var(--border))] shadow-2xl z-50 flex flex-col"
          style={{
            transform: selectedNode ? "translateX(0)" : "translateX(100%)",
            transition: "transform 200ms ease-out",
          }}
        >
          {selectedNode &&
            (() => {
              // Connector action nodes render ConnectorNodePanel (owns its own header)
              if (selectedNode.type === "action") {
                const actionData = selectedNode.data as unknown as ActionNodeData;
                const connId = actionData.config?.connectorId as string | undefined;
                if (connId) {
                  return (
                    <ConnectorNodePanel
                      connectorId={connId}
                      nodeConfig={actionData.config ?? {}}
                      onConfigChange={(config) =>
                        onUpdateNodeData(selectedNode.id, {
                          ...actionData,
                          config,
                        })
                      }
                      onClose={() => setSelectedNode(null)}
                    />
                  );
                }
              }

              // Primitive nodes: shared header + per-type form
              return (
                <>
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))] flex-shrink-0">
                    <div>
                      <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
                        {((selectedNode.data as Record<string, unknown>).label as string) ||
                          selectedNode.type}
                      </div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">
                        {nodeKindLabel(selectedNode)}
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedNode(null)}
                      className="p-1.5 hover:bg-[hsl(var(--muted))] rounded-md transition-colors"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <path d="M1 1l12 12M13 1L1 13" />
                      </svg>
                    </button>
                  </div>

                  {/* Properties form — scrollable */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {selectedNodeIssues.length > 0 && (
                      <div
                        className={`rounded-lg border p-3 ${
                          selectedNodeIssues.some((issue) => issue.severity === "error")
                            ? "border-red-500/30 bg-red-500/10"
                            : "border-amber-500/30 bg-amber-500/10"
                        }`}
                      >
                        <div
                          className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${
                            selectedNodeIssues.some((issue) => issue.severity === "error")
                              ? "text-red-300"
                              : "text-amber-300"
                          }`}
                        >
                          Needs attention
                        </div>
                        <div className="space-y-1.5">
                          {selectedNodeIssues.map((issue, index) => (
                            <div
                              key={`${issue.code ?? issue.severity}-${index}`}
                              className="text-[11px] leading-relaxed text-[hsl(var(--foreground))]"
                            >
                              {issue.message}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedNode.type === "trigger" && (
                      <TriggerForm
                        data={selectedNode.data as unknown as TriggerNodeData}
                        onUpdate={onUpdateNodeData}
                        nodeId={selectedNode.id}
                        gateway={gateway}
                        appForgeEventOptions={appForgeEventOptions}
                        workflows={workflows}
                      />
                    )}
                    {selectedNode.type === "agentStep" && (
                      <AgentForm
                        data={selectedNode.data as unknown as AgentStepNodeData}
                        agents={agents}
                        availableTools={availableTools}
                        onUpdate={onUpdateNodeData}
                        nodeId={selectedNode.id}
                        gateway={gateway}
                      />
                    )}
                    {selectedNode.type === "action" && (
                      <ActionForm
                        data={selectedNode.data as unknown as ActionNodeData}
                        onUpdate={onUpdateNodeData}
                        nodeId={selectedNode.id}
                        gateway={gateway}
                        connectors={connectors}
                        knowledgeCollections={knowledgeCollections}
                        agents={agents}
                        outputChannels={outputChannels}
                      />
                    )}
                    {selectedNode.type === "gate" && (
                      <GateForm
                        data={selectedNode.data as unknown as GateNodeData}
                        onUpdate={onUpdateNodeData}
                        nodeId={selectedNode.id}
                        appForgeEventOptions={appForgeEventOptions}
                      />
                    )}
                    {selectedNode.type === "output" && (
                      <OutputForm
                        data={selectedNode.data as unknown as OutputNodeData}
                        onUpdate={onUpdateNodeData}
                        nodeId={selectedNode.id}
                        outputChannels={outputChannels}
                        nodes={nodes}
                        connectors={connectors}
                        knowledgeCollections={knowledgeCollections}
                        workflows={workflows}
                      />
                    )}
                    {selectedNode.type === "modelProvider" && (
                      <ModelProviderForm
                        data={selectedNode.data as unknown as SubPortNodeData}
                        onUpdate={onUpdateNodeData}
                        nodeId={selectedNode.id}
                      />
                    )}
                    {selectedNode.type === "memorySource" && (
                      <MemorySourceForm
                        data={selectedNode.data as unknown as SubPortNodeData}
                        onUpdate={onUpdateNodeData}
                        nodeId={selectedNode.id}
                        knowledgeCollections={knowledgeCollections}
                        agents={agents}
                      />
                    )}
                    {selectedNode.type === "toolGrant" && (
                      <ToolGrantForm
                        data={selectedNode.data as unknown as SubPortNodeData}
                        onUpdate={onUpdateNodeData}
                        nodeId={selectedNode.id}
                        connectors={connectors}
                        availableTools={availableTools}
                      />
                    )}
                    {["trigger", "agentStep", "action", "gate", "output"].includes(
                      selectedNode.type ?? "",
                    ) && (
                      <ExecutionDataPanel
                        key={selectedNode.id}
                        node={selectedNode}
                        latestStep={selectedNodeLatestStep}
                        onUpdate={onUpdateNodeData}
                        onTestToNode={handleTestToNode}
                        testing={partialRunningNodeId === selectedNode.id}
                      />
                    )}
                  </div>
                </>
              );
            })()}
        </div>
      </div>
    </div>
  );
}
