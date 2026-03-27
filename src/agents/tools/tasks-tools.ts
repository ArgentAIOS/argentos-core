/**
 * Task Management Tools for Agents
 *
 * Provides tools for agents to manage tasks programmatically:
 * - tasks_list: List tasks with filters
 * - tasks_add: Create a new task
 * - tasks_start: Start working on a task
 * - tasks_complete: Mark a task as complete
 * - tasks_block: Mark a task as blocked
 * - tasks_update: Update task details
 * - tasks_search: Search tasks
 */

import { Type } from "@sinclair/typebox";
import type {
  Task,
  TaskFilter,
  TaskPriority,
  TaskStatus,
  ProjectWithChildren,
} from "../../data/types.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import { callGateway } from "../../gateway/call.js";
import { type AnyAgentTool, readStringParam } from "./common.js";

// Helper to return text result
function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

// ============================================================================
// Schemas
// ============================================================================

const TaskPriorityEnum = Type.Union([
  Type.Literal("urgent"),
  Type.Literal("high"),
  Type.Literal("normal"),
  Type.Literal("low"),
  Type.Literal("background"),
]);

const TaskStatusEnum = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("blocked"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

const TasksToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("list"),
    Type.Literal("add"),
    Type.Literal("start"),
    Type.Literal("complete"),
    Type.Literal("block"),
    Type.Literal("update"),
    Type.Literal("search"),
    Type.Literal("counts"),
    Type.Literal("overdue"),
    Type.Literal("project_create"),
    Type.Literal("project_list"),
    Type.Literal("project_detail"),
    Type.Literal("claim"),
    Type.Literal("team_list"),
  ]),
  // For list action
  status: Type.Optional(
    Type.Unsafe<string | string[]>({
      description:
        "Filter by status: pending, in_progress, blocked, completed, failed, cancelled. Single value or array.",
    }),
  ),
  priority: Type.Optional(
    Type.Unsafe<string | string[]>({
      description:
        "Filter by priority: urgent, high, normal, low, background. Single value or array.",
    }),
  ),
  limit: Type.Optional(Type.Number({ default: 20 })),
  includeCompleted: Type.Optional(Type.Boolean({ default: false })),
  includeWorkerTasks: Type.Optional(
    Type.Boolean({
      default: false,
      description:
        "Include worker/job-assignment tasks. Leave false for the operator/main-agent board.",
    }),
  ),
  // For add/update actions
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  assignee: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description: "Task assignee: jason, argent, claude-code, a session key, or null to unassign",
    }),
  ),
  dueAt: Type.Optional(Type.Number()),
  tags: Type.Optional(Type.Array(Type.String())),
  parentTaskId: Type.Optional(Type.String()),
  // For start/complete/block/update actions
  taskId: Type.Optional(Type.String()),
  // For block action
  reason: Type.Optional(Type.String()),
  // For complete action
  notes: Type.Optional(Type.String()),
  // For search action
  query: Type.Optional(Type.String()),
  // For project_create action
  tasks: Type.Optional(
    Type.Array(
      Type.Object({
        title: Type.String(),
        description: Type.Optional(Type.String()),
        priority: Type.Optional(TaskPriorityEnum),
      }),
    ),
  ),
  // For project_detail action
  projectId: Type.Optional(Type.String()),
  // For team_list / claim actions
  teamId: Type.Optional(Type.String({ description: "Team ID for team-scoped operations" })),
});

// ============================================================================
// Tool Options
// ============================================================================

type TasksToolOptions = {
  agentSessionKey?: string;
  agentId?: string;
};

function isWorkerLaneTask(task: Task): boolean {
  if (task.source === "job") return true;
  if (!task.metadata || typeof task.metadata !== "object") return false;
  return Boolean((task.metadata as Record<string, unknown>).jobAssignmentId);
}

function filterOperatorLaneTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => !isWorkerLaneTask(task));
}

// ============================================================================
// Formatting Helpers
// ============================================================================

const PRIORITY_ICONS: Record<TaskPriority, string> = {
  urgent: "🔴",
  high: "🟠",
  normal: "🟡",
  low: "🟢",
  background: "⚪",
};

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending: "⏳",
  in_progress: "🔄",
  blocked: "🚫",
  completed: "✅",
  failed: "❌",
  cancelled: "🚮",
};

