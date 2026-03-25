import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle,
  Circle,
  Loader,
  Clock,
  Calendar,
  Plus,
  Pencil,
  Trash2,
  X,
  Play,
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderKanban,
  LayoutGrid,
  Ban,
  XCircle,
  Sparkles,
  Users,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { type CronJob, type CronJobUpdatePatch } from "../hooks/useCronJobs";

export type TaskStatus = "pending" | "in-progress" | "in_progress" | "completed";
export type TaskType = "one-time" | "scheduled" | "interval" | "project";

export interface Task {
  id: string;
  title: string;
  details?: string; // Markdown-supported details/description
  status: TaskStatus;
  type: TaskType;
  createdAt: Date;
  completedAt?: Date;
  parentTaskId?: string;
  // Ownership / origin fields (from backend)
  source?: string; // "user" | "agent" | "heartbeat" | "schedule"
  assignee?: string; // session key or label
  agentId?: string;
  teamId?: string;
  // For scheduled tasks
  schedule?: {
    frequency: "daily" | "weekly" | "monthly" | "custom" | "interval";
    time?: string; // HH:MM format
    days?: number[]; // 0-6 for weekly, 1-31 for monthly
    cron?: string; // custom cron expression
    intervalMinutes?: number; // For interval-based scheduling (5, 10, 20, 30, 60)
    lastRun?: Date;
    nextRun?: Date;
  };
}

export interface Project {
  id: string;
  title: string;
  details?: string;
  status: TaskStatus;
  type: string;
  priority: string;
  createdAt: string;
  taskCount: number;
  completedCount: number;
  tags?: string[];
}

interface TaskListProps {
  tasks: Task[];
  workerTasks?: Task[];
  projects?: Project[];
  cronJobs?: CronJob[];
  cronFormatSchedule?: (job: CronJob) => string;
  cronGetNextRun?: (job: CronJob) => string | null;
  onCronJobUpdate?: (
    jobId: string,
    patch: CronJobUpdatePatch,
  ) => Promise<CronJob | boolean | null | void> | CronJob | boolean | null | void;
  onCronJobDelete?: (
    jobId: string,
  ) => Promise<boolean | { removed: boolean } | void> | boolean | { removed: boolean } | void;
  onCronJobRun?: (
    jobId: string,
  ) =>
    | Promise<boolean | { ok: boolean; ran: boolean; reason?: "not-due" } | void>
    | boolean
    | { ok: boolean; ran: boolean; reason?: "not-due" }
    | void;
  onTaskClick?: (task: Task) => void;
  onTaskEdit?: (task: Task) => Promise<Task | boolean | null | void> | Task | boolean | null | void;
  onTaskDelete?: (taskId: string) => Promise<boolean | void> | boolean | void;
  onTaskAdd?: (
    title: string,
    type: TaskType,
    schedule?: Task["schedule"],
    details?: string,
    assignee?: string,
  ) => Promise<Task | boolean | null | void> | Task | boolean | null | void;
  onTaskExecute?: (task: Task) => Promise<boolean | void> | boolean | void;
  onProjectDelete?: (projectId: string) => Promise<boolean | void> | boolean | void;
  onProjectTaskAdd?: (
    projectId: string,
    title: string,
    details?: string,
  ) => Promise<Task | boolean | null | void> | Task | boolean | null | void;
  onProjectKickoff?: () => void;
  onOpenBoard?: () => void;
  showBoard?: boolean;
  showWorkerLane?: boolean;
}

const statusIcons: Record<string, typeof Circle> = {
  pending: Circle,
  "in-progress": Loader,
  in_progress: Loader,
  completed: CheckCircle,
  blocked: Ban,
  failed: XCircle,
  cancelled: XCircle,
};

const statusColors: Record<string, string> = {
  pending: "text-gray-400",
  "in-progress": "text-purple-400",
  in_progress: "text-purple-400",
  completed: "text-green-400",
  blocked: "text-yellow-400",
  failed: "text-red-400",
  cancelled: "text-gray-500",
};

type TaskOwner = "operator" | "agent" | "team" | "system";

