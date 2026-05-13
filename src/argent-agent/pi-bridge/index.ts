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

// ---------------------------------------------------------------------------
// SESSION COMPACTION RESULT MAPPER (GH #303)
// ---------------------------------------------------------------------------
//
// pi 0.73+ drops `firstKeptEntryId` and `details` from `CompactionResult`.
// Argent reads both fields in `pi-embedded-runner/compact.ts` and threads
// them downstream into `EmbeddedPiCompactResult` / `appendCompaction(...)` /
// `compaction-safeguard.ts`. `mapSessionCompactionResult` is the single
// chokepoint that absorbs that drift — argent consumes
// `ArgentSessionCompactionResult` (stable shape) instead of pi's raw type.
//
export {
  mapSessionCompactionResult,
  type ArgentSessionCompactionResult,
  type PiSessionCompactionResultLike,
  type SessionForCompactionMapping,
} from "./session-compaction.js";

// ---------------------------------------------------------------------------
// TOOL / CONTEXT / TYPEBOX IDENTITY BRIDGE (GH #305)
// ---------------------------------------------------------------------------
//
// pi 0.70+ ships its own `typebox@1.x` while argent still uses
// `@sinclair/typebox@0.34.x`. The two `TSchema` identities collide at every
// boundary that hands an argent tool to pi (`createAgentSession`,
// `streamSimple`, etc.). `tool.ts` exposes pi's canonical identities plus
// `bridgeToolParameters()` — the explicit cast that absorbs the version drift
// in one place. See `./tool.ts` header for the full rationale.
//
export type { TSchema, Static, Tool, Context } from "./tool.js";
export { Type, bridgeToolParameters } from "./tool.js";

// ---------------------------------------------------------------------------
// SUPPORTS-XHIGH CAPABILITY HELPER (GH #306)
// ---------------------------------------------------------------------------
//
// Pi 0.73+ removes the `supportsXhigh` named export and replaces it with
// `getSupportedThinkingLevels(model).includes("xhigh")`. Argent re-implements
// the capability check locally so call sites stay stable across that bump.
// See `./supports-xhigh.ts` header for the full rationale.
//
export { supportsXhigh } from "./supports-xhigh.js";

// ---------------------------------------------------------------------------
// TRANSPORT TYPE ALIAS (GH #306)
// ---------------------------------------------------------------------------
//
// Pi 0.73+ tightened `Transport` to `"sse" | "websocket" | "auto"`, dropping
// legacy `"websocket-cached"`. Argent already does not reference the removed
// variant; this alias is exposed so future call sites import `Transport`
// through the bridge instead of pi directly.
//
export type { Transport } from "./transport.js";
