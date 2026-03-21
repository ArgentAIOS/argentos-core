import { diagnosticLogger as diag, logLaneDequeue, logLaneEnqueue } from "../logging/diagnostic.js";
import { CommandLane } from "./lanes.js";

// Minimal in-process queue to serialize command executions.
// Default lane ("main") preserves the existing behavior. Additional lanes allow
// low-risk parallelism (e.g. cron jobs) without interleaving stdin / logs for
// the main auto-reply workflow.

type QueueEntry = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: number;
  warnAfterMs: number;
  priority?: boolean;
  onWait?: (waitMs: number, queuedAhead: number) => void;
};

type LaneState = {
  lane: string;
  queue: QueueEntry[];
  active: number;
  maxConcurrent: number;
  draining: boolean;
  /** When set, pause draining when the named lane has queued or active items. */
  yieldsTo?: string;
  /** Lanes to kick (call drainLane) when a task on this lane completes. */
  resumesLanes?: string[];
};

const lanes = new Map<string, LaneState>();

function getLaneState(lane: string): LaneState {
  const existing = lanes.get(lane);
  if (existing) {
    return existing;
  }
  const created: LaneState = {
    lane,
    queue: [],
    active: 0,
    maxConcurrent: 1,
    draining: false,
  };
  lanes.set(lane, created);
  return created;
}

function drainLane(lane: string) {
  const state = getLaneState(lane);
  if (state.draining) {
    return;
  }
  state.draining = true;

  const pump = () => {
    // Yield to higher-priority lane: pause when it has queued or active items.
    if (state.yieldsTo) {
      const primary = lanes.get(state.yieldsTo);
      if (primary && (primary.queue.length > 0 || primary.active > 0)) {
        state.draining = false;
        return;
      }
    }
    while (state.active < state.maxConcurrent && state.queue.length > 0) {
      const entry = state.queue.shift() as QueueEntry;
      const waitedMs = Date.now() - entry.enqueuedAt;
      if (waitedMs >= entry.warnAfterMs) {
        entry.onWait?.(waitedMs, state.queue.length);
        diag.warn(
          `lane wait exceeded: lane=${lane} waitedMs=${waitedMs} queueAhead=${state.queue.length}`,
        );
      }
      logLaneDequeue(lane, waitedMs, state.queue.length);
      state.active += 1;
      void (async () => {
        const startTime = Date.now();
        try {
          const result = await entry.task();
          state.active -= 1;
          diag.debug(
            `lane task done: lane=${lane} durationMs=${Date.now() - startTime} active=${state.active} queued=${state.queue.length}`,
          );
          pump();
          resumeDependentLanes(state);
          entry.resolve(result);
        } catch (err) {
          state.active -= 1;
          const isProbeLane = lane.startsWith("auth-probe:") || lane.startsWith("session:probe-");
          if (!isProbeLane) {
            const stack = err instanceof Error ? err.stack : undefined;
            diag.error(
              `lane task error: lane=${lane} durationMs=${Date.now() - startTime} error="${String(err)}"${stack ? `\n${stack}` : ""}`,
            );
          }
          pump();
          resumeDependentLanes(state);
          entry.reject(err);
        }
      })();
    }
    state.draining = false;
  };

  pump();
}

export function setCommandLaneConcurrency(lane: string, maxConcurrent: number) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = getLaneState(cleaned);
  state.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  drainLane(cleaned);
}

export function enqueueCommandInLane<T>(
  lane: string,
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number;
    priority?: boolean;
    onWait?: (waitMs: number, queuedAhead: number) => void;
  },
): Promise<T> {
  const cleaned = lane.trim() || CommandLane.Main;
  const warnAfterMs = opts?.warnAfterMs ?? 2_000;
  const state = getLaneState(cleaned);
  return new Promise<T>((resolve, reject) => {
    const entry: QueueEntry = {
      task: () => task(),
      resolve: (value) => resolve(value as T),
      reject,
      enqueuedAt: Date.now(),
      warnAfterMs,
      priority: opts?.priority,
      onWait: opts?.onWait,
    };
    if (opts?.priority) {
      // Priority entries jump ahead of non-priority entries in the queue.
      // Find the first non-priority entry and insert before it.
      const idx = state.queue.findIndex((e) => !e.priority);
      if (idx === -1) {
        state.queue.push(entry);
      } else {
        state.queue.splice(idx, 0, entry);
      }
    } else {
      state.queue.push(entry);
    }
    logLaneEnqueue(cleaned, state.queue.length + state.active);
    drainLane(cleaned);
  });
}

export function enqueueCommand<T>(
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number;
    priority?: boolean;
    onWait?: (waitMs: number, queuedAhead: number) => void;
  },
): Promise<T> {
  return enqueueCommandInLane(CommandLane.Main, task, opts);
}

export function getQueueSize(lane: string = CommandLane.Main) {
  const resolved = lane.trim() || CommandLane.Main;
  const state = lanes.get(resolved);
  if (!state) {
    return 0;
  }
  return state.queue.length + state.active;
}

export function getTotalQueueSize() {
  let total = 0;
  for (const s of lanes.values()) {
    total += s.queue.length + s.active;
  }
  return total;
}

function resumeDependentLanes(state: LaneState) {
  if (state.resumesLanes) {
    for (const dep of state.resumesLanes) {
      drainLane(dep);
    }
  }
}

export function setLaneYieldsTo(lane: string, yieldsTo: string) {
  const state = getLaneState(lane);
  state.yieldsTo = yieldsTo;
}

export function setLaneResumes(lane: string, resumesLanes: string[]) {
  const state = getLaneState(lane);
  state.resumesLanes = resumesLanes;
}

export function clearCommandLane(lane: string = CommandLane.Main) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = lanes.get(cleaned);
  if (!state) {
    return 0;
  }
  const removed = state.queue.length;
  state.queue.length = 0;
  return removed;
}
