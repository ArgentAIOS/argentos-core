import fs from "node:fs/promises";
import path from "node:path";
import type { ArgentConfig } from "../config/config.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveMemorySearchConfig } from "../agents/memory-search.js";
import { resolveStateDir } from "../config/paths.js";
import { readSessionUpdatedAt, resolveDefaultSessionStorePath } from "../config/sessions.js";
import { getPgClient, setAgentContext } from "../data/pg-client.js";
import { resolveStorageConfig } from "../data/storage-config.js";
import { buildMemuLlmRunAttempts } from "./llm-config.js";

export type MemoryLaneStatus = "green" | "yellow" | "red";

export type MemoryLaneHealth = {
  status: MemoryLaneStatus;
  lastSuccessAt: string | null;
  staleHours: number | null;
  failureCount24h: number;
};

export type MemoryRecallReadinessHealth = {
  status: MemoryLaneStatus;
  lastRecallAt: string | null;
  total24h: number;
  thin24h: number;
  notReady24h: number;
  lowCoverage24h: number;
  error24h: number;
  empty24h: number;
  latestNotice?: string;
};

export type MemoryHealthSummary = {
  generatedAt: string;
  lanes: {
    memuExtraction: MemoryLaneHealth;
    contemplation: MemoryLaneHealth;
    sisConsolidation: MemoryLaneHealth;
    ragIngestion: MemoryLaneHealth;
  };
  failures24h: {
    memuParse: number;
    sisParse: number;
  };
  activeModels: {
    memu: {
      provider: string;
      model: string;
    };
    embeddings: {
      provider: string;
      model: string;
    };
  };
  recallReadiness: MemoryRecallReadinessHealth;
};

type MemoryHealthSignals = {
  lastMemuExtractionAt: string | null;
  lastContemplationAt: string | null;
  lastSisConsolidationAt: string | null;
  lastRagIngestionAt: string | null;
  memuParseFailures24h: number;
  sisParseFailures24h: number;
  memuProvider: string;
  memuModel: string;
  embeddingsProvider: string;
  embeddingsModel: string;
};

function parseIsoMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function chooseLatestIso(...values: Array<string | null | undefined>): string | null {
  let latest: { iso: string; ms: number } | null = null;
  for (const value of values) {
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
    const ms = parseIsoMs(value);
    if (ms == null) {
      continue;
    }
    if (latest == null || ms > latest.ms) {
      latest = { iso: value, ms };
    }
  }
  return latest?.iso ?? null;
}

function readContemplationSessionUpdatedIso(config: ArgentConfig): string | null {
  const agentId = resolveDefaultAgentId(config);
  const storePath = resolveDefaultSessionStorePath(agentId);
  const sessionKey = `agent:${agentId}:main:contemplation`;
  const updatedAt = readSessionUpdatedAt({ storePath, sessionKey });
  if (!Number.isFinite(updatedAt)) {
    return null;
  }
  return new Date(updatedAt as number).toISOString();
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function emptyRecallReadinessHealth(): MemoryRecallReadinessHealth {
  return {
    status: "green",
    lastRecallAt: null,
    total24h: 0,
    thin24h: 0,
    notReady24h: 0,
    lowCoverage24h: 0,
    error24h: 0,
    empty24h: 0,
  };
}

function resolveMemoryRecallTelemetryPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ARGENT_MEMORY_RECALL_TELEMETRY_PATH?.trim();
  if (override) {
    return path.resolve(override.replace(/^~(?=$|[\\/])/, env.HOME ?? process.env.HOME ?? "~"));
  }
  return path.join(resolveStateDir(env), "logs", "memory-recall.jsonl");
}

export function buildMemoryRecallReadinessHealthFromTelemetry(
  entries: Array<Record<string, unknown>>,
  nowMs = Date.now(),
): MemoryRecallReadinessHealth {
  const sinceMs = nowMs - 24 * 60 * 60 * 1000;
  const summary = emptyRecallReadinessHealth();
  let latestTs = 0;
  let latestStatus: "green" | "yellow" | "red" | "error" | null = null;

  for (const entry of entries) {
    const ts = typeof entry.ts === "number" && Number.isFinite(entry.ts) ? entry.ts : null;
    if (ts == null || ts < sinceMs || ts > nowMs + 60_000) {
      continue;
    }
    summary.total24h += 1;
    const status = entry.status === "error" ? "error" : "green";
    if (entry.status === "error") {
      summary.error24h += 1;
    }
    if (typeof entry.resultCount === "number" && entry.resultCount === 0) {
      summary.empty24h += 1;
    }

    const readiness =
      entry.readiness && typeof entry.readiness === "object"
        ? (entry.readiness as Record<string, unknown>)
        : null;
    const readinessStatus =
      readiness?.status === "red" || readiness?.status === "yellow" || readiness?.status === "green"
        ? readiness.status
        : status;
    if (readinessStatus === "yellow") {
      summary.thin24h += 1;
    } else if (readinessStatus === "red") {
      summary.notReady24h += 1;
    }
    const reasons = Array.isArray(readiness?.reasons) ? readiness.reasons : [];
    if (
      reasons.some(
        (reason) => reason === "low_type_coverage" || reason === "very_low_type_coverage",
      )
    ) {
      summary.lowCoverage24h += 1;
    }

    if (ts >= latestTs) {
      latestTs = ts;
      latestStatus = readinessStatus === "green" && status === "error" ? "error" : readinessStatus;
      summary.lastRecallAt =
        typeof entry.iso === "string" && entry.iso.trim() ? entry.iso : new Date(ts).toISOString();
      if (typeof readiness?.notice === "string" && readiness.notice.trim()) {
        summary.latestNotice = readiness.notice;
      }
    }
  }

  if (latestStatus === "red" || latestStatus === "error" || summary.notReady24h > 0) {
    summary.status = "red";
  } else if (
    latestStatus === "yellow" ||
    summary.thin24h > 0 ||
    summary.lowCoverage24h > 0 ||
    summary.error24h > 0 ||
    summary.empty24h > 0
  ) {
    summary.status = "yellow";
  }

  return summary;
}

