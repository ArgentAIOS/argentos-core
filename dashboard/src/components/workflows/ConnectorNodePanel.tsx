/**
 * ConnectorNodePanel — Manifest-driven form renderer for ANY connector node.
 *
 * One React component renders all 62 connectors. The connector.json manifest
 * drives the form: credential → resource → operation → dynamic fields → options.
 *
 * Spec: docs/argent/AOS_CANVAS_NODE_SPEC_FINAL.md (Sections 2, 4, 10, 13–15)
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useGateway } from "../../hooks/useGateway";
import { CredentialSelector } from "./CredentialSelector";
import DynamicPicker from "./DynamicPicker";
import { ExpressionEditor } from "./ExpressionEditor";
import { IOPreviewPanel, type OutputPort } from "./IOPreviewPanel";
import { SafetyPanel } from "./SafetyPanel";

// ── Shared style constants (match WorkflowsWidget right-dock) ───────────────

const DOCK_INPUT =
  "w-full px-2.5 py-2 rounded-lg text-xs bg-[hsl(var(--background))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] focus:outline-none focus:border-[hsl(var(--primary))] transition-colors";
const DOCK_LABEL =
  "text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider";
const DOCK_SECTION = "space-y-1.5";
const OUTPUT_MAPPING_PLACEHOLDER = '{\n  "summary": "text",\n  "id": "json.id"\n}';

// ── Types (from AOS_CANVAS_NODE_SPEC_FINAL.md Section 2) ────────────────────

interface FieldOption {
  value: string;
  label: string;
  description?: string;
}

interface ConnectorInputField {
  id: string;
  label: string;
  source?: "workerField" | "command_arg";
  required: boolean;
  valueType?: "string" | "number" | "boolean" | "json" | "datetime" | "unknown";
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
  expressionEnabled?: boolean;
  appliesTo?: string[];
  placeholder?: string;
  description?: string;
  rows?: number;
  default?: unknown;
  options?: FieldOption[];
  pickerHint?: string;
  showWhen?: { field: string; equals: unknown };
  type?: string;
  children?: ConnectorInputField[];
}

interface ConnectorOperationDefinition {
  id: string;
  label: string;
  resource: string;
  operationType: "read" | "write" | "meta";
  requiredMode?: "readonly" | "write";
  summary: string;
  sideEffectLevel: "none" | "external_mutation" | "outbound_delivery";
  inputStrategy?: "scoped_fields" | "command_args" | "mixed";
  operationFields?: ConnectorInputField[];
  optionsGroup?: ConnectorInputField[];
  outputs?: Array<{ portId: string; kind: string; shape?: string; description: string }>;
}

interface ConnectorAuthDefinition {
  kind: "service-key" | "oauth2" | "oauth-service-key" | "oauth-local";
  requiredSecrets: string[];
  setupNotes?: string[];
}

interface ConnectorManifest {
  connectorId: string;
  label: string;
  category: string;
  secondaryCategories?: string[];
  status: "harness_backed" | "manifest_only_blocked";
  backend?: string;
  auth: ConnectorAuthDefinition;
  resources: string[];
  nodeInputs: ConnectorInputField[];
  operations: ConnectorOperationDefinition[];
  readiness?: {
    state: "blocked" | "setup_required" | "read_ready" | "write_ready";
    canRenderNode: boolean;
    canRunReadOps: boolean;
    canRunWriteOps: boolean;
    blockedReason?: string;
  };
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface ConnectorNodePanelProps {
  connectorId: string;
  nodeConfig: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
  onClose: () => void;
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ConnectorNodePanel({
  connectorId,
  nodeConfig,
  onConfigChange,
  onClose,
}: ConnectorNodePanelProps) {
  const { connected, request } = useGateway();

  const [manifest, setManifest] = useState<ConnectorManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Derived state from nodeConfig ──────────────────────────────────────
  const credentialId = (nodeConfig.credentialId as string) ?? "";
  const selectedResource = (nodeConfig.resource as string) ?? "";
  const selectedOperation = (nodeConfig.operation as string) ?? "";
  const outputMappingValue =
    typeof nodeConfig.outputMapping === "string"
      ? nodeConfig.outputMapping
      : nodeConfig.outputMapping && typeof nodeConfig.outputMapping === "object"
        ? JSON.stringify(nodeConfig.outputMapping, null, 2)
        : "";

  // ── Load manifest ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!connected) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    request("workflows.manifest", { connectorId })
      .then((result: unknown) => {
        if (!cancelled) {
          setManifest(result as ConnectorManifest);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message || "Failed to load connector manifest");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connectorId, connected, request]);

  // ── Config updater ─────────────────────────────────────────────────────
  const updateConfig = useCallback(
    (field: string, value: unknown) => {
      onConfigChange({ ...nodeConfig, [field]: value });
    },
    [nodeConfig, onConfigChange],
  );

  // ── Filtered operations for selected resource ──────────────────────────
  const filteredOperations = useMemo(() => {
    if (!manifest || !selectedResource) {
      return [];
    }
    return manifest.operations.filter((op) => op.resource === selectedResource);
  }, [manifest, selectedResource]);

  // ── Grouped operations: Read | Write | Meta ────────────────────────────
  const groupedOperations = useMemo(() => {
    const groups: Record<string, ConnectorOperationDefinition[]> = {
      Read: [],
      Write: [],
      Meta: [],
    };
    for (const op of filteredOperations) {
      const key =
        op.operationType === "read" ? "Read" : op.operationType === "write" ? "Write" : "Meta";
      groups[key].push(op);
    }
    return groups;
  }, [filteredOperations]);

  // ── Current operation object ───────────────────────────────────────────
  const currentOp = useMemo(
    () => manifest?.operations.find((op) => op.id === selectedOperation) ?? null,
    [manifest, selectedOperation],
  );

  // ── Fields filtered by appliesTo ───────────────────────────────────────
  const activeFields = useMemo(() => {
    if (!manifest || !selectedOperation) {
      return [];
    }
    return manifest.nodeInputs.filter(
      (f) => !f.appliesTo || f.appliesTo.length === 0 || f.appliesTo.includes(selectedOperation),
    );
  }, [manifest, selectedOperation]);

  // ── Separate regular fields from options_group ─────────────────────────
  const { regularFields, optionsGroups } = useMemo(() => {
    const regular: ConnectorInputField[] = [];
    const opts: ConnectorInputField[] = [];
    for (const f of activeFields) {
      if (f.type === "options_group") {
        opts.push(f);
      } else {
        regular.push(f);
      }
    }
    return { regularFields: regular, optionsGroups: opts };
  }, [activeFields]);

  // ── Side-effect badge for current operation ────────────────────────────
  const sideEffectBadge = useMemo(() => {
    if (!currentOp) {
      return null;
    }
    if (currentOp.sideEffectLevel === "outbound_delivery") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-full">
          Outbound Delivery
        </span>
      );
    }
    if (currentOp.sideEffectLevel === "external_mutation") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded-full">
          External Mutation
        </span>
      );
    }
    return null;
  }, [currentOp]);

  // ── Loading / Error states ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-4 text-xs text-[hsl(var(--muted-foreground))]">
        Loading connector manifest...
      </div>
    );
  }

  if (error || !manifest) {
    return (
      <div className="p-4 space-y-2">
        <div className="text-xs text-red-400">{error || "Unknown error"}</div>
        <button onClick={onClose} className="text-xs text-[hsl(var(--primary))] hover:underline">
          Close
        </button>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))] flex-shrink-0">
        <div>
          <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
            {manifest.label}
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
            <span>{manifest.category}</span>
            {manifest.readiness && (
              <>
                <span className="opacity-40">·</span>
                <ReadinessBadge state={manifest.readiness.state} />
              </>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
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

      {/* Blocked banner — manifest-only connectors cannot be executed (spec Rule 6) */}
      {manifest.readiness?.state === "blocked" && (
        <div className="mx-4 mt-3 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
          <div className="text-xs font-medium text-red-400 mb-0.5">Contract Only — No Runtime</div>
          <div className="text-[10px] text-red-400/70 leading-relaxed">
            {manifest.readiness.blockedReason ||
              "This connector has a manifest but no executable harness. It cannot be used in workflows until a runtime is implemented."}
          </div>
        </div>
      )}

      {/* Scrollable form body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Step 2: Credential Picker — ALWAYS first (Rule 7) */}
        <CredentialSelector
          connectorId={connectorId}
          authKind={manifest.auth.kind}
          requiredSecrets={manifest.auth.requiredSecrets}
          selectedCredentialId={credentialId || undefined}
          onChange={(id) => updateConfig("credentialId", id ?? "")}
          gatewayRequest={request}
          gatewayConnected={connected}
        />

        {/* Gate: nothing below credential until one is bound */}
        {!credentialId ? (
          <div className="text-xs text-[hsl(var(--muted-foreground))] italic py-4 text-center border border-dashed border-[hsl(var(--border))] rounded-lg">
            Select credential to configure
          </div>
        ) : (
          <>
            {/* Step 3: Resource Dropdown */}
            <div className={DOCK_SECTION}>
              <label className={DOCK_LABEL}>Resource</label>
              <select
                className={DOCK_INPUT}
                value={selectedResource}
                onChange={(e) => {
                  updateConfig("resource", e.target.value);
                  // Clear operation when resource changes
                  onConfigChange({
                    ...nodeConfig,
                    resource: e.target.value,
                    operation: "",
                  });
                }}
              >
                <option value="">Select resource...</option>
                {manifest.resources.map((r) => (
                  <option key={r} value={r}>
                    {titleCase(r)}
                  </option>
                ))}
              </select>
            </div>

            {/* Step 4: Operation Dropdown (grouped by type) */}
            {selectedResource && (
              <div className={DOCK_SECTION}>
                <label className={DOCK_LABEL}>Operation</label>
                <select
                  className={DOCK_INPUT}
                  value={selectedOperation}
                  onChange={(e) => updateConfig("operation", e.target.value)}
                >
                  <option value="">Select operation...</option>
                  {(["Read", "Write", "Meta"] as const).map((group) => {
                    const ops = groupedOperations[group];
                    if (!ops || ops.length === 0) {
                      return null;
                    }
                    const writeDisabled =
                      group === "Write" && manifest.readiness?.canRunWriteOps === false;
                    return (
                      <optgroup
                        key={group}
                        label={writeDisabled ? `${group} (not available)` : group}
                      >
                        {ops.map((op) => (
                          <option
                            key={op.id}
                            value={op.id}
                            title={
                              writeDisabled
                                ? "Write operations unavailable — connector is read-only or has no runtime"
                                : op.summary
                            }
                            disabled={writeDisabled}
                          >
                            {op.label}
                            {writeDisabled ? " \u{1F512}" : ""}
                            {!writeDisabled && op.sideEffectLevel === "outbound_delivery"
                              ? " \u{1F534}"
                              : ""}
                            {!writeDisabled && op.sideEffectLevel === "external_mutation"
                              ? " \u{1F7E0}"
                              : ""}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                {sideEffectBadge && <div className="mt-1">{sideEffectBadge}</div>}
              </div>
            )}

            {/* Step 5: Dynamic fields */}
            {selectedOperation &&
              regularFields.map((field) => (
                <DynamicField
                  key={field.id}
                  field={field}
                  value={nodeConfig[field.id]}
                  allValues={nodeConfig}
                  onChange={(val) => updateConfig(field.id, val)}
                  ctx={{
                    connectorId,
                    credentialId,
                    manifest: manifest!,
                    gatewayRequest: request,
                  }}
                />
              ))}

            {/* Step 6: Options groups */}
            {selectedOperation &&
              optionsGroups.map((group) => (
                <OptionsGroup
                  key={group.id}
                  group={group}
                  values={nodeConfig}
                  onChange={(field, val) => updateConfig(field, val)}
                  ctx={{
                    connectorId,
                    credentialId,
                    manifest: manifest!,
                    gatewayRequest: request,
                  }}
                />
              ))}

            {/* Safety panel — side-effect badge + action buttons */}
            {currentOp && (
              <SafetyPanel
                sideEffectLevel={currentOp.sideEffectLevel}
                operationId={currentOp.id}
                connectorId={connectorId}
                credentialId={credentialId || undefined}
                onTestNode={
                  manifest.readiness?.state !== "blocked" && currentOp.sideEffectLevel === "none"
                    ? async () => {
                        await request("workflows.connectorCommand", {
                          connectorId,
                          command: currentOp.id,
                          credentialId,
                          args: buildConnectorCommandArgs(nodeConfig),
                        });
                      }
                    : undefined
                }
                onCheckAuth={
                  credentialId
                    ? async () => {
                        await request("workflows.connectorCommand", {
                          connectorId,
                          command: "health",
                          credentialId,
                        });
                      }
                    : undefined
                }
              />
            )}

            {/* I/O Preview — input shape + output ports */}
            {currentOp && (
              <IOPreviewPanel
                outputPorts={
                  (currentOp.outputs ?? []).map((o) => ({
                    portId: o.portId,
                    kind: o.kind,
                    description: o.description,
                  })) as OutputPort[]
                }
              />
            )}

            {currentOp && (
              <div className={DOCK_SECTION}>
                <label className={DOCK_LABEL}>Output mapping</label>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))] -mt-0.5">
                  Optional JSON map that copies connector result paths into named output fields.
                </div>
                <textarea
                  className={DOCK_INPUT + " font-mono text-[11px] resize-y"}
                  rows={4}
                  value={outputMappingValue}
                  onChange={(e) => updateConfig("outputMapping", e.target.value)}
                  placeholder={OUTPUT_MAPPING_PLACEHOLDER}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    if (!raw) {
                      updateConfig("outputMapping", "");
                      return;
                    }
                    try {
                      const parsed = JSON.parse(raw) as unknown;
                      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                        updateConfig("outputMapping", JSON.stringify(parsed, null, 2));
                      }
                    } catch {
                      // Leave invalid JSON visible; workflow validation reports the issue.
                    }
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Connector context for field rendering ─────────────────────────────────────

interface ConnectorFieldContext {
  connectorId: string;
  credentialId: string;
  manifest: ConnectorManifest;
  gatewayRequest: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
}

function connectorValueToArg(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

function buildConnectorCommandArgs(nodeConfig: Record<string, unknown>): string[] {
  const ignored = new Set([
    "connectorId",
    "connectorName",
    "connectorCategory",
    "credentialId",
    "resource",
    "operation",
    "outputMapping",
  ]);
  const args: string[] = [];
  for (const [key, value] of Object.entries(nodeConfig)) {
    if (ignored.has(key)) {
      continue;
    }
    const arg = connectorValueToArg(value);
    if (arg === undefined) {
      continue;
    }
    args.push(`--${key.replaceAll("_", "-")}`, arg);
  }
  return args;
}

// ── DynamicField — renders a single field based on renderAs ──────────────────

function DynamicField({
  field,
  value,
  allValues,
  onChange,
  ctx,
}: {
  field: ConnectorInputField;
  value: unknown;
  allValues: Record<string, unknown>;
  onChange: (value: unknown) => void;
  ctx?: ConnectorFieldContext;
}) {
  // Conditional visibility: check showWhen
  if (field.showWhen) {
    const refValue = allValues[field.showWhen.field];
    if (refValue !== field.showWhen.equals) {
      return null;
    }
  }

  const effectiveValue = value ?? field.default ?? "";
  const widget = renderFieldWidget(field, effectiveValue, onChange, ctx);

  // Wrap expression-enabled fields in ExpressionEditor toggle
  const wrappedWidget =
    field.expressionEnabled && ctx ? (
      <ExpressionEditor
        value={String(effectiveValue)}
        onChange={(v) => onChange(v)}
        expressionEnabled={true}
        placeholder={field.placeholder}
      >
        {widget}
      </ExpressionEditor>
    ) : (
      widget
    );

  return (
    <div className={DOCK_SECTION}>
      <label
        className={
          DOCK_LABEL +
          (field.required ? " after:content-['*'] after:text-red-400 after:ml-0.5" : "")
        }
      >
        {field.label}
      </label>
      {field.description && (
        <div className="text-[10px] text-[hsl(var(--muted-foreground))] -mt-0.5">
          {field.description}
        </div>
      )}
      {wrappedWidget}
    </div>
  );
}

function renderFieldWidget(
  field: ConnectorInputField,
  value: unknown,
  onChange: (value: unknown) => void,
  ctx?: ConnectorFieldContext,
) {
  switch (field.renderAs) {
    case "text":
      return (
        <input
          type="text"
          className={DOCK_INPUT}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "richtext":
      return (
        <textarea
          className={DOCK_INPUT + " resize-y"}
          rows={field.rows ?? 4}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "select":
      // Use DynamicPicker for fields with pickerHint and no static options
      if (field.pickerHint && ctx?.credentialId && (!field.options || field.options.length === 0)) {
        return (
          <DynamicPicker
            connectorId={ctx.connectorId}
            credentialId={ctx.credentialId}
            pickerHint={field.pickerHint}
            manifest={ctx.manifest as unknown as Record<string, unknown>}
            value={String(value ?? "")}
            onChange={(v) => onChange(v)}
            placeholder={field.placeholder}
            gatewayRequest={ctx.gatewayRequest}
          />
        );
      }
      return (
        <select
          className={DOCK_INPUT}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select...</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value} title={opt.description}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case "multiselect":
      return (
        <MultiselectTags
          options={field.options ?? []}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          placeholder={field.placeholder}
        />
      );

    case "boolean":
      return <ToggleSwitch checked={Boolean(value)} onChange={onChange} label={field.label} />;

    case "number":
      return (
        <input
          type="number"
          className={DOCK_INPUT}
          value={value != null ? Number(value) : ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );

    case "datetime":
      return (
        <input
          type="datetime-local"
          className={DOCK_INPUT}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "json":
      return (
        <textarea
          className={DOCK_INPUT + " font-mono text-[11px] resize-y"}
          rows={field.rows ?? 6}
          value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
          placeholder={field.placeholder ?? "{ }"}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onBlur={(e) => {
            // Validate JSON on blur
            try {
              const parsed = JSON.parse(e.target.value);
              onChange(JSON.stringify(parsed, null, 2));
            } catch {
              // Leave as-is if invalid
            }
          }}
        />
      );

    case "expression":
      return (
        <input
          type="text"
          className={DOCK_INPUT + " font-mono text-[11px]"}
          value={String(value ?? "")}
          placeholder={field.placeholder ?? "={{ $json.field }}"}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    default:
      return (
        <input
          type="text"
          className={DOCK_INPUT}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

// ── OptionsGroup — collapsible advanced settings with "+ Add option" ─────────

function OptionsGroup({
  group,
  values,
  onChange,
  ctx,
}: {
  group: ConnectorInputField;
  values: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  ctx?: ConnectorFieldContext;
}) {
  const [expanded, setExpanded] = useState(false);
  const children = group.children ?? [];

  // Track which options have been "added" by the user
  const [addedOptions, setAddedOptions] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const child of children) {
      if (values[child.id] !== undefined && values[child.id] !== child.default) {
        set.add(child.id);
      }
    }
    return set;
  });

  const availableToAdd = children.filter((c) => !addedOptions.has(c.id));

  return (
    <div className="border border-[hsl(var(--border))] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider hover:bg-[hsl(var(--muted))] transition-colors"
      >
        <span>{group.label || "Options"}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={`transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path d="M3 5l3 3 3-3" />
        </svg>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2.5">
          {/* Show added options */}
          {children
            .filter((c) => addedOptions.has(c.id))
            .map((child) => (
              <div key={child.id} className="flex items-center justify-between gap-2">
                {child.renderAs === "boolean" || child.type === "boolean" ? (
                  <ToggleSwitch
                    checked={Boolean(values[child.id] ?? child.default)}
                    onChange={(val) => onChange(child.id, val)}
                    label={child.label}
                  />
                ) : (
                  <DynamicField
                    field={child}
                    value={values[child.id]}
                    allValues={values}
                    onChange={(val) => onChange(child.id, val)}
                    ctx={ctx}
                  />
                )}
              </div>
            ))}

          {/* "+ Add option" button */}
          {availableToAdd.length > 0 && (
            <AddOptionButton
              available={availableToAdd}
              onAdd={(id) => {
                setAddedOptions((prev) => new Set(prev).add(id));
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── AddOptionButton — dropdown to pick which option to add ───────────────────

function AddOptionButton({
  available,
  onAdd,
}: {
  available: ConnectorInputField[];
  onAdd: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs text-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]/80 transition-colors flex items-center gap-1"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M5 1v8M1 5h8" />
        </svg>
        Add option
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-10 min-w-[180px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg shadow-lg py-1">
          {available.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                onAdd(opt.id);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MultiselectTags — tag-style multi-select ─────────────────────────────────

function MultiselectTags({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: FieldOption[];
  value: string[];
  onChange: (value: unknown) => void;
  placeholder?: string;
}) {
  const toggle = (val: string) => {
    const next = value.includes(val) ? value.filter((v) => v !== val) : [...value, val];
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1 min-h-[32px] p-1.5 rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))]">
        {value.length === 0 && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] px-1 py-0.5">
            {placeholder || "None selected"}
          </span>
        )}
        {value.map((v) => {
          const opt = options.find((o) => o.value === v);
          return (
            <span
              key={v}
              className="inline-flex items-center gap-0.5 text-[10px] bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] px-1.5 py-0.5 rounded"
            >
              {opt?.label ?? v}
              <button type="button" onClick={() => toggle(v)} className="ml-0.5 hover:text-red-400">
                x
              </button>
            </span>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1">
        {options
          .filter((o) => !value.includes(o.value))
          .map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              className="text-[10px] px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))] transition-colors"
              title={opt.description}
            >
              + {opt.label}
            </button>
          ))}
      </div>
    </div>
  );
}

// ── ToggleSwitch ─────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: unknown) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer w-full">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))]"
        }`}
      >
        <span
          className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
      <span className="text-xs text-[hsl(var(--foreground))]">{label}</span>
    </label>
  );
}

// ── ReadinessBadge ───────────────────────────────────────────────────────────

function ReadinessBadge({ state }: { state: string }) {
  const styles: Record<string, { text: string; className: string }> = {
    blocked: { text: "Blocked", className: "text-red-400" },
    setup_required: { text: "Setup Required", className: "text-yellow-400" },
    read_ready: { text: "Read Ready", className: "text-blue-400" },
    write_ready: { text: "Write Ready", className: "text-emerald-400" },
  };
  const s = styles[state] ?? { text: state, className: "text-[hsl(var(--muted-foreground))]" };
  return <span className={`text-[10px] font-medium ${s.className}`}>{s.text}</span>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default ConnectorNodePanel;
