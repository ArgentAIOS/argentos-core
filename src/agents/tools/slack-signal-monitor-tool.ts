import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, STATE_DIR, type ArgentConfig } from "../../config/config.js";
import { resolveAgentMainSessionKey } from "../../config/sessions.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import { resolveSlackAccount } from "../../slack/accounts.js";
import { readSlackMessages, getSlackMemberInfo } from "../../slack/actions.js";
import { listSlackChannels, resolveSlackChannelAllowlist } from "../../slack/resolve-channels.js";
import { resolveSlackUserAllowlist } from "../../slack/resolve-users.js";
import { fetchSlackScopes } from "../../slack/scopes.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { createAudioAlertTool } from "./audio-alert-tool.js";
import {
  type AnyAgentTool,
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
} from "./common.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";

const SLACK_SIGNAL_ACTIONS = [
  "status",
  "set_config",
  "scan_now",
  "ensure_cron_monitor",
  "disable_cron_monitor",
  "clear_seen",
] as const;

const DEFAULT_STATE_PATH = path.join(STATE_DIR, "slack-signal-monitor-state.json");
const DEFAULT_INTERVAL_SECONDS = 300;
const DEFAULT_LOOKBACK_MINUTES = 10;
const DEFAULT_MAX_MESSAGES_PER_CHANNEL = 120;
const DEFAULT_MAX_AUDIO_ALERTS = 5;
const RECENT_HITS_CAP = 300;
const DEFAULT_CRON_JOB_NAME = "Slack Signal Monitor - Mention + Keyword Scan";
const SEEN_MAP_CAP = 10_000;
const SLACK_SIGNAL_SKILL_HINT = "skills/slack-signal-monitor/SKILL.md";
const ALL_CHANNELS_SENTINELS = new Set(["*", "all", "allchannels"]);

const DEFAULT_KEYWORD_WATCHLIST = [
  "DNS",
  "DMARC",
  "DKIM",
  "SPF",
  "domain transfer",
  "website",
  "web development",
  "deploy",
  "hosting",
  "SSL",
  "Barrett",
  "urgent",
  "ASAP",
  "blocked",
];

const HIGH_SIGNAL_KEYWORDS = new Set(["urgent", "asap", "blocked"]);

const FALLBACK_USER_NAMES: Record<string, string> = {
  UD3A8KLT0: "Richard Avery",
  UD5UV7MR7: "Ben",
};

const SlackSignalMonitorSchema = Type.Object({
  action: Type.Union(
    SLACK_SIGNAL_ACTIONS.map((action) => Type.Literal(action)) as [
      ReturnType<typeof Type.Literal>,
      ...Array<ReturnType<typeof Type.Literal>>,
    ],
  ),
  accountId: Type.Optional(
    Type.String({ description: "Slack account id from channels.slack.accounts" }),
  ),
  monitorAllChannels: Type.Optional(Type.Boolean()),
  watchedChannels: Type.Optional(Type.Array(Type.String())),
  keywordWatchlist: Type.Optional(Type.Array(Type.String())),
  mentionUserIds: Type.Optional(Type.Array(Type.String())),
  mentionNames: Type.Optional(Type.Array(Type.String())),
  lookbackMinutes: Type.Optional(Type.Number({ minimum: 1, maximum: 180 })),
  maxMessagesPerChannel: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
  intervalSeconds: Type.Optional(Type.Number({ minimum: 10, maximum: 86_400 })),
  resolveUserNames: Type.Optional(Type.Boolean()),
  taskCreationEnabled: Type.Optional(Type.Boolean()),
  taskAssignee: Type.Optional(Type.String()),
  audioAlertEnabled: Type.Optional(Type.Boolean()),
  mainSessionAudioAlert: Type.Optional(Type.Boolean()),
  emitAlerts: Type.Optional(Type.Boolean()),
  createTasks: Type.Optional(Type.Boolean()),
  maxAudioAlerts: Type.Optional(Type.Number({ minimum: 0, maximum: 20 })),
  includeEvents: Type.Optional(Type.Boolean()),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number({ minimum: 1 })),
});

type UnknownRecord = Record<string, unknown>;

type SlackSignalState = {
  version: 1;
  accountId?: string;
  monitorAllChannels: boolean;
  watchedChannels: string[];
  keywordWatchlist: string[];
  mentionUserIds: string[];
  mentionNames: string[];
  lookbackMinutes: number;
  maxMessagesPerChannel: number;
  intervalSeconds: number;
  resolveUserNames: boolean;
  taskCreationEnabled: boolean;
  taskAssignee?: string;
  audioAlertEnabled: boolean;
  mainSessionAudioAlert: boolean;
  maxAudioAlerts: number;
  seenByKey: Record<string, number>;
  recentHits: Array<{
    detectedAt: string;
    type: "mention" | "keyword";
    channelName: string;
    senderName: string;
    summary: string;
    keywordHits: string[];
  }>;
  cronMonitorJobId?: string;
  updatedAt: string;
};

type SlackSignalEvent = {
  key: string;
  ts: string;
  type: "mention" | "keyword";
  channelId: string;
  channelName: string;
  senderId: string;
  senderName: string;
  text: string;
  summary: string;
  keywordHits: string[];
  highSignal: boolean;
  actionable: boolean;
};

type ScanResult = {
  events: SlackSignalEvent[];
  scannedChannelIds: string[];
  mentionCount: number;
  keywordCount: number;
  highSignalKeywordCount: number;
  actionableCount: number;
  scanErrors: string[];
  userResolutionWarnings: string[];
};

type CronMonitorCandidate = {
  id: string;
  name?: string;
  enabled: boolean;
  payloadKind?: string;
  updatedAtMs?: number;
};

