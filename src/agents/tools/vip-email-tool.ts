import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import { hasBinary } from "../../agents/skills.js";
import { loadConfig, STATE_DIR, type ArgentConfig } from "../../config/config.js";
import { resolveAgentMainSessionKey } from "../../config/sessions.js";
import { runMessageAction } from "../../infra/outbound/message-action-runner.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { optionalStringEnum } from "../schema/typebox.js";
import {
  buildInjectedAudioAlertMessage,
  createAudioAlertTool,
  extractAudioAlertToolText,
} from "./audio-alert-tool.js";
import {
  type AnyAgentTool,
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
} from "./common.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";

const VIP_EMAIL_ACTIONS = [
  "status",
  "list_vips",
  "add_vip",
  "remove_vip",
  "set_accounts",
  "set_alerts",
  "scan_now",
  "check_pending",
  "ensure_cron_monitor",
  "disable_cron_monitor",
  "clear_seen",
] as const;

const DEFAULT_STATE_PATH = path.join(STATE_DIR, "vip-email-state.json");
const DEFAULT_PENDING_FILE_PATH = "/tmp/vip-email-pending.json";
const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_CRON_INTERVAL_SECONDS = 120;
const DEFAULT_CRON_JOB_NAME = "VIP Email Alert - Monitor Inbox";
const GOG_SKILL_HINT = "skills/gog/SKILL.md";
const SEEN_MAP_CAP = 5000;

type VipSender = {
  email: string;
  name?: string;
};

type VipChannelRoute = {
  channel: string;
  target: string;
  accountId?: string;
  bestEffort?: boolean;
};

type VipAlertConfig = {
  ttsEnabled: boolean;
  channelRoutes: VipChannelRoute[];
  mainSessionAudioAlert: boolean;
};

type VipPendingEmail = {
  key: string;
  id: string;
  account: string;
  senderEmail: string;
  senderName?: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
};

type VipEmailState = {
  version: 1;
  accounts: string[];
  vipSenders: VipSender[];
  alerts: VipAlertConfig;
  seenByKey: Record<string, number>;
  pendingFilePath: string;
  cronMonitorJobId?: string;
  updatedAt: string;
};

type GogThread = {
  id?: string;
  messageId?: string;
  threadId?: string;
  from?: string;
  sender?: string;
  subject?: string;
  snippet?: string;
  date?: string;
};

const ChannelRouteSchema = Type.Object({
  channel: Type.String({ description: 'Message channel (e.g. "discord", "slack", "telegram").' }),
  target: Type.String({ description: "Target id/route for the configured channel." }),
  accountId: Type.Optional(Type.String({ description: "Optional channel account id override." })),
  bestEffort: Type.Optional(Type.Boolean({ description: "Best effort delivery for this route." })),
});

const VipEmailToolSchema = Type.Object({
  action: optionalStringEnum(VIP_EMAIL_ACTIONS, {
    description: `Action: ${VIP_EMAIL_ACTIONS.join(", ")}`,
    default: "status",
  }),
  email: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  accounts: Type.Optional(Type.Array(Type.String())),
  ttsEnabled: Type.Optional(Type.Boolean()),
  mainSessionAudioAlert: Type.Optional(
    Type.Boolean({
      description:
        "When true, new VIP detections immediately inject an audio_alert into the main chat session.",
    }),
  ),
  channelRoutes: Type.Optional(Type.Array(ChannelRouteSchema)),
  emitAlerts: Type.Optional(Type.Boolean()),
  maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  lookbackDays: Type.Optional(Type.Number({ minimum: 1, maximum: 30 })),
  pendingFilePath: Type.Optional(Type.String()),
  intervalSeconds: Type.Optional(Type.Number({ minimum: 10, maximum: 86_400 })),
  clear: Type.Optional(Type.Boolean()),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
});

type VipEmailToolOptions = {
  config?: ArgentConfig;
  agentSessionKey?: string;
};

type UnknownRecord = Record<string, unknown>;

type CronMonitorCandidate = {
  id: string;
  name?: string;
  enabled: boolean;
  payloadKind?: string;
  payloadMessage?: string;
  payloadText?: string;
  updatedAtMs?: number;
};

type ResolvedCronMonitorJobs = {
  selected?: CronMonitorCandidate;
  duplicates: CronMonitorCandidate[];
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBooleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const raw = params[key];
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
  }
  return undefined;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function dedupeSenders(senders: VipSender[]): VipSender[] {
  const byEmail = new Map<string, VipSender>();
  for (const sender of senders) {
    const email = normalizeEmail(sender.email);
    if (!email) {
      continue;
    }
    const existing = byEmail.get(email);
    const next: VipSender = {
      email,
      name: sender.name?.trim() || existing?.name,
    };
    byEmail.set(email, next);
  }
  return Array.from(byEmail.values()).toSorted((a, b) => a.email.localeCompare(b.email));
}

