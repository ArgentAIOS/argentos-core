/**
 * SIS Runner — Self-Improving System consolidation cycles.
 *
 * Runs periodically (default: after every 5 new episodes). Pulls recent
 * episodes from MIMO, clusters by pattern_hint and type, extracts cross-episode
 * patterns via Haiku, and stores consolidated insights as reflections.
 *
 * These patterns are then injected into future contemplation and heartbeat
 * prompts, closing the learn → consolidate → inject loop.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolOutcome } from "../agents/pi-embedded-subscribe.handlers.types.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import type { ArgentConfig } from "../config/config.js";
import type { MemoryAdapter } from "../data/adapter.js";
import type { Lesson } from "../memory/memu-types.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { getReplyFromConfig } from "../auto-reply/reply.js";
import { loadConfig } from "../config/config.js";
import { resolveAgentMainSessionKey } from "../config/sessions.js";
import { getMemoryAdapter } from "../data/storage-factory.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  type SisConsolidationContract,
  type SisParseFailureReason,
  validateSisConsolidationContract,
} from "./episode-types.js";
import {
  buildToolOutcomeSummary,
  deduplicateAgainstExisting,
  detectRepeatedFailures,
  detectRetryPatterns,
  parseToolLessonsFromResponse,
} from "./sis-lesson-extractor.js";

const log = createSubsystemLogger("gateway/sis");

const MAX_EPISODES_PER_BATCH = 20; // Don't feed more than 20 at once

// ── Types ──────────────────────────────────────────────────────────────────

export type SisRunner = {
  stop: () => void;
  updateConfig: (cfg: ArgentConfig) => void;
};

interface PatternResult {
  name: string;
  description: string;
  frequency: number;
  avgValence: number;
  lessons: string[];
  episodeIds: string[];
  growthDirection?: string;
}

function buildSisConsolidationReflectionContent(params: {
  episodesAnalyzed: number;
  patterns: PatternResult[];
  growthArc: string;
  recommendations: string[];
  statusNote?: string;
}): string {
  const patternLines =
    params.patterns.length > 0
      ? params.patterns.map(
          (p) =>
            `- **${p.name}** (freq=${p.frequency}, valence=${p.avgValence}): ${p.description}${p.growthDirection ? ` [${p.growthDirection}]` : ""}`,
        )
      : ["- None identified in this cycle."];
  const recommendationLines =
    params.recommendations.length > 0
      ? params.recommendations.map((r) => `- ${r}`)
      : ["- Continue collecting higher-signal episodes before next consolidation."];

  return [
    `## SIS Consolidation (${new Date().toISOString().slice(0, 10)})`,
    `**Episodes analyzed:** ${params.episodesAnalyzed}`,
    `**Patterns found:** ${params.patterns.length}`,
    params.statusNote ? `**Status:** ${params.statusNote}` : null,
    "",
    `### Growth Arc`,
    params.growthArc,
    "",
    `### Patterns`,
    ...patternLines,
    "",
    `### Recommendations`,
    ...recommendationLines,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function isEmptySisConsolidationContent(content: string): boolean {
  return /\*\*Patterns found:\*\*\s*0\b/i.test(content);
}

function buildSisConsolidationSignature(content: string): string {
  return content
    .replace(/## SIS Consolidation \(\d{4}-\d{2}-\d{2}\)/g, "## SIS Consolidation (<date>)")
    .replace(/\*\*Episodes analyzed:\*\*\s*\d+/g, "**Episodes analyzed:** <n>")
    .replace(/Period:\s+[^\n]+/g, "Period: <normalized>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function shouldSkipSisConsolidationCheckpoint(params: {
  memuStore: MemoryAdapter;
  reflectionContent: string;
}): Promise<boolean> {
  if (!isEmptySisConsolidationContent(params.reflectionContent)) {
    return false;
  }

  const latest = (
    await params.memuStore.listReflections({
      triggerType: "sis_consolidation",
      limit: 1,
    })
  )[0];
  if (!latest || !isEmptySisConsolidationContent(latest.content)) {
    return false;
  }

  return (
    buildSisConsolidationSignature(latest.content) ===
    buildSisConsolidationSignature(params.reflectionContent)
  );
}

async function persistSisConsolidationCheckpoint(params: {
  cfg: ArgentConfig;
  memuStore: MemoryAdapter;
  episodeBatch: Array<{ ts: string }>;
  reflectionContent: string;
  lessonsExtracted?: string[];
  entitiesInvolved?: string[];
  selfInsights?: string[];
}): Promise<void> {
  if (
    await shouldSkipSisConsolidationCheckpoint({
      memuStore: params.memuStore,
      reflectionContent: params.reflectionContent,
    })
  ) {
    log.info("sis: skipped duplicate empty consolidation checkpoint");
    return;
  }

  await params.memuStore.createReflection({
    triggerType: "sis_consolidation",
    periodStart: params.episodeBatch[params.episodeBatch.length - 1]?.ts,
    periodEnd: params.episodeBatch[0]?.ts,
    content: params.reflectionContent,
    lessonsExtracted: (params.lessonsExtracted ?? []).slice(0, 10),
    entitiesInvolved: (params.entitiesInvolved ?? []).slice(0, 10),
    selfInsights: (params.selfInsights ?? []).slice(0, 5),
    mood: "analytical",
  });

  const agentIdResolved = resolveDefaultAgentId(params.cfg);
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentIdResolved);
  const sisDir = path.join(workspaceDir, "memory", "sis");
  await fs.mkdir(sisDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const sisLogPath = path.join(sisDir, `${date}.md`);
  await fs.appendFile(sisLogPath, params.reflectionContent + "\n\n---\n\n");
}

// ── Consolidation Prompt ──────────────────────────────────────────────────

function buildConsolidationPrompt(
  episodes: Array<{
    id: string;
    type: string;
    ts: string;
    reflection?: string;
    lesson?: string;
    patternHint?: string;
    valence: number;
    arousal: number;
    mood: string;
    success: boolean;
    observationCount: number;
    unexpected?: string;
  }>,
  toolOutcomeSummary?: string,
): string {
  const episodeList = episodes
    .map((e, i) => {
      const parts = [
        `Episode ${i + 1} [${e.id.slice(0, 8)}] (${e.ts.slice(0, 10)}, ${e.type}):`,
        e.reflection ? `  Reflection: ${e.reflection.slice(0, 200)}` : null,
        e.lesson ? `  Lesson: ${e.lesson.slice(0, 200)}` : null,
        e.patternHint ? `  Pattern hint: ${e.patternHint}` : null,
        `  Mood: ${e.mood} | Valence: ${e.valence} | Arousal: ${e.arousal} | Success: ${e.success}`,
        e.unexpected ? `  Unexpected: ${e.unexpected.slice(0, 100)}` : null,
      ].filter(Boolean);
      return parts.join("\n");
    })
    .join("\n\n");

  const toolOutcomesSection = toolOutcomeSummary
    ? `\n## Tool Outcomes\n\n${toolOutcomeSummary}\n\nAlso extract specific tool-related lessons from the failures above. For each distinct failure pattern, produce a tool_lesson entry.\n`
    : "";

  const toolLessonsSpec = toolOutcomeSummary
    ? `,
  "tool_lessons": [
    {
      "type": "mistake|workaround|discovery",
      "tool": "tool_name",
      "context": "When/why the tool was called",
      "action": "What was attempted",
      "outcome": "What happened",
      "lesson": "What to do differently",
      "correction": "Specific fix if applicable",
      "confidence": 0.5,
      "tags": ["tag1"]
    }
  ]`
    : "";

  return `# SIS Consolidation

You are the Self-Improving System (SIS) analyzing episodes from an AI agent's contemplation cycles.
Your job: find patterns across these episodes that reveal growth arcs, recurring failures, and lessons.

## Episodes to Analyze

${episodeList}
${toolOutcomesSection}
## Instructions

Analyze these episodes and extract:

1. **Recurring Patterns** — What themes, behaviors, or situations appear across multiple episodes?
2. **Growth Arcs** — What trajectory of change do you see? (e.g., "verification failures → emerging rigor")
3. **Cross-Episode Lessons** — What lessons appear in multiple episodes or reinforce each other?
4. **Self-Insights** — What does this collection reveal about the agent's evolving identity?

Output your analysis as JSON wrapped in [SIS_PATTERNS]...[/SIS_PATTERNS] tags:

[SIS_PATTERNS]
{
  "patterns": [
    {
      "name": "pattern_name",
      "description": "What this pattern is about",
      "frequency": 3,
      "avg_valence": 0.5,
      "lessons": ["Specific lesson 1", "Specific lesson 2"],
      "episode_ids": ["id1", "id2", "id3"],
      "growth_direction": "from_state → to_state"
    }
  ],
  "growth_arc": "Overall narrative of growth across these episodes",
  "self_insights": ["Insight 1", "Insight 2"],
  "recommendations": ["What to focus on next"]${toolLessonsSpec}
}
[/SIS_PATTERNS]

Be precise. Extract only what the data shows. Don't invent patterns that aren't there.
If fewer than 2 episodes share a theme, it's not a pattern yet.`;
}

// ── Pattern Parsing ───────────────────────────────────────────────────────

const SIS_PATTERN_REGEX = /\[SIS_PATTERNS\]\s*([\s\S]*?)\s*\[\/SIS_PATTERNS\]/i;

interface ConsolidationResult {
  patterns: PatternResult[];
  growthArc: string;
  selfInsights: string[];
  recommendations: string[];
  rawJson: SisConsolidationContract;
}

type SisConsolidationParseFailure = {
  ok: false;
  reason: SisParseFailureReason;
  detail: string;
  fallbackUsed: boolean;
  candidateCount: number;
  textPreview: string;
};

type SisConsolidationParseSuccess = {
  ok: true;
  result: ConsolidationResult;
  fallbackUsed: boolean;
  candidateCount: number;
};

type SisConsolidationParseResult = SisConsolidationParseSuccess | SisConsolidationParseFailure;

type SisConsolidationMetrics = {
  attempts: number;
  parseSuccess: number;
  parseFailures: number;
  fallbackParses: number;
  parseFailureByReason: Record<SisParseFailureReason, number>;
};

const sisConsolidationMetrics: SisConsolidationMetrics = {
  attempts: 0,
  parseSuccess: 0,
  parseFailures: 0,
  fallbackParses: 0,
  parseFailureByReason: {
    "no-json-candidate": 0,
    "json-parse-failed": 0,
    "root-not-object": 0,
    "missing-patterns": 0,
    "missing-growth-arc": 0,
    "missing-self-insights": 0,
    "missing-recommendations": 0,
    "invalid-pattern-entry": 0,
  },
};

export function getSisConsolidationMetricsSnapshot(): SisConsolidationMetrics {
  return {
    ...sisConsolidationMetrics,
    parseFailureByReason: { ...sisConsolidationMetrics.parseFailureByReason },
  };
}

export function resetSisConsolidationMetrics(): void {
  sisConsolidationMetrics.attempts = 0;
  sisConsolidationMetrics.parseSuccess = 0;
  sisConsolidationMetrics.parseFailures = 0;
  sisConsolidationMetrics.fallbackParses = 0;
  for (const key of Object.keys(
    sisConsolidationMetrics.parseFailureByReason,
  ) as SisParseFailureReason[]) {
    sisConsolidationMetrics.parseFailureByReason[key] = 0;
  }
}

function emitSisParseTelemetry(event: string, payload: Record<string, unknown>): void {
  log.warn(event, payload);
}

function scoreSisPayloadText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (trimmed.includes("[SIS_PATTERNS]")) return 3;
  if (trimmed.includes('"patterns"')) return 2;
  return 1;
}

function selectBestSisReplyPayload(
  replyResult: ReplyPayload | ReplyPayload[] | undefined,
): ReplyPayload | undefined {
  if (!replyResult) {
    return undefined;
  }
  if (!Array.isArray(replyResult)) {
    return replyResult;
  }
  const ranked = replyResult
    .map((payload, index) => {
      const text = payload?.text ?? "";
      const trimmed = text.trim();
      return {
        payload,
        index,
        score: scoreSisPayloadText(trimmed),
        length: trimmed.length,
      };
    })
    .filter((entry) => entry.score > 0);
  if (ranked.length === 0) {
    return undefined;
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.length !== a.length) return b.length - a.length;
    return a.index - b.index;
  });
  return ranked[0]?.payload;
}

/**
 * Extract JSON from model response. Handles:
 * - [SIS_PATTERNS]{ ... }[/SIS_PATTERNS]
 * - [SIS_PATTERNS]\n```json\n{ ... }\n```\n[/SIS_PATTERNS]
 * - Bare JSON object with "patterns" key (fallback)
 */
