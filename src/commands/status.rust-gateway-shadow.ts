import { resolveFetch } from "../infra/fetch.js";

export const RUST_GATEWAY_SHADOW_DEFAULT_BASE_URL = "http://127.0.0.1:18799";
export const RUST_GATEWAY_SHADOW_DEFAULT_TIMEOUT_MS = 800;

export type RustGatewayShadowSummary = {
  reachable: boolean;
  status: string | null;
  version: string | null;
  uptimeSeconds: number | null;
  component: string | null;
  mode: string | null;
  protocolVersion: number | null;
  liveAuthority: string | null;
  gatewayAuthority: string | null;
  promotionReady: boolean | null;
  readinessReason: string | null;
  statePersistence: string | null;
  baseUrl: string;
  error: string | null;
};

export type RustGatewayShadowSummaryOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type RustGatewayHealthPayload = {
  status?: unknown;
  version?: unknown;
  uptimeSeconds?: unknown;
  component?: unknown;
  mode?: unknown;
  protocolVersion?: unknown;
  liveAuthority?: unknown;
  gatewayAuthority?: unknown;
  readiness?: unknown;
  capabilities?: unknown;
};

export async function getRustGatewayShadowSummary(
  options: RustGatewayShadowSummaryOptions = {},
): Promise<RustGatewayShadowSummary> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? RUST_GATEWAY_SHADOW_DEFAULT_BASE_URL);
  const fetchImpl = resolveFetch(options.fetchImpl);
  if (!fetchImpl) {
    return unavailable(baseUrl, "fetch is unavailable");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? RUST_GATEWAY_SHADOW_DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await fetchImpl(`${baseUrl}/health`, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      return unavailable(
        baseUrl,
        `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
      );
    }
    const payload = JSON.parse(text) as RustGatewayHealthPayload;
    const status = typeof payload.status === "string" ? payload.status : null;
    const version = typeof payload.version === "string" ? payload.version : null;
    const uptimeSeconds =
      typeof payload.uptimeSeconds === "number" && Number.isFinite(payload.uptimeSeconds)
        ? payload.uptimeSeconds
        : null;
    const protocolVersion =
      typeof payload.protocolVersion === "number" && Number.isFinite(payload.protocolVersion)
        ? payload.protocolVersion
        : null;
    const readiness = objectRecord(payload.readiness);
    const capabilities = objectRecord(payload.capabilities);
    const promotionReady =
      typeof readiness?.promotionReady === "boolean" ? readiness.promotionReady : null;
    const readinessReason =
      typeof readiness?.reason === "string" && readiness.reason ? readiness.reason : null;
    const statePersistence =
      typeof capabilities?.statePersistence === "string" ? capabilities.statePersistence : null;
    const component = typeof payload.component === "string" ? payload.component : null;
    const mode = typeof payload.mode === "string" ? payload.mode : null;
    const liveAuthority = typeof payload.liveAuthority === "string" ? payload.liveAuthority : null;
    const gatewayAuthority =
      typeof payload.gatewayAuthority === "string" ? payload.gatewayAuthority : null;
    if (status !== "ok") {
      return {
        reachable: false,
        status,
        version,
        uptimeSeconds,
        component,
        mode,
        protocolVersion,
        liveAuthority,
        gatewayAuthority,
        promotionReady,
        readinessReason,
        statePersistence,
        baseUrl,
        error: status ? `unexpected health status: ${status}` : "missing health status",
      };
    }
    return {
      reachable: true,
      status,
      version,
      uptimeSeconds,
      component,
      mode,
      protocolVersion,
      liveAuthority,
      gatewayAuthority,
      promotionReady,
      readinessReason,
      statePersistence,
      baseUrl,
      error: null,
    };
  } catch (error) {
    return unavailable(baseUrl, error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(baseUrl: string, error: string): RustGatewayShadowSummary {
  return {
    reachable: false,
    status: null,
    version: null,
    uptimeSeconds: null,
    component: null,
    mode: null,
    protocolVersion: null,
    liveAuthority: null,
    gatewayAuthority: null,
    promotionReady: null,
    readinessReason: null,
    statePersistence: null,
    baseUrl,
    error,
  };
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
