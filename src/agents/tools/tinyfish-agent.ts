import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { wrapWebContent } from "../../security/external-content.js";
import { stringEnum } from "../schema/typebox.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

function readBooleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}
import {
  DEFAULT_TIMEOUT_SECONDS,
  readResponseText,
  resolveTimeoutSeconds,
  withTimeout,
} from "./web-shared.js";

const BROWSER_PROFILES = ["lite", "stealth"] as const;
type BrowserProfile = (typeof BROWSER_PROFILES)[number];

const DEFAULT_AGENT_BASE_URL = "https://agent.tinyfish.ai";
const DEFAULT_AGENT_RUN_PATH = "/v1/automation/run";
const DEFAULT_AGENT_MAX_STEPS = 150;
const MAX_AGENT_MAX_STEPS = 500;
const DEFAULT_AGENT_TIMEOUT_SECONDS = 300;
const MAX_AGENT_TIMEOUT_SECONDS = 600; // hard cap so a hung run cannot block forever
const DEFAULT_BROWSER_PROFILE: BrowserProfile = "lite";

const TinyFishAgentSchema = Type.Object({
  goal: Type.String({
    description:
      "Plain-English description of what to accomplish on the target website (e.g., 'find the price of the cheapest non-stop flight from JFK to LAX on Friday and return it'). Required.",
    minLength: 1,
  }),
  url: Type.String({
    description:
      "Starting URL the agent should open. Required. The agent navigates from here using clicks, typing, and follow-up navigation as needed.",
  }),
  max_steps: Type.Optional(
    Type.Number({
      description:
        "Cap on the number of browser steps the agent may take (1-500). Defaults to the configured limit (150). Cannot exceed the configured tools.web.agent.maxSteps cap.",
      minimum: 1,
      maximum: MAX_AGENT_MAX_STEPS,
    }),
  ),
  browser_profile: Type.Optional(
    stringEnum(BROWSER_PROFILES, {
      description:
        'Browser execution mode. "lite" (fast, default) or "stealth" (harder for sites to detect; useful when "lite" gets blocked).',
    }),
  ),
  screenshots: Type.Optional(
    Type.Boolean({
      description: "Capture a screenshot at the end of the run (and at key steps).",
    }),
  ),
  snapshots: Type.Optional(
    Type.Boolean({
      description: "Capture DOM snapshots during the run.",
    }),
  ),
  recording: Type.Optional(
    Type.Boolean({
      description: "Record a screencast of the run.",
    }),
  ),
  webhook_url: Type.Optional(
    Type.String({
      description:
        "Optional HTTPS webhook to receive lifecycle events. Must be HTTPS — http:// is rejected by the TinyFish API.",
    }),
  ),
  timeout_seconds: Type.Optional(
    Type.Number({
      description:
        "Per-call timeout in seconds. Defaults to the configured timeout (300). Capped at 600 so a hung run can't block forever.",
      minimum: 1,
      maximum: MAX_AGENT_TIMEOUT_SECONDS,
    }),
  ),
});

type AgentConfig = NonNullable<NonNullable<ArgentConfig["tools"]>["web"]>["agent"];

type TinyFishAgentRunResponse = {
  run_id?: string | null;
  status?: "COMPLETED" | "FAILED" | string;
  started_at?: string | null;
  finished_at?: string | null;
  num_of_steps?: number | null;
  result?: unknown;
  schema_validation?: unknown;
  error?: {
    code?: string;
    message?: string;
    category?: string;
    retry_after?: number;
    help_url?: string;
    help_message?: string;
    details?: unknown;
  } | null;
};

function resolveAgentConfig(cfg?: ArgentConfig): AgentConfig | undefined {
  const agent = cfg?.tools?.web?.agent;
  if (!agent || typeof agent !== "object") {
    return undefined;
  }
  return agent;
}

function resolveAgentEnabled(agent: AgentConfig | undefined): boolean {
  if (typeof agent?.enabled === "boolean") {
    return agent.enabled;
  }
  return false;
}

function resolveAgentBaseUrl(agent: AgentConfig | undefined): string {
  const raw = typeof agent?.baseUrl === "string" ? agent.baseUrl.trim() : "";
  return (raw || DEFAULT_AGENT_BASE_URL).replace(/\/+$/, "");
}

