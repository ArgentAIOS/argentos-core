/**
 * Argent Agent Loop
 *
 * The core agentic loop that orchestrates provider calls, tool execution,
 * and message history management. Yields AgentEvents for full observability.
 *
 * Built for Argent Core - February 16, 2026
 */

import type {
  Provider,
  TurnRequest,
  TurnResponse,
  ModelConfig,
  ToolCall,
} from "../argent-ai/types.js";
import type { AgentEvent } from "./events.js";
import { ToolRegistry, executeToolCall } from "./tools.js";

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
 * Configuration for the agent loop.
 */
export interface LoopConfig {
  /** LLM provider */
  provider: Provider;

  /** Model configuration */
  model: ModelConfig;

  /** System prompt */
  systemPrompt: string;

  /** Initial conversation messages */
  messages: LoopMessage[];

  /** Tool registry (optional — no tools means single-turn) */
  tools?: ToolRegistry;

  /** Maximum loop iterations before forced stop (default: 10) */
  maxIterations?: number;

  /**
   * Optional callback to inject steering messages before each iteration.
   * Useful for heartbeat, SIS, or other runtime injections.
   */
  getSteeringMessages?: () => Array<{ role: "user"; content: string }>;
}

// ============================================================================
// Agent Loop
// ============================================================================

/**
 * The core agent loop. Streams provider events, executes tools, and
 * continues until the model stops calling tools or maxIterations is reached.
 *
 * Yields AgentEvents in real-time for full observability.
 */
export async function* agentLoop(config: LoopConfig): AsyncGenerator<AgentEvent> {
  const messages: LoopMessage[] = [...config.messages];
  const maxIterations = config.maxIterations ?? 10;
  let iteration = 0;
  let finalResponse: TurnResponse | null = null;

  while (iteration < maxIterations) {
    iteration++;
    yield { type: "loop_start", iteration };

    // Inject steering messages if provided
    const steering = config.getSteeringMessages?.() ?? [];
    for (const msg of steering) {
      messages.push(msg);
    }

    // Build the turn request
    const request: TurnRequest = {
      systemPrompt: config.systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
        text: m.text,
      })),
      tools: config.tools ? config.tools.toToolDefs() : undefined,
    };

    // Stream from provider, collecting events
    finalResponse = null;

    for await (const event of config.provider.stream(request, config.model)) {
      // Pass through all StreamEvents as AgentEvents
      yield event;

      if (event.type === "done") {
        finalResponse = event.response;
      }
      if (event.type === "error") {
        finalResponse = event.error;
      }
    }

    // If we got no response, bail
    if (!finalResponse) {
      break;
    }

    // Append the assistant message to history
    messages.push({
      role: "assistant",
      content: finalResponse.text,
      toolCalls: finalResponse.toolCalls.length > 0 ? finalResponse.toolCalls : undefined,
      text: finalResponse.text,
    });

    // If the model didn't request tool use, we're done
    if (finalResponse.stopReason !== "tool_use" || finalResponse.toolCalls.length === 0) {
      break;
    }

    // If we have no tool registry, we can't execute — bail
    if (!config.tools) {
      break;
    }

    // Execute each tool call
    for (const toolCall of finalResponse.toolCalls) {
      yield { type: "tool_start", toolCall };

      const { result, isError } = await executeToolCall(toolCall, config.tools);

      yield { type: "tool_end", toolCall, result, isError };

      // Append tool result to history
      messages.push({
        role: "tool",
        content: result,
        toolCallId: toolCall.id,
      });
    }
  }

  yield {
    type: "loop_end",
    iterations: iteration,
    stopReason: finalResponse?.stopReason ?? "unknown",
  };
}
