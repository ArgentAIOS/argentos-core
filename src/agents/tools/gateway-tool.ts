import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import { loadConfig, resolveConfigSnapshotHash } from "../../config/io.js";
import { loadSessionStore, resolveStorePath } from "../../config/sessions.js";
import {
  formatDoctorNonInteractiveHint,
  type RestartSentinelPayload,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const DEFAULT_UPDATE_TIMEOUT_MS = 20 * 60_000;
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_RE =
  /(?:^|[_-])(token|api[_-]?key|secret|password|passphrase|private[_-]?key|client[_-]?secret|authorization|bearer|access[_-]?token|refresh[_-]?token)$/i;

function resolveBaseHashFromSnapshot(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object") {
    return undefined;
  }
  const hashValue = (snapshot as { hash?: unknown }).hash;
  const rawValue = (snapshot as { raw?: unknown }).raw;
  const hash = resolveConfigSnapshotHash({
    hash: typeof hashValue === "string" ? hashValue : undefined,
    raw: typeof rawValue === "string" ? rawValue : undefined,
  });
  return hash ?? undefined;
}

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEY_RE.test(key)) return true;
  if (key.toLowerCase() === "key") return true;
  return false;
}

function redactSecrets(value: unknown, keyHint?: string): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return keyHint && isSensitiveKey(keyHint) ? REDACTED : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "raw") continue;
      if (isSensitiveKey(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactSecrets(v, k);
      }
    }
    return out;
  }
  return value;
}

function sanitizeConfigGetResult(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const obj = snapshot as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "raw") continue;
    if (k === "config") {
      safe[k] = redactSecrets(v, "config");
      continue;
    }
    safe[k] = redactSecrets(v, k);
  }
  return safe;
}

const GATEWAY_ACTIONS = [
  "restart",
  "config.get",
  "config.schema",
  "config.apply",
  "config.patch",
  "update.run",
] as const;

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const rec = block as { type?: unknown; text?: unknown };
    if (rec.type === "text" && typeof rec.text === "string") {
      parts.push(rec.text);
    }
  }
  return parts.join("\n");
}

function extractLatestUserMessageText(history: unknown): string | undefined {
  if (!history || typeof history !== "object") return undefined;
  const messages = (history as { messages?: unknown[] }).messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    const role = String((msg as { role?: unknown }).role ?? "").toLowerCase();
    if (role !== "user") continue;
    const content = (msg as { content?: unknown }).content;
    const text = extractTextFromContent(content).trim();
    if (text) return text;
  }
  return undefined;
}

function isExplicitRestartRequest(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  const normalized = raw.toLowerCase();

  const negative = /\b(don't|do not|stop|cancel)\b.{0,20}\brestart\b/i;
  if (negative.test(normalized)) return false;

  // "I'm going to restart..." is narration, not a request.
  const firstPersonNarration =
    /\b(i am|i'm|i will|i'll|im|we are|we're|we will|we'll|let me)\b.{0,40}\brestart\b/i;
  const explicitSecondPerson =
    /\b(can you|could you|please|go ahead and|you should|you can|run|trigger|perform)\b.{0,60}\brestart\b/i;
  if (firstPersonNarration.test(normalized) && !explicitSecondPerson.test(normalized)) {
    return false;
  }

  // Strong explicit forms.
  if (
    /^\/restart\b/i.test(raw) ||
    /^\s*(please\s+)?restart\b/i.test(raw) ||
    /\b(can you|could you)\b.{0,40}\brestart\b/i.test(normalized) ||
    /\bgo ahead and\b.{0,40}\brestart\b/i.test(normalized)
  ) {
    return true;
  }

  // Fallback: imperative-like mention of restarting the gateway/service.
  if (/\brestart\b.{0,40}\b(gateway|service|services|daemon|server)\b/i.test(normalized)) {
    return true;
  }

  return false;
}

function actionKeywords(action: string): string[] {
  switch (action) {
    case "restart":
      return ["restart", "reboot", "gateway"];
    case "config.apply":
      return ["config", "configuration", "setting", "settings", "apply"];
    case "config.patch":
      return ["config", "configuration", "setting", "settings", "patch"];
    case "update.run":
      return ["update", "upgrade", "self-update", "get updates", "pull latest"];
    default:
      return [];
  }
}

function hasActionKeyword(text: string, action: string): boolean {
  const normalized = text.toLowerCase();
  return actionKeywords(action).some((keyword) =>
    new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalized),
  );
}

