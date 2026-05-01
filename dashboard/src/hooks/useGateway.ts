import { useState, useEffect, useRef, useCallback } from "react";
import { buildDeviceAuthPayload } from "../../../src/gateway/device-auth.js";
import { loadOrCreateDeviceIdentity, signDevicePayload } from "../../../ui/src/ui/device-identity.ts";
import {
  coerceVisibleOperatorSessionKey,
  resolvePrimaryChatAgentId,
} from "../lib/sessionVisibility";

/**
 * Format a provider error string into a human-readable chat message.
 * Extracts rate-limit retry times, auth failures, and context issues.
 */
function formatProviderError(errorStr: string): string {
  // Rate limit / usage cap
  const retryMatch = errorStr.match(/try again in[\s~]*([\d]+\s*(?:min|hour|sec|m|h|s)\w*)/i);
  const rateLimitMatch = errorStr.match(/rate.?limit|usage.?limit|429|quota|too many/i);
  if (rateLimitMatch || retryMatch) {
    const providerMatch = errorStr.match(/for\s+(\S+?)\s|provider[:\s]+(\S+)/i);
    const provider = providerMatch?.[1] || providerMatch?.[2] || "provider";
    const retryText = retryMatch ? ` Try again in ${retryMatch[1]}.` : "";
    return `⚠️ Rate limited — ${provider} hit usage cap.${retryText} The system will fall back to another provider if configured.`;
  }
  // Auth failure
  if (/unauthorized|auth.*fail|invalid.*key|403|401/i.test(errorStr)) {
    return `⚠️ Authentication failed. Check your API keys in the settings.`;
  }
  // Context window
  if (/context.*window|too.*small|token.*limit/i.test(errorStr)) {
    return `⚠️ Context window too small for this request. Try a shorter message or reset the session.`;
  }
  // All profiles exhausted
  if (/all.*cooldown|no.*available.*auth|all.*exhausted/i.test(errorStr)) {
    return `⚠️ All provider accounts are temporarily exhausted. Please wait a few minutes and try again.`;
  }
  // Generic — show truncated error
  const clean = errorStr.replace(/^(Error|FailoverError):\s*/i, "");
  const truncated = clean.length > 200 ? clean.slice(0, 200) + "…" : clean;
  return `⚠️ Provider error: ${truncated}`;
}

const DEFAULT_MAIN_SESSION_KEY = "agent:main:main";
const DEFAULT_AGENT_ID = "main";

function normalizeAgentId(raw: string | null | undefined, fallback = DEFAULT_AGENT_ID): string {
  const value = (raw ?? "").trim().toLowerCase();
  return value || fallback;
}

function isWebchatSessionAlias(value: string): boolean {
  const key = value.trim().toLowerCase();
  if (!key) return false;
  return key === "webchat" || key.startsWith("webchat-") || key.startsWith("webchat:");
}

function remapLegacyDefaultAgentSession(params: {
  rawSessionKey: string;
  mainSessionKey: string;
  defaultAgentId: string;
}): string | null {
  const { rawSessionKey, mainSessionKey, defaultAgentId } = params;
  const normalizedPrimaryAgentId = resolvePrimaryChatAgentId(mainSessionKey, defaultAgentId);
  if (
    !rawSessionKey.startsWith("agent:") ||
    !normalizedPrimaryAgentId ||
    normalizedPrimaryAgentId === "main"
  ) {
    return null;
  }

  const rawParts = rawSessionKey.split(":");
  if (rawParts.length < 3 || rawParts[0] !== "agent") {
    return null;
  }

  const rawAgentId = (rawParts[1] ?? "").trim().toLowerCase();
  if (rawAgentId !== "main") {
    return null;
  }

  const mainParts = mainSessionKey.split(":");
  const mainAgentId =
    mainParts.length >= 2
      ? (mainParts[1] ?? normalizedPrimaryAgentId).trim().toLowerCase()
      : normalizedPrimaryAgentId;
  if (mainAgentId !== normalizedPrimaryAgentId) {
    return null;
  }

  const rawRest = rawParts.slice(2).join(":");
  const rawRestLower = rawRest.toLowerCase();
  if (rawRestLower === "main") {
    return mainSessionKey;
  }
  if (isWebchatSessionAlias(rawRestLower)) {
    return `agent:${normalizedPrimaryAgentId}:${rawRest}`;
  }
  return null;
}

interface GatewayConfig {
  url?: string;
  token?: string;
}

interface GatewayMessage {
  type: "req" | "res" | "event";
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  ok?: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
  event?: string;
}

type GatewayHelloPayload = {
  type?: "hello-ok";
  snapshot?: {
    sessionDefaults?: {
      mainSessionKey?: string;
      defaultAgentId?: string;
    };
  };
  auth?: {
    deviceToken?: string;
    role?: string;
    scopes?: string[];
  };
};

type StoredDeviceAuthToken = {
  deviceId: string;
  role: string;
  token: string;
  scopes: string[];
  issuedAtMs: number;
};

export interface FilesystemPermissionDeniedEvent {
  source: "agent" | "chat";
  runId?: string;
  sessionKey: string;
  toolName?: string;
  attemptedPath: string;
  allowedDirectories: string[];
  rawError: string;
  ts: number;
}

type BusyMode = "cue" | "steer";
type GatewayRequestOptions = {
  timeoutMs?: number;
};

function toCanonicalSessionKey(sessionKey: string | undefined): string {
  const mainSessionKey = globalMainSessionKey || DEFAULT_MAIN_SESSION_KEY;
  const defaultAgentId = resolvePrimaryChatAgentId(
    mainSessionKey,
    globalDefaultAgentId || DEFAULT_AGENT_ID,
  );
  const raw = coerceVisibleOperatorSessionKey({ sessionKey, mainSessionKey }).trim();
  if (!raw) return mainSessionKey;
  const lowered = raw.toLowerCase();
  const normalizedMain = mainSessionKey.toLowerCase();
  if (lowered === "global") return "global";
  if (lowered === "main" || lowered === normalizedMain || lowered === "agent:main:main") {
    return mainSessionKey;
  }
  if (isWebchatSessionAlias(lowered)) {
    return mainSessionKey;
  }
  if (raw.startsWith("agent:")) {
    const remapped = remapLegacyDefaultAgentSession({
      rawSessionKey: raw,
      mainSessionKey,
      defaultAgentId,
    });
    if (remapped) {
      return remapped;
    }
    const mainParts = normalizedMain.split(":");
    const mainAgentId =
      mainParts.length >= 2 ? (mainParts[1] ?? DEFAULT_AGENT_ID) : DEFAULT_AGENT_ID;
    const mainRest = mainParts.length >= 3 ? mainParts.slice(2).join(":") : "main";
    const rawParts = lowered.split(":");
    if (rawParts.length >= 3 && rawParts[0] === "agent") {
      const rawAgentId = rawParts[1] ?? "";
      const rawRest = rawParts.slice(2).join(":");
      if (
        rawAgentId === mainAgentId &&
        (rawRest === "main" || rawRest === mainRest || isWebchatSessionAlias(rawRest))
      ) {
        return mainSessionKey;
      }
    }
    return raw;
  }
  return `agent:${defaultAgentId}:${raw}`;
}

