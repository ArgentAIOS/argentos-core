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

  // Prefer gateway.auth.token (resolved live per-request) over the env var.
  //
  // The api-server's accepted set is [DASHBOARD_API_TOKEN captured at ITS boot,
  // gateway.auth.token resolved live per-request]. The gateway's env
  // DASHBOARD_API_TOKEN is sourced from the LaunchAgent plist / service-env and
  // can drift from the api-server's captured value across restarts and
  // redeploys. Observed 2026-06-16: a stale 48-char plist token 401'd every
  // DocPanel save (output node) while gateway.auth.token authenticated fine.
  // gateway.auth.token is the single value both processes always agree on, so
  // send it first and fall back to the env var only when argent.json carries no
  // gateway token. Per-request (INV-1 / INV-4): never cache argent.json at
  // module load — token rotation via `argent update` must be seen every call.
  let configToken: string | undefined;
  try {
    const loader = sources.loadConfig ?? loadConfig;
    const config: ArgentConfig = loader();
    configToken = config.gateway?.auth?.token?.trim() || undefined;
  } catch {
    // Config load failures (missing file, bad JSON) shouldn't crash the caller
    // — fall through to the env var, then to "no token" (api-server 401).
    configToken = undefined;
  }

  if (configToken) {
    return configToken;
  }
  return envToken ? envToken : null;
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
