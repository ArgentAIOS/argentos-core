/**
 * Explicit re-exports from @mariozechner/pi-ai.
 *
 * Keep this surface intentional so upstream additions do not silently
 * become part of ArgentOS's public runtime contract.
 */
export {
  /**
   * @deprecated Prefer Argent-native `argentComplete` from this module.
   */
  Type,
  /**
   * @deprecated Prefer Argent-native `argentComplete` from this module.
   */
  complete,
  /**
   * @deprecated Prefer Argent-native `argentCompleteSimple` from this module.
   */
  completeSimple,
  /**
   * @deprecated Prefer Argent-native `argentStream` from this module.
   */
  stream,
  /**
   * @deprecated Prefer `createArgentStreamSimple` or Argent-native `argentStreamSimple`.
   */
  streamSimple,
  /**
   * @deprecated Prefer Argent-native `argentGetModel` from this module.
   */
  getModel,
  /**
   * @deprecated Prefer Argent-native `argentGetModels` from this module.
   */
  getModels,
  /**
   * @deprecated Prefer Argent-native `argentGetProviders` from this module.
   */
  getProviders,
  /**
   * @deprecated Prefer Argent-native `argentCalculateCost` from this module.
   */
  calculateCost,
  /**
   * @deprecated Prefer Argent-native `argentSupportsXhigh` from this module.
   */
  supportsXhigh,
  /**
   * @deprecated Prefer Argent-native `argentModelsAreEqual` from this module.
   */
  modelsAreEqual,
  /**
   * @deprecated Prefer Argent-native `argentGetEnvApiKey` from this module.
   */
  getEnvApiKey,
  /**
   * @deprecated Prefer Argent-native `argentRegisterApiProvider` from this module.
   */
  registerApiProvider,
  /**
   * @deprecated Prefer Argent-native `argentGetApiProvider` from this module.
   */
  getApiProvider,
  /**
   * @deprecated Prefer Argent-native `argentGetApiProviders` from this module.
   */
  getApiProviders,
  /**
   * @deprecated Prefer Argent-native `argentUnregisterApiProviders` from this module.
   */
  unregisterApiProviders,
  /**
   * @deprecated Prefer Argent-native `argentClearApiProviders` from this module.
   */
  clearApiProviders,
  /**
   * @deprecated Kept for Pi-compat stream wrappers and tests.
   */
  AssistantMessageEventStream,
  /**
   * @deprecated Kept for Pi-compat stream wrappers and tests.
   */
  createAssistantMessageEventStream,
} from "@mariozechner/pi-ai";
export type {
  /**
   * @deprecated Prefer Argent-native aliased types where available.
   */
  Api,
  /**
   * @deprecated Prefer Argent-native aliased types where available.
   */
  Model,
  /**
   * @deprecated Prefer Argent-native aliased types where available.
   */
  Context,
  /**
   * @deprecated Prefer Argent-native aliased types where available.
   */
  AssistantMessage,
  /**
   * @deprecated Prefer Argent-native aliased types where available.
   */
  AssistantMessageEvent,
  /**
   * @deprecated Prefer Argent-native aliased types where available.
   */
  SimpleStreamOptions,
  /**
   * @deprecated Prefer Argent-native aliased types where available.
   */
  Usage,
  /**
   * @deprecated Prefer Argent-native aliased types where available.
   */
  Provider,
  /**
   * @deprecated Prefer Argent-native aliased types where available.
   */
  ImageContent,
  /**
   * @deprecated Prefer Argent-native aliased types where available.
   */
  TextContent,
  /**
   * @deprecated Prefer Argent-native aliased types where available.
   */
  Tool,
  /**
   * @deprecated Prefer Argent-native aliased types where available.
   */
  ToolResultMessage,
  /**
   * @deprecated Prefer Argent-native `ArgentOAuthCredentials`.
   */
  OAuthCredentials,
  /**
   * @deprecated Prefer Argent-native `ArgentOAuthProvider`.
   */
  OAuthProvider,
  /**
   * @deprecated Prefer Argent-native `ArgentOpenAICompletionsOptions`.
   */
  OpenAICompletionsOptions,
} from "@mariozechner/pi-ai";

import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  Usage,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { createArgentStreamSimple as createCompatArgentStreamSimple } from "../argent-agent/compat.js";

/**
 * Argent-native bridge — use these to swap Pi's streamSimple with
 * an Argent Provider. The consuming code doesn't change.
 *
 *   import { createArgentStreamSimple } from "../agent-core/ai.js";
 *   const argentStream = createArgentStreamSimple(argentProvider);
 *   activeSession.agent.streamFn = argentStream;
 */
