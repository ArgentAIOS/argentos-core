/**
 * Argent Agent — Core Turn Executor
 *
 * The agent loop that orchestrates:
 * - Lesson injection via SIS
 * - Provider calls (streaming or non-streaming)
 * - Tool execution
 * - Episode recording
 * - History updates
 *
 * Built for Argent Core - February 16, 2026
 */

import type { Provider, ToolCall, TurnRequest, TurnResponse } from "../argent-ai/types.js";
import type { AgentEvent } from "./events.js";
import type { InjectionContext } from "./sis/confidence.js";
import type { InjectionCandidate } from "./sis/injection.js";
import { agentLoop } from "./loop.js";
import { LessonInjector } from "./sis/injection.js";
import { LessonStorage } from "./sis/storage.js";
import { ToolRegistry, type ToolHandler } from "./tools.js";

// ============================================================================
// Types
// ============================================================================

export interface AgentConfig {
  /** The LLM provider to use */
  provider: Provider;

  /** Model configuration */
  model: {
    id: string;
    maxTokens?: number;
    temperature?: number;
    thinking?: boolean;
  };

  /** SIS components (optional - agent works without lessons) */
  sis?: {
    injector: LessonInjector;
    storage: LessonStorage;
  };

  /** System prompt */
  systemPrompt: string;

  /** Available tools */
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<string>;
  }>;
}

export interface TurnInput {
  /** User message content */
  content: string;

  /** Conversation history (excludes current message) */
  history: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
  }>;

  /** Optional context override (general/tool/external/critical) */
  context?: InjectionContext;

  /** Episode ID for tracking */
  episodeId?: string;

  /** Pre-turn valence for lesson tracking */
  preValence?: number;
}

export interface TurnOutput {
  /** Assistant response text */
  text: string;

  /** Extended thinking (if any) */
  thinking?: string;

  /** Tool calls (if any) */
  toolCalls: Array<{
    type: "toolCall";
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;

  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
  };

  /** Stop reason */
  stopReason: "stop" | "length" | "tool_use" | "error";

  /** Injected lessons (if SIS enabled) */
  injectedLessons?: Array<{
    id: number;
    text: string;
    confidence: number;
  }>;

  /** Error message (if stopReason is 'error') */
  errorMessage?: string;
}

// ============================================================================
// Agent Class
// ============================================================================

export class Agent {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  /**
   * Execute a turn (non-streaming)
   *
   * When tools are configured, uses the agent loop to handle multi-turn
   * tool execution automatically. Without tools, makes a single provider call.
   */
  async execute(input: TurnInput): Promise<TurnOutput> {
    // Build enhanced system prompt with lessons
    const { systemPrompt, injectedLessons } = await this.buildSystemPrompt(input);

    const formattedLessons = injectedLessons?.map((l) => ({
      id: l.lesson.id,
      text: l.lesson.text,
      confidence: l.confidence.score,
    }));

    // If tools are defined, use the agent loop for multi-turn execution
    if (this.config.tools && this.config.tools.length > 0) {
      const registry = this.buildToolRegistry();
      const messages = [...input.history, { role: "user" as const, content: input.content }];

      let lastResponse: TurnResponse | null = null;

      for await (const event of agentLoop({
        provider: this.config.provider,
        model: this.config.model,
        systemPrompt,
        messages,
        tools: registry,
      })) {
        if (event.type === "done") {
          lastResponse = event.response;
        }
        if (event.type === "error") {
          lastResponse = event.error;
        }
      }

      // Record injection if SIS enabled
      if (this.config.sis && injectedLessons && input.episodeId && input.preValence !== undefined) {
        await this.recordInjections(injectedLessons, input.episodeId, input.preValence);
      }

      if (!lastResponse) {
        return {
          text: "",
          toolCalls: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
          },
          stopReason: "error",
          injectedLessons: formattedLessons,
          errorMessage: "No response from agent loop",
        };
      }

      return {
        text: lastResponse.text,
        thinking: lastResponse.thinking,
        toolCalls: lastResponse.toolCalls,
        usage: lastResponse.usage,
        stopReason: lastResponse.stopReason,
        injectedLessons: formattedLessons,
        errorMessage: lastResponse.errorMessage,
      };
    }

    // No tools — single provider call (original behavior)
    const request: TurnRequest = {
      systemPrompt,
      messages: [
        ...input.history,
        {
          role: "user",
          content: input.content,
        },
      ],
    };

    const response = await this.config.provider.execute(request, this.config.model);

