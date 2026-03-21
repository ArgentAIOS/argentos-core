/**
 * YouTube + NotebookLM Research Tool
 *
 * First-class workflow to discover recent YouTube videos and push them into
 * NotebookLM for synthesis and artifact generation.
 */

import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  type AnyAgentTool,
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
} from "./common.js";

const execFileAsync = promisify(execFile);

const DEFAULT_SEARCH_COUNT = 20;
const MAX_SEARCH_COUNT = 50;
const DEFAULT_MONTHS = 6;
const DEFAULT_SOURCE_TIMEOUT_SEC = 240;
const DEFAULT_NOTEBOOK_ASK =
  "Summarize the key themes, repeated claims, disagreements, and actionable opportunities across these sources. Provide a concise strategic brief.";
const DEFAULT_INFOGRAPHIC_PROMPT =
  "Create a handwritten blueprint style infographic that distills the top patterns, contradictions, and opportunities from these sources.";
const NOTEBOOKLM_RESEARCH_SKILL_HINT = "skills/notebooklm-research/SKILL.md";
const INSTALL_YT_DLP_COMMAND = "python3 -m pip install --user yt-dlp";
const INSTALL_NOTEBOOKLM_COMMAND = 'python3 -m pip install --user "notebooklm-py[browser]"';
const INSTALL_PLAYWRIGHT_COMMAND = "python3 -m playwright install chromium";
const NOTEBOOKLM_LOGIN_COMMAND = "notebooklm login";

const YoutubeNotebookLmSchema = Type.Object({
  action: Type.Union([
    Type.Literal("setup_status"),
    Type.Literal("youtube_search"),
    Type.Literal("notebook_create"),
    Type.Literal("notebook_add_sources"),
    Type.Literal("notebook_ask"),
    Type.Literal("notebook_generate_infographic"),
    Type.Literal("youtube_to_notebook_workflow"),
  ]),
  query: Type.Optional(Type.String({ description: "Search query for YouTube." })),
  count: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: MAX_SEARCH_COUNT,
      description: `Number of YouTube results to keep (default ${DEFAULT_SEARCH_COUNT}).`,
    }),
  ),
  months: Type.Optional(
    Type.Number({
      description: `Only include videos from the last N months (default ${DEFAULT_MONTHS}).`,
    }),
  ),
  no_date_filter: Type.Optional(
    Type.Boolean({
      description: "If true, do not filter by upload date.",
      default: false,
    }),
  ),
  notebook_title: Type.Optional(Type.String({ description: "NotebookLM notebook title." })),
  notebook_id: Type.Optional(Type.String({ description: "NotebookLM notebook ID." })),
  urls: Type.Optional(
    Type.Array(
      Type.String({
        description: "Source URLs to add (YouTube links supported natively by NotebookLM).",
      }),
    ),
  ),
  wait_for_sources: Type.Optional(
    Type.Boolean({
      description: "Wait for each source to finish ingestion.",
      default: true,
    }),
  ),
  source_timeout_sec: Type.Optional(
    Type.Number({
      minimum: 30,
      maximum: 1800,
      description: `Per-source wait timeout in seconds (default ${DEFAULT_SOURCE_TIMEOUT_SEC}).`,
    }),
  ),
  question: Type.Optional(Type.String({ description: "Question for NotebookLM ask." })),
  include_references: Type.Optional(
    Type.Boolean({
      description: "Request response with citations/references when available.",
      default: true,
    }),
  ),
  generate_infographic: Type.Optional(
    Type.Boolean({
      description: "Workflow: generate infographic after analysis.",
      default: false,
    }),
  ),
  infographic_prompt: Type.Optional(
    Type.String({ description: "Prompt for infographic generation." }),
  ),
  infographic_orientation: Type.Optional(
    Type.Union([Type.Literal("landscape"), Type.Literal("portrait"), Type.Literal("square")]),
  ),
  infographic_detail: Type.Optional(
    Type.Union([Type.Literal("concise"), Type.Literal("standard"), Type.Literal("detailed")]),
  ),
  download_infographic: Type.Optional(
    Type.Boolean({
      description: "Download infographic artifact to disk after generation.",
      default: true,
    }),
  ),
  infographic_output_path: Type.Optional(
    Type.String({
      description: "Optional local destination path for downloaded infographic PNG.",
    }),
  ),
});