function formatTask(task: Task): string {
  const lines: string[] = [];

  lines.push(`${PRIORITY_ICONS[task.priority]} ${STATUS_ICONS[task.status]} **${task.title}**`);
  lines.push(`ID: ${task.id}`);
  lines.push(
    `Status: ${task.status} | Priority: ${task.priority}${task.assignee ? ` | Assignee: ${task.assignee}` : ""}`,
  );

  if (task.description) {
    lines.push(`Description: ${task.description}`);
  }

  if (task.dueAt) {
    const dueDate = new Date(task.dueAt);
    const isOverdue = task.dueAt < Date.now() && !["completed", "cancelled"].includes(task.status);
    lines.push(`Due: ${dueDate.toLocaleString()}${isOverdue ? " ⚠️ OVERDUE" : ""}`);
  }

  if (task.tags && task.tags.length > 0) {
    lines.push(`Tags: ${task.tags.join(", ")}`);
  }

  if (task.startedAt) {
    lines.push(`Started: ${new Date(task.startedAt).toLocaleString()}`);
  }

  if (task.completedAt) {
    lines.push(`Completed: ${new Date(task.completedAt).toLocaleString()}`);
  }

  return lines.join("\n");
}

function formatProject(project: ProjectWithChildren): string {
  const lines: string[] = [];
  const p = project.project;
  const progress =
    project.taskCount > 0 ? `${project.completedCount}/${project.taskCount}` : "0 tasks";

  lines.push(`📁 **${p.title}** [${progress}]`);
  lines.push(`ID: ${p.id}`);
  lines.push(`Status: ${p.status} | Priority: ${p.priority}`);

  if (p.description) {
    lines.push(`Description: ${p.description}`);
  }
  if (p.tags && p.tags.length > 0) {
    lines.push(`Tags: ${p.tags.join(", ")}`);
  }

  if (project.tasks.length > 0) {
    lines.push("");
    lines.push("Tasks:");
    for (const task of project.tasks) {
      const icon = STATUS_ICONS[task.status];
      lines.push(`  ${icon} [${task.id.slice(0, 8)}] ${task.title}`);
    }
  }

  return lines.join("\n");
}

function formatProjectList(projects: ProjectWithChildren[]): string {
  const lines: string[] = [];

  for (const proj of projects) {
    const p = proj.project;
    const progress = proj.taskCount > 0 ? `${proj.completedCount}/${proj.taskCount}` : "0 tasks";
    const priorityIcon = PRIORITY_ICONS[p.priority];

    // Derive status from child progress
    let statusLabel: string;
    if (proj.taskCount > 0 && proj.completedCount === proj.taskCount) {
      statusLabel = "done";
    } else if (proj.completedCount > 0) {
      statusLabel = "active";
    } else {
      statusLabel = "pending";
    }

    lines.push(
      `${priorityIcon} 📁 [${p.id.slice(0, 8)}] ${p.title} (${progress} — ${statusLabel})`,
    );
  }

  return lines.join("\n");
}

function formatTaskList(tasks: Task[]): string {
  const lines: string[] = [];

  for (const task of tasks) {
    const priorityIcon = PRIORITY_ICONS[task.priority];
    const statusIcon = STATUS_ICONS[task.status];
    const dueStr = task.dueAt ? ` (due: ${new Date(task.dueAt).toLocaleDateString()})` : "";
    const overdue =
      task.dueAt && task.dueAt < Date.now() && !["completed", "cancelled"].includes(task.status);

    lines.push(
      `${priorityIcon}${statusIcon} [${task.id.slice(0, 8)}] ${task.title}${dueStr}${overdue ? " ⚠️" : ""}`,
    );
  }

  return lines.join("\n");
}

function isProjectTask(task: Task): boolean {
  if (!task.metadata || typeof task.metadata !== "object") return false;
  return (task.metadata as Record<string, unknown>).type === "project";
}

