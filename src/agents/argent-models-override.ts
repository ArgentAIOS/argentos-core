/**
 * Argent local model catalog override.
 *
 * Bridges {@link ./argent-models-override.json} into argent's
 * `ensureArgentModelsJson()` pipeline so the entries land in the per-agent
 * `models.json` that pi-coding-agent's `ModelRegistry` consumes.
 *
 * TEMPORARY: drops when pi-ai (currently `@mariozechner/pi-ai 0.70.2`) ships
 * `gpt-5.5-chat-latest` natively. Tracking via earendil-works/pi#4275 + the
 * matching upstream PR. See the bump-backlog GH issue for the full list of
 * breaking-type-changes that block the upgrade today.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import type { ProviderConfig } from "./models-config.providers.js";

const require = createRequire(import.meta.url);

interface OverrideFile {
  providers?: Record<string, ProviderConfig>;
}

let cached: Record<string, ProviderConfig> | undefined;

/**
 * Load argent-managed model catalog overrides.
 *
 * Returns a `provider -> ProviderConfig` map that callers merge into the
 * provider set written to the per-agent `models.json`. Returns an empty
 * record when the override file is missing or malformed — overrides are
 * additive and a missing file must never break catalog generation.
 *
 * Entries here are eventually consumed by pi-coding-agent's `ModelRegistry`,
 * which appends custom-model entries to its built-in pi-ai catalog (custom
 * wins on `provider+id` collisions).
 */
export function loadArgentModelsOverride(): Record<string, ProviderConfig> {
  if (cached) {
    return cached;
  }
  try {
    // Prefer require() so the JSON is captured by tsdown's bundler graph
    // (rolldown statically resolves require("./*.json") into the dist bundle).
    const raw = require("./argent-models-override.json") as OverrideFile;
    cached = raw.providers ?? {};
    return cached;
  } catch {
    // Fall back to direct fs read for environments where require() can't see
    // the bundled JSON (e.g. tests running against src/ directly via tsx).
    try {
      const url = new URL("./argent-models-override.json", import.meta.url);
      const text = fs.readFileSync(url, "utf-8");
      const parsed = JSON.parse(text) as OverrideFile;
      cached = parsed.providers ?? {};
      return cached;
    } catch {
      cached = {};
      return cached;
    }
  }
}

/**
 * Reset the in-memory cache. Test-only — production callers must not need
 * this because the override file is bundled at build time.
 *
 * @internal
 */
export function _resetArgentModelsOverrideCacheForTests(): void {
  cached = undefined;
}
