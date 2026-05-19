/**
 * MSP Tool Framework — shared foundation for all MSP-oriented tools.
 *
 * Provides:
 * - Base MSPTool interface with typed config and actions
 * - Authentication layer (API key resolution from service-keys.json + env)
 * - Retry logic with exponential backoff + jitter
 * - Error normalization (Atera, Quickbooks, etc. → unified error shape)
 * - Audit logging (tool call, action, result, duration, caller)
 * - Rate-limit awareness (429 detection + backoff)
 *
 * Usage:
 *   const tool = createMSPTool<AteraConfig, AteraActions>({
 *     name: "atera_tickets",
 *     label: "Atera Tickets",
 *     description: "...",
 *     resolveConfig: () => loadAteraConfig(),
 *     actions: { list: listTickets, search: searchTickets },
 *   });
 */

import type { AgentToolResult } from "../../agent-core/core.js";
import type { AnyAgentTool } from "./common.js";

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface MSPToolConfig {
  /** Resolved API key (decrypted from service-keys.json or env var). */
  apiKey: string;
  /** Human-readable service name for error messages. */
  serviceName: string;
  /** Optional operator context (technician ID, account, etc.). */
  operatorContext?: Record<string, unknown>;
}

export interface MSPToolCallContext {
  /** Which action was invoked. */
  action: string;
  /** Tool name. */
  toolName: string;
  /** Caller agent ID or session key (when available). */
  callerAgentId?: string;
  /** Timestamp when tool call started. */
  startedAt: number;
  /** Raw params passed by the LLM. */
  rawParams: Record<string, unknown>;
}

export interface MSPToolAuditEntry {
  toolName: string;
  action: string;
  success: boolean;
  durationMs: number;
  startedAt: string;
  error?: string;
  resultSummary?: string;
  callerAgentId?: string;
}

export type MSPActionHandler<TConfig extends MSPToolConfig> = (
  params: Record<string, unknown>,
  config: TConfig,
  ctx: MSPToolCallContext,
) => Promise<AgentToolResult<unknown>>;

export interface MSPToolDefinition<TConfig extends MSPToolConfig> {
  /** Tool name exposed to the agent (e.g. "atera_tickets"). */
  name: string;
  /** Display label. */
  label: string;
  /** Description shown to the LLM. */
  description: string;
  /** JSON schema for tool parameters. */
  parameters: Record<string, unknown>;
  /** Resolve config at call time (API key, operator context). */
  resolveConfig: () => TConfig | Promise<TConfig>;
  /** Map of action name → handler function. */
  actions: Record<string, MSPActionHandler<TConfig>>;
  /** Default action if "action" param is omitted. */
  defaultAction?: string;
  /** Retry policy override (default: 3 retries with exponential backoff). */
  retryPolicy?: RetryPolicy;
  /** Called after each tool execution for audit/observability. */
  onAudit?: (entry: MSPToolAuditEntry) => void;
}

// ────────────────────────────────────────────────────────────────
// Retry Logic
// ────────────────────────────────────────────────────────────────

export interface RetryPolicy {
  /** Max retry attempts (default: 3). */
  maxRetries: number;
  /** Base delay in ms before first retry (default: 500). */
  baseDelayMs: number;
  /** Maximum delay cap in ms (default: 10000). */
  maxDelayMs: number;
  /** Jitter factor 0-1 (default: 0.3). */
  jitterFactor: number;
  /** HTTP status codes that trigger a retry (default: [429, 500, 502, 503, 504]). */
  retryableStatusCodes: number[];
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  jitterFactor: 0.3,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

/**
 * Compute backoff delay with jitter.
 */
function computeBackoff(attempt: number, policy: RetryPolicy): number {
  const exponential = policy.baseDelayMs * 2 ** attempt;
  const capped = Math.min(exponential, policy.maxDelayMs);
  const jitter = capped * policy.jitterFactor * Math.random();
  return capped + jitter;
}

/**
 * Determine if an error is retryable based on the retry policy.
 */
export function isRetryableError(error: unknown, policy: RetryPolicy): boolean {
  if (error instanceof MSPApiError) {
    return policy.retryableStatusCodes.includes(error.statusCode);
  }
  // Network errors (fetch failures, timeouts)
  if (error instanceof TypeError && String(error.message).includes("fetch")) {
    return true;
  }
  return false;
}

/**
 * Execute a function with retry logic.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < policy.maxRetries && isRetryableError(err, policy)) {
        const delay = computeBackoff(attempt, policy);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError; // unreachable but satisfies TS
}

// ────────────────────────────────────────────────────────────────
// Error Handling
// ────────────────────────────────────────────────────────────────

/**
 * Normalized API error for MSP services.
 */
export class MSPApiError extends Error {
  readonly statusCode: number;
  readonly service: string;
  readonly endpoint: string;
  readonly responseBody: string;
  readonly isRateLimited: boolean;
  readonly isAuthError: boolean;

