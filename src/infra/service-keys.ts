/**
 * Service Key Resolver — Reads from the dashboard's centralized key store.
 *
 * Resolution order:
 *   1. ~/.argentos/service-keys.json (dashboard-managed, primary)
 *   2. process.env (gateway plist / shell env)
 *   3. argent.json env.vars (legacy fallback; disabled by default)
 *
 * The dashboard UI (Settings > API Keys) writes to service-keys.json.
 * This allows both the human operator and the agent to manage keys
 * through the dashboard, rather than editing config files.
 *
 * Encryption at rest:
 *   Values are encrypted with AES-256-GCM using a master key stored in
 *   macOS Keychain (or ~/.argentos/.master-key on other platforms).
 *   Plaintext values are auto-migrated to encrypted form on first read.
 */

import fs from "node:fs";
import path from "node:path";
import type { ArgentConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  hashSecretValue,
  querySecretAudit,
  recordSecretAudit,
  type SecretAuditQuery,
} from "./secret-audit.js";
import { decryptSecret, encryptSecret, isEncrypted } from "./secret-crypto.js";

const log = createSubsystemLogger("service-keys");

const SERVICE_KEYS_PATH = path.join(process.env.HOME ?? "/tmp", ".argentos", "service-keys.json");

export interface ServiceKeyEntry {
  id: string;
  name: string;
  variable: string;
  value: string;
  service?: string;
  category?: string;
  enabled?: boolean;
  source?: "manual" | "org-sync" | "env";
  allowedRoles?: string[];
  allowedAgents?: string[];
  allowedTeams?: string[];
  denyAll?: boolean;
  rotatedAt?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ServiceKeysFile {
  version: number;
  keys: ServiceKeyEntry[];
}

export interface ServiceKeyAccessContext {
  actorId?: string;
  actorRole?: string;
  actorTeam?: string;
  sessionKey?: string;
  ipAddress?: string;
  source?: string;
}

interface ServiceKeyAccessEvaluation {
  allowed: boolean;
  reason?: string;
}

let cachedKeys: ServiceKeysFile | null = null;
let cachedMtime = 0;

export function invalidateServiceKeyCache(): void {
  cachedKeys = null;
  cachedMtime = 0;
}

export function saveServiceKeys(store: ServiceKeysFile): void {
  const dir = path.dirname(SERVICE_KEYS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SERVICE_KEYS_PATH, JSON.stringify(store, null, 2), "utf-8");
  fs.chmodSync(SERVICE_KEYS_PATH, 0o600);
  invalidateServiceKeyCache();
}

/**
 * Read service-keys.json with simple mtime-based caching.
 * The file is small and rarely changes, so re-reading on mtime change is fine.
 *
 * Auto-migrates plaintext values to encrypted form on first read.
 */
export function readServiceKeys(): ServiceKeysFile {
  try {
    const stat = fs.statSync(SERVICE_KEYS_PATH);
    if (cachedKeys && stat.mtimeMs === cachedMtime) {
      return cachedKeys;
    }
    const raw = fs.readFileSync(SERVICE_KEYS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as ServiceKeysFile;

    // Auto-encrypt any plaintext values
    let migrated = false;
    for (const entry of parsed.keys) {
      if (entry.value && !isEncrypted(entry.value)) {
        entry.value = encryptSecret(entry.value);
        migrated = true;
      }
    }
    if (migrated) {
      saveServiceKeys(parsed);
      log.info("migrated plaintext service keys to encrypted storage");
    }

    cachedKeys = parsed;
    cachedMtime = migrated ? fs.statSync(SERVICE_KEYS_PATH).mtimeMs : stat.mtimeMs;
    return cachedKeys;
  } catch {
    return { version: 1, keys: [] };
  }
}

function resolveAgentContextFromConfig(
  cfg: ArgentConfig | undefined,
  actorId: string | undefined,
): { role?: string; team?: string } {
  if (!cfg || !actorId) return {};
  const list = Array.isArray((cfg as any)?.agents?.list) ? ((cfg as any).agents.list as any[]) : [];
  const entry = list.find(
    (item) =>
      String(item?.id ?? "")
        .trim()
        .toLowerCase() === actorId.toLowerCase(),
  );
  if (!entry || typeof entry !== "object") return {};
  const role =
    typeof entry.role === "string" && entry.role.trim().length > 0 ? entry.role.trim() : undefined;
  const team =
    (typeof entry.team === "string" && entry.team.trim().length > 0
      ? entry.team.trim()
      : typeof entry.config?.team === "string" && entry.config.team.trim().length > 0
        ? entry.config.team.trim()
        : undefined) ?? undefined;
  return { role, team };
}

function normalizeContext(
  ctx?: ServiceKeyAccessContext,
  cfg?: ArgentConfig,
): ServiceKeyAccessContext {
  const sessionKey = ctx?.sessionKey ?? process.env.ARGENT_SESSION_KEY ?? undefined;
  const sessionDerivedAgent = (() => {
    const raw = String(sessionKey ?? "");
    if (!raw) return undefined;
    // session key formats include: "agent:<id>:...", "<id>:..." and "main"
    const match = raw.match(/^agent:([^:]+):/i);
    if (match?.[1]) return match[1];
    if (raw.includes(":")) return raw.split(":")[0]?.trim() || undefined;
    return raw.trim() || undefined;
  })();
  const actorId = ctx?.actorId ?? process.env.ARGENT_AGENT_ID ?? sessionDerivedAgent ?? undefined;
  const derived = resolveAgentContextFromConfig(cfg, actorId);
  return {
    actorId,
    actorRole: ctx?.actorRole ?? process.env.ARGENT_AGENT_ROLE ?? derived.role ?? undefined,
    actorTeam: ctx?.actorTeam ?? process.env.ARGENT_AGENT_TEAM ?? derived.team ?? undefined,
    sessionKey,
    ipAddress: ctx?.ipAddress,
    source: ctx?.source,
  };
}

function hasScopedAccessPolicy(entry: ServiceKeyEntry): boolean {
  return (
    entry.denyAll === true ||
    (Array.isArray(entry.allowedRoles) && entry.allowedRoles.length > 0) ||
    (Array.isArray(entry.allowedAgents) && entry.allowedAgents.length > 0) ||
    (Array.isArray(entry.allowedTeams) && entry.allowedTeams.length > 0)
  );
}

function includesNormalized(list: string[] | undefined, value: string | undefined): boolean {
  if (!Array.isArray(list) || list.length === 0 || !value) return false;
  const normalized = value.trim().toLowerCase();
  return list.some(
    (item) =>
      String(item ?? "")
        .trim()
        .toLowerCase() === normalized,
  );
}

function evaluateServiceKeyAccess(
  entry: ServiceKeyEntry,
  context?: ServiceKeyAccessContext,
  cfg?: ArgentConfig,
): ServiceKeyAccessEvaluation {
  if (!hasScopedAccessPolicy(entry)) {
    return { allowed: true };
  }
  if (entry.denyAll === true) {
    return { allowed: false, reason: "denyAll policy is enabled" };
  }

  const ctx = normalizeContext(context, cfg);
  const hasAnyIdentity = Boolean(ctx.actorId || ctx.actorRole || ctx.actorTeam);
  if (!hasAnyIdentity) {
    return { allowed: false, reason: "missing actor identity for scoped secret policy" };
  }

  if (includesNormalized(entry.allowedAgents, ctx.actorId)) {
    return { allowed: true };
  }
  if (includesNormalized(entry.allowedRoles, ctx.actorRole)) {
    return { allowed: true };
  }
  if (includesNormalized(entry.allowedTeams, ctx.actorTeam)) {
    return { allowed: true };
  }

  return { allowed: false, reason: "actor does not match allowedAgents/allowedRoles/allowedTeams" };
}

function auditSecretFetch(params: {
  entry?: ServiceKeyEntry;
  envName: string;
  result: "success" | "denied" | "error";
  reason?: string;
  source?: string;
  context?: ServiceKeyAccessContext;
  cfg?: ArgentConfig;
}): void {
  const ctx = normalizeContext(params.context, params.cfg);
  recordSecretAudit({
    actorId: ctx.actorId,
    actorRole: ctx.actorRole,
    actorTeam: ctx.actorTeam,
    action: params.result === "denied" ? "denied" : "fetch",
    secretId: params.entry?.id,
    secretVariable: params.envName,
    secretName: params.entry?.name,
    source: params.source,
    result: params.result,
    denialReason: params.reason,
    sessionKey: ctx.sessionKey,
    ipAddress: ctx.ipAddress,
  });
}

/**
 * Resolve an API key by env variable name.
 *
 * Checks (in order):
 *   1. service-keys.json (dashboard-managed)
 *   2. process.env
 *   3. argent.json env.vars
 */
export function resolveServiceKey(
  envName: string,
  cfg?: ArgentConfig,
  context?: ServiceKeyAccessContext,
): string | undefined {
  // 1. Dashboard-managed service keys (primary source of truth)
  const store = readServiceKeys();
  const entry = store.keys.find((k) => k.variable === envName && k.enabled !== false);
  if (entry?.value) {
    const access = evaluateServiceKeyAccess(entry, context, cfg);
    if (!access.allowed) {
      auditSecretFetch({
        entry,
        envName,
        result: "denied",
        reason: access.reason,
        source: "service-keys.json",
        context,
        cfg,
      });
      return undefined;
    }
    try {
      const decrypted = decryptSecret(entry.value);
      auditSecretFetch({
        entry,
        envName,
        result: "success",
        source: "service-keys.json",
        context,
        cfg,
      });
      return decrypted;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log.warn("failed to decrypt service key; falling back to next source", {
        variable: envName,
        keyId: entry.id,
        error: reason,
      });
      auditSecretFetch({
        entry,
        envName,
        result: "error",
        reason,
        source: "service-keys.json",
        context,
        cfg,
      });
    }
  }

  // 2. Process env (from gateway plist or shell)
  const envVal = process.env[envName];
  if (envVal) {
    auditSecretFetch({
      envName,
      result: "success",
      source: "process.env",
      context,
      cfg,
    });
    return envVal;
  }

  // 3. argent.json env.vars (legacy config fallback, explicit opt-in only)
  const allowLegacyConfigFallback =
    process.env.ARGENT_ALLOW_CONFIG_ENV_VARS === "1" ||
    process.env.ARGENT_LEGACY_CONFIG_ENV_IMPORT === "1";
  if (allowLegacyConfigFallback && cfg) {
    const configVal = (cfg.env as Record<string, Record<string, string>> | undefined)?.vars?.[
      envName
    ];
    if (configVal) {
      auditSecretFetch({
        envName,
        result: "success",
        source: "argent.json env.vars",
        context,
        cfg,
      });
      return configVal;
    }
  }

  return undefined;
}

/**
 * Seed a key into service-keys.json if it doesn't already exist.
 * Used for initial setup / migration from env vars to dashboard management.
 */
export function seedServiceKey(opts: {
  variable: string;
  value: string;
  name?: string;
  service?: string;
  category?: string;
}): boolean {
  const store = readServiceKeys();
  const existing = store.keys.find((k) => k.variable === opts.variable);
  if (existing) return false; // Already exists

  const entry: ServiceKeyEntry = {
    id: `sk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: opts.name ?? opts.variable,
    variable: opts.variable,
    value: encryptSecret(opts.value),
    enabled: true,
  };
  store.keys.push(entry);

  try {
    saveServiceKeys(store);
    cachedKeys = store;
    log.info("seeded service key", { variable: opts.variable });
    recordSecretAudit({
      action: "create",
      secretId: entry.id,
      secretVariable: entry.variable,
      secretName: entry.name,
      source: "service-keys.json",
      result: "success",
      newValueHash: hashSecretValue(opts.value),
    });
    return true;
  } catch (err) {
    log.warn("failed to seed service key", {
      variable: opts.variable,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export type UpsertResult = { action: "created" | "updated" | "skipped"; variable: string };

/**
 * Upsert a service key — used by org secret sync.
 *
 * Rules:
 *  - If a key exists with `source: "manual"`, skip (never overwrite manual entries).
 *  - If a key exists with `source: "org-sync"` or no source, update value and metadata.
 *  - If no key exists, create a new entry.
 */
export function upsertServiceKey(opts: {
  variable: string;
  value: string;
  name?: string;
  service?: string;
  category?: string;
  source?: "manual" | "org-sync" | "env";
}): UpsertResult {
  const store = readServiceKeys();
  const existing = store.keys.find((k) => k.variable === opts.variable);

  if (existing) {
    // Never overwrite keys the user manually configured
    if (existing.source === "manual") {
      return { action: "skipped", variable: opts.variable };
    }
    // Update existing org-sync or untagged key
    existing.value = encryptSecret(opts.value);
    existing.name = opts.name ?? existing.name;
    if (opts.service !== undefined) existing.service = opts.service;
    if (opts.category !== undefined) existing.category = opts.category;
    existing.source = opts.source ?? "org-sync";
    existing.enabled = true;
  } else {
    // Create new entry
    store.keys.push({
      id: `sk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: opts.name ?? opts.variable,
      variable: opts.variable,
      value: encryptSecret(opts.value),
      service: opts.service,
      category: opts.category,
      enabled: true,
      source: opts.source ?? "org-sync",
    });
  }

