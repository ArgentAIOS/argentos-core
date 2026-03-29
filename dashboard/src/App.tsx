import { useState, useEffect, useCallback, useRef } from "react";
import type { AgentVisualIdentity, AccessibilityConfig, IdentityStyleCategory } from "./aevp/types";
import { getPreset } from "./aevp/identityPresets";
import { AmplitudeTracker } from "./aevp/speechAnalyser";
import { ARGENT_DEFAULT_IDENTITY, DEFAULT_ACCESSIBILITY } from "./aevp/types";
import { ActivityLog, type LogEntry } from "./components/ActivityLog";
// Avatar component available but not used in current layout
import { AEVPPresence } from "./components/AEVPPresence";
import { AlertsModal, useAlerts } from "./components/AlertsModal";
import { AppForge } from "./components/AppForge";
import { AppWindow } from "./components/AppWindow";
import { useAudioDevices, type Voice } from "./components/AudioDeviceSelector";
import { AvatarBackground } from "./components/AvatarBackground";
import { CalendarModal } from "./components/CalendarModal";
import { CanvasPanel, type CanvasDocument, pushToCanvas } from "./components/CanvasPanel";
import {
  ChatPanel,
  type ChatMessage,
  type ChatAttachment,
  type TtsDisplayMode,
} from "./components/ChatPanel";
import { ConfigPanel, useConfig } from "./components/ConfigPanelBridge";
import { ContemplationToast, type ContemplationEvent } from "./components/ContemplationToast";
import { CorsApprovalToast } from "./components/CorsApprovalToast";
import { useDebateState } from "./components/DebatePanel";
import {
  Live2DAvatar,
  startLipSyncWithAnalyser,
  stopLipSync,
  applyCustomization,
  resetCustomizationParams,
} from "./components/Live2DAvatar";
import { LockScreen } from "./components/LockScreen";
import { ProjectBoard } from "./components/ProjectBoard";
import { ProjectKickoffModal } from "./components/ProjectKickoffModal";
import { SessionDrawer, type SessionEntry } from "./components/SessionDrawer";
import { SetupWizard } from "./components/SetupWizard";
import { StatusBar } from "./components/StatusBar";
import { TaskList, type Task } from "./components/TaskList";
import { WeatherModal } from "./components/WeatherModal";
import { CustomWidget } from "./components/widgets/CustomWidget";
import { EmptyWidget } from "./components/widgets/EmptyWidget";
import { ScheduleWidget } from "./components/widgets/ScheduleWidget";
import { SilverPriceWidget } from "./components/widgets/SilverPriceWidget";
import { TaskManagerWidget } from "./components/widgets/TaskManagerWidget";
import { WidgetGrid, createGridItem } from "./components/widgets/WidgetGrid";
import { WidgetPicker } from "./components/widgets/WidgetPicker";
import {
  getWidget as getWidgetComponent,
  getCustomWidgetId,
} from "./components/widgets/widgetRegistry";
import { WorkflowMapCanvas } from "./components/widgets/WorkflowMapCanvas";
import { WorkflowsWidget } from "./components/widgets/WorkflowsWidget";
import { WorkerFlowModal } from "./components/WorkerFlowModalBridge";
import { WorkforceBoard } from "./components/WorkforceBoardBridge";
import { useAgentState } from "./hooks/useAgentState";
import { useApps, type ForgeApp } from "./hooks/useApps";
import { useAppWindows } from "./hooks/useAppWindows";
import { useCalendar } from "./hooks/useCalendar";
import { useCronJobs } from "./hooks/useCronJobs";
import { useGateway } from "./hooks/useGateway";
import { useIdleNudge } from "./hooks/useIdleNudge";
import { useLockScreen } from "./hooks/useLockScreen";
import { useSpeechRecognition, type RecognitionMode } from "./hooks/useSpeechRecognition";
import { useTasks } from "./hooks/useTasks";
import { useTTS } from "./hooks/useTTS";
import { useWeather } from "./hooks/useWeather";
import { useWidgets } from "./hooks/useWidgets";
import {
  WorkflowMapIcon,
  WorkflowsIcon,
  WorkloadsIcon,
  TaskManagerIcon,
  OrgChartIcon,
  ScheduleIcon,
  WorkersIcon,
  HomeIcon,
  OperationsIcon,
  ShieldIcon,
  DocumentsIcon,
} from "./icons/ArgentOS";
import { resolveAgentTtsProfile } from "./lib/agentVoiceProfiles";
import {
  loadDefaultZoom,
  saveConfig,
  loadConfig,
  loadTimePresets,
  loadBubbleConfig,
} from "./lib/avatarConfig";
import { buildPresetConfig } from "./lib/avatarPresets";
import {
  isDashboardModeAllowed,
  isWorkforceSurfaceAllowed,
  parseDashboardMode,
  parseDashboardSurfaceProfile,
  type DashboardMode,
  type DashboardSurfaceProfile,
} from "./lib/configSurfaceProfile";
import { setCorsApprovalCallback } from "./lib/corsFetch";
import { parseInlineTtsDirectives, stripInlineTtsDirectives } from "./lib/inlineTtsDirectives";
import { applyMoodContinuity } from "./lib/moodContinuity";
import { type MoodName, parseMoodName } from "./lib/moodSystem";
import { resolvePrimaryChatAgentId } from "./lib/sessionVisibility";
import { mergeVisibleChatAgentOptions } from "./lib/sessionVisibility";
import { fetchLocalApi } from "./utils/localApiFetch";

// ============================================================================
// TTS Text Preparation - Clean content for natural speech
// ============================================================================

/**
 * Prepare agent text for TTS — instant local processing, no LLM call.
 * The old summarizeForTTS called gpt-4o-mini which added 5-15s of latency.
 * prepareTextForTTS strips code/URLs/markdown and trims to conversational length.
 */
function prepareTTSContent(text: string): string {
  return prepareTextForTTS(text, 200);
}

declare global {
  interface Window {
    __argentNativeVoiceActive?: boolean;
    __argentNativeSpeechActive?: boolean;
    __argentNativeAttachTtsAudio?: (payload: { msgId: string; audioUrl: string }) => void;
    __argentNativeVoiceStateChanged?: (payload: { speaking: boolean }) => void;
    __argentNativeSpeechStateChanged?: (payload: {
      listening: boolean;
      error?: string | null;
    }) => void;
    webkit?: {
      messageHandlers?: {
        argentNativeVoiceEvent?: {
          postMessage: (payload: unknown) => void;
        };
        argentNativeSpeechEvent?: {
          postMessage: (payload: unknown) => void;
        };
      };
    };
  }
}

function isNativeVoiceActive(): boolean {
  return typeof window !== "undefined" && window.__argentNativeVoiceActive === true;
}

function isNativeSpeechActive(): boolean {
  return typeof window !== "undefined" && window.__argentNativeSpeechActive === true;
}

function postNativeVoiceEvent(payload: {
  kind: "tts_now" | "tts_final";
  text: string;
  sessionKey: string;
  messageId: string;
  mood?: string | null;
}): boolean {
  if (!isNativeVoiceActive()) return false;
  try {
    const handler = window.webkit?.messageHandlers?.argentNativeVoiceEvent;
    if (!handler) return false;
    handler.postMessage(payload);
    return true;
  } catch (error) {
    console.warn("[TTS] native voice event failed", error);
    return false;
  }
}

function postNativeVoiceCommand(payload: { kind: "tts_stop" }): boolean {
  if (!isNativeVoiceActive()) return false;
  try {
    const handler = window.webkit?.messageHandlers?.argentNativeVoiceEvent;
    if (!handler) return false;
    handler.postMessage(payload);
    return true;
  } catch (error) {
    console.warn("[TTS] native voice command failed", error);
    return false;
  }
}

function postNativeSpeechCommand(payload: { kind: "start" | "stop" }): boolean {
  if (!isNativeSpeechActive()) return false;
  try {
    const handler = window.webkit?.messageHandlers?.argentNativeSpeechEvent;
    if (!handler) return false;
    handler.postMessage(payload);
    return true;
  } catch (error) {
    console.warn("[Speech] native speech command failed", error);
    return false;
  }
}

const DEFAULT_MAIN_SESSION_KEY = "agent:main:main";
const DEFAULT_AGENT_ID = "main";
const APP_LOADING_SHELL_MARKER = "<!--APP_LOADING_SHELL-->";
const APP_LOAD_ERROR_SHELL_MARKER = "<!--APP_LOAD_ERROR_SHELL-->";
const APP_CREATED_RESULT_PATTERN = /Created app "([^"]+)" \(ID: ([^,]+), v(\d+)\)/g;

type ChatAgentOption = {
  id: string;
  label: string;
};

function normalizeAgentId(raw: string | null | undefined, fallback = DEFAULT_AGENT_ID): string {
  const value = (raw ?? "").trim().toLowerCase();
  return value || fallback;
}

function isWebchatSessionAlias(value: string): boolean {
  const key = value.trim().toLowerCase();
  if (!key) return false;
  return key === "webchat" || key.startsWith("webchat-") || key.startsWith("webchat:");
}

function buildAppStatusDoc(name: string, title: string, detail: string, marker: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${name}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background:
        radial-gradient(circle at top, rgba(168, 85, 247, 0.32), transparent 45%),
        linear-gradient(180deg, #0f0b17 0%, #09070d 100%);
      color: #f5ecff;
      padding: 24px;
    }
    .card {
      width: min(100%, 360px);
      padding: 28px 24px;
      border-radius: 24px;
      background: rgba(24, 24, 39, 0.84);
      border: 1px solid rgba(168, 85, 247, 0.25);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
      text-align: center;
    }
    .spinner {
      width: 34px;
      height: 34px;
      margin: 0 auto 16px;
      border-radius: 999px;
      border: 3px solid rgba(216, 180, 254, 0.18);
      border-top-color: #a855f7;
      animation: spin 0.9s linear infinite;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
      line-height: 1.2;
    }
    p {
      margin: 0;
      color: #c9b6eb;
      font-size: 13px;
      line-height: 1.5;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  ${marker}
  <main class="card">
    <div class="spinner" aria-hidden="true"></div>
    <h1>${title}</h1>
    <p>${detail}</p>
  </main>
</body>
</html>`;
}

function buildAppLoadingDoc(name: string): string {
  return buildAppStatusDoc(
    name,
    `Opening ${name}...`,
    "Argent is loading the full app bundle. This should only take a moment.",
    APP_LOADING_SHELL_MARKER,
  );
}

function buildAppLoadErrorDoc(name: string): string {
  return buildAppStatusDoc(
    name,
    `${name} did not load`,
    "The dashboard timed out while fetching the app code. Close the window and retry.",
    APP_LOAD_ERROR_SHELL_MARKER,
  );
}

function isAppStatusShell(code: string | null | undefined): boolean {
  return Boolean(
    code && (code.includes(APP_LOADING_SHELL_MARKER) || code.includes(APP_LOAD_ERROR_SHELL_MARKER)),
  );
}

function buildOptimisticForgeApp(input: {
  id: string;
  name: string;
  version: number;
  description?: string;
  icon?: string;
}): ForgeApp {
  const timestamp = new Date().toISOString();
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    icon: input.icon,
    version: input.version,
    creator: "ai",
    createdAt: timestamp,
    updatedAt: timestamp,
    openCount: 0,
    pinned: false,
  };
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

function toCanonicalSessionKey(
  sessionKey: string | null | undefined,
  defaults?: { mainSessionKey?: string; defaultAgentId?: string },
): string {
  const mainSessionKey = defaults?.mainSessionKey || DEFAULT_MAIN_SESSION_KEY;
  const primaryAgentId = resolvePrimaryChatAgentId(
    mainSessionKey,
    defaults?.defaultAgentId || DEFAULT_AGENT_ID,
  );
  const raw = (sessionKey ?? "").trim();
  if (!raw) return mainSessionKey;
  const lowered = raw.toLowerCase();
  if (lowered === "global") return "global";
  if (
    lowered === "main" ||
    lowered === mainSessionKey.toLowerCase() ||
    isWebchatSessionAlias(lowered)
  ) {
    return mainSessionKey;
  }
  if (raw.startsWith("agent:")) {
    const remapped = remapLegacyDefaultAgentSession({
      rawSessionKey: raw,
      mainSessionKey,
      defaultAgentId: primaryAgentId,
    });
    if (remapped) {
      return remapped;
    }
    return raw;
  }
  return `agent:${primaryAgentId}:${raw}`;
}

function resolveSessionAgentId(
  sessionKey: string | null | undefined,
  defaultAgentId = DEFAULT_AGENT_ID,
): string {
  const raw = (sessionKey ?? "").trim();
  if (!raw) return normalizeAgentId(defaultAgentId);
  const match = /^agent:([^:]+):/i.exec(raw);
  return normalizeAgentId(match?.[1], defaultAgentId);
}

function normalizeOperatorDisplayName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/\*\*/g, "")
    .replace(/[`*_]/g, "")
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
  if (!cleaned) return undefined;
  const lowered = cleaned.toLowerCase();
  if (lowered === "unknown" || lowered === "n/a" || lowered === "none" || lowered === "tbd") {
    return undefined;
  }
  if (cleaned.includes("<") || cleaned.includes(">")) {
    return undefined;
  }
  return cleaned;
}

function extractOperatorDisplayNameFromUserDoc(content: string): string | undefined {
  const patterns = [
    /^\s*-\s*Preferred address:\s*(.+)\s*$/im,
    /^\s*-\s*Preferred name:\s*(.+)\s*$/im,
    /^\s*-\s*Name:\s*(.+)\s*$/im,
    /^\s*Preferred address:\s*(.+)\s*$/im,
    /^\s*Preferred name:\s*(.+)\s*$/im,
    /^\s*Name:\s*(.+)\s*$/im,
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    const parsed = normalizeOperatorDisplayName(match?.[1]);
    if (parsed) return parsed;
  }
  return undefined;
}

function buildWelcomeText(operatorName?: string): string {
  return operatorName
    ? `Hey ${operatorName}! I'm connected and ready to help. What can I do for you?`
    : "Hey there! I'm connected and ready to help. What can I do for you?";
}

type CriticalServiceAlertPayload = {
  id: string;
  service: string;
  severity: "critical" | "warning";
  status: "down" | "invalid_config" | "stale";
  message: string;
  detail?: string;
  operatorCommand: string;
  lastSeenAt: string;
  lastSuccessAt: string | null;
  staleThresholdHours?: number;
};

function formatCriticalAlertMessage(alert: CriticalServiceAlertPayload): string {
  const seen = new Date(alert.lastSeenAt).toLocaleString();
  const success = alert.lastSuccessAt ? new Date(alert.lastSuccessAt).toLocaleString() : "never";
  const detail = alert.detail ? ` Detail: ${alert.detail}.` : "";
  const threshold =
    typeof alert.staleThresholdHours === "number"
      ? ` Threshold: ${alert.staleThresholdHours}h.`
      : "";
  return `[CRITICAL:${alert.service}] ${alert.message}${detail}${threshold} Last seen: ${seen}. Last success: ${success}. Remediation: ${alert.operatorCommand}`;
}

function isStrictPgJobsUnavailable(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error && "message" in error
          ? String((error as { message?: unknown }).message ?? "")
          : "";
  return message.includes("jobs subsystem is unavailable in strict PostgreSQL mode");
}

// Mood adjectives that the agent uses as bare stage directions on their own lines.
// e.g., "soft, warm\nSleep well." or "sincere, heartfelt\nThank you."
// Used by both prepareTextForTTS (converts to v3 tags) and cleanContent (strips from display).
const BARE_MOOD_RE =
  /^(soft|warm|gentle|tender|fond|quiet|calm|steady|firm|bright|cheerful|somber|serious|intense|light|wistful|nostalgic|bittersweet|proud|humble|grateful|relieved|weary|tired|sleepy|energetic|eager|hopeful|melancholy|resigned|determined|confident|uncertain|shy|bold|fierce|raw|vulnerable|open|intimate|sincere|heartfelt|caring|genuine|settled|playful|amused|dry|flat|crisp|measured|sad|happy|nervous|excited|dramatic|sarcastic|affectionate|concerned|worried|curious|surprised|delighted|wry|rueful|mischievous|solemn|reverent|hushed|breathless|broken|strained|choked|distant|close|sweet|kind|patient|impatient|urgent|reluctant|defiant|pensive|reflective|contemplative)$/;

const AEVP_RENDERER_STORAGE_KEY = "aevp-renderer";
const AEVP_RENDERER_MIGRATION_KEY = "aevp-renderer-migration-2026-02-27-force-aevp";
const AEVP_FULL_ORB_CENTER_Y = 0.55; // push orb down toward center (was 0.72)

type StructuredMarkerMatch = {
  full: string;
  content: string;
  start: number;
  end: number;
};
const INTERNAL_SYSTEM_MARKER_RE = /\[[A-Z][A-Z0-9_]{1,32}:[^\]]{0,500}\]/g;

declare global {
  interface Window {
    __argentCurrentSessionKey?: string;
    __argentCurrentAssistantMessage?: {
      sessionKey: string;
      id: string;
      content: string;
      ttsSummary?: string | null;
      timestampMs: number | null;
    };
    __argentNativeSendMessage?: (content: string) => {
      ok: boolean;
      sessionKey?: string;
      error?: string;
    };
  }
}

function parseStructuredMarkers(text: string, marker: "TTS" | "TTS_NOW"): StructuredMarkerMatch[] {
  const token = `[${marker}:`;
  const matches: StructuredMarkerMatch[] = [];
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const start = text.indexOf(token, searchIndex);
    if (start === -1) break;

    let depth = 1;
    let cursor = start + token.length;

    while (cursor < text.length) {
      const ch = text[cursor];
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) break;
      }
      cursor++;
    }

    if (depth !== 0) {
      break;
    }

    const end = cursor + 1; // end-exclusive
    matches.push({
      full: text.slice(start, end),
      content: text.slice(start + token.length, cursor).trim(),
      start,
      end,
    });
    searchIndex = end;
  }

  return matches;
}

function stripStructuredMarkers(text: string): string {
  const ranges = [
    ...parseStructuredMarkers(text, "TTS"),
    ...parseStructuredMarkers(text, "TTS_NOW"),
  ].sort((a, b) => a.start - b.start);
  if (ranges.length === 0) return text;

  let out = "";
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    out += text.slice(cursor, range.start);
    cursor = range.end;
  }
  out += text.slice(cursor);
  return out;
}

function stripTtsControlMarkers(text: string): string {
  if (!text) return "";
  const withoutStructuredMarkers = stripStructuredMarkers(text).replace(
    /\[(?:TTS|TTS_NOW):[^\]]*\]/g,
    "",
  );
  return stripInlineTtsDirectives(withoutStructuredMarkers).trim();
}

