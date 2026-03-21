export type ModelApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "github-copilot"
  | "bedrock-converse-stream";

export type ModelCompatConfig = {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
};

export type ModelProviderAuthMode = "api-key" | "aws-sdk" | "oauth" | "token";

export type ModelDefinitionConfig = {
  id: string;
  name: string;
  api?: ModelApi;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: ModelCompatConfig;
};

export type ModelProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  auth?: ModelProviderAuthMode;
  api?: ModelApi;
  headers?: Record<string, string>;
  authHeader?: boolean;
  models: ModelDefinitionConfig[];
};

export type BedrockDiscoveryConfig = {
  enabled?: boolean;
  region?: string;
  providerFilter?: string[];
  refreshInterval?: number;
  defaultContextWindow?: number;
  defaultMaxTokens?: number;
};

export type ModelsConfig = {
  mode?: "merge" | "replace";
  providers?: Record<string, ModelProviderConfig>;
  bedrockDiscovery?: BedrockDiscoveryConfig;
};

// ---------------------------------------------------------------------------
// Provider Registry — dynamic provider configuration
// ---------------------------------------------------------------------------

export type ProviderAuthType = "api_key" | "none" | "oauth" | "token" | "aws-sdk";

export type ProviderRegistryEntry = {
  name: string;
  baseUrl: string;
  api?: ModelApi;
  authType: ProviderAuthType;
  /** Env var name to check for API key (e.g. "MINIMAX_API_KEY"). */
  envKeyVar?: string;
  /** Placeholder token value for OAuth-authenticated providers. */
  oauthPlaceholder?: string;
  /** Provider discovers models at runtime (e.g. Ollama, Venice). */
  dynamic?: boolean;
  /** URL to fetch model list from for dynamic providers. */
  discoveryUrl?: string;
  /** Static model catalog. */
  models: ModelDefinitionConfig[];
};

export type ProviderRegistry = {
  version: number;
  providers: Record<string, ProviderRegistryEntry>;
};