type JsonObject = Record<string, unknown>;

type YoutubeRawResult = {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  channel_follower_count?: number;
  view_count?: number;
  duration?: number;
  duration_string?: string;
  upload_date?: string;
};

type YoutubeNormalizedResult = {
  id: string;
  title: string;
  channel: string;
  channel_subscribers: number | null;
  views: number | null;
  views_per_subscriber: number | null;
  duration: string;
  duration_seconds: number | null;
  upload_date: string | null;
  url: string;
};

type NotebookSourceAddRecord = {
  url: string;
  source_id: string | null;
  title: string | null;
  status: string | null;
  wait_result?: JsonObject;
};

type BinaryStatus = {
  installed: boolean;
  version?: string;
  error?: string;
};

type NotebookAuthStatus = {
  authenticated: boolean | null;
  details?: JsonObject;
  error?: string;
  check_supported?: boolean;
};

type ActionSetupRequirements = {
  yt_dlp: boolean;
  notebooklm: boolean;
  notebooklm_auth: boolean;
};

type SetupSnapshot = {
  requirements: ActionSetupRequirements;
  prerequisites: {
    yt_dlp: BinaryStatus;
    notebooklm: BinaryStatus;
    notebooklm_auth: NotebookAuthStatus;
  };
  ready: boolean;
  missing: string[];
  next_steps: string[];
};

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  } as import("../../agent-core/core.js").AgentToolResult<unknown>;
}

function readBoolean(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = params[key];
  return typeof raw === "boolean" ? raw : fallback;
}

function readStringUnion(
  params: Record<string, unknown>,
  key: string,
  allowed: string[],
): string | undefined {
  const value = readStringParam(params, key);
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new Error(`${key} must be one of: ${allowed.join(", ")}`);
  }
  return normalized;
}

function clampCount(raw: number | undefined): number {
  const value = Number.isFinite(raw) ? Math.floor(raw as number) : DEFAULT_SEARCH_COUNT;
  return Math.max(1, Math.min(MAX_SEARCH_COUNT, value));
}

function normalizeMonths(params: Record<string, unknown>): number {
  const noDateFilter = readBoolean(params, "no_date_filter", false);
  if (noDateFilter) {
    return 0;
  }
  const months = readNumberParam(params, "months", { integer: true });
  if (months === undefined) {
    return DEFAULT_MONTHS;
  }
  return Math.max(0, Math.min(48, months));
}