  constructor(params: {
    service: string;
    endpoint: string;
    statusCode: number;
    statusText: string;
    body: string;
  }) {
    const truncatedBody = params.body.slice(0, 300);
    super(
      `${params.service} API ${params.statusCode}: ${params.statusText} — ${truncatedBody} [${params.endpoint}]`,
    );
    this.name = "MSPApiError";
    this.statusCode = params.statusCode;
    this.service = params.service;
    this.endpoint = params.endpoint;
    this.responseBody = truncatedBody;
    this.isRateLimited = params.statusCode === 429;
    this.isAuthError = params.statusCode === 401 || params.statusCode === 403;
  }
}

/**
 * Standard fetch wrapper for MSP API calls.
 * Handles: response parsing, error normalization, retry-ready error classification.
 */
export async function mspFetch(params: {
  url: string;
  service: string;
  apiKey: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  retryPolicy?: RetryPolicy;
}): Promise<unknown> {
  const { url, service, apiKey, method = "GET", body, headers = {}, retryPolicy } = params;
  const policy = retryPolicy ?? DEFAULT_RETRY_POLICY;

  return withRetry(async () => {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const responseBody = await res.text().catch(() => "");
      throw new MSPApiError({
        service,
        endpoint: url,
        statusCode: res.status,
        statusText: res.statusText,
        body: responseBody,
      });
    }

    const text = await res.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }, policy);
}

// ────────────────────────────────────────────────────────────────
// Authentication Layer
// ────────────────────────────────────────────────────────────────

/**
 * Resolve an API key from service-keys.json (with decryption) or env var.
 * This matches the pattern used in the Atera plugin.
 */
export function resolveServiceApiKey(envVar: string): string | undefined {
  // Try service-keys.json first (dashboard-managed, encrypted)
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const keysPath = path.join(process.env.HOME ?? "/tmp", ".argentos", "service-keys.json");
    const raw = fs.readFileSync(keysPath, "utf-8");
    const store = JSON.parse(raw);
    const entry = (store.keys ?? []).find(
      (k: { variable: string; enabled?: boolean; value?: string }) =>
        k.variable === envVar && k.enabled !== false,
    );
    if (entry?.value) {
      const val = String(entry.value);
      if (val.startsWith("enc:v1:")) {
        return decryptServiceKey(val);
      }
      return val;
    }
  } catch {
    // Non-fatal — fall through to env var
  }

  // Fallback to environment variable
  return process.env[envVar];
}

/**
 * Decrypt an enc:v1:<iv>:<tag>:<ciphertext> value using the macOS keychain master key.
 */