type ResolvedCronMonitorJobs = {
  selected?: CronMonitorCandidate;
  duplicates: CronMonitorCandidate[];
};

type ResolvedSlackReadContext = {
  accountId?: string;
  token?: string;
  tokenSource: "user" | "bot" | "none";
  accountEnabled: boolean;
};

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBooleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const raw = params[key];
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
}

function normalizeStringList(entries: string[] | undefined, opts?: { lower?: boolean }): string[] {
  if (!entries || entries.length === 0) {
    return [];
  }
  const normalized = new Set<string>();
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    normalized.add(opts?.lower ? trimmed.toLowerCase() : trimmed);
  }
  return Array.from(normalized.values());
}

function normalizeSlackUserIds(entries: string[] | undefined): string[] {
  if (!entries || entries.length === 0) {
    return [];
  }
  const normalized = new Set<string>();
  for (const entry of entries) {
    const match = entry.trim().match(/^<@([A-Z0-9]+)>$/i);
    const raw = match?.[1] ?? entry.trim();
    if (!raw) {
      continue;
    }
    normalized.add(raw.toUpperCase());
  }
  return Array.from(normalized.values()).toSorted();
}

function normalizeAllChannelsToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[-_\s]+/g, "");
}

function isAllChannelsToken(value: string): boolean {
  return ALL_CHANNELS_SENTINELS.has(normalizeAllChannelsToken(value));
}

function normalizeWatchedChannels(entries: string[] | undefined): string[] {
  if (!entries || entries.length === 0) {
    return [];
  }
  return normalizeStringList(entries.filter((entry) => !isAllChannelsToken(entry)));
}

function includesAllChannelsToken(entries: string[] | undefined): boolean {
  if (!entries || entries.length === 0) {
    return false;
  }
  return entries.some((entry) => isAllChannelsToken(entry));
}

function defaultState(): SlackSignalState {
  return {
    version: 1,
    monitorAllChannels: true,
    watchedChannels: [],
    keywordWatchlist: [...DEFAULT_KEYWORD_WATCHLIST],
    mentionUserIds: [],
    mentionNames: ["jason"],
    lookbackMinutes: DEFAULT_LOOKBACK_MINUTES,
    maxMessagesPerChannel: DEFAULT_MAX_MESSAGES_PER_CHANNEL,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    resolveUserNames: true,
    taskCreationEnabled: true,
    taskAssignee: "jason",
    audioAlertEnabled: true,
    mainSessionAudioAlert: true,
    maxAudioAlerts: DEFAULT_MAX_AUDIO_ALERTS,
    seenByKey: {},
    recentHits: [],
    updatedAt: new Date().toISOString(),
  };
}

function compactSeenMap(state: SlackSignalState) {
  const entries = Object.entries(state.seenByKey);
  if (entries.length <= SEEN_MAP_CAP) {
    return;
  }
  const keep = entries.toSorted((a, b) => Number(b[1]) - Number(a[1])).slice(0, SEEN_MAP_CAP);
  state.seenByKey = Object.fromEntries(keep);
}

function normalizeState(raw: unknown): SlackSignalState {
  if (!isRecord(raw)) {
    return defaultState();
  }
  const base = defaultState();
  const keywordWatchlist = Array.isArray(raw.keywordWatchlist)
    ? normalizeStringList(
        raw.keywordWatchlist.filter((value): value is string => typeof value === "string"),
      )
    : base.keywordWatchlist;
  const mentionNames = Array.isArray(raw.mentionNames)
    ? normalizeStringList(
        raw.mentionNames.filter((value): value is string => typeof value === "string"),
        {
          lower: true,
        },
      )
    : base.mentionNames;
  const mentionUserIds = Array.isArray(raw.mentionUserIds)
    ? normalizeSlackUserIds(
        raw.mentionUserIds.filter((value): value is string => typeof value === "string"),
      )
    : base.mentionUserIds;
  const watchedChannelsInput = Array.isArray(raw.watchedChannels)
    ? raw.watchedChannels.filter((value): value is string => typeof value === "string")
    : undefined;
  const watchedChannels = normalizeWatchedChannels(watchedChannelsInput) ?? base.watchedChannels;
  const monitorAllFromWatchlist = includesAllChannelsToken(watchedChannelsInput);
  const seenByKey = isRecord(raw.seenByKey)
    ? Object.fromEntries(
        Object.entries(raw.seenByKey)
          .filter(
            (entry): entry is [string, number] =>
              typeof entry[0] === "string" &&
              typeof entry[1] === "number" &&
              Number.isFinite(entry[1]),
          )
          .map(([key, value]) => [key, Math.floor(value)]),
      )
    : base.seenByKey;
  const recentHits = Array.isArray(raw.recentHits)
    ? raw.recentHits
        .filter((entry): entry is SlackSignalState["recentHits"][number] => {
          if (!isRecord(entry)) {
            return false;
          }
          return (
            (entry.type === "mention" || entry.type === "keyword") &&
            typeof entry.detectedAt === "string" &&
            typeof entry.channelName === "string" &&
            typeof entry.senderName === "string" &&
            typeof entry.summary === "string" &&
            Array.isArray(entry.keywordHits)
          );
        })
        .slice(0, RECENT_HITS_CAP)
    : base.recentHits;

  return {
    version: 1,
    accountId:
      typeof raw.accountId === "string" && raw.accountId.trim() ? raw.accountId.trim() : undefined,
    monitorAllChannels:
      typeof raw.monitorAllChannels === "boolean"
        ? raw.monitorAllChannels
        : monitorAllFromWatchlist,
    watchedChannels,
    keywordWatchlist: keywordWatchlist.length > 0 ? keywordWatchlist : base.keywordWatchlist,
    mentionUserIds,
    mentionNames: mentionNames.length > 0 ? mentionNames : base.mentionNames,
    lookbackMinutes:
      typeof raw.lookbackMinutes === "number" && Number.isFinite(raw.lookbackMinutes)
        ? Math.max(1, Math.min(180, Math.floor(raw.lookbackMinutes)))
        : base.lookbackMinutes,
    maxMessagesPerChannel:
      typeof raw.maxMessagesPerChannel === "number" && Number.isFinite(raw.maxMessagesPerChannel)
        ? Math.max(1, Math.min(1000, Math.floor(raw.maxMessagesPerChannel)))
        : base.maxMessagesPerChannel,
    intervalSeconds:
      typeof raw.intervalSeconds === "number" && Number.isFinite(raw.intervalSeconds)
        ? Math.max(10, Math.min(86_400, Math.floor(raw.intervalSeconds)))
        : base.intervalSeconds,
    resolveUserNames:
      typeof raw.resolveUserNames === "boolean" ? raw.resolveUserNames : base.resolveUserNames,
    taskCreationEnabled:
      typeof raw.taskCreationEnabled === "boolean"
        ? raw.taskCreationEnabled
        : base.taskCreationEnabled,
    taskAssignee:
      typeof raw.taskAssignee === "string" && raw.taskAssignee.trim()
        ? raw.taskAssignee.trim()
        : base.taskAssignee,
    audioAlertEnabled:
      typeof raw.audioAlertEnabled === "boolean" ? raw.audioAlertEnabled : base.audioAlertEnabled,
    mainSessionAudioAlert:
      typeof raw.mainSessionAudioAlert === "boolean"
        ? raw.mainSessionAudioAlert
        : base.mainSessionAudioAlert,
    maxAudioAlerts:
      typeof raw.maxAudioAlerts === "number" && Number.isFinite(raw.maxAudioAlerts)
        ? Math.max(0, Math.min(20, Math.floor(raw.maxAudioAlerts)))
        : base.maxAudioAlerts,
    seenByKey,
    recentHits,
    cronMonitorJobId:
      typeof raw.cronMonitorJobId === "string" && raw.cronMonitorJobId.trim()
        ? raw.cronMonitorJobId.trim()
        : undefined,
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt.trim()
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}

async function loadState(filePath: string): Promise<SlackSignalState> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return defaultState();
  }
}

