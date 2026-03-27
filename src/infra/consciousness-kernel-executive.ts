import fs from "node:fs";
import path from "node:path";
import type { ArgentConfig } from "../config/config.js";
import { createWebSearchTool } from "../agents/tools/web-search.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getMemorySearchManager } from "../memory/search-manager.js";
import {
  normalizeConsciousnessKernelThreadTitle,
  resolveConsciousnessKernelContinuityState,
  type ConsciousnessKernelArtifactType,
  type ConsciousnessKernelExecutiveActionKind,
  type ConsciousnessKernelExecutiveState,
  type ConsciousnessKernelExecutiveWorkState,
  type ConsciousnessKernelPaths,
  type ConsciousnessKernelPendingSurfaceState,
  type ConsciousnessKernelSelfState,
  type ConsciousnessKernelSurfaceMode,
} from "./consciousness-kernel-state.js";
import { listSystemPresence } from "./system-presence.js";

const log = createSubsystemLogger("gateway/consciousness-kernel");
const ACTION_COOLDOWN_MS = 20 * 60 * 1000;
const INTERRUPTIBLE_WINDOW_MS = 2 * 60 * 1000;

type MemoryEvidence = {
  label: string;
  path: string;
  snippet: string;
  score: number;
};

type WebEvidence = {
  title: string;
  url: string;
  snippet: string;
};

type ExecutiveActionPlan = {
  kind: ConsciousnessKernelExecutiveActionKind;
  artifactType: ConsciousnessKernelArtifactType;
  query: string | null;
  rationale: string;
};

export type ConsciousnessKernelExecutiveCycleResult =
  | {
      status: "skipped";
      reason: string;
      work: ConsciousnessKernelExecutiveWorkState | null;
      pendingSurface: ConsciousnessKernelPendingSurfaceState | null;
    }
  | {
      status: "acted";
      work: ConsciousnessKernelExecutiveWorkState;
      pendingSurface: ConsciousnessKernelPendingSurfaceState | null;
      actionKind: ConsciousnessKernelExecutiveActionKind;
      artifactType: ConsciousnessKernelArtifactType;
      artifactPath: string;
      artifactSummary: string;
      query: string | null;
      surfaceMode: ConsciousnessKernelSurfaceMode;
      progressed: boolean;
    };

type ExecutiveDeps = {
  getMemorySearchManagerFn?: typeof getMemorySearchManager;
  createWebSearchToolFn?: typeof createWebSearchTool;
  listSystemPresenceFn?: typeof listSystemPresence;
};

type ParsedWebSearchPayload = {
  contentSummary: string | null;
  evidence: WebEvidence[];
};

function normalizeText(value: unknown, maxLength = 220): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function normalizeList(value: string[], maxItems: number, maxLength: number): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of value) {
    const normalized = normalizeText(entry, maxLength);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(normalized);
    if (items.length >= maxItems) {
      break;
    }
  }
  return items;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "work-artifact";
}

function isSameWorkTitle(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeConsciousnessKernelThreadTitle(a)?.toLowerCase();
  const right = normalizeConsciousnessKernelThreadTitle(b)?.toLowerCase();
  return Boolean(left && right && left === right);
}

function deriveHypotheses(selfState: ConsciousnessKernelSelfState): string[] {
  const questions = normalizeList(selfState.agenda.openQuestions, 4, 180);
  if (questions.length > 0) {
    return questions;
  }
  const fallback = [
    normalizeText(selfState.activeWork.nextStep, 180),
    normalizeText(selfState.backgroundWork.nextStep, 180),
  ].filter((value): value is string => Boolean(value));
  return normalizeList(fallback, 3, 180);
}

function resolveAgendaLane(
  selfState: ConsciousnessKernelSelfState,
): "operator" | "background" | null {
  const source = selfState.agenda.activeItem?.source;
  return source === "operator" || source === "background" ? source : null;
}

function resolveWorkStateForLane(
  selfState: ConsciousnessKernelSelfState,
  lane: "operator" | "background" | null,
) {
  if (lane === "background") {
    return selfState.backgroundWork;
  }
  if (lane === "operator") {
    return selfState.activeWork;
  }
  return null;
}

