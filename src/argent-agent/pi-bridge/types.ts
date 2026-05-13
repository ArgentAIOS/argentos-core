/**
 * pi-bridge — Type-only re-exports from pi-ai / pi-coding-agent / pi-agent-core.
 *
 * Why this file exists
 * --------------------
 * Argent imports pi's *internal types* at ~30 sites today (see GH #182).
 * Every pi-ai bump (private constructors, removed methods, typebox version
 * switch, etc.) breaks every cast in argent. This file centralizes type-only
 * re-exports so future pi drift is absorbed in ONE module instead of cascading.
 *
 * What lives here
 * ---------------
 * Type-only forwards from pi packages that argent has *proven* are
 * structurally compatible. PR #275 proved this pattern works for the
 * `AgentMessage` / `StreamFn` / `CustomAgentMessages` triad (baseline 267 → 249,
 * 18 retired entries stayed retired). This file extends that pattern.
 *
 * What does NOT live here
 * -----------------------
 * - Value-shaped APIs whose constructors / factories may drift (e.g.
 *   `AuthStorage`, `ModelRegistry`). Those are in `./auth-storage.ts` and
 *   `./model-registry.ts` so we can wrap them with stable factory helpers
 *   (forward-compatible with pi 0.73+'s `.create()` pattern).
 * - argent-specific extensions / argent-native types. Those stay in
 *   `../pi-types.ts` and the argent-agent barrel.
 *
 * @module argent-agent/pi-bridge/types
 */

// ---------------------------------------------------------------------------
// pi-agent-core — message / stream identity (proved by PR #275)
// ---------------------------------------------------------------------------

/**
 * `AgentMessage`: union of LLM messages + custom messages, sourced from
 * pi-agent-core so the type identity is unified with `AgentSession["messages"]`.
 *
 * Without forwarding here, tsc treats argent's local mirrors and the upstream
 * originals as separate identities even when structurally equivalent, which
 * surfaces as ~19 spurious `T is not assignable to T` errors. See GH #257.
 */
export type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * `StreamFn`: stream function signature shared with pi-agent-core's
 * `AgentSessionAgent["streamFn"]`. Forwarded to keep the identity unified.
 */
export type { StreamFn } from "@earendil-works/pi-agent-core";

/**
 * `CustomAgentMessages`: extensible interface for custom app messages.
 * Forwarded so argent's `declare module` augmentations land on the same
 * declaration pi consumes.
 *
 * @example
 * ```typescript
 * declare module "@earendil-works/pi-agent-core" {
 *   interface CustomAgentMessages {
 *     artifact: ArtifactMessage;
 *   }
 * }
 * ```
 */
export type { CustomAgentMessages } from "@earendil-works/pi-agent-core";
