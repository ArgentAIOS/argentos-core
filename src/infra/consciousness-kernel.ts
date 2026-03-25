import fs from "node:fs";
import type { ArgentConfig } from "../config/config.js";
import type {
  ContemplationRunResult,
  ContemplationRunnerSnapshot,
} from "./contemplation-runner.js";
import type { SisRunResult, SisRunnerSnapshot } from "./sis-runner.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveConsciousnessKernelAuthority } from "./consciousness-kernel-authority.js";
import { runConsciousnessKernelExecutiveCycle } from "./consciousness-kernel-executive.js";
import {
  runConsciousnessKernelInnerLoop,
  type ConsciousnessKernelReflection,
} from "./consciousness-kernel-inner-loop.js";
import {
  appendConsciousnessKernelDecision,
  createConsciousnessKernelSelfState,
  resolveConsciousnessKernelDerivedAgendaTitle,
  loadConsciousnessKernelSelfState,
  normalizeConsciousnessKernelThreadTitle,
  persistConsciousnessKernelSelfState,
  resolveConsciousnessKernelBackgroundFocus,
  resolveConsciousnessKernelContinuityState,
  resolveConsciousnessKernelContinuityLane,
  resolveConsciousnessKernelOperatorFocus,
  resolveConsciousnessKernelPaths,
  type ConsciousnessKernelActiveWorkState,
  type ConsciousnessKernelAgendaItem,
  type ConsciousnessKernelAgendaSource,
  type ConsciousnessKernelContinuitySource,
  type ConsciousnessKernelDecisionEntry,
  type ConsciousnessKernelDecisionKind,
  type ConsciousnessKernelExecutiveActionKind,
  type ConsciousnessKernelArtifactType,
  type ConsciousnessKernelMode,
  type ConsciousnessKernelPaths,
  type ConsciousnessKernelSelfState,
  type ConsciousnessKernelStatus,
  type ConsciousnessKernelSurfaceMode,
  type ConsciousnessKernelWakefulness,
  type ConsciousnessKernelWorkLane,
} from "./consciousness-kernel-state.js";
import { emitDiagnosticEvent, isDiagnosticsEnabled } from "./diagnostic-events.js";

const log = createSubsystemLogger("gateway/consciousness-kernel");
const DEFAULT_TICK_MS = 30_000;
const DEFAULT_MAX_ESCALATIONS_PER_HOUR = 4;
const DEFAULT_DAILY_BUDGET = 0;
const STALLED_REFLECTION_QUIET_THRESHOLD = 3;
const BLOCKED_REASON =
  "Slice 4 still blocks soft/full modes until outward autonomy and embodiment land.";
const WORKSTREAM_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "them",
  "there",
  "this",
  "to",
  "was",
  "while",
  "with",
  "without",
]);

export type {
  ConsciousnessKernelDecisionKind,
  ConsciousnessKernelMode,
  ConsciousnessKernelStatus,
  ConsciousnessKernelWakefulness,
};

export type ConsciousnessKernelSnapshot = {
  configured: boolean;
  enabled: boolean;
  mode: ConsciousnessKernelMode;
  status: ConsciousnessKernelStatus;
  active: boolean;
  defaultAgentId: string | null;
  tickMs: number;
  localModel: string | null;
  maxEscalationsPerHour: number;
  dailyBudget: number;
  hardwareHostRequired: boolean;
  allowListening: boolean;
  allowVision: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  tickCount: number;
  blockedReason?: string;
  wakefulnessState: ConsciousnessKernelWakefulness;
  statePath: string | null;
  decisionLogPath: string | null;
  lastPersistedAt: string | null;
  bootCount: number;
  resumeCount: number;
  totalTickCount: number;
  decisionCount: number;
  lastDecisionAt: string | null;
  lastDecisionKind: ConsciousnessKernelDecisionKind | null;
  lastReflectionAt: string | null;
  reflectionModel: string | null;
  currentFocus: string | null;
  effectiveFocus: string | null;
  activeLane: ConsciousnessKernelWorkLane | null;
  activeLaneFocus: string | null;
  activeLaneThreadTitle: string | null;
  continuityLane: ConsciousnessKernelWorkLane | null;
  continuitySource: ConsciousnessKernelContinuitySource | null;
  continuityUpdatedAt: string | null;
  continuityThreadTitle: string | null;
  continuityProblemStatement: string | null;
  continuityLastConclusion: string | null;
  continuityNextStep: string | null;
  desiredAction: string | null;
  selfSummary: string | null;
  agendaUpdatedAt: string | null;
  agendaInterests: string[];
  agendaOpenQuestions: string[];
  agendaCandidateItems: ConsciousnessKernelAgendaItem[];
  agendaActiveTitle: string | null;
  agendaActiveSource: ConsciousnessKernelAgendaSource | null;
  agendaActiveRationale: string | null;
  executiveUpdatedAt: string | null;
  executiveWorkTitle: string | null;
  executiveWorkLane: ConsciousnessKernelWorkLane | null;
  executiveLastActionAt: string | null;
  executiveLastActionKind: ConsciousnessKernelExecutiveActionKind | null;
  executiveLastActionSummary: string | null;
  executiveLastArtifactAt: string | null;
  executiveLastArtifactType: ConsciousnessKernelArtifactType | null;
  executiveLastArtifactPath: string | null;
  executiveArtifactCount: number;
  executivePendingSurfaceMode: ConsciousnessKernelSurfaceMode | null;
  executivePendingSurfaceTitle: string | null;
  executivePendingSurfaceSummary: string | null;
  reflectionRepeatCount: number;
  activeWorkUpdatedAt: string | null;
  activeWorkThreadTitle: string | null;
  activeWorkProblemStatement: string | null;
  activeWorkLastConclusion: string | null;
  activeWorkNextStep: string | null;
  backgroundWorkUpdatedAt: string | null;
  backgroundWorkThreadTitle: string | null;
  backgroundWorkProblemStatement: string | null;
  backgroundWorkLastConclusion: string | null;
  backgroundWorkNextStep: string | null;
  activeConversationSessionKey: string | null;
  activeConversationChannel: string | null;
  lastConversationAt: string | null;
  lastUserMessageAt: string | null;
  lastAssistantReplyAt: string | null;
  lastAssistantConclusion: string | null;
  lastError: string | null;
  schedulerAuthorityActive: boolean;
  suppressesAutonomousContemplation: boolean;
  suppressesAutonomousSis: boolean;
};

export type ConsciousnessKernelRunner = {
  stop: () => void;
  updateConfig: (cfg: ArgentConfig) => void;
  getSnapshot: () => ConsciousnessKernelSnapshot;
};

export type ConsciousnessKernelSchedulerHooks = {
  contemplation?: {
    getSnapshot: () => ContemplationRunnerSnapshot;
    runNow: (agentId?: string) => Promise<ContemplationRunResult>;
  };
  sis?: {
    getSnapshot: () => SisRunnerSnapshot;
    runNow: () => Promise<SisRunResult>;
  };
};

type ResolvedKernelConfig = {
  configured: boolean;
  enabled: boolean;
  mode: ConsciousnessKernelMode;
  defaultAgentId: string | null;
  tickMs: number;
  localModel: string | null;
  maxEscalationsPerHour: number;
  dailyBudget: number;
  hardwareHostRequired: boolean;
  allowListening: boolean;
  allowVision: boolean;
};

export type ConsciousnessKernelConversationTurn = {
  cfg?: ArgentConfig;
  agentId: string;
  sessionKey?: string | null;
  channel?: string | null;
  userMessageText?: string | null;
  assistantReplyText?: string | null;
  assistantConclusion?: string | null;
  now?: string;
};

let currentSnapshot: ConsciousnessKernelSnapshot | null = null;
let lastDiagnosticSignature: string | null = null;
let liveConversationTurnUpdater: ((update: ConsciousnessKernelConversationTurn) => boolean) | null =
  null;
