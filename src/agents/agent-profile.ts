import type { ArgentConfig } from "../config/config.js";
import type { TtsConfig } from "../config/types.tts.js";
import type {
  AuthProfileCredential,
  AuthProfileStore,
  ProfileUsageStats,
} from "./auth-profiles.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveAgentConfig } from "./agent-scope.js";

export type AgentTtsSource = "global" | "agent";

export type EffectiveAgentTtsProfile = {
  agentId: string;
  effective: TtsConfig;
  global?: TtsConfig;
  agent?: TtsConfig;
  source: AgentTtsSource;
};

export type RedactedAuthProfileSummary = {
  id: string;
  provider: string;
  type: AuthProfileCredential["type"];
  email?: string;
  metadataKeys?: string[];
  lastGoodForProviders: string[];
  lastUsed?: number;
  cooldownUntil?: number;
  disabledUntil?: number;
  disabledReason?: string;
  errorCount?: number;
  available: boolean;
};

export type RedactedAuthProfileStoreSummary = {
  profileCount: number;
  profiles: RedactedAuthProfileSummary[];
  order: Record<string, string[]>;
  providerStats: string[];
};

const SECRET_KEY_RE = /^(?:apiKey|key|token|secret|password|refresh|refreshToken|accessToken)$/i;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneTtsConfig(config: TtsConfig | undefined): TtsConfig | undefined {
  if (!config) {
    return undefined;
  }
  return structuredClone(config);
}

function mergeRecords<T extends Record<string, unknown>>(base: T | undefined, override: T): T {
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = next[key];
    if (isPlainRecord(current) && isPlainRecord(value)) {
      next[key] = mergeRecords(current, value);
    } else {
      next[key] = structuredClone(value);
    }
  }
  return next as T;
}

export function mergeTtsConfig(
  globalConfig: TtsConfig | undefined,
  agentOverride: TtsConfig | undefined,
): TtsConfig {
  const globalClone = cloneTtsConfig(globalConfig);
  if (!agentOverride) {
    return globalClone ?? {};
  }
  return mergeRecords(
    globalClone as Record<string, unknown> | undefined,
    agentOverride,
  ) as TtsConfig;
}

export function resolveEffectiveAgentTtsProfile(
  cfg: ArgentConfig,
  agentIdRaw: string,
): EffectiveAgentTtsProfile {
  const agentId = normalizeAgentId(agentIdRaw);
  const global = cloneTtsConfig(cfg.messages?.tts);
  const agent = cloneTtsConfig(resolveAgentConfig(cfg, agentId)?.tts);
  return {
    agentId,
    effective: mergeTtsConfig(global, agent),
    ...(global ? { global } : {}),
    ...(agent ? { agent } : {}),
    source: agent ? "agent" : "global",
  };
}

function redactTtsValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactTtsValue);
  }
  if (!isPlainRecord(value)) {
    return structuredClone(value);
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) {
      continue;
    }
    redacted[key] = redactTtsValue(child);
  }
  return redacted;
}

export function redactTtsConfig(config: TtsConfig | undefined): TtsConfig | undefined {
  if (!config) {
    return undefined;
  }
  return redactTtsValue(config) as TtsConfig;
}

function credentialEmail(credential: AuthProfileCredential): string | undefined {
  return "email" in credential ? credential.email?.trim() || undefined : undefined;
}

function summarizeUsage(stats: ProfileUsageStats | undefined, nowMs: number) {
  const cooldownUntil =
    typeof stats?.cooldownUntil === "number" && stats.cooldownUntil > nowMs
      ? stats.cooldownUntil
      : undefined;
  const disabledUntil =
    typeof stats?.disabledUntil === "number" && stats.disabledUntil > nowMs
      ? stats.disabledUntil
      : undefined;
  return {
    ...(typeof stats?.lastUsed === "number" ? { lastUsed: stats.lastUsed } : {}),
    ...(cooldownUntil ? { cooldownUntil } : {}),
    ...(disabledUntil ? { disabledUntil } : {}),
    ...(stats?.disabledReason ? { disabledReason: stats.disabledReason } : {}),
    ...(typeof stats?.errorCount === "number" ? { errorCount: stats.errorCount } : {}),
    available: !cooldownUntil && !disabledUntil,
  };
}

export function summarizeAuthProfileStore(
  store: AuthProfileStore | undefined,
  options?: { nowMs?: number },
): RedactedAuthProfileStoreSummary {
  const nowMs = options?.nowMs ?? Date.now();
  const profiles = store?.profiles ?? {};
  const lastGood = store?.lastGood ?? {};
  const rows = Object.entries(profiles)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([id, credential]) => {
      const usage = summarizeUsage(store?.usageStats?.[id], nowMs);
      return {
        id,
        provider: credential.provider,
        type: credential.type,
        ...(credentialEmail(credential) ? { email: credentialEmail(credential) } : {}),
        ...(credential.type === "api_key" && credential.metadata
          ? { metadataKeys: Object.keys(credential.metadata).toSorted() }
          : {}),
        lastGoodForProviders: Object.entries(lastGood)
          .filter(([, profileId]) => profileId === id)
          .map(([provider]) => provider)
          .toSorted(),
        ...usage,
      };
    });

  return {
    profileCount: rows.length,
    profiles: rows,
    order: structuredClone(store?.order ?? {}),
    providerStats: Object.keys(store?.providerStats ?? {}).toSorted(),
  };
}
