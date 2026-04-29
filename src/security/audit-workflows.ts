export type WorkflowAuditSeverity = "info" | "warn" | "critical";

export type WorkflowAuditFinding = {
  checkId: string;
  severity: WorkflowAuditSeverity;
  title: string;
  detail: string;
  remediation?: string;
};

export type WorkflowAuditInput = {
  workflows?: readonly unknown[];
  workflowSnapshots?: unknown;
  cronJobs?: readonly unknown[];
  cronSnapshots?: unknown;
};

type JsonRecord = Record<string, unknown>;

const SECRET_KEY_PARTS = ["password", "token", "apikey", "secret"];
const SECRET_KEY_ALLOWLIST = new Set([
  "credentialid",
  "credentialname",
  "credentialtype",
  "maxtokenbudget",
  "tokenbudget",
  "tokensused",
]);

const EFFECTFUL_ACTIONS = new Set([
  "sendmessage",
  "sendemail",
  "createtask",
  "webhookcall",
  "apicall",
  "runscript",
  "generateimage",
  "generateaudio",
  "podcastgenerate",
  "connectoraction",
]);

const EFFECTFUL_SIDE_EFFECTS = new Set([
  "externalmutation",
  "externalwrite",
  "outbounddelivery",
  "mediageneration",
  "scriptexecution",
]);

const MUTATING_ACTION_WORDS = [
  "send",
  "post",
  "publish",
  "deliver",
  "create",
  "update",
  "delete",
  "write",
  "webhook",
  "api",
  "script",
];

const DESTINATION_KEYS = [
  "to",
  "recipient",
  "recipients",
  "channel",
  "channelid",
  "channel_id",
  "url",
  "endpoint",
  "webhookurl",
  "taskid",
  "collectionid",
  "workflowid",
  "documentid",
  "destination",
];

export function collectWorkflowSecurityFindings(input: WorkflowAuditInput): WorkflowAuditFinding[] {
  const workflows = collectWorkflowRecords(input);
  const cronJobs = collectCronRecords(input);
  const findings: WorkflowAuditFinding[] = [];

  for (const workflow of workflows) {
    const nodes = collectWorkflowNodes(workflow);
    findings.push(...collectEmbeddedSecretFindings(workflow, nodes));
    findings.push(...collectLiveActionFindings(workflow, nodes));
    findings.push(...collectMissingDestinationFindings(workflow, nodes));
  }

  if (workflows.length > 0 && hasCronSnapshotInput(input)) {
    findings.push(...collectScheduleReconciliationFindings(workflows, cronJobs));
  }

  return findings;
}

export const auditWorkflowSecurity = collectWorkflowSecurityFindings;

function collectWorkflowRecords(input: WorkflowAuditInput): unknown[] {
  return [
    ...flattenSnapshotRecords(input.workflows),
    ...flattenSnapshotRecords(input.workflowSnapshots),
  ].filter((record) => isRecord(record) || Array.isArray(record));
}

function collectCronRecords(input: WorkflowAuditInput): unknown[] {
  return [...flattenCronRecords(input.cronJobs), ...flattenCronRecords(input.cronSnapshots)];
}

function hasCronSnapshotInput(input: WorkflowAuditInput): boolean {
  return input.cronJobs !== undefined || input.cronSnapshots !== undefined;
}

