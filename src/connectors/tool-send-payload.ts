/**
 * tool-send-payload — Real Telegram dispatch helper.
 *
 * Replaces the `error_handler/standby` placeholder that was previously
 * returned for `tool-send-payload` workflow nodes (see
 * ops/artifacts/playwright/morning-brief/2026-05-06T1523/SUMMARY.md
 * capture (d) — all 33 captured runs returned standby instead of
 * delivering a Telegram message).
 *
 * The helper is intentionally narrow:
 *   - it only fires when `isToolSendPayloadNode(node)` is true,
 *   - it reads the bot token from the dashboard-managed service-keys store
 *     (`TELEGRAM_BOT_TOKEN`) using the same `resolveServiceKey` pattern AOS
 *     connectors already use,
 *   - it POSTs to `https://api.telegram.org/bot<TOKEN>/sendMessage`,
 *   - it maps the response to a real success/failure ItemSet so the
 *     workflow-runner can record a meaningful step output instead of
 *     `{"gateType":"error_handler","status":"standby"}`.
 *
 * Tests must mock `fetch` — production network calls in test runs are
 * forbidden (see `tool-send-payload.telegram.test.ts`).
 *
 * @module connectors/tool-send-payload
 */

import type { ArgentConfig } from "../config/config.js";
import type { GateNode, ItemSet, PipelineContext } from "../infra/workflow-types.js";
import { resolveServiceKey } from "../infra/service-keys.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("connectors/tool-send-payload");

const TELEGRAM_BOT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
const TELEGRAM_CHAT_ID_ENV = "TELEGRAM_CHAT_ID";
const TELEGRAM_API_BASE = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TEXT_CHARS = 4_096; // Telegram sendMessage hard limit.

export interface ToolSendPayloadOptions {
  /** Optional: override bot token resolution (used by tests). */
  botToken?: string;
  /** Optional: override default chat id. */
  chatId?: string;
  /** Optional: override fetch (used by tests to mock the API endpoint). */
  fetchImpl?: typeof fetch;
  /** Optional: argent config for service-key access auditing. */
  cfg?: ArgentConfig;
  /** Optional: timeout in milliseconds. */
  timeoutMs?: number;
}

export interface ToolSendPayloadDispatchResult {
  ok: boolean;
  delivered: boolean;
  chatId?: string;
  messageId?: number;
  error?: string;
  status?: number;
}

/**
 * True when the workflow node is a `tool-send-payload` placeholder
 * intended to dispatch a Telegram message.
 *
 * The PG-stored AI Morning Brief workflow has a node literally named
 * `tool-send-payload` that the canvas normalizer collapses into an
 * `error_handler` gate (see `normalizeSubPortNode` in
 * `src/infra/workflow-normalize.ts`). We detect it by node id and by
 * the gate label / nodeType hint, so we can dispatch instead of
 * passing through.
 */
export function isToolSendPayloadNode(node: GateNode): boolean {
  if (!node) {
    return false;
  }
  if (node.config.gateType !== "error_handler") {
    return false;
  }
  const id = (node.id ?? "").trim().toLowerCase();
  if (id === "tool-send-payload" || id.startsWith("tool-send-payload")) {
    return true;
  }
  const label = (node.label ?? "").trim().toLowerCase();
  if (label === "tool-send-payload" || label.startsWith("tool-send-payload")) {
    return true;
  }
  // The normalizer also stamps these with a `nodeType` hint when the
  // node was a sub-port tool grant (see workflow-normalize.ts:683).
  const cfg = node.config as unknown as { nodeType?: string; toolName?: string };
  if (typeof cfg.toolName === "string" && cfg.toolName.trim().toLowerCase() === "send-payload") {
    return true;
  }
  return false;
}

interface TelegramSendInput {
  chatId: string;
  text: string;
}

function coerceString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Build the `sendMessage` payload from the workflow's pipeline context.
 *
 * Resolution order for chat id:
 *   1. `node.config.chatId` (if normalized through)
 *   2. `context.variables.telegramChatId`
 *   3. `options.chatId` override
 *   4. `TELEGRAM_CHAT_ID` env / service-key
 *
 * Resolution order for text:
 *   1. last step's `text`
 *   2. last step's `json.summary` / `json.message`
 *   3. fallback: `"Workflow {workflowId} reached tool-send-payload"`
 */
