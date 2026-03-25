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
import { runConnectorPreview, type ConnectorPreviewResponse } from "../lib/connectorPreview";
import {
  fetchConnectorSetupStatus,
  launchConnectorSetupAction,
  runConnectorSetupCheck,
  type ConnectorSetupStatus,
} from "../lib/connectorSetup";
import { fetchLocalApi } from "../utils/localApiFetch";
import { ConnectorSetupCard } from "./ConnectorSetupCard";

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

type ConnectorPickerOption = {
  value: string;
  label: string;
  subtitle?: string;
  kind?: string;
  mention?: string;
  scopePreview?: string;
  url?: string;
  selected?: boolean;
};

type GooglePickerState = {
  accountOptions: ConnectorPickerOption[];
  gmailMessageOptions: ConnectorPickerOption[];
  gmailLabelOptions: ConnectorPickerOption[];
  driveOptions: ConnectorPickerOption[];
  calendarOptions: ConnectorPickerOption[];
  calendarScopeOptions: ConnectorPickerOption[];
  preview?: string;
};

type SlackPickerState = {
  workspace: ConnectorPickerOption | null;
  channelOptions: ConnectorPickerOption[];
  peopleOptions: ConnectorPickerOption[];
  preview?: string;
};

type M365PickerState = {
  mailbox: ConnectorPickerOption | null;
  driveOptions: ConnectorPickerOption[];
  calendarOptions: ConnectorPickerOption[];
  teamMessageOptions: ConnectorPickerOption[];
  teamScopeOptions: ConnectorPickerOption[];
  workbookScopeOptions: ConnectorPickerOption[];
  configuredTeamScope?: {
    teamId?: string;
    channelId?: string;
  };
  configuredWorkbookScope?: {
    targetUser?: string;
    itemId?: string;
    worksheet?: string;
    range?: string;
  };
  preview?: string;
};

type HubSpotPickerState = {
  portalOptions: ConnectorPickerOption[];
  portalPreview?: string;
  preview?: string;
  pipelineOptions: ConnectorPickerOption[];
  ownerOptions: ConnectorPickerOption[];
  teamOptions: ConnectorPickerOption[];
  queueOptions: ConnectorPickerOption[];
  crmInsights: ConnectorPreviewInsight[];
};

type QuickBooksPickerState = {
  companyOptions: ConnectorPickerOption[];
  company: ConnectorPickerOption | null;
  accountOptions: ConnectorPickerOption[];
  dateWindowOptions: ConnectorPickerOption[];
  preview?: string;
  previewInsights: ConnectorPreviewInsight[];
};

type MailchimpPickerState = {
  account: ConnectorPickerOption | null;
  audienceOptions: ConnectorPickerOption[];
  campaignOptions: ConnectorPickerOption[];
  memberOptions: ConnectorPickerOption[];
  preview?: string;
};

type KlaviyoPickerState = {
  account: ConnectorPickerOption | null;
  listOptions: ConnectorPickerOption[];
  profileOptions: ConnectorPickerOption[];
  campaignOptions: ConnectorPickerOption[];
  preview?: string;
};

type BufferPickerState = {
  account: ConnectorPickerOption | null;
  channelOptions: ConnectorPickerOption[];
  profileOptions: ConnectorPickerOption[];
  preview?: string;
};

type HootsuitePickerState = {
  member: ConnectorPickerOption | null;
  organizationOptions: ConnectorPickerOption[];
  socialProfileOptions: ConnectorPickerOption[];
  teamOptions: ConnectorPickerOption[];
  messageOptions: ConnectorPickerOption[];
  preview?: string;
};

type ElevenLabsPickerState = {
  account: ConnectorPickerOption | null;
  voiceOptions: ConnectorPickerOption[];
  modelOptions: ConnectorPickerOption[];
  historyOptions: ConnectorPickerOption[];
  preview?: string;
};

type N8NPickerState = {
  workflowOptions: ConnectorPickerOption[];
  preview?: string;
  triggerBuilder: TriggerBuilderRecord | null;
};

type ZapierPickerState = {
  zapOptions: ConnectorPickerOption[];
  preview?: string;
  triggerBuilder: TriggerBuilderRecord | null;
};

type ShopifyPickerState = {
  store: {
    name?: string;
    domain?: string;
    primaryDomain?: string;
    owner?: string;
    currency?: string;
    timezone?: string;
  } | null;
  productOptions: ConnectorPickerOption[];
  orderOptions: ConnectorPickerOption[];
  customerOptions: ConnectorPickerOption[];
};

type AirtablePickerState = {
  baseOptions: ConnectorPickerOption[];
  tableOptions: ConnectorPickerOption[];
  preview?: string;
};

type StripePickerState = {
  account: ConnectorPickerOption | null;
  customerOptions: ConnectorPickerOption[];
};

type NotionPickerState = {
  databaseOptions: ConnectorPickerOption[];
  pageOptions: ConnectorPickerOption[];
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
  google: {
    account: string;
    gmailSenders: string;
    gmailQuery: string;
    gmailLabels: string;
    driveRoots: string;
    calendarScopes: string;
    notes: string;
  };
  slack: {
    workspace: string;
    channels: string;
    mentionTargets: string;
    keywordTriggers: string;
    notes: string;
  };
  m365: {
    tenant: string;
    mailboxes: string;
    calendarScopes: string;
    driveScopes: string;
    workbookScopes: string;
    teamsScopes: string;
    notes: string;
  };
  hubspot: {
    portalId: string;
    pipelines: string;
    owners: string;
    teams: string;
    queues: string;
    notes: string;
  };
  mailchimp: {
    serverPrefix: string;
    audienceId: string;
    campaignId: string;
    memberEmail: string;
    notes: string;
  };
  klaviyo: {
    account: string;
    listId: string;
    profileId: string;
    profileEmail: string;
    campaignId: string;
    notes: string;
  };
  buffer: {
    account: string;
    channelId: string;
    profileId: string;
    postId: string;
    postText: string;
    notes: string;
  };
  hootsuite: {
    member: string;
    organizationId: string;
    socialProfileId: string;
    teamId: string;
    messageId: string;
    notes: string;
  };
  elevenlabs: {
    voiceId: string;
    modelId: string;
    historyItemId: string;
    notes: string;
  };
  quickbooks: {
    companyRealm: string;
    accountCues: string;
    dateWindow: string;
    notes: string;
  };
  n8n: {
    workspaceName: string;
    workflowId: string;
    workflowName: string;
    workflowStatus: string;
    triggerEvent: string;
    triggerPayload: string;
    notes: string;
  };
  zapier: {
    workspaceName: string;
    zapId: string;
    zapName: string;
    zapStatus: string;
    triggerEvent: string;
    triggerPayload: string;
    notes: string;
  };
  shopify: {
    shopDomain: string;
    productId: string;
    productStatus: string;
    orderId: string;
    orderStatus: string;
    customerEmail: string;
    createdAfter: string;
    createdBefore: string;
    notes: string;
  };
  airtable: {
    baseId: string;
    tableName: string;
    workspaceId: string;
    notes: string;
  };
  stripe: {
    connectedAccount: string;
    customerFocus: string;
    invoiceStatus: string;
    createdAfter: string;
    createdBefore: string;
    notes: string;
  };
  notion: {
    databaseId: string;
    pageId: string;
    searchQuery: string;
    notes: string;
  };
  wordpress: {
    siteBaseUrl: string;
    postType: string;
    status: string;
    sectionTaxonomyCues: string;
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
  onOpenApiKeys?: () => void;
  onOpenSystems?: () => void;
};

type SourceReadiness = {
  ok: boolean;
  summary: string;
  detail: string;
  blockers: string[];
};

type SelectedConnectorReadiness = {
  tool: string;
  label: string;
  installState: ConnectorCatalogEntry["installState"];
  statusLabel: string;
  detail: string;
  selectedCommandIds: string[];
  blocking: boolean;
};

type ConnectorRuntimeDefaultValue = string | number | boolean;

type ConnectorRuntimeCommandDefaults = {
  positional?: string[];
  args?: string[];
  options?: Record<string, ConnectorRuntimeDefaultValue>;
  globalOptions?: Record<string, ConnectorRuntimeDefaultValue>;
  env?: Record<string, string>;
};

type ConnectorPreviewInsight = {
  title: string;
  detail: string;
};

type TriggerBuilderRecord = Record<string, unknown>;

type TriggerPayloadBuildResult = {
  args?: string[];
  error?: string;
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

function firstMeaningfulValue(values: string[]): string | undefined {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function parseQuickBooksDateWindow(
  value: string,
): { date_from: string; date_to: string } | undefined {
  const raw = value.trim();
  if (!raw) {
    return undefined;
  }
  const patterns = [/^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|to|through|until|-)\s*(\d{4}-\d{2}-\d{2})$/i];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1] && match?.[2]) {
      return { date_from: match[1], date_to: match[2] };
    }
  }
  return undefined;
}

function buildCommandDefaults(
  entries: Record<string, ConnectorRuntimeCommandDefaults | undefined>,
): Record<string, ConnectorRuntimeCommandDefaults> | undefined {
  const normalized = Object.entries(entries).filter(
    (entry): entry is [string, ConnectorRuntimeCommandDefaults] => Boolean(entry[1]),
  );
  if (normalized.length === 0) {
    return undefined;
  }
  return Object.fromEntries(normalized);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePickerOption(value: unknown): ConnectorPickerOption | null {
  const typed = asRecord(value);
  if (!typed) {
    return null;
  }
  const normalizedValue = asString(typed.value) || asString(typed.id);
  const label = asString(typed.label) || normalizedValue;
  if (!normalizedValue || !label) {
    return null;
  }
  return {
    value: normalizedValue,
    label,
    subtitle: asString(typed.subtitle) || undefined,
    kind: asString(typed.kind) || asString(typed.resource) || undefined,
    mention: asString(typed.mention) || undefined,
    scopePreview: asString(typed.scope_preview) || undefined,
    url: asString(typed.url) || undefined,
    selected: typed.selected === true,
  };
}

function readPickerOptions(value: unknown): ConnectorPickerOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizePickerOption(entry))
    .filter((entry): entry is ConnectorPickerOption => Boolean(entry));
}

function readPickerOptionsFromField(value: unknown, field: string): ConnectorPickerOption[] {
  const typed = asRecord(value);
  if (!typed) {
    return [];
  }
  return readPickerOptions(typed[field]);
}

function readScopePreviewRecord(value: unknown): Record<string, unknown> | null {
  const typed = asRecord(value);
  if (!typed) {
    return null;
  }
  return asRecord(typed.scope_preview) ?? asRecord(asRecord(typed.scope)?.preview);
}

function readScopePreviewOptions(value: unknown): ConnectorPickerOption[] {
  const typed = asRecord(value);
  const preview = readScopePreviewRecord(value);
  if (!preview) {
    return typed ? readPickerOptions(typed.scope_candidates) : [];
  }
  const picker = asRecord(preview.picker);
  const nestedPickerOptions = readPickerOptions(picker?.items);
  if (nestedPickerOptions.length > 0) {
    return nestedPickerOptions;
  }
  const candidateOptions = readPickerOptions(preview.candidates);
  if (candidateOptions.length > 0) {
    return candidateOptions;
  }
  const previewScopeCandidates = readPickerOptions(preview.scope_candidates);
  if (previewScopeCandidates.length > 0) {
    return previewScopeCandidates;
  }
  const topLevelScopeCandidates = typed ? readPickerOptions(typed.scope_candidates) : [];
  if (topLevelScopeCandidates.length > 0) {
    return topLevelScopeCandidates;
  }
  const previewOption = normalizePickerOption(preview.preview);
  return previewOption ? [previewOption] : [];
}

function mergePickerOptions(...groups: ConnectorPickerOption[][]): ConnectorPickerOption[] {
  const merged: ConnectorPickerOption[] = [];
  const index = new Map<string, number>();
  for (const group of groups) {
    for (const option of group) {
      const key = `${option.kind || ""}:${option.value}`;
      const existingIndex = index.get(key);
      if (existingIndex === undefined) {
        index.set(key, merged.length);
        merged.push(option);
        continue;
      }
      const existing = merged[existingIndex]!;
      merged[existingIndex] = {
        ...existing,
        ...option,
        subtitle: existing.subtitle || option.subtitle,
        mention: existing.mention || option.mention,
        scopePreview: existing.scopePreview || option.scopePreview,
        url: existing.url || option.url,
        selected: existing.selected || option.selected,
      };
    }
  }
  return merged;
}

function filterPickerOptionsByKind(
  options: ConnectorPickerOption[],
  ...kinds: string[]
): ConnectorPickerOption[] {
  if (kinds.length === 0) {
    return options;
  }
  const normalizedKinds = new Set(kinds.map((kind) => kind.trim().toLowerCase()).filter(Boolean));
  return options.filter((option) =>
    option.kind ? normalizedKinds.has(option.kind.trim().toLowerCase()) : false,
  );
}

function readScopeCandidateOptions(value: unknown): ConnectorPickerOption[] {
  const typed = asRecord(value);
  const preview = readScopePreviewRecord(value);
  return mergePickerOptions(
    preview ? readPickerOptions(preview.scope_candidates) : [],
    typed ? readPickerOptions(typed.scope_candidates) : [],
  );
}

function readScopePreviewText(value: unknown): string | undefined {
  const typed = asRecord(value);
  if (!typed) {
    return undefined;
  }
  if (typeof typed.scope_preview === "string" && typed.scope_preview.trim()) {
    return typed.scope_preview.trim();
  }
  const previewSummary = asString(typed.preview_summary);
  if (previewSummary) {
    return previewSummary;
  }
  const summary = asString(typed.summary);
  if (summary) {
    return summary;
  }
  const preview = readScopePreviewRecord(value);
  if (!preview) {
    return undefined;
  }
  return (
    firstMeaningfulValue([
      asString(preview.preview),
      asString(preview.label),
      asString(preview.surface),
      asString(preview.kind),
    ]) ?? undefined
  );
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function formatTriggerPayloadText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  const record = asRecord(value);
  if (!record) {
    return "";
  }
  try {
    return JSON.stringify(record, null, 2);
  } catch {
    return "";
  }
}

function stringifyTriggerPayloadValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildTriggerPayloadArgs(
  raw: string,
  options: {
    allowJsonPassthrough: boolean;
  },
): TriggerPayloadBuildResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const payloadRecord = asRecord(parsed);
      if (!payloadRecord) {
        return {
          error: "Trigger payload JSON must decode to an object.",
        };
      }
      if (options.allowJsonPassthrough) {
        return {
          args: ["--payload-json", JSON.stringify(payloadRecord)],
        };
      }
      const args = Object.entries(payloadRecord).flatMap(([key, value]) => [
        "--payload",
        `${key}=${stringifyTriggerPayloadValue(value)}`,
      ]);
      return {
        args,
      };
    } catch {
      return {
        error: "Trigger payload JSON must decode to an object.",
      };
    }
  }
  const parts = trimmed.includes("\n")
    ? trimmed
        .split(/\n+/)
        .map((part) => part.trim())
        .filter(Boolean)
    : trimmed
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
  const args: string[] = [];
  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      return {
        error: "Trigger payload lines must use key=value pairs or a JSON object.",
      };
    }
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!key) {
      return {
        error: "Trigger payload lines must use key=value pairs or a JSON object.",
      };
    }
    args.push("--payload", `${key}=${value}`);
  }
  return {
    args,
  };
}

function readTriggerBuilderRecord(value: unknown): TriggerBuilderRecord | null {
  const typed = asRecord(value);
  if (!typed) {
    return null;
  }
  return (
    asRecord(typed.trigger_builder) ??
    asRecord(asRecord(typed.runtime)?.trigger_builder) ??
    asRecord(readScopePreviewRecord(value)?.trigger_builder)
  );
}

function readTriggerBuilderEventHints(builder: TriggerBuilderRecord | null): string[] {
  if (!builder) {
    return [];
  }
  const direct = readStringArray(builder.event_hints);
  if (direct.length > 0) {
    return direct;
  }
  return readStringArray(asRecord(builder.event)?.suggested_values);
}

function readTriggerBuilderDefaultEvent(builder: TriggerBuilderRecord | null): string | undefined {
  if (!builder) {
    return undefined;
  }
  return (
    asString(asRecord(builder.event)?.default) ||
    asString(asRecord(builder.request_template)?.event) ||
    undefined
  );
}

function readTriggerBuilderPayloadDescription(
  builder: TriggerBuilderRecord | null,
): string | undefined {
  if (!builder) {
    return undefined;
  }
  return (
    asString(asRecord(builder.payload_hints)?.description) ||
    asString(asRecord(builder.payload)?.description) ||
    undefined
  );
}

function readTriggerBuilderPayloadExample(
  builder: TriggerBuilderRecord | null,
): string | undefined {
  if (!builder) {
    return undefined;
  }
  const payloadExample =
    asRecord(asRecord(builder.payload_hints)?.example) ??
    asRecord(asRecord(builder.payload)?.example) ??
    asRecord(asRecord(builder.request_template)?.payload);
  if (!payloadExample) {
    return undefined;
  }
  try {
    return JSON.stringify(payloadExample, null, 2);
  } catch {
    return undefined;
  }
}

function readTriggerBuilderResponseDescription(
  builder: TriggerBuilderRecord | null,
): string | undefined {
  if (!builder) {
    return undefined;
  }
  const responseHints = asRecord(builder.response_hints);
  if (responseHints) {
    const fields = readStringArray(responseHints.normalized_fields);
    const detail = asString(responseHints.description);
    if (detail && fields.length > 0) {
      return `${detail} Fields: ${fields.join(", ")}.`;
    }
    if (detail) {
      return detail;
    }
    if (fields.length > 0) {
      return `Normalized fields: ${fields.join(", ")}.`;
    }
  }
  const normalization = asRecord(builder.response_normalization);
  if (!normalization) {
    return undefined;
  }
  const acknowledgedFrom = readStringArray(normalization.acknowledged_from);
  const resultFrom = readStringArray(normalization.result_from);
  const parts: string[] = [];
  if (acknowledgedFrom.length > 0) {
    parts.push(`Acknowledgement fields: ${acknowledgedFrom.join(", ")}`);
  }
  if (resultFrom.length > 0) {
    parts.push(`Result fields: ${resultFrom.join(", ")}`);
  }
  return parts.length > 0 ? `${parts.join(". ")}.` : undefined;
}

function readTriggerBuilderBridgeDetail(builder: TriggerBuilderRecord | null): string | undefined {
  if (!builder) {
    return undefined;
  }
  const bridge = asRecord(builder.bridge);
  const triggerUrl = asString(builder.trigger_url_redacted);
  if (triggerUrl) {
    return `Trigger bridge: ${triggerUrl}`;
  }
  if (!bridge) {
    return undefined;
  }
  const endpoint = asString(bridge.endpoint);
  const available =
    typeof bridge.available === "boolean"
      ? bridge.available
        ? "available"
        : "not ready"
      : undefined;
  return (
    [available, endpoint ? `endpoint ${endpoint}` : ""].filter(Boolean).join(" · ") || undefined
  );
}

function buildHubSpotCrmInsights(
  entries: Array<{ title: string; data: Record<string, unknown> }>,
): ConnectorPreviewInsight[] {
  return entries
    .map((entry) => ({
      title: entry.title,
      detail: readScopePreviewText(entry.data) || "No live CRM preview available yet.",
    }))
    .filter((entry) => entry.detail.trim().length > 0);
}

function buildQuickBooksPreviewInsights(data: Record<string, unknown>): ConnectorPreviewInsight[] {
  const scopePreview = readScopePreviewRecord(data);
  if (!scopePreview) {
    return [];
  }
  const insights: ConnectorPreviewInsight[] = [];
  const companyName = asString(scopePreview.company_name);
  if (companyName) {
    insights.push({ title: "Company", detail: companyName });
  }
  const transactionPreview = asRecord(scopePreview.transaction);
  const entityTypes = readStringArray(transactionPreview?.entity_types);
  if (entityTypes.length > 0) {
    insights.push({ title: "Transaction types", detail: entityTypes.join(", ") });
  }
  const accountLabels = readStringArray(transactionPreview?.account_labels);
  if (accountLabels.length > 0) {
    insights.push({
      title: accountLabels.length === 1 ? "Account" : "Accounts",
      detail:
        accountLabels.length > 3
          ? `${accountLabels.slice(0, 3).join(", ")} +${accountLabels.length - 3} more`
          : accountLabels.join(", "),
    });
  }
  const dateWindow = asRecord(scopePreview.date_window);
  if (dateWindow) {
    const start = asString(dateWindow.start) || "*";
    const end = asString(dateWindow.end) || "*";
    insights.push({ title: "Date window", detail: `${start} .. ${end}` });
  }
  const candidateCount = scopePreview.candidate_count;
  if (typeof candidateCount === "number") {
    insights.push({
      title: "Scope candidates",
      detail: `${candidateCount} candidate${candidateCount === 1 ? "" : "s"}`,
    });
  }
  return insights;
}

function readRuntimePickerScopeRecord(
  value: unknown,
  scopeKey: string,
): Record<string, unknown> | null {
  const typed = asRecord(value);
  if (!typed) {
    return null;
  }
  const runtime = asRecord(typed.runtime);
  const pickerScopes = asRecord(runtime?.picker_scopes);
  return asRecord(pickerScopes?.[scopeKey]);
}

function readRuntimePickerScopeOptions(value: unknown, scopeKey: string): ConnectorPickerOption[] {
  const scopeRecord = readRuntimePickerScopeRecord(value, scopeKey);
  if (!scopeRecord) {
    return [];
  }
  const picker = asRecord(scopeRecord.picker);
  const nestedOptions = readPickerOptions(picker?.items);
  if (nestedOptions.length > 0) {
    return nestedOptions;
  }
  return readPickerOptions(scopeRecord.candidates);
}

function readRuntimePickerScopeSelected(
  value: unknown,
  scopeKey: string,
): Record<string, unknown> | null {
  const scopeRecord = readRuntimePickerScopeRecord(value, scopeKey);
  if (!scopeRecord) {
    return null;
  }
  return asRecord(scopeRecord.selected);
}

function mergeDelimitedValue(raw: string, nextValue: string): string {
  const normalized = nextValue.trim();
  if (!normalized) {
    return raw;
  }
  const merged = new Set(parseDelimitedList(raw));
  merged.add(normalized);
  return Array.from(merged.values()).join(", ");
}

function firstSubtitleSegment(value: string | undefined): string | undefined {
  const segment = value?.split("|", 1)[0]?.trim();
  return segment ? segment : undefined;
}

function buildScopedPairValue(first?: string, second?: string): string {
  return [first?.trim(), second?.trim()].filter(Boolean).join(" | ");
}

function buildScopedTripleValue(first?: string, second?: string, third?: string): string {
  return [first?.trim(), second?.trim(), third?.trim()].filter(Boolean).join(" | ");
}

function mergeScopedPairValue(
  raw: string,
  next: {
    first?: string;
    second?: string;
  },
): string {
  const current = parseScopedPair(raw);
  return buildScopedPairValue(next.first ?? current?.first, next.second ?? current?.second);
}

function mergeScopedTripleValue(
  raw: string,
  next: {
    first?: string;
    second?: string;
    third?: string;
  },
): string {
  const current = parseScopedTriple(raw);
  return buildScopedTripleValue(
    next.first ?? current?.first,
    next.second ?? current?.second,
    next.third ?? current?.third,
  );
}

function createDefaultGooglePickerState(): GooglePickerState {
  return {
    accountOptions: [],
    gmailMessageOptions: [],
    gmailLabelOptions: [],
    driveOptions: [],
    calendarOptions: [],
    calendarScopeOptions: [],
    preview: undefined,
  };
}

function createDefaultSlackPickerState(): SlackPickerState {
  return {
    workspace: null,
    channelOptions: [],
    peopleOptions: [],
    preview: undefined,
  };
}

function createDefaultM365PickerState(): M365PickerState {
  return {
    mailbox: null,
    driveOptions: [],
    calendarOptions: [],
    teamMessageOptions: [],
    teamScopeOptions: [],
    workbookScopeOptions: [],
    configuredTeamScope: undefined,
    configuredWorkbookScope: undefined,
    preview: undefined,
  };
}

function createDefaultHubSpotPickerState(): HubSpotPickerState {
  return {
    portalOptions: [],
    portalPreview: undefined,
    preview: undefined,
    pipelineOptions: [],
    ownerOptions: [],
    teamOptions: [],
    queueOptions: [],
    crmInsights: [],
  };
}

function createDefaultQuickBooksPickerState(): QuickBooksPickerState {
  return {
    companyOptions: [],
    company: null,
    accountOptions: [],
    dateWindowOptions: [],
    preview: undefined,
    previewInsights: [],
  };
}

function createDefaultMailchimpPickerState(): MailchimpPickerState {
  return {
    account: null,
    audienceOptions: [],
    campaignOptions: [],
    memberOptions: [],
    preview: undefined,
  };
}

function createDefaultKlaviyoPickerState(): KlaviyoPickerState {
  return {
    account: null,
    listOptions: [],
    profileOptions: [],
    campaignOptions: [],
    preview: undefined,
  };
}

function createDefaultBufferPickerState(): BufferPickerState {
  return {
    account: null,
    channelOptions: [],
    profileOptions: [],
    preview: undefined,
  };
}

function createDefaultHootsuitePickerState(): HootsuitePickerState {
  return {
    member: null,
    organizationOptions: [],
    socialProfileOptions: [],
    teamOptions: [],
    messageOptions: [],
    preview: undefined,
  };
}

function createDefaultElevenLabsPickerState(): ElevenLabsPickerState {
  return {
    account: null,
    voiceOptions: [],
    modelOptions: [],
    historyOptions: [],
    preview: undefined,
  };
}

function createDefaultN8NPickerState(): N8NPickerState {
  return {
    workflowOptions: [],
    preview: undefined,
    triggerBuilder: null,
  };
}

function createDefaultZapierPickerState(): ZapierPickerState {
  return {
    zapOptions: [],
    preview: undefined,
    triggerBuilder: null,
  };
}

function createDefaultShopifyPickerState(): ShopifyPickerState {
  return {
    store: null,
    productOptions: [],
    orderOptions: [],
    customerOptions: [],
  };
}

function createDefaultAirtablePickerState(): AirtablePickerState {
  return {
    baseOptions: [],
    tableOptions: [],
    preview: undefined,
  };
}

function createDefaultStripePickerState(): StripePickerState {
  return {
    account: null,
    customerOptions: [],
  };
}

function createDefaultNotionPickerState(): NotionPickerState {
  return {
    databaseOptions: [],
    pageOptions: [],
  };
}

function normalizeSlackWorkspaceOption(value: unknown): ConnectorPickerOption | null {
  const workspaceRecord = asRecord(value);
  if (!workspaceRecord) {
    return null;
  }
  return normalizePickerOption({
    value:
      asString(workspaceRecord.id) ||
      asString(workspaceRecord.name) ||
      asString(workspaceRecord.label),
    label:
      asString(workspaceRecord.label) ||
      asString(workspaceRecord.name) ||
      asString(workspaceRecord.id),
    subtitle: asString(workspaceRecord.bot_handle) || undefined,
    kind: "workspace",
    scope_preview: asString(workspaceRecord.scope_preview) || undefined,
  });
}

function normalizeBufferEntityOption(
  value: unknown,
  kind: "channel" | "profile",
): ConnectorPickerOption | null {
  const typed = asRecord(value);
  if (!typed) {
    return null;
  }
  const id = asString(typed.id);
  if (!id) {
    return null;
  }
  const label =
    firstMeaningfulValue([
      asString(typed.formatted_username),
      asString(typed.service_username),
      asString(typed.username),
      asString(typed.service),
      id,
    ]) ?? id;
  const subtitleParts = [
    asString(typed.service),
    typed.default === true ? "default" : "",
    asString(typed.timezone),
  ].filter(Boolean);
  return {
    value: id,
    label,
    subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : undefined,
    kind,
  };
}

function normalizeHootsuiteMemberOption(value: unknown): ConnectorPickerOption | null {
  const typed = asRecord(value);
  if (!typed) {
    return null;
  }
  const memberId = asString(typed.value) || asString(typed.id) || asString(typed.member_id);
  const label =
    firstMeaningfulValue([
      asString(typed.label),
      asString(typed.fullName),
      asString(typed.name),
      memberId,
    ]) ?? "";
  if (!memberId || !label) {
    return null;
  }
  const subtitle = firstMeaningfulValue([asString(typed.email), asString(typed.subtitle)]);
  return {
    value: memberId,
    label,
    subtitle,
    kind: "member",
    selected: typed.selected === true,
  };
}

function readNestedPickerOptions(value: unknown): ConnectorPickerOption[] {
  const typed = asRecord(value);
  if (!typed) {
    return [];
  }
  const picker = asRecord(typed.picker);
  return readPickerOptions(picker?.items);
}

function normalizeStripeAccountOption(value: unknown): ConnectorPickerOption | null {
  const typed = asRecord(value);
  if (!typed) {
    return null;
  }
  const accountId = asString(typed.id);
  if (!accountId) {
    return null;
  }
  const label =
    firstMeaningfulValue([
      asString(typed.display_name),
      asString(typed.business_profile_name),
      asString(typed.email),
      accountId,
    ]) ?? accountId;
  const subtitle = firstMeaningfulValue([
    asString(typed.email),
    asString(typed.country),
    asString(typed.default_currency),
  ]);
  return {
    value: accountId,
    label,
    subtitle,
    kind: "account",
  };
}

function parseScopedPair(raw: string | undefined): { first: string; second?: string } | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  const separators = ["|", ">", "/", ":"];
  for (const separator of separators) {
    if (!value.includes(separator)) {
      continue;
    }
    const [first, second] = value.split(separator, 2).map((item) => item.trim());
    if (first && second) {
      return { first, second };
    }
  }
  return { first: value };
}

function parseScopedTriple(
  raw: string | undefined,
): { first: string; second?: string; third?: string } | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  const separators = ["|", ">", "/"];
  for (const separator of separators) {
    if (!value.includes(separator)) {
      continue;
    }
    const [first, second, third] = value.split(separator, 3).map((item) => item.trim());
    if (first) {
      return {
        first,
        second: second || undefined,
        third: third || undefined,
      };
    }
  }
  return { first: value };
}

function buildGoogleSearchQuery(scope: FlowDraft["google"]): string {
  const gmailSenders = parseDelimitedList(scope.gmailSenders);
  const gmailLabels = parseDelimitedList(scope.gmailLabels);
  const gmailQueryParts = [scope.gmailQuery.trim()].filter(Boolean);
  if (gmailSenders.length === 1) {
    gmailQueryParts.push(`from:${gmailSenders[0]}`);
  } else if (gmailSenders.length > 1) {
    gmailQueryParts.push(`(${gmailSenders.map((sender) => `from:${sender}`).join(" OR ")})`);
  }
  if (gmailLabels.length === 1) {
    gmailQueryParts.push(`label:${gmailLabels[0]}`);
  } else if (gmailLabels.length > 1) {
    gmailQueryParts.push(`(${gmailLabels.map((label) => `label:${label}`).join(" OR ")})`);
  }
  return gmailQueryParts.join(" ").trim();
}