function isExplicitActionRequest(text: string, action: string): boolean {
  if (action === "restart") {
    return isExplicitRestartRequest(text);
  }
  const raw = text.trim();
  if (!raw) return false;
  const normalized = raw.toLowerCase();

  const negative =
    /\b(don't|do not|stop|cancel)\b.{0,24}\b(restart|update|upgrade|config|patch|apply)\b/i;
  if (negative.test(normalized)) return false;

  const firstPersonNarration =
    /\b(i am|i'm|i will|i'll|im|we are|we're|we will|we'll|let me)\b.{0,60}\b(restart|update|upgrade|config|patch|apply)\b/i;
  const explicitSecondPerson = /\b(can you|could you|please|go ahead and|you should|you can)\b/i;
  if (firstPersonNarration.test(normalized) && !explicitSecondPerson.test(normalized)) {
    return false;
  }

  if (!hasActionKeyword(normalized, action)) {
    return false;
  }

  if (
    /\b(can you|could you|please|go ahead and|you should|you can|run|trigger|perform)\b/i.test(
      normalized,
    ) ||
    /^\s*(please\s+)?(apply|patch|run|update|upgrade)\b/i.test(raw)
  ) {
    return true;
  }

  if (
    (action === "update.run" && /^\/?(update|upgrade)\b/i.test(raw)) ||
    (action === "config.apply" && /^\/?config\s+apply\b/i.test(raw)) ||
    (action === "config.patch" && /^\/?config\s+patch\b/i.test(raw))
  ) {
    return true;
  }

  return false;
}

async function enforceExplicitUserRequestForAction(params: {
  action: string;
  sessionKey?: string;
}): Promise<void> {
  if (!params.sessionKey) {
    return;
  }
  const history = await callGatewayTool<{ messages?: unknown[] }>(
    "chat.history",
    {},
    { sessionKey: params.sessionKey, limit: 30 },
  );
  const latestUserText = extractLatestUserMessageText(history);
  if (!latestUserText || !isExplicitActionRequest(latestUserText, params.action)) {
    throw new Error(
      `Gateway ${params.action} blocked: latest user message is not an explicit request.`,
    );
  }
}

// NOTE: Using a flattened object schema instead of Type.Union([Type.Object(...), ...])
// because Claude API on Vertex AI rejects nested anyOf schemas as invalid JSON Schema.
// The discriminator (action) determines which properties are relevant; runtime validates.
const GatewayToolSchema = Type.Object({
  action: stringEnum(GATEWAY_ACTIONS),
  // restart
  delayMs: Type.Optional(Type.Number()),
  reason: Type.Optional(Type.String()),
  // config.get, config.schema, config.apply, update.run
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  // config.apply, config.patch
  raw: Type.Optional(Type.String()),
  baseHash: Type.Optional(Type.String()),
  // config.apply, config.patch, update.run
  sessionKey: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  restartDelayMs: Type.Optional(Type.Number()),
});
// NOTE: We intentionally avoid top-level `allOf`/`anyOf`/`oneOf` conditionals here:
// - OpenAI rejects tool schemas that include these keywords at the *top-level*.
// - Claude/Vertex has other JSON Schema quirks.
// Conditional requirements (like `raw` for config.apply) are enforced at runtime.

export function createGatewayTool(opts?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  return {
    label: "Gateway",
    name: "gateway",
    description:
      "Restart, apply config, or update the gateway in-place (SIGUSR1). Use config.patch for safe partial config updates (merges with existing). Use config.apply only when replacing entire config. Both trigger restart after writing.",
    parameters: GatewayToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "restart") {
        if (opts?.config?.commands?.restart !== true) {
          throw new Error("Gateway restart is disabled. Set commands.restart=true to enable.");
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const delayMs =
          typeof params.delayMs === "number" && Number.isFinite(params.delayMs)
            ? Math.floor(params.delayMs)
            : undefined;
        const reason =
          typeof params.reason === "string" && params.reason.trim()
            ? params.reason.trim().slice(0, 200)
            : undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;

        await enforceExplicitUserRequestForAction({ action: "restart", sessionKey });

        // Extract channel + threadId for routing after restart
        let deliveryContext: { channel?: string; to?: string; accountId?: string } | undefined;
        let threadId: string | undefined;
        if (sessionKey) {
          const threadMarker = ":thread:";
          const threadIndex = sessionKey.lastIndexOf(threadMarker);
          const baseSessionKey = threadIndex === -1 ? sessionKey : sessionKey.slice(0, threadIndex);
          const threadIdRaw =
            threadIndex === -1 ? undefined : sessionKey.slice(threadIndex + threadMarker.length);
          threadId = threadIdRaw?.trim() || undefined;
          try {
            const cfg = loadConfig();
            const storePath = resolveStorePath(cfg.session?.store);
            const store = loadSessionStore(storePath);
            let entry = store[sessionKey];
            if (!entry?.deliveryContext && threadIndex !== -1 && baseSessionKey) {
              entry = store[baseSessionKey];
            }
            if (entry?.deliveryContext) {
              deliveryContext = {
                channel: entry.deliveryContext.channel,
                to: entry.deliveryContext.to,
                accountId: entry.deliveryContext.accountId,
              };
            }
          } catch {
            // ignore: best-effort
          }
        }
        const payload: RestartSentinelPayload = {
          kind: "restart",
          status: "ok",
          ts: Date.now(),
          sessionKey,
          deliveryContext,
          threadId,
          message: note ?? reason ?? null,
          doctorHint: formatDoctorNonInteractiveHint(),
          stats: {
            mode: "gateway.restart",
            reason,
          },
        };
        try {
          await writeRestartSentinel(payload);
        } catch {
          // ignore: sentinel is best-effort
        }
        console.info(
          `gateway tool: restart requested (delayMs=${delayMs ?? "default"}, reason=${reason ?? "none"})`,
        );
        const scheduled = scheduleGatewaySigusr1Restart({
          delayMs,
          reason,
        });
        return jsonResult(scheduled);
      }

      const gatewayUrl =
        typeof params.gatewayUrl === "string" && params.gatewayUrl.trim()
          ? params.gatewayUrl.trim()
          : undefined;
      const gatewayToken =
        typeof params.gatewayToken === "string" && params.gatewayToken.trim()
          ? params.gatewayToken.trim()
          : undefined;
      const timeoutMs =
        typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
          ? Math.max(1, Math.floor(params.timeoutMs))
          : undefined;
      const gatewayOpts = { gatewayUrl, gatewayToken, timeoutMs };

      if (action === "config.get") {
        const result = await callGatewayTool("config.get", gatewayOpts, {});
        return jsonResult({ ok: true, result: sanitizeConfigGetResult(result) });
      }
      if (action === "config.schema") {
        const result = await callGatewayTool("config.schema", gatewayOpts, {});
        return jsonResult({ ok: true, result });
      }
      if (action === "config.apply") {
        const raw = readStringParam(params, "raw", { required: true });
        let baseHash = readStringParam(params, "baseHash");
        if (!baseHash) {
          const snapshot = await callGatewayTool("config.get", gatewayOpts, {});
          baseHash = resolveBaseHashFromSnapshot(snapshot);
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        const restartDelayMs =
          typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
            ? Math.floor(params.restartDelayMs)
            : undefined;
        await enforceExplicitUserRequestForAction({ action: "config.apply", sessionKey });
        const result = await callGatewayTool("config.apply", gatewayOpts, {
          raw,
          baseHash,
          sessionKey,
          note,
          restartDelayMs,
        });
        return jsonResult({ ok: true, result });
      }
      if (action === "config.patch") {
        const raw = readStringParam(params, "raw", { required: true });
        let baseHash = readStringParam(params, "baseHash");
        if (!baseHash) {
          const snapshot = await callGatewayTool("config.get", gatewayOpts, {});
          baseHash = resolveBaseHashFromSnapshot(snapshot);
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        const restartDelayMs =
          typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
            ? Math.floor(params.restartDelayMs)
            : undefined;
        await enforceExplicitUserRequestForAction({ action: "config.patch", sessionKey });
        const result = await callGatewayTool("config.patch", gatewayOpts, {
          raw,
          baseHash,
          sessionKey,
          note,
          restartDelayMs,
        });
        return jsonResult({ ok: true, result });
      }
      if (action === "update.run") {
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        const restartDelayMs =
          typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
            ? Math.floor(params.restartDelayMs)
            : undefined;
        await enforceExplicitUserRequestForAction({ action: "update.run", sessionKey });
        const updateGatewayOpts = {
          ...gatewayOpts,
          timeoutMs: timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS,
        };
        const result = await callGatewayTool("update.run", updateGatewayOpts, {
          sessionKey,
          note,
          restartDelayMs,
          timeoutMs: timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS,
        });
        return jsonResult({ ok: true, result });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}
