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

/**
 * Why no token was returned by `resolveDashboardApiTokenDetailed`. Distinguishes
 * the "user never had a token here" cases from "storage tried but failed" cases
 * so the UI can show a recoverable auth-lost banner (issue #400) instead of
 * silently rendering empty settings panels.
 */
export type DashboardApiTokenFailureReason =
  | "ok" // Token resolved successfully.
  | "absent" // No localStorage entry, no URL token — first-load / cleared state.
  | "storage-error" // localStorage.getItem threw (quota exceeded, security error).
  | "parse-error" // localStorage entry exists but JSON.parse failed.
  | "malformed"; // Entry parsed but token field missing/non-string/empty.

export interface DashboardApiTokenResolution {
  token: string | null;
  reason: DashboardApiTokenFailureReason;
}

function defaultGetStorageItem(key: string): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  return localStorage.getItem(key);
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

type ControlSettingsResult =
  | { kind: "ok"; token: string }
  | { kind: "absent" }
  | { kind: "storage-error" }
  | { kind: "parse-error" }
  | { kind: "malformed" };

function readControlSettingsToken(
  getStorageItem: (key: string) => string | null,
): ControlSettingsResult {
  let raw: string | null;
  try {
    raw = getStorageItem(DASHBOARD_CONTROL_SETTINGS_KEY);
  } catch {
    // localStorage.getItem can throw on quota exceeded, security errors, or
    // when storage is disabled. Surface this distinctly from "no entry" so the
    // dashboard can show a recoverable banner instead of silently falling
    // through to a null token and an unexplained 401 storm (issue #400).
    return { kind: "storage-error" };
  }
  if (raw === null) {
    return { kind: "absent" };
  }
  let parsed: { token?: unknown };
  try {
    parsed = JSON.parse(raw) as { token?: unknown };
  } catch {
    return { kind: "parse-error" };
  }
  if (typeof parsed.token !== "string") {
    return { kind: "malformed" };
  }
  const trimmed = parsed.token.trim();
  if (!trimmed) {
    return { kind: "malformed" };
  }
  return { kind: "ok", token: trimmed };
}

/**
 * Resolve the dashboard API auth token AND the reason for any failure. Use
 * this when you need to drive UI based on *why* a token couldn't be read
 * (e.g. show an auth-lost banner on quota errors but stay silent on first
 * load before the user has opened a tokenized URL).
 *
 * Precedence:
 *   1. `localStorage["argent.control.settings.v1"].token` — live, post-update-aware.
 *   2. URL `?token=` / `?api_token=` — legacy fallback for first request before
 *      localStorage has been populated by App.tsx.
 *   3. `null` with a specific `reason` so the caller can decide whether to
 *      show recovery UI or stay quiet.
 *
 * The `reason` reflects the localStorage outcome even when the URL fallback
 * succeeded — so "storage-error + url-token" still returns reason="ok" because
 * the user has a working token, but a future change could surface a "your
 * localStorage is broken, this session won't survive a token rotation" warning.
 */
export function resolveDashboardApiTokenDetailed(
  sources: DashboardApiTokenSources = {},
): DashboardApiTokenResolution {
  const getStorageItem = sources.getStorageItem ?? defaultGetStorageItem;
  const search = sources.search ?? defaultSearch();

  const storageResult = readControlSettingsToken(getStorageItem);
  if (storageResult.kind === "ok") {
    return { token: storageResult.token, reason: "ok" };
  }

  const fromUrl = tokenFromSearch(search);
  if (fromUrl) {
    return { token: fromUrl, reason: "ok" };
  }

  return { token: null, reason: storageResult.kind };
}

/**
 * Back-compat thin wrapper that returns just the token string-or-null.
 * Most callers should use this; only `fetchLocalApi`'s auth-lost detection
 * and components driving recovery UI need `resolveDashboardApiTokenDetailed`.
 */
export function resolveDashboardApiToken(sources: DashboardApiTokenSources = {}): string | null {
  return resolveDashboardApiTokenDetailed(sources).token;
}

// ── Auth-lost / auth-recovered event surface (issue #400) ────────────────────
//
// Subscribers (typically App.tsx mounting an AuthLostBanner) are notified
// when `fetchLocalApi` sees a 401 response or fails to attach an auth header
// because the token couldn't be resolved. They're also notified on the first
// successful 2xx after an auth-lost event so the banner can self-dismiss.
//
// Listeners are kept at module scope so HMR doesn't drop subscriptions and
// so all panels share a single signal — six panels 401-ing in parallel still
// produce a single banner.

/**
 * Reason context attached to an auth-lost event so the banner can vary copy
 * by failure mode. "rejected" means the server returned 401 despite us
 * sending a token — usually a stale or rotated token. Others come from
 * `resolveDashboardApiTokenDetailed`.
 */
export type DashboardAuthLostReason = DashboardApiTokenFailureReason | "rejected";

export interface DashboardAuthLostEvent {
  reason: DashboardAuthLostReason;
  /** Endpoint path that triggered the event, for diagnostics. Empty when the event was triggered by token resolution alone. */
  path: string;
  /** Wall-clock ms timestamp for ordering events when multiple panels fail in parallel. */
  at: number;
}

type AuthLostListener = (event: DashboardAuthLostEvent) => void;
type AuthRecoveredListener = () => void;

const authLostListeners = new Set<AuthLostListener>();
const authRecoveredListeners = new Set<AuthRecoveredListener>();

/**
 * Most recent un-recovered auth-lost event. Replayed to listeners that
 * subscribe *after* the event fired so the banner survives the race where a
 * settings panel 401s before `AuthLostBanner`'s effect has mounted — six
 * settings GETs fire in parallel at app load and any one of them can race
 * the banner's subscription. Cleared on auth-recovered.
 */