const ownerBadge: Record<TaskOwner, { label: string; className: string }> = {
  operator: { label: "Operator", className: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  agent: { label: "Agent", className: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  team: { label: "Team", className: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  system: { label: "System", className: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
};

function getTaskOwner(task: Task): TaskOwner {
  if (task.teamId) return "team";
  if (task.assignee?.includes(":subagent:")) return "team";
  if (task.source === "user") return "operator";
  if (task.source === "heartbeat" || task.source === "schedule") return "system";
  return "agent";
}

type TabType = "tasks" | "workers" | "schedule" | "projects";

function resolveCronExecutionMode(job: CronJob): "live" | "paper_trade" {
  return job.executionMode === "paper_trade" ? "paper_trade" : "live";
}

function cronAtToLocalInputValue(at?: string): string {
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function cronLocalInputValueToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function cronEveryMsToMinutes(everyMs?: number): string {
  if (typeof everyMs !== "number" || !Number.isFinite(everyMs) || everyMs <= 0) {
    return "10";
  }
  const minutes = Math.max(1, Math.round(everyMs / 60_000));
  return String(minutes);
}

function getCronPayloadPreview(job: CronJob): string {
  const body =
    typeof job.payload.message === "string" && job.payload.message.trim()
      ? job.payload.message.trim()
      : typeof job.payload.text === "string" && job.payload.text.trim()
        ? job.payload.text.trim()
        : typeof job.payload.title === "string" && job.payload.title.trim()
          ? job.payload.title.trim()
          : "";
  if (body) {
    return body;
  }
  return "No explicit payload text is stored for this job. Use the raw payload below to inspect the live scheduler input.";
}

function getCronPayloadSummary(job: CronJob): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Payload", value: job.payload.kind || "unknown" },
    {
      label: "Next run",
      value: job.state?.nextRunAtMs
        ? new Date(job.state.nextRunAtMs).toLocaleString()
        : "Not scheduled",
    },
  ];
  if (job.agentId) {
    rows.push({ label: "Agent", value: job.agentId });
  }
  if (job.sessionTarget) {
    rows.push({ label: "Session", value: job.sessionTarget });
  }
  if (job.wakeMode) {
    rows.push({ label: "Wake mode", value: job.wakeMode });
  }
  if (job.delivery?.channel) {
    rows.push({ label: "Delivery", value: job.delivery.channel });
  } else if (job.delivery?.mode) {
    rows.push({ label: "Delivery", value: job.delivery.mode });
  }
  return rows;
}

export function TaskList({
  tasks,
  workerTasks = [],
  projects = [],
  cronJobs = [],
  cronFormatSchedule,
  cronGetNextRun,
  onCronJobUpdate,
  onCronJobDelete,
  onCronJobRun,
  onTaskClick,
  onTaskEdit,
  onTaskDelete,
  onTaskAdd,
  onTaskExecute,
  onProjectDelete,
  onProjectTaskAdd,
  onProjectKickoff,
  onOpenBoard,
  showBoard,
  showWorkerLane = false,
}: TaskListProps) {
  const [activeTab, setActiveTab] = useState<TabType>("tasks");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingCronJob, setEditingCronJob] = useState<CronJob | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingCronTitle, setEditingCronTitle] = useState("");
  const [editingCronEnabled, setEditingCronEnabled] = useState(true);
  const [editingCronExecutionMode, setEditingCronExecutionMode] = useState<"live" | "paper_trade">(
    "live",
  );
  const [editingCronScheduleKind, setEditingCronScheduleKind] = useState<"cron" | "every" | "at">(
    "cron",
  );
  const [editingCronExpr, setEditingCronExpr] = useState("");
  const [editingCronTimezone, setEditingCronTimezone] = useState("America/Chicago");
  const [editingCronAt, setEditingCronAt] = useState("");
  const [editingCronEveryMinutes, setEditingCronEveryMinutes] = useState("10");
  const [_editingDetails, _setEditingDetails] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDetails, setNewTaskDetails] = useState("");
  const [newTaskType, setNewTaskType] = useState<TaskType>("one-time");
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri default
  const [scheduleTime, setScheduleTime] = useState("09");
  const [scheduleMinute, setScheduleMinute] = useState("00");
  const [scheduleAmPm, setScheduleAmPm] = useState<"AM" | "PM">("AM");
  const [selectedInterval, setSelectedInterval] = useState<number>(10); // minutes
  const [newTaskAssignee, setNewTaskAssignee] = useState<"operator" | "agent">("operator");
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [projectChildTasks, setProjectChildTasks] = useState<Record<string, Task[]>>({});
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(new Set());
  const [busyCronJobIds, setBusyCronJobIds] = useState<Set<string>>(new Set());
  const [busyProjectIds, setBusyProjectIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [addingProjectId, setAddingProjectId] = useState<string | null>(null);
  const [newProjectTaskTitle, setNewProjectTaskTitle] = useState("");
  const [newProjectTaskDetails, setNewProjectTaskDetails] = useState("");

  // Re-fetch child tasks for expanded projects whenever the top-level tasks change
  // (triggered by SSE events or polling in useTasks)
  const expandedProjectsRef = useRef(expandedProjects);
  expandedProjectsRef.current = expandedProjects;

  const setTaskBusy = useCallback((taskId: string, busy: boolean) => {
    setBusyTaskIds((prev) => {
      const next = new Set(prev);
      if (busy) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  }, []);

  const setProjectBusy = useCallback((projectId: string, busy: boolean) => {
    setBusyProjectIds((prev) => {
      const next = new Set(prev);
      if (busy) {
        next.add(projectId);
      } else {
        next.delete(projectId);
      }
      return next;
    });
  }, []);

  const setCronJobBusy = useCallback((jobId: string, busy: boolean) => {
    setBusyCronJobIds((prev) => {
      const next = new Set(prev);
      if (busy) {
        next.add(jobId);
      } else {
        next.delete(jobId);
      }
      return next;
    });
  }, []);

  const refreshProjectTasks = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) {
        throw new Error(`Project fetch failed: ${res.status}`);
      }
      const data = await res.json();
      if (data.tasks) {
        setProjectChildTasks((prev) => ({
          ...prev,
          [projectId]: data.tasks.map((t: any) => ({
            ...t,
            createdAt: new Date(t.createdAt),
            completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
            startedAt: t.startedAt ? new Date(t.startedAt) : undefined,
          })),
        }));
      }
    } catch (err) {
      console.error("[Projects] Failed to refresh tasks:", err);
      setActionError("Could not load project tasks. Please retry.");
    }
  }, []);

  useEffect(() => {
    const expanded = expandedProjectsRef.current;
    if (expanded.size === 0) return;

    for (const projectId of expanded) {
      void refreshProjectTasks(projectId);
    }
  }, [tasks, refreshProjectTasks]);

  const intervalOptions = [
    { value: 5, label: "5 min" },
    { value: 10, label: "10 min" },
    { value: 20, label: "20 min" },
    { value: 30, label: "30 min" },
    { value: 60, label: "1 hour" },
  ];

  const toggleTaskExpand = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const toggleProjectExpand = (projectId: string) => {
    const shouldExpand = !expandedProjects.has(projectId);
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
    if (shouldExpand || !projectChildTasks[projectId]) {
      void refreshProjectTasks(projectId);
    }
  };

  const dayLabels = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];

  const toggleDay = (dayIndex: number) => {
    setSelectedDays((prev) =>
      prev.includes(dayIndex) ? prev.filter((d) => d !== dayIndex) : [...prev, dayIndex].sort(),
    );
  };

  // Filter out child tasks (they appear under their project in the Projects tab)
  // and project parent tasks (they appear in the Projects tab)
  const topLevelTasks = tasks.filter((t) => !t.parentTaskId && t.type !== "project");

  // Filter tasks by type
  const oneTimeTasks = topLevelTasks.filter((t) => t.type === "one-time" || !t.type);
  const scheduledTasks = topLevelTasks.filter(
    (t) => t.type === "scheduled" || t.type === "interval",
  );

  const activeTasks = oneTimeTasks.filter((t) => t.status !== "completed");
  const completedTasks = oneTimeTasks.filter((t) => t.status === "completed");
  const workerTopLevelTasks = workerTasks.filter((t) => !t.parentTaskId && t.type !== "project");
  const workerOneTimeTasks = workerTopLevelTasks.filter((t) => t.type === "one-time" || !t.type);
  const activeWorkerTasks = workerOneTimeTasks.filter((t) => t.status !== "completed");
  const completedWorkerTasks = workerOneTimeTasks.filter((t) => t.status === "completed");

  const renderTaskLane = (
    laneActiveTasks: Task[],
    laneCompletedTasks: Task[],
    emptyState: { icon: string; title: string; subtitle: string },
  ) => (
    <>
      <div className="flex-[7] min-h-0 overflow-y-auto space-y-2">
        {laneActiveTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-white/40 text-sm">
            <span className="text-2xl mb-2">{emptyState.icon}</span>
            <span>{emptyState.title}</span>
            <span className="text-xs mt-1">{emptyState.subtitle}</span>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {laneActiveTasks.map((task) => {
            const Icon = statusIcons[task.status] || Circle;
            const color = statusColors[task.status] || "text-gray-400";
            const isExpanded = expandedTasks.has(task.id);
            const hasDetails = !!task.details;
            const isTaskBusy = busyTaskIds.has(task.id);
            return (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="rounded-xl bg-white/5 hover:bg-white/10 transition-colors group"
              >
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer"
                  onClick={() => (hasDetails ? toggleTaskExpand(task.id) : onTaskClick?.(task))}
                >
                  {hasDetails ? (
                    <button
                      type="button"
                      className="text-white/40 hover:text-white/60 transition-colors"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleTaskExpand(task.id);
                      }}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                  ) : (
                    <div className="w-4" />
                  )}
                  <Icon
                    className={`w-5 h-5 flex-shrink-0 ${color} ${
                      task.status === "in-progress" || task.status === "in_progress"
                        ? "animate-spin"
                        : ""
                    }`}
                  />
                  <span className="text-white/80 text-sm flex-1 truncate group-hover:text-white transition-colors">
                    {task.title}
                  </span>
                  {(() => {
                    const owner = getTaskOwner(task);
                    const badge = ownerBadge[owner];
                    return (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium border flex-shrink-0 ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    );
                  })()}
                  {hasDetails && !isExpanded && (
                    <span title="Has details">
                      <FileText className="w-3.5 h-3.5 text-white/30" />
                    </span>
                  )}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {task.status === "pending" && (
                      <button
                        type="button"
                        onClick={(e) => void handleExecuteClick(task, e)}
                        className="p-1.5 rounded-md hover:bg-green-500/20 text-green-400 disabled:opacity-40"
                        title="Execute task"
                        disabled={isTaskBusy}
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleEditClick(task, e)}
                      className="p-1.5 rounded-md hover:bg-white/10 text-white/50 disabled:opacity-40"
                      title="Edit task"
                      disabled={isTaskBusy}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => void handleDeleteClick(task.id, e)}
                      className="p-1.5 rounded-md hover:bg-red-500/20 text-red-400 disabled:opacity-40"
                      title="Delete task"
                      disabled={isTaskBusy}
                    >
                      {isTaskBusy ? (
                        <Loader className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                <AnimatePresence>
                  {isExpanded && hasDetails && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-3 pt-1 ml-8 border-t border-white/5">
                        <div
                          className="prose prose-invert prose-sm max-w-none
                          prose-pre:bg-black/30 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-lg
                          prose-code:text-purple-300 prose-code:bg-purple-500/10 prose-code:px-1 prose-code:rounded
                          prose-headings:text-white/80 prose-p:text-white/60 prose-li:text-white/60
                          prose-strong:text-white/80 prose-a:text-purple-400"
                        >
                          <ReactMarkdown>{task.details}</ReactMarkdown>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {laneCompletedTasks.length > 0 && (
        <div className="flex-[3] min-h-0 border-t border-white/5 flex flex-col">
          <div className="text-white/40 text-xs uppercase tracking-wider py-2 px-1 flex items-center gap-1 flex-shrink-0">
            Recently Completed
            <span className="text-white/20">({laneCompletedTasks.length})</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent pr-1">
            {laneCompletedTasks.map((task) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 p-1.5 rounded-lg opacity-50 group"
              >
                <CheckCircle className="w-4 h-4 text-green-400/50 flex-shrink-0" />
                <span className="text-white/40 text-sm flex-1 truncate line-through">
                  {task.title}
                </span>
                <button
                  type="button"
                  onClick={(e) => void handleDeleteClick(task.id, e)}
                  className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-red-400/50 transition-opacity disabled:opacity-40"
                  title="Remove"
                  disabled={busyTaskIds.has(task.id)}
                >
                  {busyTaskIds.has(task.id) ? (
                    <Loader className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const handleAddTask = async () => {
    if (!onTaskAdd) {
      setActionError("Task creation is unavailable in this view.");
      return;
    }
    if (newTaskTitle.trim()) {
      // Convert 12h to 24h format for storage
      let hour = parseInt(scheduleTime);
      if (scheduleAmPm === "PM" && hour !== 12) hour += 12;
      if (scheduleAmPm === "AM" && hour === 12) hour = 0;
      const time24 = `${hour.toString().padStart(2, "0")}:${scheduleMinute}`;

      // Build schedule based on task type
      let schedule: Task["schedule"] | undefined;
      if (newTaskType === "scheduled") {
        schedule = {
          frequency: "weekly",
          days: selectedDays,
          time: time24,
        };
      } else if (newTaskType === "interval") {
        schedule = {
          frequency: "interval",
          intervalMinutes: selectedInterval,
        };
      }

      const assigneeValue = newTaskAssignee === "agent" ? "argent" : undefined;
      setActionError(null);
      const created = await onTaskAdd(
        newTaskTitle.trim(),
        newTaskType,
        schedule,
        newTaskDetails.trim() || undefined,
        assigneeValue,
      );
      if (created === false || created === null) {
        setActionError("Failed to add task. Please retry.");
        return;
      }

      // Reset form
      setNewTaskTitle("");
      setNewTaskDetails("");
      setNewTaskType("one-time");
      setNewTaskAssignee("operator");
      setSelectedDays([1, 2, 3, 4, 5]);
      setScheduleTime("09");
      setScheduleMinute("00");
      setScheduleAmPm("AM");
      setSelectedInterval(10);
      setShowAddModal(false);
    }
  };

  const handleEditClick = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTask(task);
    setEditingTitle(task.title);
  };

  const handleCronEditClick = (job: CronJob, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionError(null);
    setEditingCronJob(job);
    setEditingCronTitle(job.name);
    setEditingCronEnabled(job.enabled);
    setEditingCronExecutionMode(resolveCronExecutionMode(job));
    const scheduleKind =
      job.schedule.kind === "every" || job.schedule.kind === "at" ? job.schedule.kind : "cron";
    setEditingCronScheduleKind(scheduleKind);
    setEditingCronExpr(job.schedule.expr ?? "");
    setEditingCronTimezone(
      job.schedule.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
    );
    setEditingCronAt(cronAtToLocalInputValue(job.schedule.at));
    setEditingCronEveryMinutes(cronEveryMsToMinutes(job.schedule.everyMs));
  };

  const runTaskAction = async (
    taskId: string,
    action: () => Promise<boolean | Task | void | null> | boolean | Task | void | null,
    errorMessage: string,
  ) => {
    if (busyTaskIds.has(taskId)) {
      return false;
    }
    setActionError(null);
    setTaskBusy(taskId, true);
    try {
      const result = await action();
      if (result === false || result === null) {
        setActionError(errorMessage);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[TaskList] Task action failed:", err);
      setActionError(errorMessage);
      return false;
    } finally {
      setTaskBusy(taskId, false);
    }
  };

  const runProjectAction = async (
    projectId: string,
    action: () => Promise<boolean | Task | void | null> | boolean | Task | void | null,
    errorMessage: string,
  ) => {
    if (busyProjectIds.has(projectId)) {
      return false;
    }
    setActionError(null);
    setProjectBusy(projectId, true);
    try {
      const result = await action();
      if (result === false || result === null) {
        setActionError(errorMessage);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[TaskList] Project action failed:", err);
      setActionError(errorMessage);
      return false;
    } finally {
      setProjectBusy(projectId, false);
    }
  };

  const runCronJobAction = async (
    jobId: string,
    action: () =>
      | Promise<
          boolean | CronJob | { ok?: boolean; removed?: boolean; ran?: boolean } | void | null
        >
      | boolean
      | CronJob
      | { ok?: boolean; removed?: boolean; ran?: boolean }
      | void
      | null,
    errorMessage: string,
  ) => {
    if (busyCronJobIds.has(jobId)) {
      return false;
    }
    setActionError(null);
    setCronJobBusy(jobId, true);
    try {
      const result = await action();
      if (
        result === false ||
        result === null ||
        (typeof result === "object" &&
          result !== null &&
          "removed" in result &&
          result.removed === false)
      ) {
        setActionError(errorMessage);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[TaskList] Cron job action failed:", err);
      setActionError(errorMessage);
      return false;
    } finally {
      setCronJobBusy(jobId, false);
    }
  };

  const handleDeleteClick = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onTaskDelete) {
      setActionError("Task deletion is unavailable in this view.");
      return;
    }
    await runTaskAction(taskId, () => onTaskDelete(taskId), "Failed to delete task.");
  };

  const handleExecuteClick = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onTaskExecute) {
      setActionError("Task execution is unavailable in this view.");
      return;
    }
    await runTaskAction(task.id, () => onTaskExecute(task), "Failed to execute task.");
  };

  const handleCronDeleteClick = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onCronJobDelete) {
      setActionError("Scheduled job deletion is unavailable in this view.");
      return;
    }
    await runCronJobAction(
      jobId,
      async () => {
        const result = await onCronJobDelete(jobId);
        if (result === undefined || typeof result === "boolean") {
          return result;
        }
        return result.removed === false ? false : result;
      },
      "Failed to delete scheduled job.",
    );
  };

  const handleCronRunClick = async (job: CronJob, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onCronJobRun) {
      setActionError("Running scheduled jobs is unavailable in this view.");
      return;
    }
    const ok = await runCronJobAction(
      job.id,
      async () => {
        const result = await onCronJobRun(job.id);
        if (typeof result === "boolean" || result === undefined) {
          return result;
        }
        return result.ran === false && result.reason === "not-due" ? false : result;
      },
      "Failed to run scheduled job.",
    );
    if (ok && editingCronJob?.id === job.id) {
      setEditingCronJob(null);
    }
  };

  const handleMarkComplete = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onTaskEdit) {
      setActionError("Task updates are unavailable in this view.");
      return;
    }
    await runTaskAction(
      task.id,
      () => onTaskEdit({ ...task, status: "completed" }),
      "Failed to mark task complete.",
    );
  };

  const handleEditSave = async () => {
    if (!editingTask) return;
    if (!editingTitle.trim()) return;
    if (!onTaskEdit) {
      setActionError("Task updates are unavailable in this view.");
      return;
    }
    const ok = await runTaskAction(
      editingTask.id,
      () => onTaskEdit({ ...editingTask, title: editingTitle.trim() }),
      "Failed to save task changes.",
    );
    if (ok) {
      setEditingTask(null);
    }
  };

  const handleEditDelete = async () => {
    if (!editingTask) return;
    if (!onTaskDelete) {
      setActionError("Task deletion is unavailable in this view.");
      return;
    }
    const ok = await runTaskAction(
      editingTask.id,
      () => onTaskDelete(editingTask.id),
      "Failed to delete task.",
    );
    if (ok) {
      setEditingTask(null);
    }
  };

  const buildEditingCronSchedule = () => {
    if (!editingCronJob) {
      return null;
    }
    if (editingCronScheduleKind === "cron") {
      const expr = editingCronExpr.trim();
      if (!expr) {
        setActionError("Cron expression is required.");
        return null;
      }
      const tz = editingCronTimezone.trim();
      return {
        kind: "cron" as const,
        expr,
        ...(tz ? { tz } : {}),
      };
    }
    if (editingCronScheduleKind === "at") {
      const at = cronLocalInputValueToIso(editingCronAt);
      if (!at) {
        setActionError("A valid one-time run timestamp is required.");
        return null;
      }
      return { kind: "at" as const, at };
    }

    const intervalMinutes = Number(editingCronEveryMinutes);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      setActionError("Interval minutes must be greater than zero.");
      return null;
    }
    return {
      kind: "every" as const,
      everyMs: Math.round(intervalMinutes * 60_000),
      ...(typeof editingCronJob.schedule.anchorMs === "number"
        ? { anchorMs: editingCronJob.schedule.anchorMs }
        : {}),
    };
  };

  const handleCronEditSave = async () => {
    if (!editingCronJob) return;
    if (!editingCronTitle.trim()) {
      setActionError("Scheduled job name is required.");
      return;
    }
    if (!onCronJobUpdate) {
      setActionError("Scheduled job updates are unavailable in this view.");
      return;
    }
    const schedule = buildEditingCronSchedule();
    if (!schedule) {
      return;
    }
    const ok = await runCronJobAction(
      editingCronJob.id,
      () =>
        onCronJobUpdate(editingCronJob.id, {
          name: editingCronTitle.trim(),
          enabled: editingCronEnabled,
          executionMode: editingCronExecutionMode,
          schedule,
        }),
      "Failed to save scheduled job.",
    );
    if (ok) {
      setEditingCronJob(null);
    }
  };

  const handleCronEditDelete = async () => {
    if (!editingCronJob) return;
    if (!onCronJobDelete) {
      setActionError("Scheduled job deletion is unavailable in this view.");
      return;
    }
    const ok = await runCronJobAction(
      editingCronJob.id,
      async () => {
        const result = await onCronJobDelete(editingCronJob.id);
        if (result === undefined || typeof result === "boolean") {
          return result;
        }
        return result.removed === false ? false : result;
      },
      "Failed to delete scheduled job.",
    );
    if (ok) {
      setEditingCronJob(null);
    }
  };

  const handleProjectDelete = async (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onProjectDelete) {
      setActionError("Project deletion is unavailable in this view.");
      return;
    }
    if (!window.confirm(`Delete project "${project.title}" and all child tasks?`)) {
      return;
    }
    const ok = await runProjectAction(
      project.id,
      () => onProjectDelete(project.id),
      "Failed to delete project.",
    );
    if (!ok) return;

    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.delete(project.id);
      return next;
    });
    setProjectChildTasks((prev) => {
      const next = { ...prev };
      delete next[project.id];
      return next;
    });
    if (addingProjectId === project.id) {
      setAddingProjectId(null);
      setNewProjectTaskTitle("");
      setNewProjectTaskDetails("");
    }
  };

  const handleStartProjectTaskAdd = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAddingProjectId(projectId);
    setNewProjectTaskTitle("");
    setNewProjectTaskDetails("");
    if (!expandedProjects.has(projectId)) {
      toggleProjectExpand(projectId);
    }
  };

  const handleProjectTaskAdd = async (projectId: string) => {
    if (!newProjectTaskTitle.trim()) return;
    if (!onProjectTaskAdd) {
      setActionError("Adding project tasks is unavailable in this view.");
      return;
    }
    const ok = await runProjectAction(
      projectId,
      () =>
        onProjectTaskAdd(
          projectId,
          newProjectTaskTitle.trim(),
          newProjectTaskDetails.trim() || undefined,
        ),
      "Failed to add project task.",
    );
    if (!ok) return;

    setNewProjectTaskTitle("");
    setNewProjectTaskDetails("");
    setAddingProjectId(null);
    await refreshProjectTasks(projectId);
  };

  const formatSchedule = (task: Task) => {
    if (!task.schedule) return "No schedule";
    const { frequency, time, days, intervalMinutes } = task.schedule;

    if (frequency === "interval" || task.type === "interval") {
      return `Every ${intervalMinutes || 10} minutes`;
    }

    if (frequency === "daily") return `Daily at ${time || "9:00"}`;
    if (frequency === "weekly") {
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const selectedDays = days?.map((d) => dayNames[d]).join(", ") || "Mon-Fri";
      return `Weekly: ${selectedDays} at ${time || "9:00"}`;
    }
    if (frequency === "monthly") return `Monthly on day ${days?.[0] || 1} at ${time || "9:00"}`;
    return task.schedule.cron || "Custom";
  };

  const activeLaneMeta =
    activeTab === "workers"
      ? {
          label: "Business Worker Lane",
          body: "Job-assignment and worker-generated tasks live here. This lane is separate from the operator board and is hidden in CORE surfaces.",
        }
      : activeTab === "tasks"
        ? {
            label: "Operator Lane",
            body: "Personal operator and main-agent tasks live here. Worker/job tasks are excluded from this board by default.",
          }
        : null;

  return (
    <div className="glass-panel rounded-2xl p-4 h-full flex flex-col">
      {/* Header with tabs */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 bg-white/5 rounded-lg p-1">
          <button
            onClick={() => setActiveTab("tasks")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === "tasks"
                ? "bg-purple-500/30 text-purple-300"
                : "text-white/50 hover:text-white/70"
            }`}
          >
            <Clock className="w-4 h-4 inline mr-1.5" />
            Tasks
          </button>
          {showWorkerLane && (
            <button
              onClick={() => setActiveTab("workers")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                activeTab === "workers"
                  ? "bg-purple-500/30 text-purple-300"
                  : "text-white/50 hover:text-white/70"
              }`}
            >
              <Users className="w-4 h-4 inline mr-1.5" />
              Workers
            </button>
          )}
          <button
            onClick={() => setActiveTab("schedule")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === "schedule"
                ? "bg-purple-500/30 text-purple-300"
                : "text-white/50 hover:text-white/70"
            }`}
          >
            <Calendar className="w-4 h-4 inline mr-1.5" />
            Schedule
          </button>
          <button
            onClick={() => setActiveTab("projects")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === "projects"
                ? "bg-purple-500/30 text-purple-300"
                : "text-white/50 hover:text-white/70"
            }`}
          >
            <FolderKanban className="w-4 h-4 inline mr-1.5" />
            Projects
          </button>
        </div>

        <div className="flex gap-1">
          {/* Board view toggle */}
          {onOpenBoard && (
            <button
              onClick={onOpenBoard}
              className={`p-2 rounded-lg transition-colors ${
                showBoard
                  ? "bg-purple-500/30 text-purple-300"
                  : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60"
              }`}
              title="Open project board"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          )}
          {/* Kickoff button */}
          {activeTab === "projects" && onProjectKickoff && (
            <button
              onClick={onProjectKickoff}
              className="px-2.5 py-1.5 flex items-center gap-1.5 rounded-lg bg-white/5 text-purple-400 border border-purple-500/20 hover:bg-purple-500/10 transition-colors text-sm font-medium"
              title="SpecForge Kickoff"
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">Kickoff Project</span>
            </button>
          )}
          {/* Add button */}
          {activeTab !== "workers" && (
            <button
              onClick={() => setShowAddModal(true)}
              className="p-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
              title="Add task"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {actionError}
        </div>
      )}

      {activeLaneMeta && (
        <div className="mb-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
            {activeLaneMeta.label}
          </div>
          <div className="mt-1 text-xs text-white/60">{activeLaneMeta.body}</div>
        </div>
      )}

      {/* Task list content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === "projects" ? (
          /* Projects Tab */
          <div className="flex-1 overflow-y-auto space-y-2">
            {projects.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 text-white/40 text-sm">
                <span className="text-2xl mb-2">📁</span>
                <span>No projects yet</span>
                <span className="text-xs mt-1">Ask the agent to create one</span>
              </div>
            )}

            <AnimatePresence mode="popLayout">
              {projects.map((project) => {
                const isExpanded = expandedProjects.has(project.id);
                const progress =
                  project.taskCount > 0
                    ? Math.round((project.completedCount / project.taskCount) * 100)
                    : 0;

                // Derive status from progress
                let statusLabel: string;
                let statusColor: string;
                if (project.taskCount > 0 && project.completedCount === project.taskCount) {
                  statusLabel = "Done";
                  statusColor = "text-green-400";
                } else if (project.completedCount > 0) {
                  statusLabel = "Active";
                  statusColor = "text-purple-400";
                } else {
                  statusLabel = "Pending";
                  statusColor = "text-gray-400";
                }

                return (
                  <motion.div
                    key={project.id}
                    layout
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="rounded-xl bg-white/5 hover:bg-white/10 transition-colors group"
                  >
                    <div
                      className="flex items-center gap-3 p-3 cursor-pointer"
                      onClick={() => toggleProjectExpand(project.id)}
                    >
                      <button className="text-white/40 hover:text-white/60 transition-colors">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                      <FolderKanban className="w-5 h-5 flex-shrink-0 text-purple-400" />
                      <div className="flex-1 min-w-0">
                        <span className="text-white/80 text-sm block truncate">
                          {project.title}
                        </span>
                        <div className="flex items-center gap-2 mt-1">
                          {/* Progress bar */}
                          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-purple-500 rounded-full transition-all duration-500"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-white/40 text-xs whitespace-nowrap">
                            {project.completedCount}/{project.taskCount}
                          </span>
                          <span className={`text-xs ${statusColor}`}>{statusLabel}</span>
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleStartProjectTaskAdd(project.id, e)}
                          className="p-1.5 rounded-md hover:bg-purple-500/20 text-purple-300 disabled:opacity-40"
                          title="Add project task"
                          disabled={busyProjectIds.has(project.id)}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => void handleProjectDelete(project, e)}
                          className="p-1.5 rounded-md hover:bg-red-500/20 text-red-400 disabled:opacity-40"
                          title="Delete project"
                          disabled={busyProjectIds.has(project.id)}
                        >
                          {busyProjectIds.has(project.id) ? (
                            <Loader className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Expanded child tasks */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 ml-8 space-y-1">
                            {project.details && (
                              <p className="text-white/40 text-xs mb-2">{project.details}</p>
                            )}
                            {addingProjectId === project.id && (
                              <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-2 mb-2 space-y-2">
                                <input
                                  type="text"
                                  value={newProjectTaskTitle}
                                  onChange={(e) => setNewProjectTaskTitle(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      void handleProjectTaskAdd(project.id);
                                    } else if (e.key === "Escape") {
                                      setAddingProjectId(null);
                                      setNewProjectTaskTitle("");
                                      setNewProjectTaskDetails("");
                                    }
                                  }}
                                  placeholder="New project task..."
                                  className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                                  autoFocus
                                />
                                <textarea
                                  value={newProjectTaskDetails}
                                  onChange={(e) => setNewProjectTaskDetails(e.target.value)}
                                  placeholder="Details (optional)"
                                  className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 min-h-[60px] resize-y"
                                />
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    onClick={() => {
                                      setAddingProjectId(null);
                                      setNewProjectTaskTitle("");
                                      setNewProjectTaskDetails("");
                                    }}
                                    className="px-2 py-1 text-xs rounded-md text-white/50 hover:text-white/70"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => void handleProjectTaskAdd(project.id)}
                                    disabled={
                                      !newProjectTaskTitle.trim() || busyProjectIds.has(project.id)
                                    }
                                    className="px-2 py-1 text-xs rounded-md bg-purple-500/30 text-purple-300 hover:bg-purple-500/40 disabled:opacity-40"
                                  >
                                    Add Task
                                  </button>
                                </div>
                              </div>
                            )}
                            {projectChildTasks[project.id] ? (
                              projectChildTasks[project.id].length === 0 ? (
                                <div className="text-white/30 text-xs">No project tasks yet.</div>
                              ) : (
                                projectChildTasks[project.id].map((task) => {
                                  const isTaskBusy = busyTaskIds.has(task.id);
                                  const canExecute = task.status === "pending";
                                  const canComplete = task.status !== "completed";
                                  const Icon = statusIcons[task.status] || Circle;
                                  const color = statusColors[task.status] || "text-gray-400";
                                  return (
                                    <div
                                      key={task.id}
                                      className="flex items-center gap-2 py-1 rounded-md px-1 group/task hover:bg-white/5"
                                    >
                                      <Icon
                                        className={`w-4 h-4 flex-shrink-0 ${color} ${
                                          task.status === "in-progress" ? "animate-spin" : ""
                                        }`}
                                      />
                                      <span className="text-white/60 text-xs truncate">
                                        {task.title}
                                      </span>
                                      <div className="ml-auto flex gap-1 opacity-0 group-hover/task:opacity-100 transition-opacity">
                                        {canExecute && (
                                          <button
                                            onClick={(e) => void handleExecuteClick(task, e)}
                                            className="p-1 rounded-md hover:bg-green-500/20 text-green-400 disabled:opacity-40"
                                            title="Execute task"
                                            disabled={isTaskBusy}
                                          >
                                            <Play className="w-3 h-3" />
                                          </button>
                                        )}
                                        {canComplete && (
                                          <button
                                            onClick={(e) => void handleMarkComplete(task, e)}
                                            className="p-1 rounded-md hover:bg-green-500/20 text-green-400 disabled:opacity-40"
                                            title="Mark complete"
                                            disabled={isTaskBusy}
                                          >
                                            <CheckCircle className="w-3 h-3" />
                                          </button>
                                        )}
                                        <button
                                          onClick={(e) => handleEditClick(task, e)}
                                          className="p-1 rounded-md hover:bg-white/10 text-white/50 disabled:opacity-40"
                                          title="Edit task"
                                          disabled={isTaskBusy}
                                        >
                                          <Pencil className="w-3 h-3" />
                                        </button>
                                        <button
                                          onClick={(e) => void handleDeleteClick(task.id, e)}
                                          className="p-1 rounded-md hover:bg-red-500/20 text-red-400 disabled:opacity-40"
                                          title="Delete task"
                                          disabled={isTaskBusy}
                                        >
                                          {isTaskBusy ? (
                                            <Loader className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Trash2 className="w-3 h-3" />
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })
                              )
                            ) : (
                              <div className="text-white/30 text-xs">Loading tasks...</div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        ) : activeTab === "tasks" ? (
          renderTaskLane(activeTasks, completedTasks, {
            icon: "✨",
            title: "No tasks queued",
            subtitle: "Give me a task or add one",
          })
        ) : activeTab === "workers" ? (
          renderTaskLane(activeWorkerTasks, completedWorkerTasks, {
            icon: "👷",
            title: "No worker tasks queued",
            subtitle: "Business worker jobs appear here",
          })
        ) : (
          /* Schedule Tab */
          <div className="flex-1 overflow-y-auto space-y-2">
            {scheduledTasks.length === 0 && cronJobs.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 text-white/40 text-sm">
                <span className="text-2xl mb-2">📅</span>
                <span>No scheduled tasks</span>
                <span className="text-xs mt-1">Add a recurring task</span>
              </div>
            )}

            {/* Cron Jobs from ArgentOS */}
            {cronJobs.length > 0 && (
              <>
                <div className="text-white/40 text-xs uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
                  <Bot className="w-3 h-3" />
                  Agent Jobs
                </div>
                {cronJobs.map((job) => {
                  const isCronJobBusy = busyCronJobIds.has(job.id);
                  const executionMode = resolveCronExecutionMode(job);
                  const isPaperTradeBlocked =
                    executionMode === "paper_trade" &&
                    job.state?.lastGateDecision === "simulated_paper_trade";
                  const statusBadgeClass = job.enabled
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                    : "bg-white/5 text-white/40 border-white/10";

                  return (
                    <motion.div
                      key={job.id}
                      layout
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex flex-col gap-2 p-3 rounded-xl border mb-2 group transition-colors ${
                        job.enabled
                          ? "bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/15"
                          : "bg-white/5 border-white/10 hover:bg-white/10"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Bot
                          className={`w-4 h-4 flex-shrink-0 ${
                            job.enabled ? "text-purple-400" : "text-white/30"
                          }`}
                        />
                        <span className="text-white/80 text-sm flex-1 truncate">{job.name}</span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {onCronJobRun && (
                            <button
                              onClick={(e) => void handleCronRunClick(job, e)}
                              className="p-1.5 rounded-md hover:bg-green-500/20 text-green-400 disabled:opacity-40"
                              title="Run now"
                              disabled={isCronJobBusy}
                            >
                              {isCronJobBusy ? (
                                <Loader className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Play className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                          {onCronJobUpdate && (
                            <button
                              onClick={(e) => handleCronEditClick(job, e)}
                              className="p-1.5 rounded-md hover:bg-white/10 text-white/50 disabled:opacity-40"
                              title="Edit job"
                              disabled={isCronJobBusy}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onCronJobDelete && (
                            <button
                              onClick={(e) => void handleCronDeleteClick(job.id, e)}
                              className="p-1.5 rounded-md hover:bg-red-500/20 text-red-400 disabled:opacity-40"
                              title="Delete job"
                              disabled={isCronJobBusy}
                            >
                              {isCronJobBusy ? (
                                <Loader className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-white/40 text-xs ml-7 flex justify-between gap-3">
                        <span className="truncate">
                          {cronFormatSchedule?.(job) ||
                            job.schedule?.expr ||
                            job.schedule?.kind ||
                            "Scheduled"}
                        </span>
                        <span className="text-purple-400 whitespace-nowrap">
                          {cronGetNextRun?.(job) || ""}
                        </span>
                      </div>
                      <div className="ml-7 flex flex-wrap gap-1.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide border ${statusBadgeClass}`}
                        >
                          {job.enabled ? "Enabled" : "Disabled"}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide border ${
                            executionMode === "live"
                              ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/20"
                              : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                          }`}
                        >
                          {executionMode === "live" ? "Live" : "Paper Trade"}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide border border-white/10 text-white/40 bg-white/5">
                          {job.payload.kind}
                        </span>
                        {isPaperTradeBlocked && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide border border-amber-500/30 text-amber-200 bg-amber-500/10">
                            Blocked
                          </span>
                        )}
                      </div>
                      {isPaperTradeBlocked && job.state?.lastGateReason && (
                        <div className="ml-7 text-[11px] text-amber-200/80">
                          {job.state.lastGateReason}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </>
            )}

            <AnimatePresence mode="popLayout">
              {scheduledTasks.map((task) => {
                const isTaskBusy = busyTaskIds.has(task.id);
                return (
                  <motion.div
                    key={task.id}
                    layout
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    onClick={() => onTaskClick?.(task)}
                    className="flex flex-col gap-1 p-3 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="w-5 h-5 text-purple-400 flex-shrink-0" />
                      <span className="text-white/80 text-sm flex-1 truncate group-hover:text-white transition-colors">
                        {task.title}
                      </span>
                      {/* Action buttons */}
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleEditClick(task, e)}
                          className="p-1.5 rounded-md hover:bg-white/10 text-white/50 disabled:opacity-40"
                          title="Edit schedule"
                          disabled={isTaskBusy}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => void handleDeleteClick(task.id, e)}
                          className="p-1.5 rounded-md hover:bg-red-500/20 text-red-400 disabled:opacity-40"
                          title="Delete"
                          disabled={isTaskBusy}
                        >
                          {isTaskBusy ? (
                            <Loader className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="text-white/40 text-xs ml-8">{formatSchedule(task)}</div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Add Task Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 rounded-2xl p-6 w-96 max-w-[90vw]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold text-lg">Add Task</h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-1 rounded-lg hover:bg-white/10 text-white/50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="Task title..."
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 mb-3"
                autoFocus
              />

              {/* Details textarea with markdown support */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-white/40" />
                  <span className="text-white/40 text-xs">Details (Markdown supported)</span>
                </div>
                <textarea
                  value={newTaskDetails}
                  onChange={(e) => setNewTaskDetails(e.target.value)}
                  placeholder="Add details, notes, code blocks..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 text-sm font-mono min-h-[100px] resize-y"
                />
              </div>

              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setNewTaskType("one-time")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    newTaskType === "one-time"
                      ? "bg-purple-500/30 text-purple-300 border border-purple-500/50"
                      : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
                  }`}
                >
                  One-time
                </button>
                <button
                  onClick={() => setNewTaskType("scheduled")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    newTaskType === "scheduled"
                      ? "bg-purple-500/30 text-purple-300 border border-purple-500/50"
                      : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
                  }`}
                >
                  Scheduled
                </button>
                <button
                  onClick={() => setNewTaskType("interval")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    newTaskType === "interval"
                      ? "bg-purple-500/30 text-purple-300 border border-purple-500/50"
                      : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
                  }`}
                >
                  Interval
                </button>
              </div>

              {/* Assignee selector */}
              <div className="mb-4">
                <label className="text-white/50 text-xs uppercase tracking-wider mb-2 block">
                  Assign To
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setNewTaskAssignee("operator")}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                      newTaskAssignee === "operator"
                        ? "bg-blue-500/30 text-blue-300 border border-blue-500/50"
                        : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    Operator
                  </button>
                  <button
                    onClick={() => setNewTaskAssignee("agent")}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                      newTaskAssignee === "agent"
                        ? "bg-purple-500/30 text-purple-300 border border-purple-500/50"
                        : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    Agent
                  </button>
                </div>
              </div>

              {/* Schedule options - only show when Scheduled is selected */}
              {newTaskType === "scheduled" && (
                <div className="mb-4 space-y-4">
                  {/* Day selector circles */}
                  <div>
                    <label className="text-white/50 text-xs uppercase tracking-wider mb-2 block">
                      Days
                    </label>
                    <div className="flex justify-between gap-1">
                      {dayLabels.map((label, index) => (
                        <button
                          key={index}
                          onClick={() => toggleDay(index)}
                          className={`w-9 h-9 rounded-full text-xs font-medium transition-all ${
                            selectedDays.includes(index)
                              ? "bg-purple-500 text-white"
                              : "bg-white/5 text-white/40 hover:bg-white/10"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Time picker */}
                  <div>
                    <label className="text-white/50 text-xs uppercase tracking-wider mb-2 block">
                      Time
                    </label>
                    <div className="flex gap-2 items-center">
                      <select
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500/50"
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                          <option key={h} value={h.toString().padStart(2, "0")}>
                            {h}
                          </option>
                        ))}
                      </select>
                      <span className="text-white/50">:</span>
                      <select
                        value={scheduleMinute}
                        onChange={(e) => setScheduleMinute(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500/50"
                      >
                        {["00", "15", "30", "45"].map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <div className="flex bg-white/5 rounded-lg border border-white/10 overflow-hidden">
                        <button
                          onClick={() => setScheduleAmPm("AM")}
                          className={`px-3 py-2 text-sm font-medium transition-all ${
                            scheduleAmPm === "AM"
                              ? "bg-purple-500/30 text-purple-300"
                              : "text-white/50 hover:bg-white/10"
                          }`}
                        >
                          AM
                        </button>
                        <button
                          onClick={() => setScheduleAmPm("PM")}
                          className={`px-3 py-2 text-sm font-medium transition-all ${
                            scheduleAmPm === "PM"
                              ? "bg-purple-500/30 text-purple-300"
                              : "text-white/50 hover:bg-white/10"
                          }`}
                        >
                          PM
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Interval options - only show when Interval is selected */}
              {newTaskType === "interval" && (
                <div className="mb-4">
                  <label className="text-white/50 text-xs uppercase tracking-wider mb-2 block">
                    Repeat Every
                  </label>
                  <div className="flex gap-2">
                    {intervalOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setSelectedInterval(opt.value)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                          selectedInterval === opt.value
                            ? "bg-purple-500 text-white"
                            : "bg-white/5 text-white/50 hover:bg-white/10"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-white/30 text-xs mt-2">
                    Task will run continuously at this interval
                  </p>
                </div>
              )}

              <button
                onClick={() => void handleAddTask()}
                disabled={!newTaskTitle.trim()}
                className="w-full py-3 bg-purple-500/30 hover:bg-purple-500/40 disabled:bg-white/5 disabled:text-white/20 text-purple-300 rounded-xl font-medium transition-all"
              >
                Add Task
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Task Modal */}
      <AnimatePresence>
        {editingTask && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setEditingTask(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 rounded-2xl p-6 w-96 max-w-[90vw]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold text-lg">Edit Task</h3>
                <button
                  onClick={() => setEditingTask(null)}
                  className="p-1 rounded-lg hover:bg-white/10 text-white/50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <input
                type="text"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 mb-4"
                autoFocus
              />

              <div className="text-white/50 text-sm mb-4">
                Type:{" "}
                {editingTask.type === "scheduled"
                  ? "Scheduled"
                  : editingTask.type === "interval"
                    ? "Interval"
                    : editingTask.type === "project"
                      ? "Project"
                      : "One-time"}
                {editingTask.schedule && <div className="mt-1">{formatSchedule(editingTask)}</div>}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => void handleEditSave()}
                  disabled={!editingTitle.trim() || busyTaskIds.has(editingTask.id)}
                  className="flex-1 py-2 bg-purple-500/30 hover:bg-purple-500/40 disabled:bg-white/5 disabled:text-white/20 text-purple-300 rounded-xl font-medium transition-all"
                >
                  {busyTaskIds.has(editingTask.id) ? "Saving..." : "Save Changes"}
                </button>
                <button
                  onClick={() => void handleEditDelete()}
                  disabled={busyTaskIds.has(editingTask.id)}
                  className="py-2 px-4 bg-red-500/20 hover:bg-red-500/30 disabled:opacity-40 text-red-400 rounded-xl font-medium transition-all"
                >
                  {busyTaskIds.has(editingTask.id) ? "Deleting..." : "Delete"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Cron Job Modal */}
      <AnimatePresence>
        {editingCronJob && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setEditingCronJob(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 rounded-2xl p-6 w-[30rem] max-w-[92vw]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold text-lg">Edit Agent Job</h3>
                <button
                  onClick={() => setEditingCronJob(null)}
                  className="p-1 rounded-lg hover:bg-white/10 text-white/50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/40 mb-1.5">
                    Name
                  </label>
                  <input
                    type="text"
                    value={editingCronTitle}
                    onChange={(e) => setEditingCronTitle(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/40 mb-1.5">
                      Mode
                    </label>
                    <select
                      value={editingCronExecutionMode}
                      onChange={(e) =>
                        setEditingCronExecutionMode(e.target.value as "live" | "paper_trade")
                      }
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-purple-500/50"
                    >
                      <option value="live">Live</option>
                      <option value="paper_trade">Paper Trade</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/40 mb-1.5">
                      Status
                    </label>
                    <select
                      value={editingCronEnabled ? "enabled" : "disabled"}
                      onChange={(e) => setEditingCronEnabled(e.target.value === "enabled")}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-purple-500/50"
                    >
                      <option value="enabled">Enabled</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/40 mb-1.5">
                    Schedule Type
                  </label>
                  <select
                    value={editingCronScheduleKind}
                    onChange={(e) =>
                      setEditingCronScheduleKind(e.target.value as "cron" | "every" | "at")
                    }
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-purple-500/50"
                  >
                    <option value="cron">Cron Expression</option>
                    <option value="every">Interval</option>
                    <option value="at">One Time</option>
                  </select>
                </div>

                {editingCronScheduleKind === "cron" && (
                  <div className="grid grid-cols-[2fr,1fr] gap-3">
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-white/40 mb-1.5">
                        Cron Expression
                      </label>
                      <input
                        type="text"
                        value={editingCronExpr}
                        onChange={(e) => setEditingCronExpr(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                        placeholder="30 8 * * *"
                      />
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-white/40 mb-1.5">
                        Timezone
                      </label>
                      <input
                        type="text"
                        value={editingCronTimezone}
                        onChange={(e) => setEditingCronTimezone(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                        placeholder="America/Chicago"
                      />
                    </div>
                  </div>
                )}

                {editingCronScheduleKind === "every" && (
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/40 mb-1.5">
                      Interval Minutes
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={editingCronEveryMinutes}
                      onChange={(e) => setEditingCronEveryMinutes(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                    />
                  </div>
                )}

                {editingCronScheduleKind === "at" && (
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/40 mb-1.5">
                      Run At
                    </label>
                    <input
                      type="datetime-local"
                      value={editingCronAt}
                      onChange={(e) => setEditingCronAt(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                    />
                  </div>
                )}

                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
                    Execution Summary
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs text-white/55 sm:grid-cols-2">
                    {getCronPayloadSummary(editingCronJob).map((row) => (
                      <div key={row.label}>
                        <span className="text-white/35">{row.label}:</span> {row.value}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
                    What This Job Will Run
                  </div>
                  <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/20 px-3 py-2 text-xs leading-5 text-white/75">
                    {getCronPayloadPreview(editingCronJob)}
                  </pre>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
                    Raw Payload
                  </div>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/20 px-3 py-2 text-xs leading-5 text-white/65">
                    {JSON.stringify(editingCronJob.payload, null, 2)}
                  </pre>
                </div>

                {editingCronJob.delivery && (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
                      Delivery
                    </div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/20 px-3 py-2 text-xs leading-5 text-white/65">
                      {JSON.stringify(editingCronJob.delivery, null, 2)}
                    </pre>
                  </div>
                )}

                <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-100/85">
                  Audit note: `agentTurn` jobs execute the payload text shown above. If this text is
                  wrong or too broad, the job itself is unsafe even when the schedule looks correct.
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => void handleCronEditSave()}
                    disabled={!editingCronTitle.trim() || busyCronJobIds.has(editingCronJob.id)}
                    className="flex-1 py-2 bg-purple-500/30 hover:bg-purple-500/40 disabled:bg-white/5 disabled:text-white/20 text-purple-300 rounded-xl font-medium transition-all"
                  >
                    {busyCronJobIds.has(editingCronJob.id) ? "Saving..." : "Save Changes"}
                  </button>
                  {onCronJobRun && (
                    <button
                      onClick={(e) => void handleCronRunClick(editingCronJob, e)}
                      disabled={busyCronJobIds.has(editingCronJob.id)}
                      className="py-2 px-4 bg-green-500/20 hover:bg-green-500/30 disabled:opacity-40 text-green-300 rounded-xl font-medium transition-all"
                    >
                      Run Now
                    </button>
                  )}
                  <button
                    onClick={() => void handleCronEditDelete()}
                    disabled={busyCronJobIds.has(editingCronJob.id)}
                    className="py-2 px-4 bg-red-500/20 hover:bg-red-500/30 disabled:opacity-40 text-red-400 rounded-xl font-medium transition-all"
                  >
                    {busyCronJobIds.has(editingCronJob.id) ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
