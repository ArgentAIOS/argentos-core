/**
 * Storage Factory — Creates the correct StorageAdapter based on config.
 *
 * Reads the storage config from argent.json and returns:
 *   - SQLiteAdapter when backend is "sqlite" (default)
 *   - DualAdapter when backend is "dual"
 *   - PgAdapter when backend is "postgres"
 *
 * Usage:
 *   const adapter = await getStorageAdapter();
 *   await adapter.memory.createItem({ ... });
 */

import type { MemoryAdapter, StorageAdapter } from "./adapter.js";
import type { StorageConfig } from "./storage-config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { DualAdapter } from "./dual-adapter.js";
import { SQLiteAdapter } from "./sqlite-adapter.js";
import { resolveStorageConfig, isPostgresEnabled } from "./storage-config.js";
import { readStorageConfigFromDisk } from "./storage-resolver.js";

const log = createSubsystemLogger("data/storage-factory");

let _adapter: StorageAdapter | null = null;
let _pgMemory: MemoryAdapter | null = null;

function shouldFailClosedStorage(config: StorageConfig): boolean {
  if (process.env.ARGENT_STORAGE_FAIL_OPEN === "1") return false;
  if (process.env.ARGENT_STORAGE_FAIL_CLOSED === "1") return true;
  if (config.backend === "postgres") return true;
  return config.backend === "dual" && config.readFrom === "postgres";
}

/**
 * Get or create the global StorageAdapter singleton.
 *
 * On first call, reads config and creates the appropriate adapter.
 * Subsequent calls return the same instance.
 *
 * @param overrideConfig - Override config for testing. Normally reads from argent.json.
 */
export async function getStorageAdapter(
  overrideConfig?: Partial<StorageConfig>,
): Promise<StorageAdapter> {
  if (_adapter?.isReady()) return _adapter;

  const config = resolveStorageConfig(overrideConfig ?? loadStorageConfigFromFile());

  log.info("creating storage adapter", {
    backend: config.backend,
    readFrom: config.readFrom,
    writeTo: config.writeTo,
  });

  switch (config.backend) {
    case "sqlite":
      _adapter = await createSQLiteAdapter();
      break;

    case "dual": {
      if (!isPostgresEnabled(config)) {
        log.warn("dual mode requested but postgres not configured, falling back to sqlite");
        _adapter = await createSQLiteAdapter();
        break;
      }
      try {
        const sqlite = await createSQLiteAdapter();
        const pg = await createPgAdapter(config);
        _pgMemory = pg.memory;
        _adapter = new DualAdapter(config, sqlite, pg);
        await _adapter.init();
      } catch (err) {
        const failClosed = shouldFailClosedStorage(config);
        const errorText = err instanceof Error ? err.message : String(err);
        if (failClosed) {
          log.error("dual mode pg init failed (fail-closed active)", {
            error: errorText,
          });
          throw new Error(`Storage initialization failed in dual mode: ${errorText}`);
        }
        // Availability-first fallback: keep the system communicative if PG is down.
        log.error("dual mode pg init failed, falling back to sqlite (fail-open)", {
          error: err instanceof Error ? err.message : String(err),
        });
        _adapter = await createSQLiteAdapter();
        _pgMemory = null;
      }
      break;
    }

    case "postgres": {
      if (!isPostgresEnabled(config)) {
        log.error("postgres mode requested but postgres not configured");
        throw new Error("StorageConfig: backend is 'postgres' but no postgres config provided");
      }
      try {
        _adapter = await createPgAdapter(config);
        _pgMemory = _adapter.memory;
      } catch (err) {
        const failClosed = shouldFailClosedStorage(config);
        const errorText = err instanceof Error ? err.message : String(err);
        if (failClosed) {
          log.error("postgres mode init failed (fail-closed active)", {
            error: errorText,
          });
          throw new Error(`Storage initialization failed in postgres mode: ${errorText}`);
        }
        // Cold-backup failover path when explicitly fail-open.
        log.error("postgres mode init failed, falling back to sqlite (fail-open)", {
          error: err instanceof Error ? err.message : String(err),
        });
        _adapter = await createSQLiteAdapter();
        _pgMemory = null;
      }
      break;
    }

    default:
      log.warn(`unknown backend "${config.backend}", falling back to sqlite`);
      _adapter = await createSQLiteAdapter();
  }

  return _adapter;
}

/**
 * Close and destroy the global adapter.
 * Call during graceful shutdown.
 */
export async function closeStorageAdapter(): Promise<void> {
  if (_adapter) {
    await _adapter.close();
    _adapter = null;
    log.info("storage adapter closed");
  }
}

/**
 * Check if the storage adapter is currently initialized.
 */
export function isStorageAdapterReady(): boolean {
  return _adapter?.isReady() ?? false;
}

/**
 * Get the raw PG MemoryAdapter (not wrapped by DualAdapter).
 * Used by the PG write mirror to avoid double-writing to SQLite.
 * Returns null if PG is not configured or not initialized.
 */
export function getPgMemoryAdapter(): MemoryAdapter | null {
  return _pgMemory;
}

/**
 * Get the in-memory initialized StorageAdapter without creating a new one.
 * Useful in synchronous paths that cannot await initialization.
 */
export function getInitializedStorageAdapter(): StorageAdapter | null {
  return _adapter;
}

/**
 * Get the in-memory initialized MemoryAdapter without creating a new one.
 * Useful in synchronous paths that should honor current storage mode once initialized.
 */
export function getInitializedMemoryAdapter(): MemoryAdapter | null {
  return _adapter?.memory ?? null;
}

/**
 * Convenience: resolve the MemoryAdapter from the storage factory.
 * Use this instead of getMemuStore() for all memory operations.
 */
export async function getMemoryAdapter(): Promise<MemoryAdapter> {
  const storage = await getStorageAdapter();
  return storage.memory;
}

// ── Internal Helpers ─────────────────────────────────────────────────────

async function createSQLiteAdapter(): Promise<StorageAdapter> {
  // Lazy import to avoid pulling in MemU/DataAPI unless needed
  const { getMemuStore } = await import("../memory/memu-store.js");
  const { getDataAPI } = await import("./index.js");

  const store = getMemuStore();
  const dataApi = await getDataAPI();

  // Access internal modules from DataAPI
  const tasksModule = dataApi.tasks;
  const teamsModule = dataApi.teams;

  const adapter = new SQLiteAdapter(store, tasksModule, teamsModule);
  await adapter.init();
  return adapter;
}

async function createPgAdapter(config: StorageConfig): Promise<StorageAdapter> {
  if (!config.postgres) {
    throw new Error("StorageConfig: postgres config is required for PG adapter");
  }
  let PgAdapter: new (postgres: NonNullable<StorageConfig["postgres"]>) => StorageAdapter;
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<{
      PgAdapter: new (postgres: NonNullable<StorageConfig["postgres"]>) => StorageAdapter;
    }>;
    ({ PgAdapter } = await dynamicImport("./pg-adapter.js"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PostgreSQL adapter unavailable: ${message}`);
  }
  try {
    const adapter = new PgAdapter(config.postgres);
    await adapter.init();
    return adapter;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PostgreSQL adapter unavailable: ${message}`);
  }
}

/**
 * Load storage config from ~/.argentos/argent.json.
 * Returns undefined if file doesn't exist or has no storage key.
 */
function loadStorageConfigFromFile(): Partial<StorageConfig> | undefined {
  try {
    return readStorageConfigFromDisk(process.env);
  } catch {
    return undefined;
  }
}