function resolveAgentMaxStepsCap(agent: AgentConfig | undefined): number {
  const raw =
    typeof agent?.maxSteps === "number" && Number.isFinite(agent.maxSteps)
      ? agent.maxSteps
      : DEFAULT_AGENT_MAX_STEPS;
  const clamped = Math.max(1, Math.min(MAX_AGENT_MAX_STEPS, Math.floor(raw)));
  return clamped;
}

function resolveAgentBrowserProfile(agent: AgentConfig | undefined): BrowserProfile {
  const raw = typeof agent?.browserProfile === "string" ? agent.browserProfile : "";
  if (raw === "lite" || raw === "stealth") {
    return raw;
  }
  return DEFAULT_BROWSER_PROFILE;
}

function resolveAgentTimeoutCapSeconds(agent: AgentConfig | undefined): number {
  const raw =
    typeof agent?.timeoutSeconds === "number" && Number.isFinite(agent.timeoutSeconds)
      ? agent.timeoutSeconds
      : DEFAULT_AGENT_TIMEOUT_SECONDS;
  return Math.max(1, Math.min(MAX_AGENT_TIMEOUT_SECONDS, Math.floor(raw)));
}

function resolveAgentApiKey(params: {
  agent: AgentConfig | undefined;
  cfg?: ArgentConfig;
  agentSessionKey?: string;
}): string | undefined {
  const fromConfig =
    params.agent && typeof params.agent.apiKey === "string" ? params.agent.apiKey.trim() : "";
  if (fromConfig) {
    return fromConfig;
  }
  // Use the existing service-key resolver so dashboard-managed keys win over env.
  const fromService = resolveServiceKey("TINYFISH_API_KEY", params.cfg, {
    sessionKey: params.agentSessionKey,
    source: "tinyfish_agent",
  });
  if (fromService) {
    return fromService.trim();
  }
  const fromEnv = (process.env.TINYFISH_API_KEY ?? "").trim();
  return fromEnv || undefined;
}

function describeAgentTool(): string {
  return [
    "Run a natural-language browser-automation goal on a real website via the TinyFish Agent API.",
    "Use this when search + fetch aren't enough — e.g. multi-step flows that require clicks, form fills, or login-walled content.",
    "Provide a clear `goal` (what success looks like, what to extract) and a `url` to start from. The agent navigates the site and returns a structured result.",
    "Paid feature — runs are billed against your TinyFish account. The tool surfaces a clear error if your account lacks credits.",
  ].join(" ");
}

export type RunTinyFishAgentParams = {
  goal: string;
  url: string;
  apiKey: string;
  baseUrl: string;
  maxSteps: number;
  browserProfile: BrowserProfile;
  capture: {
    screenshots?: boolean;
    snapshots?: boolean;
    recording?: boolean;
    elements?: boolean;
  };
  webhookUrl?: string;
  timeoutSeconds: number;
};

export type RunTinyFishAgentResult = {
  status: string;
  run_id?: string;
  num_of_steps?: number;
  started_at?: string;
  finished_at?: string;
  result?: unknown;
  schema_validation?: unknown;
};

export async function runTinyFishAgent(
  params: RunTinyFishAgentParams,
): Promise<RunTinyFishAgentResult> {
  const endpoint = `${params.baseUrl.replace(/\/+$/, "")}${DEFAULT_AGENT_RUN_PATH}`;
  const captureFlags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(params.capture)) {
    if (typeof value === "boolean") {
      captureFlags[key] = value;
    }
  }
  const body: Record<string, unknown> = {
    url: params.url,
    goal: params.goal,
    browser_profile: params.browserProfile,
    agent_config: {
      max_steps: params.maxSteps,
    },
  };
  if (Object.keys(captureFlags).length > 0) {
    body.capture_config = captureFlags;
  }
  if (params.webhookUrl) {
    body.webhook_url = params.webhookUrl;
  }
  body.api_integration = "argentos";

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
    // Try to surface the structured TinyFish error, including the paid-tier nudge.
    const detail = await readResponseText(res);
    let parsedError: TinyFishAgentRunResponse["error"] | undefined;
    try {
      const parsed = detail ? (JSON.parse(detail) as TinyFishAgentRunResponse) : undefined;
      parsedError = parsed?.error ?? undefined;
    } catch {
      parsedError = undefined;
    }
    const code = parsedError?.code ?? `HTTP_${res.status}`;
    const message =
      parsedError?.message ??
      parsedError?.help_message ??
      detail ??
      res.statusText ??
      "request failed";
    const helpUrl = parsedError?.help_url;
    const err = new TinyFishAgentError({
      httpStatus: res.status,
      code,
      message,
      helpUrl,
    });
    throw err;
  }

  const data = (await res.json()) as TinyFishAgentRunResponse;
  const status = typeof data.status === "string" ? data.status : "UNKNOWN";
  return {
    status,
    run_id: typeof data.run_id === "string" ? data.run_id : undefined,
    num_of_steps: typeof data.num_of_steps === "number" ? data.num_of_steps : undefined,
    started_at: typeof data.started_at === "string" ? data.started_at : undefined,
    finished_at: typeof data.finished_at === "string" ? data.finished_at : undefined,
    result: data.result ?? undefined,
    schema_validation: data.schema_validation ?? undefined,
  };
}