async function saveState(filePath: string, state: SlackSignalState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  compactSeenMap(state);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function normalizeCronNameForMatch(value: string): string {
  return value
    .replaceAll(/\p{Pd}/gu, "-")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toCronMonitorCandidate(raw: unknown): CronMonitorCandidate | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) {
    return null;
  }
  const payload = isRecord(raw.payload) ? raw.payload : undefined;
  return {
    id,
    name: typeof raw.name === "string" ? raw.name.trim() : undefined,
    enabled: raw.enabled !== false,
    payloadKind: typeof payload?.kind === "string" ? payload.kind : undefined,
    updatedAtMs: typeof raw.updatedAtMs === "number" ? raw.updatedAtMs : undefined,
  };
}

function isSlackMonitorCandidate(job: CronMonitorCandidate): boolean {
  if (job.payloadKind === "slackSignalScan") {
    return true;
  }
  const name = job.name ? normalizeCronNameForMatch(job.name) : "";
  return name.includes("slack signal") || name.includes("slack monitor");
}

function selectCronMonitorJobs(params: {
  jobs: CronMonitorCandidate[];
  preferredId?: string;
}): ResolvedCronMonitorJobs {
  const candidates = params.jobs.filter(isSlackMonitorCandidate);
  if (candidates.length === 0) {
    return { selected: undefined, duplicates: [] };
  }

  const preferred =
    params.preferredId &&
    candidates.find(
      (job) => job.id === params.preferredId && job.payloadKind === "slackSignalScan",
    );

  const scored = candidates
    .map((job, index) => ({
      job,
      index,
      score:
        (job.payloadKind === "slackSignalScan" ? 100 : 0) +
        (job.enabled ? 50 : 0) +
        Math.min(Math.floor((job.updatedAtMs ?? 0) / 1_000), 25),
    }))
    .toSorted((a, b) => b.score - a.score || a.index - b.index);

  const selected = preferred ?? scored[0]?.job;
  const duplicates = selected ? candidates.filter((job) => job.id !== selected.id) : [];
  return { selected, duplicates };
}

async function resolveCronMonitorJobs(params: {
  gatewayOpts: GatewayCallOptions;
  state: SlackSignalState;
}): Promise<ResolvedCronMonitorJobs> {
  const listed = await callGatewayTool<{ jobs?: unknown }>("cron.list", params.gatewayOpts, {
    includeDisabled: true,
  });
  const rawJobs = Array.isArray(listed?.jobs) ? listed.jobs : [];
  const parsed = rawJobs
    .map((raw) => toCronMonitorCandidate(raw))
    .filter((job): job is CronMonitorCandidate => Boolean(job));
  return selectCronMonitorJobs({
    jobs: parsed,
    preferredId: params.state.cronMonitorJobId,
  });
}

