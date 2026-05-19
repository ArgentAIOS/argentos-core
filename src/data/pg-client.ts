/**
 * PostgreSQL Client — postgres.js connection singleton.
 *
 * Uses postgres.js for lazy connection pooling, automatic prepared
 * statements, and native type handling (including pgvector).
 */

import postgres from "postgres";
import type { PostgresConfig } from "./storage-config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("data/postgres");

let _sql: ReturnType<typeof postgres> | null = null;

/**
 * Get or create the PostgreSQL connection pool.
 * postgres.js handles connection pooling internally with lazy connections.
 */
export function getPgClient(config: PostgresConfig): ReturnType<typeof postgres> {
  if (_sql) return _sql;

  // ArgentOS uses port 5433 (not default 5432) to avoid conflicts
  _sql = postgres(config.connectionString, {
    max: config.maxConnections ?? 10,
    idle_timeout: 30,
    connect_timeout: 10,
    // Transform column names from snake_case to camelCase
    transform: {
      column: {
        to: postgres.toCamel,
        from: postgres.fromCamel,
      },
    },
    types: {
      // Register pgvector type handler
      vector: {
        to: 1,
        from: [16535], // pgvector OID
        serialize: (v: number[]) => `[${v.join(",")}]`,
        parse: (v: string) => v.slice(1, -1).split(",").map(Number),
      },
    },
    onnotice: () => {}, // Suppress NOTICE messages
  });

  log.info("postgres: connection pool created", {
    connectionString: config.connectionString.replace(/\/\/.*@/, "//<redacted>@"),
    maxConnections: config.maxConnections ?? 10,
  });

  return _sql;
}

/**
 * Close the PostgreSQL connection pool.
 * Call during graceful shutdown.
 */
export async function closePgClient(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
    log.info("postgres: connection pool closed");
  }
}

/**
 * Set the agent_id session variable for RLS policies.
 * Must be called at the start of each request/operation.
 */
export async function setAgentContext(
  sql: ReturnType<typeof postgres>,
  agentId: string,
): Promise<void> {
  await sql`SELECT set_config('app.agent_id', ${agentId}, false)`;
}

/**
 * Health check — verify the connection is alive and pgvector is available.
 */
export async function pgHealthCheck(
  sql: ReturnType<typeof postgres>,
): Promise<{ ok: boolean; pgVersion?: string; pgvector?: boolean; error?: string }> {
  try {
    const [{ version }] = await sql`SELECT version()`;
    let pgvector = false;
    try {
      await sql`SELECT '[1,2,3]'::vector`;
      pgvector = true;
    } catch {
      // pgvector not installed
    }
    return { ok: true, pgVersion: version, pgvector };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