function dedupeAccounts(accounts: string[]): string[] {
  const uniq = new Set<string>();
  for (const account of accounts) {
    const normalized = normalizeEmail(account);
    if (normalized) {
      uniq.add(normalized);
    }
  }
  return Array.from(uniq).toSorted();
}

function normalizeChannelRoutes(routes: VipChannelRoute[]): VipChannelRoute[] {
  const deduped = new Map<string, VipChannelRoute>();
  for (const route of routes) {
    const channel = route.channel.trim().toLowerCase();
    const target = route.target.trim();
    if (!channel || !target) {
      continue;
    }
    const key = `${channel}::${target}::${route.accountId?.trim() ?? ""}`;
    deduped.set(key, {
      channel,
      target,
      accountId: route.accountId?.trim() || undefined,
      bestEffort: route.bestEffort,
    });
  }
  return Array.from(deduped.values()).toSorted((a, b) =>
    `${a.channel}:${a.target}`.localeCompare(`${b.channel}:${b.target}`),
  );
}

function defaultState(): VipEmailState {
  return {
    version: 1,
    accounts: [],
    vipSenders: [],
    alerts: {
      ttsEnabled: true,
      channelRoutes: [],
      mainSessionAudioAlert: false,
    },
    seenByKey: {},
    pendingFilePath: DEFAULT_PENDING_FILE_PATH,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeState(raw: unknown): VipEmailState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultState();
  }
  const typed = raw as {
    version?: unknown;
    accounts?: unknown;
    vipSenders?: unknown;
    alerts?: unknown;
    seenByKey?: unknown;
    pendingFilePath?: unknown;
    cronMonitorJobId?: unknown;
    updatedAt?: unknown;
  };
  const base = defaultState();
  const accounts = Array.isArray(typed.accounts)
    ? typed.accounts.filter((item): item is string => typeof item === "string")
    : [];
  const vipSendersRaw = Array.isArray(typed.vipSenders)
    ? typed.vipSenders.filter(
        (item): item is { email?: unknown; name?: unknown } =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const vipSenders = dedupeSenders(
    vipSendersRaw
      .map((item) => ({
        email: typeof item.email === "string" ? item.email : "",
        name: typeof item.name === "string" ? item.name : undefined,
      }))
      .filter((item) => item.email.trim().length > 0),
  );
  const alertsRaw =
    typed.alerts && typeof typed.alerts === "object" && !Array.isArray(typed.alerts)
      ? (typed.alerts as {
          ttsEnabled?: unknown;
          channelRoutes?: unknown;
          mainSessionAudioAlert?: unknown;
        })
      : {};
  const channelRoutesRaw = Array.isArray(alertsRaw.channelRoutes)
    ? alertsRaw.channelRoutes.filter(
        (
          item,
        ): item is {
          channel?: unknown;
          target?: unknown;
          accountId?: unknown;
          bestEffort?: unknown;
        } => Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const channelRoutes = normalizeChannelRoutes(
    channelRoutesRaw.map((item) => ({
      channel: typeof item.channel === "string" ? item.channel : "",
      target: typeof item.target === "string" ? item.target : "",
      accountId: typeof item.accountId === "string" ? item.accountId : undefined,
      bestEffort: typeof item.bestEffort === "boolean" ? item.bestEffort : undefined,
    })),
  );
  const seenByKey =
    typed.seenByKey && typeof typed.seenByKey === "object" && !Array.isArray(typed.seenByKey)
      ? Object.fromEntries(
          Object.entries(typed.seenByKey as Record<string, unknown>)
            .map(([k, v]) => [k, typeof v === "number" && Number.isFinite(v) ? v : null] as const)
            .filter((entry): entry is [string, number] => typeof entry[1] === "number"),
        )
      : {};

  return {
    version: base.version,
    accounts: dedupeAccounts(accounts),
    vipSenders,
    alerts: {
      ttsEnabled: typeof alertsRaw.ttsEnabled === "boolean" ? alertsRaw.ttsEnabled : true,
      channelRoutes,
      mainSessionAudioAlert:
        typeof alertsRaw.mainSessionAudioAlert === "boolean"
          ? alertsRaw.mainSessionAudioAlert
          : false,
    },
    seenByKey,
    pendingFilePath:
      typeof typed.pendingFilePath === "string" && typed.pendingFilePath.trim()
        ? typed.pendingFilePath.trim()
        : base.pendingFilePath,
    cronMonitorJobId:
      typeof typed.cronMonitorJobId === "string" && typed.cronMonitorJobId.trim()
        ? typed.cronMonitorJobId.trim()
        : undefined,
    updatedAt:
      typeof typed.updatedAt === "string" && typed.updatedAt.trim()
        ? typed.updatedAt
        : base.updatedAt,
  };
}

async function loadState(statePath: string): Promise<VipEmailState> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

async function saveState(statePath: string, state: VipEmailState) {
  const next: VipEmailState = {
    ...state,
    accounts: dedupeAccounts(state.accounts),
    vipSenders: dedupeSenders(state.vipSenders),
    alerts: {
      ttsEnabled: state.alerts.ttsEnabled !== false,
      channelRoutes: normalizeChannelRoutes(state.alerts.channelRoutes),
      mainSessionAudioAlert: state.alerts.mainSessionAudioAlert === true,
    },
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function compactSeenMap(state: VipEmailState) {
  const entries = Object.entries(state.seenByKey);
  if (entries.length <= SEEN_MAP_CAP) {
    return;
  }
  const keep = entries.toSorted((a, b) => b[1] - a[1]).slice(0, SEEN_MAP_CAP);
  state.seenByKey = Object.fromEntries(keep);
}

function buildScanQuery(vipSenders: VipSender[], lookbackDays: number): string {
  const emails = vipSenders.map((sender) => sender.email).filter(Boolean);
  const fromQuery = emails.join(" OR ");
  return `in:inbox from:(${fromQuery}) newer_than:${lookbackDays}d`;
}

async function discoverGogAccounts(): Promise<string[]> {
  const result = await runCommandWithTimeout(["gog", "auth", "list", "--json"], {
    timeoutMs: 20_000,
  });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "gog auth list failed");
  }
  const out = result.stdout.trim();
  if (!out) {
    return [];
  }
  try {
    const parsed = JSON.parse(out) as unknown;
    if (Array.isArray(parsed)) {
      return dedupeAccounts(
        parsed
          .map((item) =>
            item && typeof item === "object" && !Array.isArray(item)
              ? (item as { account?: unknown; email?: unknown })
              : null,
          )
          .flatMap((item) => {
            if (!item) {
              return [];
            }
            const email =
              typeof item.email === "string"
                ? item.email
                : typeof item.account === "string"
                  ? item.account
                  : "";
            return email ? [email] : [];
          }),
      );
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const typed = parsed as {
        accounts?: unknown;
      };
      if (Array.isArray(typed.accounts)) {
        return dedupeAccounts(
          typed.accounts.flatMap((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              return [];
            }
            const obj = item as { email?: unknown; account?: unknown };
            const email =
              typeof obj.email === "string"
                ? obj.email
                : typeof obj.account === "string"
                  ? obj.account
                  : "";
            return email ? [email] : [];
          }),
        );
      }
    }
  } catch {
    // ignore JSON parse and try plain-text fallback below
  }
  const matches = out.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return dedupeAccounts(matches);
}

function parseThreads(stdout: string): GogThread[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is GogThread => Boolean(item) && typeof item === "object");
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const typed = parsed as {
      threads?: unknown;
      messages?: unknown;
    };
    if (Array.isArray(typed.threads)) {
      return typed.threads.filter(
        (item): item is GogThread => Boolean(item) && typeof item === "object",
      );
    }
    if (Array.isArray(typed.messages)) {
      return typed.messages.filter(
        (item): item is GogThread => Boolean(item) && typeof item === "object",
      );
    }
  }
  return [];
}

