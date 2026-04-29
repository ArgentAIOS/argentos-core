/**
 * MemU Agent Tools — Memory Recall, Store, Categories, Forget
 *
 * These tools give the agent direct access to the MemU three-layer
 * memory system (Resources → Items → Categories).
 */

import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import type { MemoryAdapter } from "../../data/adapter.js";
import type { Entity, KnowledgeObservationKind, MemoryType } from "../../memory/memu-types.js";
import type { AnyAgentTool } from "./common.js";
import {
  getKnowledgeAclSnapshot,
  hasKnowledgeCollectionReadAccess,
} from "../../data/knowledge-acl.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import { callGateway } from "../../gateway/call.js";
import {
  listMemoryCategoriesWithCounts,
  mergeMemoryCategories,
  planMemoryCategoryCleanup,
  renameMemoryCategory,
} from "../../memory/categories/admin.js";
import { getMemuEmbedder } from "../../memory/memu-embed.js";
import { contentHash } from "../../memory/memu-store.js";
import { MEMORY_TYPES } from "../../memory/memu-types.js";
import { buildCogneeSupplement, runCogneeSearch } from "../../memory/retrieve/cognee.js";
import { encodeForPrompt } from "../../utils/toon-encoding.js";
import { resolveUserTimezone } from "../date-time.js";
import { resolveEffectiveIntentForAgent } from "../intent.js";
import { inferDepartmentKnowledgeCollections } from "../support-rag-routing.js";
import {
  jsonResult,
  normalizeToolParams,
  readStringParam,
  readStringArrayParam,
  readNumberParam,
} from "./common.js";
import { appendMemoryRecallTelemetry } from "./memu-recall-telemetry.js";

// ── Mode Presets ──

interface ModeConfig {
  limitFloor: number;
  scoring: "similarity" | "salience" | "identity";
  deep: boolean;
  diversify: boolean;
  halfLifeDays: number;
  entityExpand: boolean;
  defaultTypes?: MemoryType[];
  /** Coverage score threshold below which two-pass auto-triggers (0-1). undefined = no auto-trigger. */
  coverageFloor?: number;
  /** Per-type priority weights. Types with weight > 1 get boosted, < 1 get demoted in final ranking. */
  typePriority?: Partial<Record<MemoryType, number>>;
  /** If true, hard-filter results to only defaultTypes (no bleed). */
  strictTypes?: boolean;
}

interface RecallIntentSignal {
  queryClass:
    | "identity_property"
    | "timeline_episodic"
    | "decision_project"
    | "synthesis"
    | "general";
  preferredMode?: RecallMode;
  reason?: "query-intent";
  slotKey?: string;
  slotTerms: string[];
  siblingPenaltyTerms: string[];
  profileBias: boolean;
  operatorBias: boolean;
  preferenceCueTerms?: string[];
  recencyBias?: boolean;
  docBias?: boolean;
  accomplishmentBias?: boolean;
}

type TimelineWindow = {
  granularity: "day" | "week" | "month";
  label: string;
  isoDate: string;
  endIsoDate: string;
  weekday?: string;
  startMs: number;
  endMs: number;
};

interface EntityFilterContext {
  entityItemIds: Set<string> | null;
  matchTerms: string[];
  resolvedEntities: Entity[];
}

interface RecallAnswerCandidate {
  value: string;
  strategy:
    | "favorite-slot"
    | "dog-name"
    | "pizza-preference"
    | "timeline-window"
    | "timeline-range"
    | "recent-project"
    | "who-is"
    | "where-live"
    | "summary-best-hit";
  confidence: number;
  sourceId: string;
  sourceType: string;
  sourceSummary: string;
}

interface RecallResultRow {
  item: {
    id: string;
    memoryType?: string;
    summary?: string;
    significance?: string;
    reinforcementCount?: number;
    createdAt?: string;
    happenedAt?: string | null;
    emotionalValence?: number;
    emotionalArousal?: number;
    reflection?: string | null;
    lesson?: string | null;
    extra?: Record<string, unknown>;
  };
  score: number;
  categories: string[];
}

type RecallResultSnapshot = {
  id: string;
  type: string | undefined;
  summary: string;
  score: number;
};

type RecallDecompositionStep = {
  key: string;
  label: string;
  query: string;
  mode?: RecallMode;
  reason: string;
  matchIndex: number;
};

type RecallDecompositionState = "confirmed" | "weak_recall" | "missing" | "error";

const STRICT_MULTI_FACT_RECALL_RE =
  /\b(?:for\s+each|each\s+one|one\s+by\s+one|separately|individually|per\s+fact|verify\s+each|show\s+evidence|with\s+evidence|break\s+(?:it|them)\s+down)\b/i;

function shouldUseObservationRetrieval(cfg: ArgentConfig): boolean {
  return (
    cfg.memory?.observations?.enabled === true &&
    cfg.memory?.observations?.retrieval?.enabled === true
  );
}

function buildRecallDecompositionPlan(query: string): RecallDecompositionStep[] {
  const steps: RecallDecompositionStep[] = [];
  const pushStep = (regex: RegExp, step: Omit<RecallDecompositionStep, "matchIndex">): void => {
    const match = regex.exec(query);
    if (!match || match.index < 0) return;
    steps.push({ ...step, matchIndex: match.index });
  };

  pushStep(/\bfavorite\s+color\b/i, {
    key: "favorite_color",
    label: "favorite color",
    query: "What's my favorite color?",
    mode: "preferences",
    reason: "favorite-color-fragment",
  });

  pushStep(/\b(?:pizza|toppings?|put\s+on\s+my\s+pizza|order\s+(?:on|for)\s+my\s+pizza)\b/i, {
    key: "pizza_toppings",
    label: "pizza toppings",
    query: "What toppings would I put on my pizza?",
    mode: "preferences",
    reason: "pizza-fragment",
  });

  pushStep(/\b(?:favorite\s+(?:fur\s+pal|fur\s+baby)|dog'?s\s+name|pet\s+name|favorite\s+pet)\b/i, {
    key: "dog_name",
    label: "dog name",
    query: "What's my dog's name?",
    mode: "identity",
    reason: "pet-identity-fragment",
  });

  pushStep(
    /\b(?:first\s+time\s+we\s+started\s+talking|first\s+conversation|earliest\s+memory|oldest\s+memory)\b/i,
    {
      key: "first_conversation",
      label: "first conversation",
      query: "first time we started talking with Jason",
      reason: "chronology-fragment",
    },
  );

  const deduped = new Map<string, RecallDecompositionStep>();
  for (const step of steps.sort((a, b) => a.matchIndex - b.matchIndex)) {
    if (!deduped.has(step.key)) deduped.set(step.key, step);
  }
  const ordered = [...deduped.values()].sort((a, b) => a.matchIndex - b.matchIndex);
  return ordered.length > 1 ? ordered : [];
}

function shouldUseRecallDecomposition(params: unknown, query: string): boolean {
  if (!params || typeof params !== "object") {
    return STRICT_MULTI_FACT_RECALL_RE.test(query);
  }
  const record = params as Record<string, unknown>;
  if (record.decompose === true) {
    return true;
  }
  if (record.decompose === false) {
    return false;
  }
  return STRICT_MULTI_FACT_RECALL_RE.test(query);
}

function classifyRecallDecompositionState(
  detail: Record<string, unknown>,
  factKey?: string,
): RecallDecompositionState {
  if (typeof detail.error === "string" && detail.error.trim()) return "error";

  const answer =
    detail.answer && typeof detail.answer === "object"
      ? (detail.answer as Record<string, unknown>)
      : null;
  const strategy = typeof answer?.strategy === "string" ? answer.strategy : "";
  const confidence = typeof answer?.confidence === "number" ? answer.confidence : 0;
  const results = Array.isArray(detail.results)
    ? (detail.results as Array<Record<string, unknown>>)
    : [];
  const topSummary = String(results[0]?.summary ?? answer?.sourceSummary ?? "").trim();

  if (!topSummary && results.length === 0) return "missing";
  if (topSummary && isNegativePropertyResult(topSummary)) return "missing";
  if (factKey === "first_conversation") {
    return "weak_recall";
  }
  if (strategy && strategy !== "summary-best-hit" && confidence >= 0.8) return "confirmed";
  return "weak_recall";
}

function inferObservationKindsForRecall(params: {
  intent: RecallIntentSignal | null;
  query: string;
}): KnowledgeObservationKind[] {
  switch (params.intent?.queryClass) {
    case "identity_property":
      return ["operator_preference", "relationship_fact"];
    case "decision_project":
      return ["project_state"];
    default:
      return [];
  }
}

type KnowledgeSearchHit = {
  id: string;
  score: number;
  summary: string;
  type: string;
  citation: string | null;
  collection: string | null;
  sourceFile: string | null;
  chunkIndex: number | null;
  chunkTotal: number | null;
  createdAt: string;
};

type MemoryWriteSanitizerPolicy = "log_only" | "drop" | "drop_and_alert";

type MemorySanitizerReasonCode =
  | "override_previous_instructions"
  | "system_role_injection"
  | "prompt_exfiltration_request"
  | "jailbreak_control_phrase";

const RECALL_MODES: Record<string, ModeConfig> = {
  general: {
    limitFloor: 10,
    scoring: "salience",
    deep: false,
    diversify: false,
    halfLifeDays: 30,
    entityExpand: false,
  },
  identity: {
    limitFloor: 25,
    scoring: "identity",
    deep: true,
    diversify: true,
    halfLifeDays: 90,
    entityExpand: true,
    coverageFloor: 0.75,
    typePriority: { profile: 1.5, event: 1.3, behavior: 1.2, knowledge: 0.8, self: 0.9 },
  },
  timeline: {
    limitFloor: 15,
    scoring: "salience",
    deep: false,
    diversify: false,
    halfLifeDays: 14,
    entityExpand: false,
    defaultTypes: ["event", "episode"],
    typePriority: { event: 1.4, episode: 1.2 },
    strictTypes: true,
  },
  preferences: {
    limitFloor: 15,
    scoring: "salience",
    deep: false,
    diversify: false,
    halfLifeDays: 120,
    entityExpand: false,
    defaultTypes: ["behavior", "profile"],
    strictTypes: true,
    typePriority: { behavior: 1.5, profile: 1.0 },
  },
  incident: {
    limitFloor: 20,
    scoring: "salience",
    deep: true,
    diversify: true,
    halfLifeDays: 60,
    entityExpand: true,
    coverageFloor: 0.75,
    typePriority: { event: 1.5, knowledge: 1.2, self: 1.1, behavior: 0.8 },
  },
};

function buildRecallResultSnapshot(results: RecallResultRow[], limit = 5): RecallResultSnapshot[] {
  return results.slice(0, limit).map((result) => ({
    id: result.item.id,
    type: result.item.memoryType,
    summary: stripCitation(String(result.item.summary ?? "")),
    score: Math.round(result.score * 1000) / 1000,
  }));
}

type RecallMode = keyof typeof RECALL_MODES;

const OPERATIONAL_PROFILE_HINT_RE =
  /\b(?:status|snapshot|health|metric|count|queue|uptime|latency|ticket|alert|cron|heartbeat|service|gateway|dashboard|api|provider|model)\b/i;
const OP_PROFILE_NUMERIC_RE = /\b\d+(?:[.,]\d+)?%?\b/g;
const OP_PROFILE_DATETIME_RE =
  /\b\d{4}-\d{2}-\d{2}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?:z)?\b/gi;
const OP_PROFILE_ID_RE =
  /\b(?:[a-f0-9]{8,}|[a-f0-9]{8}-[a-f0-9-]{27,}|(?:run|req|msg)-[a-z0-9-]+)\b/gi;
const OP_PROFILE_NUMERIC_TEST_RE = /\b\d+(?:[.,]\d+)?%?\b/;
const OP_PROFILE_DATETIME_TEST_RE =
  /\b\d{4}-\d{2}-\d{2}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?:z)?\b/i;

const RELATIONSHIP_ALIAS_GROUPS: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "mother", aliases: ["mom", "mother", "mama", "mum", "mommy"] },
  { canonical: "father", aliases: ["dad", "father", "daddy", "papa"] },
  { canonical: "wife", aliases: ["wife", "spouse"] },
  { canonical: "husband", aliases: ["husband", "spouse"] },
  { canonical: "son", aliases: ["son", "boy"] },
  { canonical: "daughter", aliases: ["daughter", "girl"] },
  { canonical: "brother", aliases: ["brother"] },
  { canonical: "sister", aliases: ["sister"] },
];

const FAMILY_CARE_SIGNAL_RE =
  /\b(mom|mother|dad|father|caregiver|caregiving|dementia|hospice|wandering|fall|stroke|safety|confused|confusion|memory care)\b/i;
const FAMILY_CARE_CONTEXT_RE =
  /\b(dementia|hospice|wandering|fall|stroke|caregiver|caregiving|safety|confused|confusion|nitroglycerin|memory care|neurological)\b/i;

const WEEKDAY_TO_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const INDEX_TO_WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MEMORY_WRITE_SANITIZER_PATTERNS: Array<{
  code: MemorySanitizerReasonCode;
  regex: RegExp;
}> = [
  {
    code: "override_previous_instructions",
    regex:
      /\b(?:ignore|disregard|override)\b[\s\S]{0,80}\b(?:previous|prior|earlier)\b[\s\S]{0,80}\binstructions?\b/i,
  },
  {
    code: "system_role_injection",
    regex: /(?:^|\n)\s*(?:system|developer|assistant)\s*:\s*/i,
  },
  {
    code: "prompt_exfiltration_request",
    regex:
      /\b(?:reveal|show|print|output|leak)\b[\s\S]{0,80}\b(?:system prompt|hidden prompt|developer message|chain[- ]of[- ]thought)\b/i,
  },
  {
    code: "jailbreak_control_phrase",
    regex: /\b(?:you are now|do anything now|DAN|bypass safety|act as root)\b/i,
  },
];

const memoryWriteSanitizerCounters = {
  seen: 0,
  flagged: 0,
  dropped: 0,
  alerts: 0,
  reasonCodes: {} as Record<string, number>,
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAliasTerm(text: string, alias: string): boolean {
  return new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(text);
}

function tokenizeIntentTerms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function containsAnyIntentCue(text: string, terms: string[]): boolean {
  return terms.some((term) => containsAliasTerm(text, term));
}

function normalizeEntityName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function extractTemporalEntitySubject(query: string): string | null {
  const trimmed = query.trim().replace(/[?!.\s]+$/g, "");
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

function isStrongCanonicalEntityName(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^[A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*)+$/.test(trimmed) &&
    !trimmed.includes("(") &&
    !/'s\b/i.test(trimmed)
  );
}

async function resolveEntityFilterContext(params: {
  memory: MemoryAdapter;
  entityFilter: string;
}): Promise<EntityFilterContext> {
  const trimmed = params.entityFilter.trim();
  if (!trimmed) {
    return { entityItemIds: null, matchTerms: [], resolvedEntities: [] };
  }

  const allEntities = await params.memory.listEntities({ limit: 500 });
  const normalizedFilter = normalizeEntityName(trimmed);
  const exactEntities = allEntities.filter(
    (entity) => normalizeEntityName(entity.name) === normalizedFilter,
  );

  const resolvedEntities = [...exactEntities];
  const matchTerms = new Set<string>([trimmed]);

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const single = normalizeEntityName(parts[0] ?? "");
    const canonicalMatches = allEntities.filter((entity) => {
      if (!isStrongCanonicalEntityName(entity.name)) return false;
      const first = normalizeEntityName(entity.name.split(/\s+/)[0] ?? "");
      return first === single;
    });
    if (canonicalMatches.length === 1) {
      resolvedEntities.push(canonicalMatches[0]);
      matchTerms.add(canonicalMatches[0].name);
    }
  } else if (parts.length >= 2 && isStrongCanonicalEntityName(trimmed)) {
    const first = normalizeEntityName(parts[0] ?? "");
    const firstTokenMatches = allEntities.filter(
      (entity) =>
        normalizeEntityName(entity.name) === first ||
        (entity.name.split(/\s+/).length === 1 && normalizeEntityName(entity.name) === first),
    );
    const competingCanonicals = allEntities.filter((entity) => {
      if (!isStrongCanonicalEntityName(entity.name)) return false;
      const candidateFirst = normalizeEntityName(entity.name.split(/\s+/)[0] ?? "");
      return candidateFirst === first;
    });
    if (competingCanonicals.length === 1 && competingCanonicals[0].name === trimmed) {
      matchTerms.add(parts[0] ?? "");
      for (const entity of firstTokenMatches) {
        resolvedEntities.push(entity);
        matchTerms.add(entity.name);
      }
    }
  }

  const uniqueResolved = new Map<string, Entity>();
  for (const entity of resolvedEntities) {
    uniqueResolved.set(entity.id, entity);
    matchTerms.add(entity.name);
  }

  const entityItemIds =
    uniqueResolved.size > 0
      ? new Set(
          (
            await Promise.all(
              [...uniqueResolved.values()].map((entity) =>
                params.memory.getEntityItems(entity.id, 200),
              ),
            )
          )
            .flat()
            .map((item) => item.id),
        )
      : null;

  return {
    entityItemIds,
    matchTerms: [...matchTerms].filter((term) => term.trim().length > 0),
    resolvedEntities: [...uniqueResolved.values()],
  };
}

function itemMatchesEntityTerms(
  item: {
    summary?: string;
    reflection?: string | null;
    lesson?: string | null;
  },
  matchTerms: string[],
): boolean {
  if (matchTerms.length === 0) return false;
  const haystack = `${String(item.summary ?? "")} ${String(item.reflection ?? "")} ${String(item.lesson ?? "")}`;
  return matchTerms.some((term) => containsAliasTerm(haystack.toLowerCase(), term.toLowerCase()));
}

function hasWebsiteProjectCue(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const websiteSurface = hasWebsiteProjectSurface(normalized);
  const deliverySurface = hasWebsiteProjectDeliverySurface(normalized);
  return (
    (websiteSurface && deliverySurface) ||
    (/\b(?:namecheap|cloudflare|coolify)\b/i.test(normalized) &&
      /\b(?:woman|client|website|site|portfolio|resume|cv)\b/i.test(normalized))
  );
}

function isWebsiteProjectIntent(intent: RecallIntentSignal | null): boolean {
  if (!intent || intent.queryClass !== "decision_project") return false;
  return intent.slotTerms.some((term) =>
    [
      "website",
      "site",
      "portfolio",
      "resume",
      "cv",
      "domain",
      "cloudflare",
      "coolify",
      "namecheap",
    ].includes(term),
  );
}

function buildProjectSlotTerms(query: string, websiteProject = false): string[] {
  const terms = new Set(tokenizeIntentTerms(query).filter((term) => term.length >= 3));
  terms.add("project");
  terms.add("build");
  terms.add("plan");
  if (websiteProject) {
    for (const term of [
      "website",
      "site",
      "portfolio",
      "resume",
      "cv",
      "domain",
      "cloudflare",
      "coolify",
      "namecheap",
    ]) {
      terms.add(term);
    }
  }
  return [...terms];
}

const GENERIC_DECISION_PROJECT_TERMS = new Set([
  "project",
  "projects",
  "build",
  "building",
  "built",
  "plan",
  "planning",
  "planned",
  "decision",
  "agreed",
  "recent",
  "new",
  "development",
  "working",
  "together",
  "website",
  "site",
  "portfolio",
  "resume",
  "cv",
  "domain",
  "cloudflare",
  "coolify",
  "namecheap",
  "client",
  "woman",
  "simple",
  "started",
  "week",
  "last",
  "active",
  "draft",
  "tech",
  "stack",
  "initial",
  "task",
  "breakdown",
  "brief",
  "jason",
]);

function extractSpecificDecisionProjectTerms(intent: RecallIntentSignal): string[] {
  if (intent.queryClass !== "decision_project") return [];
  return intent.slotTerms.filter(
    (term) => term.length >= 4 && !GENERIC_DECISION_PROJECT_TERMS.has(term),
  );
}

const FAVORITE_SLOT_BOUNDARY_TERMS = new Set([
  "and",
  "ate",
  "beginning",
  "brashear",
  "conversation",
  "conversations",
  "earliest",
  "early",
  "exact",
  "first",
  "if",
  "jason",
  "last",
  "leo",
  "memory",
  "month",
  "oldest",
  "opening",
  "pizza",
  "relationship",
  "started",
  "talking",
  "time",
  "timeline",
  "topping",
  "toppings",
  "week",
  "with",
  "yesterday",
  "today",
]);

function sanitizeFavoriteSlotKey(rawSlotKey: string): string {
  const cleaned = rawSlotKey.trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
  if (!cleaned) return "";

  const kept: string[] = [];
  for (const token of cleaned.split(/\s+/)) {
    const normalizedToken = token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
    if (!normalizedToken) continue;
    if (kept.length > 0 && FAVORITE_SLOT_BOUNDARY_TERMS.has(normalizedToken)) break;
    kept.push(normalizedToken);
    if (kept.length >= 3) break;
  }

  return kept.join(" ").trim();
}