export class TinyFishAgentError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly helpUrl?: string;
  constructor(params: { httpStatus: number; code: string; message: string; helpUrl?: string }) {
    super(params.message);
    this.name = "TinyFishAgentError";
    this.httpStatus = params.httpStatus;
    this.code = params.code;
    this.helpUrl = params.helpUrl;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isHttpsOnlyUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function createTinyFishAgentTool(options?: {
  config?: ArgentConfig;
  sandboxed?: boolean;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const agent = resolveAgentConfig(options?.config);
  if (!resolveAgentEnabled(agent)) {
    return null;
  }
  const baseUrl = resolveAgentBaseUrl(agent);
  const maxStepsCap = resolveAgentMaxStepsCap(agent);
  const defaultBrowserProfile = resolveAgentBrowserProfile(agent);
  const timeoutCapSeconds = resolveAgentTimeoutCapSeconds(agent);
  const captureDefaults = agent?.capture ?? {};

  return {
    label: "TinyFish Agent",
    name: "tinyfish_agent",
    description: describeAgentTool(),
    parameters: TinyFishAgentSchema,
    execute: async (_toolCallId, args) => {
      const apiKey = resolveAgentApiKey({
        agent,
        cfg: options?.config,
        agentSessionKey: options?.agentSessionKey,
      });
      if (!apiKey) {
        return jsonResult({
          error: "missing_tinyfish_api_key",
          message:
            "tinyfish_agent needs a TinyFish API key. Set TINYFISH_API_KEY in the Gateway environment or set tools.web.agent.apiKey. Get a key at https://agent.tinyfish.ai/api-keys.",
          docs: "https://docs.argent.ai/tools/web#tinyfish-agent",
        });
      }
      const params = args as Record<string, unknown>;
      let goal: string;
      let url: string;
      try {
        goal = readStringParam(params, "goal", { required: true });
        url = readStringParam(params, "url", { required: true });
      } catch (e) {
        return jsonResult({
          error: "invalid_input",
          message: e instanceof Error ? e.message : "goal and url are required",
        });
      }
      if (!isHttpsUrl(url)) {
        return jsonResult({
          error: "invalid_url",
          message: "url must be an absolute http:// or https:// URL.",
        });
      }
      const requestedMaxSteps = readNumberParam(params, "max_steps", { integer: true });
      const maxSteps =
        typeof requestedMaxSteps === "number"
          ? Math.max(1, Math.min(maxStepsCap, Math.floor(requestedMaxSteps)))
          : maxStepsCap;

      const rawBrowserProfile = readStringParam(params, "browser_profile");
      const browserProfile: BrowserProfile =
        rawBrowserProfile === "lite" || rawBrowserProfile === "stealth"
          ? rawBrowserProfile
          : defaultBrowserProfile;

      const requestedTimeout = readNumberParam(params, "timeout_seconds", { integer: true });
      const timeoutSeconds = (() => {
        const requested =
          typeof requestedTimeout === "number" ? Math.floor(requestedTimeout) : timeoutCapSeconds;
        const fallback = resolveTimeoutSeconds(requested, DEFAULT_TIMEOUT_SECONDS);
        return Math.max(1, Math.min(timeoutCapSeconds, fallback));
      })();

      const webhookUrl = readStringParam(params, "webhook_url");
      if (webhookUrl && !isHttpsOnlyUrl(webhookUrl)) {
        return jsonResult({
          error: "invalid_webhook_url",
          message: "webhook_url must be HTTPS.",
        });
      }

      const screenshots = readBooleanParam(params, "screenshots");
      const snapshots = readBooleanParam(params, "snapshots");
      const recording = readBooleanParam(params, "recording");
      const capture = {
        screenshots: screenshots ?? captureDefaults.screenshots,
        snapshots: snapshots ?? captureDefaults.snapshots,
        recording: recording ?? captureDefaults.recording,
        elements: captureDefaults.elements,
      };

      try {
        const data = await runTinyFishAgent({
          goal,
          url,
          apiKey,
          baseUrl,
          maxSteps,
          browserProfile,
          capture,
          webhookUrl,
          timeoutSeconds,
        });
        // Wrap the (potentially untrusted) extracted text in web-content guard
        // markers so prompt injection from the page can't masquerade as agent
        // output. result/schema_validation are returned untouched (structured).
        return jsonResult({
          provider: "tinyfish",
          status: data.status,
          success: data.status === "COMPLETED",
          run_id: data.run_id,
          num_of_steps: data.num_of_steps,
          started_at: data.started_at,
          finished_at: data.finished_at,
          goal: wrapWebContent(goal, "web_fetch"),
          starting_url: url,
          browser_profile: browserProfile,
          max_steps: maxSteps,
          result: data.result,
          schema_validation: data.schema_validation,
        });
      } catch (e) {
        if (e instanceof TinyFishAgentError) {
          // Map TinyFish's INSUFFICIENT_CREDITS to a clear upgrade nudge.
          const isPaidWall =
            e.code === "INSUFFICIENT_CREDITS" ||
            e.httpStatus === 402 ||
            (e.httpStatus === 403 && /credit|subscription|tier/i.test(e.message));
          if (isPaidWall) {
            return jsonResult({
              error: "tinyfish_agent_paid_feature",
              message:
                "TinyFish Agent runs are billed against your TinyFish account, and your account is out of credits or on an inactive subscription. Top up at https://agent.tinyfish.ai/billing — or disable tools.web.agent.enabled to remove this tool.",
              httpStatus: e.httpStatus,
              code: e.code,
              docs: e.helpUrl ?? "https://docs.tinyfish.ai/agent-api",
            });
          }
          if (e.httpStatus === 401) {
            return jsonResult({
              error: "tinyfish_agent_auth_failed",
              message:
                "TinyFish Agent rejected the API key (401). Regenerate at https://agent.tinyfish.ai/api-keys and update TINYFISH_API_KEY.",
              httpStatus: e.httpStatus,
              code: e.code,
            });
          }
          if (e.code === "RATE_LIMIT_EXCEEDED" || e.httpStatus === 429) {
            return jsonResult({
              error: "tinyfish_agent_rate_limited",
              message: "TinyFish Agent rate limit exceeded. Retry after a short delay.",
              httpStatus: e.httpStatus,
              code: e.code,
            });
          }
          return jsonResult({
            error: "tinyfish_agent_error",
            message: e.message,
            httpStatus: e.httpStatus,
            code: e.code,
            docs: e.helpUrl ?? "https://docs.tinyfish.ai/agent-api",
          });
        }
        const message = e instanceof Error ? e.message : String(e);
        const isTimeout = /aborted|timeout/i.test(message);
        return jsonResult({
          error: isTimeout ? "tinyfish_agent_timeout" : "tinyfish_agent_unexpected_error",
          message,
        });
      }
    },
  };
}

export const __testing = {
  resolveAgentApiKey,
  resolveAgentBaseUrl,
  resolveAgentBrowserProfile,
  resolveAgentConfig,
  resolveAgentEnabled,
  resolveAgentMaxStepsCap,
  resolveAgentTimeoutCapSeconds,
  runTinyFishAgent,
  isHttpsUrl,
  isHttpsOnlyUrl,
  DEFAULT_AGENT_BASE_URL,
  DEFAULT_AGENT_MAX_STEPS,
  DEFAULT_AGENT_TIMEOUT_SECONDS,
  MAX_AGENT_MAX_STEPS,
  MAX_AGENT_TIMEOUT_SECONDS,
} as const;