async function collectMemoryRecallReadinessHealth(
  nowMs = Date.now(),
): Promise<MemoryRecallReadinessHealth> {
  const filePath = resolveMemoryRecallTelemetryPath();
  const raw = await fs.readFile(filePath, "utf-8").catch(() => "");
  if (!raw.trim()) {
    return emptyRecallReadinessHealth();
  }
  const entries: Array<Record<string, unknown>> = [];
  for (const line of raw.split("\n").slice(-5000)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && parsed.tool === "memory_recall") {
        entries.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed telemetry lines.
    }
  }
  return buildMemoryRecallReadinessHealthFromTelemetry(entries, nowMs);
}

export function classifyMemoryLaneStatus(params: {
  lastSuccessAt: string | null;
  failureCount24h: number;
  nowMs: number;
  yellowAfterHours: number;
  redAfterHours: number;
  yellowFailureCount?: number;
  redFailureCount?: number;
}): MemoryLaneHealth {
  const failureCount24h = clampCount(params.failureCount24h);
  const parsedMs = parseIsoMs(params.lastSuccessAt);
  const staleHours =
    parsedMs == null ? null : Math.max(0, (params.nowMs - parsedMs) / (1000 * 60 * 60));

  if (parsedMs == null) {
    return {
      status: "red",
      lastSuccessAt: null,
      staleHours: null,
      failureCount24h,
    };
  }

  const redFailureCount = params.redFailureCount ?? 5;
  const yellowFailureCount = params.yellowFailureCount ?? 1;
  const staleHoursValue = staleHours ?? 0;
  if (failureCount24h >= redFailureCount || staleHoursValue >= params.redAfterHours) {
    return {
      status: "red",
      lastSuccessAt: params.lastSuccessAt,
      staleHours,
      failureCount24h,
    };
  }
  if (failureCount24h >= yellowFailureCount || staleHoursValue >= params.yellowAfterHours) {
    return {
      status: "yellow",
      lastSuccessAt: params.lastSuccessAt,
      staleHours,
      failureCount24h,
    };
  }
  return {
    status: "green",
    lastSuccessAt: params.lastSuccessAt,
    staleHours,
    failureCount24h,
  };
}

export function buildMemoryHealthSummaryFromSignals(
  signals: MemoryHealthSignals,
  nowMs = Date.now(),
): MemoryHealthSummary {
  const memuExtraction = classifyMemoryLaneStatus({
    lastSuccessAt: signals.lastMemuExtractionAt,
    failureCount24h: signals.memuParseFailures24h,
    nowMs,
    yellowAfterHours: 6,
    redAfterHours: 24,
    yellowFailureCount: 3,
    redFailureCount: 8,
  });
  const contemplation = classifyMemoryLaneStatus({
    lastSuccessAt: signals.lastContemplationAt,
    failureCount24h: 0,
    nowMs,
    yellowAfterHours: 2,
    redAfterHours: 8,
    yellowFailureCount: 99,
    redFailureCount: 999,
  });
  const sisConsolidation = classifyMemoryLaneStatus({
    lastSuccessAt: signals.lastSisConsolidationAt,
    failureCount24h: signals.sisParseFailures24h,
    nowMs,
    yellowAfterHours: 12,
    redAfterHours: 36,
  });
  const ragIngestion = classifyMemoryLaneStatus({
    lastSuccessAt: signals.lastRagIngestionAt,
    failureCount24h: 0,
    nowMs,
    yellowAfterHours: 72,
    redAfterHours: 168,
    yellowFailureCount: 99,
    redFailureCount: 999,
  });

  return {
    generatedAt: new Date(nowMs).toISOString(),
    lanes: {
      memuExtraction,
      contemplation,
      sisConsolidation,
      ragIngestion,
    },
    failures24h: {
      memuParse: clampCount(signals.memuParseFailures24h),
      sisParse: clampCount(signals.sisParseFailures24h),
    },
    activeModels: {
      memu: {
        provider: signals.memuProvider,
        model: signals.memuModel,
      },
      embeddings: {
        provider: signals.embeddingsProvider,
        model: signals.embeddingsModel,
      },
    },
    recallReadiness: emptyRecallReadinessHealth(),
  };
}

