import type { ToolClaimValidation } from "../agents/tool-claim-validation.js";
import type { Task } from "../data/types.js";
import type { CreatePersonalSkillCandidateInput } from "../memory/memu-types.js";
import type { ExecutionWorkerStatusHint } from "./execution-worker-runner-core.js";

export * from "./execution-worker-runner-core.js";

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
