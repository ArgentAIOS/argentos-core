/**
 * canvas-node-parser.ts — Manifest → ConnectorNodeDefinition normalization.
 *
 * Spec: docs/argent/AOS_CANVAS_NODE_SPEC_FINAL.md
 * Implementation Guidance step 1: "Build a manifest parser that emits ConnectorNodeDefinition."
 *
 * Takes a raw connector.json object and produces a fully normalized ConnectorNodeDefinition
 * with inferred operation types, standard output ports, readiness state, side-effect
 * classification, and field normalization. The dashboard consumes ONLY the normalized
 * output — never raw manifests.
 */

// ── Exported types (match spec §2 Node Model) ────────────────────────────────

export interface ConnectorNodeDefinition {
  connectorId: string;
  label: string;
  category: string;
  secondaryCategories: string[];
  status: "harness_backed" | "manifest_only_blocked";
  backend: string;
  auth: ConnectorAuthDefinition;
  resources: string[];
  nodeInputs: ConnectorInputField[];
  operations: ConnectorOperationDefinition[];
  readiness: ConnectorReadinessDefinition;
  events: ConnectorEventDefinition[];
  pickerHints: Record<string, ConnectorPickerHint>;
}

export interface ConnectorAuthDefinition {
  kind: "service-key" | "oauth2" | "oauth-service-key" | "oauth-local";
  requiredSecrets: string[];
  setupNotes: string[];
}

export interface ConnectorInputField {
  id: string;
  label: string;
  source: "workerField" | "command_arg";
  required: boolean;
  valueType: "string" | "number" | "boolean" | "json" | "datetime" | "unknown";
  renderAs:
    | "text"
    | "richtext"
    | "select"
    | "multiselect"
    | "boolean"
    | "number"
    | "json"
    | "datetime"
    | "expression";
  expressionEnabled: boolean;
  appliesTo: string[];
  placeholder: string;
  description: string;
  rows?: number;
  default?: unknown;
  options?: FieldOption[];
  pickerHint?: string;
  showWhen?: { field: string; equals: unknown };
  type?: string;
  children?: ConnectorInputField[];
}

export interface FieldOption {
  value: string;
  label: string;
  description?: string;
}

export interface ConnectorOperationDefinition {
  id: string;
  label: string;
  operationType: "read" | "write" | "meta";
  requiredMode: "readonly" | "write" | "full" | "admin";
  resource: string;
  summary: string;
  inputStrategy: "scoped_fields" | "command_args" | "mixed";
  outputs: ConnectorOutputDefinition[];
  sideEffectLevel: "none" | "external_mutation" | "outbound_delivery";
  operationFields?: ConnectorInputField[];
  optionsGroup?: ConnectorInputField[];
}

export interface ConnectorOutputDefinition {
  portId: string;
  kind: "resource" | "collection" | "status" | "diagnostic" | "raw_json";
  shape: "object" | "array" | "scalar" | "mixed";
  description: string;
}

export interface ConnectorReadinessDefinition {
  state: "blocked" | "setup_required" | "read_ready" | "write_ready";
  canRenderNode: boolean;
  canRunReadOps: boolean;
  canRunWriteOps: boolean;
  blockedReason?: string;
}

export interface ConnectorEventDefinition {
  id: string;
  resource: string;
  summary: string;
  delivery: string;
  configFields: ConnectorInputField[];
}

