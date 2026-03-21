/**
 * Argent Agent Events
 *
 * AgentEvent is a superset of StreamEvent that includes loop lifecycle
 * events (tool execution, loop iterations, lesson injection).
 *
 * Built for Argent Core - February 16, 2026
 */

import type { StreamEvent, ToolCall } from "../argent-ai/types.js";

// ============================================================================
// Agent Event Types
// ============================================================================

export type ToolStartEvent = {
  type: "tool_start";
  toolCall: ToolCall;
};

export type ToolEndEvent = {
  type: "tool_end";
  toolCall: ToolCall;
  result: string;
  isError: boolean;
};

export type LoopStartEvent = {
  type: "loop_start";
  iteration: number;
};

export type LoopEndEvent = {
  type: "loop_end";
  iterations: number;
  stopReason: string;
};

export type LessonInjectedEvent = {
  type: "lesson_injected";
  lessons: Array<{ id: number; text: string; confidence: number }>;
};

/**
 * All events emitted by the agent loop.
 * Superset of StreamEvent with lifecycle and tool events.
 */
export type AgentEvent =
  | StreamEvent
  | ToolStartEvent
  | ToolEndEvent
  | LoopStartEvent
  | LoopEndEvent
  | LessonInjectedEvent;

// ============================================================================
// Type Guards
// ============================================================================

/** Stream event types from the provider */
const STREAM_EVENT_TYPES = new Set([
  "start",
  "text_start",
  "text_delta",
  "text_end",
  "thinking_start",
  "thinking_delta",
  "thinking_end",
  "tool_call_start",
  "tool_call_delta",
  "tool_call_end",
  "done",
  "error",
]);

/**
 * Check if an event is a base StreamEvent from the provider.
 */
export function isStreamEvent(event: AgentEvent): event is StreamEvent {
  return STREAM_EVENT_TYPES.has(event.type);
}

/**
 * Check if an event is a tool execution event (start or end).
 */
export function isToolEvent(event: AgentEvent): event is ToolStartEvent | ToolEndEvent {
  return event.type === "tool_start" || event.type === "tool_end";
}

/**
 * Check if an event is a loop lifecycle event (start or end).
 */
export function isLoopEvent(event: AgentEvent): event is LoopStartEvent | LoopEndEvent {
  return event.type === "loop_start" || event.type === "loop_end";
}
