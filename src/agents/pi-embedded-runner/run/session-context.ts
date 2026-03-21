import type { SessionEntry } from "../../../config/sessions/types.js";
import { parseAgentSessionKey } from "../../../routing/session-key.js";

export interface SessionBootstrapSnapshot {
  lastInteractionAtMs?: number;
  lastSessionKey?: string;
  sessionClearedAtMs?: number;
  sessionClearedFromKey?: string;
  sessionClearedReason?: string;
}

export interface CrossChannelContextView {
  timestampMs: number;
  sessionKey: string;
  channel?: string;
  summary: string;
}

const SIGNIFICANT_TOOL_PREFIXES = [
  "github",
  "task",
  "doc_panel",
  "knowledge",
  "memory",
  "specforge",
  "schedule",
  "cron",
  "atera",
];

const SIGNIFICANT_TEXT_PATTERNS = [
  /\b(issue|ticket)\s*#?\d+/i,
  /\b(created|filed|opened|closed|updated|reassigned|assigned)\b/i,
  /\b(task|action item|project|milestone|approval)\b/i,
  /\b(docs?pane|docpanel|knowledge base|collection|acl)\b/i,
  /\b(schedule|cron|deadline|follow-up)\b/i,
  /\b(decision|resolved|root cause|incident)\b/i,
];

function formatElapsed(nowMs: number, lastMs: number): string {
  const elapsedMs = Math.max(0, nowMs - lastMs);
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h ago` : `${days}d ago`;
  }
  if (hours > 0) {
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `${hours}h ${remMinutes}m ago` : `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return `${Math.max(1, seconds)}s ago`;
}

export function inferSessionChannelFromKey(
  sessionKey: string | undefined,
  fallback?: string,
): string | undefined {
  const fallbackNorm = fallback?.trim().toLowerCase();
  const parsed = parseAgentSessionKey(sessionKey);
  const raw = (parsed?.rest ?? sessionKey ?? "").trim().toLowerCase();
  if (!raw) {
    return fallbackNorm;
  }
  const firstToken = raw.split(":")[0]?.trim();
  if (
    firstToken &&
    firstToken !== "main" &&
    firstToken !== "dm" &&
    firstToken !== "subagent" &&
    firstToken !== "acp" &&
    firstToken !== "global"
  ) {
    return firstToken;
  }
  return fallbackNorm;
}

export function resolveSessionBootstrapSnapshotFromStore(
  store: Record<string, SessionEntry>,
): SessionBootstrapSnapshot {
  const globalEntry = store["__lastUserMessage"];
  const globalLastAt =
    typeof globalEntry?.lastUserMessageAt === "number" ? globalEntry.lastUserMessageAt : undefined;
  const globalPrevAt =
    typeof globalEntry?.previousLastUserMessageAt === "number"
      ? globalEntry.previousLastUserMessageAt
      : undefined;
  const directLastAt =
    globalLastAt != null && globalPrevAt != null
      ? Math.max(globalLastAt, globalPrevAt)
      : (globalLastAt ?? globalPrevAt);
  const directLastSession =
    directLastAt === globalLastAt
      ? (globalEntry?.lastInteractionSessionKey ?? globalEntry?.previousSessionKey)
      : (globalEntry?.previousSessionKey ?? globalEntry?.lastInteractionSessionKey);
  const sessionClearedAtMs =
    typeof globalEntry?.sessionClearedAt === "number" ? globalEntry.sessionClearedAt : undefined;
  const sessionClearedFromKey = globalEntry?.sessionClearedFromKey;
  const sessionClearedReason = globalEntry?.sessionClearedReason;

  let bestAt = 0;
  let bestKey: string | undefined;
  const maybeSetBest = (at: number | undefined, key: string | undefined) => {
    if (typeof at === "number" && Number.isFinite(at) && at > bestAt) {
      bestAt = at;
      bestKey = key?.trim() || bestKey;
      return;
    }
    if (!bestKey && key?.trim()) {
      bestKey = key.trim();
    }
  };

  maybeSetBest(directLastAt, directLastSession);
  for (const [key, entry] of Object.entries(store)) {
    if (!entry || key === "__lastUserMessage") {
      continue;
    }
    const candidate = entry.lastUserMessageAt ?? entry.updatedAt ?? 0;
    maybeSetBest(candidate, key);
  }
  return {
    lastInteractionAtMs: bestAt > 0 ? bestAt : undefined,
    lastSessionKey: bestKey,
    sessionClearedAtMs,
    sessionClearedFromKey,
    sessionClearedReason,
  };
}