export {
  piModelToArgentConfig,
  piContextToArgentRequest,
  piMessageToArgentResponse,
  mapPiStopReasonToArgent,
} from "../argent-agent/compat.js";

type ArgentCompatProvider = Parameters<typeof createCompatArgentStreamSimple>[0];

type StreamSimpleFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

/**
 * Hardened wrapper over Argent's Pi-compat stream bridge.
 *
 * Guarantees:
 * - streaming iterator errors are converted to a terminal `error` event
 * - `result()` always resolves to an assistant message (never throws)
 * - malformed tool-call arguments are normalized to an object
 */
export function createArgentStreamSimple(provider: ArgentCompatProvider): StreamSimpleFn {
  const compat = createCompatArgentStreamSimple(provider) as StreamSimpleFn;

  return (model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
    normalizeAssistantMessageEventStream(compat(model, context, options), model);
}

/**
 * Harden an arbitrary Pi-compatible streamSimple function with the same
 * assistant-message normalization and terminal-error capture used by the
 * Argent compat bridge. Use this for raw Pi providers that can still emit
 * malformed assistant messages under provider/runtime edge cases.
 */
export function hardenStreamSimple(streamFn: StreamSimpleFn): StreamSimpleFn {
  return (model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
    normalizeAssistantMessageEventStream(streamFn(model, context, options), model);
}

function normalizeAssistantMessageEventStream(
  stream: AssistantMessageEventStream,
  model: Model<Api>,
): AssistantMessageEventStream {
  let terminalEventSeen = false;
  let emittedFallbackError: AssistantMessage | undefined;
  let terminalMessage: AssistantMessage | undefined;
  const normalizedStream = createAssistantMessageEventStream();

  void (async () => {
    try {
      for await (const event of stream) {
        const normalizedEvent = normalizeEvent(event);
        if (normalizedEvent.type === "done" || normalizedEvent.type === "error") {
          terminalEventSeen = true;
          terminalMessage =
            normalizedEvent.type === "done" ? normalizedEvent.message : normalizedEvent.error;
        }
        normalizedStream.push(normalizedEvent);
      }
      if (!terminalEventSeen) {
        terminalMessage = normalizeMessage(await stream.result());
        normalizedStream.push(buildTerminalEvent(terminalMessage));
        terminalEventSeen = true;
      }
    } catch (error) {
      if (!terminalEventSeen) {
        emittedFallbackError = buildStreamErrorMessage(model, error);
        normalizedStream.push({ type: "error", reason: "error", error: emittedFallbackError });
      }
    } finally {
      if (emittedFallbackError) {
        normalizedStream.end(emittedFallbackError);
      } else if (terminalMessage) {
        normalizedStream.end(terminalMessage);
      } else {
        try {
          normalizedStream.end(normalizeMessage(await stream.result()));
        } catch (error) {
          normalizedStream.end(buildStreamErrorMessage(model, error));
        }
      }
    }
  })();

  return normalizedStream;
}

function normalizeEvent(event: AssistantMessageEvent): AssistantMessageEvent {
  if (event.type === "toolcall_end") {
    const args = normalizeToolCallArguments(event.toolCall.arguments);
    return {
      ...event,
      toolCall: {
        ...event.toolCall,
        arguments: args,
      },
      partial: normalizeMessage(event.partial),
    };
  }

  if ("partial" in event && event.partial) {
    return {
      ...event,
      partial: normalizeMessage(event.partial),
    } as AssistantMessageEvent;
  }

  if (event.type === "done") {
    return { ...event, message: normalizeMessage(event.message) };
  }
  if (event.type === "error") {
    return { ...event, error: normalizeMessage(event.error) };
  }
  return event;
}

function buildTerminalEvent(message: AssistantMessage): AssistantMessageEvent {
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    return {
      type: "error",
      reason: message.stopReason,
      error: message,
    };
  }
  return {
    type: "done",
    reason:
      message.stopReason === "length" || message.stopReason === "toolUse"
        ? message.stopReason
        : "stop",
    message,
  };
}

function normalizeMessage(message: AssistantMessage): AssistantMessage {
  const content = Array.isArray(message.content) ? message.content : [];
  let normalizedContent = content.map((block) => {
    if (block.type !== "toolCall") {
      return block;
    }
    return {
      ...block,
      arguments: normalizeToolCallArguments(block.arguments),
    };
  });

  if (normalizedContent.length === 0 && message.stopReason === "error") {
    normalizedContent = [buildAssistantErrorTextContent(message.errorMessage)];
  }

  if (Array.isArray(message.content) && normalizedContent === message.content) {
    return message;
  }

  return {
    ...message,
    content: normalizedContent,
  };
}

function normalizeToolCallArguments(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function buildAssistantErrorTextContent(errorMessage?: string): { type: "text"; text: string } {
  const text = errorMessage?.trim() || "(error)";
  return { type: "text", text };
}

function buildStreamErrorMessage(model: Model<Api>, error: unknown): AssistantMessage {
  const includeStack = process.env.ARGENT_DEBUG_ERROR_STACKS === "1";
  const errorMessage =
    error instanceof Error
      ? includeStack && error.stack
        ? `${error.message}\n${error.stack}`
        : error.message
      : String(error);
  const usage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  return {
    role: "assistant",
    content: [buildAssistantErrorTextContent(errorMessage)],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  };
}

/**
 * Argent-native LLM call functions.
 * These are Argent implementations of Pi's complete/stream functions,
 * backed by the Argent provider registry.
 *
 * When Pi is removed, these replace the Pi versions exported above.
 * For now they coexist — use `argentComplete` etc. to avoid name conflicts.
 */
export {
  complete as argentComplete,
  completeSimple as argentCompleteSimple,
  stream as argentStream,
  streamSimple as argentStreamSimple,
} from "../argent-ai/complete.js";

/**
 * Argent-native model database.
 * Pi-compatible getModel/getModels/getProviders backed by Argent's own
 * model definitions. Use `argentGetModel` etc. to avoid conflicts with Pi.
 */
export {
  getModel as argentGetModel,
  getModels as argentGetModels,
  getProviders as argentGetProviders,
  calculateCost as argentCalculateCost,
  supportsXhigh as argentSupportsXhigh,
  modelsAreEqual as argentModelsAreEqual,
  MODELS as ARGENT_MODELS,
  MODELS,
} from "../argent-ai/models-db.js";

/**
 * Argent-native environment API key resolution.
 */
export { getEnvApiKey as argentGetEnvApiKey } from "../argent-ai/env-api-keys.js";

/**
 * Argent-native API provider registry.
 */
export {
  registerApiProvider as argentRegisterApiProvider,
  getApiProvider as argentGetApiProvider,
  getApiProviders as argentGetApiProviders,
  unregisterApiProviders as argentUnregisterApiProviders,
  clearApiProviders as argentClearApiProviders,
  hasApiProvider as argentHasApiProvider,
  listRegisteredApis as argentListRegisteredApis,
} from "../argent-ai/registry.js";

/**
 * Argent-native OAuth types.
 * These match Pi's OAuthCredentials/OAuthProvider from pi-ai.
 */
export type {
  OAuthCredentials as ArgentOAuthCredentials,
  OAuthProvider as ArgentOAuthProvider,
} from "../argent-agent/oauth-types.js";

/**
 * Upstream OpenAI Codex OAuth login.
 * Keep this on Pi's implementation so Argent stays aligned with the
 * current OpenAI/OAuth contract instead of maintaining a forked flow.
 */
export { loginOpenAICodex as argentLoginOpenAICodex } from "@mariozechner/pi-ai/oauth";

/**
 * Argent-native OpenAI Responses API streaming.
 * Replaces Pi's `streamOpenAIResponses` — handles reasoning replay,
 * function calls, and SSE streaming.
 */
export {
  streamOpenAIResponses as argentStreamOpenAIResponses,
  type OpenAIResponsesOptions as ArgentOpenAIResponsesOptions,
} from "../argent-ai/openai-responses.js";
export { streamOpenAIResponses } from "../argent-ai/openai-responses.js";

/**
 * Upstream OAuth API key resolution and provider discovery.
 * OpenAI Codex refresh behavior changes upstream, so keep these wired
 * to Pi's implementation rather than a local registry snapshot.
 */
export {
  getOAuthApiKey as argentGetOAuthApiKey,
  getOAuthProviders as argentGetOAuthProviders,
} from "@mariozechner/pi-ai/oauth";
export { getOAuthApiKey, getOAuthProviders, loginOpenAICodex } from "@mariozechner/pi-ai/oauth";

/**
 * Argent-native OpenAI Completions options type.
 * Extends StreamOptions with OpenAI-specific parameters like toolChoice.
 */
export type { OpenAICompletionsOptions as ArgentOpenAICompletionsOptions } from "../argent-ai/types.js";
