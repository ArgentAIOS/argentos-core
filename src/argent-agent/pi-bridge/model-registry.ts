/**
 * pi-bridge — ModelRegistry bridge.
 *
 * Same pattern as `./auth-storage.ts`. Wraps pi-coding-agent's
 * `ModelRegistry` behind a stable surface, with a `createModelRegistry()`
 * factory that delegates to pi's `.create(...)` static — the raw
 * `new ModelRegistry(...)` constructor is private (even in pi 0.70.2,
 * see #182).
 *
 * @module argent-agent/pi-bridge/model-registry
 */

import { ModelRegistry as PiModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AuthStorage } from "./auth-storage.js";

/**
 * Argent's bridge-typed `ModelRegistry` value. Consumers should import from
 * here rather than directly from pi-coding-agent so future drift can be
 * absorbed in this single file.
 */
export const ModelRegistry = PiModelRegistry;

/**
 * Argent's bridge-typed `ModelRegistry` instance type.
 *
 * Note: pi-coding-agent's `ModelRegistry` has a private constructor (since
 * 0.70.2), so `InstanceType<typeof PiModelRegistry>` is rejected by tsc as
 * "not satisfying `abstract new (...args) => any`". We infer the instance
 * type from the `.create()` static factory's return type, which IS public.
 */
export type ModelRegistry = ReturnType<typeof PiModelRegistry.create>;

/**
 * Factory for `ModelRegistry`. Uses pi's `.create(...)` static factory rather
 * than `new ModelRegistry(...)` — the raw constructor is private (even in
 * pi 0.70.2 it's `private constructor()`, see #182). Centralizing the
 * factory call here means call sites stay forward-compatible across pi
 * versions, even if `.create()` is later renamed or its signature shifts.
 *
 * @param authStorage an `AuthStorage` instance (from `createAuthStorage`)
 * @param modelsFilePath absolute path to the models.json file
 */
export function createModelRegistry(
  authStorage: AuthStorage,
  modelsFilePath: string,
): ModelRegistry {
  return PiModelRegistry.create(authStorage, modelsFilePath);
}