function resolveSessionAgentIdFromKey(sessionKey: string | undefined): string {
  const canonicalSessionKey = toCanonicalSessionKey(sessionKey);
  const match = /^agent:([^:]+):/i.exec(canonicalSessionKey);
  return normalizeAgentId(
    match?.[1],
    resolvePrimaryChatAgentId(globalMainSessionKey, globalDefaultAgentId || DEFAULT_AGENT_ID),
  );
}

// Singleton WebSocket connection to survive React StrictMode and HMR
let globalWs: WebSocket | null = null;
let globalConnected = false;
let globalConnecting = false;
let connectionPromise: Promise<void> | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let manualDisconnect = false;
let suppressAutoReconnectUntilManualConnect = false;
let globalMainSessionKey = DEFAULT_MAIN_SESSION_KEY;
let globalDefaultAgentId = DEFAULT_AGENT_ID;
let globalGatewayUrl = "";
let globalGatewayToken = "";
let runtimeGatewayTokenOverride = "";

export function shouldForceGatewayCredentialReconnect(params: {
  connected: boolean;
  suppressedAutoReconnect: boolean;
  currentUrl: string;
  currentToken: string;
  nextUrl: string;
  nextToken: string;
}): boolean {
  const credentialsChanged =
    params.currentUrl.trim() !== params.nextUrl.trim() ||
    params.currentToken.trim() !== params.nextToken.trim();
  return (params.connected || params.suppressedAutoReconnect) && credentialsChanged;
}

function readStoredDashboardGatewayToken(): string {
  try {
    const raw = localStorage.getItem("argent.control.settings.v1");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === "string" ? parsed.token.trim() : "";
  } catch {
    return "";
  }
}

// Module-level refs so HMR doesn't break message routing
const globalPendingRequests: Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
> = new Map();
const globalEventHandlers: Map<string, Set<(payload: unknown) => void>> = new Map();

// Track active user-initiated runIds so background "chat" events can be distinguished
export const activeUserRunIds = new Set<string>();
const DEBUG_GATEWAY_STREAM =
  import.meta.env.DEV && import.meta.env.VITE_DEBUG_GATEWAY_STREAM === "1";
const DASHBOARD_GATEWAY_CLIENT_ID = "webchat";
const DASHBOARD_GATEWAY_CLIENT_MODE = "webchat";
const DASHBOARD_GATEWAY_ROLE = "operator";
const DASHBOARD_GATEWAY_SCOPES = ["operator.admin", "operator.approvals", "operator.pairing"];
const DEVICE_AUTH_STORAGE_KEY = "argent.device.auth.v1";

function isPermanentConnectFailureMessage(message: string): boolean {
  const value = message.toLowerCase();
  return (
    value.includes("device identity required") ||
    value.includes("secure context") ||
    value.includes("origin not allowed") ||
    value.includes("gateway token missing") ||
    value.includes("gateway token mismatch") ||
    value.includes("gateway password missing") ||
    value.includes("gateway password mismatch") ||
    value.includes("unauthorized")
  );
}

function addGatewayTokenHint(message: string): string {
  if (
    /gateway token missing|gateway token mismatch|device identity required|unauthorized/i.test(
      message,
    )
  ) {
    return `${message}. Open a tokenized dashboard URL or set the gateway token in Control UI settings.`;
  }
  return message;
}

function sortedScopes(scopes: string[]): string[] {
  return [...scopes].sort((a, b) => a.localeCompare(b));
}

function loadDeviceAuthToken(params: {
  deviceId: string;
  role: string;
}): StoredDeviceAuthToken | null {
  try {
    const raw = localStorage.getItem(DEVICE_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDeviceAuthToken>;
    if (
      parsed.deviceId !== params.deviceId ||
      parsed.role !== params.role ||
      typeof parsed.token !== "string" ||
      !parsed.token
    ) {
      return null;
    }
    return {
      deviceId: parsed.deviceId,
      role: parsed.role,
      token: parsed.token,
      scopes: Array.isArray(parsed.scopes)
        ? parsed.scopes.filter((scope): scope is string => typeof scope === "string")
        : [],
      issuedAtMs: typeof parsed.issuedAtMs === "number" ? parsed.issuedAtMs : 0,
    };
  } catch {
    return null;
  }
}

function storeDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  token: string;
  scopes: string[];
}) {
  try {
    const entry: StoredDeviceAuthToken = {
      deviceId: params.deviceId,
      role: params.role,
      token: params.token,
      scopes: sortedScopes(params.scopes),
      issuedAtMs: Date.now(),
    };
    localStorage.setItem(DEVICE_AUTH_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Best effort only; the dashboard can fall back to the shared token.
  }
}

function clearDeviceAuthToken(params: { deviceId: string; role: string }) {
  try {
    const existing = loadDeviceAuthToken(params);
    if (existing) {
      localStorage.removeItem(DEVICE_AUTH_STORAGE_KEY);
    }
  } catch {
    // Best effort only.
  }
}

function parseFilesystemPathDenial(rawError: string): {
  attemptedPath: string;
  allowedDirectories: string[];
} | null {
  const match = /^Path\s+"([^"]+)"\s+is outside allowed directories:\s*(.*)$/i.exec(
    rawError.trim(),
  );
  if (!match) return null;
  const attemptedPath = match[1]?.trim();
  if (!attemptedPath) return null;
  const allowedDirectories = (match[2] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return { attemptedPath, allowedDirectories };
}

function firstDefinedString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

