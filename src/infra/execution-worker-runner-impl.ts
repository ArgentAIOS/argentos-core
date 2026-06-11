import { randomUUID } from "node:crypto";
import type { ToolClaimValidation } from "../agents/tool-claim-validation.js";
import type { ArgentConfig } from "../config/config.js";
import type { AgentExecutionWorkerConfig } from "../config/types.agent-defaults.js";
import type { IntentPolicyConfig } from "../config/types.intent.js";
import type { JobRelationshipContract, Task } from "../data/types.js";
import type { CreatePersonalSkillCandidateInput } from "../memory/memu-types.js";
import { resolveAgentConfig, resolveDefaultAgentId } from "../agents/agent-scope.js";
import {
  buildIntentSystemPromptHint,
  resolveEffectiveIntentForAgent,
  resolveEffectiveIntentForDepartment,
} from "../agents/intent.js";
import { getActiveEmbeddedRunCount } from "../agents/pi-embedded-runner/runs.js";
import { evaluateRelationshipExecution } from "../agents/relationship-eval.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import { agentCommand } from "../commands/agent.js";
import { loadConfig } from "../config/config.js";
import { resolveStorePath, updateSessionStore, type SessionEntry } from "../config/sessions.js";
import { getStorageAdapter } from "../data/storage-factory.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getQueueSize } from "../process/command-queue.js";
import { CommandLane } from "../process/lanes.js";
import { buildAgentMainSessionKey, normalizeAgentId } from "../routing/session-key.js";

const log = createSubsystemLogger("gateway/execution-worker");

const DEFAULT_EVERY = "20m";
const DEFAULT_SESSION_MAIN_KEY = "worker-execution";
const DEFAULT_MAX_RUN_MINUTES = 12;
const DEFAULT_MAX_TASKS_PER_CYCLE = 24;
const DEFAULT_REQUIRE_EVIDENCE = true;
const DEFAULT_MAX_NO_PROGRESS_ATTEMPTS = 2;

export type ExecutionWorkerStatusHint = {
  kind: "paused" | "running" | "queued" | "waiting" | "blocked" | "idle";
  summary: string;
  detail?: string;
  taskSnapshot?: {
    openVisibleCount: number;
    runnableCount: number;
    dependencyBlockedCount: number;
    blockedStatusCount: number;
    pendingCount: number;
    inProgressCount: number;
    evaluatedAt: number;
  };
};

export type ExecutionWorkerControlResult = {
  ok: boolean;
  scope: "global" | "agent";
  agentId?: string;
  paused: boolean;
};

export type ExecutionWorkerMetricsResetResult = {
  ok: boolean;
  scope: "global" | "agent";
  agentId?: string;
  resetCount: number;
};

export type ExecutionWorkerDispatchResult = {
  ok: boolean;
  scope: "global" | "agent";
  agentId?: string;
  dispatched: number;
  paused: boolean;
  running: boolean;
  reason?: string;
};

export type ExecutionWorkerAgentStatus = {
  agentId: string;
  enabled: boolean;
  paused: boolean;
  running: boolean;
  rerunRequested: boolean;
  nextDueAt: number | null;
  lastRunAt: number | null;
  lastDispatchRequestedAt: number | null;
  lastDispatchReason?: string;
  statusHint: ExecutionWorkerStatusHint;
  config: {
    every: string;
    model?: string;
    sessionMainKey: string;
    maxRunMinutes: number;
    maxTasksPerCycle: number;
    scope: "assigned" | "all" | "unassigned_or_assigned";
    requireEvidence: boolean;
    maxNoProgressAttempts: number;
  };
  metrics: {
    totalRuns: number;
    totalSkips: number;
    totalAttempted: number;
    totalProgressed: number;
    totalCompleted: number;
    totalBlocked: number;
    lastStatus: "ran" | "skipped";
    lastReason?: string;
    lastAttempted: number;
    lastProgressed: number;
    lastCompleted: number;
    lastBlocked: number;
    lastFinishedAt: number | null;
  };
};

export type ExecutionWorkerStatus = {
  enabled: boolean;
  globalPaused: boolean;
  agentCount: number;
  agents: ExecutionWorkerAgentStatus[];
};

export type ExecutionWorkerRunner = {
  stop: () => void;
  updateConfig: (cfg: ArgentConfig) => void;
  getStatus: (opts?: { agentId?: string }) => ExecutionWorkerStatus;
  dispatchNow: (opts?: { agentId?: string; reason?: string }) => ExecutionWorkerDispatchResult;
  pause: (opts?: { agentId?: string }) => ExecutionWorkerControlResult;
  resume: (opts?: { agentId?: string }) => ExecutionWorkerControlResult;
  resetMetrics: (opts?: { agentId?: string }) => ExecutionWorkerMetricsResetResult;
};

export type ExecutionWorkerTaskScope = "assigned" | "all" | "unassigned_or_assigned";

export type WorkerTaskSnapshot = NonNullable<ExecutionWorkerStatusHint["taskSnapshot"]>;

function isOpenTask(task: Task): boolean {
  return task.status === "pending" || task.status === "in_progress" || task.status === "blocked";
}

function taskType(task: Task): string | undefined {
  return (task as Task & { type?: string }).type;
}

function isTaskVisibleToWorker(
  task: Task,
  agentId: string,
  scope: ExecutionWorkerTaskScope,
): boolean {
  if (!isOpenTask(task)) {
    return false;
  }
  if (scope === "all") {
    return true;
  }
  if (scope === "assigned") {
    return task.assignee === agentId || task.agentId === agentId;
  }
  return !task.assignee || task.assignee === agentId || task.agentId === agentId;
}

export function isAutonomousAgentServiceableTask(task: Task, agentId: string): boolean {
  if (!isOpenTask(task)) {
    return false;
  }
  if (taskType(task) === "project") {
    return false;
  }
  return task.assignee === agentId || task.agentId === agentId;
}

export function buildWorkerTaskSnapshot(
  tasks: Task[],
  agentId: string,
  scope: ExecutionWorkerTaskScope,
  nowMs = Date.now(),
): WorkerTaskSnapshot {
  const openVisible = tasks.filter((task) => isTaskVisibleToWorker(task, agentId, scope));
  const openIds = new Set(tasks.filter(isOpenTask).map((task) => task.id));
  const dependencyBlocked = openVisible.filter((task) =>
    (task.dependsOn ?? []).some((dependencyId) => openIds.has(dependencyId)),
  );
  const runnable = openVisible.filter(
    (task) =>
      task.status === "pending" &&
      taskType(task) !== "project" &&
      !(task.dependsOn ?? []).some((dependencyId) => openIds.has(dependencyId)),
  );

  return {
    openVisibleCount: openVisible.length,
    runnableCount: runnable.length,
    dependencyBlockedCount: dependencyBlocked.length,
    blockedStatusCount: openVisible.filter((task) => task.status === "blocked").length,
    pendingCount: openVisible.filter((task) => task.status === "pending").length,
    inProgressCount: openVisible.filter((task) => task.status === "in_progress").length,
    evaluatedAt: nowMs,
  };
}

