import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ItemSet, WorkflowDefinition, WorkflowEdge, WorkflowNode } from "./workflow-types.js";
import {
  normalizeWorkflow,
  type CanvasWorkflowLayout,
  type WorkflowIssue,
  type WorkflowNormalizationInput,
  type WorkflowNormalizationResult,
} from "./workflow-normalize.js";

export type WorkflowPackageFormat = "json" | "yaml";

export interface WorkflowPackageCredentialRequirement {
  id: string;
  label: string;
  provider: string;
  purpose: string;
  requiredForLive?: boolean;
}

export interface WorkflowPackageDependency {
  kind: "connector" | "channel" | "appforge_base" | "knowledge_collection" | "agent";
  id: string;
  label?: string;
  requiredForLive?: boolean;
}

export interface WorkflowPackageTestFixtures {
  triggerPayload?: Record<string, unknown>;
  pinnedOutputs?: Record<string, unknown>;
}

export interface WorkflowPackageScenario {
  audience: "solo_operator" | "small_business" | "both";
  department: "marketing" | "sales" | "hr" | "operations" | "finance" | "support";
  runPattern: "manual" | "schedule" | "webhook" | "appforge_event" | "message_event";
  summary: string;
  appForgeTables?: string[];
}

export interface WorkflowPackage {
  kind: "argent.workflow.package";
  schemaVersion: 1;
  id: string;
  slug: string;
  name: string;
  description: string;
  scenario: WorkflowPackageScenario;
  workflow: WorkflowDefinition;
  canvasLayout: CanvasWorkflowLayout;
  credentials?: {
    required: WorkflowPackageCredentialRequirement[];
  };
  dependencies?: WorkflowPackageDependency[];
  testFixtures?: WorkflowPackageTestFixtures;
  notes?: string[];
}

export interface ImportedWorkflowPackage {
  package: WorkflowPackage;
  normalized: WorkflowNormalizationResult;
  readiness: WorkflowPackageReadiness;
}

export interface WorkflowPackageReadiness {
  okForImport: boolean;
  okForPinnedTestRun: boolean;
  blockers: WorkflowIssue[];
  liveRequirements: string[];
  liveReadiness?: WorkflowPackageLiveReadiness;
}

export type WorkflowPackageLiveReadinessStatus = "live_ready" | "canary_required" | "dry_run_only";

export type WorkflowPackageLiveReadinessReasonCode =
  | "missing_connector"
  | "connector_repo_only"
  | "connector_no_binary"
  | "connector_not_ready"
  | "missing_credentials"
  | "missing_appforge_base"
  | "missing_appforge_table"
  | "appforge_metadata_only"
  | "appforge_write_not_ready"
  | "missing_channel"
  | "canary_required";

export interface WorkflowPackageLiveReadinessReason {
  code: WorkflowPackageLiveReadinessReasonCode;
  kind: "connector" | "credential" | "appforge" | "channel" | "canary";
  id: string;
  label: string;
  message: string;
}

export interface WorkflowPackageLiveReadiness {
  okForLive: boolean;
  status: WorkflowPackageLiveReadinessStatus;
  label: string;
  reasons: WorkflowPackageLiveReadinessReason[];
}

export interface WorkflowPackageLiveReadinessConnector {
  tool: string;
  label?: string;
  installState?: string;
  status?: { ok?: boolean; label?: string; detail?: string };
  modes?: string[];
  discovery?: { binaryPath?: string };
}

