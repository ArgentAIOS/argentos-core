/**
 * Tasks Database Module
 *
 * SQLite-backed task storage for the ArgentOS dashboard.
 * Shared with the agent via the unified data API.
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

// Use the unified ArgentOS data directory
const DATA_DIR = path.join(process.env.HOME, ".argentos", "data");
const DB_PATH = path.join(DATA_DIR, "dashboard.db");

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create schema
const initSchema = () => {
  // Tasks table
  db.exec(`
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
    )
  `);

  // Indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC)`);

  // FTS for task search (standalone, not content-linked)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
      task_id,
      title,
      description,
      tags
    )
  `);

  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
      INSERT INTO tasks_fts(task_id, title, description, tags)
      VALUES (new.id, new.title, new.description, new.tags);
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
      DELETE FROM tasks_fts WHERE task_id = old.id;
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
      UPDATE tasks_fts SET
        title = new.title,
        description = new.description,
        tags = new.tags
      WHERE task_id = old.id;
    END
  `);

  // Migration: add assignee column if it doesn't exist
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN assignee TEXT");
  } catch {
    // Column already exists — ignore
  }

  // Migration: add team_id column if it doesn't exist
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN team_id TEXT");
  } catch {
    // Column already exists — ignore
  }

  console.log("[TasksDB] Schema initialized at", DB_PATH);
};

initSchema();

// ============================================================================
// Schedule helpers
// ============================================================================

/**
 * Compute the next run time (epoch ms) for a scheduled or interval task.
 * @param {object} schedule - The task schedule object
 * @param {number} [fromTime] - Base time for calculation (defaults to now)
 * @returns {number|null} epoch ms of next run, or null if not applicable
 */
function computeNextRun(schedule, fromTime) {
  if (!schedule) return null;
  const now = fromTime || Date.now();

  if (schedule.frequency === "interval" && schedule.intervalMinutes) {
    return now + schedule.intervalMinutes * 60000;
  }

  if (schedule.frequency === "weekly" && schedule.days && schedule.days.length > 0) {
    const [hours, minutes] = (schedule.time || "09:00").split(":").map(Number);
    const base = new Date(now);

    // Try today + next 7 days to find the soonest matching day
    for (let offset = 0; offset < 8; offset++) {
      const candidate = new Date(base);
      candidate.setDate(candidate.getDate() + offset);
      candidate.setHours(hours, minutes, 0, 0);
      const dayOfWeek = candidate.getDay();
      if (schedule.days.includes(dayOfWeek) && candidate.getTime() > now) {
        return candidate.getTime();
      }
    }
    return null;
  }

  if (schedule.frequency === "daily") {
    const [hours, minutes] = (schedule.time || "09:00").split(":").map(Number);
    const candidate = new Date(now);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() <= now) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }

  return null;
}

/**
 * Get all scheduled/interval tasks that are due for execution.
 * Returns tasks where type is scheduled or interval, nextRun <= now, and status != completed.
 */
function getScheduledTasksDue() {
  const now = Date.now();
  const rows = db
    .prepare(`
      SELECT * FROM tasks
      WHERE status NOT IN ('completed', 'in-progress')
        AND (json_extract(metadata, '$.type') = 'scheduled'
          OR json_extract(metadata, '$.type') = 'interval')
        AND json_extract(metadata, '$.schedule.nextRun') IS NOT NULL
        AND json_extract(metadata, '$.schedule.nextRun') <= ?
    `)
    .all(now);
  return rows.map(rowToTask);
}

/**
 * After a scheduled task executes, update lastRun, recalculate nextRun,
 * and reset status to pending for recurring tasks.
 */