export function buildExecutionWorkerStatusHint(params: {
  agentId: string;
  globalPaused: boolean;
  agentPaused: boolean;
  running: boolean;
  rerunRequested: boolean;
  nextDueAt: number | null;
  lastReason?: string;
  snapshot: WorkerTaskSnapshot;
}): ExecutionWorkerStatusHint {
  if (params.globalPaused || params.agentPaused) {
    return {
      kind: "paused",
      summary: params.agentPaused
        ? `Execution worker for ${params.agentId} is paused.`
        : "Execution worker is globally paused.",
      taskSnapshot: params.snapshot,
    };
  }
  if (params.running) {
    return {
      kind: "running",
      summary: `Execution worker for ${params.agentId} is running.`,
      taskSnapshot: params.snapshot,
    };
  }
  if (params.lastReason === "agent-busy") {
    return {
      kind: "waiting",
      summary: "Waiting for the main agent lane to become available.",
      detail: "Runnable task counts may be stale until the next worker pass.",
      taskSnapshot: params.snapshot,
    };
  }
  if (params.snapshot.dependencyBlockedCount > 0 && params.snapshot.runnableCount === 0) {
    return {
      kind: "blocked",
      summary: `${params.snapshot.dependencyBlockedCount} task is waiting on dependencies.`,
      detail: "Resolve or complete dependency tasks before the worker can proceed.",
      taskSnapshot: params.snapshot,
    };
  }
  if (params.snapshot.runnableCount > 0) {
    return {
      kind: params.rerunRequested ? "queued" : "waiting",
      summary: `${params.snapshot.runnableCount} runnable task is waiting for worker cadence.`,
      detail: params.nextDueAt
        ? `The next pass is scheduled for ${new Date(params.nextDueAt).toISOString()}.`
        : "A rerun can be requested when the agent lane is available.",
      taskSnapshot: params.snapshot,
    };
  }
  if (params.snapshot.openVisibleCount === 0) {
    return {
      kind: "idle",
      summary: "No open tasks are in this worker's scope.",
      detail: "There may be other open task items outside this worker scope.",
      taskSnapshot: params.snapshot,
    };
  }
  return {
    kind: "idle",
    summary: "No runnable task is available for this worker.",
    taskSnapshot: params.snapshot,
  };
}

export function buildPersonalSkillCandidateInputFromTaskOutcome(params: {
  task: Task;
  toolValidation: Pick<
    ToolClaimValidation,
    "executedTools" | "externalToolsExecuted" | "hasExternalArtifact" | "valid"
  >;
}): CreatePersonalSkillCandidateInput | null {
  if (params.task.status !== "completed") {
    return null;
  }
  if (taskType(params.task) === "project") {
    return null;
  }
  const relatedTools = [...new Set(params.toolValidation.executedTools)];
  if (!params.toolValidation.hasExternalArtifact || relatedTools.length === 0) {
    return null;
  }

  const primaryTool = params.toolValidation.externalToolsExecuted[0] ?? relatedTools[0] ?? "tool";
  return {
    scope: "operator",
    title: `${primaryTool} procedure from completed task`,
    summary: params.task.description ?? params.task.title,
    triggerPatterns: [params.task.title],
    procedureOutline:
      typeof params.task.metadata?.completionNotes === "string"
        ? params.task.metadata.completionNotes
        : (params.task.description ?? params.task.title),
    relatedTools,
    sourceTaskIds: [params.task.id],
    evidenceCount: 1,
    confidence: params.toolValidation.valid ? 0.7 : 0.4,
    state: "candidate",
    agentId: params.task.agentId ?? params.task.assignee,
  };
}

type WorkerScope = NonNullable<AgentExecutionWorkerConfig["scope"]>;

function toTaskScope(scope: WorkerScope): ExecutionWorkerTaskScope {
  if (scope === "agent-visible") {
    return "unassigned_or_assigned";
  }
  return scope;
}

type ResolvedExecutionWorkerConfig = {
  enabled: boolean;
  intervalMs: number;
  model?: string;
  sessionMainKey: string;
  maxRunMinutes: number;
  maxTasksPerCycle: number;
  scope: WorkerScope;
  requireEvidence: boolean;
  maxNoProgressAttempts: number;
};

type WorkerAgentState = {
  agentId: string;
  config: ResolvedExecutionWorkerConfig;
  nextDueMs: number;
  lastRunMs?: number;
  running: boolean;
  rerunRequested: boolean;
  lastDispatchRequestedAt: number | null;
  lastDispatchReason?: string;
  lastTaskSnapshot?: WorkerTaskSnapshot;
  noProgressByTask: Map<string, number>;
  textualToolCallTasks: Set<string>;
  stats: {
    totalRuns: number;
    totalSkips: number;
    totalAttempted: number;
    totalProgressed: number;
    totalCompleted: number;
    totalBlocked: number;
    lastStatus: WorkerRunResult["status"];
    lastReason?: string;
    lastAttempted: number;
    lastProgressed: number;
    lastCompleted: number;
    lastBlocked: number;
    lastFinishedAt: number | null;
  };
};

type WorkerRunResult = {
  status: "ran" | "skipped";
  reason?: string;
  attempted?: number;
  progressed?: number;
  completed?: number;
  blocked?: number;
};

type WorkerToolClaimValidation = Pick<
  ToolClaimValidation,
  | "claimedTools"
  | "executedTools"
  | "missingClaims"
  | "externalToolsExecuted"
  | "hasExternalArtifact"
  | "valid"
>;

async function maybeCreatePersonalSkillCandidateFromTaskOutcome(params: {
  storage: Awaited<ReturnType<typeof getStorageAdapter>>;
  task: Task;
  toolValidation?: WorkerToolClaimValidation;
}): Promise<boolean> {
  if (!params.toolValidation) {
    return false;
  }
  const input = buildPersonalSkillCandidateInputFromTaskOutcome({
    task: params.task,
    toolValidation: params.toolValidation,
  });
  if (!input) {
    return false;
  }

  const existing = await params.storage.memory.listPersonalSkillCandidates({ limit: 500 });
  const existingTaskIds = new Set(existing.flatMap((candidate) => candidate.sourceTaskIds));
  if (existingTaskIds.has(params.task.id)) {
    return false;
  }

  await params.storage.memory.createPersonalSkillCandidate(input);
  return true;
}

