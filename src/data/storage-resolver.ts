/**
 * Storage Resolver — canonical runtime/storage location resolution.
 *
 * Single source of truth for:
 * - reading storage config from argent.json
 * - resolving PostgreSQL connection string
 * - resolving Redis config
 */

import fs from "node:fs";
import type { RedisConfig, StorageConfig } from "./storage-config.js";
import { resolveConfigPathCandidate } from "../config/paths.js";
import { ARGENT_PG_PORT, resolveStorageConfig } from "./storage-config.js";

export const DEFAULT_PG_URL = `postgres://localhost:${ARGENT_PG_PORT}/argentos`;

/**
 * Read raw storage config from the active argent.json path.
 * Returns undefined when config file or storage block is missing.
 */
export function readStorageConfigFromDisk(
  env: NodeJS.ProcessEnv = process.env,
): Partial<StorageConfig> | undefined {
  try {
    const configPath = resolveConfigPathCandidate(env);
    if (!fs.existsSync(configPath)) return undefined;
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return raw?.storage ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve full storage config from disk with defaults applied.
 */
export function resolveRuntimeStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
  override?: Partial<StorageConfig>,
): StorageConfig {
  return resolveStorageConfig(override ?? readStorageConfigFromDisk(env));
}

/**
 * Resolve PostgreSQL URL with stable precedence:
 *   1) explicit
 *   2) ARGENT_PG_URL / PG_URL
 *   3) argent.json storage.postgres.connectionString
 *   4) default localhost:5433/argentos
 */
export function resolvePostgresUrl(options?: {
  explicit?: string | null;
  env?: NodeJS.ProcessEnv;
  storage?: Partial<StorageConfig>;
  fallback?: string;
}): string {
  const env = options?.env ?? process.env;
  const explicit = options?.explicit?.trim();
  if (explicit) return explicit;

  const fromEnv = env.ARGENT_PG_URL?.trim() || env.PG_URL?.trim();
  if (fromEnv) return fromEnv;

  const storage =
    options?.storage ?? readStorageConfigFromDisk(env) ?? ({} as Partial<StorageConfig>);
  const fromConfig = storage.postgres?.connectionString?.trim();
  if (fromConfig) return fromConfig;

  return options?.fallback ?? DEFAULT_PG_URL;
}

/**
 * Resolve Redis config from storage block (if configured).
 */
export function resolveRedisConfig(
  env: NodeJS.ProcessEnv = process.env,
  storage?: Partial<StorageConfig>,
): RedisConfig | null {
  const source = storage ?? readStorageConfigFromDisk(env);
  return source?.redis ?? null;
}
