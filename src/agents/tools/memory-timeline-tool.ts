/**
 * Memory Timeline Tool — Chronological view of memories
 *
 * Shows memories over time, optionally filtered by topic, entity, or type.
 * Groups results by date for easy scanning.
 */

import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import type { KnowledgeObservationKind, MemoryItem, MemoryType } from "../../memory/memu-types.js";
import type { AnyAgentTool } from "./common.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import { retrieveMemory } from "../../memory/retrieve/search.js";
import { resolveUserTimezone } from "../date-time.js";
import { jsonResult, readStringParam, readNumberParam } from "./common.js";

const MemoryTimelineSchema = Type.Object({
  query: Type.Optional(
    Type.String({ description: "Topic to search for (uses FTS5 if available)" }),
  ),
  entity: Type.Optional(
    Type.String({ description: "Entity name filter — show memories linked to this entity" }),
  ),
  type: Type.Optional(
    Type.Union(
      [
        Type.Literal("profile"),
        Type.Literal("event"),
        Type.Literal("knowledge"),
        Type.Literal("behavior"),
        Type.Literal("skill"),
        Type.Literal("tool"),
        Type.Literal("self"),
        Type.Literal("episode"),
      ],
      { description: "Memory type filter" },
    ),
  ),
  days: Type.Optional(
    Type.Number({ description: "How many days back to look (default: 30)", default: 30 }),
  ),
  limit: Type.Optional(Type.Number({ description: "Max results (default: 25)", default: 25 })),
});

// Significance emoji map
const SIG_EMOJI: Record<string, string> = {
  routine: "\u26AA",
  noteworthy: "\uD83D\uDD35",
  important: "\uD83D\uDFE1",
  core: "\uD83D\uDD34",
};

// Type emoji map
const TYPE_EMOJI: Record<string, string> = {
  profile: "\uD83D\uDC64",
  event: "\uD83D\uDCC5",
  knowledge: "\uD83D\uDCD6",
  behavior: "\uD83D\uDCA1",
  skill: "\uD83D\uDEE0\uFE0F",
  tool: "\u2699\uFE0F",
  self: "\uD83E\uDE9E",
  episode: "\uD83C\uDFAC",
};

const TIMELINE_QUERY_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "me",
  "you",
  "do",
  "did",
  "what",
  "all",
  "this",
  "that",
]);

function normalizeEntityName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

type TimelineEntity = {
  id: string;
  name: string;
};

function isStrongCanonicalEntityName(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^[A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*)+$/.test(trimmed) &&
    !trimmed.includes("(") &&
    !/'s\b/i.test(trimmed)
  );
}

function extractTemporalEntitySubject(query: string | null | undefined): string | null {
  const trimmed = query?.trim().replace(/[?!.\s]+$/g, "") ?? "";
  if (!trimmed) return null;

  const patterns = [
    /\b(?:show|give|list|pull|find)(?:\s+me)?\s+(?:all\s+)?(?:memories?|memory|timeline|events?)\s+about\s+(.+?)(?=\s+(?:from|over|during|within|for)\b|$)/i,
    /\bwhat\s+do\s+you\s+remember\s+about\s+(.+?)(?=\s+(?:from|over|during|within|for)\b|$)/i,
    /\bwhat\s+memories\s+do\s+you\s+have\s+(?:about|of)\s+(.+?)(?=\s+(?:from|over|during|within|for)\b|$)/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const candidate = match?.[1]
      ?.trim()
      .replace(/^(?:the|my)\s+/i, "")
      .trim();
    if (!candidate) continue;
    if (candidate.length < 2 || candidate.length > 80) continue;
    if (/\b(?:last|past|week|month|today|yesterday)\b/i.test(candidate)) continue;
    return candidate;
  }

  return null;
}

function inferTimelineDays(query: string | null | undefined): number | null {
  const normalized = query?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (/\btoday\b/.test(normalized)) return 1;
  if (/\byesterday\b/.test(normalized)) return 2;
  if (/\b(?:last|past)\s+week\b/.test(normalized)) return 7;
  if (/\bthis week\b/.test(normalized)) return 7;
  if (/\b(?:last|past)\s+(?:month|30\s+days?)\b/.test(normalized)) return 30;
  return null;
}