async function runGogSearch(params: {
  account: string;
  query: string;
  maxResults: number;
}): Promise<GogThread[]> {
  const result = await runCommandWithTimeout(
    ["gog", "gmail", "search", params.query, "--max", String(params.maxResults), "--json"],
    {
      timeoutMs: 30_000,
      env: {
        ...process.env,
        GOG_ACCOUNT: params.account,
      },
    },
  );
  if (result.code !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || "gog gmail search failed";
    throw new Error(`gog search failed for ${params.account}: ${message}`);
  }
  return parseThreads(result.stdout);
}

function findVipSender(vipSenders: VipSender[], fromRaw: string): VipSender | null {
  const from = fromRaw.toLowerCase();
  for (const sender of vipSenders) {
    if (from.includes(sender.email.toLowerCase())) {
      return sender;
    }
  }
  return null;
}

function buildSetupRequiredPayload(params: {
  reason: string;
  gogInstalled: boolean;
  discoveredAccounts: string[];
}) {
  return {
    ok: false,
    setupRequired: true,
    reason: params.reason,
    gogInstalled: params.gogInstalled,
    discoveredAccounts: params.discoveredAccounts,
    nextStep: {
      skill: "gog",
      skillPathHint: GOG_SKILL_HINT,
      guidance: "Use the gog skill to complete OAuth before enabling VIP email monitoring.",
      commands: [
        "gog auth credentials /path/to/client_secret.json",
        "gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets",
        "gog auth list --json",
      ],
    },
  };
}