function cutoffDateForMonths(months: number, now = new Date()): string | null {
  if (months <= 0) {
    return null;
  }
  const cutoff = new Date(now.getTime() - months * 30 * 24 * 60 * 60 * 1000);
  const yyyy = cutoff.getFullYear();
  const mm = String(cutoff.getMonth() + 1).padStart(2, "0");
  const dd = String(cutoff.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function formatDuration(input: { duration?: number; duration_string?: string }): string {
  if (input.duration_string && input.duration_string.trim()) {
    return input.duration_string.trim();
  }
  if (
    typeof input.duration !== "number" ||
    !Number.isFinite(input.duration) ||
    input.duration < 0
  ) {
    return "N/A";
  }
  const total = Math.floor(input.duration);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) {
    return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function formatUploadDate(raw?: string): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) {
    return null;
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function shouldIncludeByDate(rawUploadDate: string | undefined, cutoffYmd: string | null): boolean {
  if (!cutoffYmd) {
    return true;
  }
  if (!rawUploadDate || !/^\d{8}$/.test(rawUploadDate)) {
    return false;
  }
  return rawUploadDate >= cutoffYmd;
}

function normalizeYoutubeResult(raw: YoutubeRawResult): YoutubeNormalizedResult {
  const id = raw.id?.trim() || "";
  const channel = raw.channel?.trim() || raw.uploader?.trim() || "Unknown channel";
  const views =
    typeof raw.view_count === "number" && Number.isFinite(raw.view_count) ? raw.view_count : null;
  const subscribers =
    typeof raw.channel_follower_count === "number" && Number.isFinite(raw.channel_follower_count)
      ? raw.channel_follower_count
      : null;
  const ratio =
    views !== null && subscribers !== null && subscribers > 0 ? views / subscribers : null;

  return {
    id,
    title: raw.title?.trim() || "Untitled",
    channel,
    channel_subscribers: subscribers,
    views,
    views_per_subscriber: ratio,
    duration: formatDuration(raw),
    duration_seconds:
      typeof raw.duration === "number" && Number.isFinite(raw.duration)
        ? Math.floor(raw.duration)
        : null,
    upload_date: formatUploadDate(raw.upload_date),
    url: id ? `https://youtube.com/watch?v=${id}` : "",
  };
}

function parseJsonOutput(rawStdout: string, context: string): unknown {
  const trimmed = rawStdout.trim();
  if (!trimmed) {
    throw new Error(`${context} returned empty output`);
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // continue
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as unknown;
    } catch {
      // keep searching
    }
  }

  const preview = trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
  throw new Error(`${context} did not return valid JSON: ${preview}`);
}

function asJsonObject(raw: unknown, context: string): JsonObject {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${context} expected JSON object output`);
  }
  return raw as JsonObject;
}

function pickString(obj: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function sanitizeNotebookTitle(title: string): string {
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "YouTube Research";
  }
  return cleaned.length > 120 ? `${cleaned.slice(0, 117).trim()}...` : cleaned;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function resolveInfographicOutputPath(params: {
  requested?: string;
  notebookTitle?: string | null;
  query?: string;
}): string {
  const requested = params.requested?.trim();
  if (requested) {
    if (requested.startsWith("~/")) {
      return path.join(os.homedir(), requested.slice(2));
    }
    return path.resolve(requested);
  }

  const baseDir = path.join(os.homedir(), "argent", "research", "notebooklm");
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(
    2,
    "0",
  )}${String(now.getSeconds()).padStart(2, "0")}`;
  const stem = slugify(params.notebookTitle || params.query || "research");
  return path.join(baseDir, `${stamp}-${stem || "notebook"}-infographic.png`);
}

async function runCommand(
  binary: string,
  args: string[],
  options?: { timeoutMs?: number },
): Promise<{ stdout: string; stderr: string }> {
  const timeout =
    typeof options?.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? Math.max(5_000, Math.floor(options.timeoutMs))
      : 120_000;

  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      timeout,
      maxBuffer: 12 * 1024 * 1024,
    });
    return { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") };
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    }
    const error = err as Error & {
      code?: string;
      stdout?: string;
      stderr?: string;
      message?: string;
      signal?: string;
      killed?: boolean;
    };
    if (error.code === "ENOENT") {
      throw new Error(`${binary} not found in PATH`, { cause: err });
    }
    const pieces = [
      error.stderr?.trim(),
      error.stdout?.trim(),
      error.killed ? `timed out (signal=${error.signal ?? "unknown"})` : undefined,
      error.message,
    ].filter((value): value is string => Boolean(value));
    const detail = pieces.join("\n").slice(0, 1200);
    throw new Error(`${binary} ${args.join(" ")} failed: ${detail || "unknown error"}`, {
      cause: err,
    });
  }
}

async function notebookJson(
  args: string[],
  context: string,
  timeoutMs = 180_000,
): Promise<JsonObject> {
  try {
    const { stdout } = await runCommand("notebooklm", args, { timeoutMs });
    const parsed = parseJsonOutput(stdout, context);
    return asJsonObject(parsed, context);
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    }
    const normalized = err.message.toLowerCase();
    if (
      normalized.includes("login") ||
      normalized.includes("auth") ||
      normalized.includes("unauthorized") ||
      normalized.includes("forbidden") ||
      normalized.includes("401") ||
      normalized.includes("403")
    ) {
      throw new Error(
        `${context} failed because NotebookLM is not authenticated. Run: notebooklm login`,
        { cause: err },
      );
    }
    throw err;
  }
}

