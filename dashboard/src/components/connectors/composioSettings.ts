/**
 * Composio settings panel — pure helpers.
 *
 * Slice 2.2 splits derivation/fetch logic into this module so it can be
 * unit-tested without spinning up jsdom. The panel component
 * (`ComposioSettingsPanel.tsx`) consumes these helpers verbatim.
 *
 * Decision map (locked per
 * `ops/HANDOFF_OPEN_DESIGN_COMPOSIO_INTEGRATION_REPLY.md`):
 *   - Q1 user_id / agent scope -> every helper takes an explicit `agentId`
 *     and never falls back to a global secret.
 *   - Q2 secret store          -> reads the COMPOSIO_API_KEY status from
 *     `/api/connectors/composio/status` (which delegates to service-keys.ts).
 *   - Q3 preferComposio        -> serialized verbatim through the flags PUT.
 *   - Q4 default-off gate      -> client-side defaults match the server
 *     defaults so a missing status response never silently flips Composio
 *     on.
 */

export interface ComposioStatusResponse {
  agentId: string | null;
  configured: boolean;
  apiKeyTail: string | null;
  enabled: boolean;
  allowedAgents: string[];
  flags: ComposioFlagsShape;
  flagsAvailable: boolean;
  keyId: string | null;
  apiKeyVariable: string;
  learnMoreUrl: string;
}

export interface ComposioFlagsShape {
  enabled?: boolean;
  preferComposio?: string[];
  toolRouter?: { enabled?: boolean };
}

export interface ComposioConnectivityResultLike {
  ok: boolean;
  reason?:
    | "feature-disabled"
    | "missing-api-key"
    | "missing-actor-identity"
    | "auth-error"
    | "network-error"
    | "unknown-error";
  message?: string;
  apiKeyTail?: string;
  baseURL?: string;
  probedAt?: string;
  userId?: string;
}

export const COMPOSIO_DEFAULT_LEARN_MORE_URL = "https://app.composio.dev";

export function emptyComposioStatus(agentId?: string): ComposioStatusResponse {
  return {
    agentId: agentId ?? null,
    configured: false,
    apiKeyTail: null,
    enabled: true,
    allowedAgents: [],
    flags: { enabled: false, preferComposio: [], toolRouter: { enabled: false } },
    flagsAvailable: false,
    keyId: null,
    apiKeyVariable: "COMPOSIO_API_KEY",
    learnMoreUrl: COMPOSIO_DEFAULT_LEARN_MORE_URL,
  };
}

/**
 * Normalize a raw `preferComposio` text input from the panel into the
 * canonical lowercase, whitespace-trimmed, deduped list the backend stores.
 * Accepts comma- or newline-separated strings; rejects empties.
 */
export function parsePreferComposioInput(input: string | undefined | null): string[] {
  if (!input) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/g)) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function formatPreferComposioForInput(list: string[] | undefined): string {
  if (!Array.isArray(list) || list.length === 0) {
    return "";
  }
  return list.join(", ");
}

/**
 * Derive the human-readable status badge for the panel header. The badge
 * encodes the Q4 default-off contract: until the operator both saves a key
 * AND flips `flags.enabled`, the surface reads "Disabled".
 */
export type ComposioBadgeTone = "neutral" | "ready" | "warning" | "error";
export interface ComposioBadge {
  tone: ComposioBadgeTone;
  label: string;
  detail: string;
}

export function deriveComposioBadge(status: ComposioStatusResponse): ComposioBadge {
  if (!status.configured) {
    return {
      tone: "warning",
      label: "Not configured",
      detail: "Add COMPOSIO_API_KEY to enable the integration.",
    };
  }
  if (!status.flags?.enabled) {
    return {
      tone: "neutral",
      label: "Disabled",
      detail: "Key saved. Flip the per-agent toggle to opt this agent in.",
    };
  }
  if (status.flags?.toolRouter?.enabled) {
    return {
      tone: "ready",
      label: "Tool Router (beta)",
      detail: "Agent is opted into the Composio Tool Router beta.",
    };
  }
  return {
    tone: "ready",
    label: "Enabled",
    detail: "Tool Router beta off; tools resolve through session.tools().",
  };
}

/**
 * Run the connectivity probe against the dashboard API. Wrapped in a helper
 * so the component does not need to repeat the fetch shape; tests can mock
 * `fetch` and observe the request body.
 */
export async function runComposioConnectivityProbe(params: {
  agentId: string;
  fetchImpl?: typeof fetch;
}): Promise<ComposioConnectivityResultLike> {
  const { agentId } = params;
  const fetchImpl = params.fetchImpl ?? fetch;
  if (!agentId.trim()) {
    return {
      ok: false,
      reason: "missing-actor-identity",
      message: "Select an agent before running the connectivity test.",
    };
  }
  let res: Response;
  try {
    res = await fetchImpl("/api/connectors/composio/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agentId.trim() }),
    });
  } catch (err) {
    return {
      ok: false,
      reason: "network-error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // fallthrough — handled below
  }
  if (!res.ok) {
    const message =
      (payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof (payload as Record<string, unknown>).error === "string"
        ? ((payload as Record<string, unknown>).error as string)
        : null) || `Composio probe failed with HTTP ${res.status}`;
    return { ok: false, reason: "unknown-error", message };
  }
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      reason: "unknown-error",
      message: "Composio probe returned an unexpected response shape.",
    };
  }
  return payload as ComposioConnectivityResultLike;
}