function deriveExecutiveWorkState(selfState: ConsciousnessKernelSelfState, now: string) {
  const continuity = resolveConsciousnessKernelContinuityState(selfState);
  const agendaLane = resolveAgendaLane(selfState);
  const lane = agendaLane ?? continuity.lane;
  const laneWorkState = resolveWorkStateForLane(selfState, lane);
  const title =
    normalizeConsciousnessKernelThreadTitle(selfState.agenda.activeItem?.title) ??
    normalizeConsciousnessKernelThreadTitle(laneWorkState?.threadTitle) ??
    normalizeConsciousnessKernelThreadTitle(continuity.threadTitle) ??
    normalizeConsciousnessKernelThreadTitle(selfState.agency.currentFocus) ??
    null;
  if (!title) {
    return null;
  }
  const existing = selfState.executive.work;
  const preserveExisting = existing && isSameWorkTitle(existing.title, title);
  return {
    updatedAt: now,
    lane,
    source: continuity.source ?? selfState.agenda.activeItem?.source ?? null,
    title,
    whyItMatters:
      normalizeText(selfState.agenda.activeItem?.rationale, 220) ??
      normalizeText(laneWorkState?.problemStatement, 220) ??
      normalizeText(continuity.problemStatement, 220) ??
      normalizeText(selfState.agency.selfSummary, 220),
    problemStatement:
      normalizeText(laneWorkState?.problemStatement, 260) ??
      normalizeText(continuity.problemStatement, 260) ??
      normalizeText(selfState.activeWork.problemStatement, 260) ??
      normalizeText(selfState.backgroundWork.problemStatement, 260),
    hypotheses: deriveHypotheses(selfState),
    evidence: preserveExisting ? [...existing.evidence] : [],
    attemptedActions: preserveExisting ? [...existing.attemptedActions] : [],
    lastConclusion:
      normalizeText(laneWorkState?.lastConclusion, 220) ??
      normalizeText(continuity.lastConclusion, 220) ??
      normalizeText(selfState.activeWork.lastConclusion, 220) ??
      normalizeText(selfState.backgroundWork.lastConclusion, 220),
    nextStep:
      normalizeText(laneWorkState?.nextStep, 220) ??
      normalizeText(continuity.nextStep, 220) ??
      normalizeText(selfState.activeWork.nextStep, 220) ??
      normalizeText(selfState.backgroundWork.nextStep, 220),
    progressSignals: preserveExisting ? [...existing.progressSignals] : [],
    stopCondition:
      selfState.perception.hardwareHostRequired && !selfState.perception.hostAttached
        ? "Wait for host attachment or new external evidence before pushing farther."
        : null,
  } satisfies ConsciousnessKernelExecutiveWorkState;
}