function prepareTextForTTS(text: string, maxWords = 300): string {
  if (!text) return "";

  let cleaned = text
    // Convert bare mood direction lines to v3 audio tags BEFORE any other processing.
    // Catches "soft, warm" or "pause, genuine affection" on their own line.
    .replace(/^([a-zA-Z][a-zA-Z, ]{2,50})$/gm, (line) => {
      const parts = line.toLowerCase().trim().split(/,\s*/);
      if (
        parts.length >= 1 &&
        parts.length <= 4 &&
        parts.every((p) => BARE_MOOD_RE.test(p.trim()))
      ) {
        return `[${line.trim()}]`;
      }
      return line;
    })
    // Remove code blocks (``` ... ```)
    .replace(/```[\s\S]*?```/g, " ")
    // Remove inline code (`...`)
    .replace(/`[^`]+`/g, "")
    // Remove URLs
    .replace(/https?:\/\/[^\s]+/g, "")
    // Remove email addresses (sound terrible in TTS)
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, "")
    // Remove emoji (Unicode emoji ranges — ElevenLabs v3 produces artifacts on these)
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu,
      "",
    )
    // Remove parenthetical content — sounds unnatural in speech
    // e.g. "(tools, handlers)" or "(morning briefing, triage, etc.)"
    .replace(/\s*\([^)]{0,200}\)/g, "")
    // Remove markdown table rows (lines with | separators)
    .replace(/^\|.*\|$/gm, "")
    // Remove markdown table separator lines (|---|---|)
    .replace(/^\s*\|?[\s\-:|]+\|?\s*$/gm, "")
    // Remove file paths
    .replace(/[\/\\][\w\-\.\/\\]+\.\w+/g, "")
    // Remove markdown headers
    .replace(/^#{1,6}\s+/gm, "")
    // Convert stage directions in italics to ElevenLabs v3 audio tags where supported.
    // e.g., *laughs* → [laughs], *sighs heavily* → [sighs heavily]
    // Non-vocalizable directions (nods, stares, etc.) are stripped silently.
    .replace(/\*([^*]{1,40})\*/g, (_, inner) => {
      const lower = inner.toLowerCase().trim();
      // Vocalizable expressions → convert to v3 audio tags (ElevenLabs renders these)
      if (
        /^(laughs?|laughing|chuckles?|chuckling|giggles?|giggling|sighs?|sighing|gasps?|gasping|gulps?|coughs?|coughing|sniffs?|clears throat|inhales?|exhales?|hums?|humming|groans?|groaning|whimpers?|snickers?|scoffs?|tuts?|whistles?|yawns?|sobbing|crying|sneezes?|hiccups?)/.test(
          lower,
        )
      ) {
        return `[${inner.trim()}]`;
      }
      // Delivery/mood directions → convert to v3 audio tags
      if (
        /^(whispers?|whispering|softly|gently|excitedly|nervously|sarcastically|dramatically|quietly|loudly|hesitantly|warmly|playfully|teasing|deadpan|mocking|amused|tenderly|fondly|wistfully|firmly|brightly|cheerfully|sadly|happily|eagerly|hopefully|wearily|sleepily|confidently|shyly|fiercely|proudly|humbly|gratefully|sincerely|genuinely|lovingly|knowingly|conspiratorially|matter-of-factly|thoughtfully|carefully|reassuringly|soothingly|urgently)/.test(
          lower,
        )
      ) {
        return `[${inner.trim()}]`;
      }
      // Adjective-form mood cues — "soft, warm", "sincere, heartfelt", etc.
      // If ALL comma-separated words are mood adjectives, treat as a v3 audio tag.
      const MOOD_ADJECTIVES =
        /^(soft|warm|gentle|tender|fond|quiet|calm|steady|firm|bright|cheerful|somber|serious|intense|light|wistful|nostalgic|bittersweet|proud|humble|grateful|relieved|weary|tired|sleepy|energetic|eager|hopeful|melancholy|resigned|determined|confident|uncertain|shy|bold|fierce|raw|vulnerable|open|intimate|sincere|heartfelt|caring|genuine|settled|playful|amused|dry|flat|crisp|measured|sad|happy|nervous|excited|dramatic|sarcastic|affectionate|concerned|worried|curious|surprised|delighted|wry|rueful|mischievous|solemn|reverent|hushed|breathless|broken|strained|choked|distant|close|sweet|kind|patient|impatient|urgent|reluctant|defiant|resigned|pensive|reflective|contemplative)$/;
      const commaParts = lower.split(/,\s*/);
      if (
        commaParts.length >= 1 &&
        commaParts.length <= 4 &&
        commaParts.every((p: string) => MOOD_ADJECTIVES.test(p.trim()))
      ) {
        return `[${inner.trim()}]`;
      }
      // Pause/timing directions → convert to v3 tags
      if (/^(pauses?|long pause|beat|brief pause|silence|moment)/.test(lower)) {
        return `[${inner.trim()}]`;
      }
      // Non-vocalizable stage directions — strip silently (visual actions)
      if (
        /^(stops?|thinks?|waits?|nods?|smiles?|frowns?|shrugs?|sits|stands|looks|stares|blinks|considers?|actually stops|sits with that|leans|tilts|raises|crosses|waves|points|turns)/.test(
          lower,
        )
      ) {
        return "";
      }
      return inner; // Keep non-stage-direction italic content as text
    })
    // Remove remaining markdown bold/italic markers
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    // Remove markdown links [text](url)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove bullet points
    .replace(/^[\s]*[-*•]\s+/gm, "")
    // Remove numbered lists
    .replace(/^\s*\d+\.\s+/gm, "")
    // Remove special characters that sound bad (but keep [] around audio tags for ElevenLabs v3)
    .replace(/[{}<>|\\@#$%^&*+=~]/g, " ")
    // Remove standalone brackets that aren't part of audio tags
    // v3 supports 1800+ free-form tags — preserve any [bracketed phrase] starting with a letter
    .replace(/\[(?![a-zA-Z][a-zA-Z0-9 '',.\-]{0,60}\])/g, " ")
    .replace(/(?<!\[[a-zA-Z][a-zA-Z0-9 '',.\-]{0,60})\]/g, " ")
    // Remove multiple spaces/newlines
    .replace(/\s+/g, " ")
    .trim();

  // Split into sentences — capture trailing content without punctuation too
  const sentenceMatches: string[] = cleaned.match(/[^.!?]+[.!?]+/g) || [];
  // Capture any trailing text after the last sentence-ending punctuation
  const lastPuncIdx = Math.max(
    cleaned.lastIndexOf("."),
    cleaned.lastIndexOf("!"),
    cleaned.lastIndexOf("?"),
  );
  if (lastPuncIdx >= 0 && lastPuncIdx < cleaned.length - 1) {
    const trailing = cleaned.slice(lastPuncIdx + 1).trim();
    if (trailing.length >= 5) sentenceMatches.push(trailing);
  } else if (sentenceMatches.length === 0) {
    sentenceMatches.push(cleaned);
  }

  const conversational: string[] = [];
  for (const sentence of sentenceMatches) {
    const s = sentence.trim();
    if (s.length < 5) continue;
    // Skip sentences that are mostly numbers (e.g. raw data)
    if ((s.match(/\d/g) || []).length > s.length * 0.5) continue;
    // Skip sentences that look like technical output (paths, camelCase, snake_case heavy)
    const techTokens = (
      s.match(/[a-z][A-Z]|_[a-z]|[/\\][\w.-]+\.\w|::\w|=>|\{\s*\}|^\s*[-*]\s/g) || []
    ).length;
    if (techTokens > 3) continue;
    conversational.push(s);
  }

  // If too many sentences after filtering, prefer opening + closing over technical middle
  if (conversational.length > 8) {
    const opening = conversational.slice(0, 3);
    const closing = conversational.slice(-2);
    conversational.length = 0;
    conversational.push(...opening, ...closing);
  }

  // Join and limit to max words — find a natural sentence boundary near the limit
  const result = conversational.join(" ");
  const words = result.split(/\s+/).filter(Boolean);

  if (words.length > maxWords) {
    // Try to cut at a sentence boundary within the last 20% of the limit
    const cutText = words.slice(0, maxWords).join(" ");
    const lastSentenceEnd = Math.max(
      cutText.lastIndexOf(". "),
      cutText.lastIndexOf("! "),
      cutText.lastIndexOf("? "),
    );
    // Only use sentence boundary if it's in the last 40% of text (don't cut too early)
    if (lastSentenceEnd > cutText.length * 0.6) {
      return cutText.slice(0, lastSentenceEnd + 1);
    }
    return cutText + ".";
  }

  return result || cleaned.substring(0, 2000);
}

function scoreSpokenSummary(text: string): number {
  return text
    .replace(INTERNAL_SYSTEM_MARKER_RE, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

function pickSpokenSummary(params: {
  markers: StructuredMarkerMatch[];
  explicitText?: string | null;
  ttsReadyText: string;
}): {
  text: string | null;
  source: "explicit" | "marker" | "auto" | "none";
} {
  const explicitPrepared = prepareTTSContent(params.explicitText ?? "");
  const explicitScore = scoreSpokenSummary(explicitPrepared);
  if (explicitScore > 0) {
    return { text: explicitPrepared, source: "explicit" };
  }

  const markerCandidates = params.markers.map((m) => m.content.trim()).filter(Boolean);
  const bestMarker = markerCandidates.reduce<string | null>((best, current) => {
    if (!best) return current;
    return scoreSpokenSummary(current) > scoreSpokenSummary(best) ? current : best;
  }, null);

  const markerScore = bestMarker ? scoreSpokenSummary(bestMarker) : 0;
  const autoPrepared = prepareTTSContent(params.ttsReadyText);
  const autoScore = scoreSpokenSummary(autoPrepared);

  // Prefer auto-prepared summary when marker is missing/too short compared to full response.
  if (autoScore > 0 && (markerScore === 0 || markerScore < 40 || autoScore >= markerScore + 20)) {
    return { text: autoPrepared, source: "auto" };
  }
  if (bestMarker) return { text: bestMarker, source: "marker" };
  if (autoScore > 0) return { text: autoPrepared, source: "auto" };
  return { text: null, source: "none" };
}

const initialLogs: LogEntry[] = [
  { id: "1", type: "info", message: "Dashboard started", timestamp: new Date() },
];

// Gateway configuration - get token from your argentos config
// Use dynamic URL based on current hostname (allows access from any machine on network)
const GATEWAY_URL = `ws://${window.location.hostname}:18789`;
const CONTROL_SETTINGS_KEY = "argent.control.settings.v1";
const TTS_DISPLAY_MODE_KEY = "argent.tts-display-mode";
const DASHBOARD_MODE_STORAGE_KEY = "argent.dashboard.mode";
const OPERATIONS_PRESENCE_POSITION_STORAGE_KEY = "argent.operations.presence.position";
const OPERATIONS_PRESENCE_SIZE_STORAGE_KEY = "argent.operations.presence.size";
const OPERATIONS_PRESENCE_DEFAULT_WIDTH = 520;
const OPERATIONS_PRESENCE_DEFAULT_HEIGHT = 500;
const OPERATIONS_PRESENCE_MIN_WIDTH = 360;
const OPERATIONS_PRESENCE_MIN_HEIGHT = 360;
const OPERATIONS_PRESENCE_MAX_WIDTH = 820;
const OPERATIONS_PRESENCE_MAX_HEIGHT = 820;
const OPERATIONS_PRESENCE_PADDING = 16;
const OPERATIONS_PRESENCE_STAGE_SCALE = 1.3;
const OPERATIONS_PRESENCE_LOCKED_OFFSET_X = -89;
const OPERATIONS_PRESENCE_LOCKED_OFFSET_Y = 10;
const OPERATIONS_PRESENCE_LOCKED_SCALE = 1.33;

type WorkspaceTab = {
  id: string;
  name: string;
  icon: string;
};

const DEFAULT_WORKSPACE_TABS: WorkspaceTab[] = [{ id: "home", name: "Home", icon: "🏠" }];

function sanitizeWorkspaceTabs(
  tabs: WorkspaceTab[],
  allowWorkforceSurface: boolean,
): WorkspaceTab[] {
  const filtered = allowWorkforceSurface ? tabs : tabs.filter((tab) => tab.id !== "operations");
  return filtered.length > 0 ? filtered : DEFAULT_WORKSPACE_TABS;
}

function resolveWorkspaceFallback(
  currentWorkspace: string,
  tabs: WorkspaceTab[],
  allowWorkforceSurface: boolean,
): string {
  if (!allowWorkforceSurface && currentWorkspace === "operations") {
    return "home";
  }
  return tabs.some((tab) => tab.id === currentWorkspace)
    ? currentWorkspace
    : (tabs[0]?.id ?? "home");
}

function readStoredGatewayToken(): string {
  try {
    const raw = localStorage.getItem(CONTROL_SETTINGS_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === "string" ? parsed.token.trim() : "";
  } catch {
    return "";
  }
}

function persistGatewayToken(token: string) {
  if (!token) return;
  try {
    const raw = localStorage.getItem(CONTROL_SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    parsed.token = token;
    localStorage.setItem(CONTROL_SETTINGS_KEY, JSON.stringify(parsed));
  } catch {
    // Best effort only — never block app startup on localStorage issues.
  }
}

function resolveGatewayToken(): string {
  const tokenFromUrl = new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
  if (tokenFromUrl) {
    persistGatewayToken(tokenFromUrl);
    return tokenFromUrl;
  }
  const tokenFromStorage = readStoredGatewayToken();
  if (tokenFromStorage) return tokenFromStorage;
  const tokenFromEnv = String(import.meta.env.VITE_GATEWAY_TOKEN ?? "").trim();
  return tokenFromEnv;
}

function readStoredTtsDisplayMode(): TtsDisplayMode {
  try {
    const raw = localStorage.getItem(TTS_DISPLAY_MODE_KEY);
    if (raw === "voice-first" || raw === "voice-only" || raw === "text-voice") {
      return raw;
    }
  } catch {
    // Ignore storage errors.
  }
  return "text-voice";
}

function readStoredDashboardMode(): DashboardMode | null {
  try {
    const raw = localStorage.getItem(DASHBOARD_MODE_STORAGE_KEY);
    if (raw === "personal" || raw === "operations") {
      return raw;
    }
  } catch {
    // Ignore storage errors.
  }
  return null;
}

function persistDashboardMode(mode: DashboardMode) {
  try {
    localStorage.setItem(DASHBOARD_MODE_STORAGE_KEY, mode);
  } catch {
    // Best effort only.
  }
}

function readStoredOperationsPresencePosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(OPERATIONS_PRESENCE_POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    const x = typeof parsed.x === "number" ? parsed.x : NaN;
    const y = typeof parsed.y === "number" ? parsed.y : NaN;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y };
    }
  } catch {
    // Ignore storage errors.
  }
  return null;
}

function readStoredOperationsPresenceSize(): { width: number; height: number } | null {
  try {
    const raw = localStorage.getItem(OPERATIONS_PRESENCE_SIZE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };
    const width = typeof parsed.width === "number" ? parsed.width : NaN;
    const height = typeof parsed.height === "number" ? parsed.height : NaN;
    if (Number.isFinite(width) && Number.isFinite(height)) {
      return { width, height };
    }
  } catch {
    // Ignore storage errors.
  }
  return null;
}

const GATEWAY_TOKEN = resolveGatewayToken();

type AvatarState = "idle" | "thinking" | "working" | "success" | "error";

// Chat history persistence (per-session)
const STORAGE_PREFIX = "argent-chat-";
const MAX_STORED_MESSAGES = 50;

function storageKey(sessionKey: string) {
  return `${STORAGE_PREFIX}${sessionKey}`;
}

function loadStoredMessages(sessionKey = DEFAULT_MAIN_SESSION_KEY): ChatMessage[] {
  try {
    let stored = localStorage.getItem(storageKey(sessionKey));
    // Migrate from legacy keys for default session
    if (!stored && sessionKey === DEFAULT_MAIN_SESSION_KEY) {
      // Try old "webchat" key first, then legacy key
      stored =
        localStorage.getItem(storageKey("webchat")) || localStorage.getItem("argent-chat-history");
      if (stored) {
        localStorage.setItem(storageKey(sessionKey), stored);
        localStorage.removeItem(storageKey("webchat"));
        localStorage.removeItem("argent-chat-history");
      }
    }
    if (stored) {
      const parsed = JSON.parse(stored);
      // Restore Date objects
      return parsed.map((msg: ChatMessage & { timestamp: string }) => ({
        ...msg,
        content: typeof msg.content === "string" ? stripTtsControlMarkers(msg.content) : "",
        ttsSummary:
          typeof msg.ttsSummary === "string"
            ? stripTtsControlMarkers(msg.ttsSummary)
            : msg.ttsSummary,
        timestamp: new Date(msg.timestamp),
      }));
    }
  } catch (e) {
    console.error("Failed to load chat history:", e);
  }
  return [];
}

function saveMessages(messages: ChatMessage[], sessionKey = DEFAULT_MAIN_SESSION_KEY) {
  let toStore = messages.slice(-MAX_STORED_MESSAGES);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      localStorage.setItem(storageKey(sessionKey), JSON.stringify(toStore));
      return; // success
    } catch {
      // QuotaExceededError — trim more aggressively
      toStore = toStore.slice(-Math.max(5, Math.floor(toStore.length / 2)));
    }
  }
  // Last resort: clear this key entirely so we don't spam errors
  try {
    localStorage.removeItem(storageKey(sessionKey));
  } catch {
    /* ignore */
  }
}

/** Memory stats — fetches from /api/memory/stats */
/** Module-level cache so data survives tab switches (component unmount/remount) */
let memoryStatsCache: {
  memoryItems: number;
  entities: number;
  categories: number;
  reflections: number;
  resources: number;
} | null = null;
let memoryStatsInterval: ReturnType<typeof setInterval> | null = null;

function startMemoryStatsPolling() {
  if (memoryStatsInterval) return; // already polling
  const load = async () => {
    try {
      const res = await fetch("/api/memory/stats");
      if (res.ok) {
        const data = await res.json();
        memoryStatsCache = {
          memoryItems: data.items ?? data.total ?? data.count ?? data.memoryItems ?? 0,
          entities: data.entityCount ?? data.entities ?? 0,
          categories: data.categoryCount ?? data.categories ?? 0,
          reflections: data.reflectionCount ?? data.reflections ?? 0,
          resources: data.resourceCount ?? data.resources ?? 0,
        };
      }
    } catch {}
  };
  load();
  memoryStatsInterval = setInterval(load, 30000);
}

