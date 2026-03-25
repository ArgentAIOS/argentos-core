import fs from "node:fs/promises";
import path from "node:path";
import type { ChannelAccountSnapshot } from "../channels/plugins/types.js";
import type { ArgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import {
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import {
  ensureAuthProfileStore,
  isProfileInCooldown,
  isProviderInCooldown,
  listProfilesForProvider,
  resolveProviderCircuitState,
  resolveProviderUnusableUntilForDisplay,
} from "../agents/auth-profiles.js";
import { normalizeProviderId } from "../agents/model-selection.js";
import { resolveChannelDefaultAccountId } from "../channels/plugins/helpers.js";
import { getChannelPlugin, listChannelPlugins } from "../channels/plugins/index.js";
import { withProgress } from "../cli/progress.js";
import { loadConfig } from "../config/config.js";
import { validateGatewayAuthConfig } from "../config/gateway-auth-validation.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { isPostgresEnabled, resolveStorageConfig } from "../data/storage-config.js";
import { buildGatewayConnectionDetails, callGateway } from "../gateway/call.js";
import { info } from "../globals.js";
import {
  getConsciousnessKernelSnapshot,
  type ConsciousnessKernelSnapshot,
} from "../infra/consciousness-kernel.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { formatErrorMessage } from "../infra/errors.js";
import {
  type HeartbeatSummary,
  resolveHeartbeatSummaryForAgent,
} from "../infra/heartbeat-runner.js";
import { getMemoryHealthSummary, type MemoryHealthSummary } from "../memory/health.js";
import { buildChannelAccountBindings, resolvePreferredAccountId } from "../routing/bindings.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { theme } from "../terminal/theme.js";
import {
  type CriticalServiceAlert,
  detectHeartbeatStaleness,
  evaluateCriticalServiceSignals,
} from "./critical-observability.js";

export type ChannelAccountHealthSummary = {
  accountId: string;
  configured?: boolean;
  linked?: boolean;
  authAgeMs?: number | null;
  probe?: unknown;
  lastProbeAt?: number | null;
  [key: string]: unknown;
};

export type ChannelHealthSummary = ChannelAccountHealthSummary & {
  accounts?: Record<string, ChannelAccountHealthSummary>;
};

export type AgentHeartbeatSummary = HeartbeatSummary;

export type AgentHealthSummary = {
  agentId: string;
  name?: string;
  isDefault: boolean;
  heartbeat: AgentHeartbeatSummary;
  sessions: HealthSummary["sessions"];
};

export type HealthSummary = {
  /**
   * Convenience top-level flag for UIs (e.g. WebChat) that only need a binary
   * "can talk to the gateway" signal. If this payload exists, the gateway RPC
   * succeeded, so this is always `true`.
   */
  ok: true;
  ts: number;
  durationMs: number;
  channels: Record<string, ChannelHealthSummary>;
  channelOrder: string[];
  channelLabels: Record<string, string>;
  /** Legacy: default agent heartbeat seconds (rounded). */
  heartbeatSeconds: number;
  defaultAgentId: string;
  agents: AgentHealthSummary[];
  authProviders: Array<{
    provider: string;
    circuitState: "closed" | "open" | "half_open";
    available: boolean;
    cooldownUntil?: number;
    rateLimitedProfiles: number;
    totalProfiles: number;
  }>;
  sessions: {
    path: string;
    count: number;
    recent: Array<{
      key: string;
      updatedAt: number | null;
      age: number | null;
    }>;
  };
  kernel?: ConsciousnessKernelSnapshot;
  memoryHealth?: MemoryHealthSummary;
  criticalAlerts: CriticalServiceAlert[];
};

const DEFAULT_TIMEOUT_MS = 10_000;

const debugHealth = (...args: unknown[]) => {
  if (isTruthyEnvValue(process.env.ARGENT_DEBUG_HEALTH)) {
    console.warn("[health:debug]", ...args);
  }
};

const formatDurationParts = (ms: number): string => {
  if (!Number.isFinite(ms)) {
    return "unknown";
  }
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))}ms`;
  }
  const units: Array<{ label: string; size: number }> = [
    { label: "w", size: 7 * 24 * 60 * 60 * 1000 },
    { label: "d", size: 24 * 60 * 60 * 1000 },
    { label: "h", size: 60 * 60 * 1000 },
    { label: "m", size: 60 * 1000 },
    { label: "s", size: 1000 },
  ];
  let remaining = Math.max(0, Math.floor(ms));
  const parts: string[] = [];
  for (const unit of units) {
    const value = Math.floor(remaining / unit.size);
    if (value > 0) {
      parts.push(`${value}${unit.label}`);
      remaining -= value * unit.size;
    }
  }
  if (parts.length === 0) {
    return "0s";
  }
  return parts.join(" ");
};

const TRIVIAL_KERNEL_FOCUS_PATTERNS = [
  /^i know[.! ]*$/i,
  /^got it[.! ]*$/i,
  /^understood[.! ]*$/i,
  /^right[.! ]*$/i,
  /^exactly[.! ]*$/i,
  /^correct[.! ]*$/i,
  /^(?:that )?makes sense[.! ]*$/i,
  /^all right[.! ]*$/i,
  /^alright[.! ]*$/i,
];

function resolveKernelWorkFocusFromSnapshot(work: {
  threadTitle: string | null;
  problemStatement: string | null;
  nextStep: string | null;
  lastConclusion: string | null;
}): string | null {
  for (const candidate of [
    work.threadTitle,
    work.problemStatement,
    work.nextStep,
    work.lastConclusion,
  ]) {
    const normalized = typeof candidate === "string" ? candidate.trim() : "";
    if (!normalized) {
      continue;
    }
    if (TRIVIAL_KERNEL_FOCUS_PATTERNS.some((pattern) => pattern.test(normalized))) {
      continue;
    }
    return normalized;
  }
  return null;
}

const resolveHeartbeatSummary = (cfg: ReturnType<typeof loadConfig>, agentId: string) =>
  resolveHeartbeatSummaryForAgent(cfg, agentId);

async function probePostgresHealth(cfg: ReturnType<typeof loadConfig>): Promise<{
  healthy: boolean;
  enabled: boolean;
  detail?: string;
}> {
  const storage = resolveStorageConfig(cfg.storage);
  const enabled = isPostgresEnabled(storage);
  if (!enabled) {
    return { healthy: true, enabled: false };
  }
  const conn = storage.postgres?.connectionString?.trim();
  if (!conn) {
    return {
      healthy: false,
      enabled: true,
      detail: "storage backend uses PostgreSQL but connection string is missing",
    };
  }

  try {
    const { default: postgres } = await import("postgres");
    const sql = postgres(conn, {
      max: 1,
      prepare: false,
      connect_timeout: 2,
      idle_timeout: 2,
    });
    await sql`select 1 as ok`;
    await sql.end({ timeout: 1 });
    return { healthy: true, enabled: true };
  } catch (error) {
    return {
      healthy: false,
      enabled: true,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function detectHeartbeatStale(cfg: ReturnType<typeof loadConfig>): Promise<{
  monitored: boolean;
  stale: boolean;
  lastCycleAt: string | null;
  staleHours: number | null;
  staleThresholdHours: number;
}> {
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const hb = resolveHeartbeatSummary(cfg, defaultAgentId);
  const staleThresholdMs = 24 * 60 * 60 * 1000;
  const staleThresholdHours = Math.floor(staleThresholdMs / (60 * 60 * 1000));

  if (!hb.enabled) {
    return {
      monitored: false,
      stale: false,
      lastCycleAt: null,
      staleHours: null,
      staleThresholdHours,
    };
  }

  const workspaceDir = resolveAgentWorkspaceDir(cfg, defaultAgentId);
  const progressPath = path.join(workspaceDir, "memory", "heartbeat-progress.json");
  try {
    const raw = await fs.readFile(progressPath, "utf-8");
    const parsed = JSON.parse(raw) as { lastCycleAt?: number };
    const lastCycleAtMs = Number.isFinite(parsed.lastCycleAt) ? Number(parsed.lastCycleAt) : null;
    const staleness = detectHeartbeatStaleness({
      lastCycleAtMs,
      nowMs: Date.now(),
      staleThresholdMs,
    });
    return {
      monitored: true,
      stale: staleness.stale,
      lastCycleAt: lastCycleAtMs ? new Date(lastCycleAtMs).toISOString() : null,
      staleHours: staleness.staleHours,
      staleThresholdHours: staleness.staleThresholdHours,
    };
  } catch {
    // Missing progress file on fresh installs should not page operators.
    return {
      monitored: true,
      stale: false,
      lastCycleAt: null,
      staleHours: null,
      staleThresholdHours,
    };
  }
}

const resolveAgentOrder = (cfg: ReturnType<typeof loadConfig>) => {
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const entries = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const seen = new Set<string>();
  const ordered: Array<{ id: string; name?: string }> = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    if (typeof entry.id !== "string" || !entry.id.trim()) {
      continue;
    }
    const id = normalizeAgentId(entry.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ordered.push({ id, name: typeof entry.name === "string" ? entry.name : undefined });
  }

  if (!seen.has(defaultAgentId)) {
    ordered.unshift({ id: defaultAgentId });
  }

  if (ordered.length === 0) {
    ordered.push({ id: defaultAgentId });
  }

  return { defaultAgentId, ordered };
};

const resolveAuthProvidersForAgent = (
  cfg: ReturnType<typeof loadConfig>,
  agentId: string,
): HealthSummary["authProviders"] => {
  const authStore = ensureAuthProfileStore(resolveAgentDir(cfg, agentId), {
    allowKeychainPrompt: false,
  });
  return Array.from(
    new Set([
      ...Object.values(authStore.profiles).map((credential) =>
        normalizeProviderId(credential.provider),
      ),
      ...Object.keys(authStore.providerStats ?? {}).map((provider) =>
        normalizeProviderId(provider),
      ),
    ]),
  )
    .filter(Boolean)
    .toSorted()
    .map((provider) => {
      const profileIds = listProfilesForProvider(authStore, provider);
      const rateLimitedProfiles = profileIds.filter((profileId) =>
        isProfileInCooldown(authStore, profileId),
      ).length;
      const available = !isProviderInCooldown(authStore, provider);
      const cooldownUntil = resolveProviderUnusableUntilForDisplay(authStore, provider);
      const circuitState = resolveProviderCircuitState(authStore, provider);
      return {
        provider,
        circuitState,
        available,
        cooldownUntil: typeof cooldownUntil === "number" ? cooldownUntil : undefined,
        rateLimitedProfiles,
        totalProfiles: profileIds.length,
      };
    });
};

const buildSessionSummary = (storePath: string) => {
  const store = loadSessionStore(storePath);
  const sessions = Object.entries(store)
    .filter(([key]) => key !== "global" && key !== "unknown")
    .map(([key, entry]) => ({ key, updatedAt: entry?.updatedAt ?? 0 }))
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
  const recent = sessions.slice(0, 5).map((s) => ({
    key: s.key,
    updatedAt: s.updatedAt || null,
    age: s.updatedAt ? Date.now() - s.updatedAt : null,
  }));
  return {
    path: storePath,
    count: sessions.length,
    recent,
  } satisfies HealthSummary["sessions"];
};

const isAccountEnabled = (account: unknown): boolean => {
  if (!account || typeof account !== "object") {
    return true;
  }
  const enabled = (account as { enabled?: boolean }).enabled;
  return enabled !== false;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const formatProbeLine = (probe: unknown, opts: { botUsernames?: string[] } = {}): string | null => {
  const record = asRecord(probe);
  if (!record) {
    return null;
  }
  const ok = typeof record.ok === "boolean" ? record.ok : undefined;
  if (ok === undefined) {
    return null;
  }
  const elapsedMs = typeof record.elapsedMs === "number" ? record.elapsedMs : null;
  const status = typeof record.status === "number" ? record.status : null;
  const error = typeof record.error === "string" ? record.error : null;
  const bot = asRecord(record.bot);
  const botUsername = bot && typeof bot.username === "string" ? bot.username : null;
  const webhook = asRecord(record.webhook);
  const webhookUrl = webhook && typeof webhook.url === "string" ? webhook.url : null;

  const usernames = new Set<string>();
  if (botUsername) {
    usernames.add(botUsername);
  }
  for (const extra of opts.botUsernames ?? []) {
    if (extra) {
      usernames.add(extra);
    }
  }

  if (ok) {
    let label = "ok";
    if (usernames.size > 0) {
      label += ` (@${Array.from(usernames).join(", @")})`;
    }
    if (elapsedMs != null) {
      label += ` (${elapsedMs}ms)`;
    }
    if (webhookUrl) {
      label += ` - webhook ${webhookUrl}`;
    }
    return label;
  }
  let label = `failed (${status ?? "unknown"})`;
  if (error) {
    label += ` - ${error}`;
  }
  return label;
};

const formatAccountProbeTiming = (summary: ChannelAccountHealthSummary): string | null => {
  const probe = asRecord(summary.probe);
  if (!probe) {
    return null;
  }
  const elapsedMs = typeof probe.elapsedMs === "number" ? Math.round(probe.elapsedMs) : null;
  const ok = typeof probe.ok === "boolean" ? probe.ok : null;
  if (elapsedMs == null && ok !== true) {
    return null;
  }

  const accountId = summary.accountId || "default";
  const botRecord = asRecord(probe.bot);
  const botUsername =
    botRecord && typeof botRecord.username === "string" ? botRecord.username : null;
  const handle = botUsername ? `@${botUsername}` : accountId;
  const timing = elapsedMs != null ? `${elapsedMs}ms` : "ok";

  return `${handle}:${accountId}:${timing}`;
};

const isProbeFailure = (summary: ChannelAccountHealthSummary): boolean => {
  const probe = asRecord(summary.probe);
  if (!probe) {
    return false;
  }
  const ok = typeof probe.ok === "boolean" ? probe.ok : null;
  return ok === false;
};

function styleHealthChannelLine(line: string): string {
  const colon = line.indexOf(":");
  if (colon === -1) {
    return line;
  }

  const label = line.slice(0, colon + 1);
  const detail = line.slice(colon + 1).trimStart();
  const normalized = detail.toLowerCase();

  const applyPrefix = (prefix: string, color: (value: string) => string) =>
    `${label} ${color(detail.slice(0, prefix.length))}${detail.slice(prefix.length)}`;

  if (normalized.startsWith("failed")) {
    return applyPrefix("failed", theme.error);
  }
  if (normalized.startsWith("ok")) {
    return applyPrefix("ok", theme.success);
  }
  if (normalized.startsWith("linked")) {
    return applyPrefix("linked", theme.success);
  }
  if (normalized.startsWith("configured")) {
    return applyPrefix("configured", theme.success);
  }
  if (normalized.startsWith("not linked")) {
    return applyPrefix("not linked", theme.warn);
  }
  if (normalized.startsWith("not configured")) {
    return applyPrefix("not configured", theme.muted);
  }
  if (normalized.startsWith("unknown")) {
    return applyPrefix("unknown", theme.warn);
  }

  return line;
}

export const formatHealthChannelLines = (
  summary: HealthSummary,
  opts: {
    accountMode?: "default" | "all";
    accountIdsByChannel?: Record<string, string[] | undefined>;
  } = {},
): string[] => {
  const channels = summary.channels ?? {};
  const channelOrder =
    summary.channelOrder?.length > 0 ? summary.channelOrder : Object.keys(channels);
  const accountMode = opts.accountMode ?? "default";

  const lines: string[] = [];
  for (const channelId of channelOrder) {
    const channelSummary = channels[channelId];
    if (!channelSummary) {
      continue;
    }
    const plugin = getChannelPlugin(channelId as never);
    const label = summary.channelLabels?.[channelId] ?? plugin?.meta.label ?? channelId;
    const accountSummaries = channelSummary.accounts ?? {};
    const accountIds = opts.accountIdsByChannel?.[channelId];
    const filteredSummaries =
      accountIds && accountIds.length > 0
        ? accountIds
            .map((accountId) => accountSummaries[accountId])
            .filter((entry): entry is ChannelAccountHealthSummary => Boolean(entry))
        : undefined;
    const listSummaries =
      accountMode === "all"
        ? Object.values(accountSummaries)
        : (filteredSummaries ?? (channelSummary.accounts ? Object.values(accountSummaries) : []));
    const baseSummary =
      filteredSummaries && filteredSummaries.length > 0 ? filteredSummaries[0] : channelSummary;
    const botUsernames = listSummaries
      ? listSummaries
          .map((account) => {
            const probeRecord = asRecord(account.probe);
            const bot = probeRecord ? asRecord(probeRecord.bot) : null;
            return bot && typeof bot.username === "string" ? bot.username : null;
          })
          .filter((value): value is string => Boolean(value))
      : [];
    const linked = typeof baseSummary.linked === "boolean" ? baseSummary.linked : null;
    if (linked !== null) {
      if (linked) {
        const authAgeMs = typeof baseSummary.authAgeMs === "number" ? baseSummary.authAgeMs : null;
        const authLabel = authAgeMs != null ? ` (auth age ${Math.round(authAgeMs / 60000)}m)` : "";
        lines.push(`${label}: linked${authLabel}`);
      } else {
        lines.push(`${label}: not linked`);
      }
      continue;
    }

    const configured = typeof baseSummary.configured === "boolean" ? baseSummary.configured : null;
    if (configured === false) {
      lines.push(`${label}: not configured`);
      continue;
    }

    const accountTimings =
      accountMode === "all"
        ? listSummaries
            .map((account) => formatAccountProbeTiming(account))
            .filter((value): value is string => Boolean(value))
        : [];
    const failedSummary = listSummaries.find((accountSummary) => isProbeFailure(accountSummary));
    if (failedSummary) {
      const failureLine = formatProbeLine(failedSummary.probe, { botUsernames });
      if (failureLine) {
        lines.push(`${label}: ${failureLine}`);
        continue;
      }
    }

    if (accountTimings.length > 0) {
      lines.push(`${label}: ok (${accountTimings.join(", ")})`);
      continue;
    }

    const probeLine = formatProbeLine(baseSummary.probe, { botUsernames });
    if (probeLine) {
      lines.push(`${label}: ${probeLine}`);
      continue;
    }

    if (configured === true) {
      lines.push(`${label}: configured`);
      continue;
    }
    lines.push(`${label}: unknown`);
  }
  return lines;
};

export async function getHealthSnapshot(params?: {
  timeoutMs?: number;
  probe?: boolean;
}): Promise<HealthSummary> {
  const timeoutMs = params?.timeoutMs;
  const cfg = loadConfig();
  const { defaultAgentId, ordered } = resolveAgentOrder(cfg);
  const channelBindings = buildChannelAccountBindings(cfg);
  const sessionCache = new Map<string, HealthSummary["sessions"]>();
  const agents: AgentHealthSummary[] = ordered.map((entry) => {
    const storePath = resolveStorePath(cfg.session?.store, { agentId: entry.id });
    const sessions = sessionCache.get(storePath) ?? buildSessionSummary(storePath);
    sessionCache.set(storePath, sessions);
    return {
      agentId: entry.id,
      name: entry.name,
      isDefault: entry.id === defaultAgentId,
      heartbeat: resolveHeartbeatSummary(cfg, entry.id),
      sessions,
    } satisfies AgentHealthSummary;
  });
  const defaultAgent = agents.find((agent) => agent.isDefault) ?? agents[0];
  const heartbeatSeconds = defaultAgent?.heartbeat.everyMs
    ? Math.round(defaultAgent.heartbeat.everyMs / 1000)
    : 0;
  const sessions =
    defaultAgent?.sessions ??
    buildSessionSummary(resolveStorePath(cfg.session?.store, { agentId: defaultAgentId }));
  const authProviders = resolveAuthProvidersForAgent(cfg, defaultAgentId);
  const nowIso = new Date().toISOString();
  const [postgresHealth, heartbeatHealth] = await Promise.all([
    probePostgresHealth(cfg),
    detectHeartbeatStale(cfg),
  ]);
  const gatewayAuthIssues = validateGatewayAuthConfig(cfg);
  const criticalAlerts = evaluateCriticalServiceSignals([
    {
      service: "postgres",
      healthy: !postgresHealth.enabled || postgresHealth.healthy,
      severity: "critical",
      statusWhenFailing: "down",
      messageWhenFailing: "PostgreSQL is unreachable while configured as active storage backend.",
      detail: postgresHealth.detail,
      operatorCommand: "bash scripts/setup-postgres.sh",
      observedAtIso: nowIso,
    },
    {
      service: "gateway-auth-config",
      healthy: gatewayAuthIssues.length === 0,
      severity: "critical",
      statusWhenFailing: "invalid_config",
      messageWhenFailing: "Gateway auth configuration is invalid.",
      detail: gatewayAuthIssues[0]?.message,
      operatorCommand: "argent configure gateway-auth",
      observedAtIso: nowIso,
    },
    {
      service: "heartbeat-runner",
      healthy: !heartbeatHealth.monitored || !heartbeatHealth.stale,
      severity: "critical",
      statusWhenFailing: "stale",
      messageWhenFailing: "Heartbeat runner appears stale and has not reported a recent cycle.",
      detail:
        heartbeatHealth.lastCycleAt == null
          ? "no heartbeat cycle timestamp available"
          : `last cycle at ${heartbeatHealth.lastCycleAt}`,
      staleThresholdHours: heartbeatHealth.staleThresholdHours,
      operatorCommand: "argent system heartbeat recompute-score",
      observedAtIso: nowIso,
    },
  ]);

  const start = Date.now();
  const cappedTimeout = Math.max(1000, timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const doProbe = params?.probe !== false;
  const channels: Record<string, ChannelHealthSummary> = {};
  const channelOrder = listChannelPlugins().map((plugin) => plugin.id);
  const channelLabels: Record<string, string> = {};

  for (const plugin of listChannelPlugins()) {
    channelLabels[plugin.id] = plugin.meta.label ?? plugin.id;
    const accountIds = plugin.config.listAccountIds(cfg);
    const defaultAccountId = resolveChannelDefaultAccountId({
      plugin,
      cfg,
      accountIds,
    });
    const boundAccounts = channelBindings.get(plugin.id)?.get(defaultAgentId) ?? [];
    const preferredAccountId = resolvePreferredAccountId({
      accountIds,
      defaultAccountId,
      boundAccounts,
    });
    const boundAccountIdsAll = Array.from(
      new Set(Array.from(channelBindings.get(plugin.id)?.values() ?? []).flatMap((ids) => ids)),
    );
    const accountIdsToProbe = Array.from(
      new Set(
        [preferredAccountId, defaultAccountId, ...accountIds, ...boundAccountIdsAll].filter(
          (value) => value && value.trim(),
        ),
      ),
    );
    debugHealth("channel", {
      id: plugin.id,
      accountIds,
      defaultAccountId,
      boundAccounts,
      preferredAccountId,
      accountIdsToProbe,
    });
    const accountSummaries: Record<string, ChannelAccountHealthSummary> = {};

    for (const accountId of accountIdsToProbe) {
      const account = plugin.config.resolveAccount(cfg, accountId);
      const enabled = plugin.config.isEnabled
        ? plugin.config.isEnabled(account, cfg)
        : isAccountEnabled(account);
      const configured = plugin.config.isConfigured
        ? await plugin.config.isConfigured(account, cfg)
        : true;

      let probe: unknown;
      let lastProbeAt: number | null = null;
      if (enabled && configured && doProbe && plugin.status?.probeAccount) {
        try {
          probe = await plugin.status.probeAccount({
            account,
            timeoutMs: cappedTimeout,
            cfg,
          });
          lastProbeAt = Date.now();
        } catch (err) {
          probe = { ok: false, error: formatErrorMessage(err) };
          lastProbeAt = Date.now();
        }
      }

      const probeRecord =
        probe && typeof probe === "object" ? (probe as Record<string, unknown>) : null;
      const bot =
        probeRecord && typeof probeRecord.bot === "object"
          ? (probeRecord.bot as { username?: string | null })
          : null;
      if (bot?.username) {
        debugHealth("probe.bot", { channel: plugin.id, accountId, username: bot.username });
      }

      const snapshot: ChannelAccountSnapshot = {
        accountId,
        enabled,
        configured,
      };
      if (probe !== undefined) {
        snapshot.probe = probe;
      }
      if (lastProbeAt) {
        snapshot.lastProbeAt = lastProbeAt;
      }

      const summary = plugin.status?.buildChannelSummary
        ? await plugin.status.buildChannelSummary({
            account,
            cfg,
            defaultAccountId: accountId,
            snapshot,
          })
        : undefined;
      const record =
        summary && typeof summary === "object"
          ? (summary as ChannelAccountHealthSummary)
          : ({
              accountId,
              configured,
              probe,
              lastProbeAt,
            } satisfies ChannelAccountHealthSummary);
      if (record.configured === undefined) {
        record.configured = configured;
      }
      if (record.lastProbeAt === undefined && lastProbeAt) {
        record.lastProbeAt = lastProbeAt;
      }
      record.accountId = accountId;
      accountSummaries[accountId] = record;
    }

    const defaultSummary =
      accountSummaries[preferredAccountId] ??
      accountSummaries[defaultAccountId] ??
      accountSummaries[accountIdsToProbe[0] ?? preferredAccountId];
    const fallbackSummary = defaultSummary ?? accountSummaries[Object.keys(accountSummaries)[0]];
    if (fallbackSummary) {
      channels[plugin.id] = {
        ...fallbackSummary,
        accounts: accountSummaries,
      } satisfies ChannelHealthSummary;
    }
  }

  const summary: HealthSummary = {
    ok: true,
    ts: Date.now(),
    durationMs: Date.now() - start,
    channels,
    channelOrder,
    channelLabels,
    heartbeatSeconds,
    defaultAgentId,
    agents,
    authProviders,
    sessions: {
      path: sessions.path,
      count: sessions.count,
      recent: sessions.recent,
    },
    kernel: getConsciousnessKernelSnapshot() ?? undefined,
    memoryHealth: await (async () => {
      try {
        return await getMemoryHealthSummary(cfg);
      } catch {
        return undefined;
      }
    })(),
    criticalAlerts,
  };

  return summary;
}

export async function healthCommand(
  opts: { json?: boolean; timeoutMs?: number; verbose?: boolean; config?: ArgentConfig },
  runtime: RuntimeEnv,
) {
  const cfg = opts.config ?? loadConfig();
  // Always query the running gateway; do not open a direct Baileys socket here.
  const summary = await withProgress(
    {
      label: "Checking gateway health…",
      indeterminate: true,
      enabled: opts.json !== true,
    },
    async () =>
      await callGateway<HealthSummary>({
        method: "health",
        params: opts.verbose ? { probe: true } : undefined,
        timeoutMs: opts.timeoutMs,
        config: cfg,
      }),
  );
  // Gateway reachability defines success; channel issues are reported but not fatal here.
  const fatal = false;

  if (opts.json) {
    runtime.log(JSON.stringify(summary, null, 2));
  } else {
    const debugEnabled = isTruthyEnvValue(process.env.ARGENT_DEBUG_HEALTH);
    if (opts.verbose) {
      const details = buildGatewayConnectionDetails({ config: cfg });
      runtime.log(info("Gateway connection:"));
      for (const line of details.message.split("\n")) {
        runtime.log(`  ${line}`);
      }
    }
    const localAgents = resolveAgentOrder(cfg);
    const defaultAgentId = summary.defaultAgentId ?? localAgents.defaultAgentId;
    const agents = Array.isArray(summary.agents) ? summary.agents : [];
    const fallbackAgents = localAgents.ordered.map((entry) => {
      const storePath = resolveStorePath(cfg.session?.store, { agentId: entry.id });
      return {
        agentId: entry.id,
        name: entry.name,
        isDefault: entry.id === localAgents.defaultAgentId,
        heartbeat: resolveHeartbeatSummary(cfg, entry.id),
        sessions: buildSessionSummary(storePath),
      } satisfies AgentHealthSummary;
    });
    const resolvedAgents = agents.length > 0 ? agents : fallbackAgents;
    const displayAgents = opts.verbose
      ? resolvedAgents
      : resolvedAgents.filter((agent) => agent.agentId === defaultAgentId);
    const channelBindings = buildChannelAccountBindings(cfg);
    if (debugEnabled) {
      runtime.log(info("[debug] local channel accounts"));
      for (const plugin of listChannelPlugins()) {
        const accountIds = plugin.config.listAccountIds(cfg);
        const defaultAccountId = resolveChannelDefaultAccountId({
          plugin,
          cfg,
          accountIds,
        });
        runtime.log(
          `  ${plugin.id}: accounts=${accountIds.join(", ") || "(none)"} default=${defaultAccountId}`,
        );
        for (const accountId of accountIds) {
          const account = plugin.config.resolveAccount(cfg, accountId);
          const record = asRecord(account);
          const tokenSource =
            record && typeof record.tokenSource === "string" ? record.tokenSource : undefined;
          const configured = plugin.config.isConfigured
            ? await plugin.config.isConfigured(account, cfg)
            : true;
          runtime.log(
            `    - ${accountId}: configured=${configured}${tokenSource ? ` tokenSource=${tokenSource}` : ""}`,
          );
        }
      }
      runtime.log(info("[debug] bindings map"));
      for (const [channelId, byAgent] of channelBindings.entries()) {
        const entries = Array.from(byAgent.entries()).map(
          ([agentId, ids]) => `${agentId}=[${ids.join(", ")}]`,
        );
        runtime.log(`  ${channelId}: ${entries.join(" ")}`);
      }
      runtime.log(info("[debug] gateway channel probes"));
      for (const [channelId, channelSummary] of Object.entries(summary.channels ?? {})) {
        const accounts = channelSummary.accounts ?? {};
        const probes = Object.entries(accounts).map(([accountId, accountSummary]) => {
          const probe = asRecord(accountSummary.probe);
          const bot = probe ? asRecord(probe.bot) : null;
          const username = bot && typeof bot.username === "string" ? bot.username : null;
          return `${accountId}=${username ?? "(no bot)"}`;
        });
        runtime.log(`  ${channelId}: ${probes.join(", ") || "(none)"}`);
      }
    }
    const channelAccountFallbacks = Object.fromEntries(
      listChannelPlugins().map((plugin) => {
        const accountIds = plugin.config.listAccountIds(cfg);
        const defaultAccountId = resolveChannelDefaultAccountId({
          plugin,
          cfg,
          accountIds,
        });
        const preferred = resolvePreferredAccountId({
          accountIds,
          defaultAccountId,
          boundAccounts: channelBindings.get(plugin.id)?.get(defaultAgentId) ?? [],
        });
        return [plugin.id, [preferred] as string[]] as const;
      }),
    );
    const accountIdsByChannel = (() => {
      const entries = displayAgents.length > 0 ? displayAgents : resolvedAgents;
      const byChannel: Record<string, string[]> = {};
      for (const [channelId, byAgent] of channelBindings.entries()) {
        const accountIds: string[] = [];
        for (const agent of entries) {
          const ids = byAgent.get(agent.agentId) ?? [];
          for (const id of ids) {
            if (!accountIds.includes(id)) {
              accountIds.push(id);
            }
          }
        }
        if (accountIds.length > 0) {
          byChannel[channelId] = accountIds;
        }
      }
      for (const [channelId, fallbackIds] of Object.entries(channelAccountFallbacks)) {
        if (!byChannel[channelId] || byChannel[channelId].length === 0) {
          byChannel[channelId] = fallbackIds;
        }
      }
      return byChannel;
    })();
    const channelLines =
      Object.keys(accountIdsByChannel).length > 0
        ? formatHealthChannelLines(summary, {
            accountMode: opts.verbose ? "all" : "default",
            accountIdsByChannel,
          })
        : formatHealthChannelLines(summary, {
            accountMode: opts.verbose ? "all" : "default",
          });
    for (const line of channelLines) {
      runtime.log(styleHealthChannelLine(line));
    }
    const authProviders =
      summary.authProviders ?? resolveAuthProvidersForAgent(cfg, defaultAgentId);
    for (const provider of authProviders) {
      const circuitState = provider.circuitState;
      const detail =
        circuitState === "open"
          ? `open${provider.cooldownUntil ? ` until ${new Date(provider.cooldownUntil).toLocaleTimeString()}` : ""}`
          : circuitState === "half_open"
            ? "half-open (probe)"
            : "closed";
      const profileDetail =
        provider.totalProfiles > 0
          ? ` (${provider.rateLimitedProfiles}/${provider.totalProfiles} profiles in cooldown)`
          : "";
      runtime.log(
        `${provider.provider}: ${
          circuitState === "closed" ? theme.success(detail) : theme.warn(detail)
        }${profileDetail}`,
      );
    }
    for (const plugin of listChannelPlugins()) {
      const channelSummary = summary.channels?.[plugin.id];
      if (!channelSummary || channelSummary.linked !== true) {
        continue;
      }
      if (!plugin.status?.logSelfId) {
        continue;
      }
      const boundAccounts = channelBindings.get(plugin.id)?.get(defaultAgentId) ?? [];
      const accountIds = plugin.config.listAccountIds(cfg);
      const defaultAccountId = resolveChannelDefaultAccountId({
        plugin,
        cfg,
        accountIds,
      });
      const accountId = resolvePreferredAccountId({
        accountIds,
        defaultAccountId,
        boundAccounts,
      });
      const account = plugin.config.resolveAccount(cfg, accountId);
      plugin.status.logSelfId({
        account,
        cfg,
        runtime,
        includeChannelPrefix: true,
      });
    }

    if (resolvedAgents.length > 0) {
      const agentLabels = resolvedAgents.map((agent) =>
        agent.isDefault ? `${agent.agentId} (default)` : agent.agentId,
      );
      runtime.log(info(`Agents: ${agentLabels.join(", ")}`));
    }
    const heartbeatParts = displayAgents
      .map((agent) => {
        const everyMs = agent.heartbeat?.everyMs;
        const label = everyMs ? formatDurationParts(everyMs) : "disabled";
        return `${label} (${agent.agentId})`;
      })
      .filter(Boolean);
    if (heartbeatParts.length > 0) {
      runtime.log(info(`Heartbeat interval: ${heartbeatParts.join(", ")}`));
    }
    if (summary.kernel) {
      const kernelParts = [
        `${summary.kernel.status}/${summary.kernel.mode}`,
        `wakefulness=${summary.kernel.wakefulnessState}`,
        `ticks=${summary.kernel.tickCount} runtime/${summary.kernel.totalTickCount} total`,
        `decisions=${summary.kernel.decisionCount}`,
      ];
      if (summary.kernel.schedulerAuthorityActive) {
        const managedSubsystems = [
          summary.kernel.suppressesAutonomousContemplation ? "contemplation" : null,
          summary.kernel.suppressesAutonomousSis ? "sis" : null,
        ].filter((value): value is string => Boolean(value));
        if (managedSubsystems.length > 0) {
          kernelParts.push(`authority=${managedSubsystems.join("+")}`);
        }
      }
      if (summary.kernel.lastTickAt) {
        kernelParts.push(
          `lastTick=${formatDurationParts(Math.max(0, Date.now() - Date.parse(summary.kernel.lastTickAt)))}`,
        );
      }
      if (summary.kernel.lastPersistedAt) {
        kernelParts.push(
          `persisted=${formatDurationParts(
            Math.max(0, Date.now() - Date.parse(summary.kernel.lastPersistedAt)),
          )} ago`,
        );
      }
      if (summary.kernel.desiredAction) {
        kernelParts.push(`intent=${summary.kernel.desiredAction}`);
      }
      if (summary.kernel.effectiveFocus) {
        kernelParts.push(`focus=${summary.kernel.effectiveFocus}`);
      }
      if (
        summary.kernel.activeLaneFocus &&
        summary.kernel.activeLaneFocus !== summary.kernel.effectiveFocus
      ) {
        kernelParts.push(`active=${summary.kernel.activeLaneFocus}`);
      }
      if (summary.kernel.continuityLane) {
        kernelParts.push(`lane=${summary.kernel.continuityLane}`);
      }
      if (
        summary.kernel.activeLane &&
        summary.kernel.activeLane !== summary.kernel.continuityLane
      ) {
        kernelParts.push(`workingLane=${summary.kernel.activeLane}`);
      }
      if (summary.kernel.continuitySource) {
        kernelParts.push(`owner=${summary.kernel.continuitySource}`);
      }
      if (
        summary.kernel.currentFocus &&
        summary.kernel.currentFocus !== summary.kernel.effectiveFocus
      ) {
        kernelParts.push(`kernelFocus=${summary.kernel.currentFocus}`);
      }
      if (
        summary.kernel.agendaActiveTitle &&
        summary.kernel.agendaActiveTitle !== summary.kernel.effectiveFocus &&
        summary.kernel.agendaActiveTitle !== summary.kernel.continuityThreadTitle
      ) {
        kernelParts.push(`agenda=${summary.kernel.agendaActiveTitle}`);
      }
      if (summary.kernel.agendaActiveSource) {
        kernelParts.push(`agendaSource=${summary.kernel.agendaActiveSource}`);
      }
      if (summary.kernel.agendaActiveRationale) {
        kernelParts.push(`agendaWhy=${summary.kernel.agendaActiveRationale}`);
      }
      if (summary.kernel.agendaOpenQuestions[0]) {
        kernelParts.push(`question=${summary.kernel.agendaOpenQuestions[0]}`);
      }
      if (
        summary.kernel.executiveWorkTitle &&
        summary.kernel.executiveWorkTitle !== summary.kernel.effectiveFocus &&
        summary.kernel.executiveWorkTitle !== summary.kernel.activeLaneFocus
      ) {
        kernelParts.push(`exec=${summary.kernel.executiveWorkTitle}`);
      }
      if (summary.kernel.executiveLastActionKind) {
        kernelParts.push(`action=${summary.kernel.executiveLastActionKind}`);
      }
      if (summary.kernel.executiveLastArtifactType) {
        kernelParts.push(`artifact=${summary.kernel.executiveLastArtifactType}`);
      }
      if (summary.kernel.executiveArtifactCount > 0) {
        kernelParts.push(`artifacts=${summary.kernel.executiveArtifactCount}`);
      }
      if (summary.kernel.executivePendingSurfaceMode) {
        kernelParts.push(`surface=${summary.kernel.executivePendingSurfaceMode}`);
      }
      if (summary.kernel.continuityThreadTitle) {
        kernelParts.push(`thread=${summary.kernel.continuityThreadTitle}`);
      } else {
        const operatorWorkFocus = resolveKernelWorkFocusFromSnapshot({
          threadTitle: summary.kernel.activeWorkThreadTitle,
          problemStatement: summary.kernel.activeWorkProblemStatement,
          nextStep: summary.kernel.activeWorkNextStep,
          lastConclusion: summary.kernel.activeWorkLastConclusion,
        });
        if (operatorWorkFocus) {
          kernelParts.push(`thread=${operatorWorkFocus}`);
        }
      }
      const backgroundWorkFocus = resolveKernelWorkFocusFromSnapshot({
        threadTitle: summary.kernel.backgroundWorkThreadTitle,
        problemStatement: summary.kernel.backgroundWorkProblemStatement,
        nextStep: summary.kernel.backgroundWorkNextStep,
        lastConclusion: summary.kernel.backgroundWorkLastConclusion,
      });
      if (backgroundWorkFocus) {
        kernelParts.push(`background=${backgroundWorkFocus}`);
      }
      if (summary.kernel.continuityNextStep) {
        kernelParts.push(`next=${summary.kernel.continuityNextStep}`);
      } else if (summary.kernel.activeWorkNextStep) {
        kernelParts.push(`next=${summary.kernel.activeWorkNextStep}`);
      }
      if (summary.kernel.reflectionRepeatCount > 0) {
        kernelParts.push(`stall=x${summary.kernel.reflectionRepeatCount + 1}`);
      }
      if (summary.kernel.activeConversationChannel) {
        kernelParts.push(`channel=${summary.kernel.activeConversationChannel}`);
      }
      if (summary.kernel.lastAssistantConclusion) {
        kernelParts.push(`carry=${summary.kernel.lastAssistantConclusion}`);
      }
      if (summary.kernel.lastError) {
        kernelParts.push(`error=${summary.kernel.lastError}`);
      }
      runtime.log(info(`Kernel: ${kernelParts.join(", ")}`));
    }
    if (displayAgents.length === 0) {
      runtime.log(
        info(`Session store: ${summary.sessions.path} (${summary.sessions.count} entries)`),
      );
      if (summary.sessions.recent.length > 0) {
        for (const r of summary.sessions.recent) {
          runtime.log(
            `- ${r.key} (${r.updatedAt ? `${Math.round((Date.now() - r.updatedAt) / 60000)}m ago` : "no activity"})`,
          );
        }
      }
    } else {
      for (const agent of displayAgents) {
        runtime.log(
          info(
            `Session store (${agent.agentId}): ${agent.sessions.path} (${agent.sessions.count} entries)`,
          ),
        );
        if (agent.sessions.recent.length > 0) {
          for (const r of agent.sessions.recent) {
            runtime.log(
              `- ${r.key} (${r.updatedAt ? `${Math.round((Date.now() - r.updatedAt) / 60000)}m ago` : "no activity"})`,
            );
          }
        }
      }
    }
  }

  if (fatal) {
    runtime.exit(1);
  }
}
