import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  Play,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  Wand2,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchLocalApi } from "../utils/localApiFetch";

type GatewayRequest = <T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  opts?: { timeoutMs?: number },
) => Promise<T>;

type FamilyMember = {
  id: string;
  name: string;
  role: string;
  team?: string | null;
};

type JobTemplate = {
  id: string;
  name: string;
  departmentId?: string;
  description?: string;
  rolePrompt: string;
  successDefinition?: string;
  toolsAllow?: string[];
  defaultStage?: "simulate" | "shadow" | "limited-live" | "live";
  metadata?: Record<string, unknown>;
};

type JobAssignment = {
  id: string;
  templateId: string;
  agentId: string;
  title: string;
  enabled: boolean;
  cadenceMinutes: number;
  deploymentStage?: "simulate" | "shadow" | "limited-live" | "live";
  scopeLimit?: string;
  metadata?: Record<string, unknown>;
  updatedAt?: number;
};

type JobRun = {
  id: string;
  agentId: string;
  assignmentId: string;
  status: "running" | "completed" | "blocked" | "failed";
  startedAt: number;
  endedAt?: number;
  deploymentStage?: string;
};

type JobEvent = {
  id: string;
  eventType: string;
  source: "internal_hook" | "webhook" | "manual" | "system";
  targetAgentId?: string;
  createdAt: number;
  outcome?: string;
  metadata?: Record<string, unknown>;
};

type CapabilityToolEntry = {
  name: string;
  label?: string;
  description?: string;
  source: "core" | "plugin" | "connector";
  pluginId?: string;
  optional?: boolean;
};

type ConnectorCatalogCommand = {
  id: string;
  summary?: string;
  requiredMode?: string;
  supportsJson?: boolean;
  resource?: string;
  actionClass?: string;
};

type ConnectorCatalogEntry = {
  tool: string;
  label: string;
  description?: string;
  backend?: string;
  version?: string;
  manifestSchemaVersion?: string;
  category?: string;
  categories: string[];
  resources: string[];
  modes: string[];
  commands: ConnectorCatalogCommand[];
  installState: "ready" | "needs-setup" | "repo-only" | "error";
  status: {
    ok: boolean;
    label: string;
    detail?: string;
  };
  discovery?: {
    binaryPath?: string;
    repoDir?: string;
    harnessDir?: string;
    requiresPython?: string;
    sources?: Array<"path" | "repo">;
  };
  auth?: {
    kind?: string;
    required?: boolean;
    serviceKeys?: string[];
    interactiveSetup?: string[];
  };
};

type AgentSettingsResponse = {
  executionWorker?: {
    enabled?: boolean;
    every?: string;
  };
  tools?: {
    allow?: string[];
  };
};

type FlowStep = "worker" | "triggers" | "tools" | "rules" | "launch";
type WorkerPresetId = "vip-email" | "slack-mentions";

type FlowDraft = {
  presetId: WorkerPresetId | "";
  mode: "new" | "existing";
  existingAgentId: string;
  existingAssignmentId: string;
  identity: {
    displayName: string;
    agentId: string;
    role: string;
    team: string;
  };
  purpose: {
    workerTitle: string;
    mission: string;
    systems: string;
  };
  inputs: {
    sourceKind: "schedule" | "event" | "hybrid";
    sourceLabel: string;
    cadenceMinutes: string;
    eventTriggers: string;
    drainUntilClear: boolean;
  };
  tools: {
    selected: string[];
    missing: string;
    search: string;
  };
  connectors: {
    selected: string[];
    selectedActions: string[];
    search: string;
  };
  hubspot: {
    portalId: string;
    pipelines: string;
    owners: string;
    teams: string;
    queues: string;
    notes: string;
  };
  rules: {
    operatingInstructions: string;
    successDefinition: string;
    scopeLimit: string;
    blockedResponse: string;
    escalationTarget: string;
    escalationRules: string;
  };
  launch: {
    deploymentStage: "simulate" | "shadow" | "limited-live" | "live";
    state: "play" | "pause" | "stop";
  };
};

type WorkerFlowModalProps = {
  isOpen: boolean;
  onClose: () => void;
  gatewayRequest: GatewayRequest;
  onOpenAdvanced?: () => void;
  onOpenSystems?: () => void;
};

const FLOW_STEPS: Array<{ id: FlowStep; label: string; icon: typeof Workflow }> = [
  { id: "worker", label: "Worker", icon: Workflow },
  { id: "triggers", label: "Inputs", icon: RefreshCw },
  { id: "tools", label: "Systems", icon: Wrench },
  { id: "rules", label: "Rules", icon: ShieldAlert },
  { id: "launch", label: "Launch", icon: Play },
];

function slugifyAgentId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function parseDelimitedList(raw: string, delimiter: RegExp = /[\n,]+/): string[] {
  return raw
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinDelimitedList(values: unknown): string {
  if (Array.isArray(values)) {
    return values
      .filter((value): value is string => typeof value === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .join(", ");
  }
  if (typeof values === "string") {
    return values.trim();
  }
  return "";
}

function intervalFromMinutes(raw: string): string {
  const minutes = Number.parseInt(raw, 10);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "20m";
  }
  if (minutes % 60 === 0) {
    return `${Math.max(1, Math.floor(minutes / 60))}h`;
  }
  return `${Math.max(1, minutes)}m`;
}

function formatDateTime(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return "Never";
  return new Date(ts).toLocaleString();
}

function createDefaultDraft(): FlowDraft {
  return {
    presetId: "",
    mode: "new",
    existingAgentId: "",
    existingAssignmentId: "",
    identity: {
      displayName: "",
      agentId: "",
      role: "",
      team: "",
    },
    purpose: {
      workerTitle: "",
      mission: "",
      systems: "",
    },
    inputs: {
      sourceKind: "schedule",
      sourceLabel: "",
      cadenceMinutes: "5",
      eventTriggers: "",
      drainUntilClear: true,
    },
    tools: {
      selected: [],
      missing: "",
      search: "",
    },
    connectors: {
      selected: [],
      selectedActions: [],
      search: "",
    },
    hubspot: {
      portalId: "",
      pipelines: "",
      owners: "",
      teams: "",
      queues: "",
      notes: "",
    },
    rules: {
      operatingInstructions: "",
      successDefinition: "",
      scopeLimit: "",
      blockedResponse: "",
      escalationTarget: "",
      escalationRules: "",
    },
    launch: {
      deploymentStage: "simulate",
      state: "play",
    },
  };
}

type WorkerPresetDefinition = {
  id: WorkerPresetId;
  label: string;
  detail: string;
  systemsNote: string;
};

const WORKER_PRESETS: WorkerPresetDefinition[] = [
  {
    id: "vip-email",
    label: "VIP Email Watcher",
    detail: "Monitors a mailbox for messages from priority senders and surfaces them immediately.",
    systemsNote:
      "Uses the existing vip_email runtime tool today and prefers aos-google as the connector path.",
  },
  {
    id: "slack-mentions",
    label: "Slack Mention Watcher",
    detail:
      "Scans Slack for direct mentions of Jason and other high-signal messages in watched channels.",
    systemsNote:
      "Uses the existing slack_signal_monitor runtime tool today; a Slack connector plugin can be added later.",
  },
];

function qualifyConnectorAction(tool: string, commandId: string): string {
  return `${tool}::${commandId}`;
}

function splitQualifiedConnectorAction(value: string): { tool: string; commandId: string } | null {
  const index = value.indexOf("::");
  if (index <= 0) return null;
  return {
    tool: value.slice(0, index),
    commandId: value.slice(index + 2),
  };
}

function normalizeConnectorToolSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function connectorActionToolName(tool: string, commandId: string): string {
  return `connector_${normalizeConnectorToolSegment(tool)}__${normalizeConnectorToolSegment(commandId)}`;
}

function readOperatorFlow(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = meta?.operatorFlow;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readHubSpotScope(flow: Record<string, unknown> | undefined): FlowDraft["hubspot"] {
  const raw = flow?.hubspot;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return createDefaultDraft().hubspot;
  }
  const typed = raw as Record<string, unknown>;
  return {
    portalId: typeof typed.portalId === "string" ? typed.portalId : "",
    pipelines: joinDelimitedList(typed.pipelines),
    owners: joinDelimitedList(typed.owners),
    teams: joinDelimitedList(typed.teams),
    queues: joinDelimitedList(typed.queues),
    notes: typeof typed.notes === "string" ? typed.notes : "",
  };
}

function buildHubSpotScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const portalId = draft.hubspot.portalId.trim();
  const pipelines = parseDelimitedList(draft.hubspot.pipelines);
  const owners = parseDelimitedList(draft.hubspot.owners);
  const teams = parseDelimitedList(draft.hubspot.teams);
  const queues = parseDelimitedList(draft.hubspot.queues);
  const notes = draft.hubspot.notes.trim();
  if (
    !portalId &&
    pipelines.length === 0 &&
    owners.length === 0 &&
    teams.length === 0 &&
    queues.length === 0 &&
    !notes
  ) {
    return undefined;
  }
  return {
    portalId: portalId || undefined,
    pipelines: pipelines.length > 0 ? pipelines : undefined,
    owners: owners.length > 0 ? owners : undefined,
    teams: teams.length > 0 ? teams : undefined,
    queues: queues.length > 0 ? queues : undefined,
    notes: notes || undefined,
  };
}

function describeHubSpotScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const portalId = draft.hubspot.portalId.trim();
  if (portalId) parts.push(`portal ${portalId}`);
  const pipelines = parseDelimitedList(draft.hubspot.pipelines);
  if (pipelines.length > 0) parts.push(`pipelines ${pipelines.join(", ")}`);
  const owners = parseDelimitedList(draft.hubspot.owners);
  if (owners.length > 0) parts.push(`owners ${owners.join(", ")}`);
  const teams = parseDelimitedList(draft.hubspot.teams);
  if (teams.length > 0) parts.push(`teams ${teams.join(", ")}`);
  const queues = parseDelimitedList(draft.hubspot.queues);
  if (queues.length > 0) parts.push(`queues ${queues.join(", ")}`);
  return parts.join(" · ");
}

function getHubSpotScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-hubspot")) {
    return null;
  }
  const portalId = draft.hubspot.portalId.trim();
  const pipelines = parseDelimitedList(draft.hubspot.pipelines);
  const owners = parseDelimitedList(draft.hubspot.owners);
  const teams = parseDelimitedList(draft.hubspot.teams);
  const queues = parseDelimitedList(draft.hubspot.queues);
  if (!portalId) {
    return "HubSpot needs a portal or account id before this worker can launch.";
  }
  if (pipelines.length === 0 && owners.length === 0 && teams.length === 0 && queues.length === 0) {
    return "HubSpot needs at least one structured scope target such as a pipeline, owner, team, or queue before launch.";
  }
  return null;
}