function canonicalizeIdentityPropertySlotKey(slotKey: string): string {
  switch (slotKey.trim().toLowerCase()) {
    case "dog":
    case "dog name":
    case "fur baby":
    case "fur pal":
    case "pet":
    case "pet name":
      return "dog name";
    default:
      return slotKey.trim().toLowerCase();
  }
}

function buildDogNameIntentSignal(): RecallIntentSignal {
  return {
    queryClass: "identity_property",
    preferredMode: "identity",
    reason: "query-intent",
    slotKey: "dog name",
    slotTerms: ["dog", "name"],
    siblingPenaltyTerms: [],
    profileBias: true,
    operatorBias: true,
    preferenceCueTerms: [],
  };
}

function buildDecisionProjectIntentSignal(params: {
  query: string;
  reason: string;
  websiteProject?: boolean;
  recencyBias?: boolean;
  accomplishmentBias?: boolean;
}): RecallIntentSignal {
  return {
    queryClass: "decision_project",
    preferredMode: "incident",
    reason: params.reason,
    slotTerms: buildProjectSlotTerms(params.query, params.websiteProject ?? false),
    siblingPenaltyTerms: [],
    profileBias: false,
    operatorBias: true,
    preferenceCueTerms: [],
    recencyBias: params.recencyBias ?? false,
    docBias: true,
    accomplishmentBias: params.accomplishmentBias ?? false,
  };
}

