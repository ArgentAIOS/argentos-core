/**
 * Helpers for authenticated Dashboard API calls from the gateway.
 *
 * Symmetric to the api-server's `resolveAcceptedTokens` — both sides must agree
 * on where the current token lives. The api-server accepts both
 * `process.env.DASHBOARD_API_TOKEN` and `gateway.auth.token` from argent.json,
 * but `dashboardApiHeaders()` historically only emitted the env-var value. That
 * meant any tool reading the token through this helper would 401 against the
 * api-server whenever the env var was unset or stale, even though `argent.json`
 * carried a valid token (which the api-server WOULD have accepted). doc_panel,
 * doc_panel_update, workflow-runner, and workflow-execution-service all hit
 * this path; the operator-visible symptom is "DocPanel is still failing with
 * Invalid token" after a token rotation.
 *
 * Resolution order matches the api-server's resolveAcceptedTokens:
 *   1. `process.env.DASHBOARD_API_TOKEN` — explicit override
 *   2. `gateway.auth.token` from argent.json (loaded per-request, see INV-1/INV-4)
 *   3. No Authorization header — caller will see 401 from the api-server
 */

import type { ArgentConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";

/**
 * Test-injectable sources for `resolveDashboardApiToken`. Production code calls
 * `dashboardApiHeaders()` with no args and the resolver pulls from
 * `process.env` + `loadConfig()`. Tests pass explicit inputs to exercise each
 * branch without touching globals.
 */
export interface DashboardApiTokenSources {
  /** Environment-variable map. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Loader for argent.json's resolved config. Defaults to `loadConfig()`. */
  loadConfig?: () => ArgentConfig;
}

/**
 * Resolve the dashboard API token using the same precedence as the api-server.
 * Pure with respect to its `sources` arg — exported for direct test coverage.
 */
export function resolveDashboardApiToken(sources: DashboardApiTokenSources = {}): string | null {
  const env = sources.env ?? process.env;
  const envToken = env.DASHBOARD_API_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  // Per-request fetch: see INV-1 / INV-4. We must not cache `argent.json` at
  // module load — token rotation via `argent update` requires every header
  // build to see the live value.
  let config: ArgentConfig | null = null;
  try {
    const loader = sources.loadConfig ?? loadConfig;
    config = loader();
  } catch {
    // Config load failures (missing file, bad JSON) shouldn't crash the caller
    // — fall through to "no token" and let the api-server return 401, which
    // matches the historical behaviour when the env var was unset.
    return null;
  }

  const configToken = config.gateway?.auth?.token?.trim();
  return configToken ? configToken : null;
}

/** Build headers for Dashboard API requests, injecting bearer token when available. */
export function dashboardApiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = resolveDashboardApiToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}