async function readPendingFile(filePath: string): Promise<VipPendingEmail[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is VipPendingEmail => {
      return Boolean(
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof (item as { key?: unknown }).key === "string" &&
        typeof (item as { id?: unknown }).id === "string",
      );
    });
  } catch {
    return [];
  }
}

async function writePendingFile(filePath: string, entries: VipPendingEmail[]) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

async function appendPendingFile(filePath: string, entries: VipPendingEmail[]): Promise<number> {
  const existing = await readPendingFile(filePath);
  const byKey = new Map<string, VipPendingEmail>();
  for (const item of existing) {
    byKey.set(item.key, item);
  }
  for (const item of entries) {
    byKey.set(item.key, item);
  }
  const merged = Array.from(byKey.values()).toSorted((a, b) => b.date.localeCompare(a.date));
  await writePendingFile(filePath, merged);
  return merged.length;
}

function formatChannelAlertMessage(emails: VipPendingEmail[]) {
  const lines: string[] = [];
  lines.push(`VIP email alert: ${emails.length} new email${emails.length === 1 ? "" : "s"}`);
  for (const email of emails.slice(0, 10)) {
    const senderLabel = email.senderName
      ? `${email.senderName} <${email.senderEmail}>`
      : email.senderEmail;
    lines.push(`- ${senderLabel}: ${email.subject} (${email.account})`);
  }
  if (emails.length > 10) {
    lines.push(`...and ${emails.length - 10} more`);
  }
  return lines.join("\n");
}

function formatMainSessionAudioAlert(emails: VipPendingEmail[]): {
  title: string;
  message: string;
} {
  const latest = emails[0];
  if (!latest) {
    return {
      title: "VIP email alert",
      message: "Hey Jason, a VIP email was detected.",
    };
  }
  const sender = latest.senderName?.trim() || latest.senderEmail;
  const subject = latest.subject?.trim() || "(no subject)";
  const snippet = latest.snippet?.trim();
  if (emails.length === 1) {
    const summaryPart = snippet ? ` Here's what it's about: ${snippet}` : "";
    return {
      title: `VIP email: ${sender}`,
      message: `Hey Jason, ${sender} just emailed you. Subject: ${subject}.${summaryPart}`,
    };
  }
  const latestPart = snippet ? ` Latest summary: ${snippet}` : "";
  return {
    title: `VIP emails: ${emails.length} new`,
    message: `Hey Jason, you have ${emails.length} new VIP emails. Latest is from ${sender}. Subject: ${subject}.${latestPart}`,
  };
}

async function removePendingFileEntries(filePath: string, keys: string[]): Promise<number> {
  if (keys.length === 0) {
    return (await readPendingFile(filePath)).length;
  }
  const keySet = new Set(keys);
  const remaining = (await readPendingFile(filePath)).filter((item) => !keySet.has(item.key));
  await writePendingFile(filePath, remaining);
  return remaining.length;
}

async function dispatchMainSessionAudioAlert(params: {
  cfg: ArgentConfig;
  gatewayOpts: GatewayCallOptions;
  emails: VipPendingEmail[];
  mainSessionKey: string;
  agentSessionKey?: string;
}): Promise<{
  sent: boolean;
  error?: string;
  title?: string;
  message?: string;
  audioDetails?: unknown;
}> {
  if (params.emails.length === 0) {
    return { sent: false, error: "no emails" };
  }
  const composed = formatMainSessionAudioAlert(params.emails);
  try {
    const audioTool = createAudioAlertTool({
      config: params.cfg,
      agentSessionKey: params.agentSessionKey,
    });
    const audioResult = await audioTool.execute(`vip-email-audio-${Date.now()}`, {
      message: composed.message,
      title: composed.title,
      urgency: params.emails.length > 1 ? "warning" : "urgent",
      mood: "urgent",
    });
    const generatedText = extractAudioAlertToolText(audioResult);
    const injectMessage = buildInjectedAudioAlertMessage({
      toolText: generatedText,
      title: composed.title,
      summaryText: composed.message,
      urgency: params.emails.length > 1 ? "warning" : "urgent",
    });
    await callGatewayTool("chat.inject", params.gatewayOpts, {
      sessionKey: params.mainSessionKey,
      message: injectMessage,
      label: "VIP Email Alert",
    });
    const audioDetails =
      audioResult && typeof audioResult === "object" && "details" in audioResult
        ? (audioResult as { details?: unknown }).details
        : undefined;
    return {
      sent: true,
      title: composed.title,
      message: composed.message,
      audioDetails,
    };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : String(err),
      title: composed.title,
      message: composed.message,
    };
  }
}

