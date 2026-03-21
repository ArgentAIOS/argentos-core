/**
 * Argent Agent — Provider Factory
 *
 * Convenience functions for creating providers with auto-loaded API keys
 * from the dashboard key store.
 *
 * Built for Argent Core - February 16, 2026
 */

import type { Provider } from "../argent-ai/types.js";
import { createAnthropicProvider } from "../argent-ai/providers/anthropic.js";
import { createGoogleProvider } from "../argent-ai/providers/google.js";
import { createMiniMaxProvider } from "../argent-ai/providers/minimax.js";
import { createCodexProvider as createRawCodexProvider } from "../argent-ai/providers/openai-responses.js";
import { createOpenAIProvider } from "../argent-ai/providers/openai.js";
import { createXAIProvider } from "../argent-ai/providers/xai.js";
import { createZAIProvider } from "../argent-ai/providers/zai.js";
import { getProviderKey } from "./keys.js";

// ============================================================================
// Provider Factory
// ============================================================================

export interface ProviderOptions {
  /** Override API key (if not provided, loads from key store) */
  apiKey?: string;

  /** Cache retention preference */
  cacheRetention?: "none" | "short" | "long";

  /** Base URL override */
  baseURL?: string;
}

/**
 * Create Anthropic provider with auto-loaded key
 */
export async function createAnthropic(options: ProviderOptions = {}): Promise<Provider> {
  const apiKey = options.apiKey || (await getProviderKey("anthropic"));

  if (!apiKey) {
    throw new Error("No Anthropic API key found. Add one in Dashboard > Settings > API Keys.");
  }

  return createAnthropicProvider({
    apiKey,
    cacheRetention: options.cacheRetention || "short",
    baseURL: options.baseURL,
  });
}

/**
 * Create OpenAI provider with auto-loaded key
 */
export async function createOpenAI(options: ProviderOptions = {}): Promise<Provider> {
  const apiKey = options.apiKey || (await getProviderKey("openai"));

  if (!apiKey) {
    throw new Error("No OpenAI API key found. Add one in Dashboard > Settings > API Keys.");
  }

  return createOpenAIProvider({
    apiKey,
    baseURL: options.baseURL,
  });
}

/**
 * Create Inception provider (OpenAI-compatible) with auto-loaded key
 */
export async function createInception(options: ProviderOptions = {}): Promise<Provider> {
  const apiKey = options.apiKey || (await getProviderKey("inception"));

  if (!apiKey) {
    throw new Error("No Inception API key found. Add one in Dashboard > Settings > API Keys.");
  }

  return createOpenAIProvider({
    apiKey,
    baseURL: options.baseURL,
  });
}

/**
 * Create Google (Gemini) provider with auto-loaded key
 */
export async function createGoogle(options: ProviderOptions = {}): Promise<Provider> {
  const apiKey = options.apiKey || (await getProviderKey("google"));

  if (!apiKey) {
    throw new Error("No Google API key found. Add one in Dashboard > Settings > API Keys.");
  }

  return createGoogleProvider({ apiKey });
}

/**
 * Create xAI (Grok) provider with auto-loaded key
 */
export async function createXAI(options: ProviderOptions = {}): Promise<Provider> {
  const apiKey = options.apiKey || (await getProviderKey("xai"));

  if (!apiKey) {
    throw new Error("No xAI API key found. Add one in Dashboard > Settings > API Keys.");
  }

  return createXAIProvider({
    apiKey,
    baseURL: options.baseURL,
  });
}

/**
 * Create MiniMax provider with auto-loaded key
 */
export async function createMiniMax(options: ProviderOptions = {}): Promise<Provider> {
  const apiKey = options.apiKey || (await getProviderKey("minimax"));

  if (!apiKey) {
    throw new Error("No MiniMax API key found. Add one in Dashboard > Settings > API Keys.");
  }

  return createMiniMaxProvider({
    apiKey,
    baseURL: options.baseURL,
  });
}

/**
 * Create Z.AI provider with auto-loaded key
 */
export async function createZAI(options: ProviderOptions = {}): Promise<Provider> {
  const apiKey = options.apiKey || (await getProviderKey("zai"));

  if (!apiKey) {
    throw new Error("No Z.AI API key found. Add one in Dashboard > Settings > API Keys.");
  }

  return createZAIProvider({
    apiKey,
    baseURL: options.baseURL,
  });
}

/**
 * Create OpenAI Codex provider (Responses API) with auto-loaded key.
 * Resolves key from: options.apiKey → service key store → env OPENAI_API_KEY.
 * For OAuth flows, pass the JWT as options.apiKey.
 */
export async function createOpenAICodex(options: ProviderOptions = {}): Promise<Provider> {
  const apiKey = options.apiKey || (await getProviderKey("openai-codex"));

  if (!apiKey) {
    throw new Error(
      "No OpenAI API key found for Codex. Add one in Dashboard > Settings > API Keys or use an auth profile.",
    );
  }

  return createRawCodexProvider({
    apiKey,
    baseURL: options.baseURL ?? "https://api.openai.com/v1",
  });
}
