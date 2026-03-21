/**
 * Meeting Recorder Tool for Agents
 *
 * Records system audio + microphone during meetings (Zoom, Meet, Teams),
 * then transcribes and extracts summaries/action items via the existing
 * media-understanding pipeline and doc_panel/tasks integrations.
 */

import { Type } from "@sinclair/typebox";
import { execFile, spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { transcribeOpenAiCompatibleAudio } from "../../media-understanding/providers/openai/audio.js";
import { dashboardApiHeaders } from "../../utils/dashboard-api.js";
import { resolveApiKeyForProvider } from "../model-auth.js";
import { type AnyAgentTool, readStringParam, readNumberParam } from "./common.js";

const execFileAsync = promisify(execFile);

const DASHBOARD_API = process.env.ARGENT_DASHBOARD_API || "http://localhost:9242";
const MEETINGS_DIR = path.join(os.homedir(), ".argentos", "meetings");
const AUDIO_DIR = path.join(MEETINGS_DIR, "audio");
const TRANSCRIPTS_DIR = path.join(MEETINGS_DIR, "transcripts");
const INDEX_PATH = path.join(MEETINGS_DIR, "index.json");
const ACTIVE_PATH = path.join(MEETINGS_DIR, "active.json");

// 24 MB — Whisper API limit is 25MB, leave margin
const MAX_CHUNK_BYTES = 24 * 1024 * 1024;

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: { text } };
}

