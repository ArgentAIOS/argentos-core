/**
 * Heartbeat Contract System
 *
 * Parses HEARTBEAT.md structured task sections into machine-readable contracts.
 * The agent writes HEARTBEAT.md in a structured markdown format.
 * This parser converts it to JSON that the heartbeat runner + verification sidecar use.
 *
 * HEARTBEAT.md task format (inside a ## Tasks section):
 *   - [ ] task_id | Description of the task | required | verify: verification_hint
 *   - [x] task_id | Already completed task | optional | verify: some_check
 *
 * The parser also supports a freeform section (everything outside ## Tasks)
 * which is passed through as the heartbeat prompt context.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("heartbeat/contract");

// ── Types ──────────────────────────────────────────────────────────────────

export interface HeartbeatTask {
  /** Unique task identifier (slug from markdown) */
  id: string;
  /** Human-readable description of what to do */
  action: string;
  /** Whether this task must be completed each heartbeat cycle */
  required: boolean;
  /** Hint for the verification sidecar on how to check completion */
  verification: string;
  /** Maximum retry attempts before giving up (default: 3) */
  maxAttempts: number;
  /** Whether the agent marked this as already done in the markdown (checked checkbox) */
  markedDone: boolean;
}

export interface HeartbeatContract {
  /** Structured tasks parsed from ## Tasks section */
  tasks: HeartbeatTask[];
  /** Freeform context (everything outside ## Tasks) — passed as prompt context */
  context: string;
  /** Raw source file path */
  sourcePath: string;
  /** Timestamp when contract was parsed */
  parsedAt: number;
}

export interface HeartbeatTaskProgress {
  /** Task ID */
  taskId: string;
  /** Current status */
  status: "pending" | "verified" | "failed" | "skipped";
  /** Number of attempts so far */
  attempts: number;
  /** Last attempt timestamp */
  lastAttemptAt?: number;
  /** Verification result from last attempt */
  lastResult?: string;
}

export interface HeartbeatProgress {
  /** Timestamp of last heartbeat cycle */
  lastCycleAt: number;
  /** Per-task progress */
  tasks: Record<string, HeartbeatTaskProgress>;
  /** Number of consecutive cycles completed */
  cycleCount: number;
}

// ── Parser ─────────────────────────────────────────────────────────────────

/**
 * Task line regex:
 * - [ ] task_id | Description | required/optional | verify: hint
 * - [x] task_id | Description | required/optional | verify: hint
 *
 * Supports:
 * - Checkbox state: [ ] or [x] or [X]
 * - Pipe-delimited fields
 * - Optional "verify:" prefix on last field
 * - Optional "max_attempts: N" inline
 */
const TASK_LINE_RE = /^[-*+]\s*\[([xX ])\]\s*(.+)$/;

function parseTaskLine(line: string): HeartbeatTask | null {
  const match = TASK_LINE_RE.exec(line.trim());
  if (!match) return null;

  const checked = match[1] !== " ";
  const rest = match[2].trim();

  // Split by pipe
  const parts = rest.split("|").map((p) => p.trim());
  if (parts.length < 2) return null;

  const id = parts[0].replace(/\s+/g, "_").toLowerCase();
  const action = parts[1];
  const flags = parts.slice(2).join(" ").toLowerCase();

  const required = !flags.includes("optional");
  const verifyMatch = /verify:\s*(.+)/i.exec(parts.slice(2).join("|"));
  const verification = verifyMatch ? verifyMatch[1].trim() : "task_completed";

  const maxAttemptsMatch = /max_attempts:\s*(\d+)/i.exec(flags);
  const maxAttempts = maxAttemptsMatch ? parseInt(maxAttemptsMatch[1], 10) : 3;

  return {
    id,
    action,
    required,
    verification,
    maxAttempts,
    markedDone: checked,
  };
}

/**
 * Parse HEARTBEAT.md content into a HeartbeatContract.
 * Extracts structured tasks from ## Tasks section.
 * Everything else is preserved as freeform context.
 */
export function parseHeartbeatContract(content: string, sourcePath: string): HeartbeatContract {
  const lines = content.split("\n");
  const tasks: HeartbeatTask[] = [];
  const contextLines: string[] = [];
  let inTasksSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section headers
    if (/^##\s+Tasks\b/i.test(trimmed)) {
      inTasksSection = true;
      continue;
    }
    if (/^##\s+/.test(trimmed) && inTasksSection) {
      // Left the Tasks section
      inTasksSection = false;
    }

    if (inTasksSection) {
      const task = parseTaskLine(trimmed);
      if (task) {
        tasks.push(task);
      }
      // Skip non-task lines in the Tasks section (blank lines, comments)
      continue;
    }

    contextLines.push(line);
  }

  return {
    tasks,
    context: contextLines.join("\n").trim(),
    sourcePath,
    parsedAt: Date.now(),
  };
}

// ── Progress Persistence ───────────────────────────────────────────────────

const PROGRESS_FILENAME = "heartbeat-progress.json";

