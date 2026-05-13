import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import { readResponseText, resolveTimeoutSeconds, withTimeout } from "./web-shared.js";

/**
 * TinyFish Browser API — low-level remote browser session.
 *
 * The TinyFish Browser API exposes a remote Chrome instance reachable via the
 * Chrome DevTools Protocol (CDP) / Playwright. argent does NOT wrap Playwright
 * itself — it returns the `cdp_url` so the agent (or a higher-level tool) can
 * connect via `chromium.connect_over_cdp(cdp_url)`.
 *
 * Endpoint: POST https://api.browser.tinyfish.ai
 * Auth:     X-API-Key: $TINYFISH_API_KEY
 * Body:     { url?: string }   // optional initial page to navigate
 * Response: { session_id, cdp_url, base_url }
 *
 * Sessions auto-terminate after 1 hour of inactivity; there is no explicit
 * delete/close endpoint. The `tinyfish_browser_close` tool surfaces that
 * behavior cleanly so the agent doesn't try to make a non-existent API call.
 *
 * Pricing: Browser is part of the paid Agent/Browser surface (Search + Fetch
 * remain free). A clear 402/403 error is surfaced when the free-tier wall is
 * hit.
 */

export const DEFAULT_TINYFISH_BROWSER_BASE_URL = "https://api.browser.tinyfish.ai";
const DEFAULT_BROWSER_TIMEOUT_SECONDS = 90; // session startup is 10–30s; docs recommend ≥60s

type TinyFishBrowserConfig = {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  timeoutSeconds?: number;
};

type TinyFishBrowserSessionResponse = {
  session_id?: string;
  cdp_url?: string;
  base_url?: string;
};

const BrowserOpenSchema = Type.Object({
  url: Type.Optional(
    Type.String({
      description:
        "Optional initial URL the remote browser should navigate to. The response returns before navigation completes.",
    }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({
      description:
        "HTTP timeout in seconds for the session-create request. Session startup typically takes 10–30s; default 90.",
      minimum: 10,
      maximum: 600,
    }),
  ),
});

const BrowserCloseSchema = Type.Object({
  session_id: Type.String({
    description: "Session ID returned from tinyfish_browser_open.",
  }),
});

type WebToolsConfig = NonNullable<ArgentConfig["tools"]>["web"];

function resolveBrowserConfig(cfg?: ArgentConfig): TinyFishBrowserConfig {
  // Reuse the same TinyFish config scope as fetch so we don't churn the
  // config schema for this additive tool. Operators can still set apiKey via
  // env (TINYFISH_API_KEY) — that's the documented, recommended path.
  const web = cfg?.tools?.web as WebToolsConfig | undefined;
  const fetchCfg = web?.fetch as { tinyfish?: TinyFishBrowserConfig } | undefined;
  const tinyfish = fetchCfg?.tinyfish;
  if (!tinyfish || typeof tinyfish !== "object") {
    return {};
  }
  return tinyfish;
}

function normalizeApiKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveBrowserApiKey(params: {
  browser?: TinyFishBrowserConfig;
  cfg?: ArgentConfig;
  agentSessionKey?: string;
}): string | undefined {
  // Dashboard service keys take precedence (consistent with web_search /
  // web_fetch TinyFish key resolution).
  const fromServiceKeys = resolveServiceKey("TINYFISH_API_KEY", params.cfg, {
    sessionKey: params.agentSessionKey,
    source: "tinyfish_browser",
  });
  if (fromServiceKeys) {
    return fromServiceKeys.trim();
  }
  const fromConfig = normalizeApiKey(params.browser?.apiKey);
  if (fromConfig) {
    return fromConfig;
  }
  const fromEnv = normalizeApiKey(process.env.TINYFISH_API_KEY);
  return fromEnv || undefined;
}

export function resolveBrowserBaseUrl(browser?: TinyFishBrowserConfig): string {
  const raw = browser && typeof browser.baseUrl === "string" ? browser.baseUrl.trim() : "";
  return (raw || DEFAULT_TINYFISH_BROWSER_BASE_URL).replace(/\/+$/, "");
}

function missingBrowserKeyPayload() {
  return {
    error: "missing_tinyfish_api_key",
    message:
      "tinyfish_browser needs a TinyFish API key. Set TINYFISH_API_KEY in the Gateway environment, or configure tools.web.fetch.tinyfish.apiKey. Get a key at https://agent.tinyfish.ai/api-keys.",
    docs: "https://docs.tinyfish.ai/browser-api",
  };
}

function paidTierWallPayload(status: number, detail: string) {
  return {
    error: "tinyfish_browser_paid_tier_required",
    status,
    message:
      "TinyFish Browser is part of the paid Agent/Browser surface (Search + Fetch remain free). " +
      "Upgrade your TinyFish account at https://agent.tinyfish.ai to enable Browser. " +
      (detail ? `Server detail: ${detail}` : ""),
    docs: "https://docs.tinyfish.ai/browser-api",
  };
}

export async function openTinyFishBrowserSession(params: {
  apiKey: string;
  baseUrl: string;
  url?: string;
  timeoutSeconds: number;
}): Promise<
  | {
      ok: true;
      session_id: string;
      cdp_url: string;
      base_url: string;
      status: number;
    }
  | {
      ok: false;
      status: number;
      detail: string;
      paidWall: boolean;
    }
> {
  const endpoint = `${params.baseUrl.replace(/\/+$/, "")}/`;
  const body: Record<string, unknown> = {};
  if (params.url) {
    body.url = params.url;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": params.apiKey,
    },
    body: JSON.stringify(body),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    const paidWall = res.status === 402 || res.status === 403;
    return { ok: false, status: res.status, detail, paidWall };
  }

  const data = (await res.json()) as TinyFishBrowserSessionResponse;
  if (!data.session_id || !data.cdp_url) {
    return {
      ok: false,
      status: res.status,
      detail: `TinyFish Browser returned an incomplete session payload: ${JSON.stringify(data)}`,
      paidWall: false,
    };
  }
  return {
    ok: true,
    session_id: data.session_id,
    cdp_url: data.cdp_url,
    base_url: data.base_url ?? "",
    status: res.status,
  };
}