async function notebookUse(notebookId: string): Promise<void> {
  await runCommand("notebooklm", ["use", notebookId], { timeoutMs: 60_000 });
}

async function notebookCreate(title: string): Promise<JsonObject> {
  return await notebookJson(["create", title, "--json"], "notebook create", 120_000);
}

async function notebookAddSource(url: string): Promise<JsonObject> {
  return await notebookJson(["source", "add", url, "--json"], "notebook source add", 180_000);
}

async function notebookWaitForSource(sourceId: string, timeoutSec: number): Promise<JsonObject> {
  return await notebookJson(
    ["source", "wait", sourceId, "--timeout", String(timeoutSec), "--json"],
    "notebook source wait",
    Math.max(timeoutSec * 1000 + 15_000, 60_000),
  );
}

async function notebookAsk(question: string, includeReferences: boolean): Promise<JsonObject> {
  const args = ["ask", question, "--json"];
  if (!includeReferences) {
    // Keep JSON output while allowing callers to suppress references in their final formatting logic.
    // The CLI currently includes references when available under --json output.
  }
  return await notebookJson(args, "notebook ask", 180_000);
}

async function notebookGenerateInfographic(params: {
  prompt?: string;
  orientation?: string;
  detail?: string;
  wait: boolean;
}): Promise<JsonObject> {
  const args = ["generate", "infographic"];
  if (params.prompt?.trim()) {
    args.push(params.prompt.trim());
  }
  if (params.orientation) {
    args.push("--orientation", params.orientation);
  }
  if (params.detail) {
    args.push("--detail", params.detail);
  }
  if (params.wait) {
    args.push("--wait");
  }
  args.push("--json");
  return await notebookJson(args, "notebook generate infographic", params.wait ? 600_000 : 180_000);
}

async function notebookDownloadLatestInfographic(outputPath: string): Promise<JsonObject> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  return await notebookJson(
    ["download", "infographic", outputPath, "--latest", "--force", "--json"],
    "notebook download infographic",
    300_000,
  );
}

