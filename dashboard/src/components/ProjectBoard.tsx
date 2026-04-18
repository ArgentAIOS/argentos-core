import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion, AnimatePresence } from "framer-motion";
import {
  Archive,
  ArchiveRestore,
  Plus,
  X,
  LayoutGrid,
  List,
  Filter,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader,
  CheckCircle,
  AlertTriangle,
  Clock,
  Calendar,
  ArrowLeft,
  Trash2,
  Pencil,
  User,
  Tag,
  FileText,
} from "lucide-react";
import { useState, useMemo, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import type { Task, Project, TaskStatus, TaskType } from "./TaskList";
import { fetchLocalApi } from "../utils/localApiFetch";

// Extended task with optional assignee/priority (backend adds these)
interface BoardTask extends Omit<Task, "assignee"> {
  assignee?: string | null;
  priority?: string | null;
  tags?: string[];
}

type ViewMode = "overview" | "board" | "list" | "timeline";
type ColumnId = "pending" | "active" | "done";
const DAY_MS = 86_400_000;

interface ProjectBoardProps {
  tasks: Task[];
  projects: Project[];
  onTaskUpdate: (task: Task | BoardTask) => void;
  onTaskDelete: (id: string) => void;
  onTaskAdd: (title: string, type: TaskType, schedule?: Task["schedule"], details?: string) => void;
  onTaskStart: (id: string) => void;
  onTaskComplete: (id: string) => void;
  onProjectArchive?: (projectId: string, archived: boolean) => void | Promise<boolean | void>;
  onClose: () => void;
  selectedProjectId?: string;
  initialFilter?: {
    project?: string;
    assignee?: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

const STATIC_ASSIGNEES = [
  { id: "jason", label: "Operator", color: "bg-blue-500", letter: "O" },
  { id: "argent", label: "Main Agent", color: "bg-purple-500", letter: "A" },
];

type AssigneeOption = { id: string; label: string; color: string; letter: string };

const PRIORITIES = [
  { id: "urgent", label: "Urgent", color: "bg-red-500" },
  { id: "high", label: "High", color: "bg-orange-400" },
  { id: "normal", label: "Normal", color: "bg-blue-400" },
  { id: "low", label: "Low", color: "bg-gray-400" },
];

const COLUMNS: { id: ColumnId; label: string; statuses: TaskStatus[] }[] = [
  { id: "pending", label: "Pending", statuses: ["pending"] },
  { id: "active", label: "Active", statuses: ["in-progress"] },
  { id: "done", label: "Done", statuses: ["completed"] },
];

const columnColors: Record<ColumnId, string> = {
  pending: "text-gray-400",
  active: "text-purple-400",
  done: "text-green-400",
};

const columnBorderColors: Record<ColumnId, string> = {
  pending: "border-gray-500/30",
  active: "border-purple-500/30",
  done: "border-green-500/30",
};

function isArchivedProject(project: Project): boolean {
  const metadata = project.metadata;
  if (!metadata || typeof metadata !== "object") return false;
  const archivedAt = (metadata as Record<string, unknown>).archivedAt;
  return typeof archivedAt === "string" && archivedAt.trim().length > 0;
}

// ============================================================================
// Assignee Avatar
// ============================================================================

function AssigneeAvatar({
  assignee,
  options,
  size = "sm",
}: {
  assignee?: string | null;
  options: AssigneeOption[];
  size?: "sm" | "md";
}) {
  const match = options.find((a) => a.id === assignee);
  const dim = size === "sm" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs";

  if (!match) {
    return (
      <div
        className={`${dim} rounded-full bg-white/10 flex items-center justify-center text-white/40 font-medium flex-shrink-0`}
      >
        ?
      </div>
    );
  }

  return (
    <div
      className={`${dim} rounded-full ${match.color} flex items-center justify-center text-white font-medium flex-shrink-0`}
      title={match.label}
    >
      {match.letter}
    </div>
  );
}

// ============================================================================
// Priority Dot
// ============================================================================

function PriorityDot({ priority }: { priority?: string | null }) {
  const match = PRIORITIES.find((p) => p.id === priority);
  if (!match) return null;
  return (
    <div className={`w-2 h-2 rounded-full ${match.color} flex-shrink-0`} title={match.label} />
  );
}

function dueDateInputValue(value?: Date): string {
  if (!value || Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function diffInDays(start: Date, end: Date): number {
  return Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / DAY_MS);
}

function parseDueDateInput(value: string): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(`${trimmed}T23:59:59`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isOverdueTask(task: { dueAt?: Date; status?: TaskStatus | string }): boolean {
  if (!task.dueAt) return false;
  if (task.status === "completed") return false;
  return startOfDay(task.dueAt).getTime() < startOfDay(new Date()).getTime();
}

type TaskCommentRecord = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
};

type TaskActivityRecord = {
  id: string;
  at: string;
  text: string;
};

function normalizeTaskMetadata(task: {
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  const metadata = task.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
}

function parseTaskComments(task: { metadata?: Record<string, unknown> }): TaskCommentRecord[] {
  const raw = normalizeTaskMetadata(task).comments;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const body =
        typeof (entry as { body?: unknown }).body === "string"
          ? (entry as { body: string }).body.trim()
          : "";
      if (!body) return null;
      const createdAt =
        typeof (entry as { createdAt?: unknown }).createdAt === "string"
          ? (entry as { createdAt: string }).createdAt
          : new Date().toISOString();
      const author =
        typeof (entry as { author?: unknown }).author === "string" &&
        (entry as { author: string }).author.trim()
          ? (entry as { author: string }).author.trim()
          : "Operator";
      const id =
        typeof (entry as { id?: unknown }).id === "string" && (entry as { id: string }).id.trim()
          ? (entry as { id: string }).id
          : `${createdAt}:${body}`;
      return { id, body, author, createdAt };
    })
    .filter((entry): entry is TaskCommentRecord => Boolean(entry))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function parseTaskActivity(task: { metadata?: Record<string, unknown> }): TaskActivityRecord[] {
  const raw = normalizeTaskMetadata(task).activity;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const text =
        typeof (entry as { text?: unknown }).text === "string"
          ? (entry as { text: string }).text.trim()
          : "";
      if (!text) return null;
      const at =
        typeof (entry as { at?: unknown }).at === "string"
          ? (entry as { at: string }).at
          : new Date().toISOString();
      const id =
        typeof (entry as { id?: unknown }).id === "string" && (entry as { id: string }).id.trim()
          ? (entry as { id: string }).id
          : `${at}:${text}`;
      return { id, at, text };
    })
    .filter((entry): entry is TaskActivityRecord => Boolean(entry))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function makeActivityEntry(text: string, at = new Date().toISOString()): TaskActivityRecord {
  return {
    id: `${at}:${text}:${Math.random().toString(36).slice(2, 8)}`,
    at,
    text,
  };
}

function withRecordedTaskChanges(previous: BoardTask, next: BoardTask): BoardTask {
  const priorDue = previous.dueAt?.getTime() ?? null;
  const nextDue = next.dueAt?.getTime() ?? null;
  const newEntries: TaskActivityRecord[] = [];

  if (previous.title !== next.title) {
    newEntries.push(makeActivityEntry(`Title updated to "${next.title}".`));
  }
  if ((previous.details || "") !== (next.details || "")) {
    newEntries.push(
      makeActivityEntry(next.details ? "Description updated." : "Description cleared."),
    );
  }
  if (previous.status !== next.status) {
    const label =
      next.status === "in-progress" || next.status === "in_progress"
        ? "Active"
        : next.status === "completed"
          ? "Done"
          : "Pending";
    newEntries.push(makeActivityEntry(`Status changed to ${label}.`));
  }
  if ((previous.assignee || null) !== (next.assignee || null)) {
    newEntries.push(
      makeActivityEntry(
        next.assignee ? `Assignee changed to ${next.assignee}.` : "Assignee cleared.",
      ),
    );
  }
  if ((previous.priority || null) !== (next.priority || null)) {
    newEntries.push(
      makeActivityEntry(
        next.priority ? `Priority changed to ${next.priority}.` : "Priority cleared.",
      ),
    );
  }
  if (priorDue !== nextDue) {
    newEntries.push(
      makeActivityEntry(
        next.dueAt ? `Due date set to ${next.dueAt.toLocaleDateString()}.` : "Due date cleared.",
      ),
    );
  }

  if (newEntries.length === 0) return next;

  const metadata = normalizeTaskMetadata(next);
  return {
    ...next,
    metadata: {
      ...metadata,
      activity: [...parseTaskActivity(next), ...newEntries],
    },
  };
}

function buildTaskTimeline(task: BoardTask): TaskActivityRecord[] {
  const derived: TaskActivityRecord[] = [
    {
      id: `${task.id}:created`,
      at: task.createdAt.toISOString(),
      text: "Task created.",
    },
  ];

  if (task.startedAt) {
    derived.push({
      id: `${task.id}:started`,
      at: task.startedAt.toISOString(),
      text: "Work started.",
    });
  }
  if (task.completedAt) {
    derived.push({
      id: `${task.id}:completed`,
      at: task.completedAt.toISOString(),
      text: "Task completed.",
    });
  }
  if (task.dueAt) {
    derived.push({
      id: `${task.id}:due`,
      at: task.dueAt.toISOString(),
      text: `Due ${task.dueAt.toLocaleDateString()}.`,
    });
  }

  return [...parseTaskActivity(task), ...derived].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
}

// ============================================================================
// Task Card (used in board view)
// ============================================================================

function TaskCard({
  task,
  assigneeOptions,
  onClick,
  isDragOverlay,
}: {
  task: BoardTask;
  assigneeOptions: AssigneeOption[];
  onClick: () => void;
  isDragOverlay?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 p-3 cursor-pointer transition-all group ${
        isDragOverlay
          ? "shadow-2xl shadow-purple-500/20 ring-1 ring-purple-500/30 scale-[1.02]"
          : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <PriorityDot priority={task.priority} />
        <span className="text-white/80 text-sm flex-1 leading-snug line-clamp-2 group-hover:text-white transition-colors">
          {task.title}
        </span>
      </div>

      <div className="flex items-center justify-between mt-2.5">
        <div className="flex items-center gap-1.5">
          {task.tags?.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded-md bg-purple-500/15 text-purple-300 font-medium"
            >
              {tag}
            </span>
          ))}
          {task.dueAt && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                isOverdueTask(task) ? "bg-red-500/15 text-red-300" : "bg-white/10 text-white/55"
              }`}
            >
              {isOverdueTask(task) ? "Overdue " : "Due "}
              {task.dueAt.toLocaleDateString()}
            </span>
          )}
        </div>
        <AssigneeAvatar assignee={task.assignee} options={assigneeOptions} />
      </div>
    </div>
  );
}

// ============================================================================
// Sortable Task Card (wraps TaskCard with dnd-kit)
// ============================================================================

function SortableTaskCard({
  task,
  assigneeOptions,
  onClick,
}: {
  task: BoardTask;
  assigneeOptions: AssigneeOption[];
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} assigneeOptions={assigneeOptions} onClick={onClick} />
    </div>
  );
}

// ============================================================================
// Kanban Column
// ============================================================================

function KanbanColumn({
  column,
  tasks,
  assigneeOptions,
  onTaskClick,
}: {
  column: (typeof COLUMNS)[number];
  tasks: BoardTask[];
  assigneeOptions: AssigneeOption[];
  onTaskClick: (task: BoardTask) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const displayTasks = column.id === "done" && !collapsed ? tasks.slice(-10) : tasks;
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[260px] flex flex-col min-h-0 rounded-xl transition-colors ${
        isOver ? "bg-white/5 ring-1 ring-[hsl(var(--primary))]/30" : ""
      }`}
    >
      {/* Column header */}
      <div
        className={`flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border-b-2 ${columnBorderColors[column.id]}`}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-white/40 hover:text-white/60"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <span className={`text-sm font-semibold ${columnColors[column.id]}`}>{column.label}</span>
        <span className="text-white/30 text-xs ml-auto">{tasks.length}</span>
      </div>

      {/* Cards */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-white/10 rounded-xl"
          >
            <SortableContext
              items={displayTasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {displayTasks.map((task) => (
                <SortableTaskCard
                  key={task.id}
                  task={task}
                  assigneeOptions={assigneeOptions}
                  onClick={() => onTaskClick(task)}
                />
              ))}
            </SortableContext>

            {tasks.length === 0 && (
              <div className="text-white/20 text-xs text-center py-8">No tasks</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// List View Row
// ============================================================================

function ListViewRow({
  task,
  assigneeOptions,
  onClick,
}: {
  task: BoardTask;
  assigneeOptions: AssigneeOption[];
  onClick: () => void;
}) {
  const statusIcons: Record<TaskStatus, typeof Circle> = {
    pending: Circle,
    "in-progress": Loader,
    in_progress: Loader,
    completed: CheckCircle,
  };
  const statusColors: Record<TaskStatus, string> = {
    pending: "text-gray-400",
    "in-progress": "text-purple-400",
    in_progress: "text-purple-400",
    completed: "text-green-400",
  };

  const Icon = statusIcons[task.status] || Circle;

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer transition-colors group"
    >
      <Icon
        className={`w-4 h-4 flex-shrink-0 ${statusColors[task.status]} ${
          task.status === "in-progress" ? "animate-spin" : ""
        }`}
      />
      <PriorityDot priority={task.priority} />
      <span className="text-white/80 text-sm flex-1 truncate group-hover:text-white transition-colors">
        {task.title}
      </span>
      <div className="flex items-center gap-2">
        {task.tags?.map((tag) => (
          <span
            key={tag}
            className="text-[10px] px-1.5 py-0.5 rounded-md bg-purple-500/15 text-purple-300"
          >
            {tag}
          </span>
        ))}
        <AssigneeAvatar assignee={task.assignee} options={assigneeOptions} />
      </div>
    </div>
  );
}

function TimelineView({
  tasks,
  onTaskClick,
}: {
  tasks: BoardTask[];
  onTaskClick: (task: BoardTask) => void;
}) {
  const datedTasks = tasks.filter((task) => task.dueAt || task.createdAt);
  if (datedTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/30 text-sm">
        <Calendar className="w-8 h-8 mb-2 opacity-50" />
        <span>No dated tasks</span>
      </div>
    );
  }

  const ordered = [...datedTasks].sort((a, b) => {
    const aTime = a.dueAt?.getTime() ?? a.createdAt.getTime();
    const bTime = b.dueAt?.getTime() ?? b.createdAt.getTime();
    return aTime - bTime;
  });

  const minDate = startOfDay(
    new Date(Math.min(...ordered.map((task) => task.createdAt.getTime()))),
  );
  const rawMaxDate = startOfDay(
    new Date(Math.max(...ordered.map((task) => (task.dueAt ?? task.createdAt).getTime()))),
  );
  const maxDate = diffInDays(minDate, rawMaxDate) < 6 ? addDays(minDate, 6) : rawMaxDate;
  const totalDays = Math.max(1, diffInDays(minDate, maxDate) + 1);
  const timelineDays = Array.from({ length: totalDays }, (_, idx) => addDays(minDate, idx));
  const today = startOfDay(new Date());
  const todayOffset = Math.min(Math.max(diffInDays(minDate, today), 0), totalDays - 1);
  const todayVisible = today.getTime() >= minDate.getTime() && today.getTime() <= maxDate.getTime();

  return (
    <div className="h-full overflow-auto">
      <div className="min-w-[920px]">
        <div className="grid grid-cols-[280px_1fr] gap-3 border-b border-white/5 pb-3 mb-3">
          <div className="text-white/40 text-xs uppercase tracking-wider px-2">Task</div>
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${totalDays}, minmax(44px, 1fr))` }}
          >
            {timelineDays.map((day) => (
              <div
                key={day.toISOString()}
                className={`text-[10px] text-center ${
                  day.getTime() === today.getTime()
                    ? "text-cyan-300 font-semibold"
                    : "text-white/40"
                }`}
              >
                {day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {ordered.map((task) => {
            const taskStart = startOfDay(task.createdAt);
            const taskEnd = startOfDay(task.dueAt ?? task.createdAt);
            const offset = Math.max(0, diffInDays(minDate, taskStart));
            const span = Math.max(1, diffInDays(taskStart, taskEnd) + 1);
            const overdue = isOverdueTask(task);
            const barClass =
              task.status === "completed"
                ? "bg-green-500/35 border-green-400/40"
                : overdue
                  ? "bg-red-500/25 border-red-400/40"
                  : task.status === "in-progress" || task.status === "in_progress"
                    ? "bg-purple-500/35 border-purple-400/40"
                    : "bg-cyan-500/20 border-cyan-400/30";

            return (
              <div key={task.id} className="grid grid-cols-[280px_1fr] gap-3 items-center">
                <button
                  onClick={() => onTaskClick(task)}
                  className={`text-left rounded-lg px-3 py-2 transition-colors ${
                    overdue
                      ? "bg-red-500/8 border border-red-500/20 hover:bg-red-500/12"
                      : "bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="text-white/80 text-sm truncate">{task.title}</div>
                  <div
                    className={`text-[11px] mt-1 ${overdue ? "text-red-300/80" : "text-white/35"}`}
                  >
                    {task.dueAt
                      ? `${overdue ? "Overdue" : "Due"} ${task.dueAt.toLocaleDateString()}`
                      : "No due date"}
                  </div>
                </button>
                <div
                  className="relative grid gap-1 h-10"
                  style={{ gridTemplateColumns: `repeat(${totalDays}, minmax(44px, 1fr))` }}
                >
                  {timelineDays.map((day) => (
                    <div
                      key={day.toISOString()}
                      className="h-full rounded-md bg-white/[0.03] border border-white/[0.03]"
                    />
                  ))}
                  {todayVisible && (
                    <div
                      className="absolute top-0 bottom-0 w-[2px] bg-cyan-400/60 rounded-full pointer-events-none"
                      style={{ left: `calc(${((todayOffset + 0.5) / totalDays) * 100}% - 1px)` }}
                    />
                  )}
                  <div
                    className={`absolute top-1 bottom-1 rounded-md border ${barClass}`}
                    style={{
                      left: `calc(${(offset / totalDays) * 100}% + 2px)`,
                      width: `calc(${(span / totalDays) * 100}% - 4px)`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function OverviewView({
  project,
  tasks,
  onTaskClick,
}: {
  project: Project | null;
  tasks: BoardTask[];
  onTaskClick: (task: BoardTask) => void;
}) {
  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/30 text-sm">
        <FileText className="w-8 h-8 mb-2 opacity-50" />
        <span>Select a project to view summary metrics</span>
      </div>
    );
  }

  const now = Date.now();
  const pending = tasks.filter((task) => task.status === "pending").length;
  const active = tasks.filter(
    (task) => task.status === "in-progress" || task.status === "in_progress",
  ).length;
  const done = tasks.filter((task) => task.status === "completed").length;
  const overdue = tasks.filter(
    (task) => task.status !== "completed" && task.dueAt && task.dueAt.getTime() < now,
  ).length;
  const comments = tasks.flatMap((task) =>
    parseTaskComments(task).map((comment) => ({
      ...comment,
      taskId: task.id,
      taskTitle: task.title,
    })),
  );
  const recentComments = comments
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);
  const dueSoon = tasks.filter((task) => {
    if (!task.dueAt || task.status === "completed") return false;
    const delta = startOfDay(task.dueAt).getTime() - startOfDay(new Date()).getTime();
    return delta >= 0 && delta <= 7 * DAY_MS;
  }).length;
  const recentActivity = tasks
    .flatMap((task) =>
      buildTaskTimeline(task).map((entry) => ({
        ...entry,
        taskId: task.id,
        taskTitle: task.title,
      })),
    )
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8);
  const upcoming = tasks
    .filter((task) => task.dueAt && task.status !== "completed")
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))
    .slice(0, 5);
  const progress = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
  const assigneeBreakdown = Array.from(
    tasks.reduce((map, task) => {
      const key = task.assignee || "unassigned";
      const current = map.get(key) || { total: 0, active: 0, done: 0 };
      current.total += 1;
      if (task.status === "completed") current.done += 1;
      if (task.status === "in-progress" || task.status === "in_progress") current.active += 1;
      map.set(key, current);
      return map;
    }, new Map<string, { total: number; active: number; done: number }>()),
  )
    .map(([assignee, counts]) => ({
      assignee,
      ...counts,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  return (
    <div className="h-full overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10">
      <div className="space-y-4">
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-white text-lg font-semibold truncate">{project.title}</div>
              <div className="text-white/45 text-sm mt-1 line-clamp-3">
                {project.details || "No project summary yet."}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-3xl font-semibold text-white">{progress}%</div>
              <div className="text-white/35 text-xs uppercase tracking-wider">Complete</div>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-[hsl(var(--primary))]"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-7 gap-3">
          {[
            { label: "Total Tasks", value: tasks.length, tone: "text-white" },
            { label: "Pending", value: pending, tone: "text-gray-300" },
            { label: "Active", value: active, tone: "text-purple-300" },
            { label: "Done", value: done, tone: "text-green-300" },
            {
              label: "Overdue",
              value: overdue,
              tone: overdue > 0 ? "text-red-300" : "text-white/60",
            },
            {
              label: "Due Soon",
              value: dueSoon,
              tone: dueSoon > 0 ? "text-amber-300" : "text-white/60",
            },
            {
              label: "Comments",
              value: comments.length,
              tone: comments.length > 0 ? "text-cyan-300" : "text-white/60",
            },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
              <div className={`text-2xl font-semibold ${card.tone}`}>{card.value}</div>
              <div className="text-white/35 text-xs uppercase tracking-wider mt-1">
                {card.label}
              </div>
            </div>
          ))}
        </div>

        <div className="grid xl:grid-cols-2 gap-4">
          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
            <div className="text-white/75 text-sm font-medium mb-3">Upcoming / overdue</div>
            <div className="space-y-2">
              {upcoming.length === 0 ? (
                <div className="text-white/25 text-sm">No due dates on active tasks yet.</div>
              ) : (
                upcoming.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => onTaskClick(task)}
                    className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${
                      isOverdueTask(task)
                        ? "bg-red-500/8 border border-red-500/20 hover:bg-red-500/12"
                        : "bg-black/20 border border-white/5 hover:bg-black/30"
                    }`}
                  >
                    <div className="text-white/75 text-sm truncate">{task.title}</div>
                    <div
                      className={`text-[11px] mt-1 ${
                        isOverdueTask(task) ? "text-red-300/80" : "text-white/35"
                      }`}
                    >
                      {isOverdueTask(task) ? "Overdue " : "Due "}
                      {task.dueAt?.toLocaleDateString()}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
            <div className="text-white/75 text-sm font-medium mb-3">Assignee workload</div>
            <div className="space-y-2">
              {assigneeBreakdown.length === 0 ? (
                <div className="text-white/25 text-sm">No assignments yet.</div>
              ) : (
                assigneeBreakdown.map((entry) => (
                  <div
                    key={entry.assignee}
                    className="rounded-lg bg-black/20 border border-white/5 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-white/75 text-sm truncate">
                        {entry.assignee === "unassigned" ? "Unassigned" : entry.assignee}
                      </div>
                      <div className="text-[11px] text-white/35">{entry.total} task(s)</div>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px]">
                      <span className="text-purple-300">Active {entry.active}</span>
                      <span className="text-green-300">Done {entry.done}</span>
                      <span className="text-white/40">
                        Pending {Math.max(0, entry.total - entry.active - entry.done)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
            <div className="text-white/75 text-sm font-medium mb-3">Recent comments</div>
            <div className="space-y-2">
              {recentComments.length === 0 ? (
                <div className="text-white/25 text-sm">No comments recorded yet.</div>
              ) : (
                recentComments.map((comment) => (
                  <button
                    key={comment.id}
                    onClick={() => {
                      const target = tasks.find((task) => task.id === comment.taskId);
                      if (target) onTaskClick(target);
                    }}
                    className="w-full text-left rounded-lg bg-black/20 border border-white/5 px-3 py-2 hover:bg-black/30 transition-colors"
                  >
                    <div className="text-white/75 text-sm truncate">{comment.taskTitle}</div>
                    <div className="text-white/55 text-sm line-clamp-2 mt-1">{comment.body}</div>
                    <div className="text-[11px] text-white/30 mt-1">
                      {comment.author} · {new Date(comment.createdAt).toLocaleString()}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
          <div className="text-white/75 text-sm font-medium mb-3">Recent activity</div>
          <div className="space-y-2">
            {recentActivity.map((entry) => (
              <button
                key={entry.id}
                onClick={() => {
                  const target = tasks.find((task) => task.id === entry.taskId);
                  if (target) onTaskClick(target);
                }}
                className="w-full text-left rounded-lg bg-black/20 border border-white/5 px-3 py-2 hover:bg-black/30 transition-colors"
              >
                <div className="text-white/75 text-sm truncate">{entry.taskTitle}</div>
                <div className="text-white/55 text-sm mt-1">{entry.text}</div>
                <div className="text-[11px] text-white/30 mt-1">
                  {new Date(entry.at).toLocaleString()}
                </div>
              </button>
            ))}
            {recentActivity.length === 0 && (
              <div className="text-white/25 text-sm">No recent activity recorded yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Add Task Inline Form
// ============================================================================

function AddTaskForm({
  onAdd,
  onCancel,
}: {
  onAdd: (title: string, details?: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const handleSubmit = () => {
    if (title.trim()) {
      onAdd(title.trim(), details.trim() || undefined);
      setTitle("");
      setDetails("");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="rounded-xl bg-white/5 border border-purple-500/30 p-3"
    >
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Task title..."
        className="w-full bg-transparent text-white text-sm placeholder-white/30 focus:outline-none"
        autoFocus
      />

      {showDetails && (
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Add details..."
          className="w-full bg-transparent text-white/60 text-xs placeholder-white/20 focus:outline-none mt-2 min-h-[60px] resize-none"
        />
      )}

      <div className="flex items-center justify-between mt-2">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-white/30 hover:text-white/50 text-xs"
        >
          {showDetails ? "Hide details" : "+ Details"}
        </button>
        <div className="flex gap-1.5">
          <button
            onClick={onCancel}
            className="px-2.5 py-1 rounded-md text-white/40 hover:text-white/60 text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="px-2.5 py-1 rounded-md bg-purple-500/30 text-purple-300 hover:bg-purple-500/40 disabled:opacity-30 text-xs font-medium transition-colors"
          >
            Add
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// Task Detail Panel (slide-out from right)
// ============================================================================

function TaskDetailPanel({
  task,
  assigneeOptions,
  onClose,
  onUpdate,
  onDelete,
}: {
  task: BoardTask;
  assigneeOptions: AssigneeOption[];
  onClose: () => void;
  onUpdate: (task: BoardTask) => void;
  onDelete: (id: string) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [editingDetails, setEditingDetails] = useState(false);
  const [details, setDetails] = useState(task.details || "");
  const [dueDate, setDueDate] = useState(dueDateInputValue(task.dueAt));
  const [commentDraft, setCommentDraft] = useState("");
  const comments = useMemo(() => parseTaskComments(task), [task]);
  const activity = useMemo(() => buildTaskTimeline(task), [task]);

  useEffect(() => {
    setTitle(task.title);
    setDetails(task.details || "");
    setDueDate(dueDateInputValue(task.dueAt));
    setCommentDraft("");
    setEditingTitle(false);
    setEditingDetails(false);
  }, [task.id, task.title, task.details, task.dueAt]);

  const statusOptions: { value: TaskStatus; label: string }[] = [
    { value: "pending", label: "Pending" },
    { value: "in-progress", label: "Active" },
    { value: "completed", label: "Done" },
  ];

  const commitTaskUpdate = useCallback(
    (nextTask: BoardTask) => {
      onUpdate(withRecordedTaskChanges(task, nextTask));
    },
    [onUpdate, task],
  );

  const handleTitleSave = () => {
    if (title.trim() && title !== task.title) {
      commitTaskUpdate({ ...task, title: title.trim() });
    }
    setEditingTitle(false);
  };

  const handleDetailsSave = () => {
    if (details !== (task.details || "")) {
      commitTaskUpdate({ ...task, details: details || undefined });
    }
    setEditingDetails(false);
  };

  const handleStatusChange = (newStatus: TaskStatus) => {
    commitTaskUpdate({ ...task, status: newStatus });
  };

  const handleAssigneeChange = (assignee: string | null) => {
    commitTaskUpdate({ ...task, assignee } as any);
  };

  const handleDueDateSave = () => {
    const nextDueDate = parseDueDateInput(dueDate);
    const currentDueTime = task.dueAt?.getTime();
    const nextDueTime = nextDueDate?.getTime();
    if (currentDueTime !== nextDueTime) {
      commitTaskUpdate({ ...task, dueAt: nextDueDate } as any);
    }
  };

  const handleAddComment = () => {
    const body = commentDraft.trim();
    if (!body) return;
    const createdAt = new Date().toISOString();
    const comment: TaskCommentRecord = {
      id: `${createdAt}:${Math.random().toString(36).slice(2, 8)}`,
      body,
      author: "Operator",
      createdAt,
    };
    const metadata = normalizeTaskMetadata(task);
    onUpdate({
      ...task,
      metadata: {
        ...metadata,
        comments: [...parseTaskComments(task), comment],
        activity: [
          ...parseTaskActivity(task),
          makeActivityEntry(`Comment added by ${comment.author}.`, createdAt),
        ],
      },
    } as any);
    setCommentDraft("");
  };

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="absolute top-0 right-0 h-full w-[540px] max-w-[92vw] bg-gray-900/95 backdrop-blur-xl border-l border-white/10 z-50 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <span className="text-white/50 text-xs uppercase tracking-wider">Task Details</span>
        <div className="flex gap-1">
          <button
            onClick={() => onDelete(task.id)}
            className="p-1.5 rounded-md hover:bg-red-500/20 text-red-400/60 hover:text-red-400 transition-colors"
            title="Delete task"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-white/10 text-white/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Title */}
        {editingTitle ? (
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleTitleSave();
              if (e.key === "Escape") {
                setTitle(task.title);
                setEditingTitle(false);
              }
            }}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white font-semibold focus:outline-none focus:border-purple-500/50"
            autoFocus
          />
        ) : (
          <div
            onClick={() => setEditingTitle(true)}
            className="text-white font-semibold text-lg cursor-pointer hover:text-purple-300 transition-colors group flex items-center gap-2"
          >
            {task.title}
            <Pencil className="w-3.5 h-3.5 opacity-0 group-hover:opacity-50" />
          </div>
        )}

        {/* Status */}
        <div>
          <label className="text-white/40 text-xs uppercase tracking-wider block mb-1.5">
            Status
          </label>
          <div className="flex gap-1.5">
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  task.status === opt.value
                    ? opt.value === "pending"
                      ? "bg-gray-500/30 text-gray-300 border border-gray-500/50"
                      : opt.value === "in-progress"
                        ? "bg-purple-500/30 text-purple-300 border border-purple-500/50"
                        : "bg-green-500/30 text-green-300 border border-green-500/50"
                    : "bg-white/5 text-white/40 border border-white/5 hover:bg-white/10"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Assignee */}
        <div>
          <label className="text-white/40 text-xs uppercase tracking-wider block mb-1.5">
            <User className="w-3 h-3 inline mr-1" />
            Assignee
          </label>
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => handleAssigneeChange(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                !task.assignee
                  ? "bg-white/15 text-white/80 border border-white/20"
                  : "bg-white/5 text-white/40 border border-white/5 hover:bg-white/10"
              }`}
            >
              <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[8px] text-white/40">
                ?
              </div>
              None
            </button>
            {assigneeOptions.map((a) => (
              <button
                key={a.id}
                onClick={() => handleAssigneeChange(a.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                  task.assignee === a.id
                    ? "bg-white/15 text-white/80 border border-white/20"
                    : "bg-white/5 text-white/40 border border-white/5 hover:bg-white/10"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full ${a.color} flex items-center justify-center text-[8px] text-white font-bold`}
                >
                  {a.letter}
                </div>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Priority */}
        <div>
          <label className="text-white/40 text-xs uppercase tracking-wider block mb-1.5">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            Priority
          </label>
          <div className="flex gap-1.5">
            {PRIORITIES.map((p) => (
              <button
                key={p.id}
                onClick={() => commitTaskUpdate({ ...task, priority: p.id } as any)}
                className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  (task as BoardTask).priority === p.id
                    ? "bg-white/15 text-white/80 border border-white/20"
                    : "bg-white/5 text-white/40 border border-white/5 hover:bg-white/10"
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${p.color}`} />
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Due date */}
        <div>
          <label className="text-white/40 text-xs uppercase tracking-wider block mb-1.5">
            <Calendar className="w-3 h-3 inline mr-1" />
            Due Date
          </label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              onBlur={handleDueDateSave}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white/80 text-sm focus:outline-none focus:border-purple-500/50"
            />
            {dueDate && (
              <button
                onClick={() => {
                  setDueDate("");
                  commitTaskUpdate({ ...task, dueAt: undefined } as any);
                }}
                className="px-2 py-2 rounded-lg bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10 text-xs transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-white/40 text-xs uppercase tracking-wider block mb-1.5">
            Description
          </label>
          {editingDetails ? (
            <div>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                onBlur={handleDetailsSave}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white/70 text-sm focus:outline-none focus:border-purple-500/50 min-h-[120px] resize-y font-mono"
                placeholder="Markdown supported..."
                autoFocus
              />
              <div className="flex justify-end gap-1.5 mt-1">
                <button
                  onClick={() => {
                    setDetails(task.details || "");
                    setEditingDetails(false);
                  }}
                  className="px-2 py-1 text-xs text-white/40 hover:text-white/60"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDetailsSave}
                  className="px-2 py-1 text-xs text-purple-300 hover:text-purple-200"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => setEditingDetails(true)}
              className="rounded-lg bg-white/5 p-3 min-h-[80px] cursor-pointer hover:bg-white/8 transition-colors group"
            >
              {task.details ? (
                <div
                  className="prose prose-invert prose-sm max-w-none
                  prose-pre:bg-black/30 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-lg
                  prose-code:text-purple-300 prose-code:bg-purple-500/10 prose-code:px-1 prose-code:rounded
                  prose-headings:text-white/80 prose-p:text-white/60 prose-li:text-white/60
                  prose-strong:text-white/80 prose-a:text-purple-400"
                >
                  <ReactMarkdown>{task.details}</ReactMarkdown>
                </div>
              ) : (
                <span className="text-white/20 text-sm flex items-center gap-1">
                  <Pencil className="w-3 h-3" /> Add description...
                </span>
              )}
            </div>
          )}
        </div>

        {/* Timestamps */}
        <div className="space-y-1 pt-2 border-t border-white/5">
          <div className="flex items-center gap-2 text-white/30 text-xs">
            <Clock className="w-3 h-3" />
            Created: {task.createdAt.toLocaleDateString()}
          </div>
          {task.startedAt && (
            <div className="flex items-center gap-2 text-purple-300/70 text-xs">
              <Loader className="w-3 h-3" />
              Started: {task.startedAt.toLocaleDateString()}
            </div>
          )}
          {task.dueAt && (
            <div className="flex items-center gap-2 text-amber-300/70 text-xs">
              <Calendar className="w-3 h-3" />
              Due: {task.dueAt.toLocaleDateString()}
            </div>
          )}
          {task.completedAt && (
            <div className="flex items-center gap-2 text-green-400/50 text-xs">
              <CheckCircle className="w-3 h-3" />
              Completed: {task.completedAt.toLocaleDateString()}
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-white/5 space-y-3">
          <div>
            <label className="text-white/40 text-xs uppercase tracking-wider block mb-1.5">
              Comments
            </label>
            <div className="rounded-lg bg-white/5 border border-white/5 p-3 space-y-3">
              <textarea
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder="Add context, blockers, receipts, or notes..."
                className="w-full bg-transparent text-white/70 text-sm placeholder-white/20 focus:outline-none min-h-[84px] resize-y"
              />
              <div className="flex justify-end">
                <button
                  onClick={handleAddComment}
                  disabled={!commentDraft.trim()}
                  className="px-3 py-1.5 rounded-lg bg-purple-500/25 text-purple-200 hover:bg-purple-500/35 disabled:opacity-30 text-xs font-medium transition-colors"
                >
                  Add comment
                </button>
              </div>
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {comments.length === 0 ? (
                  <div className="text-white/25 text-xs">No comments yet.</div>
                ) : (
                  comments.map((comment) => (
                    <div
                      key={comment.id}
                      className="rounded-lg bg-black/20 border border-white/5 p-3"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-white/35 mb-1.5">
                        <span>{comment.author}</span>
                        <span>{new Date(comment.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="text-sm text-white/70 whitespace-pre-wrap">
                        {comment.body}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="text-white/40 text-xs uppercase tracking-wider block mb-1.5">
              Activity
            </label>
            <div className="rounded-lg bg-white/5 border border-white/5 p-3 space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {activity.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 text-sm">
                  <Clock className="w-3.5 h-3.5 text-white/25 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-white/70">{entry.text}</div>
                    <div className="text-[11px] text-white/30 mt-0.5">
                      {new Date(entry.at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// Filter Bar
// ============================================================================

function FilterBar({
  assigneeOptions,
  assigneeFilter,
  onAssigneeChange,
  priorityFilter,
  onPriorityChange,
  projectStateFilter,
  onProjectStateChange,
  projectFilter,
  onProjectChange,
  projects,
}: {
  assigneeOptions: AssigneeOption[];
  assigneeFilter: string;
  onAssigneeChange: (v: string) => void;
  priorityFilter: string;
  onPriorityChange: (v: string) => void;
  projectStateFilter: string;
  onProjectStateChange: (v: string) => void;
  projectFilter: string;
  onProjectChange: (v: string) => void;
  projects: Project[];
}) {
  const visibleProjects = projects.filter((project) => {
    if (projectStateFilter === "archived") return isArchivedProject(project);
    if (projectStateFilter === "done")
      return (
        !isArchivedProject(project) &&
        project.taskCount > 0 &&
        project.completedCount === project.taskCount
      );
    if (projectStateFilter === "active")
      return (
        !isArchivedProject(project) &&
        (project.taskCount === 0 || project.completedCount < project.taskCount)
      );
    return true;
  });

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Filter className="w-3.5 h-3.5 text-white/30" />

      {/* Assignee */}
      <select
        value={assigneeFilter}
        onChange={(e) => onAssigneeChange(e.target.value)}
        className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-white/70 text-xs focus:outline-none focus:border-purple-500/50 cursor-pointer"
      >
        <option value="all">All Assignees</option>
        <option value="unassigned">Unassigned</option>
        {assigneeOptions.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>

      {/* Priority */}
      <select
        value={priorityFilter}
        onChange={(e) => onPriorityChange(e.target.value)}
        className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-white/70 text-xs focus:outline-none focus:border-purple-500/50 cursor-pointer"
      >
        <option value="all">All Priorities</option>
        {PRIORITIES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      <select
        value={projectStateFilter}
        onChange={(e) => onProjectStateChange(e.target.value)}
        className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-white/70 text-xs focus:outline-none focus:border-purple-500/50 cursor-pointer"
      >
        <option value="all">All Projects</option>
        <option value="active">Active Projects</option>
        <option value="done">Done Projects</option>
        <option value="archived">Archived Projects</option>
      </select>

      {/* Project */}
      {visibleProjects.length > 0 && (
        <select
          value={projectFilter}
          onChange={(e) => onProjectChange(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-white/70 text-xs focus:outline-none focus:border-purple-500/50 cursor-pointer"
        >
          <option value="all">All Projects</option>
          {visibleProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {isArchivedProject(p) ? `${p.title} (Archived)` : p.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ============================================================================
// Main ProjectBoard Component
// ============================================================================

export function ProjectBoard({
  tasks,
  projects,
  onTaskUpdate,
  onTaskDelete,
  onTaskAdd,
  onTaskStart,
  onTaskComplete,
  onProjectArchive,
  onClose,
  selectedProjectId,
  initialFilter,
}: ProjectBoardProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [selectedTask, setSelectedTask] = useState<BoardTask | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [dragActiveTask, setDragActiveTask] = useState<BoardTask | null>(null);
  const [selectedProjectTasks, setSelectedProjectTasks] = useState<BoardTask[] | null>(null);
  const [projectStateFilter, setProjectStateFilter] = useState("all");
  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>(STATIC_ASSIGNEES);

  // Filters
  const [assigneeFilter, setAssigneeFilter] = useState(initialFilter?.assignee || "all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState(initialFilter?.project || "all");

  useEffect(() => {
    if (selectedProjectId) {
      setProjectFilter(selectedProjectId);
      return;
    }
    if (initialFilter?.project) {
      setProjectFilter(initialFilter.project);
    }
  }, [selectedProjectId, initialFilter?.project]);

  const activeProjectId = projectFilter !== "all" ? projectFilter : null;
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  useEffect(() => {
    if (!selectedProject) return;
    setProjectStateFilter(isArchivedProject(selectedProject) ? "archived" : "all");
  }, [selectedProject]);

  useEffect(() => {
    let cancelled = false;
    const loadAssignees = async () => {
      try {
        const response = await fetchLocalApi("/api/workflow-map/agents");
        if (!response.ok) return;
        const data = await response.json();
        const defaultId =
          typeof data.defaultId === "string" && data.defaultId.trim()
            ? data.defaultId.trim()
            : "argent";
        const familyAgents = Array.isArray(data.agents)
          ? data.agents
              .filter((agent: any) => String(agent.id || "").trim() !== defaultId)
              .map((agent: any) => ({
                id: String(agent.id),
                label: String(agent.name || agent.id),
                color: "bg-purple-500",
                letter:
                  String(agent.name || agent.id)
                    .trim()
                    .charAt(0)
                    .toUpperCase() || "?",
              }))
          : [];
        if (cancelled) return;
        const merged: AssigneeOption[] = [
          { id: "jason", label: "Operator", color: "bg-blue-500", letter: "O" },
          {
            id: defaultId,
            label: defaultId === "argent" ? "Main Agent" : `Main Agent (${defaultId})`,
            color: "bg-purple-500",
            letter: "A",
          },
        ];
        for (const entry of familyAgents) {
          if (!merged.some((candidate) => candidate.id === entry.id)) {
            merged.push(entry);
          }
        }
        setAssigneeOptions(merged);
      } catch (error) {
        if (!cancelled) {
          console.error("[ProjectBoard] Failed to load assignee options:", error);
        }
      }
    };

    void loadAssignees();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeProjectId) {
      setSelectedProjectTasks(null);
      return;
    }

    let cancelled = false;
    const loadProjectTasks = async () => {
      try {
        const response = await fetchLocalApi(`/api/projects/${activeProjectId}`);
        if (!response.ok) {
          throw new Error(`Project fetch failed: ${response.status}`);
        }
        const data = await response.json();
        if (cancelled) return;
        const nextTasks = Array.isArray(data.tasks)
          ? data.tasks.map((task: any) => ({
              ...task,
              createdAt: new Date(task.createdAt),
              completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
              startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
              dueAt: task.dueAt ? new Date(task.dueAt) : undefined,
            }))
          : [];
        setSelectedProjectTasks(nextTasks as BoardTask[]);
      } catch (error) {
        if (cancelled) return;
        console.error("[ProjectBoard] Failed to load selected project tasks:", error);
        setSelectedProjectTasks([]);
      }
    };

    void loadProjectTasks();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, tasks]);

  // Cast tasks to BoardTask (backend may or may not have assignee/priority yet)
  const boardTasks: BoardTask[] = useMemo(() => {
    if (activeProjectId && selectedProjectTasks) {
      return selectedProjectTasks;
    }
    return tasks.map((t) => ({ ...t }) as BoardTask);
  }, [activeProjectId, selectedProjectTasks, tasks]);

  // Apply filters
  const filteredTasks = useMemo(() => {
    return boardTasks.filter((t) => {
      // When a project is selected, show that project's child tasks on the board.
      if (activeProjectId) {
        if (t.type === "project") return false;
        if (t.parentTaskId !== activeProjectId) return false;
      } else {
        // Default board view excludes project parents and child tasks.
        if (t.parentTaskId || t.type === "project") return false;
      }

      if (assigneeFilter !== "all") {
        if (assigneeFilter === "unassigned") {
          if (t.assignee) return false;
        } else if (t.assignee !== assigneeFilter) {
          return false;
        }
      }
      if (priorityFilter !== "all" && t.priority !== priorityFilter) {
        return false;
      }
      return true;
    });
  }, [boardTasks, assigneeFilter, priorityFilter, activeProjectId]);

  // Group tasks by column
  const columnTasks = useMemo(() => {
    const result: Record<ColumnId, BoardTask[]> = {
      pending: [],
      active: [],
      done: [],
    };

    for (const task of filteredTasks) {
      if (task.status === "completed") {
        result.done.push(task);
      } else if (task.status === "in-progress" || task.status === "in_progress") {
        result.active.push(task);
      } else {
        result.pending.push(task);
      }
    }

    return result;
  }, [filteredTasks]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = filteredTasks.find((t) => t.id === event.active.id);
      if (task) setDragActiveTask(task);
    },
    [filteredTasks],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragActiveTask(null);
      const { active, over } = event;
      if (!over) return;

      const taskId = active.id as string;
      const task = filteredTasks.find((t) => t.id === taskId);
      if (!task) return;

      // Determine which column the task was dropped into
      // over.id could be another task's id or a column droppable
      let targetColumn: ColumnId | null = null;

      if (over.id === "pending" || over.id === "active" || over.id === "done") {
        targetColumn = over.id;
      }

      // Check if dropped on another task - find that task's column
      const overTask = targetColumn ? null : filteredTasks.find((t) => t.id === over.id);
      if (overTask && !targetColumn) {
        if (overTask.status === "completed") targetColumn = "done";
        else if (overTask.status === "in-progress" || overTask.status === "in_progress")
          targetColumn = "active";
        else targetColumn = "pending";
      }

      if (!targetColumn) return;

      // Determine current column
      let currentColumn: ColumnId;
      if (task.status === "completed") currentColumn = "done";
      else if (task.status === "in-progress" || task.status === "in_progress")
        currentColumn = "active";
      else currentColumn = "pending";

      if (currentColumn === targetColumn) return;

      // Move task between columns
      if (targetColumn === "active") {
        onTaskStart(task.id);
      } else if (targetColumn === "done") {
        onTaskComplete(task.id);
      } else if (targetColumn === "pending") {
        onTaskUpdate({ ...task, status: "pending" });
      }
    },
    [filteredTasks, onTaskStart, onTaskComplete, onTaskUpdate],
  );

  const handleAddTask = (title: string, details?: string) => {
    onTaskAdd(title, "one-time", undefined, details);
    setShowAddForm(false);
  };

  const handleTaskClick = (task: BoardTask) => {
    setSelectedTask(task);
  };

  const handleTaskUpdate = (task: Task | BoardTask) => {
    onTaskUpdate(task);
    // Update selected task if it's the one being edited
    if (selectedTask?.id === task.id) {
      setSelectedTask({ ...task } as BoardTask);
    }
  };

  const handleTaskDelete = (id: string) => {
    onTaskDelete(id);
    if (selectedTask?.id === id) {
      setSelectedTask(null);
    }
  };

  return (
    <div className="glass-panel rounded-2xl h-full flex flex-col overflow-hidden relative">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
            title="Back to tasks"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-white font-semibold text-base">Project Board</h2>
          <span className="text-white/30 text-xs">{filteredTasks.length} tasks</span>
        </div>

        <div className="flex items-center gap-2">
          {selectedProject && onProjectArchive && (
            <button
              onClick={() =>
                void onProjectArchive(selectedProject.id, !isArchivedProject(selectedProject))
              }
              className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:text-white/80 hover:bg-white/10 transition-colors"
              title={isArchivedProject(selectedProject) ? "Unarchive project" : "Archive project"}
            >
              {isArchivedProject(selectedProject) ? (
                <ArchiveRestore className="w-4 h-4" />
              ) : (
                <Archive className="w-4 h-4" />
              )}
            </button>
          )}
          {/* Add Task */}
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-1.5 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
            title="Add task"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* View toggle */}
          <div className="flex bg-white/5 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("overview")}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === "overview"
                  ? "bg-purple-500/30 text-purple-300"
                  : "text-white/40 hover:text-white/60"
              }`}
              title="Summary view"
            >
              <FileText className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("board")}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === "board"
                  ? "bg-purple-500/30 text-purple-300"
                  : "text-white/40 hover:text-white/60"
              }`}
              title="Board view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === "list"
                  ? "bg-purple-500/30 text-purple-300"
                  : "text-white/40 hover:text-white/60"
              }`}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("timeline")}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === "timeline"
                  ? "bg-purple-500/30 text-purple-300"
                  : "text-white/40 hover:text-white/60"
              }`}
              title="Timeline view"
            >
              <Calendar className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-4 py-2 border-b border-white/5 flex-shrink-0">
        <FilterBar
          assigneeOptions={assigneeOptions}
          assigneeFilter={assigneeFilter}
          onAssigneeChange={setAssigneeFilter}
          priorityFilter={priorityFilter}
          onPriorityChange={setPriorityFilter}
          projectStateFilter={projectStateFilter}
          onProjectStateChange={setProjectStateFilter}
          projectFilter={projectFilter}
          onProjectChange={setProjectFilter}
          projects={projects}
        />
      </div>

      {/* Add Task Form */}
      <AnimatePresence>
        {showAddForm && (
          <div className="px-4 pt-3 flex-shrink-0">
            <AddTaskForm onAdd={handleAddTask} onCancel={() => setShowAddForm(false)} />
          </div>
        )}
      </AnimatePresence>

      {/* Board / List content */}
      <div className="flex-1 overflow-hidden p-4">
        {viewMode === "overview" ? (
          <OverviewView
            project={selectedProject}
            tasks={filteredTasks}
            onTaskClick={handleTaskClick}
          />
        ) : viewMode === "board" ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-3 h-full">
              {COLUMNS.map((col) => (
                <KanbanColumn
                  key={col.id}
                  column={col}
                  tasks={columnTasks[col.id]}
                  assigneeOptions={assigneeOptions}
                  onTaskClick={handleTaskClick}
                />
              ))}
            </div>

            {typeof document !== "undefined"
              ? createPortal(
                  <DragOverlay>
                    {dragActiveTask && (
                      <div className="w-[260px]">
                        <TaskCard
                          task={dragActiveTask}
                          assigneeOptions={assigneeOptions}
                          onClick={() => {}}
                          isDragOverlay
                        />
                      </div>
                    )}
                  </DragOverlay>,
                  document.body,
                )
              : null}
          </DndContext>
        ) : viewMode === "timeline" ? (
          <TimelineView tasks={filteredTasks} onTaskClick={handleTaskClick} />
        ) : (
          <div className="space-y-1.5 overflow-y-auto h-full pr-1 scrollbar-thin scrollbar-thumb-white/10">
            {filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-white/30 text-sm">
                <Tag className="w-8 h-8 mb-2 opacity-50" />
                <span>No matching tasks</span>
              </div>
            ) : (
              filteredTasks.map((task) => (
                <ListViewRow
                  key={task.id}
                  task={task}
                  assigneeOptions={assigneeOptions}
                  onClick={() => handleTaskClick(task)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Task Detail Panel (slide-out) */}
      <AnimatePresence>
        {selectedTask && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/30 z-40"
              onClick={() => setSelectedTask(null)}
            />
            <TaskDetailPanel
              task={selectedTask}
              assigneeOptions={assigneeOptions}
              onClose={() => setSelectedTask(null)}
              onUpdate={handleTaskUpdate}
              onDelete={handleTaskDelete}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
