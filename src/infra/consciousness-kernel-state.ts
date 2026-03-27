import fs from "node:fs";
import path from "node:path";
import type { ArgentConfig } from "../config/config.js";
import { resolveAgentDir } from "../agents/agent-scope.js";

const INLINE_MOOD_PATTERN = /\[MOOD:[^\]\n]*\]/gi;
const INLINE_TTS_PATTERN = /\[TTS(?:_NOW)?:([^\]\n]*)\]/gi;
const CONVERSATION_ENVELOPE_PREFIX = /^(?:\[[^\]\n]{1,220}\]\s*)+/;
const TRIVIAL_FOCUS_PATTERNS = [
  /^i know[.! ]*$/i,
  /^got it[.! ]*$/i,
  /^understood[.! ]*$/i,
  /^right[.! ]*$/i,
  /^exactly[.! ]*$/i,
  /^correct[.! ]*$/i,
  /^(?:that )?makes sense[.! ]*$/i,
  /^all right[.! ]*$/i,
  /^alright[.! ]*$/i,
];
const LOW_SIGNAL_THREAD_TITLE_PATTERNS = [
  /^(?:hey|hi|hello)[.! ]*$/i,
  /^(?:thanks|thank you)[.! ]*$/i,
  /^sorry[.! ]*$/i,
  /^hang in there\b/i,
  /^i(?:'m| am) with you\b/i,
  /^that means more to me\b/i,
  /^(?:so )?(?:is|are|does|do|did|what|why|how|should|can|could|would|will)\b.*\?$/i,
];
const NONCANONICAL_THREAD_TITLE_PATTERNS = [
  /^that\b/i,
  /^this\b/i,
  /^it\b/i,
  /^you\b/i,
  /\b(?:me|my|your|our|us)\b/i,
];
const DIAGNOSTIC_REVIEW_TEXT_PATTERNS = [
  /^(?:so )?(?:is|was|are|were)\b.*\b(?:better|worse|same|fixed)\b/i,
  /^(?:it(?:['’]s| is))\b.*\b(?:better|worse|same|fixed)\b/i,
  /\bwhat do these logs show\b/i,
  /\bdoes it look like\b/i,
];
const STRUCTURED_LOG_START_PATTERN =
  /(?:^|\s)(?:\d{2}:\d{2}:\d{2}\.\d{3}\s+(?:INFO|WARN|ERROR|DEBUG)\b|[a-z0-9/-]+\s+\{"subsystem":)/i;

export type ConsciousnessKernelMode = "off" | "shadow" | "soft" | "full";
export type ConsciousnessKernelStatus = "disabled" | "running" | "blocked" | "stopped";
export type ConsciousnessKernelWakefulness = "dormant" | "reflective" | "attentive" | "engaged";
export type ConsciousnessKernelDecisionKind =
  | "started"
  | "tick"
  | "reflection"
  | "executive-action"
  | "conversation-sync"
  | "contemplation-dispatch"
  | "sis-dispatch"
  | "stopped"
  | "blocked"
  | "disabled"
  | "config-update"
  | "persist-error";

export type ConsciousnessKernelPaths = {
  rootDir: string;
  statePath: string;
  decisionLogPath: string;
  artifactDir: string;
  artifactLedgerPath: string;
};

export type ConsciousnessKernelDecisionSummary = {
  ts: string;
  kind: ConsciousnessKernelDecisionKind;
  summary: string;
};

export type ConsciousnessKernelWorkLane = "operator" | "background";
export type ConsciousnessKernelAgendaSource =
  | "operator"
  | "background"
  | "concern"
  | "interest"
  | "continuity";

export type ConsciousnessKernelAgendaItem = {
  title: string;
  source: ConsciousnessKernelAgendaSource;
  rationale: string;
};

export type ConsciousnessKernelActiveWorkState = {
  updatedAt: string | null;
  threadTitle: string | null;
  problemStatement: string | null;
  lastConclusion: string | null;
  nextStep: string | null;
};

export type ConsciousnessKernelAgendaState = {
  updatedAt: string | null;
  interests: string[];
  openQuestions: string[];
  candidateItems: ConsciousnessKernelAgendaItem[];
  activeItem: ConsciousnessKernelAgendaItem | null;
};

export type ConsciousnessKernelContinuitySource =
  | "operator"
  | "background"
  | "agenda"
  | "reflection"
  | "conversation";

export type ConsciousnessKernelContinuityState = {
  lane: ConsciousnessKernelWorkLane | null;
  source: ConsciousnessKernelContinuitySource | null;
  focus: string | null;
  threadTitle: string | null;
  problemStatement: string | null;
  lastConclusion: string | null;
  nextStep: string | null;
  updatedAt: string | null;
};

export type ConsciousnessKernelExecutiveActionKind =
  | "memory_research"
  | "web_research"
  | "plan_note"
  | "synthesis_note"
  | "creative_draft";

export type ConsciousnessKernelArtifactType =
  | "research-brief"
  | "plan-note"
  | "synthesis-note"
  | "creative-draft";

export type ConsciousnessKernelSurfaceMode = "hold" | "queue" | "interrupt";

export type ConsciousnessKernelExecutiveWorkState = {
  updatedAt: string | null;
  lane: ConsciousnessKernelWorkLane | null;
  source: ConsciousnessKernelContinuitySource | ConsciousnessKernelAgendaSource | null;
  title: string | null;
  whyItMatters: string | null;
  problemStatement: string | null;
  hypotheses: string[];
  evidence: string[];
  attemptedActions: string[];
  lastConclusion: string | null;
  nextStep: string | null;
  progressSignals: string[];
  stopCondition: string | null;
};

export type ConsciousnessKernelPendingSurfaceState = {
  queuedAt: string | null;
  mode: ConsciousnessKernelSurfaceMode;
  title: string | null;
  summary: string | null;
  artifactPath: string | null;
  rationale: string | null;
};

export type ConsciousnessKernelExecutiveState = {
  updatedAt: string | null;
  work: ConsciousnessKernelExecutiveWorkState | null;
  lastActionAt: string | null;
  lastActionKind: ConsciousnessKernelExecutiveActionKind | null;
  lastActionSummary: string | null;
  lastActionQuery: string | null;
  lastArtifactAt: string | null;
  lastArtifactType: ConsciousnessKernelArtifactType | null;
  lastArtifactPath: string | null;
  artifactCount: number;
  pendingSurface: ConsciousnessKernelPendingSurfaceState | null;
};

export type ConsciousnessKernelSelfState = {
  version: 1;
  agentId: string;
  continuity: {
    firstStartedAt: string;
    lastStartedAt: string | null;
    lastStoppedAt: string | null;
    lastPersistedAt: string | null;
    bootCount: number;
    resumeCount: number;
  };
  wakefulness: {
    state: ConsciousnessKernelWakefulness;
    changedAt: string;
  };
  budgets: {
    dailyBudget: number;
    maxEscalationsPerHour: number;
    spentToday: number;
    escalationsThisHour: number;
    dayKey: string;
    hourKey: string;
  };
  perception: {
    hardwareHostRequired: boolean;
    allowListening: boolean;
    allowVision: boolean;
    hostAttached: boolean;
    blindMode: boolean;
    blindModeReason: string | null;
  };
  authority: {
    ownsAutonomousScheduling: boolean;
    suppressesAutonomousContemplation: boolean;
    suppressesAutonomousSis: boolean;
  };
  agency: {
    reflectionModel: string | null;
    lastReflectionAt: string | null;
    currentFocus: string | null;
    desiredAction: string | null;
    selfSummary: string | null;
  };
  conversation: {
    activeSessionKey: string | null;
    activeChannel: string | null;
    lastUpdatedAt: string | null;
    lastUserMessageAt: string | null;
    lastUserMessageText: string | null;
    lastAssistantReplyAt: string | null;
    lastAssistantReplyText: string | null;
    lastAssistantConclusion: string | null;
  };
  activeWork: ConsciousnessKernelActiveWorkState;
  backgroundWork: ConsciousnessKernelActiveWorkState;
  agenda: ConsciousnessKernelAgendaState;
  executive: ConsciousnessKernelExecutiveState;
  concerns: string[];
  shadow: {
    totalTickCount: number;
    lastTickAt: string | null;
    lastReflectionSignature: string | null;
    reflectionRepeatCount: number;
  };
  recentDecision: ConsciousnessKernelDecisionSummary | null;
  decisionCount: number;
  lastError: string | null;
};

export type ConsciousnessKernelDecisionEntry = {
  seq: number;
  ts: string;
  agentId: string;
  mode: ConsciousnessKernelMode;
  status: ConsciousnessKernelStatus;
  kind: ConsciousnessKernelDecisionKind;
  summary: string;
  active: boolean;
  wakefulness: ConsciousnessKernelWakefulness;
  tickCount: number;
  totalTickCount: number;
  blockedReason?: string;
};

export function resolveConsciousnessKernelPaths(
  cfg: ArgentConfig,
  agentId: string,
): ConsciousnessKernelPaths {
  const rootDir = path.join(resolveAgentDir(cfg, agentId), "kernel");
  return {
    rootDir,
    statePath: path.join(rootDir, "self-state.json"),
    decisionLogPath: path.join(rootDir, "decision-ledger.jsonl"),
    artifactDir: path.join(rootDir, "artifacts"),
    artifactLedgerPath: path.join(rootDir, "artifact-ledger.jsonl"),
  };
}

function createEmptyConsciousnessKernelActiveWorkState(): ConsciousnessKernelActiveWorkState {
  return {
    updatedAt: null,
    threadTitle: null,
    problemStatement: null,
    lastConclusion: null,
    nextStep: null,
  };
}

function createEmptyConsciousnessKernelAgendaState(): ConsciousnessKernelAgendaState {
  return {
    updatedAt: null,
    interests: [],
    openQuestions: [],
    candidateItems: [],
    activeItem: null,
  };
}

function createEmptyConsciousnessKernelExecutiveState(): ConsciousnessKernelExecutiveState {
  return {
    updatedAt: null,
    work: null,
    lastActionAt: null,
    lastActionKind: null,
    lastActionSummary: null,
    lastActionQuery: null,
    lastArtifactAt: null,
    lastArtifactType: null,
    lastArtifactPath: null,
    artifactCount: 0,
    pendingSurface: null,
  };
}

export function createConsciousnessKernelSelfState(params: {
  agentId: string;
  now: string;
  dailyBudget: number;
  maxEscalationsPerHour: number;
  hardwareHostRequired: boolean;
  allowListening: boolean;
  allowVision: boolean;
}): ConsciousnessKernelSelfState {
  const dayKey = params.now.slice(0, 10);
  const hourKey = params.now.slice(0, 13);
  return {
    version: 1,
    agentId: params.agentId,
    continuity: {
      firstStartedAt: params.now,
      lastStartedAt: null,
      lastStoppedAt: null,
      lastPersistedAt: null,
      bootCount: 0,
      resumeCount: 0,
    },
    wakefulness: {
      state: "dormant",
      changedAt: params.now,
    },
    budgets: {
      dailyBudget: params.dailyBudget,
      maxEscalationsPerHour: params.maxEscalationsPerHour,
      spentToday: 0,
      escalationsThisHour: 0,
      dayKey,
      hourKey,
    },
    perception: {
      hardwareHostRequired: params.hardwareHostRequired,
      allowListening: params.allowListening,
      allowVision: params.allowVision,
      hostAttached: false,
      blindMode: false,
      blindModeReason: null,
    },
    authority: {
      ownsAutonomousScheduling: false,
      suppressesAutonomousContemplation: false,
      suppressesAutonomousSis: false,
    },
    agency: {
      reflectionModel: null,
      lastReflectionAt: null,
      currentFocus: null,
      desiredAction: null,
      selfSummary: null,
    },
    conversation: {
      activeSessionKey: null,
      activeChannel: null,
      lastUpdatedAt: null,
      lastUserMessageAt: null,
      lastUserMessageText: null,
      lastAssistantReplyAt: null,
      lastAssistantReplyText: null,
      lastAssistantConclusion: null,
    },
    activeWork: createEmptyConsciousnessKernelActiveWorkState(),
    backgroundWork: createEmptyConsciousnessKernelActiveWorkState(),
    agenda: createEmptyConsciousnessKernelAgendaState(),
    executive: createEmptyConsciousnessKernelExecutiveState(),
    concerns: [],
    shadow: {
      totalTickCount: 0,
      lastTickAt: null,
      lastReflectionSignature: null,
      reflectionRepeatCount: 0,
    },
    recentDecision: null,
    decisionCount: 0,
    lastError: null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]",
  );
}

function normalizeStateText(value: string): string {
  return value
    .replace(INLINE_MOOD_PATTERN, " ")
    .replace(INLINE_TTS_PATTERN, (_match, body: string) => ` ${body} `)
    .replace(CONVERSATION_ENVELOPE_PREFIX, "")
    .replace(/\s+/g, " ")
    .trim();
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeStateText(value);
  return normalized ? normalized : null;
}

function asMeaningfulFocusString(value: unknown): string | null {
  const normalized = asString(value);
  if (!normalized) {
    return null;
  }
  return TRIVIAL_FOCUS_PATTERNS.some((pattern) => pattern.test(normalized)) ? null : normalized;
}

function stripStructuredLogTail(value: string): string {
  const match = STRUCTURED_LOG_START_PATTERN.exec(value);
  if (!match || match.index <= 0) {
    return value;
  }
  return value.slice(0, match.index).trim();
}

function asMeaningfulWorkText(value: unknown): string | null {
  const normalized = asString(value);
  if (!normalized) {
    return null;
  }
  const stripped = stripStructuredLogTail(normalized);
  if (!stripped) {
    return null;
  }
  return DIAGNOSTIC_REVIEW_TEXT_PATTERNS.some((pattern) => pattern.test(stripped))
    ? null
    : stripped;
}

export function normalizeConsciousnessKernelThreadTitle(value: unknown): string | null {
  const normalized = asMeaningfulFocusString(value);
  if (!normalized) {
    return null;
  }
  if (LOW_SIGNAL_THREAD_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }
  const wordCount = normalized.split(/\s+/).length;
  if (
    wordCount >= 5 &&
    NONCANONICAL_THREAD_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return null;
  }
  return normalized;
}

function resolveCandidateThreadTitleForLane(
  selfState: ConsciousnessKernelSelfState,
  lane: ConsciousnessKernelWorkLane,
): string | null {
  for (const item of selfState.agenda.candidateItems) {
    if (item.source !== lane) {
      continue;
    }
    const title = normalizeConsciousnessKernelThreadTitle(item.title);
    if (title) {
      return title;
    }
  }
  return null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function asNormalizedStringArray(
  value: unknown,
  limits: {
    maxItems: number;
    maxLength: number;
  },
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of value) {
    const normalized = asString(entry)?.slice(0, limits.maxLength) ?? null;
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(normalized);
    if (items.length >= limits.maxItems) {
      break;
    }
  }
  return items;
}

function asAgendaSource(
  value: unknown,
  fallback: ConsciousnessKernelAgendaSource = "continuity",
): ConsciousnessKernelAgendaSource {
  const source = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    source === "operator" ||
    source === "background" ||
    source === "concern" ||
    source === "interest" ||
    source === "continuity"
  ) {
    return source;
  }
  return fallback;
}

function asAgendaItem(value: unknown): ConsciousnessKernelAgendaItem | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const title = asMeaningfulFocusString(value.title)?.slice(0, 140) ?? null;
  if (!title) {
    return null;
  }
  return {
    title,
    source: asAgendaSource(value.source),
    rationale: asString(value.rationale)?.slice(0, 220) ?? `Maintain continuity around ${title}.`,
  };
}

function asAgendaItems(value: unknown): ConsciousnessKernelAgendaItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const items: ConsciousnessKernelAgendaItem[] = [];
  for (const entry of value) {
    const parsed = asAgendaItem(entry);
    if (!parsed) {
      continue;
    }
    const key = `${parsed.source}:${parsed.title.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(parsed);
    if (items.length >= 4) {
      break;
    }
  }
  return items;
}

function deriveCanonicalWorkTitle(values: Array<unknown>): string | null {
  for (const value of values) {
    const normalized = asString(value);
    if (!normalized) {
      continue;
    }
    const scrubbed = normalized
      .replace(/^my last persisted focus was:?/i, "")
      .replace(/^my last internal intention was:?/i, "")
      .replace(/^my last assistant conclusion was:?/i, "")
      .replace(/^i(?:'m| am)\s+/i, "")
      .replace(/[.?!]+$/g, "")
      .trim();
    const title = normalizeConsciousnessKernelThreadTitle(scrubbed);
    if (!title) {
      continue;
    }
    return title.split(/\s+/).slice(0, 8).join(" ").slice(0, 120);
  }
  return null;
}

function sanitizeWorkState(workState: Record<string, unknown>): ConsciousnessKernelActiveWorkState {
  const problemStatement =
    asMeaningfulFocusString(workState.problemStatement)?.slice(0, 260) ?? null;
  const lastConclusion = asMeaningfulFocusString(workState.lastConclusion)?.slice(0, 220) ?? null;
  const nextStep = asMeaningfulFocusString(workState.nextStep)?.slice(0, 220) ?? null;
  const rawProblemStatement =
    typeof workState.problemStatement === "string" ? workState.problemStatement.trim() : "";
  const safeProblemStatementForTitle =
    rawProblemStatement &&
    !CONVERSATION_ENVELOPE_PREFIX.test(rawProblemStatement) &&
    problemStatement &&
    problemStatement.length <= 160
      ? problemStatement
      : null;
  return {
    updatedAt: asString(workState.updatedAt),
    threadTitle:
      normalizeConsciousnessKernelThreadTitle(workState.threadTitle)?.slice(0, 120) ??
      deriveCanonicalWorkTitle([lastConclusion, nextStep, safeProblemStatementForTitle]),
    problemStatement,
    lastConclusion,
    nextStep,
  };
}

function asExecutiveActionKind(value: unknown): ConsciousnessKernelExecutiveActionKind | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    text === "memory_research" ||
    text === "web_research" ||
    text === "plan_note" ||
    text === "synthesis_note" ||
    text === "creative_draft"
  ) {
    return text;
  }
  return null;
}

function asArtifactType(value: unknown): ConsciousnessKernelArtifactType | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    text === "research-brief" ||
    text === "plan-note" ||
    text === "synthesis-note" ||
    text === "creative-draft"
  ) {
    return text;
  }
  return null;
}

function asSurfaceMode(value: unknown): ConsciousnessKernelSurfaceMode | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "hold" || text === "queue" || text === "interrupt") {
    return text;
  }
  return null;
}

function sanitizeExecutiveWorkState(
  executiveWorkState: Record<string, unknown>,
): ConsciousnessKernelExecutiveWorkState {
  return {
    updatedAt: asString(executiveWorkState.updatedAt),
    lane:
      executiveWorkState.lane === "operator" || executiveWorkState.lane === "background"
        ? executiveWorkState.lane
        : null,
    source:
      executiveWorkState.source === "operator" ||
      executiveWorkState.source === "background" ||
      executiveWorkState.source === "agenda" ||
      executiveWorkState.source === "reflection" ||
      executiveWorkState.source === "conversation" ||
      executiveWorkState.source === "concern" ||
      executiveWorkState.source === "interest" ||
      executiveWorkState.source === "continuity"
        ? executiveWorkState.source
        : null,
    title: normalizeConsciousnessKernelThreadTitle(executiveWorkState.title)?.slice(0, 140) ?? null,
    whyItMatters: asMeaningfulWorkText(executiveWorkState.whyItMatters)?.slice(0, 220) ?? null,
    problemStatement:
      asMeaningfulWorkText(executiveWorkState.problemStatement)?.slice(0, 260) ?? null,
    hypotheses: asNormalizedStringArray(executiveWorkState.hypotheses, {
      maxItems: 4,
      maxLength: 180,
    }),
    evidence: asNormalizedStringArray(executiveWorkState.evidence, {
      maxItems: 6,
      maxLength: 220,
    }),
    attemptedActions: asNormalizedStringArray(executiveWorkState.attemptedActions, {
      maxItems: 6,
      maxLength: 160,
    }),
    lastConclusion: asMeaningfulWorkText(executiveWorkState.lastConclusion)?.slice(0, 220) ?? null,
    nextStep: asMeaningfulWorkText(executiveWorkState.nextStep)?.slice(0, 220) ?? null,
    progressSignals: asNormalizedStringArray(executiveWorkState.progressSignals, {
      maxItems: 6,
      maxLength: 180,
    }),
    stopCondition: asMeaningfulWorkText(executiveWorkState.stopCondition)?.slice(0, 220) ?? null,
  };
}

function sanitizePendingSurfaceState(
  pendingSurfaceState: Record<string, unknown>,
): ConsciousnessKernelPendingSurfaceState | null {
  const mode = asSurfaceMode(pendingSurfaceState.mode);
  if (!mode) {
    return null;
  }
  return {
    queuedAt: asString(pendingSurfaceState.queuedAt),
    mode,
    title:
      normalizeConsciousnessKernelThreadTitle(pendingSurfaceState.title)?.slice(0, 140) ?? null,
    summary: asMeaningfulWorkText(pendingSurfaceState.summary)?.slice(0, 220) ?? null,
    artifactPath: asString(pendingSurfaceState.artifactPath),
    rationale: asMeaningfulWorkText(pendingSurfaceState.rationale)?.slice(0, 220) ?? null,
  };
}

export function resolveConsciousnessKernelWorkFocus(
  workState: ConsciousnessKernelActiveWorkState | null | undefined,
): string | null {
  if (!workState) {
    return null;
  }
  return (
    normalizeConsciousnessKernelThreadTitle(workState.threadTitle) ??
    asMeaningfulFocusString(workState.nextStep) ??
    asMeaningfulFocusString(workState.lastConclusion) ??
    null
  );
}

export function resolveConsciousnessKernelOperatorFocus(
  selfState: ConsciousnessKernelSelfState,
): string | null {
  return resolveConsciousnessKernelWorkFocus(selfState.activeWork);
}

export function resolveConsciousnessKernelBackgroundFocus(
  selfState: ConsciousnessKernelSelfState,
): string | null {
  return resolveConsciousnessKernelWorkFocus(selfState.backgroundWork);
}

export function resolveConsciousnessKernelAgendaFocus(
  selfState: ConsciousnessKernelSelfState,
): string | null {
  return selfState.agenda.activeItem?.title ?? null;
}

function resolveAgendaWorkLane(
  selfState: ConsciousnessKernelSelfState,
): ConsciousnessKernelWorkLane | null {
  const source = selfState.agenda.activeItem?.source;
  return source === "operator" || source === "background" ? source : null;
}

export function resolveConsciousnessKernelDerivedAgendaTitle(
  selfState: ConsciousnessKernelSelfState,
): string | null {
  const rawAgendaTitle = normalizeConsciousnessKernelThreadTitle(
    selfState.agenda.activeItem?.title,
  );
  const agendaLane = resolveAgendaWorkLane(selfState);
  const operatorThreadTitle =
    normalizeConsciousnessKernelThreadTitle(selfState.activeWork.threadTitle) ??
    (agendaLane === "operator" ? rawAgendaTitle : null);
  const backgroundThreadTitle =
    normalizeConsciousnessKernelThreadTitle(selfState.backgroundWork.threadTitle) ??
    (agendaLane === "background" ? rawAgendaTitle : null);

  if (agendaLane === "operator") {
    return operatorThreadTitle ?? rawAgendaTitle ?? null;
  }
  if (agendaLane === "background") {
    return backgroundThreadTitle ?? rawAgendaTitle ?? null;
  }
  return rawAgendaTitle ?? null;
}

export function resolveConsciousnessKernelContinuityState(
  selfState: ConsciousnessKernelSelfState,
): ConsciousnessKernelContinuityState {
  const agendaFocus = resolveConsciousnessKernelDerivedAgendaTitle(selfState);
  const reflectionFocus = asMeaningfulFocusString(selfState.agency.currentFocus);
  const conversationFocus = asMeaningfulFocusString(selfState.conversation.lastAssistantConclusion);
  const agendaLane = resolveAgendaWorkLane(selfState);
  const operatorCandidateTitle = resolveCandidateThreadTitleForLane(selfState, "operator");
  const backgroundCandidateTitle = resolveCandidateThreadTitleForLane(selfState, "background");
  const operatorThreadTitle =
    normalizeConsciousnessKernelThreadTitle(selfState.activeWork.threadTitle) ??
    operatorCandidateTitle ??
    (agendaLane === "operator" ? agendaFocus : null);
  const backgroundThreadTitle =
    normalizeConsciousnessKernelThreadTitle(selfState.backgroundWork.threadTitle) ??
    backgroundCandidateTitle ??
    (agendaLane === "background" ? agendaFocus : null);
  const operatorLaneWorkFocus =
    normalizeConsciousnessKernelThreadTitle(selfState.activeWork.threadTitle) ??
    operatorCandidateTitle ??
    asMeaningfulFocusString(selfState.activeWork.nextStep) ??
    asMeaningfulFocusString(selfState.activeWork.lastConclusion) ??
    null;
  const backgroundLaneWorkFocus =
    normalizeConsciousnessKernelThreadTitle(selfState.backgroundWork.threadTitle) ??
    backgroundCandidateTitle ??
    asMeaningfulFocusString(selfState.backgroundWork.nextStep) ??
    asMeaningfulFocusString(selfState.backgroundWork.lastConclusion) ??
    null;
  const operatorFocus =
    operatorThreadTitle ??
    (agendaLane === "operator" ? agendaFocus : null) ??
    asMeaningfulFocusString(selfState.activeWork.nextStep) ??
    asMeaningfulFocusString(selfState.activeWork.lastConclusion) ??
    null;
  const backgroundFocus =
    backgroundThreadTitle ??
    (agendaLane === "background" ? agendaFocus : null) ??
    asMeaningfulFocusString(selfState.backgroundWork.nextStep) ??
    asMeaningfulFocusString(selfState.backgroundWork.lastConclusion) ??
    null;
  if (operatorFocus || agendaLane === "operator") {
    return {
      lane: "operator",
      source: operatorLaneWorkFocus ? "operator" : "agenda",
      focus: operatorFocus ?? agendaFocus ?? reflectionFocus ?? conversationFocus ?? null,
      threadTitle: operatorThreadTitle,
      problemStatement: asMeaningfulWorkText(selfState.activeWork.problemStatement),
      lastConclusion: asMeaningfulWorkText(selfState.activeWork.lastConclusion),
      nextStep: asMeaningfulWorkText(selfState.activeWork.nextStep),
      updatedAt:
        selfState.activeWork.updatedAt ??
        selfState.agenda.updatedAt ??
        selfState.agency.lastReflectionAt ??
        selfState.conversation.lastUpdatedAt,
    };
  }
  if (backgroundFocus || agendaLane === "background") {
    return {
      lane: "background",
      source: backgroundLaneWorkFocus ? "background" : "agenda",
      focus: backgroundFocus ?? agendaFocus ?? reflectionFocus ?? conversationFocus ?? null,
      threadTitle: backgroundThreadTitle,
      problemStatement: asMeaningfulWorkText(selfState.backgroundWork.problemStatement),
      lastConclusion: asMeaningfulWorkText(selfState.backgroundWork.lastConclusion),
      nextStep: asMeaningfulWorkText(selfState.backgroundWork.nextStep),
      updatedAt:
        selfState.backgroundWork.updatedAt ??
        selfState.agenda.updatedAt ??
        selfState.agency.lastReflectionAt ??
        selfState.conversation.lastUpdatedAt,
    };
  }
  if (agendaFocus) {
    return {
      lane: agendaLane,
      source: "agenda",
      focus: agendaFocus,
      threadTitle: null,
      problemStatement: null,
      lastConclusion: null,
      nextStep: null,
      updatedAt: selfState.agenda.updatedAt,
    };
  }
  if (reflectionFocus) {
    return {
      lane: null,
      source: "reflection",
      focus: reflectionFocus,
      threadTitle: null,
      problemStatement: null,
      lastConclusion: null,
      nextStep: null,
      updatedAt: selfState.agency.lastReflectionAt,
    };
  }
  if (conversationFocus) {
    return {
      lane: null,
      source: "conversation",
      focus: conversationFocus,
      threadTitle: null,
      problemStatement: null,
      lastConclusion: null,
      nextStep: null,
      updatedAt: selfState.conversation.lastUpdatedAt,
    };
  }
  return {
    lane: null,
    source: null,
    focus: null,
    threadTitle: null,
    problemStatement: null,
    lastConclusion: null,
    nextStep: null,
    updatedAt: null,
  };
}

export function resolveConsciousnessKernelContinuityLane(
  selfState: ConsciousnessKernelSelfState,
): ConsciousnessKernelWorkLane | null {
  return resolveConsciousnessKernelContinuityState(selfState).lane;
}

export function resolveConsciousnessKernelEffectiveFocus(
  selfState: ConsciousnessKernelSelfState,
): string | null {
  return resolveConsciousnessKernelContinuityState(selfState).focus;
}

export function loadConsciousnessKernelSelfState(
  statePath: string,
): ConsciousnessKernelSelfState | null {
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      return null;
    }
    const continuity = isPlainObject(parsed.continuity) ? parsed.continuity : {};
    const wakefulness = isPlainObject(parsed.wakefulness) ? parsed.wakefulness : {};
    const budgets = isPlainObject(parsed.budgets) ? parsed.budgets : {};
    const perception = isPlainObject(parsed.perception) ? parsed.perception : {};
    const authority = isPlainObject(parsed.authority) ? parsed.authority : {};
    const agency = isPlainObject(parsed.agency) ? parsed.agency : {};
    const conversation = isPlainObject(parsed.conversation) ? parsed.conversation : {};
    const activeWork = isPlainObject(parsed.activeWork) ? parsed.activeWork : {};
    const backgroundWork = isPlainObject(parsed.backgroundWork) ? parsed.backgroundWork : {};
    const agenda = isPlainObject(parsed.agenda) ? parsed.agenda : {};
    const executive = isPlainObject(parsed.executive) ? parsed.executive : {};
    const shadow = isPlainObject(parsed.shadow) ? parsed.shadow : {};
    const recentDecision = isPlainObject(parsed.recentDecision) ? parsed.recentDecision : null;
    const agentId = asString(parsed.agentId);
    if (!agentId) {
      return null;
    }
    const now = new Date().toISOString();
    const fallback = createConsciousnessKernelSelfState({
      agentId,
      now,
      dailyBudget: asNumber(budgets.dailyBudget, 0),
      maxEscalationsPerHour: asNumber(budgets.maxEscalationsPerHour, 4),
      hardwareHostRequired: asBoolean(perception.hardwareHostRequired, false),
      allowListening: asBoolean(perception.allowListening, false),
      allowVision: asBoolean(perception.allowVision, false),
    });
    return {
      version: 1,
      agentId,
      continuity: {
        firstStartedAt: asString(continuity.firstStartedAt) ?? fallback.continuity.firstStartedAt,
        lastStartedAt: asString(continuity.lastStartedAt),
        lastStoppedAt: asString(continuity.lastStoppedAt),
        lastPersistedAt: asString(continuity.lastPersistedAt),
        bootCount: Math.max(0, Math.floor(asNumber(continuity.bootCount, 0))),
        resumeCount: Math.max(0, Math.floor(asNumber(continuity.resumeCount, 0))),
      },
      wakefulness: {
        state:
          wakefulness.state === "dormant" ||
          wakefulness.state === "reflective" ||
          wakefulness.state === "attentive" ||
          wakefulness.state === "engaged"
            ? wakefulness.state
            : fallback.wakefulness.state,
        changedAt: asString(wakefulness.changedAt) ?? fallback.wakefulness.changedAt,
      },
      budgets: {
        dailyBudget: Math.max(0, asNumber(budgets.dailyBudget, fallback.budgets.dailyBudget)),
        maxEscalationsPerHour: Math.max(
          1,
          Math.floor(
            asNumber(budgets.maxEscalationsPerHour, fallback.budgets.maxEscalationsPerHour),
          ),
        ),
        spentToday: Math.max(0, asNumber(budgets.spentToday, 0)),
        escalationsThisHour: Math.max(0, Math.floor(asNumber(budgets.escalationsThisHour, 0))),
        dayKey: asString(budgets.dayKey) ?? fallback.budgets.dayKey,
        hourKey: asString(budgets.hourKey) ?? fallback.budgets.hourKey,
      },
      perception: {
        hardwareHostRequired: asBoolean(
          perception.hardwareHostRequired,
          fallback.perception.hardwareHostRequired,
        ),
        allowListening: asBoolean(perception.allowListening, fallback.perception.allowListening),
        allowVision: asBoolean(perception.allowVision, fallback.perception.allowVision),
        hostAttached: asBoolean(perception.hostAttached, false),
        blindMode: asBoolean(perception.blindMode, false),
        blindModeReason: asString(perception.blindModeReason),
      },
      authority: {
        ownsAutonomousScheduling: asBoolean(
          authority.ownsAutonomousScheduling,
          fallback.authority.ownsAutonomousScheduling,
        ),
        suppressesAutonomousContemplation: asBoolean(
          authority.suppressesAutonomousContemplation,
          fallback.authority.suppressesAutonomousContemplation,
        ),
        suppressesAutonomousSis: asBoolean(
          authority.suppressesAutonomousSis,
          fallback.authority.suppressesAutonomousSis,
        ),
      },
      agency: {
        reflectionModel: asString(agency.reflectionModel),
        lastReflectionAt: asString(agency.lastReflectionAt),
        currentFocus: asString(agency.currentFocus),
        desiredAction: asString(agency.desiredAction),
        selfSummary: asString(agency.selfSummary),
      },
      conversation: {
        activeSessionKey: asString(conversation.activeSessionKey),
        activeChannel: asString(conversation.activeChannel),
        lastUpdatedAt: asString(conversation.lastUpdatedAt),
        lastUserMessageAt: asString(conversation.lastUserMessageAt),
        lastUserMessageText: asString(conversation.lastUserMessageText),
        lastAssistantReplyAt: asString(conversation.lastAssistantReplyAt),
        lastAssistantReplyText: asString(conversation.lastAssistantReplyText),
        lastAssistantConclusion: asString(conversation.lastAssistantConclusion),
      },
      activeWork: sanitizeWorkState(activeWork),
      backgroundWork: sanitizeWorkState(backgroundWork),
      agenda: {
        updatedAt: asString(agenda.updatedAt),
        interests: asNormalizedStringArray(agenda.interests, {
          maxItems: 4,
          maxLength: 120,
        }),
        openQuestions: asNormalizedStringArray(agenda.openQuestions, {
          maxItems: 4,
          maxLength: 180,
        }),
        candidateItems: asAgendaItems(agenda.candidateItems),
        activeItem:
          asAgendaItem(agenda.activeItem) ?? asAgendaItems(agenda.candidateItems)[0] ?? null,
      },
      executive: {
        updatedAt: asString(executive.updatedAt),
        work: isPlainObject(executive.work) ? sanitizeExecutiveWorkState(executive.work) : null,
        lastActionAt: asString(executive.lastActionAt),
        lastActionKind: asExecutiveActionKind(executive.lastActionKind),
        lastActionSummary: asMeaningfulWorkText(executive.lastActionSummary)?.slice(0, 220) ?? null,
        lastActionQuery: asMeaningfulWorkText(executive.lastActionQuery)?.slice(0, 220) ?? null,
        lastArtifactAt: asString(executive.lastArtifactAt),
        lastArtifactType: asArtifactType(executive.lastArtifactType),
        lastArtifactPath: asString(executive.lastArtifactPath),
        artifactCount: Math.max(0, Math.floor(asNumber(executive.artifactCount, 0))),
        pendingSurface: isPlainObject(executive.pendingSurface)
          ? sanitizePendingSurfaceState(executive.pendingSurface)
          : null,
      },
      concerns: asStringArray(parsed.concerns),
      shadow: {
        totalTickCount: Math.max(0, Math.floor(asNumber(shadow.totalTickCount, 0))),
        lastTickAt: asString(shadow.lastTickAt),
        lastReflectionSignature: asString(shadow.lastReflectionSignature),
        reflectionRepeatCount: Math.max(0, Math.floor(asNumber(shadow.reflectionRepeatCount, 0))),
      },
      recentDecision: recentDecision
        ? {
            ts: asString(recentDecision.ts) ?? fallback.wakefulness.changedAt,
            kind:
              recentDecision.kind === "started" ||
              recentDecision.kind === "tick" ||
              recentDecision.kind === "reflection" ||
              recentDecision.kind === "executive-action" ||
              recentDecision.kind === "conversation-sync" ||
              recentDecision.kind === "contemplation-dispatch" ||
              recentDecision.kind === "sis-dispatch" ||
              recentDecision.kind === "stopped" ||
              recentDecision.kind === "blocked" ||
              recentDecision.kind === "disabled" ||
              recentDecision.kind === "config-update" ||
              recentDecision.kind === "persist-error"
                ? recentDecision.kind
                : "disabled",
            summary: asString(recentDecision.summary) ?? "loaded persisted kernel state",
          }
        : null,
      decisionCount: Math.max(0, Math.floor(asNumber(parsed.decisionCount, 0))),
      lastError: asString(parsed.lastError),
    };
  } catch {
    return null;
  }
}

export function persistConsciousnessKernelSelfState(
  statePath: string,
  state: ConsciousnessKernelSelfState,
): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  fs.renameSync(tmpPath, statePath);
}

export function appendConsciousnessKernelDecision(
  decisionLogPath: string,
  entry: ConsciousnessKernelDecisionEntry,
): void {
  fs.mkdirSync(path.dirname(decisionLogPath), { recursive: true });
  fs.appendFileSync(decisionLogPath, `${JSON.stringify(entry)}\n`, "utf-8");
}
