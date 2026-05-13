// Import from the pi-bridge (single point of drift) rather than directly from
// `@earendil-works/pi-coding-agent`. This is the canonical migration pattern for
// #286: `new AuthStorage(...)` / `new ModelRegistry(...)` are exactly the call
// sites that break on the pi 0.73+ private-constructor change (#182). Using
// the bridge factory helpers makes those forward-compatible.
import path from "node:path";
import {
  AuthStorage,
  ModelRegistry,
  createAuthStorage,
  createModelRegistry,
} from "../argent-agent/pi-bridge/index.js";

export { AuthStorage, ModelRegistry, createAuthStorage, createModelRegistry };

// Compatibility helpers for pi-coding-agent 0.50+ (discover* helpers removed).
export function discoverAuthStorage(agentDir: string): AuthStorage {
  return createAuthStorage(path.join(agentDir, "auth.json"));
}

export function discoverModels(authStorage: AuthStorage, agentDir: string): ModelRegistry {
  return createModelRegistry(authStorage, path.join(agentDir, "models.json"));
}
