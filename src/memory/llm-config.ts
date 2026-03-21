import type { ArgentConfig } from "../config/config.js";
import { normalizeThinkLevel, type ThinkLevel } from "../auto-reply/thinking.js";
import { BUILTIN_PROFILES, DEFAULT_TIER_MODELS } from "../models/builtin-profiles.js";

export const MEMU_LLM_REPLACEMENT_GUIDANCE =
  "Use a text-generation model such as openai-codex/gpt-5.3-codex, anthropic/claude-sonnet-4-6, or ollama/qwen3:14b.";

type MemuLlmRunConfig = {
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  timeoutMs: number;
};

export type MemuLlmRunAttempt = MemuLlmRunConfig & {
  label: "primary" | "ollama-fallback";
  /** Treat provider/model as an explicit override so router cannot reroute this attempt. */
  respectProvidedModel: boolean;
};

export type MemuLlmValidationIssue = {
  code: "embedding-only-model";
  provider?: string;
  model: string;
  message: string;
  replacementGuidance: string;
};

function normalizeModelString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isEmbeddingOnlyMemuModel(model: unknown): boolean {
  const normalizedModel = normalizeModelString(model);
  if (!normalizedModel) {
    return false;
  }
  return (
    normalizedModel.startsWith("nomic-embed") ||
    normalizedModel.startsWith("text-embedding-") ||
    normalizedModel.startsWith("gemini-embedding-") ||
    normalizedModel.startsWith("voyage-") ||
    normalizedModel.startsWith("mxbai-embed") ||
    normalizedModel.includes("/embed-") ||
    /(?:^|[-_:./])embeddings?(?:$|[-_:./\d])/.test(normalizedModel)
  );
}

export function validateMemuLlmSelection(value: {
  provider?: unknown;
  model?: unknown;
}): MemuLlmValidationIssue | null {
  const provider =
    typeof value.provider === "string" && value.provider.trim().length > 0
      ? value.provider.trim()
      : undefined;
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (!model || !isEmbeddingOnlyMemuModel(model)) {
    return null;
  }
  return {
    code: "embedding-only-model",
    provider,
    model,
    message: `MemU LLM cannot use embedding-only model "${provider ? `${provider}/` : ""}${model}".`,
    replacementGuidance: MEMU_LLM_REPLACEMENT_GUIDANCE,
  };
}

export function detectInvalidMemuLlmConfig(config: ArgentConfig): MemuLlmValidationIssue | null {
  const llm = config.memory?.memu?.llm;
  return validateMemuLlmSelection({ provider: llm?.provider, model: llm?.model });
}

function parseThinkLevel(value: unknown): ThinkLevel | undefined {
  return typeof value === "string" ? normalizeThinkLevel(value) : undefined;
}

function parseTimeoutMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const timeout = Math.floor(value);
  return timeout > 0 ? timeout : undefined;
}

export function resolveMemuLlmRunConfig(
  config: ArgentConfig,
  defaults: { timeoutMs: number },
): MemuLlmRunConfig {
  const llm = config.memory?.memu?.llm;
  const invalid = detectInvalidMemuLlmConfig(config);

  const provider =
    !invalid && typeof llm?.provider === "string" && llm.provider.trim().length > 0
      ? llm.provider.trim()
      : undefined;
  const model =
    !invalid && typeof llm?.model === "string" && llm.model.trim().length > 0
      ? llm.model.trim()
      : undefined;
  const thinkLevel = parseThinkLevel(llm?.thinkLevel);
  const timeoutMs = parseTimeoutMs(llm?.timeoutMs) ?? defaults.timeoutMs;

  return { provider, model, thinkLevel, timeoutMs };
}

function resolveMemuOllamaFallbackModel(config: ArgentConfig): string {
  const router = config.agents?.defaults?.modelRouter;
  const activeProfile = router?.activeProfile;
  const profileTiers = activeProfile
    ? (router?.profiles?.[activeProfile]?.tiers ?? BUILTIN_PROFILES[activeProfile]?.tiers)
    : undefined;
  const localTier = profileTiers?.local ?? router?.tiers?.local;
  const localProvider = String(localTier?.provider ?? "")
    .trim()
    .toLowerCase();
  const localModel = String(localTier?.model ?? "").trim();
  if (localProvider === "ollama" && localModel.length > 0) {
    return localModel;
  }
  return DEFAULT_TIER_MODELS.local.model;
}

/**
 * Build ordered MemU LLM attempts:
 *   1. configured MemU primary (memory.memu.llm)
 *   2. Ollama local fallback
 */
export function buildMemuLlmRunAttempts(
  config: ArgentConfig,
  defaults: { timeoutMs: number },
): MemuLlmRunAttempt[] {
  const primaryResolved = resolveMemuLlmRunConfig(config, defaults);
  const defaultOllamaProvider = String(DEFAULT_TIER_MODELS.local.provider ?? "ollama").trim();
  const defaultOllamaModel = resolveMemuOllamaFallbackModel(config);
  const primary: MemuLlmRunConfig =
    String(primaryResolved.provider ?? "").trim().length === 0 &&
    String(primaryResolved.model ?? "").trim().length === 0
      ? {
          provider: defaultOllamaProvider,
          model: defaultOllamaModel,
          thinkLevel: primaryResolved.thinkLevel ?? "low",
          timeoutMs: primaryResolved.timeoutMs,
        }
      : primaryResolved;
  const primaryProvider = String(primary.provider ?? "")
    .trim()
    .toLowerCase();
  const primaryModel = String(primary.model ?? "").trim();
  const primaryRespectProvidedModel =
    String(primary.provider ?? "").trim().length > 0 || primaryModel.length > 0;

  const attempts: MemuLlmRunAttempt[] = [
    {
      ...primary,
      label: "primary",
      respectProvidedModel: primaryRespectProvidedModel,
    },
  ];

  const ollamaProvider = defaultOllamaProvider;
  const ollamaModel = defaultOllamaModel;
  const isAlreadyOllamaPrimary =
    primaryProvider === ollamaProvider.toLowerCase() && primaryModel === ollamaModel;
  if (!isAlreadyOllamaPrimary) {
    attempts.push({
      provider: ollamaProvider,
      model: ollamaModel,
      thinkLevel: primary.thinkLevel ?? "low",
      timeoutMs: primary.timeoutMs,
      label: "ollama-fallback",
      respectProvidedModel: true,
    });
  }

  return attempts;
}