  try {
    saveServiceKeys(store);
    log.info("upserted service key", {
      variable: opts.variable,
      action: existing ? "updated" : "created",
    });
    recordSecretAudit({
      action: existing ? "update" : "create",
      secretId: existing?.id,
      secretVariable: opts.variable,
      secretName: opts.name ?? opts.variable,
      source: "service-keys.json",
      result: "success",
      newValueHash: hashSecretValue(opts.value),
    });
    return { action: existing ? "updated" : "created", variable: opts.variable };
  } catch (err) {
    log.warn("failed to upsert service key", {
      variable: opts.variable,
      error: err instanceof Error ? err.message : String(err),
    });
    // Return skipped on write failure rather than throwing
    return { action: "skipped", variable: opts.variable };
  }
}

/**
 * Bulk upsert service keys — convenience wrapper for org secret sync.
 */
export function bulkUpsertServiceKeys(
  keys: Array<{
    variable: string;
    value: string;
    name?: string;
    service?: string;
    category?: string;
    source?: "manual" | "org-sync" | "env";
  }>,
): UpsertResult[] {
  return keys.map((k) => upsertServiceKey(k));
}

function normalizeUnique(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function listServiceKeyPolicies(): Array<{
  id: string;
  variable: string;
  name: string;
  denyAll: boolean;
  allowedRoles: string[];
  allowedAgents: string[];
  allowedTeams: string[];
}> {
  const store = readServiceKeys();
  return store.keys.map((key) => ({
    id: key.id,
    variable: key.variable,
    name: key.name,
    denyAll: key.denyAll === true,
    allowedRoles: normalizeUnique(key.allowedRoles) ?? [],
    allowedAgents: normalizeUnique(key.allowedAgents) ?? [],
    allowedTeams: normalizeUnique(key.allowedTeams) ?? [],
  }));
}

export function updateServiceKeyPolicyByVariable(params: {
  variable: string;
  allowedRoles?: string[];
  allowedAgents?: string[];
  allowedTeams?: string[];
  denyAll?: boolean;
  actorId?: string;
  actorRole?: string;
  actorTeam?: string;
  sessionKey?: string;
}): { updated: boolean; reason?: string } {
  const store = readServiceKeys();
  const entry = store.keys.find((key) => key.variable === params.variable);
  if (!entry) {
    return { updated: false, reason: `No key found for variable ${params.variable}` };
  }

  const previousRoles = normalizeUnique(entry.allowedRoles) ?? [];
  const previousAgents = normalizeUnique(entry.allowedAgents) ?? [];
  const previousTeams = normalizeUnique(entry.allowedTeams) ?? [];
  const previousDenyAll = entry.denyAll === true;

  if (params.allowedRoles !== undefined) entry.allowedRoles = normalizeUnique(params.allowedRoles);
  if (params.allowedAgents !== undefined)
    entry.allowedAgents = normalizeUnique(params.allowedAgents);
  if (params.allowedTeams !== undefined) entry.allowedTeams = normalizeUnique(params.allowedTeams);
  if (params.denyAll !== undefined) entry.denyAll = params.denyAll === true;

  entry.updatedAt = new Date().toISOString();
  saveServiceKeys(store);

  recordSecretAudit({
    actorId: params.actorId,
    actorRole: params.actorRole,
    actorTeam: params.actorTeam,
    action: "update",
    secretId: entry.id,
    secretVariable: entry.variable,
    secretName: entry.name,
    source: "service-keys.json",
    result: "success",
    oldValueHash: hashSecretValue(
      JSON.stringify({
        denyAll: previousDenyAll,
        allowedRoles: previousRoles,
        allowedAgents: previousAgents,
        allowedTeams: previousTeams,
      }),
    ),
    newValueHash: hashSecretValue(
      JSON.stringify({
        denyAll: entry.denyAll === true,
        allowedRoles: normalizeUnique(entry.allowedRoles) ?? [],
        allowedAgents: normalizeUnique(entry.allowedAgents) ?? [],
        allowedTeams: normalizeUnique(entry.allowedTeams) ?? [],
      }),
    ),
    sessionKey: params.sessionKey,
  });

  return { updated: true };
}

export function grantServiceKeyAccess(params: {
  variable: string;
  role?: string;
  agent?: string;
  team?: string;
  actorId?: string;
  actorRole?: string;
  actorTeam?: string;
  sessionKey?: string;
}): { updated: boolean; reason?: string } {
  const role = params.role?.trim();
  const agent = params.agent?.trim();
  const team = params.team?.trim();
  if (!role && !agent && !team) {
    return { updated: false, reason: "Specify at least one of role, agent, or team." };
  }

  const store = readServiceKeys();
  const entry = store.keys.find((key) => key.variable === params.variable);
  if (!entry) return { updated: false, reason: `No key found for variable ${params.variable}` };

  const nextRoles = normalizeUnique([...(entry.allowedRoles ?? []), ...(role ? [role] : [])]);
  const nextAgents = normalizeUnique([...(entry.allowedAgents ?? []), ...(agent ? [agent] : [])]);
  const nextTeams = normalizeUnique([...(entry.allowedTeams ?? []), ...(team ? [team] : [])]);

  entry.allowedRoles = nextRoles;
  entry.allowedAgents = nextAgents;
  entry.allowedTeams = nextTeams;
  entry.updatedAt = new Date().toISOString();
  saveServiceKeys(store);

  recordSecretAudit({
    actorId: params.actorId,
    actorRole: params.actorRole,
    actorTeam: params.actorTeam,
    action: "grant",
    secretId: entry.id,
    secretVariable: entry.variable,
    secretName: entry.name,
    source: "service-keys.json",
    result: "success",
    newValueHash: hashSecretValue(
      JSON.stringify({
        allowedRoles: nextRoles,
        allowedAgents: nextAgents,
        allowedTeams: nextTeams,
      }),
    ),
    sessionKey: params.sessionKey,
  });

  return { updated: true };
}

export function revokeServiceKeyAccess(params: {
  variable: string;
  role?: string;
  agent?: string;
  team?: string;
  actorId?: string;
  actorRole?: string;
  actorTeam?: string;
  sessionKey?: string;
}): { updated: boolean; reason?: string } {
  const role = params.role?.trim().toLowerCase();
  const agent = params.agent?.trim().toLowerCase();
  const team = params.team?.trim().toLowerCase();
  if (!role && !agent && !team) {
    return { updated: false, reason: "Specify at least one of role, agent, or team." };
  }

  const store = readServiceKeys();
  const entry = store.keys.find((key) => key.variable === params.variable);
  if (!entry) return { updated: false, reason: `No key found for variable ${params.variable}` };

  const nextRoles = (entry.allowedRoles ?? []).filter(
    (value) => value.trim().toLowerCase() !== role,
  );
  const nextAgents = (entry.allowedAgents ?? []).filter(
    (value) => value.trim().toLowerCase() !== agent,
  );
  const nextTeams = (entry.allowedTeams ?? []).filter(
    (value) => value.trim().toLowerCase() !== team,
  );

  entry.allowedRoles = normalizeUnique(nextRoles);
  entry.allowedAgents = normalizeUnique(nextAgents);
  entry.allowedTeams = normalizeUnique(nextTeams);
  entry.updatedAt = new Date().toISOString();
  saveServiceKeys(store);

  recordSecretAudit({
    actorId: params.actorId,
    actorRole: params.actorRole,
    actorTeam: params.actorTeam,
    action: "revoke",
    secretId: entry.id,
    secretVariable: entry.variable,
    secretName: entry.name,
    source: "service-keys.json",
    result: "success",
    newValueHash: hashSecretValue(
      JSON.stringify({
        allowedRoles: entry.allowedRoles ?? [],
        allowedAgents: entry.allowedAgents ?? [],
        allowedTeams: entry.allowedTeams ?? [],
      }),
    ),
    sessionKey: params.sessionKey,
  });

  return { updated: true };
}

export async function queryServiceKeyAudit(query: SecretAuditQuery = {}) {
  return await querySecretAudit(query);
}

// ============================================================================
// Async PG-aware resolution
// ============================================================================

/**
 * Resolve a service key with PG fallback.
 *
 * Resolution order:
 *   1. PostgreSQL service_keys table (when PG is enabled)
 *   2. service-keys.json (dashboard-managed)
 *   3. process.env
 *   4. argent.json env.vars (legacy fallback; disabled by default)
 *
 * Use this in async contexts where PG is available.
 * The sync `resolveServiceKey` remains for backward compatibility.
 */
export async function resolveServiceKeyAsync(
  envName: string,
  cfg?: ArgentConfig,
  context?: ServiceKeyAccessContext,
): Promise<string | undefined> {
  // 1. Try PG if available
  try {
    const { isPostgresEnabled } = await import("../data/storage-config.js");
    const { resolveRuntimeStorageConfig } = await import("../data/storage-resolver.js");
    const storageConfig = resolveRuntimeStorageConfig();
    if (isPostgresEnabled(storageConfig) && storageConfig.postgres) {
      const { getPgClient } = await import("../data/pg-client.js");
      const { pgGetServiceKeyByVariable } = await import("./pg-secret-store.js");
      const sql = getPgClient(storageConfig.postgres);
      const pgEntry = await pgGetServiceKeyByVariable(sql, envName);
      if (pgEntry && pgEntry.enabled) {
        const policyEntry: ServiceKeyEntry = {
          id: pgEntry.id,
          name: pgEntry.name,
          variable: pgEntry.variable,
          value: "",
          enabled: pgEntry.enabled,
          allowedRoles: pgEntry.allowedRoles,
          allowedAgents: pgEntry.allowedAgents,
          allowedTeams: pgEntry.allowedTeams,
          denyAll: pgEntry.denyAll,
        };
        const access = evaluateServiceKeyAccess(policyEntry, context, cfg);
        if (!access.allowed) {
          auditSecretFetch({
            entry: policyEntry,
            envName,
            result: "denied",
            reason: access.reason,
            source: "postgres",
            context,
            cfg,
          });
          return undefined;
        }
        auditSecretFetch({
          entry: policyEntry,
          envName,
          result: "success",
          source: "postgres",
          context,
          cfg,
        });
        return pgEntry.value;
      }
    }
  } catch {
    // PG not available — fall through to file-based
  }

  // 2-4. Fall back to sync resolution
  return resolveServiceKey(envName, cfg, context);
}

/**
 * Migrate all service keys from JSON to PG.
 * Call during setup or via `argent secrets migrate`.
 */
export async function migrateServiceKeysToPg(): Promise<{
  migrated: number;
  skipped: number;
  error?: string;
}> {
  try {
    const { isPostgresEnabled } = await import("../data/storage-config.js");
    const { resolveRuntimeStorageConfig } = await import("../data/storage-resolver.js");
    const storageConfig = resolveRuntimeStorageConfig();
    if (!isPostgresEnabled(storageConfig) || !storageConfig.postgres) {
      return { migrated: 0, skipped: 0, error: "PostgreSQL not configured" };
    }

    const { getPgClient } = await import("../data/pg-client.js");
    const { migrateSecretsToPg } = await import("./pg-secret-store.js");
    const { resolveAuthStorePath } = await import("../agents/auth-profiles/paths.js");

    const sql = getPgClient(storageConfig.postgres);
    const result = await migrateSecretsToPg(sql, {
      serviceKeysPath: SERVICE_KEYS_PATH,
      authProfilesPath: resolveAuthStorePath(),
    });

    return {
      migrated: result.serviceKeys.migrated + result.authCredentials.migrated,
      skipped: result.serviceKeys.skipped + result.authCredentials.skipped,
    };
  } catch (err) {
    return {
      migrated: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