type JobExecutionContext = {
  assignmentId: string;
  assignmentTitle: string;
  executionMode: "simulate" | "live";
  deploymentStage: "simulate" | "shadow" | "limited-live" | "live";
  departmentId?: string;
  scopeLimit?: string;
  reviewRequired?: boolean;
  rolePrompt: string;
  sop?: string;
  successDefinition?: string;
  relationshipContract?: JobRelationshipContract;
  departmentPolicy?: IntentPolicyConfig;
  simulationScenarios?: string[];
};

function buildIntentVerdict(params: {
  simulationViolation: boolean;
  intent: ReturnType<typeof resolveEffectiveIntentForAgent>;
}): "ok" | "runtime-off" | "not-configured" | "hierarchy-invalid" | "policy-violation" {
  if (params.simulationViolation) {
    return "policy-violation";
  }
  if (!params.intent) {
    return "not-configured";
  }
  if (params.intent.runtimeMode === "off") {
    return "runtime-off";
  }
  if (params.intent.validationMode === "enforce" && params.intent.issues.length > 0) {
    return "hierarchy-invalid";
  }
  return "ok";
}

function createEmptyWorkerStats(): WorkerAgentState["stats"] {
  return {
    totalRuns: 0,
    totalSkips: 0,
    totalAttempted: 0,
    totalProgressed: 0,
    totalCompleted: 0,
    totalBlocked: 0,
    lastStatus: "skipped",
    lastReason: "not-started",
    lastAttempted: 0,
    lastProgressed: 0,
    lastCompleted: 0,
    lastBlocked: 0,
    lastFinishedAt: null,
  };
}

function parseEveryMs(raw: string | undefined): number {
  try {
    return parseDurationMs(raw ?? DEFAULT_EVERY, { defaultUnit: "m" });
  } catch {
    return parseDurationMs(DEFAULT_EVERY, { defaultUnit: "m" });
  }
}

function parseModelOverrideRef(
  value: string | undefined,
): { provider: string; model: string } | null {
  const raw = String(value ?? "").trim();
  const slashIndex = raw.indexOf("/");
  if (!raw || slashIndex <= 0 || slashIndex === raw.length - 1) {
    return null;
  }
  return {
    provider: raw.slice(0, slashIndex).trim(),
    model: raw.slice(slashIndex + 1).trim(),
  };
}

function toPositiveInt(
  value: number | undefined,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.floor(value ?? fallback)));
}

function hasDependencyBlockers(task: Task, byId: Map<string, Task>): boolean {
  const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
  if (deps.length === 0) {
    return false;
  }
  return deps.some((depId) => {
    const dep = byId.get(depId);
    return Boolean(dep && dep.status !== "completed");
  });
}

function priorityWeight(task: Task): number {
  switch (task.priority) {
    case "urgent":
      return 5;
    case "high":
      return 4;
    case "normal":
      return 3;
    case "low":
      return 2;
    case "background":
      return 1;
    default:
      return 0;
  }
}

function pickNextTask(allTasks: Task[], agentId: string, scope: WorkerScope): Task | null {
  const byId = new Map(allTasks.map((task) => [task.id, task]));
  const candidates = allTasks
    .filter((task) => task.status === "pending" || task.status === "in_progress")
    .filter((task) => {
      if (!isAutonomousAgentServiceableTask(task, agentId)) {
        return false;
      }
      if (scope === "all" || scope === "assigned" || scope === "agent-visible") {
        return true;
      }
      return false;
    })
    .filter((task) => !hasDependencyBlockers(task, byId))
    .toSorted((a, b) => {
      // Continue in-progress work before pulling new items.
      if (a.status !== b.status) {
        if (a.status === "in_progress") {
          return -1;
        }
        if (b.status === "in_progress") {
          return 1;
        }
      }
      const priorityDiff = priorityWeight(b) - priorityWeight(a);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      const dueA = a.dueAt ?? Number.POSITIVE_INFINITY;
      const dueB = b.dueAt ?? Number.POSITIVE_INFINITY;
      if (dueA !== dueB) {
        return dueA - dueB;
      }
      return a.createdAt - b.createdAt;
    });
  return candidates[0] ?? null;
}

function extractToolValidation(meta: unknown): WorkerToolClaimValidation | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const candidate = (meta as { toolValidation?: unknown }).toolValidation;
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  const parsed = candidate as Partial<WorkerToolClaimValidation>;
  if (!Array.isArray(parsed.claimedTools) || !Array.isArray(parsed.executedTools)) {
    return undefined;
  }
  if (!Array.isArray(parsed.missingClaims) || !Array.isArray(parsed.externalToolsExecuted)) {
    return undefined;
  }
  if (typeof parsed.hasExternalArtifact !== "boolean" || typeof parsed.valid !== "boolean") {
    return undefined;
  }
  return parsed as WorkerToolClaimValidation;
}

function hasExecutionEvidence(result: {
  meta?: unknown;
  payloads?: Array<{ text?: string }>;
}): boolean {
  const toolValidation = extractToolValidation(result.meta);
  if (toolValidation) {
    return toolValidation.executedTools.length > 0 && toolValidation.missingClaims.length === 0;
  }
  const text = (result.payloads ?? [])
    .map((payload) => payload.text ?? "")
    .join("\n")
    .trim();
  return text.length > 0;
}

/**
 * Textual pseudo-tool-calls: smaller local models sometimes WRITE a tool
 * invocation as message text instead of emitting a native tool call —
 * observed dialects from gemma/qwen under the worker prompt:
 *   <|tool_call>call:tasks.search{...}   [ tasks: list, status: open ]
 *   <tool_call>{"name": ...}             [Tool Call: tasks (...)]
 * Nothing executes, so the run records zero work. Detect them so the next
 * attempt can correct the model explicitly.
 */