function buildSlackSearchQuery(scope: FlowDraft["slack"]): string {
  const channels = parseDelimitedList(scope.channels);
  const mentionTargets = parseDelimitedList(scope.mentionTargets);
  const keywordTriggers = parseDelimitedList(scope.keywordTriggers);
  const normalizedChannelTerms = channels.map((channel) =>
    channel.startsWith("#") ? `in:${channel}` : `in:#${channel}`,
  );
  return [
    ...normalizedChannelTerms,
    ...mentionTargets.map((target) =>
      target.startsWith("@") || target.startsWith("<@") ? target : `@${target}`,
    ),
    ...keywordTriggers,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
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
    google: {
      account: "",
      gmailSenders: "",
      gmailQuery: "",
      gmailLabels: "",
      driveRoots: "",
      calendarScopes: "",
      notes: "",
    },
    slack: {
      workspace: "",
      channels: "",
      mentionTargets: "",
      keywordTriggers: "",
      notes: "",
    },
    m365: {
      tenant: "",
      mailboxes: "",
      calendarScopes: "",
      driveScopes: "",
      workbookScopes: "",
      teamsScopes: "",
      notes: "",
    },
    hubspot: {
      portalId: "",
      pipelines: "",
      owners: "",
      teams: "",
      queues: "",
      notes: "",
    },
    mailchimp: {
      serverPrefix: "",
      audienceId: "",
      campaignId: "",
      memberEmail: "",
      notes: "",
    },
    klaviyo: {
      account: "",
      listId: "",
      profileId: "",
      profileEmail: "",
      campaignId: "",
      notes: "",
    },
    buffer: {
      account: "",
      channelId: "",
      profileId: "",
      postId: "",
      postText: "",
      notes: "",
    },
    hootsuite: {
      member: "",
      organizationId: "",
      socialProfileId: "",
      teamId: "",
      messageId: "",
      notes: "",
    },
    elevenlabs: {
      voiceId: "",
      modelId: "",
      historyItemId: "",
      notes: "",
    },
    quickbooks: {
      companyRealm: "",
      accountCues: "",
      dateWindow: "",
      notes: "",
    },
    n8n: {
      workspaceName: "",
      workflowId: "",
      workflowName: "",
      workflowStatus: "",
      triggerEvent: "",
      triggerPayload: "",
      notes: "",
    },
    zapier: {
      workspaceName: "",
      zapId: "",
      zapName: "",
      zapStatus: "",
      triggerEvent: "",
      triggerPayload: "",
      notes: "",
    },
    shopify: {
      shopDomain: "",
      productId: "",
      productStatus: "",
      orderId: "",
      orderStatus: "",
      customerEmail: "",
      createdAfter: "",
      createdBefore: "",
      notes: "",
    },
    airtable: {
      baseId: "",
      tableName: "",
      workspaceId: "",
      notes: "",
    },
    stripe: {
      connectedAccount: "",
      customerFocus: "",
      invoiceStatus: "",
      createdAfter: "",
      createdBefore: "",
      notes: "",
    },
    notion: {
      databaseId: "",
      pageId: "",
      searchQuery: "",
      notes: "",
    },
    wordpress: {
      siteBaseUrl: "",
      postType: "",
      status: "",
      sectionTaxonomyCues: "",
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
      "Uses the existing slack_signal_monitor runtime tool today and prefers aos-slack when the connector runtime is ready.",
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

function selectedConnectorCommandIds(draft: FlowDraft, tool: string): string[] {
  return draft.connectors.selectedActions
    .map((value) => splitQualifiedConnectorAction(value))
    .filter((entry): entry is { tool: string; commandId: string } => Boolean(entry))
    .filter((entry) => entry.tool === tool)
    .map((entry) => entry.commandId);
}

function readOperatorFlow(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = meta?.operatorFlow;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readHubSpotScope(flow: Record<string, unknown> | undefined): FlowDraft["hubspot"] {
  const readScopeRecord = (value: unknown): FlowDraft["hubspot"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      portalId: typeof typed.portalId === "string" ? typed.portalId : "",
      pipelines: joinDelimitedList(typed.pipelines),
      owners: joinDelimitedList(typed.owners),
      teams: joinDelimitedList(typed.teams),
      queues: joinDelimitedList(typed.queues),
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.hubspot);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-hubspot") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().hubspot;
}

function readGoogleScope(flow: Record<string, unknown> | undefined): FlowDraft["google"] {
  const readScopeRecord = (value: unknown): FlowDraft["google"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      account:
        typeof typed.account === "string"
          ? typed.account
          : typeof typed.mailbox === "string"
            ? typed.mailbox
            : typeof typed.mailboxAccount === "string"
              ? typed.mailboxAccount
              : "",
      gmailSenders: joinDelimitedList(
        typed.gmailSenders ?? typed.senders ?? typed.vipSenders ?? typed.senderAllowlist,
      ),
      gmailQuery:
        typeof typed.gmailQuery === "string"
          ? typed.gmailQuery
          : typeof typed.query === "string"
            ? typed.query
            : "",
      gmailLabels: joinDelimitedList(typed.gmailLabels ?? typed.labels ?? typed.labelCues),
      driveRoots: joinDelimitedList(typed.driveRoots ?? typed.driveFolders ?? typed.driveScope),
      calendarScopes: joinDelimitedList(
        typed.calendarScopes ?? typed.calendars ?? typed.calendarIds ?? typed.calendarScope,
      ),
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.google);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-google") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().google;
}

function buildGoogleScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const account = draft.google.account.trim();
  const gmailSenders = parseDelimitedList(draft.google.gmailSenders);
  const gmailQuery = draft.google.gmailQuery.trim();
  const gmailLabels = parseDelimitedList(draft.google.gmailLabels);
  const driveRoots = parseDelimitedList(draft.google.driveRoots);
  const calendarScopes = parseDelimitedList(draft.google.calendarScopes);
  const notes = draft.google.notes.trim();
  if (
    !account &&
    gmailSenders.length === 0 &&
    !gmailQuery &&
    gmailLabels.length === 0 &&
    driveRoots.length === 0 &&
    calendarScopes.length === 0 &&
    !notes
  ) {
    return undefined;
  }
  const synthesizedGmailQuery = buildGoogleSearchQuery(draft.google);
  const calendarId = firstMeaningfulValue(calendarScopes);
  const driveQuery = firstMeaningfulValue(driveRoots);
  const commandDefaults = buildCommandDefaults({
    "gmail.search": {
      positional: synthesizedGmailQuery ? [synthesizedGmailQuery] : undefined,
      env: account ? { AOS_GOOGLE_ACCOUNT: account } : undefined,
    },
    "gmail.read": {
      env: account ? { AOS_GOOGLE_ACCOUNT: account } : undefined,
    },
    "drive.list": {
      options: driveQuery ? { query: driveQuery } : undefined,
      env: account ? { AOS_GOOGLE_ACCOUNT: account } : undefined,
    },
    "calendar.list": {
      options: calendarId ? { calendarId } : undefined,
      env: account ? { AOS_GOOGLE_ACCOUNT: account } : undefined,
    },
    "calendar.create": {
      options: calendarId ? { calendarId } : undefined,
      env: account ? { AOS_GOOGLE_ACCOUNT: account } : undefined,
    },
  });
  const summary = describeGoogleScope(draft);
  return {
    summary: summary || undefined,
    account: account || undefined,
    gmailSenders: gmailSenders.length > 0 ? gmailSenders : undefined,
    gmailQuery: gmailQuery || undefined,
    gmailLabels: gmailLabels.length > 0 ? gmailLabels : undefined,
    driveRoots: driveRoots.length > 0 ? driveRoots : undefined,
    calendarScopes: calendarScopes.length > 0 ? calendarScopes : undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function isMeaningfulGoogleAccount(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return ![
    "any",
    "all",
    "google",
    "gmail",
    "google workspace",
    "workspace",
    "mailbox",
    "inbox",
    "calendar",
    "drive",
    "account",
  ].includes(normalized);
}

function describeGoogleScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const account = draft.google.account.trim();
  if (account) parts.push(`account ${account}`);
  const gmailSenders = parseDelimitedList(draft.google.gmailSenders);
  if (gmailSenders.length > 0) parts.push(`senders ${gmailSenders.join(", ")}`);
  const gmailQuery = draft.google.gmailQuery.trim();
  if (gmailQuery) parts.push(`query ${gmailQuery}`);
  const gmailLabels = parseDelimitedList(draft.google.gmailLabels);
  if (gmailLabels.length > 0) parts.push(`labels ${gmailLabels.join(", ")}`);
  const driveRoots = parseDelimitedList(draft.google.driveRoots);
  if (driveRoots.length > 0) parts.push(`drive ${driveRoots.join(", ")}`);
  const calendarScopes = parseDelimitedList(draft.google.calendarScopes);
  if (calendarScopes.length > 0) parts.push(`calendars ${calendarScopes.join(", ")}`);
  return parts.join(" · ");
}

function getGoogleScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-google")) {
    return null;
  }
  const account = draft.google.account.trim();
  const gmailSenders = parseDelimitedList(draft.google.gmailSenders);
  const gmailQuery = draft.google.gmailQuery.trim();
  const gmailLabels = parseDelimitedList(draft.google.gmailLabels);
  const driveRoots = parseDelimitedList(draft.google.driveRoots);
  const calendarScopes = parseDelimitedList(draft.google.calendarScopes);
  const commandIds = selectedConnectorCommandIds(draft, "aos-google");
  const usesGmail = commandIds.some((id) => id.startsWith("gmail."));
  const usesDrive = commandIds.some((id) => id.startsWith("drive."));
  const usesCalendar = commandIds.some((id) => id.startsWith("calendar."));
  if (!isMeaningfulGoogleAccount(account)) {
    return "Google Workspace needs a mailbox or account before this worker can launch.";
  }
  if (usesGmail && gmailSenders.length === 0 && !gmailQuery && gmailLabels.length === 0) {
    return "Google Workspace mail actions need at least one sender list, Gmail query, or label scope before launch.";
  }
  if (usesDrive && driveRoots.length === 0) {
    return "Google Workspace Drive actions need at least one Drive folder or root scope before launch.";
  }
  if (usesCalendar && calendarScopes.length === 0) {
    return "Google Workspace calendar actions need at least one calendar scope before launch.";
  }
  if (
    commandIds.length === 0 &&
    gmailSenders.length === 0 &&
    !gmailQuery &&
    gmailLabels.length === 0 &&
    driveRoots.length === 0 &&
    calendarScopes.length === 0
  ) {
    return "Google Workspace needs a concrete mail, Drive, or calendar scope before this worker can launch.";
  }
  return null;
}

function readSlackScope(flow: Record<string, unknown> | undefined): FlowDraft["slack"] {
  const readScopeRecord = (value: unknown): FlowDraft["slack"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      workspace:
        typeof typed.workspace === "string"
          ? typed.workspace
          : typeof typed.workspaceId === "string"
            ? typed.workspaceId
            : typeof typed.account === "string"
              ? typed.account
              : "",
      channels: joinDelimitedList(typed.channels ?? typed.channelIds ?? typed.channelScope),
      mentionTargets: joinDelimitedList(
        typed.mentionTargets ?? typed.targets ?? typed.people ?? typed.watchList,
      ),
      keywordTriggers: joinDelimitedList(
        typed.keywordTriggers ?? typed.keywords ?? typed.triggers ?? typed.signalTerms,
      ),
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.slack);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-slack") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().slack;
}

function buildSlackScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const workspace = draft.slack.workspace.trim();
  const channels = parseDelimitedList(draft.slack.channels);
  const mentionTargets = parseDelimitedList(draft.slack.mentionTargets);
  const keywordTriggers = parseDelimitedList(draft.slack.keywordTriggers);
  const notes = draft.slack.notes.trim();
  if (
    !workspace &&
    channels.length === 0 &&
    mentionTargets.length === 0 &&
    keywordTriggers.length === 0 &&
    !notes
  ) {
    return undefined;
  }
  const searchQuery = buildSlackSearchQuery(draft.slack);
  const defaultChannel = firstMeaningfulValue(channels);
  const commandDefaults = buildCommandDefaults({
    "message.search": {
      options: searchQuery ? { query: searchQuery } : undefined,
    },
    "mention.scan": {
      options: searchQuery ? { query: searchQuery } : undefined,
    },
    "message.reply": {
      positional: defaultChannel ? [defaultChannel] : undefined,
    },
  });
  const summary = describeSlackScope(draft);
  return {
    summary: summary || undefined,
    workspace: workspace || undefined,
    channels: channels.length > 0 ? channels : undefined,
    mentionTargets: mentionTargets.length > 0 ? mentionTargets : undefined,
    keywordTriggers: keywordTriggers.length > 0 ? keywordTriggers : undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function isMeaningfulSlackWorkspace(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return !["any", "all", "slack", "workspace", "channel", "channels", "team", "default"].includes(
    normalized,
  );
}

function describeSlackScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const workspace = draft.slack.workspace.trim();
  if (workspace) parts.push(`workspace ${workspace}`);
  const channels = parseDelimitedList(draft.slack.channels);
  if (channels.length > 0) parts.push(`channels ${channels.join(", ")}`);
  const mentionTargets = parseDelimitedList(draft.slack.mentionTargets);
  if (mentionTargets.length > 0) parts.push(`mentions ${mentionTargets.join(", ")}`);
  const keywordTriggers = parseDelimitedList(draft.slack.keywordTriggers);
  if (keywordTriggers.length > 0) parts.push(`signals ${keywordTriggers.join(", ")}`);
  return parts.join(" · ");
}

function getSlackScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-slack")) {
    return null;
  }
  const workspace = draft.slack.workspace.trim();
  const channels = parseDelimitedList(draft.slack.channels);
  const mentionTargets = parseDelimitedList(draft.slack.mentionTargets);
  const keywordTriggers = parseDelimitedList(draft.slack.keywordTriggers);
  if (!isMeaningfulSlackWorkspace(workspace)) {
    return "Slack needs a workspace before this worker can launch.";
  }
  if (channels.length === 0 && mentionTargets.length === 0 && keywordTriggers.length === 0) {
    return "Slack needs channel scope, mention targets, or signal keywords before this worker can launch.";
  }
  return null;
}

function readM365Scope(flow: Record<string, unknown> | undefined): FlowDraft["m365"] {
  const readScopeRecord = (value: unknown): FlowDraft["m365"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      tenant:
        typeof typed.tenant === "string"
          ? typed.tenant
          : typeof typed.tenantId === "string"
            ? typed.tenantId
            : typeof typed.organization === "string"
              ? typed.organization
              : "",
      mailboxes: joinDelimitedList(typed.mailboxes ?? typed.mailboxScope ?? typed.mailScope),
      calendarScopes: joinDelimitedList(
        typed.calendarScopes ?? typed.calendars ?? typed.calendarIds ?? typed.calendarScope,
      ),
      driveScopes: joinDelimitedList(typed.driveScopes ?? typed.drives ?? typed.driveScope),
      workbookScopes: joinDelimitedList(
        typed.workbookScopes ?? typed.workbooks ?? typed.excelScope,
      ),
      teamsScopes: joinDelimitedList(
        typed.teamsScopes ?? typed.teams ?? typed.channels ?? typed.teamChannelScope,
      ),
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.m365);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-m365") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().m365;
}

