import type { MemoryAdapter } from "../../data/adapter.js";
import type { PersonalSkillCandidate } from "../../memory/memu-types.js";
import type { SkillMatchCandidate } from "./types.js";

const PERSONAL_SKILL_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "this",
  "to",
  "use",
  "we",
  "what",
  "when",
  "where",
  "with",
  "you",
  "your",
]);

const PROCEDURAL_SIGNAL_RE =
  /\b(use|when|before|after|if|then|verify|check|start|open|run|update|record|save|fetch|search|deploy|publish|create|review|prepare|build|upload|download|reply|send|compare|capture|inspect|trace)\b/i;
const NEGATION_RE = /\b(no|not|never|avoid|skip|don't|do not)\b/i;
const PERSONAL_SKILL_DECAY_DAYS = 21;
const PERSONAL_SKILL_STALE_DAYS = 45;
const PERSONAL_SKILL_DEPRECATE_DAYS = 90;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function daysSince(iso: string | null | undefined, now: string): number | null {
  if (!iso) return null;
  const thenMs = Date.parse(iso);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(thenMs) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, (nowMs - thenMs) / (24 * 60 * 60 * 1000));
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !PERSONAL_SKILL_STOPWORDS.has(part));
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function countProvenance(candidate: PersonalSkillCandidate): number {
  return (
    candidate.sourceMemoryIds.length +
    candidate.sourceEpisodeIds.length +
    candidate.sourceTaskIds.length +
    candidate.sourceLessonIds.length
  );
}

function parseProcedureOutlineToSteps(outline: string | null | undefined): string[] {
  const raw = outline?.trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .map((line) =>
      line
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .trim(),
    )
    .filter((line) => line.length > 0 && !/^use when:/i.test(line));
}

function normalizePreconditions(candidate: PersonalSkillCandidate): string[] {
  if (candidate.preconditions.length > 0) {
    return dedupePreserveOrder(candidate.preconditions);
  }
  if (candidate.triggerPatterns.length === 0) {
    return [];
  }
  return dedupePreserveOrder(candidate.triggerPatterns.map((pattern) => `When ${pattern}`));
}

function normalizeExecutionSteps(candidate: PersonalSkillCandidate): string[] {
  if (candidate.executionSteps.length > 0) {
    return dedupePreserveOrder(candidate.executionSteps);
  }
  return dedupePreserveOrder(parseProcedureOutlineToSteps(candidate.procedureOutline));
}

function normalizeExpectedOutcomes(candidate: PersonalSkillCandidate): string[] {
  if (candidate.expectedOutcomes.length > 0) {
    return dedupePreserveOrder(candidate.expectedOutcomes);
  }
  return candidate.summary.trim() ? [candidate.summary.trim()] : [];
}

