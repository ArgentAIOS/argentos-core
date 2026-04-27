const DEFAULT_TIMEOUT_MS = 10_000;

type WebKitMessageHandlerWindow = Window & {
  webkit?: {
    messageHandlers?: Record<string, unknown>;
  };
};

function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as WebKitMessageHandlerWindow).webkit?.messageHandlers);
}

function dashboardApiTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  // Accept both api_token (explicit) and token (gateway token — used for both WS and API)
  const token = (params.get("api_token") ?? params.get("token"))?.trim();
  return token ? token : null;
}

function directDashboardApiUrl(path: string): string | null {
  if (typeof window === "undefined") return null;
  if (!path.startsWith("/")) return null;
  return `http://${window.location.hostname}:9242${path}`;
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
  if (!timeoutMs || timeoutMs <= 0) return fetch(input, init);
  const controller = new AbortController();
  const upstream = init.signal;
  const onAbort = () => controller.abort();

  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener("abort", onAbort, { once: true });
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
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
  const directInit = withDashboardApiAuth(init);
  const preferDirect = isNativeShell() && direct;
  if (preferDirect) {
    try {
      return await fetchWithTimeout(direct, directInit, timeoutMs);
    } catch (directErr) {
      try {
        return await fetchWithTimeout(path, init, timeoutMs);
      } catch {
        if (!alt) throw directErr;
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
    if (!alt) throw primaryErr;
    try {
      return await fetchWithTimeout(alt, init, timeoutMs);
    } catch {
      throw primaryErr;
    }
  }
}
