import { Type } from "@sinclair/typebox";
import type { ProjectWithChildren, Task, TaskPriority, TaskStatus } from "../../data/types.js";
import type { AnyAgentTool } from "./common.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import { readNumberParam, readStringArrayParam, readStringParam } from "./common.js";

const ProjectPriorityEnum = Type.Union([
  Type.Literal("urgent"),
  Type.Literal("high"),
  Type.Literal("normal"),
  Type.Literal("low"),
  Type.Literal("background"),
]);

const ProjectStatusEnum = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("blocked"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

const ProjectCreateSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  priority: Type.Optional(ProjectPriorityEnum),
  tags: Type.Optional(Type.Array(Type.String())),
  tasks: Type.Array(
    Type.Object({
      title: Type.String(),
      description: Type.Optional(Type.String()),
      priority: Type.Optional(ProjectPriorityEnum),
    }),
  ),
});

const ProjectsListSchema = Type.Object({
  status: Type.Optional(Type.Unsafe<string | string[]>()),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  includeWorkerTasks: Type.Optional(Type.Boolean()),
});

const ProjectDetailSchema = Type.Object({
  projectId: Type.String({ minLength: 1 }),
  includeWorkerTasks: Type.Optional(Type.Boolean()),
});

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function isWorkerLaneTask(task: Task): boolean {
  if (task.source === "job") return true;
  if (!task.metadata || typeof task.metadata !== "object") return false;
  return Boolean((task.metadata as Record<string, unknown>).jobAssignmentId);
}

function isProjectTask(task: Task): boolean {
  if (!task.metadata || typeof task.metadata !== "object") return false;
  return (task.metadata as Record<string, unknown>).type === "project";
}

function formatProject(project: ProjectWithChildren): string {
  const lines: string[] = [];
  const p = project.project;
  const progress =
    project.taskCount > 0 ? `${project.completedCount}/${project.taskCount}` : "0 tasks";
  lines.push(`📁 **${p.title}** [${progress}]`);
  lines.push(`ID: ${p.id}`);
  lines.push(`Status: ${p.status} | Priority: ${p.priority}`);
  if (p.description) lines.push(`Description: ${p.description}`);
  if (p.tags?.length) lines.push(`Tags: ${p.tags.join(", ")}`);
  if (project.tasks.length > 0) {
    lines.push("");
    lines.push("Tasks:");
    for (const task of project.tasks) {
      lines.push(`- [${task.status}] ${task.title} (${task.priority})`);
    }
  }
  return lines.join("\n");
}

function formatProjectList(projects: ProjectWithChildren[]): string {
  return projects
    .map((project) => {
      const p = project.project;
      const pct =
        project.taskCount > 0 ? Math.round((project.completedCount / project.taskCount) * 100) : 0;
      return `- [${p.status}] ${p.title} (id=${p.id}, ${project.completedCount}/${project.taskCount} tasks, ${pct}% complete, priority=${p.priority})`;
    })
    .join("\n");
}

async function listAllTasks(
  storage: Awaited<ReturnType<typeof getStorageAdapter>>,
  params: {
    includeWorkerTasks?: boolean;
  },
) {
  const result = await storage.tasks.list({ limit: 500 });
  return params.includeWorkerTasks ? result : result.filter((task) => !isWorkerLaneTask(task));
}

async function getProjectWithChildrenFromStorage(
  storage: Awaited<ReturnType<typeof getStorageAdapter>>,
  projectId: string,
  params: { includeWorkerTasks?: boolean },
): Promise<ProjectWithChildren | null> {
  const project = await storage.tasks.get(projectId);
  if (!project || (!params.includeWorkerTasks && isWorkerLaneTask(project))) {
    return null;
  }
  const tasks = await storage.tasks.list({ parentTaskId: project.id, limit: 500 });
  const filteredTasks = params.includeWorkerTasks
    ? tasks
    : tasks.filter((t) => !isWorkerLaneTask(t));
  return {
    project,
    tasks: filteredTasks,
    taskCount: filteredTasks.length,
    completedCount: filteredTasks.filter((task) => task.status === "completed").length,
  };
}

export function createProjectCreateTool(opts?: { agentId?: string }): AnyAgentTool {
  return {
    label: "Project Create",
    name: "project_create",
    description:
      "Create a project with child tasks. Use for project boards, project setup, roadmap setup, and when the operator asks to create a project with multiple tasks.",
    parameters: ProjectCreateSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const title = readStringParam(params, "title", { required: true });
      const description = readStringParam(params, "description");
      const priority =
        (readStringParam(params, "priority") as TaskPriority | undefined) ?? "normal";
      const tags = readStringArrayParam(params, "tags");
      const taskInputs = Array.isArray(params.tasks)
        ? (params.tasks as Array<{ title: string; description?: string; priority?: TaskPriority }>)
        : [];
      if (taskInputs.length === 0) {
        throw new Error("project_create requires at least one task in tasks[].");
      }
      const storage = await getStorageAdapter();
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
        childTasks.push(
          await storage.tasks.create({
            title: taskInput.title,
            description: taskInput.description,
            priority: taskInput.priority,
            source: "agent",
            agentId: opts?.agentId,
            parentTaskId: projectTask.id,
          }),
        );
      }
      return textResult(
        `Created project:\n\n${formatProject({
          project: projectTask,
          tasks: childTasks,
          taskCount: childTasks.length,
          completedCount: 0,
        })}`,
      );
    },
  };
}

export function createProjectsListTool(): AnyAgentTool {
  return {
    label: "Projects List",
    name: "projects_list",
    description:
      "List all projects with task counts and progress. Use for project board, project board summary, active projects, roadmap status, and what projects we are working on.",
    parameters: ProjectsListSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const statusRaw = params.status as TaskStatus | TaskStatus[] | undefined;
      const statuses = statusRaw ? (Array.isArray(statusRaw) ? statusRaw : [statusRaw]) : null;
      const limit = readNumberParam(params, "limit", { integer: true }) ?? 20;
      const includeWorkerTasks = params.includeWorkerTasks === true;
      const storage = await getStorageAdapter();
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
          return {
            project: projectTask,
            tasks: [],
            taskCount: children.length,
            completedCount: children.filter((task) => task.status === "completed").length,
          } satisfies ProjectWithChildren;
        });
      if (result.length === 0) {
        return textResult("No projects found.");
      }
      return textResult(`Found ${result.length} project(s):\n\n${formatProjectList(result)}`);
    },
  };
}

export function createProjectDetailTool(): AnyAgentTool {
  return {
    label: "Project Detail",
    name: "project_detail",
    description:
      "Get one project with all child tasks. Use for project detail, project status, project tasks, roadmap detail, and board drilldown.",
    parameters: ProjectDetailSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const projectId = readStringParam(params, "projectId", { required: true });
      const includeWorkerTasks = params.includeWorkerTasks === true;
      const storage = await getStorageAdapter();
      const result = await getProjectWithChildrenFromStorage(storage, projectId, {
        includeWorkerTasks,
      });
      if (!result) {
        return textResult(`Project not found: ${projectId}`);
      }
      return textResult(`Project detail:\n\n${formatProject(result)}`);
    },
  };
}
