import type { MemoryAdapter } from "../../data/adapter.js";
import type {
  CreateKnowledgeObservationEvidenceInput,
  CreateKnowledgeObservationInput,
  Entity,
  KnowledgeObservation,
  KnowledgeObservationConsolidationResult,
  KnowledgeObservationEvidenceStance,
  KnowledgeObservationKind,
  Lesson,
  MemoryItem,
} from "../memu-types.js";
import {
  buildKnowledgeObservationCanonicalKey,
  type KnowledgeObservationSlot,
  normalizeObservationKeySegment,
} from "./canonical-key.js";
import { computeKnowledgeObservationConfidence } from "./confidence.js";
import {
  computeKnowledgeObservationFreshness,
  isKnowledgeObservationRevalidationDue,
} from "./revalidation.js";

type ObservationCandidate = {
  kind: "operator_preference" | "project_state" | "relationship_fact" | "tooling_state";
  subjectType: "entity" | "project" | "tool";
  subjectId: string;
  slot: KnowledgeObservationSlot;
  summary: string;
  detail: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  evidence: CreateKnowledgeObservationEvidenceInput;
  signature: string;
  sourceCreatedAt: string | null;
};

const GENERIC_PROJECT_COLLECTIONS = new Set(["docpane", "projects"]);

const RELATIONSHIP_SIGNATURE_PATTERNS: ReadonlyArray<{ regex: RegExp; token: string }> = [
  { regex: /\bbusiness partner\b/i, token: "business-partner" },
  { regex: /\bco-?founder\b/i, token: "co-founder" },
  { regex: /\bpartner\b/i, token: "partner" },
  { regex: /\bmother\b|\bmom\b/i, token: "mother" },
  { regex: /\bfather\b|\bdad\b/i, token: "father" },
  { regex: /\bwife\b/i, token: "wife" },
  { regex: /\bhusband\b/i, token: "husband" },
  { regex: /\bfriend\b/i, token: "friend" },
  { regex: /\bcolleague\b/i, token: "colleague" },
  { regex: /\bbrother\b/i, token: "brother" },
  { regex: /\bsister\b/i, token: "sister" },
  { regex: /\bdog\b|\bpet\b/i, token: "pet" },
  { regex: /\bowner\b/i, token: "owner" },
];

const PROJECT_STATE_SLOT_PATTERNS: ReadonlyArray<{
  regex: RegExp;
  slot: Extract<KnowledgeObservationSlot, "status" | "risk">;
  signature: string;
}> = [
  {
    regex: /\b(blocked|stuck|waiting on|at risk|dependency|delayed|needs approval)\b/i,
    slot: "risk",
    signature: "blocked",
  },
  {
    regex: /\b(went live|is live|launched|deployed|auto-deploys?)\b/i,
    slot: "status",
    signature: "live",
  },
  {
    regex: /\b(granted .* permission|approved|allowed to|go ahead)\b/i,
    slot: "status",
    signature: "approved",
  },
  {
    regex: /\b(prd draft|prp planning draft|prp|prd|planning draft|planned|planning|draft)\b/i,
    slot: "status",
    signature: "planning",
  },
  {
    regex: /\b(working on|building|implementing|developing|foundation)\b/i,
    slot: "status",
    signature: "active",
  },
];

const REVALIDATION_SWEEP_KINDS = ["project_state", "relationship_fact"] as const;

