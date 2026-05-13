/**
 * pi-bridge — AuthStorage bridge.
 *
 * Wraps pi-coding-agent's `AuthStorage` behind a stable surface:
 * - Re-exports `AuthStorage` as both a value AND a type, so consumers can
 *   type-annotate without importing pi-coding-agent directly.
 * - Provides `createAuthStorage(path)` — a factory helper that delegates to
 *   pi's `.create(...)` static factory. The raw `new AuthStorage(...)`
 *   constructor is **private** (even in pi 0.70.2, per the d.ts on line 55),
 *   so the factory pattern is the only forward-compatible call shape.
 *   Centralizing it here means future renames or signature shifts on the
 *   static factory are absorbed in this single file.
 *
 * Migration policy
 * ----------------
 * New code MUST use `createAuthStorage(path)` from this file rather than
 * `new AuthStorage(path)` (which doesn't compile) or `AuthStorage.create(...)`
 * directly (which couples call sites to pi's API). Legacy direct call sites
 * are tracked for migration under GH #286.
 *
 * @module argent-agent/pi-bridge/auth-storage
 */

import { AuthStorage as PiAuthStorage } from "@earendil-works/pi-coding-agent";

/**
 * Argent's bridge-typed `AuthStorage` value. Consumers should import from
 * here so future drift (renamed type, replaced backend, etc.) can be
 * absorbed in this file rather than rippling across argent's source tree.
 */
export const AuthStorage = PiAuthStorage;

/**
 * Argent's bridge-typed `AuthStorage` instance type.
 *
 * Note: pi-coding-agent's `AuthStorage` has a private constructor (since
 * 0.70.2), so `InstanceType<typeof PiAuthStorage>` is rejected by tsc as
 * "not satisfying `abstract new (...args) => any`". We infer the instance
 * type from the `.create()` static factory's return type, which IS public.
 */
export type AuthStorage = ReturnType<typeof PiAuthStorage.create>;

/**
 * Factory for `AuthStorage`. Uses pi's `.create(...)` static factory; the
 * raw constructor is private (per the d.ts, line 55 of
 * `pi-coding-agent/dist/core/auth-storage.d.ts`). Centralizing the call
 * shape here means consumers stay forward-compatible if pi later renames
 * or re-signatures the factory.
 *
 * @param authFilePath absolute path to the auth.json file
 */
export function createAuthStorage(authFilePath: string): AuthStorage {
  return PiAuthStorage.create(authFilePath);
}