function normalizeTimelineSearchQuery(
  query: string | null | undefined,
  entityName: string | null,
): string | null {
  const raw = query?.trim() ?? "";
  if (!raw) return null;

  let normalized = raw;
  if (entityName) {
    normalized = normalized.replace(new RegExp(`\\b${escapeRegExp(entityName)}\\b`, "ig"), " ");
  }
  normalized = normalized
    .replace(/\b(?:show|give|list|pull|find)(?:\s+me)?\b/gi, " ")
    .replace(/\b(?:all\s+)?(?:memories?|memory|timeline|events?|remember)\b/gi, " ")
    .replace(/\b(?:about|of|from|over|during|within|for)\b/gi, " ")
    .replace(/\b(?:last|past)\s+(?:month|week|30\s+days?)\b/gi, " ")
    .replace(/\b(?:today|yesterday|recent|recently)\b/gi, " ")
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const filteredTerms = normalized
    .split(/\s+/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 2 && !TIMELINE_QUERY_STOPWORDS.has(term));

  return filteredTerms.length > 0 ? filteredTerms.join(" ") : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAliasTerm(text: string, alias: string): boolean {
  return new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(text);
}

function itemMatchesEntityTerms(summary: string, matchTerms: string[]): boolean {
  const haystack = summary.toLowerCase();
  return matchTerms.some((term) => containsAliasTerm(haystack, term.toLowerCase()));
}

function uniqueEntities(entities: TimelineEntity[]): TimelineEntity[] {
  const out = new Map<string, TimelineEntity>();
  for (const entity of entities) {
    out.set(entity.id, entity);
  }
  return [...out.values()];
}

function resolveTimelineEntities(
  entityName: string,
  allEntities: TimelineEntity[],
): TimelineEntity[] {
  const normalizedFilter = normalizeEntityName(entityName);
  const exactMatches = allEntities.filter(
    (entity) => normalizeEntityName(entity.name) === normalizedFilter,
  );
  const resolved: TimelineEntity[] = [...exactMatches];
  const parts = entityName.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    const canonicalMatches = allEntities.filter((candidate) => {
      if (!isStrongCanonicalEntityName(candidate.name)) return false;
      const first = normalizeEntityName(candidate.name.split(/\s+/)[0] ?? "");
      return first === normalizedFilter;
    });
    if (canonicalMatches.length === 1) {
      resolved.push(canonicalMatches[0]);
    }
  }

  return uniqueEntities(resolved);
}

function getTimelineAnchorMs(item: Pick<MemoryItem, "createdAt" | "happenedAt">): number {
  const happenedMs = item.happenedAt ? Date.parse(item.happenedAt) : Number.NaN;
  if (!Number.isNaN(happenedMs)) return happenedMs;
  const createdMs = Date.parse(item.createdAt);
  return Number.isNaN(createdMs) ? 0 : createdMs;
}

function getTimelineAnchorIso(item: Pick<MemoryItem, "createdAt" | "happenedAt">): string {
  return item.happenedAt && !Number.isNaN(Date.parse(item.happenedAt))
    ? item.happenedAt
    : item.createdAt;
}

function scoreTimelineTopicMatch(summary: string, query: string | null): number {
  if (!query) return 0;
  const lowered = summary.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !TIMELINE_QUERY_STOPWORDS.has(term));
  if (terms.length === 0) return 0;
  return terms.filter((term) => lowered.includes(term)).length;
}

function isStaticIdentitySummary(summary: string, entityTerms: string[]): boolean {
  const lowered = summary.toLowerCase();
  const mentionsEntity =
    entityTerms.length === 0 ||
    entityTerms.some((term) => containsAliasTerm(lowered, term.toLowerCase()));
  if (!mentionsEntity) return false;

  const dynamicCue =
    /\b(?:asked|requested|wanted|went live|built|prepared|reported|pushed|planned|planning|meeting|reminder|reporting|dashboard|ticket|alerts?|email|demo|investor|brain dump|visibility|blocked|flow|draft|review|launched|deployed|changed|updated|scheduled)\b/i.test(
      summary,
    );
  if (dynamicCue) return false;

  return /\b(?:is|are|was|were|has|have|co-founder|cofounder|co-runs|business partner|collaborator|former|background|credentials?|certifications?|cert footprint|deployment history|inner circle|trusted collaborator)\b/i.test(
    summary,
  );
}

