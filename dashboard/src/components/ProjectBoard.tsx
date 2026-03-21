import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion, AnimatePresence } from "framer-motion";
import {
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
  ArrowLeft,
  Trash2,
  Pencil,
  User,
  Tag,
} from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import type { Task, Project, TaskStatus, TaskType } from "./TaskList";

// Extended task with optional assignee/priority (backend adds these)
interface BoardTask extends Omit<Task, "assignee"> {
  assignee?: string | null;
  priority?: string | null;
  tags?: string[];
}

type ViewMode = "board" | "list";
type ColumnId = "pending" | "active" | "done";

interface ProjectBoardProps {
  tasks: Task[];
  projects: Project[];
  onTaskUpdate: (task: Task | BoardTask) => void;
  onTaskDelete: (id: string) => void;
  onTaskAdd: (title: string, type: TaskType, schedule?: Task["schedule"], details?: string) => void;
  onTaskStart: (id: string) => void;
  onTaskComplete: (id: string) => void;
  onClose: () => void;
  initialFilter?: {
    project?: string;
    assignee?: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

const ASSIGNEES = [
  { id: "jason", label: "Jason", color: "bg-blue-500", letter: "J" },
  { id: "argent", label: "Argent", color: "bg-purple-500", letter: "A" },
  { id: "claude-code", label: "Claude", color: "bg-orange-500", letter: "C" },
];

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

// ============================================================================
// Assignee Avatar
// ============================================================================

function AssigneeAvatar({
  assignee,
  size = "sm",
}: {
  assignee?: string | null;
  size?: "sm" | "md";
}) {
  const match = ASSIGNEES.find((a) => a.id === assignee);
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

// ============================================================================
// Task Card (used in board view)
// ============================================================================

function TaskCard({
  task,
  onClick,
  isDragOverlay,
}: {
  task: BoardTask;
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
        </div>
        <AssigneeAvatar assignee={task.assignee} />
      </div>
    </div>
  );
}

// ============================================================================
// Sortable Task Card (wraps TaskCard with dnd-kit)
// ============================================================================

function SortableTaskCard({ task, onClick }: { task: BoardTask; onClick: () => void }) {
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
      <TaskCard task={task} onClick={onClick} />
    </div>
  );
}

// ============================================================================
// Kanban Column
// ============================================================================

function KanbanColumn({
  column,
  tasks,
  onTaskClick,
}: {
  column: (typeof COLUMNS)[number];
  tasks: BoardTask[];
  onTaskClick: (task: BoardTask) => void;
}) {
  const [collapsed, setCollapsed] = useState(column.id === "done");
  const displayTasks = column.id === "done" && !collapsed ? tasks.slice(-10) : tasks;

  return (
    <div className="flex-1 min-w-[260px] flex flex-col min-h-0">
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
            className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-white/10"
          >
            <SortableContext
              items={displayTasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {displayTasks.map((task) => (
                <SortableTaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />
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

function ListViewRow({ task, onClick }: { task: BoardTask; onClick: () => void }) {
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
        <AssigneeAvatar assignee={task.assignee} />
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
  onClose,
  onUpdate,
  onDelete,
}: {
  task: BoardTask;
  onClose: () => void;
  onUpdate: (task: BoardTask) => void;
  onDelete: (id: string) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [editingDetails, setEditingDetails] = useState(false);
  const [details, setDetails] = useState(task.details || "");

  const statusOptions: { value: TaskStatus; label: string }[] = [
    { value: "pending", label: "Pending" },
    { value: "in-progress", label: "Active" },
    { value: "completed", label: "Done" },
  ];

  const handleTitleSave = () => {
    if (title.trim() && title !== task.title) {
      onUpdate({ ...task, title: title.trim() });
    }
    setEditingTitle(false);
  };

  const handleDetailsSave = () => {
    if (details !== (task.details || "")) {
      onUpdate({ ...task, details: details || undefined });
    }
    setEditingDetails(false);
  };

  const handleStatusChange = (newStatus: TaskStatus) => {
    onUpdate({ ...task, status: newStatus });
  };

  const handleAssigneeChange = (assignee: string | null) => {
    onUpdate({ ...task, assignee } as any);
  };

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="absolute top-0 right-0 h-full w-[380px] bg-gray-900/95 backdrop-blur-xl border-l border-white/10 z-50 flex flex-col overflow-hidden"
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
            {ASSIGNEES.map((a) => (
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
                onClick={() => onUpdate({ ...task, priority: p.id } as any)}
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
          {task.completedAt && (
            <div className="flex items-center gap-2 text-green-400/50 text-xs">
              <CheckCircle className="w-3 h-3" />
              Completed: {task.completedAt.toLocaleDateString()}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// Filter Bar
// ============================================================================

function FilterBar({
  assigneeFilter,
  onAssigneeChange,
  priorityFilter,
  onPriorityChange,
  projectFilter,
  onProjectChange,
  projects,
}: {
  assigneeFilter: string;
  onAssigneeChange: (v: string) => void;
  priorityFilter: string;
  onPriorityChange: (v: string) => void;
  projectFilter: string;
  onProjectChange: (v: string) => void;
  projects: Project[];
}) {
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
        {ASSIGNEES.map((a) => (
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

      {/* Project */}
      {projects.length > 0 && (
        <select
          value={projectFilter}
          onChange={(e) => onProjectChange(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-white/70 text-xs focus:outline-none focus:border-purple-500/50 cursor-pointer"
        >
          <option value="all">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
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
  onClose,
  initialFilter,
}: ProjectBoardProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [selectedTask, setSelectedTask] = useState<BoardTask | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [dragActiveTask, setDragActiveTask] = useState<BoardTask | null>(null);

  // Filters
  const [assigneeFilter, setAssigneeFilter] = useState(initialFilter?.assignee || "all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState(initialFilter?.project || "all");

  // Cast tasks to BoardTask (backend may or may not have assignee/priority yet)
  const boardTasks: BoardTask[] = useMemo(() => tasks.map((t) => ({ ...t }) as BoardTask), [tasks]);

  // Apply filters
  const filteredTasks = useMemo(() => {
    return boardTasks.filter((t) => {
      // Skip child tasks and project parent tasks (same as TaskList)
      if (t.parentTaskId || t.type === "project") return false;

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
  }, [boardTasks, assigneeFilter, priorityFilter, projectFilter]);

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
      } else if (task.status === "in-progress") {
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

      // Check if dropped on another task - find that task's column
      const overTask = filteredTasks.find((t) => t.id === over.id);
      if (overTask) {
        if (overTask.status === "completed") targetColumn = "done";
        else if (overTask.status === "in-progress") targetColumn = "active";
        else targetColumn = "pending";
      }

      if (!targetColumn) return;

      // Determine current column
      let currentColumn: ColumnId;
      if (task.status === "completed") currentColumn = "done";
      else if (task.status === "in-progress") currentColumn = "active";
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
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-4 py-2 border-b border-white/5 flex-shrink-0">
        <FilterBar
          assigneeFilter={assigneeFilter}
          onAssigneeChange={setAssigneeFilter}
          priorityFilter={priorityFilter}
          onPriorityChange={setPriorityFilter}
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
        {viewMode === "board" ? (
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
                  onTaskClick={handleTaskClick}
                />
              ))}
            </div>

            <DragOverlay>
              {dragActiveTask && (
                <div className="w-[260px]">
                  <TaskCard task={dragActiveTask} onClick={() => {}} isDragOverlay />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        ) : (
          <div className="space-y-1.5 overflow-y-auto h-full pr-1 scrollbar-thin scrollbar-thumb-white/10">
            {filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-white/30 text-sm">
                <Tag className="w-8 h-8 mb-2 opacity-50" />
                <span>No matching tasks</span>
              </div>
            ) : (
              filteredTasks.map((task) => (
                <ListViewRow key={task.id} task={task} onClick={() => handleTaskClick(task)} />
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