function filterTasksByQuery(tasks: Task[], query: string): Task[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  return tasks.filter((task) => {
    const haystack = [
      task.title,
      task.description ?? "",
      ...(task.tags ?? []),
      task.assignee ?? "",
      task.id,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

async function listAllTasks(
  storage: Awaited<ReturnType<typeof getStorageAdapter>>,
  options?: { includeWorkerTasks?: boolean },
): Promise<Task[]> {
  const all: Task[] = [];
  const pageSize = 200;
  const hardCap = 5000;

  for (let offset = 0; offset < hardCap; offset += pageSize) {
    const page = await storage.tasks.list({ limit: pageSize, offset });
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < pageSize) break;
  }

  return options?.includeWorkerTasks ? all : filterOperatorLaneTasks(all);
}

async function getProjectWithChildrenFromStorage(
  storage: Awaited<ReturnType<typeof getStorageAdapter>>,
  projectId: string,
  options?: { includeWorkerTasks?: boolean },
): Promise<ProjectWithChildren | null> {
  const project = await storage.tasks.get(projectId);
  if (!project) return null;
  if (!options?.includeWorkerTasks && isWorkerLaneTask(project)) return null;

  const tasks = await storage.tasks.list({ parentTaskId: project.id, limit: 500 });
  const visibleTasks = options?.includeWorkerTasks ? tasks : filterOperatorLaneTasks(tasks);
  const completedCount = visibleTasks.filter((t) => t.status === "completed").length;

  return {
    project,
    tasks: visibleTasks,
    taskCount: visibleTasks.length,
    completedCount,
  };
}

async function resolveSessionTeam(
  storage: Awaited<ReturnType<typeof getStorageAdapter>>,
  sessionKey: string,
): Promise<{ id: string; name: string } | null> {
  const teams = await storage.teams.list();
  for (const team of teams) {
    const teamWithMembers = await storage.teams.get(team.id);
    if (teamWithMembers?.members.some((m) => m.sessionKey === sessionKey)) {
      return { id: team.id, name: team.name };
    }
  }
  return null;
}

// ============================================================================
// Tool Implementation
// ============================================================================

export function createTasksTool(opts?: TasksToolOptions): AnyAgentTool {
  return {
    label: "Tasks",
    name: "tasks",
    description: `Manage tasks and projects on the ArgentOS task board.

ACTIONS:
- list: List tasks (filter by status/priority, default shows active tasks)
- add: Create a new task (requires title, optional parentTaskId to add to a project)
- start: Start working on a task (requires taskId)
- complete: Mark task as complete (requires taskId, optional notes). For team tasks, auto-unblocks dependents.
- block: Mark task as blocked (requires taskId and reason)
- update: Update task details (requires taskId)
- search: Search tasks by keyword (requires query)
- counts: Get task counts by status
- overdue: List overdue tasks
- project_create: Create a project with child tasks (requires title, tasks[])
- project_list: List all projects with progress (optional status filter)
- project_detail: Get project details with all child tasks (requires projectId)
- claim: Claim an unassigned pending task (optional taskId for specific, or auto-picks first available). Use teamId to scope.
- team_list: List tasks scoped to a team (requires teamId, or auto-detects from session)`,
    parameters: TasksToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const storage = await getStorageAdapter();

      switch (action) {
        case "list": {
          const statusParam = params.status as TaskStatus | TaskStatus[] | undefined;
          const priorityParam = params.priority as TaskPriority | TaskPriority[] | undefined;
          const limit = typeof params.limit === "number" ? params.limit : 20;
          const includeCompleted = Boolean(params.includeCompleted);
          const includeWorkerTasks = Boolean(params.includeWorkerTasks);

          const filter: TaskFilter = { limit };

          if (statusParam) {
            filter.status = statusParam;
          } else if (!includeCompleted) {
            filter.status = ["pending", "in_progress", "blocked"];
          }

          if (priorityParam) {
            filter.priority = priorityParam;
          }

          const tasks = (await storage.tasks.list(filter)).filter(
            (task) => includeWorkerTasks || !isWorkerLaneTask(task),
          );

          if (tasks.length === 0) {
            return textResult("No tasks found matching the criteria.");
          }

          return textResult(`Found ${tasks.length} task(s):\n\n${formatTaskList(tasks)}`);
        }

        case "add": {
          const title = readStringParam(params, "title", { required: true });
          const description = readStringParam(params, "description");
          const priority = (params.priority as TaskPriority) || "normal";
          const assignee = params.assignee as string | undefined;
          const dueAt = typeof params.dueAt === "number" ? params.dueAt : undefined;
          const tags = Array.isArray(params.tags) ? (params.tags as string[]) : undefined;
          const parentTaskId = readStringParam(params, "parentTaskId");

          const task = await storage.tasks.create({
            title,
            description,
            priority,
            assignee,
            dueAt,
            tags,
            parentTaskId,
            source: "agent",
            agentId: opts?.agentId,
          });

          return textResult(`Created task:\n\n${formatTask(task)}`);
        }

        case "start": {
          const taskId = readStringParam(params, "taskId", { required: true });
          const task = await storage.tasks.start(taskId);

          if (!task) {
            return textResult(`Task not found: ${taskId}`);
          }

          return textResult(`Started task:\n\n${formatTask(task)}`);
        }

        case "complete": {
          const taskId = readStringParam(params, "taskId", { required: true });
          const notes = readStringParam(params, "notes");

          const taskToComplete = await storage.tasks.get(taskId);
          if (!taskToComplete) {
            return textResult(`Task not found: ${taskId}`);
          }

          if (notes) {
            await storage.tasks.update(taskToComplete.id, {
              metadata: { ...(taskToComplete.metadata ?? {}), completionNotes: notes },
            });
          }

          const blockedCandidates = (
            await storage.tasks.list({
              status: "blocked",
              limit: 1000,
            })
          ).filter((task) => task.dependsOn?.includes(taskToComplete.id));

          const task = await storage.tasks.complete(taskToComplete.id);

          if (!task) {
            return textResult(`Task not found: ${taskId}`);
          }

          const unblockedTasks: Task[] = [];
          for (const blocked of blockedCandidates) {
            const candidate = await storage.tasks.get(blocked.id);
            if (candidate?.status === "pending") {
              unblockedTasks.push(candidate);
            }
          }

          let result = `Completed task:\n\n${formatTask(task)}`;
          if (unblockedTasks.length > 0) {
            result += `\n\n🔓 Unblocked ${unblockedTasks.length} dependent task(s):\n`;
            result += unblockedTasks.map((t) => `  - [${t.id.slice(0, 8)}] ${t.title}`).join("\n");

            // Auto-nudge: notify assigned workers that their task is unblocked
            for (const unblocked of unblockedTasks) {
              if (unblocked.assignee && unblocked.assignee.includes(":")) {
                try {
                  callGateway({
                    method: "agent",
                    params: {
                      sessionKey: unblocked.assignee,
                      message: `Task "${unblocked.title}" [${unblocked.id.slice(0, 8)}] is now unblocked and ready for you to work on. Use \`tasks action=start taskId=${unblocked.id.slice(0, 8)}\` to begin.`,
                      deliver: false,
                    },
                    timeoutMs: 5_000,
                  }).catch(() => {
                    // Best-effort nudge — ignore failures
                  });
                } catch {
                  // Best-effort nudge — ignore failures
                }
              }
            }
          }

          return textResult(result);
        }

        case "block": {
          const taskId = readStringParam(params, "taskId", { required: true });
          const reason = readStringParam(params, "reason", { required: true });

          const task = await storage.tasks.block(taskId, reason);

          if (!task) {
            return textResult(`Task not found: ${taskId}`);
          }

          return textResult(`Blocked task (${reason}):\n\n${formatTask(task)}`);
        }

        case "update": {
          const taskId = readStringParam(params, "taskId", { required: true });
          const title = readStringParam(params, "title");
          const description = readStringParam(params, "description");
          const status = params.status as TaskStatus | undefined;
          const priority = params.priority as TaskPriority | undefined;
          const assignee =
            params.assignee !== undefined ? (params.assignee as string | null) : undefined;
          const dueAt = typeof params.dueAt === "number" ? params.dueAt : undefined;
          const tags = Array.isArray(params.tags) ? (params.tags as string[]) : undefined;

          const task = await storage.tasks.update(taskId, {
            title,
            description,
            status,
            priority,
            assignee,
            dueAt,
            tags,
          });

          if (!task) {
            return textResult(`Task not found: ${taskId}`);
          }

          return textResult(`Updated task:\n\n${formatTask(task)}`);
        }

        case "search": {
          const query = readStringParam(params, "query", { required: true });
          const limit = typeof params.limit === "number" ? params.limit : 10;
          const includeWorkerTasks = Boolean(params.includeWorkerTasks);
          const tasks = filterTasksByQuery(
            await listAllTasks(storage, { includeWorkerTasks }),
            query,
          )
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, limit);

          if (tasks.length === 0) {
            return textResult(`No tasks found matching: "${query}"`);
          }

          return textResult(
            `Found ${tasks.length} task(s) matching "${query}":\n\n${formatTaskList(tasks)}`,
          );
        }

        case "counts": {
          const includeWorkerTasks = Boolean(params.includeWorkerTasks);
          const counts: Record<TaskStatus, number> = {
            pending: 0,
            in_progress: 0,
            blocked: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
          };
          for (const task of await listAllTasks(storage, { includeWorkerTasks })) {
            counts[task.status] += 1;
          }
          const lines = Object.entries(counts)
            .map(([status, count]) => `${STATUS_ICONS[status as TaskStatus]} ${status}: ${count}`)
            .join("\n");

          return textResult(`Task counts:\n\n${lines}`);
        }

        case "overdue": {
          const includeWorkerTasks = Boolean(params.includeWorkerTasks);
          const now = Date.now();
          const tasks = (await listAllTasks(storage, { includeWorkerTasks }))
            .filter(
              (task) =>
                (task.status === "pending" || task.status === "in_progress") &&
                typeof task.dueAt === "number" &&
                task.dueAt < now,
            )
            .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));

          if (tasks.length === 0) {
            return textResult("No overdue tasks. 🎉");
          }

          return textResult(`⚠️ ${tasks.length} overdue task(s):\n\n${formatTaskList(tasks)}`);
        }

        case "project_create": {
          const title = readStringParam(params, "title", { required: true });
          const description = readStringParam(params, "description");
          const priority = (params.priority as TaskPriority) || "normal";
          const tags = Array.isArray(params.tags) ? (params.tags as string[]) : undefined;
          const taskInputs = Array.isArray(params.tasks)
            ? (params.tasks as Array<{
                title: string;
                description?: string;
                priority?: TaskPriority;
              }>)
            : [];

          if (taskInputs.length === 0) {
            return textResult(
              "Error: project_create requires at least one task in the tasks[] array.",
            );
          }

          const projectTask = await storage.tasks.create({
            title,
            description,
            priority,
            tags,
            source: "agent",
            agentId: opts?.agentId,
            metadata: { type: "project" },
          });

          const childTasks: Task[] = [];
          for (const taskInput of taskInputs) {
            const child = await storage.tasks.create({
              title: taskInput.title,
              description: taskInput.description,
              priority: taskInput.priority,
              source: "agent",
              agentId: opts?.agentId,
              parentTaskId: projectTask.id,
            });
            childTasks.push(child);
          }

          const result: ProjectWithChildren = {
            project: projectTask,
            tasks: childTasks,
            taskCount: childTasks.length,
            completedCount: 0,
          };

          return textResult(`Created project:\n\n${formatProject(result)}`);
        }

        case "project_list": {
          const statusParam = params.status as TaskStatus | TaskStatus[] | undefined;
          const limit = typeof params.limit === "number" ? params.limit : 20;
          const includeWorkerTasks = Boolean(params.includeWorkerTasks);
          const statuses = statusParam
            ? Array.isArray(statusParam)
              ? statusParam
              : [statusParam]
            : null;
          const allTasks = await listAllTasks(storage, { includeWorkerTasks });
          const childByParentId = new Map<string, Task[]>();
          for (const task of allTasks) {
            if (!task.parentTaskId) continue;
            const bucket = childByParentId.get(task.parentTaskId) ?? [];
            bucket.push(task);
            childByParentId.set(task.parentTaskId, bucket);
          }
          const result = allTasks
            .filter((task) => isProjectTask(task))
            .filter((task) => (statuses ? statuses.includes(task.status) : true))
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit)
            .map((projectTask) => {
              const children = childByParentId.get(projectTask.id) ?? [];
              const completedCount = children.filter((t) => t.status === "completed").length;
              return {
                project: projectTask,
                tasks: [],
                taskCount: children.length,
                completedCount,
              } as ProjectWithChildren;
            });

          if (result.length === 0) {
            return textResult("No projects found.");
          }

          return textResult(`Found ${result.length} project(s):\n\n${formatProjectList(result)}`);
        }

        case "project_detail": {
          const projectId = readStringParam(params, "projectId", { required: true });
          const includeWorkerTasks = Boolean(params.includeWorkerTasks);
          const result = await getProjectWithChildrenFromStorage(storage, projectId, {
            includeWorkerTasks,
          });

          if (!result) {
            return textResult(`Project not found: ${projectId}`);
          }

          return textResult(`Project detail:\n\n${formatProject(result)}`);
        }

        case "claim": {
          // Atomically claim an unassigned pending task
          const teamId = readStringParam(params, "teamId");
          const taskId = readStringParam(params, "taskId");
          const claimerKey = opts?.agentSessionKey;

          if (!claimerKey) {
            return textResult("Error: no session key available to claim tasks.");
          }

          let effectiveTeamId = teamId;
          if (!effectiveTeamId && opts?.agentSessionKey) {
            const teamInfo = await resolveSessionTeam(storage, opts.agentSessionKey);
            if (teamInfo) {
              effectiveTeamId = teamInfo.id;
            }
          }

          if (taskId) {
            // Claim a specific task
            const task = await storage.tasks.get(taskId);
            if (!task) return textResult(`Task not found: ${taskId}`);
            if (!effectiveTeamId && isWorkerLaneTask(task)) {
              return textResult(
                "Worker/job-assignment tasks must be claimed from a team-scoped worker session.",
              );
            }
            if (effectiveTeamId && task.teamId !== effectiveTeamId) {
              return textResult(`Task does not belong to team: ${effectiveTeamId}`);
            }
            if (task.assignee) return textResult(`Task already assigned to: ${task.assignee}`);
            if (task.status !== "pending")
              return textResult(`Task status is ${task.status}, can only claim pending tasks.`);

            const updated = await storage.tasks.update(task.id, { assignee: claimerKey });
            if (!updated) return textResult(`Failed to claim task: ${taskId}`);
            return textResult(`Claimed task:\n\n${formatTask(updated)}`);
          }

          // Auto-claim: find first unassigned pending task in team
          const filter: TaskFilter = {
            status: "pending",
            limit: 200,
          };
          if (effectiveTeamId) filter.teamId = effectiveTeamId;

          const candidates = (await storage.tasks.list(filter))
            .filter((candidate) => effectiveTeamId || !isWorkerLaneTask(candidate))
            .filter((candidate) => !candidate.assignee)
            .sort((a, b) => a.createdAt - b.createdAt);
          if (candidates.length === 0) {
            return textResult("No unassigned pending tasks available to claim.");
          }

          const candidate = await storage.tasks.get(candidates[0].id);
          if (!candidate || candidate.assignee || candidate.status !== "pending") {
            return textResult("Failed to claim task (race condition — try again).");
          }
          const claimed = await storage.tasks.update(candidate.id, { assignee: claimerKey });
          if (!claimed) return textResult("Failed to claim task (race condition — try again).");
          return textResult(`Claimed task:\n\n${formatTask(claimed)}`);
        }

        case "team_list": {
          let teamId = readStringParam(params, "teamId");
          let teamName: string | null = null;

          if (!teamId && opts?.agentSessionKey) {
            const teamInfo = await resolveSessionTeam(storage, opts.agentSessionKey);
            if (teamInfo) {
              teamId = teamInfo.id;
              teamName = teamInfo.name;
            }
          }
          if (!teamId) return textResult("No teamId provided and no team found for this session.");

          const limit = typeof params.limit === "number" ? params.limit : 50;
          const statusParam = params.status as TaskStatus | TaskStatus[] | undefined;
          const filter: TaskFilter = {
            teamId,
            limit,
          };
          if (statusParam) filter.status = statusParam;

          const tasks = await storage.tasks.list(filter);
          if (tasks.length === 0) return textResult("No tasks found for this team.");
          if (teamName) {
            return textResult(
              `Team "${teamName}" — ${tasks.length} task(s):\n\n${formatTaskList(tasks)}`,
            );
          }
          return textResult(`Team tasks — ${tasks.length} task(s):\n\n${formatTaskList(tasks)}`);
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