export interface ConnectorPickerHint {
  kind: string;
  resource: string;
  sourceCommand: string;
  sourceFields: string[];
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse a raw connector.json into a normalized ConnectorNodeDefinition.
 *
 * This is the SINGLE source of truth for the canvas. All raw manifest quirks,
 * missing fields, and inconsistencies are resolved here — not in the UI.
 */
export function parseConnectorManifest(
  connectorId: string,
  raw: Record<string, unknown>,
): ConnectorNodeDefinition {
  const scope = obj(raw.scope);
  const connector = obj(raw.connector);
  const rawAuth = obj(raw.auth);
  const rawCommands = arr(raw.commands);
  const rawEvents = arr(raw.events);
  const rawFields = arr(scope.fields);
  const rawPickerHints = obj(scope.pickerHints);
  const workerVisibleActions = strArr(scope.worker_visible_actions);

  // ── Status (Rule 5/6: manifest-only cannot be executable) ─────────────
  const scaffoldOnly = scope.scaffold_only === true;
  const liveBackend = scope.live_backend_available === true;
  const status: ConnectorNodeDefinition["status"] =
    scaffoldOnly || !liveBackend ? "manifest_only_blocked" : "harness_backed";

  // ── Auth ───────────────────────────────────────────────────────────────
  const auth = normalizeAuth(rawAuth);

  // ── Fields → nodeInputs ───────────────────────────────────────────────
  const nodeInputs = rawFields.map((f) => normalizeField(f));

  // ── Commands → operations ─────────────────────────────────────────────
  const operations = normalizeOperations(rawCommands, workerVisibleActions, nodeInputs);

  // ── Events ────────────────────────────────────────────────────────────
  const events = normalizeEvents(rawEvents);

  // ── Picker hints ──────────────────────────────────────────────────────
  const pickerHints = normalizePickerHints(rawPickerHints);

  // ── Readiness (spec §10) ──────────────────────────────────────────────
  const readiness = resolveReadiness(status, auth, operations, scope);

  // ── Resources ─────────────────────────────────────────────────────────
  const resources = strArr(connector.resources);
  // Fallback: infer from operations if connector.resources is empty
  if (resources.length === 0) {
    const seen = new Set<string>();
    for (const op of operations) {
      if (op.resource && !seen.has(op.resource)) {
        seen.add(op.resource);
        resources.push(op.resource);
      }
    }
  }

  return {
    connectorId,
    label: str(connector.label) || titleCase(connectorId.replace(/^aos-/, "")),
    category: str(connector.category) || "general",
    secondaryCategories: strArr(connector.categories).filter((c) => c !== str(connector.category)),
    status,
    backend: str(raw.backend) || "unknown",
    auth,
    resources,
    nodeInputs,
    operations,
    readiness,
    events,
    pickerHints,
  };
}

// ── Auth normalization ────────────────────────────────────────────────────────

function normalizeAuth(raw: Record<string, unknown>): ConnectorAuthDefinition {
  const kind = str(raw.kind);
  const validKinds = ["service-key", "oauth2", "oauth-service-key", "oauth-local"] as const;
  const resolvedKind: ConnectorAuthDefinition["kind"] = validKinds.includes(
    kind as (typeof validKinds)[number],
  )
    ? (kind as ConnectorAuthDefinition["kind"])
    : "service-key";

  return {
    kind: resolvedKind,
    requiredSecrets: strArr(raw.service_keys),
    setupNotes: strArr(raw.interactive_setup),
  };
}

// ── Field normalization ───────────────────────────────────────────────────────

function normalizeField(raw: unknown): ConnectorInputField {
  const f = obj(raw);
  const id = str(f.id);
  const type = str(f.type);
  const renderAs = resolveRenderAs(str(f.renderAs), type, f);
  const valueType = resolveValueType(renderAs, type);

  const children = Array.isArray(f.children)
    ? f.children.map((c: unknown) => normalizeField(c))
    : undefined;

  return {
    id,
    label: str(f.label) || titleCase(id),
    source: "workerField",
    required: f.required === true,
    valueType,
    renderAs,
    expressionEnabled: f.expressionEnabled === true,
    appliesTo: strArr(f.applies_to),
    placeholder: str(f.placeholder),
    description: str(f.description),
    ...(typeof f.rows === "number" ? { rows: f.rows } : {}),
    ...(f.default !== undefined ? { default: f.default } : {}),
    ...(Array.isArray(f.options) ? { options: normalizeOptions(f.options) } : {}),
    ...(typeof f.pickerHint === "string" ? { pickerHint: f.pickerHint } : {}),
    ...(f.showWhen && typeof f.showWhen === "object"
      ? { showWhen: f.showWhen as ConnectorInputField["showWhen"] }
      : {}),
    ...(type === "options_group" ? { type: "options_group" } : {}),
    ...(children ? { children } : {}),
  };
}

function normalizeOptions(raw: unknown[]): FieldOption[] {
  return raw
    .map((o) => {
      const opt = obj(o);
      const value = str(opt.value);
      if (!value) return null;
      return {
        value,
        label: str(opt.label) || value,
        ...(str(opt.description) ? { description: str(opt.description) } : {}),
      };
    })
    .filter((o): o is FieldOption => o !== null);
}

/**
 * Resolve renderAs from explicit value, type field, or heuristics.
 * Bare manifests (like aos-openai) have neither renderAs nor type —
 * this function infers a reasonable default so the UI always gets a valid widget.
 */
function resolveRenderAs(
  explicit: string,
  type: string,
  raw: Record<string, unknown>,
): ConnectorInputField["renderAs"] {
  // Explicit renderAs takes priority
  const valid: ConnectorInputField["renderAs"][] = [
    "text",
    "richtext",
    "select",
    "multiselect",
    "boolean",
    "number",
    "json",
    "datetime",
    "expression",
  ];
  if (valid.includes(explicit as ConnectorInputField["renderAs"])) {
    return explicit as ConnectorInputField["renderAs"];
  }

  // Fall back to type field
  if (valid.includes(type as ConnectorInputField["renderAs"])) {
    return type as ConnectorInputField["renderAs"];
  }

  // type=options_group is a container, not a widget
  if (type === "options_group") return "text";

  // Heuristic: has options array → select
  if (Array.isArray(raw.options) && raw.options.length > 0) return "select";

  // Heuristic: has pickerHint → select (will wire to DynamicPicker)
  if (typeof raw.pickerHint === "string") return "select";

  // Heuristic: field name patterns
  const id = str(raw.id).toLowerCase();
  if (
    id.includes("date") ||
    id.includes("deadline") ||
    id.includes("due_") ||
    id.includes("scheduled_at") ||
    id.endsWith("_time") ||
    id.endsWith("_at")
  )
    return "datetime";
  if (id.includes("json") || id.includes("payload") || id.includes("body_json")) return "json";
  if (id.includes("enabled") || id.includes("active") || id === "dry_run") return "boolean";
  if (id.includes("count") || id.includes("limit") || id.includes("amount") || id.includes("max_"))
    return "number";
  if (
    id.includes("message") ||
    id.includes("body") ||
    id.includes("note") ||
    id.includes("description") ||
    id.includes("content")
  )
    return "richtext";

  return "text";
}

function resolveValueType(
  renderAs: ConnectorInputField["renderAs"],
  type: string,
): ConnectorInputField["valueType"] {
  switch (renderAs) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "json":
      return "json";
    default:
      break;
  }
  if (type === "datetime" || type === "date") return "datetime";
  return "string";
}

