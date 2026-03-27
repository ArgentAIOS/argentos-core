/**
 * TaskManagerWidget — Operator's personal task board (Kanban).
 *
 * Four columns: To Do, In Progress, Blocked, Done.
 * Data from the dashboard REST API via the useTasks hook.
 * Polls every 15s + SSE for real-time updates.
 */

import { Plus, AlertTriangle, Clock, CheckCircle2, Zap, Circle, X } from "lucide-react";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { Task } from "../TaskList";
import { useGateway } from "../../hooks/useGateway";
import { useTasks } from "../../hooks/useTasks";
import { fetchLocalApi } from "../../utils/localApiFetch";

// ── Helpers ────────────────────────────────────────────────────────

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDueDate(task: Task): string | null {
  const raw = (task as Task & { dueAt?: number | string | Date }).dueAt;
  if (!raw) return null;
  const due = typeof raw === "number" ? new Date(raw) : new Date(raw);
  if (Number.isNaN(due.getTime())) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) return "Overdue";
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return `${diffDays}d`;
}

function isOverdue(task: Task): boolean {
  const raw = (task as Task & { dueAt?: number | string | Date }).dueAt;
  if (!raw) return false;
  const due = typeof raw === "number" ? new Date(raw) : new Date(raw);
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now();
}

function isBlocked(task: Task): boolean {
  return task.status === ("blocked" as Task["status"]);
}

type PriorityKey = "urgent" | "high" | "normal" | "low" | "background";

const PRIORITY_CONFIG: Record<PriorityKey, { icon: typeof Zap; color: string; label: string }> = {
  urgent: { icon: Zap, color: "text-red-400", label: "Urgent" },
  high: { icon: Zap, color: "text-orange-400", label: "High" },
  normal: { icon: Circle, color: "text-blue-400", label: "Normal" },
  low: { icon: Circle, color: "text-white/30", label: "Low" },
  background: { icon: Circle, color: "text-white/20", label: "Bg" },
};

function taskPriority(task: Task): PriorityKey {
  const p = (task as Task & { priority?: string }).priority;
  if (p && p in PRIORITY_CONFIG) return p as PriorityKey;
  return "normal";
}

// Sort: urgent > high > normal > low > background, then by creation date desc
const PRIORITY_ORDER: Record<PriorityKey, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

function sortTasks(a: Task, b: Task): number {
  const pa = PRIORITY_ORDER[taskPriority(a)] ?? 2;
  const pb = PRIORITY_ORDER[taskPriority(b)] ?? 2;
  if (pa !== pb) return pa - pb;
  // Overdue first within same priority
  const aOverdue = isOverdue(a) ? 0 : 1;
  const bOverdue = isOverdue(b) ? 0 : 1;
  if (aOverdue !== bOverdue) return aOverdue - bOverdue;
  // Newer first
  return (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0);
}

// ── Agent Filtering ────────────────────────────────────────────────

interface FamilyMember {
  id: string;
  name: string;
  role?: string;
  alive?: boolean;
}

