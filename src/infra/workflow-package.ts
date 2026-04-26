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
  };
}

export function importWorkflowPackage(workflowPackage: WorkflowPackage): ImportedWorkflowPackage {
  const normalized = normalizeWorkflow(workflowPackageToNormalizationInput(workflowPackage));
  return {
    package: workflowPackage,
    normalized,
    readiness: auditWorkflowPackageReadiness(workflowPackage, normalized),
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
