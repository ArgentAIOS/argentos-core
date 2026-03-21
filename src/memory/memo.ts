/**
 * ArgentOS Observation Capture Hooks
 *
 * Integrates observation capture into the agent runtime via internal hooks.
 * Captures tool results, session lifecycle, and other events for memory.
 */

import path from "node:path";
import { getMemoryAdapter } from "../data/storage-factory.js";
import {
  registerInternalHook,
  createInternalHookEvent,
  triggerInternalHook,
  type InternalHookEvent,
} from "../hooks/internal-hooks.js";
import { onAgentEvent, type AgentEventPayload } from "../infra/agent-events.js";
import { resolveUserPath } from "../utils.js";
import { queueExtraction } from "./extract/pipeline.js";
import {
  ensureObservationsSchema,
  getOrCreateSession,
  addObservation,
  endSession,
  type Observation,
} from "./memo-schema.js";
import { openDatabase, type DatabaseSync } from "./sqlite.js";

// Extend InternalHookEventType to include "tool"
declare module "../hooks/internal-hooks.js" {
  interface InternalHookEventTypeMap {
    tool: "result" | "error";
  }
}

export type ToolResultHookContext = {
  toolName: string;
  input: string;
  output: string;
  duration?: number;
  success?: boolean;
  workspaceDir?: string;
};

export type SessionLifecycleContext = {
  projectPath?: string;
  workspaceDir?: string;
  agentId?: string;
};

let _db: DatabaseSync | null = null;
let _dbPath: string | null = null;

/** Stashed config for extraction pipeline (set during registerObservationHooks) */
let _currentConfig: import("../config/config.js").ArgentConfig | undefined;

/**
 * Get or initialize the observations database
 */
function getObservationsDb(workspaceDir?: string): DatabaseSync | null {
  const stateDir = workspaceDir
    ? path.join(resolveUserPath(workspaceDir), ".argentos")
    : resolveUserPath("~/.argentos");

  const dbPath = path.join(stateDir, "observations.db");

  // Return cached db if same path
  if (_db && _dbPath === dbPath) {
    return _db;
  }

  try {
    // Ensure directory exists
    const fs = require("node:fs");
    fs.mkdirSync(stateDir, { recursive: true });

    const db = openDatabase(dbPath);
    ensureObservationsSchema({ db, ftsEnabled: true });

    _db = db;
    _dbPath = dbPath;
    return db;
  } catch (err) {
    console.error("Failed to initialize observations database:", err);
    return null;
  }
}

/**
 * Trigger a tool result event
 */
export function triggerToolResultHook(
  sessionKey: string,
  context: ToolResultHookContext,
): Promise<void> {
  const event = createInternalHookEvent("tool" as any, "result", sessionKey, context as any);
  return triggerInternalHook(event);
}

/**
 * Trigger a session start event
 */
export function triggerSessionStartHook(
  sessionKey: string,
  context: SessionLifecycleContext,
): Promise<void> {
  const event = createInternalHookEvent("session", "start", sessionKey, context as any);
  return triggerInternalHook(event);
}

/**
 * Trigger a session end event
 */
export function triggerSessionEndHook(
  sessionKey: string,
  context: SessionLifecycleContext & { summary?: string },
): Promise<void> {
  const event = createInternalHookEvent("session", "end", sessionKey, context as any);
  return triggerInternalHook(event);
}

/**
 * Calculate importance score for an observation
 */
function calculateImportance(context: ToolResultHookContext): number {
  let score = 5; // Base score

  // Errors are more important
  if (context.success === false) {
    score += 2;
  }

  // Long outputs often indicate significant work
  if (context.output && context.output.length > 1000) {
    score += 1;
  }

  // Certain tools are more important
  const highImportanceTools = ["Write", "Edit", "Bash", "WebSearch"];
  const lowImportanceTools = ["Read", "Glob", "Grep"];

  if (highImportanceTools.includes(context.toolName)) {
    score += 2;
  } else if (lowImportanceTools.includes(context.toolName)) {
    score -= 1;
  }

  return Math.max(1, Math.min(10, score));
}

/**
 * Summarize a tool result for storage
 */
function summarizeToolResult(context: ToolResultHookContext): string {
  const { toolName, input, output, success } = context;

  // Truncate for summary
  const inputSummary = input.length > 200 ? input.slice(0, 200) + "..." : input;
  const outputSummary = output.length > 200 ? output.slice(0, 200) + "..." : output;

  if (success === false) {
    return `${toolName} failed: ${outputSummary}`;
  }

  switch (toolName) {
    case "Read":
      return `Read file: ${inputSummary}`;
    case "Write":
      return `Wrote file: ${inputSummary}`;
    case "Edit":
      return `Edited file: ${inputSummary}`;
    case "Bash":
      return `Ran command: ${inputSummary}`;
    case "Grep":
      return `Searched for: ${inputSummary}`;
    case "Glob":
      return `Found files matching: ${inputSummary}`;
    case "WebSearch":
      return `Web search: ${inputSummary}`;
    default:
      return `${toolName}: ${inputSummary}`;
  }
}