function markScheduledTaskExecuted(id) {
  const task = getTask(id);
  if (!task || !task.schedule) return null;

  const now = Date.now();
  const newSchedule = {
    ...task.schedule,
    lastRun: now,
    nextRun: computeNextRun(task.schedule, now),
  };

  // For recurring tasks (interval/weekly/daily), reset to pending so they fire again
  const meta = JSON.stringify({ type: task.type, schedule: newSchedule });
  db.prepare(`UPDATE tasks SET metadata = ?, status = 'pending', updated_at = ? WHERE id = ?`).run(
    meta,
    now,
    id,
  );
  return getTask(id);
}

// ============================================================================
// Helper functions
// ============================================================================

// Safely convert a DB timestamp (epoch ms or ISO string) to ISO string
function safeToISOString(value) {
  if (!value) return undefined;
  try {
    // If it's already an ISO string, validate it
    if (typeof value === "string") {
      const d = new Date(value);
      return isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    return new Date(value).toISOString();
  } catch {
    return undefined;
  }
}

// Convert DB row to dashboard task format
function rowToTask(row) {
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    details: row.description || undefined,
    status: mapStatusFromDb(row.status),
    type: row.metadata ? JSON.parse(row.metadata).type || "one-time" : "one-time",
    schedule: row.metadata ? JSON.parse(row.metadata).schedule : undefined,
    priority: row.priority,
    assignee: row.assignee || undefined,
    createdAt: safeToISOString(row.created_at),
    startedAt: safeToISOString(row.started_at),
    completedAt: safeToISOString(row.completed_at),
    dueAt: safeToISOString(row.due_at),
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    source: row.source,
    agentId: row.agent_id,
    teamId: row.team_id || undefined,
    parentTaskId: row.parent_task_id || undefined,
  };
}

// Map dashboard status to DB status
function mapStatusToDb(status) {
  const map = {
    pending: "pending",
    "in-progress": "in_progress",
    completed: "completed",
    blocked: "blocked",
    failed: "failed",
  };
  return map[status] || status;
}

// Map DB status to dashboard status
function mapStatusFromDb(status) {
  const map = {
    pending: "pending",
    in_progress: "in-progress",
    completed: "completed",
    blocked: "blocked",
    failed: "failed",
  };
  return map[status] || status;
}

// ============================================================================
// CRUD Operations
// ============================================================================