const CONTINUITY_META_PATTERNS = [
  /\bwhat were you (?:holding in mind|thinking about)\b/i,
  /\bwhat are you working on\b/i,
  /\bwhat are you focused on\b/i,
  /\bwhat (?:is|was) your (?:focus|current focus)\b/i,
  /\bbefore i (?:came back|messaged|started messaging)\b/i,
  /\bpersisted focus\b/i,
  /\blast reflection\b/i,
  /\binternal intention\b/i,
  /\bacross the gap\b/i,
];
const ACKNOWLEDGEMENT_PATTERNS = [
  /^(?:ok(?:ay)?|yes|yup|yeah|sure|fine|please do|do it|continue|carry on|go ahead|sounds good|lets do it|let's do it)[.! ]*$/i,
];
const TRIVIAL_CARRY_FORWARD_PATTERNS = [
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
const RELATIONAL_CARRY_FORWARD_PATTERNS = [
  /\b(?:sorry|apolog(?:ize|y)|hang in there|with you|care|kid|love|excited|means more to me)\b/i,
  /\b(?:flood(?:ing)?|messy real|not scared off|rather be here)\b/i,
];
const WORK_SIGNAL_PATTERNS = [
  /\b(?:work|working|thread|blocker|blockers|problem|issue|task|tasks|ticket|evidence)\b/i,
  /\b(?:deploy|deployment|launch|fix|build|plan|next step|focus|authority|continuity|kernel)\b/i,
  /\b(?:support|host|reconnect|reconnection|diagnos(?:e|is)|investigat(?:e|ion)|trace|strategy)\b/i,
  /\b(?:workflow|calibration|carry|warm|move(?:d)?|continue|continuing|resolve|remediation)\b/i,
];
const DIAGNOSTIC_REVIEW_PATTERNS = [
  /^(?:so )?(?:is|was|are|were)\b.*\b(?:better|worse|same|fixed)\b/i,
  /\bwhat do these logs show\b/i,
  /\bdoes it look like\b/i,
  /\bresume following\b/i,
];
const STRUCTURED_LOG_DUMP_PATTERN =
  /(?:\b\d{2}:\d{2}:\d{2}\.\d{3}\b.*\b(?:INFO|WARN|ERROR|DEBUG)\b|{"subsystem":)/i;
const BACKGROUND_CHANNELS = new Set([
  "cron",
  "heartbeat",
  "sis",
  "contemplation",
  "worker",
  "execution-worker",
  "scheduler",
  "system",
]);
const INLINE_MOOD_PATTERN = /\[MOOD:[^\]\n]*\]/gi;
const INLINE_TTS_PATTERN = /\[TTS(?:_NOW)?:([^\]\n]*)\]/gi;

function resolveKernelConfig(cfg: ArgentConfig): ResolvedKernelConfig {
  const raw = cfg.agents?.defaults?.kernel;
  const configured = Boolean(raw && typeof raw === "object");
  const enabled = raw?.enabled === true;
  const rawMode = raw?.mode;
  const mode: ConsciousnessKernelMode =
    rawMode === "off" || rawMode === "shadow" || rawMode === "soft" || rawMode === "full"
      ? rawMode
      : enabled
        ? "shadow"
        : "off";
  const defaultAgentId = resolveDefaultAgentId(cfg);
  return {
    configured,
    enabled,
    mode,
    defaultAgentId,
    tickMs:
      typeof raw?.tickMs === "number" && Number.isFinite(raw.tickMs)
        ? Math.max(1000, Math.floor(raw.tickMs))
        : DEFAULT_TICK_MS,
    localModel:
      typeof raw?.localModel === "string" && raw.localModel.trim() ? raw.localModel : null,
    maxEscalationsPerHour:
      typeof raw?.maxEscalationsPerHour === "number" && Number.isFinite(raw.maxEscalationsPerHour)
        ? Math.max(1, Math.floor(raw.maxEscalationsPerHour))
        : DEFAULT_MAX_ESCALATIONS_PER_HOUR,
    dailyBudget:
      typeof raw?.dailyBudget === "number" && Number.isFinite(raw.dailyBudget)
        ? Math.max(0, raw.dailyBudget)
        : DEFAULT_DAILY_BUDGET,
    hardwareHostRequired: raw?.hardwareHostRequired === true,
    allowListening: raw?.allowListening === true,
    allowVision: raw?.allowVision === true,
  };
}

function snapshotSignature(snapshot: ConsciousnessKernelSnapshot): string {
  return JSON.stringify({
    status: snapshot.status,
    mode: snapshot.mode,
    enabled: snapshot.enabled,
    active: snapshot.active,
    schedulerAuthorityActive: snapshot.schedulerAuthorityActive,
    blockedReason: snapshot.blockedReason ?? "",
    defaultAgentId: snapshot.defaultAgentId ?? "",
    wakefulnessState: snapshot.wakefulnessState,
    lastError: snapshot.lastError ?? "",
  });
}

function maybeEmitDiagnosticEvent(cfg: ArgentConfig, snapshot: ConsciousnessKernelSnapshot) {
  if (!isDiagnosticsEnabled(cfg)) {
    return;
  }
  const signature = snapshotSignature(snapshot);
  if (signature === lastDiagnosticSignature) {
    return;
  }
  lastDiagnosticSignature = signature;
  emitDiagnosticEvent({
    type: "kernel.state",
    state: snapshot.status,
    mode: snapshot.mode,
    enabled: snapshot.enabled,
    active: snapshot.active,
    defaultAgentId: snapshot.defaultAgentId ?? undefined,
    blockedReason: snapshot.blockedReason,
  });
}

function emitKernelDecisionEvent(
  cfg: ArgentConfig,
  snapshot: ConsciousnessKernelSnapshot,
  decision: ConsciousnessKernelDecisionEntry,
) {
  if (!isDiagnosticsEnabled(cfg)) {
    return;
  }
  emitDiagnosticEvent({
    type: "kernel.decision",
    kind: decision.kind,
    mode: decision.mode,
    status: decision.status,
    active: decision.active,
    defaultAgentId: snapshot.defaultAgentId ?? undefined,
    wakefulness: decision.wakefulness,
    tickCount: decision.tickCount,
    totalTickCount: decision.totalTickCount,
    summary: decision.summary,
    blockedReason: decision.blockedReason,
  });
}

function setSnapshot(cfg: ArgentConfig, snapshot: ConsciousnessKernelSnapshot) {
  currentSnapshot = snapshot;
  maybeEmitDiagnosticEvent(cfg, snapshot);
}

function nowIso(): string {
  return new Date().toISOString();
}

function unwrapInlineStatusTags(text: string): string {
  return text
    .replace(INLINE_MOOD_PATTERN, " ")
    .replace(INLINE_TTS_PATTERN, (_match, body: string) => ` ${body} `);
}

function normalizeConversationText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized =
    typeof value === "string" ? unwrapInlineStatusTags(value).replace(/\s+/g, " ").trim() : "";
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function looksLikeContinuityMetaText(value: string | null | undefined): boolean {
  const normalized = normalizeConversationText(value, 500);
  if (!normalized) {
    return false;
  }
  return CONTINUITY_META_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeAcknowledgementText(value: string | null | undefined): boolean {
  const normalized = normalizeConversationText(value, 120);
  if (!normalized) {
    return false;
  }
  return ACKNOWLEDGEMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeTrivialCarryForwardText(value: string | null | undefined): boolean {
  const normalized = normalizeConversationText(value, 120);
  if (!normalized) {
    return false;
  }
  return TRIVIAL_CARRY_FORWARD_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeRelationalCarryForwardText(value: string | null | undefined): boolean {
  const normalized = normalizeConversationText(value, 320);
  if (!normalized) {
    return false;
  }
  return RELATIONAL_CARRY_FORWARD_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeWorkShapedText(value: string | null | undefined): boolean {
  const normalized = normalizeConversationText(value, 500);
  if (!normalized || looksLikeTrivialCarryForwardText(normalized)) {
    return false;
  }
  const hasWorkSignal = WORK_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized));
  if (!hasWorkSignal) {
    return false;
  }
  if (!looksLikeRelationalCarryForwardText(normalized)) {
    return true;
  }
  return /\b(?:problem|issue|task|ticket|thread|blocker|plan|next step|continuity|authority)\b/i.test(
    normalized,
  );
}

function looksLikeDiagnosticReviewText(value: string | null | undefined): boolean {
  const normalized = normalizeConversationText(value, 1200);
  if (!normalized) {
    return false;
  }
  if (DIAGNOSTIC_REVIEW_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return normalized.includes("?") && STRUCTURED_LOG_DUMP_PATTERN.test(normalized);
}

function stripStructuredLogTail(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = normalizeConversationText(value, maxLength * 4);
  if (!normalized) {
    return null;
  }
  const match = STRUCTURED_LOG_DUMP_PATTERN.exec(normalized);
  const trimmed = match && match.index > 0 ? normalized.slice(0, match.index).trim() : normalized;
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function deriveActiveWorkThreadTitle(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeConversationText(value, 220);
    if (!normalized) {
      continue;
    }
    const scrubbed = normalized
      .replace(/^my last persisted focus was:\s*/i, "")
      .replace(/^my last internal intention was:\s*/i, "")
      .replace(/^my last assistant conclusion was:\s*/i, "")
      .replace(/^i(?:'m| am)\s+/i, "")
      .replace(/[.?!]+$/g, "")
      .trim();
    const title = normalizeConsciousnessKernelThreadTitle(scrubbed);
    if (!title) {
      continue;
    }
    return normalizeConversationText(title.split(/\s+/).slice(0, 8).join(" "), 120);
  }
  return null;
}

function resolveConversationWorkLane(
  channel: string | null | undefined,
  sessionKey: string | null | undefined,
): ConsciousnessKernelWorkLane {
  const normalizedChannel = normalizeConversationText(channel, 80)?.toLowerCase() ?? null;
  if (normalizedChannel && BACKGROUND_CHANNELS.has(normalizedChannel)) {
    return "background";
  }
  const normalizedSessionKey = normalizeConversationText(sessionKey, 160)?.toLowerCase() ?? "";
  if (
    normalizedSessionKey.includes(":cron:") ||
    normalizedSessionKey.includes(":heartbeat:") ||
    normalizedSessionKey.includes(":sis:") ||
    normalizedSessionKey.includes(":contemplation:") ||
    normalizedSessionKey.includes(":worker:") ||
    normalizedSessionKey.includes(":execution-worker:")
  ) {
    return "background";
  }
  return "operator";
}

function resolveWorkStateForLane(
  selfState: ConsciousnessKernelSelfState,
  lane: ConsciousnessKernelWorkLane,
): ConsciousnessKernelActiveWorkState {
  return lane === "background" ? selfState.backgroundWork : selfState.activeWork;
}

function resolveReflectionThreadTitle(params: {
  reflectionThreadTitle: string | null;
  reflectionLane: ConsciousnessKernelWorkLane;
  activeItem: ConsciousnessKernelAgendaItem | null;
  reflectionWorkState: ConsciousnessKernelActiveWorkState;
}): string | null {
  return (
    normalizeConsciousnessKernelThreadTitle(params.reflectionThreadTitle) ??
    (resolveAgendaSourceWorkLane(params.activeItem?.source) === params.reflectionLane
      ? normalizeConsciousnessKernelThreadTitle(params.activeItem?.title)
      : null) ??
    normalizeConsciousnessKernelThreadTitle(params.reflectionWorkState.threadTitle) ??
    null
  );
}

function tokenizeWorkstreamText(value: string | null | undefined): string[] {
  const normalized = normalizeConversationText(value, 600)?.toLowerCase() ?? "";
  if (!normalized) {
    return [];
  }
  return normalized
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => {
      if (token.length > 4 && token.endsWith("s")) {
        return token.slice(0, -1);
      }
      return token;
    })
    .filter((token) => {
      if (!token || WORKSTREAM_STOPWORDS.has(token)) {
        return false;
      }
      return token.length >= 3 || /\d/.test(token);
    });
}

function collectWorkstreamTokens(values: Array<string | null | undefined>): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    for (const token of tokenizeWorkstreamText(value)) {
      tokens.add(token);
    }
  }
  return tokens;
}

function looksLikeSameWorkstream(params: {
  existingTitle: string | null;
  existingProblemStatement: string | null;
  existingLastConclusion: string | null;
  existingNextStep: string | null;
  proposedTitle: string | null;
  proposedProblemStatement: string | null;
  proposedLastConclusion: string | null;
  proposedNextStep: string | null;
}): boolean {
  const existingTokens = collectWorkstreamTokens([
    params.existingTitle,
    params.existingProblemStatement,
    params.existingLastConclusion,
    params.existingNextStep,
  ]);
  const proposedTokens = collectWorkstreamTokens([
    params.proposedTitle,
    params.proposedProblemStatement,
    params.proposedLastConclusion,
    params.proposedNextStep,
  ]);
  if (existingTokens.size === 0 || proposedTokens.size === 0) {
    return false;
  }
  let shared = 0;
  for (const token of existingTokens) {
    if (proposedTokens.has(token)) {
      shared += 1;
    }
  }
  const smallerSetSize = Math.min(existingTokens.size, proposedTokens.size);
  if (shared >= 3 && shared / smallerSetSize >= 0.45) {
    return true;
  }
  return shared >= 2 && (existingTokens.size <= 4 || proposedTokens.size <= 4);
}

function resolveStableWorkThreadTitle(params: {
  reflectionWorkState: ConsciousnessKernelActiveWorkState;
  proposedTitle: string | null;
  proposedProblemStatement: string | null;
  proposedLastConclusion: string | null;
  proposedNextStep: string | null;
}): string | null {
  const existingTitle = normalizeConsciousnessKernelThreadTitle(
    params.reflectionWorkState.threadTitle,
  );
  const proposedTitle = normalizeConsciousnessKernelThreadTitle(params.proposedTitle);
  if (!existingTitle) {
    return proposedTitle;
  }
  if (!proposedTitle) {
    return existingTitle;
  }
  if (existingTitle.toLowerCase() === proposedTitle.toLowerCase()) {
    return existingTitle;
  }
  if (
    looksLikeSameWorkstream({
      existingTitle,
      existingProblemStatement: params.reflectionWorkState.problemStatement,
      existingLastConclusion: params.reflectionWorkState.lastConclusion,
      existingNextStep: params.reflectionWorkState.nextStep,
      proposedTitle,
      proposedProblemStatement: params.proposedProblemStatement,
      proposedLastConclusion: params.proposedLastConclusion,
      proposedNextStep: params.proposedNextStep,
    })
  ) {
    return existingTitle;
  }
  return proposedTitle;
}

function reorderAgendaCandidates(
  candidateItems: ConsciousnessKernelAgendaItem[],
  preferredActiveItem: ConsciousnessKernelAgendaItem,
): ConsciousnessKernelAgendaItem[] {
  const preferredTitle = normalizeConsciousnessKernelThreadTitle(preferredActiveItem.title);
  const reordered = candidateItems.filter((item) => {
    return (
      normalizeConsciousnessKernelThreadTitle(item.title)?.toLowerCase() !==
        preferredTitle?.toLowerCase() || item.source !== preferredActiveItem.source
    );
  });
  return [{ ...preferredActiveItem }, ...reordered.map((item) => ({ ...item }))].slice(0, 4);
}

function selectAlternateAgendaItemForStall(params: {
  candidateItems: ConsciousnessKernelAgendaItem[];
  activeItem: ConsciousnessKernelAgendaItem | null;
  reflectionLane: ConsciousnessKernelWorkLane;
}): ConsciousnessKernelAgendaItem | null {
  const currentTitle = normalizeConsciousnessKernelThreadTitle(params.activeItem?.title);
  const preferredLane = params.reflectionLane;
  let best: ConsciousnessKernelAgendaItem | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const [index, item] of params.candidateItems.entries()) {
    const itemTitle = normalizeConsciousnessKernelThreadTitle(item.title);
    if (!itemTitle) {
      continue;
    }
    if (
      currentTitle &&
      itemTitle.toLowerCase() === currentTitle.toLowerCase() &&
      item.source === params.activeItem?.source
    ) {
      continue;
    }

    let score = 100 - index;
    const itemLane = resolveAgendaSourceWorkLane(item.source);
    if (itemLane === preferredLane) {
      score += 20;
    }
    if (item.source === params.activeItem?.source) {
      score += 8;
    }
    if (item.source === "continuity") {
      score += 6;
    } else if (item.source === "concern") {
      score += 4;
    } else if (item.source === "interest") {
      score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { ...item, title: itemTitle };
    }
  }

  return best;
}

function buildStallPressureReflection(params: {
  reflection: ConsciousnessKernelReflection;
  reflectionLane: ConsciousnessKernelWorkLane;
  reflectionThreadTitle: string | null;
}): { reflection: ConsciousnessKernelReflection; reason: string } | null {
  const alternate = selectAlternateAgendaItemForStall({
    candidateItems: params.reflection.candidateItems,
    activeItem: params.reflection.activeItem,
    reflectionLane: params.reflectionLane,
  });
  if (alternate) {
    const alternateTitle =
      normalizeConsciousnessKernelThreadTitle(alternate.title) ?? params.reflection.focus;
    const alternateProblem =
      normalizeConversationText(alternate.rationale, 260) ?? params.reflection.problemStatement;
    const alternateNextStep =
      normalizeConversationText(`Investigate ${alternateTitle}: ${alternate.rationale}`, 220) ??
      params.reflection.nextStep ??
      `Investigate ${alternateTitle}.`;
    return {
      reflection: {
        ...params.reflection,
        focus: alternateTitle,
        desiredAction:
          params.reflection.desiredAction === "hold" ? "plan" : params.reflection.desiredAction,
        summary: `Repeated identical reflection detected; rotating to ${alternateTitle}.`,
        threadTitle: alternateTitle,
        problemStatement: alternateProblem,
        lastConclusion: `Previous reflection stalled without new evidence.`,
        nextStep: alternateNextStep,
        candidateItems: reorderAgendaCandidates(params.reflection.candidateItems, alternate),
        activeItem: alternate,
      },
      reason: `rotated to ${alternateTitle}`,
    };
  }

  const currentTitle =
    normalizeConsciousnessKernelThreadTitle(params.reflectionThreadTitle) ??
    normalizeConsciousnessKernelThreadTitle(params.reflection.activeItem?.title) ??
    params.reflection.focus;
  const sharpenedNextStep =
    normalizeConversationText(`Identify the single missing datum blocking ${currentTitle}.`, 220) ??
    params.reflection.nextStep ??
    `Identify the single missing datum blocking ${currentTitle}.`;
  return {
    reflection: {
      ...params.reflection,
      desiredAction:
        params.reflection.desiredAction === "hold" ? "research" : params.reflection.desiredAction,
      summary: `Repeated identical reflection detected; sharpening ${currentTitle}.`,
      threadTitle: currentTitle,
      nextStep: sharpenedNextStep,
    },
    reason: `sharpened ${currentTitle}`,
  };
}

function synchronizeAgendaTitleWithThread(params: {
  candidateItems: ConsciousnessKernelAgendaItem[];
  activeItem: ConsciousnessKernelAgendaItem | null;
  reflectionLane: ConsciousnessKernelWorkLane;
  canonicalThreadTitle: string | null;
}): {
  candidateItems: ConsciousnessKernelAgendaItem[];
  activeItem: ConsciousnessKernelAgendaItem | null;
} {
  const canonicalTitle = normalizeConsciousnessKernelThreadTitle(params.canonicalThreadTitle);
  if (!params.activeItem || !canonicalTitle) {
    return {
      candidateItems: params.candidateItems.map((item) => ({ ...item })),
      activeItem: params.activeItem ? { ...params.activeItem } : null,
    };
  }
  if (resolveAgendaSourceWorkLane(params.activeItem.source) !== params.reflectionLane) {
    return {
      candidateItems: params.candidateItems.map((item) => ({ ...item })),
      activeItem: { ...params.activeItem },
    };
  }

  const previousTitle = normalizeConsciousnessKernelThreadTitle(params.activeItem.title);
  const nextActiveItem = { ...params.activeItem, title: canonicalTitle };
  const nextCandidates = params.candidateItems.map((item) => {
    const itemTitle = normalizeConsciousnessKernelThreadTitle(item.title);
    if (item.source !== params.activeItem?.source) {
      return { ...item };
    }
    if (!previousTitle || itemTitle?.toLowerCase() !== previousTitle.toLowerCase()) {
      return { ...item };
    }
    return { ...item, title: canonicalTitle };
  });
  return {
    candidateItems: reorderAgendaCandidates(nextCandidates, nextActiveItem),
    activeItem: nextActiveItem,
  };
}

function buildReflectionSignature(params: {
  reflectionLane: ConsciousnessKernelWorkLane;
  focus: string | null;
  desiredAction: string | null;
  threadTitle: string | null;
  problemStatement: string | null;
  lastConclusion: string | null;
  nextStep: string | null;
  activeItem: ConsciousnessKernelAgendaItem | null;
  concerns: string[];
}): string {
  return JSON.stringify({
    lane: params.reflectionLane,
    focus: params.focus ?? null,
    desiredAction: params.desiredAction ?? null,
    threadTitle: normalizeConsciousnessKernelThreadTitle(params.threadTitle),
    problemStatement: normalizeConversationText(params.problemStatement, 260),
    lastConclusion: normalizeConversationText(params.lastConclusion, 220),
    nextStep: normalizeConversationText(params.nextStep, 220),
    activeItemTitle: normalizeConsciousnessKernelThreadTitle(params.activeItem?.title ?? null),
    activeItemSource: params.activeItem?.source ?? null,
    concerns: params.concerns.map((entry) => entry.trim().toLowerCase()),
  });
}

function shouldEmitQuiescedReflectionLog(repeatCount: number): boolean {
  return repeatCount === STALLED_REFLECTION_QUIET_THRESHOLD || repeatCount % 5 === 0;
}

function resolveAgendaSourceWorkLane(
  source: ConsciousnessKernelAgendaSource | null | undefined,
): ConsciousnessKernelWorkLane | null {
  return source === "operator" || source === "background" ? source : null;
}

function resolveReflectionWorkLane(
  selfState: ConsciousnessKernelSelfState,
  activeItemSource: ConsciousnessKernelAgendaSource | null | undefined,
): ConsciousnessKernelWorkLane {
  return (
    resolveAgendaSourceWorkLane(activeItemSource) ??
    resolveConsciousnessKernelContinuityLane(selfState) ??
    resolveConversationWorkLane(
      selfState.conversation.activeChannel,
      selfState.conversation.activeSessionKey,
    )
  );
}

function syncWorkLaneFromConversation(params: {
  targetWorkState: ConsciousnessKernelActiveWorkState;
  fallbackFocus: string | null;
  lane: ConsciousnessKernelWorkLane;
  now: string;
  userMessageText: string | null;
  assistantConclusion: string | null;
}) {
  const { targetWorkState, fallbackFocus, lane, now, userMessageText, assistantConclusion } =
    params;
  if (
    looksLikeContinuityMetaText(userMessageText) ||
    looksLikeContinuityMetaText(assistantConclusion)
  ) {
    return;
  }
  if (
    lane === "operator" &&
    (looksLikeDiagnosticReviewText(userMessageText) ||
      looksLikeDiagnosticReviewText(assistantConclusion))
  ) {
    return;
  }

  const sanitizedProblemStatement = stripStructuredLogTail(userMessageText, 500);
  const sanitizedConclusion = stripStructuredLogTail(assistantConclusion, 220);

  const candidateProblemStatement =
    sanitizedProblemStatement &&
    !looksLikeAcknowledgementText(userMessageText) &&
    !looksLikeTrivialCarryForwardText(userMessageText)
      ? sanitizedProblemStatement
      : null;
  const candidateConclusion =
    sanitizedConclusion && !looksLikeTrivialCarryForwardText(assistantConclusion)
      ? sanitizedConclusion
      : null;
  if (!candidateProblemStatement && !candidateConclusion) {
    return;
  }
  if (
    !looksLikeWorkShapedText(candidateProblemStatement) &&
    !looksLikeWorkShapedText(candidateConclusion)
  ) {
    return;
  }

  targetWorkState.updatedAt = now;
  targetWorkState.threadTitle =
    deriveActiveWorkThreadTitle([
      candidateConclusion,
      candidateProblemStatement,
      targetWorkState.threadTitle,
      fallbackFocus,
    ]) ?? targetWorkState.threadTitle;
  if (candidateProblemStatement) {
    targetWorkState.problemStatement = candidateProblemStatement;
  }
  if (candidateConclusion) {
    targetWorkState.lastConclusion = candidateConclusion;
    if (!targetWorkState.nextStep) {
      targetWorkState.nextStep = candidateConclusion;
    }
  }
}

function deriveAssistantConclusion(assistantReplyText: string | null): string | null {
  if (!assistantReplyText) {
    return null;
  }
  const firstParagraph = assistantReplyText
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .find(Boolean);
  const source = firstParagraph ?? assistantReplyText;
  const firstSentence = source.split(/(?<=[.!?])\s+/).find((part) => part.trim().length > 0);
  return normalizeConversationText(firstSentence ?? source, 220);
}

function applyConversationTurnToSelfState(
  selfState: ConsciousnessKernelSelfState,
  update: ConsciousnessKernelConversationTurn,
): { now: string; summary: string; lane: ConsciousnessKernelWorkLane } {
  const now = update.now ?? nowIso();
  const sessionKey = normalizeConversationText(update.sessionKey, 160);
  const channel = normalizeConversationText(update.channel, 80);
  const userMessageText = normalizeConversationText(update.userMessageText, 500);
  const assistantReplyText = normalizeConversationText(update.assistantReplyText, 700);
  const assistantConclusion =
    normalizeConversationText(update.assistantConclusion, 220) ??
    deriveAssistantConclusion(assistantReplyText);

  if (sessionKey) {
    selfState.conversation.activeSessionKey = sessionKey;
  }
  if (channel) {
    selfState.conversation.activeChannel = channel;
  }
  selfState.conversation.lastUpdatedAt = now;
  if (userMessageText) {
    selfState.conversation.lastUserMessageAt = now;
    selfState.conversation.lastUserMessageText = userMessageText;
  }
  if (assistantReplyText) {
    selfState.conversation.lastAssistantReplyAt = now;
    selfState.conversation.lastAssistantReplyText = assistantReplyText;
  }
  if (assistantConclusion) {
    selfState.conversation.lastAssistantConclusion = assistantConclusion;
  }
  const lane = resolveConversationWorkLane(channel, sessionKey);
  const targetWorkState = resolveWorkStateForLane(selfState, lane);
  const fallbackFocus =
    lane === "background"
      ? (resolveConsciousnessKernelBackgroundFocus(selfState) ?? selfState.agency.currentFocus)
      : (resolveConsciousnessKernelOperatorFocus(selfState) ?? selfState.agency.currentFocus);
  syncWorkLaneFromConversation({
    targetWorkState,
    fallbackFocus,
    lane,
    now,
    userMessageText,
    assistantConclusion,
  });

  return {
    now,
    summary: `conversation sync (${lane}:${channel ?? sessionKey ?? "unknown"}): ${assistantConclusion ?? userMessageText ?? "continuity updated"}`,
    lane,
  };
}

function resolveSnapshotStatus(params: { stopped: boolean; resolved: ResolvedKernelConfig }): {
  status: ConsciousnessKernelStatus;
  active: boolean;
  blockedReason?: string;
} {
  if (params.stopped) {
    return { status: "stopped", active: false };
  }
  if (!params.resolved.enabled || params.resolved.mode === "off") {
    return { status: "disabled", active: false };
  }
  if (params.resolved.mode !== "shadow") {
    return { status: "blocked", active: false, blockedReason: BLOCKED_REASON };
  }
  return { status: "running", active: true };
}

function setWakefulness(
  selfState: ConsciousnessKernelSelfState,
  nextState: ConsciousnessKernelWakefulness,
  now: string,
) {
  if (selfState.wakefulness.state === nextState) {
    return;
  }
  selfState.wakefulness = {
    state: nextState,
    changedAt: now,
  };
}

function refreshSelfStateBudgetWindows(selfState: ConsciousnessKernelSelfState, now: string) {
  const dayKey = now.slice(0, 10);
  const hourKey = now.slice(0, 13);
  if (selfState.budgets.dayKey !== dayKey) {
    selfState.budgets.dayKey = dayKey;
    selfState.budgets.spentToday = 0;
  }
  if (selfState.budgets.hourKey !== hourKey) {
    selfState.budgets.hourKey = hourKey;
    selfState.budgets.escalationsThisHour = 0;
  }
}

export function getConsciousnessKernelSnapshot(): ConsciousnessKernelSnapshot | null {
  return currentSnapshot ? { ...currentSnapshot } : null;
}

export function resetConsciousnessKernelStateForTest() {
  currentSnapshot = null;
  lastDiagnosticSignature = null;
  liveConversationTurnUpdater = null;
}

export function recordConsciousnessKernelConversationTurn(
  params: ConsciousnessKernelConversationTurn,
): boolean {
  const cfg = params.cfg ?? loadConfig();
  const resolved = resolveKernelConfig(cfg);
  if (!resolved.enabled || !resolved.defaultAgentId || params.agentId !== resolved.defaultAgentId) {
    return false;
  }

  if (liveConversationTurnUpdater?.(params)) {
    return true;
  }

  const paths = resolveConsciousnessKernelPaths(cfg, params.agentId);
  const state =
    loadConsciousnessKernelSelfState(paths.statePath) ??
    createConsciousnessKernelSelfState({
      agentId: params.agentId,
      now: params.now ?? nowIso(),
      dailyBudget: resolved.dailyBudget,
      maxEscalationsPerHour: resolved.maxEscalationsPerHour,
      hardwareHostRequired: resolved.hardwareHostRequired,
      allowListening: resolved.allowListening,
      allowVision: resolved.allowVision,
    });

  state.budgets.dailyBudget = resolved.dailyBudget;
  state.budgets.maxEscalationsPerHour = resolved.maxEscalationsPerHour;
  state.perception.hardwareHostRequired = resolved.hardwareHostRequired;
  state.perception.allowListening = resolved.allowListening;
  state.perception.allowVision = resolved.allowVision;
  const authority = resolveConsciousnessKernelAuthority(cfg);
  state.authority.ownsAutonomousScheduling = authority.schedulerAuthorityActive;
  state.authority.suppressesAutonomousContemplation = authority.suppressesAutonomousContemplation;
  state.authority.suppressesAutonomousSis = authority.suppressesAutonomousSis;
  const eventNow = params.now ?? nowIso();
  setWakefulness(state, "engaged", eventNow);
  const applied = applyConversationTurnToSelfState(state, { ...params, now: eventNow });
  state.recentDecision = {
    ts: applied.now,
    kind: "conversation-sync",
    summary: applied.summary,
  };
  state.decisionCount += 1;
  state.lastError = null;
  persistConsciousnessKernelSelfState(paths.statePath, {
    ...state,
    continuity: {
      ...state.continuity,
      lastPersistedAt: applied.now,
    },
  });
  const { status, active, blockedReason } = resolveSnapshotStatus({
    stopped: false,
    resolved,
  });
  appendConsciousnessKernelDecision(paths.decisionLogPath, {
    seq: state.decisionCount,
    ts: applied.now,
    agentId: params.agentId,
    mode: resolved.mode,
    status,
    active,
    kind: "conversation-sync",
    summary: applied.summary,
    wakefulness: state.wakefulness.state,
    tickCount: state.shadow.totalTickCount,
    totalTickCount: state.shadow.totalTickCount,
    blockedReason,
  });
  return true;
}

export function startConsciousnessKernel(opts: {
  cfg?: ArgentConfig;
  schedulerHooks?: ConsciousnessKernelSchedulerHooks;
}): ConsciousnessKernelRunner {
  let cfg = opts.cfg ?? loadConfig();
  const schedulerHooks = opts.schedulerHooks ?? {};
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startedAt: string | null = null;
  let lastTickAt: string | null = null;
  let tickCount = 0;
  let currentAgentId: string | null = null;
  let currentPaths: ConsciousnessKernelPaths | null = null;
  let selfState: ConsciousnessKernelSelfState | null = null;
  let lastError: string | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const buildSnapshot = (resolved = resolveKernelConfig(cfg)): ConsciousnessKernelSnapshot => {
    const authority = resolveConsciousnessKernelAuthority(cfg);
    const { status, active, blockedReason } = resolveSnapshotStatus({ stopped, resolved });
    const continuityState = selfState ? resolveConsciousnessKernelContinuityState(selfState) : null;
    const derivedAgendaTitle = selfState
      ? resolveConsciousnessKernelDerivedAgendaTitle(selfState)
      : null;
    const activeLane = selfState
      ? (resolveAgendaSourceWorkLane(selfState.agenda.activeItem?.source) ??
        continuityState?.lane ??
        null)
      : null;
    const activeLaneThreadTitle = selfState
      ? activeLane === "background"
        ? (normalizeConsciousnessKernelThreadTitle(selfState.backgroundWork.threadTitle) ??
          (selfState.agenda.activeItem?.source === "background" ? derivedAgendaTitle : null))
        : activeLane === "operator"
          ? (normalizeConsciousnessKernelThreadTitle(selfState.activeWork.threadTitle) ??
            (selfState.agenda.activeItem?.source === "operator" ? derivedAgendaTitle : null))
          : null
      : null;
    const activeLaneFocus = selfState
      ? activeLane === "background"
        ? (activeLaneThreadTitle ??
          resolveConsciousnessKernelBackgroundFocus(selfState) ??
          derivedAgendaTitle ??
          selfState.agency.currentFocus)
        : activeLane === "operator"
          ? (activeLaneThreadTitle ??
            resolveConsciousnessKernelOperatorFocus(selfState) ??
            derivedAgendaTitle ??
            selfState.agency.currentFocus)
          : (continuityState?.focus ?? selfState.agency.currentFocus ?? null)
      : null;
    return {
      ...resolved,
      status,
      active,
      startedAt,
      lastTickAt,
      tickCount,
      blockedReason,
      wakefulnessState:
        selfState?.wakefulness.state ?? (status === "running" ? "reflective" : "dormant"),
      statePath: currentPaths?.statePath ?? null,
      decisionLogPath: currentPaths?.decisionLogPath ?? null,
      lastPersistedAt: selfState?.continuity.lastPersistedAt ?? null,
      bootCount: selfState?.continuity.bootCount ?? 0,
      resumeCount: selfState?.continuity.resumeCount ?? 0,
      totalTickCount: selfState?.shadow.totalTickCount ?? 0,
      decisionCount: selfState?.decisionCount ?? 0,
      lastDecisionAt: selfState?.recentDecision?.ts ?? null,
      lastDecisionKind: selfState?.recentDecision?.kind ?? null,
      lastReflectionAt: selfState?.agency.lastReflectionAt ?? null,
      reflectionModel: selfState?.agency.reflectionModel ?? null,
      currentFocus: selfState?.agency.currentFocus ?? null,
      effectiveFocus: continuityState?.focus ?? null,
      activeLane,
      activeLaneFocus,
      activeLaneThreadTitle,
      continuityLane: continuityState?.lane ?? null,
      continuitySource: continuityState?.source ?? null,
      continuityUpdatedAt: continuityState?.updatedAt ?? null,
      continuityThreadTitle: continuityState?.threadTitle ?? null,
      continuityProblemStatement: continuityState?.problemStatement ?? null,
      continuityLastConclusion: continuityState?.lastConclusion ?? null,
      continuityNextStep: continuityState?.nextStep ?? null,
      desiredAction: selfState?.agency.desiredAction ?? null,
      selfSummary: selfState?.agency.selfSummary ?? null,
      agendaUpdatedAt: selfState?.agenda.updatedAt ?? null,
      agendaInterests: selfState ? [...selfState.agenda.interests] : [],
      agendaOpenQuestions: selfState ? [...selfState.agenda.openQuestions] : [],
      agendaCandidateItems: selfState
        ? selfState.agenda.candidateItems.map((item) => ({ ...item }))
        : [],
      agendaActiveTitle: derivedAgendaTitle,
      agendaActiveSource: selfState?.agenda.activeItem?.source ?? null,
      agendaActiveRationale: selfState?.agenda.activeItem?.rationale ?? null,
      executiveUpdatedAt: selfState?.executive.updatedAt ?? null,
      executiveWorkTitle: selfState?.executive.work?.title ?? null,
      executiveWorkLane: selfState?.executive.work?.lane ?? null,
      executiveLastActionAt: selfState?.executive.lastActionAt ?? null,
      executiveLastActionKind: selfState?.executive.lastActionKind ?? null,
      executiveLastActionSummary: selfState?.executive.lastActionSummary ?? null,
      executiveLastArtifactAt: selfState?.executive.lastArtifactAt ?? null,
      executiveLastArtifactType: selfState?.executive.lastArtifactType ?? null,
      executiveLastArtifactPath: selfState?.executive.lastArtifactPath ?? null,
      executiveArtifactCount: selfState?.executive.artifactCount ?? 0,
      executivePendingSurfaceMode: selfState?.executive.pendingSurface?.mode ?? null,
      executivePendingSurfaceTitle: selfState?.executive.pendingSurface?.title ?? null,
      executivePendingSurfaceSummary: selfState?.executive.pendingSurface?.summary ?? null,
      reflectionRepeatCount: selfState?.shadow.reflectionRepeatCount ?? 0,
      activeWorkUpdatedAt: selfState?.activeWork.updatedAt ?? null,
      activeWorkThreadTitle: selfState?.activeWork.threadTitle ?? null,
      activeWorkProblemStatement: selfState?.activeWork.problemStatement ?? null,
      activeWorkLastConclusion: selfState?.activeWork.lastConclusion ?? null,
      activeWorkNextStep: selfState?.activeWork.nextStep ?? null,
      backgroundWorkUpdatedAt: selfState?.backgroundWork.updatedAt ?? null,
      backgroundWorkThreadTitle: selfState?.backgroundWork.threadTitle ?? null,
      backgroundWorkProblemStatement: selfState?.backgroundWork.problemStatement ?? null,
      backgroundWorkLastConclusion: selfState?.backgroundWork.lastConclusion ?? null,
      backgroundWorkNextStep: selfState?.backgroundWork.nextStep ?? null,
      activeConversationSessionKey: selfState?.conversation.activeSessionKey ?? null,
      activeConversationChannel: selfState?.conversation.activeChannel ?? null,
      lastConversationAt: selfState?.conversation.lastUpdatedAt ?? null,
      lastUserMessageAt: selfState?.conversation.lastUserMessageAt ?? null,
      lastAssistantReplyAt: selfState?.conversation.lastAssistantReplyAt ?? null,
      lastAssistantConclusion: selfState?.conversation.lastAssistantConclusion ?? null,
      lastError,
      schedulerAuthorityActive: authority.schedulerAuthorityActive,
      suppressesAutonomousContemplation: authority.suppressesAutonomousContemplation,
      suppressesAutonomousSis: authority.suppressesAutonomousSis,
    };
  };

  const ensureSelfState = (resolved: ResolvedKernelConfig, createIfMissing: boolean) => {
    const agentId = resolved.defaultAgentId;
    if (!agentId) {
      currentAgentId = null;
      currentPaths = null;
      selfState = null;
      return;
    }
    const nextPaths = resolveConsciousnessKernelPaths(cfg, agentId);
    const shouldReload =
      currentAgentId !== agentId ||
      !currentPaths ||
      currentPaths.statePath !== nextPaths.statePath ||
      selfState?.agentId !== agentId;
    currentAgentId = agentId;
    currentPaths = nextPaths;
    if (shouldReload) {
      selfState = loadConsciousnessKernelSelfState(nextPaths.statePath);
    }
    if (!selfState && createIfMissing) {
      selfState = createConsciousnessKernelSelfState({
        agentId,
        now: nowIso(),
        dailyBudget: resolved.dailyBudget,
        maxEscalationsPerHour: resolved.maxEscalationsPerHour,
        hardwareHostRequired: resolved.hardwareHostRequired,
        allowListening: resolved.allowListening,
        allowVision: resolved.allowVision,
      });
    }
  };

  const syncSelfStateConfig = (resolved: ResolvedKernelConfig, now: string) => {
    if (!selfState) {
      return;
    }
    const authority = resolveConsciousnessKernelAuthority(cfg);
    selfState.agentId = resolved.defaultAgentId ?? selfState.agentId;
    refreshSelfStateBudgetWindows(selfState, now);
    selfState.budgets.dailyBudget = resolved.dailyBudget;
    selfState.budgets.maxEscalationsPerHour = resolved.maxEscalationsPerHour;
    selfState.perception.hardwareHostRequired = resolved.hardwareHostRequired;
    selfState.perception.allowListening = resolved.allowListening;
    selfState.perception.allowVision = resolved.allowVision;
    selfState.authority.ownsAutonomousScheduling = authority.schedulerAuthorityActive;
    selfState.authority.suppressesAutonomousContemplation =
      authority.suppressesAutonomousContemplation;
    selfState.authority.suppressesAutonomousSis = authority.suppressesAutonomousSis;
  };

  const persistSelfState = (now: string): boolean => {
    if (!selfState || !currentPaths) {
      return false;
    }
    try {
      const nextState: ConsciousnessKernelSelfState = {
        ...selfState,
        continuity: {
          ...selfState.continuity,
          lastPersistedAt: now,
        },
        recentDecision: selfState.recentDecision ? { ...selfState.recentDecision } : null,
        agenda: {
          ...selfState.agenda,
          interests: [...selfState.agenda.interests],
          openQuestions: [...selfState.agenda.openQuestions],
          candidateItems: selfState.agenda.candidateItems.map((item) => ({ ...item })),
          activeItem: selfState.agenda.activeItem ? { ...selfState.agenda.activeItem } : null,
        },
        executive: {
          ...selfState.executive,
          work: selfState.executive.work
            ? {
                ...selfState.executive.work,
                hypotheses: [...selfState.executive.work.hypotheses],
                evidence: [...selfState.executive.work.evidence],
                attemptedActions: [...selfState.executive.work.attemptedActions],
                progressSignals: [...selfState.executive.work.progressSignals],
              }
            : null,
          pendingSurface: selfState.executive.pendingSurface
            ? { ...selfState.executive.pendingSurface }
            : null,
        },
        concerns: [...selfState.concerns],
        lastError: selfState.lastError,
      };
      persistConsciousnessKernelSelfState(currentPaths.statePath, nextState);
      selfState = nextState;
      lastError = nextState.lastError;
      return true;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (selfState) {
        selfState.lastError = lastError;
      }
      log.warn("consciousness kernel: persist failed", {
        error: lastError,
        statePath: currentPaths.statePath,
      });
      return false;
    }
  };

  const recordDecision = (params: {
    resolved: ResolvedKernelConfig;
    now: string;
    kind: ConsciousnessKernelDecisionKind;
    summary: string;
  }) => {
    if (!selfState || !currentPaths || !currentAgentId) {
      return;
    }
    const snapshot = buildSnapshot(params.resolved);
    const entry: ConsciousnessKernelDecisionEntry = {
      seq: selfState.decisionCount + 1,
      ts: params.now,
      agentId: currentAgentId,
      mode: snapshot.mode,
      status: snapshot.status,
      kind: params.kind,
      summary: params.summary,
      active: snapshot.active,
      wakefulness: selfState.wakefulness.state,
      tickCount,
      totalTickCount: selfState.shadow.totalTickCount,
      blockedReason: snapshot.blockedReason,
    };
    try {
      appendConsciousnessKernelDecision(currentPaths.decisionLogPath, entry);
      selfState.decisionCount = entry.seq;
      selfState.recentDecision = {
        ts: params.now,
        kind: params.kind,
        summary: params.summary,
      };
      selfState.lastError = null;
      persistSelfState(params.now);
      emitKernelDecisionEvent(cfg, buildSnapshot(params.resolved), entry);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (selfState) {
        selfState.lastError = lastError;
      }
      log.warn("consciousness kernel: decision ledger append failed", {
        error: lastError,
        decisionLogPath: currentPaths.decisionLogPath,
      });
      persistSelfState(params.now);
    }
  };

  const recordConversationTurn = (update: ConsciousnessKernelConversationTurn): boolean => {
    if (
      stopped ||
      !selfState ||
      !currentPaths ||
      !currentAgentId ||
      update.agentId !== currentAgentId
    ) {
      return false;
    }
    const resolved = resolveKernelConfig(cfg);
    if (!resolved.enabled || resolved.defaultAgentId !== currentAgentId) {
      return false;
    }
    const eventNow = update.now ?? nowIso();
    syncSelfStateConfig(resolved, eventNow);
    setWakefulness(selfState, "engaged", eventNow);
    const applied = applyConversationTurnToSelfState(selfState, { ...update, now: eventNow });
    const continuityState = resolveConsciousnessKernelContinuityState(selfState);
    recordDecision({
      resolved,
      now: applied.now,
      kind: "conversation-sync",
      summary: applied.summary,
    });
    setSnapshot(cfg, buildSnapshot(resolved));
    log.info("consciousness kernel: conversation sync", {
      agentId: update.agentId,
      sessionKey: selfState.conversation.activeSessionKey,
      channel: selfState.conversation.activeChannel,
      lane: applied.lane,
      conclusion: selfState.conversation.lastAssistantConclusion,
      operatorWorkThread: selfState.activeWork.threadTitle,
      operatorWorkNextStep: selfState.activeWork.nextStep,
      backgroundWorkThread: selfState.backgroundWork.threadTitle,
      backgroundWorkNextStep: selfState.backgroundWork.nextStep,
      effectiveFocus: continuityState.focus,
      activeLane: applied.lane,
      activeLaneFocus:
        applied.lane === "background"
          ? resolveConsciousnessKernelBackgroundFocus(selfState)
          : resolveConsciousnessKernelOperatorFocus(selfState),
      activeLaneThreadTitle:
        applied.lane === "background"
          ? selfState.backgroundWork.threadTitle
          : selfState.activeWork.threadTitle,
      continuityLane: continuityState.lane,
      continuitySource: continuityState.source,
      continuityThreadTitle: continuityState.threadTitle,
      continuityProblemStatement: continuityState.problemStatement,
      continuityLastConclusion: continuityState.lastConclusion,
      continuityNextStep: continuityState.nextStep,
    });
    return true;
  };

  liveConversationTurnUpdater = recordConversationTurn;

  const maybeRunManagedContemplation = async (resolved: ResolvedKernelConfig, now: string) => {
    if (!schedulerHooks.contemplation || !resolved.defaultAgentId) {
      return;
    }
    const snapshot = schedulerHooks.contemplation.getSnapshot();
    if (
      !snapshot.defaultAgentAutonomousSchedulingSuppressed ||
      typeof snapshot.defaultAgentNextDueMs !== "number" ||
      snapshot.defaultAgentNextDueMs > Date.now()
    ) {
      return;
    }
    try {
      const result = await schedulerHooks.contemplation.runNow(resolved.defaultAgentId);
      if (selfState) {
        recordDecision({
          resolved,
          now,
          kind: "contemplation-dispatch",
          summary:
            result.status === "ran"
              ? `kernel invoked contemplation for ${resolved.defaultAgentId}`
              : `kernel contemplation dispatch skipped (${result.reason ?? "unknown"})`,
        });
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (selfState) {
        selfState.lastError = lastError;
        persistSelfState(now);
      }
      log.warn("consciousness kernel: contemplation dispatch failed", {
        error: lastError,
        agentId: resolved.defaultAgentId,
      });
    }
  };

  const maybeRunManagedSis = async (resolved: ResolvedKernelConfig, now: string) => {
    if (!schedulerHooks.sis) {
      return;
    }
    const snapshot = schedulerHooks.sis.getSnapshot();
    if (
      !snapshot.autonomousSchedulingSuppressed ||
      snapshot.running ||
      typeof snapshot.nextDueMs !== "number" ||
      snapshot.nextDueMs > Date.now()
    ) {
      return;
    }
    try {
      const result = await schedulerHooks.sis.runNow();
      if (selfState) {
        recordDecision({
          resolved,
          now,
          kind: "sis-dispatch",
          summary:
            result.status === "ran"
              ? `kernel invoked SIS consolidation (${result.patternsFound ?? 0} patterns)`
              : `kernel SIS dispatch skipped (${result.reason ?? "unknown"})`,
        });
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (selfState) {
        selfState.lastError = lastError;
        persistSelfState(now);
      }
      log.warn("consciousness kernel: SIS dispatch failed", {
        error: lastError,
      });
    }
  };

  const maybeRunManagedSubsystems = async (resolved: ResolvedKernelConfig, now: string) => {
    if (!resolveConsciousnessKernelAuthority(cfg).schedulerAuthorityActive) {
      return;
    }
    await maybeRunManagedContemplation(resolved, now);
    await maybeRunManagedSis(resolved, now);
  };

  const maybeRunInnerReflection = async (resolved: ResolvedKernelConfig, now: string) => {
    if (!selfState || !currentAgentId || !resolved.localModel) {
      return;
    }
    try {
      const result = await runConsciousnessKernelInnerLoop({
        cfg,
        agentId: currentAgentId,
        localModelRef: resolved.localModel,
        selfState,
        tickCount: selfState.shadow.totalTickCount,
        now,
      });
      if (result.status !== "reflected") {
        log.info("consciousness kernel: reflection skipped", {
          model: resolved.localModel,
          reason: result.reason,
        });
        return;
      }
      let appliedReflection: ConsciousnessKernelReflection = {
        ...result.reflection,
        candidateItems: result.reflection.candidateItems.map((item) => ({ ...item })),
        activeItem: result.reflection.activeItem ? { ...result.reflection.activeItem } : null,
      };
      let reflectionLane = resolveReflectionWorkLane(
        selfState,
        appliedReflection.activeItem?.source,
      );
      let reflectionWorkState = resolveWorkStateForLane(selfState, reflectionLane);
      let reflectionThreadTitle = resolveReflectionThreadTitle({
        reflectionThreadTitle: appliedReflection.threadTitle,
        reflectionLane,
        activeItem: appliedReflection.activeItem,
        reflectionWorkState,
      });
      reflectionThreadTitle = resolveStableWorkThreadTitle({
        reflectionWorkState,
        proposedTitle: reflectionThreadTitle,
        proposedProblemStatement: appliedReflection.problemStatement,
        proposedLastConclusion: appliedReflection.lastConclusion,
        proposedNextStep: appliedReflection.nextStep,
      });
      if (reflectionThreadTitle) {
        appliedReflection.focus = reflectionThreadTitle;
      }
      const initialReflectionSignature = buildReflectionSignature({
        reflectionLane,
        focus: appliedReflection.focus,
        desiredAction: appliedReflection.desiredAction,
        threadTitle: reflectionThreadTitle,
        problemStatement: appliedReflection.problemStatement,
        lastConclusion: appliedReflection.lastConclusion,
        nextStep: appliedReflection.nextStep,
        activeItem: appliedReflection.activeItem,
        concerns: appliedReflection.concerns,
      });
      let stallPressureReason: string | null = null;
      if (
        selfState.shadow.lastReflectionSignature === initialReflectionSignature &&
        selfState.shadow.reflectionRepeatCount >= 1
      ) {
        const pressured = buildStallPressureReflection({
          reflection: appliedReflection,
          reflectionLane,
          reflectionThreadTitle,
        });
        if (pressured) {
          appliedReflection = pressured.reflection;
          reflectionLane = resolveReflectionWorkLane(
            selfState,
            appliedReflection.activeItem?.source,
          );
          reflectionWorkState = resolveWorkStateForLane(selfState, reflectionLane);
          reflectionThreadTitle = resolveReflectionThreadTitle({
            reflectionThreadTitle: appliedReflection.threadTitle,
            reflectionLane,
            activeItem: appliedReflection.activeItem,
            reflectionWorkState,
          });
          reflectionThreadTitle = resolveStableWorkThreadTitle({
            reflectionWorkState,
            proposedTitle: reflectionThreadTitle,
            proposedProblemStatement: appliedReflection.problemStatement,
            proposedLastConclusion: appliedReflection.lastConclusion,
            proposedNextStep: appliedReflection.nextStep,
          });
          if (reflectionThreadTitle) {
            appliedReflection.focus = reflectionThreadTitle;
          }
          stallPressureReason = pressured.reason;
        }
      }
      const synchronizedAgenda = synchronizeAgendaTitleWithThread({
        candidateItems: appliedReflection.candidateItems,
        activeItem: appliedReflection.activeItem,
        reflectionLane,
        canonicalThreadTitle: reflectionThreadTitle,
      });
      appliedReflection = {
        ...appliedReflection,
        candidateItems: synchronizedAgenda.candidateItems,
        activeItem: synchronizedAgenda.activeItem,
      };
      selfState.agency.reflectionModel = appliedReflection.modelRef;
      selfState.agency.lastReflectionAt = now;
      selfState.agency.currentFocus = appliedReflection.focus;
      selfState.agency.desiredAction = appliedReflection.desiredAction;
      selfState.agency.selfSummary = appliedReflection.summary;
      reflectionWorkState.updatedAt = now;
      reflectionWorkState.threadTitle = reflectionThreadTitle;
      reflectionWorkState.problemStatement = appliedReflection.problemStatement;
      reflectionWorkState.lastConclusion = appliedReflection.lastConclusion;
      reflectionWorkState.nextStep = appliedReflection.nextStep;
      selfState.agenda.updatedAt = now;
      selfState.agenda.interests = [...appliedReflection.interests];
      selfState.agenda.openQuestions = [...appliedReflection.openQuestions];
      selfState.agenda.candidateItems = appliedReflection.candidateItems.map((item) => ({
        ...item,
      }));
      selfState.agenda.activeItem = appliedReflection.activeItem
        ? { ...appliedReflection.activeItem }
        : null;
      selfState.concerns = appliedReflection.concerns;
      setWakefulness(selfState, appliedReflection.wakefulness, now);
      const reflectionSignature = buildReflectionSignature({
        reflectionLane,
        focus: appliedReflection.focus,
        desiredAction: appliedReflection.desiredAction,
        threadTitle: reflectionThreadTitle,
        problemStatement: appliedReflection.problemStatement,
        lastConclusion: appliedReflection.lastConclusion,
        nextStep: appliedReflection.nextStep,
        activeItem: selfState.agenda.activeItem,
        concerns: appliedReflection.concerns,
      });
      const reflectionRepeated = selfState.shadow.lastReflectionSignature === reflectionSignature;
      selfState.shadow.lastReflectionSignature = reflectionSignature;
      selfState.shadow.reflectionRepeatCount = reflectionRepeated
        ? selfState.shadow.reflectionRepeatCount + 1
        : 0;
      const repeatCount = selfState.shadow.reflectionRepeatCount + 1;
      const reflectionQuiesced =
        reflectionRepeated && repeatCount >= STALLED_REFLECTION_QUIET_THRESHOLD;
      if (reflectionQuiesced) {
        const quietFocus =
          resolveConsciousnessKernelContinuityState(selfState).threadTitle ??
          resolveConsciousnessKernelContinuityState(selfState).focus ??
          selfState.agenda.activeItem?.title ??
          appliedReflection.focus;
        selfState.agency.desiredAction = "hold";
        selfState.agency.selfSummary = `Stall guard engaged on ${quietFocus}; waiting for new evidence or a better alternate.`;
      }
      recordDecision({
        resolved,
        now,
        kind: "reflection",
        summary: reflectionQuiesced
          ? `hold: stalled x${repeatCount} (${selfState.agenda.activeItem?.title ?? appliedReflection.focus})`
          : reflectionRepeated
            ? `${appliedReflection.desiredAction}: unchanged x${repeatCount} (${selfState.agenda.activeItem?.title ?? appliedReflection.focus})`
            : stallPressureReason
              ? `${appliedReflection.desiredAction}: ${stallPressureReason}`
              : `${appliedReflection.desiredAction}: ${appliedReflection.focus}${reflectionThreadTitle ? ` [${reflectionThreadTitle}]` : ""}`,
      });
      const continuityState = resolveConsciousnessKernelContinuityState(selfState);
      if (reflectionQuiesced) {
        if (shouldEmitQuiescedReflectionLog(repeatCount)) {
          log.info("consciousness kernel: reflection quiesced", {
            model: appliedReflection.modelRef,
            repeatCount,
            focus: appliedReflection.focus,
            effectiveFocus: continuityState.focus,
            activeLane: reflectionLane,
            activeLaneFocus: appliedReflection.focus,
            activeLaneThreadTitle: reflectionThreadTitle,
            lane: reflectionLane,
            continuityLane: continuityState.lane,
            continuitySource: continuityState.source,
            threadTitle: continuityState.threadTitle,
            agendaActiveTitle: resolveConsciousnessKernelDerivedAgendaTitle(selfState),
            agendaActiveSource: selfState.agenda.activeItem?.source ?? null,
            nextStep: continuityState.nextStep ?? appliedReflection.nextStep,
          });
        }
      } else if (reflectionRepeated) {
        log.info("consciousness kernel: reflection unchanged", {
          model: appliedReflection.modelRef,
          repeatCount,
          focus: appliedReflection.focus,
          effectiveFocus: continuityState.focus,
          activeLane: reflectionLane,
          activeLaneFocus: appliedReflection.focus,
          activeLaneThreadTitle: reflectionThreadTitle,
          lane: reflectionLane,
          continuityLane: continuityState.lane,
          continuitySource: continuityState.source,
          threadTitle: continuityState.threadTitle ?? reflectionThreadTitle,
          agendaActiveTitle: resolveConsciousnessKernelDerivedAgendaTitle(selfState),
          agendaActiveSource: selfState.agenda.activeItem?.source ?? null,
          nextStep: appliedReflection.nextStep,
        });
      } else {
        log.info("consciousness kernel: reflection", {
          model: appliedReflection.modelRef,
          wakefulness: appliedReflection.wakefulness,
          desiredAction: appliedReflection.desiredAction,
          focus: appliedReflection.focus,
          effectiveFocus: continuityState.focus,
          activeLane: reflectionLane,
          activeLaneFocus: appliedReflection.focus,
          activeLaneThreadTitle: reflectionThreadTitle,
          lane: reflectionLane,
          continuityLane: continuityState.lane,
          continuitySource: continuityState.source,
          summary: appliedReflection.summary,
          threadTitle: reflectionThreadTitle,
          problemStatement: appliedReflection.problemStatement,
          lastConclusion: appliedReflection.lastConclusion,
          nextStep: appliedReflection.nextStep,
          continuityThreadTitle: continuityState.threadTitle,
          continuityProblemStatement: continuityState.problemStatement,
          continuityLastConclusion: continuityState.lastConclusion,
          continuityNextStep: continuityState.nextStep,
          agendaInterests: appliedReflection.interests,
          agendaOpenQuestions: appliedReflection.openQuestions,
          agendaActiveTitle: resolveConsciousnessKernelDerivedAgendaTitle(selfState),
          agendaActiveSource: appliedReflection.activeItem?.source ?? null,
          agendaActiveRationale: appliedReflection.activeItem?.rationale ?? null,
          agendaCandidates: appliedReflection.candidateItems,
          concerns: appliedReflection.concerns,
          stallPressure: stallPressureReason,
        });
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (selfState) {
        selfState.lastError = lastError;
        persistSelfState(now);
      }
      log.warn("consciousness kernel: inner reflection failed", {
        error: lastError,
        model: resolved.localModel,
      });
    }
  };

  const maybeRunExecutiveCycle = async (resolved: ResolvedKernelConfig, now: string) => {
    if (!selfState || !currentAgentId || !currentPaths) {
      return;
    }
    if (
      selfState.budgets.dailyBudget > 0 &&
      selfState.budgets.spentToday >= selfState.budgets.dailyBudget
    ) {
      return;
    }
    const sessionKey =
      selfState.conversation.activeSessionKey ?? `agent:${currentAgentId}:kernel:autonomy`;
    try {
      const result = await runConsciousnessKernelExecutiveCycle({
        cfg,
        agentId: currentAgentId,
        now,
        sessionKey,
        paths: currentPaths,
        selfState,
      });
      if (result.status !== "acted") {
        return;
      }
      selfState.executive.updatedAt = now;
      selfState.executive.work = result.work;
      selfState.executive.lastActionAt = now;
      selfState.executive.lastActionKind = result.actionKind;
      selfState.executive.lastActionSummary = result.artifactSummary;
      selfState.executive.lastActionQuery = result.query;
      selfState.executive.lastArtifactAt = now;
      selfState.executive.lastArtifactType = result.artifactType;
      selfState.executive.lastArtifactPath = result.artifactPath;
      selfState.executive.artifactCount += 1;
      selfState.executive.pendingSurface = result.pendingSurface;
      if (selfState.budgets.dailyBudget > 0) {
        selfState.budgets.spentToday = Math.min(
          selfState.budgets.dailyBudget,
          selfState.budgets.spentToday + 1,
        );
      }
      recordDecision({
        resolved,
        now,
        kind: "executive-action",
        summary: `${result.actionKind}: ${result.work.title ?? result.artifactSummary}`,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (selfState) {
        selfState.lastError = lastError;
        persistSelfState(now);
      }
      log.warn("consciousness kernel: executive cycle failed", {
        error: lastError,
      });
    }
  };

  const applyDormantState = (
    resolved: ResolvedKernelConfig,
    kind: ConsciousnessKernelDecisionKind,
    summary: string,
  ) => {
    const now = nowIso();
    const hasPersistedState = Boolean(
      resolved.defaultAgentId &&
      fs.existsSync(resolveConsciousnessKernelPaths(cfg, resolved.defaultAgentId).statePath),
    );
    ensureSelfState(resolved, Boolean(resolved.enabled || selfState || hasPersistedState));
    if (selfState) {
      syncSelfStateConfig(resolved, now);
      selfState.continuity.lastStoppedAt = now;
      setWakefulness(selfState, "dormant", now);
      recordDecision({ resolved, now, kind, summary });
    }
    const snapshot = buildSnapshot(resolved);
    setSnapshot(cfg, snapshot);
    return snapshot;
  };

  const startShadowRuntime = (
    resolved: ResolvedKernelConfig,
    reason: "started" | "config-update",
  ) => {
    const now = nowIso();
    const hadPersistedState = Boolean(
      resolved.defaultAgentId &&
      fs.existsSync(resolveConsciousnessKernelPaths(cfg, resolved.defaultAgentId).statePath),
    );
    ensureSelfState(resolved, true);
    startedAt = startedAt ?? now;
    if (tickCount < 0) {
      tickCount = 0;
    }
    if (selfState) {
      syncSelfStateConfig(resolved, now);
      if (reason === "started") {
        selfState.continuity.bootCount += 1;
        if (hadPersistedState) {
          selfState.continuity.resumeCount += 1;
        }
        selfState.continuity.lastStartedAt = now;
      }
      setWakefulness(selfState, "reflective", now);
    }
    if (reason === "started") {
      recordDecision({
        resolved,
        now,
        kind: "started",
        summary: hadPersistedState
          ? "shadow kernel resumed from durable self-state and scheduler authority"
          : "shadow kernel started with fresh durable self-state and scheduler authority",
      });
    } else if (selfState) {
      recordDecision({
        resolved,
        now,
        kind: "config-update",
        summary: "shadow kernel config updated without breaking continuity or scheduler authority",
      });
    }
    const snapshot = buildSnapshot(resolved);
    setSnapshot(cfg, snapshot);
    return snapshot;
  };

  const scheduleTick = (resolved: ResolvedKernelConfig) => {
    clearTimer();
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      void (async () => {
        if (stopped) {
          return;
        }
        const latest = resolveKernelConfig(cfg);
        if (
          !latest.enabled ||
          latest.mode !== "shadow" ||
          latest.defaultAgentId !== currentAgentId
        ) {
          resync();
          return;
        }
        const now = nowIso();
        ensureSelfState(latest, true);
        tickCount += 1;
        lastTickAt = now;
        if (selfState) {
          syncSelfStateConfig(latest, now);
          selfState.shadow.totalTickCount += 1;
          selfState.shadow.lastTickAt = now;
          setWakefulness(selfState, "reflective", now);
          recordDecision({
            resolved: latest,
            now,
            kind: "tick",
            summary: `shadow tick ${tickCount}`,
          });
        }
        await maybeRunInnerReflection(latest, now);
        await maybeRunExecutiveCycle(latest, now);
        await maybeRunManagedSubsystems(latest, now);
        setSnapshot(cfg, buildSnapshot(latest));
        scheduleTick(latest);
      })().catch((err: unknown) => {
        lastError = err instanceof Error ? err.message : String(err);
        if (selfState) {
          selfState.lastError = lastError;
          persistSelfState(nowIso());
        }
        log.warn("consciousness kernel: tick failed", {
          error: lastError,
        });
        scheduleTick(resolveKernelConfig(cfg));
      });
    }, resolved.tickMs);
    timer.unref?.();
  };

  const resync = () => {
    clearTimer();
    const resolved = resolveKernelConfig(cfg);
    const canRunShadow = !stopped && resolved.enabled && resolved.mode === "shadow";
    const sameAgent = currentAgentId === resolved.defaultAgentId;
    const isAlreadyRunningShadow = Boolean(
      startedAt && sameAgent && !stopped && resolved.mode === "shadow",
    );

    if (canRunShadow) {
      if (!isAlreadyRunningShadow) {
        startedAt = null;
        tickCount = 0;
        lastTickAt = null;
      }
      const snapshot = startShadowRuntime(
        resolved,
        isAlreadyRunningShadow ? "config-update" : "started",
      );
      if (!isAlreadyRunningShadow) {
        log.info("consciousness kernel: started", {
          mode: snapshot.mode,
          defaultAgentId: snapshot.defaultAgentId,
          tickMs: snapshot.tickMs,
          schedulerAuthorityActive: snapshot.schedulerAuthorityActive,
          statePath: snapshot.statePath,
        });
      }
      scheduleTick(resolved);
      return;
    }

    startedAt = null;
    tickCount = 0;
    lastTickAt = null;
    if (stopped) {
      const snapshot = applyDormantState(resolved, "stopped", "shadow kernel stopped");
      log.info("consciousness kernel: stopped", {
        mode: snapshot.mode,
        decisionCount: snapshot.decisionCount,
        totalTickCount: snapshot.totalTickCount,
      });
      return;
    }

    if (!resolved.enabled || resolved.mode === "off") {
      const snapshot = applyDormantState(resolved, "disabled", "kernel disabled in config");
      if (!snapshot.statePath) {
        setSnapshot(cfg, snapshot);
      }
      log.info("consciousness kernel: disabled", {
        mode: snapshot.mode,
      });
      return;
    }

    const snapshot = applyDormantState(resolved, "blocked", BLOCKED_REASON);
    log.warn("consciousness kernel: blocked", {
      mode: snapshot.mode,
      reason: snapshot.blockedReason,
    });
  };

  resync();

  return {
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      resync();
      if (liveConversationTurnUpdater === recordConversationTurn) {
        liveConversationTurnUpdater = null;
      }
    },
    updateConfig(nextCfg: ArgentConfig) {
      cfg = nextCfg;
      stopped = false;
      resync();
    },
    getSnapshot() {
      return buildSnapshot();
    },
  };
}
