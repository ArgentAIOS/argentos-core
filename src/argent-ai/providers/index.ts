/**
 * Argent AI — Provider Registry
 *
 * Barrel exports for all providers + factory dispatch function.
 *
 * Built for Argent Core - February 16, 2026
 */

import type { Provider as ProviderInterface } from "../types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGoogleProvider } from "./google.js";
import { createMiniMaxProvider } from "./minimax.js";
import { createOpenAIResponsesProvider, createCodexProvider } from "./openai-responses.js";
import { createOpenAIProvider } from "./openai.js";
import { createXAIProvider } from "./xai.js";
import { createZAIProvider } from "./zai.js";

// Provider exports
export {
  AnthropicProvider,
  createAnthropicProvider,
  type AnthropicProviderConfig,
} from "./anthropic.js";

export { OpenAIProvider, createOpenAIProvider, type OpenAIProviderConfig } from "./openai.js";

export {
  OpenAIResponsesProvider,
  createOpenAIResponsesProvider,
  createCodexProvider,
  type OpenAIResponsesProviderConfig,
} from "./openai-responses.js";

export { GoogleProvider, createGoogleProvider, type GoogleProviderConfig } from "./google.js";

export { createXAIProvider, type XAIProviderConfig } from "./xai.js";

export { MiniMaxProvider, createMiniMaxProvider, type MiniMaxProviderConfig } from "./minimax.js";

export { ZAIProvider, createZAIProvider, type ZAIProviderConfig } from "./zai.js";

// ============================================================================
// Factory Dispatch
// ============================================================================

/**
 * Create a provider by name with the given configuration.
 *
 * @param name - Provider name ("anthropic", "openai", "google", "xai", "minimax", "zai")
 * @param config - Provider-specific configuration (must include apiKey)
 * @returns Configured Provider instance
 */
export function createProvider(name: string, config: Record<string, unknown>): ProviderInterface {
  const apiKey = config.apiKey as string;
  if (!apiKey) {
    throw new Error(`Provider "${name}" requires an apiKey`);
  }

  switch (name) {
    case "anthropic":
      return createAnthropicProvider(config as any);
    case "openai":
      return createOpenAIProvider(config as any);
    case "openai-responses":
      return createOpenAIResponsesProvider(config as any);
    case "openai-codex":
      return createCodexProvider(config as any);
    case "google":
      return createGoogleProvider(config as any);
    case "xai":
      return createXAIProvider(config as any);
    case "minimax":
      return createMiniMaxProvider(config as any);
    case "zai":
      return createZAIProvider(config as any);
    default:
      throw new Error(
        `Unknown provider: "${name}". Known providers: anthropic, openai, openai-responses, openai-codex, google, xai, minimax, zai`,
      );
  }
}
