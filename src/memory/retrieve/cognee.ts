import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ArgentConfig } from "../../config/config.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_MODES: CogneeSearchMode[] = ["GRAPH_COMPLETION", "INSIGHTS", "SIMILARITY"];
const AOS_PERMISSION_MODE = "readonly";

const ALLOWED_MODES = new Set<CogneeSearchMode>([
  "SIMILARITY",
  "GRAPH_COMPLETION",
  "CHUNKS",
  "SUMMARIES",
  "INSIGHTS",
]);

export type CogneeSearchMode =
  | "SIMILARITY"
  | "GRAPH_COMPLETION"
  | "CHUNKS"
  | "SUMMARIES"
  | "INSIGHTS";

export type CogneeTriggerReason = "sufficiency_fail" | "structural_query";

export type CogneeSearchHit = {
  summary: string;
  score: number;
  source?: string;
  vaultPath?: string;
};

export type CogneeSearchResult = {
  used: boolean;
  trigger?: CogneeTriggerReason;
  mode?: CogneeSearchMode;
  error?: string;
  results: CogneeSearchHit[];
};

export type CogneeSupplementHit = {
  summary: string;
  source?: string;
  vaultPath?: string;
  cogneeScore: number;
  normalizedScore: number;
  overlapScore: number;
  mergedScore: number;
};

export function isCogneeStructuralQuery(query: string): boolean {
  const text = query.toLowerCase();
  if (!text.trim()) return false;

  const hasRelationToken =
    /\b(connect|connection|relate|relationship|linked|tie|dependency|between)\b/u.test(text);
  const hasComparePattern =
    /\bhow\b.*\b(connect|relate|linked)\b/u.test(text) ||
    /\bwhat\b.*\bbetween\b/u.test(text) ||
    /\blink\b.*\band\b/u.test(text);

  return hasRelationToken || hasComparePattern;
}

export function resolveCogneeTrigger(params: {
  config?: ArgentConfig;
  query: string;
  sufficiencyFailed: boolean;
}): CogneeTriggerReason | null {
  const retrieval = params.config?.memory?.cognee?.retrieval;
  const cogneeEnabled =
    params.config?.memory?.cognee?.enabled === true && retrieval?.enabled === true;
  if (!cogneeEnabled) return null;

  const triggerOnSufficiencyFail = retrieval?.triggerOnSufficiencyFail ?? true;
  if (params.sufficiencyFailed && triggerOnSufficiencyFail) {
    return "sufficiency_fail";
  }

  const triggerOnStructuralQuery = retrieval?.triggerOnStructuralQuery ?? true;
  if (isCogneeStructuralQuery(params.query) && triggerOnStructuralQuery) {
    return "structural_query";
  }

  return null;
}

export function resolveCogneeSearchModes(config?: ArgentConfig): CogneeSearchMode[] {
  const configured = config?.memory?.cognee?.retrieval?.searchModes ?? [];
  const normalized = configured
    .map((mode) => mode.trim().toUpperCase())
    .filter((mode): mode is CogneeSearchMode => ALLOWED_MODES.has(mode as CogneeSearchMode));
  return normalized.length > 0 ? normalized : DEFAULT_MODES;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unwrapAosEnvelope(raw: unknown): { payload: unknown; error?: string } {
  if (!raw || typeof raw !== "object") {
    return { payload: raw };
  }

  const record = raw as Record<string, unknown>;
  if (typeof record.ok !== "boolean") {
    return { payload: raw };
  }
  if (record.ok) {
    return { payload: record.data };
  }

  const errorRecord = record.error;
  if (typeof errorRecord === "string" && errorRecord.trim().length > 0) {
    return { payload: [], error: errorRecord.trim() };
  }
  if (errorRecord && typeof errorRecord === "object") {
    const parsed = errorRecord as Record<string, unknown>;
    const code = typeof parsed.code === "string" ? parsed.code : undefined;
    const message = typeof parsed.message === "string" ? parsed.message : undefined;
    if (code && message) {
      return { payload: [], error: `${code}: ${message}` };
    }
    if (message) {
      return { payload: [], error: message };
    }
    if (code) {
      return { payload: [], error: code };
    }
  }
  return { payload: [], error: "aos-cognee returned ok=false" };
}

function buildAosContractArgs(query: string, mode: CogneeSearchMode): string[] {
  return ["--json", "--mode", AOS_PERMISSION_MODE, "search", query, "--search-mode", mode];
}

function buildLegacyArgs(query: string, mode: CogneeSearchMode): string[] {
  return ["search", query, "--mode", mode, "--json"];
}

function normalizeCogneeSearchHits(raw: unknown, maxResults: number): CogneeSearchHit[] {
  const payload =
    raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown[] }).results)
      ? (raw as { results: unknown[] }).results
      : raw && typeof raw === "object" && Array.isArray((raw as { hits?: unknown[] }).hits)
        ? (raw as { hits: unknown[] }).hits
        : Array.isArray(raw)
          ? raw
          : [];

  const hits: CogneeSearchHit[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const summary = [record.summary, record.text, record.content, record.entity]
      .find((value) => typeof value === "string" && value.trim().length > 0)
      ?.toString()
      .trim();
    if (!summary) continue;
    const scoreRaw = record.score;
    const score = typeof scoreRaw === "number" && Number.isFinite(scoreRaw) ? scoreRaw : 0;
    const source = typeof record.source === "string" ? record.source : undefined;
    const vaultPath =
      typeof record.vaultPath === "string"
        ? record.vaultPath
        : typeof record.sourceVaultPath === "string"
          ? record.sourceVaultPath
          : undefined;
    hits.push({ summary, score, source, vaultPath });
    if (hits.length >= maxResults) break;
  }
  return hits;
}