// ── Operation normalization ───────────────────────────────────────────────────

/**
 * Spec Rule 1: action_class == "write" or required_mode != "readonly" → write
 * Spec Rule 2: capabilities/health/doctor/config.show → meta
 * Spec §3: Operation Types with keyword lists
 */
function normalizeOperations(
  rawCommands: unknown[],
  workerVisibleActions: string[],
  nodeInputs: ConnectorInputField[],
): ConnectorOperationDefinition[] {
  const visibleSet = new Set(workerVisibleActions);

  return rawCommands
    .map((cmd) => {
      const c = obj(cmd);
      const id = str(c.id);
      if (!id) return null;

      // Filter to worker-visible actions if the manifest specifies them
      if (visibleSet.size > 0 && !visibleSet.has(id)) return null;

      const resource = str(c.resource) || inferResource(id);
      const actionClass = str(c.action_class) || inferActionClassFromId(id);
      const requiredMode = str(c.required_mode);
      const operationType = resolveOperationType(id, actionClass, requiredMode);
      const sideEffectLevel = resolveSideEffect(id, operationType);

      // Determine input strategy: if there are fields with appliesTo matching this op
      const hasFields = nodeInputs.some(
        (f) => f.appliesTo.length === 0 || f.appliesTo.includes(id),
      );
      const inputStrategy: ConnectorOperationDefinition["inputStrategy"] = hasFields
        ? "scoped_fields"
        : "command_args";

      // Standard output ports (spec §6)
      const outputs = buildStandardOutputPorts(operationType);

      // Operation-specific fields from nodeInputs
      const operationFields = nodeInputs.filter(
        (f) => f.type !== "options_group" && (f.appliesTo.length === 0 || f.appliesTo.includes(id)),
      );

      // Options groups that apply to this operation
      const optionsGroup = nodeInputs.filter(
        (f) => f.type === "options_group" && (f.appliesTo.length === 0 || f.appliesTo.includes(id)),
      );

      const op: ConnectorOperationDefinition = {
        id,
        label: str(c.summary) || humanizeCommandId(id),
        operationType,
        requiredMode: normalizeRequiredMode(requiredMode, operationType),
        resource,
        summary: str(c.summary) || humanizeCommandId(id),
        inputStrategy,
        outputs,
        sideEffectLevel,
        ...(operationFields.length > 0 ? { operationFields } : {}),
        ...(optionsGroup.length > 0 ? { optionsGroup } : {}),
      };
      return op;
    })
    .filter((op): op is ConnectorOperationDefinition => op !== null);
}

