/**
 * Tasks Data Module
 *
 * CRUD operations for tasks stored in the dashboard database.
 * Used by agents to programmatically manage the task board.
 */

import { randomUUID } from "node:crypto";
import type { ConnectionManager } from "./connection.js";
import type {
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TaskFilter,
  TaskStatus,
  TaskPriority,
  TaskAssignee,
  ProjectCreateInput,
  ProjectWithChildren,
} from "./types.js";

const TASKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal',
  source TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  due_at INTEGER,
  agent_id TEXT,
  session_id TEXT,
  channel_id TEXT,
  parent_task_id TEXT,
  tags TEXT,
  metadata TEXT,
  FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_agent_id ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);

-- FTS for task search (standalone, not content-linked)
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  task_id,
  title,
  description,
  tags
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(task_id, title, description, tags)
  VALUES (new.id, new.title, new.description, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
  DELETE FROM tasks_fts WHERE task_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
  UPDATE tasks_fts SET
    title = new.title,
    description = new.description,
    tags = new.tags
  WHERE task_id = old.id;
END;

`;

export class TasksModule {
  private conn: ConnectionManager;
  private initialized = false;

  constructor(conn: ConnectionManager) {
    this.conn = conn;
  }

  /**
   * Initialize the tasks schema
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const db = this.conn.getDatabase("dashboard");
    db.exec(TASKS_SCHEMA);

    // Migration: add assignee column if it doesn't exist
    try {
      db.exec("ALTER TABLE tasks ADD COLUMN assignee TEXT");
    } catch {
      // Column already exists — ignore
    }

    // Migration: add depends_on and team_id columns
    try {
      db.exec("ALTER TABLE tasks ADD COLUMN depends_on TEXT DEFAULT '[]'");
    } catch {
      // Column already exists — ignore
    }
    try {
      db.exec("ALTER TABLE tasks ADD COLUMN team_id TEXT");
    } catch {
      // Column already exists — ignore
    }
    try {
      db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_team_id ON tasks(team_id)");
    } catch {
      // Index already exists — ignore
    }

    this.initialized = true;
  }

  /**
   * Create a new task
   */
  create(input: TaskCreateInput): Task {
    const now = Date.now();
    const id = randomUUID();

    // Tasks with unresolved dependencies start as blocked
    const hasDeps = input.dependsOn && input.dependsOn.length > 0;
    const initialStatus = hasDeps ? "blocked" : "pending";

    const task: Task = {
      id,
      title: input.title,
      description: input.description,
      status: initialStatus,
      priority: input.priority || "normal",
      source: input.source || "user",
      assignee: input.assignee,
      createdAt: now,
      updatedAt: now,
      dueAt: input.dueAt,
      agentId: input.agentId,
      channelId: input.channelId,
      parentTaskId: input.parentTaskId,
      dependsOn: input.dependsOn,
      teamId: input.teamId,
      tags: input.tags,
      metadata: input.metadata,
    };

    this.conn.execute(
      "dashboard",
      `INSERT INTO tasks (
        id, title, description, status, priority, source, assignee,
        created_at, updated_at, due_at, agent_id, channel_id,
        parent_task_id, depends_on, team_id, tags, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.title,
        task.description || null,
        task.status,
        task.priority,
        task.source,
        task.assignee || null,
        task.createdAt,
        task.updatedAt,
        task.dueAt || null,
        task.agentId || null,
        task.channelId || null,
        task.parentTaskId || null,
        task.dependsOn ? JSON.stringify(task.dependsOn) : "[]",
        task.teamId || null,
        task.tags ? JSON.stringify(task.tags) : null,
        task.metadata ? JSON.stringify(task.metadata) : null,
      ],
    );

    return task;
  }

  /**
   * Get a task by ID (supports full UUID or prefix match)
   */
  get(id: string): Task | null {
    const db = this.conn.getDatabase("dashboard");
    // Try exact match first
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    if (row) return this.rowToTask(row);

    // Try prefix match (for short IDs like first 8 chars)
    if (id.length >= 4 && id.length < 36) {
      const prefixRow = db.prepare("SELECT * FROM tasks WHERE id LIKE ? LIMIT 1").get(`${id}%`) as
        | TaskRow
        | undefined;
      return prefixRow ? this.rowToTask(prefixRow) : null;
    }

    return null;
  }

  /**
   * Update a task
   */
  update(id: string, input: TaskUpdateInput): Task | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = Date.now();
    const updates: string[] = ["updated_at = ?"];
    const params: unknown[] = [now];

    if (input.title !== undefined) {
      updates.push("title = ?");
      params.push(input.title);
    }
    if (input.description !== undefined) {
      updates.push("description = ?");
      params.push(input.description);
    }
    if (input.status !== undefined) {
      updates.push("status = ?");
      params.push(input.status);

      // Track status transitions
      if (input.status === "in_progress" && existing.status === "pending") {
        updates.push("started_at = ?");
        params.push(now);
      }
      if (
        input.status === "completed" ||
        input.status === "failed" ||
        input.status === "cancelled"
      ) {
        updates.push("completed_at = ?");
        params.push(now);
      }
    }
    if (input.priority !== undefined) {
      updates.push("priority = ?");
      params.push(input.priority);
    }
    if (input.assignee !== undefined) {
      updates.push("assignee = ?");
      params.push(input.assignee);
    }
    if (input.dueAt !== undefined) {
      updates.push("due_at = ?");
      params.push(input.dueAt);
    }
    if (input.dependsOn !== undefined) {
      updates.push("depends_on = ?");
      params.push(JSON.stringify(input.dependsOn));
    }
    if (input.teamId !== undefined) {
      updates.push("team_id = ?");
      params.push(input.teamId);
    }
    if (input.tags !== undefined) {
      updates.push("tags = ?");
      params.push(JSON.stringify(input.tags));
    }
    if (input.metadata !== undefined) {
      updates.push("metadata = ?");
      params.push(JSON.stringify(input.metadata));
    }

    params.push(existing.id);

    this.conn.execute("dashboard", `UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, params);

    return this.get(existing.id);
  }

  /**
   * Delete a task
   */
  delete(id: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    const result = this.conn.execute("dashboard", "DELETE FROM tasks WHERE id = ?", [existing.id]);
    return result.changes > 0;
  }

  /**
   * List tasks with optional filtering
   */
  list(filter?: TaskFilter): Task[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    if (filter?.priority) {
      const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
      conditions.push(`priority IN (${priorities.map(() => "?").join(", ")})`);
      params.push(...priorities);
    }
    if (filter?.source) {
      const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
      conditions.push(`source IN (${sources.map(() => "?").join(", ")})`);
      params.push(...sources);
    }
    if (filter?.assignee !== undefined) {
      if (filter.assignee === null) {
        conditions.push("assignee IS NULL");
      } else {
        conditions.push("assignee = ?");
        params.push(filter.assignee);
      }
    }
    if (filter?.agentId) {
      conditions.push("agent_id = ?");
      params.push(filter.agentId);
    }
    if (filter?.channelId) {
      conditions.push("channel_id = ?");
      params.push(filter.channelId);
    }
    if (filter?.teamId) {
      conditions.push("team_id = ?");
      params.push(filter.teamId);
    }
    if (filter?.tags && filter.tags.length > 0) {
      // Match any of the tags
      const tagConditions = filter.tags.map(() => "tags LIKE ?");
      conditions.push(`(${tagConditions.join(" OR ")})`);
      params.push(...filter.tags.map((t) => `%"${t}"%`));
    }
    if (filter?.dueBefore) {
      conditions.push("due_at <= ?");
      params.push(filter.dueBefore);
    }
    if (filter?.dueAfter) {
      conditions.push("due_at >= ?");
      params.push(filter.dueAfter);
    }
    if (filter?.isProject === true) {
      conditions.push("json_extract(metadata, '$.type') = 'project'");
    }
    if (filter?.isProject === false) {
      conditions.push("(metadata IS NULL OR json_extract(metadata, '$.type') != 'project')");
    }
    if (filter?.parentTaskId) {
      conditions.push("parent_task_id = ?");
      params.push(filter.parentTaskId);
    }

    let sql = "SELECT * FROM tasks";
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += " ORDER BY priority DESC, due_at ASC, created_at DESC";

    if (filter?.limit) {
      sql += ` LIMIT ${filter.limit}`;
    }
    if (filter?.offset) {
      sql += ` OFFSET ${filter.offset}`;
    }

    const db = this.conn.getDatabase("dashboard");
    const rows = db.prepare(sql).all(...params) as TaskRow[];
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Search tasks using FTS
   */
  search(query: string, limit = 20): Task[] {
    const db = this.conn.getDatabase("dashboard");
    const sql = `
      SELECT t.* FROM tasks t
      JOIN tasks_fts fts ON t.id = fts.task_id
      WHERE tasks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(query, limit) as TaskRow[];
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Start a task (change status to in_progress)
   */
  start(id: string): Task | null {
    const task = this.get(id);
    if (!task) return null;

    if (this.hasUnresolvedDependencies(task)) {
      return this.update(task.id, {
        status: "blocked",
        metadata: {
          ...(task.metadata ?? {}),
          blockedReason: "Waiting on dependencies",
        },
      });
    }

    return this.update(task.id, { status: "in_progress" });
  }

  /**
   * Complete a task
   */
  complete(id: string): Task | null {
    const task = this.markCompleted(id);
    if (!task) return null;
    this.resolveUnblockedDependents(task);
    return task;
  }

  /**
   * Complete a task and resolve any dependent tasks whose deps are now all satisfied.
   * Returns the completed task and any newly unblocked tasks.
   */
  completeAndResolve(id: string): { task: Task | null; unblockedTasks: Task[] } {
    const task = this.markCompleted(id);
    if (!task) return { task: null, unblockedTasks: [] };

    const unblockedTasks = this.resolveUnblockedDependents(task);
    return { task, unblockedTasks };
  }

  /**
   * After completing a task, find blocked tasks that depend on it and unblock
   * those whose ALL dependencies are now completed.
   */
  private resolveUnblockedDependents(completedTask: Task): Task[] {
    const db = this.conn.getDatabase("dashboard");

    // Find all blocked tasks that reference this task in their depends_on
    const candidateRows = db
      .prepare(
        `SELECT * FROM tasks
         WHERE status = 'blocked'
         AND depends_on LIKE ?`,
      )
      .all(`%${completedTask.id}%`) as TaskRow[];

    const unblocked: Task[] = [];

    for (const row of candidateRows) {
      const candidate = this.rowToTask(row);
      if (!candidate.dependsOn || candidate.dependsOn.length === 0) continue;

      // Check if the completed task ID is actually in the depends_on array
      if (!candidate.dependsOn.includes(completedTask.id)) continue;

      // Check if ALL dependencies are now completed
      const allDepsCompleted = candidate.dependsOn.every((depId) => {
        if (depId === completedTask.id) return true;
        const dep = this.get(depId);
        return dep?.status === "completed";
      });

      if (allDepsCompleted) {
        const updated = this.update(candidate.id, { status: "pending" });
        if (updated) {
          unblocked.push(updated);
        }
      }
    }

    return unblocked;
  }

  private markCompleted(id: string): Task | null {
    return this.update(id, { status: "completed" });
  }

  private hasUnresolvedDependencies(task: Task): boolean {
    if (!task.dependsOn || task.dependsOn.length === 0) return false;
    return task.dependsOn.some((depId) => {
      const dep = this.get(depId);
      return dep?.status !== "completed";
    });
  }

  /**
   * Block a task
   */
  block(id: string, reason?: string): Task | null {
    const task = this.get(id);
    if (!task) return null;

    const metadata = { ...task.metadata, blockedReason: reason };
    return this.update(id, { status: "blocked", metadata });
  }

  /**
   * Fail a task
   */
  fail(id: string, reason?: string): Task | null {
    const task = this.get(id);
    if (!task) return null;

    const metadata = { ...task.metadata, failureReason: reason };
    return this.update(id, { status: "failed", metadata });
  }

  /**
   * Get task counts by status
   */
  getCounts(): Record<TaskStatus, number> {
    const db = this.conn.getDatabase("dashboard");
    const rows = db
      .prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status")
      .all() as Array<{
      status: TaskStatus;
      count: number;
    }>;

    const counts: Record<TaskStatus, number> = {
      pending: 0,
      in_progress: 0,
      blocked: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const row of rows) {
      counts[row.status] = row.count;
    }

    return counts;
  }

  /**
   * Get overdue tasks
   */
  getOverdue(): Task[] {
    return this.list({
      status: ["pending", "in_progress"],
      dueBefore: Date.now(),
    });
  }

  // ============================================================================
  // Projects
  // ============================================================================

  /**
   * Create a project (parent task) with child tasks
   */
  createProject(input: ProjectCreateInput): ProjectWithChildren {
    const projectTask = this.create({
      title: input.title,
      description: input.description,
      priority: input.priority || "normal",
      source: input.source || "agent",
      agentId: input.agentId,
      tags: input.tags,
      metadata: { type: "project" },
    });

    const childTasks: Task[] = [];
    for (const taskInput of input.tasks) {
      const child = this.create({
        ...taskInput,
        parentTaskId: projectTask.id,
        source: taskInput.source || input.source || "agent",
        agentId: taskInput.agentId || input.agentId,
      });
      childTasks.push(child);
    }

    return {
      project: projectTask,
      tasks: childTasks,
      taskCount: childTasks.length,
      completedCount: 0,
    };
  }

  /**
   * List all projects with child task counts
   */
  listProjects(filter?: TaskFilter): ProjectWithChildren[] {
    const db = this.conn.getDatabase("dashboard");

    const conditions: string[] = ["json_extract(t.metadata, '$.type') = 'project'"];
    const params: unknown[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(`t.status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    if (filter?.agentId) {
      conditions.push("t.agent_id = ?");
      params.push(filter.agentId);
    }

    const sql = `
      SELECT t.*,
        (SELECT COUNT(*) FROM tasks AS c WHERE c.parent_task_id = t.id) AS task_count,
        (SELECT COUNT(*) FROM tasks AS c WHERE c.parent_task_id = t.id AND c.status = 'completed') AS completed_count
      FROM tasks t
      WHERE ${conditions.join(" AND ")}
      ORDER BY t.created_at DESC
      LIMIT ?
    `;
    params.push(filter?.limit || 50);

    const rows = db.prepare(sql).all(...params) as (TaskRow & {
      task_count: number;
      completed_count: number;
    })[];

    return rows.map((row) => ({
      project: this.rowToTask(row),
      tasks: [], // populated on demand via getProjectWithChildren
      taskCount: row.task_count,
      completedCount: row.completed_count,
    }));
  }

  /**
   * Get a project with all its child tasks
   */
  getProjectWithChildren(projectId: string): ProjectWithChildren | null {
    const project = this.get(projectId);
    if (!project) return null;

    const db = this.conn.getDatabase("dashboard");
    const childRows = db
      .prepare("SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC")
      .all(projectId) as TaskRow[];

    const tasks = childRows.map((row) => this.rowToTask(row));
    const completedCount = tasks.filter((t) => t.status === "completed").length;

    return {
      project,
      tasks,
      taskCount: tasks.length,
      completedCount,
    };
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private rowToTask(row: TaskRow): Task {
    let dependsOn: string[] | undefined;
    if (row.depends_on) {
      try {
        const parsed = JSON.parse(row.depends_on);
        if (Array.isArray(parsed) && parsed.length > 0) {
          dependsOn = parsed;
        }
      } catch {
        // Malformed JSON — ignore
      }
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description || undefined,
      status: row.status as TaskStatus,
      priority: row.priority as TaskPriority,
      source: row.source as Task["source"],
      assignee: (row.assignee as TaskAssignee) || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      dueAt: row.due_at || undefined,
      agentId: row.agent_id || undefined,
      sessionId: row.session_id || undefined,
      channelId: row.channel_id || undefined,
      parentTaskId: row.parent_task_id || undefined,
      dependsOn,
      teamId: row.team_id || undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  source: string;
  assignee: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  due_at: number | null;
  agent_id: string | null;
  session_id: string | null;
  channel_id: string | null;
  parent_task_id: string | null;
  depends_on: string | null;
  team_id: string | null;
  tags: string | null;
  metadata: string | null;
}
