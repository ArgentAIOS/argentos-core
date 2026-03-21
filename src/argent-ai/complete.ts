/**
 * Argent AI — Streaming & Completion Functions
 *
 * Pi-compatible `stream()`, `streamSimple()`, `complete()`, and
 * `completeSimple()` functions backed by the Argent provider registry.
 *
 * These are the top-level LLM call functions that consuming code uses.
 * They look up the registered API provider for the model's API field,
 * call the provider's streaming function, and return Pi-format results.
 *
 * @module argent-ai/complete
 */

import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  StreamOptions,
} from "./types.js";
import { getApiProvider } from "./registry.js";

/**
 * Stream a response from the LLM using the raw provider API.
 *
 * Looks up the registered provider for the model's API protocol and
 * streams the response. Use `streamSimple()` for the reasoning-aware
 * version with thinking level support.
 *
 * @param model - Model definition with API protocol, provider, and pricing
 * @param context - System prompt, message history, and available tools
 * @param options - Stream options (temperature, maxTokens, signal, etc.)
 * @returns Async iterable event stream yielding AssistantMessageEvents
 * @throws Error if no provider is registered for the model's API
 */
export function stream<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const provider = getApiProvider(model.api);
  if (!provider) {
    throw new Error(
      `No API provider registered for "${model.api}". ` +
        `Register one with registerApiProvider() before calling stream().`,
    );
  }
  return provider.stream(model, context, options);
}

/**
 * Stream a response with reasoning/thinking support.
 *
 * This is the most commonly used streaming function. It supports
 * thinking levels (minimal, low, medium, high, xhigh) and custom
 * token budgets for reasoning models.
 *
 * @param model - Model definition
 * @param context - System prompt, message history, and available tools
 * @param options - Simple stream options with reasoning level
 * @returns Async iterable event stream
 * @throws Error if no provider is registered for the model's API
 */
export function streamSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const provider = getApiProvider(model.api);
  if (!provider) {
    throw new Error(
      `No API provider registered for "${model.api}". ` +
        `Register one with registerApiProvider() before calling streamSimple().`,
    );
  }
  return provider.streamSimple(model, context, options);
}

/**
 * Non-streaming completion using the raw provider API.
 *
 * Streams the full response internally and returns the final
 * AssistantMessage once complete. Use `completeSimple()` for the
 * reasoning-aware version.
 *
 * @param model - Model definition
 * @param context - System prompt, message history, and available tools
 * @param options - Stream options
 * @returns Final assistant message with content, usage, and stop reason
 * @throws Error if no provider registered or if the stream errors
 */
export async function complete<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: StreamOptions,
): Promise<AssistantMessage> {
  const eventStream = stream(model, context, options);

  // Consume the stream and return the final result
  for await (const _event of eventStream) {
    // Events are consumed to drive the stream to completion
  }

  return eventStream.result();
}

/**
 * Non-streaming completion with reasoning support.
 *
 * This is the most commonly used completion function. Streams the full
 * response internally and returns the final AssistantMessage.
 *
 * Used by: compaction summaries, model scanning, live tests, image
 * analysis, and anywhere a single response is needed without streaming UI.
 *
 * @param model - Model definition
 * @param context - System prompt, message history, and available tools
 * @param options - Simple stream options with reasoning level
 * @returns Final assistant message
 * @throws Error if no provider registered or if the stream errors
 */
export async function completeSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
  const eventStream = streamSimple(model, context, options);

  // Consume the stream and return the final result
  for await (const _event of eventStream) {
    // Events are consumed to drive the stream to completion
  }

  return eventStream.result();
}