    // Record injection if SIS enabled
    if (this.config.sis && injectedLessons && input.episodeId && input.preValence !== undefined) {
      await this.recordInjections(injectedLessons, input.episodeId, input.preValence);
    }

    return {
      text: response.text,
      thinking: response.thinking,
      toolCalls: response.toolCalls,
      usage: response.usage,
      stopReason: response.stopReason,
      injectedLessons: formattedLessons,
      errorMessage: response.errorMessage,
    };
  }

  /**
   * Execute a turn with streaming
   *
   * When tools are configured, uses the agent loop and yields all AgentEvents
   * (including tool_start, tool_end, loop_start, loop_end). Without tools,
   * yields StreamEvents from a single provider call.
   */
  async *stream(
    input: TurnInput,
  ): AsyncGenerator<
    | AgentEvent
    | { type: "lesson_injected"; lessons: Array<{ id: number; text: string; confidence: number }> }
  > {
    // Build enhanced system prompt with lessons
    const { systemPrompt, injectedLessons } = await this.buildSystemPrompt(input);

    // Emit lesson_injected event before the loop starts
    if (injectedLessons && injectedLessons.length > 0) {
      yield {
        type: "lesson_injected" as const,
        lessons: injectedLessons.map((l) => ({
          id: l.lesson.id,
          text: l.lesson.text,
          confidence: l.confidence.score,
        })),
      };
    }

    // If tools are defined, use the agent loop for multi-turn streaming
    if (this.config.tools && this.config.tools.length > 0) {
      const registry = this.buildToolRegistry();
      const messages = [...input.history, { role: "user" as const, content: input.content }];

      for await (const event of agentLoop({
        provider: this.config.provider,
        model: this.config.model,
        systemPrompt,
        messages,
        tools: registry,
      })) {
        yield event;
      }

      // Record injection if SIS enabled
      if (this.config.sis && injectedLessons && input.episodeId && input.preValence !== undefined) {
        await this.recordInjections(injectedLessons, input.episodeId, input.preValence);
      }
      return;
    }

    // No tools — single provider call (original behavior)
    const request: TurnRequest = {
      systemPrompt,
      messages: [
        ...input.history,
        {
          role: "user",
          content: input.content,
        },
      ],
    };

    for await (const event of this.config.provider.stream(request, this.config.model)) {
      yield event;
    }

    // Record injection if SIS enabled
    if (this.config.sis && injectedLessons && input.episodeId && input.preValence !== undefined) {
      await this.recordInjections(injectedLessons, input.episodeId, input.preValence);
    }
  }

  /**
   * Execute tools and continue turn
   *
   * Call this after a turn that returned tool calls.
   */
  async executeTool(toolCallId: string, toolName: string): Promise<string> {
    const tool = this.config.tools?.find((t) => t.name === toolName);

    if (!tool) {
      return `Error: Tool "${toolName}" not found`;
    }

    try {
      // Extract arguments from the tool call
      // TODO: Pass actual arguments from the turn output
      const result = await tool.handler({});
      return result;
    } catch (error) {
      return `Error executing tool: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Build a ToolRegistry from the config.tools array.
   */
  private buildToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    if (this.config.tools) {
      for (const tool of this.config.tools) {
        registry.register(tool);
      }
    }
    return registry;
  }

  private async buildSystemPrompt(input: TurnInput): Promise<{
    systemPrompt: string;
    injectedLessons?: InjectionCandidate[];
  }> {
    // If no SIS, return base prompt
    if (!this.config.sis) {
      return { systemPrompt: this.config.systemPrompt };
    }

    // Select lessons for injection
    const context = input.context || "general";
    const result = await this.config.sis.injector.selectLessonsForTurn({
      context,
      maxLessons: 3,
      episodeId: input.episodeId,
    });

    // If no lessons selected, return base prompt
    if (result.injected.length === 0) {
      return { systemPrompt: this.config.systemPrompt };
    }

    // Inject lessons into prompt
    const enhancedPrompt = `${result.promptSection}\n\n${this.config.systemPrompt}`;

    return {
      systemPrompt: enhancedPrompt,
      injectedLessons: result.injected,
    };
  }

  private async recordInjections(
    injectedLessons: InjectionCandidate[],
    episodeId: string,
    preValence: number,
  ): Promise<void> {
    if (!this.config.sis) return;

    for (const candidate of injectedLessons) {
      await this.config.sis.storage.recordInjection({
        lessonId: candidate.lesson.id,
        episodeId,
        preValence,
        postValence: preValence, // Placeholder - updated on episode completion
      });
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createAgent(config: AgentConfig): Agent {
  return new Agent(config);
}