// Track pending tool calls for matching start/result
const pendingToolCalls = new Map<string, { toolName: string; args: unknown; startTime: number }>();

/**
 * Register agent event listener for automatic observation capture
 * This hooks into the agent event system to capture all tool executions
 */
export function registerAgentEventObserver(): () => void {
  return onAgentEvent((evt: AgentEventPayload) => {
    // Only process tool events
    if (evt.stream !== "tool") return;

    const data = evt.data as {
      phase?: string;
      name?: string;
      toolCallId?: string;
      args?: unknown;
      result?: string;
      error?: string;
    };

    if (data.phase === "start" && data.toolCallId && data.name) {
      // Track tool start
      pendingToolCalls.set(data.toolCallId, {
        toolName: data.name,
        args: data.args,
        startTime: evt.ts,
      });
    } else if ((data.phase === "result" || data.phase === "error") && data.toolCallId) {
      // Tool completed - capture observation
      const pending = pendingToolCalls.get(data.toolCallId);
      if (!pending) return;

      pendingToolCalls.delete(data.toolCallId);

      const sessionKey = evt.sessionKey || evt.runId;
      const duration = evt.ts - pending.startTime;
      const isError = data.phase === "error" || !!data.error;

      // Get input as string
      const input =
        typeof pending.args === "string"
          ? pending.args
          : JSON.stringify(pending.args ?? {}, null, 2);

      // Get output as string
      const output = data.result || data.error || "";

      // Trigger the hook (async, non-blocking)
      void triggerToolResultHook(sessionKey, {
        toolName: pending.toolName,
        input: input.slice(0, 10000), // Limit size
        output: output.slice(0, 10000),
        duration,
        success: !isError,
      });
    }
  });
}

/**
 * Register observation capture hooks
 * Call this during application startup
 */
export function registerObservationHooks(
  config?: import("../config/config.js").ArgentConfig,
): void {
  _currentConfig = config;
  // Register agent event observer for automatic capture
  registerAgentEventObserver();
  // Handle tool results
  registerInternalHook("tool:result", async (event: InternalHookEvent) => {
    const context = event.context as ToolResultHookContext;
    const db = getObservationsDb(context.workspaceDir);
    if (!db) return;

    try {
      const session = getOrCreateSession(db, event.sessionKey, context.workspaceDir);

      addObservation(db, {
        sessionId: session.id,
        type: "tool_result",
        toolName: context.toolName,
        input: context.input,
        output: context.output,
        summary: summarizeToolResult(context),
        importance: calculateImportance(context),
      });
    } catch (err) {
      console.error("Failed to capture tool observation:", err);
    }

    // Also create a MemU Resource and queue for extraction.
    // Only extract from high-value tool results (skip Read/Glob/Grep noise).
    const extractionWorthy = calculateImportance(context) >= 5;
    if (extractionWorthy) {
      try {
        const store = await getMemoryAdapter();
        const summary = summarizeToolResult(context);
        const text = [
          `Tool: ${context.toolName}`,
          `Session: ${event.sessionKey}`,
          `Input: ${context.input.slice(0, 2000)}`,
          `Output: ${context.output.slice(0, 2000)}`,
          `Summary: ${summary}`,
        ].join("\n");

        const resource = await store.createResource({
          url: `session://${event.sessionKey}/tool/${context.toolName}`,
          modality: "text",
          caption: summary,
          text,
        });

        // Queue for async extraction (non-blocking background processing)
        // Only if we have a config available (needed for LLM calls)
        const cfg = _currentConfig;
        if (cfg) {
          queueExtraction({
            resourceId: resource.id,
            text,
            config: cfg,
          });
        }
      } catch (err) {
        // Non-blocking — don't let MemU failures break observation capture
        console.error("[MemU] Failed to create resource from tool result:", err);
      }
    }
  });

  // Handle session start
  registerInternalHook("session:start", async (event: InternalHookEvent) => {
    const context = event.context as SessionLifecycleContext;
    const db = getObservationsDb(context.workspaceDir);
    if (!db) return;

    try {
      getOrCreateSession(db, event.sessionKey, context.projectPath);
    } catch (err) {
      console.error("Failed to start session observation:", err);
    }
  });

  // Handle session end
  registerInternalHook("session:end", async (event: InternalHookEvent) => {
    const context = event.context as SessionLifecycleContext & { summary?: string };
    const db = getObservationsDb(context.workspaceDir);
    if (!db) return;

    try {
      endSession(db, event.sessionKey, context.summary);
    } catch (err) {
      console.error("Failed to end session observation:", err);
    }
  });
}

/**
 * Close the observations database connection
 */
export function closeObservationsDb(): void {
  if (_db) {
    try {
      (_db as any).close?.();
    } catch {
      // Ignore close errors
    }
    _db = null;
    _dbPath = null;
  }
}
