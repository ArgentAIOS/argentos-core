/**
 * Argent AI — xAI (Grok) Provider
 *
 * xAI's Grok uses an OpenAI-compatible API at https://api.x.ai/v1.
 * This wraps the OpenAI provider with the xAI base URL.
 *
 * Built for Argent Core - February 16, 2026
 */

import type { Provider } from "../types.js";
import { OpenAIProvider, type OpenAIProviderConfig } from "./openai.js";

// ============================================================================
// Types
// ============================================================================

export interface XAIProviderConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

// ============================================================================
// Constants
// ============================================================================

const XAI_BASE_URL = "https://api.x.ai/v1";

// ============================================================================
// Factory
// ============================================================================

export function createXAIProvider(config: XAIProviderConfig): Provider {
  const openAIConfig: OpenAIProviderConfig = {
    apiKey: config.apiKey,
    baseURL: config.baseURL || XAI_BASE_URL,
    defaultModel: config.defaultModel,
  };

  return new OpenAIProvider(openAIConfig, "xai");
}
