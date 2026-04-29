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

const DESTINATION_KEYS = new Set([
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
]);

const PODCAST_ACTIONS = new Map([
  ["podcastplan", "podcast_plan"],
  ["podcastgenerate", "podcast_generate"],
]);

export function collectWorkflowSecurityFindings(input: WorkflowAuditInput): WorkflowAuditFinding[] {
  const workflows = collectWorkflowRecords(input);
  const cronJobs = collectCronRecords(input);
  const findings: WorkflowAuditFinding[] = [];

  for (const workflow of workflows) {
    const nodes = collectWorkflowNodes(workflow);
    findings.push(...collectEmbeddedSecretFindings(workflow, nodes));
    findings.push(...collectLiveActionFindings(workflow, nodes));
    findings.push(...collectLiveExecutionSplitFindings(workflow, nodes));
    findings.push(...collectPodcastCapabilityFindings(workflow, nodes));
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
  const workflowRefs = collectWorkflowRefs(workflows);
  const findings: WorkflowAuditFinding[] = [];

  for (const workflow of workflows) {
    const nodes = collectWorkflowNodes(workflow);
    if (!isScheduledWorkflow(workflow, nodes)) {
      continue;
    }
    const workflowId = getWorkflowId(workflow);
    const workflowName = getWorkflowName(workflow);
    const workflowCronJobIds = collectWorkflowCronJobIds(workflow, nodes);
    const workflowScheduleExpressions = collectWorkflowScheduleExpressions(workflow, nodes);
    const matchingCronEntries = cronEvidence.entries.filter(
      (entry) =>
        (workflowId !== null && entry.workflowId === workflowId) ||
        (workflowName !== null && entry.workflowName === workflowName),
    );
    const hasEvidence =
      (workflowId !== null && cronEvidence.workflowIds.has(workflowId)) ||
      (workflowName !== null && cronEvidence.workflowNames.has(workflowName)) ||
      workflowCronJobIds.some((cronJobId) => cronEvidence.jobIds.has(cronJobId));
    if (hasEvidence) {
      if (
        workflowScheduleExpressions.length > 0 &&
        matchingCronEntries.some((entry) => entry.scheduleExpression !== null) &&
        !matchingCronEntries.some(
          (entry) =>
            entry.scheduleExpression !== null &&
            workflowScheduleExpressions.includes(entry.scheduleExpression),
        )
      ) {
        findings.push({
          checkId: "workflows.schedule.cron_expression_mismatch",
          severity: "warn",
          title: "Scheduled workflow cron expression differs from scheduler job",
          detail: `${formatWorkflowLabel(
            workflow,
          )} has schedule metadata and an enabled cron job, but their cron expressions do not match.`,
          remediation:
            "Update the workflow row or scheduler row so the persisted schedule and enabled cron job describe the same cadence.",
        });
      }
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

  for (const entry of cronEvidence.entries) {
    const hasWorkflow =
      (entry.workflowId !== null && workflowRefs.ids.has(entry.workflowId)) ||
      (entry.workflowName !== null && workflowRefs.names.has(entry.workflowName));
    if (hasWorkflow) {
      continue;
    }
    findings.push({
      checkId: "workflows.schedule.orphan_cron_workflow",
      severity: "warn",
      title: "Enabled cron job points at a missing workflow row",
      detail:
        "The provided cron snapshot includes an enabled workflow-run job, but the workflow snapshot does not include the referenced workflow row.",
      remediation:
        "Remove stale scheduler jobs or include the matching workflow row in the audit snapshot before marking scheduled workflow readiness complete.",
    });
  }

  return findings;
}

function collectLiveExecutionSplitFindings(
  workflow: unknown,
  nodes: readonly unknown[],
): WorkflowAuditFinding[] {
  const liveActionLabels: string[] = [];
  for (const node of nodes) {
    if (!isActionNode(node)) {
      continue;
    }
    const action = getActionRecord(node);
    const actionId = getActionId(node, action);
    if (
      isLiveSideEffectAction(node, action, actionId) &&
      !hasSafeExecutionMode(workflow, node, action)
    ) {
      liveActionLabels.push(formatNodeLabel(node));
    }
  }
  if (liveActionLabels.length === 0) {
    return [];
  }

  const missing = [
    hasWorkflowEvidence(workflow, "validate") ? null : "validate",
    hasWorkflowEvidence(workflow, "dry-run") ? null : "dry-run",
    hasWorkflowEvidence(workflow, "run-now") ? null : "run-now",
  ].filter((value): value is string => value !== null);

  if (missing.length === 0) {
    return [];
  }

  return [
    {
      checkId: "workflows.actions.missing_execution_split_evidence",
      severity: "warn",
      title: "Live side-effect workflow lacks validate/dry-run/run-now evidence",
      detail: `${formatWorkflowLabel(workflow)} contains live side-effect actions (${formatList(
        liveActionLabels,
      )}) but the workflow snapshot lacks separate ${missing.join(", ")} evidence.`,
      remediation:
        "Capture separate validate, dry-run, and run-now evidence in the workflow snapshot before enabling scheduled or live Morning Brief execution.",
    },
  ];
}

function collectPodcastCapabilityFindings(
  workflow: unknown,
  nodes: readonly unknown[],
): WorkflowAuditFinding[] {
  const configuredCapabilities = collectConfiguredCapabilityKeys(workflow, nodes);
  const findings: WorkflowAuditFinding[] = [];

  for (const node of nodes) {
    if (!isActionNode(node)) {
      continue;
    }
    const action = getActionRecord(node);
    const actionId = getActionId(node, action);
    if (!actionId) {
      continue;
    }
    const requiredCapability = PODCAST_ACTIONS.get(normalizeKey(actionId));
    if (!requiredCapability || configuredCapabilities.has(normalizeKey(requiredCapability))) {
      continue;
    }
    findings.push({
      checkId: "workflows.podcast.missing_capability_wiring",
      severity: "warn",
      title: "Podcast action lacks capability or tool wiring",
      detail: `${formatWorkflowLabel(workflow)} ${formatNodeLabel(
        node,
      )} uses ${requiredCapability}, but the workflow snapshot does not expose matching capability or tool-grant wiring.`,
      remediation:
        "Add an explicit podcast capability/tool grant to the workflow snapshot so podcast planning and generation cannot rely on ambient runtime wiring.",
    });
  }

  return findings;
}

function collectWorkflowRefs(workflows: readonly unknown[]): {
  ids: Set<string>;
  names: Set<string>;
} {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const workflow of workflows) {
    const id = getWorkflowId(workflow);
    const name = getWorkflowName(workflow);
    if (id) {
      ids.add(id);
    }
    if (name) {
      names.add(name);
    }
  }
  return { ids, names };
}

function collectWorkflowCronJobIds(workflow: unknown, nodes: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const value of [...collectWorkflowSurfaces(workflow), ...nodes]) {
    for (const path of [
      ["cronJobId"],
      ["jobId"],
      ["schedule", "cronJobId"],
      ["schedule", "jobId"],
      ["config", "cronJobId"],
      ["config", "jobId"],
      ["data", "cronJobId"],
      ["data", "jobId"],
      ["data", "schedule", "cronJobId"],
      ["data", "schedule", "jobId"],
    ]) {
      const id = asString(getNested(value, path));
      if (id) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

function collectWorkflowScheduleExpressions(
  workflow: unknown,
  nodes: readonly unknown[],
): string[] {
  const expressions = new Set<string>();
  for (const value of [...collectWorkflowSurfaces(workflow), ...nodes]) {
    for (const path of [
      ["cron"],
      ["cronExpr"],
      ["cronExpression"],
      ["schedule", "cron"],
      ["schedule", "cronExpr"],
      ["schedule", "cronExpression"],
      ["config", "cron"],
      ["config", "cronExpr"],
      ["config", "cronExpression"],
      ["data", "cron"],
      ["data", "cronExpr"],
      ["data", "cronExpression"],
      ["data", "config", "cron"],
      ["data", "config", "cronExpr"],
      ["data", "config", "cronExpression"],
    ]) {
      const expression = asString(getNested(value, path));
      if (expression) {
        expressions.add(normalizeCronExpression(expression));
      }
    }
  }
  return [...expressions];
}

function hasWorkflowEvidence(
  workflow: unknown,
  evidenceType: "validate" | "dry-run" | "run-now",
): boolean {
  const evidenceKeys =
    evidenceType === "validate"
      ? [
          "validateEvidence",
          "validationEvidence",
          "validateResult",
          "validationResult",
          "lastValidation",
          "lastValidatedAt",
          "validatedAt",
        ]
      : evidenceType === "dry-run"
        ? [
            "dryRunEvidence",
            "dryRunResult",
            "dryRunRunId",
            "lastDryRun",
            "lastDryRunAt",
            "dryRunAt",
          ]
        : [
            "runNowEvidence",
            "runNowResult",
            "runNowRunId",
            "manualRunEvidence",
            "manualRunResult",
            "lastRunNow",
            "lastRunNowAt",
            "runNowAt",
            "manualRunAt",
          ];

  for (const surface of collectWorkflowSurfaces(workflow)) {
    if (
      evidenceType === "validate" &&
      (surface.validated === true || surface.validationPassed === true)
    ) {
      return true;
    }
    for (const key of evidenceKeys) {
      if (hasEvidenceValue(surface[key])) {
        return true;
      }
      const readiness = surface.readiness;
      if (isRecord(readiness) && hasEvidenceValue(readiness[key])) {
        return true;
      }
      const audit = surface.audit;
      if (isRecord(audit) && hasEvidenceValue(audit[key])) {
        return true;
      }
    }
  }
  return false;
}

function hasEvidenceValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || value === true) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return isRecord(value) && Object.keys(value).length > 0;
}

function collectConfiguredCapabilityKeys(
  workflow: unknown,
  nodes: readonly unknown[],
): Set<string> {
  const keys = new Set<string>();
  const collect = (value: unknown, path: string[], depth: number) => {
    if (depth > 4 || value === undefined || value === null) {
      return;
    }
    const key = path[path.length - 1] ?? "";
    if (typeof value === "string") {
      if (isCapabilityEvidenceKey(key) || isCapabilityEvidenceKey(path[path.length - 2] ?? "")) {
        keys.add(normalizeKey(value));
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => collect(entry, [...path, String(index)], depth + 1));
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    for (const [childKey, childValue] of Object.entries(value)) {
      collect(childValue, [...path, childKey], depth + 1);
    }
  };

  for (const surface of collectWorkflowSurfaces(workflow)) {
    for (const key of [
      "tools",
      "toolsAllow",
      "toolGrants",
      "toolGrantSnapshot",
      "capabilities",
      "configuredCapabilities",
      "capabilityWiring",
      "capabilityIds",
    ]) {
      collect(surface[key], [key], 0);
    }
  }

  for (const node of nodes) {
    if (isToolWiringNode(node)) {
      collect(node, ["node"], 0);
      continue;
    }
    const config = getNodeConfig(node);
    if (isRecord(config)) {
      for (const key of ["toolsAllow", "toolGrants", "capabilities", "capabilityWiring"]) {
        collect(config[key], ["config", key], 0);
      }
    }
  }

  return keys;
}

function isToolWiringNode(node: unknown): boolean {
  if (!isRecord(node)) {
    return false;
  }
  const type = normalizeKey(
    asString(node.type) ??
      asString(node.kind) ??
      asString(getNested(node, ["data", "subPortType"])) ??
      asString(getNested(node, ["config", "nodeType"])) ??
      asString(getNested(node, ["data", "config", "nodeType"])) ??
      "",
  );
  return type.includes("toolgrant") || type === "toolgrant" || type === "toolgrantnode";
}

function isCapabilityEvidenceKey(key: string): boolean {
  return [
    "tool",
    "toolname",
    "toolsallow",
    "id",
    "name",
    "capability",
    "capabilityid",
    "capabilityids",
    "appcapabilityid",
    "appcapabilityname",
    "connectorid",
  ].includes(normalizeKey(key));
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
    if (!DESTINATION_KEYS.has(normalizedKey)) {
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
  entries: Array<{
    jobId: string | null;
    workflowId: string | null;
    workflowName: string | null;
    scheduleExpression: string | null;
  }>;
  jobIds: Set<string>;
  workflowIds: Set<string>;
  workflowNames: Set<string>;
} {
  const entries: Array<{
    jobId: string | null;
    workflowId: string | null;
    workflowName: string | null;
    scheduleExpression: string | null;
  }> = [];
  const jobIds = new Set<string>();
  const workflowIds = new Set<string>();
  const workflowNames = new Set<string>();

  for (const job of cronJobs) {
    if (!isRecord(job) || job.enabled === false) {
      continue;
    }
    const jobId =
      asString(job.id) ??
      asString(job.jobId) ??
      asString(job.cronJobId) ??
      asString(getNested(job, ["job", "id"]));
    const id =
      asString(job.workflowId) ??
      asString(job.targetWorkflowId) ??
      asString(getNested(job, ["payload", "workflowId"])) ??
      asString(getNested(job, ["workflow", "id"]));
    const name =
      asString(job.workflowName) ??
      asString(job.targetWorkflowName) ??
      asString(getNested(job, ["payload", "workflowName"])) ??
      asString(getNested(job, ["workflow", "name"]));
    const scheduleExpression = firstString([
      job.cron,
      job.cronExpr,
      job.cronExpression,
      getNested(job, ["schedule", "cron"]),
      getNested(job, ["schedule", "cronExpr"]),
      getNested(job, ["schedule", "cronExpression"]),
      getNested(job, ["payload", "cron"]),
      getNested(job, ["payload", "cronExpr"]),
      getNested(job, ["payload", "cronExpression"]),
    ]);
    if (jobId) {
      jobIds.add(jobId);
    }
    if (id) {
      workflowIds.add(id);
    }
    if (name) {
      workflowNames.add(name);
    }
    if (id || name) {
      entries.push({
        jobId,
        workflowId: id,
        workflowName: name,
        scheduleExpression: scheduleExpression ? normalizeCronExpression(scheduleExpression) : null,
      });
    }
  }

  return { entries, jobIds, workflowIds, workflowNames };
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

function formatList(values: readonly string[]): string {
  const visible = values.slice(0, 3).join(", ");
  const remaining = values.length - 3;
  return remaining > 0 ? `${visible}, +${remaining} more` : visible;
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

function firstString(values: readonly unknown[]): string | null {
  for (const value of values) {
    const stringValue = asString(value);
    if (stringValue) {
      return stringValue;
    }
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCronExpression(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[\s._-]/g, "");
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
