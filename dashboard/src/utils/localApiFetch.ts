const DEFAULT_TIMEOUT_MS = 10_000;

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
  const alt = alternateLoopbackUrl(path);
  try {
    return await fetchWithTimeout(path, init, timeoutMs);
  } catch (primaryErr) {
    if (!alt) throw primaryErr;
    try {
      return await fetchWithTimeout(alt, init, timeoutMs);
    } catch {
      throw primaryErr;
    }
  }
}