/** Spec §3 — classify operation type from command id and manifest hints */
function resolveOperationType(
  id: string,
  actionClass: string,
  requiredMode: string,
): ConnectorOperationDefinition["operationType"] {
  const lower = id.toLowerCase();

  // Rule 2: meta operations
  if (
    lower === "capabilities" ||
    lower === "health" ||
    lower === "doctor" ||
    lower === "config.show" ||
    lower.endsWith(".capabilities") ||
    lower.endsWith(".health") ||
    lower.endsWith(".doctor")
  ) {
    return "meta";
  }

  // Explicit action_class from manifest
  if (actionClass === "read") return "read";
  if (actionClass === "write" || actionClass === "destructive") return "write";

  // Rule 1: required_mode != "readonly" → write candidate
  if (requiredMode && requiredMode !== "readonly") return "write";

  // Keyword inference (spec §3)
  const readKeywords = [
    "list",
    "get",
    "read",
    "search",
    "query",
    "status",
    "report",
    "show",
    "fetch",
  ];
  const writeKeywords = [
    "create",
    "update",
    "delete",
    "send",
    "trigger",
    "cancel",
    "append",
    "upload",
    "assign",
    "reply",
    "edit",
    "generate",
    "remove",
    "revoke",
    "post",
  ];

  const parts = lower.split(".");
  const action = parts[parts.length - 1];

  if (readKeywords.some((k) => action.includes(k))) return "read";
  if (writeKeywords.some((k) => action.includes(k))) return "write";

  // Default to read (safe)
  return "read";
}

/** Spec §9 — Side-effect classification */
function resolveSideEffect(
  id: string,
  operationType: ConnectorOperationDefinition["operationType"],
): ConnectorOperationDefinition["sideEffectLevel"] {
  if (operationType === "read" || operationType === "meta") return "none";

  const lower = id.toLowerCase();

  // Outbound delivery: sends messages or communications outside ArgentOS
  if (
    lower.includes("send") ||
    lower.includes("post") ||
    lower.includes("reply") ||
    lower.includes("email") ||
    lower.includes("sms") ||
    lower.includes("message.create") ||
    lower.includes("notify")
  ) {
    return "outbound_delivery";
  }

  // Everything else that's a write is external mutation
  return "external_mutation";
}

/** Spec §6 — Standard output ports per operation type */
function buildStandardOutputPorts(
  operationType: ConnectorOperationDefinition["operationType"],
): ConnectorOutputDefinition[] {
  switch (operationType) {
    case "read":
      return [
        {
          portId: "result",
          kind: "resource",
          shape: "mixed",
          description: "Primary returned data",
        },
        {
          portId: "items",
          kind: "collection",
          shape: "array",
          description: "Collection payload for list/search operations",
        },
        {
          portId: "summary",
          kind: "status",
          shape: "scalar",
          description: "Human-readable outcome summary",
        },
        {
          portId: "raw",
          kind: "raw_json",
          shape: "object",
          description: "Full JSON response for advanced chaining",
        },
      ];
    case "write":
      return [
        {
          portId: "result",
          kind: "resource",
          shape: "object",
          description: "Primary returned object",
        },
        {
          portId: "status",
          kind: "status",
          shape: "scalar",
          description: "Normalized execution status",
        },
        {
          portId: "record",
          kind: "resource",
          shape: "object",
          description: "Created/updated entity",
        },
        {
          portId: "summary",
          kind: "status",
          shape: "scalar",
          description: "Human-readable outcome summary",
        },
        {
          portId: "raw",
          kind: "raw_json",
          shape: "object",
          description: "Full JSON response for advanced chaining",
        },
      ];
    case "meta":
      return [
        { portId: "status", kind: "status", shape: "scalar", description: "Probe status" },
        {
          portId: "summary",
          kind: "status",
          shape: "scalar",
          description: "Human-readable diagnostic summary",
        },
        {
          portId: "diagnostics",
          kind: "diagnostic",
          shape: "object",
          description: "Probe/setup detail",
        },
        { portId: "raw", kind: "raw_json", shape: "object", description: "Full JSON response" },
      ];
  }
}

function normalizeRequiredMode(
  raw: string,
  operationType: ConnectorOperationDefinition["operationType"],
): ConnectorOperationDefinition["requiredMode"] {
  const valid = ["readonly", "write", "full", "admin"] as const;
  if (valid.includes(raw as (typeof valid)[number])) {
    return raw as ConnectorOperationDefinition["requiredMode"];
  }
  // Infer from operation type
  return operationType === "read" || operationType === "meta" ? "readonly" : "write";
}