async function dispatchChannelAlerts(params: {
  cfg: ArgentConfig;
  routes: VipChannelRoute[];
  emails: VipPendingEmail[];
  agentSessionKey?: string;
  agentId?: string;
}): Promise<{
  sent: number;
  failed: number;
  errors: string[];
}> {
  if (params.routes.length === 0 || params.emails.length === 0) {
    return { sent: 0, failed: 0, errors: [] };
  }
  const message = formatChannelAlertMessage(params.emails);
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const route of params.routes) {
    try {
      await runMessageAction({
        cfg: params.cfg,
        action: "send",
        params: {
          channel: route.channel,
          target: route.target,
          accountId: route.accountId,
          message,
          bestEffort: route.bestEffort ?? true,
        },
        sessionKey: params.agentSessionKey,
        agentId: params.agentId,
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      errors.push(
        `route ${route.channel}:${route.target} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { sent, failed, errors };
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
    payloadMessage: typeof payload?.message === "string" ? payload.message : undefined,
    payloadText: typeof payload?.text === "string" ? payload.text : undefined,
    updatedAtMs: typeof raw.updatedAtMs === "number" ? raw.updatedAtMs : undefined,
  };
}

function isVipMonitorCandidate(job: CronMonitorCandidate): boolean {
  if (job.payloadKind === "vipEmailScan") {
    return true;
  }
  const name = job.name ? normalizeCronNameForMatch(job.name) : "";
  if (name.includes("vip email")) {
    return true;
  }
  const message = job.payloadMessage?.toLowerCase() ?? "";
  if (message.includes("vip_email") || message.includes("vip email")) {
    return true;
  }
  const text = job.payloadText?.toLowerCase() ?? "";
  return text.includes("vip_email") || text.includes("vip email");
}

function compareCandidatesByPriority(a: CronMonitorCandidate, b: CronMonitorCandidate): number {
  const kindScore = (candidate: CronMonitorCandidate) =>
    candidate.payloadKind === "vipEmailScan" ? 1 : 0;
  const enabledScore = (candidate: CronMonitorCandidate) => (candidate.enabled ? 1 : 0);
  const canonicalNameScore = (candidate: CronMonitorCandidate) =>
    candidate.name &&
    normalizeCronNameForMatch(candidate.name) === normalizeCronNameForMatch(DEFAULT_CRON_JOB_NAME)
      ? 1
      : 0;

  const aKind = kindScore(a);
  const bKind = kindScore(b);
  if (aKind !== bKind) {
    return bKind - aKind;
  }

  const aEnabled = enabledScore(a);
  const bEnabled = enabledScore(b);
  if (aEnabled !== bEnabled) {
    return bEnabled - aEnabled;
  }

  const aCanonicalName = canonicalNameScore(a);
  const bCanonicalName = canonicalNameScore(b);
  if (aCanonicalName !== bCanonicalName) {
    return bCanonicalName - aCanonicalName;
  }

  const aUpdated = typeof a.updatedAtMs === "number" ? a.updatedAtMs : 0;
  const bUpdated = typeof b.updatedAtMs === "number" ? b.updatedAtMs : 0;
  if (aUpdated !== bUpdated) {
    return bUpdated - aUpdated;
  }

  return a.id.localeCompare(b.id);
}

function selectCronMonitorJobs(params: {
  jobs: CronMonitorCandidate[];
  preferredId?: string;
}): ResolvedCronMonitorJobs {
  const candidates = params.jobs.filter((job) => isVipMonitorCandidate(job));
  if (candidates.length === 0) {
    return { selected: undefined, duplicates: [] };
  }

  const preferredId = params.preferredId?.trim();
  const statePreferred =
    preferredId &&
    candidates.find((job) => job.id === preferredId && job.payloadKind === "vipEmailScan");
  if (statePreferred) {
    return {
      selected: statePreferred,
      duplicates: candidates.filter((job) => job.id !== statePreferred.id),
    };
  }

  const sorted = [...candidates].toSorted(compareCandidatesByPriority);
  const selected = sorted[0];
  return {
    selected,
    duplicates: candidates.filter((job) => job.id !== selected.id),
  };
}

async function resolveCronMonitorJobs(params: {
  gatewayOpts: GatewayCallOptions;
  state: VipEmailState;
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

export const __testing = {
  normalizeCronNameForMatch,
  toCronMonitorCandidate,
  isVipMonitorCandidate,
  selectCronMonitorJobs,
  formatMainSessionAudioAlert,
};

export function createVipEmailTool(options?: VipEmailToolOptions): AnyAgentTool {
  return {
    label: "VIP Email",
    name: "vip_email",
    description: `Manage VIP sender monitoring for Gmail (via gog), with deduplicated alerts and cron integration.

Core capabilities:
- Manage VIP sender list (add/remove/list)
- Manage allowed Gmail accounts to scan
- Scan inboxes for new VIP emails (dedupe by message key so the same email is never alerted twice)
- Queue pending VIP emails for downstream processing
- Configure alert routes (Discord/Slack/Telegram/etc.) and TTS preference
- Install/disable a cron monitor job

First-run guard:
- If gog is missing or Gmail OAuth is not configured, this tool returns setupRequired=true
  and points the agent to the gog skill (${GOG_SKILL_HINT}) with OAuth commands.`,
    parameters: VipEmailToolSchema,
    execute: async (_toolCallId, args) => {
      const params = (args as Record<string, unknown>) ?? {};
      const action = readStringParam(params, "action") ?? "status";
      const statePath = DEFAULT_STATE_PATH;
      const cfg = options?.config ?? loadConfig();
      const agentId = resolveSessionAgentId({
        sessionKey: options?.agentSessionKey,
        config: cfg,
      });
      const gatewayOpts: GatewayCallOptions = {
        gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
        gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
        timeoutMs:
          (typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
            ? Math.max(1, Math.floor(params.timeoutMs))
            : undefined) ?? 30_000,
      };

      const state = await loadState(statePath);
      const gogInstalled = hasBinary("gog");
      let discoveredAccounts: string[] = [];
      if (gogInstalled) {
        try {
          discoveredAccounts = await discoverGogAccounts();
        } catch {
          discoveredAccounts = [];
        }
      }
      const effectiveAccounts = dedupeAccounts(
        state.accounts.length > 0 ? state.accounts : discoveredAccounts,
      );

      if (action === "status") {
        let cronStatus: unknown = null;
        if (state.cronMonitorJobId) {
          try {
            cronStatus = await callGatewayTool("cron.status", gatewayOpts, {});
          } catch {
            cronStatus = { warning: "cron status unavailable" };
          }
        }
        return jsonResult({
          ok: true,
          setupRequired: !gogInstalled || effectiveAccounts.length === 0,
          gogInstalled,
          discoveredAccounts,
          state: {
            ...state,
            effectiveAccounts,
          },
          cronStatus,
          setupHint:
            !gogInstalled || effectiveAccounts.length === 0
              ? buildSetupRequiredPayload({
                  reason: !gogInstalled ? "gog binary not found" : "no gog auth accounts found",
                  gogInstalled,
                  discoveredAccounts,
                }).nextStep
              : undefined,
        });
      }

      if (action === "list_vips") {
        return jsonResult({
          ok: true,
          count: state.vipSenders.length,
          vipSenders: state.vipSenders,
        });
      }

      if (action === "add_vip") {
        const email = normalizeEmail(readStringParam(params, "email", { required: true }));
        const name = readStringParam(params, "name");
        const next = dedupeSenders([...state.vipSenders, { email, name }]);
        state.vipSenders = next;
        await saveState(statePath, state);
        return jsonResult({
          ok: true,
          added: { email, name: name?.trim() || undefined },
          count: state.vipSenders.length,
          vipSenders: state.vipSenders,
        });
      }

      if (action === "remove_vip") {
        const email = normalizeEmail(readStringParam(params, "email", { required: true }));
        const before = state.vipSenders.length;
        state.vipSenders = state.vipSenders.filter(
          (sender) => normalizeEmail(sender.email) !== email,
        );
        const removed = state.vipSenders.length !== before;
        await saveState(statePath, state);
        return jsonResult({
          ok: true,
          removed,
          email,
          count: state.vipSenders.length,
          vipSenders: state.vipSenders,
        });
      }

      if (action === "set_accounts") {
        const accounts = readStringArrayParam(params, "accounts") ?? [];
        state.accounts = dedupeAccounts(accounts);
        await saveState(statePath, state);
        return jsonResult({
          ok: true,
          accounts: state.accounts,
          discoveredAccounts,
        });
      }

      if (action === "set_alerts") {
        const ttsEnabled = readBooleanParam(params, "ttsEnabled");
        const mainSessionAudioAlert = readBooleanParam(params, "mainSessionAudioAlert");
        const routesRaw = Array.isArray(params.channelRoutes) ? params.channelRoutes : undefined;
        if (ttsEnabled !== undefined) {
          state.alerts.ttsEnabled = ttsEnabled;
        }
        if (mainSessionAudioAlert !== undefined) {
          state.alerts.mainSessionAudioAlert = mainSessionAudioAlert;
        }
        if (routesRaw) {
          const parsed = routesRaw
            .filter(
              (
                item,
              ): item is {
                channel?: unknown;
                target?: unknown;
                accountId?: unknown;
                bestEffort?: unknown;
              } => Boolean(item) && typeof item === "object" && !Array.isArray(item),
            )
            .map((item) => ({
              channel: typeof item.channel === "string" ? item.channel : "",
              target: typeof item.target === "string" ? item.target : "",
              accountId: typeof item.accountId === "string" ? item.accountId : undefined,
              bestEffort: typeof item.bestEffort === "boolean" ? item.bestEffort : undefined,
            }));
          state.alerts.channelRoutes = normalizeChannelRoutes(parsed);
        }
        await saveState(statePath, state);
        return jsonResult({
          ok: true,
          alerts: state.alerts,
        });
      }

      if (action === "clear_seen") {
        state.seenByKey = {};
        await saveState(statePath, state);
        return jsonResult({
          ok: true,
          cleared: true,
          seenCount: 0,
        });
      }

      if (action === "check_pending") {
        const clear = readBooleanParam(params, "clear") ?? true;
        const pendingFilePath = readStringParam(params, "pendingFilePath") ?? state.pendingFilePath;
        const pending = await readPendingFile(pendingFilePath);
        if (clear) {
          await writePendingFile(pendingFilePath, []);
        }
        return jsonResult({
          ok: true,
          count: pending.length,
          cleared: clear,
          pendingFilePath,
          pending,
        });
      }

      if (action === "scan_now") {
        const accountOverrides = readStringArrayParam(params, "accounts");
        const scanAccounts = dedupeAccounts(
          accountOverrides && accountOverrides.length > 0 ? accountOverrides : effectiveAccounts,
        );
        if (!gogInstalled) {
          return jsonResult(
            buildSetupRequiredPayload({
              reason: "gog binary not found",
              gogInstalled,
              discoveredAccounts,
            }),
          );
        }
        if (scanAccounts.length === 0) {
          return jsonResult(
            buildSetupRequiredPayload({
              reason: "no gog auth accounts found",
              gogInstalled,
              discoveredAccounts,
            }),
          );
        }
        if (state.vipSenders.length === 0) {
          return jsonResult({
            ok: false,
            setupRequired: false,
            reason: "no VIP senders configured",
            guidance: 'Add VIPs first with vip_email action="add_vip".',
          });
        }

        const emitAlerts = readBooleanParam(params, "emitAlerts") ?? true;
        const maxResults =
          readNumberParam(params, "maxResults", { integer: true }) ?? DEFAULT_MAX_RESULTS;
        const lookbackDays =
          readNumberParam(params, "lookbackDays", { integer: true }) ?? DEFAULT_LOOKBACK_DAYS;
        const pendingFilePath =
          readStringParam(params, "pendingFilePath") ??
          state.pendingFilePath ??
          DEFAULT_PENDING_FILE_PATH;
        state.pendingFilePath = pendingFilePath;

        const query = buildScanQuery(state.vipSenders, lookbackDays);
        const now = Date.now();
        const newlyDetected: VipPendingEmail[] = [];
        const scanErrors: string[] = [];

        for (const account of scanAccounts) {
          try {
            const threads = await runGogSearch({
              account,
              query,
              maxResults,
            });
            for (const thread of threads) {
              const from = thread.from ?? thread.sender ?? "";
              const matched = findVipSender(state.vipSenders, from);
              if (!matched) {
                continue;
              }
              const rawId = thread.id ?? thread.messageId ?? thread.threadId ?? "";
              if (!rawId.trim()) {
                continue;
              }
              const key = `${account}:${rawId.trim()}`;
              if (state.seenByKey[key]) {
                continue;
              }
              state.seenByKey[key] = now;
              newlyDetected.push({
                key,
                id: rawId.trim(),
                account,
                senderEmail: matched.email,
                senderName: matched.name,
                from: from || matched.email,
                subject: thread.subject?.trim() || "(no subject)",
                snippet: thread.snippet?.trim() || "",
                date: thread.date?.trim() || new Date(now).toISOString(),
              });
            }
          } catch (err) {
            scanErrors.push(err instanceof Error ? err.message : String(err));
          }
        }

        compactSeenMap(state);
        await saveState(statePath, state);

        let pendingCount = 0;
        if (newlyDetected.length > 0) {
          pendingCount = await appendPendingFile(pendingFilePath, newlyDetected);
        } else {
          pendingCount = (await readPendingFile(pendingFilePath)).length;
        }

        let dispatched = { sent: 0, failed: 0, errors: [] as string[] };
        if (emitAlerts && newlyDetected.length > 0 && state.alerts.channelRoutes.length > 0) {
          dispatched = await dispatchChannelAlerts({
            cfg,
            routes: state.alerts.channelRoutes,
            emails: newlyDetected,
            agentSessionKey: options?.agentSessionKey,
            agentId,
          });
        }

        const mainSessionKey =
          options?.agentSessionKey ||
          resolveAgentMainSessionKey({
            cfg,
            agentId,
          });
        let mainSessionAudioDispatch:
          | {
              sent: boolean;
              error?: string;
              title?: string;
              message?: string;
              audioDetails?: unknown;
            }
          | undefined;
        if (
          emitAlerts &&
          newlyDetected.length > 0 &&
          state.alerts.ttsEnabled &&
          state.alerts.mainSessionAudioAlert
        ) {
          mainSessionAudioDispatch = await dispatchMainSessionAudioAlert({
            cfg,
            gatewayOpts,
            emails: newlyDetected,
            mainSessionKey,
            agentSessionKey: options?.agentSessionKey,
          });
        }
        if (mainSessionAudioDispatch?.sent) {
          try {
            pendingCount = await removePendingFileEntries(
              pendingFilePath,
              newlyDetected.map((email) => email.key),
            );
          } catch (err) {
            scanErrors.push(
              `failed to clear delivered pending VIP emails: ${err instanceof Error ? err.message : String(err)}`,
            );
            pendingCount = (await readPendingFile(pendingFilePath)).length;
          }
        }

        const ttsHint =
          state.alerts.ttsEnabled && newlyDetected.length > 0
            ? state.alerts.mainSessionAudioAlert
              ? "TTS alerts are enabled with native main-session audio delivery."
              : 'TTS alerts are enabled. Set mainSessionAudioAlert=true in vip_email action="set_alerts" to inject spoken alerts directly into main chat.'
            : undefined;

        return jsonResult({
          ok: true,
          setupRequired: false,
          query,
          scannedAccounts: scanAccounts,
          newCount: newlyDetected.length,
          pendingCount,
          emitAlerts,
          channelDispatch: dispatched,
          ttsEnabled: state.alerts.ttsEnabled,
          mainSessionAudioAlert: state.alerts.mainSessionAudioAlert,
          mainSessionAudioDispatch,
          ttsHint,
          errors: scanErrors,
          newEmails: newlyDetected,
        });
      }

      if (action === "ensure_cron_monitor") {
        if (!gogInstalled || effectiveAccounts.length === 0) {
          return jsonResult(
            buildSetupRequiredPayload({
              reason: !gogInstalled ? "gog binary not found" : "no gog auth accounts found",
              gogInstalled,
              discoveredAccounts,
            }),
          );
        }
        const intervalSeconds =
          readNumberParam(params, "intervalSeconds", { integer: true }) ??
          DEFAULT_CRON_INTERVAL_SECONDS;
        const resolvedMonitor = await resolveCronMonitorJobs({
          gatewayOpts,
          state,
        });
        const existingId = resolvedMonitor.selected?.id;
        const schedule = { kind: "every" as const, everyMs: intervalSeconds * 1000 };
        const payload = {
          kind: "vipEmailScan" as const,
          emitAlerts: true,
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
              description: "Poll Gmail for VIP senders and alert once per new email.",
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
          note: "Cron monitor runs deterministic vip_email scan_now with dedupe state to prevent duplicate alerts.",
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

      throw new Error(`Unknown action: ${action}`);
    },
  };
}
