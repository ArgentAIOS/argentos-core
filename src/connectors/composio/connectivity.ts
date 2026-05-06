/**
 * Composio connectivity probe — slice 2.1.
 *
 * A read-only health check that verifies the SDK can reach Composio's API
 * without performing any tool execution or mutating any account state.
 * Used by:
 *   - Dashboard "Composio API key configured?" indicator (slice 2.2 UI).
 *   - `argent doctor` style commands once wired (out of scope for 2.1).
 *
 * The probe never throws. It always returns a structured
 * `ComposioConnectivityResult` so the caller can render a precise reason.
 */

import type { Composio } from "@composio/core";
import type { ArgentConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  createComposioClient,
  isComposioEnabled,
  resolveComposioApiKey,
  resolveComposioUserId,
  tailApiKey,
} from "./client.js";
import {
  DEFAULT_COMPOSIO_BASE_URL,
  type ComposioActorContext,
  type ComposioConnectivityResult,
  type ComposioFeatureFlags,
} from "./types.js";

const log = createSubsystemLogger("composio-connector");

export interface ComposioConnectivityCheckParams {
  actor?: ComposioActorContext;
  flags?: ComposioFeatureFlags;
  cfg?: ArgentConfig;
  /** Override the Composio API base URL (test fixtures, regional endpoints). */
  baseURL?: string;
  /** Inject a pre-built SDK client (test seam). When omitted we build one. */
  client?: Composio;
  /**
   * Inject an alternative API key resolver (test seam). Defaults to
   * reading `COMPOSIO_API_KEY` via the service-keys store.
   */
  resolveApiKey?: (
    actor: ComposioActorContext | undefined,
    cfg: ArgentConfig | undefined,
  ) => string | undefined;
}

/**
 * Pick the smallest possible Composio read endpoint to confirm the API key
 * is valid and the network is reachable. `toolkits.listCategories()` is a
 * read of public catalog metadata — it does not touch the user's connected
 * accounts, does not consume tool-execution quota, and exists across SDK
 * versions covered by `@composio/core ^0.8`.
 */
async function probeComposioReadEndpoint(client: Composio): Promise<void> {
  // The SDK exposes `toolkits.listCategories()` which returns a flat list of
  // platform-managed categories. It is the cheapest authenticated read on
  // the catalog surface.
  const toolkits: { listCategories?: () => Promise<unknown> } | undefined = (
    client as unknown as { toolkits?: { listCategories?: () => Promise<unknown> } }
  ).toolkits;
  if (!toolkits || typeof toolkits.listCategories !== "function") {
    throw new Error(
      "composio sdk: toolkits.listCategories() is unavailable (unexpected SDK version)",
    );
  }
  await toolkits.listCategories();
}

function classifyError(err: unknown): {
  reason: "auth-error" | "network-error" | "unknown-error";
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  const lowered = message.toLowerCase();
  if (
    lowered.includes("401") ||
    lowered.includes("403") ||
    lowered.includes("unauthorized") ||
    lowered.includes("forbidden") ||
    lowered.includes("invalid api key") ||
    lowered.includes("api key")
  ) {
    return { reason: "auth-error", message };
  }
  if (
    lowered.includes("enotfound") ||
    lowered.includes("econnrefused") ||
    lowered.includes("etimedout") ||
    lowered.includes("network") ||
    lowered.includes("fetch failed") ||
    lowered.includes("socket hang up")
  ) {
    return { reason: "network-error", message };
  }
  return { reason: "unknown-error", message };
}

/**
 * Run the Composio connectivity probe for the given actor context. Always
 * returns a structured result; never throws.
 *
 * Failure ordering mirrors the locked decisions:
 *   1. Q4 feature gate (default-off).
 *   2. Q1 actor identity (need a user_id to scope every Composio call).
 *   3. Q2 secret (must resolve through service-keys.ts; allowedAgents
 *      policy is enforced upstream).
 *   4. Network/auth call against Composio's catalog read endpoint.
 */
export async function checkComposioConnectivity(
  params: ComposioConnectivityCheckParams = {},
): Promise<ComposioConnectivityResult> {
  const probedAt = new Date().toISOString();
  const baseURL = params.baseURL?.trim() || DEFAULT_COMPOSIO_BASE_URL;

  // 1. Q4: feature gate.
  if (!isComposioEnabled(params.flags)) {
    return {
      ok: false,
      reason: "feature-disabled",
      message:
        "Composio integration is disabled for this agent. Opt in by setting connectors.composio.enabled = true.",
      baseURL,
      probedAt,
    };
  }

  // 2. Q1: actor identity.
  const userId = resolveComposioUserId(params.actor);
  if (!userId) {
    return {
      ok: false,
      reason: "missing-actor-identity",
      message:
        "No actorId is available to scope Composio's user_id. Pass an explicit actor context or set ARGENT_AGENT_ID.",
      baseURL,
      probedAt,
    };
  }

  // 3. Q2: secret store.
  const resolveApiKey = params.resolveApiKey ?? resolveComposioApiKey;
  const apiKey = resolveApiKey(params.actor, params.cfg);
  if (!apiKey) {
    return {
      ok: false,
      reason: "missing-api-key",
      message:
        "COMPOSIO_API_KEY is not configured for this agent (or scoped away by allowedAgents policy).",
      baseURL,
      probedAt,
    };
  }

  // 4. Network/auth probe.
  let client = params.client;
  if (!client) {
    try {
      client = createComposioClient({ apiKey, baseURL });
    } catch (err) {
      const { reason, message } = classifyError(err);
      log.warn("composio client construction failed", {
        reason,
        message,
        apiKeyTail: tailApiKey(apiKey),
      });
      return {
        ok: false,
        reason,
        message,
        apiKeyTail: tailApiKey(apiKey),
        baseURL,
        probedAt,
      };
    }
  }

  try {
    await probeComposioReadEndpoint(client);
  } catch (err) {
    const { reason, message } = classifyError(err);
    log.warn("composio connectivity probe failed", {
      reason,
      message,
      apiKeyTail: tailApiKey(apiKey),
    });
    return {
      ok: false,
      reason,
      message,
      apiKeyTail: tailApiKey(apiKey),
      baseURL,
      probedAt,
    };
  }

  return {
    ok: true,
    userId,
    apiKeyTail: tailApiKey(apiKey),
    baseURL,
    probedAt,
  };
}