function normalizeUrlList(urls: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    if (!/^https?:\/\//i.test(value)) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}

async function commandStatus(binary: "yt-dlp" | "notebooklm"): Promise<BinaryStatus> {
  try {
    const { stdout } = await runCommand(binary, ["--version"], { timeoutMs: 20_000 });
    const version = stdout.trim().split(/\r?\n/)[0]?.trim();
    return { installed: true, version: version || undefined };
  } catch (err) {
    return {
      installed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function inferNotebookAuthOk(raw: JsonObject): boolean | null {
  const checks = [
    raw.authenticated,
    raw.ok,
    raw.logged_in,
    raw.is_logged_in,
    raw.valid,
    raw.success,
  ];
  for (const value of checks) {
    if (typeof value === "boolean") {
      return value;
    }
  }
  const status = pickString(raw, ["status", "state", "message"]);
  if (status) {
    const normalized = status.toLowerCase();
    if (
      normalized.includes("ok") ||
      normalized.includes("authenticated") ||
      normalized.includes("logged in")
    ) {
      return true;
    }
    if (
      normalized.includes("not authenticated") ||
      normalized.includes("not logged in") ||
      normalized.includes("login required")
    ) {
      return false;
    }
  }
  return null;
}

function requirementsForAction(action: string): ActionSetupRequirements {
  switch (action) {
    case "setup_status":
      return { yt_dlp: true, notebooklm: true, notebooklm_auth: true };
    case "youtube_search":
      return { yt_dlp: true, notebooklm: false, notebooklm_auth: false };
    case "notebook_create":
    case "notebook_add_sources":
    case "notebook_ask":
    case "notebook_generate_infographic":
      return { yt_dlp: false, notebooklm: true, notebooklm_auth: true };
    case "youtube_to_notebook_workflow":
      return { yt_dlp: true, notebooklm: true, notebooklm_auth: true };
    default:
      return { yt_dlp: false, notebooklm: false, notebooklm_auth: false };
  }
}

function isAuthCheckUnsupported(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("unknown command") ||
    normalized.includes("no such command") ||
    normalized.includes("invalid choice") ||
    normalized.includes("unrecognized argument") ||
    normalized.includes("invalid arguments")
  );
}

async function resolveNotebookAuthStatus(notebookInstalled: boolean): Promise<NotebookAuthStatus> {
  if (!notebookInstalled) {
    return { authenticated: null };
  }

  try {
    const auth = await notebookJson(["auth", "check", "--json"], "notebook auth check", 60_000);
    return {
      authenticated: inferNotebookAuthOk(auth),
      details: auth,
      check_supported: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isAuthCheckUnsupported(message)) {
      return {
        authenticated: null,
        error: message,
        check_supported: false,
      };
    }
    return {
      authenticated: false,
      error: message,
      check_supported: true,
    };
  }
}

function evaluateSetupSnapshot(params: {
  requirements: ActionSetupRequirements;
  ytDlp: BinaryStatus;
  notebooklm: BinaryStatus;
  notebookAuth: NotebookAuthStatus;
}): SetupSnapshot {
  const missing: string[] = [];

  if (params.requirements.yt_dlp && !params.ytDlp.installed) {
    missing.push("yt_dlp");
  }
  if (params.requirements.notebooklm && !params.notebooklm.installed) {
    missing.push("notebooklm");
  }
  if (
    params.requirements.notebooklm_auth &&
    params.notebooklm.installed &&
    params.notebookAuth.authenticated !== true
  ) {
    missing.push("notebooklm_auth");
  }

  const nextSteps: string[] = [];
  if (params.requirements.yt_dlp && !params.ytDlp.installed) {
    nextSteps.push(INSTALL_YT_DLP_COMMAND);
  }

  if (params.requirements.notebooklm && !params.notebooklm.installed) {
    nextSteps.push(INSTALL_NOTEBOOKLM_COMMAND);
    nextSteps.push(INSTALL_PLAYWRIGHT_COMMAND);
  } else if (
    params.requirements.notebooklm_auth &&
    params.notebooklm.installed &&
    params.notebookAuth.authenticated !== true
  ) {
    nextSteps.push(NOTEBOOKLM_LOGIN_COMMAND);
  }

  return {
    requirements: params.requirements,
    prerequisites: {
      yt_dlp: params.ytDlp,
      notebooklm: params.notebooklm,
      notebooklm_auth: params.notebookAuth,
    },
    ready: missing.length === 0,
    missing,
    next_steps: nextSteps,
  };
}

async function collectSetupSnapshot(requirements: ActionSetupRequirements): Promise<SetupSnapshot> {
  const ytDlp = await commandStatus("yt-dlp");
  const notebooklm = await commandStatus("notebooklm");
  const notebookAuth = await resolveNotebookAuthStatus(
    requirements.notebooklm_auth || requirements.notebooklm ? notebooklm.installed : false,
  );
  return evaluateSetupSnapshot({
    requirements,
    ytDlp,
    notebooklm,
    notebookAuth,
  });
}

function buildSetupRequiredPayload(params: {
  action: string;
  snapshot: SetupSnapshot;
  reason?: string;
}) {
  const reason =
    params.reason ??
    `Setup required before running "${params.action}": ${params.snapshot.missing.join(", ")}`;

  return {
    ok: false,
    action: params.action,
    setupRequired: true,
    firstRunCheck: true,
    reason,
    prerequisites: params.snapshot.prerequisites,
    requirements: params.snapshot.requirements,
    missing: params.snapshot.missing,
    next_steps: params.snapshot.next_steps,
    nextStep: {
      skill: "notebooklm-research",
      skillPathHint: NOTEBOOKLM_RESEARCH_SKILL_HINT,
      guidance:
        "Run the setup commands, then call youtube_notebooklm with action=setup_status until ready=true.",
      commands: params.snapshot.next_steps,
    },
  };
}

async function runYoutubeSearch(params: { query: string; count: number; months: number }): Promise<{
  query: string;
  requested_count: number;
  fetched_count: number;
  cutoff_upload_date: string | null;
  filtered_out: number;
  results: YoutubeNormalizedResult[];
}> {
  const fetchCount = params.months > 0 ? Math.min(params.count * 3, 200) : params.count;
  const searchExpr = `ytsearch${fetchCount}:${params.query}`;

  const { stdout } = await runCommand(
    "yt-dlp",
    [searchExpr, "--dump-json", "--no-download", "--no-warnings", "--quiet"],
    { timeoutMs: 180_000 },
  );

  const rawEntries = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return [];
        }
        return [parsed as YoutubeRawResult];
      } catch {
        return [];
      }
    });

  if (rawEntries.length === 0) {
    return {
      query: params.query,
      requested_count: params.count,
      fetched_count: 0,
      cutoff_upload_date: cutoffDateForMonths(params.months),
      filtered_out: 0,
      results: [],
    };
  }

  const cutoff = cutoffDateForMonths(params.months);
  const filtered = rawEntries.filter((entry) => shouldIncludeByDate(entry.upload_date, cutoff));
  const normalized = filtered.map(normalizeYoutubeResult).filter((entry) => Boolean(entry.url));

  return {
    query: params.query,
    requested_count: params.count,
    fetched_count: rawEntries.length,
    cutoff_upload_date: cutoff,
    filtered_out: rawEntries.length - filtered.length,
    results: normalized.slice(0, params.count),
  };
}

