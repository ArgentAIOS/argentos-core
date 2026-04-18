export type SessionVisibilityEntry = {
  key: string;
  channel?: string;
  surface?: string;
};

export type ChatAgentOption = {
  id: string;
  label: string;
};

export function inferSessionSurface(sessionKey: string): string {
  const key = sessionKey.trim().toLowerCase();
  if (!key) {
    return "";
  }
  if (key === "global" || key === "unknown") {
    return key;
  }

  const agentMatch = /^agent:[^:]+:(.+)$/i.exec(key);
  const raw = (agentMatch?.[1] ?? key).trim();
  if (!raw) {
    return "";
  }

  const match = /^([a-z0-9_]+)(?:[:-]|$)/i.exec(raw);
  return match?.[1]?.toLowerCase() ?? "";
}

export function resolvePrimaryChatAgentId(
  mainSessionKey: string | undefined,
  fallbackAgentId: string,
): string {
  const key = mainSessionKey?.trim().toLowerCase() ?? "";
  const agentMatch = /^agent:([^:]+):/i.exec(key);
  if (agentMatch?.[1]) {
    return agentMatch[1].trim().toLowerCase();
  }
  return fallbackAgentId.trim().toLowerCase();
}

export function mergeVisibleChatAgentOptions(params: {
  primaryAgentId: string;
  currentChatAgentId?: string | null;
  loadedOptions?: ChatAgentOption[];
}): ChatAgentOption[] {
  const primaryAgentId = params.primaryAgentId.trim().toLowerCase();
  const currentChatAgentId = params.currentChatAgentId?.trim().toLowerCase() ?? "";
  const loadedOptions = params.loadedOptions ?? [];

  const merged = new Map<string, ChatAgentOption>();

  for (const option of loadedOptions) {
    const id = option.id.trim().toLowerCase();
    if (!id) {
      continue;
    }
    merged.set(id, {
      id,
      label: option.label?.trim() || id,
    });
  }

  if (!merged.has(primaryAgentId)) {
    merged.set(primaryAgentId, { id: primaryAgentId, label: primaryAgentId });
  }

  if (currentChatAgentId && !merged.has(currentChatAgentId)) {
    merged.set(currentChatAgentId, {
      id: currentChatAgentId,
      label: currentChatAgentId,
    });
  }

  return Array.from(merged.values());
}

export function resolveSessionAgentId(sessionKey: string, fallbackAgentId: string): string {
  const key = sessionKey.trim().toLowerCase();
  if (!key) {
    return fallbackAgentId.trim().toLowerCase();
  }
  const agentMatch = /^agent:([^:]+):/i.exec(key);
  if (agentMatch?.[1]) {
    return agentMatch[1].trim().toLowerCase();
  }
  return fallbackAgentId.trim().toLowerCase();
}

export function isBackgroundSessionKey(sessionKey: string): boolean {
  const key = sessionKey.trim().toLowerCase();
  if (!key) {
    return false;
  }
  const agentMatch = /^agent:[^:]+:(.+)$/i.exec(key);
  const raw = (agentMatch?.[1] ?? key).trim();
  if (!raw) {
    return false;
  }

  return (
    raw.startsWith("temp:") ||
    raw.startsWith("temp-") ||
    raw === "worker-execution" ||
    raw.includes(":worker-execution") ||
    raw.endsWith(":contemplation") ||
    raw.includes(":contemplation:") ||
    raw.endsWith(":sis-consolidation") ||
    raw.includes(":sis-consolidation:") ||
    raw.endsWith(":heartbeat") ||
    raw.includes(":heartbeat:") ||
    raw.endsWith(":cron") ||
    raw.includes(":cron:")
  );
}

export function coerceVisibleOperatorSessionKey(params: {
  sessionKey: string | null | undefined;
  mainSessionKey: string;
}): string {
  const raw = params.sessionKey?.trim() ?? "";
  if (!raw) {
    return params.mainSessionKey;
  }
  return isBackgroundSessionKey(raw) ? params.mainSessionKey : raw;
}

export function isVisibleOperatorSession(params: {
  session: SessionVisibilityEntry;
  currentSessionKey: string;
  selectedAgentId: string;
  defaultAgentId?: string;
}): boolean {
  const { session, currentSessionKey, selectedAgentId, defaultAgentId } = params;
  const key = session.key.trim().toLowerCase();
  const current = currentSessionKey.trim().toLowerCase();
  const fallbackAgentId =
    defaultAgentId?.trim().toLowerCase() || selectedAgentId.trim().toLowerCase();
  if (!key) {
    return false;
  }
  if (isBackgroundSessionKey(key)) {
    return false;
  }
  if (resolveSessionAgentId(key, fallbackAgentId) !== selectedAgentId.trim().toLowerCase()) {
    return false;
  }
  if (key === current) {
    return true;
  }

  const channel = session.channel?.trim().toLowerCase();
  if (channel && channel !== "webchat") {
    return false;
  }

  const surface = (session.surface?.trim().toLowerCase() ?? inferSessionSurface(key)).toLowerCase();
  if (surface === "webchat" || surface === "main") {
    return true;
  }

  return (
    key === "main" ||
    key.endsWith(":main") ||
    key.startsWith("webchat-") ||
    key.includes(":webchat-") ||
    key.includes(":webchat:")
  );
}