function normalizeSignature(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferPreferenceSlot(summary: string): KnowledgeObservationSlot | null {
  const lowered = summary.toLowerCase();
  if (/(discord|telegram|voice|speak|aloud|email|text|sms|message)/.test(lowered)) {
    return "delivery_preference";
  }
  if (
    /(approval|approve|confirm|sign.?off|review|maintenance window|human in the loop)/.test(lowered)
  ) {
    return "decision_preference";
  }
  if (/(brief|concise|direct|detailed|short|long-form|bullet)/.test(lowered)) {
    return "response_style";
  }
  return null;
}

function inferToolingSlot(text: string): KnowledgeObservationSlot {
  const lowered = text.toLowerCase();
  if (
    /(prefer|works best|best path|use .* instead|workaround|fallback|retry with|should use)/.test(
      lowered,
    )
  ) {
    return "best_path";
  }
  if (
    /(verify|verification|check|assert|confirm|before running|after running|smoke test)/.test(
      lowered,
    )
  ) {
    return "verification_pattern";
  }
  if (/(risk|fragile|unstable|unreliable)/.test(lowered)) {
    return "risk";
  }
  if (/(status|available|enabled|disabled|healthy|offline|online|unavailable)/.test(lowered)) {
    return "status";
  }
  return "failure_mode";
}

function buildRelationshipSignature(...values: Array<string | null | undefined>): string | null {
  const joined = values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  if (!joined) {
    return null;
  }
  const tokens = RELATIONSHIP_SIGNATURE_PATTERNS.filter(({ regex }) => regex.test(joined)).map(
    ({ token }) => token,
  );
  if (tokens.length > 0) {
    return [...new Set(tokens)].toSorted().join(" ");
  }
  return normalizeSignature(joined);
}

function hasRelationshipCue(text: string): boolean {
  return RELATIONSHIP_SIGNATURE_PATTERNS.some(({ regex }) => regex.test(text));
}

function inferProjectStateSignal(text: string): {
  slot: Extract<KnowledgeObservationSlot, "status" | "risk">;
  signature: string;
} | null {
  for (const pattern of PROJECT_STATE_SLOT_PATTERNS) {
    if (pattern.regex.test(text)) {
      return {
        slot: pattern.slot,
        signature: pattern.signature,
      };
    }
  }
  return null;
}

function readItemExtraString(item: MemoryItem, key: string): string | null {
  const value = item.extra[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractProjectSubjectFromSummary(summary: string): string | null {
  const patterns = [
    /^\s*#?\s*(?:PRD|PRP)\s*:\s*(.+?)(?:\s+[—-]\s+.+)?$/i,
    /^\s*Project:\s*(.+?)(?:\s+[—-]\s+.+)?$/i,
    /^\s*([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,6}\s+(?:website|site|platform|dashboard|app|portfolio(?:\s+website|\s+site)?))\b/i,
    /^\s*([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,5})\s+project\b/i,
  ];
  for (const pattern of patterns) {
    const match = summary.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function weightForItem(item: MemoryItem): number {
  switch (item.significance) {
    case "core":
      return 2.5;
    case "important":
      return 2;
    case "noteworthy":
      return 1.5;
    default:
      return 1;
  }
}

function pickToolName(lesson: Lesson): string | null {
  const firstRelated = lesson.relatedTools.find((entry) => entry.trim().length > 0);
  if (firstRelated) {
    return normalizeObservationKeySegment(firstRelated);
  }
  const joined = `${lesson.context} ${lesson.action} ${lesson.outcome} ${lesson.lesson}`.trim();
  const match = joined.match(/\b([a-z][a-z0-9_-]{1,40})\b/i);
  return match ? normalizeObservationKeySegment(match[1]) : null;
}

async function buildOperatorPreferenceCandidates(
  memory: MemoryAdapter,
  items: MemoryItem[],
): Promise<ObservationCandidate[]> {
  const candidates: ObservationCandidate[] = [];
  for (const item of items) {
    const summary = String(item.summary ?? "").trim();
    if (!summary) {
      continue;
    }
    if (
      !/\b(prefer|prefers|likes|loves|wants|needs|does not want|doesn't want|avoid)\b/i.test(
        summary,
      )
    ) {
      continue;
    }
    const slot = inferPreferenceSlot(summary);
    if (!slot) {
      continue;
    }
    const entities = await memory.getItemEntities(item.id);
    if (entities.length !== 1) {
      continue;
    }
    const [entity] = entities;
    if (!entity) {
      continue;
    }
    const subjectId = normalizeObservationKeySegment(entity.id);
    if (!subjectId) {
      continue;
    }

    candidates.push({
      kind: "operator_preference",
      subjectType: "entity",
      subjectId,
      slot,
      summary,
      detail: item.reflection ?? item.lesson ?? null,
      tags: [slot],
      metadata: {
        sourceMemoryType: item.memoryType,
      },
      evidence: {
        stance: "support",
        weight: 1,
        excerpt: summary,
        itemId: item.id,
        sourceCreatedAt: item.happenedAt ?? item.createdAt,
      },
      signature: normalizeSignature(summary),
      sourceCreatedAt: item.happenedAt ?? item.createdAt,
    });
  }
  return candidates;
}

async function buildRelationshipCandidates(
  memory: MemoryAdapter,
  items: MemoryItem[],
  entities: Entity[],
): Promise<ObservationCandidate[]> {
  const candidates: ObservationCandidate[] = [];

  for (const entity of entities) {
    const summary =
      (entity.relationship?.trim() ? `${entity.name} is ${entity.relationship}` : "") ||
      entity.profileSummary?.trim() ||
      "";
    const signature = buildRelationshipSignature(
      entity.relationship,
      entity.profileSummary,
      summary,
    );
    if (!summary || !signature) {
      continue;
    }

    candidates.push({
      kind: "relationship_fact",
      subjectType: "entity",
      subjectId: normalizeObservationKeySegment(entity.id),
      slot: "relationship",
      summary,
      detail: entity.emotionalTexture ?? null,
      tags: [
        "relationship",
        ...signature.split(" ").map((token) => normalizeObservationKeySegment(token)),
      ],
      metadata: {
        entityType: entity.entityType,
        relationship: entity.relationship,
        source: "entity",
      },
      evidence: {
        stance: "support",
        weight: Math.max(1, Math.min(3, entity.bondStrength * 3)),
        excerpt: entity.profileSummary ?? entity.relationship ?? summary,
        entityId: entity.id,
        sourceCreatedAt: entity.updatedAt,
      },
      signature,
      sourceCreatedAt: entity.updatedAt,
    });
  }

  for (const item of items) {
    const summary = String(item.summary ?? "").trim();
    if (
      !summary ||
      !hasRelationshipCue(summary) ||
      !["profile", "knowledge", "event"].includes(item.memoryType)
    ) {
      continue;
    }
    const linkedEntities = await memory.getItemEntities(item.id);
    if (linkedEntities.length !== 1) {
      continue;
    }
    const [entity] = linkedEntities;
    if (!entity) {
      continue;
    }
    const signature = buildRelationshipSignature(summary, entity.relationship);
    if (!signature) {
      continue;
    }

    candidates.push({
      kind: "relationship_fact",
      subjectType: "entity",
      subjectId: normalizeObservationKeySegment(entity.id),
      slot: "relationship",
      summary,
      detail: item.reflection ?? item.lesson ?? entity.profileSummary ?? null,
      tags: [
        "relationship",
        ...signature.split(" ").map((token) => normalizeObservationKeySegment(token)),
      ],
      metadata: {
        sourceMemoryType: item.memoryType,
        entityType: entity.entityType,
        source: "item",
      },
      evidence: {
        stance: "support",
        weight: weightForItem(item),
        excerpt: summary,
        itemId: item.id,
        sourceCreatedAt: item.happenedAt ?? item.createdAt,
      },
      signature,
      sourceCreatedAt: item.happenedAt ?? item.createdAt,
    });
  }

  return candidates;
}

async function resolveProjectSubjectId(
  memory: MemoryAdapter,
  item: MemoryItem,
): Promise<string | null> {
  const linkedEntities = await memory.getItemEntities(item.id);
  const projectEntity = linkedEntities.find((entity) => entity.entityType === "project");
  if (projectEntity) {
    return normalizeObservationKeySegment(projectEntity.name);
  }

  const collection = readItemExtraString(item, "collection");
  if (collection && !GENERIC_PROJECT_COLLECTIONS.has(collection.toLowerCase())) {
    return normalizeObservationKeySegment(collection);
  }

  const extracted = extractProjectSubjectFromSummary(String(item.summary ?? ""));
  return extracted ? normalizeObservationKeySegment(extracted) : null;
}

async function buildProjectStateCandidates(
  memory: MemoryAdapter,
  items: MemoryItem[],
): Promise<ObservationCandidate[]> {
  const candidates: ObservationCandidate[] = [];
  for (const item of items) {
    const summary = String(item.summary ?? "").trim();
    if (!summary || !["knowledge", "event", "episode"].includes(item.memoryType)) {
      continue;
    }
    const signal = inferProjectStateSignal(summary);
    if (!signal) {
      continue;
    }
    const subjectId = await resolveProjectSubjectId(memory, item);
    if (!subjectId) {
      continue;
    }

    candidates.push({
      kind: "project_state",
      subjectType: "project",
      subjectId,
      slot: signal.slot,
      summary,
      detail: item.reflection ?? item.lesson ?? readItemExtraString(item, "collection"),
      tags: [subjectId, signal.slot, signal.signature],
      metadata: {
        sourceMemoryType: item.memoryType,
        projectState: signal.signature,
        collection: readItemExtraString(item, "collection"),
      },
      evidence: {
        stance: "support",
        weight: weightForItem(item),
        excerpt: summary,
        itemId: item.id,
        sourceCreatedAt: item.happenedAt ?? item.createdAt,
      },
      signature: signal.signature,
      sourceCreatedAt: item.happenedAt ?? item.createdAt,
    });
  }
  return candidates;
}

function buildToolingCandidates(lessons: Lesson[]): ObservationCandidate[] {
  const candidates: ObservationCandidate[] = [];
  for (const lesson of lessons) {
    const toolName = pickToolName(lesson);
    if (!toolName) {
      continue;
    }
    const mergedText = [
      lesson.context,
      lesson.action,
      lesson.outcome,
      lesson.lesson,
      lesson.correction,
    ]
      .filter(Boolean)
      .join(" ");
    const slot = inferToolingSlot(mergedText);
    const summary = lesson.lesson.trim() || lesson.outcome.trim() || lesson.action.trim();
    if (!summary) {
      continue;
    }

    candidates.push({
      kind: "tooling_state",
      subjectType: "tool",
      subjectId: toolName,
      slot,
      summary,
      detail: lesson.correction ?? lesson.outcome ?? null,
      tags: [toolName, slot, ...lesson.tags.slice(0, 3)],
      metadata: {
        relatedTools: lesson.relatedTools,
        occurrences: lesson.occurrences,
      },
      evidence: {
        stance: "support",
        weight: Math.max(1, Math.min(3, lesson.confidence * 3)),
        excerpt: summary,
        lessonId: lesson.id,
        sourceCreatedAt: lesson.lastSeen,
      },
      signature: normalizeSignature(summary),
      sourceCreatedAt: lesson.lastSeen,
    });
  }
  return candidates;
}

function compareCandidateRecency(a: ObservationCandidate, b: ObservationCandidate): number {
  const aTs = a.sourceCreatedAt ? Date.parse(a.sourceCreatedAt) : 0;
  const bTs = b.sourceCreatedAt ? Date.parse(b.sourceCreatedAt) : 0;
  return bTs - aTs;
}

function selectEvidence(
  chosen: ObservationCandidate,
  group: ObservationCandidate[],
): {
  support: CreateKnowledgeObservationEvidenceInput[];
  contradict: CreateKnowledgeObservationEvidenceInput[];
  supportCount: number;
  sourceDiversity: number;
  contradictionWeight: number;
  lastSupportedAt: string | null;
  lastContradictedAt: string | null;
} {
  const support: CreateKnowledgeObservationEvidenceInput[] = [];
  const contradict: CreateKnowledgeObservationEvidenceInput[] = [];
  const sourceKinds = new Set<string>();
  let contradictionWeight = 0;
  let lastSupportedAt: string | null = null;
  let lastContradictedAt: string | null = null;

  for (const candidate of group) {
    const sameTruth = candidate.signature === chosen.signature;
    const stance: KnowledgeObservationEvidenceStance = sameTruth ? "support" : "contradict";
    const entry: CreateKnowledgeObservationEvidenceInput = {
      ...candidate.evidence,
      stance,
    };
    if (entry.itemId) {
      sourceKinds.add("item");
    }
    if (entry.lessonId) {
      sourceKinds.add("lesson");
    }
    if (entry.reflectionId) {
      sourceKinds.add("reflection");
    }
    if (entry.entityId) {
      sourceKinds.add("entity");
    }

    if (sameTruth) {
      support.push(entry);
      if (
        candidate.sourceCreatedAt &&
        (!lastSupportedAt || candidate.sourceCreatedAt > lastSupportedAt)
      ) {
        lastSupportedAt = candidate.sourceCreatedAt;
      }
    } else {
      contradict.push(entry);
      contradictionWeight += entry.weight ?? 1;
      if (
        candidate.sourceCreatedAt &&
        (!lastContradictedAt || candidate.sourceCreatedAt > lastContradictedAt)
      ) {
        lastContradictedAt = candidate.sourceCreatedAt;
      }
    }
  }

  return {
    support,
    contradict,
    supportCount: support.length,
    sourceDiversity: sourceKinds.size,
    contradictionWeight,
    lastSupportedAt,
    lastContradictedAt,
  };
}

async function findActiveObservationByCanonicalKey(
  memory: MemoryAdapter,
  kind: KnowledgeObservation["kind"],
  canonicalKey: string,
): Promise<KnowledgeObservation | null> {
  const candidates = await memory.listKnowledgeObservations({
    kinds: [kind],
    status: "active",
    limit: 200,
  });
  return candidates.find((candidate) => candidate.canonicalKey === canonicalKey) ?? null;
}

async function buildKnowledgeObservationCandidateGroups(params: {
  memory: MemoryAdapter;
}): Promise<Map<string, ObservationCandidate[]>> {
  const [items, entities, lessons] = await Promise.all([
    params.memory.listItems({ limit: 250 }),
    params.memory.listEntities({ limit: 150 }),
    params.memory.listLessons({ limit: 150 }),
  ]);

  const rawCandidates = [
    ...(await buildOperatorPreferenceCandidates(params.memory, items)),
    ...(await buildRelationshipCandidates(params.memory, items, entities)),
    ...(await buildProjectStateCandidates(params.memory, items)),
    ...buildToolingCandidates(lessons),
  ];

  const grouped = new Map<string, ObservationCandidate[]>();
  for (const candidate of rawCandidates) {
    const canonicalKey = buildKnowledgeObservationCanonicalKey({
      kind: candidate.kind,
      subjectType: candidate.subjectType,
      subjectId: candidate.subjectId,
      slot: candidate.slot,
    });
    const list = grouped.get(canonicalKey) ?? [];
    list.push(candidate);
    grouped.set(canonicalKey, list);
  }

  return grouped;
}

export async function sweepKnowledgeObservationScopeRevalidation(params: {
  memory: MemoryAdapter;
  now?: Date;
  limit?: number;
  kindDays?: Partial<Record<KnowledgeObservationKind, number>>;
}): Promise<{
  scanned: number;
  markedStale: number;
  staleIds: string[];
  retainedCanonicalKeys: string[];
}> {
  const now = params.now ?? new Date();
  const candidateGroups = await buildKnowledgeObservationCandidateGroups({
    memory: params.memory,
  });
  const candidateKeys = new Set(candidateGroups.keys());
  const activeObservations = await params.memory.listKnowledgeObservations({
    kinds: [...REVALIDATION_SWEEP_KINDS],
    status: "active",
    limit: params.limit ?? 250,
  });

  const staleIds: string[] = [];
  for (const observation of activeObservations) {
    if (candidateKeys.has(observation.canonicalKey)) {
      continue;
    }
    if (
      !isKnowledgeObservationRevalidationDue({
        observation,
        now,
        kindDays: params.kindDays,
      })
    ) {
      continue;
    }
    await params.memory.markKnowledgeObservationStale(observation.id);
    staleIds.push(observation.id);
  }

  return {
    scanned: activeObservations.length,
    markedStale: staleIds.length,
    staleIds,
    retainedCanonicalKeys: [...candidateKeys],
  };
}

export async function consolidateKnowledgeObservations(params: {
  memory: MemoryAdapter;
  now?: Date;
  maxScopes?: number;
}): Promise<KnowledgeObservationConsolidationResult[]> {
  const memory = params.memory;
  const now = params.now ?? new Date();
  const grouped = await buildKnowledgeObservationCandidateGroups({ memory });

  const results: KnowledgeObservationConsolidationResult[] = [];
  for (const [canonicalKey, group] of [...grouped.entries()].slice(0, params.maxScopes ?? 25)) {
    const ordered = group.toSorted(compareCandidateRecency);
    const chosen = ordered[0];
    if (!chosen) {
      continue;
    }

    const evidence = selectEvidence(chosen, ordered);
    const confidence = computeKnowledgeObservationConfidence({
      sourceCount: evidence.supportCount,
      sourceDiversity: evidence.sourceDiversity,
      supportWeight: evidence.support.reduce((sum, entry) => sum + (entry.weight ?? 1), 0),
      contradictionWeight: evidence.contradictionWeight,
      lastSupportedAt: evidence.lastSupportedAt,
      now,
    });
    const freshness = computeKnowledgeObservationFreshness({
      kind: chosen.kind,
      lastSupportedAt: evidence.lastSupportedAt,
      lastContradictedAt: evidence.lastContradictedAt,
      now,
    });
    const payload: CreateKnowledgeObservationInput = {
      kind: chosen.kind,
      subjectType: chosen.subjectType,
      subjectId: chosen.subjectId,
      canonicalKey,
      summary: chosen.summary,
      detail: chosen.detail,
      confidence: confidence.confidence,
      confidenceComponents: confidence.components,
      freshness: freshness.freshness,
      revalidationDueAt: freshness.revalidationDueAt,
      supportCount: evidence.supportCount,
      sourceDiversity: evidence.sourceDiversity,
      contradictionWeight: evidence.contradictionWeight,
      lastSupportedAt: evidence.lastSupportedAt,
      lastContradictedAt: evidence.lastContradictedAt,
      firstSupportedAt: evidence.support[0]?.sourceCreatedAt ?? evidence.lastSupportedAt,
      tags: [...new Set(chosen.tags)],
      metadata: {
        ...chosen.metadata,
        slot: chosen.slot,
      },
      evidence: [...evidence.support, ...evidence.contradict],
    };

    const existing = await findActiveObservationByCanonicalKey(memory, chosen.kind, canonicalKey);
    if (!existing) {
      const observation = await memory.upsertKnowledgeObservation(payload);
      results.push({
        action: "create",
        observation,
        canonicalKey,
        reason: "no-active-observation",
        evidenceCount: payload.evidence?.length ?? 0,
      });
      continue;
    }

    if (normalizeSignature(existing.summary) === chosen.signature) {
      const observation = await memory.upsertKnowledgeObservation(payload);
      results.push({
        action: "reinforce",
        observation,
        canonicalKey,
        reason: "same-active-truth",
        evidenceCount: payload.evidence?.length ?? 0,
      });
      continue;
    }

    const observation = await memory.supersedeKnowledgeObservation({
      id: existing.id,
      successor: payload,
    });
    results.push({
      action: "supersede",
      observation,
      canonicalKey,
      reason: "material-truth-change",
      evidenceCount: payload.evidence?.length ?? 0,
    });
  }

  return results;
}
