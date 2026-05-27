// Shared singleton postgres connection used by surfaces that need to
// read or mutate workflow tables outside the RPC gateway (e.g. the
// Telegram inline-button callback handler in src/telegram/bot-handlers.ts).
// The gateway path (src/gateway/server-methods/workflows.ts) has its own
// private getSql that this file replaces; both surfaces now share a single
// pool to avoid duplicate connections and divergent retry behavior.

import postgres from "postgres";
import { resolvePostgresUrl, resolveRuntimeStorageConfig } from "../data/storage-resolver.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("workflow/pg-client");

let _sql: ReturnType<typeof postgres> | null = null;
let _initPromise: Promise<ReturnType<typeof postgres>> | null = null;

function isPgBacked(env: NodeJS.ProcessEnv = process.env): boolean {
  const cfg = resolveRuntimeStorageConfig(env);
  return cfg.backend === "postgres" || cfg.backend === "dual";
}

export async function getWorkflowSql(): Promise<ReturnType<typeof postgres>> {
  if (_sql) {
    return _sql;
  }
  if (_initPromise) {
    return _initPromise;
  }

  _initPromise = (async () => {
    if (!isPgBacked()) {
      throw new Error("Workflows require PostgreSQL backend");
    }
    const connectionString = resolvePostgresUrl();
    const sql = postgres(connectionString, {
      max: 3,
      idle_timeout: 10,
      connect_timeout: 5,
      prepare: false,
    });
    try {
      await sql`SELECT 1`;
      _sql = sql;
      log.info("workflow PG connection established");
      return sql;
    } catch (err) {
      log.warn(`workflow PG init failed: ${String(err)}`);
      _initPromise = null;
      throw err;
    }
  })();

  return _initPromise;
}

export async function closeWorkflowSql(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
    _initPromise = null;
  }
}
