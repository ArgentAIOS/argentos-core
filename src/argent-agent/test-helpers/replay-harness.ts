/**
 * Deterministic replay harness for Argent agent-loop safety tests.
 *
 * Why this exists:
 * - Critical runtime safety tests should not depend on live model variance.
 * - Follow-on safety slices need one stable way to replay tool chains,
 *   follow-up injection, and loop event sequences from fixtures.
 *
 * Scope:
 * - Test-only helper for scripted `agentLoopV2` runs.
 * - Records provider requests, loop events, and tool execution events.
 * - Keeps replay fixtures fully local and deterministic.
 */

import type {
  ModelConfig,
  Provider,
  StreamEvent,
  ToolCall,
  TurnRequest,
  TurnResponse,
} from "../../argent-ai/types.js";
import { agentLoopV2, type LoopMessage, type LoopV2Event } from "../loop-v2.js";
import {
  ToolExecutor,
  type ExtendedToolHandler,
  type PostExecutionHook,
  type PreExecutionHook,
  type ToolExecutionEvent,
  type ToolPolicy,
} from "../tool-executor.js";
import { ToolRegistry } from "../tools.js";

export type ReplayTurnFixture = {
  response: TurnResponse;
  events?: StreamEvent[];
};

export type AgentLoopReplayFixture = {
  systemPrompt: string;
  messages: LoopMessage[];
  turns: ReplayTurnFixture[];
  tools?: ExtendedToolHandler[];
  policies?: ToolPolicy[];
  preHooks?: PreExecutionHook[];
  postHooks?: PostExecutionHook[];
  parallelTools?: boolean;
  steeringMessages?: Array<{ role: "user"; content: string }>;
  agentId?: string;
  model?: Partial<ModelConfig>;
};

export type AgentLoopReplayResult = {
  events: LoopV2Event[];
  requests: TurnRequest[];
  toolEvents: ToolExecutionEvent[];
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultModelConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    id: "replay-model",
    ...overrides,
  } as ModelConfig;
}

function buildDefaultEvents(response: TurnResponse): StreamEvent[] {
  const partial = cloneJson(response);
  const events: StreamEvent[] = [{ type: "start", partial }];

  if (response.text) {
    events.push({ type: "text_start", partial: cloneJson(response) });
    events.push({ type: "text_delta", delta: response.text, partial: cloneJson(response) });
    events.push({ type: "text_end", text: response.text, partial: cloneJson(response) });
  }

  for (const toolCall of response.toolCalls) {
    events.push({ type: "tool_call_start", partial: cloneJson(response) });
    events.push({
      type: "tool_call_delta",
      delta: JSON.stringify(toolCall.arguments),
      partial: cloneJson(response),
    });
    events.push({
      type: "tool_call_end",
      toolCall: cloneJson(toolCall),
      partial: cloneJson(response),
    });
  }

  events.push({ type: "done", response: cloneJson(response) });
  return events;
}

function createScriptedProvider(turns: ReplayTurnFixture[], requests: TurnRequest[]): Provider {
  let turnIndex = 0;

  return {
    name: "replay-provider",
    async execute(request: TurnRequest): Promise<TurnResponse> {
      requests.push(cloneJson(request));
      const turn = turns[turnIndex];
      if (!turn) {
        throw new Error(`No scripted replay turn available for execute() at index ${turnIndex}`);
      }
      turnIndex += 1;
      return cloneJson(turn.response);
    },
    async *stream(request: TurnRequest): AsyncGenerator<StreamEvent> {
      requests.push(cloneJson(request));
      const turn = turns[turnIndex];
      if (!turn) {
        throw new Error(`No scripted replay turn available for stream() at index ${turnIndex}`);
      }
      turnIndex += 1;
      const events = turn.events ?? buildDefaultEvents(turn.response);
      for (const event of events) {
        yield cloneJson(event);
      }
    },
  };
}

function createToolExecutor(params: {
  tools?: ExtendedToolHandler[];
  policies?: ToolPolicy[];
  preHooks?: PreExecutionHook[];
  postHooks?: PostExecutionHook[];
  toolEvents: ToolExecutionEvent[];
}): ToolExecutor {
  const registry = new ToolRegistry();
  for (const tool of params.tools ?? []) {
    registry.register(tool);
  }
  return new ToolExecutor({
    registry,
    policies: params.policies,
    preHooks: params.preHooks,
    postHooks: params.postHooks,
    onEvent: (event) => params.toolEvents.push(cloneJson(event)),
  });
}

export async function runAgentLoopReplay(
  fixture: AgentLoopReplayFixture,
): Promise<AgentLoopReplayResult> {
  const requests: TurnRequest[] = [];
  const toolEvents: ToolExecutionEvent[] = [];
  const events: LoopV2Event[] = [];
  const provider = createScriptedProvider(fixture.turns, requests);
  const toolExecutor = fixture.tools?.length
    ? createToolExecutor({
        tools: fixture.tools,
        policies: fixture.policies,
        preHooks: fixture.preHooks,
        postHooks: fixture.postHooks,
        toolEvents,
      })
    : undefined;

  for await (const event of agentLoopV2({
    provider,
    model: defaultModelConfig(fixture.model),
    systemPrompt: fixture.systemPrompt,
    messages: cloneJson(fixture.messages),
    toolExecutor,
    parallelTools: fixture.parallelTools,
    getSteeringMessages: fixture.steeringMessages
      ? () => cloneJson(fixture.steeringMessages ?? [])
      : undefined,
    agentId: fixture.agentId ?? "replay-agent",
    onToolEvent: (toolEvent) => toolEvents.push(cloneJson(toolEvent)),
  })) {
    events.push(cloneJson(event));
  }

  return { events, requests, toolEvents };
}

export function createReplayToolCall(params: {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
}): ToolCall {
  return {
    type: "toolCall",
    id: params.id,
    name: params.name,
    arguments: params.arguments ?? {},
  };
}

export function createReplayTurnResponse(params: {
  text: string;
  toolCalls?: ToolCall[];
  stopReason: TurnResponse["stopReason"];
  provider?: string;
  model?: string;
}): TurnResponse {
  return {
    text: params.text,
    toolCalls: params.toolCalls ?? [],
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
    stopReason: params.stopReason,
    provider: params.provider ?? "replay-provider",
    model: params.model ?? "replay-model",
  };
}