function flattenSnapshotRecords(snapshot: unknown): unknown[] {
  if (snapshot === undefined || snapshot === null) {
    return [];
  }
  if (Array.isArray(snapshot)) {
    return snapshot;
  }
  if (!isRecord(snapshot)) {
    return [];
  }
  for (const key of ["workflows", "workflowRecords", "definitions", "records"]) {
    const value = snapshot[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [snapshot];
}

function flattenCronRecords(snapshot: unknown): unknown[] {
  if (snapshot === undefined || snapshot === null) {
    return [];
  }
  if (Array.isArray(snapshot)) {
    return snapshot;
  }
  if (!isRecord(snapshot)) {
    return [];
  }
  for (const key of ["jobs", "cronJobs", "records"]) {
    const value = snapshot[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [snapshot];
}

function collectEmbeddedSecretFindings(
  workflow: unknown,
  nodes: readonly unknown[],
): WorkflowAuditFinding[] {
  const findings: WorkflowAuditFinding[] = [];
  const workflowLabel = formatWorkflowLabel(workflow);

  for (const node of nodes) {
    const config = getNodeConfig(node);
    if (!config) {
      continue;
    }
    const secretPaths = collectSecretPaths(config, "config");
    if (secretPaths.length === 0) {
      continue;
    }
    findings.push({
      checkId: "workflows.secrets.embedded",
      severity: "critical",
      title: "Workflow node config embeds secret-like fields",
      detail: `${workflowLabel} ${formatNodeLabel(node)} includes secret-like config keys (${secretPaths.join(
        ", ",
      )}). Values are intentionally omitted from this audit output.`,
      remediation:
        "Move workflow credentials into the credential store or environment-backed secret references, then keep only credential IDs or secret references in workflow config.",
    });
  }

  return findings;
}

function collectLiveActionFindings(
  workflow: unknown,
  nodes: readonly unknown[],
): WorkflowAuditFinding[] {
  const findings: WorkflowAuditFinding[] = [];
  const workflowLabel = formatWorkflowLabel(workflow);

  for (const node of nodes) {
    if (!isActionNode(node)) {
      continue;
    }
    const action = getActionRecord(node);
    const actionId = getActionId(node, action);
    if (!isLiveSideEffectAction(node, action, actionId)) {
      continue;
    }
    if (hasApprovalMetadata(node, action) || hasSafeExecutionMode(workflow, node, action)) {
      continue;
    }
    findings.push({
      checkId: "workflows.actions.live_requires_approval",
      severity: "warn",
      title: "Live workflow action lacks approval or dry-run metadata",
      detail: `${workflowLabel} ${formatNodeLabel(node)} uses ${
        actionId ?? "an effectful action"
      } without detectable approval metadata or an explicit safe/dry-run execution mode.`,
      remediation:
        "Add operator approval metadata for the action, or mark the workflow/action as dry-run, safe mode, simulate, shadow, or paper-trade before live execution.",
    });
  }

  return findings;
}

function collectMissingDestinationFindings(
  workflow: unknown,
  nodes: readonly unknown[],
): WorkflowAuditFinding[] {
  const findings: WorkflowAuditFinding[] = [];
  const workflowLabel = formatWorkflowLabel(workflow);

  for (const node of nodes) {
    const destinationType = getDestinationNodeType(node);
    if (!destinationType || hasExplicitDestination(node)) {
      continue;
    }
    findings.push({
      checkId: "workflows.output.missing_destination",
      severity: "warn",
      title: "Workflow delivery output lacks an explicit destination",
      detail: `${workflowLabel} ${formatNodeLabel(
        node,
      )} is configured as ${destinationType} but does not expose a destination field such as channel, recipient, URL, task, collection, or workflow ID.`,
      remediation:
        "Set an explicit destination on delivery/output nodes so workflow execution cannot fall back to an implicit or ambient target.",
    });
  }

  return findings;
}

function collectScheduleReconciliationFindings(
  workflows: readonly unknown[],
  cronJobs: readonly unknown[],
): WorkflowAuditFinding[] {
  const cronEvidence = collectCronWorkflowEvidence(cronJobs);
  const findings: WorkflowAuditFinding[] = [];

  for (const workflow of workflows) {
    const nodes = collectWorkflowNodes(workflow);
    if (!isScheduledWorkflow(workflow, nodes)) {
      continue;
    }
    const workflowId = getWorkflowId(workflow);
    const workflowName = getWorkflowName(workflow);
    const hasEvidence =
      (workflowId !== null && cronEvidence.workflowIds.has(workflowId)) ||
      (workflowName !== null && cronEvidence.workflowNames.has(workflowName));
    if (hasEvidence) {
      continue;
    }
    findings.push({
      checkId: "workflows.schedule.missing_cron_evidence",
      severity: "warn",
      title: "Scheduled workflow lacks matching cron evidence",
      detail: `${formatWorkflowLabel(
        workflow,
      )} has schedule metadata, but the provided cron snapshot does not include an enabled workflow-run job for the same workflow.`,
      remediation:
        "Reconcile the workflow definition with the scheduler store, or remove stale schedule metadata from workflows that are no longer scheduled.",
    });
  }

  return findings;
}

function collectWorkflowNodes(workflow: unknown): unknown[] {
  const nodes: unknown[] = [];
  const seen = new Set<unknown>();
  const addNodes = (value: unknown) => {
    if (!Array.isArray(value)) {
      return;
    }
    for (const node of value) {
      if (!seen.has(node)) {
        seen.add(node);
        nodes.push(node);
      }
    }
  };

  for (const record of collectWorkflowSurfaces(workflow)) {
    addNodes(record.nodes);
    if (isRecord(record.canvasLayout)) {
      addNodes(record.canvasLayout.nodes);
    }
  }

  return nodes;
}

function collectWorkflowSurfaces(workflow: unknown): JsonRecord[] {
  const surfaces: JsonRecord[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 3 || !isRecord(value) || seen.has(value)) {
      return;
    }
    seen.add(value);
    surfaces.push(value);
    for (const key of ["workflow", "definition", "workflowDefinition", "record", "data"]) {
      visit(value[key], depth + 1);
    }
  };

  visit(workflow, 0);
  return surfaces;
}

function getNodeConfig(node: unknown): unknown {
  if (!isRecord(node)) {
    return null;
  }
  if (isRecord(node.config)) {
    return node.config;
  }
  if (isRecord(node.data)) {
    if (isRecord(node.data.config)) {
      return node.data.config;
    }
    return node.data;
  }
  return null;
}

function collectSecretPaths(value: unknown, path: string): string[] {
  const paths: string[] = [];
  const visit = (current: unknown, currentPath: string) => {
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${currentPath}[${index}]`));
      return;
    }
    if (!isRecord(current)) {
      return;
    }
    for (const [key, entry] of Object.entries(current)) {
      const childPath = `${currentPath}.${key}`;
      if (isSecretField(key) && hasEmbeddedSecretValue(entry)) {
        paths.push(childPath);
        continue;
      }
      visit(entry, childPath);
    }
  };

  visit(value, path);
  return paths;
}

function isSecretField(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    !SECRET_KEY_ALLOWLIST.has(normalized) &&
    SECRET_KEY_PARTS.some((part) => normalized.includes(part))
  );
}

function hasEmbeddedSecretValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 && !isSecretReference(trimmed);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  return isRecord(value) || Array.isArray(value);
}

function isSecretReference(value: string): boolean {
  const lowered = value.toLowerCase();
  return (
    lowered === "redacted" ||
    lowered === "<redacted>" ||
    lowered.startsWith("env:") ||
    lowered.startsWith("secret:") ||
    lowered.startsWith("secrets:") ||
    lowered.startsWith("$") ||
    lowered.startsWith("${") ||
    lowered.startsWith("process.env.") ||
    (lowered.includes("{{") && lowered.includes("secret"))
  );
}

function isActionNode(node: unknown): boolean {
  if (!isRecord(node)) {
    return false;
  }
  const kind =
    asString(node.kind) ?? asString(node.type) ?? asString(getNested(node, ["data", "kind"]));
  if (kind && normalizeKey(kind).includes("action")) {
    return true;
  }
  return getActionRecord(node) !== null;
}

function getActionRecord(node: unknown): unknown {
  if (!isRecord(node)) {
    return null;
  }
  const config = getNodeConfig(node);
  if (isRecord(config) && config.actionType !== undefined) {
    return config.actionType;
  }
  for (const path of [
    ["actionType"],
    ["action"],
    ["data", "actionType"],
    ["data", "action"],
    ["data", "operation"],
  ]) {
    const value = getNested(node, path);
    if (value !== undefined) {
      return value;
    }
  }
  return null;
}

function getActionId(node: unknown, action: unknown): string | null {
  if (typeof action === "string") {
    return action;
  }
  if (isRecord(action)) {
    return (
      asString(action.type) ??
      asString(action.id) ??
      asString(action.action) ??
      asString(action.operation) ??
      null
    );
  }
  if (isRecord(node)) {
    return asString(node.actionType) ?? asString(node.operation) ?? null;
  }
  return null;
}

function isLiveSideEffectAction(node: unknown, action: unknown, actionId: string | null): boolean {
  const normalizedAction = actionId ? normalizeKey(actionId) : null;
  if (normalizedAction && EFFECTFUL_ACTIONS.has(normalizedAction)) {
    return true;
  }

  const sideEffect =
    asString(getNested(node, ["sideEffect"])) ??
    asString(getNested(node, ["sideEffectLevel"])) ??
    asString(getNested(node, ["data", "sideEffect"])) ??
    asString(getNested(node, ["data", "sideEffectLevel"])) ??
    asString(getNested(node, ["config", "sideEffect"])) ??
    asString(getNested(node, ["config", "sideEffectLevel"]));
  if (sideEffect && EFFECTFUL_SIDE_EFFECTS.has(normalizeKey(sideEffect))) {
    return true;
  }

  if (normalizedAction) {
    return MUTATING_ACTION_WORDS.some((word) => normalizedAction.includes(word));
  }
  if (isRecord(action)) {
    const operation = asString(action.operation) ?? asString(action.resource);
    return operation
      ? MUTATING_ACTION_WORDS.some((word) => normalizeKey(operation).includes(word))
      : false;
  }
  return false;
}

function hasApprovalMetadata(node: unknown, action: unknown): boolean {
  for (const value of [node, getNodeConfig(node), action]) {
    if (!isRecord(value)) {
      continue;
    }
    if (
      value.operatorApprovedLive === true ||
      value.requiresApproval === true ||
      value.approvalRequired === true ||
      value.requiresOperatorApproval === true ||
      asString(value.operatorApprovedAt) !== null ||
      asString(value.approvedAt) !== null ||
      isRecord(value.approval)
    ) {
      return true;
    }
  }
  return false;
}

function hasSafeExecutionMode(workflow: unknown, node: unknown, action: unknown): boolean {
  for (const value of [
    workflow,
    ...collectWorkflowSurfaces(workflow),
    node,
    getNodeConfig(node),
    action,
  ]) {
    if (!isRecord(value)) {
      continue;
    }
    if (
      value.dryRun === true ||
      value.dry_run === true ||
      value.safeMode === true ||
      value.preview === true ||
      value.operatorApprovedLive === false
    ) {
      return true;
    }
    const mode =
      asString(value.mode) ??
      asString(value.executionMode) ??
      asString(value.deploymentStage) ??
      asString(value.validationMode) ??
      asString(value.stage);
    if (
      mode &&
      [
        "dryrun",
        "dry-run",
        "safe",
        "simulate",
        "simulation",
        "shadow",
        "papertrade",
        "draft",
        "test",
      ].includes(normalizeKey(mode))
    ) {
      return true;
    }
  }
  return false;
}

function getDestinationNodeType(node: unknown): string | null {
  if (!isRecord(node)) {
    return null;
  }
  const config = getNodeConfig(node);
  const outputType =
    asString(getNested(node, ["config", "outputType"])) ??
    asString(getNested(node, ["data", "outputType"])) ??
    (isRecord(config) ? asString(config.outputType) : null);
  if (outputType) {
    return `output.${outputType}`;
  }

  const action = getActionRecord(node);
  const actionId = getActionId(node, action);
  const normalizedAction = actionId ? normalizeKey(actionId) : null;
  if (
    normalizedAction &&
    ["sendmessage", "sendemail", "webhookcall", "apicall", "connectoraction"].includes(
      normalizedAction,
    )
  ) {
    return `action.${actionId}`;
  }

  return null;
}

function hasExplicitDestination(node: unknown): boolean {
  const candidates = [node, getNodeConfig(node), getActionRecord(node)];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }
    if (recordHasDestination(candidate)) {
      return true;
    }
    for (const nestedKey of ["parameters", "params", "delivery", "destination", "target"]) {
      const nested = candidate[nestedKey];
      if (isRecord(nested) && recordHasDestination(nested)) {
        return true;
      }
    }
  }
  return false;
}

function recordHasDestination(record: JsonRecord): boolean {
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = normalizeKey(key);
    if (!DESTINATION_KEYS.includes(normalizedKey)) {
      continue;
    }
    if (hasNonEmptyDestinationValue(value)) {
      return true;
    }
  }
  return false;
}

function hasNonEmptyDestinationValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  return isRecord(value) && Object.keys(value).length > 0;
}

function collectCronWorkflowEvidence(cronJobs: readonly unknown[]): {
  workflowIds: Set<string>;
  workflowNames: Set<string>;
} {
  const workflowIds = new Set<string>();
  const workflowNames = new Set<string>();

  for (const job of cronJobs) {
    if (!isRecord(job) || job.enabled === false) {
      continue;
    }
    const id =
      asString(job.workflowId) ??
      asString(job.targetWorkflowId) ??
      asString(getNested(job, ["payload", "workflowId"])) ??
      asString(getNested(job, ["workflow", "id"]));
    if (id) {
      workflowIds.add(id);
    }
    const name = asString(job.workflowName) ?? asString(getNested(job, ["workflow", "name"]));
    if (name) {
      workflowNames.add(name);
    }
  }

  return { workflowIds, workflowNames };
}

function isScheduledWorkflow(workflow: unknown, nodes: readonly unknown[]): boolean {
  if (hasScheduleMetadata(workflow)) {
    return true;
  }
  return nodes.some((node) => {
    if (!isRecord(node)) {
      return false;
    }
    const kind =
      asString(node.kind) ?? asString(node.type) ?? asString(getNested(node, ["data", "kind"]));
    const triggerType =
      asString(node.triggerType) ??
      asString(getNested(node, ["config", "triggerType"])) ??
      asString(getNested(node, ["data", "triggerType"])) ??
      asString(getNested(node, ["data", "config", "triggerType"]));
    return (
      normalizeKey(kind ?? "").includes("trigger") &&
      (normalizeKey(triggerType ?? "") === "schedule" || hasScheduleMetadata(node))
    );
  });
}

function hasScheduleMetadata(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.scheduled === true ||
    value.schedule !== undefined ||
    value.cron !== undefined ||
    value.cronExpr !== undefined ||
    value.cronExpression !== undefined
  ) {
    return true;
  }
  for (const key of ["config", "data", "trigger", "schedule"]) {
    if (isRecord(value[key]) && hasScheduleMetadata(value[key])) {
      return true;
    }
  }
  return false;
}

function getWorkflowId(workflow: unknown): string | null {
  for (const surface of collectWorkflowSurfaces(workflow)) {
    const id = asString(surface.id) ?? asString(surface.workflowId);
    if (id) {
      return id;
    }
  }
  return null;
}

function getWorkflowName(workflow: unknown): string | null {
  for (const surface of collectWorkflowSurfaces(workflow)) {
    const name = asString(surface.name) ?? asString(surface.title);
    if (name) {
      return name;
    }
  }
  return null;
}

function formatWorkflowLabel(workflow: unknown): string {
  const id = getWorkflowId(workflow);
  const name = getWorkflowName(workflow);
  if (id && name) {
    return `Workflow "${name}" (${id})`;
  }
  if (id) {
    return `Workflow ${id}`;
  }
  if (name) {
    return `Workflow "${name}"`;
  }
  return "Workflow";
}

function formatNodeLabel(node: unknown): string {
  if (!isRecord(node)) {
    return "node";
  }
  const id =
    asString(node.id) ?? asString(node.nodeId) ?? asString(getNested(node, ["data", "id"]));
  const label = asString(node.label) ?? asString(getNested(node, ["data", "label"]));
  if (id && label) {
    return `node "${label}" (${id})`;
  }
  if (id) {
    return `node ${id}`;
  }
  if (label) {
    return `node "${label}"`;
  }
  return "node";
}

function getNested(record: unknown, path: readonly string[]): unknown {
  let current = record;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[\s._-]/g, "");
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