export function buildSessionBootstrapBlock(params: {
  nowMs: number;
  status: "fresh" | "resumed";
  lastInteractionAtMs?: number;
  lastSessionKey?: string;
  sessionClearedAtMs?: number;
  sessionClearedFromKey?: string;
  sessionClearedReason?: string;
  fallbackChannel?: string;
}): string {
  const timestamp = params.lastInteractionAtMs
    ? new Date(params.lastInteractionAtMs).toISOString()
    : "unknown";
  const elapsed = params.lastInteractionAtMs
    ? formatElapsed(params.nowMs, params.lastInteractionAtMs)
    : "unknown";
  const channel = inferSessionChannelFromKey(params.lastSessionKey, params.fallbackChannel);
  const channelSuffix = channel ? ` — channel: ${channel}` : "";
  const lastSession = params.lastSessionKey?.trim() || "unknown";
  const lines = [
    "[SESSION_BOOTSTRAP]",
    `Last interaction: ${timestamp} (${elapsed})${channelSuffix}`,
    `Last session key: ${lastSession}`,
    `Status: ${params.status}`,
    "[/SESSION_BOOTSTRAP]",
  ];

  if (params.status === "fresh" && params.sessionClearedAtMs) {
    const clearedAt = new Date(params.sessionClearedAtMs).toISOString();
    const clearedElapsed = formatElapsed(params.nowMs, params.sessionClearedAtMs);
    const clearedKey = params.sessionClearedFromKey?.trim() || "unknown";
    const clearedReason = params.sessionClearedReason?.trim() || "session reset";
    lines.push(
      "[SESSION_CLEARED]",
      `At: ${clearedAt} (${clearedElapsed})`,
      `Cleared session key: ${clearedKey}`,
      `Reason: ${clearedReason}`,
      "Re-orient from workspace continuity context before proceeding.",
      "[/SESSION_CLEARED]",
    );
  }

  return lines.join("\n");
}

export function extractAssistantTextForContext(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const rec = message as { content?: unknown };
  if (typeof rec.content === "string") {
    return rec.content.trim() || undefined;
  }
  if (!Array.isArray(rec.content)) {
    return undefined;
  }
  const parts = rec.content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const text = "text" in block ? String((block as { text?: unknown }).text ?? "") : "";
      return text.trim();
    })
    .filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join(" ").trim() || undefined;
}

export function selectCrossChannelEventSummary(params: {
  assistantText?: string;
  toolMetas: Array<{ toolName: string; meta?: string }>;
  messagingToolSentTexts: string[];
}): string | undefined {
  const assistantText = params.assistantText?.replace(/\s+/g, " ").trim() ?? "";
  const textForScan = [
    assistantText,
    ...params.messagingToolSentTexts.map((text) => text.replace(/\s+/g, " ").trim()),
  ]
    .filter(Boolean)
    .join(" ");

  if (!textForScan) {
    return undefined;
  }

  const significantTool = params.toolMetas.some((meta) => {
    const normalized = meta.toolName.trim().toLowerCase();
    return SIGNIFICANT_TOOL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  });
  const significantText = SIGNIFICANT_TEXT_PATTERNS.some((pattern) => pattern.test(textForScan));
  const structured = /(^|\n)\s*[-*]\s+/.test(assistantText) || /\b\d+\.\s/.test(assistantText);

  if (!significantTool && !significantText && !structured) {
    return undefined;
  }

  const source =
    assistantText ||
    params.messagingToolSentTexts.map((text) => text.trim()).find((text) => text.length > 0) ||
    "";
  if (!source) {
    return undefined;
  }

  const compact = source.replace(/\s+/g, " ").trim();
  return compact.length > 320 ? `${compact.slice(0, 317)}...` : compact;
}

export function buildCrossChannelContextBlock(params: {
  currentSessionKey?: string;
  events: CrossChannelContextView[];
}): string | undefined {
  const currentSessionKey = params.currentSessionKey?.trim();
  const filtered = params.events.filter((event) => {
    const key = event.sessionKey.trim();
    if (!key) {
      return false;
    }
    if (currentSessionKey && key === currentSessionKey) {
      return false;
    }
    return Boolean(event.summary.trim());
  });
  if (filtered.length === 0) {
    return undefined;
  }

  const lines = ["[CROSS_CHANNEL_CONTEXT]", "Recent activity from other channels:"];
  for (const event of filtered.slice(-10)) {
    const ts =
      event.timestampMs > 0 ? new Date(event.timestampMs).toISOString().slice(11, 16) : "--:--";
    const channel = event.channel?.trim() || inferSessionChannelFromKey(event.sessionKey) || "n/a";
    lines.push(`- ${ts} ${channel}: ${event.summary.trim()}`);
  }
  lines.push("[/CROSS_CHANNEL_CONTEXT]");
  return lines.join("\n");
}