const EXCLUDED_AGENT_IDS = new Set(["main", "dumbo", "argent"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

function isOperationalAgent(a: { id: string; role?: string }): boolean {
  if (EXCLUDED_AGENT_IDS.has(a.id.toLowerCase())) return false;
  if (a.id.startsWith("test-") || a.id.startsWith("test_")) return false;
  if (UUID_RE.test(a.id)) return false;
  if (a.role === "think_tank_panelist") return false;
  if (!a.role) return false;
  return true;
}

// ── Create Task Modal ──────────────────────────────────────────────

const API_BASE = "/api";

interface CreateTaskModalProps {
  onClose: () => void;
  onCreated: () => void;
  agents: FamilyMember[];
  projects: Array<{ id: string; title: string }>;
}

function CreateTaskModal({ onClose, onCreated, agents, projects }: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"urgent" | "high" | "normal" | "low">("normal");
  const [assignee, setAssignee] = useState("");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        priority,
        type: "one-time",
      };
      if (description.trim()) body.details = description.trim();
      if (assignee) body.assignee = assignee;
      if (project) body.parentTaskId = project;
      if (tags.trim()) {
        body.tags = tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      }

      const res = await fetchLocalApi(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create task");
      onCreated();
      onClose();
    } catch (err) {
      console.error("[TaskManagerWidget] Error creating task:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const priorityColors: Record<string, string> = {
    urgent: "text-red-400",
    high: "text-orange-400",
    normal: "text-blue-400",
    low: "text-white/40",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white/90">Create Task</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
          >
            <X size={16} />
          </button>
        </div>

        {/* Title */}
        <div className="mb-4">
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/50">
            Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim()) handleSubmit();
            }}
            placeholder="What needs to be done?"
            autoFocus
            className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/25"
          />
        </div>

        {/* Description */}
        <div className="mb-4">
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/50">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Additional details..."
            rows={3}
            className="w-full resize-none rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/25"
          />
        </div>

        {/* Priority + Assign To row */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/50">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className={`w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm outline-none focus:border-white/25 ${priorityColors[priority] ?? "text-white"}`}
            >
              <option value="urgent" className="text-red-400">
                Urgent
              </option>
              <option value="high" className="text-orange-400">
                High
              </option>
              <option value="normal" className="text-blue-400">
                Normal
              </option>
              <option value="low" className="text-white/40">
                Low
              </option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/50">
              Assign To
            </label>
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-white outline-none focus:border-white/25"
            >
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Project + Tags row */}
        <div className="mb-6 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/50">
              Project
            </label>
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-white outline-none focus:border-white/25"
            >
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/50">
              Tags
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="tag1, tag2, ..."
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/25"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-white/50 transition-colors hover:bg-white/5 hover:text-white/70"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/15 disabled:opacity-30"
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Task Card ──────────────────────────────────────────────────────

function TaskCard({
  task,
  column,
}: {
  task: Task;
  column: "todo" | "progress" | "blocked" | "done";
}) {
  const priority = taskPriority(task);
  const cfg = PRIORITY_CONFIG[priority];
  const PriorityIcon = cfg.icon;
  const overdue = isOverdue(task);
  const blocked = isBlocked(task);
  const dueLabel = formatDueDate(task);

  const borderColor = blocked
    ? "border-l-amber-500"
    : overdue
      ? "border-l-red-500"
      : "border-l-transparent";

  return (
    <div
      className={`rounded-lg border border-white/[0.06] border-l-2 ${borderColor} bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.06]`}
    >
      {/* Title */}
      <div className="mb-1.5 text-[13px] font-medium leading-tight text-white/85">{task.title}</div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {/* Priority (skip for done column) */}
        {column !== "done" && (
          <span className={`flex items-center gap-1 ${cfg.color}`}>
            <PriorityIcon size={10} />
            {priority !== "normal" && cfg.label}
          </span>
        )}

        {/* Assignee */}
        {task.assignee && <span className="text-white/40">{task.assignee}</span>}

        {/* Due date / Overdue */}
        {column !== "done" && dueLabel && (
          <span
            className={`flex items-center gap-1 ${
              overdue ? "font-semibold text-red-400" : "text-white/40"
            }`}
          >
            <Clock size={10} />
            {overdue ? "Overdue!" : `Due: ${dueLabel}`}
          </span>
        )}

        {/* Blocked badge + reason */}
        {column === "blocked" && (
          <span className="flex items-center gap-1 font-medium text-amber-400">
            <AlertTriangle size={10} />
            {(task as Task & { blockerReason?: string }).blockerReason || "Blocked"}
          </span>
        )}

        {/* Blocked badge (non-blocked column, legacy) */}
        {column !== "blocked" && blocked && (
          <span className="flex items-center gap-1 font-medium text-amber-400">
            <AlertTriangle size={10} />
            Blocked
          </span>
        )}

        {/* Started duration (in progress column) */}
        {column === "progress" && task.startedAt && (
          <span className="text-white/35">
            Started{" "}
            {relativeTime(
              task.startedAt instanceof Date ? task.startedAt : new Date(task.startedAt),
            )}
          </span>
        )}

        {/* Completed time (done column) */}
        {column === "done" && task.completedAt && (
          <span className="flex items-center gap-1 text-emerald-400/60">
            <CheckCircle2 size={10} />
            {relativeTime(
              task.completedAt instanceof Date ? task.completedAt : new Date(task.completedAt),
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Column ─────────────────────────────────────────────────────────

function Column({
  title,
  count,
  tasks,
  column,
  accent,
}: {
  title: string;
  count: number;
  tasks: Task[];
  column: "todo" | "progress" | "blocked" | "done";
  accent: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Column header */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
          {title}
        </span>
        <span
          className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${accent}`}
        >
          {count}
        </span>
      </div>
      {/* Cards */}
      <div
        className="flex flex-col gap-1.5 overflow-y-auto pr-0.5"
        style={{ maxHeight: "calc(100% - 28px)" }}
      >
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} column={column} />
        ))}
        {tasks.length === 0 && (
          <div className="py-6 text-center text-[11px] text-white/20">None</div>
        )}
      </div>
    </div>
  );
}

// ── Widget ─────────────────────────────────────────────────────────

export function TaskManagerWidget() {
  const { tasks, projects, loading, refreshTasks } = useTasks({
    enabled: true,
    pollMs: 15_000,
    includeWorkerTasks: false,
    workerOnly: false,
  });

  const { request, connected } = useGateway();
  const [showModal, setShowModal] = useState(false);
  const [agents, setAgents] = useState<FamilyMember[]>([]);
  const agentsFetchedRef = useRef(false);

  // Fetch family members for the Assign To dropdown
  useEffect(() => {
    if (!connected || agentsFetchedRef.current) return;
    agentsFetchedRef.current = true;
    (async () => {
      try {
        const res = await request<{ members: FamilyMember[] }>("family.members");
        const members = res?.members ?? [];
        const operational = members.filter((m) => isOperationalAgent({ id: m.id, role: m.role }));
        setAgents(operational);
      } catch {
        // keep empty — dropdown will just show "Unassigned"
      }
    })();
  }, [connected, request]);

  const handleCreated = useCallback(() => {
    refreshTasks();
  }, [refreshTasks]);

  // Partition tasks into columns
  const { todo, inProgress, blocked, done, overdueCount, blockedCount } = useMemo(() => {
    const todoList: Task[] = [];
    const progressList: Task[] = [];
    const blockedList: Task[] = [];
    const doneList: Task[] = [];
    let ov = 0;
    let bl = 0;

    for (const t of tasks) {
      // Normalize status — the DB uses both "in-progress" and "in_progress"
      const status = (t.status ?? "pending").replace("-", "_");

      if (status === "completed" || status === "failed") {
        doneList.push(t);
      } else if (status === "in_progress") {
        progressList.push(t);
        if (isOverdue(t)) ov++;
      } else if (status === "blocked") {
        blockedList.push(t);
        bl++;
        if (isOverdue(t)) ov++;
      } else {
        // pending, cancelled
        todoList.push(t);
        if (isOverdue(t)) ov++;
      }
    }

    todoList.sort(sortTasks);
    progressList.sort(sortTasks);
    blockedList.sort(sortTasks);
    doneList.sort((a, b) => {
      const aTime = a.completedAt?.getTime?.() ?? 0;
      const bTime = b.completedAt?.getTime?.() ?? 0;
      return bTime - aTime; // newest completed first
    });

    return {
      todo: todoList,
      inProgress: progressList,
      blocked: blockedList,
      done: doneList.slice(0, 20), // cap done at 20
      overdueCount: ov,
      blockedCount: bl,
    };
  }, [tasks]);

  // Empty state
  if (!loading && tasks.length === 0) {
    return (
      <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
            Tasks
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/60 transition-colors hover:bg-white/15 hover:text-white/80"
          >
            <Plus size={12} />
            Add Task
          </button>
        </div>
        {showModal && (
          <CreateTaskModal
            onClose={() => setShowModal(false)}
            onCreated={handleCreated}
            agents={agents}
            projects={projects.map((p) => ({ id: p.id, title: p.title }))}
          />
        )}
        <div className="flex flex-1 items-center justify-center text-white/40">
          <div className="text-center">
            <div className="mb-2 text-3xl opacity-40">
              <CheckCircle2 size={36} className="mx-auto" />
            </div>
            <div className="text-sm">No tasks yet. Add tasks from chat or the Task List panel.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/5 p-6">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
            Tasks
          </div>
          {/* Summary stats */}
          <div className="flex items-center gap-2 text-[11px] text-white/35">
            <span>{tasks.length} total</span>
            {overdueCount > 0 && (
              <span className="font-medium text-red-400">{overdueCount} overdue</span>
            )}
            {blockedCount > 0 && (
              <span className="font-medium text-amber-400">{blockedCount} blocked</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/60 transition-colors hover:bg-white/15 hover:text-white/80"
        >
          <Plus size={12} />
          Add Task
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && tasks.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-[11px] text-white/25">
          Loading tasks...
        </div>
      )}

      {/* Kanban columns */}
      {(!loading || tasks.length > 0) && (
        <div className="flex flex-1 gap-3 overflow-hidden">
          <Column
            title="To Do"
            count={todo.length}
            tasks={todo}
            column="todo"
            accent="bg-white/10 text-white/50"
          />
          <Column
            title="In Progress"
            count={inProgress.length}
            tasks={inProgress}
            column="progress"
            accent="bg-blue-500/20 text-blue-400"
          />
          <Column
            title="Blocked"
            count={blocked.length}
            tasks={blocked}
            column="blocked"
            accent="bg-amber-500/20 text-amber-400"
          />
          <Column
            title="Done"
            count={done.length}
            tasks={done}
            column="done"
            accent="bg-emerald-500/20 text-emerald-400"
          />
        </div>
      )}

      {/* Create Task Modal */}
      {showModal && (
        <CreateTaskModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
          agents={agents}
          projects={projects.map((p) => ({ id: p.id, title: p.title }))}
        />
      )}
    </div>
  );
}