function resolveProgressPath(workspaceDir: string): string {
  return path.join(workspaceDir, "memory", PROGRESS_FILENAME);
}

export async function loadProgress(workspaceDir: string): Promise<HeartbeatProgress> {
  const progressPath = resolveProgressPath(workspaceDir);
  try {
    const raw = await fs.readFile(progressPath, "utf-8");
    return JSON.parse(raw) as HeartbeatProgress;
  } catch {
    return { lastCycleAt: 0, tasks: {}, cycleCount: 0 };
  }
}

export async function saveProgress(
  workspaceDir: string,
  progress: HeartbeatProgress,
): Promise<void> {
  const progressPath = resolveProgressPath(workspaceDir);
  // Ensure directory exists
  await fs.mkdir(path.dirname(progressPath), { recursive: true });
  await fs.writeFile(progressPath, JSON.stringify(progress, null, 2), "utf-8");
}

/**
 * Initialize progress for a new heartbeat cycle.
 * Carries over failed task state from previous cycle.
 * Resets verified/skipped tasks to pending.
 */
export function initCycleProgress(
  contract: HeartbeatContract,
  previous: HeartbeatProgress,
): HeartbeatProgress {
  const tasks: Record<string, HeartbeatTaskProgress> = {};

  for (const task of contract.tasks) {
    const prev = previous.tasks[task.id];

    if (task.markedDone) {
      // Agent checked it off in markdown — start as verified
      tasks[task.id] = {
        taskId: task.id,
        status: "verified",
        attempts: 0,
      };
      continue;
    }

    if (prev && prev.status === "failed" && prev.attempts >= task.maxAttempts) {
      // Exceeded max attempts in previous cycle — keep as failed
      tasks[task.id] = { ...prev };
      continue;
    }

    // Fresh start for this cycle
    tasks[task.id] = {
      taskId: task.id,
      status: "pending",
      attempts: prev?.status === "failed" ? prev.attempts : 0,
      lastResult: prev?.lastResult,
    };
  }

  return {
    lastCycleAt: Date.now(),
    tasks,
    cycleCount: previous.cycleCount + 1,
  };
}

/**
 * Get tasks that still need work in the current cycle.
 */
export function getPendingTasks(
  contract: HeartbeatContract,
  progress: HeartbeatProgress,
): HeartbeatTask[] {
  return contract.tasks.filter((task) => {
    const tp = progress.tasks[task.id];
    if (!tp) return true;
    return tp.status === "pending";
  });
}

/**
 * Get tasks that failed verification and can be retried.
 */
export function getRetryableTasks(
  contract: HeartbeatContract,
  progress: HeartbeatProgress,
): HeartbeatTask[] {
  return contract.tasks.filter((task) => {
    const tp = progress.tasks[task.id];
    if (!tp || tp.status !== "failed") return false;
    return tp.attempts < task.maxAttempts;
  });
}

/**
 * Build a prompt supplement that injects contract state into the heartbeat prompt.
 * This tells the agent what tasks are pending and what failed previously.
 */
export function buildContractPromptSupplement(
  contract: HeartbeatContract,
  progress: HeartbeatProgress,
): string {
  const pending = getPendingTasks(contract, progress);
  const retryable = getRetryableTasks(contract, progress);

  if (pending.length === 0 && retryable.length === 0) {
    return "";
  }

  const lines: string[] = [];

  if (pending.length > 0) {
    lines.push("## Heartbeat Tasks (pending)");
    for (const task of pending) {
      const req = task.required ? "REQUIRED" : "optional";
      lines.push(`- ${task.id}: ${task.action} [${req}]`);
    }
  }

  if (retryable.length > 0) {
    lines.push("", "## Heartbeat Tasks (retry — previous attempt failed)");
    for (const task of retryable) {
      const tp = progress.tasks[task.id];
      const feedback = tp?.lastResult ? ` — Feedback: ${tp.lastResult}` : "";
      lines.push(
        `- ${task.id}: ${task.action} [attempt ${(tp?.attempts ?? 0) + 1}/${task.maxAttempts}]${feedback}`,
      );
    }
  }

  lines.push(
    "",
    "Complete each task and provide evidence of completion in your response.",
    "The verification system will check your work.",
  );

  return lines.join("\n");
}

// ── Contract Loading ───────────────────────────────────────────────────────

/**
 * Load and parse the heartbeat contract from HEARTBEAT.md.
 * Returns null if the file doesn't exist or has no tasks section.
 */
export async function loadHeartbeatContract(
  heartbeatFilePath: string,
): Promise<HeartbeatContract | null> {
  try {
    const content = await fs.readFile(heartbeatFilePath, "utf-8");
    const contract = parseHeartbeatContract(content, heartbeatFilePath);

    if (contract.tasks.length === 0) {
      log.debug("heartbeat contract: no tasks found in HEARTBEAT.md");
      return null;
    }

    log.info("heartbeat contract: parsed", {
      taskCount: contract.tasks.length,
      requiredCount: contract.tasks.filter((t) => t.required).length,
    });

    return contract;
  } catch {
    return null;
  }
}