async function collectMemoryHealthSignalsPostgres(
  config: ArgentConfig,
): Promise<MemoryHealthSignals> {
  const memuPrimaryAttempt = buildMemuLlmRunAttempts(config, { timeoutMs: 30_000 })[0];
  const memuProvider = String(memuPrimaryAttempt?.provider ?? "ollama").trim() || "ollama";
  const memuModel = String(memuPrimaryAttempt?.model ?? "qwen3:14b").trim() || "qwen3:14b";
  const storage = resolveStorageConfig(
    (config as ArgentConfig & { storage?: Parameters<typeof resolveStorageConfig>[0] }).storage,
  );
  if (!storage.postgres) {
    throw new Error("PostgreSQL configuration is required for memory health signals");
  }

  const sql = getPgClient(storage.postgres);
  const agentId = resolveDefaultAgentId(config);
  const resolvedMemorySearch = resolveMemorySearchConfig(config, agentId);
  const embeddingsProvider = String(resolvedMemorySearch?.provider ?? "ollama").trim() || "ollama";
  const embeddingsModel =
    String(resolvedMemorySearch?.model ?? "nomic-embed-text").trim() || "nomic-embed-text";
  await setAgentContext(sql, agentId);

  const lastContemplationFromSession = readContemplationSessionUpdatedIso(config);
  const lastMemuRows = await sql<{ ts: string | null }[]>`
    SELECT created_at::text as ts
    FROM model_feedback
    WHERE session_key LIKE 'temp:memu-extract:%' AND success = true
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const lastContemplationRows = await sql<{ ts: string | null }[]>`
    SELECT created_at::text as ts
    FROM model_feedback
    WHERE (session_type = 'contemplation' OR session_key LIKE '%:contemplation%')
      AND success = true
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const lastSisRows = await sql<{ ts: string | null }[]>`
    SELECT created_at::text as ts
    FROM model_feedback
    WHERE session_key LIKE '%sis-consolidation%' AND success = true
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const lastSisReflectionRows = await sql<{ ts: string | null }[]>`
    SELECT created_at::text as ts
    FROM reflections
    WHERE trigger_type = 'sis_consolidation'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const lastRagRows = await sql<{ ts: string | null }[]>`
    SELECT COALESCE(extra->>'ingestedAt', created_at::text) as ts
    FROM memory_items
    WHERE extra->>'source' = 'knowledge_ingest'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const memuParseRows = await sql<{ cnt: number }[]>`
    SELECT count(*)::int as cnt
    FROM memory_items
    WHERE memory_type = 'episode'
      AND summary LIKE '[fallback]%'
      AND created_at >= now() - interval '1 day'
  `;
  const sisAttemptsRows = await sql<{ cnt: number }[]>`
    SELECT count(*)::int as cnt
    FROM model_feedback
    WHERE session_key LIKE '%sis-consolidation%'
      AND created_at >= now() - interval '1 day'
  `;
  const sisFailuresRows = await sql<{ cnt: number }[]>`
    SELECT count(*)::int as cnt
    FROM model_feedback
    WHERE session_key LIKE '%sis-consolidation%'
      AND success = false
      AND created_at >= now() - interval '1 day'
  `;

  const sisAttempts24h = clampCount(sisAttemptsRows[0]?.cnt ?? 0);
  const sisFailures24h = clampCount(sisFailuresRows[0]?.cnt ?? 0);

  const lastContemplationAt = chooseLatestIso(
    lastContemplationRows[0]?.ts ?? null,
    lastContemplationFromSession,
  );

  return {
    lastMemuExtractionAt: lastMemuRows[0]?.ts ?? null,
    lastContemplationAt,
    lastSisConsolidationAt: lastSisRows[0]?.ts ?? lastSisReflectionRows[0]?.ts ?? null,
    lastRagIngestionAt: lastRagRows[0]?.ts ?? null,
    memuParseFailures24h: clampCount(memuParseRows[0]?.cnt ?? 0),
    sisParseFailures24h: Math.max(0, Math.min(sisAttempts24h, sisFailures24h)),
    memuProvider,
    memuModel,
    embeddingsProvider,
    embeddingsModel,
  };
}

export async function getMemoryHealthSummary(
  config: ArgentConfig,
  nowMs = Date.now(),
): Promise<MemoryHealthSummary> {
  const signals = await collectMemoryHealthSignalsPostgres(config);
  const summary = buildMemoryHealthSummaryFromSignals(signals, nowMs);
  summary.recallReadiness = await collectMemoryRecallReadinessHealth(nowMs);
  return summary;
}