// ── Event normalization ───────────────────────────────────────────────────────

function normalizeEvents(rawEvents: unknown[]): ConnectorEventDefinition[] {
  return rawEvents
    .map((e) => {
      const ev = obj(e);
      const id = str(ev.id);
      if (!id) return null;
      return {
        id,
        resource: str(ev.resource) || inferResource(id),
        summary: str(ev.summary) || humanizeCommandId(id),
        delivery: str(ev.delivery) || "webhook",
        configFields: Array.isArray(ev.configFields)
          ? ev.configFields.map((f: unknown) => normalizeField(f))
          : [],
      };
    })
    .filter((e): e is ConnectorEventDefinition => e !== null);
}

// ── Picker hint normalization ─────────────────────────────────────────────────

function normalizePickerHints(raw: Record<string, unknown>): Record<string, ConnectorPickerHint> {
  const result: Record<string, ConnectorPickerHint> = {};
  for (const [key, val] of Object.entries(raw)) {
    const h = obj(val);
    result[key] = {
      kind: str(h.kind) || key,
      resource: str(h.resource) || "",
      sourceCommand: str(h.source_command) || "",
      sourceFields: strArr(h.source_fields),
    };
  }
  return result;
}

// ── Readiness resolution (spec §10) ──────────────────────────────────────────