function extractJsonCandidates(text: string): Array<{ json: string; fallbackUsed: boolean }> {
  const out: Array<{ json: string; fallbackUsed: boolean }> = [];
  const tagged = SIS_PATTERN_REGEX.exec(text);
  if (tagged?.[1]) {
    const inner = tagged[1].trim();
    const strippedFence = inner
      .replace(/^```(?:json)?\s*\n?/im, "")
      .replace(/\n?```\s*$/im, "")
      .trim();
    if (strippedFence) {
      out.push({ json: strippedFence, fallbackUsed: strippedFence !== inner });
    }
  }

  if (out.length === 0 && text.includes('"patterns"')) {
    const start = text.indexOf("{");
    if (start >= 0) {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === "{") depth++;
        if (ch === "}") {
          depth--;
          if (depth === 0) {
            out.push({ json: text.slice(start, i + 1), fallbackUsed: true });
            break;
          }
        }
      }
    }
  }

  return out;
}

function parseConsolidationResponse(text: string): SisConsolidationParseResult {
  sisConsolidationMetrics.attempts++;
  const candidates = extractJsonCandidates(text);
  if (candidates.length === 0) {
    sisConsolidationMetrics.parseFailures++;
    sisConsolidationMetrics.parseFailureByReason["no-json-candidate"]++;
    return {
      ok: false,
      reason: "no-json-candidate",
      detail: "No parseable SIS JSON candidate found in model response",
      fallbackUsed: false,
      candidateCount: 0,
      textPreview: text.slice(0, 300),
    };
  }

  let jsonParseFailedCount = 0;
  let lastValidationFailure: Omit<SisConsolidationParseFailure, "ok"> | null = null;

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate.json) as unknown;
    } catch {
      jsonParseFailedCount++;
      continue;
    }

    const validated = validateSisConsolidationContract(parsed);
    if (!validated.ok) {
      lastValidationFailure = {
        reason: validated.reason,
        detail: validated.detail,
        fallbackUsed: candidate.fallbackUsed,
        candidateCount: candidates.length,
        textPreview: text.slice(0, 300),
      };
      continue;
    }

    const raw = validated.value;
    sisConsolidationMetrics.parseSuccess++;
    if (candidate.fallbackUsed) {
      sisConsolidationMetrics.fallbackParses++;
    }
    return {
      ok: true,
      fallbackUsed: candidate.fallbackUsed,
      candidateCount: candidates.length,
      result: {
        patterns: raw.patterns.map((p) => ({
          name: p.name,
          description: p.description,
          frequency: p.frequency,
          avgValence: p.avg_valence,
          lessons: p.lessons,
          episodeIds: p.episode_ids,
          growthDirection: p.growth_direction,
        })),
        growthArc: raw.growth_arc,
        selfInsights: raw.self_insights,
        recommendations: raw.recommendations,
        rawJson: raw,
      },
    };
  }

  if (jsonParseFailedCount > 0 && !lastValidationFailure) {
    sisConsolidationMetrics.parseFailures++;
    sisConsolidationMetrics.parseFailureByReason["json-parse-failed"]++;
    return {
      ok: false,
      reason: "json-parse-failed",
      detail: `Failed to parse ${jsonParseFailedCount} JSON candidate(s)`,
      fallbackUsed: candidates.some((c) => c.fallbackUsed),
      candidateCount: candidates.length,
      textPreview: text.slice(0, 300),
    };
  }

  const failure = lastValidationFailure ?? {
    reason: "json-parse-failed" as SisParseFailureReason,
    detail: "Unable to parse or validate SIS JSON candidate",
    fallbackUsed: candidates.some((c) => c.fallbackUsed),
    candidateCount: candidates.length,
    textPreview: text.slice(0, 300),
  };
  sisConsolidationMetrics.parseFailures++;
  sisConsolidationMetrics.parseFailureByReason[failure.reason]++;
  return { ok: false, ...failure };
}

