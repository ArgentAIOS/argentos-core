/**
 * Composio SDK wrapper — slice 2.1 foundation.
 *
 * This module is the **only** place the rest of argent-core touches
 * `@composio/core`. It is deliberately thin: read the API key from the
 * existing service-keys store (Q2), resolve the `user_id` from the actor
 * context (Q1), check the per-agent feature gate (Q4), and hand back a
 * configured SDK client.
 *
 * It does **not** execute Composio tools. Slices 2.2 and later own
 * authentication setup, tool discovery, and execution. This module's
 * sole job is to gate that work behind the locked decisions in
 * `ops/HANDOFF_OPEN_DESIGN_COMPOSIO_INTEGRATION_REPLY.md`.
 *
 * Decision map:
 *   - Q1 user_id source       -> `resolveComposioUserId()` (uses
 *     `normalizeAgentId` from `routing/session-key.ts`).
 *   - Q2 secret store         -> `resolveComposioApiKey()` reads
 *     `COMPOSIO_API_KEY` via `resolveServiceKey()`; `allowedAgents`
 *     enforcement lives in service-keys.ts.
 *   - Q3 AOS overlap policy   -> recorded in `ComposioFeatureFlags.preferComposio`;
 *     read by slice 2.4 (no enforcement here yet).
 *   - Q4 Tool Router gate     -> `assertFeatureEnabled()` enforces
 *     default-off per-agent toggle.
 *   - Q5 destructive=deny     -> recorded in metadata; enforcement happens at
 *     execution-time in slice 2.5 via `exec-approvals` / `tool-policy`.
 *   - Q7 TS-only test harness -> `client.test.ts` (vitest) sits next to this file.
 */

import { Composio } from "@composio/core";
import type { ArgentConfig } from "../../config/config.js";
import { resolveServiceKey, type ServiceKeyAccessContext } from "../../infra/service-keys.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  COMPOSIO_API_KEY_VAR,
  DEFAULT_COMPOSIO_BASE_URL,
  type ComposioActorContext,
  type ComposioClientConfig,
  type ComposioFeatureFlags,
} from "./types.js";

const log = createSubsystemLogger("composio-connector");

/**
 * Compact tail of an API key for logs and audit envelopes. Matches the
 * `apiKeyTail` shape open-design's spec calls out (slice 2.2 will surface
 * this through the dashboard settings UI).
 */
export function tailApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) {
    return "*".repeat(Math.max(trimmed.length, 1));
  }
  return `…${trimmed.slice(-4)}`;
}

/**
 * Resolve Composio's per-end-user `user_id` (Q1 — Agent Persona scope).
 *
 * The canonical source is the normalized agent id. We fall back through the
 * same precedence chain `service-keys.ts` uses so a single actor context
 * resolves identically against secrets and against Composio.
 */
export function resolveComposioUserId(actor?: ComposioActorContext): string | undefined {
  const candidate = actor?.actorId?.trim() || process.env.ARGENT_AGENT_ID?.trim() || undefined;
  if (!candidate) {
    return undefined;
  }
  return normalizeAgentId(candidate);
}

/**
 * Read `COMPOSIO_API_KEY` (Q2) through the existing service-keys store.
 * Per-agent scoping is enforced inside `resolveServiceKey()` via the
 * `allowedAgents` policy — this wrapper simply forwards the actor context.
 */
export function resolveComposioApiKey(
  actor?: ComposioActorContext,
  cfg?: ArgentConfig,
): string | undefined {
  const ctx: ServiceKeyAccessContext | undefined = actor
    ? {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        actorTeam: actor.actorTeam,
        sessionKey: actor.sessionKey,
        source: "composio-connector",
      }
    : undefined;
  return resolveServiceKey(COMPOSIO_API_KEY_VAR, cfg, ctx);
}

/**
 * Enforce the per-agent feature gate (Q4). Default-off, mirrors the
 * `experimentalWrites` precedent in `executive-shadow-client.ts`. The
 * caller decides what to do on a falsy result; for the connectivity
 * probe we surface a structured `feature-disabled` reason.
 */
export function isComposioEnabled(flags?: ComposioFeatureFlags): boolean {
  return flags?.enabled === true;
}

/**
 * True when the agent has explicitly opted into Tool Router beta (Q4).
 * Tool Router is beta as of May 2026; default is `session.tools()` over
 * a curated allow-list owned by slice 2.4.
 */
export function isComposioToolRouterEnabled(flags?: ComposioFeatureFlags): boolean {
  return Boolean(flags?.enabled === true && flags?.toolRouter?.enabled === true);
}

/**
 * Build a configured Composio SDK client. Throws on missing API key — that
 * is a programmer error: callers should consult `resolveComposioApiKey()`
 * (which returns undefined when the key is missing or scoped away from this
 * actor) before invoking the constructor.
 *
 * The wrapper does NOT cache clients. Composio's client is per-API-key, and
 * argent-core may run multiple agents in the same process; caching by key
 * is slice 2.2's job once the settings UI lands.
 */
export function createComposioClient(config: ComposioClientConfig): Composio {
  if (!config.apiKey || !config.apiKey.trim()) {
    throw new Error("createComposioClient: apiKey is required");
  }
  const baseURL = config.baseURL?.trim() || DEFAULT_COMPOSIO_BASE_URL;
  log.debug("constructing composio client", {
    apiKeyTail: tailApiKey(config.apiKey),
    baseURL,
  });
  // Default-off telemetry — argent-core is the privacy-respecting host, not
  // the upstream service. Operators can flip this via slice 2.2 settings.
  const allowTracking = config.allowTracking ?? false;
  return new Composio({
    apiKey: config.apiKey.trim(),
    baseURL,
    allowTracking,
  });
}

/**
 * Convenience entry-point for slices 2.2+: resolve the actor's API key and
 * `user_id` from the existing argent-core surfaces, enforce the feature
 * gate, and return a ready-to-use SDK client. Returns `undefined` when any
 * gate fails — never throws on missing config.
 */
export function tryCreateComposioClientForActor(params: {
  actor?: ComposioActorContext;
  flags?: ComposioFeatureFlags;
  cfg?: ArgentConfig;
}): { client: Composio; userId: string; apiKeyTail: string } | undefined {
  if (!isComposioEnabled(params.flags)) {
    return undefined;
  }
  const userId = resolveComposioUserId(params.actor);
  if (!userId) {
    return undefined;
  }
  const apiKey = resolveComposioApiKey(params.actor, params.cfg);
  if (!apiKey) {
    return undefined;
  }
  const client = createComposioClient({ apiKey });
  return { client, userId, apiKeyTail: tailApiKey(apiKey) };
}
