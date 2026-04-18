import { useState, useEffect, useCallback, useRef } from "react";
import type { Task, TaskType, Project } from "../components/TaskList";
import { fetchLocalApi } from "../utils/localApiFetch";

const API_BASE = "/api";

interface UseTasksReturn {
  tasks: Task[];
  projects: Project[];
  loading: boolean;
  error: string | null;
  addTask: (
    title: string,
    type?: TaskType,
    schedule?: Task["schedule"],
    details?: string,
    assignee?: string,
  ) => Promise<Task | null>;
  addProjectTask: (
    projectId: string,
    title: string,
    details?: string,
    priority?: string,
  ) => Promise<Task | null>;
  updateTask: (taskId: string, updates: Partial<Task>) => Promise<Task | null>;
  deleteTask: (taskId: string) => Promise<boolean>;
  deleteProject: (projectId: string) => Promise<boolean>;
  archiveProject: (projectId: string, archived: boolean) => Promise<boolean>;
  startTask: (taskId: string) => Promise<Task | null>;
  completeTask: (taskId: string) => Promise<Task | null>;
  startTaskByTitle: (title: string) => Promise<Task | null>;
  completeTaskByTitle: (title: string) => Promise<Task | null>;
  refreshTasks: () => Promise<void>;
}

interface UseTasksOptions {
  enabled?: boolean;
  pollMs?: number;
  includeWorkerTasks?: boolean;
  workerOnly?: boolean;
}