export const __testing = {
  parseConsolidationResponse,
  extractJsonCandidates,
  selectBestSisReplyPayload,
  buildSisConsolidationSignature,
  shouldSkipSisConsolidationCheckpoint,
  resetSisConsolidationMetrics,
  getSisConsolidationMetricsSnapshot,
} as const;

// ── Single Consolidation Cycle ────────────────────────────────────────────

let sisRunning = false;

async function runConsolidationOnce(
  cfg: ArgentConfig,
  toolOutcomes?: ToolOutcome[],
): Promise<{
  status: "ran" | "skipped";
  reason?: string;
  patternsFound?: number;
  lessonsExtractedCount?: number;
}> {
  if (sisRunning) {
    return { status: "skipped", reason: "already-running" };
  }

  sisRunning = true;
  try {
    const memuStore = await getMemoryAdapter();

    // Count episodes since last consolidation
    const lastConsolidation = await memuStore.listReflections({
      triggerType: "sis_consolidation",
      limit: 1,
    });
    const lastConsolidatedAt =
      lastConsolidation.length > 0 ? lastConsolidation[0].createdAt : "2000-01-01T00:00:00.000Z";

    // Get recent episodes (after last consolidation)
    const allEpisodes = await memuStore.listItems({ memoryType: "episode", limit: 100 });
    const newEpisodes = allEpisodes.filter((e) => e.createdAt > lastConsolidatedAt);

    log.info("sis: episode check", {
      total: allEpisodes.length,
      newSinceLast: newEpisodes.length,
      lastConsolidatedAt: lastConsolidatedAt.slice(0, 19),
    });

    const episodesPerConsolidation = cfg.agents?.defaults?.sis?.episodesPerConsolidation ?? 5;

    if (newEpisodes.length < episodesPerConsolidation) {
      return { status: "skipped", reason: `only-${newEpisodes.length}-episodes` };
    }

    // Build episode summaries for the prompt
    const episodeBatch = newEpisodes.slice(0, MAX_EPISODES_PER_BATCH).map((e) => {
      const extra = e.extra as Record<string, unknown>;
      return {
        id: (extra.episodeId as string) ?? e.id,
        type: (extra.episodeType as string) ?? "unknown",
        ts: e.happenedAt ?? e.createdAt,
        reflection: e.reflection ?? undefined,
        lesson: e.lesson ?? undefined,
        patternHint: (extra.patternHint as string) ?? undefined,
        valence: e.emotionalValence,
        arousal: e.emotionalArousal,
        mood: e.moodAtCapture ?? "neutral",
        success: (extra.success as boolean) ?? true,
        observationCount: (extra.observationCount as number) ?? 0,
        unexpected: (extra.unexpected as string) ?? undefined,
      };
    });

    const toolSummary = toolOutcomes ? buildToolOutcomeSummary(toolOutcomes) : undefined;
    const prompt = buildConsolidationPrompt(episodeBatch, toolSummary ?? undefined);

    // Use a dedicated session key for SIS
    const agentId = normalizeAgentId(resolveDefaultAgentId(cfg));
    const mainSessionKey = resolveAgentMainSessionKey({ cfg, agentId });
    const sessionKey = `${mainSessionKey}:sis-consolidation`;

    const ctx = {
      Body: prompt,
      From: "sis",
      To: "sis",
      Provider: "sis",
      SessionKey: sessionKey,
    };

    const replyResult = await getReplyFromConfig(
      ctx,
      { isHeartbeat: true, isSis: true, lane: "background" },
      cfg,
    );
    const payload = selectBestSisReplyPayload(replyResult);
    const text = (payload as ReplyPayload | undefined)?.text?.trim() ?? "";

    if (!text) {
      emitSisParseTelemetry("sis: empty-response", {
        event: "sis_consolidation_empty_response",
        textLength: 0,
        metrics: getSisConsolidationMetricsSnapshot(),
      });
      return { status: "skipped", reason: "empty-response" };
    }

    log.info("sis: consolidation response received", {
      textLength: text.length,
      episodesAnalyzed: episodeBatch.length,
      hasTags: text.includes("[SIS_PATTERNS]"),
      hasPatterns: text.includes('"patterns"'),
    });

    const result = parseConsolidationResponse(text);
    if (!result.ok) {
      emitSisParseTelemetry("sis: parse-failed", {
        event: "sis_parse_failure",
        reason: result.reason,
        detail: result.detail,
        fallbackUsed: result.fallbackUsed,
        candidateCount: result.candidateCount,
        metrics: getSisConsolidationMetricsSnapshot(),
        textLength: text.length,
        textPreview: result.textPreview,
      });
      return { status: "ran", patternsFound: 0 };
    }

    if (result.result.patterns.length === 0) {
      const emptyReflectionContent = buildSisConsolidationReflectionContent({
        episodesAnalyzed: episodeBatch.length,
        patterns: [],
        growthArc: result.result.growthArc,
        recommendations: result.result.recommendations,
        statusNote: "No cross-episode patterns identified.",
      });
      await persistSisConsolidationCheckpoint({
        cfg,
        memuStore,
        episodeBatch,
        reflectionContent: emptyReflectionContent,
        selfInsights: result.result.selfInsights,
      });
      emitSisParseTelemetry("sis: consolidation-empty-patterns", {
        event: "sis_parse_success_empty_patterns",
        textLength: text.length,
        fallbackUsed: result.fallbackUsed,
        candidateCount: result.candidateCount,
        metrics: getSisConsolidationMetricsSnapshot(),
        textPreview: text.slice(0, 300),
      });
      return { status: "ran", patternsFound: 0 };
    }
    const parsed = result.result;

    // Store as a reflection
    const allLessons = parsed.patterns.flatMap((p) => p.lessons);
    const allEntities = new Set<string>();
    for (const p of parsed.patterns) {
      for (const eid of p.episodeIds) {
        allEntities.add(eid);
      }
    }

    const reflectionContent = buildSisConsolidationReflectionContent({
      episodesAnalyzed: episodeBatch.length,
      patterns: parsed.patterns,
      growthArc: parsed.growthArc,
      recommendations: parsed.recommendations,
    });
    await persistSisConsolidationCheckpoint({
      cfg,
      memuStore,
      episodeBatch,
      reflectionContent,
      lessonsExtracted: allLessons,
      entitiesInvolved: Array.from(allEntities),
      selfInsights: parsed.selfInsights,
    });

    // ── Lesson Extraction ─────────────────────────────────────────────────
    let totalLessonsStored = 0;

    // Path 1: Rule-based inline detection from tool outcomes
    const allExtracted = [
      ...(toolOutcomes ? detectRetryPatterns(toolOutcomes) : []),
      ...(toolOutcomes ? detectRepeatedFailures(toolOutcomes) : []),
    ];

    // Path 2: Parse model-extracted tool_lessons from consolidation response
    const modelLessons = parseToolLessonsFromResponse(parsed.rawJson as Record<string, unknown>);
    allExtracted.push(...modelLessons);

    if (allExtracted.length > 0) {
      // Deduplicate against existing lessons
      const newLessons = await deduplicateAgainstExisting(allExtracted, memuStore);

      // Store each new lesson
      for (const lesson of newLessons) {
        await memuStore.createLesson({
          type: lesson.type,
          context: lesson.context,
          action: lesson.action,
          outcome: lesson.outcome,
          lesson: lesson.lesson,
          correction: lesson.correction,
          confidence: lesson.confidence,
          tags: lesson.tags,
          relatedTools: lesson.relatedTools,
        });
      }

      totalLessonsStored = newLessons.length;
      const reinforced = allExtracted.length - newLessons.length;

      log.info("sis: lessons extracted", {
        ruleBasedCandidates: allExtracted.length - modelLessons.length,
        modelExtracted: modelLessons.length,
        storedNew: totalLessonsStored,
        reinforcedExisting: reinforced,
      });
    }

    log.info("sis: consolidation complete", {
      patternsFound: parsed.patterns.length,
      parseFallbackUsed: result.fallbackUsed,
      parseCandidateCount: result.candidateCount,
      episodesAnalyzed: episodeBatch.length,
      lessonsExtracted: allLessons.length,
      lessonsStored: totalLessonsStored,
      parseMetrics: getSisConsolidationMetricsSnapshot(),
    });

    // Publish to Redis dashboard + shared knowledge library
    try {
      const { isRedisAgentStateActive, onSisLessonsExtracted } =
        await import("../data/redis-agent-state.js");
      if (isRedisAgentStateActive() && totalLessonsStored > 0) {
        await onSisLessonsExtracted({
          lessonCount: totalLessonsStored,
          reflectionId: undefined,
        });
      }

      // Auto-publish high-confidence lessons to the family shared knowledge library
      const highConfLessons = allExtracted.filter((l) => l.confidence >= 0.8);
      if (highConfLessons.length > 0) {
        const { getAgentFamily } = await import("../data/agent-family.js");
        const family = await getAgentFamily();
        const agentIdForPublish = normalizeAgentId(resolveDefaultAgentId(cfg));

        for (const lesson of highConfLessons) {
          try {
            await family.publishKnowledge({
              sourceAgentId: agentIdForPublish,
              category: "lesson",
              title: lesson.lesson.slice(0, 200),
              content: JSON.stringify({
                context: lesson.context,
                action: lesson.action,
                outcome: lesson.outcome,
                correction: lesson.correction,
                tools: lesson.relatedTools,
                tags: lesson.tags,
              }),
              confidence: lesson.confidence,
            });
          } catch {
            /* shared knowledge is optional */
          }
        }

        log.info("sis: published to shared knowledge", {
          count: highConfLessons.length,
        });
      }
    } catch {
      /* Redis/family events are optional */
    }

    // Run lesson lifecycle maintenance (decay, dedup, promotion)
    try {
      await runMaintenanceCycle(cfg, memuStore);
    } catch (maintenanceErr) {
      log.error("sis: maintenance cycle failed", {
        error: maintenanceErr instanceof Error ? maintenanceErr.message : String(maintenanceErr),
      });
    }

    return {
      status: "ran",
      patternsFound: parsed.patterns.length,
      lessonsExtractedCount: totalLessonsStored,
    };
  } catch (err) {
    emitSisParseTelemetry("sis: consolidation-failed", {
      event: "sis_consolidation_error",
      error: err instanceof Error ? err.message : String(err),
      metrics: getSisConsolidationMetricsSnapshot(),
    });
    return { status: "skipped", reason: "error" };
  } finally {
    sisRunning = false;
  }
}

