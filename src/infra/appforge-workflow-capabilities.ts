export type AppForgeWorkflowCapabilityKind =
  | "action"
  | "human_review"
  | "trigger"
  | "output"
  | "view";

export type AppForgeWorkflowSideEffect =
  | "read"
  | "operator_interaction"
  | "external_write"
  | "outbound_delivery"
  | "mutation";

export type AppForgeAppSummary = {
  id: string;
  name: string;
  description?: string;
  version?: number;
  metadata?: unknown;
  [key: string]: unknown;
};

export type AppForgeWorkflowCapability = {
  id: string;
  name: string;
  label: string;
  description: string;
  category: "AppForge";
  source: "appforge";
  appId: string;
  appName: string;
  appVersion?: number;
  capabilityId: string;
  capabilityType: AppForgeWorkflowCapabilityKind;
  sideEffect: AppForgeWorkflowSideEffect;
  inputs: string[];
  outputs: string[];
  eventTypes: string[];
  openMode?: "modal" | "window" | "background";
  governance: {
    mode: "allow" | "ask";
    approvalBacked: boolean;
    note?: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(stringValue).filter((item): item is string => Boolean(item));
}

function cleanId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "capability"
  );
}

function capabilityKind(value: unknown): AppForgeWorkflowCapabilityKind {
  const raw = stringValue(value);
  return raw === "action" ||
    raw === "human_review" ||
    raw === "trigger" ||
    raw === "output" ||
    raw === "view"
    ? raw
    : "action";
}

function sideEffect(
  value: unknown,
  kind: AppForgeWorkflowCapabilityKind,
): AppForgeWorkflowSideEffect {
  const raw = stringValue(value);
  if (
    raw === "read" ||
    raw === "operator_interaction" ||
    raw === "external_write" ||
    raw === "outbound_delivery" ||
    raw === "mutation"
  ) {
    return raw;
  }
  return kind === "human_review" || kind === "view" ? "operator_interaction" : "read";
}

function openMode(value: unknown): AppForgeWorkflowCapability["openMode"] {
  const raw = stringValue(value);
  return raw === "modal" || raw === "window" || raw === "background" ? raw : undefined;
}

function metadataCapabilities(metadata: unknown): unknown[] {
  if (!isRecord(metadata)) {
    return [];
  }
  return [
    ...(Array.isArray(metadata.workflowCapabilities) ? metadata.workflowCapabilities : []),
    ...(isRecord(metadata.workflow) && Array.isArray(metadata.workflow.capabilities)
      ? metadata.workflow.capabilities
      : []),
    ...(isRecord(metadata.appForge) && Array.isArray(metadata.appForge.workflowCapabilities)
      ? metadata.appForge.workflowCapabilities
      : []),
  ];
}

export function extractAppForgeWorkflowCapabilities(
  app: AppForgeAppSummary,
): AppForgeWorkflowCapability[] {
  const capabilities = metadataCapabilities(app.metadata);
  return capabilities.filter(isRecord).map((capability, index) => {
    const capabilityId =
      stringValue(capability.id) ??
      stringValue(capability.name) ??
      cleanId(stringValue(capability.label) ?? `capability-${index + 1}`);
    const kind = capabilityKind(capability.type ?? capability.kind);
    const effect = sideEffect(
      capability.sideEffect ?? capability.side_effect ?? capability.actionClass,
      kind,
    );
    const label = stringValue(capability.label) ?? stringValue(capability.name) ?? capabilityId;
    const name = `appforge:${app.id}:${cleanId(capabilityId)}`;
    const requiresApproval =
      effect === "external_write" || effect === "outbound_delivery" || effect === "mutation";

    return {
      id: name,
      name,
      label,
      description:
        stringValue(capability.description) ?? app.description ?? `Run ${label} in ${app.name}.`,
      category: "AppForge" as const,
      source: "appforge" as const,
      appId: app.id,
      appName: app.name,
      appVersion: app.version,
      capabilityId,
      capabilityType: kind,
      sideEffect: effect,
      inputs: stringArray(capability.inputs),
      outputs: stringArray(capability.outputs),
      eventTypes: stringArray(capability.eventTypes ?? capability.events),
      openMode: openMode(capability.openMode ?? capability.open_mode),
      governance: {
        mode: requiresApproval ? "ask" : "allow",
        approvalBacked: requiresApproval,
        note: requiresApproval
          ? "AppForge capability has mutating or outbound side effects and must be approval-gated in live workflows."
          : undefined,
      },
    };
  });
}

export function collectAppForgeWorkflowCapabilities(
  apps: AppForgeAppSummary[],
): AppForgeWorkflowCapability[] {
  return apps.flatMap(extractAppForgeWorkflowCapabilities).toSorted((a, b) => {
    const appCompare = a.appName.localeCompare(b.appName);
    return appCompare || a.label.localeCompare(b.label);
  });
}