export function useTasks(options: UseTasksOptions = {}): UseTasksReturn {
  const {
    enabled = true,
    pollMs = 15000,
    includeWorkerTasks = false,
    workerOnly = false,
  } = options;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshAbortRef = useRef<AbortController | null>(null);

  const isWorkerLaneTask = useCallback((task: Task | Project) => {
    const source = (task as Task).source;
    if (source === "job") return true;
    const metadata = (task as Task & { metadata?: Record<string, unknown> }).metadata;
    return Boolean(metadata && typeof metadata === "object" && metadata.jobAssignmentId);
  }, []);

  const filterByLane = useCallback(
    <T extends Task | Project>(items: T[]): T[] => {
      if (!workerOnly) return items;
      return items.filter((item) => isWorkerLaneTask(item));
    },
    [isWorkerLaneTask, workerOnly],
  );

  // Fetch projects (internal, called by refreshTasks)
  const fetchProjectsInternal = useCallback(
    async (signal?: AbortSignal) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      try {
        const controller = signal ? null : new AbortController();
        const activeSignal = signal ?? controller!.signal;
        timeout = setTimeout(() => controller?.abort(), 8_000);
        const params = new URLSearchParams();
        params.set("includeArchived", "true");
        if (includeWorkerTasks) params.set("includeWorkerTasks", "true");
        const url = `${API_BASE}/projects${params.size > 0 ? `?${params.toString()}` : ""}`;
        const res = await fetchLocalApi(url, { signal: activeSignal }, 8_000);
        if (!res.ok) return;
        const data = await res.json();
        setProjects(filterByLane(data.projects || []));
      } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          console.error("[useTasks] Error fetching projects:", err);
        }
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    },
    [filterByLane, includeWorkerTasks],
  );

  // Fetch all tasks + projects from API
  const refreshTasks = useCallback(async () => {
    if (refreshInFlightRef.current) {
      return;
    }
    refreshInFlightRef.current = true;
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const params = new URLSearchParams();
      if (includeWorkerTasks) params.set("includeWorkerTasks", "true");
      const url = `${API_BASE}/tasks${params.size > 0 ? `?${params.toString()}` : ""}`;
      const res = await fetchLocalApi(url, { signal: controller.signal }, 10_000);
      if (!res.ok) throw new Error("Failed to fetch tasks");
      const data = await res.json();
      // Convert date strings back to Date objects
      const tasksWithDates = data.tasks.map((t: any) => ({
        ...t,
        createdAt: new Date(t.createdAt),
        completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
        startedAt: t.startedAt ? new Date(t.startedAt) : undefined,
        dueAt: t.dueAt ? new Date(t.dueAt) : undefined,
      }));
      setTasks(filterByLane(tasksWithDates));
      setError(null);
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        console.error("[useTasks] Error fetching tasks:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch tasks");
      }
    } finally {
      clearTimeout(timeout);
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
      }
      refreshInFlightRef.current = false;
      setLoading(false);
    }
    // Also refresh projects
    void fetchProjectsInternal(controller.signal);
  }, [fetchProjectsInternal, filterByLane, includeWorkerTasks]);

  // Initial fetch + polling + SSE listener
  useEffect(() => {
    if (!enabled) {
      refreshAbortRef.current?.abort();
      refreshAbortRef.current = null;
      refreshInFlightRef.current = false;
      setLoading(false);
      return;
    }
    refreshTasks();

    // SSE listener for real-time task events
    const eventSource = new EventSource(`${API_BASE}/tasks/events`);
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (
          data.type === "task_created" ||
          data.type === "task_updated" ||
          data.type === "task_deleted"
        ) {
          refreshTasks();
        }
      } catch {
        // ignore parse errors
      }
    };

    // Fallback polling every 15 seconds (in case SSE disconnects)
    const interval = setInterval(() => {
      refreshTasks();
    }, pollMs);

    return () => {
      eventSource.close();
      clearInterval(interval);
      refreshAbortRef.current?.abort();
      refreshAbortRef.current = null;
      refreshInFlightRef.current = false;
    };
  }, [enabled, pollMs, refreshTasks]);

  // Add a new task
  const addTask = useCallback(
    async (
      title: string,
      type: TaskType = "one-time",
      schedule?: Task["schedule"],
      details?: string,
      assignee?: string,
    ): Promise<Task | null> => {
      try {
        const res = await fetchLocalApi(`${API_BASE}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, type, schedule, details, assignee }),
        });
        if (!res.ok) throw new Error("Failed to create task");
        const data = await res.json();
        const newTask = {
          ...data.task,
          createdAt: new Date(data.task.createdAt),
          dueAt: data.task.dueAt ? new Date(data.task.dueAt) : undefined,
        };
        if (!workerOnly || isWorkerLaneTask(newTask)) {
          setTasks((prev) => [newTask, ...prev]);
        }
        return newTask;
      } catch (err) {
        console.error("[useTasks] Error creating task:", err);
        setError(err instanceof Error ? err.message : "Failed to create task");
        return null;
      }
    },
    [isWorkerLaneTask, workerOnly],
  );

  // Add a child task to a project
  const addProjectTask = useCallback(
    async (
      projectId: string,
      title: string,
      details?: string,
      priority = "normal",
    ): Promise<Task | null> => {
      try {
        const res = await fetchLocalApi(`${API_BASE}/projects/${projectId}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, details, priority }),
        });
        if (!res.ok) throw new Error("Failed to create project task");
        const data = await res.json();
        const newTask = {
          ...data.task,
          createdAt: new Date(data.task.createdAt),
          dueAt: data.task.dueAt ? new Date(data.task.dueAt) : undefined,
        };
        if (!workerOnly || isWorkerLaneTask(newTask)) {
          setTasks((prev) => [newTask, ...prev]);
        }
        void fetchProjectsInternal();
        return newTask;
      } catch (err) {
        console.error("[useTasks] Error creating project task:", err);
        setError(err instanceof Error ? err.message : "Failed to create project task");
        return null;
      }
    },
    [fetchProjectsInternal, isWorkerLaneTask, workerOnly],
  );

  // Update a task
  const updateTask = useCallback(
    async (taskId: string, updates: Partial<Task>): Promise<Task | null> => {
      try {
        const res = await fetchLocalApi(`${API_BASE}/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error("Failed to update task");
        const data = await res.json();
        const updatedTask = {
          ...data.task,
          createdAt: new Date(data.task.createdAt),
          startedAt: data.task.startedAt ? new Date(data.task.startedAt) : undefined,
          completedAt: data.task.completedAt ? new Date(data.task.completedAt) : undefined,
          dueAt: data.task.dueAt ? new Date(data.task.dueAt) : undefined,
        };
        setTasks((prev) =>
          prev.flatMap((t) => {
            if (t.id !== taskId) return [t];
            if (workerOnly && !isWorkerLaneTask(updatedTask)) return [];
            return [updatedTask];
          }),
        );
        return updatedTask;
      } catch (err) {
        console.error("[useTasks] Error updating task:", err);
        setError(err instanceof Error ? err.message : "Failed to update task");
        return null;
      }
    },
    [isWorkerLaneTask, workerOnly],
  );

  // Delete a task
  const deleteTask = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      const res = await fetchLocalApi(`${API_BASE}/tasks/${taskId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete task");
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      return true;
    } catch (err) {
      console.error("[useTasks] Error deleting task:", err);
      setError(err instanceof Error ? err.message : "Failed to delete task");
      return false;
    }
  }, []);

  // Delete a project and all child tasks
  const deleteProject = useCallback(async (projectId: string): Promise<boolean> => {
    try {
      const res = await fetchLocalApi(`${API_BASE}/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete project");
      setTasks((prev) => prev.filter((t) => t.id !== projectId && t.parentTaskId !== projectId));
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      return true;
    } catch (err) {
      console.error("[useTasks] Error deleting project:", err);
      setError(err instanceof Error ? err.message : "Failed to delete project");
      return false;
    }
  }, []);

  const archiveProject = useCallback(
    async (projectId: string, archived: boolean): Promise<boolean> => {
      try {
        const res = await fetchLocalApi(`${API_BASE}/projects/${projectId}/archive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
        });
        if (!res.ok) throw new Error("Failed to update project archive state");
        const data = await res.json();
        const updatedProject = data.project;
        if (updatedProject) {
          setProjects((prev) =>
            prev.map((project) =>
              project.id === projectId ? { ...project, ...updatedProject } : project,
            ),
          );
        }
        return true;
      } catch (err) {
        console.error("[useTasks] Error updating project archive state:", err);
        setError(err instanceof Error ? err.message : "Failed to update project archive state");
        return false;
      }
    },
    [],
  );

  // Start a task (set to in-progress)
  const startTask = useCallback(async (taskId: string): Promise<Task | null> => {
    try {
      const res = await fetchLocalApi(`${API_BASE}/tasks/${taskId}/start`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to start task");
      const data = await res.json();
      const updatedTask = {
        ...data.task,
        createdAt: new Date(data.task.createdAt),
        startedAt: data.task.startedAt ? new Date(data.task.startedAt) : undefined,
        dueAt: data.task.dueAt ? new Date(data.task.dueAt) : undefined,
      };
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updatedTask : t)));
      return updatedTask;
    } catch (err) {
      console.error("[useTasks] Error starting task:", err);
      setError(err instanceof Error ? err.message : "Failed to start task");
      return null;
    }
  }, []);

  // Complete a task
  const completeTask = useCallback(async (taskId: string): Promise<Task | null> => {
    try {
      const res = await fetchLocalApi(`${API_BASE}/tasks/${taskId}/complete`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to complete task");
      const data = await res.json();
      const updatedTask = {
        ...data.task,
        createdAt: new Date(data.task.createdAt),
        completedAt: data.task.completedAt ? new Date(data.task.completedAt) : undefined,
        dueAt: data.task.dueAt ? new Date(data.task.dueAt) : undefined,
      };
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updatedTask : t)));
      return updatedTask;
    } catch (err) {
      console.error("[useTasks] Error completing task:", err);
      setError(err instanceof Error ? err.message : "Failed to complete task");
      return null;
    }
  }, []);

  // Start a task by title (for [TASK_START:title] markers)
  // Fetches fresh task list from API to avoid stale closure / race condition
  const startTaskByTitle = useCallback(
    async (title: string): Promise<Task | null> => {
      try {
        const params = new URLSearchParams();
        if (includeWorkerTasks) params.set("includeWorkerTasks", "true");
        const url = `${API_BASE}/tasks${params.size > 0 ? `?${params.toString()}` : ""}`;
        const res = await fetchLocalApi(url);
        if (!res.ok) return null;
        const data = await res.json();
        const freshTasks: Task[] = filterByLane(data.tasks || []);
        const task = freshTasks.find((t) => t.title === title && t.status === "pending");
        if (task) {
          return startTask(task.id);
        }
      } catch (err) {
        console.error("[useTasks] Error in startTaskByTitle:", err);
      }
      return null;
    },
    [filterByLane, includeWorkerTasks, startTask],
  );

  // Complete a task by title (for [TASK_DONE:title] markers)
  // Fetches fresh task list from API to avoid stale closure / race condition
  const completeTaskByTitle = useCallback(
    async (title: string): Promise<Task | null> => {
      try {
        const params = new URLSearchParams();
        if (includeWorkerTasks) params.set("includeWorkerTasks", "true");
        const url = `${API_BASE}/tasks${params.size > 0 ? `?${params.toString()}` : ""}`;
        const res = await fetchLocalApi(url);
        if (!res.ok) return null;
        const data = await res.json();
        const freshTasks: Task[] = filterByLane(data.tasks || []);
        const task = freshTasks.find((t) => t.title === title && t.status !== "completed");
        if (task) {
          return completeTask(task.id);
        }
      } catch (err) {
        console.error("[useTasks] Error in completeTaskByTitle:", err);
      }
      return null;
    },
    [completeTask, filterByLane, includeWorkerTasks],
  );

  return {
    tasks,
    projects,
    loading,
    error,
    addTask,
    addProjectTask,
    updateTask,
    deleteTask,
    deleteProject,
    archiveProject,
    startTask,
    completeTask,
    startTaskByTitle,
    completeTaskByTitle,
    refreshTasks,
  };
}
