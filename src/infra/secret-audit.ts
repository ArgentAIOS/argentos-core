import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("secret-audit");
const AUDIT_LOG_PATH = path.join(process.env.HOME ?? "/tmp", ".argentos", "secret-audit.jsonl");

export type SecretAuditAction =
  | "fetch"
  | "denied"
  | "create"
  | "update"
  | "delete"
  | "grant"
  | "revoke"
  | "rotate";

export interface SecretAuditRecord {
  id: string;
  timestamp: string;
  actorId?: string;
  actorRole?: string;
  actorTeam?: string;
  action: SecretAuditAction;
  secretId?: string;
  secretVariable: string;
  secretName?: string;
  source?: string;
  result: "success" | "denied" | "error";
  denialReason?: string;
  oldValueHash?: string;
  newValueHash?: string;
  sessionKey?: string;
  ipAddress?: string;
}

export interface SecretAuditQuery {
  secretVariable?: string;
  actorId?: string;
  result?: SecretAuditRecord["result"];
  action?: SecretAuditRecord["action"];
  limit?: number;
}

let ensurePgAuditTablePromise: Promise<boolean> | null = null;

export function hashSecretValue(value: string | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return undefined;
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function recordSecretAudit(input: Omit<SecretAuditRecord, "id" | "timestamp">): void {
  const entry: SecretAuditRecord = {
    id: `sa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    ...input,
  };

  appendLocalAudit(entry);
  void appendPgAudit(entry).catch((err) => {
    log.warn("failed to append pg audit entry", {
      error: err instanceof Error ? err.message : String(err),
      action: entry.action,
      secretVariable: entry.secretVariable,
    });
  });
}

export async function querySecretAudit(query: SecretAuditQuery = {}): Promise<SecretAuditRecord[]> {
  const fromPg = await queryAuditFromPg(query);
  if (fromPg.length > 0) return fromPg;
  return queryAuditFromFile(query);
}

function appendLocalAudit(entry: SecretAuditRecord): void {
  try {
    const dir = path.dirname(AUDIT_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
    try {
      fs.chmodSync(AUDIT_LOG_PATH, 0o600);
    } catch {
      // best effort only
    }
  } catch (err) {
    log.warn("failed to append local audit entry", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function appendPgAudit(entry: SecretAuditRecord): Promise<void> {
  const sql = await getPgClientIfEnabled();
  if (!sql) return;
  const ensured = await ensurePgAuditTable(sql);
  if (!ensured) return;
  await sql`
    INSERT INTO argent_secret_audit (
      id, timestamp, actor_id, actor_role, actor_team, action,
      secret_id, secret_variable, secret_name, source, result, denial_reason,
      old_value_hash, new_value_hash, session_key, ip_address
    ) VALUES (
      ${entry.id},
      ${entry.timestamp},
      ${entry.actorId ?? null},
      ${entry.actorRole ?? null},
      ${entry.actorTeam ?? null},
      ${entry.action},
      ${entry.secretId ?? null},
      ${entry.secretVariable},
      ${entry.secretName ?? null},
      ${entry.source ?? null},
      ${entry.result},
      ${entry.denialReason ?? null},
      ${entry.oldValueHash ?? null},
      ${entry.newValueHash ?? null},
      ${entry.sessionKey ?? null},
      ${entry.ipAddress ?? null}
    )
  `;
}

async function queryAuditFromPg(query: SecretAuditQuery): Promise<SecretAuditRecord[]> {
  try {
    const sql = await getPgClientIfEnabled();
    if (!sql) return [];
    const ensured = await ensurePgAuditTable(sql);
    if (!ensured) return [];
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const rows = await sql<
      Array<{
        id: string;
        timestamp: string | Date;
        actor_id: string | null;
        actor_role: string | null;
        actor_team: string | null;
        action: SecretAuditAction;
        secret_id: string | null;
        secret_variable: string;
        secret_name: string | null;
        source: string | null;
        result: "success" | "denied" | "error";
        denial_reason: string | null;
        old_value_hash: string | null;
        new_value_hash: string | null;
        session_key: string | null;
        ip_address: string | null;
      }>
    >`
      SELECT
        id, timestamp, actor_id, actor_role, actor_team, action,
        secret_id, secret_variable, secret_name, source, result, denial_reason,
        old_value_hash, new_value_hash, session_key, ip_address
      FROM argent_secret_audit
      ORDER BY timestamp DESC
      LIMIT ${Math.min(limit * 5, 5000)}
    `;

    const filtered = rows
      .map((row) => ({
        id: row.id,
        timestamp:
          row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp ?? ""),
        actorId: row.actor_id ?? undefined,
        actorRole: row.actor_role ?? undefined,
        actorTeam: row.actor_team ?? undefined,
        action: row.action,
        secretId: row.secret_id ?? undefined,
        secretVariable: row.secret_variable,
        secretName: row.secret_name ?? undefined,
        source: row.source ?? undefined,
        result: row.result,
        denialReason: row.denial_reason ?? undefined,
        oldValueHash: row.old_value_hash ?? undefined,
        newValueHash: row.new_value_hash ?? undefined,
        sessionKey: row.session_key ?? undefined,
        ipAddress: row.ip_address ?? undefined,
      }))
      .filter((row) => matchAuditQuery(row, query))
      .slice(0, limit);
    return filtered;
  } catch {
    return [];
  }
}

function queryAuditFromFile(query: SecretAuditQuery): SecretAuditRecord[] {
  try {
    if (!fs.existsSync(AUDIT_LOG_PATH)) return [];
    const lines = fs
      .readFileSync(AUDIT_LOG_PATH, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const out: SecretAuditRecord[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
      try {
        const parsed = JSON.parse(lines[i]!) as SecretAuditRecord;
        if (matchAuditQuery(parsed, query)) {
          out.push(parsed);
        }
      } catch {
        // Ignore invalid line.
      }
    }
    return out;
  } catch {
    return [];
  }
}

function matchAuditQuery(row: SecretAuditRecord, query: SecretAuditQuery): boolean {
  if (query.secretVariable && row.secretVariable !== query.secretVariable) return false;
  if (query.actorId && row.actorId !== query.actorId) return false;
  if (query.result && row.result !== query.result) return false;
  if (query.action && row.action !== query.action) return false;
  return true;
}

async function ensurePgAuditTable(sql: any): Promise<boolean> {
  if (!ensurePgAuditTablePromise) {
    ensurePgAuditTablePromise = (async () => {
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS argent_secret_audit (
            id TEXT PRIMARY KEY,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            actor_id TEXT,
            actor_role TEXT,
            actor_team TEXT,
            action TEXT NOT NULL,
            secret_id TEXT,
            secret_variable TEXT NOT NULL,
            secret_name TEXT,
            source TEXT,
            result TEXT NOT NULL,
            denial_reason TEXT,
            old_value_hash TEXT,
            new_value_hash TEXT,
            session_key TEXT,
            ip_address TEXT
          )
        `;
        await sql`
          CREATE INDEX IF NOT EXISTS idx_argent_secret_audit_secret_ts
          ON argent_secret_audit (secret_variable, timestamp DESC)
        `;
        await sql`
          CREATE INDEX IF NOT EXISTS idx_argent_secret_audit_actor_ts
          ON argent_secret_audit (actor_id, timestamp DESC)
        `;
        return true;
      } catch {
        return false;
      }
    })();
  }
  return await ensurePgAuditTablePromise;
}

async function getPgClientIfEnabled(): Promise<any | null> {
  try {
    const { isPostgresEnabled } = await import("../data/storage-config.js");
    const { resolveRuntimeStorageConfig } = await import("../data/storage-resolver.js");
    const cfg = resolveRuntimeStorageConfig();
    if (!isPostgresEnabled(cfg) || !cfg.postgres) return null;
    const { getPgClient } = await import("../data/pg-client.js");
    return getPgClient(cfg.postgres);
  } catch {
    return null;
  }
}