function buildM365ScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const tenant = draft.m365.tenant.trim();
  const mailboxes = parseDelimitedList(draft.m365.mailboxes);
  const calendarScopes = parseDelimitedList(draft.m365.calendarScopes);
  const driveScopes = parseDelimitedList(draft.m365.driveScopes);
  const workbookScopes = parseDelimitedList(draft.m365.workbookScopes);
  const teamsScopes = parseDelimitedList(draft.m365.teamsScopes);
  const notes = draft.m365.notes.trim();
  if (
    !tenant &&
    mailboxes.length === 0 &&
    calendarScopes.length === 0 &&
    driveScopes.length === 0 &&
    workbookScopes.length === 0 &&
    teamsScopes.length === 0 &&
    !notes
  ) {
    return undefined;
  }
  const targetUser = firstMeaningfulValue(mailboxes);
  const drivePath = firstMeaningfulValue(driveScopes);
  const workbookScope = parseScopedTriple(firstMeaningfulValue(workbookScopes));
  const teamScope = parseScopedPair(firstMeaningfulValue(teamsScopes));
  const sharedEnv = targetUser ? { M365_TARGET_USER: targetUser } : undefined;
  const commandDefaults = buildCommandDefaults({
    "mail.search": {
      env: sharedEnv,
    },
    "mail.read": {
      env: sharedEnv,
    },
    "mail.reply": {
      env: sharedEnv,
    },
    "mail.send": {
      env: sharedEnv,
    },
    "calendar.list": {
      env: sharedEnv,
    },
    "calendar.create": {
      env: sharedEnv,
    },
    "file.list": {
      positional: drivePath ? [drivePath] : undefined,
      env: sharedEnv,
    },
    "excel.read_rows": {
      positional:
        workbookScope?.first && workbookScope.second && workbookScope.third
          ? [workbookScope.first, workbookScope.second, workbookScope.third]
          : workbookScope?.first && workbookScope.second
            ? [workbookScope.first, workbookScope.second]
            : workbookScope?.first
              ? [workbookScope.first]
              : undefined,
      env: sharedEnv,
    },
    "excel.append_rows": {
      positional:
        workbookScope?.first && workbookScope.second && workbookScope.third
          ? [workbookScope.first, workbookScope.second, workbookScope.third]
          : workbookScope?.first && workbookScope.second
            ? [workbookScope.first, workbookScope.second]
            : workbookScope?.first
              ? [workbookScope.first]
              : undefined,
      env: sharedEnv,
    },
    "teams.list_messages": {
      positional:
        teamScope?.first && teamScope.second
          ? [teamScope.first, teamScope.second]
          : teamScope?.first
            ? [teamScope.first]
            : undefined,
      env: sharedEnv,
    },
    "teams.reply_message": {
      positional:
        teamScope?.first && teamScope.second
          ? [teamScope.first, teamScope.second]
          : teamScope?.first
            ? [teamScope.first]
            : undefined,
      env: sharedEnv,
    },
  });
  const summary = describeM365Scope(draft);
  return {
    summary: summary || undefined,
    tenant: tenant || undefined,
    mailboxes: mailboxes.length > 0 ? mailboxes : undefined,
    calendarScopes: calendarScopes.length > 0 ? calendarScopes : undefined,
    driveScopes: driveScopes.length > 0 ? driveScopes : undefined,
    workbookScopes: workbookScopes.length > 0 ? workbookScopes : undefined,
    teamsScopes: teamsScopes.length > 0 ? teamsScopes : undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function isMeaningfulM365Tenant(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return ![
    "any",
    "all",
    "m365",
    "microsoft",
    "microsoft 365",
    "office 365",
    "tenant",
    "organization",
    "org",
  ].includes(normalized);
}

function describeM365Scope(draft: FlowDraft): string {
  const parts: string[] = [];
  const tenant = draft.m365.tenant.trim();
  if (tenant) parts.push(`tenant ${tenant}`);
  const mailboxes = parseDelimitedList(draft.m365.mailboxes);
  if (mailboxes.length > 0) parts.push(`mailboxes ${mailboxes.join(", ")}`);
  const calendarScopes = parseDelimitedList(draft.m365.calendarScopes);
  if (calendarScopes.length > 0) parts.push(`calendars ${calendarScopes.join(", ")}`);
  const driveScopes = parseDelimitedList(draft.m365.driveScopes);
  if (driveScopes.length > 0) parts.push(`drives ${driveScopes.join(", ")}`);
  const workbookScopes = parseDelimitedList(draft.m365.workbookScopes);
  if (workbookScopes.length > 0) parts.push(`workbooks ${workbookScopes.join(", ")}`);
  const teamsScopes = parseDelimitedList(draft.m365.teamsScopes);
  if (teamsScopes.length > 0) parts.push(`Teams ${teamsScopes.join(", ")}`);
  return parts.join(" · ");
}

function getM365ScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-m365")) {
    return null;
  }
  const tenant = draft.m365.tenant.trim();
  const mailboxes = parseDelimitedList(draft.m365.mailboxes);
  const calendarScopes = parseDelimitedList(draft.m365.calendarScopes);
  const driveScopes = parseDelimitedList(draft.m365.driveScopes);
  const workbookScopes = parseDelimitedList(draft.m365.workbookScopes);
  const teamsScopes = parseDelimitedList(draft.m365.teamsScopes);
  const commandIds = selectedConnectorCommandIds(draft, "aos-m365");
  const usesMail = commandIds.some((id) => id.startsWith("mail."));
  const usesCalendar = commandIds.some((id) => id.startsWith("calendar."));
  const usesFile = commandIds.some((id) => id.startsWith("file."));
  const usesExcel = commandIds.some((id) => id.startsWith("excel."));
  const usesTeams = commandIds.some((id) => id.startsWith("teams."));
  if (!isMeaningfulM365Tenant(tenant)) {
    return "Microsoft 365 needs a tenant or organization before this worker can launch.";
  }
  if (usesMail && mailboxes.length === 0) {
    return "Microsoft 365 mail actions need at least one mailbox scope before launch.";
  }
  if (usesCalendar && calendarScopes.length === 0) {
    return "Microsoft 365 calendar actions need at least one calendar scope before launch.";
  }
  if (usesFile && driveScopes.length === 0) {
    return "Microsoft 365 file actions need at least one OneDrive or SharePoint scope before launch.";
  }
  if (usesExcel && workbookScopes.length === 0) {
    return "Microsoft 365 Excel actions need at least one workbook or worksheet scope before launch.";
  }
  if (usesTeams && teamsScopes.length === 0) {
    return "Microsoft 365 Teams actions need at least one team or channel scope before launch.";
  }
  if (
    commandIds.length === 0 &&
    mailboxes.length === 0 &&
    calendarScopes.length === 0 &&
    driveScopes.length === 0 &&
    workbookScopes.length === 0 &&
    teamsScopes.length === 0
  ) {
    return "Microsoft 365 needs a concrete mailbox, calendar, drive, workbook, or Teams scope before this worker can launch.";
  }
  return null;
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
  const firstPipeline = firstMeaningfulValue(pipelines);
  const firstTeam = firstMeaningfulValue(teams);
  const commandDefaults = buildCommandDefaults({
    "deal.search": {
      globalOptions: portalId ? { portalId } : undefined,
      options: firstPipeline ? { pipelineId: firstPipeline } : undefined,
    },
    "ticket.search": {
      globalOptions: portalId ? { portalId } : undefined,
      options: firstPipeline ? { pipelineId: firstPipeline } : undefined,
    },
    "owner.list": {
      globalOptions: portalId ? { portalId } : undefined,
      options: firstTeam ? { teamId: firstTeam } : undefined,
    },
  });
  const summary = describeHubSpotScope(draft);
  return {
    summary: summary || undefined,
    portalId: portalId || undefined,
    pipelines: pipelines.length > 0 ? pipelines : undefined,
    owners: owners.length > 0 ? owners : undefined,
    teams: teams.length > 0 ? teams : undefined,
    queues: queues.length > 0 ? queues : undefined,
    notes: notes || undefined,
    commandDefaults,
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

function readQuickBooksScope(flow: Record<string, unknown> | undefined): FlowDraft["quickbooks"] {
  const readScopeRecord = (value: unknown): FlowDraft["quickbooks"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      companyRealm:
        typeof typed.companyRealm === "string"
          ? typed.companyRealm
          : typeof typed.company === "string"
            ? typed.company
            : typeof typed.realmId === "string"
              ? typed.realmId
              : "",
      accountCues: joinDelimitedList(
        typed.accountCues ?? typed.accounts ?? typed.accountCue ?? typed.account,
      ),
      dateWindow: typeof typed.dateWindow === "string" ? typed.dateWindow : "",
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.quickbooks);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-quickbooks") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().quickbooks;
}

function readMailchimpScope(flow: Record<string, unknown> | undefined): FlowDraft["mailchimp"] {
  const readScopeRecord = (value: unknown): FlowDraft["mailchimp"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      serverPrefix:
        typeof typed.serverPrefix === "string"
          ? typed.serverPrefix
          : typeof typed.server_prefix === "string"
            ? typed.server_prefix
            : "",
      audienceId:
        typeof typed.audienceId === "string"
          ? typed.audienceId
          : typeof typed.audience_id === "string"
            ? typed.audience_id
            : typeof typed.audience === "string"
              ? typed.audience
              : "",
      campaignId:
        typeof typed.campaignId === "string"
          ? typed.campaignId
          : typeof typed.campaign_id === "string"
            ? typed.campaign_id
            : typeof typed.campaign === "string"
              ? typed.campaign
              : "",
      memberEmail:
        typeof typed.memberEmail === "string"
          ? typed.memberEmail
          : typeof typed.member_email === "string"
            ? typed.member_email
            : typeof typed.member === "string"
              ? typed.member
              : typeof typed.email === "string"
                ? typed.email
                : "",
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.mailchimp);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-mailchimp") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().mailchimp;
}

function readKlaviyoScope(flow: Record<string, unknown> | undefined): FlowDraft["klaviyo"] {
  const readScopeRecord = (value: unknown): FlowDraft["klaviyo"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      account:
        typeof typed.account === "string"
          ? typed.account
          : typeof typed.account_label === "string"
            ? typed.account_label
            : "",
      listId:
        typeof typed.listId === "string"
          ? typed.listId
          : typeof typed.list_id === "string"
            ? typed.list_id
            : typeof typed.list === "string"
              ? typed.list
              : "",
      profileId:
        typeof typed.profileId === "string"
          ? typed.profileId
          : typeof typed.profile_id === "string"
            ? typed.profile_id
            : typeof typed.profile === "string"
              ? typed.profile
              : "",
      profileEmail:
        typeof typed.profileEmail === "string"
          ? typed.profileEmail
          : typeof typed.profile_email === "string"
            ? typed.profile_email
            : typeof typed.email === "string"
              ? typed.email
              : "",
      campaignId:
        typeof typed.campaignId === "string"
          ? typed.campaignId
          : typeof typed.campaign_id === "string"
            ? typed.campaign_id
            : typeof typed.campaign === "string"
              ? typed.campaign
              : "",
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.klaviyo);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-klaviyo") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().klaviyo;
}

function readBufferScope(flow: Record<string, unknown> | undefined): FlowDraft["buffer"] {
  const readScopeRecord = (value: unknown): FlowDraft["buffer"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      account:
        typeof typed.account === "string"
          ? typed.account
          : typeof typed.accountId === "string"
            ? typed.accountId
            : typeof typed.account_id === "string"
              ? typed.account_id
              : "",
      channelId:
        typeof typed.channelId === "string"
          ? typed.channelId
          : typeof typed.channel_id === "string"
            ? typed.channel_id
            : typeof typed.channel === "string"
              ? typed.channel
              : "",
      profileId:
        typeof typed.profileId === "string"
          ? typed.profileId
          : typeof typed.profile_id === "string"
            ? typed.profile_id
            : typeof typed.profile === "string"
              ? typed.profile
              : "",
      postId:
        typeof typed.postId === "string"
          ? typed.postId
          : typeof typed.post_id === "string"
            ? typed.post_id
            : typeof typed.post === "string"
              ? typed.post
              : "",
      postText:
        typeof typed.postText === "string"
          ? typed.postText
          : typeof typed.post_text === "string"
            ? typed.post_text
            : typeof typed.text === "string"
              ? typed.text
              : "",
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.buffer);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-buffer") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().buffer;
}

function readHootsuiteScope(flow: Record<string, unknown> | undefined): FlowDraft["hootsuite"] {
  const readScopeRecord = (value: unknown): FlowDraft["hootsuite"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      member:
        typeof typed.member === "string"
          ? typed.member
          : typeof typed.memberId === "string"
            ? typed.memberId
            : typeof typed.member_id === "string"
              ? typed.member_id
              : "",
      organizationId:
        typeof typed.organizationId === "string"
          ? typed.organizationId
          : typeof typed.organization_id === "string"
            ? typed.organization_id
            : typeof typed.organization === "string"
              ? typed.organization
              : "",
      socialProfileId:
        typeof typed.socialProfileId === "string"
          ? typed.socialProfileId
          : typeof typed.social_profile_id === "string"
            ? typed.social_profile_id
            : typeof typed.socialProfile === "string"
              ? typed.socialProfile
              : typeof typed.profile === "string"
                ? typed.profile
                : "",
      teamId:
        typeof typed.teamId === "string"
          ? typed.teamId
          : typeof typed.team_id === "string"
            ? typed.team_id
            : typeof typed.team === "string"
              ? typed.team
              : "",
      messageId:
        typeof typed.messageId === "string"
          ? typed.messageId
          : typeof typed.message_id === "string"
            ? typed.message_id
            : typeof typed.message === "string"
              ? typed.message
              : "",
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.hootsuite);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-hootsuite") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().hootsuite;
}

function readElevenLabsScope(flow: Record<string, unknown> | undefined): FlowDraft["elevenlabs"] {
  const readScopeRecord = (value: unknown): FlowDraft["elevenlabs"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      voiceId:
        typeof typed.voiceId === "string"
          ? typed.voiceId
          : typeof typed.voice_id === "string"
            ? typed.voice_id
            : typeof typed.voice === "string"
              ? typed.voice
              : "",
      modelId:
        typeof typed.modelId === "string"
          ? typed.modelId
          : typeof typed.model_id === "string"
            ? typed.model_id
            : typeof typed.model === "string"
              ? typed.model
              : "",
      historyItemId:
        typeof typed.historyItemId === "string"
          ? typed.historyItemId
          : typeof typed.history_item_id === "string"
            ? typed.history_item_id
            : typeof typed.history === "string"
              ? typed.history
              : "",
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.elevenlabs);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-elevenlabs") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().elevenlabs;
}

function readN8NScope(flow: Record<string, unknown> | undefined): FlowDraft["n8n"] {
  const readScopeRecord = (value: unknown): FlowDraft["n8n"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    const trigger = asRecord(typed.trigger);
    return {
      workspaceName:
        typeof typed.workspaceName === "string"
          ? typed.workspaceName
          : typeof typed.workspace === "string"
            ? typed.workspace
            : typeof typed.workspace_name === "string"
              ? typed.workspace_name
              : "",
      workflowId:
        typeof typed.workflowId === "string"
          ? typed.workflowId
          : typeof typed.workflow_id === "string"
            ? typed.workflow_id
            : typeof typed.id === "string"
              ? typed.id
              : "",
      workflowName:
        typeof typed.workflowName === "string"
          ? typed.workflowName
          : typeof typed.workflow_name === "string"
            ? typed.workflow_name
            : typeof typed.name === "string"
              ? typed.name
              : "",
      workflowStatus:
        typeof typed.workflowStatus === "string"
          ? typed.workflowStatus
          : typeof typed.workflow_status === "string"
            ? typed.workflow_status
            : typeof typed.status === "string"
              ? typed.status
              : "",
      triggerEvent:
        typeof typed.triggerEvent === "string"
          ? typed.triggerEvent
          : typeof typed.event === "string"
            ? typed.event
            : asString(trigger?.event),
      triggerPayload:
        typeof typed.triggerPayload === "string"
          ? typed.triggerPayload
          : formatTriggerPayloadText(trigger?.payload),
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.n8n);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-n8n") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().n8n;
}

function readZapierScope(flow: Record<string, unknown> | undefined): FlowDraft["zapier"] {
  const readScopeRecord = (value: unknown): FlowDraft["zapier"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    const trigger = asRecord(typed.trigger);
    return {
      workspaceName:
        typeof typed.workspaceName === "string"
          ? typed.workspaceName
          : typeof typed.workspace === "string"
            ? typed.workspace
            : typeof typed.workspace_name === "string"
              ? typed.workspace_name
              : "",
      zapId:
        typeof typed.zapId === "string"
          ? typed.zapId
          : typeof typed.zap_id === "string"
            ? typed.zap_id
            : typeof typed.id === "string"
              ? typed.id
              : "",
      zapName:
        typeof typed.zapName === "string"
          ? typed.zapName
          : typeof typed.zap_name === "string"
            ? typed.zap_name
            : typeof typed.name === "string"
              ? typed.name
              : "",
      zapStatus:
        typeof typed.zapStatus === "string"
          ? typed.zapStatus
          : typeof typed.zap_status === "string"
            ? typed.zap_status
            : typeof typed.status === "string"
              ? typed.status
              : "",
      triggerEvent:
        typeof typed.triggerEvent === "string"
          ? typed.triggerEvent
          : typeof typed.event === "string"
            ? typed.event
            : asString(trigger?.event),
      triggerPayload:
        typeof typed.triggerPayload === "string"
          ? typed.triggerPayload
          : formatTriggerPayloadText(trigger?.payload),
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.zapier);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-zapier") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().zapier;
}

function readShopifyScope(flow: Record<string, unknown> | undefined): FlowDraft["shopify"] {
  const readScopeRecord = (value: unknown): FlowDraft["shopify"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      shopDomain:
        typeof typed.shopDomain === "string"
          ? typed.shopDomain
          : typeof typed.store === "string"
            ? typed.store
            : typeof typed.shop === "string"
              ? typed.shop
              : "",
      productId:
        typeof typed.productId === "string"
          ? typed.productId
          : typeof typed.product === "string"
            ? typed.product
            : "",
      productStatus:
        typeof typed.productStatus === "string"
          ? typed.productStatus
          : typeof typed.catalogStatus === "string"
            ? typed.catalogStatus
            : "",
      orderId:
        typeof typed.orderId === "string"
          ? typed.orderId
          : typeof typed.order === "string"
            ? typed.order
            : "",
      orderStatus: typeof typed.orderStatus === "string" ? typed.orderStatus : "",
      customerEmail:
        typeof typed.customerEmail === "string"
          ? typed.customerEmail
          : typeof typed.customer === "string"
            ? typed.customer
            : "",
      createdAfter:
        typeof typed.createdAfter === "string"
          ? typed.createdAfter
          : typeof typed.startDate === "string"
            ? typed.startDate
            : "",
      createdBefore:
        typeof typed.createdBefore === "string"
          ? typed.createdBefore
          : typeof typed.endDate === "string"
            ? typed.endDate
            : "",
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.shopify);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-shopify") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().shopify;
}

function readAirtableScope(flow: Record<string, unknown> | undefined): FlowDraft["airtable"] {
  const readScopeRecord = (value: unknown): FlowDraft["airtable"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      baseId:
        typeof typed.baseId === "string"
          ? typed.baseId
          : typeof typed.base === "string"
            ? typed.base
            : "",
      tableName:
        typeof typed.tableName === "string"
          ? typed.tableName
          : typeof typed.table === "string"
            ? typed.table
            : "",
      workspaceId:
        typeof typed.workspaceId === "string"
          ? typed.workspaceId
          : typeof typed.workspace === "string"
            ? typed.workspace
            : "",
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.airtable);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-airtable") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().airtable;
}

function readStripeScope(flow: Record<string, unknown> | undefined): FlowDraft["stripe"] {
  const readScopeRecord = (value: unknown): FlowDraft["stripe"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      connectedAccount:
        typeof typed.connectedAccount === "string"
          ? typed.connectedAccount
          : typeof typed.accountId === "string"
            ? typed.accountId
            : typeof typed.account === "string"
              ? typed.account
              : "",
      customerFocus:
        typeof typed.customerFocus === "string"
          ? typed.customerFocus
          : typeof typed.customer === "string"
            ? typed.customer
            : typeof typed.customerId === "string"
              ? typed.customerId
              : "",
      invoiceStatus:
        typeof typed.invoiceStatus === "string"
          ? typed.invoiceStatus
          : typeof typed.status === "string"
            ? typed.status
            : "",
      createdAfter:
        typeof typed.createdAfter === "string"
          ? typed.createdAfter
          : typeof typed.startDate === "string"
            ? typed.startDate
            : "",
      createdBefore:
        typeof typed.createdBefore === "string"
          ? typed.createdBefore
          : typeof typed.endDate === "string"
            ? typed.endDate
            : "",
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.stripe);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-stripe") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().stripe;
}

function readNotionScope(flow: Record<string, unknown> | undefined): FlowDraft["notion"] {
  const readScopeRecord = (value: unknown): FlowDraft["notion"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      databaseId:
        typeof typed.databaseId === "string"
          ? typed.databaseId
          : typeof typed.database === "string"
            ? typed.database
            : "",
      pageId:
        typeof typed.pageId === "string"
          ? typed.pageId
          : typeof typed.page === "string"
            ? typed.page
            : "",
      searchQuery:
        typeof typed.searchQuery === "string"
          ? typed.searchQuery
          : typeof typed.query === "string"
            ? typed.query
            : "",
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.notion);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-notion") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().notion;
}

function buildMailchimpScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const serverPrefix = draft.mailchimp.serverPrefix.trim();
  const audienceId = draft.mailchimp.audienceId.trim();
  const campaignId = draft.mailchimp.campaignId.trim();
  const memberEmail = draft.mailchimp.memberEmail.trim();
  const notes = draft.mailchimp.notes.trim();
  if (!serverPrefix && !audienceId && !campaignId && !memberEmail && !notes) {
    return undefined;
  }
  const summary = describeMailchimpScope(draft);
  const commandDefaults = buildCommandDefaults({
    "account.read": {
      env: serverPrefix ? { MAILCHIMP_SERVER_PREFIX: serverPrefix } : undefined,
    },
    "audience.list": {
      env: serverPrefix ? { MAILCHIMP_SERVER_PREFIX: serverPrefix } : undefined,
      options: { limit: 20 },
    },
    "audience.read": {
      positional: audienceId ? [audienceId] : undefined,
      env: serverPrefix ? { MAILCHIMP_SERVER_PREFIX: serverPrefix } : undefined,
    },
    "member.list": {
      positional: audienceId ? [audienceId] : undefined,
      env: serverPrefix ? { MAILCHIMP_SERVER_PREFIX: serverPrefix } : undefined,
      options: { limit: 20 },
    },
    "member.read": {
      positional: audienceId && memberEmail ? [audienceId, memberEmail] : undefined,
      env: serverPrefix ? { MAILCHIMP_SERVER_PREFIX: serverPrefix } : undefined,
    },
    "campaign.list": {
      env: serverPrefix ? { MAILCHIMP_SERVER_PREFIX: serverPrefix } : undefined,
      options: { limit: 20 },
    },
    "campaign.read": {
      positional: campaignId ? [campaignId] : undefined,
      env: serverPrefix ? { MAILCHIMP_SERVER_PREFIX: serverPrefix } : undefined,
    },
    "report.list": {
      env: serverPrefix ? { MAILCHIMP_SERVER_PREFIX: serverPrefix } : undefined,
      options: { limit: 20 },
    },
    "report.read": {
      positional: campaignId ? [campaignId] : undefined,
      env: serverPrefix ? { MAILCHIMP_SERVER_PREFIX: serverPrefix } : undefined,
    },
  });
  return {
    summary: summary || undefined,
    serverPrefix: serverPrefix || undefined,
    audienceId: audienceId || undefined,
    campaignId: campaignId || undefined,
    memberEmail: memberEmail || undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function buildKlaviyoScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const account = draft.klaviyo.account.trim();
  const listId = draft.klaviyo.listId.trim();
  const profileId = draft.klaviyo.profileId.trim();
  const profileEmail = draft.klaviyo.profileEmail.trim();
  const campaignId = draft.klaviyo.campaignId.trim();
  const notes = draft.klaviyo.notes.trim();
  if (!account && !listId && !profileId && !profileEmail && !campaignId && !notes) {
    return undefined;
  }
  const commandDefaults = buildCommandDefaults({
    "account.read": undefined,
    "list.list": {
      options: { limit: 10 },
    },
    "list.read": {
      positional: listId ? [listId] : undefined,
    },
    "profile.list": {
      positional: listId ? [listId] : undefined,
      options: { limit: 10, ...(profileEmail ? { email: profileEmail } : {}) },
      env: profileEmail ? { KLAVIYO_PROFILE_EMAIL: profileEmail } : undefined,
    },
    "profile.read": {
      positional: profileId ? [profileId] : undefined,
      env: profileEmail ? { KLAVIYO_PROFILE_EMAIL: profileEmail } : undefined,
    },
    "campaign.list": {
      options: { limit: 10, channel: "email" },
    },
    "campaign.read": {
      positional: campaignId ? [campaignId] : undefined,
    },
  });
  const summary = describeKlaviyoScope(draft);
  return {
    summary: summary || undefined,
    account: account || undefined,
    listId: listId || undefined,
    profileId: profileId || undefined,
    profileEmail: profileEmail || undefined,
    campaignId: campaignId || undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function buildBufferScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const account = draft.buffer.account.trim();
  const channelId = draft.buffer.channelId.trim();
  const profileId = draft.buffer.profileId.trim();
  const postId = draft.buffer.postId.trim();
  const postText = draft.buffer.postText.trim();
  const notes = draft.buffer.notes.trim();
  if (!account && !channelId && !profileId && !postId && !postText && !notes) {
    return undefined;
  }
  const sharedEnv = {
    ...(account ? { BUFFER_ACCOUNT_ID: account } : {}),
    ...(channelId ? { BUFFER_CHANNEL_ID: channelId } : {}),
    ...(profileId ? { BUFFER_PROFILE_ID: profileId } : {}),
    ...(postId ? { BUFFER_POST_ID: postId } : {}),
    ...(postText ? { BUFFER_POST_TEXT: postText } : {}),
  };
  const resolvedEnv = Object.keys(sharedEnv).length > 0 ? sharedEnv : undefined;
  const commandDefaults = buildCommandDefaults({
    "account.read": {
      env: resolvedEnv,
    },
    "channel.list": {
      options: { limit: 10 },
      env: resolvedEnv,
    },
    "channel.read": {
      positional: channelId ? [channelId] : undefined,
      env: resolvedEnv,
    },
    "profile.list": {
      options: { limit: 10 },
      env: resolvedEnv,
    },
    "profile.read": {
      positional: profileId ? [profileId] : undefined,
      env: resolvedEnv,
    },
    "post.list": {
      positional: profileId ? [profileId] : undefined,
      options: { limit: 10 },
      env: resolvedEnv,
    },
    "post.read": {
      positional: postId ? [postId] : undefined,
      env: resolvedEnv,
    },
    "post.create_draft": {
      positional: channelId && postText ? [channelId, postText] : undefined,
      env: resolvedEnv,
    },
    "post.schedule": {
      positional: channelId && postText ? [channelId, postText] : undefined,
      env: resolvedEnv,
    },
  });
  const summary = describeBufferScope(draft);
  return {
    summary: summary || undefined,
    account: account || undefined,
    channelId: channelId || undefined,
    profileId: profileId || undefined,
    postId: postId || undefined,
    postText: postText || undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function buildHootsuiteScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const member = draft.hootsuite.member.trim();
  const organizationId = draft.hootsuite.organizationId.trim();
  const socialProfileId = draft.hootsuite.socialProfileId.trim();
  const teamId = draft.hootsuite.teamId.trim();
  const messageId = draft.hootsuite.messageId.trim();
  const notes = draft.hootsuite.notes.trim();
  if (!member && !organizationId && !socialProfileId && !teamId && !messageId && !notes) {
    return undefined;
  }
  const sharedEnv = {
    ...(organizationId ? { HOOTSUITE_ORGANIZATION_ID: organizationId } : {}),
    ...(socialProfileId ? { HOOTSUITE_SOCIAL_PROFILE_ID: socialProfileId } : {}),
    ...(teamId ? { HOOTSUITE_TEAM_ID: teamId } : {}),
    ...(messageId ? { HOOTSUITE_MESSAGE_ID: messageId } : {}),
  };
  const resolvedEnv = Object.keys(sharedEnv).length > 0 ? sharedEnv : undefined;
  const commandDefaults = buildCommandDefaults({
    "me.read": {
      env: resolvedEnv,
    },
    "organization.list": {
      env: resolvedEnv,
    },
    "organization.read": {
      positional: organizationId ? [organizationId] : undefined,
      env: resolvedEnv,
    },
    "social_profile.list": {
      options: organizationId ? { organizationId } : undefined,
      env: resolvedEnv,
    },
    "social_profile.read": {
      positional: socialProfileId ? [socialProfileId] : undefined,
      env: resolvedEnv,
    },
    "team.list": {
      options: organizationId ? { organizationId } : undefined,
      env: resolvedEnv,
    },
    "team.read": {
      positional: teamId ? [teamId] : undefined,
      env: resolvedEnv,
    },
    "message.list": {
      options: {
        limit: 25,
        ...(socialProfileId ? { socialProfileId } : {}),
      },
      env: resolvedEnv,
    },
    "message.read": {
      positional: messageId ? [messageId] : undefined,
      env: resolvedEnv,
    },
  });
  const summary = describeHootsuiteScope(draft);
  return {
    summary: summary || undefined,
    member: member || undefined,
    organizationId: organizationId || undefined,
    socialProfileId: socialProfileId || undefined,
    teamId: teamId || undefined,
    messageId: messageId || undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function buildElevenLabsScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const voiceId = draft.elevenlabs.voiceId.trim();
  const modelId = draft.elevenlabs.modelId.trim();
  const historyItemId = draft.elevenlabs.historyItemId.trim();
  const notes = draft.elevenlabs.notes.trim();
  if (!voiceId && !modelId && !historyItemId && !notes) {
    return undefined;
  }
  const sharedEnv = {
    ...(voiceId ? { ELEVENLABS_VOICE_ID: voiceId } : {}),
    ...(modelId ? { ELEVENLABS_MODEL_ID: modelId } : {}),
    ...(historyItemId ? { ELEVENLABS_HISTORY_ITEM_ID: historyItemId } : {}),
  };
  const resolvedEnv = Object.keys(sharedEnv).length > 0 ? sharedEnv : undefined;
  const commandDefaults = buildCommandDefaults({
    "voice.list": {
      options: { pageSize: 20 },
      env: resolvedEnv,
    },
    "voice.read": {
      positional: voiceId ? [voiceId] : undefined,
      env: resolvedEnv,
    },
    "model.list": {
      env: resolvedEnv,
    },
    "history.list": {
      options: { pageSize: 20 },
      env: resolvedEnv,
    },
    "history.read": {
      positional: historyItemId ? [historyItemId] : undefined,
      env: resolvedEnv,
    },
    "user.read": {
      env: resolvedEnv,
    },
    synthesize: {
      env: resolvedEnv,
    },
  });
  const summary = describeElevenLabsScope(draft);
  return {
    summary: summary || undefined,
    voiceId: voiceId || undefined,
    modelId: modelId || undefined,
    historyItemId: historyItemId || undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function buildQuickBooksScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const companyRealm = draft.quickbooks.companyRealm.trim();
  const accountCues = parseDelimitedList(draft.quickbooks.accountCues);
  const dateWindow = draft.quickbooks.dateWindow.trim();
  const parsedDateWindow = parseQuickBooksDateWindow(dateWindow);
  const notes = draft.quickbooks.notes.trim();
  if (!companyRealm && accountCues.length === 0 && !dateWindow && !notes) {
    return undefined;
  }
  const transactionListOptions = parsedDateWindow ? { ...parsedDateWindow } : undefined;
  const commandDefaults = buildCommandDefaults({
    "company.read": {
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
    "customer.list": {
      positional: accountCues.length > 0 ? accountCues : undefined,
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
    "customer.search": {
      positional: accountCues.length > 0 ? accountCues : undefined,
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
    "vendor.list": {
      positional: accountCues.length > 0 ? accountCues : undefined,
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
    "vendor.search": {
      positional: accountCues.length > 0 ? accountCues : undefined,
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
    "invoice.list": {
      positional: accountCues.length > 0 ? accountCues : undefined,
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
    "invoice.search": {
      positional: accountCues.length > 0 ? accountCues : undefined,
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
    "bill.list": {
      positional: accountCues.length > 0 ? accountCues : undefined,
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
    "bill.search": {
      positional: accountCues.length > 0 ? accountCues : undefined,
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
    "payment.list": {
      positional: accountCues.length > 0 ? accountCues : undefined,
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
    "account.list": {
      positional: accountCues.length > 0 ? accountCues : undefined,
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
    "transaction.list": {
      positional: accountCues.length > 0 ? accountCues : undefined,
      options: transactionListOptions,
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
    "transaction.search": {
      positional: accountCues.length > 0 ? accountCues : undefined,
      options: transactionListOptions,
      env: companyRealm ? { QBO_REALM_ID: companyRealm } : undefined,
    },
  });
  const summary = describeQuickBooksScope(draft);
  return {
    summary: summary || undefined,
    companyRealm: companyRealm || undefined,
    accountCues: accountCues.length > 0 ? accountCues : undefined,
    dateWindow: dateWindow || undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function buildN8NScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const workspaceName = draft.n8n.workspaceName.trim();
  const workflowId = draft.n8n.workflowId.trim();
  const workflowName = draft.n8n.workflowName.trim();
  const workflowStatus = draft.n8n.workflowStatus.trim();
  const triggerEvent = draft.n8n.triggerEvent.trim();
  const triggerPayload = draft.n8n.triggerPayload.trim();
  const triggerPayloadArgs = buildTriggerPayloadArgs(triggerPayload, {
    allowJsonPassthrough: false,
  }).args;
  const notes = draft.n8n.notes.trim();
  if (
    !workspaceName &&
    !workflowId &&
    !workflowName &&
    !workflowStatus &&
    !triggerEvent &&
    !triggerPayload &&
    !notes
  ) {
    return undefined;
  }
  const env = {
    ...(workspaceName ? { N8N_WORKSPACE_NAME: workspaceName } : {}),
    ...(workflowId ? { N8N_WORKFLOW_ID: workflowId } : {}),
    ...(workflowName ? { N8N_WORKFLOW_NAME: workflowName } : {}),
    ...(workflowStatus ? { N8N_WORKFLOW_STATUS: workflowStatus } : {}),
  };
  const resolvedEnv = Object.keys(env).length > 0 ? env : undefined;
  const commandDefaults = buildCommandDefaults({
    "workflow.list": {
      options: workflowStatus ? { status: workflowStatus, limit: 20 } : { limit: 20 },
      env: resolvedEnv,
    },
    "workflow.status": {
      positional: workflowId ? [workflowId] : undefined,
      options: workflowStatus ? { status: workflowStatus } : undefined,
      env: resolvedEnv,
    },
    "workflow.trigger": {
      positional: workflowId ? [workflowId] : undefined,
      options: { event: triggerEvent || "manual" },
      args: triggerPayloadArgs,
      env: resolvedEnv,
    },
  });
  const summary = describeN8NScope(draft);
  return {
    summary: summary || undefined,
    workspaceName: workspaceName || undefined,
    workflowId: workflowId || undefined,
    workflowName: workflowName || undefined,
    workflowStatus: workflowStatus || undefined,
    triggerEvent: triggerEvent || undefined,
    triggerPayload: triggerPayload || undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function buildZapierScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const workspaceName = draft.zapier.workspaceName.trim();
  const zapId = draft.zapier.zapId.trim();
  const zapName = draft.zapier.zapName.trim();
  const zapStatus = draft.zapier.zapStatus.trim();
  const triggerEvent = draft.zapier.triggerEvent.trim();
  const triggerPayload = draft.zapier.triggerPayload.trim();
  const triggerPayloadArgs = buildTriggerPayloadArgs(triggerPayload, {
    allowJsonPassthrough: true,
  }).args;
  const notes = draft.zapier.notes.trim();
  if (
    !workspaceName &&
    !zapId &&
    !zapName &&
    !zapStatus &&
    !triggerEvent &&
    !triggerPayload &&
    !notes
  ) {
    return undefined;
  }
  const env = {
    ...(workspaceName ? { ZAPIER_WORKSPACE_NAME: workspaceName } : {}),
    ...(zapId ? { ZAPIER_ZAP_ID: zapId } : {}),
    ...(zapName ? { ZAPIER_ZAP_NAME: zapName } : {}),
    ...(zapStatus ? { ZAPIER_ZAP_STATUS: zapStatus } : {}),
  };
  const resolvedEnv = Object.keys(env).length > 0 ? env : undefined;
  const commandDefaults = buildCommandDefaults({
    "zap.list": {
      options: zapStatus ? { status: zapStatus, limit: 20 } : { limit: 20 },
      env: resolvedEnv,
    },
    "zap.status": {
      positional: zapId ? [zapId] : undefined,
      options: zapStatus ? { status: zapStatus } : undefined,
      env: resolvedEnv,
    },
    "zap.trigger": {
      positional: zapId ? [zapId] : undefined,
      options: { event: triggerEvent || "manual" },
      args: triggerPayloadArgs,
      env: resolvedEnv,
    },
  });
  const summary = describeZapierScope(draft);
  return {
    summary: summary || undefined,
    workspaceName: workspaceName || undefined,
    zapId: zapId || undefined,
    zapName: zapName || undefined,
    zapStatus: zapStatus || undefined,
    triggerEvent: triggerEvent || undefined,
    triggerPayload: triggerPayload || undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function buildShopifyScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const shopDomain = draft.shopify.shopDomain.trim();
  const productId = draft.shopify.productId.trim();
  const productStatus = draft.shopify.productStatus.trim();
  const orderId = draft.shopify.orderId.trim();
  const orderStatus = draft.shopify.orderStatus.trim();
  const customerEmail = draft.shopify.customerEmail.trim();
  const createdAfter = draft.shopify.createdAfter.trim();
  const createdBefore = draft.shopify.createdBefore.trim();
  const notes = draft.shopify.notes.trim();
  if (
    !shopDomain &&
    !productId &&
    !productStatus &&
    !orderId &&
    !orderStatus &&
    !customerEmail &&
    !createdAfter &&
    !createdBefore &&
    !notes
  ) {
    return undefined;
  }
  const sharedEnv = {
    ...(shopDomain ? { SHOPIFY_SHOP_DOMAIN: shopDomain } : {}),
    ...(productStatus ? { SHOPIFY_PRODUCT_STATUS: productStatus } : {}),
    ...(orderStatus ? { SHOPIFY_ORDER_STATUS: orderStatus } : {}),
    ...(customerEmail ? { SHOPIFY_CUSTOMER_EMAIL: customerEmail } : {}),
    ...(createdAfter ? { SHOPIFY_CREATED_AFTER: createdAfter } : {}),
    ...(createdBefore ? { SHOPIFY_CREATED_BEFORE: createdBefore } : {}),
  };
  const commandDefaults = buildCommandDefaults({
    "shop.read": {
      env: shopDomain ? sharedEnv : undefined,
    },
    "product.list": {
      env: shopDomain ? sharedEnv : undefined,
      options: productStatus ? { status: productStatus } : undefined,
    },
    "product.read": {
      env: shopDomain ? sharedEnv : undefined,
      positional: productId ? [productId] : undefined,
    },
    "order.list": {
      env: shopDomain ? sharedEnv : undefined,
      options: {
        ...(orderStatus ? { status: orderStatus } : {}),
        ...(createdAfter ? { createdAfter } : {}),
        ...(createdBefore ? { createdBefore } : {}),
      },
    },
    "order.read": {
      env: shopDomain ? sharedEnv : undefined,
      positional: orderId ? [orderId] : undefined,
    },
    "customer.list": {
      env: shopDomain ? sharedEnv : undefined,
      options: {
        ...(customerEmail ? { email: customerEmail } : {}),
        ...(createdAfter ? { createdAfter } : {}),
        ...(createdBefore ? { createdBefore } : {}),
      },
    },
    "customer.read": {
      env: shopDomain ? sharedEnv : undefined,
    },
  });
  const summary = describeShopifyScope(draft);
  return {
    summary: summary || undefined,
    shopDomain: shopDomain || undefined,
    productId: productId || undefined,
    productStatus: productStatus || undefined,
    orderId: orderId || undefined,
    orderStatus: orderStatus || undefined,
    customerEmail: customerEmail || undefined,
    createdAfter: createdAfter || undefined,
    createdBefore: createdBefore || undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function buildAirtableScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const baseId = draft.airtable.baseId.trim();
  const tableName = draft.airtable.tableName.trim();
  const workspaceId = draft.airtable.workspaceId.trim();
  const notes = draft.airtable.notes.trim();
  if (!baseId && !tableName && !workspaceId && !notes) {
    return undefined;
  }
  const sharedEnv = {
    ...(baseId ? { AIRTABLE_BASE_ID: baseId } : {}),
    ...(tableName ? { AIRTABLE_TABLE_NAME: tableName } : {}),
    ...(workspaceId ? { AIRTABLE_WORKSPACE_ID: workspaceId } : {}),
  };
  const commandDefaults = buildCommandDefaults({
    "base.list": {
      env: Object.keys(sharedEnv).length > 0 ? sharedEnv : undefined,
    },
    "base.read": {
      env: Object.keys(sharedEnv).length > 0 ? sharedEnv : undefined,
    },
    "table.list": {
      env: Object.keys(sharedEnv).length > 0 ? sharedEnv : undefined,
    },
    "table.read": {
      env: Object.keys(sharedEnv).length > 0 ? sharedEnv : undefined,
      positional: tableName ? [tableName] : undefined,
    },
    "record.list": {
      env: Object.keys(sharedEnv).length > 0 ? sharedEnv : undefined,
      options: tableName ? { table: tableName } : undefined,
    },
    "record.search": {
      env: Object.keys(sharedEnv).length > 0 ? sharedEnv : undefined,
      options: tableName ? { table: tableName } : undefined,
    },
    "record.read": {
      env: Object.keys(sharedEnv).length > 0 ? sharedEnv : undefined,
      options: tableName ? { table: tableName } : undefined,
    },
    "record.create_draft": {
      env: Object.keys(sharedEnv).length > 0 ? sharedEnv : undefined,
      options: tableName ? { table: tableName } : undefined,
    },
    "record.update_draft": {
      env: Object.keys(sharedEnv).length > 0 ? sharedEnv : undefined,
      options: tableName ? { table: tableName } : undefined,
    },
  });
  const summary = describeAirtableScope(draft);
  return {
    summary: summary || undefined,
    baseId: baseId || undefined,
    tableName: tableName || undefined,
    workspaceId: workspaceId || undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function buildStripeScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const connectedAccount = draft.stripe.connectedAccount.trim();
  const customerFocus = draft.stripe.customerFocus.trim();
  const invoiceStatus = draft.stripe.invoiceStatus.trim();
  const createdAfter = draft.stripe.createdAfter.trim();
  const createdBefore = draft.stripe.createdBefore.trim();
  const notes = draft.stripe.notes.trim();
  if (
    !connectedAccount &&
    !customerFocus &&
    !invoiceStatus &&
    !createdAfter &&
    !createdBefore &&
    !notes
  ) {
    return undefined;
  }
  const customerId = customerFocus.startsWith("cus_") ? customerFocus : undefined;
  const customerEmail = customerFocus.includes("@") ? customerFocus : undefined;
  const sharedEnv = connectedAccount ? { STRIPE_ACCOUNT_ID: connectedAccount } : undefined;
  const commandDefaults = buildCommandDefaults({
    "balance.read": {
      env: sharedEnv,
    },
    "customer.list": {
      options: customerEmail ? { email: customerEmail } : undefined,
      env: sharedEnv,
    },
    "customer.search": {
      positional: customerFocus ? [customerFocus] : undefined,
      env: sharedEnv,
    },
    "customer.read": {
      positional: customerId ? [customerId] : undefined,
      env: sharedEnv,
    },
    "payment.list": {
      options: {
        ...(customerId ? { customerId } : {}),
        ...(createdAfter ? { createdAfter } : {}),
        ...(createdBefore ? { createdBefore } : {}),
      },
      env: sharedEnv,
    },
    "invoice.list": {
      options: {
        ...(customerId ? { customerId } : {}),
        ...(invoiceStatus ? { status: invoiceStatus } : {}),
        ...(createdAfter ? { createdAfter } : {}),
        ...(createdBefore ? { createdBefore } : {}),
      },
      env: sharedEnv,
    },
    "invoice.read": {
      env: sharedEnv,
    },
    "payment.read": {
      env: sharedEnv,
    },
  });
  const summary = describeStripeScope(draft);
  return {
    summary: summary || undefined,
    connectedAccount: connectedAccount || undefined,
    customerFocus: customerFocus || undefined,
    invoiceStatus: invoiceStatus || undefined,
    createdAfter: createdAfter || undefined,
    createdBefore: createdBefore || undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function buildNotionScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const databaseId = draft.notion.databaseId.trim();
  const pageId = draft.notion.pageId.trim();
  const searchQuery = draft.notion.searchQuery.trim();
  const notes = draft.notion.notes.trim();
  if (!databaseId && !pageId && !searchQuery && !notes) {
    return undefined;
  }
  const commandDefaults = buildCommandDefaults({
    "database.query": {
      positional: databaseId ? [databaseId] : undefined,
    },
    "page.read": {
      positional: pageId ? [pageId] : undefined,
    },
    "page.update": {
      positional: pageId ? [pageId] : undefined,
    },
    "search.query": {
      positional: searchQuery ? [searchQuery] : undefined,
    },
  });
  const summary = describeNotionScope(draft);
  return {
    summary: summary || undefined,
    databaseId: databaseId || undefined,
    pageId: pageId || undefined,
    searchQuery: searchQuery || undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function describeStripeScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const connectedAccount = draft.stripe.connectedAccount.trim();
  if (connectedAccount) parts.push(`account ${connectedAccount}`);
  const customerFocus = draft.stripe.customerFocus.trim();
  if (customerFocus) parts.push(`customer ${customerFocus}`);
  const invoiceStatus = draft.stripe.invoiceStatus.trim();
  if (invoiceStatus) parts.push(`invoice status ${invoiceStatus}`);
  const createdAfter = draft.stripe.createdAfter.trim();
  if (createdAfter) parts.push(`after ${createdAfter}`);
  const createdBefore = draft.stripe.createdBefore.trim();
  if (createdBefore) parts.push(`before ${createdBefore}`);
  return parts.join(" · ");
}

function describeNotionScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const databaseId = draft.notion.databaseId.trim();
  if (databaseId) parts.push(`database ${databaseId}`);
  const pageId = draft.notion.pageId.trim();
  if (pageId) parts.push(`page ${pageId}`);
  const searchQuery = draft.notion.searchQuery.trim();
  if (searchQuery) parts.push(`search ${searchQuery}`);
  return parts.join(" · ");
}

function looksLikeShopifyDomain(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return normalized.endsWith(".myshopify.com") || normalized.includes(".");
}

function describeShopifyScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const shopDomain = draft.shopify.shopDomain.trim();
  if (shopDomain) parts.push(`shop ${shopDomain}`);
  const productId = draft.shopify.productId.trim();
  if (productId) parts.push(`product ${productId}`);
  const productStatus = draft.shopify.productStatus.trim();
  if (productStatus) parts.push(`product status ${productStatus}`);
  const orderId = draft.shopify.orderId.trim();
  if (orderId) parts.push(`order ${orderId}`);
  const orderStatus = draft.shopify.orderStatus.trim();
  if (orderStatus) parts.push(`order status ${orderStatus}`);
  const customerEmail = draft.shopify.customerEmail.trim();
  if (customerEmail) parts.push(`customer ${customerEmail}`);
  const createdAfter = draft.shopify.createdAfter.trim();
  if (createdAfter) parts.push(`after ${createdAfter}`);
  const createdBefore = draft.shopify.createdBefore.trim();
  if (createdBefore) parts.push(`before ${createdBefore}`);
  return parts.join(" · ");
}

function describeAirtableScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const baseId = draft.airtable.baseId.trim();
  if (baseId) parts.push(`base ${baseId}`);
  const tableName = draft.airtable.tableName.trim();
  if (tableName) parts.push(`table ${tableName}`);
  const workspaceId = draft.airtable.workspaceId.trim();
  if (workspaceId) parts.push(`workspace ${workspaceId}`);
  return parts.join(" · ");
}

function getShopifyScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-shopify")) {
    return null;
  }
  const shopDomain = draft.shopify.shopDomain.trim();
  const productId = draft.shopify.productId.trim();
  const orderId = draft.shopify.orderId.trim();
  const orderStatus = draft.shopify.orderStatus.trim();
  const customerEmail = draft.shopify.customerEmail.trim();
  const createdAfter = draft.shopify.createdAfter.trim();
  const createdBefore = draft.shopify.createdBefore.trim();
  const commandIds = selectedConnectorCommandIds(draft, "aos-shopify");
  if (!looksLikeShopifyDomain(shopDomain)) {
    return "Shopify needs a concrete shop domain before this worker can launch.";
  }
  if (commandIds.includes("product.read") && !productId) {
    return "Shopify product.read actions need a specific product id before this worker can launch.";
  }
  if (commandIds.includes("order.read") && !orderId) {
    return "Shopify order.read actions need a specific order id before this worker can launch.";
  }
  if (commandIds.includes("order.list") && !orderStatus && !createdAfter && !createdBefore) {
    return "Shopify order list actions need an order status or created date window before this worker can launch.";
  }
  if (commandIds.includes("customer.read")) {
    return "Shopify customer.read actions still need an explicit customer id scope. Use customer list filters for now or wait for customer-id picker support.";
  }
  if (commandIds.includes("customer.list") && !customerEmail && !createdAfter && !createdBefore) {
    return "Shopify customer list actions need a customer email or created date window before this worker can launch.";
  }
  return null;
}

function getAirtableScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-airtable")) {
    return null;
  }
  const baseId = draft.airtable.baseId.trim();
  const tableName = draft.airtable.tableName.trim();
  const commandIds = selectedConnectorCommandIds(draft, "aos-airtable");
  const usesBaseScoped =
    commandIds.length === 0 ||
    commandIds.includes("base.read") ||
    commandIds.includes("table.list") ||
    commandIds.includes("table.read") ||
    commandIds.some((id) => id.startsWith("record."));
  const usesTableScoped =
    commandIds.includes("table.read") || commandIds.some((id) => id.startsWith("record."));
  if (usesBaseScoped && !baseId) {
    return "Airtable needs a base id before this worker can launch.";
  }
  if (usesTableScoped && !tableName) {
    return "Airtable table and record actions need a default table name before this worker can launch.";
  }
  return null;
}

function getStripeScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-stripe")) {
    return null;
  }
  const customerFocus = draft.stripe.customerFocus.trim();
  const invoiceStatus = draft.stripe.invoiceStatus.trim();
  const createdAfter = draft.stripe.createdAfter.trim();
  const createdBefore = draft.stripe.createdBefore.trim();
  const commandIds = selectedConnectorCommandIds(draft, "aos-stripe");
  if (commandIds.length === 0) {
    return null;
  }
  const nonBalanceCommands = commandIds.filter((id) => id !== "balance.read");
  if (nonBalanceCommands.length === 0) {
    return null;
  }
  if (
    commandIds.some(
      (id) => id === "customer.list" || id === "customer.search" || id === "customer.read",
    ) &&
    !customerFocus
  ) {
    return "Stripe customer actions need a customer id, email, or search cue before this worker can launch.";
  }
  if (commandIds.includes("payment.list") && !customerFocus && !createdAfter && !createdBefore) {
    return "Stripe payment actions need a customer cue or created date range before this worker can launch.";
  }
  if (
    commandIds.includes("invoice.list") &&
    !customerFocus &&
    !invoiceStatus &&
    !createdAfter &&
    !createdBefore
  ) {
    return "Stripe invoice actions need a customer cue, invoice status, or created date range before this worker can launch.";
  }
  return null;
}

function getNotionScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-notion")) {
    return null;
  }
  const databaseId = draft.notion.databaseId.trim();
  const pageId = draft.notion.pageId.trim();
  const searchQuery = draft.notion.searchQuery.trim();
  const commandIds = selectedConnectorCommandIds(draft, "aos-notion");
  if (commandIds.length === 0 && !databaseId && !pageId && !searchQuery) {
    return "Notion needs a database, page, or search scope before this worker can launch.";
  }
  if (commandIds.includes("database.query") && !databaseId) {
    return "Notion database actions need a database id before this worker can launch.";
  }
  if ((commandIds.includes("page.read") || commandIds.includes("page.update")) && !pageId) {
    return "Notion page actions need a page id before this worker can launch.";
  }
  if (commandIds.includes("search.query") && !searchQuery) {
    return "Notion search actions need a search query before this worker can launch.";
  }
  return null;
}

function isMeaningfulQuickBooksCompanyRealm(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return ![
    "any",
    "all",
    "company",
    "account",
    "realm",
    "quickbooks",
    "quickbooks online",
    "qbo",
    "organization",
    "org",
  ].includes(normalized);
}

function describeMailchimpScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const serverPrefix = draft.mailchimp.serverPrefix.trim();
  if (serverPrefix) parts.push(`server ${serverPrefix}`);
  const audienceId = draft.mailchimp.audienceId.trim();
  if (audienceId) parts.push(`audience ${audienceId}`);
  const campaignId = draft.mailchimp.campaignId.trim();
  if (campaignId) parts.push(`campaign ${campaignId}`);
  const memberEmail = draft.mailchimp.memberEmail.trim();
  if (memberEmail) parts.push(`member ${memberEmail}`);
  return parts.join(" · ");
}

function describeKlaviyoScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const account = draft.klaviyo.account.trim();
  if (account) parts.push(`account ${account}`);
  const listId = draft.klaviyo.listId.trim();
  if (listId) parts.push(`list ${listId}`);
  const profileId = draft.klaviyo.profileId.trim();
  if (profileId) parts.push(`profile ${profileId}`);
  const profileEmail = draft.klaviyo.profileEmail.trim();
  if (profileEmail) parts.push(`email ${profileEmail}`);
  const campaignId = draft.klaviyo.campaignId.trim();
  if (campaignId) parts.push(`campaign ${campaignId}`);
  return parts.join(" · ");
}

function describeBufferScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const account = draft.buffer.account.trim();
  if (account) parts.push(`account ${account}`);
  const channelId = draft.buffer.channelId.trim();
  if (channelId) parts.push(`channel ${channelId}`);
  const profileId = draft.buffer.profileId.trim();
  if (profileId) parts.push(`profile ${profileId}`);
  const postId = draft.buffer.postId.trim();
  if (postId) parts.push(`post ${postId}`);
  const postText = draft.buffer.postText.trim();
  if (postText) parts.push(`draft text set`);
  return parts.join(" · ");
}

function describeHootsuiteScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const member = draft.hootsuite.member.trim();
  if (member) parts.push(`member ${member}`);
  const organizationId = draft.hootsuite.organizationId.trim();
  if (organizationId) parts.push(`org ${organizationId}`);
  const socialProfileId = draft.hootsuite.socialProfileId.trim();
  if (socialProfileId) parts.push(`social profile ${socialProfileId}`);
  const teamId = draft.hootsuite.teamId.trim();
  if (teamId) parts.push(`team ${teamId}`);
  const messageId = draft.hootsuite.messageId.trim();
  if (messageId) parts.push(`message ${messageId}`);
  return parts.join(" · ");
}

function describeElevenLabsScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const voiceId = draft.elevenlabs.voiceId.trim();
  if (voiceId) parts.push(`voice ${voiceId}`);
  const modelId = draft.elevenlabs.modelId.trim();
  if (modelId) parts.push(`model ${modelId}`);
  const historyItemId = draft.elevenlabs.historyItemId.trim();
  if (historyItemId) parts.push(`history ${historyItemId}`);
  return parts.join(" · ");
}

function describeQuickBooksScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const companyRealm = draft.quickbooks.companyRealm.trim();
  if (companyRealm) parts.push(`company/realm ${companyRealm}`);
  const accountCues = parseDelimitedList(draft.quickbooks.accountCues);
  if (accountCues.length > 0) parts.push(`account cues ${accountCues.join(", ")}`);
  const dateWindow = draft.quickbooks.dateWindow.trim();
  if (dateWindow) parts.push(`date window ${dateWindow}`);
  return parts.join(" · ");
}

function describeN8NScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const workspaceName = draft.n8n.workspaceName.trim();
  if (workspaceName) parts.push(`workspace ${workspaceName}`);
  const workflowName = draft.n8n.workflowName.trim();
  const workflowId = draft.n8n.workflowId.trim();
  if (workflowName) {
    parts.push(`workflow ${workflowName}`);
  } else if (workflowId) {
    parts.push(`workflow ${workflowId}`);
  }
  const workflowStatus = draft.n8n.workflowStatus.trim();
  if (workflowStatus) parts.push(`status ${workflowStatus}`);
  return parts.join(" · ");
}

function describeZapierScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const workspaceName = draft.zapier.workspaceName.trim();
  if (workspaceName) parts.push(`workspace ${workspaceName}`);
  const zapName = draft.zapier.zapName.trim();
  const zapId = draft.zapier.zapId.trim();
  if (zapName) {
    parts.push(`zap ${zapName}`);
  } else if (zapId) {
    parts.push(`zap ${zapId}`);
  }
  const zapStatus = draft.zapier.zapStatus.trim();
  if (zapStatus) parts.push(`status ${zapStatus}`);
  return parts.join(" · ");
}

function getMailchimpScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-mailchimp")) {
    return null;
  }
  const audienceId = draft.mailchimp.audienceId.trim();
  const campaignId = draft.mailchimp.campaignId.trim();
  const memberEmail = draft.mailchimp.memberEmail.trim();
  const commandIds = selectedConnectorCommandIds(draft, "aos-mailchimp");
  if (
    commandIds.some(
      (id) => id === "audience.read" || id === "member.list" || id === "member.read",
    ) &&
    !audienceId
  ) {
    return "Mailchimp audience and member actions need an audience id before this worker can launch.";
  }
  if (commandIds.includes("member.read") && !memberEmail) {
    return "Mailchimp member.read needs a member email before this worker can launch.";
  }
  if (commandIds.some((id) => id === "campaign.read" || id === "report.read") && !campaignId) {
    return "Mailchimp campaign and report reads need a campaign id before this worker can launch.";
  }
  return null;
}

function getKlaviyoScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-klaviyo")) {
    return null;
  }
  const listId = draft.klaviyo.listId.trim();
  const profileId = draft.klaviyo.profileId.trim();
  const profileEmail = draft.klaviyo.profileEmail.trim();
  const campaignId = draft.klaviyo.campaignId.trim();
  const commandIds = selectedConnectorCommandIds(draft, "aos-klaviyo");
  if (commandIds.includes("list.read") && !listId) {
    return "Klaviyo list.read needs a list id before this worker can launch.";
  }
  if (commandIds.includes("profile.list") && !listId && !profileEmail) {
    return "Klaviyo profile.list needs a list id or profile email cue before this worker can launch.";
  }
  if (commandIds.includes("profile.read") && !profileId && !profileEmail) {
    return "Klaviyo profile.read needs a profile id or profile email before this worker can launch.";
  }
  if (commandIds.includes("campaign.read") && !campaignId) {
    return "Klaviyo campaign.read needs a campaign id before this worker can launch.";
  }
  return null;
}

function getBufferScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-buffer")) {
    return null;
  }
  const channelId = draft.buffer.channelId.trim();
  const profileId = draft.buffer.profileId.trim();
  const postId = draft.buffer.postId.trim();
  const postText = draft.buffer.postText.trim();
  const commandIds = selectedConnectorCommandIds(draft, "aos-buffer");
  if (commandIds.includes("channel.read") && !channelId) {
    return "Buffer channel.read needs a channel id before this worker can launch.";
  }
  if (commandIds.includes("profile.read") && !profileId) {
    return "Buffer profile.read needs a profile id before this worker can launch.";
  }
  if (commandIds.includes("post.list") && !profileId) {
    return "Buffer post.list needs a profile id before this worker can launch.";
  }
  if (commandIds.includes("post.read") && !postId) {
    return "Buffer post.read needs a post id before this worker can launch.";
  }
  if (
    (commandIds.includes("post.create_draft") || commandIds.includes("post.schedule")) &&
    !channelId
  ) {
    return "Buffer post draft and schedule actions need a channel id before this worker can launch.";
  }
  if (
    (commandIds.includes("post.create_draft") || commandIds.includes("post.schedule")) &&
    !postText
  ) {
    return "Buffer post draft and schedule actions need post text before this worker can launch.";
  }
  return null;
}

function getHootsuiteScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-hootsuite")) {
    return null;
  }
  const organizationId = draft.hootsuite.organizationId.trim();
  const socialProfileId = draft.hootsuite.socialProfileId.trim();
  const teamId = draft.hootsuite.teamId.trim();
  const messageId = draft.hootsuite.messageId.trim();
  const commandIds = selectedConnectorCommandIds(draft, "aos-hootsuite");
  if (
    (commandIds.includes("organization.read") || commandIds.includes("team.list")) &&
    !organizationId
  ) {
    return "Hootsuite organization and team actions need an organization id before this worker can launch.";
  }
  if (commandIds.includes("social_profile.read") && !socialProfileId) {
    return "Hootsuite social_profile.read needs a social profile id before this worker can launch.";
  }
  if (commandIds.includes("team.read") && !teamId) {
    return "Hootsuite team.read needs a team id before this worker can launch.";
  }
  if (commandIds.includes("message.list") && !socialProfileId) {
    return "Hootsuite message.list needs a social profile id before this worker can launch.";
  }
  if (commandIds.includes("message.read") && !messageId) {
    return "Hootsuite message.read needs a message id before this worker can launch.";
  }
  return null;
}

function getElevenLabsScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-elevenlabs")) {
    return null;
  }
  const voiceId = draft.elevenlabs.voiceId.trim();
  const modelId = draft.elevenlabs.modelId.trim();
  const historyItemId = draft.elevenlabs.historyItemId.trim();
  const commandIds = selectedConnectorCommandIds(draft, "aos-elevenlabs");
  if (commandIds.includes("voice.read") && !voiceId) {
    return "ElevenLabs voice.read needs a voice id before this worker can launch.";
  }
  if (commandIds.includes("history.read") && !historyItemId) {
    return "ElevenLabs history.read needs a history item id before this worker can launch.";
  }
  if (commandIds.includes("synthesize") && !voiceId) {
    return "ElevenLabs synthesize needs a voice id before this worker can launch.";
  }
  if (commandIds.includes("synthesize") && !modelId) {
    return "ElevenLabs synthesize needs a model id before this worker can launch.";
  }
  return null;
}

function getQuickBooksScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-quickbooks")) {
    return null;
  }
  const companyRealm = draft.quickbooks.companyRealm.trim();
  if (!isMeaningfulQuickBooksCompanyRealm(companyRealm)) {
    return "QuickBooks needs a company or realm before this worker can launch.";
  }
  return null;
}

function getN8NScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-n8n")) {
    return null;
  }
  const workspaceName = draft.n8n.workspaceName.trim();
  const workflowId = draft.n8n.workflowId.trim();
  const workflowName = draft.n8n.workflowName.trim();
  const workflowStatus = draft.n8n.workflowStatus.trim();
  const commandIds = selectedConnectorCommandIds(draft, "aos-n8n");
  const workflowTarget = workflowId || workflowName;
  if (
    commandIds.some((id) => id === "workflow.status" || id === "workflow.trigger") &&
    !workflowTarget
  ) {
    return "n8n workflow status or trigger actions need a specific workflow id or workflow name before launch.";
  }
  if (commandIds.includes("workflow.trigger")) {
    const payloadError = buildTriggerPayloadArgs(draft.n8n.triggerPayload, {
      allowJsonPassthrough: false,
    }).error;
    if (payloadError) {
      return `n8n trigger payload is invalid. ${payloadError}`;
    }
  }
  if (!workflowTarget && !workspaceName && !workflowStatus) {
    return "n8n needs a concrete workflow, workspace, or status filter before this worker can launch.";
  }
  return null;
}

function getZapierScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-zapier")) {
    return null;
  }
  const workspaceName = draft.zapier.workspaceName.trim();
  const zapId = draft.zapier.zapId.trim();
  const zapName = draft.zapier.zapName.trim();
  const zapStatus = draft.zapier.zapStatus.trim();
  const commandIds = selectedConnectorCommandIds(draft, "aos-zapier");
  const zapTarget = zapId || zapName;
  if (commandIds.some((id) => id === "zap.status" || id === "zap.trigger") && !zapTarget) {
    return "Zapier status or trigger actions need a specific zap id or zap name before launch.";
  }
  if (commandIds.includes("zap.trigger")) {
    const payloadError = buildTriggerPayloadArgs(draft.zapier.triggerPayload, {
      allowJsonPassthrough: true,
    }).error;
    if (payloadError) {
      return `Zapier trigger payload is invalid. ${payloadError}`;
    }
  }
  if (!zapTarget && !workspaceName && !zapStatus) {
    return "Zapier needs a concrete zap, workspace, or status filter before this worker can launch.";
  }
  return null;
}