function cleanSlackText(input: string): string {
  return input
    .replaceAll(/<@([A-Z0-9]+)>/gi, "@$1")
    .replaceAll(/<#[A-Z0-9]+\|([^>]+)>/gi, "#$1")
    .replaceAll(/<mailto:([^|>]+)\|([^>]+)>/gi, "$2")
    .replaceAll(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replaceAll(/[\t\n\r]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function summarizeMessage(text: string, max = 180): string {
  const cleaned = cleanSlackText(text);
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(1, max - 3)).trimEnd()}...`;
}

function extractMentionedUserIds(text: string): Set<string> {
  const matches = new Set<string>();
  const regex = /<@([A-Z0-9]+)>/gi;
  for (const match of text.matchAll(regex)) {
    const id = match[1]?.trim().toUpperCase();
    if (id) {
      matches.add(id);
    }
  }
  return matches;
}

function matchKeywords(text: string, watchlist: string[]): string[] {
  const lower = cleanSlackText(text).toLowerCase();
  const hits: string[] = [];
  for (const keyword of watchlist) {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    if (lower.includes(normalized)) {
      hits.push(keyword);
    }
  }
  return hits;
}

function isHighSignalKeywordHit(keywordHits: string[], text: string): boolean {
  if (keywordHits.length === 0) {
    return false;
  }
  if (keywordHits.some((keyword) => HIGH_SIGNAL_KEYWORDS.has(keyword.toLowerCase()))) {
    return true;
  }
  if (keywordHits.length >= 2) {
    return true;
  }
  const lower = cleanSlackText(text).toLowerCase();
  return lower.includes("?");
}

function isActionableMention(text: string): boolean {
  const lower = cleanSlackText(text).toLowerCase();
  if (lower.includes("?")) {
    return true;
  }
  if (/\b(can you|could you|would you|please|need you to|can u|could u|would u)\b/i.test(lower)) {
    return true;
  }
  if (/(urgent|asap|blocked).{0,24}jason|jason.{0,24}(urgent|asap|blocked)/i.test(lower)) {
    return true;
  }
  return false;
}

function resolveSlackReadContext(
  cfg: ArgentConfig,
  state: SlackSignalState,
): ResolvedSlackReadContext {
  const account = resolveSlackAccount({ cfg, accountId: state.accountId });
  const userToken = account.config.userToken?.trim() || undefined;
  const botToken = account.botToken?.trim() || undefined;
  const token = userToken || botToken;
  return {
    accountId: account.accountId,
    token,
    tokenSource: userToken ? "user" : botToken ? "bot" : "none",
    accountEnabled: account.enabled,
  };
}

function buildSetupRequiredPayload(params: {
  reason: string;
  state: SlackSignalState;
  readContext: ResolvedSlackReadContext;
}) {
  const commands: string[] = [];
  if (params.readContext.tokenSource === "none") {
    commands.push("Configure channels.slack.botToken (or userToken) in argent.json");
  }
  if (!params.state.monitorAllChannels && params.state.watchedChannels.length === 0) {
    commands.push(
      'Set monitor scope with slack_signal_monitor action="set_config" and either monitorAllChannels=true or watchedChannels=["C..."]',
    );
  }
  return {
    ok: false,
    setupRequired: true,
    reason: params.reason,
    nextStep: {
      skill: "slack-signal-monitor",
      skillPathHint: SLACK_SIGNAL_SKILL_HINT,
      guidance:
        "Configure Slack token/scopes and monitor scope, then run slack_signal_monitor action=status until setupRequired=false.",
      commands,
    },
  };
}

function extractToolText(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("content" in result)) {
    return undefined;
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textBlock = content.find(
    (item) =>
      item &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
  ) as { text?: string } | undefined;
  return textBlock?.text?.trim() || undefined;
}

function formatMentionAlert(event: SlackSignalEvent) {
  const sender = event.senderName || event.senderId;
  const message = `Hey Jason, ${sender} mentioned you in #${event.channelName} - ${event.summary}`;
  return {
    title: `Slack mention: ${sender}`,
    message,
  };
}

function formatKeywordAlert(event: SlackSignalEvent) {
  const keyword = event.keywordHits[0] ?? "a watched keyword";
  const message = `Hey Jason, someone in #${event.channelName} is talking about ${keyword} - ${event.summary}`;
  return {
    title: `Slack keyword: ${keyword}`,
    message,
  };
}

async function dispatchMainSessionAudioAlerts(params: {
  cfg: ArgentConfig;
  gatewayOpts: GatewayCallOptions;
  events: SlackSignalEvent[];
  mainSessionKey: string;
  agentSessionKey?: string;
  maxAudioAlerts: number;
}): Promise<{ sent: number; failed: number; errors: string[] }> {
  if (params.events.length === 0 || params.maxAudioAlerts <= 0) {
    return { sent: 0, failed: 0, errors: [] };
  }

  const audioTool = createAudioAlertTool({
    config: params.cfg,
    agentSessionKey: params.agentSessionKey,
  });

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const event of params.events.slice(0, params.maxAudioAlerts)) {
    try {
      const composed =
        event.type === "mention" ? formatMentionAlert(event) : formatKeywordAlert(event);
      const urgency = event.actionable || event.highSignal ? "urgent" : "warning";
      const audioResult = await audioTool.execute(`slack-signal-audio-${Date.now()}-${sent}`, {
        message: composed.message,
        title: composed.title,
        urgency,
        mood: urgency === "urgent" ? "urgent" : "serious",
      });

      const generatedText = extractToolText(audioResult);
      const injectMessage =
        generatedText && generatedText.length > 0
          ? generatedText
          : `[ALERT_WARN:${composed.title}]\n${composed.message}`;

      await callGatewayTool("chat.inject", params.gatewayOpts, {
        sessionKey: params.mainSessionKey,
        message: injectMessage,
        label: "Slack Signal Alert",
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { sent, failed, errors };
}

async function createTasksForActionableMentions(params: {
  events: SlackSignalEvent[];
  taskAssignee?: string;
  agentId?: string;
}): Promise<{
  created: number;
  failed: number;
  tasks: Array<{ id: string; title: string }>;
  errors: string[];
}> {
  const actionable = params.events.filter((event) => event.type === "mention" && event.actionable);
  if (actionable.length === 0) {
    return { created: 0, failed: 0, tasks: [], errors: [] };
  }

  const storage = getStorageAdapter();
  let created = 0;
  let failed = 0;
  const tasks: Array<{ id: string; title: string }> = [];
  const errors: string[] = [];

  for (const event of actionable) {
    const priority = /(urgent|asap|blocked)/i.test(event.text) ? "urgent" : "high";
    const title = `Slack follow-up: ${event.senderName} in #${event.channelName}`;
    const description = [
      `Channel: ${event.channelName} (${event.channelId})`,
      `Sender: ${event.senderName} (${event.senderId})`,
      `Message TS: ${event.ts}`,
      "",
      `Message: ${cleanSlackText(event.text)}`,
    ].join("\n");

    try {
      const createdTask = await storage.tasks.create({
        title,
        description,
        priority,
        assignee: params.taskAssignee,
        tags: ["slack", "mention", "signal-monitor"],
        source: "agent",
        agentId: params.agentId,
      });
      tasks.push({ id: createdTask.id, title: createdTask.title });
      created += 1;
    } catch (err) {
      failed += 1;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { created, failed, tasks, errors };
}

async function scanSlackSignals(params: {
  cfg: ArgentConfig;
  state: SlackSignalState;
  readContext: ResolvedSlackReadContext;
  lookbackMinutes: number;
  maxMessagesPerChannel: number;
}): Promise<ScanResult> {
  const scanErrors: string[] = [];
  const userResolutionWarnings: string[] = [];
  const events: SlackSignalEvent[] = [];

  const mentionUserIds = new Set(params.state.mentionUserIds);
  if (
    params.state.mentionNames.length > 0 &&
    params.readContext.token &&
    params.state.resolveUserNames
  ) {
    try {
      const resolved = await resolveSlackUserAllowlist({
        token: params.readContext.token,
        entries: params.state.mentionNames,
      });
      for (const entry of resolved) {
        if (entry.resolved && entry.id) {
          mentionUserIds.add(entry.id);
        }
      }
    } catch (err) {
      userResolutionWarnings.push(
        `failed to resolve mention names via users.list (add users:read scope): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const channelNameById = new Map<string, string>();
  const channelIdsToScan = new Set<string>();
  if (params.state.monitorAllChannels) {
    if (!params.readContext.token) {
      scanErrors.push("monitorAllChannels requires a Slack token");
    } else {
      try {
        const channels = await listSlackChannels({ token: params.readContext.token });
        for (const channel of channels) {
          if (channel.archived) {
            continue;
          }
          channelIdsToScan.add(channel.id);
          channelNameById.set(channel.id, channel.name || channel.id);
        }
      } catch (err) {
        scanErrors.push(
          `failed to list Slack channels for monitorAllChannels: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } else if (params.readContext.token && params.state.watchedChannels.length > 0) {
    try {
      const resolvedChannels = await resolveSlackChannelAllowlist({
        token: params.readContext.token,
        entries: params.state.watchedChannels,
      });
      for (const channel of resolvedChannels) {
        if (channel.resolved && channel.id) {
          channelIdsToScan.add(channel.id);
          channelNameById.set(channel.id, channel.name || channel.id);
        }
      }
    } catch (err) {
      scanErrors.push(
        `failed to resolve channel names: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const senderNameCache = new Map<string, string>();
  for (const [userId, name] of Object.entries(FALLBACK_USER_NAMES)) {
    senderNameCache.set(userId, name);
  }

  const oldestTs = `${Math.max(0, Date.now() / 1000 - params.lookbackMinutes * 60)}`;
  if (channelIdsToScan.size === 0) {
    for (const channelId of params.state.watchedChannels) {
      channelIdsToScan.add(channelId);
    }
  }

  for (const channelId of channelIdsToScan) {
    try {
      const readRes = await readSlackMessages(channelId, {
        accountId: params.readContext.accountId,
        token: params.readContext.token,
        limit: params.maxMessagesPerChannel,
        after: oldestTs,
      });

      for (const message of readRes.messages) {
        const ts = typeof message.ts === "string" ? message.ts.trim() : "";
        const text = typeof message.text === "string" ? message.text : "";
        const senderId = typeof message.user === "string" ? message.user.trim().toUpperCase() : "";
        if (!ts || !text || !senderId) {
          continue;
        }
        const key = `${channelId}:${ts}`;
        if (params.state.seenByKey[key]) {
          continue;
        }

        const mentionedIds = extractMentionedUserIds(text);
        const mentionById = Array.from(mentionedIds).some((id) => mentionUserIds.has(id));
        const lowerText = cleanSlackText(text).toLowerCase();
        const mentionByName = params.state.mentionNames.some((name) => lowerText.includes(name));
        const hasMention = mentionById || mentionByName;

        const keywordHits = matchKeywords(text, params.state.keywordWatchlist);
        const hasKeyword = keywordHits.length > 0;
        if (!hasMention && !hasKeyword) {
          continue;
        }

        params.state.seenByKey[key] = Date.now();

        if (!senderNameCache.has(senderId)) {
          if (params.state.resolveUserNames && params.readContext.token) {
            try {
              const info = await getSlackMemberInfo(senderId, {
                accountId: params.readContext.accountId,
                token: params.readContext.token,
              });
              const user = isRecord(info.user) ? info.user : undefined;
              const profile = user && isRecord(user.profile) ? user.profile : undefined;
              const resolvedName =
                (typeof profile?.display_name === "string" && profile.display_name.trim()) ||
                (typeof profile?.real_name === "string" && profile.real_name.trim()) ||
                (typeof user?.name === "string" && user.name.trim()) ||
                FALLBACK_USER_NAMES[senderId] ||
                senderId;
              senderNameCache.set(senderId, resolvedName);
            } catch (err) {
              senderNameCache.set(senderId, FALLBACK_USER_NAMES[senderId] || senderId);
              userResolutionWarnings.push(
                `failed to resolve user ${senderId} (add users:read scope): ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          } else {
            senderNameCache.set(senderId, FALLBACK_USER_NAMES[senderId] || senderId);
          }
        }

        const type: "mention" | "keyword" = hasMention ? "mention" : "keyword";
        const highSignal = hasMention ? true : isHighSignalKeywordHit(keywordHits, text);
        const actionable = hasMention ? isActionableMention(text) : false;
        const channelName = channelNameById.get(channelId) || channelId;

        events.push({
          key,
          ts,
          type,
          channelId,
          channelName,
          senderId,
          senderName: senderNameCache.get(senderId) || senderId,
          text,
          summary: summarizeMessage(text),
          keywordHits,
          highSignal,
          actionable,
        });
      }
    } catch (err) {
      scanErrors.push(`channel ${channelId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const mentionCount = events.filter((event) => event.type === "mention").length;
  const keywordOnly = events.filter((event) => event.type === "keyword");
  const highSignalKeywordCount = keywordOnly.filter((event) => event.highSignal).length;
  const actionableCount = events.filter((event) => event.actionable).length;

  const keywordCount = keywordOnly.length;
  const sorted = events.toSorted((a, b) => Number.parseFloat(b.ts) - Number.parseFloat(a.ts));

  return {
    events: sorted,
    scannedChannelIds: Array.from(channelIdsToScan.values()),
    mentionCount,
    keywordCount,
    highSignalKeywordCount,
    actionableCount,
    scanErrors,
    userResolutionWarnings: Array.from(new Set(userResolutionWarnings)),
  };
}

export function createSlackSignalMonitorTool(options?: {
  config?: ArgentConfig;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Slack Signal Monitor",
    name: "slack_signal_monitor",
    description: `Monitor Slack for high-signal mentions and keyword hits.

Capabilities:
- Detect new @mentions of Jason and watched keyword conversations.
- Monitor either an explicit channel allowlist or all visible Slack channels.
- Deduplicate seen messages across scans.
- Send spoken/audio alerts to the main session for mention + high-signal keyword matches.
- Create tasks for actionable @mentions.
- Install/disable a deterministic cron monitor (every 5 minutes by default).

Actions:
- status
- set_config
- scan_now
- ensure_cron_monitor
- disable_cron_monitor
- clear_seen`,
    parameters: SlackSignalMonitorSchema,
    execute: async (_toolCallId, args) => {
      const params = (args as Record<string, unknown>) ?? {};
      const action = readStringParam(params, "action", { required: true });
      const cfg = options?.config ?? loadConfig();
      const agentId = resolveSessionAgentId({
        sessionKey: options?.agentSessionKey,
        config: cfg,
      });
      const statePath = DEFAULT_STATE_PATH;
      const state = await loadState(statePath);

      const gatewayOpts: GatewayCallOptions = {
        gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
        gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
        timeoutMs:
          (typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
            ? Math.max(1, Math.floor(params.timeoutMs))
            : undefined) ?? 30_000,
      };

      const accountOverride = readStringParam(params, "accountId");
      if (accountOverride) {
        state.accountId = accountOverride;
      }

      const readContext = resolveSlackReadContext(cfg, state);
      const setupMissing: string[] = [];
      if (!readContext.accountEnabled) {
        setupMissing.push("slack account disabled");
      }
      if (readContext.tokenSource === "none") {
        setupMissing.push("missing slack token");
      }
      if (!state.monitorAllChannels && state.watchedChannels.length === 0) {
        setupMissing.push("monitor scope not configured");
      }

      if (action === "status") {
        let scopes: { ok: boolean; scopes?: string[]; source?: string; error?: string } | undefined;
        if (readContext.token) {
          scopes = await fetchSlackScopes(readContext.token, gatewayOpts.timeoutMs ?? 30_000);
        }

        return jsonResult({
          ok: setupMissing.length === 0,
          setupRequired: setupMissing.length > 0,
          setupMissing,
          tokenSource: readContext.tokenSource,
          state: {
            ...state,
            accountId: readContext.accountId,
            recentHits: state.recentHits.slice(0, 50),
          },
          recommendations: {
            requiresUsersReadScope:
              scopes?.ok && Array.isArray(scopes.scopes)
                ? !scopes.scopes.includes("users:read")
                : true,
            knownFallbackUserNames: FALLBACK_USER_NAMES,
          },
          slackScopes: scopes,
        });
      }

      if (action === "set_config") {
        const monitorAllChannels = readBooleanParam(params, "monitorAllChannels");
        if (monitorAllChannels !== undefined) {
          state.monitorAllChannels = monitorAllChannels;
        }

        const watchedChannels = readStringArrayParam(params, "watchedChannels");
        if (watchedChannels) {
          state.watchedChannels = normalizeWatchedChannels(watchedChannels);
          if (monitorAllChannels === undefined) {
            if (includesAllChannelsToken(watchedChannels)) {
              state.monitorAllChannels = true;
            } else if (state.watchedChannels.length > 0) {
              state.monitorAllChannels = false;
            }
          }
        }

        const keywordWatchlist = readStringArrayParam(params, "keywordWatchlist");
        if (keywordWatchlist) {
          const normalized = normalizeStringList(keywordWatchlist);
          state.keywordWatchlist = normalized.length > 0 ? normalized : state.keywordWatchlist;
        }

        const mentionUserIds = readStringArrayParam(params, "mentionUserIds");
        if (mentionUserIds) {
          state.mentionUserIds = normalizeSlackUserIds(mentionUserIds);
        }

        const mentionNames = readStringArrayParam(params, "mentionNames");
        if (mentionNames) {
          const normalized = normalizeStringList(mentionNames, { lower: true });
          state.mentionNames = normalized.length > 0 ? normalized : state.mentionNames;
        }

        const intervalSeconds = readNumberParam(params, "intervalSeconds", { integer: true });
        if (intervalSeconds !== undefined) {
          state.intervalSeconds = Math.max(10, Math.min(86_400, intervalSeconds));
        }

        const lookbackMinutes = readNumberParam(params, "lookbackMinutes", { integer: true });
        if (lookbackMinutes !== undefined) {
          state.lookbackMinutes = Math.max(1, Math.min(180, lookbackMinutes));
        }

        const maxMessagesPerChannel = readNumberParam(params, "maxMessagesPerChannel", {
          integer: true,
        });
        if (maxMessagesPerChannel !== undefined) {
          state.maxMessagesPerChannel = Math.max(1, Math.min(1000, maxMessagesPerChannel));
        }

        const resolveUserNames = readBooleanParam(params, "resolveUserNames");
        if (resolveUserNames !== undefined) {
          state.resolveUserNames = resolveUserNames;
        }

        const taskCreationEnabled = readBooleanParam(params, "taskCreationEnabled");
        if (taskCreationEnabled !== undefined) {
          state.taskCreationEnabled = taskCreationEnabled;
        }

        const taskAssignee = readStringParam(params, "taskAssignee");
        if (taskAssignee !== undefined) {
          state.taskAssignee = taskAssignee.trim() || undefined;
        }

        const audioAlertEnabled = readBooleanParam(params, "audioAlertEnabled");
        if (audioAlertEnabled !== undefined) {
          state.audioAlertEnabled = audioAlertEnabled;
        }

        const mainSessionAudioAlert = readBooleanParam(params, "mainSessionAudioAlert");
        if (mainSessionAudioAlert !== undefined) {
          state.mainSessionAudioAlert = mainSessionAudioAlert;
        }

        const maxAudioAlerts = readNumberParam(params, "maxAudioAlerts", { integer: true });
        if (maxAudioAlerts !== undefined) {
          state.maxAudioAlerts = Math.max(0, Math.min(20, maxAudioAlerts));
        }

        await saveState(statePath, state);

        return jsonResult({
          ok: true,
          state,
        });
      }

      if (action === "clear_seen") {
        state.seenByKey = {};
        await saveState(statePath, state);
        return jsonResult({ ok: true, cleared: true });
      }

      if (action === "scan_now") {
        if (setupMissing.length > 0) {
          return jsonResult(
            buildSetupRequiredPayload({
              reason: `Slack signal monitor setup incomplete: ${setupMissing.join(", ")}`,
              state,
              readContext,
            }),
          );
        }

        const lookbackMinutes =
          readNumberParam(params, "lookbackMinutes", { integer: true }) ?? state.lookbackMinutes;
        const maxMessagesPerChannel =
          readNumberParam(params, "maxMessagesPerChannel", { integer: true }) ??
          state.maxMessagesPerChannel;
        const emitAlerts = readBooleanParam(params, "emitAlerts") ?? true;
        const createTasks = readBooleanParam(params, "createTasks") ?? state.taskCreationEnabled;

        const scan = await scanSlackSignals({
          cfg,
          state,
          readContext,
          lookbackMinutes: Math.max(1, Math.min(180, lookbackMinutes)),
          maxMessagesPerChannel: Math.max(1, Math.min(1000, maxMessagesPerChannel)),
        });
        if (scan.events.length > 0) {
          const nowIso = new Date().toISOString();
          const recent = scan.events.map((event) => ({
            detectedAt: nowIso,
            type: event.type,
            channelName: event.channelName,
            senderName: event.senderName,
            summary: event.summary,
            keywordHits: event.keywordHits,
          }));
          state.recentHits = [...recent, ...state.recentHits].slice(0, RECENT_HITS_CAP);
        }
        await saveState(statePath, state);

        if (scan.events.length === 0) {
          return jsonResult({
            ok: true,
            setupRequired: false,
            monitorAllChannels: state.monitorAllChannels,
            scannedChannels: scan.scannedChannelIds,
            newCount: 0,
            mentionCount: 0,
            keywordCount: 0,
            actionableCount: 0,
            message: "No new high-signal Slack events.",
          });
        }

        const mainSessionKey =
          options?.agentSessionKey ||
          resolveAgentMainSessionKey({
            cfg,
            agentId,
          });

        const eligibleAlerts = scan.events.filter(
          (event) => event.type === "mention" || event.highSignal,
        );
        const audioDispatch =
          emitAlerts && state.audioAlertEnabled && state.mainSessionAudioAlert
            ? await dispatchMainSessionAudioAlerts({
                cfg,
                gatewayOpts,
                events: eligibleAlerts,
                mainSessionKey,
                agentSessionKey: options?.agentSessionKey,
                maxAudioAlerts: state.maxAudioAlerts,
              })
            : { sent: 0, failed: 0, errors: [] as string[] };

        const taskDispatch = createTasks
          ? await createTasksForActionableMentions({
              events: scan.events,
              taskAssignee: state.taskAssignee,
              agentId,
            })
          : {
              created: 0,
              failed: 0,
              tasks: [] as Array<{ id: string; title: string }>,
              errors: [] as string[],
            };

        const includeEvents = readBooleanParam(params, "includeEvents") ?? true;

        return jsonResult({
          ok: true,
          setupRequired: false,
          monitorAllChannels: state.monitorAllChannels,
          scannedChannels: scan.scannedChannelIds,
          lookbackMinutes,
          maxMessagesPerChannel,
          newCount: scan.events.length,
          mentionCount: scan.mentionCount,
          keywordCount: scan.keywordCount,
          highSignalKeywordCount: scan.highSignalKeywordCount,
          actionableCount: scan.actionableCount,
          alertCandidates: eligibleAlerts.length,
          audioDispatch,
          taskDispatch,
          scanErrors: scan.scanErrors,
          userResolutionWarnings: scan.userResolutionWarnings,
          events: includeEvents ? scan.events : undefined,
        });
      }

      if (action === "ensure_cron_monitor") {
        if (setupMissing.length > 0) {
          return jsonResult(
            buildSetupRequiredPayload({
              reason: `Slack signal monitor setup incomplete: ${setupMissing.join(", ")}`,
              state,
              readContext,
            }),
          );
        }

        const intervalSeconds =
          readNumberParam(params, "intervalSeconds", { integer: true }) ?? state.intervalSeconds;
        const resolvedMonitor = await resolveCronMonitorJobs({
          gatewayOpts,
          state,
        });
        const existingId = resolvedMonitor.selected?.id;
        const schedule = { kind: "every" as const, everyMs: intervalSeconds * 1000 };
        const payload = {
          kind: "slackSignalScan" as const,
          emitAlerts: true,
          createTasks: true,
          accountId: state.accountId,
        };
        const delivery = { mode: "none" as const };

        let jobId = existingId;
        if (existingId) {
          await callGatewayTool("cron.update", gatewayOpts, {
            id: existingId,
            patch: {
              name: DEFAULT_CRON_JOB_NAME,
              enabled: true,
              schedule,
              sessionTarget: "isolated",
              wakeMode: "next-heartbeat",
              payload,
              delivery,
            },
          });
        } else {
          const created = await callGatewayTool<{ job?: { id?: string } }>(
            "cron.add",
            gatewayOpts,
            {
              name: DEFAULT_CRON_JOB_NAME,
              description:
                "Scan Slack for mentions and watched keywords, send audio alerts, and auto-create actionable tasks.",
              enabled: true,
              schedule,
              sessionTarget: "isolated",
              wakeMode: "next-heartbeat",
              payload,
              delivery,
              agentId,
            },
          );
          jobId =
            (created?.job && typeof created.job.id === "string" ? created.job.id : undefined) ??
            undefined;
        }

        const duplicateJobIds: string[] = [];
        const duplicateRemovalErrors: string[] = [];
        const seenJobIds = new Set<string>();
        for (const duplicate of resolvedMonitor.duplicates) {
          if (!duplicate.id || duplicate.id === jobId || seenJobIds.has(duplicate.id)) {
            continue;
          }
          seenJobIds.add(duplicate.id);
          try {
            await callGatewayTool("cron.remove", gatewayOpts, { id: duplicate.id });
            duplicateJobIds.push(duplicate.id);
          } catch (err) {
            duplicateRemovalErrors.push(
              `failed to remove duplicate cron job ${duplicate.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        if (jobId) {
          state.cronMonitorJobId = jobId;
          state.intervalSeconds = Math.max(10, Math.min(86_400, intervalSeconds));
          await saveState(statePath, state);
        }

        return jsonResult({
          ok: true,
          enabled: true,
          jobId,
          intervalSeconds,
          schedule,
          duplicateJobsRemoved: duplicateJobIds,
          warnings: duplicateRemovalErrors.length > 0 ? duplicateRemovalErrors : undefined,
          note: "Cron monitor runs deterministic slack_signal_monitor scan_now with dedupe state.",
        });
      }

      if (action === "disable_cron_monitor") {
        const resolvedMonitor = await resolveCronMonitorJobs({
          gatewayOpts,
          state,
        });
        const jobIds = [
          resolvedMonitor.selected?.id,
          ...resolvedMonitor.duplicates.map((job) => job.id),
        ].filter(
          (value, idx, arr): value is string => Boolean(value) && arr.indexOf(value) === idx,
        );

        if (jobIds.length === 0) {
          return jsonResult({
            ok: true,
            disabled: false,
            reason: "no monitor job found",
          });
        }

        const disabledJobIds: string[] = [];
        const disableErrors: string[] = [];
        for (const jobId of jobIds) {
          try {
            await callGatewayTool("cron.update", gatewayOpts, {
              id: jobId,
              patch: { enabled: false },
            });
            disabledJobIds.push(jobId);
          } catch (err) {
            disableErrors.push(
              `failed to disable cron job ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        state.cronMonitorJobId = disabledJobIds[0] ?? state.cronMonitorJobId;
        await saveState(statePath, state);

        return jsonResult({
          ok: disableErrors.length === 0,
          disabled: disabledJobIds.length > 0,
          disabledJobIds,
          warnings: disableErrors.length > 0 ? disableErrors : undefined,
        });
      }

      return textResult(`Unknown action: ${action}`);
    },
  };
}

export const __testing = {
  cleanSlackText,
  summarizeMessage,
  extractMentionedUserIds,
  matchKeywords,
  isHighSignalKeywordHit,
  isActionableMention,
  isAllChannelsToken,
  normalizeWatchedChannels,
  includesAllChannelsToken,
  defaultState,
  normalizeState,
  selectCronMonitorJobs,
} as const;
