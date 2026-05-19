/**
 * Provider Registry — Runtime manager
 *
 * Reads/writes ~/.argentos/provider-registry.json.
 * Seeds from provider-registry-seed.ts on first run or version bump.
 * Dashboard and resolveImplicitProviders() read from this registry.
 */

import fs from "node:fs";
import path from "node:path";
import type { ProviderRegistry, ProviderRegistryEntry } from "../config/types.models.js";
import { resolveStateDir } from "../config/paths.js";
import { buildSeedRegistry, SEED_VERSION } from "./provider-registry-seed.js";

const REGISTRY_FILENAME = "provider-registry.json";

function registryPath(stateDir?: string): string {
  const dir = stateDir ?? resolveStateDir();
  return path.join(dir, REGISTRY_FILENAME);
}

function readJsonSync(filepath: string): unknown {
  try {
    const raw = fs.readFileSync(filepath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isRegistry(value: unknown): value is ProviderRegistry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.version === "number" && typeof obj.providers === "object" && obj.providers !== null
  );
}

function mergeProviderEntry(
  seedEntry: ProviderRegistryEntry,
  userEntry: ProviderRegistryEntry,
): ProviderRegistryEntry {
  const seedModels = Array.isArray(seedEntry.models) ? seedEntry.models : [];
  const userModels = Array.isArray(userEntry.models) ? userEntry.models : [];
  const mergedModels = [...userModels];
  const seen = new Set(userModels.map((model) => model.id));
  for (const model of seedModels) {
    if (!seen.has(model.id)) {
      mergedModels.push(model);
    }
  }
  return {
    ...seedEntry,
    ...userEntry,
    models: mergedModels,
  };
}

/**
 * Load the provider registry from disk.
 * If the file is missing or its version is older than the seed, re-seeds.
 * Merges: seed entries are added for providers not already in the file,
 * preserving any user customizations for existing providers.
 */
export function loadProviderRegistry(stateDir?: string): ProviderRegistry {
  const filepath = registryPath(stateDir);
  const raw = readJsonSync(filepath);
  const seed = buildSeedRegistry();

  if (!isRegistry(raw)) {
    // No registry on disk — write seed and return it.
    saveProviderRegistry(seed, stateDir);
    return seed;
  }

  if (raw.version >= SEED_VERSION) {
    // Registry is current or newer. Return as-is.
    return raw;
  }

  // Registry is outdated. Merge: user edits win, new seed entries are added.
  const merged: ProviderRegistry = {
    version: SEED_VERSION,
    providers: { ...seed.providers },
  };
  for (const [key, userEntry] of Object.entries(raw.providers)) {
    const seedEntry = seed.providers[key];
    merged.providers[key] = seedEntry
      ? mergeProviderEntry(seedEntry, userEntry as ProviderRegistryEntry)
      : (userEntry as ProviderRegistryEntry);
  }

  saveProviderRegistry(merged, stateDir);
  return merged;
}

/**
 * Save the provider registry to disk.
 */
export function saveProviderRegistry(registry: ProviderRegistry, stateDir?: string): void {
  const filepath = registryPath(stateDir);
  const dir = path.dirname(filepath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(filepath, JSON.stringify(registry, null, 2) + "\n", { mode: 0o600 });
}

/**
 * Get a single provider entry from the registry.
 */
export function getRegistryProvider(
  providerName: string,
  stateDir?: string,
): ProviderRegistryEntry | undefined {
  const registry = loadProviderRegistry(stateDir);
  return registry.providers[providerName];
}

/**
 * Get all provider entries from the registry.
 */
export function getRegistryProviders(stateDir?: string): Record<string, ProviderRegistryEntry> {
  const registry = loadProviderRegistry(stateDir);
  return registry.providers;
}

/**
 * Reset a single provider to its seed defaults.
 * Returns true if the provider was found in the seed and reset.
 */
export function resetProviderToSeed(providerName: string, stateDir?: string): boolean {
  const seed = buildSeedRegistry();
  const seedEntry = seed.providers[providerName];
  if (!seedEntry) return false;

  const registry = loadProviderRegistry(stateDir);
  registry.providers[providerName] = seedEntry;
  saveProviderRegistry(registry, stateDir);
  return true;
}

/**
 * Reset the entire registry to seed defaults.
 */
export function resetRegistryToSeed(stateDir?: string): ProviderRegistry {
  const seed = buildSeedRegistry();
  saveProviderRegistry(seed, stateDir);
  return seed;
}