async function addSourcesToNotebook(params: {
  notebookId: string;
  urls: string[];
  waitForSources: boolean;
  sourceTimeoutSec: number;
}): Promise<{ added: NotebookSourceAddRecord[]; failed: Array<{ url: string; error: string }> }> {
  await notebookUse(params.notebookId);

  const added: NotebookSourceAddRecord[] = [];
  const failed: Array<{ url: string; error: string }> = [];

  for (const url of params.urls) {
    try {
      const created = await notebookAddSource(url);
      const sourceId = pickString(created, ["source_id", "id"]);
      const status = pickString(created, ["status"]);
      const title = pickString(created, ["title", "name"]);
      const record: NotebookSourceAddRecord = {
        url,
        source_id: sourceId,
        status,
        title,
      };

      if (params.waitForSources && sourceId) {
        try {
          const waitResult = await notebookWaitForSource(sourceId, params.sourceTimeoutSec);
          record.wait_result = waitResult;
        } catch (err) {
          failed.push({
            url,
            error: `source wait failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      added.push(record);
    } catch (err) {
      failed.push({ url, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { added, failed };
}

export function createYoutubeNotebookLmTool(): AnyAgentTool {
  return {
    label: "YouTube + NotebookLM",
    name: "youtube_notebooklm",
    description: `Research and synthesis tool that bridges YouTube discovery with NotebookLM analysis.

Actions:
- setup_status: Check local prerequisite/install/auth status and return next setup commands.
- youtube_search: Search YouTube using yt-dlp with optional recency filtering.
- notebook_create: Create a NotebookLM notebook.
- notebook_add_sources: Add one or more URLs to a notebook and optionally wait for ingestion.
- notebook_ask: Ask NotebookLM a question against notebook sources.
- notebook_generate_infographic: Generate + optionally download a NotebookLM infographic.
- youtube_to_notebook_workflow: End-to-end flow (search YouTube -> create notebook -> ingest sources -> ask -> optional infographic).

Dependencies:
- yt-dlp on PATH (for YouTube search)
- notebooklm CLI on PATH (pip install "notebooklm-py[browser]")
- notebooklm authenticated session (run notebooklm login once)

First-run guard:
- Actions automatically check setup state and return setupRequired=true with
  exact next steps when prerequisites/auth are missing.`,
    parameters: YoutubeNotebookLmSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        const requirements = requirementsForAction(action);
        const needsSetupCheck =
          requirements.yt_dlp || requirements.notebooklm || requirements.notebooklm_auth;

        if (needsSetupCheck) {
          const setup = await collectSetupSnapshot(requirements);

          if (action === "setup_status") {
            return jsonResult({
              ok: setup.ready,
              action,
              setupRequired: !setup.ready,
              firstRunCheck: true,
              prerequisites: setup.prerequisites,
              requirements: setup.requirements,
              missing: setup.missing,
              ready: setup.ready,
              next_steps: setup.next_steps,
            });
          }

          if (!setup.ready) {
            return jsonResult(buildSetupRequiredPayload({ action, snapshot: setup }));
          }
        }

        if (action === "youtube_search") {
          const query = readStringParam(params, "query", { required: true });
          const count = clampCount(readNumberParam(params, "count", { integer: true }));
          const months = normalizeMonths(params);
          const result = await runYoutubeSearch({ query, count, months });
          return jsonResult({ action, ...result });
        }

        if (action === "notebook_create") {
          const titleRaw =
            readStringParam(params, "notebook_title") ||
            readStringParam(params, "query") ||
            "YouTube Research";
          const title = sanitizeNotebookTitle(titleRaw);
          const created = await notebookCreate(title);
          return jsonResult({
            action,
            notebook: {
              id: pickString(created, ["id", "notebook_id"]),
              title: pickString(created, ["title", "name"]) ?? title,
              raw: created,
            },
          });
        }

        if (action === "notebook_add_sources") {
          const notebookId = readStringParam(params, "notebook_id", { required: true });
          const urls = normalizeUrlList(readStringArrayParam(params, "urls", { required: true }));
          if (urls.length === 0) {
            throw new Error("urls must include at least one http(s) URL");
          }
          const waitForSources = readBoolean(params, "wait_for_sources", true);
          const sourceTimeoutSec =
            readNumberParam(params, "source_timeout_sec", { integer: true }) ??
            DEFAULT_SOURCE_TIMEOUT_SEC;

          const ingestion = await addSourcesToNotebook({
            notebookId,
            urls,
            waitForSources,
            sourceTimeoutSec: Math.max(30, Math.min(1800, sourceTimeoutSec)),
          });

          return jsonResult({
            action,
            notebook_id: notebookId,
            requested_urls: urls.length,
            added_count: ingestion.added.length,
            failed_count: ingestion.failed.length,
            added: ingestion.added,
            failed: ingestion.failed,
          });
        }

        if (action === "notebook_ask") {
          const notebookId = readStringParam(params, "notebook_id", { required: true });
          const question = readStringParam(params, "question", { required: true });
          const includeReferences = readBoolean(params, "include_references", true);
          await notebookUse(notebookId);
          const answer = await notebookAsk(question, includeReferences);

          return jsonResult({
            action,
            notebook_id: notebookId,
            question,
            answer,
          });
        }

        if (action === "notebook_generate_infographic") {
          const notebookId = readStringParam(params, "notebook_id", { required: true });
          const prompt =
            readStringParam(params, "infographic_prompt") || DEFAULT_INFOGRAPHIC_PROMPT;
          const orientation = readStringUnion(params, "infographic_orientation", [
            "landscape",
            "portrait",
            "square",
          ]);
          const detail = readStringUnion(params, "infographic_detail", [
            "concise",
            "standard",
            "detailed",
          ]);
          const wait = true;
          const shouldDownload = readBoolean(params, "download_infographic", true);

          await notebookUse(notebookId);
          const generated = await notebookGenerateInfographic({
            prompt,
            orientation,
            detail,
            wait,
          });

          let downloaded: JsonObject | null = null;
          let outputPath: string | null = null;
          if (shouldDownload) {
            outputPath = resolveInfographicOutputPath({
              requested: readStringParam(params, "infographic_output_path"),
              notebookTitle: pickString(generated, ["title", "name"]),
              query: readStringParam(params, "query"),
            });
            downloaded = await notebookDownloadLatestInfographic(outputPath);
          }

          return jsonResult({
            action,
            notebook_id: notebookId,
            generated,
            downloaded,
            output_path: outputPath,
          });
        }

        if (action === "youtube_to_notebook_workflow") {
          const query = readStringParam(params, "query", { required: true });
          const count = clampCount(readNumberParam(params, "count", { integer: true }) ?? 10);
          const months = normalizeMonths(params);
          const waitForSources = readBoolean(params, "wait_for_sources", true);
          const sourceTimeoutSec =
            readNumberParam(params, "source_timeout_sec", { integer: true }) ??
            DEFAULT_SOURCE_TIMEOUT_SEC;
          const generateInfographic = readBoolean(params, "generate_infographic", false);

          const search = await runYoutubeSearch({ query, count, months });
          if (search.results.length === 0) {
            return jsonResult({
              action,
              query,
              message: "No YouTube results found for this query/date filter.",
              search,
            });
          }

          const notebookTitle = sanitizeNotebookTitle(
            readStringParam(params, "notebook_title") || `YouTube Research: ${query}`,
          );
          const created = await notebookCreate(notebookTitle);
          const notebookId = pickString(created, ["id", "notebook_id"]);
          if (!notebookId) {
            throw new Error("notebook create did not return a notebook id");
          }

          const urls = search.results.map((entry) => entry.url).filter(Boolean);
          const ingestion = await addSourcesToNotebook({
            notebookId,
            urls,
            waitForSources,
            sourceTimeoutSec: Math.max(30, Math.min(1800, sourceTimeoutSec)),
          });

          await notebookUse(notebookId);
          const question = readStringParam(params, "question") || DEFAULT_NOTEBOOK_ASK;
          const analysis = await notebookAsk(question, true);

          let infographic: JsonObject | null = null;
          let infographicDownload: JsonObject | null = null;
          let infographicPath: string | null = null;

          if (generateInfographic) {
            const prompt =
              readStringParam(params, "infographic_prompt") || DEFAULT_INFOGRAPHIC_PROMPT;
            const orientation = readStringUnion(params, "infographic_orientation", [
              "landscape",
              "portrait",
              "square",
            ]);
            const detail = readStringUnion(params, "infographic_detail", [
              "concise",
              "standard",
              "detailed",
            ]);
            infographic = await notebookGenerateInfographic({
              prompt,
              orientation,
              detail,
              wait: true,
            });

            if (readBoolean(params, "download_infographic", true)) {
              infographicPath = resolveInfographicOutputPath({
                requested: readStringParam(params, "infographic_output_path"),
                notebookTitle,
                query,
              });
              infographicDownload = await notebookDownloadLatestInfographic(infographicPath);
            }
          }

          return jsonResult({
            action,
            query,
            notebook: {
              id: notebookId,
              title: pickString(created, ["title", "name"]) ?? notebookTitle,
            },
            search,
            ingestion,
            analysis,
            infographic,
            infographic_download: infographicDownload,
            infographic_output_path: infographicPath,
          });
        }

        return textResult(
          "Unknown action. Use: setup_status, youtube_search, notebook_create, notebook_add_sources, notebook_ask, notebook_generate_infographic, youtube_to_notebook_workflow",
        );
      } catch (err) {
        return textResult(
          `youtube_notebooklm error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

export const __testing = {
  cutoffDateForMonths,
  evaluateSetupSnapshot,
  formatDuration,
  formatUploadDate,
  isAuthCheckUnsupported,
  normalizeYoutubeResult,
  parseJsonOutput,
  requirementsForAction,
  sanitizeNotebookTitle,
  resolveInfographicOutputPath,
} as const;