function detectRecallIntentSignal(query: string): RecallIntentSignal | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  const temporalEntitySubject = extractTemporalEntitySubject(query);
  const accomplishmentQuery =
    /\b(?:accomplished|accomplishment|completed|finished|shipped|built|implemented|worked on|get done|got done|done)\b/i.test(
      normalized,
    );
  const timelineCue =
    /\b(?:today|yesterday|last|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      normalized,
    );
  const projectWorkCue =
    /\bprojects?\b/i.test(normalized) &&
    /\b(?:started|starting|building|build|working on|work on|development|developing|spec(?:ced|ing)?|planning)\b/i.test(
      normalized,
    );
  const websiteProjectCue = hasWebsiteProjectCue(normalized);
  const entityTimelineRecallCue =
    Boolean(temporalEntitySubject) &&
    /\b(?:memories?|memory|timeline|events?|remember)\b/i.test(normalized);

  const favoriteMatch = normalized.match(
    /\b(?:what(?:'s| is)?\s+)?(?:my|jason(?:'s)?)?\s*favorite\s+([a-z][a-z0-9 -]{1,40})\b/i,
  );
  if (favoriteMatch) {
    const slotKey = canonicalizeIdentityPropertySlotKey(
      sanitizeFavoriteSlotKey(favoriteMatch[1].replace(/\?+$/, "")),
    );
    if (slotKey) {
      if (slotKey === "dog name") {
        return buildDogNameIntentSignal();
      }
      return {
        queryClass: "identity_property",
        preferredMode: "preferences",
        reason: "query-intent",
        slotKey,
        slotTerms: tokenizeIntentTerms(`favorite ${slotKey}`),
        siblingPenaltyTerms: ["favorite"],
        profileBias: true,
        operatorBias: true,
        preferenceCueTerms: ["favorite", "prefer", "like", "love"],
      };
    }
  }

  if (
    /\bwhat(?:'s| is)\s+my\s+dog'?s\s+name\b/i.test(normalized) ||
    /\bwhat(?:'s| is)\s+the\s+name\s+of\s+my\s+dog\b/i.test(normalized)
  ) {
    return buildDogNameIntentSignal();
  }

  if (/\bwhere\s+(?:do\s+i|does\s+jason)\s+live\b/i.test(normalized)) {
    return {
      queryClass: "identity_property",
      preferredMode: "identity",
      reason: "query-intent",
      slotKey: "live",
      slotTerms: ["live", "lives"],
      siblingPenaltyTerms: [],
      profileBias: true,
      operatorBias: true,
      preferenceCueTerms: [],
    };
  }

  if (/\bwhat\s+do\s+i\s+like\b/i.test(normalized)) {
    return {
      queryClass: "identity_property",
      preferredMode: "preferences",
      reason: "query-intent",
      slotTerms: ["like", "prefer", "favorite"],
      siblingPenaltyTerms: [],
      profileBias: true,
      operatorBias: true,
      preferenceCueTerms: ["like", "prefer", "favorite", "love"],
    };
  }

  if (/\b(?:pizza|toppings?)\b/i.test(normalized)) {
    return {
      queryClass: "identity_property",
      preferredMode: "preferences",
      reason: "query-intent",
      slotKey: "pizza toppings",
      slotTerms: ["pizza", "topping", "toppings", "order"],
      siblingPenaltyTerms: [],
      profileBias: true,
      operatorBias: true,
      preferenceCueTerms: [
        "like",
        "likes",
        "love",
        "loves",
        "prefer",
        "prefers",
        "order",
        "orders",
      ],
    };
  }

  const whoIsMatch = normalized.match(/\bwho\s+is\s+([a-z][a-z0-9 .'-]{1,60})\b/i);
  if (whoIsMatch) {
    return {
      queryClass: "identity_property",
      preferredMode: "identity",
      reason: "query-intent",
      slotKey: whoIsMatch[1].trim(),
      slotTerms: tokenizeIntentTerms(whoIsMatch[1]),
      siblingPenaltyTerms: [],
      profileBias: true,
      operatorBias: false,
      preferenceCueTerms: [],
    };
  }

  if (websiteProjectCue) {
    return buildDecisionProjectIntentSignal({
      query,
      reason: "query-intent",
      websiteProject: true,
      recencyBias: timelineCue,
      accomplishmentBias: timelineCue,
    });
  }

  if (/\bproject\b/i.test(normalized) && hasWebsiteProjectSurface(normalized)) {
    return buildDecisionProjectIntentSignal({
      query,
      reason: "query-intent",
      websiteProject: true,
      recencyBias: timelineCue,
      accomplishmentBias: timelineCue,
    });
  }

  if (projectWorkCue && timelineCue) {
    return buildDecisionProjectIntentSignal({
      query,
      reason: "query-intent",
      recencyBias: true,
      accomplishmentBias: true,
    });
  }

  if (entityTimelineRecallCue && timelineCue) {
    return {
      queryClass: "timeline_episodic",
      preferredMode: "timeline",
      reason: "query-intent",
      slotTerms: tokenizeIntentTerms(`${temporalEntitySubject ?? ""} event timeline memory`),
      siblingPenaltyTerms: [],
      profileBias: false,
      operatorBias: true,
      preferenceCueTerms: [],
      accomplishmentBias: false,
    };
  }

  if (
    (/\bwhat\s+(?:did|happened?)\b/i.test(normalized) ||
      /\b(?:summari[sz]e|recap|review|tell me)\b/i.test(normalized) ||
      accomplishmentQuery) &&
    timelineCue
  ) {
    return {
      queryClass: "timeline_episodic",
      preferredMode: "timeline",
      reason: "query-intent",
      slotTerms: ["event", "timeline", "happened", "did", "accomplished", "completed", "built"],
      siblingPenaltyTerms: [],
      profileBias: false,
      operatorBias: true,
      preferenceCueTerms: [],
      accomplishmentBias: accomplishmentQuery,
    };
  }

  if (/\b(?:what did we decide|decision|agreed|plan|current plan)\b/i.test(normalized)) {
    return buildDecisionProjectIntentSignal({
      query,
      reason: "query-intent",
    });
  }

  if (
    /\b(?:most recent|recent|new)\s+(?:development\s+)?project\b/i.test(normalized) ||
    /\bwhat(?:'s| is)\s+the\s+most\s+recent\s+project\b/i.test(normalized) ||
    /\bworking on together\b/i.test(normalized)
  ) {
    return buildDecisionProjectIntentSignal({
      query,
      reason: "query-intent",
      recencyBias: true,
    });
  }

  if (/\b(?:what matters to me|lately|pattern|trend|stressed|recurring)\b/i.test(normalized)) {
    return {
      queryClass: "synthesis",
      preferredMode: "incident",
      reason: "query-intent",
      slotTerms: ["pattern", "trend", "lesson", "reflection"],
      siblingPenaltyTerms: [],
      profileBias: false,
      operatorBias: true,
      preferenceCueTerms: [],
      recencyBias: false,
      docBias: false,
    };
  }

  return null;
}

function inferLatentProjectIntentFromHits(params: {
  query: string;
  currentIntent: RecallIntentSignal | null;
  results: Array<{
    item: {
      memoryType?: string;
      summary?: string;
      extra?: Record<string, unknown>;
    };
    score: number;
  }>;
}): RecallIntentSignal | null {
  if (params.currentIntent) return null;
  const normalized = params.query.trim();
  if (!normalized) return null;
  if (
    /\b(?:what|who|where|when|why|how|did|do|does|is|are|can|could|should|would|please|last|week|today|yesterday)\b/i.test(
      normalized,
    )
  ) {
    return null;
  }

  const queryTerms = tokenizeIntentTerms(normalized).filter((term) => term.length >= 3);
  if (queryTerms.length < 2 || queryTerms.length > 6) return null;

  let strongProjectHits = 0;
  let websiteProjectHits = 0;
  let docBackedHits = 0;
  for (const result of params.results.slice(0, 12)) {
    const summary = String(result.item.summary ?? "");
    if (!summary) continue;
    const lowered = stripCitation(summary).toLowerCase();
    const overlap = queryTerms.filter((term) => containsAliasTerm(lowered, term)).length;
    if (overlap < Math.min(2, queryTerms.length)) continue;

    const extra =
      result.item.extra && typeof result.item.extra === "object"
        ? (result.item.extra as Record<string, unknown>)
        : {};
    const source = typeof extra.source === "string" ? extra.source : undefined;
    const hasProjectTitle = extractRecentProjectTitle(summary) !== null;
    const websiteProject = isWebsiteProjectSupport(summary);
    const docBacked = isKnowledgeCollectionScopedSource(source);
    if (hasProjectTitle || websiteProject || docBacked) {
      strongProjectHits += 1;
      if (websiteProject) websiteProjectHits += 1;
      if (docBacked) docBackedHits += 1;
    }
  }

  if (strongProjectHits === 0) return null;

  return buildDecisionProjectIntentSignal({
    query: normalized,
    reason: "latent-project-match",
    websiteProject: websiteProjectHits > 0,
    recencyBias: false,
    accomplishmentBias: false,
  });
}

function buildIntentQueryVariants(
  query: string,
  intent: RecallIntentSignal | null,
  timelineWindow?: TimelineWindow | null,
): string[] {
  if (!intent) return [query];
  const variants = new Set<string>([query]);
  const parts = new Set<string>();

  if (intent.slotKey) parts.add(intent.slotKey);
  for (const term of intent.slotTerms) parts.add(term);
  for (const cue of intent.preferenceCueTerms ?? []) parts.add(cue);
  if (intent.operatorBias) parts.add("Jason");

  const compact = [...parts].filter(Boolean).join(" ").trim();
  if (compact) {
    variants.add(`${query} ${compact}`.trim());
    variants.add(compact);
  }

  if (intent?.queryClass === "identity_property" && intent.slotKey) {
    const favoriteSlotQuery = (intent.preferenceCueTerms ?? []).includes("favorite");
    if (favoriteSlotQuery) {
      variants.add(`Jason's favorite ${intent.slotKey}`);
      variants.add(`favorite ${intent.slotKey}`);
    }
    if (intent.slotKey === "dog name") {
      variants.add("Jason dog name");
      variants.add("Jason pet name");
      variants.add("dog name");
    }
    if (intent.slotKey === "live") {
      variants.add("Jason lives");
      variants.add("where Jason lives");
    }
    if (intent.slotKey === "pizza toppings") {
      variants.add("Jason pizza toppings");
      variants.add("Jason pizza order");
      variants.add("Jason likes pizza");
      variants.add("pizza preference");
    }
  }

  if (intent?.queryClass === "timeline_episodic") {
    variants.add(`${query} event timeline`);
    variants.add("recent event timeline");
    if (intent.accomplishmentBias) {
      variants.add("last week accomplishments");
      variants.add("completed last week");
      variants.add("built last week");
      variants.add("what we worked on last week");
    }
    if (timelineWindow) {
      variants.add(timelineWindow.isoDate);
      variants.add(`${timelineWindow.isoDate} to ${timelineWindow.endIsoDate}`);
      if (timelineWindow.granularity === "day" && timelineWindow.weekday) {
        variants.add(`${timelineWindow.weekday} ${timelineWindow.isoDate}`);
        variants.add(`events on ${timelineWindow.isoDate}`);
        variants.add(`what happened ${timelineWindow.weekday}`);
      } else if (timelineWindow.granularity === "month") {
        variants.add(`events from ${timelineWindow.isoDate} to ${timelineWindow.endIsoDate}`);
        variants.add("what happened in the past month");
        variants.add("memories from the past month");
      } else {
        variants.add(`week of ${timelineWindow.isoDate}`);
        variants.add(`events from ${timelineWindow.isoDate} to ${timelineWindow.endIsoDate}`);
        variants.add("what happened last week");
      }
    }
  }

  if (intent?.queryClass === "decision_project") {
    variants.add(`${query} decision plan`);
    variants.add("decision plan agreed");
    if (isWebsiteProjectIntent(intent)) {
      variants.add("simple website portfolio");
      variants.add("resume portfolio website");
      variants.add("woman client website");
      variants.add("resume website collecting data");
      variants.add("domain Namecheap Cloudflare Coolify");
      variants.add("Cloudflare Coolify Namecheap");
    }
    if (intent.accomplishmentBias) {
      variants.add("projects started last week");
      variants.add("projects started building");
      variants.add("projects we are working on");
      variants.add("active development last week");
    }
    if (timelineWindow) {
      variants.add(`project work ${timelineWindow.isoDate}`);
      variants.add(`projects from ${timelineWindow.isoDate} to ${timelineWindow.endIsoDate}`);
      variants.add(`week of ${timelineWindow.isoDate} project`);
    }
    if (intent.recencyBias) {
      variants.add("most recent project");
      variants.add("recent development project");
      variants.add("new development project");
      variants.add("project planning");
      variants.add("working on together project");
    }
    if (intent.docBias) {
      variants.add("PRP Planning Draft");
      variants.add("Tech Stack");
      variants.add("Initial Task Breakdown");
      variants.add("V1 PRD Draft");
      variants.add("Conversational Discovery Brief");
    }
  }

  return [...variants].filter((entry) => entry.trim().length > 0);
}

function scoreManualPropertyCandidate(params: {
  summary: string;
  memoryType?: string;
  intent: RecallIntentSignal;
}): number {
  const summary = params.summary;
  const lowered = summary.toLowerCase();
  const summaryTerms = new Set(tokenizeIntentTerms(summary));
  let score = 0;

  const slotMatches = params.intent.slotTerms.filter((term) => summaryTerms.has(term)).length;
  score += slotMatches * 1.6;

  if (params.intent.operatorBias && containsAliasTerm(lowered, "jason")) {
    score += 1.4;
  }

  if (params.intent.profileBias && params.memoryType === "profile") {
    score += 1.2;
  }

  if (
    params.intent.preferenceCueTerms?.length &&
    containsAnyIntentCue(lowered, params.intent.preferenceCueTerms)
  ) {
    score += 1.1;
  }

  if (params.intent.slotKey) {
    const escapedSlot = escapeRegExp(params.intent.slotKey);
    if (new RegExp(`\\bfavorite\\s+${escapedSlot}\\b`, "i").test(summary)) {
      score += 6;
    }
    if (new RegExp(`\\b${escapedSlot}\\b`, "i").test(summary)) {
      score += 2.5;
    }
  }

  if (params.intent.slotKey === "dog name") {
    if (
      /\b(?:dog'?s name is|pet name is|named)\s+[A-Z][a-z]+/.test(summary) ||
      /^.+?\s+is\s+(?:Jason'?s|my)\s+dog\b/i.test(summary)
    ) {
      score += 6;
    }
  }

  if (params.intent.slotKey === "pizza toppings") {
    if (
      /\bpizza\b/i.test(summary) &&
      /\b(?:like|likes|love|loves|prefer|prefers|order|orders)\b/i.test(summary)
    ) {
      score += 5;
    }
    if (/\b(?:canadian bacon|extra cheese|pepperoni|sausage|jalape(?:n|ñ)o)\b/i.test(summary)) {
      score += 4;
    }
  }

  if (params.intent.slotKey && lowered.includes("favorite") && slotMatches === 0) {
    score -= 3;
  }

  if (
    params.intent.queryClass === "identity_property" &&
    /\b(?:communication|warmth|voice|style|automation|integration)\b/i.test(summary) &&
    params.intent.slotKey &&
    !summaryTerms.has(params.intent.slotKey.toLowerCase())
  ) {
    score -= 2.5;
  }

  return score;
}

async function collectManualPropertyCandidates(params: {
  memory: MemoryAdapter;
  intent: RecallIntentSignal | null;
  limit: number;
}): Promise<RecallResultRow[]> {
  if (!params.intent || params.intent.queryClass !== "identity_property") return [];
  const candidateTypes: Array<MemoryType> =
    params.intent.preferredMode === "identity" ? ["profile", "behavior"] : ["profile", "behavior"];
  const merged = new Map<string, RecallResultRow>();

  for (const memoryType of candidateTypes) {
    const pageSize = memoryType === "profile" ? 800 : 500;
    const maxPages = memoryType === "profile" ? 5 : 3;
    for (let page = 0; page < maxPages; page += 1) {
      const items = await params.memory.listItems({
        memoryType,
        limit: pageSize,
        offset: page * pageSize,
      });
      if (items.length === 0) break;

      for (const item of items) {
        const score = scoreManualPropertyCandidate({
          summary: String(item.summary ?? ""),
          memoryType: item.memoryType,
          intent: params.intent,
        });
        if (score < 4.5) continue;
        const existing = merged.get(item.id);
        const candidate: RecallResultRow = {
          item,
          score: 0.45 + score * 0.22,
          categories: [],
        };
        if (!existing || candidate.score > existing.score) {
          merged.set(item.id, candidate);
        }
      }

      if (merged.size >= params.limit) break;
    }
  }

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, params.limit);
}

function scoreManualTimelineCandidate(params: {
  item: RecallResultRow["item"];
  timelineWindow: TimelineWindow;
}): number {
  const eventAt = parseItemTimelineEpoch(params.item);
  if (!itemFallsWithinTimelineWindow(params.item, params.timelineWindow)) {
    return -1;
  }

  const summary = String(params.item.summary ?? "");
  const lowered = summary.toLowerCase();
  let score = 0;

  if (params.item.memoryType === "event") score += 5.5;
  else if (params.item.memoryType === "episode") score += 4.2;
  else if (params.item.memoryType === "knowledge") score += 2;

  if (
    params.timelineWindow.granularity === "day" &&
    params.timelineWindow.weekday &&
    containsAliasTerm(lowered, params.timelineWindow.weekday.toLowerCase())
  ) {
    score += 0.8;
  }
  if (lowered.includes(params.timelineWindow.isoDate)) score += 1.2;
  if (
    /\b(?:did|worked|built|fixed|deployed|planned|decided|created|drafted|shaped|completed|finished|implemented|shipped|merged|wired)\b/i.test(
      summary,
    )
  ) {
    score += 1.4;
  }
  if (/\b(?:status|heartbeat|cron|ticket|queue|uptime|metric|alert)\b/i.test(summary)) {
    score -= 2.2;
  }

  return score;
}

function isAccomplishmentTimelineSupport(summary: string): boolean {
  return /\b(?:built|fixed|deployed|planned|decided|created|drafted|shaped|completed|finished|implemented|shipped|merged|wired|launched)\b/i.test(
    summary,
  );
}

function isTimelineOperationalNoise(summary: string): boolean {
  return /\b(?:status|heartbeat|cron|ticket|queue|uptime|metric|alert|monitoring|scheduled run|email check|vip email|job finished|next run)\b/i.test(
    summary,
  );
}

async function collectManualTimelineCandidates(params: {
  memory: MemoryAdapter;
  intent: RecallIntentSignal | null;
  timelineWindow?: TimelineWindow | null;
  limit: number;
}): Promise<RecallResultRow[]> {
  if (params.intent?.queryClass !== "timeline_episodic" || !params.timelineWindow) {
    return [];
  }

  const merged = new Map<string, RecallResultRow>();
  const pageSize = Math.max(20, Math.min(100, params.limit * 4));

  for (const memoryType of ["event", "episode"] as const) {
    for (let page = 0; page < 4; page++) {
      const items = await params.memory.listItems({
        memoryType,
        limit: pageSize,
        offset: page * pageSize,
      });
      if (items.length === 0) break;

      for (const item of items) {
        const score = scoreManualTimelineCandidate({
          item,
          timelineWindow: params.timelineWindow,
        });
        if (score < 4.5) continue;
        const existing = merged.get(item.id);
        const candidate: RecallResultRow = {
          item,
          score: 0.5 + score * 0.24,
          categories: [],
        };
        if (!existing || candidate.score > existing.score) {
          merged.set(item.id, candidate);
        }
      }

      if (merged.size >= params.limit) break;
    }
    if (merged.size >= params.limit) break;
  }

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, params.limit);
}

function parseCreatedAtEpoch(value: string | undefined): number {
  if (!value) return 0;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : 0;
}

function parseItemTimelineEpoch(item: { happenedAt?: string | null; createdAt?: string }): number {
  return parseCreatedAtEpoch(item.happenedAt ?? undefined) || parseCreatedAtEpoch(item.createdAt);
}

function extractTimelineIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const directMatch = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (directMatch?.[1]) return directMatch[1];
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return null;
  return new Date(epoch).toISOString().slice(0, 10);
}

function itemFallsWithinTimelineWindow(
  item: { happenedAt?: string | null; createdAt?: string },
  timelineWindow: TimelineWindow,
): boolean {
  const itemIsoDate =
    extractTimelineIsoDate(item.happenedAt) ?? extractTimelineIsoDate(item.createdAt);
  if (itemIsoDate) {
    return itemIsoDate >= timelineWindow.isoDate && itemIsoDate <= timelineWindow.endIsoDate;
  }

  const eventAt = parseItemTimelineEpoch(item);
  return eventAt >= timelineWindow.startMs && eventAt < timelineWindow.endMs;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildTimelineDayWindow(date: Date): TimelineWindow {
  const start = startOfLocalDay(date);
  const end = addLocalDays(start, 1);
  return {
    granularity: "day",
    label: `${INDEX_TO_WEEKDAY[start.getDay()]}, ${formatLocalIsoDate(start)}`,
    isoDate: formatLocalIsoDate(start),
    endIsoDate: formatLocalIsoDate(start),
    weekday: INDEX_TO_WEEKDAY[start.getDay()] ?? "Unknown",
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function buildTimelineWeekWindow(startDate: Date, label: string): TimelineWindow {
  const start = startOfLocalDay(startDate);
  const end = addLocalDays(start, 7);
  return {
    granularity: "week",
    label,
    isoDate: formatLocalIsoDate(start),
    endIsoDate: formatLocalIsoDate(addLocalDays(end, -1)),
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function buildTimelineMonthWindow(
  startDate: Date,
  endDateInclusive: Date,
  label: string,
): TimelineWindow {
  const start = startOfLocalDay(startDate);
  const end = addLocalDays(startOfLocalDay(endDateInclusive), 1);
  return {
    granularity: "month",
    label,
    isoDate: formatLocalIsoDate(start),
    endIsoDate: formatLocalIsoDate(addLocalDays(end, -1)),
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function detectTimelineWindow(query: string, now: Date = new Date()): TimelineWindow | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  const today = startOfLocalDay(now);
  if (/\btoday\b/i.test(normalized)) {
    return buildTimelineDayWindow(today);
  }
  if (/\byesterday\b/i.test(normalized)) {
    return buildTimelineDayWindow(addLocalDays(today, -1));
  }

  const weekday = Object.keys(WEEKDAY_TO_INDEX).find((name) => containsAliasTerm(normalized, name));
  if (!weekday) {
    const currentWeekMonday = addLocalDays(today, -((today.getDay() + 6) % 7));
    if (/\b(?:last|past)\s+(?:month|30\s+days?)\b/i.test(normalized)) {
      const monthStart = addLocalDays(today, -29);
      return buildTimelineMonthWindow(
        monthStart,
        today,
        `Past 30 days ending ${formatLocalIsoDate(today)}`,
      );
    }
    if (/\b(?:last|past)\s+week\b/i.test(normalized)) {
      const lastWeekMonday = addLocalDays(currentWeekMonday, -7);
      return buildTimelineWeekWindow(
        lastWeekMonday,
        `Week of ${formatLocalIsoDate(lastWeekMonday)}`,
      );
    }
    if (/\bthis week\b/i.test(normalized)) {
      return buildTimelineWeekWindow(
        currentWeekMonday,
        `Week of ${formatLocalIsoDate(currentWeekMonday)}`,
      );
    }
    return null;
  }

  const targetDayIndex = WEEKDAY_TO_INDEX[weekday];
  if (targetDayIndex === undefined) {
    return null;
  }

  if (/\blast week\b/i.test(normalized)) {
    const currentWeekMonday = addLocalDays(today, -((today.getDay() + 6) % 7));
    const lastWeekMonday = addLocalDays(currentWeekMonday, -7);
    const mondayIndex = (targetDayIndex + 6) % 7;
    return buildTimelineDayWindow(addLocalDays(lastWeekMonday, mondayIndex));
  }

  const daysBack = (today.getDay() - targetDayIndex + 7) % 7 || 7;
  return buildTimelineDayWindow(addLocalDays(today, -daysBack));
}

function stripCitationAndHeading(summary: string): string {
  return stripCitation(summary)
    .replace(/^#+\s*/gm, "")
    .trim();
}

function extractRecentProjectTitle(summary: string): string | null {
  const cleaned = stripCitationAndHeading(summary);
  const firstLine = cleaned
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;

  const normalizedLine = firstLine
    .replace(
      /^(?:PRP|Planning PRP|Base PRP|Tech Stack|Initial Task Breakdown|Conversational Discovery Brief)\s*:\s*/i,
      "",
    )
    .trim();

  const explicitForwardObserver = normalizedLine.match(
    /\bForward Observer Area Intelligence Platform\b/i,
  );
  if (explicitForwardObserver) {
    return "Forward Observer Area Intelligence Platform";
  }

  const namedProjectFromSentence = normalizedLine.match(
    /\b(?:built|building|designed|creating|created|granted(?:\s+the\s+family\s+dev\s+team\s+permission\s+to\s+build)?)\s+(?:the\s+)?([A-Z][A-Za-z0-9/&' -]{2,80}?(?:Project|Platform|Website|Site|Portfolio|Resume|CV))\b/,
  );
  if (namedProjectFromSentence?.[1]) {
    return namedProjectFromSentence[1].trim();
  }

  const headingBase =
    normalizedLine.match(
      /^(.*?)(?:\s+[—-]\s+(?:V1 PRD Draft|PRP Planning Draft|Conversational Discovery Brief|Tech Stack|Planning PRP|Base PRP|Initial Task Breakdown|Revision Packet.*|Build-Ready Source Matrix.*))$/i,
    )?.[1] ?? normalizedLine;
  const title = headingBase.trim();
  if (!title) return null;
  if (
    /^(?:built|building|defined|defining|granted|granting|locked|locking|shaped|shaping|created|creating|deployed|deploying|fixed|fixing|implemented|implementing|separated|separating|scheduled|scheduling|designed|designing|wired|wiring)\b/i.test(
      title,
    )
  ) {
    return null;
  }
  if (
    !/\b(?:project|platform|observer|intelligence|study map|website|site|portfolio|resume|cv|landing page)\b/i.test(
      title,
    )
  ) {
    return null;
  }
  if (title.length > 120) return null;
  return title;
}

function scoreManualProjectCandidate(params: {
  item: RecallResultRow["item"];
  intent: RecallIntentSignal;
  timelineWindow?: TimelineWindow | null;
}): number {
  const summary = String(params.item.summary ?? "");
  const lowered = summary.toLowerCase();
  const summaryTerms = new Set(tokenizeIntentTerms(summary));
  const createdAt = parseCreatedAtEpoch(params.item.createdAt);
  const itemAt = parseItemTimelineEpoch(params.item);
  const ageDays = createdAt > 0 ? Math.max(0, (Date.now() - createdAt) / 86400000) : 365;
  let score = 0;
  const websiteProjectArtifact = isWebsiteProjectSupport(summary);
  const strongProjectArtifact =
    websiteProjectArtifact ||
    /\b(?:forward observer|area intelligence|prp|prd|tech stack|task breakdown|planning draft|conversational discovery brief|base prp|source matrix|foundation|brief flow)\b/i.test(
      summary,
    );

  if (params.item.memoryType === "knowledge") score += 3.8;
  if (params.item.memoryType === "event" || params.item.memoryType === "episode") score += 1.8;
  if (params.item.memoryType === "profile") score += 0.4;

  const extra =
    params.item.extra && typeof params.item.extra === "object"
      ? (params.item.extra as Record<string, unknown>)
      : {};
  if (params.intent.docBias && extra.source === "knowledge_ingest") score += 2.8;
  if (params.intent.docBias && extra.collection === "docpane") score += 3.4;

  const slotMatches = params.intent.slotTerms.filter((term) => summaryTerms.has(term)).length;
  const specificProjectTerms = extractSpecificDecisionProjectTerms(params.intent);
  const specificMatches = specificProjectTerms.filter((term) =>
    containsAliasTerm(lowered, term),
  ).length;
  score += slotMatches * 1.2;
  if (params.intent.reason === "latent-project-match" && specificMatches > 0) {
    score += specificMatches * 3.8;
    if (specificProjectTerms.length > 1 && specificMatches === specificProjectTerms.length) {
      score += 2.4;
    }
  }

  if (strongProjectArtifact || /\bgreenfield\b/i.test(summary)) {
    score += 6.5;
  }

  if (websiteProjectArtifact) {
    score += isWebsiteProjectIntent(params.intent) ? 5.2 : 1.4;
  }

  if (
    /\b(?:current projects include|currently working on several projects|works on a range of projects)\b/i.test(
      lowered,
    )
  ) {
    score -= 3.5;
  }

  if (
    /\b(?:memory recall|audit|checkpoint|morning brief|spec tool|onboarding tool|session checkpoint|test results)\b/i.test(
      lowered,
    )
  ) {
    score -= 4.5;
  }

  if (
    !strongProjectArtifact &&
    /\b(?:is currently working on|has been working on|active in 2026|since 2026|currently working with)\b/i.test(
      lowered,
    )
  ) {
    score -= 4.5;
  }

  if (
    !strongProjectArtifact &&
    /\b(?:atera|rmm\/psa|cron job|vip email|next run scheduled|integration is active)\b/i.test(
      summary,
    )
  ) {
    score -= 7;
  }

  if (
    isWebsiteProjectIntent(params.intent) &&
    !websiteProjectArtifact &&
    !/\b(?:website|site|portfolio|resume|cv|domain|cloudflare|coolify|namecheap)\b/i.test(summary)
  ) {
    score -= 4.8;
  }

  if (/\b(?:project|development|planning|build|brief|task)\b/i.test(summary)) {
    score += 1.6;
  }

  if (
    params.intent.reason === "latent-project-match" &&
    specificProjectTerms.length > 0 &&
    specificMatches === 0
  ) {
    score -= 5.5;
  }

  if (params.intent.recencyBias) {
    if (ageDays <= 2) score += 5;
    else if (ageDays <= 5) score += 3.5;
    else if (ageDays <= 10) score += 2;
    else if (ageDays <= 21) score += 0.6;
    else score -= 1.2;
  }

  if (params.timelineWindow && itemAt > 0) {
    if (itemFallsWithinTimelineWindow(params.item, params.timelineWindow)) {
      score += 4.5;
    } else if (
      params.intent.recencyBias &&
      itemAt >= params.timelineWindow.endMs &&
      itemAt < params.timelineWindow.endMs + 7 * 86400000
    ) {
      score += 1.4;
    } else if (params.intent.recencyBias) {
      score -= 1.8;
    }
  }

  return score;
}

async function collectManualProjectCandidates(params: {
  memory: MemoryAdapter;
  intent: RecallIntentSignal | null;
  timelineWindow?: TimelineWindow | null;
  limit: number;
}): Promise<RecallResultRow[]> {
  if (!params.intent || params.intent.queryClass !== "decision_project") return [];

  const candidateTypes: Array<MemoryType> = ["knowledge", "event", "episode", "profile"];
  const pageConfig: Record<MemoryType, { pageSize: number; maxPages: number }> = {
    knowledge: { pageSize: 500, maxPages: 4 },
    event: { pageSize: 250, maxPages: 2 },
    episode: { pageSize: 200, maxPages: 2 },
    profile: { pageSize: 250, maxPages: 2 },
    behavior: { pageSize: 0, maxPages: 0 },
    self: { pageSize: 0, maxPages: 0 },
    skill: { pageSize: 0, maxPages: 0 },
    tool: { pageSize: 0, maxPages: 0 },
  };

  const merged = new Map<string, RecallResultRow>();
  for (const memoryType of candidateTypes) {
    const config = pageConfig[memoryType];
    for (let page = 0; page < config.maxPages; page += 1) {
      const items = await params.memory.listItems({
        memoryType,
        limit: config.pageSize,
        offset: page * config.pageSize,
      });
      if (items.length === 0) break;

      for (const item of items) {
        const score = scoreManualProjectCandidate({
          item,
          intent: params.intent,
          timelineWindow: params.timelineWindow,
        });
        if (score < 5) continue;
        const existing = merged.get(item.id);
        const candidate: RecallResultRow = {
          item,
          score: 0.3 + score * 0.25,
          categories: [],
        };
        if (!existing || candidate.score > existing.score) {
          merged.set(item.id, candidate);
        }
      }
    }
  }

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, params.limit);
}

function normalizeRecallResultSignature(summary: string): string {
  return stripCitation(summary)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summaryMentionsIntentSlot(summary: string, intent: RecallIntentSignal): boolean {
  const lowered = summary.toLowerCase();
  if (intent.slotKey) {
    if (new RegExp(`\\b${escapeRegExp(intent.slotKey)}\\b`, "i").test(summary)) return true;
    if ((intent.preferenceCueTerms ?? []).includes("favorite")) {
      if (new RegExp(`\\bfavorite\\s+${escapeRegExp(intent.slotKey)}\\b`, "i").test(summary)) {
        return true;
      }
    }
  }
  return intent.slotTerms.some((term) => containsAliasTerm(lowered, term));
}

function isDirectPropertySupport(summary: string, intent: RecallIntentSignal): boolean {
  if (intent.slotKey) {
    const slot = escapeRegExp(intent.slotKey);
    if (new RegExp(`\\bfavorite\\s+${slot}\\s+(?:is|was)\\b`, "i").test(summary)) return true;
    if (new RegExp(`\\b${slot}\\s+(?:is|was)\\b`, "i").test(summary)) return true;
  }

  if (intent.slotKey === "dog name") {
    return (
      /\b(?:dog'?s name is|pet name is)\s+[A-Z][a-z]+/i.test(summary) ||
      /^.+?\s+is\s+(?:Jason'?s|my)\s+dog\b/i.test(summary) ||
      /\bhas a dog named\b/i.test(summary)
    );
  }

  if (intent.slotKey === "pizza toppings") {
    return (
      /\bpizza order\b/i.test(summary) ||
      /\bfavorite pizza topping\b/i.test(summary) ||
      (/\bpizza\b/i.test(summary) &&
        /\b(?:like|likes|love|loves|prefer|prefers|order|orders)\b/i.test(summary))
    );
  }

  if (intent.slotKey === "live") {
    return /\b(?:lives in|live in|located in)\b/i.test(summary);
  }

  return false;
}

function isNegativePropertyResult(summary: string): boolean {
  return /\b(?:no personal information|not found|don'?t have|do not have|don'?t know|isn'?t stored|was not found)\b/i.test(
    summary,
  );
}

function isMetaMemoryPropertyResult(summary: string): boolean {
  return /\b(?:memo earning his keep|persistent memory system|remembering the stuff that matters|memory failed me|recall tool|retrieval that came back|from what we already validated together)\b/i.test(
    summary,
  );
}

function isConversationalPropertyEcho(summary: string): boolean {
  return (
    /\b(?:want me to|just confirming i remember|right\?|honestly\?|if i answered|i still don'?t have)\b/i.test(
      summary,
    ) || /\?/.test(summary)
  );
}

function isGenericPropertyNoise(summary: string, intent: RecallIntentSignal): boolean {
  if (!intent.slotKey) return false;
  if (summaryMentionsIntentSlot(summary, intent)) return false;
  return /\b(?:preference|prefers|communication|warmth|voice|style|automation|integration|collaboration|teamwork|expressive|expressiveness)\b/i.test(
    summary,
  );
}

function isRecentProjectSupport(summary: string): boolean {
  return (
    isWebsiteProjectSupport(summary) ||
    /\b(?:forward observer|area intelligence|prp|prd|tech stack|task breakdown|planning draft|conversational discovery brief)\b/i.test(
      summary,
    )
  );
}

function hasWebsiteProjectSurface(summary: string): boolean {
  return /\b(?:website|site|portfolio|resume|cv|landing page|landing)\b/i.test(summary);
}

function hasWebsiteProjectDeliverySurface(summary: string): boolean {
  return /\b(?:domain|dns|host(?:ing|ed)?|deploy(?:ment)?|cloudflare|coolify|namecheap|lead|leads|form|intake|collect(?:ing)? data)\b/i.test(
    summary,
  );
}

function isWebsiteProjectSupport(summary: string): boolean {
  const websiteSurface = hasWebsiteProjectSurface(summary);
  const deliverySurface = hasWebsiteProjectDeliverySurface(summary);
  return /\b(?:forward observer|area intelligence|prp|prd|tech stack|task breakdown|planning draft|conversational discovery brief)\b/i.test(
    summary,
  )
    ? true
    : (websiteSurface && deliverySurface) ||
        (/\b(?:namecheap|cloudflare|coolify)\b/i.test(summary) &&
          /\b(?:woman|client|website|site|portfolio|resume|cv)\b/i.test(summary));
}

function isGenericRecentProjectNoise(summary: string): boolean {
  return /\b(?:current projects include|currently working on several projects|works on a range of projects|is currently working on|has been working on|active in 2026|since 2026|atera integration|rmm\/psa|cron job|vip email|next run scheduled)\b/i.test(
    summary,
  );
}

function isWebsiteProjectNoise(summary: string): boolean {
  return /\b(?:atera|rmm\/psa|cron job|vip email|mao|multi-agent orchestrator|titan agent|trading ai|trading agent|ai architecture)\b/i.test(
    summary,
  );
}

function pruneDecisionProjectNoiseResults(
  results: RecallResultRow[],
  intent: RecallIntentSignal | null,
): RecallResultRow[] {
  if (!intent || intent.queryClass !== "decision_project") return results;
  const strongProjectExists = results.some((result) =>
    isRecentProjectSupport(String(result.item.summary ?? "")),
  );
  if (!strongProjectExists) return results;

  const filtered = results.filter((result) => {
    const summary = String(result.item.summary ?? "");
    if (
      /\b(?:memory recall|audit|checkpoint|morning brief|spec tool|session checkpoint|test results)\b/i.test(
        summary,
      )
    ) {
      return false;
    }
    if (isGenericRecentProjectNoise(summary) && !isRecentProjectSupport(summary)) {
      return false;
    }
    if (
      isWebsiteProjectIntent(intent) &&
      !isWebsiteProjectSupport(summary) &&
      !hasWebsiteProjectSurface(summary)
    ) {
      return false;
    }
    if (
      isWebsiteProjectIntent(intent) &&
      isWebsiteProjectNoise(summary) &&
      !isWebsiteProjectSupport(summary)
    ) {
      return false;
    }
    return true;
  });

  return filtered.length > 0 ? filtered : results;
}

function pruneTimelineNoiseResults(
  results: RecallResultRow[],
  intent: RecallIntentSignal | null,
): RecallResultRow[] {
  if (!intent || intent.queryClass !== "timeline_episodic") return results;
  const strongTimelineExists = results.some((result) =>
    isAccomplishmentTimelineSupport(String(result.item.summary ?? "")),
  );
  if (!strongTimelineExists) return results;

  const filtered = results.filter((result) => {
    const summary = String(result.item.summary ?? "");
    if (isTimelineOperationalNoise(summary) && !isAccomplishmentTimelineSupport(summary)) {
      return false;
    }
    return true;
  });

  return filtered.length > 0 ? filtered : results;
}

function applyTimelineEntityFocus(
  results: RecallResultRow[],
  intent: RecallIntentSignal | null,
  entityFilterContext: EntityFilterContext | null,
): RecallResultRow[] {
  if (!intent || intent.queryClass !== "timeline_episodic" || !entityFilterContext) {
    return results;
  }
  if (entityFilterContext.matchTerms.length === 0 || entityFilterContext.entityItemIds === null) {
    return results;
  }

  const annotated = results.map((result) => {
    const summary = String(result.item.summary ?? "");
    const directMention = itemMatchesEntityTerms(result.item, entityFilterContext.matchTerms);
    const linkedEntity = entityFilterContext.entityItemIds?.has(result.item.id) ?? false;
    let score = result.score;

    if (directMention) {
      score *= 1.22;
    } else if (linkedEntity) {
      score *= 0.7;
      if (
        /\b(?:jason|owner|operator|favorite|prefers|likes|uses|has)\b/i.test(summary) &&
        !/\b(?:he|him|his)\b/i.test(summary)
      ) {
        score *= 0.7;
      }
    }

    return { ...result, score, directMention, linkedEntity };
  });

  const directMentionCount = annotated.filter((result) => result.directMention).length;
  const focused =
    directMentionCount >= 2
      ? annotated.filter((result) => result.directMention || !result.linkedEntity)
      : annotated;

  return focused
    .map(({ directMention: _directMention, linkedEntity: _linkedEntity, ...result }) => result)
    .sort((a, b) => b.score - a.score);
}

function prunePropertyNoiseResults(
  results: RecallResultRow[],
  intent: RecallIntentSignal | null,
): RecallResultRow[] {
  if (!intent || intent.queryClass !== "identity_property" || !intent.slotKey) return results;
  const directSupportExists = results.some((result) =>
    isDirectPropertySupport(String(result.item.summary ?? ""), intent),
  );
  if (!directSupportExists) return results;

  const filtered = results.filter((result) => {
    const summary = String(result.item.summary ?? "");
    if (isNegativePropertyResult(summary)) return false;
    if (isMetaMemoryPropertyResult(summary)) return false;
    if (isConversationalPropertyEcho(summary)) return false;
    if (isGenericPropertyNoise(summary, intent)) return false;
    return true;
  });

  return filtered.length > 0 ? filtered : results;
}

function applyDuplicateRecallPressure(results: RecallResultRow[]): RecallResultRow[] {
  const seen = new Set<string>();
  const deduped: RecallResultRow[] = [];
  for (const result of results) {
    const signature = normalizeRecallResultSignature(String(result.item.summary ?? ""));
    if (!signature) {
      deduped.push(result);
      continue;
    }
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(result);
  }
  return deduped;
}

function extractRecallAnswerCandidate(params: {
  query: string;
  intent: RecallIntentSignal | null;
  timelineWindow?: TimelineWindow | null;
  finalResults: Array<{
    item: {
      id: string;
      memoryType?: string;
      summary?: string;
      createdAt?: string;
      happenedAt?: string | null;
    };
    score: number;
  }>;
}): RecallAnswerCandidate | null {
  const top = params.finalResults[0];
  if (!top) return null;
  const queryTerms = tokenizeIntentTerms(params.query).filter((term) => term.length >= 3);
  const specificProjectTerms =
    params.intent?.queryClass === "decision_project"
      ? extractSpecificDecisionProjectTerms(params.intent)
      : [];

  const summaries = params.finalResults.map((result) => ({
    id: result.item.id,
    type: String(result.item.memoryType ?? ""),
    summary: String(result.item.summary ?? ""),
    score: result.score,
    eventAt: parseItemTimelineEpoch(result.item),
    createdAt: result.item.createdAt,
    happenedAt: result.item.happenedAt,
  }));

  const makeCandidate = (
    source: (typeof summaries)[number],
    value: string,
    strategy: RecallAnswerCandidate["strategy"],
    confidence: number,
  ): RecallAnswerCandidate => {
    const normalizedValue = String(value ?? source.summary ?? "").trim();
    const fallbackValue = String(source.summary ?? "").trim();
    return {
      value: normalizedValue || fallbackValue,
      strategy,
      confidence,
      sourceId: source.id,
      sourceType: source.type,
      sourceSummary: source.summary,
    };
  };

  if (params.intent?.slotKey) {
    const favoriteRegex = new RegExp(
      `\\bfavorite\\s+${escapeRegExp(params.intent.slotKey)}\\s+(?:is|was)\\s+(.+?)(?:[.?!]|$)`,
      "i",
    );
    for (const source of summaries) {
      const match = favoriteRegex.exec(source.summary);
      if (match?.[1]) {
        return makeCandidate(source, match[1], "favorite-slot", 0.98);
      }
    }
  }

  if (params.intent?.slotKey === "dog name") {
    for (const source of summaries) {
      const a = /^(.+?)\s+is\s+(?:Jason'?s|my)\s+dog\b/i.exec(source.summary);
      if (a?.[1]) return makeCandidate(source, a[1], "dog-name", 0.97);
      const b = /\b(?:dog'?s name is|pet name is)\s+(.+?)(?:[.?!]|$)/i.exec(source.summary);
      if (b?.[1]) return makeCandidate(source, b[1], "dog-name", 0.95);
    }
  }

  if (params.intent?.slotKey === "pizza toppings") {
    for (const source of summaries) {
      const match =
        /\b(?:likes?|loves?|prefers?|orders?)\s+(.+?pizza.+?)(?:[.?!]|$)/i.exec(source.summary) ??
        /\b(.+pizza.+?)(?:[.?!]|$)/i.exec(source.summary);
      if (match?.[1]) {
        return makeCandidate(source, match[1], "pizza-preference", 0.92);
      }
    }
  }

  if (params.intent?.slotKey === "live") {
    for (const source of summaries) {
      const match = /\b(?:lives in|live in|located in)\s+(.+?)(?:[.?!]|$)/i.exec(source.summary);
      if (match?.[1]) {
        return makeCandidate(source, match[1], "where-live", 0.9);
      }
    }
  }

  if (params.intent?.queryClass === "timeline_episodic" && params.timelineWindow) {
    const windowSummaries = summaries
      .filter((source) => itemFallsWithinTimelineWindow(source, params.timelineWindow!))
      .sort((a, b) => a.eventAt - b.eventAt);
    if (windowSummaries.length > 0) {
      const uniqueSummaries = [...new Set(windowSummaries.map((source) => source.summary.trim()))]
        .filter(Boolean)
        .slice(0, params.timelineWindow.granularity === "day" ? 3 : 4);
      const timelineValue =
        params.timelineWindow.granularity === "day"
          ? uniqueSummaries.join("; ")
          : windowSummaries
              .map((source) => ({
                date: source.eventAt > 0 ? new Date(source.eventAt) : null,
                summary: source.summary.trim(),
              }))
              .filter(
                (entry, index, entries) =>
                  entry.summary &&
                  entries.findIndex((candidate) => candidate.summary === entry.summary) === index,
              )
              .slice(0, 4)
              .map((entry) =>
                entry.date ? `${formatLocalIsoDate(entry.date)}: ${entry.summary}` : entry.summary,
              )
              .join("; ");
      return makeCandidate(
        windowSummaries[0],
        timelineValue,
        params.timelineWindow.granularity === "day" ? "timeline-window" : "timeline-range",
        0.9,
      );
    }
  }

  if (params.intent?.queryClass === "decision_project") {
    const prioritizedProjectSources = isWebsiteProjectIntent(params.intent)
      ? [
          ...summaries.filter(
            (source) =>
              isWebsiteProjectSupport(source.summary) || hasWebsiteProjectSurface(source.summary),
          ),
          ...summaries.filter(
            (source) =>
              !isWebsiteProjectSupport(source.summary) && !hasWebsiteProjectSurface(source.summary),
          ),
        ]
      : summaries;
    const projectSources = prioritizedProjectSources.slice(0, Math.min(12, summaries.length));
    const projectNames = new Map<
      string,
      { count: number; source: (typeof summaries)[number]; overlap: number; latestAt: number }
    >();
    for (const source of projectSources) {
      const projectName = extractRecentProjectTitle(source.summary);
      if (!projectName) continue;
      const overlapTerms = specificProjectTerms.length > 0 ? specificProjectTerms : queryTerms;
      const overlap = overlapTerms.filter((term) =>
        containsAliasTerm(`${projectName} ${source.summary}`.toLowerCase(), term),
      ).length;
      const sourceAt = source.eventAt;
      const existing = projectNames.get(projectName);
      if (existing) {
        existing.count += 1;
        existing.overlap = Math.max(existing.overlap, overlap);
        if (
          sourceAt > existing.latestAt ||
          (sourceAt === existing.latestAt && source.score > existing.source.score)
        ) {
          existing.latestAt = sourceAt;
          existing.source = source;
        }
      } else {
        projectNames.set(projectName, { count: 1, source, overlap, latestAt: sourceAt });
      }
    }
    const rankedProjects = [...projectNames.entries()];
    const preferOverlap = rankedProjects.some((entry) => entry[1].overlap > 0);
    const rankedProject = rankedProjects.sort((a, b) => {
      if (params.intent?.recencyBias && b[1].latestAt !== a[1].latestAt) {
        return b[1].latestAt - a[1].latestAt;
      }
      if (preferOverlap && b[1].overlap !== a[1].overlap) return b[1].overlap - a[1].overlap;
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      if (!preferOverlap && b[1].overlap !== a[1].overlap) return b[1].overlap - a[1].overlap;
      return b[1].source.score - a[1].source.score;
    })[0];
    if (rankedProject) {
      return makeCandidate(rankedProject[1].source, rankedProject[0], "recent-project", 0.9);
    }
  }

  if (params.intent?.preferredMode === "identity" && params.intent?.slotKey) {
    const whoSource = summaries.find((source) =>
      containsAliasTerm(source.summary.toLowerCase(), params.intent!.slotKey!.toLowerCase()),
    );
    if (whoSource) {
      return makeCandidate(whoSource, whoSource.summary, "who-is", 0.8);
    }
  }

  return makeCandidate(top, top.summary, "summary-best-hit", 0.62);
}

function applyIntentAwareRecallRerank(
  results: Array<{
    item: {
      memoryType?: string;
      summary?: string;
      significance?: string;
    };
    score: number;
  }>,
  intent: RecallIntentSignal | null,
): void {
  if (!intent || results.length <= 1) return;
  const slotTerms = new Set(intent.slotTerms);

  for (const result of results) {
    const summary = String(result.item.summary ?? "");
    const lowered = summary.toLowerCase();
    const summaryTerms = new Set(tokenizeIntentTerms(summary));
    let boost = 1;

    const slotMatches = [...slotTerms].filter((term) => summaryTerms.has(term)).length;
    if (slotMatches > 0) {
      boost *= 1 + slotMatches * 0.55;
    }

    if (intent.profileBias && result.item.memoryType === "profile") {
      boost *= 1.45;
    }

    if (
      intent.preferenceCueTerms?.length &&
      containsAnyIntentCue(lowered, intent.preferenceCueTerms) &&
      slotMatches > 0
    ) {
      boost *= 1.55;
    }

    if (
      intent.operatorBias &&
      (containsAliasTerm(lowered, "jason") ||
        containsAliasTerm(lowered, "my ") ||
        containsAliasTerm(lowered, "jason's"))
    ) {
      boost *= 1.15;
    }

    if (intent.slotKey) {
      const escapedSlot = escapeRegExp(intent.slotKey);
      if (
        new RegExp(`\\bfavorite\\s+${escapedSlot}\\b`, "i").test(summary) ||
        new RegExp(`\\b${escapedSlot}\\b`, "i").test(summary)
      ) {
        boost *= 1.8;
      }
      if (
        new RegExp(
          `\\b(?:favorite\\s+${escapedSlot}|${escapedSlot}\\s+(?:is|was)|(?:is|was)\\s+${escapedSlot})\\b`,
          "i",
        ).test(summary)
      ) {
        boost *= 1.35;
      }
    }

    if (intent.siblingPenaltyTerms.length > 0 && lowered.includes("favorite")) {
      const favoritePhrase = lowered.match(/\bfavorite\s+([a-z][a-z0-9 -]{1,40})\b/i)?.[1]?.trim();
      if (favoritePhrase && intent.slotKey) {
        const normalizedFavorite = favoritePhrase.replace(/\?+$/, "");
        if (normalizedFavorite !== intent.slotKey.toLowerCase()) {
          boost *= 0.08;
        }
      }
    }

    if (slotMatches === 0 && intent.slotKey && lowered.includes("favorite")) {
      boost *= 0.2;
    }

    result.score *= boost;
  }
}

function reorderPropertySlotResults(
  results: Array<{
    item: {
      memoryType?: string;
      summary?: string;
    };
    score: number;
  }>,
  intent: RecallIntentSignal | null,
): Array<{
  item: {
    memoryType?: string;
    summary?: string;
  };
  score: number;
}> {
  if (!intent?.slotKey) return results;

  const direct: typeof results = [];
  const contextual: typeof results = [];
  const sibling: typeof results = [];

  for (const result of results) {
    const summary = String(result.item.summary ?? "");
    const lowered = summary.toLowerCase();
    const exactFavoriteMatch = new RegExp(
      `\\bfavorite\\s+${escapeRegExp(intent.slotKey)}\\b`,
      "i",
    ).test(summary);
    const slotMention = new RegExp(`\\b${escapeRegExp(intent.slotKey)}\\b`, "i").test(summary);
    const otherFavorite = /\bfavorite\s+[a-z]/i.test(summary) && !exactFavoriteMatch;
    const isPreferenceStatement =
      containsAnyIntentCue(lowered, intent.preferenceCueTerms ?? []) &&
      (result.item.memoryType === "profile" || result.item.memoryType === "behavior");

    if (
      exactFavoriteMatch ||
      (slotMention &&
        (result.item.memoryType === "profile" ||
          result.item.memoryType === "behavior" ||
          isPreferenceStatement))
    ) {
      direct.push(result);
    } else if (otherFavorite) {
      sibling.push(result);
    } else {
      contextual.push(result);
    }
  }

  direct.sort((a, b) => b.score - a.score);
  contextual.sort((a, b) => b.score - a.score);
  sibling.sort((a, b) => b.score - a.score);

  if (direct.length > 0 && intent.siblingPenaltyTerms.length > 0) {
    return [...direct, ...contextual];
  }

  return [...direct, ...contextual, ...sibling];
}

function expandQueryWithEntityAlias(query: string, alias: string, entityName: string): string {
  const aliasRe = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "ig");
  const replaced = query.replace(aliasRe, entityName);
  if (replaced === query) {
    return `${query} ${entityName}`;
  }
  return replaced;
}

function scoreEntityAliasMatch(params: {
  entity: Entity;
  canonical: string;
  alias: string;
  query: string;
}): number {
  const relationship = String(params.entity.relationship ?? "").toLowerCase();
  const profile = String(params.entity.profileSummary ?? "").toLowerCase();
  const name = String(params.entity.name ?? "").toLowerCase();
  const query = params.query.toLowerCase();

  let score = 0;
  if (containsAliasTerm(relationship, params.canonical)) score += 6;
  if (containsAliasTerm(relationship, params.alias)) score += 4;
  if (containsAliasTerm(profile, params.canonical)) score += 2;
  if (containsAliasTerm(profile, params.alias)) score += 2;
  if (containsAliasTerm(query, name)) score += 2;
  if (params.entity.bondStrength >= 0.8) score += 2;
  if (params.entity.bondStrength >= 0.6) score += 1;
  if (params.entity.memoryCount >= 10) score += 1;
  return score;
}

async function resolveAliasExpansionContext(params: {
  memory: MemoryAdapter;
  query: string;
  mode: RecallMode;
  entityFilter?: string;
}): Promise<{
  expandedQueries: string[];
  matchedAliases: string[];
  resolvedEntities: Entity[];
  escalatedMode?: RecallMode;
  familyCareSignal: boolean;
}> {
  const query = params.query.trim();
  const lowered = query.toLowerCase();
  const familyCareSignal = FAMILY_CARE_SIGNAL_RE.test(lowered);
  if (!query) {
    return {
      expandedQueries: [],
      matchedAliases: [],
      resolvedEntities: [],
      familyCareSignal,
    };
  }
  if (params.entityFilter) {
    return {
      expandedQueries: [query],
      matchedAliases: [],
      resolvedEntities: [],
      familyCareSignal,
    };
  }

  const aliasHits: Array<{ canonical: string; alias: string }> = [];
  for (const group of RELATIONSHIP_ALIAS_GROUPS) {
    for (const alias of group.aliases) {
      if (containsAliasTerm(lowered, alias)) {
        aliasHits.push({ canonical: group.canonical, alias });
      }
    }
  }
  if (aliasHits.length === 0) {
    const escalatedMode = familyCareSignal && params.mode === "general" ? "identity" : undefined;
    return {
      expandedQueries: [query],
      matchedAliases: [],
      resolvedEntities: [],
      escalatedMode,
      familyCareSignal,
    };
  }

  const entities = await params.memory.listEntities({ limit: 120 });
  const candidateScores = new Map<string, number>();
  const entityById = new Map<string, Entity>();
  for (const aliasHit of aliasHits) {
    for (const entity of entities) {
      const score = scoreEntityAliasMatch({
        entity,
        canonical: aliasHit.canonical,
        alias: aliasHit.alias,
        query,
      });
      if (score <= 0) continue;
      const prev = candidateScores.get(entity.id) ?? 0;
      candidateScores.set(entity.id, Math.max(prev, score));
      entityById.set(entity.id, entity);
    }
  }

  const resolvedEntities = [...candidateScores.entries()]
    .map(([id, score]) => ({ entity: entityById.get(id)!, score }))
    .filter((entry) => Boolean(entry.entity))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.entity.bondStrength !== a.entity.bondStrength) {
        return b.entity.bondStrength - a.entity.bondStrength;
      }
      return b.entity.memoryCount - a.entity.memoryCount;
    })
    .slice(0, 3)
    .map((entry) => entry.entity);

  const expandedQueries = new Set<string>([query]);
  for (const entity of resolvedEntities) {
    expandedQueries.add(`${query} ${entity.name}`);
    for (const aliasHit of aliasHits) {
      expandedQueries.add(expandQueryWithEntityAlias(query, aliasHit.alias, entity.name));
    }
    if (
      familyCareSignal ||
      containsAliasTerm(lowered, "mom") ||
      containsAliasTerm(lowered, "dad")
    ) {
      expandedQueries.add(
        `${entity.name} caregiver safety context dementia hospice wandering confusion`,
      );
    }
  }

  const escalatedMode =
    params.mode === "general" && (familyCareSignal || resolvedEntities.length > 0)
      ? "identity"
      : undefined;
  return {
    expandedQueries: [...expandedQueries].filter((entry) => entry.trim().length > 0).slice(0, 6),
    matchedAliases: aliasHits.map((hit) => hit.alias),
    resolvedEntities,
    escalatedMode,
    familyCareSignal,
  };
}

function applyFamilyCareRankingBoost(
  results: Array<{
    item: {
      memoryType?: string;
      summary?: string;
      reflection?: string | null;
      lesson?: string | null;
      significance?: string;
    };
    score: number;
  }>,
  resolvedEntities: Entity[],
  familyCareSignal: boolean,
): void {
  if (!familyCareSignal && resolvedEntities.length === 0) {
    return;
  }
  const entityNames = resolvedEntities.map((entity) => entity.name.toLowerCase());
  for (const result of results) {
    let boost = 1;
    const summary = String(result.item.summary ?? "");
    const reflection = String(result.item.reflection ?? "");
    const lesson = String(result.item.lesson ?? "");
    const text = `${summary} ${reflection} ${lesson}`.toLowerCase();
    const hasCareCue = FAMILY_CARE_CONTEXT_RE.test(text);
    const hasEntity = entityNames.some((name) => containsAliasTerm(text, name));

    if (hasEntity) boost *= 1.7;
    if (hasCareCue) boost *= 1.35;
    if (result.item.memoryType === "profile" || result.item.memoryType === "event") {
      boost *= 1.1;
    }
    if (result.item.significance === "important" || result.item.significance === "core") {
      boost *= 1.05;
    }
    result.score *= boost;
  }
}

function isOperationalProfileSnapshot(summary: string): boolean {
  if (!OPERATIONAL_PROFILE_HINT_RE.test(summary)) {
    return false;
  }
  return OP_PROFILE_NUMERIC_TEST_RE.test(summary) || OP_PROFILE_DATETIME_TEST_RE.test(summary);
}

function operationalProfileSignature(summary: string): string {
  return summary
    .toLowerCase()
    .replace(OP_PROFILE_DATETIME_RE, " <datetime> ")
    .replace(OP_PROFILE_ID_RE, " <id> ")
    .replace(OP_PROFILE_NUMERIC_RE, " <num> ")
    .replace(/[^\p{L}\p{N}<>\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCollectionValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function toCollectionTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isKnowledgeCollectionScopedSource(source: unknown): boolean {
  return source === "knowledge_ingest" || source === "vault";
}

async function findOperationalProfileDuplicate(memory: MemoryAdapter, fact: string) {
  if (!isOperationalProfileSnapshot(fact)) {
    return null;
  }
  const signature = operationalProfileSignature(fact);
  if (!signature) {
    return null;
  }
  const recentProfiles = await memory.listItems({ memoryType: "profile", limit: 250 });
  return (
    recentProfiles.find((item) => operationalProfileSignature(item.summary) === signature) ?? null
  );
}

function detectMemoryInjectionReasons(text: string): MemorySanitizerReasonCode[] {
  const reasons = new Set<MemorySanitizerReasonCode>();
  for (const pattern of MEMORY_WRITE_SANITIZER_PATTERNS) {
    if (pattern.regex.test(text)) reasons.add(pattern.code);
  }
  return [...reasons];
}

function normalizeSanitizerPolicy(raw: unknown): MemoryWriteSanitizerPolicy {
  if (raw === "log_only" || raw === "drop" || raw === "drop_and_alert") return raw;
  return "drop";
}

function resolveMemoryWriteSanitizerPolicy(cfg: ArgentConfig): MemoryWriteSanitizerPolicy {
  const envPolicy = process.env.ARGENT_MEMU_SANITIZER_POLICY;
  if (envPolicy) return normalizeSanitizerPolicy(envPolicy);
  return normalizeSanitizerPolicy(cfg.memory?.memu?.sanitizer?.policy);
}

function incrementSanitizerCounters(params: {
  reasons: MemorySanitizerReasonCode[];
  action: "allow" | "drop" | "alert";
}): void {
  memoryWriteSanitizerCounters.seen += 1;
  if (params.reasons.length > 0) {
    memoryWriteSanitizerCounters.flagged += 1;
    for (const reason of params.reasons) {
      memoryWriteSanitizerCounters.reasonCodes[reason] =
        (memoryWriteSanitizerCounters.reasonCodes[reason] ?? 0) + 1;
    }
  }
  if (params.action === "drop") memoryWriteSanitizerCounters.dropped += 1;
  if (params.action === "alert") memoryWriteSanitizerCounters.alerts += 1;
}

function logMemoryWriteSanitizerAudit(params: {
  tool: "memory_store" | "memory_reflect";
  policy: MemoryWriteSanitizerPolicy;
  action: "allow" | "drop" | "alert";
  reasonCodes: MemorySanitizerReasonCode[];
  agentId?: string;
}): void {
  const event = {
    event: "memory_write_sanitizer",
    tool: params.tool,
    policy: params.policy,
    action: params.action,
    reasonCodes: params.reasonCodes,
    agentId: params.agentId ?? "main",
    counters: memoryWriteSanitizerCounters,
  };
  if (params.action === "drop" || params.action === "alert") {
    console.warn("[memu-sanitizer]", JSON.stringify(event));
  } else if (params.reasonCodes.length > 0) {
    console.info("[memu-sanitizer]", JSON.stringify(event));
  }
}

async function runRecallVectorFallback(params: {
  memory: MemoryAdapter;
  cfg: ArgentConfig;
  queryVariants: string[];
  fetchLimit: number;
  agentId?: string;
}): Promise<Array<{ item: any; score: number; categories: string[] }>> {
  const embedder = await getMemuEmbedder(params.cfg);
  const merged = new Map<string, { item: any; score: number; categories: string[] }>();
  for (const queryVariant of params.queryVariants.slice(0, 4)) {
    const embedding = await embedder.embed(queryVariant);
    if (!embedding || embedding.length === 0) continue;
    const hits = await params.memory.searchByVector(
      Float32Array.from(embedding),
      params.fetchLimit,
      params.agentId,
    );
    for (const hit of hits) {
      const existing = merged.get(hit.item.id);
      const scoredHit = { ...hit, score: hit.score * 0.97, categories: [] as string[] };
      if (!existing || scoredHit.score > existing.score) {
        merged.set(hit.item.id, scoredHit);
      }
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

function hasKnowledgeBackedProjectSupport(
  result: RecallResultRow,
  intent: RecallIntentSignal | null,
): boolean {
  const summary = String(result.item.summary ?? "");
  const extra =
    result.item.extra && typeof result.item.extra === "object"
      ? (result.item.extra as Record<string, unknown>)
      : {};
  const source = typeof extra.source === "string" ? extra.source : undefined;
  const docBacked =
    isKnowledgeCollectionScopedSource(source) ||
    typeof extra.collection === "string" ||
    typeof extra.citation === "string";
  if (!docBacked) return false;
  if (isWebsiteProjectIntent(intent)) {
    return isWebsiteProjectSupport(summary) || hasWebsiteProjectSurface(summary);
  }
  return isRecentProjectSupport(summary) || extractRecentProjectTitle(summary) !== null;
}

function shouldTriggerKnowledgeProjectFallback(params: {
  intent: RecallIntentSignal | null;
  answerCandidate: RecallAnswerCandidate | null;
  results: RecallResultRow[];
}): boolean {
  if (!params.intent || params.intent.queryClass !== "decision_project") return false;

  const topResults = params.results.slice(0, 5);
  if (topResults.length === 0) return true;

  const specificProjectTerms = extractSpecificDecisionProjectTerms(params.intent);
  const hasSpecificTermSupport =
    specificProjectTerms.length === 0 ||
    topResults.some((result) => {
      const summary = String(result.item.summary ?? "").toLowerCase();
      return specificProjectTerms.some((term) => containsAliasTerm(summary, term));
    });
  const knowledgeBackedSupportCount = topResults.filter((result) =>
    hasKnowledgeBackedProjectSupport(result, params.intent),
  ).length;
  const weakAnswer =
    !params.answerCandidate || params.answerCandidate.strategy === "summary-best-hit";

  return weakAnswer || knowledgeBackedSupportCount === 0 || !hasSpecificTermSupport;
}

async function runKnowledgeProjectFallback(params: {
  config: ArgentConfig;
  queryVariants: string[];
  collectionFilters: string[];
  includeShared: boolean;
  limit: number;
  intent: RecallIntentSignal;
}): Promise<{ results: RecallResultRow[]; queryVariants: string[] }> {
  const merged = new Map<string, RecallResultRow>();
  const fallbackQueries: string[] = [];
  const perQueryLimit = Math.max(6, Math.min(20, params.limit));

  for (const queryVariant of params.queryVariants.slice(0, 6)) {
    const result = await callGateway<{
      success: boolean;
      results?: KnowledgeSearchHit[];
    }>({
      config: params.config,
      method: "knowledge.search",
      params: {
        query: queryVariant,
        options: {
          ...(params.collectionFilters.length > 0 ? { collection: params.collectionFilters } : {}),
          limit: perQueryLimit,
          includeShared: params.includeShared,
          ingestedOnly: true,
        },
      },
      timeoutMs: 10_000,
    }).catch(() => ({ success: false, results: [] }));

    if (!result.success || !Array.isArray(result.results) || result.results.length === 0) {
      continue;
    }

    fallbackQueries.push(queryVariant);
    for (const hit of result.results) {
      const baseItem: RecallResultRow["item"] = {
        id: String(hit.id),
        memoryType: "knowledge",
        summary: String(hit.summary ?? ""),
        significance: "noteworthy",
        reinforcementCount: 1,
        createdAt: hit.createdAt,
        happenedAt: null,
        extra: {
          source: "knowledge_ingest",
          retrievalSource: "knowledge_search_fallback",
          ...(typeof hit.citation === "string" && hit.citation.trim()
            ? { citation: hit.citation }
            : {}),
          ...(typeof hit.collection === "string" && hit.collection.trim()
            ? { collection: hit.collection }
            : {}),
          ...(typeof hit.sourceFile === "string" && hit.sourceFile.trim()
            ? { sourceFile: hit.sourceFile }
            : {}),
          ...(typeof hit.chunkIndex === "number" ? { chunkIndex: hit.chunkIndex } : {}),
          ...(typeof hit.chunkTotal === "number" ? { chunkTotal: hit.chunkTotal } : {}),
        },
      };
      const manualScore = scoreManualProjectCandidate({
        item: baseItem,
        intent: params.intent,
      });
      const candidate: RecallResultRow = {
        item: baseItem,
        score:
          0.72 + Math.min(2.5, Math.max(0, Number(hit.score) || 0)) * 0.22 + manualScore * 0.16,
        categories: [],
      };
      const existing = merged.get(candidate.item.id);
      if (!existing || candidate.score > existing.score) {
        merged.set(candidate.item.id, candidate);
      }
    }
  }

  return {
    results: [...merged.values()].sort((a, b) => b.score - a.score).slice(0, params.limit),
    queryVariants: fallbackQueries,
  };
}

// ── Schemas ──

const MemoryRecallSchema = Type.Object({
  query: Type.String({ description: "Natural language search query" }),
  decompose: Type.Optional(
    Type.Boolean({
      description:
        "Decompose strict multi-fact memory questions into atomic internal recalls. " +
        "Slower, but returns per-fact states and evidence-oriented grouping.",
      default: false,
    }),
  ),
  mode: Type.Optional(
    Type.Union(
      [
        Type.Literal("general"),
        Type.Literal("identity"),
        Type.Literal("timeline"),
        Type.Literal("preferences"),
        Type.Literal("incident"),
      ],
      {
        description:
          "Retrieval mode preset. identity = higher limits + entity expansion + type diversity. Default: general.",
      },
    ),
  ),
  types: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal("profile"),
        Type.Literal("event"),
        Type.Literal("knowledge"),
        Type.Literal("behavior"),
        Type.Literal("skill"),
        Type.Literal("tool"),
        Type.Literal("self"),
      ]),
      { description: "Filter by memory type(s)" },
    ),
  ),
  entity: Type.Optional(
    Type.String({ description: "Filter to memories linked to a specific entity name" }),
  ),
  collection: Type.Optional(
    Type.String({
      description:
        "Filter to a specific knowledge ingest collection (matches extra.collection / collectionTag).",
    }),
  ),
  include_shared: Type.Optional(
    Type.Boolean({
      description:
        "Include memories shared by other family agents (visibility: family/public). Requires PG. Default: false.",
      default: false,
    }),
  ),
  min_significance: Type.Optional(
    Type.Union(
      [
        Type.Literal("routine"),
        Type.Literal("noteworthy"),
        Type.Literal("important"),
        Type.Literal("core"),
      ],
      { description: "Minimum significance level (e.g. 'important' returns important + core)" },
    ),
  ),
  emotional_filter: Type.Optional(
    Type.Union(
      [
        Type.Literal("positive"),
        Type.Literal("negative"),
        Type.Literal("intense"),
        Type.Literal("calm"),
      ],
      {
        description:
          "Filter by emotional quality: positive (valence>0), negative (valence<0), intense (arousal>0.5), calm (arousal<0.3)",
      },
    ),
  ),
  limit: Type.Optional(Type.Number({ description: "Max results (default 10)", default: 10 })),
  deep: Type.Optional(
    Type.Boolean({
      description: "Use deep recall with LLM re-ranking (slower, higher quality)",
      default: false,
    }),
  ),
  include_coverage: Type.Optional(
    Type.Boolean({
      description: "Return type/entity coverage metadata in response. Default: false.",
      default: false,
    }),
  ),
  min_type_coverage: Type.Optional(
    Type.Number({
      description:
        "Minimum number of distinct memory types that should be represented in results. " +
        "Triggers two-pass expansion if initial results have fewer types. Default: no minimum.",
    }),
  ),
});

const MemoryStoreSchema = Type.Object({
  fact: Type.String({ description: "The fact or note to store" }),
  type: Type.Union(
    [
      Type.Literal("profile"),
      Type.Literal("event"),
      Type.Literal("knowledge"),
      Type.Literal("behavior"),
      Type.Literal("skill"),
      Type.Literal("tool"),
      Type.Literal("self"),
    ],
    { description: "Memory type classification" },
  ),
  categories: Type.Optional(Type.Array(Type.String(), { description: "Category names to assign" })),
  happenedAt: Type.Optional(Type.String({ description: "ISO 8601 timestamp for events" })),
  significance: Type.Optional(
    Type.Union(
      [
        Type.Literal("routine"),
        Type.Literal("noteworthy"),
        Type.Literal("important"),
        Type.Literal("core"),
      ],
      { description: "How significant is this memory? routine → noteworthy → important → core" },
    ),
  ),
  emotion: Type.Optional(
    Type.Object(
      {
        valence: Type.Number({
          description: "Emotional valence: -2 (deeply negative) to +2 (deeply positive)",
        }),
        arousal: Type.Number({ description: "Emotional arousal: 0 (calm) to 1 (intense)" }),
      },
      { description: "Emotional context at time of storage" },
    ),
  ),
  reflection: Type.Optional(Type.String({ description: "What does this memory mean to you?" })),
  lesson: Type.Optional(Type.String({ description: "What lesson was learned?" })),
  visibility: Type.Optional(
    Type.Union(
      [
        Type.Literal("private"),
        Type.Literal("team"),
        Type.Literal("family"),
        Type.Literal("public"),
      ],
      {
        description:
          "Who can see this memory? private (default, only you), team (your team), family (all family agents), public (anyone)",
      },
    ),
  ),
  entities: Type.Optional(
    Type.Array(Type.String(), { description: "Names of people, pets, places involved" }),
  ),
});

const MemoryCategoriesSchema = Type.Object({
  query: Type.Optional(Type.String({ description: "Filter categories by keyword" })),
  pattern: Type.Optional(
    Type.String({ description: "Regex or substring filter for category name" }),
  ),
  minItems: Type.Optional(Type.Number({ description: "Minimum linked memory item count" })),
  maxItems: Type.Optional(Type.Number({ description: "Maximum linked memory item count" })),
  sort: Type.Optional(
    Type.Union([Type.Literal("name"), Type.Literal("itemCount")], {
      description: "Sort categories by name or itemCount",
    }),
  ),
  sortDirection: Type.Optional(
    Type.Union([Type.Literal("asc"), Type.Literal("desc")], {
      description: "Sort direction",
    }),
  ),
  limit: Type.Optional(Type.Number({ description: "Max categories (default 20)", default: 20 })),
});

const MemoryCategoryMergeSchema = Type.Object({
  sourceCategoryIds: Type.Array(Type.String(), {
    description: "Category IDs to absorb into the target category",
  }),
  targetCategoryId: Type.String({ description: "Surviving category ID" }),
});

const MemoryCategoryRenameSchema = Type.Object({
  categoryId: Type.String({ description: "Category ID to rename" }),
  newName: Type.String({ description: "New display name" }),
});

const MemoryCategoryCleanupSchema = Type.Object({
  dryRun: Type.Optional(Type.Boolean({ description: "Preview changes before applying" })),
  deleteEmpty: Type.Optional(
    Type.Boolean({ description: "Delete categories with 0 linked items" }),
  ),
  mergeSimilar: Type.Optional(Type.Boolean({ description: "Merge near-duplicate categories" })),
  similarityThreshold: Type.Optional(
    Type.Number({
      description: "Normalized Levenshtein threshold for near-duplicate names (default 0.8)",
    }),
  ),
  maxMergeSourceItems: Type.Optional(
    Type.Number({
      description:
        "Only auto-merge source categories with this many linked items or fewer (default 3)",
    }),
  ),
});

const MemoryForgetSchema = Type.Object({
  id: Type.Optional(Type.String({ description: "Memory item ID to delete" })),
  fact: Type.Optional(
    Type.String({ description: "Exact fact text to find and delete (by content hash)" }),
  ),
});

// ── Tool Factories ──

function readBooleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const raw = params[key];
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
}

function readMemoryCategorySort(value: string | undefined): "name" | "itemCount" | undefined {
  return value === "name" || value === "itemCount" ? value : undefined;
}

function readSortDirection(value: string | undefined): "asc" | "desc" | undefined {
  return value === "asc" || value === "desc" ? value : undefined;
}

export function createMemoryRecallTool(options: {
  config?: ArgentConfig;
  agentId?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }

  const tool: AnyAgentTool = {
    label: "Memory Recall",
    name: "memory_recall",
    description:
      "Search your long-term memory (MemU) for relevant facts, events, preferences, and knowledge. " +
      "Use this before answering questions about the user, past conversations, or stored context. " +
      "Returns scored results with memory type and category labels. " +
      "Use this first for memory-only recap questions like what happened, what was accomplished, what changed last week, or what project we worked on. " +
      "Set mode='identity' for people/relationship queries (auto-uses higher limits + type diversity). " +
      "Set include_coverage=true to see type distribution and coverage metadata.",
    parameters: MemoryRecallSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = normalizeToolParams(rawParams);
      let query: string;
      try {
        query = readStringParam(params, "query", { required: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await appendMemoryRecallTelemetry({
          version: 1,
          ts: Date.now(),
          iso: new Date().toISOString(),
          status: "error",
          tool: "memory_recall",
          toolCallId: _toolCallId,
          agentId: options.agentId,
          query: "",
          requestedMode: "general",
          resolvedMode: "general",
          queryClass: "general",
          deep: false,
          collectionFilters: [],
          includeCoverage: false,
          error: message,
        }).catch(() => undefined);
        return jsonResult({ results: [], error: message });
      }
      const skipDecomposition =
        Boolean(params) &&
        typeof params === "object" &&
        (params as Record<string, unknown>).__decomposition_skip === true;
      const entityFilter = readStringParam(params, "entity");
      const explicitCollectionFilter = readStringParam(params, "collection");
      const includeCoverage = params.include_coverage === true;
      const requestedMode = (readStringParam(params, "mode") ?? "general") as RecallMode;

      if (!skipDecomposition) {
        const decompositionPlan = buildRecallDecompositionPlan(query);
        if (decompositionPlan.length > 1 && shouldUseRecallDecomposition(params, query)) {
          const mergedResults = new Map<string, Record<string, unknown>>();
          const facts = await Promise.all(
            decompositionPlan.map(async (step, index) => {
              const factParams: Record<string, unknown> = {
                ...(params && typeof params === "object"
                  ? (params as Record<string, unknown>)
                  : {}),
                query: step.query,
                __decomposition_skip: true,
              };
              if (step.mode) factParams.mode = step.mode;

              const factResult = await tool.execute(
                `${_toolCallId}::fact-${index + 1}`,
                factParams,
              );
              const factDetail =
                factResult && typeof factResult === "object" && "details" in factResult
                  ? ((factResult as { details?: Record<string, unknown> }).details ?? {})
                  : {};
              const factRows = Array.isArray(factDetail.results)
                ? (factDetail.results as Array<Record<string, unknown>>)
                : [];
              for (const row of factRows.slice(0, 2)) {
                const key =
                  typeof row.id === "string" && row.id.trim()
                    ? row.id
                    : `${step.key}:${String(row.summary ?? "")}`;
                if (!mergedResults.has(key)) mergedResults.set(key, row);
              }

              const state = classifyRecallDecompositionState(factDetail, step.key);
              return {
                key: step.key,
                label: step.label,
                reason: step.reason,
                query: step.query,
                mode: factDetail.mode ?? step.mode ?? requestedMode,
                queryClass: factDetail.queryClass ?? "general",
                state,
                resultCount:
                  typeof factDetail.count === "number" ? factDetail.count : factRows.length,
                answer:
                  factDetail.answer && typeof factDetail.answer === "object"
                    ? factDetail.answer
                    : null,
                topResult: factRows[0] ?? null,
              };
            }),
          );

          const decompositionSummary = {
            confirmed: facts.filter((fact) => fact.state === "confirmed").length,
            weakRecall: facts.filter((fact) => fact.state === "weak_recall").length,
            missing: facts.filter((fact) => fact.state === "missing").length,
            errors: facts.filter((fact) => fact.state === "error").length,
          };
          const response: Record<string, unknown> = {
            results: [...mergedResults.values()],
            count: mergedResults.size,
            mode: requestedMode,
            queryClass: "multi_fact",
            decomposition: {
              used: true,
              facts,
              summary: decompositionSummary,
            },
            recallTelemetry: {
              decompositionUsed: true,
              subqueries: facts.map((fact) => ({
                key: fact.key,
                query: fact.query,
                mode: fact.mode,
                queryClass: fact.queryClass,
                state: fact.state,
              })),
            },
          };

          if (includeCoverage) {
            response.coverage = {
              decompositionUsed: true,
              factsConfirmed: decompositionSummary.confirmed,
              factsWeakRecall: decompositionSummary.weakRecall,
              factsMissing: decompositionSummary.missing,
              factErrors: decompositionSummary.errors,
            };
          }

          await appendMemoryRecallTelemetry({
            version: 1,
            ts: Date.now(),
            iso: new Date().toISOString(),
            status: "ok",
            tool: "memory_recall",
            toolCallId: _toolCallId,
            agentId: options.agentId,
            query,
            requestedMode,
            resolvedMode: requestedMode,
            queryClass: "multi_fact",
            deep: typeof params.deep === "boolean" ? params.deep : false,
            entityFilter: entityFilter ?? undefined,
            collectionFilters: explicitCollectionFilter ? [explicitCollectionFilter] : [],
            includeCoverage,
            resultCount: mergedResults.size,
            recallTelemetry: {
              decompositionUsed: true,
              subqueries: facts.map((fact) => ({
                key: fact.key,
                query: fact.query,
                mode: fact.mode,
                queryClass: fact.queryClass,
                state: fact.state,
              })),
            },
            topResults: [...mergedResults.values()].slice(0, 5).map((row) => ({
              id: typeof row.id === "string" ? row.id : undefined,
              type: typeof row.type === "string" ? row.type : undefined,
              summary: String(row.summary ?? ""),
              score: typeof row.score === "number" ? row.score : 0,
            })),
          }).catch(() => undefined);

          try {
            const toon = encodeForPrompt(response);
            return { content: [{ type: "text" as const, text: toon }], details: response };
          } catch {
            return jsonResult(response);
          }
        }
      }

      const resolvedIntent = options.agentId
        ? resolveEffectiveIntentForAgent({
            config: cfg,
            agentId: options.agentId,
          })
        : null;
      const collectionFilters = inferDepartmentKnowledgeCollections({
        departmentId: resolvedIntent?.departmentId,
        query,
        explicitCollections: explicitCollectionFilter ? [explicitCollectionFilter] : [],
      });
      const normalizedCollectionFilters = new Set(
        collectionFilters.map((value) => normalizeCollectionValue(value)).filter(Boolean),
      );
      const normalizedCollectionTagFilters = new Set(
        collectionFilters
          .map((value) => normalizeCollectionValue(value))
          .filter(Boolean)
          .map((value) => toCollectionTag(value)),
      );
      const minSignificance = readStringParam(params, "min_significance") as
        | "routine"
        | "noteworthy"
        | "important"
        | "core"
        | undefined;
      const emotionalFilter = readStringParam(params, "emotional_filter") as
        | "positive"
        | "negative"
        | "intense"
        | "calm"
        | undefined;
      const includeShared = params.include_shared === true;
      const minTypeCoverage = readNumberParam(params, "min_type_coverage", { integer: true });
      const inferredEntityFilter = entityFilter ? null : extractTemporalEntitySubject(query);
      const effectiveEntityFilter = entityFilter ?? inferredEntityFilter;
      let mode = requestedMode;
      let modeConfig = RECALL_MODES[mode] ?? RECALL_MODES.general;
      let intentSignal = detectRecallIntentSignal(query);
      let queryClass = intentSignal?.queryClass ?? "general";
      const timelineWindow =
        queryClass === "timeline_episodic" || queryClass === "decision_project"
          ? detectTimelineWindow(query)
          : null;

      // User inputs (mode defaults are applied after alias/context escalation)
      const userTypes = readStringArrayParam(params, "types") as MemoryType[] | undefined;
      const userLimit = readNumberParam(params, "limit", { integer: true }) ?? 10;
      const explicitDeep = typeof params.deep === "boolean" ? params.deep : undefined;

      const tz = resolveUserTimezone(cfg.agents?.defaults?.userTimezone);

      try {
        const storage = await getStorageAdapter();
        const memory =
          options.agentId && storage.memory.withAgentId
            ? storage.memory.withAgentId(options.agentId)
            : storage.memory;
        let results: Array<{ item: any; score: number; categories: string[] }>;

        const aliasContext = await resolveAliasExpansionContext({
          memory,
          query,
          mode,
          entityFilter: effectiveEntityFilter ?? undefined,
        });
        let modeEscalationReason: string | undefined;
        if (intentSignal?.preferredMode && requestedMode === "general" && mode === "general") {
          mode = intentSignal.preferredMode;
          modeConfig = RECALL_MODES[mode] ?? RECALL_MODES.general;
          modeEscalationReason = intentSignal.reason;
        }
        if (aliasContext.escalatedMode) {
          mode = aliasContext.escalatedMode;
          modeConfig = RECALL_MODES[mode] ?? RECALL_MODES.general;
          modeEscalationReason = "entity-alias-or-family-care-signal";
        }
        let queryVariants = [
          ...new Set(
            [
              ...(aliasContext.expandedQueries.length > 0 ? aliasContext.expandedQueries : [query]),
              ...buildIntentQueryVariants(query, intentSignal, timelineWindow),
              ...(effectiveEntityFilter
                ? [
                    effectiveEntityFilter,
                    `${effectiveEntityFilter} memory`,
                    ...(timelineWindow
                      ? [`${effectiveEntityFilter} ${timelineWindow.isoDate}`]
                      : []),
                  ]
                : []),
            ].filter((entry) => entry.trim().length > 0),
          ),
        ].slice(
          0,
          queryClass === "decision_project" ? 18 : queryClass === "timeline_episodic" ? 12 : 8,
        );

        const inferredTimelineTypes: MemoryType[] | undefined =
          !userTypes && effectiveEntityFilter && queryClass === "timeline_episodic"
            ? ["event", "episode", "profile", "knowledge"]
            : undefined;
        const types: MemoryType[] | undefined =
          userTypes ??
          inferredTimelineTypes ??
          (modeConfig.defaultTypes ? modeConfig.defaultTypes : undefined);
        const limit = Math.max(userLimit, modeConfig.limitFloor);
        const deep =
          explicitDeep ??
          (queryClass === "timeline_episodic" || queryClass === "decision_project"
            ? true
            : modeConfig.deep);
        const diversify = modeConfig.diversify;
        const entityExpand = modeConfig.entityExpand;

        if (types) {
          for (const t of types) {
            if (!MEMORY_TYPES.includes(t)) {
              return jsonResult({ error: `Invalid memory type: ${t}`, validTypes: MEMORY_TYPES });
            }
          }
        }

        const entityFilterContext = effectiveEntityFilter
          ? await resolveEntityFilterContext({
              memory,
              entityFilter: effectiveEntityFilter,
            })
          : null;

        const hasPostFilters = !!(
          effectiveEntityFilter ||
          normalizedCollectionFilters.size > 0 ||
          minSignificance ||
          emotionalFilter
        );
        const fetchLimit = hasPostFilters ? limit * 3 : deep ? limit * 4 : limit;

        let adapterResults: Array<{ item: any; score: number; categories: string[] }> = [];
        let vectorFallbackUsed = false;
        let vectorFallbackReason: "keyword_empty" | "keyword_sparse" | undefined;
        let vectorFallbackAdded = 0;
        let adapterSearchSucceeded = false;
        try {
          const merged = new Map<string, { item: any; score: number; categories: string[] }>();
          for (const queryVariant of queryVariants) {
            const ownHits = await memory.searchByKeyword(queryVariant, fetchLimit);
            for (const hit of ownHits) {
              const existing = merged.get(hit.item.id);
              if (!existing || hit.score > existing.score) {
                merged.set(hit.item.id, { ...hit, categories: [] as string[] });
              }
            }

            if (includeShared && memory.searchByKeywordShared) {
              try {
                const sharedHits = await memory.searchByKeywordShared(queryVariant, fetchLimit);
                for (const hit of sharedHits) {
                  const existing = merged.get(hit.item.id);
                  if (!existing || hit.score > existing.score) {
                    merged.set(hit.item.id, { ...hit, categories: [] as string[] });
                  }
                }
              } catch {
                // Shared search is optional.
              }
            }
          }

          adapterResults = [...merged.values()].sort((a, b) => b.score - a.score);
          const latentProjectIntent = inferLatentProjectIntentFromHits({
            query,
            currentIntent: intentSignal,
            results: adapterResults,
          });
          if (latentProjectIntent) {
            intentSignal = latentProjectIntent;
            queryClass = intentSignal.queryClass;
            if (mode === "general" || mode === "identity") {
              mode = intentSignal.preferredMode;
              modeConfig = RECALL_MODES[mode] ?? RECALL_MODES.general;
              modeEscalationReason = latentProjectIntent.reason;
            }
            queryVariants = [
              ...new Set(
                [
                  ...queryVariants,
                  ...buildIntentQueryVariants(query, intentSignal, timelineWindow),
                ].filter((entry) => entry.trim().length > 0),
              ),
            ].slice(0, 18);

            for (const queryVariant of queryVariants) {
              const ownHits = await memory.searchByKeyword(queryVariant, fetchLimit);
              for (const hit of ownHits) {
                const existing = merged.get(hit.item.id);
                if (!existing || hit.score > existing.score) {
                  merged.set(hit.item.id, { ...hit, categories: [] as string[] });
                }
              }
            }
            adapterResults = [...merged.values()].sort((a, b) => b.score - a.score);
          }

          const sparseThreshold = Math.max(2, Math.ceil(limit * 0.3));
          const suppressVectorFallbackForLatentProject =
            intentSignal?.queryClass === "decision_project" &&
            intentSignal.reason === "latent-project-match" &&
            adapterResults.length > 0;
          if (
            (adapterResults.length === 0 || adapterResults.length < sparseThreshold) &&
            !suppressVectorFallbackForLatentProject
          ) {
            vectorFallbackReason = adapterResults.length === 0 ? "keyword_empty" : "keyword_sparse";
            try {
              const vectorFallback = await runRecallVectorFallback({
                memory,
                cfg,
                queryVariants,
                fetchLimit,
                agentId: options.agentId,
              });
              if (vectorFallback.length > 0) {
                const existingIds = new Set(adapterResults.map((hit) => hit.item.id));
                for (const hit of vectorFallback) {
                  if (existingIds.has(hit.item.id)) continue;
                  adapterResults.push(hit);
                  existingIds.add(hit.item.id);
                  vectorFallbackAdded += 1;
                }
                if (vectorFallbackAdded > 0) {
                  vectorFallbackUsed = true;
                  adapterResults.sort((a, b) => b.score - a.score);
                }
              }
            } catch {
              // Embedding/vector fallback is best effort.
            }
          }
          adapterSearchSucceeded = true;
        } catch {
          // Adapter search unavailable; fall back to MemU retrieval path below.
        }

        if (adapterSearchSucceeded) {
          results = adapterResults;
        } else {
          return jsonResult({
            results: [],
            error: "Memory adapter search unavailable",
          });
        }

        const manualPropertyCandidates = await collectManualPropertyCandidates({
          memory,
          intent: intentSignal,
          limit: Math.max(20, limit * 2),
        });
        const manualProjectCandidates = await collectManualProjectCandidates({
          memory,
          intent: intentSignal,
          timelineWindow,
          limit: Math.max(12, limit * 2),
        });
        const manualTimelineCandidates = await collectManualTimelineCandidates({
          memory,
          intent: intentSignal,
          timelineWindow,
          limit: Math.max(12, limit * 2),
        });
        if (manualPropertyCandidates.length > 0) {
          const mergedById = new Map(results.map((result) => [result.item.id, result] as const));
          for (const candidate of manualPropertyCandidates) {
            const existing = mergedById.get(candidate.item.id);
            if (!existing || candidate.score > existing.score) {
              mergedById.set(candidate.item.id, candidate);
            }
          }
          results = [...mergedById.values()].sort((a, b) => b.score - a.score);
        }
        if (manualProjectCandidates.length > 0) {
          const mergedById = new Map(results.map((result) => [result.item.id, result] as const));
          for (const candidate of manualProjectCandidates) {
            const existing = mergedById.get(candidate.item.id);
            if (!existing || candidate.score > existing.score) {
              mergedById.set(candidate.item.id, candidate);
            }
          }
          results = [...mergedById.values()].sort((a, b) => b.score - a.score);
        }
        if (manualTimelineCandidates.length > 0) {
          const mergedById = new Map(results.map((result) => [result.item.id, result] as const));
          for (const candidate of manualTimelineCandidates) {
            const existing = mergedById.get(candidate.item.id);
            if (!existing || candidate.score > existing.score) {
              mergedById.set(candidate.item.id, candidate);
            }
          }
          results = [...mergedById.values()].sort((a, b) => b.score - a.score);
        }

        const aclAutoCreateCollections = includeShared
          ? []
          : results
              .map((r) => {
                const extra =
                  r.item.extra && typeof r.item.extra === "object"
                    ? (r.item.extra as Record<string, unknown>)
                    : {};
                const source = typeof extra.source === "string" ? extra.source : undefined;
                if (!isKnowledgeCollectionScopedSource(source)) return null;
                if (typeof extra.collection === "string" && extra.collection.trim()) {
                  return extra.collection;
                }
                if (typeof extra.collectionTag === "string" && extra.collectionTag.trim()) {
                  return extra.collectionTag;
                }
                return null;
              })
              .filter((value): value is string => Boolean(value));

        const aclSnapshot = await getKnowledgeAclSnapshot({
          agentId: options.agentId ?? "argent",
          autoCreateCollections: aclAutoCreateCollections,
        });

        if (aclSnapshot.aclEnforced) {
          results = results.filter((r) => {
            const extra =
              r.item.extra && typeof r.item.extra === "object"
                ? (r.item.extra as Record<string, unknown>)
                : {};
            const source = typeof extra.source === "string" ? extra.source : undefined;
            if (!isKnowledgeCollectionScopedSource(source)) return true;
            const collectionValue =
              typeof extra.collection === "string" && extra.collection.trim()
                ? extra.collection
                : typeof extra.collectionTag === "string"
                  ? extra.collectionTag
                  : "";
            return hasKnowledgeCollectionReadAccess(aclSnapshot, collectionValue);
          });
        }

        // Deep mode fallback: if strict full-text matching returns sparse/no hits,
        // broaden with per-token searches and merge candidates.
        if (deep && results.length < Math.max(3, Math.floor(limit / 3))) {
          const tokenQueries = [
            ...new Set(
              query
                .split(/[^\p{L}\p{N}_-]+/u)
                .map((token) => token.trim())
                .filter((token) => token.length >= 3),
            ),
          ].slice(0, 10);
          if (tokenQueries.length > 0) {
            const mergedById = new Map(results.map((result) => [result.item.id, result] as const));
            for (const tokenQuery of tokenQueries) {
              let tokenHits: Array<{ item: any; score: number; categories: string[] }> = [];
              try {
                tokenHits = await memory.searchByKeyword(tokenQuery, fetchLimit);
              } catch {
                tokenHits = [];
              }
              for (const hit of tokenHits) {
                const existing = mergedById.get(hit.item.id);
                if (!existing || hit.score > existing.score) {
                  mergedById.set(hit.item.id, { ...hit, categories: [] as string[] });
                }
              }
            }
            results = [...mergedById.values()].sort((a, b) => b.score - a.score);
          }
        }

        // Apply post-retrieval filters
        if (hasPostFilters) {
          const sigPriority: Record<string, number> = {
            routine: 1,
            noteworthy: 2,
            important: 3,
            core: 4,
          };
          const minSigLevel = minSignificance ? (sigPriority[minSignificance] ?? 0) : 0;

          // Get entity's linked item IDs if filtering by entity
          results = results.filter((r) => {
            // Entity filter
            if (entityFilterContext) {
              const linkedMatch =
                entityFilterContext.entityItemIds !== null &&
                entityFilterContext.entityItemIds.has(r.item.id);
              const textMatch = itemMatchesEntityTerms(r.item, entityFilterContext.matchTerms);
              if (!linkedMatch && !textMatch) return false;
            }

            // Collection filter (for ingested knowledge silos)
            if (normalizedCollectionFilters.size > 0) {
              const extra =
                r.item.extra && typeof r.item.extra === "object"
                  ? (r.item.extra as Record<string, unknown>)
                  : {};
              const itemCollectionRaw = normalizeCollectionValue(extra.collection);
              const itemCollectionTag = normalizeCollectionValue(
                typeof extra.collectionTag === "string"
                  ? extra.collectionTag
                  : itemCollectionRaw
                    ? toCollectionTag(itemCollectionRaw)
                    : "",
              );
              const rawMatch = itemCollectionRaw
                ? normalizedCollectionFilters.has(itemCollectionRaw)
                : false;
              const tagMatch = itemCollectionTag
                ? normalizedCollectionTagFilters.has(itemCollectionTag)
                : false;
              if (!rawMatch && !tagMatch) return false;
            }

            // Significance filter
            if (minSigLevel > 0) {
              const itemSig = sigPriority[r.item.significance ?? "routine"] ?? 1;
              if (itemSig < minSigLevel) return false;
            }

            // Emotional filter
            if (emotionalFilter) {
              const v = r.item.emotionalValence ?? 0;
              const a = r.item.emotionalArousal ?? 0;
              switch (emotionalFilter) {
                case "positive":
                  if (v <= 0) return false;
                  break;
                case "negative":
                  if (v >= 0) return false;
                  break;
                case "intense":
                  if (a <= 0.5) return false;
                  break;
                case "calm":
                  if (a >= 0.3) return false;
                  break;
              }
            }

            return true;
          });
        }

        applyFamilyCareRankingBoost(
          results,
          aliasContext.resolvedEntities,
          aliasContext.familyCareSignal,
        );
        results.sort((a, b) => b.score - a.score);
        const preIntentRerankSnapshot = buildRecallResultSnapshot(results);

        // Strict type enforcement: hard-filter to defaultTypes when mode requires it
        // (Priority 2: timeline = event-only, preferences = behavior+profile only)
        if (modeConfig.strictTypes && types) {
          results = results.filter((r) => types.includes(r.item.memoryType as MemoryType));
        }

        // Entity graph expansion: pull in memories from linked entities
        if (entityExpand && results.length > 0) {
          try {
            const seenIds = new Set(results.map((r) => r.item.id));
            const discoveredEntityIds = new Set<string>();

            for (const entity of aliasContext.resolvedEntities) {
              discoveredEntityIds.add(entity.id);
            }

            // Discover entities from Pass 1 results
            for (const r of results) {
              const itemEntities = await memory.getItemEntities(r.item.id);
              for (const e of itemEntities) {
                discoveredEntityIds.add(e.id);
              }
            }

            // Also try to find entities by name from the query text
            const queryWords = queryVariants
              .flatMap((variant) => variant.split(/\s+/))
              .filter((w) => w.length > 2);
            for (const word of queryWords) {
              const entity = await memory.findEntityByName(word);
              if (entity) discoveredEntityIds.add(entity.id);
            }

            // Fetch memories linked to discovered entities
            for (const entityId of discoveredEntityIds) {
              const entityMemories = await memory.getEntityItems(entityId, 10);
              for (const mem of entityMemories) {
                if (!seenIds.has(mem.id)) {
                  const categories = await memory.getItemCategories(mem.id);
                  results.push({
                    item: mem,
                    score: 0.5, // Entity-expanded items get a baseline score
                    categories: categories.map((c) => c.name),
                  });
                  seenIds.add(mem.id);
                }
              }
            }
          } catch {
            // Entity expansion failed — continue with existing results
          }
        }

        // Two-pass retrieval: fill in missing types
        // Triggers: (a) diversify mode, (b) min_type_coverage param, (c) coverageFloor auto-trigger
        // IMPORTANT: Check coverage from simulated slice (not full expanded set) because
        // entity expansion can inflate type diversity beyond what the final limit preserves.
        let twoPassUsed = false;
        let twoPassAttempted = false;
        let twoPassTypesSearched: string[] = [];
        let twoPassReason: string | undefined;
        if (!types || !modeConfig.strictTypes) {
          // Simulate the post-slice type distribution the user will actually see
          const simulatedSlice = results.slice(0, limit);
          const typeCounts: Record<string, number> = {};
          for (const r of simulatedSlice) {
            const t = r.item.memoryType as string;
            typeCounts[t] = (typeCounts[t] ?? 0) + 1;
          }

          const stats = await memory.getStats();
          const typesWithItems = Object.keys(stats.itemsByType).filter(
            (t) => stats.itemsByType[t] > 0,
          );
          const distinctTypesFound = Object.keys(typeCounts).length;
          const coverageScore =
            typesWithItems.length > 0 ? distinctTypesFound / typesWithItems.length : 1;

          const missingTypes = typesWithItems
            .filter((type) => !typeCounts[type])
            .map((type) => type as MemoryType);

          // Determine if expansion is needed
          const belowCoverageFloor =
            modeConfig.coverageFloor !== undefined && coverageScore < modeConfig.coverageFloor;
          const belowMinTypeCoverage =
            minTypeCoverage !== undefined && distinctTypesFound < minTypeCoverage;
          const needsExpansion =
            missingTypes.length > 0 && (diversify || belowCoverageFloor || belowMinTypeCoverage);

          if (needsExpansion) {
            twoPassAttempted = true;
            twoPassTypesSearched = missingTypes;
            twoPassReason = belowCoverageFloor
              ? `coverage ${coverageScore.toFixed(2)} < floor ${modeConfig.coverageFloor}`
              : belowMinTypeCoverage
                ? `types ${distinctTypesFound} < min ${minTypeCoverage}`
                : "diversify mode";
            try {
              const pass2Merged = new Map<
                string,
                { item: any; score: number; categories: string[] }
              >();
              const pass2FetchLimit = Math.max(fetchLimit, 50, 10 * missingTypes.length);
              for (const queryVariant of queryVariants) {
                const pass2Hits = await memory.searchByKeyword(queryVariant, pass2FetchLimit);
                for (const hit of pass2Hits) {
                  if (!missingTypes.includes(hit.item.memoryType as MemoryType)) {
                    continue;
                  }
                  const existing = pass2Merged.get(hit.item.id);
                  if (!existing || hit.score > existing.score) {
                    pass2Merged.set(hit.item.id, { ...hit, categories: [] as string[] });
                  }
                }
              }
              const pass2 = [...pass2Merged.values()];

              // Dedupe by item ID
              const seenIds = new Set(results.map((r) => r.item.id));
              for (const r of pass2) {
                if (!seenIds.has(r.item.id)) {
                  results.push(r);
                  seenIds.add(r.item.id);
                }
              }
              twoPassUsed = pass2.length > 0;
            } catch {
              // Pass 2 failed — continue with Pass 1 results
            }
          }
        }

        // Type diversity soft quota: prevent any single type from dominating >60%
        // Applies when diversify mode is on, two-pass expanded, or min_type_coverage set
        const applyDiversity = diversify || twoPassUsed;
        if (applyDiversity && results.length > 1) {
          const typeCounts: Record<string, number> = {};
          for (const r of results) {
            const t = r.item.memoryType as string;
            typeCounts[t] = (typeCounts[t] ?? 0) + 1;
          }

          const totalCount = results.length;
          const threshold = Math.ceil(totalCount * 0.6);

          for (const [dominantType, count] of Object.entries(typeCounts)) {
            if (count > threshold && Object.keys(typeCounts).length > 1) {
              const dominant: typeof results = [];
              const others: typeof results = [];
              for (const r of results) {
                if (r.item.memoryType === dominantType) {
                  dominant.push(r);
                } else {
                  others.push(r);
                }
              }
              results = [...dominant.slice(0, threshold), ...others];
              break;
            }
          }
        }

        // Type priority re-ranking (runs AFTER diversity quota so it has final say on order)
        if (modeConfig.typePriority && results.length > 1) {
          const priorities = modeConfig.typePriority;
          for (const r of results) {
            const weight = priorities[r.item.memoryType as MemoryType] ?? 1.0;
            r.score *= weight;
          }
          results.sort((a, b) => b.score - a.score);
        }

        applyIntentAwareRecallRerank(results, intentSignal);
        results.sort((a, b) => b.score - a.score);
        results = reorderPropertySlotResults(results, intentSignal);
        results = prunePropertyNoiseResults(results, intentSignal);
        results = pruneDecisionProjectNoiseResults(results, intentSignal);
        results = pruneTimelineNoiseResults(results, intentSignal);
        results = applyTimelineEntityFocus(results, intentSignal, entityFilterContext);
        results = applyDuplicateRecallPressure(results);
        const postIntentRerankSnapshot = buildRecallResultSnapshot(results);

        // When two-pass expanded results, increase effective limit to include additions
        const effectiveLimit = twoPassUsed ? Math.max(limit, results.length) : limit;
        let finalResults = results.slice(0, effectiveLimit);
        let answerCandidate = extractRecallAnswerCandidate({
          query,
          intent: intentSignal,
          timelineWindow,
          finalResults,
        });
        let observationFallbackUsed = false;
        let observationFallbackCount = 0;
        let observationFallbackQueries: string[] = [];
        let observationResults:
          | Array<{
              summary: string;
              confidence: number;
              freshness: number;
              canonicalKey: string;
              status: string;
              evidence: Array<{
                stance: string;
                excerpt: string | null;
                itemId: string | null;
                lessonId: string | null;
                reflectionId: string | null;
                entityId: string | null;
              }>;
            }>
          | undefined;
        if (
          shouldUseObservationRetrieval(cfg) &&
          normalizedCollectionFilters.size === 0 &&
          typeof memory.searchKnowledgeObservations === "function"
        ) {
          const observationKinds = inferObservationKindsForRecall({
            intent: intentSignal,
            query,
          });
          if (observationKinds.length > 0) {
            const observationHits = await memory.searchKnowledgeObservations(query, {
              kinds: observationKinds,
              limit: cfg.memory?.observations?.retrieval?.maxResults ?? 3,
              minConfidence: cfg.memory?.observations?.retrieval?.minConfidence ?? 0.45,
              minFreshness: cfg.memory?.observations?.retrieval?.minFreshness ?? 0.2,
            });
            if (observationHits.length > 0) {
              observationFallbackUsed = true;
              observationFallbackCount = observationHits.length;
              observationFallbackQueries = [...queryVariants];
              observationResults = observationHits.map((hit) => ({
                summary: hit.observation.summary,
                confidence: hit.observation.confidence,
                freshness: hit.observation.freshness,
                canonicalKey: hit.observation.canonicalKey,
                status: hit.observation.status,
                evidence: hit.topEvidence.map((evidence) => ({
                  stance: evidence.stance,
                  excerpt: evidence.excerpt ?? null,
                  itemId: evidence.itemId ?? null,
                  lessonId: evidence.lessonId ?? null,
                  reflectionId: evidence.reflectionId ?? null,
                  entityId: evidence.entityId ?? null,
                })),
              }));
              if (!answerCandidate || answerCandidate.confidence < 0.8) {
                const topObservation = observationHits[0]!.observation;
                answerCandidate = {
                  value: topObservation.summary,
                  strategy: "summary-best-hit",
                  confidence: Math.max(0.7, Math.min(0.96, topObservation.confidence)),
                  sourceId: topObservation.id,
                  sourceType: "knowledge_observation",
                  sourceSummary: topObservation.summary,
                };
              }
            }
          }
        }
        let knowledgeFallbackUsed = false;
        let knowledgeFallbackCount = 0;
        let knowledgeFallbackQueries: string[] = [];
        if (
          shouldTriggerKnowledgeProjectFallback({
            intent: intentSignal,
            answerCandidate,
            results: finalResults,
          }) &&
          intentSignal
        ) {
          const knowledgeFallback = await runKnowledgeProjectFallback({
            config: cfg,
            queryVariants,
            collectionFilters,
            includeShared,
            limit: Math.max(8, limit),
            intent: intentSignal,
          });
          if (knowledgeFallback.results.length > 0) {
            const mergedById = new Map(results.map((result) => [result.item.id, result] as const));
            for (const candidate of knowledgeFallback.results) {
              const existing = mergedById.get(candidate.item.id);
              if (!existing || candidate.score > existing.score) {
                mergedById.set(candidate.item.id, candidate);
              }
            }
            results = [...mergedById.values()].sort((a, b) => b.score - a.score);
            results = pruneDecisionProjectNoiseResults(results, intentSignal);
            results = applyDuplicateRecallPressure(results);
            finalResults = results.slice(0, effectiveLimit);
            answerCandidate = extractRecallAnswerCandidate({
              query,
              intent: intentSignal,
              timelineWindow,
              finalResults,
            });
            knowledgeFallbackUsed = true;
            knowledgeFallbackCount = knowledgeFallback.results.length;
            knowledgeFallbackQueries = knowledgeFallback.queryVariants;
          }
        }
        const returnedTopSnapshot = buildRecallResultSnapshot(finalResults);
        const sufficiencyFailed = finalResults.length < Math.max(2, Math.ceil(limit * 0.3));
        const cogneeRetrieval = await runCogneeSearch({
          config: cfg,
          query,
          sufficiencyFailed,
        });
        const formatted = await Promise.all(
          finalResults.map(async (r) => {
            const base = formatResult(r, tz) as Record<string, unknown>;
            try {
              const entities = await memory.getItemEntities(r.item.id);
              if (entities.length > 0) {
                base.entities = entities.map((entity) => entity.name);
              }
            } catch {
              // Entity list enrichment is best effort.
            }
            return base;
          }),
        );

        const response: Record<string, unknown> = {
          results: formatted,
          count: formatted.length,
          mode,
          deep,
          queryClass,
          aclEnforced: aclSnapshot.aclEnforced,
        };
        if (answerCandidate) {
          response.answer = answerCandidate;
        }
        if (observationResults && observationResults.length > 0) {
          response.currentBeliefs = observationResults;
        }
        response.recallTelemetry = {
          queryClass,
          queryVariants,
          timelineWindow: timelineWindow
            ? {
                granularity: timelineWindow.granularity,
                label: timelineWindow.label,
                isoDate: timelineWindow.isoDate,
                endIsoDate: timelineWindow.endIsoDate,
              }
            : undefined,
          manualPropertyCandidates: manualPropertyCandidates.length,
          manualProjectCandidates: manualProjectCandidates.length,
          manualTimelineCandidates: manualTimelineCandidates.length,
          preRerankTop: preIntentRerankSnapshot,
          postRerankTop: postIntentRerankSnapshot,
          answerStrategy: answerCandidate?.strategy ?? null,
          answerSourceId: answerCandidate?.sourceId ?? null,
          vectorFallbackUsed,
          observationFallbackUsed,
          observationFallbackQueries,
          observationFallbackCount,
          knowledgeFallbackUsed,
          knowledgeFallbackQueries,
          knowledgeFallbackCount,
          knowledgeObservationCount: observationResults?.length ?? 0,
        };

        if (mode !== requestedMode) {
          response.modeEscalatedFrom = requestedMode;
          response.modeEscalationReason = modeEscalationReason ?? "query-intent";
        }
        if (aliasContext.matchedAliases.length > 0 || aliasContext.resolvedEntities.length > 0) {
          response.aliasResolution = {
            matchedAliases: [...new Set(aliasContext.matchedAliases)],
            expandedQueries: queryVariants,
            resolvedEntities: aliasContext.resolvedEntities.map((entity) => ({
              name: entity.name,
              relationship: entity.relationship,
              bondStrength: Math.round(entity.bondStrength * 100) / 100,
              memoryCount: entity.memoryCount,
            })),
          };
        }
        if (aliasContext.familyCareSignal) {
          response.familyCareSignal = true;
        }
        if (vectorFallbackUsed && vectorFallbackReason) {
          response.recallFallback = {
            used: true,
            type: "vector",
            reason: vectorFallbackReason,
            added: vectorFallbackAdded,
          };
        }
        if (knowledgeFallbackUsed) {
          response.knowledgeFallback = {
            used: true,
            count: knowledgeFallbackCount,
            queryVariants: knowledgeFallbackQueries,
          };
        }
        if (observationFallbackUsed) {
          response.observationFallback = {
            used: true,
            count: observationFallbackCount,
            queryVariants: observationFallbackQueries,
          };
        }
        if (cogneeRetrieval.used || cogneeRetrieval.error) {
          const supplemental = buildCogneeSupplement({
            memuSummaries: finalResults.map((r) => r.item.summary),
            cogneeHits: cogneeRetrieval.results,
            limit: 5,
          });
          response.cogneeRetrieval = {
            used: cogneeRetrieval.used,
            trigger: cogneeRetrieval.trigger,
            mode: cogneeRetrieval.mode,
            count: cogneeRetrieval.results.length,
            summaries: cogneeRetrieval.results.map((hit) => hit.summary),
            supplemental,
            error: cogneeRetrieval.error,
          };
        }

        if (effectiveEntityFilter) response.entityFilter = effectiveEntityFilter;
        if (inferredEntityFilter && !entityFilter) response.entityFilterInferred = true;
        if (effectiveEntityFilter) {
          response.entityFilterResolved = {
            matchTerms: entityFilterContext?.matchTerms ?? [],
            entities: (entityFilterContext?.resolvedEntities ?? []).map((entity) => entity.name),
          };
        }
        if (collectionFilters.length === 1) response.collection = collectionFilters[0];
        if (collectionFilters.length > 1) response.collections = collectionFilters;
        if (
          !explicitCollectionFilter &&
          collectionFilters.length > 0 &&
          resolvedIntent?.departmentId
        ) {
          response.collectionRouting = {
            auto: true,
            departmentId: resolvedIntent.departmentId,
          };
        }
        if (minSignificance) response.minSignificance = minSignificance;
        if (emotionalFilter) response.emotionalFilter = emotionalFilter;

        // Coverage metadata
        if (includeCoverage) {
          const stats = await memory.getStats();

          const typesReturned: Record<string, number> = {};
          for (const r of finalResults) {
            const t = r.item.memoryType as string;
            typesReturned[t] = (typesReturned[t] ?? 0) + 1;
          }

          const typesWithItems = Object.keys(stats.itemsByType).filter(
            (t) => stats.itemsByType[t] > 0,
          );
          const typesMissing = typesWithItems.filter((t) => !typesReturned[t]);
          const coverageScore =
            typesWithItems.length > 0
              ? Math.round((Object.keys(typesReturned).length / typesWithItems.length) * 100) / 100
              : 1;

          // Collect entities from results
          const entitiesMatched = new Set<string>();
          for (const r of finalResults) {
            try {
              const itemEntities = await memory.getItemEntities(r.item.id);
              for (const e of itemEntities) {
                entitiesMatched.add(e.name);
              }
            } catch {
              // Skip item entity coverage for this item if unavailable.
            }
          }

          response.coverage = {
            typesReturned,
            typesMissing,
            entitiesMatched: [...entitiesMatched],
            coverageScore,
            twoPassUsed,
            twoPassAttempted,
            ...(twoPassAttempted && {
              twoPassTypesSearched,
              twoPassReason,
            }),
          };
        }

        await appendMemoryRecallTelemetry({
          version: 1,
          ts: Date.now(),
          iso: new Date().toISOString(),
          status: "ok",
          tool: "memory_recall",
          toolCallId: _toolCallId,
          agentId: options.agentId,
          query,
          requestedMode,
          resolvedMode: mode,
          queryClass,
          deep,
          entityFilter: effectiveEntityFilter ?? undefined,
          collectionFilters,
          includeCoverage,
          minTypeCoverage: minTypeCoverage ?? undefined,
          resultCount: formatted.length,
          answer: answerCandidate
            ? {
                value: answerCandidate.value,
                strategy: answerCandidate.strategy,
                confidence: answerCandidate.confidence,
                sourceId: answerCandidate.sourceId,
                sourceType: answerCandidate.sourceType,
                sourceSummary: answerCandidate.sourceSummary,
              }
            : undefined,
          recallFallback:
            vectorFallbackUsed || vectorFallbackReason
              ? {
                  used: vectorFallbackUsed,
                  type: vectorFallbackUsed ? "vector" : undefined,
                  reason: vectorFallbackReason,
                  added: vectorFallbackAdded,
                }
              : undefined,
          coverage: includeCoverage
            ? {
                ...((response.coverage as Record<string, unknown> | undefined) ?? {}),
              }
            : undefined,
          recallTelemetry: {
            queryVariants,
            timelineWindow: timelineWindow
              ? {
                  granularity: timelineWindow.granularity,
                  label: timelineWindow.label,
                  isoDate: timelineWindow.isoDate,
                  endIsoDate: timelineWindow.endIsoDate,
                }
              : undefined,
            manualPropertyCandidates: manualPropertyCandidates.length,
            manualProjectCandidates: manualProjectCandidates.length,
            manualTimelineCandidates: manualTimelineCandidates.length,
            preRerankTop: preIntentRerankSnapshot,
            postRerankTop: postIntentRerankSnapshot,
            answerStrategy: answerCandidate?.strategy ?? null,
            answerSourceId: answerCandidate?.sourceId ?? null,
            vectorFallbackUsed,
            knowledgeFallbackUsed,
            knowledgeFallbackQueries,
            knowledgeFallbackCount,
          },
          topResults: returnedTopSnapshot,
          modeEscalationReason,
        }).catch(() => undefined);

        try {
          const toon = encodeForPrompt(response);
          return { content: [{ type: "text" as const, text: toon }], details: response };
        } catch {
          return jsonResult(response);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await appendMemoryRecallTelemetry({
          version: 1,
          ts: Date.now(),
          iso: new Date().toISOString(),
          status: "error",
          tool: "memory_recall",
          toolCallId: _toolCallId,
          agentId: options.agentId,
          query,
          requestedMode,
          resolvedMode: mode,
          queryClass,
          deep:
            explicitDeep ??
            (queryClass === "timeline_episodic" || queryClass === "decision_project"
              ? true
              : modeConfig.deep),
          entityFilter: effectiveEntityFilter ?? undefined,
          collectionFilters,
          includeCoverage,
          minTypeCoverage: minTypeCoverage ?? undefined,
          error: message,
        }).catch(() => undefined);
        return jsonResult({ results: [], error: message });
      }
    },
  };

  return tool;
}

export function createMemoryStoreTool(options: {
  config?: ArgentConfig;
  agentId?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }

  return {
    label: "Memory Store",
    name: "memory_store",
    description:
      "Store a fact, note, observation, or self-insight in long-term memory (MemU). " +
      "Use significance to mark how important this memory is (routine → noteworthy → important → core). " +
      "Add emotion to capture emotional context. Link entities (people, pets, places) for relational memory. " +
      "Use type='self' for self-observations and lessons learned. " +
      "Deduplicates: if an identical fact exists, it reinforces it instead of creating a duplicate.",
    parameters: MemoryStoreSchema,
    execute: async (_toolCallId, params) => {
      const fact = readStringParam(params, "fact", { required: true });
      const memoryType = readStringParam(params, "type", { required: true }) as MemoryType;
      const categoryNames = readStringArrayParam(params, "categories");
      const happenedAt = readStringParam(params, "happenedAt");
      const significance = readStringParam(params, "significance") as
        | "routine"
        | "noteworthy"
        | "important"
        | "core"
        | undefined;
      const emotion = params.emotion as { valence?: number; arousal?: number } | undefined;
      const reflection = readStringParam(params, "reflection");
      const lesson = readStringParam(params, "lesson");
      const visibility = readStringParam(params, "visibility") as
        | "private"
        | "team"
        | "family"
        | "public"
        | undefined;
      const entityNames = readStringArrayParam(params, "entities");
      const sanitizerPolicy = resolveMemoryWriteSanitizerPolicy(cfg);
      const reasonCodes = detectMemoryInjectionReasons(fact);

      if (reasonCodes.length > 0) {
        const action =
          sanitizerPolicy === "log_only" ? "allow" : sanitizerPolicy === "drop" ? "drop" : "alert";
        incrementSanitizerCounters({ reasons: reasonCodes, action });
        logMemoryWriteSanitizerAudit({
          tool: "memory_store",
          policy: sanitizerPolicy,
          action,
          reasonCodes,
          agentId: options.agentId,
        });
        if (sanitizerPolicy !== "log_only") {
          return jsonResult({
            action: "rejected",
            rejected: true,
            policy: sanitizerPolicy,
            reasonCodes,
            message: "Memory write rejected by sanitizer policy.",
          });
        }
      } else {
        incrementSanitizerCounters({ reasons: [], action: "allow" });
      }

      if (!MEMORY_TYPES.includes(memoryType)) {
        return jsonResult({
          error: `Invalid memory type: ${memoryType}`,
          validTypes: MEMORY_TYPES,
        });
      }

      try {
        const storage = await getStorageAdapter();
        const memory =
          options.agentId && storage.memory.withAgentId
            ? storage.memory.withAgentId(options.agentId)
            : storage.memory;

        // Check for duplicate by content hash
        const hash = contentHash(fact);
        const existing = await memory.findItemByHash(hash);
        if (existing) {
          await memory.reinforceItem(existing.id);
          return jsonResult({
            action: "reinforced",
            id: existing.id,
            summary: existing.summary,
            reinforcementCount: existing.reinforcementCount + 1,
            message: "Identical fact already exists — reinforced instead of duplicating.",
          });
        }

        const semanticDuplicate =
          memoryType === "profile" ? await findOperationalProfileDuplicate(memory, fact) : null;
        if (semanticDuplicate) {
          await memory.reinforceItem(semanticDuplicate.id);
          return jsonResult({
            action: "reinforced",
            id: semanticDuplicate.id,
            summary: semanticDuplicate.summary,
            reinforcementCount: semanticDuplicate.reinforcementCount + 1,
            dedupeMode: "operational-profile",
            message:
              "Near-duplicate operational profile snapshot detected — reinforced canonical memory.",
          });
        }

        // Create new item with identity fields
        const item = await memory.createItem({
          memoryType,
          summary: fact,
          happenedAt: happenedAt ?? undefined,
          significance: significance ?? undefined,
          emotionalValence: emotion?.valence,
          emotionalArousal: emotion?.arousal,
          reflection: reflection ?? undefined,
          lesson: lesson ?? undefined,
          agentId: options.agentId,
          visibility,
        });

        // Embed it
        let embedded = false;
        try {
          const embedder = await getMemuEmbedder(cfg);
          const vec = await embedder.embed(fact);
          await memory.updateItemEmbedding(item.id, vec);
          embedded = true;
        } catch {
          // Non-fatal: item still stored without embedding
        }

        // Assign to categories
        const assignedCategories: string[] = [];
        if (categoryNames) {
          for (const name of categoryNames) {
            const cat = await memory.getOrCreateCategory(name);
            await memory.linkItemToCategory(item.id, cat.id);
            assignedCategories.push(cat.name);
          }
        }

        // Link entities
        const linkedEntities: string[] = [];
        if (entityNames) {
          for (const name of entityNames) {
            const entity = await memory.getOrCreateEntity(name);
            await memory.linkItemToEntity(item.id, entity.id, "mentioned");
            linkedEntities.push(entity.name);
          }
        }

        return jsonResult({
          action: "created",
          id: item.id,
          type: item.memoryType,
          summary: item.summary,
          significance: item.significance,
          emotion: {
            valence: item.emotionalValence,
            arousal: item.emotionalArousal,
          },
          embedded,
          categories: assignedCategories,
          entities: linkedEntities,
          ...(reasonCodes.length > 0 && {
            sanitizer: {
              policy: sanitizerPolicy,
              action: "allowed_with_audit",
              reasonCodes,
            },
          }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: message });
      }
    },
  };
}

export function createMemoryCategoriesTool(options: {
  config?: ArgentConfig;
  agentId?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }

  return {
    label: "Memory Categories",
    name: "memory_categories",
    description:
      "List memory categories with item counts. " +
      "Categories are auto-organized topics that group related facts. " +
      "Optionally filter by keyword.",
    parameters: MemoryCategoriesSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = normalizeToolParams(rawParams);
      const query = readStringParam(params, "query");
      const pattern = readStringParam(params, "pattern");
      const minItems = readNumberParam(params, "minItems", { integer: true });
      const maxItems = readNumberParam(params, "maxItems", { integer: true });
      const sort = readMemoryCategorySort(readStringParam(params, "sort"));
      const sortDirection = readSortDirection(readStringParam(params, "sortDirection"));
      const limit = readNumberParam(params, "limit", { integer: true }) ?? 20;

      try {
        const storage = await getStorageAdapter();
        const memory =
          options.agentId && storage.memory.withAgentId
            ? storage.memory.withAgentId(options.agentId)
            : storage.memory;

        const results = await listMemoryCategoriesWithCounts(memory, {
          query,
          pattern,
          minItems,
          maxItems,
          sort,
          sortDirection,
          limit,
        });

        const stats = await memory.getStats();

        return jsonResult({
          categories: results,
          count: results.length,
          totalItems: stats.items,
          totalCategories: stats.categories,
          itemsByType: stats.itemsByType,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ categories: [], error: message });
      }
    },
  };
}

export function createMemoryCategoryMergeTool(options: {
  config?: ArgentConfig;
  agentId?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }

  return {
    label: "Memory Category Merge",
    name: "memory_category_merge",
    description:
      "Merge one or more source memory categories into a target category. " +
      "All linked memory items are relinked to the target, then source categories are deleted.",
    parameters: MemoryCategoryMergeSchema,
    execute: async (_toolCallId, params) => {
      const sourceCategoryIds = readStringArrayParam(params, "sourceCategoryIds", {
        required: true,
      });
      const targetCategoryId = readStringParam(params, "targetCategoryId", { required: true });

      try {
        const storage = await getStorageAdapter();
        const memory =
          options.agentId && storage.memory.withAgentId
            ? storage.memory.withAgentId(options.agentId)
            : storage.memory;
        const result = await mergeMemoryCategories({
          memory,
          sourceCategoryIds,
          targetCategoryId,
        });
        return jsonResult({ action: "merged", ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: message });
      }
    },
  };
}

export function createMemoryCategoryRenameTool(options: {
  config?: ArgentConfig;
  agentId?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }

  return {
    label: "Memory Category Rename",
    name: "memory_category_rename",
    description: "Rename a memory category display name without changing linked memory items.",
    parameters: MemoryCategoryRenameSchema,
    execute: async (_toolCallId, params) => {
      const categoryId = readStringParam(params, "categoryId", { required: true });
      const newName = readStringParam(params, "newName", { required: true });

      try {
        const storage = await getStorageAdapter();
        const memory =
          options.agentId && storage.memory.withAgentId
            ? storage.memory.withAgentId(options.agentId)
            : storage.memory;
        const category = await renameMemoryCategory({ memory, categoryId, newName });
        return jsonResult({ action: "renamed", category });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: message });
      }
    },
  };
}

export function createMemoryCategoryCleanupTool(options: {
  config?: ArgentConfig;
  agentId?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }

  return {
    label: "Memory Category Cleanup",
    name: "memory_category_cleanup",
    description:
      "Preview or apply category cleanup: delete empty category shells and merge conservative duplicate/sprawl category names. Dry-run defaults to true.",
    parameters: MemoryCategoryCleanupSchema,
    execute: async (_toolCallId, params) => {
      const dryRun = readBooleanParam(params, "dryRun") ?? true;
      const deleteEmpty = readBooleanParam(params, "deleteEmpty") ?? true;
      const mergeSimilar = readBooleanParam(params, "mergeSimilar") ?? true;
      const similarityThreshold = readNumberParam(params, "similarityThreshold");
      const maxMergeSourceItems = readNumberParam(params, "maxMergeSourceItems", {
        integer: true,
      });

      try {
        const storage = await getStorageAdapter();
        const memory =
          options.agentId && storage.memory.withAgentId
            ? storage.memory.withAgentId(options.agentId)
            : storage.memory;
        const plan = await planMemoryCategoryCleanup(memory, {
          dryRun,
          deleteEmpty,
          mergeSimilar,
          similarityThreshold,
          maxMergeSourceItems,
        });
        return jsonResult({
          action: dryRun ? "preview" : "cleaned",
          ...plan,
          emptyCategoryCount: plan.emptyCategories.length,
          mergeCount: plan.merges.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: message });
      }
    },
  };
}

export function createMemoryForgetTool(options: {
  config?: ArgentConfig;
  agentId?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;

  return {
    label: "Memory Forget",
    name: "memory_forget",
    description:
      "Remove a specific memory item from long-term memory. " +
      "Provide either the item ID or the exact fact text. " +
      "This permanently deletes the memory item and its category links.",
    parameters: MemoryForgetSchema,
    execute: async (_toolCallId, params) => {
      const id = readStringParam(params, "id");
      const fact = readStringParam(params, "fact");

      if (!id && !fact) {
        return jsonResult({
          error: "Provide either 'id' or 'fact' to identify the memory to forget.",
        });
      }

      try {
        const storage = await getStorageAdapter();
        const memory =
          options.agentId && storage.memory.withAgentId
            ? storage.memory.withAgentId(options.agentId)
            : storage.memory;

        let targetId: string | undefined;
        let targetSummary: string | undefined;

        if (id) {
          const item = await memory.getItem(id);
          if (!item) {
            return jsonResult({ error: `No memory item found with ID: ${id}` });
          }
          targetId = item.id;
          targetSummary = item.summary;
        } else if (fact) {
          const hash = contentHash(fact);
          const item = await memory.findItemByHash(hash);
          if (!item) {
            return jsonResult({
              error: "No memory item found matching that exact fact text.",
              hint: "Try memory_recall to search for similar items first.",
            });
          }
          targetId = item.id;
          targetSummary = item.summary;
        }

        if (!targetId) {
          return jsonResult({ error: "Could not resolve target memory item." });
        }

        // Remove category links first, then the item
        const categories = await memory.getItemCategories(targetId);
        for (const cat of categories) {
          await memory.unlinkItemFromCategory(targetId, cat.id);
        }

        const deleted = await memory.deleteItem(targetId);

        return jsonResult({
          action: deleted ? "deleted" : "not_found",
          id: targetId,
          summary: targetSummary,
          unlinkedCategories: categories.map((c) => c.name),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: message });
      }
    },
  };
}

// ── Entity Tool ──

const MemoryEntitySchema = Type.Object({
  action: Type.Union(
    [Type.Literal("get"), Type.Literal("list"), Type.Literal("create"), Type.Literal("update")],
    { description: "Action: get (by name), list (all), create (new), update (existing)" },
  ),
  name: Type.Optional(Type.String({ description: "Entity name (required for get/create/update)" })),
  entity_type: Type.Optional(
    Type.Union(
      [
        Type.Literal("person"),
        Type.Literal("pet"),
        Type.Literal("place"),
        Type.Literal("organization"),
        Type.Literal("project"),
      ],
      { description: "Entity type classification" },
    ),
  ),
  relationship: Type.Optional(
    Type.String({ description: 'Relationship to you, e.g. "owner", "business partner"' }),
  ),
  bond_strength: Type.Optional(
    Type.Number({ description: "Bond strength: 0.0 (distant) to 1.0 (deeply bonded)" }),
  ),
  emotional_texture: Type.Optional(
    Type.String({
      description: 'Emotional quality of the relationship, e.g. "deep love + ongoing worry"',
    }),
  ),
  min_bond: Type.Optional(
    Type.Number({ description: "Filter list to entities with bond_strength >= this value" }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Max results for list action (default 20)", default: 20 }),
  ),
});

export function createMemoryEntityTool(options: {
  config?: ArgentConfig;
  agentId?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;

  return {
    label: "Memory Entity",
    name: "memory_entity",
    description:
      "Manage entities (people, pets, places, organizations, projects) in your relational memory. " +
      "Use 'get' to look up an entity by name and see their profile + linked memories. " +
      "Use 'list' to see all known entities sorted by bond strength. " +
      "Use 'create' to register a new entity. Use 'update' to modify an existing entity.",
    parameters: MemoryEntitySchema,
    execute: async (_toolCallId, rawParams) => {
      const params = normalizeToolParams(rawParams);
      let action: string;
      try {
        action = readStringParam(params, "action", { required: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: message });
      }
      const name = readStringParam(params, "name");

      try {
        const storage = await getStorageAdapter();
        const memory =
          options.agentId && storage.memory.withAgentId
            ? storage.memory.withAgentId(options.agentId)
            : storage.memory;

        switch (action) {
          case "get": {
            if (!name) return jsonResult({ error: "name is required for 'get' action" });
            const entity = await memory.findEntityByName(name);
            if (!entity)
              return jsonResult({
                found: false,
                name,
                message: `No entity found with name "${name}"`,
              });

            const memories = await memory.getEntityItems(entity.id, 10);
            return jsonResult({
              found: true,
              entity: {
                id: entity.id,
                name: entity.name,
                type: entity.entityType,
                relationship: entity.relationship,
                bondStrength: entity.bondStrength,
                emotionalTexture: entity.emotionalTexture,
                profile: entity.profileSummary,
                memoryCount: entity.memoryCount,
                firstMentioned: entity.firstMentionedAt,
                lastMentioned: entity.lastMentionedAt,
              },
              recentMemories: memories.map((m) => ({
                id: m.id,
                type: m.memoryType,
                summary: m.summary,
                significance: m.significance,
              })),
            });
          }

          case "list": {
            const entityType = readStringParam(params, "entity_type") as
              | "person"
              | "pet"
              | "place"
              | "organization"
              | "project"
              | undefined;
            const minBond = readNumberParam(params, "min_bond");
            const limit = readNumberParam(params, "limit", { integer: true }) ?? 20;

            const entities = await memory.listEntities({
              entityType,
              minBondStrength: minBond ?? undefined,
              limit,
            });

            return jsonResult({
              entities: entities.map((e) => ({
                name: e.name,
                type: e.entityType,
                relationship: e.relationship,
                bondStrength: Math.round(e.bondStrength * 100) / 100,
                memoryCount: e.memoryCount,
                profile: e.profileSummary,
              })),
              count: entities.length,
            });
          }

          case "create": {
            if (!name) return jsonResult({ error: "name is required for 'create' action" });

            const existing = await memory.findEntityByName(name);
            if (existing) {
              return jsonResult({
                action: "already_exists",
                entity: {
                  name: existing.name,
                  type: existing.entityType,
                  relationship: existing.relationship,
                  bondStrength: existing.bondStrength,
                },
                message: `Entity "${name}" already exists. Use action='update' to modify it.`,
              });
            }

            const entityType = readStringParam(params, "entity_type") as
              | "person"
              | "pet"
              | "place"
              | "organization"
              | "project"
              | undefined;
            const relationship = readStringParam(params, "relationship");
            const bondStrength = readNumberParam(params, "bond_strength");
            const emotionalTexture = readStringParam(params, "emotional_texture");

            const entity = await memory.createEntity({
              name,
              entityType: entityType ?? "person",
              relationship: relationship ?? undefined,
              bondStrength: bondStrength ?? 0.5,
              emotionalTexture: emotionalTexture ?? undefined,
              agentId: options.agentId,
            });

            return jsonResult({
              action: "created",
              entity: {
                id: entity.id,
                name: entity.name,
                type: entity.entityType,
                relationship: entity.relationship,
                bondStrength: entity.bondStrength,
              },
            });
          }

          case "update": {
            if (!name) return jsonResult({ error: "name is required for 'update' action" });

            const entity = await memory.findEntityByName(name);
            if (!entity) return jsonResult({ error: `No entity found with name "${name}"` });

            const updates: Record<string, unknown> = {};
            const relationship = readStringParam(params, "relationship");
            const bondStrength = readNumberParam(params, "bond_strength");
            const emotionalTexture = readStringParam(params, "emotional_texture");
            const entityType = readStringParam(params, "entity_type");

            if (relationship !== undefined) updates.relationship = relationship;
            if (bondStrength !== undefined) updates.bondStrength = bondStrength;
            if (emotionalTexture !== undefined) updates.emotionalTexture = emotionalTexture;
            if (entityType !== undefined) updates.entityType = entityType;

            if (Object.keys(updates).length === 0) {
              return jsonResult({ error: "No update fields provided" });
            }

            const updated = await memory.updateEntity(entity.id, updates as any);
            if (!updated) {
              return jsonResult({ error: `Failed to update entity "${name}"` });
            }
            return jsonResult({
              action: "updated",
              entity: {
                name: updated.name,
                type: updated.entityType,
                relationship: updated.relationship,
                bondStrength: updated.bondStrength,
                emotionalTexture: updated.emotionalTexture,
              },
            });
          }

          default:
            return jsonResult({
              error: `Unknown action: ${action}. Use get, list, create, or update.`,
            });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: message });
      }
    },
  };
}

// ── Reflect Tool ──

const MemoryReflectSchema = Type.Object({
  content: Type.String({
    description: "The reflection narrative — what happened, what you noticed",
  }),
  lessons: Type.Optional(Type.Array(Type.String(), { description: "Specific lessons learned" })),
  self_insights: Type.Optional(
    Type.Array(Type.String(), {
      description: "Insights about yourself — patterns, growth, realizations",
    }),
  ),
  entities: Type.Optional(
    Type.Array(Type.String(), {
      description: "Names of people/entities involved in this reflection",
    }),
  ),
  mood: Type.Optional(
    Type.String({ description: "Overall emotional tone of the reflection (one word)" }),
  ),
});

export function createMemoryReflectTool(options: {
  config?: ArgentConfig;
  agentId?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;

  return {
    label: "Memory Reflect",
    name: "memory_reflect",
    description:
      "Record a structured reflection about recent experience. " +
      "Reflections capture what happened, what you learned, and what you noticed about yourself. " +
      "Lessons and self-insights are automatically stored as 'self' type memories. " +
      "Use after significant interactions, when you notice patterns, or during reflection time.",
    parameters: MemoryReflectSchema,
    execute: async (_toolCallId, params) => {
      const content = readStringParam(params, "content", { required: true });
      const lessons = readStringArrayParam(params, "lessons") ?? [];
      const selfInsights = readStringArrayParam(params, "self_insights") ?? [];
      const entityNames = readStringArrayParam(params, "entities") ?? [];
      const mood = readStringParam(params, "mood");
      const sanitizerPolicy = resolveMemoryWriteSanitizerPolicy(cfg);
      const contentReasonCodes = detectMemoryInjectionReasons(content);
      const reflectAction =
        contentReasonCodes.length === 0
          ? "allow"
          : sanitizerPolicy === "log_only"
            ? "allow"
            : sanitizerPolicy === "drop"
              ? "drop"
              : "alert";
      incrementSanitizerCounters({ reasons: contentReasonCodes, action: reflectAction });
      if (contentReasonCodes.length > 0) {
        logMemoryWriteSanitizerAudit({
          tool: "memory_reflect",
          policy: sanitizerPolicy,
          action: reflectAction,
          reasonCodes: contentReasonCodes,
          agentId: options.agentId,
        });
        if (sanitizerPolicy !== "log_only") {
          return jsonResult({
            action: "rejected",
            rejected: true,
            policy: sanitizerPolicy,
            reasonCodes: contentReasonCodes,
            message: "Reflection rejected by sanitizer policy.",
          });
        }
      }

      const filteredLessons: string[] = [];
      const filteredInsights: string[] = [];
      const droppedLessonReasons = new Set<MemorySanitizerReasonCode>();
      const droppedInsightReasons = new Set<MemorySanitizerReasonCode>();
      let droppedLessons = 0;
      let droppedInsights = 0;

      for (const lesson of lessons) {
        const reasons = detectMemoryInjectionReasons(lesson);
        if (reasons.length === 0 || sanitizerPolicy === "log_only") {
          filteredLessons.push(lesson);
          if (reasons.length > 0) {
            incrementSanitizerCounters({ reasons, action: "allow" });
            logMemoryWriteSanitizerAudit({
              tool: "memory_reflect",
              policy: sanitizerPolicy,
              action: "allow",
              reasonCodes: reasons,
              agentId: options.agentId,
            });
          }
          continue;
        }
        droppedLessons += 1;
        reasons.forEach((reason) => droppedLessonReasons.add(reason));
        const action = sanitizerPolicy === "drop" ? "drop" : "alert";
        incrementSanitizerCounters({ reasons, action });
        logMemoryWriteSanitizerAudit({
          tool: "memory_reflect",
          policy: sanitizerPolicy,
          action,
          reasonCodes: reasons,
          agentId: options.agentId,
        });
      }

      for (const insight of selfInsights) {
        const reasons = detectMemoryInjectionReasons(insight);
        if (reasons.length === 0 || sanitizerPolicy === "log_only") {
          filteredInsights.push(insight);
          if (reasons.length > 0) {
            incrementSanitizerCounters({ reasons, action: "allow" });
            logMemoryWriteSanitizerAudit({
              tool: "memory_reflect",
              policy: sanitizerPolicy,
              action: "allow",
              reasonCodes: reasons,
              agentId: options.agentId,
            });
          }
          continue;
        }
        droppedInsights += 1;
        reasons.forEach((reason) => droppedInsightReasons.add(reason));
        const action = sanitizerPolicy === "drop" ? "drop" : "alert";
        incrementSanitizerCounters({ reasons, action });
        logMemoryWriteSanitizerAudit({
          tool: "memory_reflect",
          policy: sanitizerPolicy,
          action,
          reasonCodes: reasons,
          agentId: options.agentId,
        });
      }

      try {
        const storage = await getStorageAdapter();
        const memory =
          options.agentId && storage.memory.withAgentId
            ? storage.memory.withAgentId(options.agentId)
            : storage.memory;

        // Create the reflection record
        const reflection = await memory.createReflection({
          triggerType: "manual",
          content,
          lessonsExtracted: filteredLessons,
          entitiesInvolved: entityNames,
          selfInsights: filteredInsights,
          mood: mood ?? undefined,
          agentId: options.agentId,
        });

        // Auto-create self-type memories from lessons
        let selfMemoriesCreated = 0;
        for (const lesson of filteredLessons) {
          if (!lesson.trim()) continue;
          await memory.createItem({
            memoryType: "self",
            summary: lesson,
            significance: "noteworthy",
            lesson,
            agentId: options.agentId,
          });
          selfMemoriesCreated++;
        }

        // Auto-create self-type memories from insights
        for (const insight of filteredInsights) {
          if (!insight.trim()) continue;
          await memory.createItem({
            memoryType: "self",
            summary: insight,
            significance: "noteworthy",
            reflection: `From reflection: ${content.slice(0, 100)}`,
            agentId: options.agentId,
          });
          selfMemoriesCreated++;
        }

        // Link entities
        const linkedEntities: string[] = [];
        for (const name of entityNames) {
          const entity = await memory.getOrCreateEntity(name);
          linkedEntities.push(entity.name);
        }

        return jsonResult({
          action: "reflected",
          reflectionId: reflection.id,
          content: reflection.content,
          mood: reflection.mood,
          lessonsCount: filteredLessons.length,
          selfInsightsCount: filteredInsights.length,
          selfMemoriesCreated,
          entitiesLinked: linkedEntities,
          ...(droppedLessons > 0 || droppedInsights > 0
            ? {
                sanitizer: {
                  policy: sanitizerPolicy,
                  droppedLessons,
                  droppedInsights,
                  reasonCodes: [...new Set([...droppedLessonReasons, ...droppedInsightReasons])],
                },
              }
            : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: message });
      }
    },
  };
}

// ── Helpers ──

/** Convert UTC ISO timestamp to user's local time string */
function toLocalTime(utcIso: string | null, tz: string): string | null {
  if (!utcIso) return null;
  try {
    const d = new Date(utcIso);
    if (isNaN(d.getTime())) return utcIso;
    return d.toLocaleString("en-US", {
      timeZone: tz,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return utcIso;
  }
}

function extractCitation(summary: string, fallback?: unknown): string | null {
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  const match = /^\s*\[\[citation:([^\]]+)\]\]/i.exec(summary);
  if (!match) return null;
  return match[1]?.trim() || null;
}

function stripCitation(summary: string): string {
  return summary.replace(/^\s*\[\[citation:[^\]]+\]\]\s*/i, "").trim();
}

function formatResult(
  r: {
    item: {
      id: string;
      memoryType: string;
      summary: string;
      reinforcementCount: number;
      createdAt: string;
      happenedAt: string | null;
      significance?: string;
      emotionalValence?: number;
      emotionalArousal?: number;
      reflection?: string | null;
      lesson?: string | null;
      extra?: Record<string, unknown>;
    };
    score: number;
    categories: string[];
  },
  tz: string,
) {
  const summary = stripCitation(r.item.summary);
  const base: Record<string, unknown> = {
    id: r.item.id,
    type: r.item.memoryType,
    summary,
    score: Math.round(r.score * 1000) / 1000,
    reinforced: r.item.reinforcementCount,
    significance: r.item.significance ?? "routine",
    categories: r.categories,
    created: toLocalTime(r.item.createdAt, tz),
    happenedAt: toLocalTime(r.item.happenedAt, tz),
  };

  if (r.item.extra && typeof r.item.extra === "object") {
    const extra = r.item.extra as Record<string, unknown>;
    const citation = extractCitation(r.item.summary, extra.citation);
    if (citation) base.citation = citation;
    if (typeof extra.collection === "string" && extra.collection.trim()) {
      base.collection = extra.collection;
    }
    if (typeof extra.sourceFile === "string" && extra.sourceFile.trim()) {
      base.sourceFile = extra.sourceFile;
    }
    if (typeof extra.chunkIndex === "number") {
      base.chunkIndex = extra.chunkIndex;
    }
    if (typeof extra.chunkTotal === "number") {
      base.chunkTotal = extra.chunkTotal;
    }
  }

  // Include emotional context if non-zero
  if (r.item.emotionalValence || r.item.emotionalArousal) {
    base.emotion = {
      valence: r.item.emotionalValence ?? 0,
      arousal: r.item.emotionalArousal ?? 0,
    };
  }

  if (r.item.reflection) base.reflection = r.item.reflection;
  if (r.item.lesson) base.lesson = r.item.lesson;

  return base;
}
