/**
 * Tool Loop Detection Wrapper
 *
 * Wraps agent tools with loop detection, following the same pattern as
 * wrapToolWithBeforeToolCallHook in pi-tools.before-tool-call.ts.
 *
 * @module agents/pi-tools.loop-detect
 */

import type { AnyAgentTool } from "./pi-tools.types.js";
import type { LoopAction, ToolLoopDetector } from "./tool-loop-detector.js";

export const TOOL_LOOP_BUDGET_MARKER = "[tool-loop-budget]";

function formatLoopAbortResult(result: Extract<LoopAction, { action: "abort" }>): string {
  return [
    TOOL_LOOP_BUDGET_MARKER,
    `Tool "${result.toolName}" hit its per-turn budget after ${result.count} calls.`,
    "Do not call this tool again in this turn.",
    "Summarize what you have so far and present findings using the information already gathered.",
  ].join(" ");
}

export function wrapToolWithLoopDetection(
  tool: AnyAgentTool,
  detector: ToolLoopDetector,
  options?: { onLoopDetected?: (event: LoopAction) => void },
): AnyAgentTool {
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }
  const toolName = tool.name || "tool";
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const result = detector.check(toolName, params);

      if (result.action === "abort") {
        options?.onLoopDetected?.(result);
        // Return an internal loop-stop result instead of surfacing a hard tool failure.
        // This keeps the instruction in the model's tool context and avoids noisy user-facing
        // "tool failed" payloads for an intentional guardrail.
        return formatLoopAbortResult(result);
      }

      if (result.action === "delay") {
        options?.onLoopDetected?.(result);
        // Return a warning message as the tool result instead of executing
        return `WARNING: Tool "${result.toolName}" called ${result.count} times with identical arguments. Try a different approach or different arguments. (backoff: ${result.delayMs}ms)`;
      }

      return await execute(toolCallId, params, signal, onUpdate);
    },
  };
}
