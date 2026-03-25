import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { parseBooleanValue } from "../../utils/boolean.js";

export type MemoryRecallTelemetryTopResult = {
  id?: string;
  type?: string;
  summary: string;
  score?: number;
};

export type MemoryRecallTelemetryAnswer = {
  value: string;
  strategy: string;
  confidence: number;
  sourceId?: string;
  sourceType?: string;
  sourceSummary?: string;
};

export type MemoryRecallTelemetryCoverage = {
  typesReturned?: Record<string, number>;
  typesMissing?: string[];
  entitiesMatched?: string[];
  coverageScore?: number;
  twoPassUsed?: boolean;
  twoPassAttempted?: boolean;
  twoPassTypesSearched?: string[];
  twoPassReason?: string;
};

export type MemoryRecallTelemetryMeta = {
  queryVariants?: string[];
  timelineWindow?: {
    granularity?: string;
    label: string;
    isoDate: string;
    endIsoDate?: string;
  };
  manualPropertyCandidates?: number;
  manualProjectCandidates?: number;
  manualTimelineCandidates?: number;
  preRerankTop?: MemoryRecallTelemetryTopResult[];
  postRerankTop?: MemoryRecallTelemetryTopResult[];
  answerStrategy?: string | null;
  answerSourceId?: string | null;
  vectorFallbackUsed?: boolean;
  observationFallbackUsed?: boolean;
  observationFallbackQueries?: string[];
  observationFallbackCount?: number;
  knowledgeFallbackUsed?: boolean;
  knowledgeFallbackQueries?: string[];
  knowledgeFallbackCount?: number;
};

export type MemoryRecallTelemetryEntry = {
  version: 1;
  ts: number;
  iso: string;
  status: "ok" | "error";
  tool: "memory_recall";
  toolCallId?: string;
  agentId?: string;
  query: string;
  requestedMode: string;
  resolvedMode?: string;
  queryClass?: string;
  deep?: boolean;
  entityFilter?: string;
  collectionFilters?: string[];
  includeCoverage?: boolean;
  minTypeCoverage?: number;
  resultCount?: number;
  answer?: MemoryRecallTelemetryAnswer;
  recallFallback?: {
    used: boolean;
    type?: string;
    reason?: string;
    added?: number;
  };
  coverage?: MemoryRecallTelemetryCoverage;
  recallTelemetry?: MemoryRecallTelemetryMeta;
  topResults?: MemoryRecallTelemetryTopResult[];
  modeEscalationReason?: string;
  error?: string;
};

export type MemoryRecallTelemetrySummary = {
  total: number;
  ok: number;
  error: number;
  answered: number;
  empty: number;
  vectorFallbacks: number;
  queryClasses: Record<string, number>;
  answerStrategies: Record<string, number>;
  resolvedModes: Record<string, number>;
};

const DEFAULT_MAX_BYTES = 5_000_000;
const DEFAULT_KEEP_LINES = 5_000;
const writesByPath = new Map<string, Promise<void>>();

