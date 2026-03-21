/**
 * CORS-aware fetch wrapper.
 *
 * On CORS/network error, routes through /api/proxy/cors.
 * If the domain isn't allowlisted (403), fires the approval callback.
 */

type CorsApprovalCallback = (domain: string) => Promise<boolean>;

let approvalCallback: CorsApprovalCallback | null = null;

/** Register the approval callback (called from App.tsx) */
export function setCorsApprovalCallback(cb: CorsApprovalCallback) {
  approvalCallback = cb;
}

/** Domains known to lack CORS headers — skip direct fetch, go straight to proxy. */
const PROXY_ONLY_DOMAINS = new Set(["api.silverintel.report"]);

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const onAbort = () => controller.abort();
  if (externalSignal?.aborted) {
    controller.abort();
  } else if (externalSignal) {
    externalSignal.addEventListener("abort", onAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onAbort);
    }
  }
}

async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout("/api/proxy/cors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      method: init?.method || "GET",
      headers: init?.headers || {},
      body: init?.body ?? undefined,
    }),
  });
}

export async function corsFetch(url: string, init?: RequestInit): Promise<Response> {
  const domain = extractDomain(url);

  // Skip direct fetch for domains known to lack CORS headers
  if (domain && PROXY_ONLY_DOMAINS.has(domain)) {
    const proxyRes = await proxyFetch(url, init);
    if (proxyRes.status !== 403) return proxyRes;
    // Fall through to approval flow if not allowlisted
    const directError = new Error(`CORS proxy returned 403 for ${domain}`);
    const errorData = await proxyRes.json().catch(() => ({}));
    const reportedDomain = errorData.domain || domain;
    if (approvalCallback) {
      const approved = await approvalCallback(reportedDomain);
      if (approved) {
        await fetchWithTimeout("/api/settings/cors-allowlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: reportedDomain, note: "Approved via dashboard" }),
        });
        return await proxyFetch(url, init);
      }
    }
    throw directError;
  }

  // Try direct fetch first
  try {
    const res = await fetchWithTimeout(url, init);
    return res;
  } catch (directError) {
    // Network/CORS error — fall through to proxy
    if (!domain) throw directError;

    console.log(`[corsFetch] Direct fetch failed for ${domain}, trying proxy...`);

    // Try through server-side proxy
    let proxyRes: Response;
    try {
      proxyRes = await proxyFetch(url, init);
    } catch (proxyError) {
      console.error("[corsFetch] Proxy fetch failed:", proxyError);
      throw directError;
    }

    // If proxy succeeded (domain was allowlisted), return the response
    if (proxyRes.status !== 403) {
      console.log(`[corsFetch] Proxy succeeded for ${domain} (status ${proxyRes.status})`);
      return proxyRes;
    }

    // Domain not in allowlist — ask operator for approval
    console.log(`[corsFetch] Domain ${domain} not allowlisted, requesting approval...`);
    const errorData = await proxyRes.json().catch(() => ({}));
    const reportedDomain = errorData.domain || domain;

    if (approvalCallback) {
      const approved = await approvalCallback(reportedDomain);
      if (approved) {
        // Add to server allowlist
        await fetchWithTimeout("/api/settings/cors-allowlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: reportedDomain, note: "Approved via dashboard" }),
        });
        // Retry through proxy
        const retryRes = await proxyFetch(url, init);
        console.log(`[corsFetch] Retry after approval: status ${retryRes.status}`);
        return retryRes;
      }
    } else {
      console.warn("[corsFetch] No approval callback registered — cannot prompt user");
    }

    // Not approved or no callback
    throw directError;
  }
}
