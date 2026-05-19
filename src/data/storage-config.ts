/**
 * Storage Configuration — Feature flags for database backend selection.
 *
 * Controls whether ArgentOS uses SQLite, PostgreSQL, or dual-write mode.
 * Config lives in ~/.argentos/argent.json under the "storage" key.
 *
 * Progression during migration:
 *   1. backend: "sqlite"                         — current default, no change
 *   2. backend: "dual", readFrom: "sqlite"       — both get writes, SQLite reads
 *   3. backend: "dual", readFrom: "postgres"     — both get writes, PG reads
 *   4. backend: "postgres"                       — PG only, SQLite deprecated
 */

export type StorageBackend = "sqlite" | "postgres" | "dual";

export interface PostgresConfig {
  /** Connection string, e.g. "postgres://localhost:5432/argentos" */
  connectionString: string;
  /** Max connections in pool (postgres.js manages this) */
  maxConnections?: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  /** Optional password */
  password?: string;
  /** Database index (0-15) */
  db?: number;
}

export interface StorageConfig {
  /** Which backend(s) to use */
  backend: StorageBackend;
  /** In dual mode: which backend serves reads */
  readFrom: "sqlite" | "postgres";
  /** In dual mode: which backends receive writes */
  writeTo: ("sqlite" | "postgres")[];
  /** PostgreSQL connection config (required when backend includes postgres) */
  postgres: PostgresConfig | null;
  /** Redis config (optional — enables hot cache, presence, streams) */
  redis: RedisConfig | null;
}

/**
 * ArgentOS uses non-default ports to avoid conflicts with other services:
 *   PostgreSQL: 5433 (default is 5432)
 *   Redis:      6380 (default is 6379)
 */
export const ARGENT_PG_PORT = 5433;
export const ARGENT_REDIS_PORT = 6380;

/** Default config — pure SQLite, no PG or Redis */
export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  backend: "sqlite",
  readFrom: "sqlite",
  writeTo: ["sqlite"],
  postgres: null,
  redis: null,
};

/**
 * Resolve storage config from argent.json.
 * Falls back to SQLite-only if no storage key is present.
 */
export function resolveStorageConfig(raw?: Partial<StorageConfig>): StorageConfig {
  if (!raw) return { ...DEFAULT_STORAGE_CONFIG };

  const backend = raw.backend ?? "sqlite";
  return {
    backend,
    readFrom: raw.readFrom ?? (backend === "postgres" ? "postgres" : "sqlite"),
    writeTo:
      raw.writeTo ??
      (backend === "dual"
        ? ["sqlite", "postgres"]
        : backend === "postgres"
          ? ["postgres"]
          : ["sqlite"]),
    postgres: raw.postgres ?? null,
    redis: raw.redis ?? null,
  };
}

/** Check if PostgreSQL is configured and should be active */
export function isPostgresEnabled(config: StorageConfig): boolean {
  return config.backend === "postgres" || (config.backend === "dual" && config.postgres !== null);
}

/** Check if Redis is configured */
export function isRedisEnabled(config: StorageConfig): boolean {
  return config.redis !== null;
}

/** Check if we should write to a specific backend */
export function shouldWriteTo(config: StorageConfig, target: "sqlite" | "postgres"): boolean {
  return config.writeTo.includes(target);
}

/** Check if we should read from a specific backend */
export function shouldReadFrom(config: StorageConfig, target: "sqlite" | "postgres"): boolean {
  return config.readFrom === target;
}

/**
 * True when runtime is configured for PostgreSQL-only IO and should avoid
 * legacy SQLite/DataAPI pathways.
 */
export function isStrictPostgresOnly(config: StorageConfig): boolean {
  return shouldReadFrom(config, "postgres") && !shouldWriteTo(config, "sqlite");
}