const TEXTUAL_TOOL_CALL_PATTERNS = [
  /<\|?tool_call\|?>?/i,
  /<tool_call>/i,
  /\[tool[_ ]?call\b/i,
  /\bcall:[a-z_]+[.({]/i,
  /^\s*\[\s*[a-z_]+\s*:\s*[a-z_]+/im,
];

export function looksLikeTextualToolCall(text: string): boolean {
  if (!text.trim()) {
    return false;
  }
  return TEXTUAL_TOOL_CALL_PATTERNS.some((pattern) => pattern.test(text));
}

function buildTaskExecutionPrompt(
  task: Task,
  jobContext?: JobExecutionContext,
  opts?: { textualToolCallNudge?: boolean },
): string {
  const lines = [
    "[WORKER_EXEC]",
    `Task: ${task.id} — ${task.title}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
  ];
  if (task.description?.trim()) {
    lines.push(`Description: ${task.description.trim()}`);
  }
  if (task.dueAt) {
    lines.push(`Due: ${new Date(task.dueAt).toISOString()}`);
  }
  if (jobContext) {
    lines.push(
      `Job Assignment: ${jobContext.assignmentTitle} (${jobContext.assignmentId})`,
      `Deployment Stage: ${jobContext.deploymentStage.toUpperCase()}`,
      `Job Mode: ${jobContext.executionMode.toUpperCase()}`,
      `Role Contract: ${jobContext.rolePrompt}`,
    );
    if (jobContext.departmentId) {
      lines.push(`Department Identity: ${jobContext.departmentId}`);
    }
    if (jobContext.departmentPolicy?.objective) {
      lines.push(`Department Objective: ${jobContext.departmentPolicy.objective}`);
    }
    if (jobContext.departmentPolicy?.tradeoffHierarchy?.length) {
      lines.push(
        `Department Tradeoffs: ${jobContext.departmentPolicy.tradeoffHierarchy.join(" > ")}`,
      );
    }
    if (jobContext.departmentPolicy?.neverDo?.length) {
      lines.push(`Department Never Do: ${jobContext.departmentPolicy.neverDo.join(", ")}`);
    }
    if (jobContext.relationshipContract?.relationshipObjective) {
      lines.push(
        `Relationship Objective: ${jobContext.relationshipContract.relationshipObjective}`,
      );
    }
    if (jobContext.relationshipContract?.toneProfile) {
      lines.push(`Tone Profile: ${jobContext.relationshipContract.toneProfile}`);
    }
    if (jobContext.relationshipContract?.trustPriorities?.length) {
      lines.push(`Trust Priorities: ${jobContext.relationshipContract.trustPriorities.join(", ")}`);
    }
    if (jobContext.relationshipContract?.continuityRequirements?.length) {
      lines.push(
        `Continuity Requirements: ${jobContext.relationshipContract.continuityRequirements.join(", ")}`,
      );
    }
    if (jobContext.relationshipContract?.honestyRules?.length) {
      lines.push(`Honesty Rules: ${jobContext.relationshipContract.honestyRules.join(", ")}`);
    }
    if (jobContext.relationshipContract?.handoffStyle) {
      lines.push(`Handoff Style: ${jobContext.relationshipContract.handoffStyle}`);
    }
    if (jobContext.relationshipContract?.relationalFailureModes?.length) {
      lines.push(
        `Avoid These Relationship Failures: ${jobContext.relationshipContract.relationalFailureModes.join(", ")}`,
      );
    }
    if (jobContext.simulationScenarios?.length) {
      lines.push(`Simulation Scenarios: ${jobContext.simulationScenarios.join(" | ")}`);
    }
    if (jobContext.scopeLimit) {
      lines.push(`Limited-Live Scope Boundary: ${jobContext.scopeLimit}`);
    }
    if (jobContext.sop) {
      lines.push(`Job SOP:\n${jobContext.sop}`);
    }
    if (jobContext.successDefinition) {
      lines.push(`Job Definition of Done: ${jobContext.successDefinition}`);
    }
    if (jobContext.executionMode === "simulate" || jobContext.deploymentStage === "shadow") {
      lines.push(
        "SIMULATION MODE IS ENFORCED.",
        "Do not perform live third-party writes.",
        "Produce draft/internal-note artifacts only and clearly mark them as simulated output.",
      );
    } else if (jobContext.deploymentStage === "limited-live") {
      lines.push(
        "LIMITED-LIVE MODE IS ENFORCED.",
        "Stay strictly within the declared scope boundary.",
        "Do not widen authority, improvise policy, or send outbound customer messaging unless the scope explicitly allows it.",
        "If the request exceeds the stated scope, stop and escalate instead of stretching the role.",
      );
    }
  }
  lines.push(
    "",
    "You are in explicit execution mode.",
    "Do the work for this task now using tools.",
    "Tools run ONLY through the native tool-call interface. Never write a tool invocation as message text (no <tool_call> tags, no 'call:tool{...}', no '[tool: ...]' notation) — text like that executes nothing and counts as zero work.",
    "Before marking blocked, attempt at least two distinct recovery paths and record what failed.",
    "If blocked after retries, mark it blocked with a concrete reason and the attempted recoveries.",
    "If completed, mark it completed.",
    "Always update task state on the board when work changes status.",
    "Return a concise summary with evidence of what changed.",
  );
  if (opts?.textualToolCallNudge) {
    lines.push(
      "",
      "FORMAT CORRECTION: your previous attempt wrote tool invocations as plain text, so nothing executed.",
      "Invoke each tool through the tool-call interface now — one tool call at a time, no narration of the call itself.",
    );
  }
  return lines.join("\n");
}

async function withSessionToolPolicyOverride<T>(params: {
  cfg: ArgentConfig;
  agentId: string;
  sessionKey: string;
  toolsAllow?: string[];
  toolsDeny?: string[];
  run: () => Promise<T>;
}): Promise<T> {
  const hasOverride = Boolean(
    (params.toolsAllow && params.toolsAllow.length > 0) ||
    (params.toolsDeny && params.toolsDeny.length > 0),
  );
  if (!hasOverride) {
    return await params.run();
  }

  const storePath = resolveStorePath(params.cfg.session?.store, { agentId: params.agentId });
  let previous: SessionEntry | undefined;
  let existed = false;

  await updateSessionStore(storePath, (store) => {
    const existing = store[params.sessionKey];
    existed = Boolean(existing);
    previous = existing ? { ...existing } : undefined;
    const next: SessionEntry = {
      ...(existing ?? { sessionId: randomUUID() }),
      updatedAt: Date.now(),
    };
    if (params.toolsAllow && params.toolsAllow.length > 0) {
      next.toolsAllow = params.toolsAllow;
    } else {
      delete next.toolsAllow;
    }
    if (params.toolsDeny && params.toolsDeny.length > 0) {
      next.toolsDeny = params.toolsDeny;
    } else {
      delete next.toolsDeny;
    }
    store[params.sessionKey] = next;
  });

  try {
    return await params.run();
  } finally {
    await updateSessionStore(storePath, (store) => {
      if (existed && previous) {
        store[params.sessionKey] = previous;
      } else {
        delete store[params.sessionKey];
      }
    });
  }
}

function mergeWorkerConfig(
  agentId: string,
  defaults: AgentExecutionWorkerConfig | undefined,
  overrides: AgentExecutionWorkerConfig | undefined,
): ResolvedExecutionWorkerConfig {
  const rawEnabled = overrides?.enabled ?? defaults?.enabled ?? false;
  const rawEvery = overrides?.every ?? defaults?.every;
  const intervalMs = parseEveryMs(rawEvery);
  const model =
    typeof overrides?.model === "string" && overrides.model.trim().length > 0
      ? overrides.model.trim()
      : typeof defaults?.model === "string" && defaults.model.trim().length > 0
        ? defaults.model.trim()
        : undefined;
  const sessionMainKey =
    (overrides?.sessionMainKey ?? defaults?.sessionMainKey ?? DEFAULT_SESSION_MAIN_KEY).trim() ||
    DEFAULT_SESSION_MAIN_KEY;
  const maxRunMinutes = toPositiveInt(
    overrides?.maxRunMinutes ?? defaults?.maxRunMinutes,
    DEFAULT_MAX_RUN_MINUTES,
    { min: 1, max: 120 },
  );
  const maxTasksPerCycle = toPositiveInt(
    overrides?.maxTasksPerCycle ?? defaults?.maxTasksPerCycle,
    DEFAULT_MAX_TASKS_PER_CYCLE,
    { min: 1, max: 200 },
  );
  const scope = overrides?.scope ?? defaults?.scope ?? ("assigned" as const);
  const requireEvidence =
    overrides?.requireEvidence ?? defaults?.requireEvidence ?? DEFAULT_REQUIRE_EVIDENCE;
  const maxNoProgressAttempts = toPositiveInt(
    overrides?.maxNoProgressAttempts ?? defaults?.maxNoProgressAttempts,
    DEFAULT_MAX_NO_PROGRESS_ATTEMPTS,
    { min: 1, max: 10 },
  );
  return {
    enabled: rawEnabled,
    intervalMs,
    model,
    sessionMainKey,
    maxRunMinutes,
    maxTasksPerCycle,
    scope,
    requireEvidence,
    maxNoProgressAttempts,
  };
}

function resolveWorkerStates(cfg: ArgentConfig, previous: Map<string, WorkerAgentState>) {
  const next = new Map<string, WorkerAgentState>();
  const defaults = cfg.agents?.defaults?.executionWorker;
  const defaultAgentId = normalizeAgentId(resolveDefaultAgentId(cfg));

  const defaultConfig = mergeWorkerConfig(defaultAgentId, defaults, undefined);
  if (defaultConfig.enabled) {
    const prev = previous.get(defaultAgentId);
    next.set(defaultAgentId, {
      agentId: defaultAgentId,
      config: defaultConfig,
      nextDueMs: prev?.nextDueMs ?? Date.now() + defaultConfig.intervalMs,
      lastRunMs: prev?.lastRunMs,
      running: false,
      rerunRequested: prev?.rerunRequested ?? false,
      lastDispatchRequestedAt: prev?.lastDispatchRequestedAt ?? null,
      lastDispatchReason: prev?.lastDispatchReason,
      lastTaskSnapshot: prev?.lastTaskSnapshot,
      noProgressByTask: prev?.noProgressByTask ?? new Map<string, number>(),
      textualToolCallTasks: prev?.textualToolCallTasks ?? new Set<string>(),
      stats: prev?.stats ?? createEmptyWorkerStats(),
    });
  }

  for (const entry of cfg.agents?.list ?? []) {
    if (!entry?.id) {
      continue;
    }
    const agentId = normalizeAgentId(entry.id);
    if (agentId === defaultAgentId) {
      continue;
    }
    const override = resolveAgentConfig(cfg, agentId)?.executionWorker;
    if (!override?.enabled) {
      continue;
    }
    const merged = mergeWorkerConfig(agentId, defaults, override);
    const prev = previous.get(agentId);
    next.set(agentId, {
      agentId,
      config: merged,
      nextDueMs: prev?.nextDueMs ?? Date.now() + merged.intervalMs,
      lastRunMs: prev?.lastRunMs,
      running: false,
      rerunRequested: prev?.rerunRequested ?? false,
      lastDispatchRequestedAt: prev?.lastDispatchRequestedAt ?? null,
      lastDispatchReason: prev?.lastDispatchReason,
      lastTaskSnapshot: prev?.lastTaskSnapshot,
      noProgressByTask: prev?.noProgressByTask ?? new Map<string, number>(),
      textualToolCallTasks: prev?.textualToolCallTasks ?? new Set<string>(),
      stats: prev?.stats ?? createEmptyWorkerStats(),
    });
  }

  return next;
}

async function runWorkerOnce(cfg: ArgentConfig, state: WorkerAgentState): Promise<WorkerRunResult> {
  // Avoid user-facing contention.
  const mainQueue = getQueueSize(CommandLane.Main) + getQueueSize(CommandLane.Interactive);
  const activeRuns = getActiveEmbeddedRunCount();
  if (mainQueue > 0 || activeRuns > 0) {
    return { status: "skipped", reason: "agent-busy" };
  }

  const storage = await getStorageAdapter();
  await storage.jobs.ensureDueTasks({ agentId: state.agentId, now: Date.now() });
  const startedAt = Date.now();
  const maxRuntimeMs = state.config.maxRunMinutes * 60_000;
  const taskScope = toTaskScope(state.config.scope);
  const sessionKey = buildAgentMainSessionKey({
    agentId: state.agentId,
    mainKey: state.config.sessionMainKey,
  });

  let attempted = 0;
  let progressed = 0;
  let completed = 0;
  let blocked = 0;

  while (attempted < state.config.maxTasksPerCycle && Date.now() - startedAt < maxRuntimeMs) {
    const allTasks = await storage.tasks.list();
    state.lastTaskSnapshot = buildWorkerTaskSnapshot(allTasks, state.agentId, taskScope);
    const task = pickNextTask(allTasks, state.agentId, state.config.scope);
    if (!task) {
      break;
    }

    const before = (await storage.tasks.get(task.id)) ?? task;
    const beforeUpdatedAt = before.updatedAt;
    const beforeStatus = before.status;
    const beforeStartedAt = before.startedAt ?? 0;

    if (before.status === "pending") {
      await storage.tasks.start(before.id);
    }

    const jobTaskContext = await storage.jobs.getContextForTask(before.id);
    const departmentId = jobTaskContext?.template.departmentId?.trim() || undefined;
    const departmentPolicy = departmentId
      ? resolveEffectiveIntentForDepartment({
          config: cfg,
          departmentId,
        })
      : undefined;
    const jobContext: JobExecutionContext | undefined = jobTaskContext
      ? {
          assignmentId: jobTaskContext.assignment.id,
          assignmentTitle: jobTaskContext.assignment.title,
          executionMode: jobTaskContext.assignment.executionMode,
          deploymentStage:
            jobTaskContext.assignment.deploymentStage ??
            (jobTaskContext.assignment.executionMode === "live" ? "live" : "simulate"),
          departmentId,
          scopeLimit: jobTaskContext.assignment.scopeLimit,
          reviewRequired: jobTaskContext.assignment.reviewRequired,
          rolePrompt: jobTaskContext.template.rolePrompt,
          sop: jobTaskContext.template.sop,
          successDefinition: jobTaskContext.template.successDefinition,
          relationshipContract: jobTaskContext.template.relationshipContract,
          departmentPolicy,
          simulationScenarios: Array.isArray(jobTaskContext.template.metadata?.simulationScenarios)
            ? jobTaskContext.template.metadata.simulationScenarios.filter(
                (item): item is string => typeof item === "string" && item.trim().length > 0,
              )
            : undefined,
        }
      : undefined;

    const resolvedIntent = resolveEffectiveIntentForAgent({
      config: cfg,
      agentId: state.agentId,
    });
    const intentHint = resolvedIntent ? buildIntentSystemPromptHint(resolvedIntent.policy) : "";
    const prompt = [
      buildTaskExecutionPrompt(before, jobContext, {
        textualToolCallNudge: state.textualToolCallTasks.has(before.id),
      }),
      intentHint?.trim() ? `\n${intentHint.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const sessionPolicy = jobTaskContext
      ? await storage.jobs.resolveSessionToolPolicyForAssignment(jobTaskContext)
      : {};

    const workerModelOverride = parseModelOverrideRef(state.config.model);
    const result = await withSessionToolPolicyOverride({
      cfg,
      agentId: state.agentId,
      sessionKey,
      toolsAllow: sessionPolicy.toolsAllow,
      toolsDeny: sessionPolicy.toolsDeny,
      run: async () =>
        await agentCommand({
          agentId: state.agentId,
          sessionKey,
          lane: "cron",
          runId: `worker-${state.agentId}-${before.id}-${Date.now()}`,
          message: prompt,
          extraSystemPrompt:
            "This is an explicit queue-draining worker run. Prefer concrete action over discussion.",
          bestEffortDeliver: false,
          providerOverride: workerModelOverride?.provider,
          modelOverride: workerModelOverride?.model,
        }),
    });

    const after = await storage.tasks.get(before.id);
    const toolValidation = extractToolValidation(result.meta);
    const simulationViolation =
      (jobContext?.executionMode === "simulate" || jobContext?.deploymentStage === "shadow") &&
      Boolean(toolValidation && toolValidation.externalToolsExecuted.length > 0);
    if (simulationViolation) {
      await storage.tasks.block(
        before.id,
        `Simulation-mode policy violation: executed external tools (${toolValidation?.externalToolsExecuted.join(", ")})`,
      );
    }
    const evidenceOk = hasExecutionEvidence(result);
    const boardChanged = Boolean(
      after &&
      (after.updatedAt > beforeUpdatedAt ||
        after.status !== beforeStatus ||
        (after.startedAt ?? 0) > beforeStartedAt),
    );
    const accepted =
      !simulationViolation && boardChanged && (!state.config.requireEvidence || evidenceOk);

    attempted += 1;

    if (accepted) {
      progressed += 1;
      state.noProgressByTask.delete(before.id);
      state.textualToolCallTasks.delete(before.id);
    } else {
      const executedToolCount = toolValidation?.executedTools.length ?? 0;
      const resultText = (result.payloads ?? []).map((payload) => payload.text ?? "").join("\n");
      if (executedToolCount === 0 && looksLikeTextualToolCall(resultText)) {
        state.textualToolCallTasks.add(before.id);
        log.warn(
          `worker ${state.agentId}: textual pseudo-tool-call detected on task ${before.id}; next attempt gets a format correction`,
        );
      }
      const attempts = (state.noProgressByTask.get(before.id) ?? 0) + 1;
      state.noProgressByTask.set(before.id, attempts);
      if (attempts >= state.config.maxNoProgressAttempts) {
        await storage.tasks.block(
          before.id,
          "Auto-blocked by execution worker after repeated no-progress attempts",
        );
        progressed += 1;
        state.noProgressByTask.delete(before.id);
        state.textualToolCallTasks.delete(before.id);
      }
    }

    const latest = await storage.tasks.get(before.id);
    const intentVerdict = buildIntentVerdict({
      simulationViolation,
      intent: resolvedIntent,
    });
    const priorRuns = jobTaskContext
      ? await storage.jobs.listRuns({ assignmentId: jobTaskContext.assignment.id, limit: 6 })
      : [];
    const recentRelationshipScores = priorRuns
      .filter((run) => run.taskId !== before.id && run.status !== "running")
      .map((run) => {
        const relationship = run.metadata?.relationship as
          | { overallScore?: number }
          | undefined
          | null;
        return relationship?.overallScore;
      })
      .filter((score): score is number => Number.isFinite(score))
      .slice(0, 5);
    const runMetadata = {
      intent: resolvedIntent
        ? {
            runtimeMode: resolvedIntent.runtimeMode,
            validationMode: resolvedIntent.validationMode,
            departmentId: resolvedIntent.departmentId ?? null,
            templateDepartmentId: jobContext?.departmentId ?? null,
            issuesCount: resolvedIntent.issues.length,
            lineage: resolvedIntent.lineage,
          }
        : null,
      intentVerdict,
      deploymentStage: jobContext?.deploymentStage ?? null,
      relationship: evaluateRelationshipExecution({
        simulationViolation,
        latestStatus: latest?.status,
        intent: resolvedIntent ?? undefined,
        deploymentStage: jobContext?.deploymentStage,
        relationshipContract: jobContext?.relationshipContract,
        declaredDepartmentId: jobContext?.departmentId,
        effectiveDepartmentId: resolvedIntent?.departmentId,
        departmentPolicy: jobContext?.departmentPolicy,
        recentScores: recentRelationshipScores,
      }),
    };
    if (latest?.status === "completed") {
      completed += 1;
      const personalSkillCandidateCreated = await maybeCreatePersonalSkillCandidateFromTaskOutcome({
        storage,
        task: latest,
        toolValidation,
      });
      if (personalSkillCandidateCreated) {
        log.info("execution-worker: personal skill candidate created", {
          agentId: state.agentId,
          taskId: latest.id,
          taskTitle: latest.title,
        });
      }
      if (jobTaskContext) {
        await storage.jobs.completeRunForTask(before.id, {
          status: "completed",
          summary: "Execution worker completed the job task.",
          metadata: runMetadata,
        });
      }
    } else if (latest?.status === "blocked") {
      blocked += 1;
      if (jobTaskContext) {
        await storage.jobs.completeRunForTask(before.id, {
          status: "blocked",
          blockers:
            typeof latest.metadata?.blockedReason === "string"
              ? latest.metadata.blockedReason
              : "Task blocked during execution",
          metadata: runMetadata,
        });
      }
    } else if (latest?.status === "failed" && jobTaskContext) {
      await storage.jobs.completeRunForTask(before.id, {
        status: "failed",
        blockers:
          typeof latest.metadata?.failureReason === "string"
            ? latest.metadata.failureReason
            : "Task failed during execution",
        metadata: runMetadata,
      });
    }
  }

  if (attempted === 0) {
    return { status: "skipped", reason: "no-runnable-tasks" };
  }
  return { status: "ran", attempted, progressed, completed, blocked };
}

export function startExecutionWorkerRunner(init: { cfg?: ArgentConfig }): ExecutionWorkerRunner {
  let cfg = init.cfg ?? loadConfig();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let initialized = false;
  let agents = resolveWorkerStates(cfg, new Map());
  let globalPaused = false;
  let pausedAgents = new Set<string>();

  const buildStatusHint = (state: WorkerAgentState): ExecutionWorkerStatusHint =>
    buildExecutionWorkerStatusHint({
      agentId: state.agentId,
      globalPaused,
      agentPaused: pausedAgents.has(state.agentId),
      running: state.running,
      rerunRequested: state.rerunRequested,
      nextDueAt: state.nextDueMs || null,
      lastReason: state.stats.lastReason,
      snapshot:
        state.lastTaskSnapshot ??
        buildWorkerTaskSnapshot([], state.agentId, toTaskScope(state.config.scope)),
    });

  const scheduleNext = () => {
    if (stopped) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (agents.size === 0) {
      return;
    }
    if (globalPaused) {
      return;
    }

    const now = Date.now();
    let nextDue = Number.POSITIVE_INFINITY;
    for (const state of agents.values()) {
      if (pausedAgents.has(state.agentId)) {
        continue;
      }
      if (!state.running && state.nextDueMs < nextDue) {
        nextDue = state.nextDueMs;
      }
    }
    if (!Number.isFinite(nextDue)) {
      return;
    }

    const delayMs = Math.max(0, nextDue - now);
    timer = setTimeout(() => {
      void runCycle();
    }, delayMs);
    timer.unref?.();
  };

  const runCycle = async () => {
    if (stopped) {
      return;
    }
    if (globalPaused) {
      scheduleNext();
      return;
    }
    const now = Date.now();
    for (const state of agents.values()) {
      if (stopped) {
        break;
      }
      if (pausedAgents.has(state.agentId)) {
        continue;
      }
      if (state.running) {
        continue;
      }
      if (now < state.nextDueMs) {
        continue;
      }

      state.running = true;
      try {
        const result = await runWorkerOnce(cfg, state);
        state.lastRunMs = Date.now();
        const baseInterval = state.config.intervalMs;
        const busyRetryMs = Math.min(baseInterval, 45_000);
        if (state.rerunRequested) {
          state.nextDueMs = state.lastRunMs;
          state.rerunRequested = false;
        } else {
          state.nextDueMs =
            result.status === "skipped" && result.reason === "agent-busy"
              ? state.lastRunMs + busyRetryMs
              : state.lastRunMs + baseInterval;
        }

        if (result.status === "ran") {
          state.stats.totalRuns += 1;
          state.stats.totalAttempted += result.attempted ?? 0;
          state.stats.totalProgressed += result.progressed ?? 0;
          state.stats.totalCompleted += result.completed ?? 0;
          state.stats.totalBlocked += result.blocked ?? 0;
          state.stats.lastStatus = "ran";
          state.stats.lastReason = undefined;
          state.stats.lastAttempted = result.attempted ?? 0;
          state.stats.lastProgressed = result.progressed ?? 0;
          state.stats.lastCompleted = result.completed ?? 0;
          state.stats.lastBlocked = result.blocked ?? 0;
          state.stats.lastFinishedAt = state.lastRunMs;
          log.info("execution worker cycle complete", {
            agentId: state.agentId,
            attempted: result.attempted,
            progressed: result.progressed,
            completed: result.completed,
            blocked: result.blocked,
          });
        } else {
          state.stats.totalSkips += 1;
          state.stats.lastStatus = "skipped";
          state.stats.lastReason = result.reason;
          state.stats.lastAttempted = 0;
          state.stats.lastProgressed = 0;
          state.stats.lastCompleted = 0;
          state.stats.lastBlocked = 0;
          state.stats.lastFinishedAt = state.lastRunMs;
          log.debug("execution worker cycle skipped", {
            agentId: state.agentId,
            reason: result.reason,
          });
        }
      } catch (err) {
        state.lastRunMs = Date.now();
        state.nextDueMs = state.lastRunMs + state.config.intervalMs;
        state.stats.totalSkips += 1;
        state.stats.lastStatus = "skipped";
        state.stats.lastReason = "cycle-error";
        state.stats.lastAttempted = 0;
        state.stats.lastProgressed = 0;
        state.stats.lastCompleted = 0;
        state.stats.lastBlocked = 0;
        state.stats.lastFinishedAt = state.lastRunMs;
        log.error("execution worker cycle failed", {
          agentId: state.agentId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        state.running = false;
      }
    }
    scheduleNext();
  };

  const updateConfig = (nextCfg: ArgentConfig) => {
    if (stopped) {
      return;
    }
    cfg = nextCfg;
    const prev = agents;
    agents = resolveWorkerStates(cfg, prev);
    pausedAgents = new Set(Array.from(pausedAgents).filter((agentId) => agents.has(agentId)));
    if (agents.size === 0) {
      globalPaused = false;
    }
    if (!initialized) {
      if (agents.size === 0) {
        log.info("execution worker: disabled");
      } else {
        log.info("execution worker: started", {
          agents: Array.from(agents.keys()),
        });
      }
      initialized = true;
    } else {
      log.info("execution worker: updated", {
        agents: Array.from(agents.keys()),
      });
    }
    scheduleNext();
  };

  const getStatus = (opts?: { agentId?: string }): ExecutionWorkerStatus => {
    const requestedAgentId = opts?.agentId ? normalizeAgentId(opts.agentId) : "";
    const states = Array.from(agents.values())
      .filter((state) => !requestedAgentId || state.agentId === requestedAgentId)
      .toSorted((a, b) => a.agentId.localeCompare(b.agentId));
    return {
      enabled: agents.size > 0,
      globalPaused,
      agentCount: states.length,
      agents: states.map((state) => ({
        agentId: state.agentId,
        enabled: state.config.enabled,
        paused: globalPaused || pausedAgents.has(state.agentId),
        running: state.running,
        rerunRequested: state.rerunRequested,
        nextDueAt: state.nextDueMs || null,
        lastRunAt: state.lastRunMs || null,
        lastDispatchRequestedAt: state.lastDispatchRequestedAt,
        lastDispatchReason: state.lastDispatchReason,
        statusHint: buildStatusHint(state),
        config: {
          every: `${Math.max(1, Math.floor(state.config.intervalMs / 60_000))}m`,
          model: state.config.model,
          sessionMainKey: state.config.sessionMainKey,
          maxRunMinutes: state.config.maxRunMinutes,
          maxTasksPerCycle: state.config.maxTasksPerCycle,
          scope: toTaskScope(state.config.scope),
          requireEvidence: state.config.requireEvidence,
          maxNoProgressAttempts: state.config.maxNoProgressAttempts,
        },
        metrics: {
          totalRuns: state.stats.totalRuns,
          totalSkips: state.stats.totalSkips,
          totalAttempted: state.stats.totalAttempted,
          totalProgressed: state.stats.totalProgressed,
          totalCompleted: state.stats.totalCompleted,
          totalBlocked: state.stats.totalBlocked,
          lastStatus: state.stats.lastStatus,
          lastReason: state.stats.lastReason,
          lastAttempted: state.stats.lastAttempted,
          lastProgressed: state.stats.lastProgressed,
          lastCompleted: state.stats.lastCompleted,
          lastBlocked: state.stats.lastBlocked,
          lastFinishedAt: state.stats.lastFinishedAt,
        },
      })),
    };
  };

  const dispatchNow = (opts?: {
    agentId?: string;
    reason?: string;
  }): ExecutionWorkerDispatchResult => {
    const requestedAgentId = opts?.agentId ? normalizeAgentId(opts.agentId) : "";
    const now = Date.now();
    const markState = (state: WorkerAgentState) => {
      state.lastDispatchRequestedAt = now;
      state.lastDispatchReason = opts?.reason;
      state.nextDueMs = Math.min(state.nextDueMs, now);
      if (state.running || globalPaused || pausedAgents.has(state.agentId)) {
        state.rerunRequested = true;
      }
    };

    if (!requestedAgentId) {
      if (agents.size === 0) {
        return {
          ok: false,
          scope: "global",
          dispatched: 0,
          paused: globalPaused,
          running: false,
          reason: opts?.reason,
        };
      }
      for (const state of agents.values()) {
        markState(state);
      }
      scheduleNext();
      return {
        ok: true,
        scope: "global",
        dispatched: agents.size,
        paused: globalPaused,
        running: Array.from(agents.values()).some((state) => state.running),
        reason: opts?.reason,
      };
    }

    const state = agents.get(requestedAgentId);
    if (!state) {
      return {
        ok: false,
        scope: "agent",
        agentId: requestedAgentId,
        dispatched: 0,
        paused: false,
        running: false,
        reason: opts?.reason,
      };
    }

    markState(state);
    scheduleNext();
    return {
      ok: true,
      scope: "agent",
      agentId: requestedAgentId,
      dispatched: 1,
      paused: globalPaused || pausedAgents.has(state.agentId),
      running: state.running,
      reason: opts?.reason,
    };
  };

  const pause = (opts?: { agentId?: string }): ExecutionWorkerControlResult => {
    const requestedAgentId = opts?.agentId ? normalizeAgentId(opts.agentId) : "";
    if (!requestedAgentId) {
      globalPaused = true;
      scheduleNext();
      return { ok: true, scope: "global", paused: true };
    }
    if (!agents.has(requestedAgentId)) {
      return { ok: false, scope: "agent", agentId: requestedAgentId, paused: false };
    }
    pausedAgents.add(requestedAgentId);
    scheduleNext();
    return { ok: true, scope: "agent", agentId: requestedAgentId, paused: true };
  };

  const resume = (opts?: { agentId?: string }): ExecutionWorkerControlResult => {
    const requestedAgentId = opts?.agentId ? normalizeAgentId(opts.agentId) : "";
    if (!requestedAgentId) {
      globalPaused = false;
      scheduleNext();
      return { ok: true, scope: "global", paused: false };
    }
    if (!agents.has(requestedAgentId)) {
      return { ok: false, scope: "agent", agentId: requestedAgentId, paused: false };
    }
    pausedAgents.delete(requestedAgentId);
    scheduleNext();
    return { ok: true, scope: "agent", agentId: requestedAgentId, paused: false };
  };

  const resetMetrics = (opts?: { agentId?: string }): ExecutionWorkerMetricsResetResult => {
    const requestedAgentId = opts?.agentId ? normalizeAgentId(opts.agentId) : "";
    if (!requestedAgentId) {
      let resetCount = 0;
      for (const state of agents.values()) {
        state.stats = createEmptyWorkerStats();
        state.noProgressByTask.clear();
        resetCount += 1;
      }
      return { ok: true, scope: "global", resetCount };
    }
    const state = agents.get(requestedAgentId);
    if (!state) {
      return { ok: false, scope: "agent", agentId: requestedAgentId, resetCount: 0 };
    }
    state.stats = createEmptyWorkerStats();
    state.noProgressByTask.clear();
    return { ok: true, scope: "agent", agentId: requestedAgentId, resetCount: 1 };
  };

  const stop = () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  updateConfig(cfg);
  return { stop, updateConfig, getStatus, dispatchNow, pause, resume, resetMetrics };
}
