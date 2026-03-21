/**
 * PostgreSQL Secret Store — Read/write encrypted secrets to PostgreSQL.
 *
 * This is the PG backend for service keys and auth credentials.
 * Values are encrypted with AES-256-GCM (master key from Keychain)
 * before storage — PG stores ciphertext, never plaintext.
 *
 * Used when storage backend includes "postgres" (dual or postgres mode).
 * Falls back gracefully to JSON files when PG is unavailable.
 */

import type postgres from "postgres";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { decryptSecret, encryptSecret } from "./secret-crypto.js";

const log = createSubsystemLogger("pg-secret-store");
let ensureServiceKeyPolicyColumnsPromise: Promise<void> | null = null;

export interface PgServiceKey {
  id: string;
  variable: string;
  name: string;
  value: string; // Decrypted plaintext
  service?: string;
  category?: string;
  enabled: boolean;
  source?: string;
  allowedRoles?: string[];
  allowedAgents?: string[];
  allowedTeams?: string[];
  denyAll?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PgServiceKeyRow {
  id: string;
  variable: string;
  name: string;
  encryptedValue?: string;
  encrypted_value?: string;
  service: string | null;
  category: string | null;
  enabled: boolean;
  source: string | null;
  allowedRoles?: string[] | null;
  allowed_roles?: string[] | null;
  allowedAgents?: string[] | null;
  allowed_agents?: string[] | null;
  allowedTeams?: string[] | null;
  allowed_teams?: string[] | null;
  denyAll?: boolean;
  deny_all?: boolean;
  createdAt?: Date;
  created_at?: Date;
  updatedAt?: Date;
  updated_at?: Date;
}

export interface PgAuthCredential {
  id: string;
  profileId: string;
  provider: string;
  credentialType: "api_key" | "oauth" | "token";
  payload: Record<string, unknown>; // Decrypted
  email?: string;
  enabled: boolean;
  lastUsedAt?: Date;
  cooldownUntil?: Date;
  errorCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface PgAuthCredentialRow {
  id: string;
  profileId?: string;
  profile_id?: string;
  provider: string;
  credentialType?: string;
  credential_type?: string;
  encryptedPayload?: string;
  encrypted_payload?: string;
  email: string | null;
  enabled: boolean;
  lastUsedAt?: Date | null;
  last_used_at?: Date | null;
  cooldownUntil?: Date | null;
  cooldown_until?: Date | null;
  errorCount?: number;
  error_count?: number;
  createdAt?: Date;
  created_at?: Date;
  updatedAt?: Date;
  updated_at?: Date;
}

// ============================================================================
// Service Keys
// ============================================================================

/**
 * List all service keys from PG (values decrypted).
 */
export async function pgListServiceKeys(sql: ReturnType<typeof postgres>): Promise<PgServiceKey[]> {
  await ensureServiceKeyPolicyColumns(sql);
  const rows = await sql<PgServiceKeyRow[]>`
    SELECT
      id,
      variable,
      name,
      encrypted_value AS "encryptedValue",
      service,
      category,
      enabled,
      source,
      allowed_roles AS "allowedRoles",
      allowed_agents AS "allowedAgents",
      allowed_teams AS "allowedTeams",
      deny_all AS "denyAll",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM service_keys
    ORDER BY variable
  `;
  return rows.map(decryptServiceKeyRow);
}

/**
 * Resolve a service key by variable name from PG.
 * Returns the decrypted value or undefined if not found/disabled.
 */
export async function pgResolveServiceKey(
  sql: ReturnType<typeof postgres>,
  variable: string,
): Promise<string | undefined> {
  const key = await pgGetServiceKeyByVariable(sql, variable);
  if (!key || !key.enabled) return undefined;
  return key.value;
}

export async function pgGetServiceKeyByVariable(
  sql: ReturnType<typeof postgres>,
  variable: string,
): Promise<PgServiceKey | undefined> {
  await ensureServiceKeyPolicyColumns(sql);
  const rows = await sql<PgServiceKeyRow[]>`
    SELECT
      id,
      variable,
      name,
      encrypted_value AS "encryptedValue",
      service,
      category,
      enabled,
      source,
      allowed_roles AS "allowedRoles",
      allowed_agents AS "allowedAgents",
      allowed_teams AS "allowedTeams",
      deny_all AS "denyAll",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM service_keys
    WHERE variable = ${variable}
    LIMIT 1
  `;
  if (rows.length === 0) return undefined;
  return decryptServiceKeyRow(rows[0]!);
}

/**
 * Upsert a service key into PG (value encrypted before storage).
 */
export async function pgUpsertServiceKey(
  sql: ReturnType<typeof postgres>,
  opts: {
    id?: string;
    variable: string;
    value: string; // Plaintext — will be encrypted
    name?: string;
    service?: string;
    category?: string;
    source?: string;
    allowedRoles?: string[];
    allowedAgents?: string[];
    allowedTeams?: string[];
    denyAll?: boolean;
  },
): Promise<{ action: "created" | "updated" }> {
  await ensureServiceKeyPolicyColumns(sql);
  const id = opts.id ?? `sk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const encrypted = encryptSecret(opts.value);
  const now = new Date();

  const result = await sql`
    INSERT INTO service_keys (
      id, variable, name, encrypted_value, service, category, source, enabled,
      allowed_roles, allowed_agents, allowed_teams, deny_all,
      created_at, updated_at
    )
    VALUES (
      ${id},
      ${opts.variable},
      ${opts.name ?? opts.variable},
      ${encrypted},
      ${opts.service ?? null},
      ${opts.category ?? null},
      ${opts.source ?? "manual"},
      true,
      ${opts.allowedRoles ?? []},
      ${opts.allowedAgents ?? []},
      ${opts.allowedTeams ?? []},
      ${opts.denyAll === true},
      ${now},
      ${now}
    )
    ON CONFLICT (variable) DO UPDATE SET
      encrypted_value = ${encrypted},
      name = COALESCE(${opts.name ?? null}, service_keys.name),
      service = COALESCE(${opts.service ?? null}, service_keys.service),
      category = COALESCE(${opts.category ?? null}, service_keys.category),
      allowed_roles = COALESCE(${opts.allowedRoles ?? null}, service_keys.allowed_roles),
      allowed_agents = COALESCE(${opts.allowedAgents ?? null}, service_keys.allowed_agents),
      allowed_teams = COALESCE(${opts.allowedTeams ?? null}, service_keys.allowed_teams),
      deny_all = COALESCE(${opts.denyAll ?? null}, service_keys.deny_all),
      enabled = true,
      updated_at = ${now}
    RETURNING (xmax = 0) AS inserted
  `;

  const inserted = result[0]?.inserted;
  const action = inserted ? "created" : "updated";
  log.info("pg upserted service key", { variable: opts.variable, action });
  return { action };
}

/**
 * Delete a service key from PG by variable name.
 */
export async function pgDeleteServiceKey(
  sql: ReturnType<typeof postgres>,
  variable: string,
): Promise<boolean> {
  const result = await sql`DELETE FROM service_keys WHERE variable = ${variable}`;
  return result.count > 0;
}

// ============================================================================
// Auth Credentials
// ============================================================================

/**
 * List all auth credentials from PG (payloads decrypted).
 */
export async function pgListAuthCredentials(
  sql: ReturnType<typeof postgres>,
): Promise<PgAuthCredential[]> {
  const rows = await sql<PgAuthCredentialRow[]>`
    SELECT id, profile_id, provider, credential_type, encrypted_payload, email, enabled, last_used_at, cooldown_until, error_count, created_at, updated_at
    FROM auth_credentials
    ORDER BY provider, profile_id
  `;
  return rows.map(decryptAuthRow);
}

/**
 * Get a single auth credential by profile ID.
 */
export async function pgGetAuthCredential(
  sql: ReturnType<typeof postgres>,
  profileId: string,
): Promise<PgAuthCredential | undefined> {
  const rows = await sql<PgAuthCredentialRow[]>`
    SELECT id, profile_id, provider, credential_type, encrypted_payload, email, enabled, last_used_at, cooldown_until, error_count, created_at, updated_at
    FROM auth_credentials
    WHERE profile_id = ${profileId} AND enabled = true
    LIMIT 1
  `;
  if (rows.length === 0) return undefined;
  return decryptAuthRow(rows[0]!);
}

/**
 * Upsert an auth credential into PG (payload encrypted before storage).
 */
export async function pgUpsertAuthCredential(
  sql: ReturnType<typeof postgres>,
  opts: {
    profileId: string;
    provider: string;
    credentialType: "api_key" | "oauth" | "token";
    payload: Record<string, unknown>; // Plaintext — will be encrypted
    email?: string;
  },
): Promise<{ action: "created" | "updated" }> {
  const id = `ac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const encrypted = encryptSecret(JSON.stringify(opts.payload));
  const now = new Date();

  const result = await sql`
    INSERT INTO auth_credentials (id, profile_id, provider, credential_type, encrypted_payload, email, enabled, error_count, created_at, updated_at)
    VALUES (${id}, ${opts.profileId}, ${opts.provider}, ${opts.credentialType}, ${encrypted}, ${opts.email ?? null}, true, 0, ${now}, ${now})
    ON CONFLICT (profile_id) DO UPDATE SET
      encrypted_payload = ${encrypted},
      provider = ${opts.provider},
      credential_type = ${opts.credentialType},
      email = COALESCE(${opts.email ?? null}, auth_credentials.email),
      enabled = true,
      updated_at = ${now}
    RETURNING (xmax = 0) AS inserted
  `;

  const inserted = result[0]?.inserted;
  return { action: inserted ? "created" : "updated" };
}

/**
 * Delete an auth credential from PG by profile ID.
 */
export async function pgDeleteAuthCredential(
  sql: ReturnType<typeof postgres>,
  profileId: string,
): Promise<boolean> {
  const result = await sql`DELETE FROM auth_credentials WHERE profile_id = ${profileId}`;
  return result.count > 0;
}

// ============================================================================
// Migration: JSON → PG
// ============================================================================

export interface MigrationResult {
  serviceKeys: { migrated: number; skipped: number };
  authCredentials: { migrated: number; skipped: number };
}

/**
 * Migrate all secrets from JSON files to PostgreSQL.
 *
 * Reads service-keys.json and auth-profiles.json, encrypts values
 * (or re-encrypts if already encrypted with same master key), and
 * upserts into PG tables. Existing PG entries are updated.
 */
export async function migrateSecretsToPg(
  sql: ReturnType<typeof postgres>,
  opts: {
    serviceKeysPath: string;
    authProfilesPath: string;
  },
): Promise<MigrationResult> {
  const fs = await import("node:fs");
  const result: MigrationResult = {
    serviceKeys: { migrated: 0, skipped: 0 },
    authCredentials: { migrated: 0, skipped: 0 },
  };

  // Migrate service keys
  try {
    if (fs.existsSync(opts.serviceKeysPath)) {
      const raw = JSON.parse(fs.readFileSync(opts.serviceKeysPath, "utf-8"));
      for (const entry of raw.keys ?? []) {
        if (!entry.variable || !entry.value) {
          result.serviceKeys.skipped++;
          continue;
        }
        // Decrypt if encrypted, then re-encrypt for PG
        const plaintext = decryptSecret(entry.value);
        await pgUpsertServiceKey(sql, {
          id: entry.id,
          variable: entry.variable,
          value: plaintext,
          name: entry.name,
          service: entry.service,
          category: entry.category,
          source: entry.source,
          allowedRoles: Array.isArray(entry.allowedRoles) ? entry.allowedRoles : undefined,
          allowedAgents: Array.isArray(entry.allowedAgents) ? entry.allowedAgents : undefined,
          allowedTeams: Array.isArray(entry.allowedTeams) ? entry.allowedTeams : undefined,
          denyAll: entry.denyAll === true,
        });
        result.serviceKeys.migrated++;
      }
      log.info("migrated service keys to PG", result.serviceKeys);
    }
  } catch (err) {
    log.warn("failed to migrate service keys", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Migrate auth credentials
  try {
    if (fs.existsSync(opts.authProfilesPath)) {
      const raw = JSON.parse(fs.readFileSync(opts.authProfilesPath, "utf-8"));
      for (const [profileId, cred] of Object.entries(raw.profiles ?? {})) {
        const credential = cred as Record<string, unknown>;
        if (!credential.type || !credential.provider) {
          result.authCredentials.skipped++;
          continue;
        }
        await pgUpsertAuthCredential(sql, {
          profileId,
          provider: credential.provider as string,
          credentialType: credential.type as "api_key" | "oauth" | "token",
          payload: credential,
          email: credential.email as string | undefined,
        });
        result.authCredentials.migrated++;
      }
      log.info("migrated auth credentials to PG", result.authCredentials);
    }
  } catch (err) {
    log.warn("failed to migrate auth credentials", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}

// ============================================================================
// Internal helpers
// ============================================================================

function decryptServiceKeyRow(row: PgServiceKeyRow): PgServiceKey {
  const encryptedValue = row.encryptedValue ?? row.encrypted_value;
  return {
    id: row.id,
    variable: row.variable,
    name: row.name,
    value: decryptSecret(encryptedValue),
    service: row.service ?? undefined,
    category: row.category ?? undefined,
    enabled: row.enabled,
    source: row.source ?? undefined,
    allowedRoles: Array.isArray(row.allowedRoles ?? row.allowed_roles)
      ? (row.allowedRoles ?? row.allowed_roles)
      : undefined,
    allowedAgents: Array.isArray(row.allowedAgents ?? row.allowed_agents)
      ? (row.allowedAgents ?? row.allowed_agents)
      : undefined,
    allowedTeams: Array.isArray(row.allowedTeams ?? row.allowed_teams)
      ? (row.allowedTeams ?? row.allowed_teams)
      : undefined,
    denyAll: (row.denyAll ?? row.deny_all) === true,
    createdAt: (row.createdAt ?? row.created_at ?? new Date()) as Date,
    updatedAt: (row.updatedAt ?? row.updated_at ?? new Date()) as Date,
  };
}

async function ensureServiceKeyPolicyColumns(sql: ReturnType<typeof postgres>): Promise<void> {
  if (!ensureServiceKeyPolicyColumnsPromise) {
    ensureServiceKeyPolicyColumnsPromise = (async () => {
      try {
        await sql`ALTER TABLE service_keys ADD COLUMN IF NOT EXISTS allowed_roles TEXT[] DEFAULT '{}'::text[]`;
        await sql`ALTER TABLE service_keys ADD COLUMN IF NOT EXISTS allowed_agents TEXT[] DEFAULT '{}'::text[]`;
        await sql`ALTER TABLE service_keys ADD COLUMN IF NOT EXISTS allowed_teams TEXT[] DEFAULT '{}'::text[]`;
        await sql`ALTER TABLE service_keys ADD COLUMN IF NOT EXISTS deny_all BOOLEAN NOT NULL DEFAULT false`;
      } catch (err) {
        log.warn("failed to ensure service_keys policy columns", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }
  await ensureServiceKeyPolicyColumnsPromise;
}

function decryptAuthRow(row: PgAuthCredentialRow): PgAuthCredential {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(decryptSecret(row.encryptedPayload ?? row.encrypted_payload));
  } catch {
    log.warn("failed to decrypt auth credential", { profileId: row.profileId ?? row.profile_id });
  }
  return {
    id: row.id,
    profileId: row.profileId ?? row.profile_id ?? "",
    provider: row.provider,
    credentialType: (row.credentialType ?? row.credential_type ?? "api_key") as
      | "api_key"
      | "oauth"
      | "token",
    payload,
    email: row.email ?? undefined,
    enabled: row.enabled,
    lastUsedAt: row.lastUsedAt ?? row.last_used_at ?? undefined,
    cooldownUntil: row.cooldownUntil ?? row.cooldown_until ?? undefined,
    errorCount: row.errorCount ?? row.error_count ?? 0,
    createdAt: row.createdAt ?? row.created_at ?? new Date(),
    updatedAt: row.updatedAt ?? row.updated_at ?? new Date(),
  };
}
