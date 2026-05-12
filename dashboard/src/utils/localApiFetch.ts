const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Storage key used to persist the gateway/dashboard auth token. Shared with
 * the WS path in `useGateway.ts` (see `readStoredDashboardGatewayToken`) and
 * with `App.tsx`'s `persistGatewayToken` so REST and WS pull from the same
 * source of truth and survive a `gateway.auth.token` rotation triggered by
 * `argent update`.
 */
export const DASHBOARD_CONTROL_SETTINGS_KEY = "argent.control.settings.v1";

type WebKitMessageHandlerWindow = Window & {
  webkit?: {
    messageHandlers?: Record<string, unknown>;
  };
};

function isNativeShell(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean((window as WebKitMessageHandlerWindow).webkit?.messageHandlers);
}

/**
 * Test-injectable token-resolution sources. Production code calls
 * `resolveDashboardApiToken()` with no args (resolved against the live
 * `window.location.search` + `localStorage`); tests pass explicit inputs so
 * they can exercise each precedence path without touching globals.
 */
export interface DashboardApiTokenSources {
  /** Raw `window.location.search` value (e.g. `"?token=abc"`). */
  search?: string;
  /** Reader for the persisted control-settings blob. Returns `null` when absent. */
  getStorageItem?: (key: string) => string | null;
}

function defaultGetStorageItem(key: string): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function defaultSearch(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.search;
}

function tokenFromSearch(search: string): string | null {
  if (!search) {
    return null;
  }
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  // Accept both api_token (explicit) and token (gateway token — used for both
  // WS and API). Matches the legacy URL pattern still emitted by the CLI for
  // backwards compatibility.
  const value = (params.get("api_token") ?? params.get("token"))?.trim();
  return value ? value : null;
}

function tokenFromControlSettings(getStorageItem: (key: string) => string | null): string | null {
  let raw: string | null;
  try {
    raw = getStorageItem(DASHBOARD_CONTROL_SETTINGS_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  let parsed: { token?: unknown };
  try {
    parsed = JSON.parse(raw) as { token?: unknown };
  } catch {
    return null;
  }
  if (typeof parsed.token !== "string") {
    return null;
  }
  const trimmed = parsed.token.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolve the dashboard API auth token using the same source chain as the WS
 * gateway connect path (see `useGateway.ts:readStoredDashboardGatewayToken`).
 *
 * Precedence (matches the WS path so REST + WS never disagree on a fresh
 * token after `argent update` rotates `gateway.auth.token`):
 *   1. `localStorage["argent.control.settings.v1"].token` — live, post-update-aware.
 *      Updated by `App.tsx:persistGatewayToken` whenever a tokenized URL is
 *      opened, and by the gateway-token regenerate flow in `ConfigPanel.tsx`.
 *   2. URL `?token=` / `?api_token=` query param — legacy fallback for the
 *      first request after a tokenized URL is loaded but before localStorage
 *      has been populated.
 *   3. `null` — caller sends no `Authorization` header; api-server returns 401.
 *
 * The localStorage entry takes precedence over the URL because URL params can
 * carry a stale token after a token rotation (e.g. the user reopens an old
 * tab) while localStorage was already refreshed by the WS connect or by the
 * regenerate-token UI in ConfigPanel.
 */
export function resolveDashboardApiToken(sources: DashboardApiTokenSources = {}): string | null {
  const getStorageItem = sources.getStorageItem ?? defaultGetStorageItem;
  const search = sources.search ?? defaultSearch();

  const fromStorage = tokenFromControlSettings(getStorageItem);
  if (fromStorage) {
    return fromStorage;
  }

  const fromUrl = tokenFromSearch(search);
  if (fromUrl) {
    return fromUrl;
  }

  return null;
}

function directDashboardApiUrl(path: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!path.startsWith("/")) {
    return null;
  }
  return `http://${window.location.hostname}:9242${path}`;
}

function withDashboardApiAuth(init: RequestInit = {}): RequestInit {
  const token = resolveDashboardApiToken();
  if (!token) {
    return init;
  }
  const headers = new Headers(init.headers ?? undefined);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return { ...init, headers };
}

function alternateLoopbackUrl(path: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!path.startsWith("/")) {
    return null;
  }
  // In dev mode (Vite proxy), both localhost and 127.0.0.1 route to the same
  // server, but the cross-origin fallback triggers browser CORS errors.
  // Only use the alternate in production where the api-server serves directly.
  if (import.meta.env?.DEV) {
    return null;
  }
  const { protocol, hostname, port } = window.location;
  const portPart = port ? `:${port}` : "";
  if (hostname === "localhost") {
    return `${protocol}//127.0.0.1${portPart}${path}`;
  }
  if (hostname === "127.0.0.1") {
    return `${protocol}//localhost${portPart}${path}`;
  }
  return null;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(input, init);
  }
  const controller = new AbortController();
  const upstream = init.signal;
  const onAbort = () => controller.abort();

  if (upstream) {
    if (upstream.aborted) {
      controller.abort();
    } else {
      upstream.addEventListener("abort", onAbort, { once: true });
    }
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    if (upstream) {
      upstream.removeEventListener("abort", onAbort);
    }
  }
}

export async function fetchLocalApi(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const direct = directDashboardApiUrl(path);
  const alt = alternateLoopbackUrl(path);
  const directInit = withDashboardApiAuth(init);
  const preferDirect = isNativeShell() && direct;
  if (preferDirect) {
    try {
      return await fetchWithTimeout(direct, directInit, timeoutMs);
    } catch (directErr) {
      try {
        return await fetchWithTimeout(path, init, timeoutMs);
      } catch {
        if (!alt) {
          throw directErr;
        }
        try {
          return await fetchWithTimeout(alt, init, timeoutMs);
        } catch {
          throw directErr;
        }
      }
    }
  }
  // Always include auth headers — api-server may require DASHBOARD_API_TOKEN
  const authedInit = withDashboardApiAuth(init);
  try {
    return await fetchWithTimeout(path, authedInit, timeoutMs);
  } catch (primaryErr) {
    if (direct) {
      try {
        return await fetchWithTimeout(direct, directInit, timeoutMs);
      } catch {
        // fall through to alternate loopback handling below
      }
    }
    if (!alt) {
      throw primaryErr;
    }
    try {
      return await fetchWithTimeout(alt, init, timeoutMs);
    } catch {
      throw primaryErr;
    }
  }
}
