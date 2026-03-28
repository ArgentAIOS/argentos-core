const DEFAULT_TIMEOUT_MS = 10_000;
const CONTROL_SETTINGS_KEY = "argent.control.settings.v1";
const nativeFetch = globalThis.fetch.bind(globalThis);

function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.webkit?.messageHandlers);
}

function dashboardApiTokenFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONTROL_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown };
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    return token || null;
  } catch {
    return null;
  }
}

function dashboardApiTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  // Accept both api_token (explicit) and token (gateway token — used for both WS and API)
  const token = (params.get("api_token") ?? params.get("token"))?.trim();
  return token || dashboardApiTokenFromStorage();
}

function directDashboardApiUrl(path: string): string | null {
  if (typeof window === "undefined") return null;
  if (!path.startsWith("/")) return null;
  return `http://${window.location.hostname}:9242${path}`;
}

function normalizeLocalApiPath(input: RequestInfo | URL): string | null {
  if (typeof window === "undefined") return null;

  if (typeof input === "string") {
    if (input.startsWith("/api")) return input;
    try {
      const url = new URL(input, window.location.href);
      if (url.origin === window.location.origin && url.pathname.startsWith("/api")) {
        return `${url.pathname}${url.search}`;
      }
    } catch {
      return null;
    }
    return null;
  }

  if (input instanceof URL) {
    return input.origin === window.location.origin && input.pathname.startsWith("/api")
      ? `${input.pathname}${input.search}`
      : null;
  }

  try {
    const url = new URL(input.url, window.location.href);
    if (url.origin === window.location.origin && url.pathname.startsWith("/api")) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    return null;
  }

  return null;
}

function withDashboardApiAuth(init: RequestInit = {}): RequestInit {
  const token = dashboardApiTokenFromUrl();
  if (!token) return init;
  const headers = new Headers(init.headers ?? undefined);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return { ...init, headers };
}

function alternateLoopbackUrl(path: string): string | null {
  if (typeof window === "undefined") return null;
  if (!path.startsWith("/")) return null;
  // In dev mode (Vite proxy), both localhost and 127.0.0.1 route to the same
  // server, but the cross-origin fallback triggers browser CORS errors.
  // Only use the alternate in production where the api-server serves directly.
  if (import.meta.env?.DEV) return null;
  const { protocol, hostname, port } = window.location;
  const portPart = port ? `:${port}` : "";
  if (hostname === "localhost") return `${protocol}//127.0.0.1${portPart}${path}`;
  if (hostname === "127.0.0.1") return `${protocol}//localhost${portPart}${path}`;
  return null;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0) return nativeFetch(input, init);
  const controller = new AbortController();
  const upstream = init.signal;
  const onAbort = () => controller.abort();

  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener("abort", onAbort, { once: true });
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await nativeFetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    if (upstream) upstream.removeEventListener("abort", onAbort);
  }
}

export async function fetchLocalApi(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const direct = directDashboardApiUrl(path);
  const alt = alternateLoopbackUrl(path);
  const authedInit = withDashboardApiAuth(init);
  const directInit = authedInit;
  const altInit = authedInit;
  const preferDirect = isNativeShell() && direct;
  if (preferDirect) {
    try {
      return await fetchWithTimeout(direct, directInit, timeoutMs);
    } catch (directErr) {
      try {
        return await fetchWithTimeout(path, authedInit, timeoutMs);
      } catch {
        if (!alt) throw directErr;
        try {
          return await fetchWithTimeout(alt, altInit, timeoutMs);
        } catch {
          throw directErr;
        }
      }
    }
  }
  // Always include auth headers — api-server may require DASHBOARD_API_TOKEN
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
    if (!alt) throw primaryErr;
    try {
      return await fetchWithTimeout(alt, altInit, timeoutMs);
    } catch {
      throw primaryErr;
    }
  }
}

let fetchShimInstalled = false;

export function installLocalApiFetchShim(): void {
  if (typeof window === "undefined" || fetchShimInstalled) return;
  fetchShimInstalled = true;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const localApiPath = normalizeLocalApiPath(input);
    if (!localApiPath) {
      return nativeFetch(input, init);
    }

    if (input instanceof Request && init === undefined) {
      const cloned = input.clone();
      const method = cloned.method.toUpperCase();
      return fetchLocalApi(localApiPath, {
        method: cloned.method,
        headers: cloned.headers,
        body: method === "GET" || method === "HEAD" ? undefined : await cloned.blob(),
        cache: cloned.cache,
        credentials: cloned.credentials,
        integrity: cloned.integrity,
        keepalive: cloned.keepalive,
        mode: cloned.mode,
        redirect: cloned.redirect,
        referrer: cloned.referrer,
        referrerPolicy: cloned.referrerPolicy,
        signal: cloned.signal,
      });
    }

    return fetchLocalApi(localApiPath, init ?? {});
  }) as typeof globalThis.fetch;
}