function decryptServiceKey(val: string): string | undefined {
  try {
    const crypto = require("node:crypto");
    const { execSync } = require("node:child_process");
    const masterKeyHex = execSync(
      'security find-generic-password -s "ArgentOS-MasterKey" -a "ArgentOS" -w',
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const key = Buffer.from(masterKeyHex, "hex");
    const parts = val.slice(7).split(":");
    if (parts.length === 3) {
      const [ivHex, authTagHex, cipherHex] = parts;
      const iv = Buffer.from(ivHex!, "hex");
      const authTag = Buffer.from(authTagHex!, "hex");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(cipherHex!, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    }
  } catch {
    // Decryption failed
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────────
// Audit Logging
// ────────────────────────────────────────────────────────────────

/** In-memory audit ring buffer (last 200 entries). */
const AUDIT_BUFFER: MSPToolAuditEntry[] = [];
const AUDIT_BUFFER_MAX = 200;

/**
 * Record an audit entry for a tool call.
 */
export function recordAudit(entry: MSPToolAuditEntry): void {
  AUDIT_BUFFER.push(entry);
  if (AUDIT_BUFFER.length > AUDIT_BUFFER_MAX) {
    AUDIT_BUFFER.shift();
  }
}

/**
 * Get recent audit entries, optionally filtered by tool name.
 */
export function getAuditLog(filter?: { toolName?: string; limit?: number }): MSPToolAuditEntry[] {
  let entries = AUDIT_BUFFER;
  if (filter?.toolName) {
    entries = entries.filter((e) => e.toolName === filter.toolName);
  }
  const limit = filter?.limit ?? 50;
  return entries.slice(-limit);
}

/**
 * Get audit stats: call count, error count, avg duration per tool.
 */
export function getAuditStats(): Record<
  string,
  { calls: number; errors: number; avgDurationMs: number }
> {
  const stats: Record<string, { calls: number; errors: number; totalMs: number }> = {};
  for (const entry of AUDIT_BUFFER) {
    const key = entry.toolName;
    if (!stats[key]) {
      stats[key] = { calls: 0, errors: 0, totalMs: 0 };
    }
    stats[key].calls++;
    if (!entry.success) stats[key].errors++;
    stats[key].totalMs += entry.durationMs;
  }

  const result: Record<string, { calls: number; errors: number; avgDurationMs: number }> = {};
  for (const [key, val] of Object.entries(stats)) {
    result[key] = {
      calls: val.calls,
      errors: val.errors,
      avgDurationMs: val.calls > 0 ? Math.round(val.totalMs / val.calls) : 0,
    };
  }
  return result;
}

// ────────────────────────────────────────────────────────────────
// MSP Tool Factory
// ────────────────────────────────────────────────────────────────

/**
 * Create a standardized MSP tool with built-in auth, retry, error handling, and audit logging.
 *
 * Usage:
 * ```ts
 * const tool = createMSPTool({
 *   name: "atera_tickets",
 *   label: "Atera Tickets",
 *   description: "Query Atera tickets",
 *   parameters: AteraTicketSchema,
 *   resolveConfig: loadAteraConfig,
 *   actions: {
 *     list: async (params, config, ctx) => { ... },
 *     search: async (params, config, ctx) => { ... },
 *   },
 *   defaultAction: "list",
 * });
 * ```
 */
export function createMSPTool<TConfig extends MSPToolConfig>(
  def: MSPToolDefinition<TConfig>,
): AnyAgentTool {
  return {
    label: def.label,
    name: def.name,
    description: def.description,
    parameters: def.parameters as any,
    execute: async (toolCallId: string, args: Record<string, unknown>) => {
      const startedAt = Date.now();
      const action =
        (typeof args.action === "string" ? args.action : undefined) ?? def.defaultAction ?? "list";

      const ctx: MSPToolCallContext = {
        action,
        toolName: def.name,
        startedAt,
        rawParams: args,
      };

      let success = false;
      let errorMsg: string | undefined;
      let resultSummary: string | undefined;

      try {
        // Resolve config (includes API key auth)
        const config = await def.resolveConfig();

        if (!config.apiKey) {
          return textResult(
            `Error: ${config.serviceName} API key not configured. Add it via the dashboard or service-keys.json.`,
          );
        }

        // Find action handler
        const handler = def.actions[action];
        if (!handler) {
          const available = Object.keys(def.actions).join(", ");
          return textResult(`Unknown action: "${action}". Available: ${available}`);
        }

        // Execute with retry (handler can throw MSPApiError for retryable failures)
        const result = await handler(args, config, ctx);
        success = true;
        resultSummary = truncateResultSummary(result);
        return result;
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);

        // Classify error for user-friendly message
        if (err instanceof MSPApiError) {
          if (err.isRateLimited) {
            return textResult(`${def.label}: Rate limited (429). Try again in a few seconds.`);
          }
          if (err.isAuthError) {
            return textResult(
              `${def.label}: Authentication failed (${err.statusCode}). Check API key.`,
            );
          }
          return textResult(`${def.label} API error: ${err.message}`);
        }

        return textResult(`${def.label} error: ${errorMsg}`);
      } finally {
        const durationMs = Date.now() - startedAt;
        const auditEntry: MSPToolAuditEntry = {
          toolName: def.name,
          action,
          success,
          durationMs,
          startedAt: new Date(startedAt).toISOString(),
          error: errorMsg,
          resultSummary,
          callerAgentId: ctx.callerAgentId,
        };
        recordAudit(auditEntry);
        def.onAudit?.(auditEntry);
      }
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }] };
}

function truncateResultSummary(result: AgentToolResult<unknown>): string {
  const firstText = result.content?.find((c) => c.type === "text");
  if (firstText && "text" in firstText) {
    return String(firstText.text).slice(0, 100);
  }
  return "(non-text result)";
}

/**
 * Re-export default retry policy for tool implementors that need to customize.
 */
export { DEFAULT_RETRY_POLICY };