function readWordPressScope(flow: Record<string, unknown> | undefined): FlowDraft["wordpress"] {
  const readScopeRecord = (value: unknown): FlowDraft["wordpress"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const typed = value as Record<string, unknown>;
    return {
      siteBaseUrl:
        typeof typed.siteBaseUrl === "string"
          ? typed.siteBaseUrl
          : typeof typed.baseUrl === "string"
            ? typed.baseUrl
            : typeof typed.siteUrl === "string"
              ? typed.siteUrl
              : "",
      postType:
        typeof typed.postType === "string"
          ? typed.postType
          : typeof typed.contentType === "string"
            ? typed.contentType
            : "",
      status: typeof typed.status === "string" ? typed.status : "",
      sectionTaxonomyCues: joinDelimitedList(
        typed.sectionTaxonomyCues ??
          typed.sections ??
          typed.taxonomyCues ??
          typed.taxonomies ??
          typed.categories ??
          typed.tags,
      ),
      notes: typeof typed.notes === "string" ? typed.notes : "",
    };
  };

  const direct = readScopeRecord(flow?.wordpress);
  if (direct) {
    return direct;
  }

  const connectors = Array.isArray(flow?.connectors) ? flow.connectors : [];
  for (const entry of connectors) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry as Record<string, unknown>;
    if (typed.tool !== "aos-wordpress") continue;
    const scoped = readScopeRecord(typed.scope);
    if (scoped) {
      return scoped;
    }
  }

  return createDefaultDraft().wordpress;
}

function buildWordPressScopeMetadata(draft: FlowDraft): Record<string, unknown> | undefined {
  const siteBaseUrl = draft.wordpress.siteBaseUrl.trim();
  const postType = draft.wordpress.postType.trim();
  const status = draft.wordpress.status.trim();
  const sectionTaxonomyCues = parseDelimitedList(draft.wordpress.sectionTaxonomyCues);
  const notes = draft.wordpress.notes.trim();
  if (!siteBaseUrl && !postType && !status && sectionTaxonomyCues.length === 0 && !notes) {
    return undefined;
  }
  const cueSearch = sectionTaxonomyCues.join(" ").trim();
  const commandDefaults = buildCommandDefaults({
    "site.read": {
      env: siteBaseUrl ? { WORDPRESS_BASE_URL: siteBaseUrl } : undefined,
    },
    "post.list": {
      options: status ? { status } : undefined,
      env: siteBaseUrl ? { WORDPRESS_BASE_URL: siteBaseUrl } : undefined,
    },
    "post.search": {
      options: {
        ...(cueSearch ? { query: cueSearch } : {}),
        ...(status ? { status } : {}),
      },
      env: siteBaseUrl ? { WORDPRESS_BASE_URL: siteBaseUrl } : undefined,
    },
    "page.list": {
      options: status ? { status } : undefined,
      env: siteBaseUrl ? { WORDPRESS_BASE_URL: siteBaseUrl } : undefined,
    },
    "page.search": {
      options: {
        ...(cueSearch ? { query: cueSearch } : {}),
        ...(status ? { status } : {}),
      },
      env: siteBaseUrl ? { WORDPRESS_BASE_URL: siteBaseUrl } : undefined,
    },
    "media.list": {
      options: cueSearch ? { search: cueSearch } : undefined,
      env: siteBaseUrl ? { WORDPRESS_BASE_URL: siteBaseUrl } : undefined,
    },
    "taxonomy.list": {
      options: cueSearch ? { search: cueSearch } : undefined,
      env: siteBaseUrl ? { WORDPRESS_BASE_URL: siteBaseUrl } : undefined,
    },
  });
  const summary = describeWordPressScope(draft);
  return {
    summary: summary || undefined,
    siteBaseUrl: siteBaseUrl || undefined,
    postType: postType || undefined,
    status: status || undefined,
    sectionTaxonomyCues: sectionTaxonomyCues.length > 0 ? sectionTaxonomyCues : undefined,
    notes: notes || undefined,
    commandDefaults,
  };
}

function looksLikeWordPressSiteUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /^https?:\/\//.test(normalized) ||
    normalized.startsWith("localhost") ||
    normalized.startsWith("127.") ||
    normalized.includes(".")
  );
}

function isMeaningfulWordPressPostType(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return !["any", "all", "content", "type", "post type", "wordpress", "wp"].includes(normalized);
}

function isMeaningfulWordPressStatus(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return !["any", "all", "status", "content status", "wordpress", "wp"].includes(normalized);
}

function hasMeaningfulWordPressSectionCues(raw: string): boolean {
  const genericCues = new Set([
    "any",
    "all",
    "general",
    "taxonomy",
    "taxonomies",
    "section",
    "sections",
    "category",
    "categories",
    "tag",
    "tags",
    "wordpress",
    "wp",
  ]);
  return parseDelimitedList(raw).some((cue) => !genericCues.has(cue.trim().toLowerCase()));
}

function describeWordPressScope(draft: FlowDraft): string {
  const parts: string[] = [];
  const siteBaseUrl = draft.wordpress.siteBaseUrl.trim();
  if (siteBaseUrl) parts.push(`site ${siteBaseUrl}`);
  const postType = draft.wordpress.postType.trim();
  if (postType) parts.push(`post type ${postType}`);
  const status = draft.wordpress.status.trim();
  if (status) parts.push(`status ${status}`);
  const sectionTaxonomyCues = parseDelimitedList(draft.wordpress.sectionTaxonomyCues);
  if (sectionTaxonomyCues.length > 0) {
    parts.push(`sections/taxonomy ${sectionTaxonomyCues.join(", ")}`);
  }
  return parts.join(" · ");
}

function getWordPressScopeBlocker(draft: FlowDraft): string | null {
  if (!draft.connectors.selected.includes("aos-wordpress")) {
    return null;
  }
  const siteBaseUrl = draft.wordpress.siteBaseUrl.trim();
  const postType = draft.wordpress.postType.trim();
  const status = draft.wordpress.status.trim();
  const sectionTaxonomyCues = parseDelimitedList(draft.wordpress.sectionTaxonomyCues);
  if (!looksLikeWordPressSiteUrl(siteBaseUrl)) {
    return "WordPress needs a site or base URL before this worker can launch.";
  }
  if (!isMeaningfulWordPressPostType(postType)) {
    return "WordPress needs a post type before this worker can launch.";
  }
  if (!isMeaningfulWordPressStatus(status)) {
    return "WordPress needs a content status before this worker can launch.";
  }
  if (!hasMeaningfulWordPressSectionCues(sectionTaxonomyCues.join(", "))) {
    return "WordPress needs at least one section or taxonomy cue before this worker can launch.";
  }
  return null;
}

function describeConnectorScope(tool: string, draft: FlowDraft): string {
  switch (tool) {
    case "aos-google":
      return describeGoogleScope(draft);
    case "aos-slack":
      return describeSlackScope(draft);
    case "aos-m365":
      return describeM365Scope(draft);
    case "aos-hubspot":
      return describeHubSpotScope(draft);
    case "aos-mailchimp":
      return describeMailchimpScope(draft);
    case "aos-klaviyo":
      return describeKlaviyoScope(draft);
    case "aos-buffer":
      return describeBufferScope(draft);
    case "aos-hootsuite":
      return describeHootsuiteScope(draft);
    case "aos-elevenlabs":
      return describeElevenLabsScope(draft);
    case "aos-quickbooks":
      return describeQuickBooksScope(draft);
    case "aos-n8n":
      return describeN8NScope(draft);
    case "aos-zapier":
      return describeZapierScope(draft);
    case "aos-shopify":
      return describeShopifyScope(draft);
    case "aos-airtable":
      return describeAirtableScope(draft);
    case "aos-stripe":
      return describeStripeScope(draft);
    case "aos-notion":
      return describeNotionScope(draft);
    case "aos-wordpress":
      return describeWordPressScope(draft);
    default:
      return "";
  }
}

function getConnectorScopeBlocker(tool: string, draft: FlowDraft): string | null {
  switch (tool) {
    case "aos-google":
      return getGoogleScopeBlocker(draft);
    case "aos-slack":
      return getSlackScopeBlocker(draft);
    case "aos-m365":
      return getM365ScopeBlocker(draft);
    case "aos-hubspot":
      return getHubSpotScopeBlocker(draft);
    case "aos-mailchimp":
      return getMailchimpScopeBlocker(draft);
    case "aos-klaviyo":
      return getKlaviyoScopeBlocker(draft);
    case "aos-buffer":
      return getBufferScopeBlocker(draft);
    case "aos-hootsuite":
      return getHootsuiteScopeBlocker(draft);
    case "aos-elevenlabs":
      return getElevenLabsScopeBlocker(draft);
    case "aos-quickbooks":
      return getQuickBooksScopeBlocker(draft);
    case "aos-n8n":
      return getN8NScopeBlocker(draft);
    case "aos-zapier":
      return getZapierScopeBlocker(draft);
    case "aos-shopify":
      return getShopifyScopeBlocker(draft);
    case "aos-airtable":
      return getAirtableScopeBlocker(draft);
    case "aos-stripe":
      return getStripeScopeBlocker(draft);
    case "aos-notion":
      return getNotionScopeBlocker(draft);
    case "aos-wordpress":
      return getWordPressScopeBlocker(draft);
    default:
      return null;
  }
}