export function buildTelegramSendInput(
  node: GateNode,
  context: PipelineContext,
  options: ToolSendPayloadOptions,
): TelegramSendInput {
  const cfg = node.config as unknown as Record<string, unknown>;
  const variables = context.variables ?? {};
  const lastStep = context.history?.[context.history.length - 1];
  const lastItem = lastStep?.output?.items?.[0];
  const lastJson: Record<string, unknown> = lastItem?.json ?? {};

  const chatId =
    coerceString(cfg.chatId) ??
    coerceString(variables.telegramChatId) ??
    coerceString(variables.chatId) ??
    coerceString(options.chatId) ??
    coerceString(resolveServiceKey(TELEGRAM_CHAT_ID_ENV, options.cfg)) ??
    "";

  const text =
    coerceString(lastItem?.text) ??
    coerceString(lastJson.summary) ??
    coerceString(lastJson.message) ??
    coerceString(lastJson.text) ??
    `Workflow ${context.workflowName ?? context.workflowId ?? "(unknown)"} reached ${node.id}`;

  // Telegram hard-limits sendMessage to 4096 chars; truncate cleanly.
  const truncated = text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS - 1)}…` : text;

  return { chatId, text: truncated };
}

/**
 * Real Telegram bot dispatch — POSTs `sendMessage` and returns a
 * structured success/failure result.
 *
 * Network errors and non-200 responses produce `ok: false` with a
 * descriptive `error` string. The caller is responsible for wrapping
 * the result into a workflow `ItemSet` (see `dispatchToolSendPayload`).
 */
export async function postTelegramSendMessage(
  input: TelegramSendInput,
  options: ToolSendPayloadOptions = {},
): Promise<ToolSendPayloadDispatchResult> {
  if (!input.chatId) {
    return {
      ok: false,
      delivered: false,
      error:
        "tool-send-payload: chat id missing — set TELEGRAM_CHAT_ID, pass options.chatId, or set context.variables.telegramChatId",
    };
  }
  if (!input.text) {
    return {
      ok: false,
      delivered: false,
      chatId: input.chatId,
      error: "tool-send-payload: empty message text",
    };
  }

  const token =
    options.botToken?.trim() || resolveServiceKey(TELEGRAM_BOT_TOKEN_ENV, options.cfg)?.trim();
  if (!token) {
    return {
      ok: false,
      delivered: false,
      chatId: input.chatId,
      error:
        "tool-send-payload: TELEGRAM_BOT_TOKEN missing — set it via the dashboard service-keys store or process env",
    };
  }

  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      delivered: false,
      chatId: input.chatId,
      error: "tool-send-payload: fetch is unavailable in this runtime",
    };
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: input.chatId, text: input.text }),
      signal: controller.signal,
    });

    let parsed: { ok?: boolean; result?: { message_id?: number }; description?: string } = {};
    try {
      parsed = (await response.json()) as typeof parsed;
    } catch {
      // Telegram always returns JSON; if it didn't, treat as failure below.
    }

    if (!response.ok || parsed.ok === false) {
      const description = parsed.description ?? `HTTP ${response.status}`;
      return {
        ok: false,
        delivered: false,
        chatId: input.chatId,
        status: response.status,
        error: `tool-send-payload: telegram api error — ${description}`,
      };
    }

    return {
      ok: true,
      delivered: true,
      chatId: input.chatId,
      messageId: parsed.result?.message_id,
      status: response.status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      delivered: false,
      chatId: input.chatId,
      error: `tool-send-payload: dispatch failed — ${message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Workflow-runner-facing entry point. Returns an `ItemSet` shaped the
 * same way other gate handlers return — so it can drop into the
 * `error_handler` case in `executeGate` without changing the surface
 * area further.
 *
 * Successful delivery surfaces `delivered:true, channel:"telegram"` so
 * downstream `workflow_step_runs` rows visibly differ from the prior
 * standby placeholder.
 */
export async function dispatchToolSendPayload(
  node: GateNode,
  context: PipelineContext,
  options: ToolSendPayloadOptions = {},
): Promise<ItemSet> {
  const input = buildTelegramSendInput(node, context, options);
  log.info("tool-send-payload: dispatching telegram message", {
    nodeId: node.id,
    chatId: input.chatId ? "[set]" : "[missing]",
    textLen: input.text.length,
  });

  const result = await postTelegramSendMessage(input, options);

  if (result.ok) {
    log.info("tool-send-payload: telegram delivery ok", {
      nodeId: node.id,
      messageId: result.messageId,
    });
    return {
      items: [
        {
          json: {
            channel: "telegram",
            delivered: true,
            chatId: result.chatId,
            messageId: result.messageId,
            status: result.status,
          },
          text: `Telegram delivered to ${result.chatId} (message_id=${result.messageId ?? "?"})`,
        },
      ],
    };
  }

  log.warn("tool-send-payload: telegram delivery failed", {
    nodeId: node.id,
    error: result.error,
    status: result.status,
  });
  return {
    items: [
      {
        json: {
          channel: "telegram",
          delivered: false,
          chatId: result.chatId,
          status: result.status,
          error: result.error,
        },
        text: result.error ?? "Telegram delivery failed",
      },
    ],
  };
}

export const __testing = {
  TELEGRAM_API_BASE,
  TELEGRAM_BOT_TOKEN_ENV,
  TELEGRAM_CHAT_ID_ENV,
  MAX_TEXT_CHARS,
  DEFAULT_TIMEOUT_MS,
};
