import type { SessionManager } from "../agent-core/coding.js";
import type { AgentMessage } from "../agent-core/core.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { truncateUtf16Safe } from "../utils.js";
import { sanitizeToolResult } from "./pi-embedded-subscribe.tools.js";
import { installSessionToolResultGuard } from "./session-tool-result-guard.js";

export type GuardedSessionManager = SessionManager & {
  /** Flush any synthetic tool results for pending tool calls. Idempotent. */
  flushPendingToolResults?: () => void;
};

const TOOL_RESULT_DETAILS_MAX_CHARS = 50_000;
const TOOL_RESULT_DETAILS_KEYS_MAX = 24;
const TOOL_RESULT_DETAIL_STRING_MAX_CHARS = 1_000;
const TOOL_RESULT_DETAIL_PRESERVE_KEYS = [
  "status",
  "state",
  "video_id",
  "video_url",
  "path",
  "url",
  "size_bytes",
  "ok",
  "error",
  "code",
  "targetId",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactDetailPrimitive(value: unknown): string | number | boolean | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.length <= TOOL_RESULT_DETAIL_STRING_MAX_CHARS) {
      return value;
    }
    return `${truncateUtf16Safe(value, TOOL_RESULT_DETAIL_STRING_MAX_CHARS)}…`;
  }
  return undefined;
}

function compactToolResultDetails(details: unknown): unknown {
  if (!isRecord(details)) {
    return details;
  }

  let serialized = "";
  try {
    serialized = JSON.stringify(details);
  } catch {
    return {
      omitted: true,
      reason: "details_not_serializable",
    };
  }

  if (serialized.length <= TOOL_RESULT_DETAILS_MAX_CHARS) {
    return details;
  }

  const compact: Record<string, unknown> = {
    omitted: true,
    reason: "details_too_large",
    approx_chars: serialized.length,
    top_level_keys: Object.keys(details).slice(0, TOOL_RESULT_DETAILS_KEYS_MAX),
  };

  for (const key of TOOL_RESULT_DETAIL_PRESERVE_KEYS) {
    const compacted = compactDetailPrimitive(details[key]);
    if (compacted !== undefined) {
      compact[key] = compacted;
    }
  }

  return compact;
}

function sanitizeToolResultForPersistence(message: AgentMessage): AgentMessage {
  const role = (message as { role?: unknown }).role;
  if (role !== "toolResult") {
    return message;
  }

  const sanitizedUnknown = sanitizeToolResult(message);
  if (!isRecord(sanitizedUnknown)) {
    return message;
  }

  const sanitized = sanitizedUnknown as AgentMessage & {
    details?: unknown;
    role?: string;
  };
  if (sanitized.role !== "toolResult") {
    return sanitized as AgentMessage;
  }

  if (!("details" in sanitized)) {
    return sanitized as AgentMessage;
  }

  return {
    ...sanitized,
    details: compactToolResultDetails(sanitized.details),
  } as AgentMessage;
}

/**
 * Apply the tool-result guard to a SessionManager exactly once and expose
 * a flush method on the instance for easy teardown handling.
 */
export function guardSessionManager(
  sessionManager: SessionManager,
  opts?: {
    agentId?: string;
    sessionKey?: string;
    allowSyntheticToolResults?: boolean;
  },
): GuardedSessionManager {
  if (typeof (sessionManager as GuardedSessionManager).flushPendingToolResults === "function") {
    return sessionManager as GuardedSessionManager;
  }

  const hookRunner = getGlobalHookRunner();
  const hasPersistHooks = hookRunner?.hasHooks("tool_result_persist") ?? false;
  // oxlint-disable-next-line typescript/no-explicit-any
  const transform = (
    message: any,
    meta: { toolCallId?: string; toolName?: string; isSynthetic?: boolean },
  ) => {
    const sanitized = sanitizeToolResultForPersistence(message as AgentMessage);
    if (!hookRunner || !hasPersistHooks) {
      return sanitized;
    }
    const out = hookRunner.runToolResultPersist(
      {
        toolName: meta.toolName,
        toolCallId: meta.toolCallId,
        message: sanitized,
        isSynthetic: meta.isSynthetic,
      },
      {
        agentId: opts?.agentId,
        sessionKey: opts?.sessionKey,
        toolName: meta.toolName,
        toolCallId: meta.toolCallId,
      },
    );
    return out?.message ?? sanitized;
  };

  const guard = installSessionToolResultGuard(sessionManager, {
    transformToolResultForPersistence: transform,
    allowSyntheticToolResults: opts?.allowSyntheticToolResults,
  });
  (sessionManager as GuardedSessionManager).flushPendingToolResults = guard.flushPendingToolResults;
  return sessionManager as GuardedSessionManager;
}