function scoreTimelineNarrativeValue(
  item: Pick<MemoryItem, "summary" | "memoryType" | "createdAt" | "happenedAt">,
  entityTerms: string[],
): number {
  let score = 0;
  if (item.memoryType === "event") score += 3;
  else if (item.memoryType === "episode") score += 2.5;
  else if (item.memoryType === "knowledge") score += 1;
  else if (item.memoryType === "profile") score -= 1;

  if (item.happenedAt && !Number.isNaN(Date.parse(item.happenedAt))) {
    score += 1;
  }

  if (
    /\b(?:asked|requested|wanted|went live|built|prepared|reported|planned|planning|meeting|reminder|reporting|dashboard|ticket|alerts?|email|demo|investor|brain dump|visibility|blocked|flow|draft|review|launched|deployed|changed|updated|scheduled)\b/i.test(
      item.summary,
    )
  ) {
    score += 1.5;
  }

  if (isStaticIdentitySummary(item.summary, entityTerms)) {
    score -= 2.5;
  }

  return score;
}

function shouldUseObservationRetrieval(cfg: ArgentConfig): boolean {
  return (
    cfg.memory?.observations?.enabled === true &&
    cfg.memory?.observations?.retrieval?.enabled === true
  );
}

function inferObservationKindsForTimeline(params: {
  query: string | null | undefined;
  entityName: string | null;
  memoryType: string | null;
}): KnowledgeObservationKind[] {
  const kinds = new Set<KnowledgeObservationKind>();
  if (params.entityName) {
    kinds.add("operator_preference");
    kinds.add("relationship_fact");
  }
  const haystack = `${params.query ?? ""} ${params.memoryType ?? ""}`;
  if (
    /\b(playwright|pnpm|docker|ollama|typescript|tsx|vitest|jest|tool|cli|command)\b/i.test(
      haystack,
    )
  ) {
    kinds.add("tooling_state");
  }
  if (/\b(project|build|launch|deployment|roadmap)\b/i.test(haystack)) {
    kinds.add("project_state");
  }
  return [...kinds];
}