function resolveReadiness(
  status: ConnectorNodeDefinition["status"],
  auth: ConnectorAuthDefinition,
  operations: ConnectorOperationDefinition[],
  scope: Record<string, unknown>,
): ConnectorReadinessDefinition {
  // Rule 6: manifest-only → blocked
  if (status === "manifest_only_blocked") {
    return {
      state: "blocked",
      canRenderNode: true, // visible in catalog
      canRunReadOps: false,
      canRunWriteOps: false,
      blockedReason: "No runtime harness — connector is contract-only",
    };
  }

  // Has auth requirements but no way to check if they're satisfied at parse time.
  // Default to setup_required if there are required secrets.
  // Runtime enrichment (step 2) will upgrade this based on actual health/doctor probes.
  const hasWriteOps = operations.some((op) => op.operationType === "write");
  const liveRead = scope.live_read_available === true;
  const writeBridge = scope.write_bridge_available === true;

  if (!liveRead) {
    return {
      state: "setup_required",
      canRenderNode: true,
      canRunReadOps: false,
      canRunWriteOps: false,
      blockedReason: "Read operations not yet available",
    };
  }

  if (hasWriteOps && writeBridge) {
    return {
      state: "write_ready",
      canRenderNode: true,
      canRunReadOps: true,
      canRunWriteOps: true,
    };
  }

  return {
    state: "read_ready",
    canRenderNode: true,
    canRunReadOps: true,
    canRunWriteOps: false,
    ...(hasWriteOps && !writeBridge
      ? { blockedReason: "Write operations not yet implemented" }
      : {}),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function obj(val: unknown): Record<string, unknown> {
  return val && typeof val === "object" && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function arr(val: unknown): unknown[] {
  return Array.isArray(val) ? val : [];
}

function str(val: unknown): string {
  return typeof val === "string" ? val.trim() : "";
}

function strArr(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === "string").map((v) => v.trim());
}

function inferResource(commandId: string): string {
  const parts = commandId.split(".");
  return parts.length > 1 ? parts[0] : "";
}

function inferActionClassFromId(commandId: string): string {
  const lower = commandId.toLowerCase();
  const readPatterns = [
    "list",
    "read",
    "show",
    "search",
    "status",
    "health",
    "get",
    "query",
    "fetch",
  ];
  const writePatterns = [
    "create",
    "update",
    "write",
    "send",
    "edit",
    "generate",
    "upload",
    "append",
    "delete",
    "remove",
    "revoke",
  ];

  for (const p of readPatterns) {
    if (lower.includes(p)) return "read";
  }
  for (const p of writePatterns) {
    if (lower.includes(p)) return "write";
  }
  return "";
}

function humanizeCommandId(id: string): string {
  return id
    .replace(/\./g, " → ")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function titleCase(s: string): string {
  return s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Step 2: Runtime readiness enrichment ──────────────────────────────────────
//
// Spec Implementation Guidance step 2:
// "Add runtime readiness enrichment from harness health / doctor."
//
// Takes a parsed ConnectorNodeDefinition and the result of running the harness's
// `health` command. Upgrades readiness state based on actual probe results —
// auth present, backend reachable, per-command readiness.

/** Shape returned by harness `health` command */
export interface HealthProbeResult {
  status?: string; // "ready" | "needs_setup" | "degraded"
  runtime_ready?: boolean;
  live_backend_available?: boolean;
  live_read_available?: boolean;
  write_bridge_available?: boolean;
  scaffold_only?: boolean;
  checks?: Array<{ name: string; ok: boolean; details?: Record<string, unknown> }>;
  auth?: Record<string, unknown>;
  next_steps?: string[];
}

/** Shape returned by harness `doctor` command */
export interface DoctorProbeResult {
  status?: string;
  runtime?: {
    command_readiness?: Record<string, boolean>;
    [key: string]: unknown;
  };
  checks?: Array<{ name: string; ok: boolean; details?: Record<string, unknown> }>;
}

/**
 * Enrich a parsed ConnectorNodeDefinition with live health/doctor probe results.
 * Mutates `definition.readiness` in place and returns the updated definition.
 *
 * Call flow: gateway reads manifest → parseConnectorManifest() → enrichWithHealthProbe()
 */
export function enrichWithHealthProbe(
  definition: ConnectorNodeDefinition,
  healthResult: HealthProbeResult | null,
  doctorResult: DoctorProbeResult | null,
): ConnectorNodeDefinition {
  // If connector is manifest-only, health probe won't help — stay blocked
  if (definition.status === "manifest_only_blocked") {
    return definition;
  }

  // No probe results → keep the manifest-derived readiness
  if (!healthResult) {
    return definition;
  }

  const status = healthResult.status ?? "";
  const runtimeReady = healthResult.runtime_ready === true;
  const liveBackend = healthResult.live_backend_available === true;
  const liveRead = healthResult.live_read_available === true;
  const writeBridge = healthResult.write_bridge_available === true;

  // Failed checks → extract missing details for user
  const failedChecks = (healthResult.checks ?? []).filter((c) => !c.ok);
  const missingKeys: string[] = [];
  for (const check of failedChecks) {
    if (check.name === "required_env" && Array.isArray(check.details?.missing_keys)) {
      missingKeys.push(...(check.details.missing_keys as string[]));
    }
  }

  // Determine readiness from probe
  if (status === "ready" && runtimeReady) {
    const hasWriteOps = definition.operations.some((op) => op.operationType === "write");
    if (hasWriteOps && writeBridge) {
      definition.readiness = {
        state: "write_ready",
        canRenderNode: true,
        canRunReadOps: true,
        canRunWriteOps: true,
      };
    } else if (liveRead) {
      definition.readiness = {
        state: "read_ready",
        canRenderNode: true,
        canRunReadOps: true,
        canRunWriteOps: false,
        ...(hasWriteOps ? { blockedReason: "Write operations not available" } : {}),
      };
    }
  } else if (status === "needs_setup" || !runtimeReady) {
    const reason =
      missingKeys.length > 0
        ? `Missing credentials: ${missingKeys.join(", ")}`
        : (healthResult.next_steps?.[0] ?? "Connector setup required");
    definition.readiness = {
      state: "setup_required",
      canRenderNode: true,
      canRunReadOps: false,
      canRunWriteOps: false,
      blockedReason: reason,
    };
  } else if (status === "degraded") {
    // Degraded = partial functionality. Check if reads work at least.
    definition.readiness = {
      state: liveRead ? "read_ready" : "setup_required",
      canRenderNode: true,
      canRunReadOps: liveRead,
      canRunWriteOps: false,
      blockedReason: "Connector is in degraded state — some operations may fail",
    };
  }

  // Step 2b: Doctor enrichment — per-command readiness
  if (doctorResult?.runtime?.command_readiness) {
    const cmdReadiness = doctorResult.runtime.command_readiness;
    for (const op of definition.operations) {
      if (cmdReadiness[op.id] === false) {
        // Mark individual operations as not ready — add to outputs as a diagnostic hint
        // The UI can use this to disable specific operation choices
        if (!op.outputs.some((o) => o.portId === "diagnostics")) {
          op.outputs.push({
            portId: "diagnostics",
            kind: "diagnostic",
            shape: "object",
            description: `Operation ${op.id} is not ready — check connector setup`,
          });
        }
      }
    }

    // Store command readiness on the definition for the UI
    (
      definition as ConnectorNodeDefinition & { commandReadiness?: Record<string, boolean> }
    ).commandReadiness = cmdReadiness;
  }

  return definition;
}