function buildConnectorScopeMetadata(
  tool: string,
  draft: FlowDraft,
): Record<string, unknown> | undefined {
  switch (tool) {
    case "aos-google":
      return buildGoogleScopeMetadata(draft);
    case "aos-slack":
      return buildSlackScopeMetadata(draft);
    case "aos-m365":
      return buildM365ScopeMetadata(draft);
    case "aos-hubspot":
      return buildHubSpotScopeMetadata(draft);
    case "aos-mailchimp":
      return buildMailchimpScopeMetadata(draft);
    case "aos-klaviyo":
      return buildKlaviyoScopeMetadata(draft);
    case "aos-buffer":
      return buildBufferScopeMetadata(draft);
    case "aos-hootsuite":
      return buildHootsuiteScopeMetadata(draft);
    case "aos-elevenlabs":
      return buildElevenLabsScopeMetadata(draft);
    case "aos-quickbooks":
      return buildQuickBooksScopeMetadata(draft);
    case "aos-n8n":
      return buildN8NScopeMetadata(draft);
    case "aos-zapier":
      return buildZapierScopeMetadata(draft);
    case "aos-shopify":
      return buildShopifyScopeMetadata(draft);
    case "aos-airtable":
      return buildAirtableScopeMetadata(draft);
    case "aos-stripe":
      return buildStripeScopeMetadata(draft);
    case "aos-notion":
      return buildNotionScopeMetadata(draft);
    case "aos-wordpress":
      return buildWordPressScopeMetadata(draft);
    default:
      return undefined;
  }
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
      hubspot: buildHubSpotScopeMetadata(draft),
      connectors: [],
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
      hubspot: buildHubSpotScopeMetadata(draft),
      connectors: [],
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
  scope?: Record<string, unknown>;
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
      const scope =
        typed.scope && typeof typed.scope === "object" && !Array.isArray(typed.scope)
          ? (typed.scope as Record<string, unknown>)
          : undefined;
      const selection: {
        tool: string;
        selectedCommands: string[];
        scope?: Record<string, unknown>;
      } = { tool, selectedCommands };
      if (scope) {
        selection.scope = scope;
      }
      return selection;
    })
    .filter(
      (
        entry,
      ): entry is { tool: string; selectedCommands: string[]; scope?: Record<string, unknown> } =>
        entry !== null,
    );
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
  scope?: Record<string, unknown>;
}> {
  return draft.connectors.selected.map((tool) => {
    const connector = connectorCatalog.find((entry) => entry.tool === tool);
    const selectedCommands = draft.connectors.selectedActions
      .map((value) => splitQualifiedConnectorAction(value))
      .filter((entry): entry is { tool: string; commandId: string } => Boolean(entry))
      .filter((entry) => entry.tool === tool)
      .map((entry) => entry.commandId);
    const scope = buildConnectorScopeMetadata(tool, draft);
    return {
      tool,
      label: connector?.label,
      category: connector?.category,
      installState: connector?.installState,
      selectedCommands,
      scope,
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

function buildSourceReadiness(draft: FlowDraft): SourceReadiness {
  const blockers: string[] = [];
  const sourceLabel = draft.inputs.sourceLabel.trim();
  const eventTriggers = parseDelimitedList(draft.inputs.eventTriggers);
  const cadence = Number.parseInt(draft.inputs.cadenceMinutes, 10);

  if (!sourceLabel) {
    blockers.push("Name the source this worker watches.");
  }
  if (draft.inputs.sourceKind !== "event" && (!Number.isFinite(cadence) || cadence <= 0)) {
    blockers.push("Set a valid worker cadence.");
  }
  if (draft.inputs.sourceKind !== "schedule" && eventTriggers.length === 0) {
    blockers.push("Add at least one event trigger.");
  }

  if (blockers.length > 0) {
    return {
      ok: false,
      summary: "This worker's source is not fully defined yet.",
      detail: blockers.join(" "),
      blockers,
    };
  }

  const triggerDetail =
    draft.inputs.sourceKind === "schedule"
      ? `Scheduled every ${draft.inputs.cadenceMinutes.trim() || "5"} minutes.`
      : draft.inputs.sourceKind === "event"
        ? `${eventTriggers.length} event trigger${eventTriggers.length === 1 ? "" : "s"} configured.`
        : `Scheduled every ${draft.inputs.cadenceMinutes.trim() || "5"} minutes with ${eventTriggers.length} event trigger${eventTriggers.length === 1 ? "" : "s"}.`;

  return {
    ok: true,
    summary: `Source ready: ${sourceLabel}.`,
    detail: triggerDetail,
    blockers: [],
  };
}

function buildSelectedConnectorReadiness(
  selectedConnectors: ConnectorCatalogEntry[],
  selectedActions: Array<{ tool: string; commandId: string }>,
): SelectedConnectorReadiness[] {
  return selectedConnectors.map((connector) => {
    const selectedCommandIds = selectedActions
      .filter((entry) => entry.tool === connector.tool)
      .map((entry) => entry.commandId);
    const blocking = selectedCommandIds.length > 0 && connector.installState !== "ready";
    const actionSummary =
      selectedCommandIds.length > 0
        ? `${selectedCommandIds.length} selected action${selectedCommandIds.length === 1 ? "" : "s"}`
        : "No connector actions selected yet";
    const stateDetail =
      connector.status.detail ||
      (connector.installState === "ready"
        ? "Connector runtime is available."
        : connector.installState === "needs-setup"
          ? "Connector exists but still needs setup."
          : connector.installState === "repo-only"
            ? "Connector scaffold exists but the runtime is not installed."
            : "Connector is currently failing validation.");
    return {
      tool: connector.tool,
      label: connector.label,
      installState: connector.installState,
      statusLabel: connector.status.label,
      detail: `${actionSummary}. ${stateDetail}`,
      selectedCommandIds,
      blocking,
    };
  });
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
    draft.google.gmailSenders = "VIP sender list";
    draft.google.gmailLabels = "INBOX";
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
  draft.slack.mentionTargets = "Jason";
  draft.slack.keywordTriggers = "urgent, blocker, outage";
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
  const slackConnector = params.connectorCatalog.find((entry) => entry.tool === "aos-slack");
  if (slackConnector) {
    draft.connectors.selected = [slackConnector.tool];
    if (slackConnector.installState === "ready") {
      draft.connectors.selectedActions = slackConnector.commands
        .filter((command) => ["mention.scan", "message.search"].includes(command.id))
        .map((command) => qualifyConnectorAction(slackConnector.tool, command.id));
    }
  }
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
  draft.google = {
    ...createDefaultDraft().google,
    ...readGoogleScope(templateFlow),
    ...readGoogleScope(assignmentFlow),
  };
  draft.slack = {
    ...createDefaultDraft().slack,
    ...readSlackScope(templateFlow),
    ...readSlackScope(assignmentFlow),
  };
  draft.m365 = {
    ...createDefaultDraft().m365,
    ...readM365Scope(templateFlow),
    ...readM365Scope(assignmentFlow),
  };
  draft.hubspot = {
    ...createDefaultDraft().hubspot,
    ...readHubSpotScope(templateFlow),
    ...readHubSpotScope(assignmentFlow),
  };
  draft.mailchimp = {
    ...createDefaultDraft().mailchimp,
    ...readMailchimpScope(templateFlow),
    ...readMailchimpScope(assignmentFlow),
  };
  draft.klaviyo = {
    ...createDefaultDraft().klaviyo,
    ...readKlaviyoScope(templateFlow),
    ...readKlaviyoScope(assignmentFlow),
  };
  draft.buffer = {
    ...createDefaultDraft().buffer,
    ...readBufferScope(templateFlow),
    ...readBufferScope(assignmentFlow),
  };
  draft.hootsuite = {
    ...createDefaultDraft().hootsuite,
    ...readHootsuiteScope(templateFlow),
    ...readHootsuiteScope(assignmentFlow),
  };
  draft.elevenlabs = {
    ...createDefaultDraft().elevenlabs,
    ...readElevenLabsScope(templateFlow),
    ...readElevenLabsScope(assignmentFlow),
  };
  draft.quickbooks = {
    ...createDefaultDraft().quickbooks,
    ...readQuickBooksScope(templateFlow),
    ...readQuickBooksScope(assignmentFlow),
  };
  draft.n8n = {
    ...createDefaultDraft().n8n,
    ...readN8NScope(templateFlow),
    ...readN8NScope(assignmentFlow),
  };
  draft.zapier = {
    ...createDefaultDraft().zapier,
    ...readZapierScope(templateFlow),
    ...readZapierScope(assignmentFlow),
  };
  draft.shopify = {
    ...createDefaultDraft().shopify,
    ...readShopifyScope(templateFlow),
    ...readShopifyScope(assignmentFlow),
  };
  draft.airtable = {
    ...createDefaultDraft().airtable,
    ...readAirtableScope(templateFlow),
    ...readAirtableScope(assignmentFlow),
  };
  draft.stripe = {
    ...createDefaultDraft().stripe,
    ...readStripeScope(templateFlow),
    ...readStripeScope(assignmentFlow),
  };
  draft.notion = {
    ...createDefaultDraft().notion,
    ...readNotionScope(templateFlow),
    ...readNotionScope(assignmentFlow),
  };
  draft.wordpress = {
    ...createDefaultDraft().wordpress,
    ...readWordPressScope(templateFlow),
    ...readWordPressScope(assignmentFlow),
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
  onOpenApiKeys,
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
  const [connectorSetupByTool, setConnectorSetupByTool] = useState<
    Record<string, ConnectorSetupStatus | null>
  >({});
  const [connectorSetupLoadingByTool, setConnectorSetupLoadingByTool] = useState<
    Record<string, boolean>
  >({});
  const [connectorSetupLaunchActionByTool, setConnectorSetupLaunchActionByTool] = useState<
    Record<string, string | null>
  >({});
  const [connectorSetupAutoRefreshUntilByTool, setConnectorSetupAutoRefreshUntilByTool] = useState<
    Record<string, number | null>
  >({});
  const [pickerLoadingByKey, setPickerLoadingByKey] = useState<Record<string, boolean>>({});
  const [pickerErrorByTool, setPickerErrorByTool] = useState<Record<string, string | null>>({});
  const [googlePicker, setGooglePicker] = useState<GooglePickerState>(
    createDefaultGooglePickerState,
  );
  const [slackPicker, setSlackPicker] = useState<SlackPickerState>(createDefaultSlackPickerState);
  const [m365Picker, setM365Picker] = useState<M365PickerState>(createDefaultM365PickerState);
  const [hubSpotPicker, setHubSpotPicker] = useState<HubSpotPickerState>(
    createDefaultHubSpotPickerState,
  );
  const [mailchimpPicker, setMailchimpPicker] = useState<MailchimpPickerState>(
    createDefaultMailchimpPickerState,
  );
  const [klaviyoPicker, setKlaviyoPicker] = useState<KlaviyoPickerState>(
    createDefaultKlaviyoPickerState,
  );
  const [bufferPicker, setBufferPicker] = useState<BufferPickerState>(
    createDefaultBufferPickerState,
  );
  const [hootsuitePicker, setHootsuitePicker] = useState<HootsuitePickerState>(
    createDefaultHootsuitePickerState,
  );
  const [elevenLabsPicker, setElevenLabsPicker] = useState<ElevenLabsPickerState>(
    createDefaultElevenLabsPickerState,
  );
  const [quickBooksPicker, setQuickBooksPicker] = useState<QuickBooksPickerState>(
    createDefaultQuickBooksPickerState,
  );
  const [n8nPicker, setN8NPicker] = useState<N8NPickerState>(createDefaultN8NPickerState);
  const [zapierPicker, setZapierPicker] = useState<ZapierPickerState>(
    createDefaultZapierPickerState,
  );
  const [shopifyPicker, setShopifyPicker] = useState<ShopifyPickerState>(
    createDefaultShopifyPickerState,
  );
  const [airtablePicker, setAirtablePicker] = useState<AirtablePickerState>(
    createDefaultAirtablePickerState,
  );
  const [stripePicker, setStripePicker] = useState<StripePickerState>(
    createDefaultStripePickerState,
  );
  const [notionPicker, setNotionPicker] = useState<NotionPickerState>(
    createDefaultNotionPickerState,
  );

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
  const readyConnectorTools = useMemo(
    () =>
      new Set(
        connectorCatalog
          .filter((connector) => connector.installState === "ready")
          .map((connector) => connector.tool),
      ),
    [connectorCatalog],
  );
  const selectedIncompleteConnectors = useMemo(
    () => selectedConnectorEntries.filter((connector) => connector.installState !== "ready"),
    [selectedConnectorEntries],
  );
  const selectedConnectorActions = useMemo(
    () =>
      draft.connectors.selectedActions
        .map((value) => splitQualifiedConnectorAction(value))
        .filter((value): value is { tool: string; commandId: string } => Boolean(value)),
    [draft.connectors.selectedActions],
  );
  const sourceReadiness = useMemo(() => buildSourceReadiness(draft), [draft]);
  const connectorReadiness = useMemo(
    () => buildSelectedConnectorReadiness(selectedConnectorEntries, selectedConnectorActions),
    [selectedConnectorActions, selectedConnectorEntries],
  );
  const connectorLaunchBlockers = useMemo(
    () => connectorReadiness.filter((entry) => entry.blocking),
    [connectorReadiness],
  );
  const connectorScopeBlockers = useMemo(
    () =>
      selectedConnectorEntries
        .map((connector) => getConnectorScopeBlocker(connector.tool, draft))
        .filter((value): value is string => Boolean(value)),
    [draft, selectedConnectorEntries],
  );
  const n8nTriggerSelected = useMemo(
    () => selectedConnectorCommandIds(draft, "aos-n8n").includes("workflow.trigger"),
    [draft],
  );
  const zapierTriggerSelected = useMemo(
    () => selectedConnectorCommandIds(draft, "aos-zapier").includes("zap.trigger"),
    [draft],
  );
  const n8nTriggerPayloadError = useMemo(
    () =>
      n8nTriggerSelected
        ? buildTriggerPayloadArgs(draft.n8n.triggerPayload, {
            allowJsonPassthrough: false,
          }).error
        : undefined,
    [draft.n8n.triggerPayload, n8nTriggerSelected],
  );
  const zapierTriggerPayloadError = useMemo(
    () =>
      zapierTriggerSelected
        ? buildTriggerPayloadArgs(draft.zapier.triggerPayload, {
            allowJsonPassthrough: true,
          }).error
        : undefined,
    [draft.zapier.triggerPayload, zapierTriggerSelected],
  );
  const playBlockedReasons = useMemo(() => {
    if (draft.launch.state !== "play") {
      return [] as string[];
    }
    return [
      ...sourceReadiness.blockers,
      ...connectorScopeBlockers,
      ...connectorLaunchBlockers.map(
        (entry) =>
          `${entry.label} has ${entry.selectedCommandIds.length} selected connector action${entry.selectedCommandIds.length === 1 ? "" : "s"} but is still ${entry.statusLabel.toLowerCase()}.`,
      ),
    ];
  }, [
    connectorLaunchBlockers,
    connectorScopeBlockers,
    draft.launch.state,
    sourceReadiness.blockers,
  ]);
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

  const setDraftField = useCallback((updater: (current: FlowDraft) => FlowDraft) => {
    setDraft((current) => updater(current));
    setMessage(null);
  }, []);

  const loadConnectorSetupStatus = useCallback(
    async (
      tool: string,
      options: { manual?: boolean; installMissing?: boolean } = {},
    ): Promise<ConnectorSetupStatus | null> => {
      try {
        setConnectorSetupLoadingByTool((prev) => ({ ...prev, [tool]: true }));
        if (options.manual) {
          setMessage(null);
        }
        const payload = options.manual
          ? await runConnectorSetupCheck(tool, {
              installMissing: options.installMissing === true,
              requireAuth: true,
            })
          : await fetchConnectorSetupStatus(tool);
        setConnectorSetupByTool((prev) => ({ ...prev, [tool]: payload }));
        if (options.manual) {
          if (payload?.ok) {
            setConnectorSetupAutoRefreshUntilByTool((prev) => ({ ...prev, [tool]: null }));
            setMessage({
              type: "success",
              text: `${tool} is ready. This worker can now use connector-backed actions.`,
            });
          } else {
            setMessage({
              type: "error",
              text: payload?.summary || `${tool} still needs operator setup.`,
            });
          }
        }
        await loadData();
        return payload;
      } catch (error) {
        if (options.manual) {
          setMessage({
            type: "error",
            text: error instanceof Error ? error.message : `Failed to check ${tool} setup.`,
          });
        }
        return null;
      } finally {
        setConnectorSetupLoadingByTool((prev) => ({ ...prev, [tool]: false }));
      }
    },
    [loadData],
  );

  const launchConnectorSetup = useCallback(
    async (tool: string, action: string) => {
      try {
        setConnectorSetupLaunchActionByTool((prev) => ({ ...prev, [tool]: action }));
        setMessage(null);
        const payload = await launchConnectorSetupAction(tool, action);
        if (payload.watchForChanges) {
          setConnectorSetupAutoRefreshUntilByTool((prev) => ({
            ...prev,
            [tool]: Date.now() + 2 * 60 * 1000,
          }));
          globalThis.setTimeout(() => {
            void loadConnectorSetupStatus(tool, { manual: false, installMissing: false });
          }, 1500);
        }
        setMessage({
          type: "success",
          text: payload.watchForChanges
            ? `${payload.message || `Launched ${tool} setup action.`} Watching for readiness changes now.`
            : payload.message || `Launched ${tool} setup action.`,
        });
      } catch (error) {
        setMessage({
          type: "error",
          text: error instanceof Error ? error.message : `Failed to launch ${tool} setup action.`,
        });
      } finally {
        setConnectorSetupLaunchActionByTool((prev) => ({ ...prev, [tool]: null }));
      }
    },
    [loadConnectorSetupStatus],
  );

  const runPickerPreview = useCallback(
    async (
      tool: string,
      key: string,
      request: Parameters<typeof runConnectorPreview>[1],
    ): Promise<ConnectorPreviewResponse | null> => {
      try {
        setPickerLoadingByKey((prev) => ({ ...prev, [key]: true }));
        setPickerErrorByTool((prev) => ({ ...prev, [tool]: null }));
        return await runConnectorPreview(tool, request);
      } catch (error) {
        setPickerErrorByTool((prev) => ({
          ...prev,
          [tool]: error instanceof Error ? error.message : `Failed to load ${tool} preview data.`,
        }));
        return null;
      } finally {
        setPickerLoadingByKey((prev) => ({ ...prev, [key]: false }));
      }
    },
    [],
  );

  const loadGoogleAccountPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-google", "google-account", {
      commandId: "config.show",
      env: draft.google.account.trim()
        ? { AOS_GOOGLE_ACCOUNT: draft.google.account.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const accountOptions = readPickerOptions(data.picker_options);
    setGooglePicker((prev) => ({
      ...prev,
      accountOptions,
      preview: readScopePreviewText(data),
    }));
    const nextAccount =
      asString(data.account) ||
      accountOptions.find((option) => option.selected)?.value ||
      accountOptions[0]?.value ||
      "";
    if (nextAccount && nextAccount !== draft.google.account.trim()) {
      setDraftField((current) => ({
        ...current,
        google: {
          ...current.google,
          account: nextAccount,
        },
      }));
    }
  }, [draft.google.account, runPickerPreview, setDraftField]);

  const loadGoogleMailPreview = useCallback(async () => {
    const query = buildGoogleSearchQuery(draft.google);
    const response = await runPickerPreview("aos-google", "google-mail", {
      commandId: "gmail.search",
      positional: query ? [query] : undefined,
      options: { maxResults: 10 },
      env: draft.google.account.trim()
        ? { AOS_GOOGLE_ACCOUNT: draft.google.account.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    setGooglePicker((prev) => ({
      ...prev,
      gmailMessageOptions: readPickerOptions(data.picker_options),
      gmailLabelOptions: readPickerOptionsFromField(data, "label_picker_options"),
      preview: readScopePreviewText(data),
    }));
    const scope = asRecord(data.scope);
    const nextAccount = asString(scope?.account);
    if (nextAccount && !draft.google.account.trim()) {
      setDraftField((current) => ({
        ...current,
        google: {
          ...current.google,
          account: nextAccount,
        },
      }));
    }
  }, [draft.google, runPickerPreview, setDraftField]);

  const loadGoogleDrivePreview = useCallback(async () => {
    const driveQuery = firstMeaningfulValue(parseDelimitedList(draft.google.driveRoots));
    const response = await runPickerPreview("aos-google", "google-drive", {
      commandId: "drive.list",
      options: {
        ...(driveQuery ? { query: driveQuery } : {}),
        pageSize: 12,
      },
      env: draft.google.account.trim()
        ? { AOS_GOOGLE_ACCOUNT: draft.google.account.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    setGooglePicker((prev) => ({
      ...prev,
      driveOptions: readPickerOptions(data.picker_options),
      preview: readScopePreviewText(data),
    }));
  }, [draft.google.account, draft.google.driveRoots, runPickerPreview]);

  const loadGoogleCalendarPreview = useCallback(async () => {
    const calendarId =
      firstMeaningfulValue(parseDelimitedList(draft.google.calendarScopes)) || "primary";
    const response = await runPickerPreview("aos-google", "google-calendar", {
      commandId: "calendar.list",
      options: {
        calendarId,
        maxResults: 10,
      },
      env: draft.google.account.trim()
        ? { AOS_GOOGLE_ACCOUNT: draft.google.account.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    setGooglePicker((prev) => ({
      ...prev,
      calendarOptions: readPickerOptions(data.picker_options),
      calendarScopeOptions: readPickerOptionsFromField(data, "calendar_picker_options"),
      preview: readScopePreviewText(data),
    }));
    if (!draft.google.calendarScopes.trim()) {
      setDraftField((current) => ({
        ...current,
        google: {
          ...current.google,
          calendarScopes: calendarId,
        },
      }));
    }
  }, [draft.google.account, draft.google.calendarScopes, runPickerPreview, setDraftField]);

  const loadSlackWorkspacePreview = useCallback(async () => {
    const response = await runPickerPreview("aos-slack", "slack-channels", {
      commandId: "channel.list",
      options: { limit: 25 },
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const workspaceOption = normalizeSlackWorkspaceOption({
      ...(asRecord(data.workspace) ?? {}),
      scope_preview: asString(data.scope_preview) || undefined,
    });
    const channelOptions = readNestedPickerOptions(data);
    setSlackPicker({
      workspace: workspaceOption,
      channelOptions,
      peopleOptions: [],
      preview: readScopePreviewText(data),
    });
    const workspaceValue =
      workspaceOption?.label || workspaceOption?.value || asString(asRecord(data.workspace)?.name);
    if (workspaceValue && !draft.slack.workspace.trim()) {
      setDraftField((current) => ({
        ...current,
        slack: {
          ...current.slack,
          workspace: workspaceValue,
        },
      }));
    }
  }, [draft.slack.workspace, runPickerPreview, setDraftField]);

  const loadSlackPeoplePreview = useCallback(async () => {
    const response = await runPickerPreview("aos-slack", "slack-people", {
      commandId: "people.list",
      options: { limit: 50 },
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const workspaceOption = normalizeSlackWorkspaceOption({
      ...(asRecord(data.workspace) ?? {}),
      scope_preview: asString(data.scope_preview) || undefined,
    });
    setSlackPicker((prev) => ({
      workspace: workspaceOption ?? prev.workspace,
      channelOptions: prev.channelOptions,
      peopleOptions: readNestedPickerOptions(data),
      preview: readScopePreviewText(data),
    }));
    const workspaceValue =
      workspaceOption?.label || workspaceOption?.value || asString(asRecord(data.workspace)?.name);
    if (workspaceValue && !draft.slack.workspace.trim()) {
      setDraftField((current) => ({
        ...current,
        slack: {
          ...current.slack,
          workspace: workspaceValue,
        },
      }));
    }
  }, [draft.slack.workspace, runPickerPreview, setDraftField]);

  const loadM365MailboxPreview = useCallback(async () => {
    const targetUser = firstMeaningfulValue(parseDelimitedList(draft.m365.mailboxes));
    const response = await runPickerPreview("aos-m365", "m365-mail", {
      commandId: "mail.search",
      env: targetUser ? { M365_TARGET_USER: targetUser } : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const preview = readScopePreviewRecord(data);
    const resolvedMailbox = asString(preview?.target_user) || targetUser || "";
    const mailbox =
      resolvedMailbox.length > 0
        ? ({
            value: resolvedMailbox,
            label: resolvedMailbox,
            kind: "mailbox",
            scopePreview: readScopePreviewText(data),
          } satisfies ConnectorPickerOption)
        : null;
    setM365Picker((prev) => ({
      ...prev,
      mailbox,
      preview: readScopePreviewText(data),
    }));
    if (resolvedMailbox && !draft.m365.mailboxes.trim()) {
      setDraftField((current) => ({
        ...current,
        m365: {
          ...current.m365,
          mailboxes: resolvedMailbox,
        },
      }));
    }
  }, [draft.m365.mailboxes, runPickerPreview, setDraftField]);

  const loadM365ScopeConfigPreview = useCallback(async () => {
    const targetUser = firstMeaningfulValue(parseDelimitedList(draft.m365.mailboxes));
    const response = await runPickerPreview("aos-m365", "m365-config", {
      commandId: "config.show",
      env: targetUser ? { M365_TARGET_USER: targetUser } : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const selectedTeam = readRuntimePickerScopeSelected(data, "teams");
    const selectedWorkbook = readRuntimePickerScopeSelected(data, "workbook");
    const configuredTeamScope = {
      teamId: asString(selectedTeam?.team_id) || undefined,
      channelId: asString(selectedTeam?.channel_id) || undefined,
    };
    const configuredWorkbookScope = {
      targetUser: asString(selectedWorkbook?.target_user) || undefined,
      itemId: asString(selectedWorkbook?.item_id) || undefined,
      worksheet: asString(selectedWorkbook?.worksheet) || undefined,
      range: asString(selectedWorkbook?.range) || undefined,
    };
    const configuredTeamOptions = readRuntimePickerScopeOptions(data, "teams");
    const configuredWorkbookOptions = readRuntimePickerScopeOptions(data, "workbook");
    setM365Picker((prev) => ({
      ...prev,
      teamScopeOptions: mergePickerOptions(prev.teamScopeOptions, configuredTeamOptions),
      workbookScopeOptions: mergePickerOptions(
        prev.workbookScopeOptions,
        configuredWorkbookOptions,
      ),
      configuredTeamScope,
      configuredWorkbookScope,
    }));
    if (!draft.m365.mailboxes.trim() && configuredWorkbookScope.targetUser) {
      setDraftField((current) => ({
        ...current,
        m365: {
          ...current.m365,
          mailboxes: configuredWorkbookScope.targetUser || current.m365.mailboxes,
        },
      }));
    }
    if (
      !draft.m365.teamsScopes.trim() &&
      configuredTeamScope.teamId &&
      configuredTeamScope.channelId
    ) {
      setDraftField((current) => ({
        ...current,
        m365: {
          ...current.m365,
          teamsScopes: buildScopedPairValue(
            configuredTeamScope.teamId,
            configuredTeamScope.channelId,
          ),
        },
      }));
    }
    if (
      !draft.m365.workbookScopes.trim() &&
      configuredWorkbookScope.itemId &&
      configuredWorkbookScope.worksheet &&
      configuredWorkbookScope.range
    ) {
      setDraftField((current) => ({
        ...current,
        m365: {
          ...current.m365,
          workbookScopes: buildScopedTripleValue(
            configuredWorkbookScope.itemId,
            configuredWorkbookScope.worksheet,
            configuredWorkbookScope.range,
          ),
        },
      }));
    }
  }, [
    draft.m365.mailboxes,
    draft.m365.teamsScopes,
    draft.m365.workbookScopes,
    runPickerPreview,
    setDraftField,
  ]);

  const loadM365TeamsScopePreview = useCallback(async () => {
    const targetUser = firstMeaningfulValue(parseDelimitedList(draft.m365.mailboxes));
    const response = await runPickerPreview("aos-m365", "m365-teams-scope", {
      commandId: "teams.list_teams",
      env: targetUser ? { M365_TARGET_USER: targetUser } : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    setM365Picker((prev) => ({
      ...prev,
      teamScopeOptions: mergePickerOptions(prev.teamScopeOptions, readScopePreviewOptions(data)),
      preview: readScopePreviewText(data),
    }));
  }, [draft.m365.mailboxes, runPickerPreview]);

  const loadM365ChannelsScopePreview = useCallback(async () => {
    const targetUser = firstMeaningfulValue(parseDelimitedList(draft.m365.mailboxes));
    const selectedTeam =
      parseScopedPair(firstMeaningfulValue(parseDelimitedList(draft.m365.teamsScopes)))?.first ||
      m365Picker.configuredTeamScope?.teamId;
    if (!selectedTeam) {
      setPickerErrorByTool((prev) => ({
        ...prev,
        "aos-m365": "Pick or configure a Microsoft 365 team before loading channels.",
      }));
      return;
    }
    const response = await runPickerPreview("aos-m365", "m365-channels-scope", {
      commandId: "teams.list_channels",
      positional: [selectedTeam],
      env: targetUser ? { M365_TARGET_USER: targetUser } : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    setM365Picker((prev) => ({
      ...prev,
      teamScopeOptions: mergePickerOptions(prev.teamScopeOptions, readScopePreviewOptions(data)),
      preview: readScopePreviewText(data),
    }));
  }, [
    draft.m365.mailboxes,
    draft.m365.teamsScopes,
    m365Picker.configuredTeamScope?.teamId,
    runPickerPreview,
  ]);

  const loadM365WorkbookScopePreview = useCallback(async () => {
    const targetUser = firstMeaningfulValue(parseDelimitedList(draft.m365.mailboxes));
    const drivePath = firstMeaningfulValue(parseDelimitedList(draft.m365.driveScopes));
    const response = await runPickerPreview("aos-m365", "m365-workbooks-scope", {
      commandId: "excel.list_workbooks",
      positional: drivePath ? [drivePath] : undefined,
      env: targetUser ? { M365_TARGET_USER: targetUser } : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    setM365Picker((prev) => ({
      ...prev,
      workbookScopeOptions: mergePickerOptions(
        prev.workbookScopeOptions,
        readScopePreviewOptions(data),
      ),
      preview: readScopePreviewText(data),
    }));
  }, [draft.m365.driveScopes, draft.m365.mailboxes, runPickerPreview]);

  const loadM365WorksheetScopePreview = useCallback(async () => {
    const targetUser = firstMeaningfulValue(parseDelimitedList(draft.m365.mailboxes));
    const workbookScope = parseScopedTriple(
      firstMeaningfulValue(parseDelimitedList(draft.m365.workbookScopes)),
    );
    const itemId = workbookScope?.first || m365Picker.configuredWorkbookScope?.itemId;
    if (!itemId) {
      setPickerErrorByTool((prev) => ({
        ...prev,
        "aos-m365": "Pick or configure a workbook before loading worksheets.",
      }));
      return;
    }
    const response = await runPickerPreview("aos-m365", "m365-worksheets-scope", {
      commandId: "excel.list_worksheets",
      positional: [itemId],
      env: targetUser ? { M365_TARGET_USER: targetUser } : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    setM365Picker((prev) => ({
      ...prev,
      workbookScopeOptions: mergePickerOptions(
        prev.workbookScopeOptions,
        readScopePreviewOptions(data),
      ),
      preview: readScopePreviewText(data),
    }));
  }, [
    draft.m365.mailboxes,
    draft.m365.workbookScopes,
    m365Picker.configuredWorkbookScope?.itemId,
    runPickerPreview,
  ]);

  const loadM365RangeScopePreview = useCallback(async () => {
    const targetUser = firstMeaningfulValue(parseDelimitedList(draft.m365.mailboxes));
    const workbookScope = parseScopedTriple(
      firstMeaningfulValue(parseDelimitedList(draft.m365.workbookScopes)),
    );
    const itemId = workbookScope?.first || m365Picker.configuredWorkbookScope?.itemId;
    const worksheet = workbookScope?.second || m365Picker.configuredWorkbookScope?.worksheet;
    if (!itemId || !worksheet) {
      setPickerErrorByTool((prev) => ({
        ...prev,
        "aos-m365": "Pick or configure a workbook and worksheet before loading ranges.",
      }));
      return;
    }
    const response = await runPickerPreview("aos-m365", "m365-range-scope", {
      commandId: "excel.used_range",
      positional: [itemId, worksheet],
      env: targetUser ? { M365_TARGET_USER: targetUser } : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const preview = readScopePreviewRecord(data);
    const address = asString(preview?.address);
    const rangeOption = address
      ? ({
          value: address,
          label: address,
          kind: "range",
          scopePreview: readScopePreviewText(data),
          selected: true,
        } satisfies ConnectorPickerOption)
      : null;
    setM365Picker((prev) => ({
      ...prev,
      workbookScopeOptions: mergePickerOptions(
        prev.workbookScopeOptions,
        rangeOption ? [rangeOption] : [],
      ),
      preview: readScopePreviewText(data),
    }));
    if (address && !workbookScope?.third) {
      setDraftField((current) => ({
        ...current,
        m365: {
          ...current.m365,
          workbookScopes: mergeScopedTripleValue(current.m365.workbookScopes, { third: address }),
        },
      }));
    }
  }, [
    draft.m365.mailboxes,
    draft.m365.workbookScopes,
    m365Picker.configuredWorkbookScope?.itemId,
    m365Picker.configuredWorkbookScope?.worksheet,
    runPickerPreview,
    setDraftField,
  ]);

  const loadM365CalendarPreview = useCallback(async () => {
    const targetUser = firstMeaningfulValue(parseDelimitedList(draft.m365.mailboxes));
    const response = await runPickerPreview("aos-m365", "m365-calendar", {
      commandId: "calendar.list",
      env: targetUser ? { M365_TARGET_USER: targetUser } : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    setM365Picker((prev) => ({
      ...prev,
      calendarOptions: readScopePreviewOptions(data),
      preview: readScopePreviewText(data),
    }));
  }, [draft.m365.mailboxes, runPickerPreview]);

  const loadM365DrivePreview = useCallback(async () => {
    const targetUser = firstMeaningfulValue(parseDelimitedList(draft.m365.mailboxes));
    const drivePath = firstMeaningfulValue(parseDelimitedList(draft.m365.driveScopes));
    const response = await runPickerPreview("aos-m365", "m365-drive", {
      commandId: "file.list",
      positional: drivePath ? [drivePath] : undefined,
      env: targetUser ? { M365_TARGET_USER: targetUser } : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    setM365Picker((prev) => ({
      ...prev,
      driveOptions: readScopePreviewOptions(data),
      preview: readScopePreviewText(data),
    }));
  }, [draft.m365.driveScopes, draft.m365.mailboxes, runPickerPreview]);

  const loadM365TeamsPreview = useCallback(async () => {
    const targetUser = firstMeaningfulValue(parseDelimitedList(draft.m365.mailboxes));
    const teamScope = parseScopedPair(
      firstMeaningfulValue(parseDelimitedList(draft.m365.teamsScopes)),
    );
    const response = await runPickerPreview("aos-m365", "m365-teams", {
      commandId: "teams.list_messages",
      positional:
        teamScope?.first && teamScope.second
          ? [teamScope.first, teamScope.second]
          : teamScope?.first
            ? [teamScope.first]
            : undefined,
      env: targetUser ? { M365_TARGET_USER: targetUser } : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const preview = readScopePreviewRecord(data);
    const resolvedTeamId = asString(preview?.team_id);
    const resolvedChannelId = asString(preview?.channel_id);
    setM365Picker((prev) => ({
      ...prev,
      teamMessageOptions: readScopePreviewOptions(data),
      preview: readScopePreviewText(data),
    }));
    if (resolvedTeamId && resolvedChannelId && !draft.m365.teamsScopes.trim()) {
      setDraftField((current) => ({
        ...current,
        m365: {
          ...current.m365,
          teamsScopes: `${resolvedTeamId} | ${resolvedChannelId}`,
        },
      }));
    }
  }, [draft.m365.mailboxes, draft.m365.teamsScopes, runPickerPreview, setDraftField]);

  const loadHubSpotOwnersPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-hubspot", "hubspot-owners", {
      commandId: "owner.list",
      options: {
        limit: 20,
        ...(firstMeaningfulValue(parseDelimitedList(draft.hubspot.teams))
          ? { teamId: firstMeaningfulValue(parseDelimitedList(draft.hubspot.teams)) as string }
          : {}),
      },
      env: draft.hubspot.portalId.trim()
        ? { HUBSPOT_PORTAL_ID: draft.hubspot.portalId.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const preview = readScopePreviewRecord(data);
    const portalId = asString(preview?.portal_id);
    const scopeCandidates = readScopeCandidateOptions(data);
    const portalOptions = filterPickerOptionsByKind(scopeCandidates, "portal");
    const teamOptions = filterPickerOptionsByKind(scopeCandidates, "team", "team_id");
    const portalOption = portalOptions.find((option) => option.selected) || portalOptions[0];
    setHubSpotPicker((prev) => ({
      ...prev,
      portalOptions: mergePickerOptions(prev.portalOptions, portalOptions),
      ownerOptions: mergePickerOptions(prev.ownerOptions, readPickerOptions(data.picker_options)),
      teamOptions: mergePickerOptions(prev.teamOptions, teamOptions),
      preview: "Loaded owner.list live options.",
      portalPreview:
        portalOption?.subtitle && portalOption.label
          ? `${portalOption.label} · ${portalOption.subtitle}`
          : portalId
            ? `Portal ${portalId}`
            : readScopePreviewText(data),
    }));
    const resolvedPortalId = portalOption?.value || portalId;
    if (resolvedPortalId && !draft.hubspot.portalId.trim()) {
      setDraftField((current) => ({
        ...current,
        hubspot: {
          ...current.hubspot,
          portalId: resolvedPortalId,
        },
      }));
    }
  }, [draft.hubspot.portalId, draft.hubspot.teams, runPickerPreview, setDraftField]);

  const loadHubSpotPipelinesPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-hubspot", "hubspot-pipelines", {
      commandId: "pipeline.list",
      options: { objectType: "deal" },
      env: draft.hubspot.portalId.trim()
        ? { HUBSPOT_PORTAL_ID: draft.hubspot.portalId.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const preview = readScopePreviewRecord(data);
    const portalId = asString(preview?.portal_id);
    const scopeCandidates = readScopeCandidateOptions(data);
    const portalOptions = filterPickerOptionsByKind(scopeCandidates, "portal");
    const portalOption = portalOptions.find((option) => option.selected) || portalOptions[0];
    setHubSpotPicker((prev) => ({
      ...prev,
      portalOptions: mergePickerOptions(prev.portalOptions, portalOptions),
      pipelineOptions: mergePickerOptions(
        prev.pipelineOptions,
        readPickerOptions(data.picker_options),
      ),
      preview: "Loaded pipeline.list live options.",
      portalPreview:
        portalOption?.subtitle && portalOption.label
          ? `${portalOption.label} · ${portalOption.subtitle}`
          : portalId
            ? `Portal ${portalId}`
            : readScopePreviewText(data),
    }));
    const resolvedPortalId = portalOption?.value || portalId;
    if (resolvedPortalId && !draft.hubspot.portalId.trim()) {
      setDraftField((current) => ({
        ...current,
        hubspot: {
          ...current.hubspot,
          portalId: resolvedPortalId,
        },
      }));
    }
  }, [draft.hubspot.portalId, runPickerPreview, setDraftField]);

  const loadHubSpotCrmPreview = useCallback(async () => {
    const env = draft.hubspot.portalId.trim()
      ? { HUBSPOT_PORTAL_ID: draft.hubspot.portalId.trim() }
      : undefined;
    setPickerLoadingByKey((prev) => ({ ...prev, "hubspot-crm": true }));
    try {
      const [contactResponse, dealResponse, ticketResponse] = await Promise.all([
        runPickerPreview("aos-hubspot", "hubspot-crm-contacts", {
          commandId: "contact.list",
          options: { limit: 20 },
          env,
        }),
        runPickerPreview("aos-hubspot", "hubspot-crm-deals", {
          commandId: "deal.list",
          options: { limit: 20 },
          env,
        }),
        runPickerPreview("aos-hubspot", "hubspot-crm-tickets", {
          commandId: "ticket.list",
          options: { limit: 20 },
          env,
        }),
      ]);

      const responseEntries = [
        { title: "Contacts", data: asRecord(contactResponse?.data) },
        { title: "Deals", data: asRecord(dealResponse?.data) },
        { title: "Tickets", data: asRecord(ticketResponse?.data) },
      ].filter((entry): entry is { title: string; data: Record<string, unknown> } =>
        Boolean(entry.data),
      );
      const responseData = responseEntries.map((entry) => entry.data);
      if (responseData.length === 0) {
        return;
      }

      const portalCandidates = mergePickerOptions(
        ...responseData.map((data) =>
          filterPickerOptionsByKind(readScopeCandidateOptions(data), "portal"),
        ),
      );
      const ownerCandidates = mergePickerOptions(
        ...responseData.map((data) =>
          filterPickerOptionsByKind(readScopeCandidateOptions(data), "owner"),
        ),
      );
      const pipelineCandidates = mergePickerOptions(
        ...responseData.map((data) =>
          filterPickerOptionsByKind(readScopeCandidateOptions(data), "pipeline"),
        ),
      );
      const queueCandidates = mergePickerOptions(
        ...responseData.map((data) =>
          filterPickerOptionsByKind(readScopeCandidateOptions(data), "queue"),
        ),
      );
      const portalOption =
        portalCandidates.find((option) => option.selected) || portalCandidates[0];

      setHubSpotPicker((prev) => ({
        ...prev,
        portalOptions: mergePickerOptions(prev.portalOptions, portalCandidates),
        ownerOptions: mergePickerOptions(prev.ownerOptions, ownerCandidates),
        pipelineOptions: mergePickerOptions(prev.pipelineOptions, pipelineCandidates),
        queueOptions: mergePickerOptions(prev.queueOptions, queueCandidates),
        preview: "Loaded live HubSpot contacts, deals, and tickets previews.",
        crmInsights: buildHubSpotCrmInsights(responseEntries),
        portalPreview:
          portalOption?.subtitle && portalOption.label
            ? `${portalOption.label} · ${portalOption.subtitle}`
            : portalOption?.value
              ? `Portal ${portalOption.value}`
              : prev.portalPreview,
      }));

      const resolvedPortalId = portalOption?.value || draft.hubspot.portalId.trim();
      if (resolvedPortalId && !draft.hubspot.portalId.trim()) {
        setDraftField((current) => ({
          ...current,
          hubspot: {
            ...current.hubspot,
            portalId: resolvedPortalId,
          },
        }));
      }
    } finally {
      setPickerLoadingByKey((prev) => ({ ...prev, "hubspot-crm": false }));
    }
  }, [draft.hubspot.portalId, runPickerPreview, setDraftField]);

  const loadMailchimpAccountPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-mailchimp", "mailchimp-account", {
      commandId: "account.read",
      env: draft.mailchimp.serverPrefix.trim()
        ? { MAILCHIMP_SERVER_PREFIX: draft.mailchimp.serverPrefix.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const preview = readScopePreviewRecord(data);
    const account = asRecord(data.account);
    const serverPrefix = asString(preview?.server_prefix) || draft.mailchimp.serverPrefix.trim();
    const accountLabel =
      asString(preview?.account_label) ||
      asString(account?.account_name) ||
      asString(account?.username) ||
      "";
    const accountOption =
      serverPrefix || accountLabel
        ? ({
            value: serverPrefix || accountLabel,
            label: accountLabel || serverPrefix,
            subtitle:
              serverPrefix && accountLabel && accountLabel !== serverPrefix
                ? `Server ${serverPrefix}`
                : serverPrefix
                  ? `Server ${serverPrefix}`
                  : undefined,
            kind: "account",
            scopePreview: readScopePreviewText(data),
            selected: true,
          } satisfies ConnectorPickerOption)
        : null;
    setMailchimpPicker((prev) => ({
      ...prev,
      account: accountOption,
      preview: readScopePreviewText(data),
    }));
    if (serverPrefix && serverPrefix !== draft.mailchimp.serverPrefix.trim()) {
      setDraftField((current) => ({
        ...current,
        mailchimp: {
          ...current.mailchimp,
          serverPrefix,
        },
      }));
    }
  }, [draft.mailchimp.serverPrefix, runPickerPreview, setDraftField]);

  const loadMailchimpAudiencesPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-mailchimp", "mailchimp-audiences", {
      commandId: "audience.list",
      options: { limit: 20 },
      env: draft.mailchimp.serverPrefix.trim()
        ? { MAILCHIMP_SERVER_PREFIX: draft.mailchimp.serverPrefix.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const audienceOptions = readNestedPickerOptions(data);
    setMailchimpPicker((prev) => ({
      ...prev,
      audienceOptions: mergePickerOptions(prev.audienceOptions, audienceOptions),
      preview: readScopePreviewText(data),
    }));
    if (!draft.mailchimp.audienceId.trim() && audienceOptions.length === 1) {
      setDraftField((current) => ({
        ...current,
        mailchimp: {
          ...current.mailchimp,
          audienceId: audienceOptions[0]?.value ?? current.mailchimp.audienceId,
        },
      }));
    }
  }, [draft.mailchimp.audienceId, draft.mailchimp.serverPrefix, runPickerPreview, setDraftField]);

  const loadMailchimpCampaignsPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-mailchimp", "mailchimp-campaigns", {
      commandId: "campaign.list",
      options: { limit: 20 },
      env: draft.mailchimp.serverPrefix.trim()
        ? { MAILCHIMP_SERVER_PREFIX: draft.mailchimp.serverPrefix.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const campaignOptions = readNestedPickerOptions(data);
    setMailchimpPicker((prev) => ({
      ...prev,
      campaignOptions: mergePickerOptions(prev.campaignOptions, campaignOptions),
      preview: readScopePreviewText(data),
    }));
    if (!draft.mailchimp.campaignId.trim() && campaignOptions.length === 1) {
      setDraftField((current) => ({
        ...current,
        mailchimp: {
          ...current.mailchimp,
          campaignId: campaignOptions[0]?.value ?? current.mailchimp.campaignId,
        },
      }));
    }
  }, [draft.mailchimp.campaignId, draft.mailchimp.serverPrefix, runPickerPreview, setDraftField]);

  const loadMailchimpMembersPreview = useCallback(async () => {
    const audienceId = draft.mailchimp.audienceId.trim();
    if (!audienceId) {
      setPickerErrorByTool((prev) => ({
        ...prev,
        "aos-mailchimp": "Pick or set a Mailchimp audience before loading members.",
      }));
      return;
    }
    const response = await runPickerPreview("aos-mailchimp", "mailchimp-members", {
      commandId: "member.list",
      positional: [audienceId],
      options: { limit: 20 },
      env: draft.mailchimp.serverPrefix.trim()
        ? { MAILCHIMP_SERVER_PREFIX: draft.mailchimp.serverPrefix.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const members = Array.isArray(data.members) ? data.members : [];
    const memberOptions = members
      .map((entry) => {
        const record = asRecord(entry);
        const email = asString(record?.email_address);
        if (!email) {
          return null;
        }
        const option: ConnectorPickerOption = {
          value: email,
          label: email,
          subtitle: asString(record?.status) || undefined,
          kind: "member",
          selected: email === draft.mailchimp.memberEmail.trim(),
        };
        return option;
      })
      .filter((entry): entry is ConnectorPickerOption => entry !== null);
    setMailchimpPicker((prev) => ({
      ...prev,
      memberOptions: mergePickerOptions(prev.memberOptions, memberOptions),
      preview: readScopePreviewText(data),
    }));
    if (!draft.mailchimp.memberEmail.trim() && memberOptions.length === 1) {
      setDraftField((current) => ({
        ...current,
        mailchimp: {
          ...current.mailchimp,
          memberEmail: memberOptions[0]?.value ?? current.mailchimp.memberEmail,
        },
      }));
    }
  }, [
    draft.mailchimp.audienceId,
    draft.mailchimp.memberEmail,
    draft.mailchimp.serverPrefix,
    runPickerPreview,
    setDraftField,
  ]);

  const loadKlaviyoAccountPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-klaviyo", "klaviyo-account", {
      commandId: "account.read",
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const account = asRecord(data.account);
    const preview = readScopePreviewText(data);
    const accountOption =
      account &&
      ({
        value: asString(account.id) || "current",
        label:
          firstMeaningfulValue([
            asString(account.name),
            asString(account.id),
            "Connected Klaviyo account",
          ]) ?? "Connected Klaviyo account",
        subtitle: firstMeaningfulValue([
          asString(account.timezone),
          asString(account.currency),
          asString(account.public_api_key),
        ]),
        kind: "account",
        selected: true,
        scopePreview: preview,
      } satisfies ConnectorPickerOption);
    setKlaviyoPicker((prev) => ({
      ...prev,
      account: accountOption || prev.account,
      preview,
    }));
    if (accountOption && !draft.klaviyo.account.trim()) {
      setDraftField((current) => ({
        ...current,
        klaviyo: {
          ...current.klaviyo,
          account: accountOption.label,
        },
      }));
    }
  }, [draft.klaviyo.account, runPickerPreview, setDraftField]);

  const loadKlaviyoListsPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-klaviyo", "klaviyo-lists", {
      commandId: "list.list",
      options: { limit: 10 },
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const listOptions = readNestedPickerOptions(data);
    setKlaviyoPicker((prev) => ({
      ...prev,
      listOptions: mergePickerOptions(prev.listOptions, listOptions),
      preview: readScopePreviewText(data),
    }));
    if (!draft.klaviyo.listId.trim() && listOptions.length === 1) {
      setDraftField((current) => ({
        ...current,
        klaviyo: {
          ...current.klaviyo,
          listId: listOptions[0]?.value ?? current.klaviyo.listId,
        },
      }));
    }
  }, [draft.klaviyo.listId, runPickerPreview, setDraftField]);

  const loadKlaviyoProfilesPreview = useCallback(async () => {
    const listId = draft.klaviyo.listId.trim();
    const profileEmail = draft.klaviyo.profileEmail.trim();
    const response = await runPickerPreview("aos-klaviyo", "klaviyo-profiles", {
      commandId: "profile.list",
      positional: listId ? [listId] : undefined,
      options: { limit: 10, ...(profileEmail ? { email: profileEmail } : {}) },
      env: profileEmail ? { KLAVIYO_PROFILE_EMAIL: profileEmail } : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const preview = readScopePreviewRecord(data);
    const profileOptions = readNestedPickerOptions(data);
    setKlaviyoPicker((prev) => ({
      ...prev,
      profileOptions: mergePickerOptions(prev.profileOptions, profileOptions),
      preview: readScopePreviewText(data),
    }));
    const nextListId = asString(preview?.list_id);
    const nextProfileEmail = asString(preview?.profile_email);
    if (
      (!draft.klaviyo.listId.trim() && nextListId) ||
      (!draft.klaviyo.profileEmail.trim() && nextProfileEmail) ||
      (!draft.klaviyo.profileId.trim() && profileOptions.length === 1)
    ) {
      setDraftField((current) => ({
        ...current,
        klaviyo: {
          ...current.klaviyo,
          listId: current.klaviyo.listId || nextListId || "",
          profileEmail: current.klaviyo.profileEmail || nextProfileEmail || "",
          profileId: current.klaviyo.profileId || profileOptions[0]?.value || "",
        },
      }));
    }
  }, [
    draft.klaviyo.listId,
    draft.klaviyo.profileEmail,
    draft.klaviyo.profileId,
    runPickerPreview,
    setDraftField,
  ]);

  const loadKlaviyoCampaignsPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-klaviyo", "klaviyo-campaigns", {
      commandId: "campaign.list",
      options: { limit: 10 },
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const campaignOptions = readNestedPickerOptions(data);
    setKlaviyoPicker((prev) => ({
      ...prev,
      campaignOptions: mergePickerOptions(prev.campaignOptions, campaignOptions),
      preview: readScopePreviewText(data),
    }));
    if (!draft.klaviyo.campaignId.trim() && campaignOptions.length === 1) {
      setDraftField((current) => ({
        ...current,
        klaviyo: {
          ...current.klaviyo,
          campaignId: campaignOptions[0]?.value ?? current.klaviyo.campaignId,
        },
      }));
    }
  }, [draft.klaviyo.campaignId, runPickerPreview, setDraftField]);

  const loadBufferAccountPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-buffer", "buffer-account", {
      commandId: "account.read",
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const account = asRecord(data.account);
    const accountId = asString(account?.id);
    const accountOption =
      accountId || asString(account?.email)
        ? ({
            value: accountId || asString(account?.email),
            label:
              firstMeaningfulValue([
                asString(account?.name),
                asString(account?.email),
                accountId,
                "Connected Buffer account",
              ]) ?? "Connected Buffer account",
            subtitle: firstMeaningfulValue([
              asString(account?.timezone),
              asString(account?.locale),
              asString(account?.email),
            ]),
            kind: "account",
            selected: true,
            scopePreview: readScopePreviewText(data),
          } satisfies ConnectorPickerOption)
        : null;
    setBufferPicker((prev) => ({
      ...prev,
      account: accountOption || prev.account,
      preview: readScopePreviewText(data),
    }));
    if (accountOption && !draft.buffer.account.trim()) {
      setDraftField((current) => ({
        ...current,
        buffer: {
          ...current.buffer,
          account: accountOption.value,
        },
      }));
    }
  }, [draft.buffer.account, runPickerPreview, setDraftField]);

  const loadBufferChannelsPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-buffer", "buffer-channels", {
      commandId: "channel.list",
      options: { limit: 10 },
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const channelOptions = (Array.isArray(data.channels) ? data.channels : [])
      .map((entry) => normalizeBufferEntityOption(entry, "channel"))
      .filter((entry): entry is ConnectorPickerOption => entry !== null);
    setBufferPicker((prev) => ({
      ...prev,
      channelOptions: mergePickerOptions(prev.channelOptions, channelOptions),
      preview: readScopePreviewText(data),
    }));
    if (!draft.buffer.channelId.trim() && channelOptions.length === 1) {
      setDraftField((current) => ({
        ...current,
        buffer: {
          ...current.buffer,
          channelId: channelOptions[0]?.value ?? current.buffer.channelId,
        },
      }));
    }
  }, [draft.buffer.channelId, runPickerPreview, setDraftField]);

  const loadBufferProfilesPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-buffer", "buffer-profiles", {
      commandId: "profile.list",
      options: { limit: 10 },
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const profileOptions = (Array.isArray(data.profiles) ? data.profiles : [])
      .map((entry) => normalizeBufferEntityOption(entry, "profile"))
      .filter((entry): entry is ConnectorPickerOption => entry !== null);
    setBufferPicker((prev) => ({
      ...prev,
      profileOptions: mergePickerOptions(prev.profileOptions, profileOptions),
      preview: readScopePreviewText(data),
    }));
    if (!draft.buffer.profileId.trim() && profileOptions.length === 1) {
      setDraftField((current) => ({
        ...current,
        buffer: {
          ...current.buffer,
          profileId: profileOptions[0]?.value ?? current.buffer.profileId,
        },
      }));
    }
  }, [draft.buffer.profileId, runPickerPreview, setDraftField]);

  const loadHootsuiteMemberPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-hootsuite", "hootsuite-member", {
      commandId: "me.read",
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const memberOption =
      readPickerOptions(data.picker_options)
        .map((entry) => normalizeHootsuiteMemberOption(entry))
        .filter((entry): entry is ConnectorPickerOption => entry !== null)[0] ?? null;
    const organizationOptions = readPickerOptionsFromField(data, "organization_picker_options");
    const socialProfileOptions = readPickerOptionsFromField(data, "social_profile_picker_options");
    setHootsuitePicker((prev) => ({
      ...prev,
      member: memberOption || prev.member,
      organizationOptions: mergePickerOptions(prev.organizationOptions, organizationOptions),
      socialProfileOptions: mergePickerOptions(prev.socialProfileOptions, socialProfileOptions),
      preview: readScopePreviewText(data),
    }));
    const selectedOrganization =
      organizationOptions.find((option) => option.selected) ||
      (organizationOptions.length === 1 ? organizationOptions[0] : null);
    const selectedSocialProfile =
      socialProfileOptions.find((option) => option.selected) ||
      (socialProfileOptions.length === 1 ? socialProfileOptions[0] : null);
    if (
      (memberOption && !draft.hootsuite.member.trim()) ||
      (!draft.hootsuite.organizationId.trim() && selectedOrganization) ||
      (!draft.hootsuite.socialProfileId.trim() && selectedSocialProfile)
    ) {
      setDraftField((current) => ({
        ...current,
        hootsuite: {
          ...current.hootsuite,
          member: current.hootsuite.member || memberOption?.label || "",
          organizationId: current.hootsuite.organizationId || selectedOrganization?.value || "",
          socialProfileId: current.hootsuite.socialProfileId || selectedSocialProfile?.value || "",
        },
      }));
    }
  }, [
    draft.hootsuite.member,
    draft.hootsuite.organizationId,
    draft.hootsuite.socialProfileId,
    runPickerPreview,
    setDraftField,
  ]);

  const loadHootsuiteTeamsPreview = useCallback(async () => {
    const organizationId = draft.hootsuite.organizationId.trim();
    if (!organizationId) {
      setPickerErrorByTool((prev) => ({
        ...prev,
        "aos-hootsuite": "Pick or set a Hootsuite organization before loading teams.",
      }));
      return;
    }
    const response = await runPickerPreview("aos-hootsuite", "hootsuite-teams", {
      commandId: "team.list",
      positional: [organizationId],
      env: { HOOTSUITE_ORGANIZATION_ID: organizationId },
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const teamOptions = readPickerOptions(data.picker_options);
    setHootsuitePicker((prev) => ({
      ...prev,
      teamOptions: mergePickerOptions(prev.teamOptions, teamOptions),
      preview: readScopePreviewText(data),
    }));
    if (!draft.hootsuite.teamId.trim() && teamOptions.length === 1) {
      setDraftField((current) => ({
        ...current,
        hootsuite: {
          ...current.hootsuite,
          teamId: teamOptions[0]?.value ?? current.hootsuite.teamId,
        },
      }));
    }
  }, [draft.hootsuite.organizationId, draft.hootsuite.teamId, runPickerPreview, setDraftField]);

  const loadHootsuiteMessagesPreview = useCallback(async () => {
    const socialProfileId = draft.hootsuite.socialProfileId.trim();
    if (!socialProfileId) {
      setPickerErrorByTool((prev) => ({
        ...prev,
        "aos-hootsuite": "Pick or set a Hootsuite social profile before loading messages.",
      }));
      return;
    }
    const response = await runPickerPreview("aos-hootsuite", "hootsuite-messages", {
      commandId: "message.list",
      options: { limit: 25 },
      env: { HOOTSUITE_SOCIAL_PROFILE_ID: socialProfileId },
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const messageOptions = readPickerOptions(data.picker_options);
    setHootsuitePicker((prev) => ({
      ...prev,
      messageOptions: mergePickerOptions(prev.messageOptions, messageOptions),
      preview: readScopePreviewText(data),
    }));
    if (!draft.hootsuite.messageId.trim() && messageOptions.length === 1) {
      setDraftField((current) => ({
        ...current,
        hootsuite: {
          ...current.hootsuite,
          messageId: messageOptions[0]?.value ?? current.hootsuite.messageId,
        },
      }));
    }
  }, [draft.hootsuite.messageId, draft.hootsuite.socialProfileId, runPickerPreview, setDraftField]);

  const loadElevenLabsAccountPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-elevenlabs", "elevenlabs-account", {
      commandId: "user.read",
      env: {
        ...(draft.elevenlabs.voiceId.trim()
          ? { ELEVENLABS_VOICE_ID: draft.elevenlabs.voiceId.trim() }
          : {}),
        ...(draft.elevenlabs.modelId.trim()
          ? { ELEVENLABS_MODEL_ID: draft.elevenlabs.modelId.trim() }
          : {}),
      },
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const user = asRecord(data.user);
    const subscription = asRecord(data.subscription);
    const userId = asString(user?.user_id);
    const tier = asString(subscription?.tier);
    const accountOption =
      userId || tier
        ? ({
            value: userId || tier || "elevenlabs",
            label: asString(user?.first_name) || userId || "ElevenLabs account",
            subtitle: tier ? `Tier ${tier}` : undefined,
            kind: "account",
            scopePreview: asString(data.summary) || readScopePreviewText(data),
            selected: true,
          } satisfies ConnectorPickerOption)
        : null;
    setElevenLabsPicker((prev) => ({
      ...prev,
      account: accountOption,
      preview: asString(data.summary) || readScopePreviewText(data),
    }));
  }, [draft.elevenlabs.modelId, draft.elevenlabs.voiceId, runPickerPreview]);

  const loadElevenLabsVoicesPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-elevenlabs", "elevenlabs-voices", {
      commandId: "voice.list",
      options: { pageSize: 20 },
      env: draft.elevenlabs.voiceId.trim()
        ? { ELEVENLABS_VOICE_ID: draft.elevenlabs.voiceId.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const voiceOptions = readNestedPickerOptions(data);
    setElevenLabsPicker((prev) => ({
      ...prev,
      voiceOptions: mergePickerOptions(prev.voiceOptions, voiceOptions),
      preview: asString(data.summary) || readScopePreviewText(data),
    }));
    if (!draft.elevenlabs.voiceId.trim() && voiceOptions.length === 1) {
      setDraftField((current) => ({
        ...current,
        elevenlabs: {
          ...current.elevenlabs,
          voiceId: voiceOptions[0]?.value ?? current.elevenlabs.voiceId,
        },
      }));
    }
  }, [draft.elevenlabs.voiceId, runPickerPreview, setDraftField]);

  const loadElevenLabsModelsPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-elevenlabs", "elevenlabs-models", {
      commandId: "model.list",
      env: draft.elevenlabs.modelId.trim()
        ? { ELEVENLABS_MODEL_ID: draft.elevenlabs.modelId.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const modelOptions = readNestedPickerOptions(data);
    setElevenLabsPicker((prev) => ({
      ...prev,
      modelOptions: mergePickerOptions(prev.modelOptions, modelOptions),
      preview: asString(data.summary) || readScopePreviewText(data),
    }));
    if (!draft.elevenlabs.modelId.trim() && modelOptions.length === 1) {
      setDraftField((current) => ({
        ...current,
        elevenlabs: {
          ...current.elevenlabs,
          modelId: modelOptions[0]?.value ?? current.elevenlabs.modelId,
        },
      }));
    }
  }, [draft.elevenlabs.modelId, runPickerPreview, setDraftField]);

  const loadElevenLabsHistoryPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-elevenlabs", "elevenlabs-history", {
      commandId: "history.list",
      options: { pageSize: 20 },
      env: {
        ...(draft.elevenlabs.voiceId.trim()
          ? { ELEVENLABS_VOICE_ID: draft.elevenlabs.voiceId.trim() }
          : {}),
        ...(draft.elevenlabs.modelId.trim()
          ? { ELEVENLABS_MODEL_ID: draft.elevenlabs.modelId.trim() }
          : {}),
      },
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const historyOptions = readNestedPickerOptions(data);
    setElevenLabsPicker((prev) => ({
      ...prev,
      historyOptions: mergePickerOptions(prev.historyOptions, historyOptions),
      preview: asString(data.summary) || readScopePreviewText(data),
    }));
    if (!draft.elevenlabs.historyItemId.trim() && historyOptions.length === 1) {
      setDraftField((current) => ({
        ...current,
        elevenlabs: {
          ...current.elevenlabs,
          historyItemId: historyOptions[0]?.value ?? current.elevenlabs.historyItemId,
        },
      }));
    }
  }, [
    draft.elevenlabs.historyItemId,
    draft.elevenlabs.modelId,
    draft.elevenlabs.voiceId,
    runPickerPreview,
    setDraftField,
  ]);

  const loadQuickBooksCompanyPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-quickbooks", "quickbooks-company", {
      commandId: "company.read",
      env: draft.quickbooks.companyRealm.trim()
        ? { QBO_REALM_ID: draft.quickbooks.companyRealm.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const companyOptions = mergePickerOptions(
      readPickerOptions(data.picker_options),
      filterPickerOptionsByKind(readScopeCandidateOptions(data), "company"),
    );
    const companyOption =
      companyOptions.find((option) => option.selected) || companyOptions[0] || null;
    setQuickBooksPicker((prev) => ({
      ...prev,
      companyOptions: mergePickerOptions(prev.companyOptions, companyOptions),
      company: companyOption,
      preview: readScopePreviewText(data),
      previewInsights: buildQuickBooksPreviewInsights(data),
    }));
    if (companyOption && companyOption.value !== draft.quickbooks.companyRealm.trim()) {
      setDraftField((current) => ({
        ...current,
        quickbooks: {
          ...current.quickbooks,
          companyRealm: companyOption.value,
        },
      }));
    }
  }, [draft.quickbooks.companyRealm, runPickerPreview, setDraftField]);

  const loadQuickBooksAccountsPreview = useCallback(async () => {
    const accountTerms = parseDelimitedList(draft.quickbooks.accountCues);
    const parsedDateWindow = parseQuickBooksDateWindow(draft.quickbooks.dateWindow);
    const response = await runPickerPreview("aos-quickbooks", "quickbooks-accounts", {
      commandId: "transaction.list",
      positional: accountTerms.length > 0 ? accountTerms : undefined,
      options: parsedDateWindow,
      env: draft.quickbooks.companyRealm.trim()
        ? { QBO_REALM_ID: draft.quickbooks.companyRealm.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const scopeCandidates = readScopeCandidateOptions(data);
    const companyOptions = filterPickerOptionsByKind(scopeCandidates, "company");
    const companyOption =
      companyOptions.find((option) => option.selected) || companyOptions[0] || null;
    const dateWindowOptions = filterPickerOptionsByKind(scopeCandidates, "date_window");
    setQuickBooksPicker((prev) => ({
      ...prev,
      companyOptions: mergePickerOptions(prev.companyOptions, companyOptions),
      company: companyOption ?? prev.company,
      accountOptions: mergePickerOptions(
        prev.accountOptions,
        readPickerOptions(data.picker_options),
        filterPickerOptionsByKind(scopeCandidates, "account"),
      ),
      dateWindowOptions: mergePickerOptions(prev.dateWindowOptions, dateWindowOptions),
      preview: readScopePreviewText(data),
      previewInsights: buildQuickBooksPreviewInsights(data),
    }));
    if (companyOption && companyOption.value !== draft.quickbooks.companyRealm.trim()) {
      setDraftField((current) => ({
        ...current,
        quickbooks: {
          ...current.quickbooks,
          companyRealm: companyOption.value,
        },
      }));
    }
    const dateWindowOption =
      dateWindowOptions.find((option) => option.selected) ||
      (dateWindowOptions.length === 1 ? dateWindowOptions[0] : null);
    if (dateWindowOption && !draft.quickbooks.dateWindow.trim()) {
      setDraftField((current) => ({
        ...current,
        quickbooks: {
          ...current.quickbooks,
          dateWindow: dateWindowOption.value,
        },
      }));
    }
  }, [
    draft.quickbooks.accountCues,
    draft.quickbooks.companyRealm,
    draft.quickbooks.dateWindow,
    runPickerPreview,
    setDraftField,
  ]);

  const loadN8NWorkflowsPreview = useCallback(async () => {
    const env = {
      ...(draft.n8n.workspaceName.trim()
        ? { N8N_WORKSPACE_NAME: draft.n8n.workspaceName.trim() }
        : {}),
      ...(draft.n8n.workflowId.trim() ? { N8N_WORKFLOW_ID: draft.n8n.workflowId.trim() } : {}),
      ...(draft.n8n.workflowName.trim()
        ? { N8N_WORKFLOW_NAME: draft.n8n.workflowName.trim() }
        : {}),
      ...(draft.n8n.workflowStatus.trim()
        ? { N8N_WORKFLOW_STATUS: draft.n8n.workflowStatus.trim() }
        : {}),
    };
    const response = await runPickerPreview("aos-n8n", "n8n-workflows", {
      commandId: "workflow.list",
      options: {
        limit: 20,
        ...(draft.n8n.workflowStatus.trim() ? { status: draft.n8n.workflowStatus.trim() } : {}),
      },
      env: Object.keys(env).length > 0 ? env : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const workflowOptions = mergePickerOptions(
      readPickerOptions(data.picker_options),
      readPickerOptions(data.workflow_candidates),
    );
    const configuredWorkflow = asRecord(data.configured_workflow);
    const selectedWorkflow =
      workflowOptions.find((option) => option.selected) ||
      (workflowOptions.length === 1 ? workflowOptions[0] : null);
    setN8NPicker((prev) => ({
      ...prev,
      workflowOptions,
      preview: readScopePreviewText(data),
      triggerBuilder: readTriggerBuilderRecord(data),
    }));
    const nextWorkflowId =
      asString(configuredWorkflow?.workflow_id) ||
      selectedWorkflow?.value ||
      draft.n8n.workflowId.trim() ||
      "";
    const nextWorkflowName =
      asString(configuredWorkflow?.workflow_name) ||
      selectedWorkflow?.label ||
      draft.n8n.workflowName.trim() ||
      "";
    const nextWorkflowStatus =
      asString(configuredWorkflow?.workflow_status) ||
      firstSubtitleSegment(selectedWorkflow?.subtitle) ||
      draft.n8n.workflowStatus.trim() ||
      "";
    if (
      (!draft.n8n.workflowId.trim() && nextWorkflowId) ||
      (!draft.n8n.workflowName.trim() && nextWorkflowName) ||
      (!draft.n8n.workflowStatus.trim() && nextWorkflowStatus)
    ) {
      setDraftField((current) => ({
        ...current,
        n8n: {
          ...current.n8n,
          workflowId: current.n8n.workflowId || nextWorkflowId || "",
          workflowName: current.n8n.workflowName || nextWorkflowName || "",
          workflowStatus: current.n8n.workflowStatus || nextWorkflowStatus || "",
        },
      }));
    }
  }, [draft.n8n, runPickerPreview, setDraftField]);

  const loadN8NWorkflowStatusPreview = useCallback(async () => {
    const workflowId = draft.n8n.workflowId.trim();
    const workflowName = draft.n8n.workflowName.trim();
    if (!workflowId && !workflowName) {
      setPickerErrorByTool((prev) => ({
        ...prev,
        "aos-n8n":
          "Pick or enter a workflow id or workflow name before loading n8n workflow status.",
      }));
      return;
    }
    const env = {
      ...(draft.n8n.workspaceName.trim()
        ? { N8N_WORKSPACE_NAME: draft.n8n.workspaceName.trim() }
        : {}),
      ...(workflowName ? { N8N_WORKFLOW_NAME: workflowName } : {}),
      ...(draft.n8n.workflowStatus.trim()
        ? { N8N_WORKFLOW_STATUS: draft.n8n.workflowStatus.trim() }
        : {}),
    };
    const response = await runPickerPreview("aos-n8n", "n8n-workflow-status", {
      commandId: "workflow.status",
      positional: workflowId ? [workflowId] : undefined,
      options: draft.n8n.workflowStatus.trim()
        ? { status: draft.n8n.workflowStatus.trim() }
        : undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
    });
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const workflow = asRecord(data.workflow);
    const statusOptions = mergePickerOptions(
      n8nPicker.workflowOptions,
      readPickerOptions(data.picker_options),
      readPickerOptions(data.workflow_candidates),
    );
    setN8NPicker((prev) => ({
      ...prev,
      workflowOptions: statusOptions,
      preview: readScopePreviewText(data),
      triggerBuilder: readTriggerBuilderRecord(data) ?? prev.triggerBuilder,
    }));
    const nextWorkflowId = asString(workflow?.id) || workflowId;
    const nextWorkflowName = asString(workflow?.name) || workflowName;
    const nextWorkflowStatus = asString(workflow?.status) || draft.n8n.workflowStatus.trim();
    setDraftField((current) => ({
      ...current,
      n8n: {
        ...current.n8n,
        workflowId: nextWorkflowId || current.n8n.workflowId,
        workflowName: nextWorkflowName || current.n8n.workflowName,
        workflowStatus: nextWorkflowStatus || current.n8n.workflowStatus,
      },
    }));
  }, [draft.n8n, n8nPicker.workflowOptions, runPickerPreview, setDraftField]);

  const loadZapierZapsPreview = useCallback(async () => {
    const env = {
      ...(draft.zapier.workspaceName.trim()
        ? { ZAPIER_WORKSPACE_NAME: draft.zapier.workspaceName.trim() }
        : {}),
      ...(draft.zapier.zapId.trim() ? { ZAPIER_ZAP_ID: draft.zapier.zapId.trim() } : {}),
      ...(draft.zapier.zapName.trim() ? { ZAPIER_ZAP_NAME: draft.zapier.zapName.trim() } : {}),
      ...(draft.zapier.zapStatus.trim()
        ? { ZAPIER_ZAP_STATUS: draft.zapier.zapStatus.trim() }
        : {}),
    };
    const [response, configResponse] = await Promise.all([
      runPickerPreview("aos-zapier", "zapier-zaps", {
        commandId: "zap.list",
        options: {
          limit: 20,
          ...(draft.zapier.zapStatus.trim() ? { status: draft.zapier.zapStatus.trim() } : {}),
        },
        env: Object.keys(env).length > 0 ? env : undefined,
      }),
      runPickerPreview("aos-zapier", "zapier-config", {
        commandId: "config.show",
        env: Object.keys(env).length > 0 ? env : undefined,
      }),
    ]);
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const configData = asRecord(configResponse?.data);
    const zapOptions = mergePickerOptions(
      readPickerOptions(data.picker_options),
      readPickerOptions(data.zap_candidates),
    );
    const selectedZap =
      zapOptions.find((option) => option.selected) ||
      (zapOptions.length === 1 ? zapOptions[0] : null);
    const preview = readScopePreviewRecord(data);
    const nextWorkspace =
      asString(preview?.workspace_name) || draft.zapier.workspaceName.trim() || "";
    const nextZapId =
      asString(preview?.zap_id) || selectedZap?.value || draft.zapier.zapId.trim() || "";
    const nextZapName =
      asString(preview?.zap_name) || selectedZap?.label || draft.zapier.zapName.trim() || "";
    const nextZapStatus =
      asString(preview?.zap_status) ||
      firstSubtitleSegment(selectedZap?.subtitle) ||
      draft.zapier.zapStatus.trim() ||
      "";
    setZapierPicker((prev) => ({
      ...prev,
      zapOptions,
      preview: readScopePreviewText(data),
      triggerBuilder: readTriggerBuilderRecord(configData) ?? prev.triggerBuilder,
    }));
    if (
      (!draft.zapier.workspaceName.trim() && nextWorkspace) ||
      (!draft.zapier.zapId.trim() && nextZapId) ||
      (!draft.zapier.zapName.trim() && nextZapName) ||
      (!draft.zapier.zapStatus.trim() && nextZapStatus)
    ) {
      setDraftField((current) => ({
        ...current,
        zapier: {
          ...current.zapier,
          workspaceName: current.zapier.workspaceName || nextWorkspace || "",
          zapId: current.zapier.zapId || nextZapId || "",
          zapName: current.zapier.zapName || nextZapName || "",
          zapStatus: current.zapier.zapStatus || nextZapStatus || "",
        },
      }));
    }
  }, [draft.zapier, runPickerPreview, setDraftField]);

  const loadZapierZapStatusPreview = useCallback(async () => {
    const zapId = draft.zapier.zapId.trim();
    const zapName = draft.zapier.zapName.trim();
    if (!zapId && !zapName) {
      setPickerErrorByTool((prev) => ({
        ...prev,
        "aos-zapier": "Pick or enter a zap id or zap name before loading Zapier status.",
      }));
      return;
    }
    const env = {
      ...(draft.zapier.workspaceName.trim()
        ? { ZAPIER_WORKSPACE_NAME: draft.zapier.workspaceName.trim() }
        : {}),
      ...(zapName ? { ZAPIER_ZAP_NAME: zapName } : {}),
      ...(draft.zapier.zapStatus.trim()
        ? { ZAPIER_ZAP_STATUS: draft.zapier.zapStatus.trim() }
        : {}),
    };
    const [response, configResponse] = await Promise.all([
      runPickerPreview("aos-zapier", "zapier-zap-status", {
        commandId: "zap.status",
        positional: zapId ? [zapId] : undefined,
        options: draft.zapier.zapStatus.trim()
          ? { status: draft.zapier.zapStatus.trim() }
          : undefined,
        env: Object.keys(env).length > 0 ? env : undefined,
      }),
      runPickerPreview("aos-zapier", "zapier-config", {
        commandId: "config.show",
        env: Object.keys(env).length > 0 ? env : undefined,
      }),
    ]);
    const data = asRecord(response?.data);
    if (!data) {
      return;
    }
    const configData = asRecord(configResponse?.data);
    const zap = asRecord(data.zap);
    setZapierPicker((prev) => ({
      ...prev,
      zapOptions: mergePickerOptions(
        prev.zapOptions,
        readPickerOptions(data.picker_options),
        readPickerOptions(data.zap_candidates),
      ),
      preview: readScopePreviewText(data),
      triggerBuilder: readTriggerBuilderRecord(configData) ?? prev.triggerBuilder,
    }));
    const nextWorkspace = asString(zap?.workspace_name) || draft.zapier.workspaceName.trim();
    const nextZapId = asString(zap?.id) || zapId;
    const nextZapName = asString(zap?.name) || zapName;
    const nextZapStatus = asString(zap?.status) || draft.zapier.zapStatus.trim();
    setDraftField((current) => ({
      ...current,
      zapier: {
        ...current.zapier,
        workspaceName: nextWorkspace || current.zapier.workspaceName,
        zapId: nextZapId || current.zapier.zapId,
        zapName: nextZapName || current.zapier.zapName,
        zapStatus: nextZapStatus || current.zapier.zapStatus,
      },
    }));
  }, [draft.zapier, runPickerPreview, setDraftField]);

  const loadShopifyStorePreview = useCallback(async () => {
    const response = await runPickerPreview("aos-shopify", "shopify-store", {
      commandId: "shop.read",
      env: draft.shopify.shopDomain.trim()
        ? { SHOPIFY_SHOP_DOMAIN: draft.shopify.shopDomain.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    const storeScope = asRecord(data?.store_scope);
    const shop = asRecord(storeScope?.shop);
    if (!shop) {
      return;
    }
    const store = {
      name: asString(shop.name) || undefined,
      domain: asString(shop.domain) || undefined,
      primaryDomain: asString(shop.primary_domain) || undefined,
      owner: asString(shop.owner) || undefined,
      currency: asString(shop.currency) || undefined,
      timezone: asString(shop.timezone) || undefined,
    };
    setShopifyPicker((prev) => ({ ...prev, store }));
    const resolvedDomain = firstMeaningfulValue([store.primaryDomain ?? "", store.domain ?? ""]);
    if (resolvedDomain && !draft.shopify.shopDomain.trim()) {
      setDraftField((current) => ({
        ...current,
        shopify: {
          ...current.shopify,
          shopDomain: resolvedDomain,
        },
      }));
    }
  }, [draft.shopify.shopDomain, runPickerPreview, setDraftField]);

  const loadShopifyProductsPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-shopify", "shopify-products", {
      commandId: "product.list",
      env: draft.shopify.shopDomain.trim()
        ? { SHOPIFY_SHOP_DOMAIN: draft.shopify.shopDomain.trim() }
        : undefined,
      options: {
        ...(draft.shopify.productStatus.trim()
          ? { status: draft.shopify.productStatus.trim() }
          : {}),
        limit: 12,
      },
    });
    const data = asRecord(response?.data);
    setShopifyPicker((prev) => ({
      ...prev,
      productOptions: readPickerOptions(data?.picker_options),
    }));
  }, [draft.shopify.productStatus, draft.shopify.shopDomain, runPickerPreview]);

  const loadShopifyOrdersPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-shopify", "shopify-orders", {
      commandId: "order.list",
      env: draft.shopify.shopDomain.trim()
        ? { SHOPIFY_SHOP_DOMAIN: draft.shopify.shopDomain.trim() }
        : undefined,
      options: {
        ...(draft.shopify.orderStatus.trim() ? { status: draft.shopify.orderStatus.trim() } : {}),
        ...(draft.shopify.createdAfter.trim()
          ? { createdAfter: draft.shopify.createdAfter.trim() }
          : {}),
        ...(draft.shopify.createdBefore.trim()
          ? { createdBefore: draft.shopify.createdBefore.trim() }
          : {}),
        limit: 12,
      },
    });
    const data = asRecord(response?.data);
    setShopifyPicker((prev) => ({
      ...prev,
      orderOptions: readPickerOptions(data?.picker_options),
    }));
  }, [
    draft.shopify.createdAfter,
    draft.shopify.createdBefore,
    draft.shopify.orderStatus,
    draft.shopify.shopDomain,
    runPickerPreview,
  ]);

  const loadAirtableBasesPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-airtable", "airtable-bases", {
      commandId: "base.list",
      options: { limit: 25 },
    });
    const data = asRecord(response?.data);
    setAirtablePicker((prev) => ({
      ...prev,
      baseOptions: readNestedPickerOptions(data),
      preview: asString(data?.summary) || prev.preview,
    }));
  }, [runPickerPreview]);

  const loadAirtableTablesPreview = useCallback(async () => {
    const baseId = draft.airtable.baseId.trim();
    if (!baseId) {
      setPickerErrorByTool((prev) => ({
        ...prev,
        "aos-airtable": "Pick or enter an Airtable base id before loading tables.",
      }));
      return;
    }
    const response = await runPickerPreview("aos-airtable", "airtable-tables", {
      commandId: "table.list",
      env: {
        AIRTABLE_BASE_ID: baseId,
        ...(draft.airtable.workspaceId.trim()
          ? { AIRTABLE_WORKSPACE_ID: draft.airtable.workspaceId.trim() }
          : {}),
      },
    });
    const data = asRecord(response?.data);
    setAirtablePicker((prev) => ({
      ...prev,
      tableOptions: readNestedPickerOptions(data),
      preview: asString(data?.summary) || prev.preview,
    }));
  }, [draft.airtable.baseId, draft.airtable.workspaceId, runPickerPreview]);

  const loadStripeAccountPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-stripe", "stripe-account", {
      commandId: "account.read",
      env: draft.stripe.connectedAccount.trim()
        ? { STRIPE_ACCOUNT_ID: draft.stripe.connectedAccount.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    const account = normalizeStripeAccountOption(asRecord(data?.result) ?? data);
    setStripePicker((prev) => ({
      ...prev,
      account,
    }));
    if (account && !draft.stripe.connectedAccount.trim()) {
      setDraftField((current) => ({
        ...current,
        stripe: {
          ...current.stripe,
          connectedAccount: account.value,
        },
      }));
    }
  }, [draft.stripe.connectedAccount, runPickerPreview, setDraftField]);

  const loadStripeCustomersPreview = useCallback(async () => {
    const focus = draft.stripe.customerFocus.trim();
    const response = await runPickerPreview("aos-stripe", "stripe-customers", {
      commandId: focus && !focus.includes("@") ? "customer.search" : "customer.list",
      positional: focus && !focus.includes("@") ? [focus] : undefined,
      options: focus && focus.includes("@") ? { email: focus, limit: 12 } : { limit: 12 },
      env: draft.stripe.connectedAccount.trim()
        ? { STRIPE_ACCOUNT_ID: draft.stripe.connectedAccount.trim() }
        : undefined,
    });
    const data = asRecord(response?.data);
    setStripePicker((prev) => ({
      ...prev,
      customerOptions: readPickerOptions(data?.options),
    }));
  }, [draft.stripe.connectedAccount, draft.stripe.customerFocus, runPickerPreview]);

  const loadNotionDatabasesPreview = useCallback(async () => {
    const response = await runPickerPreview("aos-notion", "notion-databases", {
      commandId: "database.list",
      options: { limit: 20 },
    });
    const data = asRecord(response?.data);
    setNotionPicker((prev) => ({
      ...prev,
      databaseOptions: readNestedPickerOptions(data),
    }));
  }, [runPickerPreview]);

  const loadNotionPagesPreview = useCallback(async () => {
    const databaseId = draft.notion.databaseId.trim();
    const pageId = draft.notion.pageId.trim();
    const searchQuery = draft.notion.searchQuery.trim();
    if (!databaseId && !pageId && !searchQuery) {
      setPickerErrorByTool((prev) => ({
        ...prev,
        "aos-notion":
          "Set a Notion database id, page id, or search query before loading live page results.",
      }));
      return;
    }
    const response = await runPickerPreview("aos-notion", "notion-pages", {
      commandId: databaseId ? "database.query" : pageId ? "page.read" : "search.query",
      positional: databaseId
        ? [databaseId]
        : pageId
          ? [pageId]
          : searchQuery
            ? [searchQuery]
            : undefined,
      options: databaseId ? { limit: 12 } : undefined,
    });
    const data = asRecord(response?.data);
    setNotionPicker((prev) => ({
      ...prev,
      pageOptions: readNestedPickerOptions(data),
    }));
  }, [draft.notion.databaseId, draft.notion.pageId, draft.notion.searchQuery, runPickerPreview]);

  useEffect(() => {
    if (!isOpen) return;
    setStep("worker");
    setDraft(createDefaultDraft());
    setSettingsByAgentId({});
    setConnectorSetupByTool({});
    setConnectorSetupLoadingByTool({});
    setConnectorSetupLaunchActionByTool({});
    setConnectorSetupAutoRefreshUntilByTool({});
    setPickerLoadingByKey({});
    setPickerErrorByTool({});
    setGooglePicker(createDefaultGooglePickerState());
    setSlackPicker(createDefaultSlackPickerState());
    setM365Picker(createDefaultM365PickerState());
    setHubSpotPicker(createDefaultHubSpotPickerState());
    setMailchimpPicker(createDefaultMailchimpPickerState());
    setKlaviyoPicker(createDefaultKlaviyoPickerState());
    setBufferPicker(createDefaultBufferPickerState());
    setHootsuitePicker(createDefaultHootsuitePickerState());
    setElevenLabsPicker(createDefaultElevenLabsPickerState());
    setQuickBooksPicker(createDefaultQuickBooksPickerState());
    setN8NPicker(createDefaultN8NPickerState());
    setZapierPicker(createDefaultZapierPickerState());
    setShopifyPicker(createDefaultShopifyPickerState());
    setAirtablePicker(createDefaultAirtablePickerState());
    setStripePicker(createDefaultStripePickerState());
    setNotionPicker(createDefaultNotionPickerState());
    void loadData();
  }, [isOpen, loadData]);

  useEffect(() => {
    const activeTools = Object.entries(connectorSetupAutoRefreshUntilByTool)
      .filter(([, until]) => typeof until === "number" && until > Date.now())
      .map(([tool]) => tool);
    if (activeTools.length === 0) return;
    const interval = globalThis.setInterval(() => {
      const now = Date.now();
      for (const tool of activeTools) {
        const until = connectorSetupAutoRefreshUntilByTool[tool];
        if (!until || now >= until) {
          setConnectorSetupAutoRefreshUntilByTool((prev) => ({ ...prev, [tool]: null }));
          continue;
        }
        if (!connectorSetupLoadingByTool[tool]) {
          void loadConnectorSetupStatus(tool, { manual: false, installMissing: false });
        }
      }
    }, 5000);
    return () => globalThis.clearInterval(interval);
  }, [connectorSetupAutoRefreshUntilByTool, connectorSetupLoadingByTool, loadConnectorSetupStatus]);

  useEffect(() => {
    if (!isOpen) return;
    for (const connector of selectedConnectorEntries) {
      if (
        connector.installState === "ready" ||
        Object.prototype.hasOwnProperty.call(connectorSetupByTool, connector.tool)
      ) {
        continue;
      }
      void loadConnectorSetupStatus(connector.tool, { manual: false, installMissing: false });
    }
  }, [connectorSetupByTool, isOpen, loadConnectorSetupStatus, selectedConnectorEntries]);

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
    if (!draft.inputs.sourceLabel.trim()) return "Source label is required.";
    const cadence = Number.parseInt(draft.inputs.cadenceMinutes, 10);
    if (draft.inputs.sourceKind !== "event" && (!Number.isFinite(cadence) || cadence <= 0)) {
      return "Cadence must be a positive number of minutes.";
    }
    if (
      draft.inputs.sourceKind !== "schedule" &&
      parseDelimitedList(draft.inputs.eventTriggers).length === 0
    ) {
      return "At least one event trigger is required for event-driven workers.";
    }
    if (!draft.rules.successDefinition.trim()) return "Success definition is required.";
    return null;
  }, [draft]);

  const saveFlow = useCallback(async () => {
    const validationError = validateCurrentDraft();
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      return;
    }
    if (draft.launch.state === "play" && playBlockedReasons.length > 0) {
      setStep("launch");
      setMessage({
        type: "error",
        text: `Worker cannot be played yet: ${playBlockedReasons.join(" ")}`,
      });
      return;
    }

    const workerId =
      draft.mode === "existing" && draft.existingAgentId.trim()
        ? draft.existingAgentId.trim()
        : slugifyAgentId(draft.identity.agentId);
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
    playBlockedReasons,
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
                                  disabled={draft.mode === "existing"}
                                  onChange={(event) =>
                                    setDraftField((current) => ({
                                      ...current,
                                      identity: {
                                        ...current.identity,
                                        agentId: slugifyAgentId(event.target.value),
                                      },
                                    }))
                                  }
                                  className={`mt-2 w-full rounded-2xl border border-white/10 px-4 py-3 text-white outline-none ${
                                    draft.mode === "existing"
                                      ? "bg-white/[0.02] text-white/45 cursor-not-allowed"
                                      : "bg-white/[0.04]"
                                  }`}
                                  placeholder="customer-service-inbox"
                                />
                                {draft.mode === "existing" ? (
                                  <div className="mt-2 text-xs text-white/45">
                                    Existing worker ids are locked here so the assignment, runtime
                                    settings, and worker controls stay attached to the same agent.
                                  </div>
                                ) : null}
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

                            <div
                              className={`mt-4 rounded-2xl border p-4 text-sm ${
                                sourceReadiness.ok
                                  ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                                  : "border-amber-400/20 bg-amber-500/10 text-amber-100"
                              }`}
                            >
                              <div className="flex items-center gap-2 font-medium">
                                {sourceReadiness.ok ? (
                                  <CheckCircle2 className="h-4 w-4" />
                                ) : (
                                  <AlertTriangle className="h-4 w-4" />
                                )}
                                Source readiness
                              </div>
                              <div className="mt-2">{sourceReadiness.summary}</div>
                              <div className="mt-1 opacity-80">{sourceReadiness.detail}</div>
                            </div>

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
                            {selectedConnectorEntries.length > 0 ? (
                              <div
                                className={`rounded-2xl border px-4 py-4 mb-4 text-sm ${
                                  connectorLaunchBlockers.length === 0
                                    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                                    : "border-amber-400/20 bg-amber-500/10 text-amber-100"
                                }`}
                              >
                                <div className="font-medium">
                                  {connectorLaunchBlockers.length === 0
                                    ? "Selected connectors are launch-ready."
                                    : "Some selected connector actions are not runnable yet."}
                                </div>
                                <div className="mt-1 opacity-80">
                                  {connectorLaunchBlockers.length === 0
                                    ? "You can keep selecting connector actions and move to Launch when ready."
                                    : "Finish Systems setup or deselect the blocked connector actions before pressing Play."}
                                </div>
                                {onOpenSystems && connectorLaunchBlockers.length > 0 ? (
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
                            ) : null}

                            {selectedIncompleteConnectors.map((connector) => {
                              const autoRefreshUntil =
                                connectorSetupAutoRefreshUntilByTool[connector.tool];
                              return (
                                <ConnectorSetupCard
                                  key={`worker-setup-${connector.tool}`}
                                  connector={connector}
                                  setupStatus={
                                    Object.prototype.hasOwnProperty.call(
                                      connectorSetupByTool,
                                      connector.tool,
                                    )
                                      ? connectorSetupByTool[connector.tool]
                                      : undefined
                                  }
                                  loading={connectorSetupLoadingByTool[connector.tool] === true}
                                  launchingAction={
                                    connectorSetupLaunchActionByTool[connector.tool] ?? null
                                  }
                                  autoRefreshing={
                                    typeof autoRefreshUntil === "number" &&
                                    autoRefreshUntil > Date.now()
                                  }
                                  disabled={saving}
                                  onOpenApiKeys={onOpenApiKeys}
                                  onCheck={(installMissing) =>
                                    void loadConnectorSetupStatus(connector.tool, {
                                      manual: true,
                                      installMissing,
                                    })
                                  }
                                  onLaunch={(action) =>
                                    void launchConnectorSetup(connector.tool, action)
                                  }
                                  onOpenSystems={onOpenSystems}
                                />
                              );
                            })}

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
                                    <div
                                      className={`mb-3 rounded-xl border px-3 py-2 text-xs ${
                                        connector.installState === "ready"
                                          ? "border-emerald-400/15 bg-emerald-500/10 text-emerald-100/90"
                                          : "border-amber-400/15 bg-amber-500/10 text-amber-100/90"
                                      }`}
                                    >
                                      {connector.status.label}.{" "}
                                      {connector.status.detail ||
                                        (connector.installState === "ready"
                                          ? "Connector runtime is available."
                                          : "Connector still needs setup before selected actions are runnable.")}
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
                              <div className="space-y-2">
                                {selectedConnectorEntries.length > 0 ? (
                                  selectedConnectorEntries.map((connector) => (
                                    <div
                                      key={connector.tool}
                                      className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100"
                                    >
                                      <div className="font-medium">
                                        {connector.label} · {connector.installState}
                                      </div>
                                      <div className="mt-1 text-[11px] text-white/60">
                                        {describeConnectorScope(connector.tool, draft) ||
                                          "Scope not set"}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <span className="text-sm text-white/45">
                                    No connectors selected yet.
                                  </span>
                                )}
                              </div>
                            </div>

                            {draft.connectors.selected.includes("aos-google") ? (
                              <div className="rounded-2xl border border-red-400/15 bg-red-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Google Workspace scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Pin the mailbox or account first, then narrow Gmail, Drive,
                                      and calendar surfaces so the worker only touches the intended
                                      slice.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1 text-xs text-red-100">
                                    {describeGoogleScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadGoogleAccountPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-google") ||
                                      pickerLoadingByKey["google-account"] === true
                                    }
                                    className="rounded-xl border border-red-300/15 bg-black/20 px-3 py-2 text-xs text-red-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["google-account"]
                                      ? "Loading account..."
                                      : "Load account"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadGoogleMailPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-google") ||
                                      pickerLoadingByKey["google-mail"] === true
                                    }
                                    className="rounded-xl border border-red-300/15 bg-black/20 px-3 py-2 text-xs text-red-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["google-mail"]
                                      ? "Loading Gmail..."
                                      : "Load Gmail"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadGoogleDrivePreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-google") ||
                                      pickerLoadingByKey["google-drive"] === true
                                    }
                                    className="rounded-xl border border-red-300/15 bg-black/20 px-3 py-2 text-xs text-red-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["google-drive"]
                                      ? "Loading Drive..."
                                      : "Load Drive"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadGoogleCalendarPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-google") ||
                                      pickerLoadingByKey["google-calendar"] === true
                                    }
                                    className="rounded-xl border border-red-300/15 bg-black/20 px-3 py-2 text-xs text-red-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["google-calendar"]
                                      ? "Loading calendar..."
                                      : "Load calendar"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-google"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-google"]}
                                  </div>
                                ) : null}
                                {googlePicker.preview ? (
                                  <div className="mb-4 rounded-xl border border-red-300/15 bg-black/15 px-3 py-2 text-xs text-red-50/90">
                                    {googlePicker.preview}
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">
                                      Mailbox or account
                                    </span>
                                    <input
                                      value={draft.google.account}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          google: {
                                            ...current.google,
                                            account: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="jason@company.com, executive inbox, shared mailbox"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Calendar scopes</span>
                                    <input
                                      value={draft.google.calendarScopes}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          google: {
                                            ...current.google,
                                            calendarScopes: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="primary, exec, recruiting, support"
                                    />
                                  </label>
                                </div>
                                {googlePicker.accountOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick account</span>
                                    <select
                                      value={draft.google.account}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          google: {
                                            ...current.google,
                                            account: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live Google account</option>
                                      {googlePicker.accountOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.scopePreview
                                              ? `${option.label} · ${option.scopePreview}`
                                              : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {googlePicker.calendarScopeOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">
                                      Pick live calendar scope
                                    </span>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        const option = googlePicker.calendarScopeOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          google: {
                                            ...current.google,
                                            calendarScopes: mergeDelimitedValue(
                                              current.google.calendarScopes,
                                              option.value,
                                            ),
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live calendar scope</option>
                                      {googlePicker.calendarScopeOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.scopePreview
                                              ? `${option.label} · ${option.scopePreview}`
                                              : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <div className="grid grid-cols-3 gap-4 mt-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Gmail senders</span>
                                    <textarea
                                      value={draft.google.gmailSenders}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          google: {
                                            ...current.google,
                                            gmailSenders: event.target.value,
                                          },
                                        }))
                                      }
                                      rows={3}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="vip@client.com, board@company.com, Jason VIP list"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Gmail query</span>
                                    <textarea
                                      value={draft.google.gmailQuery}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          google: {
                                            ...current.google,
                                            gmailQuery: event.target.value,
                                          },
                                        }))
                                      }
                                      rows={3}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="label:inbox newer_than:7d category:primary"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Gmail labels</span>
                                    <textarea
                                      value={draft.google.gmailLabels}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          google: {
                                            ...current.google,
                                            gmailLabels: event.target.value,
                                          },
                                        }))
                                      }
                                      rows={3}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="INBOX, VIP, approvals, finance"
                                    />
                                  </label>
                                </div>
                                {googlePicker.gmailMessageOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">
                                      Use sender from live Gmail result
                                    </span>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        const option = googlePicker.gmailMessageOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        const sender = option?.subtitle?.split("|", 1)[0]?.trim();
                                        if (!sender) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          google: {
                                            ...current.google,
                                            gmailSenders: mergeDelimitedValue(
                                              current.google.gmailSenders,
                                              sender,
                                            ),
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live Gmail result</option>
                                      {googlePicker.gmailMessageOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {googlePicker.gmailLabelOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">
                                      Use live Gmail label
                                    </span>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        const option = googlePicker.gmailLabelOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          google: {
                                            ...current.google,
                                            gmailLabels: mergeDelimitedValue(
                                              current.google.gmailLabels,
                                              option.value,
                                            ),
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live Gmail label</option>
                                      {googlePicker.gmailLabelOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.scopePreview
                                              ? `${option.label} · ${option.scopePreview}`
                                              : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Drive roots</span>
                                  <textarea
                                    value={draft.google.driveRoots}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        google: {
                                          ...current.google,
                                          driveRoots: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Shared drive name, folder id, finance ops, proposals"
                                  />
                                </label>
                                {googlePicker.driveOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">
                                      Use live Drive file as a scope cue
                                    </span>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        const option = googlePicker.driveOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          google: {
                                            ...current.google,
                                            driveRoots: mergeDelimitedValue(
                                              current.google.driveRoots,
                                              option.label,
                                            ),
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live Drive file</option>
                                      {googlePicker.driveOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.google.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        google: {
                                          ...current.google,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this only to clarify the concrete Gmail, Drive, or calendar scope above."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-slack") ? (
                              <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Slack scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Set the workspace, then narrow watched channels, people, and
                                      signal terms so the worker monitors one operational lane.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs text-violet-100">
                                    {describeSlackScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadSlackWorkspacePreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-slack") ||
                                      pickerLoadingByKey["slack-channels"] === true
                                    }
                                    className="rounded-xl border border-violet-300/15 bg-black/20 px-3 py-2 text-xs text-violet-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["slack-channels"]
                                      ? "Loading Slack..."
                                      : "Load workspace + channels"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadSlackPeoplePreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-slack") ||
                                      pickerLoadingByKey["slack-people"] === true
                                    }
                                    className="rounded-xl border border-violet-300/15 bg-black/20 px-3 py-2 text-xs text-violet-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["slack-people"]
                                      ? "Loading people..."
                                      : "Load people"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-slack"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-slack"]}
                                  </div>
                                ) : null}
                                {slackPicker.preview ? (
                                  <div className="mb-4 rounded-xl border border-violet-300/15 bg-black/15 px-3 py-2 text-xs text-violet-50/90">
                                    {slackPicker.preview}
                                  </div>
                                ) : null}
                                {slackPicker.workspace ? (
                                  <div className="mb-4 rounded-xl border border-violet-300/15 bg-black/15 px-3 py-3 text-xs text-violet-50/90">
                                    <div className="font-medium text-violet-100">
                                      {slackPicker.workspace.label}
                                    </div>
                                    <div className="mt-1 text-white/60">
                                      {[slackPicker.workspace.value, slackPicker.workspace.subtitle]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Workspace</span>
                                    <input
                                      value={draft.slack.workspace}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          slack: {
                                            ...current.slack,
                                            workspace: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="company Slack, T01234567, customer workspace"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Mention targets</span>
                                    <input
                                      value={draft.slack.mentionTargets}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          slack: {
                                            ...current.slack,
                                            mentionTargets: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Jason, #exec-ops oncall, @support-lead"
                                    />
                                  </label>
                                </div>
                                {slackPicker.channelOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick channel</span>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        const option = slackPicker.channelOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          slack: {
                                            ...current.slack,
                                            channels: mergeDelimitedValue(
                                              current.slack.channels,
                                              option.label,
                                            ),
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live Slack channel</option>
                                      {slackPicker.channelOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.scopePreview
                                              ? `${option.label} · ${option.scopePreview}`
                                              : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {slackPicker.peopleOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">
                                      Pick mention target
                                    </span>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        const option = slackPicker.peopleOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        const mentionValue =
                                          option.mention || option.label || option.value;
                                        setDraftField((current) => ({
                                          ...current,
                                          slack: {
                                            ...current.slack,
                                            mentionTargets: mergeDelimitedValue(
                                              current.slack.mentionTargets,
                                              mentionValue,
                                            ),
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live Slack person</option>
                                      {slackPicker.peopleOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.scopePreview
                                              ? `${option.label} · ${option.scopePreview}`
                                              : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Channels</span>
                                  <textarea
                                    value={draft.slack.channels}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        slack: {
                                          ...current.slack,
                                          channels: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="#jason, #leadership, #support-ops, C01234567"
                                  />
                                </label>
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Signal keywords</span>
                                  <textarea
                                    value={draft.slack.keywordTriggers}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        slack: {
                                          ...current.slack,
                                          keywordTriggers: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="urgent, outage, escalation, approval, blocker"
                                  />
                                </label>
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.slack.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        slack: {
                                          ...current.slack,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this to explain monitoring constraints without replacing workspace, channel, and target fields."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-m365") ? (
                              <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Microsoft 365 scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Keep the tenant explicit, then narrow mailboxes, calendars,
                                      drives, workbooks, and Teams lanes before the worker goes
                                      live.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
                                    {describeM365Scope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadM365MailboxPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-m365") ||
                                      pickerLoadingByKey["m365-mail"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["m365-mail"]
                                      ? "Loading mailbox..."
                                      : "Load mailbox"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadM365CalendarPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-m365") ||
                                      pickerLoadingByKey["m365-calendar"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["m365-calendar"]
                                      ? "Loading calendar..."
                                      : "Load calendar"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadM365DrivePreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-m365") ||
                                      pickerLoadingByKey["m365-drive"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["m365-drive"]
                                      ? "Loading files..."
                                      : "Load files"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadM365TeamsPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-m365") ||
                                      pickerLoadingByKey["m365-teams"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["m365-teams"]
                                      ? "Loading Teams..."
                                      : "Load Teams"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadM365ScopeConfigPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-m365") ||
                                      pickerLoadingByKey["m365-config"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["m365-config"]
                                      ? "Loading scope..."
                                      : "Load configured scope"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadM365TeamsScopePreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-m365") ||
                                      pickerLoadingByKey["m365-teams-scope"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["m365-teams-scope"]
                                      ? "Loading team list..."
                                      : "Load team list"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadM365ChannelsScopePreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-m365") ||
                                      pickerLoadingByKey["m365-channels-scope"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["m365-channels-scope"]
                                      ? "Loading channels..."
                                      : "Load channels"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadM365WorkbookScopePreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-m365") ||
                                      pickerLoadingByKey["m365-workbooks-scope"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["m365-workbooks-scope"]
                                      ? "Loading workbooks..."
                                      : "Load workbooks"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadM365WorksheetScopePreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-m365") ||
                                      pickerLoadingByKey["m365-worksheets-scope"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["m365-worksheets-scope"]
                                      ? "Loading worksheets..."
                                      : "Load worksheets"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadM365RangeScopePreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-m365") ||
                                      pickerLoadingByKey["m365-range-scope"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["m365-range-scope"]
                                      ? "Loading range..."
                                      : "Load range"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-m365"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-m365"]}
                                  </div>
                                ) : null}
                                {m365Picker.preview ? (
                                  <div className="mb-4 rounded-xl border border-emerald-300/15 bg-black/15 px-3 py-2 text-xs text-emerald-50/90">
                                    {m365Picker.preview}
                                  </div>
                                ) : null}
                                {m365Picker.mailbox ? (
                                  <div className="mb-4 rounded-xl border border-emerald-300/15 bg-black/15 px-3 py-3 text-xs text-emerald-50/90">
                                    <div className="font-medium text-emerald-100">
                                      {m365Picker.mailbox.label}
                                    </div>
                                    <div className="mt-1 text-white/60">
                                      {[m365Picker.mailbox.value, m365Picker.mailbox.scopePreview]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Tenant or org</span>
                                    <input
                                      value={draft.m365.tenant}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          m365: {
                                            ...current.m365,
                                            tenant: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="contoso.com, tenant id, business unit"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Mailboxes</span>
                                    <input
                                      value={draft.m365.mailboxes}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          m365: {
                                            ...current.m365,
                                            mailboxes: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="exec@company.com, support@company.com"
                                    />
                                  </label>
                                </div>
                                <div className="grid grid-cols-2 gap-4 mt-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Calendar scopes</span>
                                    <textarea
                                      value={draft.m365.calendarScopes}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          m365: {
                                            ...current.m365,
                                            calendarScopes: event.target.value,
                                          },
                                        }))
                                      }
                                      rows={3}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="primary, recruiting, support rota"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Drive scopes</span>
                                    <textarea
                                      value={draft.m365.driveScopes}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          m365: {
                                            ...current.m365,
                                            driveScopes: event.target.value,
                                          },
                                        }))
                                      }
                                      rows={3}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="OneDrive root, SharePoint site, finance docs"
                                    />
                                  </label>
                                </div>
                                {m365Picker.driveOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">
                                      Use live file as a scope cue
                                    </span>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        const option = m365Picker.driveOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          m365: {
                                            ...current.m365,
                                            driveScopes: mergeDelimitedValue(
                                              current.m365.driveScopes,
                                              option.label,
                                            ),
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">
                                        Choose a live OneDrive or SharePoint item
                                      </option>
                                      {m365Picker.driveOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4 mt-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Workbook scopes</span>
                                    <textarea
                                      value={draft.m365.workbookScopes}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          m365: {
                                            ...current.m365,
                                            workbookScopes: event.target.value,
                                          },
                                        }))
                                      }
                                      rows={3}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Quarterly forecast workbook, payroll workbook"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Teams scopes</span>
                                    <textarea
                                      value={draft.m365.teamsScopes}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          m365: {
                                            ...current.m365,
                                            teamsScopes: event.target.value,
                                          },
                                        }))
                                      }
                                      rows={3}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Executive team / approvals, support / incidents"
                                    />
                                  </label>
                                </div>
                                {m365Picker.workbookScopeOptions.length > 0 ? (
                                  <div className="grid grid-cols-3 gap-4 mt-4">
                                    <label className="block">
                                      <span className="text-sm text-white/60">Pick workbook</span>
                                      <select
                                        value=""
                                        onChange={(event) => {
                                          const option = filterPickerOptionsByKind(
                                            m365Picker.workbookScopeOptions,
                                            "workbook",
                                          ).find((entry) => entry.value === event.target.value);
                                          if (!option) {
                                            return;
                                          }
                                          setDraftField((current) => ({
                                            ...current,
                                            m365: {
                                              ...current.m365,
                                              workbookScopes: mergeScopedTripleValue(
                                                current.m365.workbookScopes,
                                                { first: option.value },
                                              ),
                                            },
                                          }));
                                        }}
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Choose a configured workbook</option>
                                        {filterPickerOptionsByKind(
                                          m365Picker.workbookScopeOptions,
                                          "workbook",
                                        ).map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="block">
                                      <span className="text-sm text-white/60">Pick worksheet</span>
                                      <select
                                        value=""
                                        onChange={(event) => {
                                          const option = filterPickerOptionsByKind(
                                            m365Picker.workbookScopeOptions,
                                            "worksheet",
                                          ).find((entry) => entry.value === event.target.value);
                                          if (!option) {
                                            return;
                                          }
                                          setDraftField((current) => ({
                                            ...current,
                                            m365: {
                                              ...current.m365,
                                              workbookScopes: mergeScopedTripleValue(
                                                current.m365.workbookScopes,
                                                { second: option.value },
                                              ),
                                            },
                                          }));
                                        }}
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Choose a configured worksheet</option>
                                        {filterPickerOptionsByKind(
                                          m365Picker.workbookScopeOptions,
                                          "worksheet",
                                        ).map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="block">
                                      <span className="text-sm text-white/60">Pick range</span>
                                      <select
                                        value=""
                                        onChange={(event) => {
                                          const option = filterPickerOptionsByKind(
                                            m365Picker.workbookScopeOptions,
                                            "range",
                                          ).find((entry) => entry.value === event.target.value);
                                          if (!option) {
                                            return;
                                          }
                                          setDraftField((current) => ({
                                            ...current,
                                            m365: {
                                              ...current.m365,
                                              workbookScopes: mergeScopedTripleValue(
                                                current.m365.workbookScopes,
                                                { third: option.value },
                                              ),
                                            },
                                          }));
                                        }}
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Choose a configured range</option>
                                        {filterPickerOptionsByKind(
                                          m365Picker.workbookScopeOptions,
                                          "range",
                                        ).map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>
                                ) : null}
                                {m365Picker.teamScopeOptions.length > 0 ? (
                                  <div className="grid grid-cols-2 gap-4 mt-4">
                                    <label className="block">
                                      <span className="text-sm text-white/60">Pick team</span>
                                      <select
                                        value=""
                                        onChange={(event) => {
                                          const option = filterPickerOptionsByKind(
                                            m365Picker.teamScopeOptions,
                                            "team",
                                          ).find((entry) => entry.value === event.target.value);
                                          if (!option) {
                                            return;
                                          }
                                          setDraftField((current) => ({
                                            ...current,
                                            m365: {
                                              ...current.m365,
                                              teamsScopes: mergeScopedPairValue(
                                                current.m365.teamsScopes,
                                                { first: option.value },
                                              ),
                                            },
                                          }));
                                        }}
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Choose a configured team</option>
                                        {filterPickerOptionsByKind(
                                          m365Picker.teamScopeOptions,
                                          "team",
                                        ).map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="block">
                                      <span className="text-sm text-white/60">Pick channel</span>
                                      <select
                                        value=""
                                        onChange={(event) => {
                                          const option = filterPickerOptionsByKind(
                                            m365Picker.teamScopeOptions,
                                            "channel",
                                          ).find((entry) => entry.value === event.target.value);
                                          if (!option) {
                                            return;
                                          }
                                          setDraftField((current) => ({
                                            ...current,
                                            m365: {
                                              ...current.m365,
                                              teamsScopes: mergeScopedPairValue(
                                                current.m365.teamsScopes,
                                                { second: option.value },
                                              ),
                                            },
                                          }));
                                        }}
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Choose a configured channel</option>
                                        {filterPickerOptionsByKind(
                                          m365Picker.teamScopeOptions,
                                          "channel",
                                        ).map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>
                                ) : null}
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.m365.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        m365: {
                                          ...current.m365,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this to clarify the M365 lane without replacing tenant and workload fields."
                                  />
                                </label>
                              </div>
                            ) : null}

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
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadHubSpotOwnersPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-hubspot") ||
                                      pickerLoadingByKey["hubspot-owners"] === true
                                    }
                                    className="rounded-xl border border-cyan-300/15 bg-black/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["hubspot-owners"]
                                      ? "Loading owners..."
                                      : "Load owners"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadHubSpotPipelinesPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-hubspot") ||
                                      pickerLoadingByKey["hubspot-pipelines"] === true
                                    }
                                    className="rounded-xl border border-cyan-300/15 bg-black/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["hubspot-pipelines"]
                                      ? "Loading pipelines..."
                                      : "Load pipelines"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadHubSpotCrmPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-hubspot") ||
                                      pickerLoadingByKey["hubspot-crm"] === true
                                    }
                                    className="rounded-xl border border-cyan-300/15 bg-black/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["hubspot-crm"]
                                      ? "Loading CRM records..."
                                      : "Load CRM records"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-hubspot"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-hubspot"]}
                                  </div>
                                ) : null}
                                {hubSpotPicker.preview ? (
                                  <div className="mb-4 rounded-xl border border-cyan-300/15 bg-black/15 px-3 py-2 text-xs text-cyan-50/80">
                                    {hubSpotPicker.preview}
                                  </div>
                                ) : null}
                                {hubSpotPicker.portalPreview ? (
                                  <div className="mb-4 rounded-xl border border-cyan-300/15 bg-black/15 px-3 py-2 text-xs text-cyan-50/90">
                                    {hubSpotPicker.portalPreview}
                                  </div>
                                ) : null}
                                {hubSpotPicker.crmInsights.length > 0 ? (
                                  <div className="mb-4 grid gap-3 md:grid-cols-3">
                                    {hubSpotPicker.crmInsights.map((insight) => (
                                      <div
                                        key={insight.title}
                                        className="rounded-xl border border-cyan-300/15 bg-black/15 px-3 py-3"
                                      >
                                        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-100/70">
                                          {insight.title}
                                        </div>
                                        <div className="mt-2 text-xs text-cyan-50/90">
                                          {insight.detail}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                {hubSpotPicker.portalOptions.length > 0 ? (
                                  <label className="block mb-4">
                                    <span className="text-sm text-white/60">Pick portal</span>
                                    <select
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
                                    >
                                      <option value="">Choose a live portal</option>
                                      {hubSpotPicker.portalOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
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
                                {hubSpotPicker.pipelineOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick pipeline</span>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        const option = hubSpotPicker.pipelineOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          hubspot: {
                                            ...current.hubspot,
                                            pipelines: mergeDelimitedValue(
                                              current.hubspot.pipelines,
                                              option.value,
                                            ),
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live pipeline</option>
                                      {hubSpotPicker.pipelineOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {hubSpotPicker.ownerOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick owner</span>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        const option = hubSpotPicker.ownerOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          hubspot: {
                                            ...current.hubspot,
                                            owners: mergeDelimitedValue(
                                              current.hubspot.owners,
                                              option.value,
                                            ),
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live owner</option>
                                      {hubSpotPicker.ownerOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {hubSpotPicker.teamOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick team</span>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        const option = hubSpotPicker.teamOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          hubspot: {
                                            ...current.hubspot,
                                            teams: mergeDelimitedValue(
                                              current.hubspot.teams,
                                              option.value,
                                            ),
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live team</option>
                                      {hubSpotPicker.teamOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {hubSpotPicker.queueOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick queue</span>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        const option = hubSpotPicker.queueOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          hubspot: {
                                            ...current.hubspot,
                                            queues: mergeDelimitedValue(
                                              current.hubspot.queues,
                                              option.value,
                                            ),
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live queue</option>
                                      {hubSpotPicker.queueOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
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

                            {draft.connectors.selected.includes("aos-shopify") ? (
                              <div className="rounded-2xl border border-lime-400/15 bg-lime-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Shopify scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Pin the store first, then narrow product, order, and customer
                                      reads so the worker only watches one commerce lane.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-lime-400/20 bg-lime-400/10 px-3 py-1 text-xs text-lime-100">
                                    {describeShopifyScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadShopifyStorePreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-shopify") ||
                                      pickerLoadingByKey["shopify-store"] === true
                                    }
                                    className="rounded-xl border border-lime-300/15 bg-black/20 px-3 py-2 text-xs text-lime-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["shopify-store"]
                                      ? "Loading store..."
                                      : "Load live store"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadShopifyProductsPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-shopify") ||
                                      pickerLoadingByKey["shopify-products"] === true
                                    }
                                    className="rounded-xl border border-lime-300/15 bg-black/20 px-3 py-2 text-xs text-lime-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["shopify-products"]
                                      ? "Loading products..."
                                      : "Load products"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadShopifyOrdersPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-shopify") ||
                                      pickerLoadingByKey["shopify-orders"] === true
                                    }
                                    className="rounded-xl border border-lime-300/15 bg-black/20 px-3 py-2 text-xs text-lime-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["shopify-orders"]
                                      ? "Loading orders..."
                                      : "Load orders"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-shopify"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-shopify"]}
                                  </div>
                                ) : null}
                                {shopifyPicker.store ? (
                                  <div className="mb-4 rounded-xl border border-lime-300/15 bg-black/15 px-3 py-3 text-xs text-lime-50/90">
                                    <div className="font-medium text-lime-100">
                                      {shopifyPicker.store.name ||
                                        shopifyPicker.store.primaryDomain ||
                                        shopifyPicker.store.domain ||
                                        "Detected Shopify store"}
                                    </div>
                                    <div className="mt-1 text-white/60">
                                      {[
                                        shopifyPicker.store.primaryDomain ||
                                          shopifyPicker.store.domain,
                                        shopifyPicker.store.owner,
                                        shopifyPicker.store.currency,
                                        shopifyPicker.store.timezone,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Shop domain</span>
                                    <input
                                      value={draft.shopify.shopDomain}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          shopify: {
                                            ...current.shopify,
                                            shopDomain: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="example.myshopify.com"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Product status</span>
                                    <input
                                      value={draft.shopify.productStatus}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          shopify: {
                                            ...current.shopify,
                                            productStatus: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="active, draft, archived, any"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Product id</span>
                                    <input
                                      value={draft.shopify.productId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          shopify: {
                                            ...current.shopify,
                                            productId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="gid://shopify/Product/... or numeric id"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Order status</span>
                                    <input
                                      value={draft.shopify.orderStatus}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          shopify: {
                                            ...current.shopify,
                                            orderStatus: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="open, closed, cancelled, any"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Order id</span>
                                    <input
                                      value={draft.shopify.orderId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          shopify: {
                                            ...current.shopify,
                                            orderId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="gid://shopify/Order/... or numeric id"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Customer email</span>
                                    <input
                                      value={draft.shopify.customerEmail}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          shopify: {
                                            ...current.shopify,
                                            customerEmail: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="vip@example.com"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Created after</span>
                                    <input
                                      value={draft.shopify.createdAfter}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          shopify: {
                                            ...current.shopify,
                                            createdAfter: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="2026-01-01 or unix epoch"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Created before</span>
                                    <input
                                      value={draft.shopify.createdBefore}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          shopify: {
                                            ...current.shopify,
                                            createdBefore: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="2026-01-31 or unix epoch"
                                    />
                                  </label>
                                </div>
                                {shopifyPicker.productOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick product</span>
                                    <select
                                      value={draft.shopify.productId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          shopify: {
                                            ...current.shopify,
                                            productId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live product</option>
                                      {shopifyPicker.productOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {shopifyPicker.orderOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick order</span>
                                    <select
                                      value={draft.shopify.orderId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          shopify: {
                                            ...current.shopify,
                                            orderId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live order</option>
                                      {shopifyPicker.orderOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.shopify.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        shopify: {
                                          ...current.shopify,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this to clarify the commerce lane without replacing the store and filter fields."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-airtable") ? (
                              <div className="rounded-2xl border border-teal-400/15 bg-teal-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Airtable scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Pin the base first, then the default table, so record reads
                                      stay inside one operational dataset.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-teal-400/20 bg-teal-400/10 px-3 py-1 text-xs text-teal-100">
                                    {describeAirtableScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadAirtableBasesPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-airtable") ||
                                      pickerLoadingByKey["airtable-bases"] === true
                                    }
                                    className="rounded-xl border border-teal-300/15 bg-black/20 px-3 py-2 text-xs text-teal-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["airtable-bases"]
                                      ? "Loading bases..."
                                      : "Load bases"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadAirtableTablesPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-airtable") ||
                                      pickerLoadingByKey["airtable-tables"] === true
                                    }
                                    className="rounded-xl border border-teal-300/15 bg-black/20 px-3 py-2 text-xs text-teal-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["airtable-tables"]
                                      ? "Loading tables..."
                                      : "Load tables"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-airtable"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-airtable"]}
                                  </div>
                                ) : null}
                                {airtablePicker.preview ? (
                                  <div className="mb-4 rounded-xl border border-teal-300/15 bg-black/15 px-3 py-2 text-xs text-teal-50/90">
                                    {airtablePicker.preview}
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-3 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Base id</span>
                                    <input
                                      value={draft.airtable.baseId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          airtable: {
                                            ...current.airtable,
                                            baseId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="appXXXXXXXXXXXXXX"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Table name</span>
                                    <input
                                      value={draft.airtable.tableName}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          airtable: {
                                            ...current.airtable,
                                            tableName: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Tickets, Leads, Content Calendar"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Workspace id</span>
                                    <input
                                      value={draft.airtable.workspaceId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          airtable: {
                                            ...current.airtable,
                                            workspaceId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="wspXXXXXXXXXXXXXX"
                                    />
                                  </label>
                                </div>
                                {airtablePicker.baseOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick base</span>
                                    <select
                                      value={draft.airtable.baseId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          airtable: {
                                            ...current.airtable,
                                            baseId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live Airtable base</option>
                                      {airtablePicker.baseOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {airtablePicker.tableOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick table</span>
                                    <select
                                      value={draft.airtable.tableName}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          airtable: {
                                            ...current.airtable,
                                            tableName: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live table</option>
                                      {airtablePicker.tableOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.airtable.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        airtable: {
                                          ...current.airtable,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this to clarify the ops dataset without replacing the base and table fields."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-mailchimp") ? (
                              <div className="rounded-2xl border border-sky-400/15 bg-sky-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Mailchimp scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Pin the audience, campaign, or member this worker should
                                      touch. Keep campaign reads and member reads narrow.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs text-sky-100">
                                    {describeMailchimpScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadMailchimpAccountPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-mailchimp") ||
                                      pickerLoadingByKey["mailchimp-account"] === true
                                    }
                                    className="rounded-xl border border-sky-300/15 bg-black/20 px-3 py-2 text-xs text-sky-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["mailchimp-account"]
                                      ? "Loading account..."
                                      : "Load account"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadMailchimpAudiencesPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-mailchimp") ||
                                      pickerLoadingByKey["mailchimp-audiences"] === true
                                    }
                                    className="rounded-xl border border-sky-300/15 bg-black/20 px-3 py-2 text-xs text-sky-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["mailchimp-audiences"]
                                      ? "Loading audiences..."
                                      : "Load audiences"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadMailchimpCampaignsPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-mailchimp") ||
                                      pickerLoadingByKey["mailchimp-campaigns"] === true
                                    }
                                    className="rounded-xl border border-sky-300/15 bg-black/20 px-3 py-2 text-xs text-sky-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["mailchimp-campaigns"]
                                      ? "Loading campaigns..."
                                      : "Load campaigns"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadMailchimpMembersPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-mailchimp") ||
                                      pickerLoadingByKey["mailchimp-members"] === true
                                    }
                                    className="rounded-xl border border-sky-300/15 bg-black/20 px-3 py-2 text-xs text-sky-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["mailchimp-members"]
                                      ? "Loading members..."
                                      : "Load members"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-mailchimp"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-mailchimp"]}
                                  </div>
                                ) : null}
                                {mailchimpPicker.preview ? (
                                  <div className="mb-4 rounded-xl border border-sky-300/15 bg-black/15 px-3 py-2 text-xs text-sky-50/90">
                                    {mailchimpPicker.preview}
                                  </div>
                                ) : null}
                                {mailchimpPicker.account ? (
                                  <div className="mb-4 rounded-xl border border-sky-300/15 bg-black/15 px-3 py-3 text-xs text-sky-50/90">
                                    <div className="font-medium text-sky-100">
                                      {mailchimpPicker.account.label}
                                    </div>
                                    <div className="mt-1 text-white/60">
                                      {mailchimpPicker.account.subtitle ||
                                        `Server ${draft.mailchimp.serverPrefix || "unset"}`}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Server prefix</span>
                                    <input
                                      value={draft.mailchimp.serverPrefix}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          mailchimp: {
                                            ...current.mailchimp,
                                            serverPrefix: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="us1"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Audience ID</span>
                                    <input
                                      value={draft.mailchimp.audienceId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          mailchimp: {
                                            ...current.mailchimp,
                                            audienceId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Audience or list id"
                                    />
                                  </label>
                                  {mailchimpPicker.audienceOptions.length > 0 ? (
                                    <label className="block">
                                      <span className="text-sm text-white/60">
                                        Pick live audience
                                      </span>
                                      <select
                                        value={draft.mailchimp.audienceId}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            mailchimp: {
                                              ...current.mailchimp,
                                              audienceId: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Choose a live audience</option>
                                        {mailchimpPicker.audienceOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                  <label className="block">
                                    <span className="text-sm text-white/60">Campaign ID</span>
                                    <input
                                      value={draft.mailchimp.campaignId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          mailchimp: {
                                            ...current.mailchimp,
                                            campaignId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Campaign id"
                                    />
                                  </label>
                                  {mailchimpPicker.campaignOptions.length > 0 ? (
                                    <label className="block">
                                      <span className="text-sm text-white/60">
                                        Pick live campaign
                                      </span>
                                      <select
                                        value={draft.mailchimp.campaignId}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            mailchimp: {
                                              ...current.mailchimp,
                                              campaignId: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Choose a live campaign</option>
                                        {mailchimpPicker.campaignOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                  <label className="block">
                                    <span className="text-sm text-white/60">Member email</span>
                                    <input
                                      value={draft.mailchimp.memberEmail}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          mailchimp: {
                                            ...current.mailchimp,
                                            memberEmail: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="member@example.com"
                                    />
                                  </label>
                                  {mailchimpPicker.memberOptions.length > 0 ? (
                                    <label className="block">
                                      <span className="text-sm text-white/60">
                                        Pick live member
                                      </span>
                                      <select
                                        value={draft.mailchimp.memberEmail}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            mailchimp: {
                                              ...current.mailchimp,
                                              memberEmail: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Choose a live member</option>
                                        {mailchimpPicker.memberOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                </div>
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.mailchimp.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        mailchimp: {
                                          ...current.mailchimp,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Clarify whether this worker audits one audience, one campaign, or a specific member segment."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-klaviyo") ? (
                              <div className="rounded-2xl border border-pink-400/15 bg-pink-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Klaviyo scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Pin the list, profile, or campaign this worker should read.
                                      Keep profile reads narrowed by list or email when possible.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-pink-400/20 bg-pink-400/10 px-3 py-1 text-xs text-pink-100">
                                    {describeKlaviyoScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadKlaviyoAccountPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-klaviyo") ||
                                      pickerLoadingByKey["klaviyo-account"] === true
                                    }
                                    className="rounded-xl border border-pink-300/15 bg-black/20 px-3 py-2 text-xs text-pink-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["klaviyo-account"]
                                      ? "Loading account..."
                                      : "Load account"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadKlaviyoListsPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-klaviyo") ||
                                      pickerLoadingByKey["klaviyo-lists"] === true
                                    }
                                    className="rounded-xl border border-pink-300/15 bg-black/20 px-3 py-2 text-xs text-pink-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["klaviyo-lists"]
                                      ? "Loading lists..."
                                      : "Load lists"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadKlaviyoProfilesPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-klaviyo") ||
                                      pickerLoadingByKey["klaviyo-profiles"] === true
                                    }
                                    className="rounded-xl border border-pink-300/15 bg-black/20 px-3 py-2 text-xs text-pink-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["klaviyo-profiles"]
                                      ? "Loading profiles..."
                                      : "Load profiles"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadKlaviyoCampaignsPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-klaviyo") ||
                                      pickerLoadingByKey["klaviyo-campaigns"] === true
                                    }
                                    className="rounded-xl border border-pink-300/15 bg-black/20 px-3 py-2 text-xs text-pink-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["klaviyo-campaigns"]
                                      ? "Loading campaigns..."
                                      : "Load campaigns"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-klaviyo"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-klaviyo"]}
                                  </div>
                                ) : null}
                                {klaviyoPicker.preview ? (
                                  <div className="mb-4 rounded-xl border border-pink-300/15 bg-black/15 px-3 py-2 text-xs text-pink-50/90">
                                    {klaviyoPicker.preview}
                                  </div>
                                ) : null}
                                {klaviyoPicker.account ? (
                                  <div className="mb-4 rounded-xl border border-pink-300/15 bg-black/15 px-3 py-3 text-xs text-pink-50/90">
                                    <div className="font-medium text-pink-100">
                                      {klaviyoPicker.account.label}
                                    </div>
                                    <div className="mt-1 text-white/60">
                                      {klaviyoPicker.account.subtitle ||
                                        "Connected Klaviyo account"}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Account label</span>
                                    <input
                                      value={draft.klaviyo.account}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          klaviyo: {
                                            ...current.klaviyo,
                                            account: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Connected Klaviyo account"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">List ID</span>
                                    <input
                                      value={draft.klaviyo.listId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          klaviyo: {
                                            ...current.klaviyo,
                                            listId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="List id"
                                    />
                                  </label>
                                  {klaviyoPicker.listOptions.length > 0 ? (
                                    <label className="block">
                                      <span className="text-sm text-white/60">Pick live list</span>
                                      <select
                                        value={draft.klaviyo.listId}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            klaviyo: {
                                              ...current.klaviyo,
                                              listId: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Select list</option>
                                        {klaviyoPicker.listOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                  <label className="block">
                                    <span className="text-sm text-white/60">Profile ID</span>
                                    <input
                                      value={draft.klaviyo.profileId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          klaviyo: {
                                            ...current.klaviyo,
                                            profileId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Profile id"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Profile email</span>
                                    <input
                                      value={draft.klaviyo.profileEmail}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          klaviyo: {
                                            ...current.klaviyo,
                                            profileEmail: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="contact@example.com"
                                    />
                                  </label>
                                  {klaviyoPicker.profileOptions.length > 0 ? (
                                    <label className="block">
                                      <span className="text-sm text-white/60">
                                        Pick live profile
                                      </span>
                                      <select
                                        value={draft.klaviyo.profileId}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            klaviyo: {
                                              ...current.klaviyo,
                                              profileId: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Select profile</option>
                                        {klaviyoPicker.profileOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                  <label className="block">
                                    <span className="text-sm text-white/60">Campaign ID</span>
                                    <input
                                      value={draft.klaviyo.campaignId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          klaviyo: {
                                            ...current.klaviyo,
                                            campaignId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Campaign id"
                                    />
                                  </label>
                                  {klaviyoPicker.campaignOptions.length > 0 ? (
                                    <label className="block">
                                      <span className="text-sm text-white/60">
                                        Pick live campaign
                                      </span>
                                      <select
                                        value={draft.klaviyo.campaignId}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            klaviyo: {
                                              ...current.klaviyo,
                                              campaignId: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Select campaign</option>
                                        {klaviyoPicker.campaignOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                </div>
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.klaviyo.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        klaviyo: {
                                          ...current.klaviyo,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Clarify whether this worker watches one list, one customer segment, or one campaign lane."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-buffer") ? (
                              <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Buffer scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Pin the account, channel, and profile this worker should
                                      watch. Buffer post reads remain scaffolded, so use the post
                                      fields only for draft metadata.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
                                    {describeBufferScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadBufferAccountPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-buffer") ||
                                      pickerLoadingByKey["buffer-account"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["buffer-account"]
                                      ? "Loading account..."
                                      : "Load account"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadBufferChannelsPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-buffer") ||
                                      pickerLoadingByKey["buffer-channels"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["buffer-channels"]
                                      ? "Loading channels..."
                                      : "Load channels"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadBufferProfilesPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-buffer") ||
                                      pickerLoadingByKey["buffer-profiles"] === true
                                    }
                                    className="rounded-xl border border-emerald-300/15 bg-black/20 px-3 py-2 text-xs text-emerald-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["buffer-profiles"]
                                      ? "Loading profiles..."
                                      : "Load profiles"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-buffer"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-buffer"]}
                                  </div>
                                ) : null}
                                {bufferPicker.preview ? (
                                  <div className="mb-4 rounded-xl border border-emerald-300/15 bg-black/15 px-3 py-2 text-xs text-emerald-50/90">
                                    {bufferPicker.preview}
                                  </div>
                                ) : null}
                                {bufferPicker.account ? (
                                  <div className="mb-4 rounded-xl border border-emerald-300/15 bg-black/15 px-3 py-3 text-xs text-emerald-50/90">
                                    <div className="font-medium text-emerald-100">
                                      {bufferPicker.account.label}
                                    </div>
                                    <div className="mt-1 text-white/60">
                                      {bufferPicker.account.subtitle || "Connected Buffer account"}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Account</span>
                                    <input
                                      value={draft.buffer.account}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          buffer: {
                                            ...current.buffer,
                                            account: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Connected Buffer account"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Channel ID</span>
                                    <input
                                      value={draft.buffer.channelId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          buffer: {
                                            ...current.buffer,
                                            channelId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Channel id"
                                    />
                                  </label>
                                  {bufferPicker.channelOptions.length > 0 ? (
                                    <label className="block">
                                      <span className="text-sm text-white/60">
                                        Pick live channel
                                      </span>
                                      <select
                                        value={draft.buffer.channelId}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            buffer: {
                                              ...current.buffer,
                                              channelId: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Select channel</option>
                                        {bufferPicker.channelOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                  <label className="block">
                                    <span className="text-sm text-white/60">Profile ID</span>
                                    <input
                                      value={draft.buffer.profileId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          buffer: {
                                            ...current.buffer,
                                            profileId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Profile id"
                                    />
                                  </label>
                                  {bufferPicker.profileOptions.length > 0 ? (
                                    <label className="block">
                                      <span className="text-sm text-white/60">
                                        Pick live profile
                                      </span>
                                      <select
                                        value={draft.buffer.profileId}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            buffer: {
                                              ...current.buffer,
                                              profileId: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Select profile</option>
                                        {bufferPicker.profileOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                  <label className="block">
                                    <span className="text-sm text-white/60">Post ID</span>
                                    <input
                                      value={draft.buffer.postId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          buffer: {
                                            ...current.buffer,
                                            postId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Optional post id"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Post text</span>
                                    <input
                                      value={draft.buffer.postText}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          buffer: {
                                            ...current.buffer,
                                            postText: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Optional draft text"
                                    />
                                  </label>
                                </div>
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.buffer.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        buffer: {
                                          ...current.buffer,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Clarify the specific Buffer queue, social lane, or publishing channel this worker should cover."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-hootsuite") ? (
                              <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Hootsuite scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Pin the organization, social profile, and optional team or
                                      message before the worker touches Hootsuite scheduling lanes.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs text-violet-100">
                                    {describeHootsuiteScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadHootsuiteMemberPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-hootsuite") ||
                                      pickerLoadingByKey["hootsuite-member"] === true
                                    }
                                    className="rounded-xl border border-violet-300/15 bg-black/20 px-3 py-2 text-xs text-violet-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["hootsuite-member"]
                                      ? "Loading member..."
                                      : "Load member context"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadHootsuiteTeamsPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-hootsuite") ||
                                      pickerLoadingByKey["hootsuite-teams"] === true
                                    }
                                    className="rounded-xl border border-violet-300/15 bg-black/20 px-3 py-2 text-xs text-violet-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["hootsuite-teams"]
                                      ? "Loading teams..."
                                      : "Load teams"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadHootsuiteMessagesPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-hootsuite") ||
                                      pickerLoadingByKey["hootsuite-messages"] === true
                                    }
                                    className="rounded-xl border border-violet-300/15 bg-black/20 px-3 py-2 text-xs text-violet-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["hootsuite-messages"]
                                      ? "Loading messages..."
                                      : "Load messages"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-hootsuite"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-hootsuite"]}
                                  </div>
                                ) : null}
                                {hootsuitePicker.preview ? (
                                  <div className="mb-4 rounded-xl border border-violet-300/15 bg-black/15 px-3 py-2 text-xs text-violet-50/90">
                                    {hootsuitePicker.preview}
                                  </div>
                                ) : null}
                                {hootsuitePicker.member ? (
                                  <div className="mb-4 rounded-xl border border-violet-300/15 bg-black/15 px-3 py-3 text-xs text-violet-50/90">
                                    <div className="font-medium text-violet-100">
                                      {hootsuitePicker.member.label}
                                    </div>
                                    <div className="mt-1 text-white/60">
                                      {hootsuitePicker.member.subtitle || "Authenticated member"}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Member</span>
                                    <input
                                      value={draft.hootsuite.member}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          hootsuite: {
                                            ...current.hootsuite,
                                            member: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Authenticated member"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Organization ID</span>
                                    <input
                                      value={draft.hootsuite.organizationId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          hootsuite: {
                                            ...current.hootsuite,
                                            organizationId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Organization id"
                                    />
                                  </label>
                                  {hootsuitePicker.organizationOptions.length > 0 ? (
                                    <label className="block">
                                      <span className="text-sm text-white/60">
                                        Pick organization
                                      </span>
                                      <select
                                        value={draft.hootsuite.organizationId}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            hootsuite: {
                                              ...current.hootsuite,
                                              organizationId: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Select organization</option>
                                        {hootsuitePicker.organizationOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                  <label className="block">
                                    <span className="text-sm text-white/60">Social profile ID</span>
                                    <input
                                      value={draft.hootsuite.socialProfileId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          hootsuite: {
                                            ...current.hootsuite,
                                            socialProfileId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Social profile id"
                                    />
                                  </label>
                                  {hootsuitePicker.socialProfileOptions.length > 0 ? (
                                    <label className="block">
                                      <span className="text-sm text-white/60">
                                        Pick social profile
                                      </span>
                                      <select
                                        value={draft.hootsuite.socialProfileId}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            hootsuite: {
                                              ...current.hootsuite,
                                              socialProfileId: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Select social profile</option>
                                        {hootsuitePicker.socialProfileOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                  <label className="block">
                                    <span className="text-sm text-white/60">Team ID</span>
                                    <input
                                      value={draft.hootsuite.teamId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          hootsuite: {
                                            ...current.hootsuite,
                                            teamId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Team id"
                                    />
                                  </label>
                                  {hootsuitePicker.teamOptions.length > 0 ? (
                                    <label className="block">
                                      <span className="text-sm text-white/60">Pick team</span>
                                      <select
                                        value={draft.hootsuite.teamId}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            hootsuite: {
                                              ...current.hootsuite,
                                              teamId: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Select team</option>
                                        {hootsuitePicker.teamOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                  <label className="block">
                                    <span className="text-sm text-white/60">Message ID</span>
                                    <input
                                      value={draft.hootsuite.messageId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          hootsuite: {
                                            ...current.hootsuite,
                                            messageId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Message id"
                                    />
                                  </label>
                                  {hootsuitePicker.messageOptions.length > 0 ? (
                                    <label className="block">
                                      <span className="text-sm text-white/60">Pick message</span>
                                      <select
                                        value={draft.hootsuite.messageId}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            hootsuite: {
                                              ...current.hootsuite,
                                              messageId: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none"
                                      >
                                        <option value="">Select message</option>
                                        {hootsuitePicker.messageOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                </div>
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.hootsuite.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        hootsuite: {
                                          ...current.hootsuite,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Clarify the Hootsuite organization, social profile, and scheduling lane this worker should own."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-elevenlabs") ? (
                              <div className="rounded-2xl border border-fuchsia-400/15 bg-fuchsia-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      ElevenLabs scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Pin the voice, model, and optional history item before the
                                      worker touches voice generation or playback history.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-1 text-xs text-fuchsia-100">
                                    {describeElevenLabsScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadElevenLabsAccountPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-elevenlabs") ||
                                      pickerLoadingByKey["elevenlabs-account"] === true
                                    }
                                    className="rounded-xl border border-fuchsia-300/15 bg-black/20 px-3 py-2 text-xs text-fuchsia-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["elevenlabs-account"]
                                      ? "Loading account..."
                                      : "Load account"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadElevenLabsVoicesPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-elevenlabs") ||
                                      pickerLoadingByKey["elevenlabs-voices"] === true
                                    }
                                    className="rounded-xl border border-fuchsia-300/15 bg-black/20 px-3 py-2 text-xs text-fuchsia-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["elevenlabs-voices"]
                                      ? "Loading voices..."
                                      : "Load voices"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadElevenLabsModelsPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-elevenlabs") ||
                                      pickerLoadingByKey["elevenlabs-models"] === true
                                    }
                                    className="rounded-xl border border-fuchsia-300/15 bg-black/20 px-3 py-2 text-xs text-fuchsia-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["elevenlabs-models"]
                                      ? "Loading models..."
                                      : "Load models"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadElevenLabsHistoryPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-elevenlabs") ||
                                      pickerLoadingByKey["elevenlabs-history"] === true
                                    }
                                    className="rounded-xl border border-fuchsia-300/15 bg-black/20 px-3 py-2 text-xs text-fuchsia-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["elevenlabs-history"]
                                      ? "Loading history..."
                                      : "Load history"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-elevenlabs"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-elevenlabs"]}
                                  </div>
                                ) : null}
                                {elevenLabsPicker.preview ? (
                                  <div className="mb-4 rounded-xl border border-fuchsia-300/15 bg-black/15 px-3 py-2 text-xs text-fuchsia-50/90">
                                    {elevenLabsPicker.preview}
                                  </div>
                                ) : null}
                                {elevenLabsPicker.account ? (
                                  <div className="mb-4 rounded-xl border border-fuchsia-300/15 bg-black/15 px-3 py-3 text-xs text-fuchsia-50/90">
                                    <div className="font-medium text-fuchsia-100">
                                      {elevenLabsPicker.account.label}
                                    </div>
                                    <div className="mt-1 text-white/60">
                                      {elevenLabsPicker.account.subtitle || "ElevenLabs account"}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-3 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Voice id</span>
                                    <input
                                      value={draft.elevenlabs.voiceId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          elevenlabs: {
                                            ...current.elevenlabs,
                                            voiceId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="21m00Tcm4TlvDq8ikWAM"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Model id</span>
                                    <input
                                      value={draft.elevenlabs.modelId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          elevenlabs: {
                                            ...current.elevenlabs,
                                            modelId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="eleven_multilingual_v2"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">History item id</span>
                                    <input
                                      value={draft.elevenlabs.historyItemId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          elevenlabs: {
                                            ...current.elevenlabs,
                                            historyItemId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="VW7YKqPnjY4h39yTbx2L"
                                    />
                                  </label>
                                </div>
                                {elevenLabsPicker.voiceOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick voice</span>
                                    <select
                                      value={draft.elevenlabs.voiceId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          elevenlabs: {
                                            ...current.elevenlabs,
                                            voiceId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live ElevenLabs voice</option>
                                      {elevenLabsPicker.voiceOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {elevenLabsPicker.modelOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick model</span>
                                    <select
                                      value={draft.elevenlabs.modelId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          elevenlabs: {
                                            ...current.elevenlabs,
                                            modelId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live ElevenLabs model</option>
                                      {elevenLabsPicker.modelOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {elevenLabsPicker.historyOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick history item</span>
                                    <select
                                      value={draft.elevenlabs.historyItemId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          elevenlabs: {
                                            ...current.elevenlabs,
                                            historyItemId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live history item</option>
                                      {elevenLabsPicker.historyOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.elevenlabs.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        elevenlabs: {
                                          ...current.elevenlabs,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this to clarify the voice lane without replacing the structured voice, model, or history fields."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-quickbooks") ? (
                              <div className="rounded-2xl border border-amber-400/15 bg-amber-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      QuickBooks scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Keep the company or realm explicit, then narrow the account
                                      and reporting window if this worker touches finance data.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs text-amber-100">
                                    {describeQuickBooksScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadQuickBooksCompanyPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-quickbooks") ||
                                      pickerLoadingByKey["quickbooks-company"] === true
                                    }
                                    className="rounded-xl border border-amber-300/15 bg-black/20 px-3 py-2 text-xs text-amber-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["quickbooks-company"]
                                      ? "Loading company..."
                                      : "Load company"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadQuickBooksAccountsPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-quickbooks") ||
                                      pickerLoadingByKey["quickbooks-accounts"] === true
                                    }
                                    className="rounded-xl border border-amber-300/15 bg-black/20 px-3 py-2 text-xs text-amber-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["quickbooks-accounts"]
                                      ? "Loading transactions..."
                                      : "Load transaction scope"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-quickbooks"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-quickbooks"]}
                                  </div>
                                ) : null}
                                {quickBooksPicker.preview ? (
                                  <div className="mb-4 rounded-xl border border-amber-300/15 bg-black/15 px-3 py-2 text-xs text-amber-50/90">
                                    {quickBooksPicker.preview}
                                  </div>
                                ) : null}
                                {quickBooksPicker.previewInsights.length > 0 ? (
                                  <div className="mb-4 grid gap-3 md:grid-cols-2">
                                    {quickBooksPicker.previewInsights.map((insight) => (
                                      <div
                                        key={insight.title}
                                        className="rounded-xl border border-amber-300/15 bg-black/15 px-3 py-3"
                                      >
                                        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-amber-100/70">
                                          {insight.title}
                                        </div>
                                        <div className="mt-2 text-xs text-amber-50/90">
                                          {insight.detail}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                {quickBooksPicker.companyOptions.length > 0 ? (
                                  <label className="block mb-4">
                                    <span className="text-sm text-white/60">Pick company</span>
                                    <select
                                      value={draft.quickbooks.companyRealm}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          quickbooks: {
                                            ...current.quickbooks,
                                            companyRealm: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live company</option>
                                      {quickBooksPicker.companyOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {quickBooksPicker.company ? (
                                  <div className="mb-4 rounded-xl border border-amber-300/15 bg-black/15 px-3 py-3 text-xs text-amber-50/90">
                                    <div className="font-medium text-amber-100">
                                      {quickBooksPicker.company.label}
                                    </div>
                                    <div className="mt-1 text-white/60">
                                      {[
                                        quickBooksPicker.company.value,
                                        quickBooksPicker.company.subtitle,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Company or realm</span>
                                    <input
                                      value={draft.quickbooks.companyRealm}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          quickbooks: {
                                            ...current.quickbooks,
                                            companyRealm: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="QuickBooks realm 1234567890 or company name"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Date window</span>
                                    <input
                                      value={draft.quickbooks.dateWindow}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          quickbooks: {
                                            ...current.quickbooks,
                                            dateWindow: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Last 30 days, FY2025 Q4, 2026-01-01 to 2026-01-31"
                                    />
                                  </label>
                                </div>
                                {quickBooksPicker.accountOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick account</span>
                                    <select
                                      value=""
                                      onChange={(event) => {
                                        const option = quickBooksPicker.accountOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          quickbooks: {
                                            ...current.quickbooks,
                                            accountCues: mergeDelimitedValue(
                                              current.quickbooks.accountCues,
                                              option.label,
                                            ),
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live account</option>
                                      {quickBooksPicker.accountOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {quickBooksPicker.dateWindowOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">
                                      Pick suggested date window
                                    </span>
                                    <select
                                      value={draft.quickbooks.dateWindow}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          quickbooks: {
                                            ...current.quickbooks,
                                            dateWindow: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a suggested date window</option>
                                      {quickBooksPicker.dateWindowOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Account cues</span>
                                  <textarea
                                    value={draft.quickbooks.accountCues}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        quickbooks: {
                                          ...current.quickbooks,
                                          accountCues: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="AP, AR, payroll clearing, revenue account, specific customer/vendor names"
                                  />
                                </label>
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.quickbooks.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        quickbooks: {
                                          ...current.quickbooks,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this to explain the accounting slice without replacing the structured fields."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-n8n") ? (
                              <div className="rounded-2xl border border-sky-400/15 bg-sky-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">n8n scope</div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Pin the workflow or workspace this worker depends on. Live
                                      reads and workflow triggering use the configured bridge.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs text-sky-100">
                                    {describeN8NScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadN8NWorkflowsPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-n8n") ||
                                      pickerLoadingByKey["n8n-workflows"] === true
                                    }
                                    className="rounded-xl border border-sky-300/15 bg-black/20 px-3 py-2 text-xs text-sky-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["n8n-workflows"]
                                      ? "Loading workflows..."
                                      : "Load workflows"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadN8NWorkflowStatusPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-n8n") ||
                                      pickerLoadingByKey["n8n-workflow-status"] === true
                                    }
                                    className="rounded-xl border border-sky-300/15 bg-black/20 px-3 py-2 text-xs text-sky-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["n8n-workflow-status"]
                                      ? "Loading workflow..."
                                      : "Load workflow status"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-n8n"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-n8n"]}
                                  </div>
                                ) : null}
                                {n8nPicker.preview ? (
                                  <div className="mb-4 rounded-xl border border-sky-300/15 bg-black/15 px-3 py-2 text-xs text-sky-50/90">
                                    {n8nPicker.preview}
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Workspace</span>
                                    <input
                                      value={draft.n8n.workspaceName}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          n8n: {
                                            ...current.n8n,
                                            workspaceName: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Ops, Marketing Automation, Current workspace"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Workflow status</span>
                                    <input
                                      value={draft.n8n.workflowStatus}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          n8n: {
                                            ...current.n8n,
                                            workflowStatus: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="active, inactive"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Workflow id</span>
                                    <input
                                      value={draft.n8n.workflowId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          n8n: {
                                            ...current.n8n,
                                            workflowId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="workflow-123"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Workflow name</span>
                                    <input
                                      value={draft.n8n.workflowName}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          n8n: {
                                            ...current.n8n,
                                            workflowName: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Onboarding Sync"
                                    />
                                  </label>
                                </div>
                                {n8nPicker.workflowOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick workflow</span>
                                    <select
                                      value={draft.n8n.workflowId}
                                      onChange={(event) => {
                                        const option = n8nPicker.workflowOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          n8n: {
                                            ...current.n8n,
                                            workflowId: option.value,
                                            workflowName: option.label,
                                            workflowStatus:
                                              firstSubtitleSegment(option.subtitle) ||
                                              current.n8n.workflowStatus,
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live workflow</option>
                                      {n8nPicker.workflowOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {n8nTriggerSelected ? (
                                  <div className="mt-4 rounded-xl border border-sky-300/15 bg-black/15 p-4">
                                    <div className="text-sm font-medium text-sky-100">
                                      Trigger builder
                                    </div>
                                    <div className="mt-1 text-xs text-white/55">
                                      {readTriggerBuilderPayloadDescription(
                                        n8nPicker.triggerBuilder,
                                      ) ||
                                        "workflow.trigger forwards a structured event and payload through the configured n8n bridge."}
                                    </div>
                                    {readTriggerBuilderBridgeDetail(n8nPicker.triggerBuilder) ? (
                                      <div className="mt-3 rounded-lg border border-sky-300/15 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-50/85">
                                        {readTriggerBuilderBridgeDetail(n8nPicker.triggerBuilder)}
                                      </div>
                                    ) : null}
                                    <div className="mt-4">
                                      <span className="text-sm text-white/60">
                                        Suggested events
                                      </span>
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {readTriggerBuilderEventHints(n8nPicker.triggerBuilder).map(
                                          (eventHint) => (
                                            <button
                                              key={eventHint}
                                              type="button"
                                              onClick={() =>
                                                setDraftField((current) => ({
                                                  ...current,
                                                  n8n: {
                                                    ...current.n8n,
                                                    triggerEvent: eventHint,
                                                  },
                                                }))
                                              }
                                              className="rounded-full border border-sky-300/15 bg-sky-500/10 px-3 py-1 text-[11px] text-sky-100"
                                            >
                                              {eventHint}
                                            </button>
                                          ),
                                        )}
                                      </div>
                                    </div>
                                    <label className="block mt-4">
                                      <span className="text-sm text-white/60">Trigger event</span>
                                      <input
                                        value={draft.n8n.triggerEvent}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            n8n: {
                                              ...current.n8n,
                                              triggerEvent: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                        placeholder={
                                          readTriggerBuilderDefaultEvent(
                                            n8nPicker.triggerBuilder,
                                          ) || "manual"
                                        }
                                      />
                                    </label>
                                    <label className="block mt-4">
                                      <span className="text-sm text-white/60">Trigger payload</span>
                                      <textarea
                                        value={draft.n8n.triggerPayload}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            n8n: {
                                              ...current.n8n,
                                              triggerPayload: event.target.value,
                                            },
                                          }))
                                        }
                                        rows={4}
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 font-mono text-sm text-white outline-none"
                                        placeholder={
                                          readTriggerBuilderPayloadExample(
                                            n8nPicker.triggerBuilder,
                                          ) || "source=agent\nreason=manual"
                                        }
                                      />
                                    </label>
                                    {n8nTriggerPayloadError ? (
                                      <div className="mt-3 rounded-lg border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                        {n8nTriggerPayloadError}
                                      </div>
                                    ) : null}
                                    {readTriggerBuilderPayloadExample(n8nPicker.triggerBuilder) ? (
                                      <div className="mt-3 rounded-lg border border-sky-300/15 bg-black/20 px-3 py-3">
                                        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-sky-100/70">
                                          Payload example
                                        </div>
                                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-sky-50/85">
                                          {readTriggerBuilderPayloadExample(
                                            n8nPicker.triggerBuilder,
                                          )}
                                        </pre>
                                      </div>
                                    ) : null}
                                    {readTriggerBuilderResponseDescription(
                                      n8nPicker.triggerBuilder,
                                    ) ? (
                                      <div className="mt-3 rounded-lg border border-sky-300/15 bg-black/20 px-3 py-2 text-[11px] text-sky-50/85">
                                        {readTriggerBuilderResponseDescription(
                                          n8nPicker.triggerBuilder,
                                        )}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.n8n.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        n8n: {
                                          ...current.n8n,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this to clarify the workflow lane without replacing the structured workflow fields."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-zapier") ? (
                              <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Zapier scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Pin the Zapier workspace or zap this worker depends on. Live
                                      reads and triggering use the configured bridge.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs text-violet-100">
                                    {describeZapierScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadZapierZapsPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-zapier") ||
                                      pickerLoadingByKey["zapier-zaps"] === true
                                    }
                                    className="rounded-xl border border-violet-300/15 bg-black/20 px-3 py-2 text-xs text-violet-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["zapier-zaps"]
                                      ? "Loading zaps..."
                                      : "Load zaps"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadZapierZapStatusPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-zapier") ||
                                      pickerLoadingByKey["zapier-zap-status"] === true
                                    }
                                    className="rounded-xl border border-violet-300/15 bg-black/20 px-3 py-2 text-xs text-violet-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["zapier-zap-status"]
                                      ? "Loading zap..."
                                      : "Load zap status"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-zapier"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-zapier"]}
                                  </div>
                                ) : null}
                                {zapierPicker.preview ? (
                                  <div className="mb-4 rounded-xl border border-violet-300/15 bg-black/15 px-3 py-2 text-xs text-violet-50/90">
                                    {zapierPicker.preview}
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Workspace</span>
                                    <input
                                      value={draft.zapier.workspaceName}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          zapier: {
                                            ...current.zapier,
                                            workspaceName: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Ops, Marketing, Current workspace"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Zap status</span>
                                    <input
                                      value={draft.zapier.zapStatus}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          zapier: {
                                            ...current.zapier,
                                            zapStatus: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="on, off"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Zap id</span>
                                    <input
                                      value={draft.zapier.zapId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          zapier: {
                                            ...current.zapier,
                                            zapId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="zap-123"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Zap name</span>
                                    <input
                                      value={draft.zapier.zapName}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          zapier: {
                                            ...current.zapier,
                                            zapName: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="Weekly Ops Sync"
                                    />
                                  </label>
                                </div>
                                {zapierPicker.zapOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick zap</span>
                                    <select
                                      value={draft.zapier.zapId}
                                      onChange={(event) => {
                                        const option = zapierPicker.zapOptions.find(
                                          (entry) => entry.value === event.target.value,
                                        );
                                        if (!option) {
                                          return;
                                        }
                                        setDraftField((current) => ({
                                          ...current,
                                          zapier: {
                                            ...current.zapier,
                                            zapId: option.value,
                                            zapName: option.label,
                                            zapStatus:
                                              firstSubtitleSegment(option.subtitle) ||
                                              current.zapier.zapStatus,
                                          },
                                        }));
                                      }}
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live zap</option>
                                      {zapierPicker.zapOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {zapierTriggerSelected ? (
                                  <div className="mt-4 rounded-xl border border-violet-300/15 bg-black/15 p-4">
                                    <div className="text-sm font-medium text-violet-100">
                                      Trigger builder
                                    </div>
                                    <div className="mt-1 text-xs text-white/55">
                                      {readTriggerBuilderPayloadDescription(
                                        zapierPicker.triggerBuilder,
                                      ) ||
                                        "zap.trigger forwards an event and payload through the configured Zapier bridge."}
                                    </div>
                                    {readTriggerBuilderBridgeDetail(zapierPicker.triggerBuilder) ? (
                                      <div className="mt-3 rounded-lg border border-violet-300/15 bg-violet-500/10 px-3 py-2 text-[11px] text-violet-50/85">
                                        {readTriggerBuilderBridgeDetail(
                                          zapierPicker.triggerBuilder,
                                        )}
                                      </div>
                                    ) : null}
                                    <div className="mt-4">
                                      <span className="text-sm text-white/60">
                                        Suggested events
                                      </span>
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {readTriggerBuilderEventHints(
                                          zapierPicker.triggerBuilder,
                                        ).map((eventHint) => (
                                          <button
                                            key={eventHint}
                                            type="button"
                                            onClick={() =>
                                              setDraftField((current) => ({
                                                ...current,
                                                zapier: {
                                                  ...current.zapier,
                                                  triggerEvent: eventHint,
                                                },
                                              }))
                                            }
                                            className="rounded-full border border-violet-300/15 bg-violet-500/10 px-3 py-1 text-[11px] text-violet-100"
                                          >
                                            {eventHint}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <label className="block mt-4">
                                      <span className="text-sm text-white/60">Trigger event</span>
                                      <input
                                        value={draft.zapier.triggerEvent}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            zapier: {
                                              ...current.zapier,
                                              triggerEvent: event.target.value,
                                            },
                                          }))
                                        }
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                        placeholder={
                                          readTriggerBuilderDefaultEvent(
                                            zapierPicker.triggerBuilder,
                                          ) || "manual"
                                        }
                                      />
                                    </label>
                                    <label className="block mt-4">
                                      <span className="text-sm text-white/60">Trigger payload</span>
                                      <textarea
                                        value={draft.zapier.triggerPayload}
                                        onChange={(event) =>
                                          setDraftField((current) => ({
                                            ...current,
                                            zapier: {
                                              ...current.zapier,
                                              triggerPayload: event.target.value,
                                            },
                                          }))
                                        }
                                        rows={4}
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 font-mono text-sm text-white outline-none"
                                        placeholder={
                                          readTriggerBuilderPayloadExample(
                                            zapierPicker.triggerBuilder,
                                          ) || '{\n  "source": "agent",\n  "reason": "manual"\n}'
                                        }
                                      />
                                    </label>
                                    {zapierTriggerPayloadError ? (
                                      <div className="mt-3 rounded-lg border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                        {zapierTriggerPayloadError}
                                      </div>
                                    ) : null}
                                    {readTriggerBuilderPayloadExample(
                                      zapierPicker.triggerBuilder,
                                    ) ? (
                                      <div className="mt-3 rounded-lg border border-violet-300/15 bg-black/20 px-3 py-3">
                                        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-violet-100/70">
                                          Payload example
                                        </div>
                                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-violet-50/85">
                                          {readTriggerBuilderPayloadExample(
                                            zapierPicker.triggerBuilder,
                                          )}
                                        </pre>
                                      </div>
                                    ) : null}
                                    {readTriggerBuilderResponseDescription(
                                      zapierPicker.triggerBuilder,
                                    ) ? (
                                      <div className="mt-3 rounded-lg border border-violet-300/15 bg-black/20 px-3 py-2 text-[11px] text-violet-50/85">
                                        {readTriggerBuilderResponseDescription(
                                          zapierPicker.triggerBuilder,
                                        )}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.zapier.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        zapier: {
                                          ...current.zapier,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this to clarify the Zapier lane without replacing the structured workspace and zap fields."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-stripe") ? (
                              <div className="rounded-2xl border border-fuchsia-400/15 bg-fuchsia-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Stripe scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Pin the Stripe account, customer focus, and billing window so
                                      payment and invoice work stays constrained.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-1 text-xs text-fuchsia-100">
                                    {describeStripeScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadStripeAccountPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-stripe") ||
                                      pickerLoadingByKey["stripe-account"] === true
                                    }
                                    className="rounded-xl border border-fuchsia-300/15 bg-black/20 px-3 py-2 text-xs text-fuchsia-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["stripe-account"]
                                      ? "Loading account..."
                                      : "Load account"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadStripeCustomersPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-stripe") ||
                                      pickerLoadingByKey["stripe-customers"] === true
                                    }
                                    className="rounded-xl border border-fuchsia-300/15 bg-black/20 px-3 py-2 text-xs text-fuchsia-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["stripe-customers"]
                                      ? "Loading customers..."
                                      : "Load customers"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-stripe"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-stripe"]}
                                  </div>
                                ) : null}
                                {stripePicker.account ? (
                                  <div className="mb-4 rounded-xl border border-fuchsia-300/15 bg-black/15 px-3 py-3 text-xs text-fuchsia-50/90">
                                    <div className="font-medium text-fuchsia-100">
                                      {stripePicker.account.label}
                                    </div>
                                    <div className="mt-1 text-white/60">
                                      {[stripePicker.account.value, stripePicker.account.subtitle]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-2 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Connected account</span>
                                    <input
                                      value={draft.stripe.connectedAccount}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          stripe: {
                                            ...current.stripe,
                                            connectedAccount: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="acct_1234, platform account, or customer business unit"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Invoice status</span>
                                    <input
                                      value={draft.stripe.invoiceStatus}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          stripe: {
                                            ...current.stripe,
                                            invoiceStatus: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="open, draft, paid, uncollectible"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Customer focus</span>
                                    <input
                                      value={draft.stripe.customerFocus}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          stripe: {
                                            ...current.stripe,
                                            customerFocus: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="cus_1234, billing@customer.com, VIP accounts"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Created after</span>
                                    <input
                                      value={draft.stripe.createdAfter}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          stripe: {
                                            ...current.stripe,
                                            createdAfter: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="2026-01-01 or last 30 days"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Created before</span>
                                    <input
                                      value={draft.stripe.createdBefore}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          stripe: {
                                            ...current.stripe,
                                            createdBefore: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="2026-01-31"
                                    />
                                  </label>
                                </div>
                                {stripePicker.customerOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick customer</span>
                                    <select
                                      value={draft.stripe.customerFocus}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          stripe: {
                                            ...current.stripe,
                                            customerFocus: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live Stripe customer</option>
                                      {stripePicker.customerOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.subtitle
                                            ? `${option.label} · ${option.subtitle}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.stripe.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        stripe: {
                                          ...current.stripe,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this to clarify the Stripe slice without replacing account, customer, status, or date fields."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-notion") ? (
                              <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      Notion scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Narrow the worker to a database, a page, or an explicit search
                                      lane before it reads workspace content.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs text-violet-100">
                                    {describeNotionScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-4">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadNotionDatabasesPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-notion") ||
                                      pickerLoadingByKey["notion-databases"] === true
                                    }
                                    className="rounded-xl border border-violet-300/15 bg-black/20 px-3 py-2 text-xs text-violet-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["notion-databases"]
                                      ? "Loading databases..."
                                      : "Load databases"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadNotionPagesPreview();
                                    }}
                                    disabled={
                                      saving ||
                                      !readyConnectorTools.has("aos-notion") ||
                                      pickerLoadingByKey["notion-pages"] === true
                                    }
                                    className="rounded-xl border border-violet-300/15 bg-black/20 px-3 py-2 text-xs text-violet-100 disabled:opacity-40"
                                  >
                                    {pickerLoadingByKey["notion-pages"]
                                      ? "Loading pages..."
                                      : "Load pages"}
                                  </button>
                                </div>
                                {pickerErrorByTool["aos-notion"] ? (
                                  <div className="mb-4 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                                    {pickerErrorByTool["aos-notion"]}
                                  </div>
                                ) : null}
                                <div className="grid grid-cols-3 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Database id</span>
                                    <input
                                      value={draft.notion.databaseId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          notion: {
                                            ...current.notion,
                                            databaseId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="database id"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Page id</span>
                                    <input
                                      value={draft.notion.pageId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          notion: {
                                            ...current.notion,
                                            pageId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="page id"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Search query</span>
                                    <input
                                      value={draft.notion.searchQuery}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          notion: {
                                            ...current.notion,
                                            searchQuery: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="project plan, editorial calendar, launch checklist"
                                    />
                                  </label>
                                </div>
                                {notionPicker.databaseOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick database</span>
                                    <select
                                      value={draft.notion.databaseId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          notion: {
                                            ...current.notion,
                                            databaseId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live Notion database</option>
                                      {notionPicker.databaseOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.scopePreview
                                            ? `${option.label} · ${option.scopePreview}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {notionPicker.pageOptions.length > 0 ? (
                                  <label className="block mt-4">
                                    <span className="text-sm text-white/60">Pick page</span>
                                    <select
                                      value={draft.notion.pageId}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          notion: {
                                            ...current.notion,
                                            pageId: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    >
                                      <option value="">Choose a live Notion page</option>
                                      {notionPicker.pageOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.scopePreview
                                            ? `${option.label} · ${option.scopePreview}`
                                            : option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.notion.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        notion: {
                                          ...current.notion,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this to explain the Notion lane without replacing the database, page, or search fields."
                                  />
                                </label>
                              </div>
                            ) : null}

                            {draft.connectors.selected.includes("aos-wordpress") ? (
                              <div className="rounded-2xl border border-sky-400/15 bg-sky-500/[0.06] p-4 mb-4">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div>
                                    <div className="text-sm font-medium text-white">
                                      WordPress scope
                                    </div>
                                    <div className="text-xs text-white/45 mt-1">
                                      Pin the site, post type, and publishing status before the
                                      worker touches any publishing surface.
                                    </div>
                                  </div>
                                  <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs text-sky-100">
                                    {describeWordPressScope(draft) || "Scope not set"}
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                  <label className="block">
                                    <span className="text-sm text-white/60">Site or base URL</span>
                                    <input
                                      value={draft.wordpress.siteBaseUrl}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          wordpress: {
                                            ...current.wordpress,
                                            siteBaseUrl: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="https://example.com/wp-json or example.com"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Post type</span>
                                    <input
                                      value={draft.wordpress.postType}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          wordpress: {
                                            ...current.wordpress,
                                            postType: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="post, page, product, event"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-sm text-white/60">Status</span>
                                    <input
                                      value={draft.wordpress.status}
                                      onChange={(event) =>
                                        setDraftField((current) => ({
                                          ...current,
                                          wordpress: {
                                            ...current.wordpress,
                                            status: event.target.value,
                                          },
                                        }))
                                      }
                                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                      placeholder="draft, pending, future, publish"
                                    />
                                  </label>
                                </div>
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">
                                    Section or taxonomy cues
                                  </span>
                                  <textarea
                                    value={draft.wordpress.sectionTaxonomyCues}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        wordpress: {
                                          ...current.wordpress,
                                          sectionTaxonomyCues: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="News, tutorials, category slug, audience segment, editorial section"
                                  />
                                </label>
                                <label className="block mt-4">
                                  <span className="text-sm text-white/60">Scope notes</span>
                                  <textarea
                                    value={draft.wordpress.notes}
                                    onChange={(event) =>
                                      setDraftField((current) => ({
                                        ...current,
                                        wordpress: {
                                          ...current.wordpress,
                                          notes: event.target.value,
                                        },
                                      }))
                                    }
                                    rows={3}
                                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                                    placeholder="Use this to explain editorial constraints or publishing notes without replacing the structured fields."
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
                                  {draft.connectors.selected.includes("aos-google") ? (
                                    <div>
                                      <span className="text-white/45">Google scope:</span>{" "}
                                      {describeGoogleScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-slack") ? (
                                    <div>
                                      <span className="text-white/45">Slack scope:</span>{" "}
                                      {describeSlackScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-m365") ? (
                                    <div>
                                      <span className="text-white/45">Microsoft 365 scope:</span>{" "}
                                      {describeM365Scope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-hubspot") ? (
                                    <div>
                                      <span className="text-white/45">HubSpot scope:</span>{" "}
                                      {describeHubSpotScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-mailchimp") ? (
                                    <div>
                                      <span className="text-white/45">Mailchimp scope:</span>{" "}
                                      {describeMailchimpScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-klaviyo") ? (
                                    <div>
                                      <span className="text-white/45">Klaviyo scope:</span>{" "}
                                      {describeKlaviyoScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-buffer") ? (
                                    <div>
                                      <span className="text-white/45">Buffer scope:</span>{" "}
                                      {describeBufferScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-hootsuite") ? (
                                    <div>
                                      <span className="text-white/45">Hootsuite scope:</span>{" "}
                                      {describeHootsuiteScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-elevenlabs") ? (
                                    <div>
                                      <span className="text-white/45">ElevenLabs scope:</span>{" "}
                                      {describeElevenLabsScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-quickbooks") ? (
                                    <div>
                                      <span className="text-white/45">QuickBooks scope:</span>{" "}
                                      {describeQuickBooksScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-n8n") ? (
                                    <div>
                                      <span className="text-white/45">n8n scope:</span>{" "}
                                      {describeN8NScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-zapier") ? (
                                    <div>
                                      <span className="text-white/45">Zapier scope:</span>{" "}
                                      {describeZapierScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-shopify") ? (
                                    <div>
                                      <span className="text-white/45">Shopify scope:</span>{" "}
                                      {describeShopifyScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-airtable") ? (
                                    <div>
                                      <span className="text-white/45">Airtable scope:</span>{" "}
                                      {describeAirtableScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-stripe") ? (
                                    <div>
                                      <span className="text-white/45">Stripe scope:</span>{" "}
                                      {describeStripeScope(draft) || "Not set"}
                                    </div>
                                  ) : null}
                                  {draft.connectors.selected.includes("aos-wordpress") ? (
                                    <div>
                                      <span className="text-white/45">WordPress scope:</span>{" "}
                                      {describeWordPressScope(draft) || "Not set"}
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

                        <div
                          className={`rounded-2xl border p-4 ${
                            sourceReadiness.ok
                              ? "border-emerald-400/20 bg-emerald-500/10"
                              : "border-amber-400/20 bg-amber-500/10"
                          }`}
                        >
                          <div
                            className={`flex items-center gap-2 font-medium mb-2 ${
                              sourceReadiness.ok ? "text-emerald-100" : "text-amber-100"
                            }`}
                          >
                            {sourceReadiness.ok ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : (
                              <AlertTriangle className="h-4 w-4" />
                            )}
                            Source readiness
                          </div>
                          <div
                            className={`text-sm ${
                              sourceReadiness.ok ? "text-emerald-100/80" : "text-amber-100/80"
                            }`}
                          >
                            {sourceReadiness.summary} {sourceReadiness.detail}
                          </div>
                        </div>

                        {connectorReadiness.length > 0 ? (
                          <div
                            className={`rounded-2xl border p-4 ${
                              connectorLaunchBlockers.length === 0
                                ? "border-emerald-400/20 bg-emerald-500/10"
                                : "border-amber-400/20 bg-amber-500/10"
                            }`}
                          >
                            <div
                              className={`flex items-center gap-2 font-medium mb-2 ${
                                connectorLaunchBlockers.length === 0
                                  ? "text-emerald-100"
                                  : "text-amber-100"
                              }`}
                            >
                              {connectorLaunchBlockers.length === 0 ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : (
                                <AlertTriangle className="h-4 w-4" />
                              )}
                              Connector readiness
                            </div>
                            <div className="space-y-2 text-sm">
                              {connectorReadiness.map((entry) => (
                                <div
                                  key={`setup-${entry.tool}`}
                                  className={`rounded-xl border px-3 py-2 ${
                                    entry.blocking
                                      ? "border-amber-300/10 bg-black/15 text-amber-100/80"
                                      : "border-emerald-300/10 bg-black/15 text-emerald-100/80"
                                  }`}
                                >
                                  <div className="font-medium">
                                    {entry.label} · {entry.statusLabel}
                                  </div>
                                  <div className="text-xs mt-1 opacity-80">{entry.detail}</div>
                                </div>
                              ))}
                            </div>
                            {onOpenSystems && connectorLaunchBlockers.length > 0 ? (
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
                        ) : null}

                        {draft.launch.state === "play" && playBlockedReasons.length > 0 ? (
                          <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4">
                            <div className="flex items-center gap-2 text-rose-100 font-medium mb-2">
                              <ShieldAlert className="h-4 w-4" /> Play is blocked
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

                        {selectedIncompleteConnectors.length > 0 ? (
                          <div className="space-y-3">
                            {selectedIncompleteConnectors.map((connector) => {
                              const autoRefreshUntil =
                                connectorSetupAutoRefreshUntilByTool[connector.tool];
                              return (
                                <ConnectorSetupCard
                                  key={`launch-setup-${connector.tool}`}
                                  connector={connector}
                                  setupStatus={
                                    Object.prototype.hasOwnProperty.call(
                                      connectorSetupByTool,
                                      connector.tool,
                                    )
                                      ? connectorSetupByTool[connector.tool]
                                      : undefined
                                  }
                                  loading={connectorSetupLoadingByTool[connector.tool] === true}
                                  launchingAction={
                                    connectorSetupLaunchActionByTool[connector.tool] ?? null
                                  }
                                  autoRefreshing={
                                    typeof autoRefreshUntil === "number" &&
                                    autoRefreshUntil > Date.now()
                                  }
                                  disabled={saving}
                                  onOpenApiKeys={onOpenApiKeys}
                                  onCheck={(installMissing) => {
                                    setStep("tools");
                                    void loadConnectorSetupStatus(connector.tool, {
                                      manual: true,
                                      installMissing,
                                    });
                                  }}
                                  onLaunch={(action) => {
                                    setStep("tools");
                                    void launchConnectorSetup(connector.tool, action);
                                  }}
                                  onOpenSystems={onOpenSystems}
                                  compact
                                />
                              );
                            })}
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
                            <div>
                              <span className="text-white/45">Connector actions:</span>{" "}
                              {selectedConnectorActions.length}
                            </div>
                            {draft.connectors.selected.includes("aos-google") ? (
                              <div>
                                <span className="text-white/45">Google scope:</span>{" "}
                                {describeGoogleScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-slack") ? (
                              <div>
                                <span className="text-white/45">Slack scope:</span>{" "}
                                {describeSlackScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-m365") ? (
                              <div>
                                <span className="text-white/45">Microsoft 365 scope:</span>{" "}
                                {describeM365Scope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-hubspot") ? (
                              <div>
                                <span className="text-white/45">HubSpot scope:</span>{" "}
                                {describeHubSpotScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-mailchimp") ? (
                              <div>
                                <span className="text-white/45">Mailchimp scope:</span>{" "}
                                {describeMailchimpScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-klaviyo") ? (
                              <div>
                                <span className="text-white/45">Klaviyo scope:</span>{" "}
                                {describeKlaviyoScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-buffer") ? (
                              <div>
                                <span className="text-white/45">Buffer scope:</span>{" "}
                                {describeBufferScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-hootsuite") ? (
                              <div>
                                <span className="text-white/45">Hootsuite scope:</span>{" "}
                                {describeHootsuiteScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-elevenlabs") ? (
                              <div>
                                <span className="text-white/45">ElevenLabs scope:</span>{" "}
                                {describeElevenLabsScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-quickbooks") ? (
                              <div>
                                <span className="text-white/45">QuickBooks scope:</span>{" "}
                                {describeQuickBooksScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-n8n") ? (
                              <div>
                                <span className="text-white/45">n8n scope:</span>{" "}
                                {describeN8NScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-zapier") ? (
                              <div>
                                <span className="text-white/45">Zapier scope:</span>{" "}
                                {describeZapierScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-shopify") ? (
                              <div>
                                <span className="text-white/45">Shopify scope:</span>{" "}
                                {describeShopifyScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-airtable") ? (
                              <div>
                                <span className="text-white/45">Airtable scope:</span>{" "}
                                {describeAirtableScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-stripe") ? (
                              <div>
                                <span className="text-white/45">Stripe scope:</span>{" "}
                                {describeStripeScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-notion") ? (
                              <div>
                                <span className="text-white/45">Notion scope:</span>{" "}
                                {describeNotionScope(draft) || "Not set"}
                              </div>
                            ) : null}
                            {draft.connectors.selected.includes("aos-wordpress") ? (
                              <div>
                                <span className="text-white/45">WordPress scope:</span>{" "}
                                {describeWordPressScope(draft) || "Not set"}
                              </div>
                            ) : null}
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
                          saving ||
                          (step === "launch" &&
                            draft.launch.state === "play" &&
                            playBlockedReasons.length > 0)
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