export function createMemoryTimelineTool(options: {
  config?: ArgentConfig;
  agentId?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;

  return {
    label: "Memory Timeline",
    name: "memory_timeline",
    description:
      "Show a chronological timeline of memories, optionally filtered by topic, entity, or type. " +
      "Results are grouped by date for easy scanning. Great for reviewing what happened or was accomplished over a period, " +
      "tracking how a topic evolved, or seeing all interactions with an entity over time. " +
      "Prefer this over external tools when the user asks what memory says happened last week or recently.",
    parameters: MemoryTimelineSchema,
    execute: async (_toolCallId, params) => {
      const rawQuery = readStringParam(params, "query");
      const explicitEntityName = readStringParam(params, "entity");
      const memoryType = readStringParam(params, "type") ?? null;
      const inferredEntityName = explicitEntityName ? null : extractTemporalEntitySubject(rawQuery);
      const effectiveEntityName = explicitEntityName ?? inferredEntityName;
      const normalizedQuery = normalizeTimelineSearchQuery(rawQuery, effectiveEntityName);
      const days =
        readNumberParam(params, "days", { integer: true }) ?? inferTimelineDays(rawQuery) ?? 30;
      const limit = readNumberParam(params, "limit", { integer: true }) ?? 25;

      try {
        const storage = await getStorageAdapter();
        const memory =
          options.agentId && storage.memory.withAgentId
            ? storage.memory.withAgentId(options.agentId)
            : storage.memory;
        const tz = resolveUserTimezone(cfg.agents?.defaults?.userTimezone);
        const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

        // Collect entity-linked item IDs if filtering by entity
        let entityItemIds: Set<string> | null = null;
        let resolvedEntities: TimelineEntity[] = [];
        let entityMatchTerms: string[] = [];
        if (effectiveEntityName) {
          const allEntities =
            ((await memory.listEntities({ limit: 500 })) as TimelineEntity[]) ?? [];
          resolvedEntities = resolveTimelineEntities(effectiveEntityName, allEntities);
          if (resolvedEntities.length === 0) {
            return jsonResult({
              timeline: [],
              count: 0,
              message: `No entity found with name "${effectiveEntityName}"`,
            });
          }
          const entityItems = (
            await Promise.all(
              resolvedEntities.map((entity) => memory.getEntityItems(entity.id, 500)),
            )
          ).flat();
          entityItemIds = new Set(entityItems.map((m) => m.id));
          entityMatchTerms = [
            effectiveEntityName,
            ...resolvedEntities.map((entity) => entity.name),
          ].filter(
            (value, index, values): value is string =>
              Boolean(value?.trim()) && values.indexOf(value) === index,
          );
        }

        let items: MemoryItem[] = [];
        let usedHybridTopicRetrieval = false;
        if (resolvedEntities.length > 0) {
          items = (
            await Promise.all(
              resolvedEntities.map((entity) => memory.getEntityItems(entity.id, 500)),
            )
          ).flat();
          const entityKeywordSeeds = uniqueEntities(
            [{ id: "__query__", name: effectiveEntityName! }, ...resolvedEntities].filter(
              (entry): entry is TimelineEntity => Boolean(entry?.name?.trim()),
            ),
          ).map((entry) => entry.name);
          const keywordHits = (
            await Promise.all(
              entityKeywordSeeds.map((term) =>
                memory.searchByKeyword(term, Math.max(limit * 4, 24)),
              ),
            )
          )
            .flat()
            .map((hit) => hit.item);
          const merged = new Map<string, MemoryItem>();
          for (const item of [...items, ...keywordHits]) {
            merged.set(item.id, item);
          }
          items = [...merged.values()];
        } else {
          if (normalizedQuery) {
            const hybrid = await retrieveMemory({
              query: rawQuery?.trim() || normalizedQuery,
              config: cfg,
              limit: limit * 6,
              memoryTypes: memoryType ? ([memoryType] as MemoryType[]) : undefined,
              reinforceOnAccess: false,
              rerank: false,
              sufficiencyCheck: false,
              // Use the already-resolved agent-scoped adapter so timeline follows the
              // same live store as the tool call/session.
              adapter: memory,
            });
            items = hybrid.results.map((hit) => hit.item);
            usedHybridTopicRetrieval = true;
          } else {
            items = await memory.listItems({
              memoryType: memoryType as MemoryType | undefined,
              limit: limit * 10,
            });
          }
        }

        // Apply entity filter in-memory
        if (entityItemIds) {
          items = items.filter((item) => entityItemIds!.has(item.id));
        }

        // Apply type + cutoff filters and sort by recency
        if (memoryType) {
          items = items.filter((item) => item.memoryType === memoryType);
        }
        if (normalizedQuery && !usedHybridTopicRetrieval) {
          items = items.filter(
            (item) => scoreTimelineTopicMatch(item.summary, normalizedQuery) > 0,
          );
        }
        items = items
          .filter((item) => {
            const ts = getTimelineAnchorMs(item);
            return Number.isNaN(ts) ? true : ts >= cutoffMs;
          })
          .sort((a, b) => {
            const directMentionDelta =
              Number(itemMatchesEntityTerms(b.summary, entityMatchTerms)) -
              Number(itemMatchesEntityTerms(a.summary, entityMatchTerms));
            if (directMentionDelta !== 0) return directMentionDelta;
            const narrativeDelta =
              scoreTimelineNarrativeValue(b, entityMatchTerms) -
              scoreTimelineNarrativeValue(a, entityMatchTerms);
            if (narrativeDelta !== 0) return narrativeDelta;
            const topicDelta =
              scoreTimelineTopicMatch(b.summary, normalizedQuery) -
              scoreTimelineTopicMatch(a.summary, normalizedQuery);
            if (topicDelta !== 0) return topicDelta;
            return getTimelineAnchorMs(b) - getTimelineAnchorMs(a);
          })
          .slice(0, limit);

        if (entityMatchTerms.length > 0) {
          const directMentionCount = items.filter((item) =>
            itemMatchesEntityTerms(item.summary, entityMatchTerms),
          ).length;
          if (directMentionCount >= 2) {
            items = items.filter((item) => itemMatchesEntityTerms(item.summary, entityMatchTerms));
          }
          const narrativeCount = items.filter(
            (item) => scoreTimelineNarrativeValue(item, entityMatchTerms) >= 2,
          ).length;
          if (narrativeCount >= 2) {
            items = items.filter(
              (item) =>
                scoreTimelineNarrativeValue(item, entityMatchTerms) >= 1 ||
                !isStaticIdentitySummary(item.summary, entityMatchTerms),
            );
          }
        }

        // Resolve entities for each item
        const itemEntitiesMap = new Map<string, string[]>();
        for (const item of items) {
          const entities = await memory.getItemEntities(item.id);
          if (entities.length > 0) {
            itemEntitiesMap.set(
              item.id,
              entities.map((e) => e.name),
            );
          }
        }

        // Group by date
        const grouped = new Map<string, MemoryItem[]>();
        for (const item of items) {
          const dateKey = formatDateKey(getTimelineAnchorIso(item), tz);
          if (!grouped.has(dateKey)) {
            grouped.set(dateKey, []);
          }
          grouped.get(dateKey)!.push(item);
        }

        let currentStateHeader = "";
        if (
          shouldUseObservationRetrieval(cfg) &&
          typeof memory.searchKnowledgeObservations === "function"
        ) {
          const observationKinds = inferObservationKindsForTimeline({
            query: rawQuery,
            entityName: effectiveEntityName,
            memoryType,
          });
          if (observationKinds.length > 0) {
            const observationQuery = rawQuery ?? normalizedQuery ?? effectiveEntityName ?? "";
            const observationHits = await memory.searchKnowledgeObservations(observationQuery, {
              kinds: observationKinds,
              limit: 2,
              minConfidence: cfg.memory?.observations?.retrieval?.minConfidence ?? 0.45,
              minFreshness: cfg.memory?.observations?.retrieval?.minFreshness ?? 0.2,
            });
            if (observationHits.length > 0) {
              const lines = observationHits.map(
                (hit) =>
                  `- ${hit.observation.summary} (confidence ${hit.observation.confidence.toFixed(2)}, freshness ${hit.observation.freshness.toFixed(2)})`,
              );
              currentStateHeader = `### Current State\n\n${lines.join("\n")}\n\n`;
            }
          }
        }

        // Format output
        let text = currentStateHeader;
        let totalCount = 0;

        for (const [dateKey, dateRows] of grouped.entries()) {
          text += `## ${dateKey}\n\n`;
          for (const item of dateRows) {
            totalCount++;
            const time = formatTime(getTimelineAnchorIso(item), tz);
            const sig = item.significance ?? "routine";
            const type = item.memoryType ?? "knowledge";
            const summary = item.summary;
            const sigEmoji = SIG_EMOJI[sig] ?? "\u26AA";
            const typeEmoji = TYPE_EMOJI[type] ?? "\uD83D\uDCD6";

            text += `[${time}] ${sigEmoji}${typeEmoji} (${type}) ${summary}\n`;

            // Metadata line
            const meta: string[] = [];
            const entities = itemEntitiesMap.get(item.id);
            if (entities && entities.length > 0) {
              meta.push(`Entities: ${entities.join(", ")}`);
            }
            meta.push(`Significance: ${sig}`);

            const valence = item.emotionalValence;
            if (valence && valence !== 0) {
              meta.push(`Emotion: ${valence > 0 ? "+" : ""}${valence.toFixed(1)}`);
            }

            text += `  ${meta.join(" | ")}\n\n`;
          }
        }

        if (totalCount === 0) {
          text = "No memories found matching the criteria.";
        }

        return jsonResult({
          timeline: text.trim(),
          count: totalCount,
          days,
          filters: {
            ...(normalizedQuery ? { query: normalizedQuery } : {}),
            ...(effectiveEntityName ? { entity: effectiveEntityName } : {}),
            ...(memoryType ? { type: memoryType } : {}),
          },
          ...(inferredEntityName && !explicitEntityName ? { entityInferred: true } : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ timeline: "", count: 0, error: message });
      }
    },
  };
}

function formatDateKey(isoDate: string, tz: string): string {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate.slice(0, 10);
    return d.toLocaleDateString("en-US", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return isoDate.slice(0, 10);
  }
}

function formatTime(isoDate: string, tz: string): string {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return "??:??";
    return d.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "??:??";
  }
}