export function useGateway(config: GatewayConfig = {}) {
  // Use current hostname for WebSocket connection (allows access from other machines)
  const defaultUrl = `ws://${window.location.hostname}:18789`;

  const { url = defaultUrl, token = "" } = config;

  const [connected, setConnected] = useState(globalConnected);
  const [connecting, setConnecting] = useState(globalConnecting);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainSessionKey, setMainSessionKey] = useState(globalMainSessionKey);
  const [defaultAgentId, setDefaultAgentId] = useState(globalDefaultAgentId);
  const [tokenSyncTick, setTokenSyncTick] = useState(0);

  const requestIdRef = useRef(0);
  // Use module-level maps so WS onmessage handler always sees current state after HMR
  const pendingRequestsRef = useRef(globalPendingRequests);
  pendingRequestsRef.current = globalPendingRequests;

  const eventHandlersRef = useRef(globalEventHandlers);
  eventHandlersRef.current = globalEventHandlers;

  useEffect(() => {
    const applyTokenFromStorage = (nextToken: string) => {
      if (nextToken === runtimeGatewayTokenOverride) return;
      runtimeGatewayTokenOverride = nextToken;
      setTokenSyncTick((tick) => tick + 1);
    };
    applyTokenFromStorage(readStoredDashboardGatewayToken());
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "argent.control.settings.v1") return;
      applyTokenFromStorage(readStoredDashboardGatewayToken());
    };
    const onGatewayTokenUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ token?: string }>).detail;
      const tokenFromEvent = typeof detail?.token === "string" ? detail.token.trim() : "";
      applyTokenFromStorage(tokenFromEvent || readStoredDashboardGatewayToken());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("argent:gateway-token-updated", onGatewayTokenUpdated as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        "argent:gateway-token-updated",
        onGatewayTokenUpdated as EventListener,
      );
    };
  }, []);

  // Abort mechanism: stores the unsubscribe + resolve for the current in-flight sendMessage
  const currentRunAbortRef = useRef<{
    unsubscribe: () => void;
    resolve: (value: string) => void;
    content: string;
    runId: string;
  } | null>(null);

  // Generate unique request ID
  const nextRequestId = useCallback(() => {
    requestIdRef.current += 1;
    return `req-${Date.now()}-${requestIdRef.current}`;
  }, []);

  // Send a request and wait for response
  const request = useCallback(
    async <T = unknown>(
      method: string,
      params: Record<string, unknown> = {},
      options: GatewayRequestOptions = {},
    ): Promise<T> => {
      if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
        throw new Error("Not connected to Gateway");
      }

      const id = nextRequestId();

      return new Promise((resolve, reject) => {
        globalPendingRequests.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
        });

        const message: GatewayMessage = {
          type: "req",
          id,
          method,
          params,
        };

        globalWs!.send(JSON.stringify(message));

        const timeoutMs =
          typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
            ? Math.max(1, Math.floor(options.timeoutMs))
            : 60000;
        // Timeout after 60 seconds by default.
        setTimeout(() => {
          if (globalPendingRequests.has(id)) {
            globalPendingRequests.delete(id);
            reject(new Error("Request timeout"));
          }
        }, timeoutMs);
      });
    },
    [nextRequestId],
  );

  // Subscribe to events (uses module-level map to survive HMR)
  const on = useCallback((event: string, handler: (payload: unknown) => void) => {
    if (!globalEventHandlers.has(event)) {
      globalEventHandlers.set(event, new Set());
    }
    globalEventHandlers.get(event)!.add(handler);

    return () => {
      globalEventHandlers.get(event)?.delete(handler);
    };
  }, []);

  const emitFilesystemPermissionDenied = useCallback(
    (params: {
      source: "agent" | "chat";
      runId?: string;
      sessionKey?: string;
      toolName?: string;
      error: string;
    }) => {
      const parsed = parseFilesystemPathDenial(params.error);
      if (!parsed) return;
      const payload: FilesystemPermissionDeniedEvent = {
        source: params.source,
        runId: params.runId,
        sessionKey: toCanonicalSessionKey(params.sessionKey),
        toolName: params.toolName,
        attemptedPath: parsed.attemptedPath,
        allowedDirectories: parsed.allowedDirectories,
        rawError: params.error,
        ts: Date.now(),
      };
      const handlers = globalEventHandlers.get("filesystem.permission.denied");
      if (handlers) {
        handlers.forEach((handler) => handler(payload));
      }
    },
    [],
  );

  // Abort the current in-flight sendMessage (for interrupt)
  const abortCurrentStream = useCallback(() => {
    const current = currentRunAbortRef.current;
    if (current) {
      current.unsubscribe();
      current.resolve(current.content || "");
      currentRunAbortRef.current = null;
    }
  }, []);

  // Stop the current run with server-side abort
  const stopCurrentRun = useCallback(
    async (sessionKey?: string) => {
      const canonicalSessionKey = toCanonicalSessionKey(sessionKey);
      // Client-side: abort stream listener immediately
      abortCurrentStream();
      // Server-side: call chat.abort RPC to kill the agent run
      try {
        await request("chat.abort", { sessionKey: canonicalSessionKey });
      } catch {
        // Fallback: client-side abort already handled
        console.warn("[Gateway] Server-side abort failed, client-side cleanup done");
      }
    },
    [abortCurrentStream, request],
  );

  // Send a chat message to the agent
  const sendMessage = useCallback(
    async (
      message: string,
      onStream?: (content: string, done: boolean) => void,
      onModelInfo?: (info: {
        provider?: string;
        model?: string;
        tier?: string;
        score?: number;
        routed?: boolean;
        matchedSkills?: Array<{
          id?: string;
          name: string;
          source: string;
          kind?: "generic" | "personal";
          state?: string;
          score: number;
          confidence?: number;
          provenanceCount?: number;
          reasons?: string[];
        }>;
        personalProcedure?: {
          id?: string;
          name?: string;
          scope?: string;
          steps?: Array<{
            index?: number;
            text?: string;
            expectedTools?: string[];
          }>;
          completedStepCount?: number;
          totalStepCount?: number;
          missingSteps?: string[];
          executedTools?: string[];
          succeeded?: boolean;
        };
      }) => void,
      onToolUse?: (toolName: string, phase: "start" | "end") => void,
      attachments?: Array<{ type: string; mimeType: string; fileName: string; content: string }>,
      sessionKey?: string,
      options?: { thinking?: string; busyMode?: BusyMode },
    ): Promise<string> => {
      // Generate the idempotency key upfront — the server uses it as the runId,
      // so we know which events belong to our run before we even send the request.
      const expectedRunId = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      activeUserRunIds.add(expectedRunId);

      return new Promise((resolve, reject) => {
        let accumulatedContent = "";
        const canonicalSessionKey = toCanonicalSessionKey(sessionKey);

        // Subscribe to agent events, filtering by our expected runId
        const unsubscribe = on("agent", (payload: unknown) => {
          const event = payload as {
            runId?: string;
            stream?: string;
            data?: {
              text?: string;
              delta?: string;
              phase?: string;
              content?: string;
              provider?: string;
              model?: string;
              tier?: string;
              score?: number;
              routed?: boolean;
              matchedSkills?: Array<{
                id?: string;
                name?: string;
                source?: string;
                kind?: "generic" | "personal";
                state?: string;
                score?: number;
                confidence?: number;
                provenanceCount?: number;
                reasons?: string[];
              }>;
              personalProcedure?: {
                id?: string;
                name?: string;
                scope?: string;
                steps?: Array<{
                  index?: number;
                  text?: string;
                  expectedTools?: string[];
                }>;
                completedStepCount?: number;
                totalStepCount?: number;
                missingSteps?: string[];
                executedTools?: string[];
                succeeded?: boolean;
              };
              skill?: Record<string, unknown>;
              plan?: Array<{
                index?: number;
                text?: string;
                expectedTools?: string[];
              }>;
              report?: {
                completedStepCount?: number;
                totalStepCount?: number;
                missingSteps?: string[];
                executedTools?: string[];
                succeeded?: boolean;
              };
              name?: string;
              error?: string;
            };
            text?: string;
            content?: string;
          };

          // Only process events for OUR run — ignore background runs completely.
          // A missing runId is treated as non-user traffic here to prevent
          // cross-run leakage (e.g. contemplation output showing in webchat).
          if (event.runId !== expectedRunId) {
            return;
          }

          if (DEBUG_GATEWAY_STREAM) {
            console.log("[Gateway] Agent event:", JSON.stringify(event).substring(0, 500));
          }

          // Handle model selection event from the model router
          if (event.stream === "lifecycle" && event.data?.phase === "model_selected") {
            onModelInfo?.({
              provider: event.data.provider ?? "",
              model: event.data.model ?? "",
              tier: event.data.tier ?? "",
              score: event.data.score ?? 0,
              routed: event.data.routed ?? false,
            });
          }

          if (event.stream === "lifecycle" && event.data?.phase === "skill_candidates") {
            const matchedSkills = Array.isArray(event.data.matchedSkills)
              ? event.data.matchedSkills
                  .map((entry) => ({
                    id: typeof entry?.id === "string" ? entry.id : undefined,
                    name: String(entry?.name ?? "").trim(),
                    source: String(entry?.source ?? "").trim(),
                    kind: entry?.kind === "personal" ? ("personal" as const) : ("generic" as const),
                    state: typeof entry?.state === "string" ? entry.state : undefined,
                    score: Number(entry?.score ?? 0),
                    confidence:
                      typeof entry?.confidence === "number" ? entry.confidence : undefined,
                    provenanceCount:
                      typeof entry?.provenanceCount === "number"
                        ? entry.provenanceCount
                        : undefined,
                    reasons: Array.isArray(entry?.reasons)
                      ? entry.reasons.filter(
                          (reason): reason is string => typeof reason === "string",
                        )
                      : undefined,
                  }))
                  .filter((entry) => entry.name.length > 0)
              : [];
            onModelInfo?.({
              matchedSkills,
            });
          }

          if (
            event.stream === "lifecycle" &&
            event.data?.phase === "personal_skill_execution_mode"
          ) {
            const skill = event.data.skill;
            if (skill && typeof skill === "object") {
              onModelInfo?.({
                personalProcedure: {
                  id: typeof skill.id === "string" ? skill.id : undefined,
                  name: String(skill.name ?? "").trim() || undefined,
                  scope: typeof skill.scope === "string" ? skill.scope : undefined,
                  steps: Array.isArray(event.data.plan)
                    ? event.data.plan.map((step) => ({
                        index: typeof step?.index === "number" ? step.index : undefined,
                        text: typeof step?.text === "string" ? step.text : undefined,
                        expectedTools: Array.isArray(step?.expectedTools)
                          ? step.expectedTools.filter(
                              (tool): tool is string => typeof tool === "string",
                            )
                          : undefined,
                      }))
                    : undefined,
                },
              });
            }
          }

          if (
            event.stream === "lifecycle" &&
            event.data?.phase === "personal_skill_execution_report"
          ) {
            const report = event.data.report;
            if (report && typeof report === "object") {
              onModelInfo?.({
                personalProcedure: {
                  completedStepCount:
                    typeof report.completedStepCount === "number"
                      ? report.completedStepCount
                      : undefined,
                  totalStepCount:
                    typeof report.totalStepCount === "number" ? report.totalStepCount : undefined,
                  missingSteps: Array.isArray(report.missingSteps)
                    ? report.missingSteps.filter((step): step is string => typeof step === "string")
                    : undefined,
                  executedTools: Array.isArray(report.executedTools)
                    ? report.executedTools.filter(
                        (tool): tool is string => typeof tool === "string",
                      )
                    : undefined,
                  succeeded: typeof report.succeeded === "boolean" ? report.succeeded : undefined,
                },
              });
            }
          }

          // Handle tool events — capture tool name for badge display
          if (event.stream === "tool" && event.data?.name) {
            const phase = event.data.phase as "start" | "end";
            if (phase === "start" || phase === "end") {
              onToolUse?.(event.data.name, phase);
            }
            if (
              event.data.phase === "error" &&
              typeof event.data.error === "string" &&
              event.data.error.trim()
            ) {
              emitFilesystemPermissionDenied({
                source: "agent",
                runId: event.runId,
                sessionKey: canonicalSessionKey,
                toolName: event.data.name,
                error: event.data.error,
              });
            }
          }

          // Handle assistant stream - check multiple possible formats
          if (event.stream === "assistant") {
            const text = firstDefinedString(
              event.data?.text,
              event.data?.content,
              event.text,
              event.content,
            );
            if (typeof text === "string") {
              accumulatedContent = text;
              // Keep abort ref content in sync
              if (currentRunAbortRef.current) {
                currentRunAbortRef.current.content = accumulatedContent;
              }
              if (DEBUG_GATEWAY_STREAM) {
                console.log("[Gateway] Got assistant text:", text.substring(0, 100));
              }
              onStream?.(accumulatedContent, false);
            }
          }

          // Also handle 'text' stream (alternative format)
          if (event.stream === "text" && event.data?.text) {
            accumulatedContent += event.data.text;
            if (currentRunAbortRef.current) {
              currentRunAbortRef.current.content = accumulatedContent;
            }
            onStream?.(accumulatedContent, false);
          }

          // Handle run_complete — the definitive end of the entire agent run.
          // Per-turn lifecycle/end events fire for EACH tool-use cycle; only
          // run_complete fires once after all turns are done.
          if (event.stream === "lifecycle" && event.data?.phase === "run_complete") {
            // run_complete may carry the final text when streaming didn't deliver it
            const runText = event.data?.text as string | undefined;
            if (runText && !accumulatedContent) {
              accumulatedContent = runText;
              if (currentRunAbortRef.current) {
                currentRunAbortRef.current.content = accumulatedContent;
              }
            }

            // Surface provider errors as visible messages instead of "No response"
            if (!accumulatedContent && event.data?.error) {
              const errorStr = String(event.data.error);
              emitFilesystemPermissionDenied({
                source: "agent",
                runId: event.runId,
                sessionKey: canonicalSessionKey,
                error: errorStr,
              });
              accumulatedContent = formatProviderError(errorStr);
            }

            console.log(
              "[Gateway] Run complete, accumulated:",
              accumulatedContent?.substring(0, 100),
            );
            unsubscribe();
            currentRunAbortRef.current = null;
            onStream?.(accumulatedContent, true);
            resolve(accumulatedContent || "No response");
          }

          // Legacy fallback: handle lifecycle/end in case run_complete is missing
          // (e.g., connecting to an older gateway that doesn't emit run_complete).
          // Only resolve if we already have accumulated content.
          if (event.stream === "lifecycle" && event.data?.phase === "end") {
            console.log(
              "[Gateway] Lifecycle end, accumulated:",
              accumulatedContent?.substring(0, 100),
            );
          }
        });

        // Store abort handle for interrupt
        currentRunAbortRef.current = {
          unsubscribe,
          resolve,
          content: accumulatedContent,
          runId: expectedRunId,
        };

        // Send the request — use the pre-generated expectedRunId as idempotencyKey
        const resolvedAgentId = resolveSessionAgentIdFromKey(canonicalSessionKey);
        const agentParams: Record<string, unknown> = {
          message,
          agentId: resolvedAgentId,
          idempotencyKey: expectedRunId,
          sessionKey: canonicalSessionKey,
        };
        if (options?.thinking) {
          agentParams.thinking = options.thinking;
        }
        if (options?.busyMode) {
          agentParams.busyMode = options.busyMode;
        }
        if (attachments && attachments.length > 0) {
          agentParams.attachments = attachments;
        }
        request<{ runId?: string; status?: string; summary?: string }>("agent", agentParams)
          .then((response) => {
            if (response.status === "steered") {
              unsubscribe();
              currentRunAbortRef.current = null;
              const steered = "Steered into active run.";
              onStream?.(steered, true);
              resolve(steered);
              return;
            }
            // If we got a final response directly (non-streaming case)
            if (response.status === "ok" && response.summary && !accumulatedContent) {
              unsubscribe();
              currentRunAbortRef.current = null;
              onStream?.(response.summary, true);
              resolve(response.summary);
            }
            // Surface error responses (e.g. 429 rate limit) as visible messages
            if (response.status === "error" && !accumulatedContent) {
              const errMsg = response.summary || "Unknown error";
              emitFilesystemPermissionDenied({
                source: "chat",
                runId: expectedRunId,
                sessionKey: canonicalSessionKey,
                error: errMsg,
              });
              // Extract a user-friendly message from FailoverError strings
              const rateMatch = errMsg.match(/rate.limit|429/i);
              const errorText = rateMatch
                ? `Rate limited — all accounts exhausted. Please wait a moment and try again.`
                : `Error: ${errMsg.length > 200 ? errMsg.slice(0, 200) + "…" : errMsg}`;
              unsubscribe();
              currentRunAbortRef.current = null;
              onStream?.(errorText, true);
              resolve(errorText);
            }
          })
          .catch((err) => {
            unsubscribe();
            currentRunAbortRef.current = null;
            // Surface the error as a visible message instead of silently failing
            const errStr = String(err?.message || err);
            emitFilesystemPermissionDenied({
              source: "chat",
              runId: expectedRunId,
              sessionKey: canonicalSessionKey,
              error: errStr,
            });
            const rateMatch = errStr.match(/rate.limit|429/i);
            const errorText = rateMatch
              ? `Rate limited — all accounts exhausted. Please wait a moment and try again.`
              : `Error: ${errStr.length > 200 ? errStr.slice(0, 200) + "…" : errStr}`;
            onStream?.(errorText, true);
            resolve(errorText);
          });

        // Timeout after 5 minutes (only if no content received at all)
        setTimeout(() => {
          if (!accumulatedContent) {
            unsubscribe();
            currentRunAbortRef.current = null;
            reject(new Error("Response timeout"));
          }
        }, 300000);
      });
    },
    [emitFilesystemPermissionDenied, request, on],
  );

  const steerMessage = useCallback(
    async (
      message: string,
      attachments?: Array<{ type: string; mimeType: string; fileName: string; content: string }>,
      sessionKey?: string,
      options?: { thinking?: string },
    ): Promise<{ runId: string; status: string; sessionId?: string }> => {
      const canonicalSessionKey = toCanonicalSessionKey(sessionKey);
      const runId = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const resolvedAgentId = resolveSessionAgentIdFromKey(canonicalSessionKey);
      const params: Record<string, unknown> = {
        message,
        agentId: resolvedAgentId,
        sessionKey: canonicalSessionKey,
        idempotencyKey: runId,
        busyMode: "steer",
      };
      if (options?.thinking) {
        params.thinking = options.thinking;
      }
      if (attachments && attachments.length > 0) {
        params.attachments = attachments;
      }
      const response = await request<{ runId?: string; status?: string; sessionId?: string }>(
        "agent",
        params,
      );
      return {
        runId: typeof response?.runId === "string" ? response.runId : runId,
        status: typeof response?.status === "string" ? response.status : "unknown",
        sessionId: typeof response?.sessionId === "string" ? response.sessionId : undefined,
      };
    },
    [request],
  );

  // Connect to the Gateway
  const connect = useCallback(
    (opts?: { fromRetry?: boolean }) => {
      if (!opts?.fromRetry) {
        suppressAutoReconnectUntilManualConnect = false;
      }
      // If already connected or connecting, return existing promise
      if (globalWs && globalWs.readyState === WebSocket.OPEN) {
        setConnected(true);
        return Promise.resolve();
      }

      if (connectionPromise) {
        return connectionPromise;
      }

      // Clear manual disconnect flag when explicitly connecting
      manualDisconnect = false;

      connectionPromise = new Promise<void>((resolve, reject) => {
        globalConnecting = true;
        setConnecting(true);
        setError(null);

        const ws = new WebSocket(url);
        globalWs = ws;
        let connectNonce: string | null = null;
        let connectSent = false;
        let connectTimer: ReturnType<typeof setTimeout> | null = null;
        let connectDeviceIdentity: Awaited<ReturnType<typeof loadOrCreateDeviceIdentity>> | null =
          null;
        let connectCanFallbackToShared = false;

        const clearConnectTimer = () => {
          if (connectTimer !== null) {
            clearTimeout(connectTimer);
            connectTimer = null;
          }
        };

        const sendConnect = async () => {
          if (connectSent || ws.readyState !== WebSocket.OPEN) {
            return;
          }
          connectSent = true;
          clearConnectTimer();

          const requestedToken = (runtimeGatewayTokenOverride || token).trim();
          const isSecureBrowserContext = typeof crypto !== "undefined" && !!crypto.subtle;
          connectDeviceIdentity = null;
          connectCanFallbackToShared = false;

          let authToken: string | undefined = requestedToken || undefined;
          let device:
            | {
                id: string;
                publicKey: string;
                signature: string;
                signedAt: number;
                nonce: string | undefined;
              }
            | undefined;

          if (isSecureBrowserContext) {
            const deviceIdentity = await loadOrCreateDeviceIdentity();
            connectDeviceIdentity = deviceIdentity;
            const storedDeviceToken = loadDeviceAuthToken({
              deviceId: deviceIdentity.deviceId,
              role: DASHBOARD_GATEWAY_ROLE,
            })?.token;
            authToken = storedDeviceToken ?? authToken;
            connectCanFallbackToShared = Boolean(storedDeviceToken && requestedToken);

            const signedAtMs = Date.now();
            const payload = buildDeviceAuthPayload({
              deviceId: deviceIdentity.deviceId,
              clientId: DASHBOARD_GATEWAY_CLIENT_ID,
              clientMode: DASHBOARD_GATEWAY_CLIENT_MODE,
              role: DASHBOARD_GATEWAY_ROLE,
              scopes: DASHBOARD_GATEWAY_SCOPES,
              signedAtMs,
              token: authToken ?? null,
              nonce: connectNonce,
            });
            device = {
              id: deviceIdentity.deviceId,
              publicKey: deviceIdentity.publicKey,
              signature: await signDevicePayload(deviceIdentity.privateKey, payload),
              signedAt: signedAtMs,
              nonce: connectNonce ?? undefined,
            };
          }

          const connectMsg: GatewayMessage = {
            type: "req",
            id: `connect-${Date.now()}`,
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: DASHBOARD_GATEWAY_CLIENT_ID,
                version: "1.0.0",
                platform: navigator.platform || "web",
                mode: DASHBOARD_GATEWAY_CLIENT_MODE,
              },
              role: DASHBOARD_GATEWAY_ROLE,
              scopes: DASHBOARD_GATEWAY_SCOPES,
              device,
              caps: ["tool-events"],
              auth: authToken ? { token: authToken } : undefined,
              userAgent: navigator.userAgent,
              locale: navigator.language,
            },
          };
          ws.send(JSON.stringify(connectMsg));
        };

        ws.onopen = () => {
          console.log("[Gateway] WebSocket opened, waiting for connect challenge...");
          connectNonce = null;
          connectSent = false;
          clearConnectTimer();
          connectTimer = setTimeout(() => {
            void sendConnect();
          }, 750);
        };

        ws.onmessage = (event) => {
          try {
            const msg: GatewayMessage = JSON.parse(event.data);

            if (msg.type === "res") {
              // Check if this is the connect response
              if (msg.ok && (msg.payload as Record<string, unknown>)?.type === "hello-ok") {
                console.log("[Gateway] Connected successfully!");
                const helloPayload = msg.payload as GatewayHelloPayload;
                if (helloPayload.auth?.deviceToken && connectDeviceIdentity) {
                  storeDeviceAuthToken({
                    deviceId: connectDeviceIdentity.deviceId,
                    role: helloPayload.auth.role ?? DASHBOARD_GATEWAY_ROLE,
                    token: helloPayload.auth.deviceToken,
                    scopes: helloPayload.auth.scopes ?? DASHBOARD_GATEWAY_SCOPES,
                  });
                }
                const defaults = helloPayload.snapshot?.sessionDefaults;
                const resolvedMain =
                  typeof defaults?.mainSessionKey === "string" && defaults.mainSessionKey.trim()
                    ? defaults.mainSessionKey.trim()
                    : DEFAULT_MAIN_SESSION_KEY;
                const resolvedAgent = resolvePrimaryChatAgentId(
                  resolvedMain,
                  typeof defaults?.defaultAgentId === "string" && defaults.defaultAgentId.trim()
                    ? defaults.defaultAgentId.trim().toLowerCase()
                    : DEFAULT_AGENT_ID,
                );
                globalMainSessionKey = resolvedMain;
                globalDefaultAgentId = resolvedAgent;
                globalGatewayUrl = url;
                globalGatewayToken = (runtimeGatewayTokenOverride || token).trim();
                setMainSessionKey(resolvedMain);
                setDefaultAgentId(resolvedAgent);
                globalConnected = true;
                globalConnecting = false;
                reconnectAttempts = 0; // Reset reconnect counter on success
                setConnected(true);
                setConnecting(false);
                setReconnecting(false);
                connectionPromise = null;
                resolve();
              } else if (!msg.ok && msg.id?.startsWith("connect-")) {
                // Connect failed
                console.error("[Gateway] Connect failed:", msg.error);
                if (connectCanFallbackToShared && connectDeviceIdentity) {
                  clearDeviceAuthToken({
                    deviceId: connectDeviceIdentity.deviceId,
                    role: DASHBOARD_GATEWAY_ROLE,
                  });
                }
                const rawError = msg.error?.message || "Connection failed";
                if (isPermanentConnectFailureMessage(rawError)) {
                  suppressAutoReconnectUntilManualConnect = true;
                }
                const displayError = addGatewayTokenHint(rawError);
                globalConnecting = false;
                setConnecting(false);
                setError(displayError);
                connectionPromise = null;
                reject(new Error(displayError));
              }

              // Handle other responses — use module-level map to survive HMR
              if (msg.id && globalPendingRequests.has(msg.id)) {
                const { resolve: res, reject: rej } = globalPendingRequests.get(msg.id)!;
                globalPendingRequests.delete(msg.id);

                if (msg.ok) {
                  res(msg.payload);
                } else {
                  rej(new Error(msg.error?.message || "Request failed"));
                }
              }
            } else if (msg.type === "event" && msg.event) {
              if (msg.event === "connect.challenge") {
                const payload = msg.payload as { nonce?: unknown } | undefined;
                const nonce = payload && typeof payload.nonce === "string" ? payload.nonce : "";
                if (nonce) {
                  connectNonce = nonce;
                  void sendConnect();
                }
                return;
              }

              if (msg.event === "agent") {
                const payload = (msg.payload ?? {}) as {
                  runId?: string;
                  sessionKey?: string;
                  stream?: string;
                  data?: {
                    phase?: string;
                    name?: string;
                    error?: string;
                  };
                };
                if (
                  payload.stream === "tool" &&
                  payload.data?.phase === "error" &&
                  typeof payload.data.error === "string" &&
                  payload.data.error.trim()
                ) {
                  emitFilesystemPermissionDenied({
                    source: "agent",
                    runId: payload.runId,
                    sessionKey: payload.sessionKey,
                    toolName: payload.data.name,
                    error: payload.data.error,
                  });
                }
                if (
                  payload.stream === "lifecycle" &&
                  (payload.data?.phase === "error" || payload.data?.phase === "run_complete") &&
                  typeof payload.data.error === "string" &&
                  payload.data.error.trim()
                ) {
                  emitFilesystemPermissionDenied({
                    source: "agent",
                    runId: payload.runId,
                    sessionKey: payload.sessionKey,
                    error: payload.data.error,
                  });
                }
              } else if (msg.event === "chat") {
                const payload = (msg.payload ?? {}) as {
                  runId?: string;
                  sessionKey?: string;
                  state?: string;
                  errorMessage?: string;
                };
                if (
                  payload.state === "error" &&
                  typeof payload.errorMessage === "string" &&
                  payload.errorMessage.trim()
                ) {
                  emitFilesystemPermissionDenied({
                    source: "chat",
                    runId: payload.runId,
                    sessionKey: payload.sessionKey,
                    error: payload.errorMessage,
                  });
                }
              }

              // Handle event — use module-level map to survive HMR
              const handlers = globalEventHandlers.get(msg.event);
              if (handlers) {
                handlers.forEach((handler) => handler(msg.payload));
              }
            }
          } catch (err) {
            console.error("[Gateway] Failed to parse message:", err);
          }
        };

        ws.onerror = (event) => {
          console.error("[Gateway] WebSocket error:", event);
          setError("Connection error");
          globalConnecting = false;
          setConnecting(false);
          connectionPromise = null;
          reject(new Error("Connection error"));
        };

        ws.onclose = (event) => {
          console.log("[Gateway] WebSocket closed:", event.code, event.reason);
          globalConnected = false;
          globalConnecting = false;
          globalWs = null;
          connectionPromise = null;
          clearConnectTimer();
          setConnected(false);
          setConnecting(false);

          // Reject all pending requests (module-level map)
          globalPendingRequests.forEach(({ reject: rej }) => {
            rej(new Error("Connection closed"));
          });
          globalPendingRequests.clear();

          const closeReason = String(event.reason || "");
          if (event.code === 1008 && isPermanentConnectFailureMessage(closeReason)) {
            suppressAutoReconnectUntilManualConnect = true;
          }

          // Auto-reconnect unless manually disconnected or a permanent handshake failure occurred
          if (!manualDisconnect && !suppressAutoReconnectUntilManualConnect) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000); // Max 30s
            console.log(`[Gateway] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);
            setReconnecting(true);

            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(() => {
              console.log("[Gateway] Attempting reconnection...");
              connect({ fromRetry: true })
                .then(() => {
                  console.log("[Gateway] Reconnected successfully");
                  reconnectAttempts = 0;
                  setReconnecting(false);
                })
                .catch((err) => {
                  console.error("[Gateway] Reconnection failed:", err);
                  // onclose will trigger another retry
                });
            }, delay);
          } else if (suppressAutoReconnectUntilManualConnect) {
            setReconnecting(false);
            console.warn(
              "[Gateway] Auto-reconnect paused due to persistent auth/device handshake failure.",
            );
          }
        };
      });

      return connectionPromise;
    },
    [emitFilesystemPermissionDenied, url, token],
  );

  // Disconnect from the Gateway
  const disconnect = useCallback(() => {
    manualDisconnect = true;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (globalWs) {
      globalWs.close();
      globalWs = null;
    }
    globalConnected = false;
    globalConnecting = false;
    globalGatewayUrl = "";
    globalGatewayToken = "";
    connectionPromise = null;
    setConnected(false);
    setReconnecting(false);
  }, []);

  useEffect(() => {
    const nextUrl = String(url || "").trim();
    const nextToken = String(runtimeGatewayTokenOverride || token || "").trim();
    const shouldRefreshCredentials = shouldForceGatewayCredentialReconnect({
      connected: globalConnected,
      suppressedAutoReconnect: suppressAutoReconnectUntilManualConnect,
      currentUrl: globalGatewayUrl,
      currentToken: globalGatewayToken,
      nextUrl,
      nextToken,
    });
    if (!shouldRefreshCredentials) {
      return;
    }
    console.log("[Gateway] Credentials changed; reconnecting with updated gateway auth token.");
    suppressAutoReconnectUntilManualConnect = false;
    reconnectAttempts = 0;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (globalWs) {
      globalWs.close(1000, "gateway-auth-updated");
    }
    setReconnecting(true);
    const timer = setTimeout(() => {
      connect()
        .then(() => {
          console.log("[Gateway] Reconnected with updated gateway token.");
          setReconnecting(false);
        })
        .catch((err) => {
          console.error("[Gateway] Reconnect with updated token failed:", err);
        });
    }, 50);
    return () => clearTimeout(timer);
  }, [connect, token, tokenSyncTick, url]);

  // Connect on mount
  useEffect(() => {
    // Small delay to let React StrictMode settle
    const timeout = setTimeout(() => {
      connect().catch((err) => {
        console.error("[Gateway] Auto-connect failed:", err);
      });
    }, 100);

    return () => {
      clearTimeout(timeout);
      // Don't disconnect on unmount - keep the singleton alive
    };
  }, [connect]);

  // Sync state with global
  useEffect(() => {
    const interval = setInterval(() => {
      if (globalConnected !== connected) {
        setConnected(globalConnected);
      }
      if (globalConnecting !== connecting) {
        setConnecting(globalConnecting);
      }
      if (globalMainSessionKey !== mainSessionKey) {
        setMainSessionKey(globalMainSessionKey);
      }
      if (globalDefaultAgentId !== defaultAgentId) {
        setDefaultAgentId(globalDefaultAgentId);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [connected, connecting, defaultAgentId, mainSessionKey]);

  // ── Session Management ──

  interface GatewaySessionRow {
    key: string;
    sessionId?: string;
    updatedAt?: number;
    label?: string;
    displayName?: string;
    subject?: string;
    channel?: string;
    lastMessage?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    contextTokens?: number;
  }

  const listSessions = useCallback(
    async (opts?: { limit?: number; search?: string }) => {
      const res = await request<{
        sessions: GatewaySessionRow[];
        count: number;
      }>("sessions.list", {
        limit: opts?.limit ?? 50,
        search: opts?.search,
        includeLastMessage: true,
        includeDerivedTitles: true,
      });
      return res;
    },
    [request],
  );

  const getSessionHistory = useCallback(
    async (sessionKey: string, limit = 100) => {
      const canonicalSessionKey = toCanonicalSessionKey(sessionKey);
      const res = await request<{
        sessionKey: string;
        sessionId?: string;
        messages: Array<{
          role: "user" | "assistant";
          content: Array<{ type: string; text?: string }>;
          timestamp: number;
        }>;
      }>("chat.history", { sessionKey: canonicalSessionKey, limit });
      return res;
    },
    [request],
  );

  const resetSession = useCallback(
    async (sessionKey: string) => {
      const canonicalSessionKey = toCanonicalSessionKey(sessionKey);
      return request<{ ok: boolean; key: string }>("sessions.reset", { key: canonicalSessionKey });
    },
    [request],
  );

  const deleteSession = useCallback(
    async (sessionKey: string) => {
      const canonicalSessionKey = toCanonicalSessionKey(sessionKey);
      return request<{ ok: boolean; key: string }>("sessions.delete", {
        key: canonicalSessionKey,
        deleteTranscript: true,
      });
    },
    [request],
  );

  // ── Transcript Search ──

  interface SearchHit {
    sessionKey: string;
    role: string;
    snippet: string;
    timestamp: number;
    sessionUpdatedAt: number;
  }

  const searchSessions = useCallback(
    async (query: string, limit = 30) => {
      return request<{
        query: string;
        count: number;
        hits: SearchHit[];
      }>("sessions.search", { query, limit });
    },
    [request],
  );

  // ── Commands ──

  interface CommandDef {
    key: string;
    description: string;
    aliases: string[];
    category: string;
    acceptsArgs: boolean;
  }

  const listCommands = useCallback(async () => {
    return request<{ commands: CommandDef[] }>("commands.list", {});
  }, [request]);

  const getSessionTokens = useCallback(
    async (sessionKey: string) => {
      const canonicalSessionKey = toCanonicalSessionKey(sessionKey);
      const keyVariants = new Set<string>([sessionKey, canonicalSessionKey]);
      if (sessionKey === "main") {
        keyVariants.add(globalMainSessionKey);
      }
      if (!sessionKey.startsWith("agent:") && sessionKey !== "global") {
        const primaryAgentId = resolvePrimaryChatAgentId(
          globalMainSessionKey,
          globalDefaultAgentId || DEFAULT_AGENT_ID,
        );
        keyVariants.add(`agent:${primaryAgentId}:${sessionKey}`);
      }
      const lookup = async (search: string) =>
        await request<{
          sessions: GatewaySessionRow[];
          defaults?: { contextTokens?: number | null };
        }>("sessions.list", {
          limit: 25,
          search,
        });

      let res = await lookup(canonicalSessionKey);
      let session = res.sessions.find(
        (s) => keyVariants.has(s.key) || s.key?.endsWith(`:${sessionKey}`),
      );
      if (!session) {
        res = await request<{
          sessions: GatewaySessionRow[];
          defaults?: { contextTokens?: number | null };
        }>("sessions.list", { limit: 100 });
        session = res.sessions.find(
          (s) => keyVariants.has(s.key) || s.key?.endsWith(`:${sessionKey}`),
        );
      }
      const defaultCtx = res.defaults?.contextTokens ?? 200_000;
      let used = session?.totalTokens ?? 0;
      let estimated = false;
      const historySessionKey = session?.key ?? canonicalSessionKey;
      if (used <= 0) {
        try {
          const history = await getSessionHistory(historySessionKey, 120);
          const estimatedTokens = history.messages.reduce((sum, message) => {
            const chars = (message.content ?? []).reduce((partSum, part) => {
              return partSum + (typeof part.text === "string" ? part.text.length : 0);
            }, 0);
            return sum + Math.ceil(chars / 3.5);
          }, 0);
          used = estimatedTokens;
          estimated = used > 0;
        } catch {
          // Leave used as 0 when history can't be fetched.
        }
      }
      return {
        used,
        total: session?.contextTokens ?? defaultCtx,
        estimated,
      };
    },
    [getSessionHistory, request],
  );

  const compactSession = useCallback(
    async (sessionKey: string, instructions?: string) => {
      const canonicalSessionKey = toCanonicalSessionKey(sessionKey);
      return request<{
        ok: boolean;
        compacted: boolean;
        reason?: string;
        tokensBefore?: number;
        tokensAfter?: number;
      }>("commands.compact", { sessionKey: canonicalSessionKey, instructions });
    },
    [request],
  );

  return {
    connected,
    connecting,
    reconnecting,
    error,
    mainSessionKey,
    defaultAgentId,
    connect,
    disconnect,
    request,
    sendMessage,
    steerMessage,
    abortCurrentStream,
    stopCurrentRun,
    on,
    listSessions,
    getSessionHistory,
    resetSession,
    deleteSession,
    searchSessions,
    listCommands,
    compactSession,
    getSessionTokens,
    activeUserRunIds,
  };
}
