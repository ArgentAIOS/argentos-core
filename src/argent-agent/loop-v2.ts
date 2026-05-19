/**
 * Argent Agent Loop v2
 *
 * Enhanced agent loop with ToolExecutor integration:
 *   - Steering messages injected per-iteration
 *   - Follow-up handling (continuation, message injection, confirmation)
 *   - Abort signal propagation for graceful shutdown
 *   - Parallel tool execution for independent calls
 *   - Execution events for full observability
 *
 * The v1 loop (loop.ts) is preserved for simple use cases.
 * This v2 loop uses the production ToolExecutor.
 *
 * Built for Argent Core — March 5, 2026
 */

import type {
  Provider,
  TurnRequest,
  TurnResponse,
  ModelConfig,
  ToolCall,
} from "../argent-ai/types.js";
import type { AgentEvent } from "./events.js";
import type {
  ToolExecutor,
  ToolResult,
  ToolFollowUp,
  ToolExecutionEvent,
} from "./tool-executor.js";
import type { ToolRegistry } from "./tools.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Message in the agent loop's conversation history.
 */
export interface LoopMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  text?: string;
}

/**
 * Configuration for the enhanced agent loop.
 */
export interface LoopV2Config {
  /** LLM provider */
  provider: Provider;

  /** Model configuration */
  model: ModelConfig;

  /** System prompt */
  systemPrompt: string;

  /** Initial conversation messages */
  messages: LoopMessage[];

  /** Tool executor (production) or basic registry (simple) */
  toolExecutor?: ToolExecutor;

  /** Fallback: basic tool registry (used if no toolExecutor) */
  tools?: ToolRegistry;

  /** Maximum loop iterations before forced stop (default: 10) */
  maxIterations?: number;

  /**
   * Inject steering messages before each iteration.
   * Useful for heartbeat, SIS lessons, or runtime injections.
   */
  getSteeringMessages?: () => Array<{ role: "user"; content: string }>;

  /** Abort signal for the entire loop */
  signal?: AbortSignal;

  /** Agent ID for context */
  agentId?: string;

  /** Whether to execute independent tool calls in parallel (default: true) */
  parallelTools?: boolean;

  /** Callback for tool execution events (bridged from ToolExecutor) */
  onToolEvent?: (event: ToolExecutionEvent) => void;
}

// ============================================================================
// Enhanced Agent Event Types
// ============================================================================

export type LoopV2Event =
  | AgentEvent
  | { type: "tool_followup"; toolCallId: string; followUp: ToolFollowUp }
  | { type: "tool_batch_start"; count: number; parallel: boolean }
  | { type: "tool_batch_end"; count: number; results: ToolResult[] }
  | { type: "loop_abort"; reason: string; iteration: number }
  | { type: "steering_injected"; count: number };

// ============================================================================
// Enhanced Agent Loop
// ============================================================================

/**
 * Enhanced agent loop with ToolExecutor integration.
 *
 * Features over v1:
 *   - ToolExecutor with policies, hooks, timeouts, retries
 *   - Follow-up handling (inject messages, request confirmations)
 *   - AbortSignal propagation for graceful shutdown
 *   - Parallel tool execution for independent calls
 *   - Steering message injection per-iteration
 */
