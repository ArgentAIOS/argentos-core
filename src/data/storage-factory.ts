/**
 * Public Core override for storage-factory.ts.
 *
 * Keeps SQLite and dual-read behavior intact while avoiding a static bundle
 * dependency on pg-adapter, which is intentionally denied from public core.
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

type PgAdapterModule = {
  PgAdapter: new (config: NonNullable<StorageConfig["postgres"]>) => StorageAdapter;
};

async function loadPgAdapterModule(): Promise<PgAdapterModule> {
  const importer = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<unknown>;

  try {
    return (await importer("./pg-adapter.js")) as PgAdapterModule;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Postgres adapter is unavailable in this ArgentOS Core build: ${reason}`);
  }
}

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
        log.error("dual mode pg init failed, falling back to sqlite (fail-open)", {
          error: errorText,
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
        log.error("postgres mode init failed, falling back to sqlite (fail-open)", {
          error: errorText,
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

export async function closeStorageAdapter(): Promise<void> {
  if (_adapter) {
    await _adapter.close();
    _adapter = null;
    log.info("storage adapter closed");
  }
}

export function isStorageAdapterReady(): boolean {
  return _adapter?.isReady() ?? false;
}

export function getPgMemoryAdapter(): MemoryAdapter | null {
  return _pgMemory;
}

export function getInitializedStorageAdapter(): StorageAdapter | null {
  return _adapter;
}

export function getInitializedMemoryAdapter(): MemoryAdapter | null {
  return _adapter?.memory ?? null;
}

export async function getMemoryAdapter(): Promise<MemoryAdapter> {
  const storage = await getStorageAdapter();
  return storage.memory;
}

async function createSQLiteAdapter(): Promise<StorageAdapter> {
  const { getMemuStore } = await import("../memory/memu-store.js");
  const { getDataAPI } = await import("./index.js");

  const store = getMemuStore();
  const dataApi = await getDataAPI();
  const tasksModule = dataApi.tasks;
  const teamsModule = dataApi.teams;

  const adapter = new SQLiteAdapter(store, tasksModule, teamsModule);
  await adapter.init();
  return adapter;
}

async function createPgAdapter(config: StorageConfig): Promise<StorageAdapter> {
  const { PgAdapter } = await loadPgAdapterModule();

  if (!config.postgres) {
    throw new Error("StorageConfig: postgres config is required for PG adapter");
  }

  const adapter = new PgAdapter(config.postgres);
  await adapter.init();
  return adapter;
}

function loadStorageConfigFromFile(): Partial<StorageConfig> | undefined {
  try {
    return readStorageConfigFromDisk(process.env);
  } catch {
    return undefined;
  }
}