function deriveActionQuery(work: ConsciousnessKernelExecutiveWorkState): string | null {
  for (const candidate of [work.hypotheses[0], work.problemStatement, work.title, work.nextStep]) {
    const normalized = normalizeText(candidate, 180);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function chooseExecutiveAction(params: {
  selfState: ConsciousnessKernelSelfState;
  work: ConsciousnessKernelExecutiveWorkState;
}): ExecutiveActionPlan | null {
  const desiredAction = (params.selfState.agency.desiredAction ?? "hold").toLowerCase();
  const query = deriveActionQuery(params.work);
  switch (desiredAction) {
    case "research":
      return {
        kind: "web_research",
        artifactType: "research-brief",
        query,
        rationale: "Follow the strongest open question with external or remembered evidence.",
      };
    case "plan":
      return {
        kind: "plan_note",
        artifactType: "plan-note",
        query,
        rationale: "Turn the carried thread into explicit next moves.",
      };
    case "consolidate":
      return {
        kind: "synthesis_note",
        artifactType: "synthesis-note",
        query,
        rationale: "Compress the thread into a durable state update with evidence.",
      };
    case "reflect":
    case "observe":
      return {
        kind: "memory_research",
        artifactType: "research-brief",
        query,
        rationale:
          "Use remembered context to gather traction instead of only restating the thread.",
      };
    case "engaged":
    case "attentive":
    case "create":
      return {
        kind: "creative_draft",
        artifactType: "creative-draft",
        query,
        rationale: "Produce a bounded draft artifact rather than another internal summary.",
      };
    default:
      return null;
  }
}

function resolveSurfaceMode(params: {
  selfState: ConsciousnessKernelSelfState;
  progressed: boolean;
  listSystemPresenceFn: typeof listSystemPresence;
}): { mode: ConsciousnessKernelSurfaceMode; rationale: string } {
  if (!params.progressed) {
    return {
      mode: "hold",
      rationale: "No new traction emerged, so keep the artifact private for now.",
    };
  }
  const lastUserAt = params.selfState.conversation.lastUserMessageAt
    ? Date.parse(params.selfState.conversation.lastUserMessageAt)
    : Number.NaN;
  const recentlyActiveInConversation =
    Number.isFinite(lastUserAt) && Date.now() - lastUserAt <= INTERRUPTIBLE_WINDOW_MS;
  const recentPresence = params.listSystemPresenceFn().some((entry) => {
    if (entry.mode === "gateway") {
      return false;
    }
    return typeof entry.lastInputSeconds === "number" && entry.lastInputSeconds <= 90;
  });
  if (recentlyActiveInConversation || recentPresence) {
    return {
      mode: "interrupt",
      rationale: "Operator appears present and recently active.",
    };
  }
  return {
    mode: "queue",
    rationale: "Operator appears away or non-interruptible right now.",
  };
}

function isActionCoolingDown(params: {
  executive: ConsciousnessKernelExecutiveState;
  work: ConsciousnessKernelExecutiveWorkState;
  plan: ExecutiveActionPlan;
  nowMs: number;
}): boolean {
  const lastActionAt = params.executive.lastActionAt
    ? Date.parse(params.executive.lastActionAt)
    : NaN;
  if (!Number.isFinite(lastActionAt) || params.nowMs - lastActionAt > ACTION_COOLDOWN_MS) {
    return false;
  }
  if (params.executive.lastActionKind !== params.plan.kind) {
    return false;
  }
  if (!isSameWorkTitle(params.executive.work?.title, params.work.title)) {
    return false;
  }
  if (params.executive.lastActionQuery && params.plan.query) {
    return (
      params.executive.lastActionQuery.trim().toLowerCase() ===
      params.plan.query.trim().toLowerCase()
    );
  }
  return true;
}

async function runMemoryEvidence(params: {
  cfg: ArgentConfig;
  agentId: string;
  query: string;
  sessionKey: string;
  getMemorySearchManagerFn: typeof getMemorySearchManager;
}): Promise<MemoryEvidence[]> {
  const managerResult = await params.getMemorySearchManagerFn({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const manager = managerResult.manager;
  if (!manager) {
    return [];
  }
  try {
    const results = await manager.search(params.query, {
      maxResults: 4,
      sessionKey: params.sessionKey,
    });
    return results.slice(0, 4).map((entry) => ({
      label: `${entry.path}:${entry.startLine}`,
      path: entry.path,
      snippet: normalizeText(entry.snippet, 220) ?? "",
      score: entry.score,
    }));
  } finally {
    await manager.close?.().catch(() => {});
  }
}

function parseWebSearchPayload(details: unknown): ParsedWebSearchPayload {
  if (!details || typeof details !== "object") {
    return { contentSummary: null, evidence: [] };
  }
  const payload = details as {
    error?: string;
    content?: string;
    citations?: string[];
    results?: Array<{ title?: string; url?: string; description?: string }>;
  };
  if (typeof payload.error === "string" && payload.error.trim()) {
    return { contentSummary: null, evidence: [] };
  }
  const evidence = Array.isArray(payload.results)
    ? payload.results
        .map((entry) => ({
          title: normalizeText(entry.title, 120) ?? "Untitled result",
          url: normalizeText(entry.url, 260) ?? "",
          snippet: normalizeText(entry.description, 220) ?? "",
        }))
        .filter((entry) => entry.url)
        .slice(0, 4)
    : [];
  return {
    contentSummary: normalizeText(payload.content, 220),
    evidence,
  };
}

async function runWebEvidence(params: {
  cfg: ArgentConfig;
  sessionKey: string;
  query: string;
  createWebSearchToolFn: typeof createWebSearchTool;
}): Promise<ParsedWebSearchPayload> {
  const tool = params.createWebSearchToolFn({
    config: params.cfg,
    agentSessionKey: params.sessionKey,
  });
  if (!tool) {
    return { contentSummary: null, evidence: [] };
  }
  const result = await tool.execute("kernel-autonomous-work", {
    query: params.query,
    count: 4,
  });
  return parseWebSearchPayload(result.details);
}

function buildArtifactMarkdown(params: {
  now: string;
  work: ConsciousnessKernelExecutiveWorkState;
  plan: ExecutiveActionPlan;
  summary: string;
  memoryEvidence: MemoryEvidence[];
  webEvidence: WebEvidence[];
  surfaceMode: ConsciousnessKernelSurfaceMode;
  surfaceRationale: string;
}): string {
  const lines = [
    `# Kernel Artifact: ${params.work.title ?? "Untitled Work"}`,
    "",
    `- Time: ${params.now}`,
    `- Action: ${params.plan.kind}`,
    `- Artifact: ${params.plan.artifactType}`,
    `- Lane: ${params.work.lane ?? "none"}`,
    `- Surface: ${params.surfaceMode}`,
    `- Surface Rationale: ${params.surfaceRationale}`,
    "",
    "## Why It Matters",
    "",
    params.work.whyItMatters ?? params.work.problemStatement ?? "No explicit rationale captured.",
    "",
    "## Problem",
    "",
    params.work.problemStatement ?? "No explicit problem statement captured.",
    "",
    "## Hypotheses",
    "",
    ...(params.work.hypotheses.length > 0
      ? params.work.hypotheses.map((entry) => `- ${entry}`)
      : ["- No explicit hypotheses captured yet."]),
    "",
    "## Evidence",
    "",
  ];
  if (params.webEvidence.length === 0 && params.memoryEvidence.length === 0) {
    lines.push("- No external or memory evidence gathered on this cycle.");
  } else {
    for (const entry of params.webEvidence) {
      lines.push(
        `- Web: ${entry.title} — ${entry.url}${entry.snippet ? ` — ${entry.snippet}` : ""}`,
      );
    }
    for (const entry of params.memoryEvidence) {
      lines.push(`- Memory: ${entry.label}${entry.snippet ? ` — ${entry.snippet}` : ""}`);
    }
  }
  lines.push(
    "",
    "## Result",
    "",
    params.summary,
    "",
    "## Next Step",
    "",
    params.work.nextStep ?? "No next step captured.",
    "",
  );
  return `${lines.join("\n").trim()}\n`;
}

function writeArtifact(params: {
  paths: ConsciousnessKernelPaths;
  now: string;
  workTitle: string;
  markdown: string;
}): string {
  const dayKey = params.now.slice(0, 10);
  const timeKey = params.now.replace(/[:.]/g, "-");
  const dir = path.join(params.paths.artifactDir, dayKey);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${timeKey}-${slugify(params.workTitle)}.md`);
  fs.writeFileSync(filePath, params.markdown, "utf-8");
  return filePath;
}

function appendArtifactLedger(params: {
  paths: ConsciousnessKernelPaths;
  now: string;
  workTitle: string;
  actionKind: ConsciousnessKernelExecutiveActionKind;
  artifactType: ConsciousnessKernelArtifactType;
  artifactPath: string;
  surfaceMode: ConsciousnessKernelSurfaceMode;
  summary: string;
  query: string | null;
  progressed: boolean;
}): void {
  fs.mkdirSync(path.dirname(params.paths.artifactLedgerPath), { recursive: true });
  fs.appendFileSync(
    params.paths.artifactLedgerPath,
    `${JSON.stringify({
      ts: params.now,
      workTitle: params.workTitle,
      actionKind: params.actionKind,
      artifactType: params.artifactType,
      artifactPath: params.artifactPath,
      surfaceMode: params.surfaceMode,
      summary: params.summary,
      query: params.query,
      progressed: params.progressed,
    })}\n`,
    "utf-8",
  );
}

export async function runConsciousnessKernelExecutiveCycle(
  params: {
    cfg: ArgentConfig;
    agentId: string;
    now: string;
    sessionKey: string;
    paths: ConsciousnessKernelPaths;
    selfState: ConsciousnessKernelSelfState;
  },
  deps: ExecutiveDeps = {},
): Promise<ConsciousnessKernelExecutiveCycleResult> {
  const getMemorySearchManagerFn = deps.getMemorySearchManagerFn ?? getMemorySearchManager;
  const createWebSearchToolFn = deps.createWebSearchToolFn ?? createWebSearchTool;
  const listSystemPresenceFn = deps.listSystemPresenceFn ?? listSystemPresence;

  const work = deriveExecutiveWorkState(params.selfState, params.now);
  if (!work) {
    return { status: "skipped", reason: "no-work-object", work: null, pendingSurface: null };
  }

  const plan = chooseExecutiveAction({ selfState: params.selfState, work });
  if (!plan) {
    return {
      status: "skipped",
      reason: "no-executive-intent",
      work,
      pendingSurface: params.selfState.executive.pendingSurface,
    };
  }

  if (
    isActionCoolingDown({
      executive: params.selfState.executive,
      work,
      plan,
      nowMs: Date.parse(params.now),
    })
  ) {
    return {
      status: "skipped",
      reason: "action-cooldown",
      work,
      pendingSurface: params.selfState.executive.pendingSurface,
    };
  }

  let memoryEvidence: MemoryEvidence[] = [];
  let webEvidence: WebEvidence[] = [];
  let actionKind = plan.kind;

  if (plan.query && (plan.kind === "memory_research" || plan.kind === "web_research")) {
    memoryEvidence = await runMemoryEvidence({
      cfg: params.cfg,
      agentId: params.agentId,
      query: plan.query,
      sessionKey: params.sessionKey,
      getMemorySearchManagerFn,
    });
  }

  if (plan.query && plan.kind === "web_research") {
    const webPayload = await runWebEvidence({
      cfg: params.cfg,
      sessionKey: params.sessionKey,
      query: plan.query,
      createWebSearchToolFn,
    });
    if (webPayload.evidence.length > 0 || webPayload.contentSummary) {
      webEvidence = webPayload.evidence;
    } else {
      actionKind = "memory_research";
    }
  }

  const summary =
    actionKind === "web_research"
      ? `Ran live web research for ${work.title} and captured ${webEvidence.length} fresh result${
          webEvidence.length === 1 ? "" : "s"
        }.`
      : actionKind === "memory_research"
        ? `Searched memory for ${work.title} and captured ${memoryEvidence.length} relevant trace${
            memoryEvidence.length === 1 ? "" : "s"
          }.`
        : actionKind === "plan_note"
          ? `Drafted a concrete action plan for ${work.title}.`
          : actionKind === "creative_draft"
            ? `Drafted a bounded creative artifact for ${work.title}.`
            : `Wrote a synthesis artifact for ${work.title}.`;
  const progressed =
    webEvidence.length > 0 || memoryEvidence.length > 0 || actionKind !== "memory_research";
  const surface = resolveSurfaceMode({
    selfState: params.selfState,
    progressed,
    listSystemPresenceFn,
  });

  const nextStep =
    work.nextStep ??
    (webEvidence[0]?.url
      ? `Review ${webEvidence[0].title} and decide whether it changes the active thread.`
      : memoryEvidence[0]?.label
        ? `Use ${memoryEvidence[0].label} to sharpen the next move.`
        : "Review the artifact and decide whether it should be surfaced now.");
  const updatedWork: ConsciousnessKernelExecutiveWorkState = {
    ...work,
    updatedAt: params.now,
    evidence: normalizeList(
      [
        ...work.evidence,
        ...webEvidence.map((entry) => `${entry.title} — ${entry.url}`),
        ...memoryEvidence.map((entry) => `${entry.label} — ${entry.snippet}`),
      ],
      6,
      220,
    ),
    attemptedActions: normalizeList(
      [
        ...work.attemptedActions,
        `${params.now} ${actionKind}${plan.query ? `: ${plan.query}` : ""}`,
      ],
      6,
      160,
    ),
    lastConclusion: summary,
    nextStep,
    progressSignals: normalizeList(
      [
        ...work.progressSignals,
        progressed ? `artifact:${plan.artifactType}` : "artifact:no-progress",
      ],
      6,
      180,
    ),
  };

  const markdown = buildArtifactMarkdown({
    now: params.now,
    work: updatedWork,
    plan: { ...plan, kind: actionKind },
    summary,
    memoryEvidence,
    webEvidence,
    surfaceMode: surface.mode,
    surfaceRationale: surface.rationale,
  });
  const artifactPath = writeArtifact({
    paths: params.paths,
    now: params.now,
    workTitle: updatedWork.title ?? "work-artifact",
    markdown,
  });
  appendArtifactLedger({
    paths: params.paths,
    now: params.now,
    workTitle: updatedWork.title ?? "Untitled Work",
    actionKind,
    artifactType: plan.artifactType,
    artifactPath,
    surfaceMode: surface.mode,
    summary,
    query: plan.query,
    progressed,
  });

  const pendingSurface: ConsciousnessKernelPendingSurfaceState = {
    queuedAt: params.now,
    mode: surface.mode,
    title: updatedWork.title,
    summary,
    artifactPath,
    rationale: surface.rationale,
  };
  log.info("consciousness kernel: executive action", {
    title: updatedWork.title,
    lane: updatedWork.lane,
    actionKind,
    artifactType: plan.artifactType,
    query: plan.query,
    artifactPath,
    surfaceMode: surface.mode,
    progressed,
  });

  return {
    status: "acted",
    work: updatedWork,
    pendingSurface,
    actionKind,
    artifactType: plan.artifactType,
    artifactPath,
    artifactSummary: summary,
    query: plan.query,
    surfaceMode: surface.mode,
    progressed,
  };
}
