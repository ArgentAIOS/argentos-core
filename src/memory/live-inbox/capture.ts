/**
 * Live Inbox — Deterministic Capture
 *
 * Extracts high-salience candidates from conversation turns using
 * regex/keyword matching. No LLM calls — runs synchronously at message time.
 *
 * Hard triggers (confidence ≥ 0.8) are promoted immediately to MemU.
 * Deferred candidates (confidence < 0.8) are staged for contemplation review.
 */

import type { MemoryAdapter } from "../../data/adapter.js";
import type {
  CandidateType,
  CreateLiveCandidateInput,
  LiveCandidate,
  MemoryType,
  Significance,
} from "../memu-types.js";
import { getMemoryAdapter } from "../../data/storage-factory.js";
import { logVerbose } from "../../globals.js";
import { contentHash } from "../memu-store.js";

// ── Pattern Definitions ──

export interface CapturePattern {
  regex: RegExp;
  type: CandidateType;
  confidence: number;
  isHard: boolean;
  memoryTypeHint?: MemoryType;
  significanceHint?: Significance;
}

/** Hard triggers — immediate promotion (confidence ≥ 0.8) */
const HARD_TRIGGER_PATTERNS: readonly CapturePattern[] = [
  // Directives: "remember this/that", "don't forget"
  {
    regex: /\b(?:remember\s+(?:this|that)|don'?t\s+forget)\b/i,
    type: "directive",
    confidence: 0.95,
    isHard: true,
    memoryTypeHint: "knowledge",
    significanceHint: "important",
  },
  // Identity: "I am...", "my name is...", "I work at..."
  {
    regex:
      /\b(?:(?:I\s+am|I'm)\s+(?:a\s+)?\w+|my\s+name\s+is\s+\w+|I\s+work\s+(?:at|for|in)\s+\w+)\b/i,
    type: "identity",
    confidence: 0.9,
    isHard: true,
    memoryTypeHint: "profile",
    significanceHint: "important",
  },
  // Preferences: "I prefer...", "I like...", "I don't like...", "I always...", "I never..."
  {
    regex: /\b(?:I\s+(?:prefer|like|love|hate|don'?t\s+like|always|never)\s+\w+)/i,
    type: "preference",
    confidence: 0.85,
    isHard: true,
    memoryTypeHint: "behavior",
    significanceHint: "noteworthy",
  },
  // Corrections: "no, that's wrong", "actually...", "don't do that", "stop doing..."
  {
    regex:
      /\b(?:no,?\s+(?:that'?s?\s+(?:wrong|incorrect|not\s+right))|actually,?\s+|(?:don'?t|stop|never)\s+(?:do\s+that|doing)\b)/i,
    type: "correction",
    confidence: 0.9,
    isHard: true,
    memoryTypeHint: "knowledge",
    significanceHint: "important",
  },
  // Commitments: "we agreed...", "the plan is...", "going forward..."
  {
    regex: /\b(?:we\s+agreed|the\s+plan\s+is|going\s+forward|from\s+now\s+on)\b/i,
    type: "commitment",
    confidence: 0.85,
    isHard: true,
    memoryTypeHint: "knowledge",
    significanceHint: "important",
  },
] as const;

/** Deferred candidate patterns — staged for contemplation review */
const DEFERRED_PATTERNS: readonly CapturePattern[] = [
  // Emotional markers: exclamation clusters, caps
  {
    regex: /[!]{2,}|(?:[A-Z]{4,}\s+){2,}/,
    type: "emotion",
    confidence: 0.6,
    isHard: false,
    memoryTypeHint: "event",
    significanceHint: "noteworthy",
  },
  // Decision language: "let's go with", "I've decided", "we'll use"
  {
    regex: /\b(?:let'?s?\s+go\s+with|I'?ve\s+decided|we'?ll\s+use|decided\s+(?:to|on))\b/i,
    type: "decision",
    confidence: 0.6,
    isHard: false,
    memoryTypeHint: "knowledge",
    significanceHint: "noteworthy",
  },
  // Relationship: mentions of names with context
  {
    regex:
      /\b(?:my\s+(?:wife|husband|partner|friend|brother|sister|mom|dad|boss|colleague|cofounder|co-founder)\s+\w+)\b/i,
    type: "relationship",
    confidence: 0.5,
    isHard: false,
    memoryTypeHint: "profile",
    significanceHint: "noteworthy",
  },
] as const;

const ALL_PATTERNS: readonly CapturePattern[] = [...HARD_TRIGGER_PATTERNS, ...DEFERRED_PATTERNS];

const WORK_OBJECT_RE =
  /\b(?:project|spec|prd|prp|brief|build|client|customer|domain|website|site|app|platform|landing\s+page|portfolio|resume|cv|lead(?:\s+capture|\s+collection|\s+generation)?|brand|marketing|osint|intelligence)\b/i;
const WORK_ACTION_RE =
  /\b(?:build(?:ing)?|creat(?:e|ing)|launch(?:ing)?|ship(?:ping)?|spec(?:c|)ing|spec(?:c|)ed|design(?:ing)?|plan(?:ning)?|scope(?:d|ing)?|draft(?:ing)?|brainstorm(?:ing)?|prototype|deploy(?:ing)?|implement(?:ing)?)\b/i;
const WORK_PLANNING_RE =
  /\b(?:brainstorm(?:ing)?|spec(?:c|)ing|planning|requirements|task\s+breakdown|repo\s+shape|architecture|framing|wireframe|brief)\b/i;
const WORK_APPROVAL_RE =
  /\b(?:permission\s+to|approved|approval|allowed\s+to|go\s+ahead|family\s+dev\s+team|dev\s+team|we(?:'re| are)\s+building|we(?:'ll| will)\s+build|this\s+(?:project|site|website|build)\s+is\s+for)\b/i;
const WORK_INFRA_RE =
  /\b(?:namecheap|cloudflare|coolify|dns|hosting|domain\s+setup|lead\s+capture|portfolio|resume|cv)\b/i;

// ── Capture Result ──

export interface CandidateInput extends CreateLiveCandidateInput {
  isHard: boolean;
  matchedPattern: string;
}

export interface CaptureResult {
  candidates: CandidateInput[];
  hardTriggers: CandidateInput[];
}

// ── Entity Extraction (lightweight) ──

const ENTITY_RE = /\b(?:@\w+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;

function extractEntities(text: string): string[] {
  const matches = text.match(ENTITY_RE);
  if (!matches) return [];
  return [...new Set(matches)].slice(0, 5);
}

function matchIndex(regex: RegExp, text: string): number {
  const match = regex.exec(text);
  return match?.index ?? -1;
}

function addCandidate(
  params: {
    candidates: CandidateInput[];
    hardTriggers: CandidateInput[];
    seen: Set<string>;
    sessionKey?: string;
    messageId?: string;
    role: "user" | "assistant";
    entities: string[];
  },
  candidate: Omit<CandidateInput, "sessionKey" | "messageId" | "role" | "entities">,
): void {
  const dedupKey = `${candidate.candidateType}:${contentHash(candidate.factText)}`;
  if (params.seen.has(dedupKey)) {
    return;
  }
  params.seen.add(dedupKey);

  const fullCandidate: CandidateInput = {
    ...candidate,
    sessionKey: params.sessionKey,
    messageId: params.messageId,
    role: params.role,
    entities: params.entities,
  };
  params.candidates.push(fullCandidate);
  if (fullCandidate.isHard) {
    params.hardTriggers.push(fullCandidate);
  }
}

function buildWorkContextCandidates(params: {
  text: string;
  sessionKey?: string;
  messageId?: string;
  role: "user" | "assistant";
  entities: string[];
  seen: Set<string>;
  candidates: CandidateInput[];
  hardTriggers: CandidateInput[];
  ttlHours: number;
}): void {
  const objectIndex = matchIndex(WORK_OBJECT_RE, params.text);
  if (objectIndex < 0) {
    return;
  }

  const hasWorkAction = WORK_ACTION_RE.test(params.text);
  const hasPlanningCue = WORK_PLANNING_RE.test(params.text);
  const hasInfraCue = WORK_INFRA_RE.test(params.text);
  const hasApprovalCue = WORK_APPROVAL_RE.test(params.text);

  if (!hasWorkAction && !hasPlanningCue && !hasInfraCue && !hasApprovalCue) {
    return;
  }

  const factText = extractFactSentence(params.text, objectIndex);
  if (factText.length < 20) {
    return;
  }

  const isHard = hasApprovalCue;
  const candidateType: CandidateType = isHard ? "commitment" : "decision";
  const confidence = isHard ? 0.84 : hasPlanningCue ? 0.74 : hasInfraCue ? 0.72 : 0.68;
  const significanceHint: Significance = isHard || hasInfraCue ? "important" : "noteworthy";

  addCandidate(
    {
      candidates: params.candidates,
      hardTriggers: params.hardTriggers,
      seen: params.seen,
      sessionKey: params.sessionKey,
      messageId: params.messageId,
      role: params.role,
      entities: params.entities,
    },
    {
      candidateType,
      factText,
      confidence,
      triggerFlags: ["work_context"],
      memoryTypeHint: "knowledge",
      significanceHint,
      ttlHours: params.ttlHours,
      isHard,
      matchedPattern: isHard ? "contextual:work-approval" : "contextual:work-planning",
    },
  );
}

// ── Core Capture ──

/**
 * Extract candidates from a message. Deterministic — no LLM calls.
 * Returns both hard triggers and deferred candidates.
 */
export function captureFromMessage(params: {
  sessionKey?: string;
  messageId?: string;
  text: string;
  role: "user" | "assistant";
  ttlHours?: number;
}): CaptureResult {
  const { text, role, sessionKey, messageId } = params;
  const ttlHours = params.ttlHours ?? 24;

  if (!text || text.length < 5) {
    return { candidates: [], hardTriggers: [] };
  }

  // Skip system/nudge/heartbeat messages
  if (text.startsWith("[NUDGE]") || text.startsWith("Heartbeat:") || text.startsWith("System:")) {
    return { candidates: [], hardTriggers: [] };
  }

  const candidates: CandidateInput[] = [];
  const hardTriggers: CandidateInput[] = [];
  const seen = new Set<string>();
  const entities = extractEntities(text);

  for (const pattern of ALL_PATTERNS) {
    const match = pattern.regex.exec(text);
    if (!match) continue;

    // Extract the fact: use the full sentence containing the match
    const factText = extractFactSentence(text, match.index);
    addCandidate(
      {
        candidates,
        hardTriggers,
        seen,
        sessionKey,
        messageId,
        role,
        entities,
      },
      {
        candidateType: pattern.type,
        factText,
        confidence: pattern.confidence,
        triggerFlags: [pattern.type],
        memoryTypeHint: pattern.memoryTypeHint,
        significanceHint: pattern.significanceHint,
        ttlHours,
        isHard: pattern.isHard,
        matchedPattern: pattern.regex.source,
      },
    );
  }

  buildWorkContextCandidates({
    text,
    sessionKey,
    messageId,
    role,
    entities,
    seen,
    candidates,
    hardTriggers,
    ttlHours,
  });

  return { candidates, hardTriggers };
}

/**
 * Extract the sentence containing the match position.
 * Falls back to a window around the match if no sentence boundary found.
 */
function extractFactSentence(text: string, matchIndex: number): string {
  // Find sentence boundaries
  const before = text.lastIndexOf(".", matchIndex - 1);
  const after = text.indexOf(".", matchIndex);

  const start = before >= 0 ? before + 1 : 0;
  const end = after >= 0 ? after + 1 : text.length;

  let sentence = text.slice(start, end).trim();

  // Cap at 500 chars
  if (sentence.length > 500) {
    sentence = sentence.slice(0, 500) + "...";
  }

  // If too short (just the match), widen the window
  if (sentence.length < 20) {
    const windowStart = Math.max(0, matchIndex - 100);
    const windowEnd = Math.min(text.length, matchIndex + 200);
    sentence = text.slice(windowStart, windowEnd).trim();
  }

  return sentence;
}

// ── Orchestrator ──

export interface CaptureAndPromoteConfig {
  enabled?: boolean;
  hardTriggers?: boolean;
  ttlHours?: number;
  promotionThreshold?: number;
}

/**
 * Capture candidates from a message and immediately promote hard triggers.
 * Fire-and-forget — errors are logged but never thrown.
 */
export function captureAndPromote(params: {
  sessionKey?: string;
  messageId?: string;
  text: string;
  role: "user" | "assistant";
  config?: CaptureAndPromoteConfig;
}): void {
  const config = params.config ?? {};
  if (config.enabled === false) return;

  const { candidates, hardTriggers } = captureFromMessage({
    sessionKey: params.sessionKey,
    messageId: params.messageId,
    text: params.text,
    role: params.role,
    ttlHours: config.ttlHours ?? 24,
  });

  if (candidates.length === 0) return;

  void (async () => {
    let store: MemoryAdapter;
    try {
      store = await getMemoryAdapter();
    } catch {
      logVerbose("live-inbox: could not access MemoryAdapter");
      return;
    }

    // Store all candidates (dedupe via unique index)
    for (const c of candidates) {
      await store.createLiveCandidate?.(c);
    }

    // Immediately promote hard triggers
    if (config.hardTriggers !== false) {
      for (const trigger of hardTriggers) {
        try {
          await promoteCandidate(store, trigger);
        } catch (err) {
          logVerbose(`live-inbox: hard trigger promotion failed: ${String(err)}`);
        }
      }
    }
  })().catch((err) => {
    logVerbose(`live-inbox: captureAndPromote failed: ${String(err)}`);
  });
}

/**
 * Promote a single candidate to MemU memory.
 * Deduplicates by content hash — reinforces if already exists.
 */
async function promoteCandidate(store: MemoryAdapter, candidate: CandidateInput): Promise<void> {
  const hash = contentHash(candidate.factText);

  // Check for existing memory with same content
  const existing = await store.findItemByHash(hash);
  if (existing) {
    // Reinforce instead of duplicate
    await store.reinforceItem(existing.id);

    // Find the candidate row to mark as merged
    const candidateRows = await (store.listLiveCandidates?.({ status: "pending", limit: 1 }) ?? []);
    const match = candidateRows.find((c) => c.factHash === hash);
    if (match) {
      await store.markLiveCandidateMerged?.(match.id, existing.id);
    }
    return;
  }

  // Create new memory item
  const item = await store.createItem({
    memoryType: candidate.memoryTypeHint ?? "knowledge",
    summary: candidate.factText,
    significance: candidate.significanceHint ?? "noteworthy",
    happenedAt: new Date().toISOString(),
    extra: {
      source: "live-inbox",
      candidateType: candidate.candidateType,
      role: candidate.role,
      confidence: candidate.confidence,
    },
  });

  // Mark candidate as promoted
  const candidateRows = await (store.listLiveCandidates?.({ status: "pending", limit: 100 }) ?? []);
  const match = candidateRows.find((c) => c.factHash === hash);
  if (match) {
    await store.markLiveCandidatePromoted?.(match.id, item.id, "hard-trigger");
  }
}