/**
 * POST a new `COMPOSIO_API_KEY` to the existing service-keys endpoint.
 * Mirrors the verbatim contract `dashboard/api-server.cjs` already serves
 * for every other API key, just with the Composio category locked in.
 */
export async function saveComposioApiKey(params: {
  value: string;
  agentId?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const trimmed = params.value.trim();
  if (!trimmed) {
    return { ok: false, error: "API key value is required." };
  }
  const allowedAgents =
    params.agentId && params.agentId.trim().length > 0 ? [params.agentId.trim().toLowerCase()] : [];
  let res: Response;
  try {
    res = await fetchImpl("/api/settings/service-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Composio",
        variable: "COMPOSIO_API_KEY",
        value: trimmed,
        service: "Composio",
        category: "Connectors",
        allowedAgents,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reach the dashboard API.",
    };
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const error =
      (body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as Record<string, unknown>).error === "string"
        ? ((body as Record<string, unknown>).error as string)
        : null) || `Save failed with HTTP ${res.status}`;
    return { ok: false, error };
  }
  return { ok: true };
}

/**
 * Update the existing key (PATCH path). Falls back to POST when the key id
 * is unknown — used by the panel's "Replace key" flow.
 */
export async function replaceComposioApiKey(params: {
  keyId: string | null;
  value: string;
  agentId?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!params.keyId) {
    return saveComposioApiKey({
      value: params.value,
      agentId: params.agentId,
      fetchImpl: params.fetchImpl,
    });
  }
  const fetchImpl = params.fetchImpl ?? fetch;
  const trimmed = params.value.trim();
  if (!trimmed) {
    return { ok: false, error: "API key value is required." };
  }
  let res: Response;
  try {
    res = await fetchImpl(`/api/settings/service-keys/${encodeURIComponent(params.keyId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: trimmed }),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reach the dashboard API.",
    };
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const error =
      (body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as Record<string, unknown>).error === "string"
        ? ((body as Record<string, unknown>).error as string)
        : null) || `Replace failed with HTTP ${res.status}`;
    return { ok: false, error };
  }
  return { ok: true };
}

/**
 * Persist the per-agent flags via the slice 2.2 PUT endpoint. Returns the
 * canonical normalized flags returned by the server so the panel renders
 * what was actually stored.
 */
export async function saveComposioFlags(params: {
  agentId: string;
  enabled: boolean;
  toolRouterEnabled: boolean;
  preferComposio: string[];
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; flags: ComposioFlagsShape } | { ok: false; error: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  if (!params.agentId.trim()) {
    return { ok: false, error: "agentId is required." };
  }
  let res: Response;
  try {
    res = await fetchImpl("/api/connectors/composio/flags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: params.agentId.trim(),
        enabled: Boolean(params.enabled),
        toolRouterEnabled: Boolean(params.toolRouterEnabled),
        preferComposio: Array.isArray(params.preferComposio) ? params.preferComposio : [],
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reach the dashboard API.",
    };
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const error =
      (body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as Record<string, unknown>).error === "string"
        ? ((body as Record<string, unknown>).error as string)
        : null) || `Flag write failed with HTTP ${res.status}`;
    return { ok: false, error };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // ignore
  }
  const flags =
    payload && typeof payload === "object" && "flags" in payload
      ? ((payload as Record<string, unknown>).flags as ComposioFlagsShape)
      : {
          enabled: params.enabled,
          toolRouter: { enabled: params.toolRouterEnabled },
          preferComposio: params.preferComposio,
        };
  return { ok: true, flags };
}

export async function loadComposioStatus(params: {
  agentId: string;
  fetchImpl?: typeof fetch;
}): Promise<ComposioStatusResponse> {
  const fetchImpl = params.fetchImpl ?? fetch;
  if (!params.agentId.trim()) {
    return emptyComposioStatus();
  }
  let res: Response;
  try {
    res = await fetchImpl(
      `/api/connectors/composio/status?agentId=${encodeURIComponent(params.agentId.trim())}`,
    );
  } catch {
    return emptyComposioStatus(params.agentId.trim());
  }
  if (!res.ok) {
    return emptyComposioStatus(params.agentId.trim());
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    return emptyComposioStatus(params.agentId.trim());
  }
  if (!payload || typeof payload !== "object") {
    return emptyComposioStatus(params.agentId.trim());
  }
  const p = payload as Partial<ComposioStatusResponse>;
  return {
    agentId: typeof p.agentId === "string" ? p.agentId : params.agentId.trim(),
    configured: p.configured === true,
    apiKeyTail: typeof p.apiKeyTail === "string" ? p.apiKeyTail : null,
    enabled: p.enabled !== false,
    allowedAgents: Array.isArray(p.allowedAgents) ? p.allowedAgents : [],
    flags: {
      enabled: p.flags?.enabled === true,
      preferComposio: Array.isArray(p.flags?.preferComposio) ? p.flags.preferComposio : [],
      toolRouter: { enabled: p.flags?.toolRouter?.enabled === true },
    },
    flagsAvailable: p.flagsAvailable === true,
    keyId: typeof p.keyId === "string" ? p.keyId : null,
    apiKeyVariable: typeof p.apiKeyVariable === "string" ? p.apiKeyVariable : "COMPOSIO_API_KEY",
    learnMoreUrl:
      typeof p.learnMoreUrl === "string" && p.learnMoreUrl.length > 0
        ? p.learnMoreUrl
        : COMPOSIO_DEFAULT_LEARN_MORE_URL,
  };
}