// ── Lesson Lifecycle Maintenance ─────────────────────────────────────────

/** Jaccard similarity on word sets: |A ∩ B| / |A ∪ B| */
function wordJaccard(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Group lessons by their related_tools overlap */
function groupByTools(lessons: Lesson[]): Map<string, Lesson[]> {
  const groups = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    const key =
      lesson.relatedTools.length > 0 ? [...lesson.relatedTools].sort().join(",") : "__no_tools__";
    const group = groups.get(key) ?? [];
    group.push(lesson);
    groups.set(key, group);
  }
  return groups;
}

/** Merge two JSON-serialized string arrays, deduplicated */
function mergeTags(tagsA: string[], tagsB: string[]): string[] {
  return [...new Set([...tagsA, ...tagsB])];
}

/**
 * Run lesson lifecycle maintenance: decay, deduplication, and promotion.
 * Called after each consolidation cycle. Failures are logged but do not
 * propagate to the caller.
 */
async function runMaintenanceCycle(cfg: ArgentConfig, memuStore: MemoryAdapter): Promise<void> {
  const decayDays = cfg.agents?.defaults?.sis?.lessonDecayDays ?? 30;

  // 1. Confidence decay — lessons not seen in X days lose confidence
  const decayed = await memuStore.decayLessons(decayDays, 0.1);
  if (decayed > 0) {
    log.info("sis: decayed stale lessons", { count: decayed, olderThanDays: decayDays });
  }

  // 2. Deduplication — find and merge similar lessons
  const allLessons = await memuStore.listLessons({ limit: 500 });
  const activeLessons = allLessons.filter((l) => l.confidence > 0.3);

  const groups = groupByTools(activeLessons);
  let mergedCount = 0;

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Compare pairs within each tool group
    const toDelete = new Set<string>();
    for (let i = 0; i < group.length; i++) {
      if (toDelete.has(group[i].id)) continue;
      for (let j = i + 1; j < group.length; j++) {
        if (toDelete.has(group[j].id)) continue;

        const similarity = wordJaccard(group[i].lesson, group[j].lesson);
        if (similarity < 0.8) continue;

        // Merge: keep the higher-confidence lesson
        const [keeper, duplicate] =
          group[i].confidence >= group[j].confidence ? [group[i], group[j]] : [group[j], group[i]];

        // Add duplicate's occurrences to keeper and merge tags
        await memuStore.mergeLessonOccurrences(
          keeper.id,
          duplicate.occurrences,
          mergeTags(keeper.tags, duplicate.tags),
        );

        // Reinforce the keeper (boosts confidence, updates last_seen)
        await memuStore.reinforceLesson(keeper.id);

        // Delete the duplicate
        await memuStore.deleteLesson(duplicate.id);
        toDelete.add(duplicate.id);
        mergedCount++;
      }
    }
  }

  if (mergedCount > 0) {
    log.info("sis: deduplicated lessons", { merged: mergedCount });
  }

  // 3. Promotion — high-confidence, high-occurrence lessons are core learnings
  // Re-fetch after dedup to get accurate state
  const promotable = await memuStore.listLessons({ limit: 500 });
  const coreCandidates = promotable.filter((l) => l.confidence > 0.9 && l.occurrences > 10);
  if (coreCandidates.length > 0) {
    log.info("sis: core lessons identified", {
      count: coreCandidates.length,
      lessons: coreCandidates.map((l) => l.lesson.slice(0, 80)),
    });
  }
}

