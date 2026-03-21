// Import from dedicated agent-core seam module (not the coding barrel) to avoid
// circular ESM dependency issues in bundler output.
import path from "node:path";
import { AuthStorage, ModelRegistry } from "../agent-core/model-discovery.js";

export { AuthStorage, ModelRegistry } from "../agent-core/model-discovery.js";

// Compatibility helpers for pi-coding-agent 0.50+ (discover* helpers removed).
export function discoverAuthStorage(agentDir: string): AuthStorage {
  return new AuthStorage(path.join(agentDir, "auth.json"));
}

export function discoverModels(authStorage: AuthStorage, agentDir: string): ModelRegistry {
  return new ModelRegistry(authStorage, path.join(agentDir, "models.json"));
}
