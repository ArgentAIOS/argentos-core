/**
 * Argent AI — Environment API Key Resolution
 *
 * Resolves API keys from environment variables for known providers.
 * Pi-compatible replacement for the legacy upstream env API-key resolver.
 *
 * @module argent-ai/env-api-keys
 */

import type { KnownProvider } from "./types.js";

/**
 * Map of known providers to their environment variable names.
 */
const PROVIDER_ENV_VARS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "openai-codex": ["OPENAI_API_KEY"],
  "azure-openai": ["AZURE_OPENAI_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  "google-vertex": ["GOOGLE_API_KEY"],
  "google-gemini-cli": ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  "amazon-bedrock": ["AWS_ACCESS_KEY_ID"], // Bedrock uses AWS credentials
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  xai: ["XAI_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  "minimax-cn": ["MINIMAX_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "vercel-ai-gateway": ["VERCEL_API_KEY"],
  zai: ["ZAI_API_KEY"],
  huggingface: ["HUGGINGFACE_API_KEY", "HF_TOKEN"],
};

/**
 * Providers that require OAuth tokens and should NOT return env API keys.
 */
const OAUTH_PROVIDERS = new Set(["github-copilot", "google-antigravity"]);

/**
 * Get API key for provider from known environment variables.
 *
 * Will not return API keys for providers that require OAuth tokens
 * (e.g., github-copilot).
 *
 * @param provider - Provider name (e.g., "anthropic", "openai")
 * @returns API key string or undefined if not found
 */
export function getEnvApiKey(provider: KnownProvider | string): string | undefined {
  // OAuth providers don't use env vars
  if (OAUTH_PROVIDERS.has(provider)) {
    return undefined;
  }

  const envVars = PROVIDER_ENV_VARS[provider];
  if (!envVars) {
    return undefined;
  }

  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value) {
      return value;
    }
  }

  return undefined;
}
