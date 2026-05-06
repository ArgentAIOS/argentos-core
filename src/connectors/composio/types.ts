/**
 * Composio connector — public types (slice 2.1).
 *
 * This module is intentionally tiny. It defines the shapes the rest of the
 * Composio integration (slices 2.2+) will consume so the SDK wrapper, the
 * connectivity probe, and the tests share one vocabulary.
 *
 * Decisions enforced here trace back to
 * `ops/HANDOFF_OPEN_DESIGN_COMPOSIO_INTEGRATION_REPLY.md` (FINAL):
 *   - Q1: actor identity is the canonical `user_id` source.
 *   - Q4: Composio SDK + Tool Router are gated behind a per-agent feature
 *     flag (default-off, mirrors `experimentalWrites` in
 *     `executive-shadow-client.ts`).
 */

export const COMPOSIO_API_KEY_VAR = "COMPOSIO_API_KEY";
export const DEFAULT_COMPOSIO_BASE_URL = "https://api.composio.dev";

/**
 * The variable name in `service-keys.json` (Q2) that stores each operator's
 * Composio API key. Per-agent isolation is enforced upstream by the existing
 * `allowedAgents` policy in `src/infra/service-keys.ts`.
 */
export type ComposioServiceKeyVariable = typeof COMPOSIO_API_KEY_VAR;

/**
 * Actor context passed in to derive Composio's `user_id` (Q1 — Agent
 * Persona scope). Mirrors `ServiceKeyAccessContext` in
 * `src/infra/service-keys.ts` so the same identity flows through both
 * subsystems.
 */
export interface ComposioActorContext {
  /** Normalized agent id (preferred). Becomes Composio's `user_id`. */
  actorId?: string;
  actorRole?: string;
  actorTeam?: string;
  sessionKey?: string;
}

/**
 * Per-agent Composio feature flags (Q4). Tool Router is beta as of May 2026
 * and is **opt-in per agent**; default-off. The shape mirrors
 * `experimentalWrites` in `executive-shadow-client.ts`.
 */
export interface ComposioFeatureFlags {
  /** Master gate for the Composio surface for this agent. Default false. */
  enabled?: boolean;
  /**
   * Override the AOS-wins-Composio-fills-gaps default (Q3) per toolkit.
   * When a toolkit slug is listed here, Composio takes precedence over the
   * matching `aos-*` connector for this agent.
   */
  preferComposio?: string[];
  /** Tool Router beta (Q4). Default false. */
  toolRouter?: { enabled?: boolean };
}

export interface ComposioClientConfig {
  /** Decrypted API key. Resolved via `service-keys.ts` upstream of the wrapper. */
  apiKey: string;
  /** Override the Composio API base URL (test fixtures, regional endpoints). */
  baseURL?: string;
  /** Disable upstream Composio analytics. Defaults to false (analytics off). */
  allowTracking?: boolean;
}

/**
 * Result of a Composio connectivity check. Either OK with the resolved
 * `user_id` (Q1) or a structured failure reason. The caller never sees the
 * raw API key.
 */
export type ComposioConnectivityResult =
  | {
      ok: true;
      userId: string;
      apiKeyTail: string;
      baseURL: string;
      probedAt: string;
    }
  | {
      ok: false;
      reason:
        | "feature-disabled"
        | "missing-api-key"
        | "missing-actor-identity"
        | "auth-error"
        | "network-error"
        | "unknown-error";
      message: string;
      apiKeyTail?: string;
      baseURL?: string;
      probedAt: string;
    };