export interface WorkflowPackageLiveReadinessContext {
  connectors?: WorkflowPackageLiveReadinessConnector[];
  credentialIds?: string[];
  appForgeBases?: Array<{
    id: string;
    label?: string;
    readReady?: boolean;
    writeReady?: boolean;
    tables?: Array<{ id: string; label?: string; readReady?: boolean; writeReady?: boolean }>;
  }>;
  channelIds?: string[];
  canaryPassedPackageSlugs?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertWorkflowPackage(value: unknown): WorkflowPackage {
  if (!isRecord(value)) {
    throw new Error("Workflow package must be an object.");
  }
  const candidate = value as Partial<WorkflowPackage>;
  if (candidate.kind !== "argent.workflow.package") {
    throw new Error('Workflow package kind must be "argent.workflow.package".');
  }
  if (candidate.schemaVersion !== 1) {
    throw new Error("Unsupported workflow package schemaVersion.");
  }
  if (!candidate.workflow || !Array.isArray(candidate.workflow.nodes)) {
    throw new Error("Workflow package requires workflow.nodes.");
  }
  if (!Array.isArray(candidate.workflow.edges)) {
    throw new Error("Workflow package requires workflow.edges.");
  }
  if (!candidate.canvasLayout || !Array.isArray(candidate.canvasLayout.nodes)) {
    throw new Error("Workflow package requires canvasLayout.nodes.");
  }
  return candidate as WorkflowPackage;
}

export function parseWorkflowPackageText(
  text: string,
  format: WorkflowPackageFormat = text.trimStart().startsWith("{") ? "json" : "yaml",
): WorkflowPackage {
  const parsed = format === "json" ? (JSON.parse(text) as unknown) : (parseYaml(text) as unknown);
  return assertWorkflowPackage(parsed);
}

export function serializeWorkflowPackage(
  workflowPackage: WorkflowPackage,
  format: WorkflowPackageFormat = "json",
): string {
  if (format === "yaml") {
    return stringifyYaml(workflowPackage, { lineWidth: 110 });
  }
  return `${JSON.stringify(workflowPackage, null, 2)}\n`;
}

export function workflowPackageToNormalizationInput(
  workflowPackage: WorkflowPackage,
): WorkflowNormalizationInput {
  return {
    id: workflowPackage.workflow.id,
    name: workflowPackage.workflow.name,
    description: workflowPackage.workflow.description,
    nodes: workflowPackage.workflow.nodes,
    edges: workflowPackage.workflow.edges,
    canvasLayout: workflowPackage.canvasLayout,
    defaultOnError: workflowPackage.workflow.defaultOnError,
    maxRunDurationMs: workflowPackage.workflow.maxRunDurationMs,
    maxRunCostUsd: workflowPackage.workflow.maxRunCostUsd,
    deploymentStage: workflowPackage.workflow.deploymentStage,
  };
}

export function applyWorkflowPackageTestFixtures(
  workflowPackage: WorkflowPackage,
): WorkflowDefinition {
  const pinned = workflowPackage.testFixtures?.pinnedOutputs ?? {};
  return {
    ...workflowPackage.workflow,
    nodes: workflowPackage.workflow.nodes.map((node) => applyPinnedOutput(node, pinned[node.id])),
    edges: workflowPackage.workflow.edges.map((edge) => ({ ...edge })),
  };
}

function applyPinnedOutput(node: WorkflowNode, pinnedOutput: unknown): WorkflowNode {
  if (pinnedOutput === undefined) {
    return node;
  }
  switch (node.kind) {
    case "trigger":
      return { ...node, config: { ...node.config, pinnedOutput } };
    case "agent":
      return { ...node, config: { ...node.config, pinnedOutput } };
    case "action":
      return { ...node, config: { ...node.config, pinnedOutput } };
    case "gate":
      return { ...node, config: { ...node.config, pinnedOutput } };
    case "output":
      return { ...node, config: { ...node.config, pinnedOutput } };
  }
}

export function auditWorkflowPackageReadiness(
  workflowPackage: WorkflowPackage,
  normalized: WorkflowNormalizationResult,
  liveContext?: WorkflowPackageLiveReadinessContext,
): WorkflowPackageReadiness {
  const blockers = normalized.issues.filter((issue) => issue.severity === "error");
  const testPinnedNodeIds = new Set(Object.keys(workflowPackage.testFixtures?.pinnedOutputs ?? {}));
  const sideEffectNodes = workflowPackage.workflow.nodes.filter((node) => {
    if (node.kind === "action") {
      return (
        node.config.actionType.type !== "store_memory" &&
        node.config.actionType.type !== "store_knowledge"
      );
    }
    if (node.kind === "output") {
      return !["docpanel", "knowledge"].includes(node.config.outputType);
    }
    return false;
  });
  const unpinnedSideEffects = sideEffectNodes
    .filter((node) => !testPinnedNodeIds.has(node.id))
    .map((node) => `${node.id} (${node.kind})`);
  const liveRequirements = [
    ...(workflowPackage.credentials?.required ?? [])
      .filter((credential) => credential.requiredForLive !== false)
      .map((credential) => `credential:${credential.id} (${credential.label})`),
    ...(workflowPackage.dependencies ?? [])
      .filter((dependency) => dependency.requiredForLive !== false)
      .map(
        (dependency) =>
          `${dependency.kind}:${dependency.id}${dependency.label ? ` (${dependency.label})` : ""}`,
      ),
  ];
  return {
    okForImport: blockers.length === 0,
    okForPinnedTestRun: blockers.length === 0 && unpinnedSideEffects.length === 0,
    blockers: [
      ...blockers,
      ...unpinnedSideEffects.map((nodeId) => ({
        severity: "error" as const,
        code: "unpinned_side_effect_for_test",
        message: `Side-effect node is not pinned for fixture execution: ${nodeId}.`,
      })),
    ],
    liveRequirements,
    liveReadiness: auditWorkflowPackageLiveReadiness(workflowPackage, liveContext),
  };
}

export function auditWorkflowPackageLiveReadiness(
  workflowPackage: WorkflowPackage,
  context: WorkflowPackageLiveReadinessContext = {},
): WorkflowPackageLiveReadiness {
  const reasons: WorkflowPackageLiveReadinessReason[] = [];
  const connectorMap = new Map((context.connectors ?? []).map((entry) => [entry.tool, entry]));
  const credentialIds = new Set(context.credentialIds ?? []);
  const channelIds = new Set(context.channelIds ?? []);
  const appForgeBases = new Map((context.appForgeBases ?? []).map((base) => [base.id, base]));
  const requiredConnectors = collectWorkflowPackageConnectorIds(workflowPackage);

  for (const connectorId of requiredConnectors) {
    const connector = connectorMap.get(connectorId);
    if (!connector) {
      reasons.push({
        code: "missing_connector",
        kind: "connector",
        id: connectorId,
        label: connectorId,
        message: `Connector ${connectorId} is not available in the connector catalog.`,
      });
      continue;
    }
    if (connectorId === "appforge-core") {
      const hasWriteMode =
        connector.modes?.some((mode) => mode === "write" || mode === "full" || mode === "admin") ??
        false;
      if (connector.installState === "metadata-only") {
        reasons.push({
          code: "appforge_metadata_only",
          kind: "appforge",
          id: connectorId,
          label: connector.label ?? connectorId,
          message:
            "appforge-core is metadata/read-ready only; it is not a live AppForge write runtime.",
        });
      }
      if (!hasWriteMode) {
        reasons.push({
          code: "appforge_write_not_ready",
          kind: "appforge",
          id: connectorId,
          label: connector.label ?? connectorId,
          message:
            "appforge-core does not advertise write/full/admin mode for live workflow writes.",
        });
      }
      continue;
    }
    if (connector.installState === "repo-only") {
      reasons.push({
        code: "connector_repo_only",
        kind: "connector",
        id: connectorId,
        label: connector.label ?? connectorId,
        message: `Connector ${connectorId} is repo-only and has no runnable installed adapter.`,
      });
    } else if (!connector.discovery?.binaryPath) {
      reasons.push({
        code: "connector_no_binary",
        kind: "connector",
        id: connectorId,
        label: connector.label ?? connectorId,
        message: `Connector ${connectorId} has no runnable binary for live execution.`,
      });
    } else if (connector.status?.ok !== true || connector.installState !== "ready") {
      reasons.push({
        code: "connector_not_ready",
        kind: "connector",
        id: connectorId,
        label: connector.label ?? connectorId,
        message: `Connector ${connectorId} is not live-ready: ${
          connector.status?.detail ?? connector.status?.label ?? connector.installState ?? "unknown"
        }.`,
      });
    }
  }

  for (const credential of workflowPackage.credentials?.required ?? []) {
    if (credential.requiredForLive === false) {
      continue;
    }
    if (!credentialIds.has(credential.id)) {
      reasons.push({
        code: "missing_credentials",
        kind: "credential",
        id: credential.id,
        label: credential.label,
        message: `Credential ${credential.id} (${credential.label}) is required before live execution.`,
      });
    }
  }

  for (const dependency of workflowPackage.dependencies ?? []) {
    if (dependency.requiredForLive === false) {
      continue;
    }
    if (dependency.kind === "channel" && !channelIds.has(dependency.id)) {
      reasons.push({
        code: "missing_channel",
        kind: "channel",
        id: dependency.id,
        label: dependency.label ?? dependency.id,
        message: `Channel ${dependency.id} must be bound before live delivery.`,
      });
    }
    if (dependency.kind === "appforge_base") {
      const base = appForgeBases.get(dependency.id);
      if (!base) {
        reasons.push({
          code: "missing_appforge_base",
          kind: "appforge",
          id: dependency.id,
          label: dependency.label ?? dependency.id,
          message: `AppForge base ${dependency.id} must exist before live execution.`,
        });
      } else if (!base.writeReady) {
        reasons.push({
          code: "appforge_write_not_ready",
          kind: "appforge",
          id: dependency.id,
          label: base.label ?? dependency.label ?? dependency.id,
          message: `AppForge base ${dependency.id} is not write-ready for live workflow mutations.`,
        });
      }
    }
  }

  for (const tableName of workflowPackage.scenario.appForgeTables ?? []) {
    const tableReady = [...appForgeBases.values()].some((base) =>
      (base.tables ?? []).some(
        (table) =>
          (table.id === tableName || table.label === tableName) &&
          table.readReady === true &&
          table.writeReady === true,
      ),
    );
    if (!tableReady) {
      reasons.push({
        code: "missing_appforge_table",
        kind: "appforge",
        id: tableName,
        label: tableName,
        message: `AppForge table ${tableName} must be read/write-ready before live execution.`,
      });
    }
  }

  if (!context.canaryPassedPackageSlugs?.includes(workflowPackage.slug)) {
    reasons.push({
      code: "canary_required",
      kind: "canary",
      id: workflowPackage.slug,
      label: workflowPackage.name,
      message: "A gated live canary is required before this template can be marked live-ready.",
    });
  }

  const okForLive = reasons.length === 0;
  const status: WorkflowPackageLiveReadinessStatus = okForLive
    ? "live_ready"
    : reasons.every((reason) => reason.code === "canary_required")
      ? "canary_required"
      : "dry_run_only";
  return {
    okForLive,
    status,
    label:
      status === "live_ready"
        ? "Live ready"
        : status === "canary_required"
          ? "Canary required"
          : "Import/dry-run only",
    reasons,
  };
}

function collectWorkflowPackageConnectorIds(workflowPackage: WorkflowPackage): string[] {
  const connectorIds = new Set<string>();
  for (const dependency of workflowPackage.dependencies ?? []) {
    if (dependency.kind === "connector") {
      connectorIds.add(dependency.id);
    }
  }
  for (const node of workflowPackage.workflow.nodes) {
    if (node.kind === "action" && node.config.actionType.type === "connector_action") {
      connectorIds.add(node.config.actionType.connectorId);
    }
    if (node.kind === "output" && node.config.outputType === "connector_action") {
      connectorIds.add(node.config.connectorId);
    }
  }
  return [...connectorIds].toSorted();
}

export function importWorkflowPackage(
  workflowPackage: WorkflowPackage,
  liveContext?: WorkflowPackageLiveReadinessContext,
): ImportedWorkflowPackage {
  const normalized = normalizeWorkflow(workflowPackageToNormalizationInput(workflowPackage));
  return {
    package: workflowPackage,
    normalized,
    readiness: auditWorkflowPackageReadiness(workflowPackage, normalized, liveContext),
  };
}

export function workflowDefinitionToPackage(params: {
  id: string;
  slug: string;
  name: string;
  description: string;
  scenario: WorkflowPackageScenario;
  workflow: WorkflowDefinition;
  canvasLayout?: CanvasWorkflowLayout;
  credentials?: WorkflowPackage["credentials"];
  dependencies?: WorkflowPackageDependency[];
  testFixtures?: WorkflowPackageTestFixtures;
  notes?: string[];
}): WorkflowPackage {
  return {
    kind: "argent.workflow.package",
    schemaVersion: 1,
    id: params.id,
    slug: params.slug,
    name: params.name,
    description: params.description,
    scenario: params.scenario,
    workflow: params.workflow,
    canvasLayout:
      params.canvasLayout ?? defaultCanvasLayout(params.workflow.nodes, params.workflow.edges),
    credentials: params.credentials,
    dependencies: params.dependencies,
    testFixtures: params.testFixtures,
    notes: params.notes,
  };
}

export function defaultCanvasLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): CanvasWorkflowLayout {
  return {
    nodes: nodes.map((node, index) => ({
      id: node.id,
      type:
        node.kind === "agent"
          ? "agentStep"
          : node.kind === "gate" && node.config.gateType === "approval"
            ? "approval"
            : node.kind,
      position: { x: 160 + (index % 4) * 320, y: 140 + Math.floor(index / 4) * 220 },
      data: { label: "label" in node ? node.label : node.id },
    })),
    edges: edges.map((edge) => ({ ...edge })),
  };
}

export function pinnedItem(text: string, json: Record<string, unknown> = {}): ItemSet {
  return { items: [{ text, json }] };
}
