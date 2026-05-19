/**
 * Provider Registry (Compatibility Shim)
 *
 * This module now re-exports the unified registry from stream.ts.
 * All provider registration and lookup goes through the single
 * ProviderRegistry + legacy bridge in stream.ts.
 *
 * Existing code that imports from './registry.js' will continue to work
 * without changes.
 *
 * @module argent-ai/registry
 */

import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  StreamOptions,
} from "./types.js";
import {
  registerLegacyApiProvider,
  getLegacyApiProvider,
  unregisterLegacyApiProviders,
  clearLegacyApiProviders,
  hasLegacyApiProvider,
  listLegacyRegisteredApis,
  type LegacyApiProvider,
} from "./stream.js";

// ── Type re-exports for backward compat ──

/**
 * Base stream function type for a provider.
 */
export type ProviderStreamFunction = (
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
) => AssistantMessageEventStream;

/**
 * Simple stream function with reasoning support.
 */
export type ProviderStreamSimpleFunction = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

/**
 * API provider definition.
 */
export interface ApiProvider<
  TApi extends Api = Api,
  TOptions extends StreamOptions = StreamOptions,
> {
  /** API protocol this provider handles */
  api: TApi;
  /** Raw stream function with provider-specific options */
  stream: (model: Model<TApi>, context: Context, options?: TOptions) => AssistantMessageEventStream;
  /** Simplified stream function with reasoning support */
  streamSimple: (
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream;
}

/**
 * Internal provider wrapper (for type compat).
 */
interface ApiProviderInternal {
  api: Api;
  stream: ProviderStreamFunction;
  streamSimple: ProviderStreamSimpleFunction;
}

// ── Wrap functions that adapt typed ApiProvider to LegacyApiProvider ──

function wrapStream<TApi extends Api, TOptions extends StreamOptions>(
  api: TApi,
  stream: (model: Model<TApi>, context: Context, options?: TOptions) => AssistantMessageEventStream,
): ProviderStreamFunction {
  return (model, context, options) => {
    if (model.api !== api) {
      throw new Error(`Mismatched API: expected ${api}, got ${model.api}`);
    }
    return stream(model as Model<TApi>, context, options as TOptions);
  };
}

function wrapStreamSimple<TApi extends Api>(
  api: TApi,
  streamSimple: (
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream,
): ProviderStreamSimpleFunction {
  return (model, context, options) => {
    if (model.api !== api) {
      throw new Error(`Mismatched API: expected ${api}, got ${model.api}`);
    }
    return streamSimple(model as Model<TApi>, context, options);
  };
}

// ── Public API (delegates to stream.ts unified registry) ──

/**
 * Register an API provider.
 *
 * @param provider - Provider implementation
 * @param sourceId - Optional source identifier for plugin tracking
 */
export function registerApiProvider<TApi extends Api, TOptions extends StreamOptions>(
  provider: ApiProvider<TApi, TOptions>,
  sourceId?: string,
): void {
  const wrapped: LegacyApiProvider = {
    api: provider.api,
    stream: wrapStream(provider.api, provider.stream),
    streamSimple: wrapStreamSimple(provider.api, provider.streamSimple),
  };
  registerLegacyApiProvider(wrapped, sourceId);
}

/**
 * Get a registered API provider.
 *
 * @param api - API protocol to look up
 * @returns Provider implementation or undefined
 */
export function getApiProvider(api: Api): ApiProviderInternal | undefined {
  const legacy = getLegacyApiProvider(api);
  if (!legacy) return undefined;
  return {
    api: legacy.api,
    stream: legacy.stream,
    streamSimple: legacy.streamSimple,
  };
}

/**
 * Get all registered API providers.
 *
 * @returns Array of provider implementations
 */
export function getApiProviders(): ApiProviderInternal[] {
  return listLegacyRegisteredApis().map((api) => {
    const p = getLegacyApiProvider(api)!;
    return { api: p.api, stream: p.stream, streamSimple: p.streamSimple };
  });
}

/**
 * Unregister all providers from a specific source.
 */
export function unregisterApiProviders(sourceId: string): void {
  unregisterLegacyApiProviders(sourceId);
}

/**
 * Clear all registered providers (testing).
 */
export function clearApiProviders(): void {
  clearLegacyApiProviders();
}

/**
 * Check if a provider is registered for an API.
 */
export function hasApiProvider(api: Api): boolean {
  return hasLegacyApiProvider(api);
}

/**
 * Get all registered API protocols.
 */
export function listRegisteredApis(): Api[] {
  return listLegacyRegisteredApis();
}