function candidateTerms(candidate: PersonalSkillCandidate): Set<string> {
  return new Set(
    tokenize(
      [
        candidate.title,
        candidate.summary,
        candidate.triggerPatterns.join(" "),
        candidate.relatedTools.join(" "),
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
}

function candidateSimilarity(a: PersonalSkillCandidate, b: PersonalSkillCandidate): number {
  if (a.title.trim().toLowerCase() === b.title.trim().toLowerCase()) {
    return 1;
  }
  const aTerms = candidateTerms(a);
  const bTerms = candidateTerms(b);
  if (aTerms.size === 0 || bTerms.size === 0) {
    return 0;
  }
  const overlap = [...aTerms].filter((term) => bTerms.has(term)).length;
  const union = new Set([...aTerms, ...bTerms]).size;
  return union > 0 ? overlap / union : 0;
}

function hasContradictionSignal(a: PersonalSkillCandidate, b: PersonalSkillCandidate): boolean {
  const sameTitle = a.title.trim().toLowerCase() === b.title.trim().toLowerCase();
  const similarity = candidateSimilarity(a, b);
  if (!sameTitle && similarity < 0.4) {
    return false;
  }

  const aOutcome = normalizeExpectedOutcomes(a).join(" ");
  const bOutcome = normalizeExpectedOutcomes(b).join(" ");
  const negationMismatch = NEGATION_RE.test(aOutcome) !== NEGATION_RE.test(bOutcome);

  const aTools = new Set(a.relatedTools.map((tool) => tool.toLowerCase()));
  const bTools = new Set(b.relatedTools.map((tool) => tool.toLowerCase()));
  const sharedTools = [...aTools].filter((tool) => bTools.has(tool)).length;
  const toolConflict = aTools.size > 0 && bTools.size > 0 && sharedTools === 0;

  const aSteps = new Set(normalizeExecutionSteps(a).map((step) => step.toLowerCase()));
  const bSteps = new Set(normalizeExecutionSteps(b).map((step) => step.toLowerCase()));
  const sharedSteps = [...aSteps].filter((step) => bSteps.has(step)).length;
  const stepConflict = aSteps.size > 0 && bSteps.size > 0 && sharedSteps === 0;

  return negationMismatch || (sameTitle && (toolConflict || stepConflict));
}

function contradictionResolutionScore(candidate: PersonalSkillCandidate): number {
  return (
    candidate.confidence * 0.45 +
    candidate.strength * 0.35 +
    Math.min(0.1, candidate.evidenceCount * 0.02) +
    Math.min(0.1, candidate.recurrenceCount * 0.02) +
    Math.min(0.05, candidate.successCount * 0.01)
  );
}

function hasProceduralSignal(candidate: PersonalSkillCandidate): boolean {
  const haystack = [
    candidate.title,
    candidate.summary,
    candidate.procedureOutline ?? "",
    candidate.triggerPatterns.join(" "),
    candidate.relatedTools.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
  return PROCEDURAL_SIGNAL_RE.test(haystack);
}

function buildFallbackProcedureOutline(candidate: PersonalSkillCandidate): string | null {
  const lines: string[] = [];
  const preconditions = normalizePreconditions(candidate);
  if (preconditions.length > 0) {
    lines.push(`Use when: ${preconditions.join(", ")}`);
  }
  const steps = normalizeExecutionSteps(candidate);
  if (steps.length > 0) {
    for (const [index, step] of steps.entries()) {
      lines.push(`${index + 1}. ${step}`);
    }
  } else if (candidate.summary.trim()) {
    lines.push(candidate.summary.trim());
  }
  const outcomes = normalizeExpectedOutcomes(candidate);
  if (outcomes.length > 0) {
    lines.push(`Expected outcome: ${outcomes.join("; ")}`);
  }
  if (candidate.relatedTools.length > 0) {
    lines.push(`Preferred tools: ${candidate.relatedTools.join(", ")}`);
  }
  const joined = lines.filter(Boolean).join("\n");
  return joined.trim() || null;
}

function normalizeProcedureOutline(candidate: PersonalSkillCandidate): string | null {
  const existing = candidate.procedureOutline?.trim();
  if (existing) return existing;
  return buildFallbackProcedureOutline(candidate);
}

function classifyReviewState(
  candidate: PersonalSkillCandidate,
): "candidate" | "incubating" | "promoted" | "rejected" | "deprecated" {
  if (candidate.state === "deprecated") return "deprecated";
  if (candidate.state === "rejected") return "rejected";

  const provenanceCount = countProvenance(candidate);
  const procedural = hasProceduralSignal(candidate);
  const hasOutline = Boolean(normalizeProcedureOutline(candidate));
  const evidenceBacked =
    candidate.evidenceCount >= 1 ||
    candidate.sourceTaskIds.length > 0 ||
    candidate.sourceLessonIds.length > 0 ||
    candidate.sourceEpisodeIds.length > 0;
  const repeated =
    candidate.recurrenceCount >= 2 ||
    candidate.evidenceCount >= 2 ||
    (candidate.sourceLessonIds.length > 0 && candidate.sourceTaskIds.length > 0);
  const strongCorrection = candidate.confidence >= 0.9 && provenanceCount >= 1;

  // If a skill is already intentionally incubating and is clearly procedural,
  // don't immediately demote it just because it lacks passive provenance yet.
  // This protects explicit agent-authored/operator-authored procedures while
  // they accumulate real usage history.
  if (
    candidate.state === "incubating" &&
    procedural &&
    hasOutline &&
    candidate.confidence >= 0.55
  ) {
    return "incubating";
  }

  if (
    procedural &&
    hasOutline &&
    evidenceBacked &&
    candidate.confidence >= 0.72 &&
    (repeated || strongCorrection)
  ) {
    return "promoted";
  }
  if (procedural && provenanceCount >= 1 && candidate.confidence >= 0.55) {
    return "incubating";
  }
  if (!procedural && provenanceCount <= 1 && candidate.confidence < 0.4) {
    return "rejected";
  }
  return "candidate";
}

export type PersonalSkillReviewResult = {
  reviewed: number;
  promoted: number;
  incubating: number;
  rejected: number;
  demoted: number;
  contradictions: number;
  changed: number;
};

export type PersonalSkillUsageOutcome = {
  matchedSkillId: string;
  used: boolean;
  succeeded: boolean;
  executedTools: string[];
};

export type PersonalSkillExecutionPlan = {
  skillId: string;
  skillName: string;
  scope: PersonalSkillCandidate["scope"];
  preconditions: string[];
  expectedOutcomes: string[];
  steps: Array<{
    index: number;
    text: string;
    expectedTools: string[];
  }>;
};

export type PersonalSkillExecutionReport = {
  skillId: string;
  completedStepCount: number;
  totalStepCount: number;
  missingSteps: string[];
  executedTools: string[];
  succeeded: boolean;
};

function buildUsageOutcomes(params: {
  matches: SkillMatchCandidate[];
  candidates: PersonalSkillCandidate[];
  executedTools: string[];
  runSucceeded: boolean;
}): PersonalSkillUsageOutcome[] {
  const byId = new Map(params.candidates.map((candidate) => [candidate.id, candidate]));
  const normalizedTools = new Set(params.executedTools.map((tool) => tool.trim().toLowerCase()));
  return params.matches
    .filter((match) => match.kind === "personal" && typeof match.id === "string")
    .map((match) => {
      const candidate = byId.get(match.id ?? "");
      const relatedTools = new Set(
        (candidate?.relatedTools ?? []).map((tool) => tool.toLowerCase()),
      );
      const used =
        relatedTools.size === 0
          ? params.executedTools.length > 0 || params.runSucceeded
          : [...relatedTools].some((tool) => normalizedTools.has(tool));
      return {
        matchedSkillId: match.id!,
        used,
        succeeded: params.runSucceeded && used,
        executedTools: params.executedTools,
      } satisfies PersonalSkillUsageOutcome;
    });
}

export async function recordPersonalSkillUsage(params: {
  memory: MemoryAdapter;
  matches: SkillMatchCandidate[];
  executedTools: string[];
  runSucceeded: boolean;
  now?: string;
}): Promise<{ updated: number }> {
  const now = params.now ?? new Date().toISOString();
  const candidates = await params.memory.listPersonalSkillCandidates({ limit: 200 });
  const outcomes = buildUsageOutcomes({
    matches: params.matches,
    candidates,
    executedTools: params.executedTools,
    runSucceeded: params.runSucceeded,
  });

  let updated = 0;
  for (const outcome of outcomes) {
    const candidate = candidates.find((entry) => entry.id === outcome.matchedSkillId);
    if (!candidate) continue;

    const usageCount = candidate.usageCount + 1;
    const successCount = candidate.successCount + (outcome.succeeded ? 1 : 0);
    const failureCount = candidate.failureCount + (outcome.used && !outcome.succeeded ? 1 : 0);
    const confidenceDelta = outcome.succeeded ? 0.05 : outcome.used ? -0.08 : -0.02;
    const strengthDelta = outcome.succeeded ? 0.08 : outcome.used ? -0.12 : -0.03;
    const confidence = clamp(candidate.confidence + confidenceDelta, 0.15, 1);
    const strength = clamp(candidate.strength + strengthDelta, 0, 1);
    let state = candidate.state;
    if (
      state === "promoted" &&
      (confidence < 0.58 || strength < 0.35 || failureCount >= successCount + 2)
    ) {
      state = "incubating";
    }
    if (confidence < 0.28 && failureCount >= 3) {
      state = "deprecated";
    }
    if (state === "incubating" && confidence >= 0.78 && successCount >= 2 && strength >= 0.6) {
      state = "promoted";
    }

    await params.memory.updatePersonalSkillCandidate(candidate.id, {
      confidence,
      strength,
      usageCount,
      successCount,
      failureCount,
      state,
      lastUsedAt: now,
      lastReinforcedAt: outcome.succeeded ? now : candidate.lastReinforcedAt,
    });
    await params.memory.createPersonalSkillReviewEvent({
      candidateId: candidate.id,
      actorType: "system",
      action: outcome.succeeded ? "usage_reinforced" : "usage_decayed",
      reason: outcome.succeeded
        ? "Matched Personal Skill was reinforced by a successful run"
        : "Matched Personal Skill decayed because the run did not complete it successfully",
      details: {
        executedTools: params.executedTools,
        succeeded: outcome.succeeded,
      },
    });
    updated += 1;
  }
  return { updated };
}

export async function reviewPersonalSkillCandidates(params: {
  memory: MemoryAdapter;
  now?: string;
  limit?: number;
}): Promise<PersonalSkillReviewResult> {
  const now = params.now ?? new Date().toISOString();
  const candidates = await params.memory.listPersonalSkillCandidates({
    limit: params.limit ?? 200,
  });

  let promoted = 0;
  let incubating = 0;
  let rejected = 0;
  let demoted = 0;
  let contradictions = 0;
  let changed = 0;
  const nextStates = new Map<string, PersonalSkillCandidate["state"]>();

  for (const candidate of candidates) {
    let nextState = classifyReviewState(candidate);
    if (
      nextState === "candidate" &&
      candidate.state === "candidate" &&
      hasProceduralSignal(candidate) &&
      Boolean(normalizeProcedureOutline(candidate)) &&
      candidate.confidence >= 0.55
    ) {
      const history = await params.memory.listPersonalSkillReviewEvents({
        candidateId: candidate.id,
        limit: 8,
      });
      const hasAuthoredSignal = history.some(
        (event) => event.action === "authored" || event.action === "patched",
      );
      if (hasAuthoredSignal) {
        nextState = "incubating";
      }
    }
    const staleDays = daysSince(candidate.lastUsedAt ?? candidate.lastReviewedAt, now);
    let nextConfidence = candidate.confidence;
    let nextStrength = candidate.strength;
    if (staleDays != null && staleDays >= PERSONAL_SKILL_DECAY_DAYS) {
      nextConfidence = clamp(candidate.confidence - 0.03, 0.15, 1);
      nextStrength = clamp(candidate.strength - 0.05, 0, 1);
    }
    if (nextState === "promoted" && staleDays != null && staleDays >= PERSONAL_SKILL_STALE_DAYS) {
      nextState = "incubating";
      demoted += 1;
    }
    if (
      staleDays != null &&
      staleDays >= PERSONAL_SKILL_DEPRECATE_DAYS &&
      nextState !== "rejected" &&
      nextState !== "deprecated" &&
      nextStrength < 0.25
    ) {
      nextState = "deprecated";
      demoted += 1;
    }
    nextStates.set(candidate.id, nextState);
    if (nextState === "promoted") promoted += 1;
    if (nextState === "incubating") incubating += 1;
    if (nextState === "rejected") rejected += 1;

    const nextOutline = normalizeProcedureOutline(candidate);
    const nextPreconditions = normalizePreconditions(candidate);
    const nextSteps = normalizeExecutionSteps(candidate);
    const nextOutcomes = normalizeExpectedOutcomes(candidate);
    const needsUpdate =
      nextState !== candidate.state ||
      nextOutline !== (candidate.procedureOutline ?? null) ||
      JSON.stringify(nextPreconditions) !== JSON.stringify(candidate.preconditions) ||
      JSON.stringify(nextSteps) !== JSON.stringify(candidate.executionSteps) ||
      JSON.stringify(nextOutcomes) !== JSON.stringify(candidate.expectedOutcomes) ||
      nextConfidence !== candidate.confidence ||
      nextStrength !== candidate.strength;
    if (!needsUpdate) {
      continue;
    }

    changed += 1;
    await params.memory.updatePersonalSkillCandidate(candidate.id, {
      state: nextState,
      procedureOutline: nextOutline,
      preconditions: nextPreconditions,
      executionSteps: nextSteps,
      expectedOutcomes: nextOutcomes,
      confidence: nextConfidence,
      strength: nextStrength,
      lastReviewedAt: now,
    });
    if (nextState !== candidate.state) {
      await params.memory.createPersonalSkillReviewEvent({
        candidateId: candidate.id,
        actorType: "system",
        action:
          nextState === "promoted"
            ? "promoted"
            : nextState === "deprecated"
              ? "deprecated"
              : "demoted",
        reason: `System review moved Personal Skill from ${candidate.state} to ${nextState}`,
        details: {
          previousState: candidate.state,
          nextState,
          confidence: nextConfidence,
          strength: nextStrength,
        },
      });
    }
  }

  const promotionCandidates = candidates.filter(
    (candidate) =>
      nextStates.get(candidate.id) === "promoted" && !candidate.supersededByCandidateId,
  );
  for (const candidate of promotionCandidates) {
    const peers = candidates.filter(
      (peer) =>
        peer.id !== candidate.id &&
        peer.scope === candidate.scope &&
        nextStates.get(peer.id) === "promoted" &&
        !peer.supersededByCandidateId,
    );
    const supersededPeers = peers.filter(
      (peer) =>
        candidateSimilarity(candidate, peer) >= 0.35 &&
        candidate.confidence >= peer.confidence &&
        candidate.evidenceCount >= peer.evidenceCount &&
        candidate.recurrenceCount >= peer.recurrenceCount &&
        candidate.updatedAt >= peer.updatedAt,
    );
    if (supersededPeers.length === 0) {
      continue;
    }
    const supersededIds = dedupePreserveOrder([
      ...candidate.supersedesCandidateIds,
      ...supersededPeers.map((peer) => peer.id),
    ]);
    changed += 1;
    await params.memory.updatePersonalSkillCandidate(candidate.id, {
      supersedesCandidateIds: supersededIds,
      lastReviewedAt: now,
    });
    for (const peer of supersededPeers) {
      changed += 1;
      await params.memory.updatePersonalSkillCandidate(peer.id, {
        state: "deprecated",
        supersededByCandidateId: candidate.id,
        lastReviewedAt: now,
      });
      await params.memory.createPersonalSkillReviewEvent({
        candidateId: peer.id,
        actorType: "system",
        action: "conflict_resolved",
        reason: `System superseded ${peer.title} with ${candidate.title}`,
        details: {
          supersededByCandidateId: candidate.id,
        },
      });
    }
  }

  const promotedLive = candidates.filter(
    (candidate) =>
      nextStates.get(candidate.id) === "promoted" && !candidate.supersededByCandidateId,
  );
  const handledPairs = new Set<string>();
  for (const candidate of promotedLive) {
    for (const peer of promotedLive) {
      if (peer.id === candidate.id || peer.scope !== candidate.scope) continue;
      const pairKey = [candidate.id, peer.id].sort().join("::");
      if (handledPairs.has(pairKey)) continue;
      handledPairs.add(pairKey);
      if (!hasContradictionSignal(candidate, peer)) {
        continue;
      }

      contradictions += 1;
      const candidateConflictIds = dedupePreserveOrder([
        ...candidate.conflictsWithCandidateIds,
        peer.id,
      ]);
      const peerConflictIds = dedupePreserveOrder([
        ...peer.conflictsWithCandidateIds,
        candidate.id,
      ]);
      const candidateContradictions = candidate.contradictionCount + 1;
      const peerContradictions = peer.contradictionCount + 1;
      const candidateScore = contradictionResolutionScore(candidate);
      const peerScore = contradictionResolutionScore(peer);
      const scoreGap = Math.abs(candidateScore - peerScore);
      const sameTitle = candidate.title.trim().toLowerCase() === peer.title.trim().toLowerCase();
      const decisive = scoreGap >= 0.12 || sameTitle;
      const winner =
        !decisive || candidateScore === peerScore
          ? null
          : candidateScore > peerScore
            ? candidate
            : peer;
      const loser = winner ? (winner.id === candidate.id ? peer : candidate) : null;

      changed += 1;
      await params.memory.updatePersonalSkillCandidate(candidate.id, {
        conflictsWithCandidateIds: candidateConflictIds,
        contradictionCount: candidateContradictions,
        confidence: clamp(candidate.confidence - 0.04, 0.15, 1),
        state:
          loser?.id === candidate.id && candidate.state === "promoted"
            ? sameTitle
              ? "deprecated"
              : "incubating"
            : candidate.state,
        supersededByCandidateId:
          loser?.id === candidate.id && sameTitle && winner
            ? winner.id
            : candidate.supersededByCandidateId,
        lastContradictedAt: now,
        lastReviewedAt: now,
      });
      await params.memory.createPersonalSkillReviewEvent({
        candidateId: candidate.id,
        actorType: "system",
        action: "conflict_detected",
        reason: `Contradiction detected with ${peer.title}`,
        details: {
          conflictWithCandidateId: peer.id,
        },
      });

      changed += 1;
      await params.memory.updatePersonalSkillCandidate(peer.id, {
        conflictsWithCandidateIds: peerConflictIds,
        contradictionCount: peerContradictions,
        confidence: clamp(peer.confidence - 0.04, 0.15, 1),
        state:
          loser?.id === peer.id && peer.state === "promoted"
            ? sameTitle
              ? "deprecated"
              : "incubating"
            : peer.state,
        supersededByCandidateId:
          loser?.id === peer.id && sameTitle && winner ? winner.id : peer.supersededByCandidateId,
        lastContradictedAt: now,
        lastReviewedAt: now,
      });
      await params.memory.createPersonalSkillReviewEvent({
        candidateId: peer.id,
        actorType: "system",
        action: "conflict_detected",
        reason: `Contradiction detected with ${candidate.title}`,
        details: {
          conflictWithCandidateId: candidate.id,
        },
      });

      if (winner && loser && sameTitle) {
        changed += 1;
        await params.memory.updatePersonalSkillCandidate(winner.id, {
          supersedesCandidateIds: dedupePreserveOrder([...winner.supersedesCandidateIds, loser.id]),
          lastReviewedAt: now,
        });
        await params.memory.createPersonalSkillReviewEvent({
          candidateId: winner.id,
          actorType: "system",
          action: "conflict_resolved",
          reason: `System resolved same-title conflict in favor of ${winner.title}`,
          details: {
            loserId: loser.id,
          },
        });
      }

      if (winner && loser && loser.state === "promoted") {
        demoted += 1;
      }
    }
  }

  return {
    reviewed: candidates.length,
    promoted,
    incubating,
    rejected,
    demoted,
    contradictions,
    changed,
  };
}

export function matchPersonalSkillCandidatesForPrompt(params: {
  prompt: string;
  candidates: PersonalSkillCandidate[];
  limit?: number;
}): SkillMatchCandidate[] {
  const queryTerms = new Set(tokenize(params.prompt));
  if (queryTerms.size === 0 || params.candidates.length === 0) {
    return [];
  }

  return params.candidates
    .filter(
      (candidate) =>
        (candidate.state === "promoted" || candidate.state === "incubating") &&
        !candidate.supersededByCandidateId,
    )
    .map((candidate) => {
      const titleTerms = tokenize(candidate.title);
      const triggerTerms = tokenize(candidate.triggerPatterns.join(" "));
      const haystackTerms = new Set(
        tokenize(
          [
            candidate.title,
            candidate.summary,
            candidate.procedureOutline ?? "",
            candidate.triggerPatterns.join(" "),
            candidate.relatedTools.join(" "),
          ]
            .filter(Boolean)
            .join(" "),
        ),
      );
      const overlap = [...queryTerms].filter((term) => haystackTerms.has(term));
      const titleOverlap = titleTerms.filter((term) => queryTerms.has(term));
      const triggerOverlap = triggerTerms.filter((term) => queryTerms.has(term));
      const provenanceCount = countProvenance(candidate);
      const stateBias = candidate.state === "promoted" ? 4 : 1.5;
      const score =
        overlap.length * 2 +
        titleOverlap.length * 3 +
        triggerOverlap.length * 2 +
        candidate.confidence * 2 +
        (candidate.scope === "operator" ? 1.5 : candidate.scope === "family" ? 0.75 : 0.25) +
        Math.min(2, provenanceCount * 0.25) +
        stateBias;
      if (score <= stateBias) {
        return null;
      }
      const reasons = dedupePreserveOrder([
        titleOverlap.length > 0 ? `name:${titleOverlap.join(",")}` : "",
        triggerOverlap.length > 0 ? `trigger:${triggerOverlap.join(",")}` : "",
        overlap.length > 0
          ? `context:${overlap
              .filter((term) => !titleOverlap.includes(term) && !triggerOverlap.includes(term))
              .join(",")}`
          : "",
        candidate.relatedTools.length > 0 ? `tools:${candidate.relatedTools.join(",")}` : "",
      ]).filter((reason) => !reason.endsWith(":"));

      return {
        id: candidate.id,
        name: candidate.title,
        source: "personal",
        kind: "personal",
        state: candidate.state,
        score: Math.round(score * 100) / 100,
        confidence: candidate.confidence,
        provenanceCount,
        reasons,
      } satisfies SkillMatchCandidate;
    })
    .filter((candidate): candidate is SkillMatchCandidate => Boolean(candidate))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, params.limit ?? 5));
}

export function mergeMatchedSkills(params: {
  personal: SkillMatchCandidate[];
  generic: SkillMatchCandidate[];
  limit?: number;
}): SkillMatchCandidate[] {
  const limit = Math.max(1, params.limit ?? 5);
  const merged: SkillMatchCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of [...params.personal, ...params.generic]) {
    const key = `${entry.kind}:${entry.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
    if (merged.length >= limit) break;
  }
  return merged;
}

export function buildMatchedPersonalSkillsContextBlock(params: {
  matches: SkillMatchCandidate[];
  candidates: PersonalSkillCandidate[];
  limit?: number;
}): string | undefined {
  const limit = Math.max(1, params.limit ?? 2);
  const byId = new Map(params.candidates.map((candidate) => [candidate.id, candidate]));
  const selected = params.matches
    .filter((match) => match.kind === "personal" && typeof match.id === "string")
    .map((match) => byId.get(match.id ?? ""))
    .filter((candidate): candidate is PersonalSkillCandidate => Boolean(candidate))
    .slice(0, limit);
  if (selected.length === 0) {
    return undefined;
  }

  const lines = [
    "## Active Personal Skills",
    "These are your learned operator-specific procedures. Check them before improvising.",
    "Promoted skills have higher authority. Incubating skills are emerging procedures: use them as a strong hint, but verify them against the current evidence before relying on them.",
    "",
  ];

  for (const candidate of selected) {
    lines.push(`### ${candidate.title}`);
    lines.push(candidate.summary.trim());
    lines.push(`State: ${candidate.state}`);
    const preconditions = normalizePreconditions(candidate);
    if (preconditions.length > 0) {
      lines.push(`Use when: ${preconditions.join(", ")}`);
    }
    if (candidate.scope !== "operator") {
      lines.push(`Scope: ${candidate.scope}`);
    }
    const outline = normalizeProcedureOutline(candidate);
    if (outline) {
      lines.push(outline);
    }
    const expectedOutcomes = normalizeExpectedOutcomes(candidate);
    if (expectedOutcomes.length > 0) {
      lines.push(`Expected outcomes: ${expectedOutcomes.join("; ")}`);
    }
    if (candidate.relatedTools.length > 0) {
      lines.push(`Related tools: ${candidate.relatedTools.join(", ")}`);
    }
    if (candidate.supersedesCandidateIds.length > 0) {
      lines.push(`Supersedes: ${candidate.supersedesCandidateIds.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function selectExecutablePersonalSkill(params: {
  prompt: string;
  matches: SkillMatchCandidate[];
  candidates: PersonalSkillCandidate[];
}): PersonalSkillCandidate | null {
  const byId = new Map(params.candidates.map((candidate) => [candidate.id, candidate]));
  const promptTerms = new Set(tokenize(params.prompt));
  for (const match of params.matches) {
    if (match.kind !== "personal" || !match.id) continue;
    const candidate = byId.get(match.id);
    if (!candidate || candidate.state !== "promoted" || candidate.supersededByCandidateId) {
      continue;
    }
    const steps = normalizeExecutionSteps(candidate);
    if (steps.length === 0) {
      continue;
    }
    const preconditions = normalizePreconditions(candidate);
    if (preconditions.length === 0) {
      return candidate;
    }
    const preconditionTerms = new Set(tokenize(preconditions.join(" ")));
    const overlap = [...promptTerms].filter((term) => preconditionTerms.has(term)).length;
    if (overlap > 0) {
      return candidate;
    }
  }
  return null;
}

function inferExpectedToolsForStep(step: string, relatedTools: string[]): string[] {
  const stepLower = step.toLowerCase();
  return relatedTools.filter((tool) => stepLower.includes(tool.toLowerCase()));
}

export function buildPersonalSkillExecutionPlan(
  candidate: PersonalSkillCandidate | null,
): PersonalSkillExecutionPlan | null {
  if (!candidate) {
    return null;
  }
  const steps = normalizeExecutionSteps(candidate);
  if (steps.length === 0) {
    return null;
  }
  return {
    skillId: candidate.id,
    skillName: candidate.title,
    scope: candidate.scope,
    preconditions: normalizePreconditions(candidate),
    expectedOutcomes: normalizeExpectedOutcomes(candidate),
    steps: steps.map((text, index) => ({
      index: index + 1,
      text,
      expectedTools: inferExpectedToolsForStep(text, candidate.relatedTools),
    })),
  };
}

export function evaluatePersonalSkillExecutionPlan(params: {
  plan: PersonalSkillExecutionPlan | null;
  executedTools: string[];
  runSucceeded: boolean;
}): PersonalSkillExecutionReport | null {
  if (!params.plan) {
    return null;
  }
  const toolSet = new Set(params.executedTools.map((tool) => tool.trim().toLowerCase()));
  let completedStepCount = 0;
  const missingSteps: string[] = [];
  for (const step of params.plan.steps) {
    const matched =
      step.expectedTools.length === 0
        ? params.runSucceeded
        : step.expectedTools.some((tool) => toolSet.has(tool.toLowerCase()));
    if (matched) {
      completedStepCount += 1;
    } else {
      missingSteps.push(step.text);
    }
  }
  return {
    skillId: params.plan.skillId,
    completedStepCount,
    totalStepCount: params.plan.steps.length,
    missingSteps,
    executedTools: params.executedTools,
    succeeded: params.runSucceeded && missingSteps.length === 0,
  };
}

export function buildExecutablePersonalSkillContextBlock(
  candidate: PersonalSkillCandidate | null,
): string | undefined {
  const plan = buildPersonalSkillExecutionPlan(candidate);
  if (!plan) {
    return undefined;
  }
  const lines = [
    "## Personal Skill Procedure Mode",
    `Primary procedure: ${plan.skillName}`,
    "If the current task genuinely fits this learned procedure, use it as the default ordered execution path unless live evidence or the user's instruction contradicts it.",
    "",
  ];
  if (plan.preconditions.length > 0) {
    lines.push(`Preconditions: ${plan.preconditions.join("; ")}`);
  }
  lines.push("Execution steps:");
  for (const step of plan.steps) {
    lines.push(`${step.index}. ${step.text}`);
  }
  if (plan.expectedOutcomes.length > 0) {
    lines.push(`Expected outcomes: ${plan.expectedOutcomes.join("; ")}`);
  }
  lines.push(
    "If the procedure stops fitting the evidence, say so and re-evaluate instead of forcing it.",
  );
  return lines.join("\n");
}

export function buildPersonalSkillCandidateReviewPrompt(
  candidates: PersonalSkillCandidate[],
): string {
  const pending = candidates
    .filter((candidate) => candidate.state === "candidate" || candidate.state === "incubating")
    .sort((a, b) => b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  if (pending.length === 0) {
    return "";
  }

  const lines = [
    "",
    "## Personal Skill Review",
    "You have emerging personal procedures. Review whether they are specific, repeated, evidence-backed, and worth strengthening into durable Personal Skills.",
    "Do not invent promotion. Only reinforce what is truly procedural and evidence-backed.",
    "",
  ];

  for (const candidate of pending) {
    lines.push(
      `- ${candidate.title} [${candidate.state}] confidence=${candidate.confidence.toFixed(2)} evidence=${candidate.evidenceCount} recurrence=${candidate.recurrenceCount} provenance=${countProvenance(candidate)}`,
    );
    lines.push(`  Summary: ${candidate.summary}`);
    if (candidate.triggerPatterns.length > 0) {
      lines.push(`  Triggers: ${candidate.triggerPatterns.join(", ")}`);
    }
    if (candidate.procedureOutline?.trim()) {
      lines.push(`  Procedure: ${candidate.procedureOutline.trim()}`);
    }
  }

  return lines.join("\n");
}