function buildPersona(draft: FlowDraft): string | undefined {
  const lines = [
    `You are ${draft.identity.displayName || draft.identity.agentId}, a ${draft.identity.role}.`,
    draft.purpose.mission ? `Mission: ${draft.purpose.mission.trim()}` : "",
    draft.purpose.systems ? `Systems in scope: ${draft.purpose.systems.trim()}` : "",
    draft.rules.operatingInstructions
      ? `Operating instructions: ${draft.rules.operatingInstructions.trim()}`
      : "",
  ].filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function buildRolePrompt(draft: FlowDraft): string {
  const triggerLine =
    draft.inputs.sourceKind === "event"
      ? `Respond when these event triggers arrive: ${draft.inputs.eventTriggers.trim() || "operator-defined triggers"}.`
      : draft.inputs.sourceKind === "hybrid"
        ? `Watch ${draft.inputs.sourceLabel.trim() || "the configured source"} on a ${draft.inputs.cadenceMinutes.trim() || "5"}-minute schedule and also react to matching event triggers.`
        : `Watch ${draft.inputs.sourceLabel.trim() || "the configured source"} every ${draft.inputs.cadenceMinutes.trim() || "5"} minutes.`;

  const queueBehavior = draft.inputs.drainUntilClear
    ? "When work is present, keep processing until the queue is drained before going idle again."
    : "Handle one unit of work per cycle, then wait for the next scheduled or event-driven pass.";

  return [
    draft.purpose.mission.trim(),
    triggerLine,
    draft.purpose.systems.trim() ? `Systems in scope: ${draft.purpose.systems.trim()}` : "",
    queueBehavior,
    draft.rules.operatingInstructions.trim(),
    draft.rules.blockedResponse.trim() ? `If blocked: ${draft.rules.blockedResponse.trim()}` : "",
    draft.rules.escalationTarget.trim()
      ? `Escalation target: ${draft.rules.escalationTarget.trim()}`
      : "",
    draft.rules.escalationRules.trim()
      ? `Escalation rules: ${draft.rules.escalationRules.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildTemplateMetadata(draft: FlowDraft): Record<string, unknown> {
  return {
    operatorFlow: {
      presetId: draft.presetId || undefined,
      workerTitle: draft.purpose.workerTitle.trim() || undefined,
      mission: draft.purpose.mission.trim() || undefined,
      systems: draft.purpose.systems.trim() || undefined,
      sourceKind: draft.inputs.sourceKind,
      sourceLabel: draft.inputs.sourceLabel.trim() || undefined,
      drainUntilClear: draft.inputs.drainUntilClear,
      connectors: [],
      hubspot: buildHubSpotScopeMetadata(draft),
      missingCapabilities: parseDelimitedList(draft.tools.missing),
      operatingInstructions: draft.rules.operatingInstructions.trim() || undefined,
      blockedResponse: draft.rules.blockedResponse.trim() || undefined,
      escalationTarget: draft.rules.escalationTarget.trim() || undefined,
      escalationRules: draft.rules.escalationRules.trim() || undefined,
      updatedAt: new Date().toISOString(),
    },
  };
}

function buildAssignmentMetadata(draft: FlowDraft): Record<string, unknown> {
  const eventTriggers = parseDelimitedList(draft.inputs.eventTriggers);
  return {
    eventTriggers,
    operatorFlow: {
      presetId: draft.presetId || undefined,
      sourceKind: draft.inputs.sourceKind,
      sourceLabel: draft.inputs.sourceLabel.trim() || undefined,
      cadenceMinutes: Number.parseInt(draft.inputs.cadenceMinutes, 10) || 5,
      drainUntilClear: draft.inputs.drainUntilClear,
      connectors: [],
      hubspot: buildHubSpotScopeMetadata(draft),
      launchState: draft.launch.state,
      missingCapabilities: parseDelimitedList(draft.tools.missing),
      escalationTarget: draft.rules.escalationTarget.trim() || undefined,
    },
  };
}

function getPrimaryAssignment(assignments: JobAssignment[], agentId: string): JobAssignment | null {
  const matches = assignments
    .filter((assignment) => assignment.agentId === agentId)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  return matches.find((assignment) => assignment.enabled) ?? matches[0] ?? null;
}

function mergeUniqueTools(values: Array<string[] | undefined>): string[] {
  const merged = new Set<string>();
  for (const list of values) {
    for (const entry of list ?? []) {
      const value = entry.trim();
      if (value) merged.add(value);
    }
  }
  return Array.from(merged.values()).sort((a, b) => a.localeCompare(b));
}

function readConnectorSelections(meta: Record<string, unknown> | undefined): Array<{
  tool: string;
  selectedCommands: string[];
}> {
  const flow = readOperatorFlow(meta);
  const raw = flow.connectors;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const typed = entry as Record<string, unknown>;
      const tool = typeof typed.tool === "string" ? typed.tool.trim() : "";
      if (!tool) return null;
      const selectedCommands = Array.isArray(typed.selectedCommands)
        ? typed.selectedCommands.filter((item): item is string => typeof item === "string")
        : [];
      return { tool, selectedCommands };
    })
    .filter((entry): entry is { tool: string; selectedCommands: string[] } => Boolean(entry));
}

function buildConnectorSelections(
  draft: FlowDraft,
  connectorCatalog: ConnectorCatalogEntry[],
): Array<{
  tool: string;
  label?: string;
  category?: string;
  installState?: string;
  selectedCommands: string[];
}> {
  return draft.connectors.selected.map((tool) => {
    const connector = connectorCatalog.find((entry) => entry.tool === tool);
    const selectedCommands = draft.connectors.selectedActions
      .map((value) => splitQualifiedConnectorAction(value))
      .filter((entry): entry is { tool: string; commandId: string } => Boolean(entry))
      .filter((entry) => entry.tool === tool)
      .map((entry) => entry.commandId);
    return {
      tool,
      label: connector?.label,
      category: connector?.category,
      installState: connector?.installState,
      selectedCommands,
    };
  });
}

function buildRunnableConnectorToolNames(
  selections: Array<{ tool: string; selectedCommands: string[] }>,
  connectorCatalog: ConnectorCatalogEntry[],
): string[] {
  return Array.from(
    new Set(
      selections.flatMap((selection) => {
        const connector = connectorCatalog.find((entry) => entry.tool === selection.tool);
        if (!connector?.discovery?.binaryPath) {
          return [];
        }
        return selection.selectedCommands.map((commandId) =>
          connectorActionToolName(selection.tool, commandId),
        );
      }),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function buildPresetDraft(params: {
  presetId: WorkerPresetId;
  connectorCatalog: ConnectorCatalogEntry[];
}): FlowDraft {
  const draft = createDefaultDraft();
  draft.mode = "new";
  draft.presetId = params.presetId;

  if (params.presetId === "vip-email") {
    const googleConnector = params.connectorCatalog.find((entry) => entry.tool === "aos-google");
    draft.identity.displayName = "VIP Email Watcher";
    draft.identity.agentId = "vip-email-watcher";
    draft.identity.role = "VIP Inbox Monitor";
    draft.identity.team = "Executive Support";
    draft.purpose.workerTitle = "VIP Email Watcher";
    draft.purpose.mission =
      "Monitor the configured inbox for messages from the VIP sender list, summarize each new VIP email once, and surface urgent items immediately.";
    draft.purpose.systems = "Google Workspace inbox, VIP sender list, alert delivery";
    draft.inputs.sourceKind = "schedule";
    draft.inputs.sourceLabel = "VIP Gmail inbox";
    draft.inputs.cadenceMinutes = "5";
    draft.inputs.drainUntilClear = true;
    draft.tools.selected = ["vip_email"];
    draft.rules.operatingInstructions =
      "Check the configured inbox accounts for new messages from VIP senders. Preserve sender context, avoid duplicate alerts, and include sender, subject, and summary in each surfaced result.";
    draft.rules.successDefinition =
      "All new emails from configured VIP senders are surfaced once with sender, subject, urgency, and next-action summary.";
    draft.rules.scopeLimit =
      "Do not respond on behalf of Jason unless explicitly authorized. This worker monitors and escalates; it does not make executive decisions.";
    draft.rules.blockedResponse =
      "If inbox access or auth fails, alert Jason with the failure reason and stop making assumptions.";
    draft.rules.escalationTarget = "Jason";
    draft.rules.escalationRules =
      "Escalate immediately for emails from VIP senders that request approval, contain urgent asks, or require a personal decision.";
    if (googleConnector) {
      draft.connectors.selected = [googleConnector.tool];
      draft.connectors.selectedActions = googleConnector.commands
        .filter((command) => ["gmail.search", "gmail.read"].includes(command.id))
        .map((command) => qualifyConnectorAction(googleConnector.tool, command.id));
    }
    return draft;
  }

  draft.identity.displayName = "Slack Mention Watcher";
  draft.identity.agentId = "slack-mention-watcher";
  draft.identity.role = "Slack Signal Monitor";
  draft.identity.team = "Executive Support";
  draft.purpose.workerTitle = "Slack Mention Watcher";
  draft.purpose.mission =
    "Watch Slack for direct mentions of Jason and other high-signal messages in the configured channels, then surface the important ones quickly and cleanly.";
  draft.purpose.systems = "Slack workspace, watched channels, mention filters, alert delivery";
  draft.inputs.sourceKind = "schedule";
  draft.inputs.sourceLabel = "Slack mentions for Jason";
  draft.inputs.cadenceMinutes = "5";
  draft.inputs.drainUntilClear = true;
  draft.tools.selected = ["slack_signal_monitor"];
  draft.rules.operatingInstructions =
    "Scan the configured Slack channels for direct mentions of Jason and high-signal operational keywords. Deduplicate repeats and summarize the actionable items.";
  draft.rules.successDefinition =
    "Direct mentions and high-signal Slack messages are surfaced once with channel, sender, summary, and urgency context.";
  draft.rules.scopeLimit =
    "Do not reply in Slack automatically unless explicitly authorized. This worker monitors, summarizes, and escalates.";
  draft.rules.blockedResponse =
    "If Slack access, tokens, or channel scope are missing, alert Jason with the setup gap instead of guessing.";
  draft.rules.escalationTarget = "Jason";
  draft.rules.escalationRules =
    "Escalate immediately for direct mentions, urgent blockers, customer-impacting issues, or anything tagged as time-sensitive.";
  return draft;
}

function hydrateDraftFromExisting(params: {
  member: FamilyMember | null;
  assignment: JobAssignment | null;
  template: JobTemplate | null;
  settings: AgentSettingsResponse | null;
}): FlowDraft {
  const draft = createDefaultDraft();
  const { member, assignment, template, settings } = params;
  const templateFlow = readOperatorFlow(template?.metadata);
  const assignmentFlow = readOperatorFlow(assignment?.metadata);

  draft.mode = "existing";
  draft.presetId =
    templateFlow.presetId === "vip-email" || templateFlow.presetId === "slack-mentions"
      ? templateFlow.presetId
      : assignmentFlow.presetId === "vip-email" || assignmentFlow.presetId === "slack-mentions"
        ? assignmentFlow.presetId
        : "";
  draft.existingAgentId = member?.id ?? assignment?.agentId ?? "";
  draft.existingAssignmentId = assignment?.id ?? "";
  draft.identity.displayName = member?.name ?? draft.existingAgentId;
  draft.identity.agentId = member?.id ?? assignment?.agentId ?? "";
  draft.identity.role = member?.role ?? "";
  draft.identity.team = member?.team ?? "";
  draft.purpose.workerTitle =
    (typeof templateFlow.workerTitle === "string" && templateFlow.workerTitle) ||
    assignment?.title ||
    template?.name ||
    "";
  draft.purpose.mission =
    (typeof templateFlow.mission === "string" && templateFlow.mission) ||
    template?.description ||
    "";
  draft.purpose.systems = (typeof templateFlow.systems === "string" && templateFlow.systems) || "";
  draft.inputs.sourceKind =
    assignmentFlow.sourceKind === "event" ||
    assignmentFlow.sourceKind === "hybrid" ||
    assignmentFlow.sourceKind === "schedule"
      ? assignmentFlow.sourceKind
      : Array.isArray(assignment?.metadata?.eventTriggers) &&
          assignment.metadata.eventTriggers.length > 0
        ? "hybrid"
        : "schedule";
  draft.inputs.sourceLabel =
    (typeof assignmentFlow.sourceLabel === "string" && assignmentFlow.sourceLabel) ||
    (typeof templateFlow.sourceLabel === "string" && templateFlow.sourceLabel) ||
    "";
  draft.inputs.cadenceMinutes = String(assignment?.cadenceMinutes ?? 5);
  draft.inputs.eventTriggers = Array.isArray(assignment?.metadata?.eventTriggers)
    ? assignment.metadata.eventTriggers.join(", ")
    : "";
  draft.inputs.drainUntilClear =
    typeof assignmentFlow.drainUntilClear === "boolean"
      ? assignmentFlow.drainUntilClear
      : typeof templateFlow.drainUntilClear === "boolean"
        ? templateFlow.drainUntilClear
        : true;
  draft.hubspot = {
    ...createDefaultDraft().hubspot,
    ...readHubSpotScope(templateFlow),
    ...readHubSpotScope(assignmentFlow),
  };
  const connectorSelections = [
    ...readConnectorSelections(template?.metadata),
    ...readConnectorSelections(assignment?.metadata),
  ];
  const connectorRuntimeToolNames = new Set(
    connectorSelections.flatMap((entry) =>
      entry.selectedCommands.map((commandId) => connectorActionToolName(entry.tool, commandId)),
    ),
  );
  draft.tools.selected = mergeUniqueTools([template?.toolsAllow, settings?.tools?.allow]).filter(
    (toolName) => !connectorRuntimeToolNames.has(toolName),
  );
  draft.tools.missing = mergeUniqueTools([
    Array.isArray(templateFlow.missingCapabilities)
      ? templateFlow.missingCapabilities.filter((item): item is string => typeof item === "string")
      : undefined,
    Array.isArray(assignmentFlow.missingCapabilities)
      ? assignmentFlow.missingCapabilities.filter(
          (item): item is string => typeof item === "string",
        )
      : undefined,
  ]).join("\n");
  draft.connectors.selected = Array.from(
    new Set(connectorSelections.map((entry) => entry.tool).filter(Boolean)),
  );
  draft.connectors.selectedActions = Array.from(
    new Set(
      connectorSelections.flatMap((entry) =>
        entry.selectedCommands.map((commandId) => qualifyConnectorAction(entry.tool, commandId)),
      ),
    ),
  );
  draft.rules.operatingInstructions =
    (typeof templateFlow.operatingInstructions === "string" &&
      templateFlow.operatingInstructions) ||
    template?.rolePrompt ||
    "";
  draft.rules.successDefinition = template?.successDefinition ?? "";
  draft.rules.scopeLimit = assignment?.scopeLimit ?? "";
  draft.rules.blockedResponse =
    (typeof templateFlow.blockedResponse === "string" && templateFlow.blockedResponse) || "";
  draft.rules.escalationTarget =
    (typeof templateFlow.escalationTarget === "string" && templateFlow.escalationTarget) ||
    (typeof assignmentFlow.escalationTarget === "string" && assignmentFlow.escalationTarget) ||
    "";
  draft.rules.escalationRules =
    (typeof templateFlow.escalationRules === "string" && templateFlow.escalationRules) || "";
  draft.launch.deploymentStage =
    assignment?.deploymentStage ?? template?.defaultStage ?? "simulate";
  draft.launch.state = assignment?.enabled
    ? settings?.executionWorker?.enabled === false
      ? "stop"
      : "play"
    : settings?.executionWorker?.enabled === false
      ? "stop"
      : "pause";
  return draft;
}

function sectionTitle(title: string, detail: string) {
  return (
    <div className="mb-5">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="text-sm text-white/55 mt-1">{detail}</p>
    </div>
  );
}

function cardButtonClasses(active: boolean) {
  return active
    ? "border-cyan-400/60 bg-cyan-500/10 text-white shadow-[0_0_0_1px_rgba(34,211,238,0.35)]"
    : "border-white/10 bg-white/[0.03] text-white/70 hover:border-white/20 hover:bg-white/[0.06]";
}

export function WorkerFlowModal({
  isOpen,
  onClose,
  gatewayRequest,
  onOpenAdvanced,
  onOpenSystems,
}: WorkerFlowModalProps) {
  const [step, setStep] = useState<FlowStep>("worker");
  const [draft, setDraft] = useState<FlowDraft>(createDefaultDraft);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [assignments, setAssignments] = useState<JobAssignment[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [toolCatalog, setToolCatalog] = useState<CapabilityToolEntry[]>([]);
  const [connectorCatalog, setConnectorCatalog] = useState<ConnectorCatalogEntry[]>([]);
  const [settingsByAgentId, setSettingsByAgentId] = useState<
    Record<string, AgentSettingsResponse | null>
  >({});

  const currentStepIndex = FLOW_STEPS.findIndex((item) => item.id === step);
  const selectedAgentId =
    draft.mode === "existing" ? draft.existingAgentId : draft.identity.agentId;
  const selectedAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.agentId === draft.existingAgentId),
    [assignments, draft.existingAgentId],
  );
  const selectedAssignment = useMemo(() => {
    if (draft.mode !== "existing") return null;
    if (draft.existingAssignmentId) {
      return assignments.find((assignment) => assignment.id === draft.existingAssignmentId) ?? null;
    }
    return getPrimaryAssignment(assignments, draft.existingAgentId);
  }, [assignments, draft.existingAgentId, draft.existingAssignmentId, draft.mode]);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedAssignment?.templateId) ?? null,
    [selectedAssignment?.templateId, templates],
  );
  const filteredTools = useMemo(() => {
    const query = draft.tools.search.trim().toLowerCase();
    if (!query) return toolCatalog;
    return toolCatalog.filter((tool) => {
      const haystack = `${tool.name} ${tool.label ?? ""} ${tool.description ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [draft.tools.search, toolCatalog]);
  const filteredConnectors = useMemo(() => {
    const query = draft.connectors.search.trim().toLowerCase();
    if (!query) return connectorCatalog;
    return connectorCatalog.filter((connector) => {
      const haystack = [
        connector.tool,
        connector.label,
        connector.description ?? "",
        connector.category ?? "",
        connector.categories.join(" "),
        connector.resources.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [connectorCatalog, draft.connectors.search]);
  const selectedConnectorEntries = useMemo(
    () =>
      connectorCatalog.filter((connector) => draft.connectors.selected.includes(connector.tool)),
    [connectorCatalog, draft.connectors.selected],
  );
  const vipGoogleConnector = useMemo(
    () => connectorCatalog.find((connector) => connector.tool === "aos-google") ?? null,
    [connectorCatalog],
  );
  const isVipEmailPreset = draft.presetId === "vip-email";
  const vipGoogleReady = vipGoogleConnector?.installState === "ready";
  const selectedConnectorActions = useMemo(
    () =>
      draft.connectors.selectedActions
        .map((value) => splitQualifiedConnectorAction(value))
        .filter((value): value is { tool: string; commandId: string } => Boolean(value)),
    [draft.connectors.selectedActions],
  );
  const hubSpotScopeBlocker = useMemo(
    () => getHubSpotScopeBlocker(draft),
    [
      draft.connectors.selected,
      draft.hubspot.portalId,
      draft.hubspot.pipelines,
      draft.hubspot.owners,
      draft.hubspot.teams,
      draft.hubspot.queues,
    ],
  );
  const playBlockedReasons = useMemo(() => {
    const reasons: string[] = [];
    if (hubSpotScopeBlocker) {
      reasons.push(hubSpotScopeBlocker);
    }
    return reasons;
  }, [hubSpotScopeBlocker]);
  const recentRuns = useMemo(
    () =>
      runs
        .filter((run) => run.agentId === selectedAgentId)
        .sort((left, right) => right.startedAt - left.startedAt)
        .slice(0, 6),
    [runs, selectedAgentId],
  );
  const recentEvents = useMemo(
    () =>
      events
        .filter((event) => event.targetAgentId === selectedAgentId)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 8),
    [events, selectedAgentId],
  );

  const loadSettings = useCallback(async (agentId: string) => {
    if (!agentId.trim()) return null;
    try {
      const response = await fetchLocalApi(
        `/api/settings/agent?agentId=${encodeURIComponent(agentId)}`,
        {},
        8000,
      );
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as AgentSettingsResponse;
      setSettingsByAgentId((prev) => ({ ...prev, [agentId]: payload }));
      return payload;
    } catch {
      return null;
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const agentsPayload = await gatewayRequest<{
        defaultId?: string;
        agents?: Array<{ id?: string; name?: string }>;
      }>("agents.list");
      const resolvedDefaultAgentId =
        (typeof agentsPayload?.defaultId === "string" && agentsPayload.defaultId.trim()) || "main";
      const [
        familyPayload,
        templatesPayload,
        assignmentsPayload,
        runsPayload,
        eventsPayload,
        toolsPayload,
        connectorsPayload,
      ] = await Promise.all([
        gatewayRequest<{ members?: FamilyMember[] }>("family.members"),
        gatewayRequest<{ templates?: JobTemplate[] }>("jobs.templates.list"),
        gatewayRequest<{ assignments?: JobAssignment[] }>("jobs.assignments.list"),
        gatewayRequest<{ runs?: JobRun[] }>("jobs.runs.list", { limit: 80 }),
        gatewayRequest<{ events?: JobEvent[] }>("jobs.events.list", { limit: 120 }),
        gatewayRequest<{ tools?: CapabilityToolEntry[] }>("tools.status", {
          agentId: resolvedDefaultAgentId,
        }),
        gatewayRequest<{ connectors?: ConnectorCatalogEntry[] }>("connectors.catalog").catch(
          () => ({
            connectors: [],
          }),
        ),
      ]);

      setFamilyMembers(Array.isArray(familyPayload?.members) ? familyPayload.members : []);
      setTemplates(Array.isArray(templatesPayload?.templates) ? templatesPayload.templates : []);
      setAssignments(
        Array.isArray(assignmentsPayload?.assignments) ? assignmentsPayload.assignments : [],
      );
      setRuns(Array.isArray(runsPayload?.runs) ? runsPayload.runs : []);
      setEvents(Array.isArray(eventsPayload?.events) ? eventsPayload.events : []);
      setToolCatalog(
        Array.isArray(toolsPayload?.tools)
          ? toolsPayload.tools.filter((tool) => tool.source !== "connector")
          : [],
      );
      setConnectorCatalog(
        Array.isArray(connectorsPayload?.connectors) ? connectorsPayload.connectors : [],
      );
    } catch (error) {
      setMessage({
        type: "error",
        text: `Failed to load worker flow data: ${error instanceof Error ? error.message : "request failed"}`,
      });
    } finally {
      setLoading(false);
    }
  }, [gatewayRequest]);

  useEffect(() => {
    if (!isOpen) return;
    setStep("worker");
    setDraft(createDefaultDraft());
    setSettingsByAgentId({});
    void loadData();
  }, [isOpen, loadData]);

  useEffect(() => {
    if (!isOpen || draft.mode !== "existing" || !draft.existingAgentId) return;
    const member = familyMembers.find((item) => item.id === draft.existingAgentId) ?? null;
    const assignment = draft.existingAssignmentId
      ? (assignments.find((item) => item.id === draft.existingAssignmentId) ?? null)
      : getPrimaryAssignment(assignments, draft.existingAgentId);
    const template = templates.find((item) => item.id === assignment?.templateId) ?? null;

    void (async () => {
      const settings =
        settingsByAgentId[draft.existingAgentId] ?? (await loadSettings(draft.existingAgentId));
      setDraft((current) => {
        if (current.mode !== "existing" || current.existingAgentId !== draft.existingAgentId) {
          return current;
        }
        const hydrated = hydrateDraftFromExisting({
          member,
          assignment,
          template,
          settings,
        });
        hydrated.existingAgentId = draft.existingAgentId;
        hydrated.existingAssignmentId = assignment?.id ?? "";
        hydrated.mode = "existing";
        return hydrated;
      });
    })();
  }, [
    assignments,
    draft.existingAgentId,
    draft.existingAssignmentId,
    draft.mode,
    familyMembers,
    isOpen,
    loadSettings,
    settingsByAgentId,
    templates,
  ]);

  const setDraftField = useCallback((updater: (current: FlowDraft) => FlowDraft) => {
    setDraft((current) => updater(current));
    setMessage(null);
  }, []);

  const toggleTool = useCallback(
    (toolName: string) => {
      setDraftField((current) => {
        const selected = current.tools.selected.includes(toolName)
          ? current.tools.selected.filter((item) => item !== toolName)
          : [...current.tools.selected, toolName].sort((a, b) => a.localeCompare(b));
        return {
          ...current,
          tools: {
            ...current.tools,
            selected,
          },
        };
      });
    },
    [setDraftField],
  );

  const toggleConnector = useCallback(
    (tool: string) => {
      setDraftField((current) => {
        const selected = current.connectors.selected.includes(tool)
          ? current.connectors.selected.filter((item) => item !== tool)
          : [...current.connectors.selected, tool].sort((a, b) => a.localeCompare(b));
        const selectedActions = current.connectors.selectedActions.filter((value) => {
          const parsed = splitQualifiedConnectorAction(value);
          return parsed?.tool !== tool;
        });
        return {
          ...current,
          connectors: {
            ...current.connectors,
            selected,
            selectedActions,
          },
        };
      });
    },
    [setDraftField],
  );

  const toggleConnectorAction = useCallback(
    (tool: string, commandId: string) => {
      const qualified = qualifyConnectorAction(tool, commandId);
      setDraftField((current) => {
        const exists = current.connectors.selectedActions.includes(qualified);
        return {
          ...current,
          connectors: {
            ...current.connectors,
            selected: current.connectors.selected.includes(tool)
              ? current.connectors.selected
              : [...current.connectors.selected, tool].sort((a, b) => a.localeCompare(b)),
            selectedActions: exists
              ? current.connectors.selectedActions.filter((value) => value !== qualified)
              : [...current.connectors.selectedActions, qualified].sort((a, b) =>
                  a.localeCompare(b),
                ),
          },
        };
      });
    },
    [setDraftField],
  );

  const goNext = useCallback(() => {
    if (currentStepIndex < FLOW_STEPS.length - 1) {
      setStep(FLOW_STEPS[currentStepIndex + 1]!.id);
    }
  }, [currentStepIndex]);

  const goBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setStep(FLOW_STEPS[currentStepIndex - 1]!.id);
    }
  }, [currentStepIndex]);

  const validateCurrentDraft = useCallback((): string | null => {
    if (!draft.identity.displayName.trim()) return "Worker name is required.";
    if (!draft.identity.agentId.trim()) return "Worker id is required.";
    if (!draft.identity.role.trim()) return "Worker role is required.";
    if (!draft.purpose.workerTitle.trim()) return "Worker title is required.";
    if (!draft.purpose.mission.trim()) return "Mission is required.";
    const cadence = Number.parseInt(draft.inputs.cadenceMinutes, 10);
    if (draft.inputs.sourceKind !== "event" && (!Number.isFinite(cadence) || cadence <= 0)) {
      return "Cadence must be a positive number of minutes.";
    }
    if (!draft.rules.successDefinition.trim()) return "Success definition is required.";
    if (draft.launch.state === "play" && playBlockedReasons.length > 0) {
      return playBlockedReasons[0] ?? "The worker cannot launch yet.";
    }
    return null;
  }, [draft, playBlockedReasons]);

  const saveFlow = useCallback(async () => {
    const validationError = validateCurrentDraft();
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      return;
    }

    const workerId = slugifyAgentId(draft.identity.agentId);
    const cadenceMinutes = Math.max(1, Number.parseInt(draft.inputs.cadenceMinutes, 10) || 5);
    const selectedManualTools = draft.tools.selected.map((item) => item.trim()).filter(Boolean);
    const connectorSelections = buildConnectorSelections(draft, connectorCatalog);
    const selectedConnectorToolNames = buildRunnableConnectorToolNames(
      connectorSelections,
      connectorCatalog,
    );
    const selectedTools = mergeUniqueTools([selectedManualTools, selectedConnectorToolNames]);
    const unresolvedConnectorActions = connectorSelections.flatMap((selection) => {
      const connector = connectorCatalog.find((entry) => entry.tool === selection.tool);
      if (connector?.discovery?.binaryPath) {
        return [];
      }
      return selection.selectedCommands.map((commandId) => `${selection.tool}:${commandId}`);
    });
    const templateMetadata = buildTemplateMetadata(draft);
    const assignmentMetadata = buildAssignmentMetadata(draft);
    const templateFlow =
      templateMetadata.operatorFlow &&
      typeof templateMetadata.operatorFlow === "object" &&
      !Array.isArray(templateMetadata.operatorFlow)
        ? (templateMetadata.operatorFlow as Record<string, unknown>)
        : null;
    if (templateFlow) {
      templateFlow.connectors = connectorSelections;
    }
    const assignmentFlow =
      assignmentMetadata.operatorFlow &&
      typeof assignmentMetadata.operatorFlow === "object" &&
      !Array.isArray(assignmentMetadata.operatorFlow)
        ? (assignmentMetadata.operatorFlow as Record<string, unknown>)
        : null;
    if (assignmentFlow) {
      assignmentFlow.connectors = connectorSelections;
    }
    const assignmentEnabled = draft.launch.state === "play";
    const persona = buildPersona(draft);
    const description = [draft.purpose.mission.trim(), draft.inputs.sourceLabel.trim()]
      .filter(Boolean)
      .join(" | ");
    const rolePrompt = buildRolePrompt(draft);

    setSaving(true);
    setMessage(null);
    try {
      await gatewayRequest("family.register", {
        id: workerId,
        name: draft.identity.displayName.trim(),
        role: draft.identity.role.trim(),
        team: draft.identity.team.trim() || undefined,
        persona,
        tools: selectedTools,
      });

      let templateId = selectedTemplate?.id ?? "";
      if (templateId) {
        await gatewayRequest("jobs.templates.update", {
          templateId,
          name: draft.purpose.workerTitle.trim(),
          departmentId: draft.identity.team.trim() || null,
          description: description || null,
          rolePrompt,
          successDefinition: draft.rules.successDefinition.trim(),
          toolsAllow: selectedTools,
          defaultStage: draft.launch.deploymentStage,
          defaultMode:
            draft.launch.deploymentStage === "live" ||
            draft.launch.deploymentStage === "limited-live"
              ? "live"
              : "simulate",
          metadata: templateMetadata,
        });
      } else {
        const templateResponse = await gatewayRequest<{ template?: { id?: string } }>(
          "jobs.templates.create",
          {
            name: draft.purpose.workerTitle.trim(),
            departmentId: draft.identity.team.trim() || undefined,
            description: description || undefined,
            rolePrompt,
            successDefinition: draft.rules.successDefinition.trim(),
            toolsAllow: selectedTools,
            defaultStage: draft.launch.deploymentStage,
            defaultMode:
              draft.launch.deploymentStage === "live" ||
              draft.launch.deploymentStage === "limited-live"
                ? "live"
                : "simulate",
          },
        );
        templateId = templateResponse?.template?.id ?? "";
        if (!templateId) {
          throw new Error("Failed to create worker template.");
        }
        await gatewayRequest("jobs.templates.update", {
          templateId,
          metadata: templateMetadata,
        });
      }

      let assignmentId = selectedAssignment?.id ?? "";
      if (assignmentId) {
        await gatewayRequest("jobs.assignments.update", {
          assignmentId,
          title: draft.purpose.workerTitle.trim(),
          enabled: assignmentEnabled,
          cadenceMinutes,
          executionMode:
            draft.launch.deploymentStage === "live" ||
            draft.launch.deploymentStage === "limited-live"
              ? "live"
              : "simulate",
          deploymentStage: draft.launch.deploymentStage,
          scopeLimit: draft.rules.scopeLimit.trim() || undefined,
          nextRunAt: assignmentEnabled ? Date.now() : null,
          metadata: assignmentMetadata,
        });
      } else {
        const assignmentResponse = await gatewayRequest<{ assignment?: { id?: string } }>(
          "jobs.assignments.create",
          {
            templateId,
            agentId: workerId,
            title: draft.purpose.workerTitle.trim(),
            enabled: assignmentEnabled,
            cadenceMinutes,
            executionMode:
              draft.launch.deploymentStage === "live" ||
              draft.launch.deploymentStage === "limited-live"
                ? "live"
                : "simulate",
            deploymentStage: draft.launch.deploymentStage,
            scopeLimit: draft.rules.scopeLimit.trim() || undefined,
            nextRunAt: assignmentEnabled ? Date.now() : undefined,
            metadata: assignmentMetadata,
          },
        );
        assignmentId = assignmentResponse?.assignment?.id ?? "";
        if (!assignmentId) {
          throw new Error("Failed to create worker assignment.");
        }
      }

      const patchResponse = await fetchLocalApi(
        `/api/settings/agent?agentId=${encodeURIComponent(workerId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            executionWorker: {
              enabled: draft.launch.state !== "stop",
              every: intervalFromMinutes(draft.inputs.cadenceMinutes),
            },
            tools: {
              allow: selectedTools,
            },
          }),
        },
        10_000,
      );
      if (!patchResponse.ok) {
        throw new Error(`Failed to update runtime settings (HTTP ${patchResponse.status})`);
      }

      if (draft.launch.state === "play") {
        await gatewayRequest("execution.worker.resume", { agentId: workerId }).catch(() => null);
        await gatewayRequest("jobs.assignments.runNow", { assignmentId });
      } else if (draft.launch.state === "pause") {
        await gatewayRequest("execution.worker.pause", { agentId: workerId }).catch(() => null);
      } else {
        await gatewayRequest("execution.worker.pause", { agentId: workerId }).catch(() => null);
      }

      await loadData();
      await loadSettings(workerId);
      setDraft((current) => ({
        ...current,
        mode: "existing",
        existingAgentId: workerId,
        existingAssignmentId: assignmentId,
        identity: {
          ...current.identity,
          agentId: workerId,
        },
      }));
      setMessage({
        type: "success",
        text: [
          draft.launch.state === "play"
            ? `Worker "${draft.identity.displayName.trim()}" is configured and running.`
            : draft.launch.state === "pause"
              ? `Worker "${draft.identity.displayName.trim()}" is configured and paused.`
              : `Worker "${draft.identity.displayName.trim()}" is configured and stopped.`,
          unresolvedConnectorActions.length > 0
            ? `${unresolvedConnectorActions.length} connector action${unresolvedConnectorActions.length === 1 ? "" : "s"} remain cataloged only because their adapter is not runnable yet.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
      setStep("launch");
    } catch (error) {
      setMessage({
        type: "error",
        text: `Failed to save worker flow: ${error instanceof Error ? error.message : "request failed"}`,
      });
    } finally {
      setSaving(false);
    }
  }, [
    draft,
    gatewayRequest,
    loadData,
    loadSettings,
    connectorCatalog,
    selectedAssignment?.id,
    selectedTemplate?.id,
    validateCurrentDraft,
  ]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 18, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.99 }}
            className="w-[1180px] max-w-[96vw] h-[88vh] rounded-3xl border border-white/10 bg-[#0b1020] shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-full min-h-0">
              <div className="w-[250px] border-r border-white/10 bg-white/[0.03] px-5 py-6 flex flex-col gap-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-cyan-300/75">
                      Worker Flow
                    </div>
                    <h2 className="text-xl font-semibold text-white mt-2">
                      Build a worker the operator way
                    </h2>
                    <p className="text-sm text-white/55 mt-2">
                      Define the role, what it watches, what it can do, and how it escalates.
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-white/60 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-2">
                  {FLOW_STEPS.map((item, index) => {
                    const Icon = item.icon;
                    const active = item.id === step;
                    const completed = index < currentStepIndex;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setStep(item.id)}
                        className={`w-full rounded-2xl border px-3 py-3 text-left transition ${cardButtonClasses(active)}`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                              active
                                ? "bg-cyan-400/15 text-cyan-200"
                                : completed
                                  ? "bg-emerald-400/15 text-emerald-200"
                                  : "bg-white/5 text-white/45"
                            }`}
                          >
                            {completed ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : (
                              <Icon className="h-4 w-4" />
                            )}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{item.label}</div>
                            <div className="text-xs text-white/45">Step {index + 1}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-auto rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.06] p-4 text-sm text-white/65">
                  <div className="font-medium text-white mb-2">What this replaces</div>
                  <p>
                    This flow writes the worker, assignment, tools, and launch state in one save.
                    The old workforce board stays available as Advanced inspection.
                  </p>
                </div>
              </div>

              <div className="flex-1 min-w-0 flex flex-col">
                <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm text-white/45">Primary operator path</div>
                    <div className="text-lg font-semibold text-white">
                      {FLOW_STEPS[currentStepIndex]?.label}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {onOpenAdvanced ? (
                      <button
                        onClick={onOpenAdvanced}
                        className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/70 hover:text-white"
                      >
                        Open Advanced
                      </button>
                    ) : null}
                    <button
                      onClick={() => void loadData()}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/70 hover:text-white"
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
                  {message ? (
                    <div
                      className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${
                        message.type === "success"
                          ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                          : "border-rose-400/25 bg-rose-500/10 text-rose-100"
                      }`}
                    >
                      {message.text}
                    </div>
                  ) : null}

                  {loading ? (
                    <div className="h-full min-h-[300px] flex items-center justify-center text-white/60 gap-3">
                      <RefreshCw className="h-5 w-5 animate-spin" /> Loading worker flow...
                    </div>
                  ) : (
                    <div className="grid grid-cols-12 gap-6">
                      <div className="col-span-8 min-w-0">
                        {step === "worker" ? (
                          <div>
                            {sectionTitle(
                              "Define the worker",
                              "Choose whether you are creating a new worker or loading an existing one to adjust its role, workload, and launch state.",
                            )}
                            <div className="grid grid-cols-2 gap-3 mb-6">
                              <button
                                onClick={() =>
                                  setDraftField((current) => ({
                                    ...createDefaultDraft(),
                                    mode: "new",
                                    presetId: "",
                                    identity: {
                                      ...createDefaultDraft().identity,
                                      displayName: current.identity.displayName,
                                      agentId: current.identity.agentId,
                                      role: current.identity.role,
                                      team: current.identity.team,
                                    },
                                  }))
                                }
                                className={`rounded-2xl border p-4 text-left transition ${cardButtonClasses(
                                  draft.mode === "new",
                                )}`}
                              >
                                <div className="text-base font-medium text-white">
                                  Create new worker
                                </div>
                                <div className="text-sm text-white/50 mt-2">
                                  Start from scratch and save the worker, workload, tools, and
                                  launch state together.
                                </div>
                              </button>
                              <button
                                onClick={() =>
                                  setDraftField((current) => ({
                                    ...current,
                                    mode: "existing",
                                    existingAgentId:
                                      current.existingAgentId || familyMembers[0]?.id || "",
                                  }))
                                }
                                className={`rounded-2xl border p-4 text-left transition ${cardButtonClasses(
                                  draft.mode === "existing",
                                )}`}
                              >
                                <div className="text-base font-medium text-white">
                                  Edit existing worker
                                </div>
                                <div className="text-sm text-white/50 mt-2">
                                  Load an existing worker, then adjust its job, tools, cadence, and
                                  escalation policy.
                                </div>
                              </button>
                            </div>

                            {draft.mode === "existing" ? (
                              <div className="space-y-4 mb-6">
                                <label className="block">
                                  <span className="text-sm text-white/60">Worker</span>
                                  <select
                                    value={draft.existingAgentId}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        existingAgentId: event.target.value,
                                        existingAssignmentId: "",
                                      }))
                                    }
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                  >
                                    <option value="">Select a worker</option>
                                    {familyMembers.map((member) => (
                                      <option key={member.id} value={member.id}>
                                        {member.name} ({member.id})
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                {selectedAssignments.length > 1 ? (
                                  <label className="block">
                                    <span className="text-sm text-white/60">Workload</span>
                                    <select
                                      value={
                                        draft.existingAssignmentId ||
                                        selectedAssignments[0]?.id ||
                                        ""
                                      }
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          existingAssignmentId: event.target.value,
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      {selectedAssignments.map((assignment) => (
                                        <option key={assignment.id} value={assignment.id}>
                                          {assignment.title}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                              </div>
                            ) : null}

                            {draft.mode === "new" ? (
                              <div className="mb-6">
                                <div className="flex items-center gap-2 mb-3 text-sm font-medium text-white">
                                  <Wand2 className="h-4 w-4 text-cyan-200" />
                                  Start from a proven worker pattern
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  {WORKER_PRESETS.map((preset) => {
                                    const selected = draft.presetId === preset.id;
                                    return (
                                      <button
                                        key={preset.id}
                                        onClick={() =>
                                          setDraft(
                                            buildPresetDraft({
                                              presetId: preset.id,
                                              connectorCatalog,
                                            }),
                                          )
                                        }
                                        className={`rounded-2xl border p-4 text-left transition ${cardButtonClasses(selected)}`}
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <div className="text-base font-medium text-white">
                                              {preset.label}
                                            </div>
                                            <div className="text-sm text-white/50 mt-2">
                                              {preset.detail}
                                            </div>
                                          </div>
                                          <Wand2 className="h-4 w-4 text-cyan-200/80" />
                                        </div>
                                        <div className="mt-3 text-xs text-white/45">
                                          {preset.systemsNote}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}

                            <div className="grid grid-cols-2 gap-4">
                              <label className="block">
                                <span className="text-sm text-white/60">Worker name</span>
                                <input
                                  value={draft.identity.displayName}
                                  onChange={(event) =>
                                    setDraftField((current) => ({
                                      ...current,
                                      identity: {
                                        ...current.identity,
                                        displayName: event.target.value,
                                      },
                                    }))
                                  }
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                  placeholder="Customer Service Inbox"
                                />
                              </label>
                              <label className="block">
                                <span className="text-sm text-white/60">Worker id</span>
                                <input
                                  value={draft.identity.agentId}
                                  onChange={(event) =>
                                    setDraftField((current) => ({
                                      ...current,
                                      identity: {
                                        ...current.identity,
                                        agentId: slugifyAgentId(event.target.value),
                                      },
                                    }))
                                  }
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                  placeholder="customer-service-inbox"
                                />
                              </label>
                              <label className="block">
                                <span className="text-sm text-white/60">Role</span>
                                <input
                                  value={draft.identity.role}
                                  onChange={(event) =>
                                    setDraftField((current) => ({
                                      ...current,
                                      identity: { ...current.identity, role: event.target.value },
                                    }))
                                  }
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                  placeholder="Support Specialist"
                                />
                              </label>
                              <label className="block">
                                <span className="text-sm text-white/60">Team or lane</span>
                                <input
                                  value={draft.identity.team}
                                  onChange={(event) =>
                                    setDraftField((current) => ({
                                      ...current,
                                      identity: { ...current.identity, team: event.target.value },
                                    }))
                                  }
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                  placeholder="Support"
                                />
                              </label>
                            </div>

                            <div className="grid grid-cols-1 gap-4 mt-4">
                              <label className="block">
                                <span className="text-sm text-white/60">Worker title</span>
                                <input
                                  value={draft.purpose.workerTitle}
                                  onChange={(event) =>
                                    setDraftField((current) => ({
                                      ...current,
                                      purpose: {
                                        ...current.purpose,
                                        workerTitle: event.target.value,
                                      },
                                    }))
                                  }
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                  placeholder="Support Inbox Monitor"
                                />
                              </label>
                              <label className="block">
                                <span className="text-sm text-white/60">Mission</span>
                                <textarea
                                  value={draft.purpose.mission}
                                  onChange={(event) =>
                                    setDraftField((current) => ({
                                      ...current,
                                      purpose: { ...current.purpose, mission: event.target.value },
                                    }))
                                  }
                                  rows={4}
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                  placeholder="Monitor the support queue, resolve issues that are within approved scope, and escalate anything blocked or higher-risk."
                                />
                              </label>
                              <label className="block">
                                <span className="text-sm text-white/60">Systems in scope</span>
                                <textarea
                                  value={draft.purpose.systems}
                                  onChange={(event) =>
                                    setDraftField((current) => ({
                                      ...current,
                                      purpose: { ...current.purpose, systems: event.target.value },
                                    }))
                                  }
                                  rows={3}
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                  placeholder="Atera, Huntress, XYZ account portal, support mailbox"
                                />
                              </label>
                            </div>
                          </div>
                        ) : null}

                        {step === "triggers" ? (
                          <div>
                            {sectionTitle(
                              "Choose the input pattern",
                              "This is where you tell the worker what it watches, how often it wakes, and whether it should keep draining the queue until clear.",
                            )}
                            <div className="grid grid-cols-3 gap-3 mb-6">
                              {[
                                {
                                  id: "schedule",
                                  label: "Scheduled",
                                  detail: "Checks on a fixed cadence.",
                                },
                                {
                                  id: "event",
                                  label: "Event-driven",
                                  detail: "Runs when named events arrive.",
                                },
                                {
                                  id: "hybrid",
                                  label: "Hybrid",
                                  detail: "Scheduled checks plus event wakeups.",
                                },
                              ].map((option) => (
                                <button
                                  key={option.id}
                                  onClick={() =>
                                    setDraftField((current) => ({
                                      ...current,
                                      inputs: {
                                        ...current.inputs,
                                        sourceKind: option.id as FlowDraft["inputs"]["sourceKind"],
                                      },
                                    }))
                                  }
                                  className={`rounded-2xl border p-4 text-left transition ${cardButtonClasses(
                                    draft.inputs.sourceKind === option.id,
                                  )}`}
                                >
                                  <div className="font-medium text-white">{option.label}</div>
                                  <div className="text-sm text-white/50 mt-2">{option.detail}</div>
                                </button>
                              ))}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <label className="block">
                                <span className="text-sm text-white/60">
                                  Source or workload label
                                </span>
                                <input
                                  value={draft.inputs.sourceLabel}
                                  onChange={(event) =>
                                    setDraftField((current) => ({
                                      ...current,
                                      inputs: {
                                        ...current.inputs,
                                        sourceLabel: event.target.value,
                                      },
                                    }))
                                  }
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                  placeholder="support@company.com, Atera ticket queue, Huntress alerts"
                                />
                              </label>
                              <label className="block">
                                <span className="text-sm text-white/60">Cadence in minutes</span>
                                <input
                                  value={draft.inputs.cadenceMinutes}
                                  onChange={(event) =>
                                    setDraftField((current) => ({
                                      ...current,
                                      inputs: {
                                        ...current.inputs,
                                        cadenceMinutes: event.target.value,
                                      },
                                    }))
                                  }
                                  disabled={draft.inputs.sourceKind === "event"}
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none disabled:opacity-40"
                                  placeholder="5"
                                />
                              </label>
                            </div>

                            <label className="block mt-4">
                              <span className="text-sm text-white/60">Event triggers</span>
                              <textarea
                                value={draft.inputs.eventTriggers}
                                onChange={(event) =>
                                  setDraftField((current) => ({
                                    ...current,
                                    inputs: {
                                      ...current.inputs,
                                      eventTriggers: event.target.value,
                                    },
                                  }))
                                }
                                rows={3}
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                placeholder="email:new, atera:ticket:new, huntress:alert:new"
                              />
                            </label>

                            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                              <input
                                type="checkbox"
                                checked={draft.inputs.drainUntilClear}
                                onChange={(event) =>
                                  setDraftField((current) => ({
                                    ...current,
                                    inputs: {
                                      ...current.inputs,
                                      drainUntilClear: event.target.checked,
                                    },
                                  }))
                                }
                                className="mt-1"
                              />
                              <div>
                                <div className="text-sm font-medium text-white">
                                  Drain until clear
                                </div>
                                <div className="text-sm text-white/50 mt-1">
                                  Keep working through all matching items in the queue during a run
                                  instead of handling one item and waiting for the next interval.
                                </div>
                              </div>
                            </label>
                          </div>
                        ) : null}

                        {step === "tools" ? (
                          <div>
                            {sectionTitle(
                              "Choose connectors and tools",
                              "Connectors define the systems this worker depends on. Raw tool grants define the runtime surface Argent can actually call today.",
                            )}
                            <div className="rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.06] px-4 py-4 mb-4 text-sm text-white/70">
                              Connector selections are operator-facing system requirements. They
                              show what needs to be installed and configured for this worker. Raw
                              tools below are still the live runtime grants until connector-backed
                              execution is bridged in.
                            </div>
                            {isVipEmailPreset ? (
                              vipGoogleConnector ? (
                                vipGoogleReady ? (
                                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-4 mb-4 text-sm text-emerald-100">
                                    <div className="font-medium">
                                      Google Workspace is ready for the VIP Email Watcher.
                                    </div>
                                    <div className="mt-1 text-emerald-100/80">
                                      Connector status is{" "}
                                      <span className="font-medium">
                                        {vipGoogleConnector.status.label}
                                      </span>
                                      . Select the Gmail actions you want below, then launch the
                                      worker.
                                    </div>
                                  </div>
                                ) : (
                                  <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-4 mb-4 text-sm text-amber-100">
                                    <div className="font-medium">
                                      Google Workspace still needs setup before this worker can rely
                                      on the connector path.
                                    </div>
                                    <div className="mt-1 text-amber-100/80">
                                      Current status:{" "}
                                      {vipGoogleConnector.status.detail ||
                                        vipGoogleConnector.installState}
                                      . Finish setup in{" "}
                                      <span className="font-medium">
                                        Config -&gt; Systems -&gt; aos-google
                                      </span>
                                      , then return here.
                                    </div>
                                    <div className="mt-2 text-amber-100/70">
                                      The preset can still keep the native{" "}
                                      <code className="text-amber-50">vip_email</code> tool
                                      selected, but Google connector execution will not be ready
                                      until the connector turns green.
                                    </div>
                                    {onOpenSystems ? (
                                      <div className="mt-3">
                                        <button
                                          onClick={onOpenSystems}
                                          className="rounded-xl border border-amber-300/20 bg-black/20 px-3 py-2 text-sm text-amber-50 hover:bg-black/30"
                                        >
                                          Open Systems Setup
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                )
                              ) : (
                                <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-4 mb-4 text-sm text-amber-100">
                                  <div className="font-medium">
                                    aos-google is not discovered yet.
                                  </div>
                                  <div className="mt-1 text-amber-100/80">
                                    This preset expects the Google Workspace connector. Add or
                                    repair <span className="font-medium">aos-google</span> in{" "}
                                    <span className="font-medium">Config -&gt; Systems</span> before
                                    depending on connector-backed Gmail actions.
                                  </div>
                                  {onOpenSystems ? (
                                    <div className="mt-3">
                                      <button
                                        onClick={onOpenSystems}
                                        className="rounded-xl border border-amber-300/20 bg-black/20 px-3 py-2 text-sm text-amber-50 hover:bg-black/30"
                                      >
                                        Open Systems Setup
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              )
                            ) : null}

                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 flex items-center gap-3 mb-4">
                              <Search className="h-4 w-4 text-white/45" />
                              <input
                                value={draft.connectors.search}
                                onChange={(event) =>
                                  setDraftField((current) => ({
                                    ...current,
                                    connectors: {
                                      ...current.connectors,
                                      search: event.target.value,
                                    },
                                  }))
                                }
                                className="flex-1 bg-transparent text-white outline-none"
                                placeholder="Search connectors"
                              />
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 max-h-[260px] overflow-y-auto mb-4">
                              <div className="flex items-center justify-between gap-3 mb-3">
                                <div className="text-sm font-medium text-white">
                                  Connector catalog
                                </div>
                                <div className="text-xs text-white/40">
                                  {connectorCatalog.length > 0
                                    ? `${connectorCatalog.length} discovered`
                                    : "No connectors discovered"}
                                </div>
                              </div>
                              {filteredConnectors.length > 0 ? (
                                <div className="grid grid-cols-2 gap-3">
                                  {filteredConnectors.map((connector) => {
                                    const selected = draft.connectors.selected.includes(
                                      connector.tool,
                                    );
                                    return (
                                      <button
                                        key={connector.tool}
                                        onClick={() => toggleConnector(connector.tool)}
                                        className={`rounded-2xl border p-4 text-left transition ${cardButtonClasses(selected)}`}
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <div className="font-medium text-white">
                                              {connector.label}
                                            </div>
                                            <div className="text-xs text-white/45 mt-1 font-mono">
                                              {connector.tool}
                                            </div>
                                          </div>
                                          <span
                                            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                                              connector.installState === "ready"
                                                ? "bg-emerald-500/15 text-emerald-100"
                                                : connector.installState === "needs-setup"
                                                  ? "bg-amber-500/15 text-amber-100"
                                                  : connector.installState === "repo-only"
                                                    ? "bg-white/10 text-white/70"
                                                    : "bg-rose-500/15 text-rose-100"
                                            }`}
                                          >
                                            {connector.status.label}
                                          </span>
                                        </div>
                                        {connector.description ? (
                                          <div className="text-sm text-white/50 mt-2">
                                            {connector.description}
                                          </div>
                                        ) : null}
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          {(connector.categories.length > 0
                                            ? connector.categories
                                            : connector.category
                                              ? [connector.category]
                                              : ["general"]
                                          ).map((category) => (
                                            <span
                                              key={`${connector.tool}-${category}`}
                                              className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/60"
                                            >
                                              {category}
                                            </span>
                                          ))}
                                        </div>
                                        {connector.status.detail ? (
                                          <div className="text-xs text-white/40 mt-3">
                                            {connector.status.detail}
                                          </div>
                                        ) : null}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-sm text-white/45">
                                  No connectors matched this search. If the system you need is
                                  missing entirely, capture it in the backlog below.
                                </div>
                              )}
                            </div>

                            {selectedConnectorEntries.length > 0 ? (
                              <div className="space-y-4 mb-4">
                                {selectedConnectorEntries.map((connector) => (
                                  <div
                                    key={`connector-actions-${connector.tool}`}
                                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                                  >
                                    <div className="flex items-center justify-between gap-3 mb-3">
                                      <div>
                                        <div className="text-sm font-medium text-white">
                                          {connector.label}
                                        </div>
                                        <div className="text-xs text-white/45 font-mono">
                                          {connector.tool}
                                        </div>
                                      </div>
                                      <div className="text-xs text-white/45">
                                        {connector.commands.length} action
                                        {connector.commands.length === 1 ? "" : "s"}
                                      </div>
                                    </div>
                                    {connector.commands.length > 0 ? (
                                      <div className="grid grid-cols-2 gap-3">
                                        {connector.commands.map((command) => {
                                          const qualified = qualifyConnectorAction(
                                            connector.tool,
                                            command.id,
                                          );
                                          const selected =
                                            draft.connectors.selectedActions.includes(qualified);
                                          return (
                                            <label
                                              key={qualified}
                                              className={`rounded-xl border px-3 py-3 text-sm transition ${
                                                selected
                                                  ? "border-cyan-400/35 bg-cyan-500/10 text-white"
                                                  : "border-white/8 bg-black/20 text-white/70"
                                              }`}
                                            >
                                              <div className="flex items-start gap-3">
                                                <input
                                                  type="checkbox"
                                                  checked={selected}
                                                  onChange={() =>
                                                    toggleConnectorAction(
                                                      connector.tool,
                                                      command.id,
                                                    )
                                                  }
                                                  className="mt-1"
                                                />
                                                <div>
                                                  <div className="font-medium text-white">
                                                    {command.summary || command.id}
                                                  </div>
                                                  <div className="text-xs text-white/45 mt-1 font-mono">
                                                    {command.id}
                                                  </div>
                                                  <div className="text-xs text-white/40 mt-1">
                                                    {command.requiredMode || "readonly"}
                                                    {command.resource
                                                      ? ` · ${command.resource}`
                                                      : ""}
                                                    {command.actionClass
                                                      ? ` · ${command.actionClass}`
                                                      : ""}
                                                  </div>
                                                </div>
                                              </div>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <div className="text-sm text-white/45">
                                        This connector was discovered, but it did not expose command
                                        metadata yet.
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-4">
                              <div className="text-sm font-medium text-white mb-2">
                                Selected connectors
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {selectedConnectorEntries.length > 0 ? (
                                  selectedConnectorEntries.map((connector) => (
                                    <span
                                      key={connector.tool}
                                      className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100"
                                    >
                                      {connector.label} · {connector.installState}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-sm text-white/45">
                                    No connectors selected yet.
                                  </span>
                                )}
                              </div>
                            </div>

                            {draft.connectors.selected.includes("aos-hubspot") ? (
                              <div className="rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      HubSpot scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Keep the scope structured so the worker knows exactly which
                                      portal and operational slice it may touch.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
                                    {describeHubSpotScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">
                                      Portal or account id
                                    </span>
                                    <input
                                      value={draft.hubspot.portalId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          hubspot: {
                                            ...current.hubspot,
                                            portalId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="HubSpot portal 123456 or account name"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Queues</span>
                                    <input
                                      value={draft.hubspot.queues}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          hubspot: {
                                            ...current.hubspot,
                                            queues: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Prospecting, Customer Success, Billing"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Pipelines</span>
                                    <textarea
                                      value={draft.hubspot.pipelines}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          hubspot: {
                                            ...current.hubspot,
                                            pipelines: event.target.value,
                                          },
                                        }))
                                      }
                                      rows={3}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Lifecycle, Deal stage, Support ticket"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Owners</span>
                                    <textarea
                                      value={draft.hubspot.owners}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          hubspot: {
                                            ...current.hubspot,
                                            owners: event.target.value,
                                          },
                                        }))
                                      }
                                      rows={3}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Jason, Support Manager, SDR Team"
                                    />
                                  </label>
                                </div>
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Teams</span>
                                  <textarea
                                    value={draft.hubspot.teams}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        hubspot: { ...current.hubspot, teams: event.target.value },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Revenue ops, Customer success, Sales ops"
                                  />
                                </label>
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.hubspot.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        hubspot: { ...current.hubspot, notes: event.target.value },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this only to clarify the structured scope above. It should not be the only scope control."
                                  />
                                </label>
                              </div>
                            ) : null}

                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 flex items-center gap-3 mb-4">
                              <Search className="h-4 w-4 text-white/45" />
                              <input
                                value={draft.tools.search}
                                onChange={(event) =>
                                  setDraftField((current) => ({
                                    ...current,
                                    tools: { ...current.tools, search: event.target.value },
                                  }))
                                }
                                className="flex-1 bg-transparent text-white outline-none"
                                placeholder="Search tools"
                              />
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 max-h-[340px] overflow-y-auto">
                              <div className="grid grid-cols-2 gap-3">
                                {filteredTools.map((tool) => {
                                  const selected = draft.tools.selected.includes(tool.name);
                                  return (
                                    <button
                                      key={tool.name}
                                      onClick={() => toggleTool(tool.name)}
                                      className={`rounded-2xl border p-4 text-left transition ${cardButtonClasses(selected)}`}
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="font-medium text-white">
                                          {tool.label || tool.name}
                                        </div>
                                        <span className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                                          {tool.source}
                                        </span>
                                      </div>
                                      <div className="text-xs text-white/45 mt-2 font-mono">
                                        {tool.name}
                                      </div>
                                      {tool.description ? (
                                        <div className="text-sm text-white/50 mt-2">
                                          {tool.description}
                                        </div>
                                      ) : null}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                              <div className="text-sm font-medium text-white mb-2">
                                Selected tools
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {draft.tools.selected.length > 0 ? (
                                  draft.tools.selected.map((tool) => (
                                    <span
                                      key={tool}
                                      className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100"
                                    >
                                      {tool}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-sm text-white/45">
                                    No tools selected yet.
                                  </span>
                                )}
                              </div>
                            </div>

                            <label className="block mt-4">
                              <span className="text-sm text-white/60">
                                Missing capabilities or tools we still need to build
                              </span>
                              <textarea
                                value={draft.tools.missing}
                                onChange={(event) =>
                                  setDraftField((current) => ({
                                    ...current,
                                    tools: { ...current.tools, missing: event.target.value },
                                  }))
                                }
                                rows={4}
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                placeholder="hootsuite.post.publish\nquickbooks.invoice.create\nreset-xyz-password"
                              />
                            </label>
                          </div>
                        ) : null}

                        {step === "rules" ? (
                          <div>
                            {sectionTitle(
                              "Define expectations and escalation",
                              "Tell the worker how it should operate, what success looks like, and what it must do when it cannot safely finish the job.",
                            )}
                            <div className="space-y-4">
                              <label className="block">
                                <span className="text-sm text-white/60">
                                  Operating instructions
                                </span>
                                <textarea
                                  value={draft.rules.operatingInstructions}
                                  onChange={(event) =>
                                    setDraftField((current) => ({
                                      ...current,
                                      rules: {
                                        ...current.rules,
                                        operatingInstructions: event.target.value,
                                      },
                                    }))
                                  }
                                  rows={6}
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                  placeholder="Review every new item. Use the approved tools to resolve what you can. Do not guess. Keep the customer updated."
                                />
                              </label>
                              <label className="block">
                                <span className="text-sm text-white/60">Definition of done</span>
                                <textarea
                                  value={draft.rules.successDefinition}
                                  onChange={(event) =>
                                    setDraftField((current) => ({
                                      ...current,
                                      rules: {
                                        ...current.rules,
                                        successDefinition: event.target.value,
                                      },
                                    }))
                                  }
                                  rows={3}
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                  placeholder="Every new item is either resolved, responded to, or escalated with clear context and a tracked handoff."
                                />
                              </label>
                              <div className="grid grid-cols-2 gap-4">
                                <label className="block">
                                  <span className="text-sm text-white/60">Scope limit</span>
                                  <textarea
                                    value={draft.rules.scopeLimit}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        rules: { ...current.rules, scopeLimit: event.target.value },
                                      }))
                                    }
                                    rows={4}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Can respond to customer questions, review logs, and reset passwords in XYZ. Cannot change billing, firewall policy, or delete data."
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-sm text-white/60">Blocked response</span>
                                  <textarea
                                    value={draft.rules.blockedResponse}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        rules: {
                                          ...current.rules,
                                          blockedResponse: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={4}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Reply to the end user that the issue is being escalated, summarize what was attempted, and open a handoff for Tier 2."
                                  />
                                </label>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <label className="block">
                                  <span className="text-sm text-white/60">Escalation target</span>
                                  <input
                                    value={draft.rules.escalationTarget}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        rules: {
                                          ...current.rules,
                                          escalationTarget: event.target.value,
                                        },
                                      }))
                                    }
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Tier 2 human, Security analyst, Jason"
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-sm text-white/60">Escalation rules</span>
                                  <textarea
                                    value={draft.rules.escalationRules}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        rules: {
                                          ...current.rules,
                                          escalationRules: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={4}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Escalate on security risk, permission failures, high-sentiment customers, unknown root cause, or after two failed attempts."
                                  />
                                </label>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {step === "launch" ? (
                          <div>
                            {sectionTitle(
                              "Launch and inspect",
                              "Choose whether the worker should start running now, stay paused, or be fully stopped. The workload audit stays visible here so you can see what this worker has been doing.",
                            )}
                            <div className="grid grid-cols-3 gap-3 mb-5">
                              {[
                                {
                                  id: "play",
                                  label: "Play",
                                  detail: "Enable triggers and dispatch the worker now.",
                                  icon: Play,
                                },
                                {
                                  id: "pause",
                                  label: "Pause",
                                  detail:
                                    "Keep the definition, but hold execution until you resume.",
                                  icon: CirclePause,
                                },
                                {
                                  id: "stop",
                                  label: "Stop",
                                  detail: "Disable the workload and turn the worker off.",
                                  icon: Power,
                                },
                              ].map((option) => {
                                const Icon = option.icon;
                                return (
                                  <button
                                    key={option.id}
                                    onClick={() =>
                                      setDraftField((current) => ({
                                        ...current,
                                        launch: {
                                          ...current.launch,
                                          state: option.id as FlowDraft["launch"]["state"],
                                        },
                                      }))
                                    }
                                    className={`rounded-2xl border p-4 text-left transition ${cardButtonClasses(
                                      draft.launch.state === option.id,
                                    )}`}
                                  >
                                    <div className="flex items-center gap-3">
                                      <Icon className="h-4 w-4 text-cyan-200" />
                                      <div className="font-medium text-white">{option.label}</div>
                                    </div>
                                    <div className="text-sm text-white/50 mt-3">
                                      {option.detail}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>

                            <label className="block mb-6">
                              <span className="text-sm text-white/60">Deployment stage</span>
                              <select
                                value={draft.launch.deploymentStage}
                                onChange={(event) =>
                                  setDraftField((current) => ({
                                    ...current,
                                    launch: {
                                      ...current.launch,
                                      deploymentStage: event.target
                                        .value as FlowDraft["launch"]["deploymentStage"],
                                    },
                                  }))
                                }
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                              >
                                <option value="simulate">Simulate</option>
                                <option value="shadow">Shadow</option>
                                <option value="limited-live">Limited live</option>
                                <option value="live">Live</option>
                              </select>
                            </label>

                            <div className="grid grid-cols-2 gap-4 mb-6">
                              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="text-sm font-medium text-white mb-3">
                                  Saved behavior summary
                                </div>
                                <div className="space-y-2 text-sm text-white/60">
                                  <div>
                                    <span className="text-white/45">Worker:</span>{" "}
                                    {draft.identity.displayName || "Not set"}
                                  </div>
                                  <div>
                                    <span className="text-white/45">Role:</span>{" "}
                                    {draft.identity.role || "Not set"}
                                  </div>
                                  <div>
                                    <span className="text-white/45">Source:</span>{" "}
                                    {draft.inputs.sourceLabel || "Not set"}
                                  </div>
                                  <div>
                                    <span className="text-white/45">Cadence:</span>{" "}
                                    {draft.inputs.sourceKind === "event"
                                      ? "Event-driven"
                                      : `${draft.inputs.cadenceMinutes || "5"} minutes`}
                                  </div>
                                  <div>
                                    <span className="text-white/45">Queue behavior:</span>{" "}
                                    {draft.inputs.drainUntilClear
                                      ? "Drain until clear"
                                      : "One item per cycle"}
                                  </div>
                                  <div>
                                    <span className="text-white/45">Connectors:</span>{" "}
                                    {draft.connectors.selected.length}
                                  </div>
                                  {draft.connectors.selected.includes("aos-hubspot") ? (
                                    <div>
                                      <span className="text-white/45">HubSpot scope:</span>{" "}
                                      {describeHubSpotScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  <div>
                                    <span className="text-white/45">Missing capabilities:</span>{" "}
                                    {parseDelimitedList(draft.tools.missing).length || 0}
                                  </div>
                                </div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="text-sm font-medium text-white mb-3">
                                  Audit preview
                                </div>
                                {selectedAgentId ? (
                                  <div className="space-y-2 text-sm text-white/60">
                                    <div>
                                      <span className="text-white/45">Recent runs:</span>{" "}
                                      {recentRuns.length}
                                    </div>
                                    <div>
                                      <span className="text-white/45">Recent events:</span>{" "}
                                      {recentEvents.length}
                                    </div>
                                    <div>
                                      <span className="text-white/45">Last run:</span>{" "}
                                      {recentRuns[0]
                                        ? formatDateTime(recentRuns[0].startedAt)
                                        : "No runs yet"}
                                    </div>
                                    <div>
                                      <span className="text-white/45">Current assignment:</span>{" "}
                                      {selectedAssignment?.title || "No assignment yet"}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-sm text-white/45">
                                    Save the worker to start collecting runtime audit history.
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 max-h-[230px] overflow-y-auto">
                                <div className="text-sm font-medium text-white mb-3">
                                  Recent runs
                                </div>
                                <div className="space-y-2">
                                  {recentRuns.length > 0 ? (
                                    recentRuns.map((run) => (
                                      <div
                                        key={run.id}
                                        className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-sm"
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <span className="text-white">{run.status}</span>
                                          <span className="text-white/40">
                                            {formatDateTime(run.startedAt)}
                                          </span>
                                        </div>
                                        <div className="text-white/45 mt-1 text-xs">
                                          {run.deploymentStage || "simulate"}
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="text-sm text-white/45">
                                      No runs recorded yet.
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 max-h-[230px] overflow-y-auto">
                                <div className="text-sm font-medium text-white mb-3">
                                  Recent events
                                </div>
                                <div className="space-y-2">
                                  {recentEvents.length > 0 ? (
                                    recentEvents.map((event) => (
                                      <div
                                        key={event.id}
                                        className="rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-sm"
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <span className="text-white">{event.eventType}</span>
                                          <span className="text-white/40">
                                            {formatDateTime(event.createdAt)}
                                          </span>
                                        </div>
                                        <div className="text-white/45 mt-1 text-xs">
                                          {event.source}
                                          {event.outcome ? ` · ${event.outcome}` : ""}
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="text-sm text-white/45">
                                      No events recorded yet.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="col-span-4 min-w-0 space-y-4">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <Wand2 className="h-4 w-4 text-cyan-200" />
                            <div className="text-sm font-medium text-white">Operator checklist</div>
                          </div>
                          <ul className="space-y-2 text-sm text-white/60">
                            <li className="flex gap-2">
                              <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-300" />
                              Role and worker identity defined
                            </li>
                            <li className="flex gap-2">
                              <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-300" />
                              Triggers and cadence defined in operator terms
                            </li>
                            <li className="flex gap-2">
                              <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-300" />
                              Connector requirements selected and raw tool grants chosen
                            </li>
                            <li className="flex gap-2">
                              <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-300" />
                              Escalation policy and blocked response written down
                            </li>
                          </ul>
                        </div>

                        {parseDelimitedList(draft.tools.missing).length > 0 ? (
                          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
                            <div className="flex items-center gap-2 text-amber-100 font-medium mb-2">
                              <AlertTriangle className="h-4 w-4" /> Missing tools to build
                            </div>
                            <div className="space-y-2 text-sm text-amber-100/80">
                              {parseDelimitedList(draft.tools.missing).map((item) => (
                                <div
                                  key={item}
                                  className="rounded-xl border border-amber-300/10 bg-black/15 px-3 py-2"
                                >
                                  {item}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {selectedConnectorEntries.some(
                          (connector) => connector.installState !== "ready",
                        ) ? (
                          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
                            <div className="flex items-center gap-2 text-amber-100 font-medium mb-2">
                              <AlertTriangle className="h-4 w-4" /> Connectors needing setup
                            </div>
                            <div className="space-y-2 text-sm text-amber-100/80">
                              {selectedConnectorEntries
                                .filter((connector) => connector.installState !== "ready")
                                .map((connector) => (
                                  <div
                                    key={`setup-${connector.tool}`}
                                    className="rounded-xl border border-amber-300/10 bg-black/15 px-3 py-2"
                                  >
                                    <div className="font-medium text-amber-50">
                                      {connector.label}
                                    </div>
                                    <div className="text-xs text-amber-100/70 mt-1">
                                      {connector.status.detail || connector.installState}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        ) : null}
                        {isVipEmailPreset && vipGoogleConnector ? (
                          vipGoogleReady ? (
                            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4">
                              <div className="flex items-center gap-2 text-emerald-100 font-medium mb-2">
                                <CheckCircle2 className="h-4 w-4" /> VIP Email Watcher readiness
                              </div>
                              <div className="text-sm text-emerald-100/80">
                                Google Workspace is ready. This worker can use the connector-backed
                                Gmail path once you press <span className="font-medium">Play</span>.
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
                              <div className="flex items-center gap-2 text-amber-100 font-medium mb-2">
                                <AlertTriangle className="h-4 w-4" /> VIP Email Watcher readiness
                              </div>
                              <div className="text-sm text-amber-100/80">
                                Google Workspace is not ready yet. Finish{" "}
                                <span className="font-medium">aos-google</span> setup in{" "}
                                <span className="font-medium">Config -&gt; Systems</span> before
                                expecting connector-backed Gmail actions from this worker.
                              </div>
                              {onOpenSystems ? (
                                <div className="mt-3">
                                  <button
                                    onClick={onOpenSystems}
                                    className="rounded-xl border border-amber-300/20 bg-black/20 px-3 py-2 text-sm text-amber-50 hover:bg-black/30"
                                  >
                                    Open Systems Setup
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          )
                        ) : null}

                        {draft.launch.state === "play" && playBlockedReasons.length > 0 ? (
                          <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4">
                            <div className="flex items-center gap-2 text-rose-100 font-medium mb-2">
                              <AlertTriangle className="h-4 w-4" /> Launch blocked
                            </div>
                            <div className="space-y-2 text-sm text-rose-100/80">
                              {playBlockedReasons.map((reason) => (
                                <div
                                  key={reason}
                                  className="rounded-xl border border-rose-300/10 bg-black/15 px-3 py-2"
                                >
                                  {reason}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                          <div className="text-sm font-medium text-white mb-3">
                            Current runtime intent
                          </div>
                          <div className="space-y-2 text-sm text-white/60">
                            <div>
                              <span className="text-white/45">Launch:</span> {draft.launch.state}
                            </div>
                            <div>
                              <span className="text-white/45">Stage:</span>{" "}
                              {draft.launch.deploymentStage}
                            </div>
                            <div>
                              <span className="text-white/45">Runtime interval:</span>{" "}
                              {intervalFromMinutes(draft.inputs.cadenceMinutes)}
                            </div>
                            <div>
                              <span className="text-white/45">Connectors selected:</span>{" "}
                              {draft.connectors.selected.length}
                            </div>
                            {draft.connectors.selected.includes("aos-hubspot") ? (
                              <div>
                                <span className="text-white/45">HubSpot scope:</span>{" "}
                                {describeHubSpotScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            <div>
                              <span className="text-white/45">Connector actions:</span>{" "}
                              {selectedConnectorActions.length}
                            </div>
                            <div>
                              <span className="text-white/45">Tools selected:</span>{" "}
                              {draft.tools.selected.length}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-white/10 px-6 py-4 flex items-center justify-between gap-4">
                  <button
                    onClick={goBack}
                    disabled={currentStepIndex === 0 || saving}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/70 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={onClose}
                      disabled={saving}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/70 disabled:opacity-40"
                    >
                      Close
                    </button>
                    {currentStepIndex < FLOW_STEPS.length - 1 ? (
                      <button
                        onClick={goNext}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-40"
                      >
                        Next <ChevronRight className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => void saveFlow()}
                        disabled={
                          saving || (draft.launch.state === "play" && playBlockedReasons.length > 0)
                        }
                        className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-40"
                      >
                        {saving ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                        Save worker flow
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
