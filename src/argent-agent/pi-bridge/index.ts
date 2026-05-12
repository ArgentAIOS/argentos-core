/**
 * pi-bridge — single import point for everything argent uses from pi-ai /
 * pi-coding-agent / pi-agent-core.
 *
 * Tracking issue: GH #286. Why it exists: see ./README.md.
 *
 * Migration policy (enforced by code review):
 * - NEW code MUST import pi shapes from this module, not from
 *   `@mariozechner/pi-*` directly.
 * - LEGACY direct imports are tracked in #286 sub-issues for incremental
 *   migration. When a legacy site is migrated, add a re-export here if the
 *   shape is missing.
 *
 * Adding a new re-export — see ./README.md "Adding a new re-export" section.
 *
 * @module argent-agent/pi-bridge
 */

// ---------------------------------------------------------------------------
// TYPE-ONLY RE-EXPORTS (proven by PR #275 + extended for #286)
// ---------------------------------------------------------------------------
//
// These are pure structural forwards. If pi changes the shape, this file
// breaks once and everything downstream surfaces the same diagnostic.
//
export type { AgentMessage, StreamFn, CustomAgentMessages } from "./types.js";

// ---------------------------------------------------------------------------
// AUTH STORAGE (value + type + factory)
// ---------------------------------------------------------------------------
//
// pi-coding-agent 0.73+ makes the `AuthStorage` constructor private and
// requires `AuthStorage.create(...)`. The `createAuthStorage()` helper here
// hides that drift — call sites are forward-compatible across the bump.
//
export { AuthStorage, createAuthStorage } from "./auth-storage.js";

// ---------------------------------------------------------------------------
// MODEL REGISTRY (value + type + factory)
// ---------------------------------------------------------------------------
//
// Same pattern as AuthStorage: factory helper isolates the
// `new ModelRegistry()` → `ModelRegistry.create()` private-constructor drift
// in pi 0.73+.
//
export { ModelRegistry, createModelRegistry } from "./model-registry.js";