export async function* agentLoopV2(config: LoopV2Config): AsyncGenerator<LoopV2Event> {
  const messages: LoopMessage[] = [...config.messages];
  const maxIterations = config.maxIterations ?? 10;
  const parallel = config.parallelTools !== false;
  let iteration = 0;
  let finalResponse: TurnResponse | null = null;
  let pendingFollowUps: ToolFollowUp[] = [];

  while (iteration < maxIterations) {
    iteration++;

    // ── Check abort ──
    if (config.signal?.aborted) {
      yield { type: "loop_abort", reason: "Signal aborted", iteration };
      break;
    }

    yield { type: "loop_start", iteration };

    // ── Inject steering messages ──
    const steering = config.getSteeringMessages?.() ?? [];
    if (steering.length > 0) {
      for (const msg of steering) {
        messages.push(msg);
      }
      yield { type: "steering_injected", count: steering.length };
    }

    // ── Inject follow-up messages from previous tool executions ──
    for (const followUp of pendingFollowUps) {
      if (followUp.type === "inject_message" && followUp.message) {
        messages.push({
          role: (followUp.role ?? "user") as "user" | "assistant",
          content: followUp.message,
        });
      }
      if (followUp.type === "request_confirmation" && followUp.confirmationPrompt) {
        messages.push({
          role: "user",
          content: `[CONFIRMATION REQUIRED] ${followUp.confirmationPrompt}`,
        });
      }
    }
    pendingFollowUps = [];

    // ── Build the turn request ──
    const request: TurnRequest = {
      systemPrompt: config.systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
        text: m.text,
      })),
      tools: getToolDefs(config),
    };

    // ── Stream from provider ──
    finalResponse = null;

    try {
      for await (const event of config.provider.stream(request, config.model)) {
        // Check abort mid-stream
        if (config.signal?.aborted) {
          yield { type: "loop_abort", reason: "Signal aborted during stream", iteration };
          return;
        }

        yield event;

        if (event.type === "done") {
          finalResponse = event.response;
        }
        if (event.type === "error") {
          finalResponse = event.error;
        }
      }
    } catch (error) {
      if (config.signal?.aborted) {
        yield { type: "loop_abort", reason: "Signal aborted (caught)", iteration };
        return;
      }
      throw error;
    }

    // If no response, bail
    if (!finalResponse) break;

    // ── Append assistant message to history ──
    messages.push({
      role: "assistant",
      content: finalResponse.text,
      toolCalls: finalResponse.toolCalls.length > 0 ? finalResponse.toolCalls : undefined,
      text: finalResponse.text,
    });

    // ── If no tool calls, done ──
    if (finalResponse.stopReason !== "tool_use" || finalResponse.toolCalls.length === 0) {
      break;
    }

    // ── Execute tool calls ──
    const toolCalls = finalResponse.toolCalls;

    if (config.toolExecutor) {
      // Production path: ToolExecutor with full lifecycle
      yield { type: "tool_batch_start", count: toolCalls.length, parallel };

      const results = await config.toolExecutor.executeBatch(toolCalls, {
        iteration,
        agentId: config.agentId,
        signal: config.signal,
        parallel,
      });

      yield { type: "tool_batch_end", count: toolCalls.length, results };

      // Process results + follow-ups
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        const result = results[i];

        yield { type: "tool_start", toolCall: tc };
        yield { type: "tool_end", toolCall: tc, result: result.content, isError: result.isError };

        // Append tool result to history
        messages.push({
          role: "tool",
          content: result.content,
          toolCallId: tc.id,
        });

        // Collect follow-ups
        if (result.followUp) {
          pendingFollowUps.push(result.followUp);
          yield { type: "tool_followup", toolCallId: tc.id, followUp: result.followUp };
        }
      }
    } else if (config.tools) {
      // Simple path: basic ToolRegistry (v1 compat)
      for (const tc of toolCalls) {
        if (config.signal?.aborted) {
          yield { type: "loop_abort", reason: "Signal aborted during tool execution", iteration };
          return;
        }

        yield { type: "tool_start", toolCall: tc };

        const tool = config.tools.get(tc.name);
        let result: string;
        let isError: boolean;

        if (!tool) {
          result = `Error: Tool "${tc.name}" not found`;
          isError = true;
        } else {
          try {
            result = await tool.handler(tc.arguments);
            isError = false;
          } catch (error) {
            result = `Error: ${error instanceof Error ? error.message : String(error)}`;
            isError = true;
          }
        }

        yield { type: "tool_end", toolCall: tc, result, isError };

        messages.push({
          role: "tool",
          content: result,
          toolCallId: tc.id,
        });
      }
    } else {
      // No tools at all — can't execute
      break;
    }

    // ── Check if follow-ups extend the iteration budget ──
    const hasFollowUps = pendingFollowUps.some(
      (f) => f.type === "continue" || f.type === "inject_message",
    );
    if (hasFollowUps) {
      // Follow-ups get extra iterations (up to the maxIterations cap)
      const extraIterations = Math.max(...pendingFollowUps.map((f) => f.maxIterations ?? 2));
      // Don't exceed original maxIterations
      const remaining = maxIterations - iteration;
      if (remaining < extraIterations) {
        // Allow follow-ups but don't exceed cap
      }
    }
  }

  yield {
    type: "loop_end",
    iterations: iteration,
    stopReason: finalResponse?.stopReason ?? "unknown",
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get tool definitions from either ToolExecutor's registry or basic ToolRegistry.
 */
function getToolDefs(
  config: LoopV2Config,
): Array<{ name: string; description: string; parameters: Record<string, unknown> }> | undefined {
  if (config.toolExecutor) {
    return config.toolExecutor.getToolDefs();
  }
  if (config.tools) {
    return config.tools.toToolDefs();
  }
  return undefined;
}