let lastAuthLostEvent: DashboardAuthLostEvent | null = null;

export function addDashboardAuthLostListener(listener: AuthLostListener): () => void {
  authLostListeners.add(listener);
  if (lastAuthLostEvent) {
    try {
      listener(lastAuthLostEvent);
    } catch {
      // Replay must not break the subscription contract.
    }
  }
  return () => authLostListeners.delete(listener);
}

export function addDashboardAuthRecoveredListener(listener: AuthRecoveredListener): () => void {
  authRecoveredListeners.add(listener);
  return () => authRecoveredListeners.delete(listener);
}

function notifyAuthLost(reason: DashboardAuthLostReason, path: string): void {
  const event: DashboardAuthLostEvent = { reason, path, at: Date.now() };
  lastAuthLostEvent = event;
  for (const listener of authLostListeners) {
    try {
      listener(event);
    } catch {
      // Listeners must not break the fetch pipeline.
    }
  }
}

function notifyAuthRecovered(): void {
  lastAuthLostEvent = null;
  if (authRecoveredListeners.size === 0) {
    return;
  }
  for (const listener of authRecoveredListeners) {
    try {
      listener();
    } catch {
      // Listeners must not break the fetch pipeline.
    }
  }
}

/**
 * Test-only reset. Production code never calls this; tests use it to ensure
 * listeners and the cached last-event from one case don't leak into the next.
 */
export function __resetDashboardAuthListenersForTesting(): void {
  authLostListeners.clear();
  authRecoveredListeners.clear();
  lastAuthLostEvent = null;
}

/**
 * Persist a freshly-entered dashboard auth token to localStorage and notify
 * subscribers (useGateway's `argent:gateway-token-updated` listener) so the
 * WS connection picks it up without a page reload. Used by `AuthLostBanner`
 * after the user pastes a recovery token from `~/.argent/argent.json`.
 *
 * Mirrors the shape App.tsx's `persistGatewayToken` writes so the two stay
 * compatible — both merge `token` into whatever the existing blob holds.
 */
export function persistDashboardApiToken(token: string): void {
  const trimmed = token.trim();
  if (!trimmed) {
    return;
  }
  try {
    const raw = localStorage.getItem(DASHBOARD_CONTROL_SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed.token = trimmed;
    localStorage.setItem(DASHBOARD_CONTROL_SETTINGS_KEY, JSON.stringify(parsed));
  } catch {
    // Quota / security errors — banner stays visible; user can also reopen
    // the dashboard via a tokenized URL as documented in the banner copy.
    return;
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent("argent:gateway-token-updated", { detail: { token: trimmed } }),
      );
    } catch {
      // Old browsers without CustomEvent support — non-fatal.
    }
  }
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

interface AuthInjection {
  init: RequestInit;
  tokenAttached: boolean;
  failureReason: DashboardApiTokenFailureReason;
}

function withDashboardApiAuth(init: RequestInit = {}): AuthInjection {
  const resolution = resolveDashboardApiTokenDetailed();
  if (!resolution.token) {
    return { init, tokenAttached: false, failureReason: resolution.reason };
  }
  const headers = new Headers(init.headers ?? undefined);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${resolution.token}`);
  }
  return {
    init: { ...init, headers },
    tokenAttached: true,
    failureReason: resolution.reason,
  };
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

/**
 * Inspect a `fetchLocalApi` response and fire the appropriate auth event.
 * Centralised so all the fallback paths (direct, alternate-loopback) go
 * through the same notification logic.
 */
function observeAuthStatus(response: Response, path: string, injection: AuthInjection): Response {
  if (response.status === 401) {
    const reason: DashboardAuthLostReason = injection.tokenAttached
      ? "rejected"
      : injection.failureReason === "ok"
        ? "absent"
        : injection.failureReason;
    notifyAuthLost(reason, path);
  } else if (response.ok && injection.tokenAttached) {
    // Successful, authenticated response — banner can self-dismiss.
    notifyAuthRecovered();
  }
  return response;
}

export async function fetchLocalApi(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const direct = directDashboardApiUrl(path);
  const alt = alternateLoopbackUrl(path);
  const injection = withDashboardApiAuth(init);
  const directInit = injection.init;
  const preferDirect = isNativeShell() && direct;
  if (preferDirect) {
    try {
      const response = await fetchWithTimeout(direct, directInit, timeoutMs);
      return observeAuthStatus(response, path, injection);
    } catch (directErr) {
      try {
        const response = await fetchWithTimeout(path, init, timeoutMs);
        return observeAuthStatus(response, path, injection);
      } catch {
        if (!alt) {
          throw directErr;
        }
        try {
          const response = await fetchWithTimeout(alt, init, timeoutMs);
          return observeAuthStatus(response, path, injection);
        } catch {
          throw directErr;
        }
      }
    }
  }
  // Always include auth headers — api-server may require DASHBOARD_API_TOKEN
  const authedInit = injection.init;
  try {
    const response = await fetchWithTimeout(path, authedInit, timeoutMs);
    return observeAuthStatus(response, path, injection);
  } catch (primaryErr) {
    if (direct) {
      try {
        const response = await fetchWithTimeout(direct, directInit, timeoutMs);
        return observeAuthStatus(response, path, injection);
      } catch {
        // fall through to alternate loopback handling below
      }
    }
    if (!alt) {
      throw primaryErr;
    }
    try {
      const response = await fetchWithTimeout(alt, init, timeoutMs);
      return observeAuthStatus(response, path, injection);
    } catch {
      throw primaryErr;
    }
  }
}