export function createTinyFishBrowserOpenTool(options?: {
  config?: ArgentConfig;
  agentSessionKey?: string;
}): AnyAgentTool {
  const browser = resolveBrowserConfig(options?.config);
  const baseUrl = resolveBrowserBaseUrl(browser);

  return {
    label: "TinyFish Browser (open)",
    name: "tinyfish_browser_open",
    description:
      "Open a remote TinyFish browser session for direct Playwright/CDP control. Returns a CDP WebSocket URL the agent (or a higher-level tool) can connect to via `chromium.connect_over_cdp(cdp_url)`. Use this when you need full browser automation (JS execution, anti-bot bypass, complex DOM interaction) that web_fetch can't handle. Browser is a paid feature; web_search and web_fetch remain free. Sessions auto-terminate after 1 hour of inactivity.",
    parameters: BrowserOpenSchema,
    execute: async (_toolCallId, args) => {
      const apiKey = resolveBrowserApiKey({
        browser,
        cfg: options?.config,
        agentSessionKey: options?.agentSessionKey,
      });
      if (!apiKey) {
        return jsonResult(missingBrowserKeyPayload());
      }
      const params = (args ?? {}) as Record<string, unknown>;
      const url = readStringParam(params, "url");
      const timeoutSecondsParam = readNumberParam(params, "timeoutSeconds", { integer: true });
      const timeoutSeconds = resolveTimeoutSeconds(
        timeoutSecondsParam ?? browser.timeoutSeconds,
        DEFAULT_BROWSER_TIMEOUT_SECONDS,
      );

      const start = Date.now();
      let result;
      try {
        result = await openTinyFishBrowserSession({
          apiKey,
          baseUrl,
          url,
          timeoutSeconds,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResult({
          error: "tinyfish_browser_request_failed",
          message: `TinyFish Browser request failed: ${message}`,
          docs: "https://docs.tinyfish.ai/browser-api",
        });
      }

      if (!result.ok) {
        if (result.paidWall) {
          return jsonResult(paidTierWallPayload(result.status, result.detail));
        }
        return jsonResult({
          error: "tinyfish_browser_error",
          status: result.status,
          message: `TinyFish Browser API error (${result.status}): ${result.detail || "request failed"}`,
          docs: "https://docs.tinyfish.ai/browser-api",
        });
      }

      return jsonResult({
        provider: "tinyfish",
        session_id: result.session_id,
        // Playwright connects here via chromium.connect_over_cdp(cdp_url).
        cdp_url: result.cdp_url,
        // base_url is for polling /pages — do NOT use for Playwright.
        base_url: result.base_url,
        initialUrl: url,
        // Sessions auto-terminate after 1 hour of inactivity per TinyFish docs.
        expires_in_seconds: 3600,
        tookMs: Date.now() - start,
        note: "Sessions auto-terminate after 1 hour of inactivity. There is no explicit close endpoint; call tinyfish_browser_close for parity (it returns a no-op acknowledgement).",
        docs: "https://docs.tinyfish.ai/browser-api",
      });
    },
  };
}

export function createTinyFishBrowserCloseTool(_options?: {
  config?: ArgentConfig;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "TinyFish Browser (close)",
    name: "tinyfish_browser_close",
    description:
      "Acknowledge a TinyFish browser session as no-longer-needed. NOTE: the TinyFish Browser API has no explicit close/delete endpoint — sessions auto-terminate after 1 hour of inactivity. This tool exists for symmetry with tinyfish_browser_open; it does not make a network call.",
    parameters: BrowserCloseSchema,
    execute: async (_toolCallId, args) => {
      const params = (args ?? {}) as Record<string, unknown>;
      const sessionId = readStringParam(params, "session_id", { required: true });
      return jsonResult({
        provider: "tinyfish",
        session_id: sessionId,
        closed: false,
        autoCleanup: true,
        message:
          "TinyFish Browser has no explicit close endpoint. Sessions auto-terminate after 1 hour of inactivity. Stop using the cdp_url to release the session.",
        docs: "https://docs.tinyfish.ai/browser-api",
      });
    },
  };
}

export const __testing = {
  resolveBrowserApiKey,
  resolveBrowserBaseUrl,
  resolveBrowserConfig,
  openTinyFishBrowserSession,
  DEFAULT_TINYFISH_BROWSER_BASE_URL,
} as const;