// ── Runner ─────────────────────────────────────────────────────────────────

export function startSisRunner(opts: { cfg?: ArgentConfig }): SisRunner {
  let cfg = opts.cfg ?? loadConfig();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let initialized = false;

  function resolveIntervalMs(): number {
    const raw = cfg.agents?.defaults?.sis?.every ?? "10m";
    const minutes = parseInt(raw, 10);
    return (isNaN(minutes) ? 10 : minutes) * 60 * 1000;
  }

  function isEnabled(): boolean {
    return (
      cfg.agents?.defaults?.sis?.enabled ?? cfg.agents?.defaults?.contemplation?.enabled === true
    );
  }

  function scheduleNext() {
    if (stopped) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    if (!isEnabled()) {
      if (initialized) {
        log.info("sis: disabled (contemplation not enabled)");
      }
      return;
    }

    const intervalMs = resolveIntervalMs();
    timer = setTimeout(runCycle, intervalMs);
    timer.unref?.();

    if (!initialized) {
      log.info("sis: started", {
        intervalMs,
        episodesPerConsolidation: cfg.agents?.defaults?.sis?.episodesPerConsolidation ?? 5,
      });
      initialized = true;
    }
  }

  async function runCycle() {
    if (stopped) return;

    const result = await runConsolidationOnce(cfg);
    if (result.status === "ran") {
      log.info("sis: cycle result", { patternsFound: result.patternsFound });
    } else if (result.reason !== "already-running") {
      log.debug("sis: skipped", { reason: result.reason });
    }

    scheduleNext();
  }

  const updateConfig = (nextCfg: ArgentConfig) => {
    if (stopped) return;
    cfg = nextCfg;
    scheduleNext();
  };

  const stop = () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  scheduleNext();

  return { stop, updateConfig };
}