function truncateText(value: string | undefined, max = 280): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 1))}...`;
}

function sanitizeTopResults(
  results: MemoryRecallTelemetryTopResult[] | undefined,
): MemoryRecallTelemetryTopResult[] | undefined {
  if (!Array.isArray(results) || results.length === 0) {
    return undefined;
  }
  return results.slice(0, 8).map((result) => ({
    id: typeof result.id === "string" && result.id.trim() ? result.id : undefined,
    type: typeof result.type === "string" && result.type.trim() ? result.type : undefined,
    summary: truncateText(String(result.summary ?? ""), 240) ?? "",
    score:
      typeof result.score === "number" && Number.isFinite(result.score) ? result.score : undefined,
  }));
}

function sanitizeCoverage(
  coverage: MemoryRecallTelemetryCoverage | undefined,
): MemoryRecallTelemetryCoverage | undefined {
  if (!coverage || typeof coverage !== "object") {
    return undefined;
  }
  return {
    typesReturned: coverage.typesReturned,
    typesMissing: Array.isArray(coverage.typesMissing)
      ? coverage.typesMissing.slice(0, 16)
      : undefined,
    entitiesMatched: Array.isArray(coverage.entitiesMatched)
      ? coverage.entitiesMatched.slice(0, 16).map((value) => truncateText(value, 80) ?? "")
      : undefined,
    coverageScore:
      typeof coverage.coverageScore === "number" && Number.isFinite(coverage.coverageScore)
        ? coverage.coverageScore
        : undefined,
    twoPassUsed: coverage.twoPassUsed,
    twoPassAttempted: coverage.twoPassAttempted,
    twoPassTypesSearched: Array.isArray(coverage.twoPassTypesSearched)
      ? coverage.twoPassTypesSearched.slice(0, 16)
      : undefined,
    twoPassReason: truncateText(coverage.twoPassReason, 120),
  };
}

function sanitizeAnswer(
  answer: MemoryRecallTelemetryAnswer | undefined,
): MemoryRecallTelemetryAnswer | undefined {
  if (!answer || typeof answer !== "object") {
    return undefined;
  }
  return {
    value: truncateText(answer.value, 200) ?? "",
    strategy: truncateText(answer.strategy, 64) ?? "unknown",
    confidence:
      typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
        ? Math.round(answer.confidence * 1000) / 1000
        : 0,
    sourceId: truncateText(answer.sourceId, 80),
    sourceType: truncateText(answer.sourceType, 64),
    sourceSummary: truncateText(answer.sourceSummary, 240),
  };
}

export function resolveMemoryRecallTelemetryPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ARGENT_MEMORY_RECALL_TELEMETRY_PATH?.trim();
  if (override) {
    return path.resolve(override.replace(/^~(?=$|[\\/])/, process.env.HOME ?? "~"));
  }
  return path.join(resolveStateDir(env), "logs", "memory-recall.jsonl");
}

export function isMemoryRecallTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = parseBooleanValue(env.ARGENT_MEMORY_RECALL_TELEMETRY);
  return flag ?? true;
}

async function pruneIfNeeded(filePath: string, opts: { maxBytes: number; keepLines: number }) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || stat.size <= opts.maxBytes) {
    return;
  }

  const raw = await fs.readFile(filePath, "utf-8").catch(() => "");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const kept = lines.slice(Math.max(0, lines.length - opts.keepLines));
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(tmp, `${kept.join("\n")}\n`, "utf-8");
  await fs.rename(tmp, filePath);
}

function sanitizeEntry(entry: MemoryRecallTelemetryEntry): MemoryRecallTelemetryEntry {
  return {
    version: 1,
    ts: entry.ts,
    iso: entry.iso,
    status: entry.status,
    tool: "memory_recall",
    toolCallId: truncateText(entry.toolCallId, 80),
    agentId: truncateText(entry.agentId, 80),
    query: truncateText(entry.query, 400) ?? "",
    requestedMode: truncateText(entry.requestedMode, 64) ?? "general",
    resolvedMode: truncateText(entry.resolvedMode, 64),
    queryClass: truncateText(entry.queryClass, 64),
    deep: entry.deep,
    entityFilter: truncateText(entry.entityFilter, 120),
    collectionFilters: Array.isArray(entry.collectionFilters)
      ? entry.collectionFilters.slice(0, 8).map((value) => truncateText(value, 80) ?? "")
      : undefined,
    includeCoverage: entry.includeCoverage,
    minTypeCoverage:
      typeof entry.minTypeCoverage === "number" && Number.isFinite(entry.minTypeCoverage)
        ? entry.minTypeCoverage
        : undefined,
    resultCount:
      typeof entry.resultCount === "number" && Number.isFinite(entry.resultCount)
        ? entry.resultCount
        : undefined,
    answer: sanitizeAnswer(entry.answer),
    recallFallback: entry.recallFallback
      ? {
          used: entry.recallFallback.used === true,
          type: truncateText(entry.recallFallback.type, 32),
          reason: truncateText(entry.recallFallback.reason, 80),
          added:
            typeof entry.recallFallback.added === "number" &&
            Number.isFinite(entry.recallFallback.added)
              ? entry.recallFallback.added
              : undefined,
        }
      : undefined,
    coverage: sanitizeCoverage(entry.coverage),
    recallTelemetry: entry.recallTelemetry
      ? {
          queryVariants: Array.isArray(entry.recallTelemetry.queryVariants)
            ? entry.recallTelemetry.queryVariants
                .slice(0, 16)
                .map((value) => truncateText(value, 120) ?? "")
            : undefined,
          timelineWindow: entry.recallTelemetry.timelineWindow
            ? {
                granularity: truncateText(entry.recallTelemetry.timelineWindow.granularity, 16),
                label: truncateText(entry.recallTelemetry.timelineWindow.label, 120) ?? "",
                isoDate: truncateText(entry.recallTelemetry.timelineWindow.isoDate, 32) ?? "",
                endIsoDate: truncateText(entry.recallTelemetry.timelineWindow.endIsoDate, 32),
              }
            : undefined,
          manualPropertyCandidates:
            typeof entry.recallTelemetry.manualPropertyCandidates === "number" &&
            Number.isFinite(entry.recallTelemetry.manualPropertyCandidates)
              ? entry.recallTelemetry.manualPropertyCandidates
              : undefined,
          manualProjectCandidates:
            typeof entry.recallTelemetry.manualProjectCandidates === "number" &&
            Number.isFinite(entry.recallTelemetry.manualProjectCandidates)
              ? entry.recallTelemetry.manualProjectCandidates
              : undefined,
          manualTimelineCandidates:
            typeof entry.recallTelemetry.manualTimelineCandidates === "number" &&
            Number.isFinite(entry.recallTelemetry.manualTimelineCandidates)
              ? entry.recallTelemetry.manualTimelineCandidates
              : undefined,
          preRerankTop: sanitizeTopResults(entry.recallTelemetry.preRerankTop),
          postRerankTop: sanitizeTopResults(entry.recallTelemetry.postRerankTop),
          answerStrategy:
            truncateText(entry.recallTelemetry.answerStrategy ?? undefined, 64) ?? null,
          answerSourceId:
            truncateText(entry.recallTelemetry.answerSourceId ?? undefined, 80) ?? null,
          vectorFallbackUsed: entry.recallTelemetry.vectorFallbackUsed,
          observationFallbackUsed: entry.recallTelemetry.observationFallbackUsed,
          observationFallbackQueries: Array.isArray(
            entry.recallTelemetry.observationFallbackQueries,
          )
            ? entry.recallTelemetry.observationFallbackQueries
                .slice(0, 12)
                .map((value) => truncateText(value, 120) ?? "")
            : undefined,
          observationFallbackCount:
            typeof entry.recallTelemetry.observationFallbackCount === "number" &&
            Number.isFinite(entry.recallTelemetry.observationFallbackCount)
              ? entry.recallTelemetry.observationFallbackCount
              : undefined,
          knowledgeFallbackUsed: entry.recallTelemetry.knowledgeFallbackUsed,
          knowledgeFallbackQueries: Array.isArray(entry.recallTelemetry.knowledgeFallbackQueries)
            ? entry.recallTelemetry.knowledgeFallbackQueries
                .slice(0, 12)
                .map((value) => truncateText(value, 120) ?? "")
            : undefined,
          knowledgeFallbackCount:
            typeof entry.recallTelemetry.knowledgeFallbackCount === "number" &&
            Number.isFinite(entry.recallTelemetry.knowledgeFallbackCount)
              ? entry.recallTelemetry.knowledgeFallbackCount
              : undefined,
        }
      : undefined,
    topResults: sanitizeTopResults(entry.topResults),
    modeEscalationReason: truncateText(entry.modeEscalationReason, 120),
    error: truncateText(entry.error, 240),
  };
}

export async function appendMemoryRecallTelemetry(
  entry: MemoryRecallTelemetryEntry,
  opts?: {
    filePath?: string;
    env?: NodeJS.ProcessEnv;
    maxBytes?: number;
    keepLines?: number;
  },
) {
  const env = opts?.env ?? process.env;
  if (!isMemoryRecallTelemetryEnabled(env)) {
    return;
  }
  const filePath = path.resolve(opts?.filePath ?? resolveMemoryRecallTelemetryPath(env));
  const serialized = `${JSON.stringify(sanitizeEntry(entry))}\n`;
  const prev = writesByPath.get(filePath) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, serialized, "utf-8");
      await pruneIfNeeded(filePath, {
        maxBytes: opts?.maxBytes ?? DEFAULT_MAX_BYTES,
        keepLines: opts?.keepLines ?? DEFAULT_KEEP_LINES,
      });
    });
  writesByPath.set(filePath, next);
  await next;
}

export async function readMemoryRecallTelemetryEntries(params?: {
  filePath?: string;
  env?: NodeJS.ProcessEnv;
  limit?: number;
  sinceTs?: number;
  queryClass?: string;
  status?: "ok" | "error";
  agentId?: string;
}): Promise<MemoryRecallTelemetryEntry[]> {
  const env = params?.env ?? process.env;
  const filePath = path.resolve(params?.filePath ?? resolveMemoryRecallTelemetryPath(env));
  const limit = Math.max(1, Math.min(10_000, Math.floor(params?.limit ?? 200)));
  const sinceTs =
    typeof params?.sinceTs === "number" && Number.isFinite(params.sinceTs)
      ? params.sinceTs
      : undefined;
  const queryClass = params?.queryClass?.trim() || undefined;
  const status = params?.status;
  const agentId = params?.agentId?.trim() || undefined;
  const raw = await fs.readFile(filePath, "utf-8").catch(() => "");
  if (!raw.trim()) {
    return [];
  }

  const parsed: MemoryRecallTelemetryEntry[] = [];
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0 && parsed.length < limit; i--) {
    const line = lines[i]?.trim();
    if (!line) {
      continue;
    }
    try {
      const obj = JSON.parse(line) as Partial<MemoryRecallTelemetryEntry> | null;
      if (!obj || typeof obj !== "object") {
        continue;
      }
      if (obj.tool !== "memory_recall") {
        continue;
      }
      if (obj.version !== 1) {
        continue;
      }
      if (typeof obj.ts !== "number" || !Number.isFinite(obj.ts)) {
        continue;
      }
      if (typeof obj.iso !== "string" || !obj.iso.trim()) {
        continue;
      }
      if (obj.status !== "ok" && obj.status !== "error") {
        continue;
      }
      if (typeof obj.query !== "string" || !obj.query.trim()) {
        continue;
      }
      if (sinceTs !== undefined && obj.ts < sinceTs) {
        continue;
      }
      if (queryClass && obj.queryClass !== queryClass) {
        continue;
      }
      if (status && obj.status !== status) {
        continue;
      }
      if (agentId && obj.agentId !== agentId) {
        continue;
      }
      parsed.push(obj as MemoryRecallTelemetryEntry);
    } catch {
      // ignore invalid lines
    }
  }
  return parsed.toReversed();
}

export function summarizeMemoryRecallTelemetry(
  entries: MemoryRecallTelemetryEntry[],
): MemoryRecallTelemetrySummary {
  const summary: MemoryRecallTelemetrySummary = {
    total: entries.length,
    ok: 0,
    error: 0,
    answered: 0,
    empty: 0,
    vectorFallbacks: 0,
    queryClasses: {},
    answerStrategies: {},
    resolvedModes: {},
  };

  for (const entry of entries) {
    if (entry.status === "ok") {
      summary.ok += 1;
    } else {
      summary.error += 1;
    }
    if ((entry.resultCount ?? 0) === 0) {
      summary.empty += 1;
    }
    if (entry.answer?.strategy) {
      summary.answered += 1;
      summary.answerStrategies[entry.answer.strategy] =
        (summary.answerStrategies[entry.answer.strategy] ?? 0) + 1;
    }
    if (entry.recallFallback?.used) {
      summary.vectorFallbacks += 1;
    }
    if (entry.queryClass) {
      summary.queryClasses[entry.queryClass] = (summary.queryClasses[entry.queryClass] ?? 0) + 1;
    }
    if (entry.resolvedMode) {
      summary.resolvedModes[entry.resolvedMode] =
        (summary.resolvedModes[entry.resolvedMode] ?? 0) + 1;
    }
  }

  return summary;
}