function tokenizeForOverlap(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function buildCogneeSupplement(params: {
  memuSummaries: string[];
  cogneeHits: CogneeSearchHit[];
  limit?: number;
}): CogneeSupplementHit[] {
  const limit = Math.max(1, params.limit ?? 5);
  if (params.cogneeHits.length === 0) return [];

  const maxRawScore = params.cogneeHits.reduce(
    (current, hit) => (hit.score > current ? hit.score : current),
    0,
  );
  const memuTokenSet = new Set(tokenizeForOverlap(params.memuSummaries.join(" ")));

  const merged = params.cogneeHits.map((hit) => {
    const normalizedScore = maxRawScore > 0 ? clampScore(hit.score / maxRawScore) : 0;
    const hitTokens = tokenizeForOverlap(hit.summary);
    let overlapScore = 0;
    if (hitTokens.length > 0 && memuTokenSet.size > 0) {
      let overlapCount = 0;
      for (const token of hitTokens) {
        if (memuTokenSet.has(token)) overlapCount += 1;
      }
      overlapScore = clampScore(overlapCount / hitTokens.length);
    }

    // Keep Cognee as primary signal while allowing MemU overlap to break close scores.
    const mergedScore = clampScore(normalizedScore * 0.55 + overlapScore * 0.45);
    return {
      summary: hit.summary,
      source: hit.source,
      vaultPath: hit.vaultPath,
      cogneeScore: hit.score,
      normalizedScore,
      overlapScore,
      mergedScore,
    };
  });

  merged.sort((a, b) => b.mergedScore - a.mergedScore);
  return merged.slice(0, limit);
}

export async function runCogneeSearch(params: {
  config?: ArgentConfig;
  query: string;
  sufficiencyFailed: boolean;
  commandRunner?: (command: string, args: string[], timeoutMs: number) => Promise<string>;
}): Promise<CogneeSearchResult> {
  const trigger = resolveCogneeTrigger({
    config: params.config,
    query: params.query,
    sufficiencyFailed: params.sufficiencyFailed,
  });
  if (!trigger) {
    return { used: false, results: [] };
  }

  const timeoutMs = params.config?.memory?.cognee?.retrieval?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResults = Math.max(
    1,
    params.config?.memory?.cognee?.retrieval?.maxResultsPerQuery ?? DEFAULT_MAX_RESULTS,
  );
  const modes = resolveCogneeSearchModes(params.config);
  const run =
    params.commandRunner ??
    (async (command: string, args: string[], timeout: number): Promise<string> => {
      const { stdout } = await execFileAsync(command, args, { timeout });
      return stdout;
    });

  for (const mode of modes) {
    try {
      const stdout = await run("aos-cognee", buildAosContractArgs(params.query, mode), timeoutMs);
      const parsed = JSON.parse(stdout || "{}");
      const envelope = unwrapAosEnvelope(parsed);
      if (envelope.error) {
        return {
          used: false,
          trigger,
          mode,
          error: envelope.error,
          results: [],
        };
      }
      const hits = normalizeCogneeSearchHits(envelope.payload, maxResults);
      if (hits.length > 0) {
        return {
          used: true,
          trigger,
          mode,
          results: hits,
        };
      }
      continue;
    } catch (contractError) {
      try {
        const fallbackStdout = await run(
          "aos-cognee",
          buildLegacyArgs(params.query, mode),
          timeoutMs,
        );
        const fallbackParsed = JSON.parse(fallbackStdout || "{}");
        const fallbackEnvelope = unwrapAosEnvelope(fallbackParsed);
        if (fallbackEnvelope.error) {
          return {
            used: false,
            trigger,
            mode,
            error: fallbackEnvelope.error,
            results: [],
          };
        }
        const fallbackHits = normalizeCogneeSearchHits(fallbackEnvelope.payload, maxResults);
        if (fallbackHits.length > 0) {
          return {
            used: true,
            trigger,
            mode,
            results: fallbackHits,
          };
        }
      } catch (legacyError) {
        return {
          used: false,
          trigger,
          mode,
          error: `${toErrorMessage(contractError)}; legacy fallback failed: ${toErrorMessage(legacyError)}`,
          results: [],
        };
      }
    }
  }

  return {
    used: true,
    trigger,
    mode: modes[0],
    results: [],
  };
}