function shouldUseAppleScriptBridge(): boolean {
  if (process.platform !== "darwin") return false;
  const override = String(process.env.ARGENT_MEETING_USE_OSASCRIPT ?? "")
    .trim()
    .toLowerCase();
  if (override === "1" || override === "true" || override === "yes") return true;
  if (override === "0" || override === "false" || override === "no") return false;
  return Boolean(process.env.ARGENT_LAUNCHD_LABEL);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function runAppleScriptShell(command: string, timeout = 20_000): Promise<string> {
  const osaArgs = [
    "-e",
    "on run argv",
    "-e",
    "do shell script (item 1 of argv)",
    "-e",
    "end run",
    command,
  ];

  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "";
  try {
    if (uid) {
      const { stdout } = await execFileAsync(
        "launchctl",
        ["asuser", uid, "osascript", ...osaArgs],
        {
          timeout,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      return String(stdout || "").trim();
    }
  } catch {
    // Fall back to direct osascript invocation below.
  }

  const { stdout } = await execFileAsync("osascript", osaArgs, {
    timeout,
    maxBuffer: 2 * 1024 * 1024,
  });
  return String(stdout || "").trim();
}

// ============================================================================
// Schema
// ============================================================================

const MeetingRecorderSchema = Type.Object({
  action: Type.Union([
    Type.Literal("start"),
    Type.Literal("stop"),
    Type.Literal("status"),
    Type.Literal("devices"),
    Type.Literal("list"),
    Type.Literal("process"),
  ]),
  // start
  title: Type.Optional(Type.String({ description: "Meeting title" })),
  systemAudio: Type.Optional(
    Type.Boolean({ description: "Capture system audio (default: true)", default: true }),
  ),
  mic: Type.Optional(
    Type.Boolean({ description: "Capture microphone (default: true)", default: true }),
  ),
  micDeviceId: Type.Optional(
    Type.String({
      description:
        "Microphone device id (from action=devices). If omitted, capture uses macOS default input device.",
    }),
  ),
  binaryPath: Type.Optional(
    Type.String({
      description:
        "Optional absolute path to argent-audio-capture binary (used by desktop app packaging).",
    }),
  ),
  liveTranscript: Type.Optional(
    Type.Boolean({
      description: "Enable live transcript updates into DocPanel while recording (default: true)",
      default: true,
    }),
  ),
  requestPermissions: Type.Optional(
    Type.Boolean({
      description:
        "When action=devices/start, request macOS mic/screen permissions if status is not determined.",
      default: false,
    }),
  ),
  liveIntervalSec: Type.Optional(
    Type.Number({
      description: "Live transcript polling/transcription interval in seconds (default: 45)",
      default: 45,
    }),
  ),
  // list
  limit: Type.Optional(Type.Number({ description: "Max recordings to return", default: 10 })),
  // process
  meetingId: Type.Optional(
    Type.String({ description: "Meeting ID to process (for process action)" }),
  ),
  createTasks: Type.Optional(
    Type.Boolean({
      description: "When processing, create tasks for extracted action items (default: false)",
      default: false,
    }),
  ),
});

// ============================================================================
// Types
// ============================================================================

type MeetingEntry = {
  id: string;
  title: string;
  startedAt: string;
  stoppedAt?: string;
  durationSec: number;
  audioPath: string;
  fileSizeBytes?: number;
  transcribed: boolean;
  transcriptPath?: string;
  processed: boolean;
  summary?: string;
};

type ActiveRecording = {
  pid: number;
  startedAt: string;
  durationSec: number;
  systemAudioPath?: string;
  micPath?: string;
  status: string;
};

type MeetingActionItem = {
  text: string;
  owner?: string;
  due?: string;
  priority: "normal" | "high";
};

type MeetingAnalysis = {
  summary: string;
  highlights: string[];
  decisions: string[];
  actionItems: MeetingActionItem[];
};

type LiveTranscriptSession = {
  meetingId: string;
  title: string;
  sessionKey?: string;
  sourcePath: string;
  intervalSec: number;
  docId: string;
  lines: string[];
  lastNormalized: string;
  inFlight: boolean;
  timer?: NodeJS.Timeout;
};

type CaptureDevice = {
  id: string;
  name: string;
  isDefault?: boolean;
};

type CaptureDeviceReport = {
  ok: boolean;
  microphonePermission?: string;
  screenCapturePermission?: boolean;
  defaultMicDeviceId?: string;
  defaultMicDeviceName?: string;
  micDevices?: CaptureDevice[];
  error?: string;
  message?: string;
};

const DEFAULT_LIVE_INTERVAL_SEC = Math.max(
  10,
  Number.parseInt(process.env.ARGENT_MEETING_LIVE_INTERVAL_SEC || "45", 10) || 45,
);
const liveTranscriptSessions = new Map<string, LiveTranscriptSession>();

// ============================================================================
// Helpers
// ============================================================================

async function ensureDirs() {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  await fs.mkdir(TRANSCRIPTS_DIR, { recursive: true });
}

async function readIndex(): Promise<MeetingEntry[]> {
  try {
    const data = await fs.readFile(INDEX_PATH, "utf-8");
    return JSON.parse(data) as MeetingEntry[];
  } catch {
    return [];
  }
}

async function writeIndex(entries: MeetingEntry[]) {
  await fs.writeFile(INDEX_PATH, JSON.stringify(entries, null, 2));
}

async function readActive(): Promise<ActiveRecording | null> {
  try {
    const data = await fs.readFile(ACTIVE_PATH, "utf-8");
    return JSON.parse(data) as ActiveRecording;
  } catch {
    return null;
  }
}

function generateMeetingId(): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `mtg-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function resolveBinaryPath(preferredPath?: string): { resolved?: string; attempted: string[] } {
  const candidates: string[] = [];

  // -1. Per-call preferred path (from menu app bundle)
  if (preferredPath) {
    const expanded = preferredPath.startsWith("~/")
      ? path.join(os.homedir(), preferredPath.slice(2))
      : preferredPath;
    candidates.push(path.resolve(expanded));
  }

  // 0. Explicit override
  const explicit = process.env.ARGENT_AUDIO_CAPTURE_BIN?.trim();
  if (explicit) {
    const expanded = explicit.startsWith("~/")
      ? path.join(os.homedir(), explicit.slice(2))
      : explicit;
    candidates.push(path.resolve(expanded));
  }

  // 1. Inside .app bundle (production distribution)
  //    Binary lives at Argent.app/Contents/Resources/bin/argent-audio-capture
  //    process.execPath is .../Contents/Resources/argent-runtime/bin/node
  const execDir = path.dirname(process.execPath);
  const appResourcesDir = execDir.includes("argent-runtime")
    ? path.resolve(execDir, "..", "..")
    : null;
  if (appResourcesDir) {
    candidates.push(path.join(appResourcesDir, "bin", "argent-audio-capture"));
  }

  // 2. Development: built binary relative to cwd
  candidates.push(
    path.join(process.cwd(), "apps/argent-audio-capture/.build/release/argent-audio-capture"),
    path.join(process.cwd(), "apps/argent-audio-capture/.build/debug/argent-audio-capture"),
  );

  // 3. Development: path relative to this module (works in src/ and dist/ trees)
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  candidates.push(
    path.join(moduleRoot, "apps/argent-audio-capture/.build/release/argent-audio-capture"),
    path.join(moduleRoot, "apps/argent-audio-capture/.build/debug/argent-audio-capture"),
  );

  // 4. Common local clone roots
  const home = os.homedir();
  candidates.push(
    path.join(home, "code/argentos/apps/argent-audio-capture/.build/release/argent-audio-capture"),
    path.join(home, "code/argentos/apps/argent-audio-capture/.build/debug/argent-audio-capture"),
    path.join(home, "argentos/apps/argent-audio-capture/.build/release/argent-audio-capture"),
    path.join(home, "argentos/apps/argent-audio-capture/.build/debug/argent-audio-capture"),
    path.join(home, "argent/apps/argent-audio-capture/.build/release/argent-audio-capture"),
    path.join(home, "argent/apps/argent-audio-capture/.build/debug/argent-audio-capture"),
  );

  const attempted = [...new Set(candidates.map((c) => path.resolve(c)))];
  for (const candidate of attempted) {
    try {
      const stat = fsSync.statSync(candidate);
      if (stat.isFile()) return { resolved: candidate, attempted };
    } catch {
      // continue
    }
  }
  return { attempted };
}

async function fileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

async function readTail(filePath: string, maxChars = 1600): Promise<string> {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    if (text.length <= maxChars) return text;
    return text.slice(-maxChars);
  } catch {
    return "";
  }
}

function processExists(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForCaptureStart(
  expectedPid: number,
  timeoutMs = 8_000,
): Promise<{
  ok: boolean;
  active?: ActiveRecording;
  reason?: string;
}> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const active = await readActive();
    if (active && active.status === "recording") {
      if (!expectedPid || active.pid === expectedPid) {
        return { ok: true, active };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!processExists(expectedPid)) {
    return { ok: false, reason: "capture process exited immediately" };
  }
  return { ok: false, reason: "capture control file was never initialized" };
}

async function ffmpegMerge(systemPath: string, micPath: string, outputPath: string): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    [
      "-i",
      systemPath,
      "-i",
      micPath,
      "-filter_complex",
      "amerge=inputs=2",
      "-ac",
      "1",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-y",
      outputPath,
    ],
    { timeout: 120_000 },
  );
}

async function ffmpegSingleCopy(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    ["-i", inputPath, "-c:a", "aac", "-b:a", "128k", "-y", outputPath],
    { timeout: 60_000 },
  );
}

async function ffmpegSplit(
  inputPath: string,
  outputDir: string,
  chunkDurationSec: number,
): Promise<string[]> {
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const pattern = path.join(outputDir, `${baseName}-chunk-%03d.m4a`);
  await execFileAsync(
    "ffmpeg",
    [
      "-i",
      inputPath,
      "-f",
      "segment",
      "-segment_time",
      String(chunkDurationSec),
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-y",
      pattern,
    ],
    { timeout: 300_000 },
  );

  // Find generated chunks
  const files = await fs.readdir(outputDir);
  return files
    .filter((f) => f.startsWith(`${baseName}-chunk-`) && f.endsWith(".m4a"))
    .sort()
    .map((f) => path.join(outputDir, f));
}

function readBooleanLikeParam(
  params: Record<string, unknown>,
  key: string,
  defaultValue = false,
): boolean {
  const raw = params[key];
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const value = raw.trim().toLowerCase();
    if (value === "true" || value === "1" || value === "yes" || value === "on") return true;
    if (value === "false" || value === "0" || value === "no" || value === "off") return false;
  }
  return defaultValue;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatDuration(durationSec: number): string {
  const mins = Math.floor(durationSec / 60);
  const secs = Math.max(0, durationSec % 60);
  return `${mins}m ${secs}s`;
}

function normalizeExtractionLine(line: string): string {
  return line
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "")
    .replace(/^[*-]\s*/, "")
    .replace(/^[A-Za-z][A-Za-z0-9 ._'-]{0,36}:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTranscriptSentences(transcript: string): string[] {
  const normalized = transcript
    .replace(/\r/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 24);
}

function inferTaskPriority(text: string): "normal" | "high" {
  return /\b(urgent|asap|today|blocker|critical|immediately)\b/i.test(text) ? "high" : "normal";
}

function extractActionItems(lines: string[], sentences: string[]): MeetingActionItem[] {
  const trigger =
    /\b(action item|todo|to-?do|next step|follow[\s-]?up|assigned|owner|need to|needs to|must|should|will)\b/i;
  const ownerPattern = /(?:owner|assignee|assigned to)[:\s]+([A-Za-z][A-Za-z .'-]{1,40})/i;
  const duePattern = /(?:due|by)\s+([A-Za-z0-9,\/\- ]{2,30})/i;

  const seen = new Set<string>();
  const out: MeetingActionItem[] = [];
  const candidates = [...lines, ...sentences];
  for (const raw of candidates) {
    const text = normalizeExtractionLine(raw);
    if (text.length < 18 || text.length > 260) continue;
    if (!trigger.test(text)) continue;
    if (/\?$/.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const owner = ownerPattern.exec(text)?.[1]?.trim();
    const due = duePattern.exec(text)?.[1]?.trim();
    out.push({
      text: text.replace(/\s*\.+\s*$/, "").trim(),
      owner,
      due,
      priority: inferTaskPriority(text),
    });
    if (out.length >= 12) break;
  }
  return out;
}

function extractDecisions(lines: string[], sentences: string[]): string[] {
  const trigger = /\b(decided|decision|agreed|approved|finalized|we will ship|go with)\b/i;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...lines, ...sentences]) {
    const text = normalizeExtractionLine(raw);
    if (text.length < 16 || text.length > 260) continue;
    if (!trigger.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text.replace(/\s*\.+\s*$/, "").trim());
    if (out.length >= 8) break;
  }
  return out;
}

function buildMeetingAnalysis(transcript: string): MeetingAnalysis {
  const lines = transcript
    .split(/\r?\n/g)
    .map((line) => normalizeExtractionLine(line))
    .filter((line) => line.length >= 24);
  const sentences = splitTranscriptSentences(transcript);

  const highlightsSource = lines.length > 0 ? lines : sentences;
  const highlights = highlightsSource
    .filter((line) => line.length >= 32)
    .slice(0, 8)
    .map((line) => line.replace(/\s*\.+\s*$/, "").trim());
  const decisions = extractDecisions(lines, sentences);
  const actionItems = extractActionItems(lines, sentences);

  const summaryParts: string[] = [];
  if (highlights.length > 0) {
    summaryParts.push(highlights.slice(0, 3).join(" "));
  }
  if (decisions.length > 0) {
    summaryParts.push(`Decisions: ${decisions.slice(0, 2).join("; ")}.`);
  }
  if (actionItems.length > 0) {
    summaryParts.push(
      `Action items: ${actionItems
        .slice(0, 3)
        .map((item) => item.text)
        .join("; ")}.`,
    );
  }
  const summary = summaryParts.join(" ").trim() || "Meeting captured and transcribed.";

  return { summary, highlights, decisions, actionItems };
}

function buildUnifiedDocContent(
  entry: MeetingEntry,
  transcript: string,
  analysis: MeetingAnalysis,
): string {
  const highlights =
    analysis.highlights.length > 0
      ? analysis.highlights.map((line) => `- ${line}`).join("\n")
      : "- (no highlights extracted)";
  const decisions =
    analysis.decisions.length > 0
      ? analysis.decisions.map((line) => `- ${line}`).join("\n")
      : "- (no explicit decisions detected)";
  const actions =
    analysis.actionItems.length > 0
      ? analysis.actionItems
          .map((item) => {
            const meta = [
              item.owner ? `owner: ${item.owner}` : null,
              item.due ? `due: ${item.due}` : null,
              item.priority === "high" ? "🔴 HIGH PRIORITY" : null,
            ]
              .filter(Boolean)
              .join(", ");
            return meta ? `- [ ] ${item.text} (${meta})` : `- [ ] ${item.text}`;
          })
          .join("\n")
      : "- (no action items detected)";

  return `# Meeting Summary: ${entry.title}

**Date**: ${entry.startedAt}
**Duration**: ${formatDuration(entry.durationSec)}
**Audio**: ${entry.audioPath}

## Executive Summary
${analysis.summary}

## Highlights
${highlights}

## Decisions
${decisions}

## Action Items
${actions}

---

## Full Transcript

${transcript}`;
}

async function pushDocPanelDoc(options: {
  id: string;
  title: string;
  content: string;
  tags: string[];
  sessionKey?: string;
}): Promise<{
  ok: boolean;
  collection: string;
  message: string;
}> {
  try {
    const saveRes = await fetch(`${DASHBOARD_API}/api/canvas/save`, {
      method: "POST",
      headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        doc: {
          id: options.id,
          title: options.title,
          content: options.content,
          type: "markdown",
          tags: options.tags,
          autoRouted: true,
        },
        sessionKey: options.sessionKey,
      }),
    });
    const payload = (await saveRes.json().catch(() => ({}))) as {
      persisted?: boolean;
      collection?: string;
      error?: string;
    };
    if (!saveRes.ok) {
      return {
        ok: false,
        collection: payload.collection || "docpane",
        message: payload.error || `DocPanel save failed (${saveRes.status})`,
      };
    }
    if (payload.persisted === false) {
      return {
        ok: false,
        collection: payload.collection || "docpane",
        message: "Knowledge sync disabled for this document",
      };
    }
    return {
      ok: true,
      collection: payload.collection || "docpane",
      message: `Synced to PG knowledge collection "${payload.collection || "docpane"}"`,
    };
  } catch (err) {
    return {
      ok: false,
      collection: "docpane",
      message: `DocPanel push failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function createTasksFromActionItems(
  entry: MeetingEntry,
  meetingId: string,
  actionItems: MeetingActionItem[],
): Promise<{ requested: number; created: number; failed: number }> {
  const requested = Math.min(actionItems.length, 12);
  let created = 0;
  let failed = 0;
  for (const item of actionItems.slice(0, requested)) {
    const title = item.text.replace(/\s+/g, " ").trim().slice(0, 160);
    if (!title) continue;
    const detailsParts = [
      `Auto-created from meeting "${entry.title}" (${meetingId})`,
      item.owner ? `Owner hint: ${item.owner}` : null,
      item.due ? `Due hint: ${item.due}` : null,
      "Source doc: meeting notes/action items in DocPanel.",
    ].filter(Boolean);
    try {
      const response = await fetch(`${DASHBOARD_API}/api/tasks`, {
        method: "POST",
        headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          title,
          details: detailsParts.join("\n"),
          priority: item.priority,
          type: "one-time",
        }),
      });
      if (response.ok) {
        created += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { requested, created, failed };
}

function normalizeLiveTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLiveTranscriptDocContent(
  session: LiveTranscriptSession,
  status: "recording" | "stopped",
): string {
  const lines =
    session.lines.length > 0
      ? session.lines.map((line) => `- ${line}`).join("\n")
      : "- Waiting for speech…";
  return `# Live Meeting Transcript: ${session.title}

**Meeting ID**: ${session.meetingId}
**Status**: ${status}
**Updated**: ${new Date().toISOString()}
**Source**: ${session.sourcePath}

## Live Transcript (partial)
${lines}

> This transcript is generated live and may include errors. Final transcript is produced after processing.`;
}

async function publishLiveTranscriptDoc(
  session: LiveTranscriptSession,
  status: "recording" | "stopped",
): Promise<void> {
  await pushDocPanelDoc({
    id: session.docId,
    title: `Meeting Live: ${session.title}`,
    content: buildLiveTranscriptDocContent(session, status),
    tags: ["meeting", "live", "transcript"],
    sessionKey: session.sessionKey,
  });
}

async function runLiveTranscriptTick(session: LiveTranscriptSession): Promise<void> {
  if (session.inFlight) return;
  session.inFlight = true;
  try {
    const active = await readActive();
    if (!active || active.status !== "recording") {
      await stopLiveTranscriptSession(session.meetingId, "stopped");
      return;
    }

    const tempPath = path.join(
      AUDIO_DIR,
      session.meetingId,
      `${session.meetingId}-live-window.wav`,
    );
    const windowSec = Math.max(10, session.intervalSec);
    await execFileAsync(
      "ffmpeg",
      [
        "-sseof",
        `-${windowSec}`,
        "-i",
        session.sourcePath,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-y",
        tempPath,
      ],
      { timeout: 60_000 },
    );

    const result = await transcribeChunk(tempPath);
    const text = result.text.trim().replace(/\s+/g, " ");
    if (!text) return;
    const normalized = normalizeLiveTranscript(text);
    if (!normalized || normalized === session.lastNormalized) return;
    session.lastNormalized = normalized;

    const stamp = new Date().toISOString().slice(11, 19);
    session.lines.push(`[${stamp}] ${text}`);
    if (session.lines.length > 200) {
      session.lines.splice(0, session.lines.length - 200);
    }

    await publishLiveTranscriptDoc(session, "recording");
  } catch {
    // Best effort: live transcript should never break recording flow.
  } finally {
    session.inFlight = false;
  }
}

async function startLiveTranscriptSession(options: {
  meetingId: string;
  title: string;
  sourcePath: string;
  sessionKey?: string;
  intervalSec: number;
}): Promise<void> {
  const existing = liveTranscriptSessions.get(options.meetingId);
  if (existing) {
    if (existing.timer) clearInterval(existing.timer);
    liveTranscriptSessions.delete(options.meetingId);
  }
  const session: LiveTranscriptSession = {
    meetingId: options.meetingId,
    title: options.title,
    sessionKey: options.sessionKey,
    sourcePath: options.sourcePath,
    intervalSec: Math.max(10, options.intervalSec),
    docId: `meeting-${options.meetingId}-live`,
    lines: [],
    lastNormalized: "",
    inFlight: false,
  };
  liveTranscriptSessions.set(options.meetingId, session);

  await publishLiveTranscriptDoc(session, "recording");
  await runLiveTranscriptTick(session);
  session.timer = setInterval(() => {
    const current = liveTranscriptSessions.get(session.meetingId);
    if (!current) return;
    void runLiveTranscriptTick(current);
  }, session.intervalSec * 1000);
}

async function stopLiveTranscriptSession(
  meetingId: string,
  status: "recording" | "stopped" = "stopped",
): Promise<void> {
  const session = liveTranscriptSessions.get(meetingId);
  if (!session) return;
  if (session.timer) clearInterval(session.timer);
  liveTranscriptSessions.delete(meetingId);
  try {
    await publishLiveTranscriptDoc(session, status);
  } catch {
    // ignore
  }
}

async function stopAllLiveTranscriptSessions(): Promise<void> {
  const ids = [...liveTranscriptSessions.keys()];
  for (const id of ids) {
    await stopLiveTranscriptSession(id, "stopped");
  }
}

async function listCaptureDevices(params?: Record<string, unknown>): Promise<string> {
  await ensureDirs();
  const preferredPath = normalizeOptionalString(readStringParam(params ?? {}, "binaryPath"));
  const requestPermissions = readBooleanLikeParam(params ?? {}, "requestPermissions", false);

  const { resolved: binaryPath, attempted } = resolveBinaryPath(preferredPath);
  if (!binaryPath) {
    const checked =
      attempted.length > 0 ? `\nChecked:\n- ${attempted.slice(0, 8).join("\n- ")}` : "";
    return `{"ok":false,"error":"swift-binary-not-found","message":"Build apps/argent-audio-capture first.${checked.replace(/\n/g, "\\n")}"}`;
  }
  try {
    await fs.access(binaryPath);
  } catch {
    return `{"ok":false,"error":"swift-binary-missing","message":"Swift binary missing at ${binaryPath}"}`;
  }

  try {
    // Keep --output-dir for compatibility with older capture binaries that still require it.
    const args = ["--output-dir", AUDIO_DIR, "--list-mic-devices"];
    if (requestPermissions) args.push("--request-permissions");
    let text = "";
    if (shouldUseAppleScriptBridge()) {
      const cmd = `${shellEscape(binaryPath)} ${args.map(shellEscape).join(" ")}`;
      text = await runAppleScriptShell(cmd, 30_000);
    } else {
      const result = await execFileAsync(binaryPath, args, {
        timeout: 20_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      text = String(result.stdout || "").trim();
    }
    if (!text) {
      return '{"ok":false,"error":"empty-device-response","message":"No device output from capture binary."}';
    }
    try {
      JSON.parse(text);
      return text;
    } catch {
      return `{"ok":false,"error":"invalid-device-json","message":"Capture binary returned non-JSON output."}`;
    }
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Unknown error listing capture devices";
    return `{"ok":false,"error":"device-list-failed","message":${JSON.stringify(msg)}}`;
  }
}

function parseCaptureDeviceReport(text: string): CaptureDeviceReport | null {
  try {
    const parsed = JSON.parse(text) as CaptureDeviceReport;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

// ============================================================================
// Actions
// ============================================================================

async function startRecording(
  params: Record<string, unknown>,
  options?: { agentSessionKey?: string },
): Promise<string> {
  await ensureDirs();

  // Check if already recording
  const active = await readActive();
  if (active && active.status === "recording") {
    return `Already recording (PID: ${active.pid}, duration: ${active.durationSec}s). Use action=stop to end the current recording first.`;
  }

  const meetingId = generateMeetingId();
  const title = readStringParam(params, "title") || meetingId;
  const captureSystem = params.systemAudio !== false;
  const captureMic = params.mic !== false;
  if (!captureSystem && !captureMic) {
    return "At least one capture source is required (systemAudio=true and/or mic=true).";
  }
  const liveTranscript = readBooleanLikeParam(params, "liveTranscript", true);
  const liveIntervalSec = Math.max(
    10,
    Math.trunc(readNumberParam(params, "liveIntervalSec") ?? DEFAULT_LIVE_INTERVAL_SEC),
  );
  const micDeviceId = normalizeOptionalString(readStringParam(params, "micDeviceId"));
  const binaryPathOverride = normalizeOptionalString(readStringParam(params, "binaryPath"));
  const requestPermissions = readBooleanLikeParam(params, "requestPermissions", false);

  const { resolved: binaryPath, attempted } = resolveBinaryPath(binaryPathOverride);
  if (!binaryPath) {
    const checked =
      attempted.length > 0 ? `\nChecked:\n- ${attempted.slice(0, 8).join("\n- ")}` : "";
    return `Swift audio capture binary not found. Build it:\n  cd apps/argent-audio-capture && swift build -c release${checked}`;
  }
  try {
    await fs.access(binaryPath);
  } catch {
    return `Swift binary not found at ${binaryPath}. Build it first:\n  cd apps/argent-audio-capture && swift build -c release`;
  }

  const devicesReport = parseCaptureDeviceReport(
    await listCaptureDevices({
      binaryPath: binaryPathOverride,
      requestPermissions,
    }),
  );
  if (!devicesReport || devicesReport.ok !== true) {
    const message =
      devicesReport?.message || devicesReport?.error || "Unable to read capture devices.";
    return `Capture preflight failed before recording start: ${message}`;
  }

  const permissionWarnings: string[] = [];
  const micPermission = String(devicesReport.microphonePermission || "").toLowerCase();
  if (captureMic && (micPermission === "denied" || micPermission === "restricted")) {
    permissionWarnings.push(
      "Microphone permission appears blocked for this capture context. Recording may fail or include no mic audio.",
    );
  }

  if (captureSystem && devicesReport.screenCapturePermission !== true) {
    permissionWarnings.push(
      "Screen/System audio permission appears missing for this capture context. Recording may fail or include no system audio.",
    );
  }

  if (captureMic && micDeviceId) {
    const knownDevices = Array.isArray(devicesReport.micDevices) ? devicesReport.micDevices : [];
    const found = knownDevices.some((d) => d?.id === micDeviceId);
    if (!found) {
      const sampleIds = knownDevices
        .map((d) => d?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .slice(0, 8);
      return `Selected microphone device was not found: ${micDeviceId}${sampleIds.length > 0 ? `\nAvailable device ids:\n- ${sampleIds.join("\n- ")}` : ""}`;
    }
  }

  const meetingAudioDir = path.join(AUDIO_DIR, meetingId);
  await fs.mkdir(meetingAudioDir, { recursive: true });
  const captureLogPath = path.join(meetingAudioDir, `${meetingId}-capture.log`);

  const args = [
    "--output-dir",
    meetingAudioDir,
    "--base-name",
    meetingId,
    "--control-file",
    ACTIVE_PATH,
    "--log-file",
    captureLogPath,
  ];
  if (captureSystem) args.push("--system-audio");
  if (captureMic) args.push("--mic");
  if (captureMic && micDeviceId) args.push("--mic-device-id", micDeviceId);

  // Clean up any stale active file
  try {
    await fs.unlink(ACTIVE_PATH);
  } catch {
    /* ignore */
  }

  // Write initial index entry
  const index = await readIndex();
  const entry: MeetingEntry = {
    id: meetingId,
    title,
    startedAt: new Date().toISOString(),
    durationSec: 0,
    audioPath: path.join(meetingAudioDir, `${meetingId}.m4a`),
    transcribed: false,
    processed: false,
  };
  index.unshift(entry);
  await writeIndex(index);

  const liveSourcePath = captureMic
    ? path.join(meetingAudioDir, `${meetingId}-mic.wav`)
    : path.join(meetingAudioDir, `${meetingId}-system.m4a`);
  if (liveTranscript) {
    await startLiveTranscriptSession({
      meetingId,
      title,
      sourcePath: liveSourcePath,
      sessionKey: options?.agentSessionKey,
      intervalSec: liveIntervalSec,
    });
  }

  const warningBlock =
    permissionWarnings.length > 0 ? `\n\nWarnings:\n- ${permissionWarnings.join("\n- ")}` : "";

  const payload = {
    status: "ok",
    meetingId: meetingId,
    args: args,
    binaryPath: "argent-audio-capture", // The client expects this in its own bundle
    message: `Recording started: **${title}** (ID: ${meetingId})\nSystem audio: ${captureSystem}, Mic: ${captureMic}\nLive transcript: ${liveTranscript ? "enabled" : "disabled"}${warningBlock}`,
  };

  return `EXEC_PAYLOAD:${JSON.stringify(payload)}`;
}

async function stopRecording(): Promise<string> {
  const active = await readActive();
  if (!active || active.status !== "recording") {
    await stopAllLiveTranscriptSessions();
    return "No active recording found.";
  }

  // Send SIGINT to the recording process
  try {
    process.kill(active.pid, "SIGINT");
  } catch {
    // Process may have already exited
  }

  // Wait for process to exit (poll active.json for status change)
  let stopped = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const check = await readActive();
    if (!check || check.status === "stopped") {
      stopped = true;
      break;
    }
  }

  if (!stopped) {
    // Force kill
    try {
      process.kill(active.pid, "SIGKILL");
    } catch {
      // ignore
    }
  }

  // Merge audio files if both exist
  const systemPath = active.systemAudioPath;
  const micPath = active.micPath;
  const index = await readIndex();
  const entry = index[0]; // Most recent
  if (!entry) {
    return "Recording stopped but no index entry found.";
  }

  const mergedPath = entry.audioPath;

  let hasSystem = false;
  let hasMic = false;
  let systemBytes = 0;
  let micBytes = 0;
  try {
    systemBytes = systemPath ? await fileSize(systemPath) : 0;
    micBytes = micPath ? await fileSize(micPath) : 0;
    hasSystem = systemBytes > 0;
    hasMic = micBytes > 0;

    if (hasSystem && hasMic) {
      await ffmpegMerge(systemPath!, micPath!, mergedPath);
    } else if (hasSystem) {
      await ffmpegSingleCopy(systemPath!, mergedPath);
    } else if (hasMic) {
      await ffmpegSingleCopy(micPath!, mergedPath);
    }
  } catch (err) {
    // If merge fails, try to just copy whichever file exists
    const fallback = systemPath || micPath;
    if (fallback) {
      try {
        await fs.copyFile(fallback, mergedPath);
      } catch {
        // ignore
      }
    }
  }

  const size = await fileSize(mergedPath);
  const recheck = await readActive();
  const duration = recheck?.durationSec ?? active.durationSec;

  // Update index
  entry.stoppedAt = new Date().toISOString();
  entry.durationSec = duration;
  entry.fileSizeBytes = size;
  await writeIndex(index);

  await stopLiveTranscriptSession(entry.id, "stopped");

  // Clean up active file
  try {
    await fs.unlink(ACTIVE_PATH);
  } catch {
    // ignore
  }

  const sizeMB = (size / (1024 * 1024)).toFixed(1);
  const sourceDiagnostics = [
    `System source: ${systemPath ? (hasSystem ? "captured" : "no audio detected") : "disabled"}${systemPath ? ` (${(systemBytes / (1024 * 1024)).toFixed(1)} MB)` : ""}`,
    `Mic source: ${micPath ? (hasMic ? "captured" : "no audio detected") : "disabled"}${micPath ? ` (${(micBytes / (1024 * 1024)).toFixed(1)} MB)` : ""}`,
  ].join("\n");
  const micHint =
    micPath && !hasMic
      ? "\nHint: Microphone track is empty. Check macOS Microphone permission and your default input device."
      : "";
  return `Recording stopped: **${entry.title}** (${duration}s, ${sizeMB} MB)\nAudio: ${mergedPath}\n${sourceDiagnostics}${micHint}\n\nUse \`meeting_record action=process meetingId=${entry.id}\` to transcribe and analyze.`;
}

async function getStatus(): Promise<string> {
  const active = await readActive();
  if (!active || active.status !== "recording") {
    return "No active recording. Use `meeting_record action=start` to begin.";
  }
  return `Recording in progress:\n- PID: ${active.pid}\n- Duration: ${active.durationSec}s\n- System audio: ${active.systemAudioPath ? "yes" : "no"}\n- Microphone: ${active.micPath ? "yes" : "no"}`;
}

async function listRecordings(params: Record<string, unknown>): Promise<string> {
  const limit = readNumberParam(params, "limit") ?? 10;
  const index = await readIndex();

  if (index.length === 0) {
    return "No recordings found.";
  }

  const entries = index.slice(0, limit);
  const lines = entries.map((e) => {
    const dur = e.durationSec ? `${Math.floor(e.durationSec / 60)}m${e.durationSec % 60}s` : "?";
    const size = e.fileSizeBytes ? `${(e.fileSizeBytes / (1024 * 1024)).toFixed(1)}MB` : "?";
    const status = e.processed ? "processed" : e.transcribed ? "transcribed" : "raw";
    return `- **${e.title}** (${e.id}) — ${dur}, ${size} [${status}]`;
  });

  return `${entries.length} recording(s):\n${lines.join("\n")}`;
}

async function processRecording(
  params: Record<string, unknown>,
  options?: { agentSessionKey?: string },
): Promise<string> {
  const meetingId = readStringParam(params, "meetingId", { required: true });
  const index = await readIndex();
  const entry = index.find((e) => e.id === meetingId);

  if (!entry) {
    return `Meeting not found: ${meetingId}`;
  }

  if (!entry.audioPath) {
    return `No audio file for meeting: ${meetingId}`;
  }

  // Check audio file exists
  const audioSize = await fileSize(entry.audioPath);
  if (audioSize === 0) {
    return `Audio file is empty or missing: ${entry.audioPath}`;
  }

  // Step 1: Transcribe
  let transcript: string;
  let transcriptModel: string | undefined;

  try {
    if (audioSize > MAX_CHUNK_BYTES) {
      // Split into chunks and transcribe each
      const chunkDir = path.join(AUDIO_DIR, `${meetingId}-chunks`);
      await fs.mkdir(chunkDir, { recursive: true });
      const chunks = await ffmpegSplit(entry.audioPath, chunkDir, 600); // 10 min chunks

      const parts: string[] = [];
      for (const chunk of chunks) {
        const result = await transcribeChunk(chunk);
        parts.push(result.text);
        if (!transcriptModel) transcriptModel = result.model;
      }
      transcript = parts.join("\n\n");

      // Clean up chunks
      for (const chunk of chunks) {
        try {
          await fs.unlink(chunk);
        } catch {
          /* ignore */
        }
      }
      try {
        await fs.rmdir(chunkDir);
      } catch {
        /* ignore */
      }
    } else {
      const result = await transcribeChunk(entry.audioPath);
      transcript = result.text;
      transcriptModel = result.model;
    }
  } catch (err) {
    return `Transcription failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!transcript.trim()) {
    return "Transcription returned empty text. The audio may not contain speech.";
  }

  const createTasks = readBooleanLikeParam(params, "createTasks", false);
  const analysis = buildMeetingAnalysis(transcript);

  // Step 2: Save transcript artifacts
  const transcriptJsonPath = path.join(TRANSCRIPTS_DIR, `${meetingId}.json`);
  const summaryMdPath = path.join(TRANSCRIPTS_DIR, `${meetingId}.summary.md`);
  const unifiedDocContent = buildUnifiedDocContent(entry, transcript, analysis);

  await fs.writeFile(
    transcriptJsonPath,
    JSON.stringify(
      { text: transcript, provider: "openai", model: transcriptModel, meetingId },
      null,
      2,
    ),
  );
  await fs.writeFile(summaryMdPath, `${unifiedDocContent}\n`);

  // Step 3: Push to DocPanel, overwriting the live transcript so the user doesn't have to switch tabs
  const docPush = await pushDocPanelDoc({
    id: `meeting-${meetingId}-live`,
    title: `Meeting Summary: ${entry.title}`,
    content: unifiedDocContent,
    tags: ["meeting", "summary", "audio", "transcript", "notes", "action-items"],
    sessionKey: options?.agentSessionKey,
  });

  // Step 4: Optional task creation from extracted action items
  let taskSummary = { requested: 0, created: 0, failed: 0 };
  if (createTasks && analysis.actionItems.length > 0) {
    taskSummary = await createTasksFromActionItems(entry, meetingId, analysis.actionItems);
  }

  // Step 5: Update index
  entry.transcribed = true;
  entry.transcriptPath = transcriptJsonPath;
  entry.processed = true;
  entry.summary = analysis.summary.slice(0, 240);
  await writeIndex(index);

  const wordCount = transcript.split(/\s+/).length;
  const failedStr = taskSummary.failed > 0 ? ` (${taskSummary.failed} failed)` : "";
  return `Meeting processing complete for **${entry!.title}**:
- Words: ~${wordCount}
- Provider: openai (${transcriptModel || "default"})
- Local summary: ${summaryMdPath}
- Document sync: ${docPush.message}
- Action items extracted: ${analysis.actionItems.length}
- Tasks created: ${taskSummary.created}/${taskSummary.requested}${failedStr}

Use \`meeting_record action=process meetingId=${meetingId} createTasks=true\` to auto-create task entries from action items.

MEDIA:${entry!.audioPath}`;
}

async function transcribeChunk(audioPath: string): Promise<{ text: string; model?: string }> {
  const buffer = await fs.readFile(audioPath);
  const ext = path.extname(audioPath).toLowerCase();
  const mime =
    ext === ".m4a"
      ? "audio/mp4"
      : ext === ".wav"
        ? "audio/wav"
        : ext === ".mp3"
          ? "audio/mpeg"
          : "audio/mp4";

  // Try to resolve API key — check env first, then provider auth
  let apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    try {
      const resolved = await resolveApiKeyForProvider({ provider: "openai" });
      apiKey = resolved.apiKey;
    } catch {
      // ignore
    }
  }

  if (!apiKey) {
    throw new Error(
      "No OpenAI API key found. Set OPENAI_API_KEY or configure openai provider in ArgentOS.",
    );
  }

  return await transcribeOpenAiCompatibleAudio({
    buffer,
    fileName: path.basename(audioPath),
    mime,
    apiKey,
    timeoutMs: 300_000,
  });
}

// ============================================================================
// Tool Export
// ============================================================================

export function createMeetingRecorderTool(options?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Meeting Recorder",
    name: "meeting_record",
    description: `Record, transcribe, and analyze meetings. Captures system audio (Zoom/Meet/Teams) and microphone.

ACTIONS:
- start: Begin recording. Options: title, systemAudio (default true), mic (default true),
  liveTranscript (default true), liveIntervalSec (default 45), micDeviceId (optional)
- stop: End recording, merge audio tracks
- status: Check if recording is active
- devices: Return microphone devices + permission status as JSON
- list: Show past recordings (optional limit, default 10)
- process: Transcribe a recording, generate notes/action items, and push docs to DocPanel. Requires meetingId.
  Optional: createTasks=true to create dashboard tasks from extracted action items.

WORKFLOW:
1. User joins a meeting → use start
2. Meeting ends → use stop
3. Process → use process with the meetingId (optionally createTasks=true)
4. Review Meeting Notes + Meeting Actions docs in DocPanel

REQUIREMENTS:
- Swift binary must be built: cd apps/argent-audio-capture && swift build -c release
- macOS 13+ with "Screen & System Audio Recording" permission
- ffmpeg installed (for audio merging)
- OpenAI API key (for transcription)`,
    parameters: MeetingRecorderSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "start":
          return textResult(await startRecording(params, options));
        case "stop":
          return textResult(await stopRecording());
        case "status":
          return textResult(await getStatus());
        case "devices":
          return textResult(await listCaptureDevices(params));
        case "list":
          return textResult(await listRecordings(params));
        case "process":
          return textResult(await processRecording(params, options));
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