/** Memory stats — 5 cards matching the V3 reference layout */
function MemoryStatsCards() {
  const [stats, setStats] = useState(memoryStatsCache);

  useEffect(() => {
    startMemoryStatsPolling();
    // Poll the cache to pick up updates
    const sync = setInterval(() => {
      if (memoryStatsCache && memoryStatsCache !== stats) {
        setStats(memoryStatsCache);
      }
    }, 1000);
    // Immediately sync if cache already has data
    if (memoryStatsCache) setStats(memoryStatsCache);
    return () => clearInterval(sync);
  }, []);

  const cards: Array<{ label: string; value: number | undefined; color: string }> = [
    { label: "Memory Items", value: stats?.memoryItems, color: "text-emerald-400" },
    { label: "Entities", value: stats?.entities, color: "text-purple-400" },
    { label: "Categories", value: stats?.categories, color: "text-cyan-400" },
    { label: "Reflections", value: stats?.reflections, color: "text-amber-400" },
    { label: "Resources", value: stats?.resources, color: "text-[hsl(var(--primary))]" },
  ];

  return (
    <div className="flex-shrink-0">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))] mb-2">
        Memory
      </div>
      <div className="space-y-1.5">
        {/* Row 1: Memory Items + Entities */}
        <div className="flex gap-1.5">
          {cards.slice(0, 2).map((c) => (
            <div
              key={c.label}
              className="flex-1 px-3 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))]"
            >
              <div className={`text-lg font-bold font-mono ${c.color}`}>
                {c.value?.toLocaleString() ?? "—"}
              </div>
              <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{c.label}</div>
            </div>
          ))}
        </div>
        {/* Row 2: Categories + Reflections */}
        <div className="flex gap-1.5">
          {cards.slice(2, 4).map((c) => (
            <div
              key={c.label}
              className="flex-1 px-3 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))]"
            >
              <div className={`text-lg font-bold font-mono ${c.color}`}>
                {c.value?.toLocaleString() ?? "—"}
              </div>
              <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{c.label}</div>
            </div>
          ))}
        </div>
        {/* Row 3: Resources */}
        <div className="flex gap-1.5">
          {cards.slice(4).map((c) => (
            <div
              key={c.label}
              className="flex-1 px-3 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))]"
            >
              <div className={`text-lg font-bold font-mono ${c.color}`}>
                {c.value?.toLocaleString() ?? "—"}
              </div>
              <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{c.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [avatarMood, setAvatarMood] = useState<MoodName | undefined>(undefined);
  const [surfaceProfile, setSurfaceProfile] = useState<DashboardSurfaceProfile>("public-core");
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>("personal");

  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>(() => {
    try {
      const stored = localStorage.getItem("argent-workspaces");
      if (stored) {
        const parsed = JSON.parse(stored) as WorkspaceTab[];
        return sanitizeWorkspaceTabs(parsed, false);
      }
    } catch {}
    return DEFAULT_WORKSPACE_TABS;
  });
  const [activeWorkspace, setActiveWorkspace] = useState("home");

  // Resizable column widths (percentages, must sum to ~100)
  const [colWidths, setColWidths] = useState<[number, number, number]>(() => {
    try {
      const stored = localStorage.getItem("argent-col-widths");
      if (stored) return JSON.parse(stored);
    } catch {}
    return [38, 32, 30]; // tasks%, avatar%, chat%
  });
  const [draggingCol, setDraggingCol] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem("argent-col-widths", JSON.stringify(colWidths));
  }, [colWidths]);

  // Column resize handler
  const handleColDrag = useCallback(
    (colIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const startX = e.clientX;
      const startWidths = [...colWidths] as [number, number, number];

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const pctDelta = (dx / rect.width) * 100;
        const next = [...startWidths] as [number, number, number];

        if (colIndex === 0) {
          // Dragging between tasks and avatar
          next[0] = Math.max(15, Math.min(45, startWidths[0] + pctDelta));
          next[1] = startWidths[1] - (next[0] - startWidths[0]);
        } else {
          // Dragging between avatar and chat
          next[1] = Math.max(20, Math.min(60, startWidths[1] + pctDelta));
          next[2] = startWidths[2] - (next[1] - startWidths[1]);
        }
        // Clamp minimums
        if (next[1] < 20) return;
        if (next[2] < 15) return;
        setColWidths(next);
      };

      const onUp = () => {
        setDraggingCol(null);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      setDraggingCol(colIndex);
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [colWidths],
  );

  // Persist workspace tabs
  useEffect(() => {
    localStorage.setItem("argent-workspaces", JSON.stringify(workspaceTabs));
  }, [workspaceTabs]);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [configPanelRequestedTab, setConfigPanelRequestedTab] = useState<"systems" | null>(null);
  const [workerFlowOpen, setWorkerFlowOpen] = useState(false);
  const backgroundPollingEnabled = !configPanelOpen;
  const [runtimeLoadProfile, setRuntimeLoadProfile] = useState<{
    active: "desktop" | "balanced-laptop" | "cool-laptop";
    label: string;
    description: string;
    pollingMultiplier: number;
    allowManualOverrides: boolean;
  }>({
    active: "desktop",
    label: "Desktop",
    description: "Full runtime behavior for desktops and larger always-on machines.",
    pollingMultiplier: 1,
    allowManualOverrides: true,
  });
  const pollingMultiplier = Math.max(1, runtimeLoadProfile.pollingMultiplier || 1);
  const allowWorkforceSurface = isWorkforceSurfaceAllowed(surfaceProfile);
  const isOperationsDashboard = allowWorkforceSurface && dashboardMode === "operations";

  // Ensure Operations tab exists when workforce is allowed
  useEffect(() => {
    if (allowWorkforceSurface && !workspaceTabs.some((t) => t.id === "operations")) {
      setWorkspaceTabs((prev) => [...prev, { id: "operations", name: "Operations", icon: "⚙️" }]);
    }
  }, [allowWorkforceSurface, workspaceTabs]);

  useEffect(() => {
    const sanitizedTabs = sanitizeWorkspaceTabs(workspaceTabs, allowWorkforceSurface);
    const nextWorkspace = resolveWorkspaceFallback(
      activeWorkspace,
      sanitizedTabs,
      allowWorkforceSurface,
    );

    const tabsChanged =
      sanitizedTabs.length !== workspaceTabs.length ||
      sanitizedTabs.some((tab, index) => {
        const current = workspaceTabs[index];
        return current?.id !== tab.id || current?.name !== tab.name || current?.icon !== tab.icon;
      });

    if (tabsChanged) {
      setWorkspaceTabs(sanitizedTabs);
    }

    if (nextWorkspace !== activeWorkspace) {
      setActiveWorkspace(nextWorkspace);
    }

    if (!allowWorkforceSurface && dashboardMode === "operations") {
      setDashboardMode("personal");
    }
  }, [activeWorkspace, allowWorkforceSurface, dashboardMode, workspaceTabs]);

  // Task management via backend API
  const {
    tasks,
    projects,
    addTask,
    addProjectTask,
    updateTask,
    deleteTask,
    deleteProject,
    startTask,
    completeTask,
    startTaskByTitle,
    completeTaskByTitle,
    refreshTasks,
  } = useTasks({ enabled: backgroundPollingEnabled, pollMs: 15000 * pollingMultiplier });
  const { tasks: workerTasks } = useTasks({
    enabled: backgroundPollingEnabled && isOperationsDashboard,
    pollMs: 15000 * pollingMultiplier,
    includeWorkerTasks: true,
    workerOnly: true,
  });

  // Board view state
  const [showBoard, setShowBoard] = useState(false);
  const [showWorkforce, setShowWorkforce] = useState(false);
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);
  const [opsView, setOpsView] = useState<
    "map" | "workers" | "jobs" | "tasks" | "org" | "schedule" | "workflows"
  >("map");
  const [operationsChatOpen, setOperationsChatOpen] = useState(false);
  const [operationsPresenceVisible, setOperationsPresenceVisible] = useState(false);
  const [operationsPresencePosition, setOperationsPresencePosition] = useState(() => {
    const stored = readStoredOperationsPresencePosition();
    if (stored) return stored;
    return {
      x: Math.max(24, window.innerWidth - 584),
      y: 112,
    };
  });
  const [operationsPresenceSize, setOperationsPresenceSize] = useState(() => {
    const stored = readStoredOperationsPresenceSize();
    if (stored) return stored;
    return {
      width: OPERATIONS_PRESENCE_DEFAULT_WIDTH,
      height: OPERATIONS_PRESENCE_DEFAULT_HEIGHT,
    };
  });
  const [showProjectKickoffModal, setShowProjectKickoffModal] = useState(false);
  const [workforceFocus, setWorkforceFocus] = useState<"all" | "due-now" | "blocked">("all");
  const [workforceBadge, setWorkforceBadge] = useState<{ dueNow: number; blocked: number }>({
    dueNow: 0,
    blocked: 0,
  });
  const operationsPresenceDragRef = useRef<{
    pointerOffsetX: number;
    pointerOffsetY: number;
  } | null>(null);
  const operationsPresenceResizeRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadSurfaceProfile = async () => {
      try {
        const response = await fetchLocalApi("/api/settings/agent/raw-config", {}, 0);
        const payload = (await response.json()) as { raw?: string };
        if (!cancelled) {
          const nextSurfaceProfile = parseDashboardSurfaceProfile(payload?.raw);
          const configDashboardMode = parseDashboardMode(payload?.raw, nextSurfaceProfile);
          const storedDashboardMode = readStoredDashboardMode();
          const nextDashboardMode =
            storedDashboardMode && isDashboardModeAllowed(storedDashboardMode, nextSurfaceProfile)
              ? storedDashboardMode
              : configDashboardMode;
          setSurfaceProfile(nextSurfaceProfile);
          setDashboardMode(nextDashboardMode);
        }
      } catch {
        if (!cancelled) {
          setSurfaceProfile("public-core");
          const storedDashboardMode = readStoredDashboardMode();
          setDashboardMode(
            storedDashboardMode === "operations" &&
              isDashboardModeAllowed("operations", "public-core")
              ? "operations"
              : "personal",
          );
        }
      }
    };
    void loadSurfaceProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isDashboardModeAllowed(dashboardMode, surfaceProfile)) {
      setDashboardMode("personal");
      persistDashboardMode("personal");
      return;
    }
    persistDashboardMode(dashboardMode);
  }, [dashboardMode, surfaceProfile]);

  // Reset operations panels when switching away from operations mode.
  // IMPORTANT: showBoard and showWorkforce are NOT in the dependency array —
  // they should only reset on mode transition, not on every state change.
  // Having them as deps caused a flash bug where Project Board would
  // immediately close in personal mode.
  useEffect(() => {
    if (isOperationsDashboard) {
      setShowWorkforce(true);
      return;
    }
    setOperationsChatOpen(false);
    setOperationsPresenceVisible(false);
    setShowWorkforce(false);
    // Note: do NOT close showBoard here — personal mode uses it too
  }, [isOperationsDashboard]);

  useEffect(() => {
    if (!operationsChatOpen && operationsPresenceVisible) {
      setOperationsPresenceVisible(false);
    }
  }, [operationsChatOpen, operationsPresenceVisible]);

  useEffect(() => {
    try {
      localStorage.setItem(
        OPERATIONS_PRESENCE_POSITION_STORAGE_KEY,
        JSON.stringify(operationsPresencePosition),
      );
    } catch {
      // Best effort only.
    }
  }, [operationsPresencePosition]);

  useEffect(() => {
    try {
      localStorage.setItem(
        OPERATIONS_PRESENCE_SIZE_STORAGE_KEY,
        JSON.stringify(operationsPresenceSize),
      );
    } catch {
      // Best effort only.
    }
  }, [operationsPresenceSize]);

  useEffect(() => {
    if (!operationsPresenceVisible) {
      operationsPresenceDragRef.current = null;
      operationsPresenceResizeRef.current = null;
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const drag = operationsPresenceDragRef.current;
      if (drag) {
        const maxX = Math.max(
          OPERATIONS_PRESENCE_PADDING,
          window.innerWidth - operationsPresenceSize.width - OPERATIONS_PRESENCE_PADDING,
        );
        const maxY = Math.max(
          OPERATIONS_PRESENCE_PADDING,
          window.innerHeight - operationsPresenceSize.height - OPERATIONS_PRESENCE_PADDING,
        );
        const nextX = Math.min(
          Math.max(OPERATIONS_PRESENCE_PADDING, event.clientX - drag.pointerOffsetX),
          maxX,
        );
        const nextY = Math.min(
          Math.max(OPERATIONS_PRESENCE_PADDING, event.clientY - drag.pointerOffsetY),
          maxY,
        );
        setOperationsPresencePosition({ x: nextX, y: nextY });
        return;
      }

      const resize = operationsPresenceResizeRef.current;
      if (!resize) return;

      const maxWidth = Math.min(
        OPERATIONS_PRESENCE_MAX_WIDTH,
        window.innerWidth - operationsPresencePosition.x - OPERATIONS_PRESENCE_PADDING,
      );
      const maxHeight = Math.min(
        OPERATIONS_PRESENCE_MAX_HEIGHT,
        window.innerHeight - operationsPresencePosition.y - OPERATIONS_PRESENCE_PADDING,
      );
      const nextWidth = Math.min(
        Math.max(
          OPERATIONS_PRESENCE_MIN_WIDTH,
          resize.startWidth + (event.clientX - resize.startX),
        ),
        Math.max(OPERATIONS_PRESENCE_MIN_WIDTH, maxWidth),
      );
      const nextHeight = Math.min(
        Math.max(
          OPERATIONS_PRESENCE_MIN_HEIGHT,
          resize.startHeight + (event.clientY - resize.startY),
        ),
        Math.max(OPERATIONS_PRESENCE_MIN_HEIGHT, maxHeight),
      );
      setOperationsPresenceSize({ width: nextWidth, height: nextHeight });
    };

    const handleMouseUp = () => {
      operationsPresenceDragRef.current = null;
      operationsPresenceResizeRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    operationsPresencePosition.x,
    operationsPresencePosition.y,
    operationsPresenceSize,
    operationsPresenceVisible,
  ]);

  useEffect(() => {
    const clampPresencePosition = () => {
      const clampedWidth = Math.min(
        Math.max(OPERATIONS_PRESENCE_MIN_WIDTH, operationsPresenceSize.width),
        Math.min(
          OPERATIONS_PRESENCE_MAX_WIDTH,
          window.innerWidth - OPERATIONS_PRESENCE_PADDING * 2,
        ),
      );
      const clampedHeight = Math.min(
        Math.max(OPERATIONS_PRESENCE_MIN_HEIGHT, operationsPresenceSize.height),
        Math.min(
          OPERATIONS_PRESENCE_MAX_HEIGHT,
          window.innerHeight - OPERATIONS_PRESENCE_PADDING * 2,
        ),
      );
      const maxX = Math.max(
        OPERATIONS_PRESENCE_PADDING,
        window.innerWidth - clampedWidth - OPERATIONS_PRESENCE_PADDING,
      );
      const maxY = Math.max(
        OPERATIONS_PRESENCE_PADDING,
        window.innerHeight - clampedHeight - OPERATIONS_PRESENCE_PADDING,
      );
      setOperationsPresenceSize((prev) =>
        prev.width === clampedWidth && prev.height === clampedHeight
          ? prev
          : { width: clampedWidth, height: clampedHeight },
      );
      setOperationsPresencePosition((prev) => ({
        x: Math.min(Math.max(OPERATIONS_PRESENCE_PADDING, prev.x), maxX),
        y: Math.min(Math.max(OPERATIONS_PRESENCE_PADDING, prev.y), maxY),
      }));
    };

    clampPresencePosition();
    window.addEventListener("resize", clampPresencePosition);
    return () => window.removeEventListener("resize", clampPresencePosition);
  }, [operationsPresenceSize.height, operationsPresenceSize.width]);

  useEffect(() => {
    if (allowWorkforceSurface) {
      return;
    }
    setShowWorkforce(false);
    setWorkerFlowOpen(false);
  }, [allowWorkforceSurface]);

  // Wrapper to match old signature for updateTaskStatus
  const updateTaskStatus = useCallback(
    (taskId: string, status: Task["status"]) => {
      if (status === "completed") {
        completeTask(taskId);
      } else if (status === "in-progress") {
        startTask(taskId);
      } else {
        updateTask(taskId, { status });
      }
    },
    [completeTask, startTask, updateTask],
  );

  // Edit task wrapper
  const editTask = useCallback(
    async (task: Task) => {
      const updates: Partial<Task> = {
        title: task.title,
        details: task.details,
      };
      if (task.status) updates.status = task.status;
      if (task.type) updates.type = task.type;
      if (task.schedule !== undefined) updates.schedule = task.schedule;
      const updated = await updateTask(task.id, updates);
      return !!updated;
    },
    [updateTask],
  );

  // Full task update wrapper for ProjectBoard (passes all editable fields)
  const editTaskFull = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (task: any) => {
      const updates: Record<string, unknown> = {
        title: task.title,
        details: task.details,
        status: task.status,
      };
      if ("assignee" in task) updates.assignee = task.assignee;
      if ("priority" in task) updates.priority = task.priority;
      updateTask(task.id, updates);
    },
    [updateTask],
  );

  const executeTask = useCallback(
    async (task: Task) => {
      // Mark task as in-progress and send to agent for execution
      const started = await startTask(task.id);
      if (!started) {
        return false;
      }
      // Send execute command through chat including task details
      // Format: "Execute task: <title>\n\nDetails: <details>"
      let message = `Execute this task now: ${task.title}`;
      if (task.details) {
        message += `\n\nTask details:\n${task.details}`;
      }
      sendMessageRef.current(message);
      return true;
    },
    [startTask],
  );

  // Widget system
  const { updateWidget, getWidget, resetToDefaults: resetWidgets, customWidgets } = useWidgets();

  // App Forge system
  const {
    apps: forgeApps,
    upsertApp: upsertForgeApp,
    createApp: createForgeApp,
    deleteApp: deleteForgeApp,
    getApp: getForgeApp,
    recordOpen: recordForgeOpen,
    pinApp: pinForgeApp,
    refreshApps: refreshForgeApps,
  } = useApps({
    enabled: backgroundPollingEnabled,
    pollMs: 5000 * pollingMultiplier,
    includeCode: true,
  });
  const appWindows = useAppWindows();
  const [appForgeOpen, setAppForgeOpen] = useState(false);

  // Track loaded app code (list endpoint omits code for speed)
  const [loadedAppCode, setLoadedAppCode] = useState<Record<string, ForgeApp>>({});

  // Expose task functions globally for agent control
  useEffect(() => {
    (window as any).argentTasks = {
      add: addTask,
      update: updateTaskStatus,
      complete: completeTaskByTitle,
      delete: deleteTask,
      edit: editTask,
      execute: executeTask,
      list: () => tasks,
      refresh: refreshTasks,
    };
  }, [
    addTask,
    updateTaskStatus,
    completeTaskByTitle,
    deleteTask,
    editTask,
    executeTask,
    tasks,
    refreshTasks,
  ]);

  // App Forge: open app handler (fetches full code then opens window)
  const handleOpenForgeApp = useCallback(
    (appId: string) => {
      const cachedApp = loadedAppCode[appId];
      const listApp = forgeApps.find((app) => app.id === appId);
      const appWithCode =
        cachedApp && !isAppStatusShell(cachedApp.code)
          ? cachedApp
          : listApp?.code
            ? listApp
            : cachedApp;
      const needsCodeFetch = !appWithCode || isAppStatusShell(appWithCode.code);

      if (listApp?.code && (!cachedApp || isAppStatusShell(cachedApp.code))) {
        setLoadedAppCode((prev) => ({ ...prev, [appId]: listApp }));
      }

      if (needsCodeFetch) {
        if (listApp) {
          setLoadedAppCode((prev) =>
            prev[appId] && !isAppStatusShell(prev[appId]?.code)
              ? prev
              : {
                  ...prev,
                  [appId]: {
                    ...(prev[appId] || listApp),
                    code: buildAppLoadingDoc(listApp.name),
                  },
                },
          );
        }

        void (async () => {
          const fullApp = await getForgeApp(appId);
          void recordForgeOpen(appId);
          setLoadedAppCode((prev) => {
            if (fullApp) {
              return { ...prev, [appId]: fullApp };
            }
            const fallback = prev[appId] || listApp;
            if (!fallback) return prev;
            return {
              ...prev,
              [appId]: {
                ...fallback,
                code: buildAppLoadErrorDoc(fallback.name),
              },
            };
          });
        })();
      } else {
        void recordForgeOpen(appId);
      }

      appWindows.openApp(appId);
      setAppForgeOpen(false); // Close forge so window is visible
    },
    [recordForgeOpen, getForgeApp, loadedAppCode, forgeApps, appWindows],
  );

  const handleNewForgeApp = useCallback((name: string, description: string) => {
    const appName = name || "Untitled App";
    sendMessageRef.current(
      [
        `[APP_FORGE] Build an App Forge micro-app.`,
        ``,
        `App name: ${appName}`,
        `Description: ${description}`,
        ``,
        `IMPORTANT: You MUST use the \`apps\` tool to save this app. Do NOT write files to disk or open a browser.`,
        ``,
        `Call the \`apps\` tool like this:`,
        `{ "action": "create", "name": "${appName}", "description": "${description.replace(/"/g, '\\"').slice(0, 200)}", "icon": "<svg viewBox=\\"0 0 32 32\\" ...>...</svg>", "code": "<!DOCTYPE html>..." }`,
        ``,
        `Code requirements:`,
        `- Complete <!DOCTYPE html> document with all CSS and JS inline`,
        `- No external dependencies or CDN links`,
        `- Use prefers-color-scheme media query, default to dark theme`,
        `- Polished modern UI with transitions and hover effects`,
        `- Generate a simple SVG icon (32x32, purple #a855f7 accent)`,
        ``,
        `After creating, emit [APP:${appName}] marker in your response.`,
        `Do NOT ask questions. Build it now.`,
      ].join("\n"),
    );
  }, []);

  const handleDeleteForgeApp = useCallback(
    async (appId: string) => {
      const deleted = await deleteForgeApp(appId);
      if (!deleted) {
        return false;
      }

      appWindows.closeApp(appId);
      setLoadedAppCode((prev) => {
        if (!(appId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[appId];
        return next;
      });
      return true;
    },
    [deleteForgeApp, appWindows.closeApp],
  );

  // Expose app functions globally
  useEffect(() => {
    (window as any).argentApps = {
      list: () => forgeApps,
      open: handleOpenForgeApp,
      create: createForgeApp,
      delete: handleDeleteForgeApp,
      refresh: refreshForgeApps,
    };
  }, [forgeApps, handleOpenForgeApp, createForgeApp, handleDeleteForgeApp, refreshForgeApps]);

  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [operatorDisplayName, setOperatorDisplayName] = useState<string | null>(null);
  const [workforceBadgeAvailable, setWorkforceBadgeAvailable] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const key = localStorage.getItem("argent-session-key") || DEFAULT_MAIN_SESSION_KEY;
    return loadStoredMessages(key);
  });
  const [isLoading, setIsLoading] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [activeModelInfo, setActiveModelInfo] = useState<{
    provider: string;
    model: string;
    tier: string;
    score: number;
    routed: boolean;
  } | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true); // TTS Default ON
  const [ttsDisplayMode, setTtsDisplayMode] = useState<TtsDisplayMode>(() =>
    readStoredTtsDisplayMode(),
  );
  const [micEnabled, setMicEnabled] = useState(false); // Mic Default OFF (push-to-talk)
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [nativeSpeaking, setNativeSpeaking] = useState(false);
  const [nativeSpeechListening, setNativeSpeechListening] = useState(false);
  const [nativeSpeechError, setNativeSpeechError] = useState<string | null>(null);
  const [, setStreamingContent] = useState("");
  // Track model info from background "agent" events (keyed by runId)
  const bgModelInfoRef = useRef<
    Map<string, { provider: string; model: string; tier: string; score: number; routed: boolean }>
  >(new Map());
  const [messageQueue, setMessageQueue] = useState<
    Array<{ content: string; image?: string; attachments?: ChatAttachment[] }>
  >([]);
  const [busyMessageMode, setBusyMessageMode] = useState<"cue" | "steer">(() =>
    localStorage.getItem("argent-busy-message-mode") === "steer" ? "steer" : "cue",
  );
  // Chat collapse
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [unreadWhileCollapsed, setUnreadWhileCollapsed] = useState(0);
  const [miniBarInput, setMiniBarInput] = useState("");
  // Slash commands
  const [slashCommands, setSlashCommands] = useState<
    Array<{
      key: string;
      description: string;
      aliases: string[];
      category: string;
      acceptsArgs: boolean;
    }>
  >([]);
  // Session management — persist across refreshes
  const [currentSessionKey, setCurrentSessionKey] = useState(() =>
    toCanonicalSessionKey(localStorage.getItem("argent-session-key")),
  );
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [chatAgentOptions, setChatAgentOptions] = useState<ChatAgentOption[]>([]);
  const [contextUsage, setContextUsage] = useState<{
    used: number;
    total: number;
    estimated?: boolean;
  }>({
    used: 0,
    total: 200_000,
    estimated: false,
  });

  // Persist session key to localStorage so refresh resumes same session
  useEffect(() => {
    localStorage.setItem("argent-session-key", currentSessionKey);
  }, [currentSessionKey]);

  useEffect(() => {
    window.__argentCurrentSessionKey = currentSessionKey;
    return () => {
      if (window.__argentCurrentSessionKey === currentSessionKey) {
        delete window.__argentCurrentSessionKey;
      }
      delete window.__argentCurrentAssistantMessage;
    };
  }, [currentSessionKey]);

  useEffect(() => {
    window.__argentNativeVoiceStateChanged = ({ speaking }) => {
      setNativeSpeaking(Boolean(speaking));
    };
    return () => {
      delete window.__argentNativeVoiceStateChanged;
    };
  }, []);

  useEffect(() => {
    window.__argentNativeSpeechStateChanged = ({ listening, error }) => {
      const nextListening = Boolean(listening);
      setNativeSpeechListening(nextListening);
      setMicEnabled(nextListening);
      const nextError = typeof error === "string" && error.trim() ? error.trim() : null;
      setNativeSpeechError(nextError);
    };
    return () => {
      delete window.__argentNativeSpeechStateChanged;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("argent-busy-message-mode", busyMessageMode);
  }, [busyMessageMode]);

  useEffect(() => {
    localStorage.setItem(TTS_DISPLAY_MODE_KEY, ttsDisplayMode);
  }, [ttsDisplayMode]);

  const cycleTtsDisplayMode = useCallback(() => {
    setTtsDisplayMode((prev) =>
      prev === "text-voice" ? "voice-first" : prev === "voice-first" ? "voice-only" : "text-voice",
    );
  }, []);

  const effectiveIsSpeaking = isSpeaking || nativeSpeaking;

  const [selectedVoice, setSelectedVoice] = useState<Voice>("jessica");

  const [weatherModalOpen, setWeatherModalOpen] = useState(false);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [alertsModalOpen, setAlertsModalOpen] = useState(false);
  const [avatarPreviewActive, setAvatarPreviewActive] = useState(false);

  // Nudges configuration
  const [customNudges, setCustomNudges] = useState<any[]>([]);
  const [nudgesGlobalEnabled, setNudgesGlobalEnabled] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [avatarMode, setAvatarMode] = useState<"full" | "bubble">("full");
  const [avatarRenderer, setAvatarRenderer] = useState<"live2d" | "aevp">(() => {
    try {
      const saved = localStorage.getItem(AEVP_RENDERER_STORAGE_KEY);
      const migrated = localStorage.getItem(AEVP_RENDERER_MIGRATION_KEY) === "1";

      if (!migrated) {
        localStorage.setItem(AEVP_RENDERER_MIGRATION_KEY, "1");
        if (saved === "live2d") {
          localStorage.setItem(AEVP_RENDERER_STORAGE_KEY, "aevp");
          return "aevp";
        }
      }

      return saved === "live2d" || saved === "aevp" ? saved : "aevp";
    } catch {
      return "aevp";
    }
  });
  useEffect(() => {
    localStorage.setItem(AEVP_RENDERER_STORAGE_KEY, avatarRenderer);
  }, [avatarRenderer]);

  // Phase 5: Dynamic visual identity (persisted to localStorage)
  const [visualIdentity, setVisualIdentity] = useState<AgentVisualIdentity>(() => {
    try {
      const saved = localStorage.getItem("aevp-identity");
      if (saved) return JSON.parse(saved);
    } catch {
      /* use default */
    }
    return ARGENT_DEFAULT_IDENTITY;
  });
  useEffect(() => {
    localStorage.setItem("aevp-identity", JSON.stringify(visualIdentity));
  }, [visualIdentity]);

  // Phase 6: Accessibility config (persisted to localStorage)
  const [accessibilityConfig, setAccessibilityConfig] = useState<AccessibilityConfig>(() => {
    try {
      const saved = localStorage.getItem("aevp-accessibility");
      if (saved) return JSON.parse(saved);
    } catch {
      /* use default */
    }
    return DEFAULT_ACCESSIBILITY;
  });
  useEffect(() => {
    localStorage.setItem("aevp-accessibility", JSON.stringify(accessibilityConfig));
  }, [accessibilityConfig]);

  // Phase 6: Ref for tonal engine pre-speech cue callback
  const preSpeechCueRef = useRef<(() => void) | null>(null);

  const [activityPanelOpen, setActivityPanelOpen] = useState(false);
  const [deepThinkMode, setDeepThinkMode] = useState(false); // Powerful tier + high reasoning
  const [deepResearchMode, setDeepResearchMode] = useState(false); // Higher web-search budget mode

  // Canvas state
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasDocuments, setCanvasDocuments] = useState<CanvasDocument[]>([]);
  const [activeCanvasDocId, setActiveCanvasDocId] = useState<string | undefined>();

  // Think Tank (Debate) state — SSE hook lives here, rendered inside CanvasPanel
  const debate = useDebateState();
  const prevDebateActive = useRef(false);
  useEffect(() => {
    if (debate.state.active && !prevDebateActive.current) {
      // Debate just started — push a tab into the Doc Panel
      pushToCanvas("\u{1F9E0} Think Tank", "", "debate");
    }
    prevDebateActive.current = debate.state.active;
  }, [debate.state.active]);

  // Load recent canvas documents on mount
  useEffect(() => {
    const loadRecentDocuments = async () => {
      try {
        const response = await fetchLocalApi("/api/canvas/documents?limit=5", {}, 12_000);
        if (response.ok) {
          const data = await response.json();
          // Load full documents for the most recent ones; tolerate partial failures.
          const docsSettled = await Promise.allSettled(
            data.documents.slice(0, 3).map(async (meta: any) => {
              const docResponse = await fetchLocalApi(
                `/api/canvas/document/${meta.id}`,
                {},
                12_000,
              );
              if (!docResponse.ok) return null;
              return await docResponse.json();
            }),
          );
          const docs = docsSettled
            .filter(
              (result): result is PromiseFulfilledResult<any> => result.status === "fulfilled",
            )
            .map((result) => result.value);
          const validDocs = docs.filter((d) => d !== null);
          if (validDocs.length > 0) {
            setCanvasDocuments(validDocs);
            setActiveCanvasDocId(validDocs[0].id);
          }
        }
      } catch (err) {
        console.error("[Canvas] Failed to load recent documents:", err);
      }
    };
    loadRecentDocuments();
  }, []);

  // Check for first-run setup wizard
  useEffect(() => {
    if (localStorage.getItem("argent-setup-complete")) return;
    fetchLocalApi("/api/settings/auth-profiles")
      .then((res) => res.json())
      .then((data) => {
        const profiles = data.profiles ? Object.keys(data.profiles) : [];
        if (profiles.length === 0) {
          setShowSetup(true);
        }
      })
      .catch(() => {
        // API not available, skip setup wizard
      });
  }, []);

  // Canvas debug positioning (enable for tuning)
  const [canvasDebug, setCanvasDebug] = useState(false); // Disabled - locked at user preference
  const [canvasLeft, setCanvasLeft] = useState(0); // percentage - flush left drawer
  const [canvasWidth, setCanvasWidth] = useState(55); // percentage - ~55% width
  const [canvasTop, setCanvasTop] = useState(0); // rem - full height

  // Avatar debug (disabled - bubble position locked)
  const [avatarDebug, setAvatarDebug] = useState(false);

  // Bubble debug panel dragging
  const [bubbleDebugPos, setBubbleDebugPos] = useState({ x: 400, y: 400 });
  const [isDraggingBubbleDebug, setIsDraggingBubbleDebug] = useState(false);
  const [bubbleDragOffset, setBubbleDragOffset] = useState({ x: 0, y: 0 });

  const handleBubbleDebugMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (
        (e.target as HTMLElement).tagName === "INPUT" ||
        (e.target as HTMLElement).tagName === "BUTTON"
      ) {
        return;
      }
      setIsDraggingBubbleDebug(true);
      setBubbleDragOffset({
        x: e.clientX - bubbleDebugPos.x,
        y: e.clientY - bubbleDebugPos.y,
      });
    },
    [bubbleDebugPos],
  );

  const handleBubbleDebugMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDraggingBubbleDebug) {
        setBubbleDebugPos({
          x: e.clientX - bubbleDragOffset.x,
          y: e.clientY - bubbleDragOffset.y,
        });
      }
    },
    [isDraggingBubbleDebug, bubbleDragOffset],
  );

  const handleBubbleDebugMouseUp = useCallback(() => {
    setIsDraggingBubbleDebug(false);
  }, []);

  useEffect(() => {
    if (isDraggingBubbleDebug) {
      window.addEventListener("mousemove", handleBubbleDebugMouseMove);
      window.addEventListener("mouseup", handleBubbleDebugMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleBubbleDebugMouseMove);
        window.removeEventListener("mouseup", handleBubbleDebugMouseUp);
      };
    }
  }, [isDraggingBubbleDebug, handleBubbleDebugMouseMove, handleBubbleDebugMouseUp]);

  // Zoom preset debug (enable to tune positions)
  const [zoomDebug, setZoomDebug] = useState(false); // Set to true when tuning positions
  const [debugZoomPresets, setDebugZoomPresets] = useState({
    full: { scale: 0.092, x: 211, y: 379 },
    portrait: { scale: 0.144, x: 213, y: 546 },
    face: { scale: 0.22, x: 211, y: 800 },
  });

  // Debug panel dragging
  const [debugPanelPos, setDebugPanelPos] = useState({ x: 8, y: 8 });
  const [isDraggingDebug, setIsDraggingDebug] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleDebugMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (
        (e.target as HTMLElement).tagName === "INPUT" ||
        (e.target as HTMLElement).tagName === "BUTTON"
      ) {
        return; // Don't start drag on interactive elements
      }
      setIsDraggingDebug(true);
      setDragOffset({
        x: e.clientX - debugPanelPos.x,
        y: e.clientY - debugPanelPos.y,
      });
    },
    [debugPanelPos],
  );

  const handleDebugMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDraggingDebug) {
        setDebugPanelPos({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y,
        });
      }
    },
    [isDraggingDebug, dragOffset],
  );

  const handleDebugMouseUp = useCallback(() => {
    setIsDraggingDebug(false);
  }, []);

  useEffect(() => {
    if (isDraggingDebug) {
      window.addEventListener("mousemove", handleDebugMouseMove);
      window.addEventListener("mouseup", handleDebugMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleDebugMouseMove);
        window.removeEventListener("mouseup", handleDebugMouseUp);
      };
    }
  }, [isDraggingDebug, handleDebugMouseMove, handleDebugMouseUp]);

  // Bubble position and scale — loads saved preference
  const [bubbleConfig] = useState(() => loadBubbleConfig());
  const [bubbleOffsetX, setBubbleOffsetX] = useState(bubbleConfig.offsetX);
  const [bubbleOffsetY, setBubbleOffsetY] = useState(bubbleConfig.offsetY);
  const [bubbleScale, setBubbleScale] = useState(bubbleConfig.scale);

  // Avatar zoom state — loads saved default preference
  const [avatarZoom, setAvatarZoom] = useState<"face" | "portrait" | "full" | "custom">(() =>
    loadDefaultZoom(),
  );
  const [avatarCustomZoom, setAvatarCustomZoom] = useState(100);

  // Track current background mode (for active state in nav)
  const [currentBackgroundMode, setCurrentBackgroundMode] = useState<
    "professional" | "casual" | "tech" | "auto"
  >("auto");

  // Listen for background override changes
  useEffect(() => {
    const handleBackgroundChange = (e: CustomEvent) => {
      const mode = e.detail as "professional" | "casual" | "tech" | null;
      setCurrentBackgroundMode(mode || "auto");
    };

    window.addEventListener("backgroundOverride" as any, handleBackgroundChange as any);
    return () =>
      window.removeEventListener("backgroundOverride" as any, handleBackgroundChange as any);
  }, []);

  // Listen for time-based auto-switches — apply the assigned preset for that time slot
  // (uses user's saved overrides via buildPresetConfig)
  useEffect(() => {
    const handleAutoSwitch = (e: CustomEvent) => {
      const bgMode = e.detail as string; // "professional" | "casual" | "tech"
      if (!bgMode) return;
      // Map background mode to time slot, then look up assigned preset
      const tp = loadTimePresets();
      const slotMap: Record<string, string> = {
        professional: tp.morning,
        casual: tp.evening,
        tech: tp.night,
      };
      const presetId = slotMap[bgMode] ?? bgMode;
      console.log("[App] Auto-switching to time preset:", presetId, "(bg:", bgMode, ")");
      const res = loadConfig()?.resolution;
      const cfg = buildPresetConfig(presetId, res);
      resetCustomizationParams();
      applyCustomization(cfg.parameters);
      saveConfig(cfg);
    };

    window.addEventListener("backgroundAutoSwitch" as any, handleAutoSwitch as any);
    return () => window.removeEventListener("backgroundAutoSwitch" as any, handleAutoSwitch as any);
  }, []);

  // Listen for bubble config changes from AvatarCustomizer
  useEffect(() => {
    const handleBubbleChange = (e: CustomEvent) => {
      const cfg = e.detail as { offsetX: number; offsetY: number; scale: number };
      if (cfg) {
        setBubbleOffsetX(cfg.offsetX);
        setBubbleOffsetY(cfg.offsetY);
        setBubbleScale(cfg.scale);
      }
    };
    window.addEventListener("bubbleConfigChange" as any, handleBubbleChange as any);
    return () => window.removeEventListener("bubbleConfigChange" as any, handleBubbleChange as any);
  }, []);

  // Config with dictionary
  const { applyDictionary } = useConfig();

  // Lock screen (YubiKey WebAuthn)
  const lockScreen = useLockScreen();

  // Alerts system - must be before useEffect that references it
  const { alerts, unreadCount, addAlert, markRead, markAllRead, deleteAlert, clearAll } =
    useAlerts();
  const criticalAlertSeenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const onHeartbeatStale = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          lastCycleAt?: string | null;
          staleHours?: number | null;
          staleThresholdHours?: number;
        }>
      ).detail;
      const now = Date.now();
      const recentlyAlerted = alerts.some(
        (a) => a.source === "heartbeat-stale" && now - a.timestamp.getTime() < 12 * 60 * 60 * 1000,
      );
      if (recentlyAlerted) return;

      const lastCycle = detail?.lastCycleAt
        ? new Date(detail.lastCycleAt).toLocaleString()
        : "unknown";
      const staleHours =
        typeof detail?.staleHours === "number" && Number.isFinite(detail.staleHours)
          ? `${detail.staleHours}h`
          : "unknown";
      const threshold =
        typeof detail?.staleThresholdHours === "number" &&
        Number.isFinite(detail.staleThresholdHours)
          ? `${detail.staleThresholdHours}h`
          : "24h";

      addAlert(
        `Heartbeat accountability appears stale (last cycle: ${lastCycle}, age: ${staleHours}, threshold: ${threshold}). Run "argent system heartbeat recompute-score" and verify HEARTBEAT.md includes active ## Tasks.`,
        "warning",
        "heartbeat-stale",
      );
    };

    window.addEventListener("heartbeat-stale", onHeartbeatStale as EventListener);
    return () => {
      window.removeEventListener("heartbeat-stale", onHeartbeatStale as EventListener);
    };
  }, [alerts, addAlert]);

  useEffect(() => {
    const onHeartbeatRunnerInactive = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          state?: string | null;
          lastRunAt?: string | null;
          ageHours?: number | null;
          staleThresholdHours?: number | null;
        }>
      ).detail;
      const now = Date.now();
      const recentlyAlerted = alerts.some(
        (a) =>
          a.source === "heartbeat-runner-inactive" &&
          now - a.timestamp.getTime() < 6 * 60 * 60 * 1000,
      );
      if (recentlyAlerted) return;

      const state = typeof detail?.state === "string" && detail.state ? detail.state : "unknown";
      const lastRun = detail?.lastRunAt ? new Date(detail.lastRunAt).toLocaleString() : "unknown";
      const age =
        typeof detail?.ageHours === "number" && Number.isFinite(detail.ageHours)
          ? `${detail.ageHours}h`
          : "unknown";
      const threshold =
        typeof detail?.staleThresholdHours === "number" &&
        Number.isFinite(detail.staleThresholdHours)
          ? `${detail.staleThresholdHours}h`
          : "unknown";

      addAlert(
        `Heartbeat runner appears inactive (state: ${state}, last run: ${lastRun}, age: ${age}, threshold: ${threshold}). Run "argent status --all --json" and verify gateway heartbeat scheduler health.`,
        "warning",
        "heartbeat-runner-inactive",
      );
    };

    window.addEventListener(
      "heartbeat-runner-inactive",
      onHeartbeatRunnerInactive as EventListener,
    );
    return () => {
      window.removeEventListener(
        "heartbeat-runner-inactive",
        onHeartbeatRunnerInactive as EventListener,
      );
    };
  }, [alerts, addAlert]);

  useEffect(() => {
    const onCriticalServiceDown = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          services?: string[];
          timestamp?: string | null;
        }>
      ).detail;
      const services = Array.isArray(detail?.services)
        ? detail.services.filter((v): v is string => typeof v === "string" && v.length > 0)
        : [];
      if (services.length === 0) return;
      const servicesKey = services.slice().sort().join(",");
      const now = Date.now();
      const recentlyAlerted = alerts.some(
        (a) =>
          a.source === "critical-service-down" &&
          a.message.includes(servicesKey) &&
          now - a.timestamp.getTime() < 60 * 60 * 1000,
      );
      if (recentlyAlerted) return;

      const checkedAt = detail?.timestamp ? new Date(detail.timestamp).toLocaleString() : "unknown";
      addAlert(
        `Critical service outage detected (${servicesKey}) at ${checkedAt}. Argent reliability is degraded until services recover. Run: "pg_isready -h 127.0.0.1 -p 5433 -d argentos" and "redis-cli -h 127.0.0.1 -p 6380 ping".`,
        "urgent",
        "critical-service-down",
      );
    };

    const onCriticalServiceRecovered = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          previous?: string[];
          timestamp?: string | null;
        }>
      ).detail;
      const previous = Array.isArray(detail?.previous)
        ? detail.previous.filter((v): v is string => typeof v === "string" && v.length > 0)
        : [];
      if (previous.length === 0) return;
      const checkedAt = detail?.timestamp ? new Date(detail.timestamp).toLocaleString() : "unknown";
      addAlert(
        `Critical services recovered (${previous.join(",")}) at ${checkedAt}.`,
        "info",
        "critical-service-recovered",
      );
    };

    window.addEventListener("critical-service-down", onCriticalServiceDown as EventListener);
    window.addEventListener(
      "critical-service-recovered",
      onCriticalServiceRecovered as EventListener,
    );
    return () => {
      window.removeEventListener("critical-service-down", onCriticalServiceDown as EventListener);
      window.removeEventListener(
        "critical-service-recovered",
        onCriticalServiceRecovered as EventListener,
      );
    };
  }, [alerts, addAlert]);

  // Expose alerts functions globally for agent control
  useEffect(() => {
    (window as any).argentAlerts = {
      add: addAlert,
      markRead,
      markAllRead,
      delete: deleteAlert,
      clear: clearAll,
      list: () => alerts,
      unreadCount: () => unreadCount,
    };
  }, [addAlert, markRead, markAllRead, deleteAlert, clearAll, alerts, unreadCount]);

  // CORS approval toast state
  const [corsApprovalDomain, setCorsApprovalDomain] = useState<string | null>(null);
  const corsResolveRef = useRef<((approved: boolean) => void) | null>(null);

  // Register CORS approval callback — shows toast when a fetch hits an unallowlisted domain
  useEffect(() => {
    setCorsApprovalCallback((domain: string) => {
      return new Promise<boolean>((resolve) => {
        corsResolveRef.current = resolve;
        setCorsApprovalDomain(domain);
        // Auto-deny after 30 seconds if no action taken
        setTimeout(() => {
          if (corsResolveRef.current === resolve) {
            resolve(false);
            setCorsApprovalDomain(null);
            corsResolveRef.current = null;
          }
        }, 30000);
      });
    });
  }, []);

  const [recognitionMode] = useState<RecognitionMode>("whisper");
  const [_interimTranscript, setInterimTranscript] = useState("");

  // Audio device selection
  const { inputDeviceId, outputDeviceId, setInputDeviceId, setOutputDeviceId } = useAudioDevices();

  // Real data hooks
  const { nextEvent } = useCalendar(60000 * pollingMultiplier, backgroundPollingEnabled);
  const {
    weather,
    detailedWeather,
    loading: weatherLoading,
    refresh: refreshWeather,
  } = useWeather(900000 * pollingMultiplier, backgroundPollingEnabled);

  useEffect(() => {
    let cancelled = false;
    const loadRuntimeProfile = async () => {
      try {
        const response = await fetchLocalApi("/api/settings/load-profile");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (cancelled) return;
        setRuntimeLoadProfile((prev) => ({
          active: data.active || prev.active,
          label: data.label || prev.label,
          description: data.description || prev.description,
          pollingMultiplier:
            typeof data.pollingMultiplier === "number" && Number.isFinite(data.pollingMultiplier)
              ? Math.max(1, data.pollingMultiplier)
              : prev.pollingMultiplier,
          allowManualOverrides: data.allowManualOverrides !== false,
        }));
      } catch (error) {
        console.error("[LoadProfile] Failed to load runtime profile:", error);
      }
    };
    void loadRuntimeProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  // Connect to the Gateway (must be before hooks that depend on it)
  const gateway = useGateway({
    url: GATEWAY_URL,
    token: GATEWAY_TOKEN,
  });

  // Workflow Map data fetched by WorkflowMapCanvas via gateway WebSocket RPC

  const canonicalizeSessionKey = useCallback(
    (sessionKey: string | null | undefined) =>
      toCanonicalSessionKey(sessionKey, {
        mainSessionKey: gateway.mainSessionKey,
        defaultAgentId: gateway.defaultAgentId,
      }),
    [gateway.defaultAgentId, gateway.mainSessionKey],
  );

  useEffect(() => {
    setCurrentSessionKey((prev) => canonicalizeSessionKey(prev));
  }, [canonicalizeSessionKey]);

  const currentChatAgentId = resolveSessionAgentId(
    currentSessionKey,
    resolvePrimaryChatAgentId(gateway.mainSessionKey, gateway.defaultAgentId || DEFAULT_AGENT_ID),
  );
  const primaryChatAgentId = resolvePrimaryChatAgentId(
    gateway.mainSessionKey,
    gateway.defaultAgentId || DEFAULT_AGENT_ID,
  );
  const currentAgentTtsProfile = resolveAgentTtsProfile(currentChatAgentId);
  const nativeVoiceShouldHandlePlayback =
    isNativeVoiceActive() &&
    (!currentAgentTtsProfile || currentAgentTtsProfile.provider === "elevenlabs");

  useEffect(() => {
    const fallbackId = primaryChatAgentId;
    setChatAgentOptions((prev) =>
      mergeVisibleChatAgentOptions({
        primaryAgentId: fallbackId,
        currentChatAgentId,
        loadedOptions: prev,
      }),
    );
  }, [currentChatAgentId, primaryChatAgentId]);

  useEffect(() => {
    if (!gateway.connected) return;
    let cancelled = false;

    const loadChatAgents = async () => {
      try {
        const payload = await gateway.request<{
          defaultId?: string;
          agents?: Array<{ id?: string; name?: string }>;
        }>("agents.list");
        if (cancelled) return;

        const options = Array.isArray(payload?.agents)
          ? payload.agents
              .map((row) => {
                const id = normalizeAgentId(row?.id, "");
                if (!id) return null;
                const label =
                  typeof row?.name === "string" && row.name.trim() ? row.name.trim() : id;
                return { id, label };
              })
              .filter((row): row is ChatAgentOption => Boolean(row))
          : [];

        const defaultId = resolvePrimaryChatAgentId(
          gateway.mainSessionKey,
          normalizeAgentId(payload?.defaultId, primaryChatAgentId),
        );
        setChatAgentOptions(
          mergeVisibleChatAgentOptions({
            primaryAgentId: defaultId,
            currentChatAgentId,
            loadedOptions: options,
          }),
        );
      } catch (error) {
        console.warn("[Chat] Failed to load agent options:", error);
        if (!cancelled) {
          setChatAgentOptions(
            mergeVisibleChatAgentOptions({
              primaryAgentId: primaryChatAgentId,
              currentChatAgentId,
            }),
          );
        }
      }
    };

    void loadChatAgents();
    return () => {
      cancelled = true;
    };
  }, [currentChatAgentId, gateway.connected, gateway.request, primaryChatAgentId]);

  useEffect(() => {
    if (!gateway.connected) return;
    let canceled = false;

    const pollCriticalHealth = async () => {
      try {
        const payload = await gateway.request<{ criticalAlerts?: CriticalServiceAlertPayload[] }>(
          "health",
          {},
          { timeoutMs: 8000 },
        );
        if (canceled) return;
        const criticalAlerts = Array.isArray(payload?.criticalAlerts) ? payload.criticalAlerts : [];
        for (const alert of criticalAlerts) {
          const dedupeKey = `${alert.id}:${alert.status}:${alert.lastSeenAt}`;
          if (criticalAlertSeenRef.current.has(dedupeKey)) continue;
          const existingUnread = alerts.some(
            (item) => item.source === `critical-service:${alert.id}` && item.read === false,
          );
          if (existingUnread) {
            criticalAlertSeenRef.current.add(dedupeKey);
            continue;
          }
          addAlert(formatCriticalAlertMessage(alert), "urgent", `critical-service:${alert.id}`, {
            label: "Copy command",
            onClick: () => navigator.clipboard.writeText(alert.operatorCommand),
          });
          criticalAlertSeenRef.current.add(dedupeKey);
        }
      } catch {
        // Critical health polling should never block dashboard usage.
      }
    };

    void pollCriticalHealth();
    const timer = window.setInterval(() => {
      void pollCriticalHealth();
    }, 60_000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [gateway.connected, gateway.request, alerts, addAlert]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refreshWorkforceBadge = async () => {
      if (!gateway.connected || !backgroundPollingEnabled || !workforceBadgeAvailable) return;
      try {
        const overview = await gateway.request<{ dueNowCount?: number; blockedRunsCount?: number }>(
          "jobs.overview",
        );
        if (disposed) return;
        setWorkforceBadgeAvailable(true);
        setWorkforceBadge({
          dueNow:
            typeof overview?.dueNowCount === "number" && Number.isFinite(overview.dueNowCount)
              ? Math.max(0, Math.floor(overview.dueNowCount))
              : 0,
          blocked:
            typeof overview?.blockedRunsCount === "number" &&
            Number.isFinite(overview.blockedRunsCount)
              ? Math.max(0, Math.floor(overview.blockedRunsCount))
              : 0,
        });
      } catch (error) {
        if (!disposed) {
          if (isStrictPgJobsUnavailable(error)) {
            setWorkforceBadgeAvailable(false);
          }
          setWorkforceBadge((prev) =>
            prev.dueNow === 0 && prev.blocked === 0 ? prev : { dueNow: 0, blocked: 0 },
          );
        }
      }
    };

    if (gateway.connected && backgroundPollingEnabled && workforceBadgeAvailable) {
      void refreshWorkforceBadge();
      timer = setInterval(() => {
        void refreshWorkforceBadge();
      }, 15000 * pollingMultiplier);
    } else {
      setWorkforceBadge({ dueNow: 0, blocked: 0 });
    }

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [
    gateway.connected,
    gateway.request,
    backgroundPollingEnabled,
    workforceBadgeAvailable,
    pollingMultiplier,
  ]);

  // AEVP State Aggregator — unified agent state from SIS episodes + activity events.
  // Syncs into existing avatarState/avatarMood for backward compatibility.
  const agentState = useAgentState(gateway);

  // Phase 5+6: Consume agent-initiated identity changes
  useEffect(() => {
    const change = agentState.pendingIdentityChange;
    if (!change) return;

    setVisualIdentity((prev) => {
      // Apply preset if specified
      let next = change.preset
        ? { ...getPreset(change.preset as IdentityStyleCategory) }
        : { ...prev };

      // Apply individual personality overrides
      const personality = { ...next.personality };
      if (change.warmth !== undefined) personality.warmth = change.warmth;
      if (change.energy !== undefined) personality.energy = change.energy;
      if (change.formality !== undefined) personality.formality = change.formality;
      if (change.openness !== undefined) personality.openness = change.openness;
      next.personality = personality;

      return next;
    });

    agentState.clearPendingIdentityChange();
  }, [agentState.pendingIdentityChange, agentState.clearPendingIdentityChange]);

  // Phase 4: Amplitude tracker for AEVP orb speech pulse
  // Direct renderer setter bypasses React (no 60fps re-renders).
  // Falls back to ref-based agentState setter if renderer not ready.
  const rendererAmplitudeSetterRef = useRef<((v: number) => void) | null>(null);
  const amplitudeTrackerRef = useRef<AmplitudeTracker | null>(null);
  if (!amplitudeTrackerRef.current) {
    amplitudeTrackerRef.current = new AmplitudeTracker();
    amplitudeTrackerRef.current.onAmplitude = (v) => {
      rendererAmplitudeSetterRef.current?.(v);
      agentState.setSpeechAmplitude(v); // ref write, no re-render
    };
  }

  // Sync SIS-driven mood into existing avatarMood when SIS data is available
  useEffect(() => {
    if (agentState.hasSISData) {
      setAvatarMood((prev) => (prev === agentState.moodName ? prev : agentState.moodName));
    }
  }, [agentState.moodName, agentState.hasSISData]);

  // Sync AEVP activity state into existing avatarState (only for thinking/working/idle)
  useEffect(() => {
    const mapped = agentState.avatarState;
    // Don't override transient states like "success" or "error"
    if (mapped === "thinking" || mapped === "working" || mapped === "idle") {
      setAvatarState((prev) => (prev === mapped ? prev : mapped));
    }
  }, [agentState.avatarState]);

  const {
    cronJobs,
    formatSchedule: cronFormatSchedule,
    getNextRun: cronGetNextRun,
    updateCronJob,
    deleteCronJob,
    runCronJob,
  } = useCronJobs({
    gatewayRequest: gateway.request,
    gatewayConnected: gateway.connected,
    enabled: backgroundPollingEnabled,
  });

  // We need a ref to handleSendMessage to avoid circular deps and stale closures
  const sendMessageRef = useRef<
    (
      msg: string,
      image?: string,
      attachments?: ChatAttachment[],
      options?: { silent?: boolean },
    ) => void
  >(() => {});

  // TTS hook
  // Track the most recent assistant message waiting for an audio URL attachment
  const pendingTtsMsgRef = useRef<{ msgId: string } | null>(null);
  const attachTtsSummary = useCallback((msgId: string, summary: string) => {
    const cleanedSummary = stripTtsControlMarkers(summary).trim();
    if (!cleanedSummary) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, ttsSummary: cleanedSummary } : m)),
    );
  }, []);

  const attachTtsAudioUrl = useCallback((msgId: string, audioUrl: string) => {
    if (!msgId || !audioUrl) return;
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, ttsAudioUrl: audioUrl } : m)));
  }, []);

  const tts = useTTS({
    voice: selectedVoice,
    profile: currentAgentTtsProfile,
    outputDeviceId,
    allowWebSpeechFallback: false,
    onStart: () => {
      setAvatarState("working");
      setIsSpeaking(true);
      agentState.setIsSpeaking(true);
    },
    onEnd: () => {
      stopLipSync();
      setAvatarState("idle");
      setIsSpeaking(false);
      agentState.setIsSpeaking(false);
      pendingTtsMsgRef.current = null;
      // Reset mood to neutral after speaking — re-enables cursor tracking
      setAvatarMood(undefined);
    },
    onError: (err) => {
      console.error("[TTS] Error:", err);
      setAvatarState("idle");
      setIsSpeaking(false);
      agentState.setIsSpeaking(false);
      pendingTtsMsgRef.current = null;
      // Alert on API key failures
      const status = (err as any)?.status;
      if (status === 401 || status === 503) {
        const providerLabel =
          currentAgentTtsProfile?.provider === "fish" ? "Fish Audio" : "ElevenLabs";
        const alertSource =
          currentAgentTtsProfile?.provider === "fish" ? "tts-fish" : "tts-elevenlabs";
        const hasExisting = alerts.some((a) => a.source === alertSource && !a.read);
        if (!hasExisting) {
          addAlert(
            status === 401
              ? `${providerLabel} API key is invalid or expired. Update it in Settings.`
              : `${providerLabel} service unavailable. Check your API key in Settings.`,
            "urgent",
            alertSource,
          );
        }
      }
    },
    onAnalyserReady: (analyser) => {
      startLipSyncWithAnalyser(analyser);
      // Phase 4: Feed analyser to amplitude tracker for orb pulse
      amplitudeTrackerRef.current?.attach(analyser);
    },
    onSpeechStart: () => {
      // Speech started — amplitude tracker is already running via analyser
      // Phase 6: Play tonal pre-speech cue
      preSpeechCueRef.current?.();
    },
    onSpeechEnd: () => {
      // Phase 4: Stop amplitude tracker + reset orb speech state
      amplitudeTrackerRef.current?.detach();
      agentState.setSpeechAmplitude(0);
    },
    onAudioReady: (audio) => {
      // Attach TTS audio URL to the assistant message for replay
      const pending = pendingTtsMsgRef.current;
      if (pending && audio.src) {
        const { msgId } = pending;
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, ttsAudioUrl: audio.src } : m)),
        );
        pendingTtsMsgRef.current = null;
      }
    },
  });

  const stopActiveSpeech = useCallback(() => {
    if (isNativeVoiceActive()) {
      postNativeVoiceCommand({ kind: "tts_stop" });
    }
    setNativeSpeaking(false);
    tts.stop();
    stopLipSync();
    amplitudeTrackerRef.current?.detach();
    setAvatarState("idle");
    setIsSpeaking(false);
    agentState.setIsSpeaking(false);
    agentState.setSpeechAmplitude(0);
    pendingTtsMsgRef.current = null;
  }, [agentState, tts]);

  // Track pending restart for continuous listening
  const [shouldRestartListening, setShouldRestartListening] = useState(false);
  // Track intentional mic mute to prevent sending partial transcripts
  const intentionalMuteRef = useRef(false);

  // Speech recognition hook
  const speech = useSpeechRecognition({
    mode: recognitionMode,
    deviceId: inputDeviceId,
    onResult: (transcript) => {
      setInterimTranscript("");
      // Don't send if mic was intentionally muted
      if (intentionalMuteRef.current) {
        console.log("[Speech] Ignoring transcript from intentional mute");
        intentionalMuteRef.current = false;
        return;
      }
      if (transcript.trim()) {
        sendMessageRef.current(transcript.trim());
      }
    },
    onInterim: (transcript) => {
      setInterimTranscript(transcript);
    },
    onStart: () => {
      // Stop any TTS when starting to listen
      stopActiveSpeech();
      addLog("info", `Listening (${recognitionMode})...`);
    },
    onEnd: () => {
      setInterimTranscript("");
      // Signal that we should restart if mic is still enabled
      setShouldRestartListening(true);
    },
    onError: (err) => {
      console.error("[Speech] Error:", err);
      addLog("info", "Speech error", err.message);
    },
  });

  const effectiveSpeechError = nativeSpeechError ?? speech.lastError;
  const effectiveIsListening = nativeSpeechListening || speech.isListening;

  const handleToggleAudio = useCallback(() => {
    const nextEnabled = !audioEnabled;
    setAudioEnabled(nextEnabled);
    if (!nextEnabled) {
      stopActiveSpeech();
    }
  }, [audioEnabled, stopActiveSpeech]);

  const handleToggleMic = useCallback(() => {
    const nativeSpeech = isNativeSpeechActive();
    if (!micEnabled) {
      intentionalMuteRef.current = false;
      setNativeSpeechError(null);
      setMicEnabled(true);
      if (nativeSpeech) {
        setNativeSpeechListening(true);
        const sent = postNativeSpeechCommand({ kind: "start" });
        if (!sent) {
          setNativeSpeechListening(false);
          setMicEnabled(false);
          speech.start();
        }
        return;
      }
      speech.start();
      return;
    }

    intentionalMuteRef.current = true;
    setMicEnabled(false);
    if (nativeSpeech) {
      setNativeSpeechListening(false);
      postNativeSpeechCommand({ kind: "stop" });
      return;
    }
    speech.stop();
  }, [micEnabled, speech]);

  useEffect(() => {
    window.__argentNativeAttachTtsAudio = ({ msgId, audioUrl }) => {
      attachTtsAudioUrl(msgId, audioUrl);
    };
    return () => {
      delete window.__argentNativeAttachTtsAudio;
    };
  }, [attachTtsAudioUrl]);

  // Auto-restart listening disabled - push-to-talk mode
  // User must click mic button to start listening each time
  useEffect(() => {
    setShouldRestartListening(false);
  }, [shouldRestartListening]);

  // Listen for task events from gateway
  useEffect(() => {
    const unsubscribe = gateway.on("task", (payload: any) => {
      if (payload.action === "add") {
        addTask(payload.title);
      } else if (payload.action === "update") {
        updateTaskStatus(payload.id, payload.status);
      }
    });
    return unsubscribe;
  }, [gateway, addTask, updateTaskStatus]);

  // Capture model routing info from background "agent" events
  // (so we can attach it to the corresponding background "chat" message)
  useEffect(() => {
    if (!gateway.connected) return;

    const unsubscribe = gateway.on("agent", (payload: unknown) => {
      const event = payload as {
        runId?: string;
        stream?: string;
        data?: {
          phase?: string;
          provider?: string;
          model?: string;
          tier?: string;
          score?: number;
          routed?: boolean;
        };
      };
      if (!event.runId) return;
      // Skip user-initiated runs (already handled by sendMessage)
      if (gateway.activeUserRunIds.has(event.runId)) return;
      // Capture model selection events
      if (event.stream === "lifecycle" && event.data?.phase === "model_selected") {
        // Prevent unbounded growth — purge if map exceeds 100 entries
        if (bgModelInfoRef.current.size > 100) {
          bgModelInfoRef.current.clear();
        }
        bgModelInfoRef.current.set(event.runId, {
          provider: event.data.provider ?? "",
          model: event.data.model ?? "",
          tier: event.data.tier ?? "",
          score: event.data.score ?? 0,
          routed: event.data.routed ?? false,
        });
      }
    });

    return unsubscribe;
  }, [gateway.connected, gateway.on]);

  // Listen for background "chat" events (e.g. subagent announce results)
  // These come from runs NOT initiated by the dashboard user (Forge, cron, etc.)
  useEffect(() => {
    if (!gateway.connected) return;

    const unsubscribe = gateway.on("chat", (payload: unknown) => {
      const event = payload as {
        runId?: string;
        sessionKey?: string;
        state?: string;
        message?: {
          role?: string;
          content?: Array<{ type: string; text?: string }>;
          timestamp?: number;
        };
      };

      // Skip events from user-initiated runs (already handled by sendMessage)
      if (event.runId && gateway.activeUserRunIds.has(event.runId)) return;

      // Only handle final messages with actual content
      if (event.state !== "final" || !event.message) return;

      const text = event.message.content?.[0]?.text;
      if (!text || !text.trim()) return;

      // Only render background messages that belong to the active visible session.
      // This prevents agent announce / workflow chatter from polluting the main chat thread.
      if (!event.sessionKey || canonicalizeSessionKey(event.sessionKey) !== currentSessionKey)
        return;

      console.log("[Chat] Background message received:", text.substring(0, 200));

      // Extract and strip [MOOD:...] plus TTS/system markers before display
      const moodMatch = text.match(/^\[MOOD:(\w+)\]\s*/);
      const mood = moodMatch ? moodMatch[1] : undefined;
      const withoutMood = moodMatch ? text.slice(moodMatch[0].length) : text;
      const alertInfoMatches = Array.from(withoutMood.matchAll(/\[ALERT:([^\]]+)\]/g)).map(
        (match) => ({
          message: match[1]?.trim() || "",
          priority: "info" as const,
        }),
      );
      const alertWarnMatches = Array.from(withoutMood.matchAll(/\[ALERT_WARN:([^\]]+)\]/g)).map(
        (match) => ({
          message: match[1]?.trim() || "",
          priority: "warning" as const,
        }),
      );
      const alertUrgentMatches = Array.from(withoutMood.matchAll(/\[ALERT_URGENT:([^\]]+)\]/g)).map(
        (match) => ({
          message: match[1]?.trim() || "",
          priority: "urgent" as const,
        }),
      );
      const alertMarkers = [...alertUrgentMatches, ...alertWarnMatches, ...alertInfoMatches].filter(
        (alert) => alert.message.length > 0,
      );
      for (const alert of alertMarkers) {
        addAlert(
          alert.message,
          alert.priority,
          `background-alert:${event.runId ?? event.sessionKey ?? "chat"}:${alert.priority}:${alert.message}`,
        );
      }

      const mediaMatches = withoutMood.match(/MEDIA:([^\s\n]+)/gi) || [];
      const audioMediaPath = mediaMatches
        .map((match) => match.replace(/^MEDIA:/i, ""))
        .find((mediaPath) => /\.(mp3|wav|ogg|m4a|opus)$/i.test(mediaPath));
      const contentWithoutStructuredTts = stripTtsControlMarkers(withoutMood);
      const audioTagRe =
        /\[(?!(?:TASK|TASK_START|TASK_DONE|TASK_ERROR|APP|ALERT|ALERT_WARN|ALERT_URGENT|MOOD|TTS|TTS_NOW):)[a-zA-Z][a-zA-Z0-9 '',.\-]{0,60}\](?!\()/g;
      const cleanText = contentWithoutStructuredTts
        .replace(/\[TASK:[^\]]+\]/g, "")
        .replace(/\[TASK_START:[^\]]+\]/g, "")
        .replace(/\[TASK_DONE:[^\]]+\]/g, "")
        .replace(/\[TASK_ERROR:[^\]]+\]/g, "")
        .replace(/\[APP:[^\]]+\]/g, "")
        .replace(/\[ALERT:[^\]]+\]/g, "")
        .replace(/\[ALERT_WARN:[^\]]+\]/g, "")
        .replace(/\[ALERT_URGENT:[^\]]+\]/g, "")
        .replace(INTERNAL_SYSTEM_MARKER_RE, "")
        .replace(/MEDIA:[^\s\n]+/gi, "")
        .replace(audioTagRe, "")
        .trim();
      const displayText = cleanText || alertMarkers[0]?.message || "";

      // Detect family member source from content (e.g. "Forge says...", "Scout found...")
      const familyNames = [
        "forge",
        "scout",
        "prism",
        "sentinel",
        "oracle",
        "herald",
        "weaver",
        "echo",
        "vanguard",
        "nexus",
        "ember",
        "cipher",
        "atlas",
        "flux",
        "lumen",
        "sage",
        "aria",
        "drift",
      ];
      const contentLower = displayText.toLowerCase();
      // Match "Name ..." at start OR "Name's ..." (e.g. "Prism's back")
      const familySource = familyNames.find(
        (name) => contentLower.startsWith(name + " ") || contentLower.startsWith(name + "'s "),
      );

      // Look up model info captured from background "agent" events
      const modelInfo = event.runId ? bgModelInfoRef.current.get(event.runId) : undefined;
      if (event.runId) bgModelInfoRef.current.delete(event.runId);

      // Add as a new assistant message in the chat
      const bgMessage: ChatMessage = {
        id: `bg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "assistant",
        content: displayText,
        timestamp: new Date(event.message.timestamp || Date.now()),
        mood,
        familySource: familySource
          ? familySource.charAt(0).toUpperCase() + familySource.slice(1)
          : undefined,
        modelInfo,
        ttsSummary: audioMediaPath ? "(audio alert)" : undefined,
      };
      if (displayText) {
        setMessages((prev) => [...prev, bgMessage]);
      }
      if (audioEnabled && audioMediaPath) {
        const mediaUrl = `/api/media?path=${encodeURIComponent(audioMediaPath)}`;
        if (displayText) {
          pendingTtsMsgRef.current = { msgId: bgMessage.id };
        }
        void tts.playUrl(mediaUrl);
      }
    });

    return unsubscribe;
  }, [
    addAlert,
    audioEnabled,
    canonicalizeSessionKey,
    currentSessionKey,
    gateway.connected,
    gateway.on,
    tts,
  ]);

  // Add a log entry (use counter to ensure unique IDs even within same millisecond)
  const logIdCounter = useRef(0);
  const addLog = useCallback((type: LogEntry["type"], message: string, details?: string) => {
    logIdCounter.current += 1;
    const entry: LogEntry = {
      id: `${Date.now()}-${logIdCounter.current}`,
      type,
      message,
      details,
      timestamp: new Date(),
    };
    setLogs((prev) => [entry, ...prev].slice(0, 20));
  }, []);

  const loadOperatorDisplayName = useCallback(async (): Promise<string | undefined> => {
    if (operatorDisplayName) return operatorDisplayName;
    try {
      const res = await fetchLocalApi("/api/settings/alignment/__main__/USER.md");
      if (!res.ok) return undefined;
      const payload = (await res.json()) as { content?: string };
      const parsed = extractOperatorDisplayNameFromUserDoc(payload.content ?? "");
      if (parsed) {
        setOperatorDisplayName(parsed);
      }
      return parsed;
    } catch {
      return undefined;
    }
  }, [operatorDisplayName]);

  // Persist messages to localStorage (per-session)
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(messages, currentSessionKey);
    }
  }, [messages, currentSessionKey]);

  useEffect(() => {
    const assistant = [...messages]
      .reverse()
      .find((msg) => msg.role === "assistant" && msg.content.trim().length > 0);
    if (!assistant) {
      delete window.__argentCurrentAssistantMessage;
      return;
    }
    window.__argentCurrentAssistantMessage = {
      sessionKey: currentSessionKey,
      id: assistant.id,
      content: assistant.content,
      ttsSummary: typeof assistant.ttsSummary === "string" ? assistant.ttsSummary : null,
      timestampMs: assistant.timestamp instanceof Date ? assistant.timestamp.getTime() : null,
    };
  }, [messages, currentSessionKey]);

  // Track unread messages while chat is collapsed
  const prevMsgCountRef = useRef(messages.length);
  useEffect(() => {
    if (chatCollapsed && messages.length > prevMsgCountRef.current) {
      const newest = messages[messages.length - 1];
      if (newest && newest.role === "assistant") {
        setUnreadWhileCollapsed((n) => n + 1);
      }
    }
    prevMsgCountRef.current = messages.length;
  }, [messages, chatCollapsed]);

  // Listen for canvas push events
  useEffect(() => {
    const handleCanvasPush = (event: CustomEvent<CanvasDocument>) => {
      const doc = event.detail;
      setCanvasDocuments((prev) => {
        // Prefer stable document IDs; fallback to title match for legacy pushes.
        const existingIndex = prev.findIndex((d) => d.id === doc.id || d.title === doc.title);
        if (existingIndex > -1) {
          const updated = [...prev];
          updated[existingIndex] = { ...updated[existingIndex], ...doc };
          return updated;
        }
        return [...prev, doc];
      });
      setActiveCanvasDocId(doc.id);
      setCanvasOpen(true);
      // Morph avatar to bubble mode
      setAvatarMode("bubble");
    };

    window.addEventListener("canvas:push" as any, handleCanvasPush);
    return () => window.removeEventListener("canvas:push" as any, handleCanvasPush);
  }, []);

  // Handle canvas open - morph to bubble avatar
  const handleCanvasOpen = useCallback(() => {
    setCanvasOpen(true);
    setAvatarMode("bubble");
  }, []);

  // Handle canvas close - morph back to full avatar
  const handleCanvasClose = useCallback(() => {
    setCanvasOpen(false);
    setAvatarMode("full");
  }, []);

  // No auto-start - push-to-talk mode

  // Log connection status changes
  useEffect(() => {
    let cancelled = false;
    if (gateway.connected) {
      addLog("success", "Connected to Gateway");
      // Add welcome message only if no stored history
      const seedWelcome = async () => {
        const name = operatorDisplayName ?? (await loadOperatorDisplayName());
        if (cancelled) return;
        setMessages((prev) => {
          if (prev.length === 0) {
            return [
              {
                id: "welcome",
                role: "assistant",
                content: buildWelcomeText(name),
                timestamp: new Date(),
              },
            ];
          }
          return prev;
        });
      };
      void seedWelcome();
    } else if (gateway.reconnecting) {
      addLog("info", "Gateway disconnected - reconnecting...");
    } else if (gateway.error) {
      addLog("info", "Gateway connection failed", gateway.error);
    }
    return () => {
      cancelled = true;
    };
  }, [
    gateway.connected,
    gateway.reconnecting,
    gateway.error,
    addLog,
    operatorDisplayName,
    loadOperatorDisplayName,
  ]);

  // Fetch available slash commands when connected
  useEffect(() => {
    if (!gateway.connected) return;
    gateway
      .listCommands()
      .then((res) => {
        setSlashCommands(res.commands);
      })
      .catch((err) => {
        console.warn("[App] Failed to fetch commands:", err);
      });
  }, [gateway.connected, gateway.listCommands]);

  // Fetch context usage on connect and when session changes
  useEffect(() => {
    if (!gateway.connected) return;
    gateway
      .getSessionTokens(currentSessionKey)
      .then(setContextUsage)
      .catch(() => {});
  }, [gateway.connected, currentSessionKey, gateway.getSessionTokens]);

  // Handle thumbs up/down feedback on agent messages
  const handleFeedback = useCallback(
    async (messageId: string, type: "up" | "down") => {
      // Update local message state
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: type } : m)));

      // Call the score API to persist
      try {
        const resp = await fetchLocalApi("/api/score/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, messageId, sessionKey: currentSessionKey }),
        });
        const result = await resp.json();
        const points = result.points;
        const newScore = result.score;
        const target = result.target;

        // Trigger immediate score refresh in StatusBar
        window.dispatchEvent(new CustomEvent("score-updated"));

        // Notify agent immediately through chat
        const emoji = type === "up" ? "\u{1F44D}" : "\u{1F44E}";
        const label = type === "up" ? "POSITIVE" : "NEGATIVE";
        const feedbackMsg = `[FEEDBACK] ${emoji} ${label} feedback on your last response (${points > 0 ? "+" : ""}${points} points). Your accountability score is now ${newScore}/${target}.`;
        sendMessageRef.current(feedbackMsg);
      } catch (err) {
        console.error("[Feedback] Failed to record:", err);
      }
    },
    [currentSessionKey],
  );

  // Handle sending a message
  const handleSendMessage = useCallback(
    async (
      content: string,
      image?: string,
      attachments?: ChatAttachment[],
      options?: { silent?: boolean },
    ) => {
      const isSilent = options?.silent === true;
      const sanitizedContent = stripTtsControlMarkers(content);
      if (!sanitizedContent && !image && (!attachments || attachments.length === 0)) {
        return;
      }

      if (!isSilent) {
        stopActiveSpeech();
      }

      if (!isSilent) {
        // Add user message (clean App Forge directive for display)
        const displayContent = sanitizedContent.startsWith("[APP_FORGE]")
          ? sanitizedContent
              .replace(/\[APP_FORGE\]\s*/, "")
              .split("\n\n")
              .slice(0, 2)
              .join("\n\n")
          : sanitizedContent;
        const userMessage: ChatMessage = {
          id: Date.now().toString(),
          role: "user",
          content: displayContent,
          image,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMessage]);
      }

      setIsLoading(true);
      if (!isSilent) setAvatarState("thinking");
      // Don't hard-reset mood — let continuity system handle natural transitions
      // Only reset on session clear, not per-message
      setStreamingContent("");
      addLog(
        isSilent ? "info" : "message",
        isSilent ? "Silent nudge sent" : "Sent message",
        sanitizedContent.substring(0, 50),
      );

      try {
        // Create placeholder for assistant response
        const assistantId = (Date.now() + 1).toString();
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: "",
            timestamp: new Date(),
          },
        ]);

        setAvatarState("working");

        // Track tasks we've already created during this response (to avoid duplicates)
        const createdTasks = new Set<string>();
        const startedTasks = new Set<string>();
        const completedTasks = new Set<string>();

        // Send to Gateway and stream response
        // Add markers for audio state and deep think mode
        let messageToSend = sanitizedContent;
        if (audioEnabled) {
          messageToSend = `[AUDIO_ENABLED] ${messageToSend}`;
        }
        if (deepThinkMode) {
          messageToSend = `[DEEP_THINK] ${messageToSend}`;
        }
        if (deepResearchMode) {
          messageToSend = `[DEEP_RESEARCH] ${messageToSend}`;
        }
        // Inject focused document context so the agent knows what we're looking at
        if (canvasOpen && activeCanvasDocId) {
          const focusedDoc = canvasDocuments.find((d) => d.id === activeCanvasDocId);
          if (focusedDoc) {
            messageToSend = `[DOC_FOCUS:${focusedDoc.title}] ${messageToSend}`;
          }
        }
        // Track tools used for badge display
        const toolsUsedSet = new Set<string>();
        // Track interjections already spoken (so we don't repeat mid-stream)
        const spokenInterjections = new Set<string>();
        // Track actual spoken text (post-dictionary) to prevent duplicate final TTS
        const spokenTexts = new Set<string>();

        // Convert ChatAttachment[] to gateway format
        const gatewayAttachments = attachments?.map((a) => ({
          type: a.type,
          mimeType: a.mimeType,
          fileName: a.fileName,
          content: a.content,
        }));

        let streamCallbackInvoked = false;
        const response = await gateway.sendMessage(
          messageToSend,
          (streamedContent, done) => {
            streamCallbackInvoked = true;
            // Parse task markers incrementally as they stream in
            // [TASK:title] or [TASK:title|details] creates a new task (pending state, appears immediately)
            // [TASK_START:title] marks task as in-progress
            // [TASK_DONE:title] marks task completed
            // Details support markdown - use \n for newlines in the marker
            const taskMatches = streamedContent.match(/\[TASK:([^\]]+)\]/g) || [];
            const startMatches = streamedContent.match(/\[TASK_START:([^\]]+)\]/g) || [];
            const doneMatches = streamedContent.match(/\[TASK_DONE:([^\]]+)\]/g) || [];
            const errorMatches = streamedContent.match(/\[TASK_ERROR:([^\]]+)\]/g) || [];

            const appCreateMatches = Array.from(
              streamedContent.matchAll(APP_CREATED_RESULT_PATTERN),
            );

            appCreateMatches.forEach(([, name, id, versionText]) => {
              if (!id || createdTasks.has(`app-create:${id}`)) {
                return;
              }
              const version = Number.parseInt(versionText || "1", 10) || 1;
              upsertForgeApp(buildOptimisticForgeApp({ id, name, version }));
              addAlert(`App "${name}" created!`, "info", "app-forge");
              void refreshForgeApps();
              createdTasks.add(`app-create:${id}`);
              createdTasks.add(`app-name:${name}`);
            });

            // Parse app markers
            // [APP:name] creates flash notification for new app
            const appMatches = streamedContent.match(/\[APP:([^\]]+)\]/g) || [];

            appMatches.forEach((match) => {
              const name = match.replace("[APP:", "").replace("]", "").trim();
              if (name && !createdTasks.has(`app-name:${name}`)) {
                // Check if this is a terminal marker: [APP:terminal:{id}]
                if (name.startsWith("terminal:")) {
                  const termId = name.slice("terminal:".length).trim();
                  if (termId && !createdTasks.has(`terminal:${termId}`)) {
                    pushToCanvas("Terminal", "", "terminal", undefined, termId);
                    createdTasks.add(`terminal:${termId}`);
                  }
                } else {
                  addAlert(`App "${name}" created!`, "info", "app-forge");
                  void refreshForgeApps();
                }
                createdTasks.add(`app-name:${name}`);
              }
            });

            // Parse mood markers — AI sets its own emotional state
            // [MOOD:happy] [MOOD:excited] [MOOD:sad] etc.
            // Mood continuity filter prevents jarring cross-valence flips
            const moodMatches = streamedContent.match(/\[MOOD:([^\]]+)\]/g) || [];
            const rawMoodNames = moodMatches.map((m) =>
              m.replace("[MOOD:", "").replace("]", "").trim(),
            );
            const parsedMoods = rawMoodNames
              .map((m) => parseMoodName(m))
              .filter((m): m is MoodName => m !== null);
            if (parsedMoods.length > 0) {
              const filteredMood = applyMoodContinuity(parsedMoods);
              if (filteredMood) {
                // Pass the raw mood name (e.g. "thoughtful") for richer AEVP color mapping
                const lastRawMood = rawMoodNames[rawMoodNames.length - 1];
                setAvatarMood((prev) => (prev === filteredMood ? prev : filteredMood));
                agentState.applyTextMood(filteredMood, lastRawMood);
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId ? { ...msg, mood: filteredMood } : msg,
                  ),
                );
              }
            }

            // Parse alert markers
            // [ALERT:message] creates info alert
            // [ALERT_WARN:message] creates warning alert
            // [ALERT_URGENT:message] creates urgent alert
            const alertMatches = streamedContent.match(/\[ALERT:([^\]]+)\]/g) || [];
            const alertWarnMatches = streamedContent.match(/\[ALERT_WARN:([^\]]+)\]/g) || [];
            const alertUrgentMatches = streamedContent.match(/\[ALERT_URGENT:([^\]]+)\]/g) || [];

            // Create tasks immediately when [TASK:] marker appears
            // Supports [TASK:title] or [TASK:title|details] format
            taskMatches.forEach((match) => {
              const content = match.replace("[TASK:", "").replace("]", "").trim();
              // Parse title|details format (pipe separator)
              const pipeIndex = content.indexOf("|");
              let title: string;
              let details: string | undefined;

              if (pipeIndex > -1) {
                title = content.substring(0, pipeIndex).trim();
                // Convert escaped newlines to actual newlines in details
                details = content
                  .substring(pipeIndex + 1)
                  .trim()
                  .replace(/\\n/g, "\n");
              } else {
                title = content;
              }

              // Skip empty or placeholder titles
              if (!title || title === "..." || title === "title" || createdTasks.has(title)) {
                return;
              }
              console.log(
                "[Tasks] Creating task (pending):",
                title,
                details ? "(with details)" : "",
              );
              addTask(title, "one-time", undefined, details);
              createdTasks.add(title);
            });

            // Mark tasks in-progress when [TASK_START:] marker appears
            startMatches.forEach((match) => {
              const title = match.replace("[TASK_START:", "").replace("]", "");
              if (!startedTasks.has(title)) {
                console.log("[Tasks] Starting task:", title);
                startTaskByTitle(title);
                startedTasks.add(title);
              }
            });

            // Mark tasks complete when [TASK_DONE:] marker appears
            doneMatches.forEach((match) => {
              const title = match.replace("[TASK_DONE:", "").replace("]", "");
              if (!completedTasks.has(title)) {
                console.log("[Tasks] Completing task:", title);
                completeTaskByTitle(title);
                completedTasks.add(title);
              }
            });

            // Mark tasks as errored when [TASK_ERROR:] marker appears
            errorMatches.forEach((match) => {
              const title = match.replace("[TASK_ERROR:", "").replace("]", "");
              if (!completedTasks.has(title)) {
                console.log("[Tasks] Task error:", title);
                // Update the task status to show error in the UI
                const task = tasks.find((t: any) => t.title === title && t.status !== "completed");
                if (task) {
                  updateTask(task.id, { status: "error" as any });
                }
                completedTasks.add(title);
              }
            });

            // Process alert markers
            alertMatches.forEach((match) => {
              const message = match.replace("[ALERT:", "").replace("]", "").trim();
              if (message && !createdTasks.has(`alert:${message}`)) {
                addAlert(message, "info", "argent");
                createdTasks.add(`alert:${message}`);
              }
            });
            alertWarnMatches.forEach((match) => {
              const message = match.replace("[ALERT_WARN:", "").replace("]", "").trim();
              if (message && !createdTasks.has(`alert:${message}`)) {
                addAlert(message, "warning", "argent");
                createdTasks.add(`alert:${message}`);
              }
            });
            alertUrgentMatches.forEach((match) => {
              const message = match.replace("[ALERT_URGENT:", "").replace("]", "").trim();
              if (message && !createdTasks.has(`alert:${message}`)) {
                addAlert(message, "urgent", "argent");
                createdTasks.add(`alert:${message}`);
              }
            });

            // Quick interjections — [TTS_NOW:text] fires TTS immediately mid-stream
            // Used for acknowledgments like "Let me check on that" before tool use
            const ttsNowMarkers = parseStructuredMarkers(streamedContent, "TTS_NOW");
            ttsNowMarkers.forEach((marker) => {
              if (!spokenInterjections.has(marker.full) && audioEnabled) {
                if (marker.content) {
                  console.log("[TTS] ✓ Interjection (NOW):", marker.content);
                  spokenInterjections.add(marker.full);
                  const text = marker.content;
                  const spoken = applyDictionary(text);
                  spokenTexts.add(spoken);
                  if (
                    nativeVoiceShouldHandlePlayback &&
                    !postNativeVoiceEvent({
                      kind: "tts_now",
                      text: spoken,
                      sessionKey: currentSessionKey,
                      messageId: assistantId,
                      mood: avatarMood ?? null,
                    })
                  ) {
                    tts.speak(spoken, avatarMood ?? undefined);
                  }
                }
              }
            });

            // Extract TTS marker content (what should be spoken at end of response)
            // Format: [TTS:text to speak] — may contain nested [audio tags]
            const ttsMarkers = parseStructuredMarkers(streamedContent, "TTS");
            const contentWithoutStructuredTts = stripStructuredMarkers(streamedContent);
            const inlineTts = parseInlineTtsDirectives(contentWithoutStructuredTts);
            const visibleText = inlineTts.cleanedText;
            const spokenSource = inlineTts.spokenText ?? visibleText;

            // ElevenLabs v3 audio tags — kept in TTS text, stripped from display
            // v3 supports 1800+ free-form tags; match any [bracketed phrase] that looks like a tag
            const AUDIO_TAG_RE =
              /\[(?!(?:TASK|TASK_START|TASK_DONE|TASK_ERROR|APP|ALERT|ALERT_WARN|ALERT_URGENT|MOOD|TTS|TTS_NOW):)[a-zA-Z][a-zA-Z0-9 '',.\-]{0,60}\](?!\()/g;

            // Strip markers from display (system markers + audio tags)
            // Also strip bare mood direction lines (e.g., "soft, warm" on its own line)
            const cleanContent = visibleText
              .replace(/^[a-zA-Z][a-zA-Z, ]{2,50}$/gm, (line) => {
                const parts = line.toLowerCase().trim().split(/,\s*/);
                if (
                  parts.length >= 1 &&
                  parts.length <= 4 &&
                  parts.every((p) => BARE_MOOD_RE.test(p.trim()))
                ) {
                  return "";
                }
                return line;
              })
              .replace(/\[TASK:[^\]]+\]/g, "")
              .replace(/\[TASK_START:[^\]]+\]/g, "")
              .replace(/\[TASK_DONE:[^\]]+\]/g, "")
              .replace(/\[TASK_ERROR:[^\]]+\]/g, "")
              .replace(/\[APP:[^\]]+\]/g, "")
              .replace(/\[ALERT:[^\]]+\]/g, "")
              .replace(/\[ALERT_WARN:[^\]]+\]/g, "")
              .replace(/\[ALERT_URGENT:[^\]]+\]/g, "")
              .replace(/\[MOOD:[^\]]+\]/g, "")
              .replace(INTERNAL_SYSTEM_MARKER_RE, "")
              .replace(/MEDIA:[^\s\n]+/gi, "")
              .replace(AUDIO_TAG_RE, "") // Strip audio tags from display
              .trim();
            const fallbackDisplayContent =
              ttsMarkers[0]?.content?.trim() ?? inlineTts.spokenText?.trim() ?? "";
            const displayContent = cleanContent || fallbackDisplayContent;

            // Build TTS-ready text: strip system markers but KEEP audio tags for ElevenLabs
            const ttsReadyContent = spokenSource
              .replace(/\[TASK:[^\]]+\]/g, "")
              .replace(/\[TASK_START:[^\]]+\]/g, "")
              .replace(/\[TASK_DONE:[^\]]+\]/g, "")
              .replace(/\[TASK_ERROR:[^\]]+\]/g, "")
              .replace(/\[APP:[^\]]+\]/g, "")
              .replace(/\[ALERT:[^\]]+\]/g, "")
              .replace(/\[ALERT_WARN:[^\]]+\]/g, "")
              .replace(/\[ALERT_URGENT:[^\]]+\]/g, "")
              .replace(/\[MOOD:[^\]]+\]/g, "")
              .replace(INTERNAL_SYSTEM_MARKER_RE, "")
              .replace(/MEDIA:[^\s\n]+/gi, "")
              // Audio tags like [laughs], [pauses] are KEPT for ElevenLabs v3
              .trim();

            // Update the streaming message (with markers stripped)
            setStreamingContent(displayContent);
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId ? { ...msg, content: displayContent } : msg,
              ),
            );

            if (done) {
              setIsLoading(false);
              setActiveTool(null);
              setActiveModelInfo(null);
              addLog("success", "Response received");

              // Refresh context usage after response
              gateway
                .getSessionTokens(currentSessionKey)
                .then(setContextUsage)
                .catch(() => {});

              // Always preserve the spoken-summary artifact in chat. Native voice mode
              // changes who plays audio, not whether the summary exists.
              const mediaMatches = streamedContent.match(/MEDIA:([^\s\n]+)/gi) || [];
              const audioMediaPath = mediaMatches
                .map((m) => m.replace(/^MEDIA:/i, ""))
                .find((p) => /\.(mp3|wav|ogg|m4a|opus)$/i.test(p));
              const picked = pickSpokenSummary({
                markers: ttsMarkers,
                explicitText: inlineTts.spokenText,
                ttsReadyText: ttsReadyContent,
              });
              const spokenText = picked.text ? applyDictionary(picked.text) : "";
              const alreadySpokenFinal = spokenText ? spokenTexts.has(spokenText) : false;

              if (audioMediaPath) {
                attachTtsSummary(assistantId, "(audio alert)");
              } else if (spokenText) {
                attachTtsSummary(assistantId, spokenText);
              }

              // Speak response via dashboard TTS (calls ElevenLabs directly)
              console.log(
                "[TTS] Final path: audioEnabled=",
                audioEnabled,
                "nativeVoice=",
                isNativeVoiceActive(),
                "spokenText=",
                spokenText?.substring(0, 80),
                "audioMediaPath=",
                audioMediaPath,
              );
              if (audioEnabled && audioMediaPath) {
                const mediaUrl = `/api/media?path=${encodeURIComponent(audioMediaPath)}`;
                console.log("[TTS] ✓ Playing pre-rendered MEDIA audio:", audioMediaPath);
                pendingTtsMsgRef.current = { msgId: assistantId };
                tts.playUrl(mediaUrl);
              } else if (audioEnabled && nativeVoiceShouldHandlePlayback) {
                if (spokenText) {
                  if (alreadySpokenFinal) {
                    console.log(
                      "[TTS] ✗ Skipping native final — already spoken as interjection:",
                      spokenText.substring(0, 80),
                    );
                    setAvatarState("idle");
                  } else {
                    const sent = postNativeVoiceEvent({
                      kind: "tts_final",
                      text: spokenText,
                      sessionKey: currentSessionKey,
                      messageId: assistantId,
                      mood: avatarMood ?? null,
                    });
                    console.log(
                      "[TTS] Native voice tts_final sent=",
                      sent,
                      "text length=",
                      spokenText.length,
                    );
                    if (!sent) {
                      pendingTtsMsgRef.current = { msgId: assistantId };
                      tts.speak(spokenText, avatarMood);
                    }
                  }
                } else {
                  console.log("[TTS] Native voice active but no spokenText — going idle");
                  setAvatarState("success");
                  setTimeout(() => setAvatarState("idle"), 2000);
                }
              } else if (audioEnabled) {
                // Priority 1/2: choose most substantive spoken summary
                if (spokenText) {
                  // Skip if this text was already spoken as a mid-stream interjection
                  if (alreadySpokenFinal) {
                    console.log(
                      "[TTS] ✗ Skipping final — already spoken as interjection:",
                      spokenText.substring(0, 80),
                    );
                    setAvatarState("idle");
                  } else {
                    console.log(
                      `[TTS] ✓ Using ${picked.source} summary:`,
                      spokenText.substring(0, 100),
                    );
                    pendingTtsMsgRef.current = { msgId: assistantId };
                    tts.speak(spokenText, avatarMood);
                  }
                } else {
                  setAvatarState("idle");
                }
              } else {
                setAvatarState("success");
                setTimeout(() => setAvatarState("idle"), 2000);
              }
            }

            // Refresh tasks+projects after response completes to catch any
            // tasks created/updated by the agent during this turn
            if (done) {
              refreshTasks();
              // Drain message queue — send next queued message (use ref to avoid stale closure)
              setMessageQueue((prev) => {
                if (prev.length > 0) {
                  const [next, ...rest] = prev;
                  setTimeout(
                    () => sendMessageRef.current(next.content, next.image, next.attachments),
                    50,
                  );
                  return rest;
                }
                return prev;
              });
            }
          },
          (modelInfo) => {
            // Store model routing info on the assistant message for display
            setActiveModelInfo(modelInfo);
            setMessages((prev) =>
              prev.map((msg) => (msg.id === assistantId ? { ...msg, modelInfo } : msg)),
            );
          },
          (toolName, phase) => {
            // Track tool usage for badge display
            if (phase === "start") {
              toolsUsedSet.add(toolName);
              setActiveTool(toolName);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId ? { ...msg, toolsUsed: Array.from(toolsUsedSet) } : msg,
                ),
              );
            } else if (phase === "end") {
              setActiveTool(null);
            }
          },
          gatewayAttachments,
          currentSessionKey,
          {
            thinking: deepThinkMode ? "xhigh" : "default",
          },
        );

        // If we got a direct response (non-streaming)
        if (response && !streamCallbackInvoked) {
          // Extract quick and final TTS markers from non-streaming response (allows nested [audio tags])
          const nonStreamingTtsNowMarkers = parseStructuredMarkers(response, "TTS_NOW");
          const nonStreamingTtsMarkers = parseStructuredMarkers(response, "TTS");
          const responseWithoutStructuredTts = stripStructuredMarkers(response);
          const inlineTts = parseInlineTtsDirectives(responseWithoutStructuredTts);
          const visibleText = inlineTts.cleanedText;
          const spokenSource = inlineTts.spokenText ?? visibleText;
          // Parse mood from non-streaming response too (with continuity)
          const nonStreamMoodMatches = response.match(/\[MOOD:([^\]]+)\]/g) || [];
          const nonStreamRawMoods = nonStreamMoodMatches.map((m) =>
            m.replace("[MOOD:", "").replace("]", "").trim(),
          );
          const nonStreamMoods = nonStreamRawMoods
            .map((m) => parseMoodName(m))
            .filter((m): m is MoodName => m !== null);
          if (nonStreamMoods.length > 0) {
            const filtered = applyMoodContinuity(nonStreamMoods);
            if (filtered) {
              const lastRaw = nonStreamRawMoods[nonStreamRawMoods.length - 1];
              setAvatarMood((prev) => (prev === filtered ? prev : filtered));
              agentState.applyTextMood(filtered, lastRaw);
              setMessages((prev) =>
                prev.map((msg) => (msg.id === assistantId ? { ...msg, mood: filtered } : msg)),
              );
            }
          }

          const AUDIO_TAG_RE_NS =
            /\[(?!(?:TASK|TASK_START|TASK_DONE|TASK_ERROR|APP|ALERT|ALERT_WARN|ALERT_URGENT|MOOD|TTS|TTS_NOW):)[a-zA-Z][a-zA-Z0-9 '',.\-]{0,60}\](?!\()/g;

          const cleanResponse = visibleText
            .replace(/^[a-zA-Z][a-zA-Z, ]{2,50}$/gm, (line) => {
              const parts = line.toLowerCase().trim().split(/,\s*/);
              if (
                parts.length >= 1 &&
                parts.length <= 4 &&
                parts.every((p) => BARE_MOOD_RE.test(p.trim()))
              ) {
                return "";
              }
              return line;
            })
            .replace(/\[TASK:[^\]]+\]/g, "")
            .replace(/\[TASK_START:[^\]]+\]/g, "")
            .replace(/\[TASK_DONE:[^\]]+\]/g, "")
            .replace(/\[TASK_ERROR:[^\]]+\]/g, "")
            .replace(/\[APP:[^\]]+\]/g, "")
            .replace(/\[ALERT:[^\]]+\]/g, "")
            .replace(/\[ALERT_WARN:[^\]]+\]/g, "")
            .replace(/\[ALERT_URGENT:[^\]]+\]/g, "")
            .replace(/\[MOOD:[^\]]+\]/g, "")
            .replace(INTERNAL_SYSTEM_MARKER_RE, "")
            .replace(/MEDIA:[^\s\n]+/gi, "")
            .replace(AUDIO_TAG_RE_NS, "") // Strip audio tags from display
            .trim();
          const fallbackDisplayResponse =
            nonStreamingTtsMarkers[0]?.content?.trim() ?? inlineTts.spokenText?.trim() ?? "";
          const displayResponse = cleanResponse || fallbackDisplayResponse;

          // TTS text: same cleanup but KEEP audio tags
          const ttsReadyResponse = spokenSource
            .replace(/\[TASK:[^\]]+\]/g, "")
            .replace(/\[TASK_START:[^\]]+\]/g, "")
            .replace(/\[TASK_DONE:[^\]]+\]/g, "")
            .replace(/\[TASK_ERROR:[^\]]+\]/g, "")
            .replace(/\[APP:[^\]]+\]/g, "")
            .replace(/\[ALERT:[^\]]+\]/g, "")
            .replace(/\[ALERT_WARN:[^\]]+\]/g, "")
            .replace(/\[ALERT_URGENT:[^\]]+\]/g, "")
            .replace(/\[MOOD:[^\]]+\]/g, "")
            .replace(INTERNAL_SYSTEM_MARKER_RE, "")
            .replace(/MEDIA:[^\s\n]+/gi, "")
            .trim();

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, content: displayResponse } : msg,
            ),
          );
          setIsLoading(false);
          setActiveTool(null);
          setActiveModelInfo(null);
          addLog("success", "Response received");

          // Refresh context usage after response
          gateway
            .getSessionTokens(currentSessionKey)
            .then(setContextUsage)
            .catch(() => {});

          const mediaMatchesNS = response.match(/MEDIA:([^\s\n]+)/gi) || [];
          const audioMediaPathNS = mediaMatchesNS
            .map((m) => m.replace(/^MEDIA:/i, ""))
            .find((p) => /\.(mp3|wav|ogg|m4a|opus)$/i.test(p));
          const picked = pickSpokenSummary({
            markers: nonStreamingTtsMarkers,
            explicitText: inlineTts.spokenText,
            ttsReadyText: ttsReadyResponse,
          });
          const spokenText = picked.text ? applyDictionary(picked.text) : "";

          const spokenInterjectionSet = new Set<string>();
          if (audioEnabled) {
            const spokenInterjections = nonStreamingTtsNowMarkers
              .map((marker) => applyDictionary(marker.content))
              .map((text) => text.trim())
              .filter(Boolean);
            spokenInterjections.forEach((text) => spokenInterjectionSet.add(text));
            for (const interjection of spokenInterjections) {
              if (nativeVoiceShouldHandlePlayback) {
                const sent = postNativeVoiceEvent({
                  kind: "tts_now",
                  text: interjection,
                  sessionKey: currentSessionKey,
                  messageId: assistantId,
                  mood: avatarMood ?? null,
                });
                if (!sent) {
                  void tts.speak(interjection, avatarMood ?? undefined);
                }
              } else {
                void tts.speak(interjection, avatarMood ?? undefined);
              }
            }
          }
          const alreadySpokenFinal = spokenText ? spokenInterjectionSet.has(spokenText) : false;

          if (audioMediaPathNS) {
            attachTtsSummary(assistantId, "(audio alert)");
          } else if (spokenText) {
            attachTtsSummary(assistantId, spokenText);
          }

          // Apply same TTS logic as streaming case
          if (audioEnabled && audioMediaPathNS) {
            const mediaUrl = `/api/media?path=${encodeURIComponent(audioMediaPathNS)}`;
            console.log(
              "[TTS] ✓ Playing pre-rendered MEDIA audio (non-streaming):",
              audioMediaPathNS,
            );
            pendingTtsMsgRef.current = { msgId: assistantId };
            tts.playUrl(mediaUrl);
          } else if (audioEnabled && nativeVoiceShouldHandlePlayback) {
            if (spokenText) {
              if (alreadySpokenFinal) {
                console.log(
                  "[TTS] ✗ Skipping native final (non-streaming) — already spoken as interjection:",
                  spokenText.substring(0, 80),
                );
                setAvatarState("idle");
              } else {
                const sent = postNativeVoiceEvent({
                  kind: "tts_final",
                  text: spokenText,
                  sessionKey: currentSessionKey,
                  messageId: assistantId,
                  mood: avatarMood ?? null,
                });
                if (!sent) {
                  pendingTtsMsgRef.current = { msgId: assistantId };
                  tts.speak(spokenText, avatarMood);
                }
              }
            } else {
              setAvatarState("success");
              setTimeout(() => setAvatarState("idle"), 2000);
            }
          } else if (audioEnabled) {
            if (spokenText) {
              if (alreadySpokenFinal) {
                console.log(
                  "[TTS] ✗ Skipping final (non-streaming) — already spoken as interjection:",
                  spokenText.substring(0, 80),
                );
                setAvatarState("idle");
              } else {
                console.log(`[TTS] ✓ Using ${picked.source} summary (non-streaming)`);
                pendingTtsMsgRef.current = { msgId: assistantId };
                tts.speak(spokenText, avatarMood);
              }
            } else {
              setAvatarState("idle");
            }
          } else {
            setAvatarState("success");
            setTimeout(() => setAvatarState("idle"), 2000);
          }
        }
      } catch (err) {
        console.error("Failed to send message:", err);
        setIsLoading(false);
        setActiveTool(null);
        setActiveModelInfo(null);
        setAvatarState("error");

        const errMsg = err instanceof Error ? err.message : "Unknown error";
        const isRateLimit = /cooldown|rate.limit|all.*models.*failed|unavailable/i.test(errMsg);
        const isContextOverflow = /context.overflow|too.large|context.length/i.test(errMsg);

        let userMessage: string;
        if (isRateLimit) {
          userMessage =
            "All AI models are currently rate-limited — your weekly quota may be exhausted across all auth profiles. Wait for the quota to reset, or add a fallback API key.";
        } else if (isContextOverflow) {
          userMessage =
            "Session context is too large for the model. Try starting a new conversation.";
        } else {
          userMessage = `Sorry, I couldn't process that. ${errMsg}`;
        }

        addLog("info", isRateLimit ? "Rate limit reached" : "Error sending message", errMsg);

        // Add error message
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 2).toString(),
            role: "assistant",
            content: userMessage,
            timestamp: new Date(),
          },
        ]);

        setTimeout(() => setAvatarState("idle"), 3000);
      }
    },
    [
      gateway,
      addLog,
      addAlert,
      audioEnabled,
      tts,
      attachTtsSummary,
      applyDictionary,
      addTask,
      completeTaskByTitle,
      refreshTasks,
      refreshForgeApps,
      upsertForgeApp,
      currentSessionKey,
      stopActiveSpeech,
    ],
  );

  // Queue a message to be sent after the current run completes
  const handleQueueMessage = useCallback(
    (
      content: string,
      image?: string,
      attachments?: ChatAttachment[],
      options?: { skipEcho?: boolean },
    ) => {
      setMessageQueue((prev) => [...prev, { content, image, attachments }]);
      // Show queued message in chat immediately (grayed out via a marker)
      if (!options?.skipEcho) {
        setMessages((prev) => [
          ...prev,
          {
            id: `queued-${Date.now()}`,
            role: "user",
            content,
            image,
            timestamp: new Date(),
          },
        ]);
      }
    },
    [],
  );

  const handleSteerMessage = useCallback(
    async (content: string, image?: string, attachments?: ChatAttachment[]) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      stopActiveSpeech();

      setMessages((prev) => [
        ...prev,
        {
          id: `steer-${Date.now()}`,
          role: "user",
          content: trimmed,
          image,
          timestamp: new Date(),
        },
      ]);

      let messageToSend = trimmed;
      if (audioEnabled) {
        messageToSend = `[AUDIO_ENABLED] ${messageToSend}`;
      }
      if (deepThinkMode) {
        messageToSend = `[DEEP_THINK] ${messageToSend}`;
      }
      if (deepResearchMode) {
        messageToSend = `[DEEP_RESEARCH] ${messageToSend}`;
      }
      if (canvasOpen && activeCanvasDocId) {
        const focusedDoc = canvasDocuments.find((d) => d.id === activeCanvasDocId);
        if (focusedDoc) {
          messageToSend = `[DOC_FOCUS:${focusedDoc.title}] ${messageToSend}`;
        }
      }

      const gatewayAttachments = attachments?.map((a) => ({
        type: a.type,
        mimeType: a.mimeType,
        fileName: a.fileName,
        content: a.content,
      }));

      try {
        const steered = await gateway.steerMessage(
          messageToSend,
          gatewayAttachments,
          currentSessionKey,
          { thinking: deepThinkMode ? "xhigh" : "default" },
        );
        if (steered.status === "steered") {
          addLog("success", "Steered message into active run");
          return;
        }
        if (steered.status === "not_active" || steered.status === "not_steerable") {
          addLog("info", "No steer target — queued message");
          handleQueueMessage(trimmed, image, attachments, { skipEcho: true });
          return;
        }
        // Defensive: if the gateway ever reports started/accepted-ish states,
        // do not queue to avoid duplicate sends.
        addLog("info", "Steer returned non-steer status", steered.status);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        addLog("info", "Steer unavailable — queued message", reason);
        handleQueueMessage(trimmed, image, attachments, { skipEcho: true });
      }
    },
    [
      activeCanvasDocId,
      addLog,
      audioEnabled,
      canvasDocuments,
      canvasOpen,
      currentSessionKey,
      deepResearchMode,
      deepThinkMode,
      gateway,
      handleQueueMessage,
      stopActiveSpeech,
    ],
  );

  // Remove a queued message by index
  const handleDequeueMessage = useCallback((index: number) => {
    setMessageQueue((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Session Management Handlers ──

  const refreshSessions = useCallback(async () => {
    if (!gateway.connected) return;
    setSessionsLoading(true);
    try {
      const res = await gateway.listSessions({ limit: 50 });
      setSessions(res.sessions || []);
    } catch (err) {
      console.error("[Sessions] Failed to load:", err);
    } finally {
      setSessionsLoading(false);
    }
  }, [gateway]);

  const handleNewSession = useCallback(
    (agentId?: string) => {
      // Reset old session on the gateway so Argent knows that thread is closed
      // (any pending questions in the old session are considered abandoned)
      if (gateway.connected) {
        gateway
          .resetSession(currentSessionKey)
          .catch((err) => console.warn("[Sessions] Failed to reset old session:", err));
      }
      const nextAgentId = normalizeAgentId(
        agentId,
        currentChatAgentId || primaryChatAgentId || DEFAULT_AGENT_ID,
      );
      const key = `agent:${nextAgentId}:webchat-${Date.now()}`;
      setCurrentSessionKey(key);
      setMessages([]);
      setStreamingContent("");
      setMessageQueue([]);
      setIsLoading(false);
      setActiveTool(null);
      setActiveModelInfo(null);
      setAvatarState("idle");
      setAvatarMood(undefined);
      addLog("info", "New session started", key);
    },
    [addLog, currentChatAgentId, gateway, currentSessionKey, primaryChatAgentId],
  );

  const handleChangeChatAgent = useCallback(
    (agentId: string) => {
      const targetAgentId = normalizeAgentId(
        agentId,
        primaryChatAgentId || currentChatAgentId || DEFAULT_AGENT_ID,
      );
      if (targetAgentId === currentChatAgentId) {
        return;
      }
      handleNewSession(targetAgentId);
    },
    [currentChatAgentId, handleNewSession, primaryChatAgentId],
  );

  // ── Slash Command Handler ──
  const handleCommand = useCallback(
    async (commandKey: string, args?: string) => {
      const addSystemMessage = (text: string) => {
        setMessages((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            role: "assistant",
            content: text,
            timestamp: new Date(),
          },
        ]);
      };

      switch (commandKey) {
        case "compact": {
          addSystemMessage("Compacting conversation context...");
          try {
            const result = await gateway.compactSession(currentSessionKey, args);
            if (result.compacted) {
              const before = result.tokensBefore
                ? `${Math.round(result.tokensBefore / 1000)}k`
                : "?";
              const after = result.tokensAfter ? `${Math.round(result.tokensAfter / 1000)}k` : "?";
              // Clear chat log and show just the compaction summary
              setMessages([
                {
                  id: `cmd-${Date.now()}`,
                  role: "assistant",
                  content: `Context compacted (${before} → ${after} tokens). Previous messages archived server-side.`,
                  timestamp: new Date(),
                },
              ]);
              // Refresh context usage bar
              gateway
                .getSessionTokens(currentSessionKey)
                .then(setContextUsage)
                .catch(() => {});
            } else {
              addSystemMessage(`Compaction skipped${result.reason ? `: ${result.reason}` : ""}`);
            }
          } catch (err) {
            addSystemMessage(
              `Compaction failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          break;
        }
        case "stop": {
          try {
            await gateway.stopCurrentRun(currentSessionKey);
            addSystemMessage("Stopped current run.");
          } catch (err) {
            addSystemMessage(`Stop failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }
        case "reset": {
          try {
            await gateway.resetSession(currentSessionKey);
            setMessages([]);
            addSystemMessage("Session reset.");
          } catch (err) {
            addSystemMessage(`Reset failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }
        case "new": {
          handleNewSession();
          break;
        }
        default: {
          // For unhandled commands, send through the agent as text
          const cmd = slashCommands.find((c) => c.key === commandKey);
          const alias = cmd?.aliases[0] || `/${commandKey}`;
          const message = args ? `${alias} ${args}` : alias;
          handleSendMessage(message);
        }
      }
    },
    [gateway, currentSessionKey, handleSendMessage, handleNewSession, slashCommands],
  );

  const handleSelectSession = useCallback(
    async (sessionKey: string) => {
      const canonicalSessionKey = canonicalizeSessionKey(sessionKey);
      if (canonicalSessionKey === currentSessionKey) return;

      // Save current messages before switching
      if (messages.length > 0) {
        saveMessages(messages, currentSessionKey);
      }

      setCurrentSessionKey(canonicalSessionKey);
      setStreamingContent("");
      setMessageQueue([]);
      setIsLoading(false);
      setActiveTool(null);
      setActiveModelInfo(null);
      setAvatarState("idle");
      setAvatarMood(undefined);

      // Update context usage from sessions list (fast), then refresh from server
      const sessionData = sessions.find(
        (s) => canonicalizeSessionKey(s.key) === canonicalSessionKey,
      );
      if (sessionData?.totalTokens) {
        setContextUsage({
          used: sessionData.totalTokens,
          total: sessionData.contextTokens ?? 200_000,
          estimated: false,
        });
      } else {
        setContextUsage({ used: 0, total: 200_000, estimated: false });
      }
      gateway
        .getSessionTokens(canonicalSessionKey)
        .then(setContextUsage)
        .catch(() => {});

      // Try to load from localStorage first (fast)
      const cached = loadStoredMessages(canonicalSessionKey);
      if (cached.length > 0) {
        setMessages(cached);
      } else {
        setMessages([]);
      }

      // Then fetch from server to get full history
      if (gateway.connected) {
        try {
          const res = await gateway.getSessionHistory(canonicalSessionKey, 50);
          if (res.messages && res.messages.length > 0) {
            const serverMessages: ChatMessage[] = res.messages.map((m, i) => ({
              id: `hist-${m.timestamp}-${i}`,
              role: m.role,
              content: stripTtsControlMarkers(
                m.content
                  .map((c) => c.text || "")
                  .join("")
                  .replace(/\[MOOD:[^\]]+\]/g, "")
                  .replace(/\[TASK[^\]]*\]/g, "")
                  .replace(/\[TTS_NOW:[^\]]+\]/g, "")
                  .replace(/\[TTS:[^\]]+\]/g, "")
                  .replace(/\[ALERT[^\]]*\]/g, "")
                  .replace(/\[APP:[^\]]+\]/g, "")
                  .replace(/MEDIA:[^\s\n]+/gi, ""),
              ).trim(),
              timestamp: new Date(m.timestamp),
            }));
            setMessages(serverMessages);
          }
        } catch (err) {
          console.error("[Sessions] Failed to load history:", err);
          // Keep cached messages
        }
      }

      addLog("info", "Switched session", canonicalSessionKey);
    },
    [addLog, canonicalizeSessionKey, currentSessionKey, gateway, messages, sessions],
  );

  const handleDeleteSession = useCallback(
    async (sessionKey: string) => {
      if (!gateway.connected) return;
      try {
        await gateway.deleteSession(sessionKey);
        // Remove from local list
        setSessions((prev) => prev.filter((s) => s.key !== sessionKey));
        // Clear local storage for this session
        localStorage.removeItem(storageKey(sessionKey));
        addLog("info", "Session deleted", sessionKey);
      } catch (err) {
        console.error("[Sessions] Failed to delete:", err);
      }
    },
    [gateway, addLog],
  );

  // Interrupt handler: server-side abort + optionally send new message immediately
  const handleInterrupt = useCallback(
    async (message: string) => {
      // Stop TTS if speaking
      stopActiveSpeech();
      // Server-side abort (also cleans up client-side stream)
      await gateway.stopCurrentRun(currentSessionKey);
      // Mark current response as done (partial)
      setIsLoading(false);
      setActiveTool(null);
      setActiveModelInfo(null);
      setAvatarState("idle");
      // If a message was provided, send it immediately (bypassing queue)
      if (message.trim()) {
        // Clear the queue — user explicitly chose to stop and send this message
        setMessageQueue([]);
        setTimeout(() => handleSendMessage(message), 50);
      } else {
        // No new message — drain queue if there are pending messages
        setMessageQueue((prev) => {
          if (prev.length > 0) {
            const [next, ...rest] = prev;
            setTimeout(() => handleSendMessage(next.content, next.image, next.attachments), 50);
            return rest;
          }
          return prev;
        });
      }
    },
    [stopActiveSpeech, gateway, handleSendMessage, currentSessionKey],
  );

  const handleReplayTtsSummary = useCallback(
    (summary: string, audioUrl?: string) => {
      const cleanedSummary = stripTtsControlMarkers(summary).trim();
      if (!cleanedSummary && !audioUrl) return;

      stopActiveSpeech();
      if (audioUrl) {
        void tts.playUrl(audioUrl);
        return;
      }

      void tts.speak(cleanedSummary, avatarMood);
    },
    [avatarMood, stopActiveSpeech, tts],
  );

  // Keep ref updated for speech recognition callback
  useEffect(() => {
    sendMessageRef.current = handleSendMessage;
  }, [handleSendMessage]);

  useEffect(() => {
    window.__argentNativeSendMessage = (content: string) => {
      const text = typeof content === "string" ? content.trim() : "";
      if (!text) {
        return { ok: false, error: "empty-content" };
      }
      void sendMessageRef.current(text);
      return { ok: true, sessionKey: currentSessionKey };
    };

    return () => {
      delete window.__argentNativeSendMessage;
    };
  }, [currentSessionKey]);

  // Fetch custom nudges on mount
  useEffect(() => {
    fetchLocalApi("/api/settings/nudges")
      .then((r) => r.json())
      .then((data) => {
        setCustomNudges(data.nudges || []);
        setNudgesGlobalEnabled(data.globalEnabled !== false);
      })
      .catch((err) => console.error("[Nudges] Failed to fetch:", err));
  }, []);

  // Idle nudge — when user walks away, send agent a random activity
  // Disable nudges while lock screen is active or if globally disabled
  useIdleNudge({
    idleThresholdMs: 2 * 60 * 1000, // 2 minutes
    nudgeCooldownMs: 5 * 60 * 1000, // 5 minutes between nudges
    enabled: gateway.connected && !lockScreen.isLocked && nudgesGlobalEnabled,
    nudges: customNudges,
    onNudge: (activity) => {
      console.log("[Nudge] User idle — nudging agent:", activity.label);
      addLog("info", `Idle nudge: ${activity.label}`);

      // Speak nudge if TTS enabled for this activity
      // @ts-ignore - ttsEnabled may not exist on default nudges
      if (activity.ttsEnabled !== false && tts.enabled) {
        tts.speak(`Working on: ${activity.label}`);
      }

      // Silent delivery — no user bubble in chat, agent response appears naturally
      sendMessageRef.current(`[NUDGE] ${activity.prompt}`, undefined, undefined, { silent: true });
    },
  });

  // Cmd+L to lock the dashboard (only when a key is registered)
  useEffect(() => {
    const handleLockShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        if (lockScreen.hasCredentials && !lockScreen.isLocked) {
          e.preventDefault();
          lockScreen.lock();
        }
      }
    };
    window.addEventListener("keydown", handleLockShortcut);
    return () => window.removeEventListener("keydown", handleLockShortcut);
  }, [lockScreen]);

  // Canvas action handlers
  const handleCanvasSaveAsPDF = useCallback(
    (doc: CanvasDocument) => {
      // Send to agent to handle PDF generation
      sendMessageRef.current(`Generate PDF from canvas document: ${doc.title}`);
      addLog("info", "PDF generation requested", doc.title);
    },
    [addLog],
  );

  const handleCanvasSaveAsDoc = useCallback(
    (doc: CanvasDocument) => {
      // Send to agent to handle .docx conversion
      sendMessageRef.current(`Convert canvas document to Word: ${doc.title}`);
      addLog("info", "Word doc conversion requested", doc.title);
    },
    [addLog],
  );

  const handleCanvasEmail = useCallback(
    (doc: CanvasDocument) => {
      // Send to agent to handle email
      sendMessageRef.current(`Email canvas document: ${doc.title}`);
      addLog("info", "Email requested", doc.title);
    },
    [addLog],
  );

  const handleDeleteDocument = useCallback(
    (docId: string, deleteMedia: boolean) => {
      setCanvasDocuments((prev) => {
        const remaining = prev.filter((d) => d.id !== docId);
        // If we deleted the active doc, switch to another
        if (activeCanvasDocId === docId && remaining.length > 0) {
          setActiveCanvasDocId(remaining[0].id);
        }
        // If no docs remain, close the panel
        if (remaining.length === 0) {
          handleCanvasClose();
        }
        return remaining;
      });

      if (deleteMedia) {
        // Find media file paths in the document content and delete them
        const doc = canvasDocuments.find((d) => d.id === docId);
        if (doc) {
          // Extract local file paths from markdown content
          const pathRegex =
            /(\/(?:var|tmp|Users)\/[^\s"')\]]+\.(?:mp4|webm|mov|mp3|wav|ogg|m4a|png|jpg|jpeg|gif|webp))/g;
          const paths = [...doc.content.matchAll(pathRegex)].map((m) => m[1]);
          if (paths.length > 0) {
            // Ask the API server to clean up media files
            fetchLocalApi("/api/media/cleanup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paths }),
            }).catch((err) => console.warn("[Canvas] Media cleanup failed:", err));
          }
        }
      }

      addLog("info", "Document deleted", `deleteMedia: ${deleteMedia}`);
    },
    [activeCanvasDocId, canvasDocuments, handleCanvasClose, addLog],
  );

  // Expose canvas functions globally
  useEffect(() => {
    (window as any).argentCanvas = {
      open: handleCanvasOpen,
      close: handleCanvasClose,
      push: pushToCanvas,
      isOpen: canvasOpen,
      documents: canvasDocuments,
      clearAll: () => setCanvasDocuments([]),
    };
  }, [canvasOpen, canvasDocuments, handleCanvasOpen, handleCanvasClose]);

  // Listen for canvas events via SSE from the API server
  useEffect(() => {
    console.log("[Canvas SSE] Connecting to /api/canvas/events");
    const eventSource = new EventSource("/api/canvas/events");

    eventSource.onopen = () => {
      console.log("[Canvas SSE] Connected");
    };

    eventSource.onmessage = (event) => {
      try {
        if (!event.data) return;
        const data = JSON.parse(event.data);
        console.log("[Canvas SSE] Received:", data);

        if (
          (data.type === "document_saved" || data.type === "document_opened") &&
          data.action === "push" &&
          data.document
        ) {
          const doc = data.document;
          console.log("[Canvas SSE] Opening canvas for:", doc.title);
          pushToCanvas(
            doc.title,
            doc.content,
            doc.type || "markdown",
            doc.language,
            undefined,
            doc.id,
            doc.createdAt || doc.created_at,
          );
        }
      } catch (err) {
        console.error("[Canvas SSE] Parse error:", err);
      }
    };

    eventSource.onerror = (err) => {
      // EventSource auto-reconnects; CONNECTING is expected during transient drops.
      if (eventSource.readyState === EventSource.CONNECTING) {
        console.warn("[Canvas SSE] Reconnecting...");
        return;
      }
      if (eventSource.readyState === EventSource.CLOSED) {
        console.warn("[Canvas SSE] Closed");
        return;
      }
      console.error("[Canvas SSE] Error:", err);
    };

    return () => {
      console.log("[Canvas SSE] Disconnecting");
      eventSource.close();
    };
  }, []);

  // Listen for canvas events from gateway (when agent creates documents)
  useEffect(() => {
    if (!gateway.connected) return;

    // Listen for dedicated 'canvas' events (from dashboard.canvas.push gateway method)
    const unsubCanvas = gateway.on("canvas", (payload: unknown) => {
      const event = payload as {
        action?: string;
        title?: string;
        content?: string;
        type?: string;
        language?: string;
      };

      console.log("[Canvas] Received gateway canvas event:", event);

      if (event.action === "push" && event.title && event.content) {
        pushToCanvas(event.title, event.content, (event.type as any) || "markdown", event.language);
      }
    });

    // Also listen for agent events with stream: "canvas" (alternative mechanism)
    const unsubAgent = gateway.on("agent", (payload: unknown) => {
      const event = payload as {
        stream?: string;
        type?: string;
        tool?: string;
        result?: {
          success?: boolean;
          title?: string;
          content?: string;
          type?: string;
          language?: string;
          documentId?: string;
        };
        data?: {
          action?: string;
          title?: string;
          content?: string;
          type?: string;
          language?: string;
        };
      };

      // Handle canvas stream events
      if (event.stream === "canvas") {
        console.log("[Canvas] Received agent canvas stream event:", event);
        const data = event.data;
        if (data?.action === "push" && data?.title && data?.content) {
          pushToCanvas(data.title, data.content, (data.type as any) || "markdown", data.language);
        }
        return;
      }

      // Handle doc_panel tool results (also accept legacy dashboard_canvas)
      if (
        event.type === "tool_result" &&
        (event.tool === "doc_panel" || event.tool === "dashboard_canvas")
      ) {
        console.log("[DocPanel] Received doc_panel tool result:", event);
        const result = event.result;
        if (result?.success && result?.title && result?.content) {
          pushToCanvas(
            result.title,
            result.content,
            (result.type as any) || "markdown",
            result.language,
            undefined,
            result.documentId,
          );
        }
        return;
      }
    });

    return () => {
      unsubCanvas();
      unsubAgent();
    };
  }, [gateway.connected, gateway.on]);

  return (
    <div className="h-screen p-4 flex flex-col gap-4 overflow-hidden">
      {/* AEVP climate overlay — subtle ambient glow from emotional state */}
      <div
        className="aevp-climate-overlay"
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(var(--aevp-glow-color, 0,0,0), var(--aevp-glow-opacity, 0)) 0%, transparent 70%)",
          transition: "all 3s ease",
        }}
      />
      {/* Status Bar */}
      <div className="flex-shrink-0">
        <StatusBar
          alertCount={unreadCount}
          nextEvent={nextEvent || "No upcoming events"}
          weather={weather || "72°F Clear"}
          connected={gateway.connected}
          onWeatherClick={() => setWeatherModalOpen(true)}
          onCalendarClick={() => setCalendarModalOpen(true)}
          onAlertsClick={() => setAlertsModalOpen(true)}
          onActivityClick={() => setActivityPanelOpen(!activityPanelOpen)}
          onAppsClick={() => setAppForgeOpen(true)}
          onWorkforceClick={
            isOperationsDashboard
              ? (focus) => {
                  setShowBoard(false);
                  setWorkforceFocus(focus ?? "all");
                  setShowWorkforce(true);
                }
              : undefined
          }
          workforceDueCount={isOperationsDashboard ? workforceBadge.dueNow : 0}
          workforceBlockedCount={isOperationsDashboard ? workforceBadge.blocked : 0}
          onNewWorkerClick={isOperationsDashboard ? () => setWorkerFlowOpen(true) : undefined}
          onSettingsClick={() => setConfigPanelOpen(true)}
          onLockClick={lockScreen.lock}
          canLock={lockScreen.hasCredentials}
          onZoomChange={(preset, customScale) => {
            setAvatarZoom(preset);
            if (preset === "custom" && customScale) {
              setAvatarCustomZoom(customScale);
            }
          }}
          currentZoom={avatarZoom}
          currentBackground={currentBackgroundMode}
          pollingEnabled={backgroundPollingEnabled}
        />
      </div>

      {/* Workspace tabs */}
      <div className="flex-shrink-0 flex items-center gap-1 px-1">
        {workspaceTabs.map((ws) => (
          <button
            key={ws.id}
            onClick={() => {
              setActiveWorkspace(ws.id);
              if (ws.id === "operations") setDashboardMode("operations");
              else setDashboardMode("personal");
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeWorkspace === ws.id
                ? "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] border border-[hsl(var(--primary))]/30 shadow-[0_0_6px_hsl(var(--primary)/0.15)]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--card))]"
            }`}
          >
            {ws.id === "home" ? (
              <HomeIcon size={16} />
            ) : ws.id === "operations" ? (
              <OperationsIcon size={16} />
            ) : (
              ws.icon
            )}{" "}
            {ws.name}
          </button>
        ))}
        <button
          onClick={() => {
            const name = prompt("Workspace name:");
            if (!name?.trim()) return;
            const id = `ws-${Date.now()}`;
            setWorkspaceTabs((prev) => [...prev, { id, name: name.trim(), icon: "📋" }]);
            setActiveWorkspace(id);
            setDashboardMode("personal");
          }}
          className="px-2 py-1.5 rounded-lg text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--card))] transition-colors"
        >
          +
        </button>
      </div>

      {/* Main Content */}
      {isOperationsDashboard && activeWorkspace === "operations" ? (
        /* Operations workspace — sub-nav tabs */
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Sub-nav */}
          <div className="flex-shrink-0 flex items-center gap-1 px-4 py-1.5 border-b border-[hsl(var(--border))]">
            {(() => {
              const OPS_TAB_ICONS: Record<string, React.ReactNode> = {
                map: <WorkflowMapIcon size={16} />,
                workflows: <WorkflowsIcon size={16} />,
                jobs: <WorkloadsIcon size={16} />,
                tasks: <TaskManagerIcon size={16} />,
                org: <OrgChartIcon size={16} />,
                schedule: <ScheduleIcon size={16} />,
              };
              return (
                [
                  { id: "map", label: "Workflow Map" },
                  { id: "workflows", label: "Workflows" },
                  { id: "jobs", label: "Workloads" },
                  { id: "tasks", label: "Task Manager" },
                  { id: "org", label: "Org Chart" },
                  { id: "schedule", label: "Schedule" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setOpsView(tab.id)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                    opsView === tab.id
                      ? "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]"
                      : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  }`}
                >
                  {OPS_TAB_ICONS[tab.id]} {tab.label}
                </button>
              ));
            })()}
          </div>

          {/* Tab content */}
          {opsView === "map" ? (
            <div className="flex-1 min-h-0 relative">
              <WorkflowMapCanvas
                agentName={
                  chatAgentOptions.find(
                    (a: { id: string; label: string }) => a.id === currentChatAgentId,
                  )?.label ||
                  currentChatAgentId ||
                  "Agent"
                }
                connected={gateway.connected}
                agentStatus={gateway.connected ? "Connected" : "Offline"}
                gatewayRequest={gateway.request}
              />
            </div>
          ) : opsView === "workflows" ? (
            <div className="flex-1 min-h-0 relative flex">
              <WorkflowsWidget />
            </div>
          ) : opsView === "jobs" ? (
            <div className="flex-1 min-h-0 overflow-auto p-4">
              <EmptyWidget />
            </div>
          ) : opsView === "tasks" ? (
            <div className="flex-1 min-h-0 overflow-auto p-4">
              <TaskManagerWidget />
            </div>
          ) : opsView === "org" ? (
            <div className="flex-1 min-h-0 overflow-auto p-4">
              <EmptyWidget />
            </div>
          ) : opsView === "schedule" ? (
            <div className="flex-1 min-h-0 overflow-auto p-4">
              <ScheduleWidget />
            </div>
          ) : null}
        </div>
      ) : isOperationsDashboard ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Operations sub-nav: switch between Map and Workers (Business only) */}
          {activeWorkspace === "operations" && (
            <div className="flex-shrink-0 flex items-center gap-1 px-4 py-1.5 border-b border-[hsl(var(--border))]">
              <button
                onClick={() => {
                  setOpsView("map");
                  setDashboardMode("operations");
                }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${opsView === "map" ? "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"}`}
              >
                <WorkflowMapIcon size={16} /> Workflow Map
              </button>
              <button
                onClick={() => setOpsView("workers")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${opsView === "workers" ? "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"}`}
              >
                <WorkersIcon size={16} /> Workers
              </button>
            </div>
          )}
          <div className="flex-1 grid min-h-0 grid-cols-12 gap-4 overflow-hidden">
            <div className="col-span-4 flex min-h-0 flex-col gap-4 overflow-hidden">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
                  Operations Console
                </div>
                <div className="mt-1 text-sm text-white/70">
                  This mode is for business execution. Operator tasks, worker tasks, schedules, and
                  project lanes are surfaced here without the personal widget desktop.
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <TaskList
                  tasks={tasks}
                  workerTasks={workerTasks}
                  projects={projects}
                  showWorkerLane={true}
                  cronJobs={cronJobs}
                  cronFormatSchedule={cronFormatSchedule}
                  cronGetNextRun={cronGetNextRun}
                  onCronJobUpdate={updateCronJob}
                  onCronJobDelete={deleteCronJob}
                  onCronJobRun={runCronJob}
                  onTaskAdd={addTask}
                  onTaskDelete={deleteTask}
                  onTaskEdit={editTask}
                  onTaskExecute={executeTask}
                  onProjectDelete={deleteProject}
                  onProjectTaskAdd={addProjectTask}
                  onProjectKickoff={() => setShowProjectKickoffModal(true)}
                  onOpenBoard={() => {
                    setShowWorkforce(false);
                    setShowBoard(true);
                  }}
                  showBoard={showBoard}
                />
              </div>
            </div>
            <div className="col-span-8 flex min-h-0 flex-col gap-4 overflow-hidden">
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <button
                  onClick={() => {
                    setShowBoard(false);
                    setWorkforceFocus("all");
                    setShowWorkforce(true);
                  }}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    showWorkforce
                      ? "border-cyan-300/40 bg-cyan-500/10 text-cyan-100"
                      : "border-white/15 text-white/70 hover:text-white"
                  }`}
                >
                  Workforce
                </button>
                <button
                  onClick={() => {
                    setShowWorkforce(false);
                    setShowBoard(true);
                  }}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    showBoard
                      ? "border-purple-300/40 bg-purple-500/10 text-purple-100"
                      : "border-white/15 text-white/70 hover:text-white"
                  }`}
                >
                  Project Board
                </button>
                <button
                  onClick={() => setOperationsChatOpen((open) => !open)}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    operationsChatOpen
                      ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                      : "border-white/15 text-white/70 hover:text-white"
                  }`}
                >
                  Chat
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {showBoard ? (
                  <ProjectBoard
                    tasks={tasks}
                    projects={projects}
                    onTaskUpdate={editTaskFull}
                    onTaskDelete={(id) => deleteTask(id)}
                    onTaskAdd={addTask}
                    onTaskStart={(id) => startTask(id)}
                    onTaskComplete={(id) => completeTask(id)}
                    onClose={() => setShowBoard(false)}
                  />
                ) : (
                  <WorkforceBoard
                    gatewayRequest={gateway.request}
                    focus={workforceFocus}
                    onClose={() => setShowWorkforce(false)}
                  />
                )}
              </div>
            </div>
          </div>
          ) : showWorkforce && allowWorkforceSurface ? (
          <div className="flex-1 min-h-0 relative">
            <WorkforceBoard
              gatewayRequest={gateway.request}
              focus={workforceFocus}
              onClose={() => setShowWorkforce(false)}
            />
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 flex min-h-0 relative gap-0">
          {/* ── Left Panel: Tasks + Memory ── */}
          <div
            className="flex flex-col gap-3 min-h-0 overflow-hidden px-2"
            style={{ width: `${colWidths[0]}%` }}
          >
            <div className="flex-1 min-h-0 overflow-hidden">
              <TaskList
                tasks={tasks}
                workerTasks={workerTasks}
                projects={projects}
                showWorkerLane={false}
                cronJobs={cronJobs}
                cronFormatSchedule={cronFormatSchedule}
                cronGetNextRun={cronGetNextRun}
                onCronJobUpdate={updateCronJob}
                onCronJobDelete={deleteCronJob}
                onCronJobRun={runCronJob}
                onTaskAdd={addTask}
                onTaskDelete={deleteTask}
                onTaskEdit={editTask}
                onTaskExecute={executeTask}
                onProjectDelete={deleteProject}
                onProjectTaskAdd={addProjectTask}
                onProjectKickoff={
                  allowWorkforceSurface ? () => setShowProjectKickoffModal(true) : undefined
                }
                onOpenBoard={() => {
                  setShowWorkforce(false);
                  setShowBoard(true);
                }}
                showBoard={showBoard}
              />
            </div>

            {/* Memory stats — wired to /api/memory/stats */}
            <MemoryStatsCards />

            {/* Project Board toggle */}
            <div className="flex-shrink-0">
              <button
                onClick={() => {
                  setShowWorkforce(false);
                  setShowBoard((prev) => !prev);
                }}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                  showBoard
                    ? "border-[hsl(var(--primary))]/50 text-[hsl(var(--primary))] bg-[hsl(var(--primary))]/15 shadow-[0_0_8px_hsl(var(--primary)/0.2)]"
                    : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--muted-foreground))]/30"
                }`}
              >
                Project Board
              </button>
            </div>
          </div>
          {/* Drag handle: tasks ↔ center */}
          <div
            className="w-1 cursor-col-resize hover:bg-[hsl(var(--primary))]/30 active:bg-[hsl(var(--primary))]/50 transition-colors flex-shrink-0 relative group"
            onMouseDown={(e) => handleColDrag(0, e)}
          >
            {draggingCol === 0 && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-1 rounded bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-[10px] text-[hsl(var(--primary))] font-mono whitespace-nowrap z-50">
                {Math.round(colWidths[0])}% | {Math.round(colWidths[1])}%
              </div>
            )}
          </div>

          {/* ── Center + Right: Board OR Avatar+Chat ── */}
          {showBoard ? (
            <div className="flex-1 overflow-hidden">
              <ProjectBoard
                tasks={tasks}
                projects={projects}
                onTaskUpdate={editTaskFull}
                onTaskDelete={(id) => deleteTask(id)}
                onTaskAdd={addTask}
                onTaskStart={(id) => startTask(id)}
                onTaskComplete={(id) => completeTask(id)}
                onClose={() => setShowBoard(false)}
              />
            </div>
          ) : (
            <>
              {/* ── Center: Avatar + Stats + Quick Access ── */}
              <div
                className="relative overflow-hidden flex flex-col items-center justify-end pb-4"
                style={{
                  width: chatCollapsed ? `${colWidths[1] + colWidths[2]}%` : `${colWidths[1]}%`,
                }}
              >
                {/* Avatar area — fill center, minimum 60% height */}
                <div className="relative flex-1 w-full min-h-[60%] flex items-center justify-center z-20">
                  {avatarRenderer !== "aevp" && <AvatarBackground />}

                  {!avatarPreviewActive &&
                    (avatarRenderer === "aevp" ? (
                      <AEVPPresence
                        fill
                        orbCenterY={AEVP_FULL_ORB_CENTER_Y}
                        agentState={agentState}
                        identity={visualIdentity}
                        accessibilityConfig={accessibilityConfig}
                        onPreSpeechCueReady={(fn) => {
                          preSpeechCueRef.current = fn;
                        }}
                        onAmplitudeTargetReady={(fn) => {
                          rendererAmplitudeSetterRef.current = fn;
                        }}
                      />
                    ) : (
                      <Live2DAvatar
                        state={avatarState}
                        mood={avatarMood}
                        width={450}
                        height={750}
                        mode="full"
                        zoomPreset={avatarZoom}
                        customZoom={avatarCustomZoom}
                        debugPresets={debugZoomPresets}
                      />
                    ))}
                </div>

                {/* Agent name + status — follows chat agent selector, never hardcoded */}
                <div className="text-center mt-2 mb-3 z-30 relative">
                  <div className="text-xl font-semibold text-[hsl(var(--foreground))]">
                    {chatAgentOptions.find((a) => a.id === currentChatAgentId)?.label ||
                      currentChatAgentId ||
                      "Agent"}
                  </div>
                  <div className="text-sm text-[hsl(var(--muted-foreground))]">
                    {gateway.connected
                      ? avatarState === "thinking"
                        ? "Thinking..."
                        : avatarState === "working"
                          ? "Working..."
                          : avatarState === "speaking"
                            ? "Speaking..."
                            : "Connected"
                      : gateway.connecting
                        ? "Connecting..."
                        : "Offline"}
                  </div>
                </div>

                {/* Stat cards — wired to real data where available */}
                <div className="flex gap-2 mb-3 z-30 relative">
                  {[
                    {
                      value: agentState.pendingApprovals ?? 0,
                      label: "Approvals",
                      color: agentState.pendingApprovals
                        ? "text-amber-400"
                        : "text-[hsl(var(--muted-foreground))]",
                      urgent: (agentState.pendingApprovals ?? 0) > 0,
                    },
                    {
                      value:
                        tasks.filter((t) => t.status === "in_progress" || t.status === "active")
                          .length || (gateway.connected ? 1 : 0),
                      label: "Active",
                      color: "text-[hsl(var(--primary))]",
                      urgent: false,
                    },
                    {
                      value: tasks.filter(
                        (t) =>
                          t.status === "overdue" ||
                          (t.dueDate &&
                            new Date(t.dueDate) < new Date() &&
                            t.status !== "completed"),
                      ).length,
                      label: "Overdue",
                      color: agentState.overdueTasks ? "text-red-400" : "text-emerald-400",
                      urgent: (agentState.overdueTasks ?? 0) > 0,
                    },
                    {
                      value: agentState.errorCount ?? 0,
                      label: "Errors",
                      color: agentState.errorCount
                        ? "text-red-400"
                        : "text-[hsl(var(--muted-foreground))]",
                      urgent: (agentState.errorCount ?? 0) > 0,
                    },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className={`px-4 py-2 rounded-lg border text-center min-w-[70px] transition-colors ${
                        stat.urgent
                          ? "bg-red-500/5 border-red-500/30"
                          : "bg-[hsl(var(--card))] border-[hsl(var(--border))]"
                      }`}
                    >
                      <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
                      <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Quick access — action verbs only, no settings duplicate */}
                <div className="flex gap-2 z-30 relative">
                  <button
                    onClick={() => {
                      setConfigPanelRequestedTab("safety");
                      setConfigPanelOpen(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/30 transition-colors"
                  >
                    <ShieldIcon size={20} />
                    <div className="text-left">
                      <div className="text-xs font-medium text-[hsl(var(--foreground))]">
                        Safety Rules
                      </div>
                      <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                        Configure
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => handleCanvasOpen()}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/30 transition-colors"
                  >
                    <DocumentsIcon size={20} />
                    <div className="text-left">
                      <div className="text-xs font-medium text-[hsl(var(--foreground))]">
                        Documents
                      </div>
                      <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                        {canvasDocuments.length} docs
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Drag handle: center ↔ chat */}
              {!chatCollapsed && (
                <div
                  className="w-1 cursor-col-resize hover:bg-[hsl(var(--primary))]/30 active:bg-[hsl(var(--primary))]/50 transition-colors flex-shrink-0 relative group"
                  onMouseDown={(e) => handleColDrag(1, e)}
                >
                  {draggingCol === 1 && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-1 rounded bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-[10px] text-[hsl(var(--primary))] font-mono whitespace-nowrap z-50">
                      {Math.round(colWidths[1])}% | {Math.round(colWidths[2])}%
                    </div>
                  )}
                </div>
              )}
              {/* Right Panel - Chat */}
              {!chatCollapsed && (
                <div
                  className="overflow-hidden relative z-40"
                  style={{ width: `${colWidths[2]}%` }}
                >
                  <ChatPanel
                    messages={messages}
                    onSend={handleSendMessage}
                    onCommand={handleCommand}
                    commands={slashCommands}
                    isLoading={isLoading}
                    activeTool={activeTool}
                    activeModelInfo={activeModelInfo}
                    onToggleSessions={() => setSessionDrawerOpen(true)}
                    onNewChat={handleNewSession}
                    chatAgentId={currentChatAgentId}
                    chatAgentOptions={chatAgentOptions}
                    onChangeChatAgent={handleChangeChatAgent}
                    sessionTitle={
                      sessions.find((s) => s.key === currentSessionKey)?.label ||
                      sessions.find((s) => s.key === currentSessionKey)?.displayName ||
                      (currentSessionKey === gateway.mainSessionKey ? "Chat" : undefined)
                    }
                    audioEnabled={audioEnabled}
                    onToggleAudio={handleToggleAudio}
                    ttsDisplayMode={ttsDisplayMode}
                    onCycleTtsDisplayMode={cycleTtsDisplayMode}
                    micEnabled={micEnabled}
                    onToggleMic={handleToggleMic}
                    isListening={effectiveIsListening}
                    isProcessingSpeech={speech.isProcessing}
                    speechError={effectiveSpeechError}
                    deepThinkMode={deepThinkMode}
                    onToggleDeepThink={() => setDeepThinkMode(!deepThinkMode)}
                    deepResearchMode={deepResearchMode}
                    onToggleDeepResearch={() => setDeepResearchMode(!deepResearchMode)}
                    canvasOpen={canvasOpen}
                    onToggleCanvas={() => (canvasOpen ? handleCanvasClose() : handleCanvasOpen())}
                    selectedInput={inputDeviceId}
                    selectedOutput={outputDeviceId}
                    selectedVoice={selectedVoice}
                    activeVoiceLabel={currentAgentTtsProfile?.label}
                    voiceSelectionLocked={Boolean(currentAgentTtsProfile?.lockVoiceSelection)}
                    onInputChange={setInputDeviceId}
                    onOutputChange={setOutputDeviceId}
                    onVoiceChange={setSelectedVoice}
                    isSpeaking={effectiveIsSpeaking}
                    onStopTTS={stopActiveSpeech}
                    onReplayTTSSummary={handleReplayTtsSummary}
                    onInterrupt={handleInterrupt}
                    onSteer={handleSteerMessage}
                    busyMode={busyMessageMode}
                    onBusyModeChange={setBusyMessageMode}
                    onQueue={handleQueueMessage}
                    queuedMessages={messageQueue}
                    onDequeue={handleDequeueMessage}
                    onFeedback={handleFeedback}
                    focusDoc={
                      canvasOpen && activeCanvasDocId
                        ? (() => {
                            const doc = canvasDocuments.find((d) => d.id === activeCanvasDocId);
                            return doc ? { id: doc.id, title: doc.title } : null;
                          })()
                        : null
                    }
                    onClearFocus={() => setActiveCanvasDocId(undefined)}
                    onToggleCollapse={() => setChatCollapsed(true)}
                    contextUsage={contextUsage}
                    gatewayRequest={gateway.request}
                    currentSessionKey={currentSessionKey}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {isOperationsDashboard && (
        <div
          className={`fixed inset-0 z-[70] transition-opacity duration-200 ${
            operationsChatOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div
            className="absolute inset-0 bg-black/35"
            onClick={() => setOperationsChatOpen(false)}
          />
          <div
            className={`absolute right-4 top-40 bottom-4 w-[460px] max-w-[calc(100vw-2rem)] transform transition-transform duration-300 ${
              operationsChatOpen ? "translate-x-0" : "translate-x-[110%]"
            }`}
          >
            <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-gray-950/95 shadow-2xl backdrop-blur">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">
                    Operations Drawer
                  </div>
                  <div className="text-sm font-medium text-white/80">Shared chat</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOperationsPresenceVisible((visible) => !visible)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      operationsPresenceVisible
                        ? "border-cyan-300/40 bg-cyan-500/10 text-cyan-100"
                        : "border-white/15 text-white/70 hover:text-white"
                    }`}
                  >
                    Presence
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1">
                <ChatPanel
                  messages={messages}
                  onSend={handleSendMessage}
                  onCommand={handleCommand}
                  commands={slashCommands}
                  isLoading={isLoading}
                  activeTool={activeTool}
                  activeModelInfo={activeModelInfo}
                  onToggleSessions={() => setSessionDrawerOpen(true)}
                  onNewChat={handleNewSession}
                  chatAgentId={currentChatAgentId}
                  chatAgentOptions={chatAgentOptions}
                  onChangeChatAgent={handleChangeChatAgent}
                  sessionTitle={
                    sessions.find((s) => s.key === currentSessionKey)?.label ||
                    sessions.find((s) => s.key === currentSessionKey)?.displayName ||
                    (currentSessionKey === gateway.mainSessionKey ? "Chat" : undefined)
                  }
                  audioEnabled={audioEnabled}
                  onToggleAudio={handleToggleAudio}
                  ttsDisplayMode={ttsDisplayMode}
                  onCycleTtsDisplayMode={cycleTtsDisplayMode}
                  micEnabled={micEnabled}
                  onToggleMic={handleToggleMic}
                  isListening={effectiveIsListening}
                  isProcessingSpeech={speech.isProcessing}
                  speechError={effectiveSpeechError}
                  deepThinkMode={deepThinkMode}
                  onToggleDeepThink={() => setDeepThinkMode(!deepThinkMode)}
                  deepResearchMode={deepResearchMode}
                  onToggleDeepResearch={() => setDeepResearchMode(!deepResearchMode)}
                  canvasOpen={canvasOpen}
                  onToggleCanvas={() => (canvasOpen ? handleCanvasClose() : handleCanvasOpen())}
                  selectedInput={inputDeviceId}
                  selectedOutput={outputDeviceId}
                  selectedVoice={selectedVoice}
                  activeVoiceLabel={currentAgentTtsProfile?.label}
                  voiceSelectionLocked={Boolean(currentAgentTtsProfile?.lockVoiceSelection)}
                  onInputChange={setInputDeviceId}
                  onOutputChange={setOutputDeviceId}
                  onVoiceChange={setSelectedVoice}
                  isSpeaking={effectiveIsSpeaking}
                  onStopTTS={stopActiveSpeech}
                  onReplayTTSSummary={handleReplayTtsSummary}
                  onInterrupt={handleInterrupt}
                  onSteer={handleSteerMessage}
                  busyMode={busyMessageMode}
                  onBusyModeChange={setBusyMessageMode}
                  onQueue={handleQueueMessage}
                  queuedMessages={messageQueue}
                  onDequeue={handleDequeueMessage}
                  onFeedback={handleFeedback}
                  focusDoc={
                    canvasOpen && activeCanvasDocId
                      ? (() => {
                          const doc = canvasDocuments.find((d) => d.id === activeCanvasDocId);
                          return doc ? { id: doc.id, title: doc.title } : null;
                        })()
                      : null
                  }
                  onClearFocus={() => setActiveCanvasDocId(undefined)}
                  onToggleCollapse={() => setOperationsChatOpen(false)}
                  contextUsage={contextUsage}
                  gatewayRequest={gateway.request}
                  currentSessionKey={currentSessionKey}
                />
              </div>
            </div>
          </div>

          {operationsPresenceVisible && (
            <div
              className="absolute z-30 w-[520px] overflow-hidden rounded-2xl border border-white/10 bg-[#070b16]/95 shadow-2xl backdrop-blur"
              style={{
                left: `${operationsPresencePosition.x}px`,
                top: `${operationsPresencePosition.y}px`,
                width: `${operationsPresenceSize.width}px`,
              }}
            >
              <div
                className="flex cursor-move items-center justify-between border-b border-white/10 px-4 py-3"
                onMouseDown={(event) => {
                  const rect = event.currentTarget.parentElement?.getBoundingClientRect();
                  if (!rect) return;
                  operationsPresenceDragRef.current = {
                    pointerOffsetX: event.clientX - rect.left,
                    pointerOffsetY: event.clientY - rect.top,
                  };
                }}
              >
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">
                    Presence
                  </div>
                  <div className="text-sm text-white/80">
                    {avatarRenderer === "aevp" ? "AEVP ambient mode" : "Live2D avatar"}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-white/55">
                    {avatarMood ? `${avatarState} • ${avatarMood}` : avatarState}
                  </div>
                  <button
                    onClick={() => {
                      setOperationsPresenceSize({
                        width: OPERATIONS_PRESENCE_DEFAULT_WIDTH,
                        height: OPERATIONS_PRESENCE_DEFAULT_HEIGHT,
                      });
                      setOperationsPresencePosition({
                        x: Math.max(24, window.innerWidth - 584),
                        y: 112,
                      });
                    }}
                    className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/60 transition-colors hover:text-white"
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => setOperationsPresenceVisible(false)}
                    className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/60 transition-colors hover:text-white"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div
                className="relative overflow-hidden bg-[#0a1020]"
                style={{ height: `${operationsPresenceSize.height - 80}px` }}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(170,130,255,0.12),transparent_60%)]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    className="relative overflow-hidden"
                    style={{
                      width: `${(operationsPresenceSize.width - 2) * OPERATIONS_PRESENCE_STAGE_SCALE}px`,
                      height: `${(operationsPresenceSize.height - 134) * OPERATIONS_PRESENCE_STAGE_SCALE}px`,
                    }}
                  >
                    {avatarRenderer === "aevp" ? (
                      <AEVPPresence
                        width={(operationsPresenceSize.width - 2) * OPERATIONS_PRESENCE_STAGE_SCALE}
                        height={
                          (operationsPresenceSize.height - 82) * OPERATIONS_PRESENCE_STAGE_SCALE
                        }
                        orbCenterY={AEVP_FULL_ORB_CENTER_Y}
                        presenceOffsetX={OPERATIONS_PRESENCE_LOCKED_OFFSET_X}
                        presenceOffsetY={OPERATIONS_PRESENCE_LOCKED_OFFSET_Y}
                        presenceScale={OPERATIONS_PRESENCE_LOCKED_SCALE}
                        agentState={agentState}
                        identity={visualIdentity}
                        accessibilityConfig={accessibilityConfig}
                        onPreSpeechCueReady={(fn) => {
                          preSpeechCueRef.current = fn;
                        }}
                        onAmplitudeTargetReady={(fn) => {
                          rendererAmplitudeSetterRef.current = fn;
                        }}
                      />
                    ) : (
                      <Live2DAvatar
                        state={avatarState}
                        mood={avatarMood}
                        width={(operationsPresenceSize.width - 2) * OPERATIONS_PRESENCE_STAGE_SCALE}
                        height={
                          (operationsPresenceSize.height - 82) * OPERATIONS_PRESENCE_STAGE_SCALE
                        }
                        mode="full"
                        zoomPreset={avatarZoom}
                        customZoom={avatarCustomZoom}
                        debugPresets={debugZoomPresets}
                      />
                    )}
                  </div>
                </div>
                <button
                  className="absolute bottom-3 right-3 h-6 w-6 cursor-se-resize rounded-md border border-white/10 bg-black/30 text-white/45"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    operationsPresenceResizeRef.current = {
                      startX: event.clientX,
                      startY: event.clientY,
                      startWidth: operationsPresenceSize.width,
                      startHeight: operationsPresenceSize.height,
                    };
                  }}
                  title="Resize presence panel"
                >
                  <span className="block translate-y-[-1px] text-xs">↘</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collapsed Chat Mini-bar — full-width bottom bar, slides up */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-gray-900/90 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-2.5 shadow-2xl transition-all duration-300 ${
          !isOperationsDashboard && chatCollapsed
            ? "bottom-4 opacity-100 translate-y-0"
            : "bottom-4 opacity-0 translate-y-16 pointer-events-none"
        }`}
        style={{ width: "min(680px, calc(100% - 2rem))" }}
      >
        {/* Chat icon + unread badge */}
        <div className="relative flex-shrink-0">
          <svg
            className="w-5 h-5 text-purple-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          {unreadWhileCollapsed > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-purple-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-pulse">
              {unreadWhileCollapsed > 9 ? "9+" : unreadWhileCollapsed}
            </span>
          )}
        </div>

        {/* Quick input */}
        <input
          type="text"
          value={miniBarInput}
          onChange={(e) => setMiniBarInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && miniBarInput.trim()) {
              e.preventDefault();
              handleSendMessage(miniBarInput.trim());
              setMiniBarInput("");
              setChatCollapsed(false);
              setUnreadWhileCollapsed(0);
            }
          }}
          placeholder="Type a message..."
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all"
        />

        {/* Send button */}
        <button
          onClick={() => {
            if (miniBarInput.trim()) {
              handleSendMessage(miniBarInput.trim());
              setMiniBarInput("");
              setChatCollapsed(false);
              setUnreadWhileCollapsed(0);
            }
          }}
          disabled={!miniBarInput.trim()}
          className="p-2 text-purple-400 hover:text-purple-300 disabled:text-white/20 transition-all flex-shrink-0"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
            />
          </svg>
        </button>

        {/* Expand button */}
        <button
          onClick={() => {
            setChatCollapsed(false);
            setUnreadWhileCollapsed(0);
          }}
          className="p-2 text-white/40 hover:text-white/80 transition-all flex-shrink-0 border-l border-white/10 pl-3"
          title="Expand chat"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Session Drawer */}
      <SessionDrawer
        isOpen={sessionDrawerOpen}
        onClose={() => setSessionDrawerOpen(false)}
        currentSessionKey={currentSessionKey}
        selectedAgentId={currentChatAgentId}
        defaultAgentId={primaryChatAgentId}
        onSelectSession={handleSelectSession}
        onNewSession={() => {
          handleNewSession();
          setSessionDrawerOpen(false);
        }}
        onDeleteSession={handleDeleteSession}
        sessions={sessions}
        loading={sessionsLoading}
        onRefresh={refreshSessions}
        onSearchTranscripts={(query) => gateway.searchSessions(query)}
      />

      {/* Activity Log Slide-out Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-80 bg-gray-900/95 backdrop-blur border-l border-white/10 transform transition-transform duration-300 z-50 ${
          activityPanelOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="p-4 h-full flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-white font-semibold">Activity Log</h2>
            <button
              onClick={() => setActivityPanelOpen(false)}
              className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ActivityLog entries={logs} />
          </div>
        </div>
      </div>

      {/* Backdrop for activity panel */}
      {activityPanelOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={() => setActivityPanelOpen(false)}
        />
      )}

      {/* Widget Picker */}
      <WidgetPicker
        isOpen={widgetPickerOpen}
        onClose={() => setWidgetPickerOpen(false)}
        onAdd={(type) => {
          // Widget added — grid handles persistence internally
          setWidgetPickerOpen(false);
        }}
        customWidgets={customWidgets}
      />

      {/* Modals */}
      <WeatherModal
        isOpen={weatherModalOpen}
        onClose={() => setWeatherModalOpen(false)}
        location="Austin, TX"
        weather={detailedWeather}
        loading={weatherLoading}
        onRefresh={refreshWeather}
      />
      <CalendarModal isOpen={calendarModalOpen} onClose={() => setCalendarModalOpen(false)} />
      <AlertsModal
        isOpen={alertsModalOpen}
        onClose={() => setAlertsModalOpen(false)}
        alerts={alerts}
        onMarkRead={markRead}
        onMarkAllRead={markAllRead}
        onDelete={deleteAlert}
        onClearAll={clearAll}
      />
      <SetupWizard
        isOpen={showSetup}
        onComplete={() => {
          setShowSetup(false);
          localStorage.setItem("argent-setup-complete", "1");
        }}
      />
      <CorsApprovalToast
        domain={corsApprovalDomain}
        onApprove={() => {
          corsResolveRef.current?.(true);
          corsResolveRef.current = null;
          setCorsApprovalDomain(null);
        }}
        onDeny={() => {
          corsResolveRef.current?.(false);
          corsResolveRef.current = null;
          setCorsApprovalDomain(null);
        }}
      />
      <ContemplationToast
        enabled={localStorage.getItem("argent-contemplation-enabled") !== "false"}
        onWakeup={(evt: ContemplationEvent) => {
          // Apply mood from contemplation to avatar
          if (evt.mood) {
            console.log("[Contemplation] Wakeup mood:", evt.mood);
            setAvatarMood(evt.mood);
          }
          // Trigger TTS for the contemplation text
          if (evt.text && !isNativeVoiceActive()) {
            tts.speak(evt.text, evt.mood || undefined);
          }
        }}
      />
      <ConfigPanel
        isOpen={configPanelOpen}
        onClose={() => {
          setConfigPanelOpen(false);
          setConfigPanelRequestedTab(null);
        }}
        requestedTab={configPanelRequestedTab}
        onRequestedTabHandled={() => setConfigPanelRequestedTab(null)}
        runtimeLoadProfile={runtimeLoadProfile}
        onRuntimeLoadProfileChange={setRuntimeLoadProfile}
        onAvatarPreviewChange={setAvatarPreviewActive}
        avatarState={avatarState}
        avatarMood={avatarMood}
        avatarRenderer={avatarRenderer}
        onRendererChange={setAvatarRenderer}
        widgets={{
          getWidget,
          updateWidget,
          resetToDefaults: resetWidgets,
          customWidgets,
        }}
        lockScreen={lockScreen}
        visualIdentity={visualIdentity}
        onIdentityChange={setVisualIdentity}
        accessibilityConfig={accessibilityConfig}
        onAccessibilityChange={setAccessibilityConfig}
        gatewayRequest={gateway.request}
      />

      {/* Worker Flow */}
      {isOperationsDashboard && (
        <WorkerFlowModal
          isOpen={workerFlowOpen}
          onClose={() => setWorkerFlowOpen(false)}
          onOpenSystems={() => {
            setWorkerFlowOpen(false);
            setConfigPanelRequestedTab("systems");
            setConfigPanelOpen(true);
          }}
          onOpenAdvanced={() => {
            setWorkerFlowOpen(false);
            setShowBoard(false);
            setWorkforceFocus("all");
            setShowWorkforce(true);
          }}
          gatewayRequest={gateway.request}
        />
      )}

      {/* Canvas Panel — docked left, leaves chat visible */}
      <CanvasPanel
        isOpen={canvasOpen}
        documents={canvasDocuments}
        activeDocId={activeCanvasDocId}
        onClose={handleCanvasClose}
        onDocumentChange={setActiveCanvasDocId}
        onDeleteDocument={handleDeleteDocument}
        onCloseTab={(docId: string) => {
          // If closing a terminal tab, kill the PTY
          const doc = canvasDocuments.find((d) => d.id === docId);
          if (doc?.type === "terminal" && doc.terminalId) {
            gateway.request("terminal.kill", { id: doc.terminalId }).catch(() => {});
          }
          setCanvasDocuments((prev) => {
            const remaining = prev.filter((d) => d.id !== docId);
            if (activeCanvasDocId === docId && remaining.length > 0) {
              setActiveCanvasDocId(remaining[0].id);
            }
            if (remaining.length === 0) {
              handleCanvasClose();
            }
            return remaining;
          });
        }}
        onSaveAsPDF={handleCanvasSaveAsPDF}
        onSaveAsDoc={handleCanvasSaveAsDoc}
        onEmail={handleCanvasEmail}
        gateway={gateway}
        onNewTerminal={async () => {
          try {
            const result = await gateway.request<{ id: string; shell: string; cwd: string }>(
              "terminal.create",
              { cwd: "~/argent" },
            );
            pushToCanvas("Terminal", "", "terminal", undefined, result.id);
          } catch (err) {
            console.error("[Terminal] Failed to create:", err);
          }
        }}
        debateState={debate.state}
        left={0}
        width={Math.round(colWidths[0] + colWidths[1])}
        top={0}
      />

      {/* App Forge Desktop */}
      <AppForge
        isOpen={appForgeOpen}
        apps={forgeApps}
        windows={appWindows.windows}
        onClose={() => setAppForgeOpen(false)}
        onOpenApp={handleOpenForgeApp}
        onPinApp={pinForgeApp}
        onDeleteApp={handleDeleteForgeApp}
        onNewApp={handleNewForgeApp}
        onRestoreApp={appWindows.restoreApp}
        onFocusApp={appWindows.focusApp}
      />

      {/* App Windows (rendered outside forge so they persist when forge closes) */}
      {appWindows.windows.map((win) => {
        const listApp = forgeApps.find((a) => a.id === win.appId);
        const cachedApp = loadedAppCode[win.appId];
        const app =
          cachedApp && (!isAppStatusShell(cachedApp.code) || !listApp?.code) ? cachedApp : listApp;
        if (!app) return null;
        return (
          <AppWindow
            key={win.appId}
            app={app}
            windowState={win}
            onClose={appWindows.closeApp}
            onMinimize={appWindows.minimizeApp}
            onMaximize={appWindows.maximizeApp}
            onFocus={appWindows.focusApp}
            onMove={appWindows.moveApp}
            onResize={appWindows.resizeApp}
          />
        );
      })}

      {/* Canvas Debug Controls */}
      {canvasDebug && canvasOpen && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800/90 backdrop-blur p-4 rounded-xl border border-white/10 z-50">
          <div className="text-white/70 text-xs mb-2 font-mono">
            Canvas Position (left: {canvasLeft}% | width: {canvasWidth}% | top: {canvasTop}rem)
          </div>
          <div className="flex gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-white/50 text-xs">Left %</label>
              <input
                type="range"
                min="20"
                max="60"
                value={canvasLeft}
                onChange={(e) => setCanvasLeft(Number(e.target.value))}
                className="w-32"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-white/50 text-xs">Width %</label>
              <input
                type="range"
                min="20"
                max="50"
                value={canvasWidth}
                onChange={(e) => setCanvasWidth(Number(e.target.value))}
                className="w-32"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-white/50 text-xs">Top (rem)</label>
              <input
                type="range"
                min="0"
                max="8"
                step="0.5"
                value={canvasTop}
                onChange={(e) => setCanvasTop(Number(e.target.value))}
                className="w-32"
              />
            </div>
            <button
              onClick={() => {
                console.log(
                  `Canvas position: left=${canvasLeft}%, width=${canvasWidth}%, top=${canvasTop}rem`,
                );
                setCanvasDebug(false);
              }}
              className="px-3 py-1 bg-green-600/50 hover:bg-green-600/70 text-white text-xs rounded"
            >
              Lock
            </button>
          </div>
        </div>
      )}

      {/* Lock Screen — renders above everything */}
      <LockScreen
        isLocked={lockScreen.isLocked}
        onUnlock={lockScreen.unlock}
        onUnlockWithPin={lockScreen.unlockWithPin}
        error={lockScreen.error}
        isAuthenticating={lockScreen.isAuthenticating}
        hasPin={lockScreen.hasPin}
        hasPlatformKey={lockScreen.hasPlatformKey}
        hasCrossPlatformKey={lockScreen.hasCrossPlatformKey}
        credentials={lockScreen.credentials}
      />

      {allowWorkforceSurface && (
        <ProjectKickoffModal
          isOpen={showProjectKickoffModal}
          onClose={() => setShowProjectKickoffModal(false)}
        />
      )}
    </div>
  );
}

export default App;