// List all tasks
function listTasks(options = {}) {
  const { includeCompleted = true, limit = 100, offset = 0, assignee } = options;

  let sql = "SELECT * FROM tasks";
  const conditions = [];
  const params = [];

  if (!includeCompleted) {
    conditions.push("status != 'completed' AND status != 'cancelled'");
  }

  if (assignee !== undefined) {
    if (assignee === null) {
      conditions.push("assignee IS NULL");
    } else {
      conditions.push("assignee = ?");
      params.push(assignee);
    }
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY created_at DESC";

  if (limit) {
    sql += " LIMIT ?";
    params.push(limit);
    if (offset > 0) {
      sql += " OFFSET ?";
      params.push(offset);
    }
  }

  const rows = db.prepare(sql).all(...params);
  return rows.map(rowToTask);
}

// Get a single task
function getTask(id) {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  return rowToTask(row);
}

// Create a new task
function createTask({
  title,
  details,
  type = "one-time",
  schedule,
  priority = "normal",
  source = "user",
  assignee,
  parentTaskId,
}) {
  const id = randomUUID();
  const now = Date.now();

  // Compute nextRun for scheduled/interval tasks
  let enrichedSchedule = schedule;
  if ((type === "scheduled" || type === "interval") && schedule) {
    const nextRun = computeNextRun(schedule, now);
    enrichedSchedule = { ...schedule, nextRun };
  }
  const metadata = JSON.stringify({ type, schedule: enrichedSchedule });

  db.prepare(`
    INSERT INTO tasks (id, title, description, status, priority, source, assignee, created_at, updated_at, metadata, parent_task_id)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title,
    details || null,
    priority,
    source,
    assignee || null,
    now,
    now,
    metadata,
    parentTaskId || null,
  );

  return getTask(id);
}

// Update a task
function updateTask(id, updates) {
  const existing = getTask(id);
  if (!existing) return null;

  const now = Date.now();
  const sets = ["updated_at = ?"];
  const params = [now];

  if (updates.title !== undefined) {
    sets.push("title = ?");
    params.push(updates.title);
  }

  if (updates.details !== undefined) {
    sets.push("description = ?");
    params.push(updates.details || null);
  }

  if (updates.status !== undefined) {
    const dbStatus = mapStatusToDb(updates.status);
    sets.push("status = ?");
    params.push(dbStatus);

    if (updates.status === "in-progress" && existing.status === "pending") {
      sets.push("started_at = ?");
      params.push(now);
    }

    if (updates.status === "completed") {
      sets.push("completed_at = ?");
      params.push(now);
    }
  }

  if (updates.priority !== undefined) {
    sets.push("priority = ?");
    params.push(updates.priority);
  }

  if (updates.assignee !== undefined) {
    sets.push("assignee = ?");
    params.push(updates.assignee);
  }

  if (updates.type !== undefined || updates.schedule !== undefined) {
    const currentMeta = existing.type ? { type: existing.type, schedule: existing.schedule } : {};
    const newMeta = {
      ...currentMeta,
      ...(updates.type !== undefined && { type: updates.type }),
      ...(updates.schedule !== undefined && { schedule: updates.schedule }),
    };
    sets.push("metadata = ?");
    params.push(JSON.stringify(newMeta));
  }

  params.push(id);

  db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getTask(id);
}

// Delete a task
function deleteTask(id) {
  const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  return result.changes > 0;
}

// Start a task
function startTask(id) {
  return updateTask(id, { status: "in-progress" });
}

// Complete a task
function completeTask(id) {
  return updateTask(id, { status: "completed" });
}

// Search tasks
function searchTasks(query, limit = 20, offset = 0) {
  try {
    const sql = `
      SELECT t.* FROM tasks t
      JOIN tasks_fts fts ON t.id = fts.task_id
      WHERE tasks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
      OFFSET ?
    `;
    const rows = db.prepare(sql).all(query, limit, Math.max(0, Number(offset) || 0));
    return rows.map(rowToTask);
  } catch (err) {
    // Fallback to LIKE search
    const pattern = `%${query}%`;
    const rows = db
      .prepare(`
      SELECT * FROM tasks
      WHERE title LIKE ? OR description LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
      OFFSET ?
    `)
      .all(pattern, pattern, limit, Math.max(0, Number(offset) || 0));
    return rows.map(rowToTask);
  }
}

// Get task counts by status
function getTaskCounts() {
  const rows = db.prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status").all();
  const counts = {
    pending: 0,
    "in-progress": 0,
    completed: 0,
    blocked: 0,
    failed: 0,
  };
  for (const row of rows) {
    const dashStatus = mapStatusFromDb(row.status);
    counts[dashStatus] = row.count;
  }
  return counts;
}

// ============================================================================
// Projects
// ============================================================================

// List all projects with child task counts
function listProjects(options = {}) {
  const { limit = 50 } = options;

  const sql = `
    SELECT t.*,
      (SELECT COUNT(*) FROM tasks AS c WHERE c.parent_task_id = t.id) AS task_count,
      (SELECT COUNT(*) FROM tasks AS c WHERE c.parent_task_id = t.id AND c.status = 'completed') AS completed_count
    FROM tasks t
    WHERE json_extract(t.metadata, '$.type') = 'project'
    ORDER BY t.created_at DESC
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(limit);

  return rows.map((row) => ({
    ...rowToTask(row),
    taskCount: row.task_count,
    completedCount: row.completed_count,
  }));
}

// Get all child tasks for a project
function getProjectTasks(projectId) {
  const rows = db
    .prepare("SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC")
    .all(projectId);
  return rows.map(rowToTask);
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  db,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
  searchTasks,
  getTaskCounts,
  listProjects,
  getProjectTasks,
  getScheduledTasksDue,
  markScheduledTaskExecuted,
  DB_PATH,
};
