import type { ArgentConfig } from "../config/config.js";
import type { WizardPrompter } from "./prompts.js";
import { WizardCancelledError } from "./prompts.js";

export type LocalRuntimeChoice = "ollama" | "lmstudio" | "cloud";

export const DEFAULT_OLLAMA_TEXT_MODEL = "qwen3:14b";
export const DEFAULT_LMSTUDIO_TEXT_MODEL = "qwen3-32b";
export const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
const LOCAL_MODEL_CONTEXT_WINDOW = 128_000;
const LOCAL_MODEL_MAX_TOKENS = 8_192;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;
const MANUAL_MODEL_ENTRY = "__manual__";

type SupportedLocalRuntimeChoice = Exclude<LocalRuntimeChoice, "cloud">;
type DiscoveredLocalRuntimeModels = {
  textModels: string[];
  embeddingModels: string[];
};

function normalizeProviderScopedModel(value: string, provider: "ollama" | "lmstudio"): string {
  const trimmed = String(value ?? "").trim();
  const prefix = `${provider}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

export function normalizeLocalRuntimeChoice(
  value: string | null | undefined,
): SupportedLocalRuntimeChoice | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "ollama" || normalized === "lmstudio" ? normalized : null;
}

export function resolveDefaultLocalTextModel(choice: SupportedLocalRuntimeChoice): string {
  return choice === "ollama" ? DEFAULT_OLLAMA_TEXT_MODEL : DEFAULT_LMSTUDIO_TEXT_MODEL;
}

function resolveExistingPrimaryModel(config: ArgentConfig): string {
  const model = config.agents?.defaults?.model;
  if (typeof model === "string") {
    return model.trim();
  }
  return model?.primary?.trim() ?? "";
}

function preserveFallbacks(config: ArgentConfig): { fallbacks?: string[] } {
  const current = config.agents?.defaults?.model;
  if (current && typeof current === "object" && Array.isArray(current.fallbacks)) {
    return { fallbacks: current.fallbacks };
  }
  return {};
}

async function probeJson(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    if (!res.ok) {
      return { ok: false, detail: `reachable but returned ${res.status}` };
    }
    return { ok: true, detail: "reachable" };
  } catch {
    return { ok: false, detail: "not detected" };
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
  if (!res.ok) {
    throw new Error(`request failed with ${res.status}`);
  }
  return res.json();
}

function uniqueNonEmpty(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) {
      seen.add(trimmed);
    }
  }
  return Array.from(seen);
}

function isEmbeddingModelName(name: string): boolean {
  return /(^|[-_/])(embed|embedding|nomic|bge|gte|e5)([-_/]|$)/i.test(name);
}

function scoreTextModel(name: string): number {
  const normalized = name.toLowerCase();
  let score = 0;
  if (normalized.includes("qwen3")) score += 100;
  else if (normalized.includes("qwen")) score += 80;
  if (/[:/-](72b|32b|30b|14b|8b)\b/.test(normalized)) score += 20;
  if (/instruct|chat|coder/.test(normalized)) score += 10;
  if (/embed|embedding|nomic|bge|gte|e5/.test(normalized)) score -= 200;
  return score;
}

function scoreEmbeddingModel(name: string): number {
  const normalized = name.toLowerCase();
  let score = 0;
  if (normalized.includes("nomic-embed-text")) score += 100;
  else if (normalized.includes("nomic")) score += 80;
  if (/embed|embedding/.test(normalized)) score += 30;
  if (/bge|gte|e5/.test(normalized)) score += 20;
  if (/qwen|chat|instruct|coder/.test(normalized)) score -= 100;
  return score;
}

function sortByPreferredScore(values: string[], scorer: (name: string) => number): string[] {
  return [...values].sort((left, right) => {
    const scoreDelta = scorer(right) - scorer(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.localeCompare(right);
  });
}

export function rankDiscoveredLocalRuntimeModels(
  choice: SupportedLocalRuntimeChoice,
  models: DiscoveredLocalRuntimeModels,
): DiscoveredLocalRuntimeModels {
  const defaultTextModel = resolveDefaultLocalTextModel(choice);
  const textModels = sortByPreferredScore(
    uniqueNonEmpty([defaultTextModel, ...models.textModels]),
    scoreTextModel,
  );
  const embeddingModels = sortByPreferredScore(
    uniqueNonEmpty([DEFAULT_EMBEDDING_MODEL, ...models.embeddingModels]),
    scoreEmbeddingModel,
  );
  return { textModels, embeddingModels };
}

async function discoverLocalRuntimeModels(
  choice: SupportedLocalRuntimeChoice,
): Promise<DiscoveredLocalRuntimeModels> {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return {
      textModels: [resolveDefaultLocalTextModel(choice)],
      embeddingModels: [DEFAULT_EMBEDDING_MODEL],
    };
  }

  try {
    const payload =
      choice === "ollama"
        ? await fetchJson("http://127.0.0.1:11434/api/tags")
        : await fetchJson("http://127.0.0.1:1234/v1/models");

    const modelNames =
      choice === "ollama"
        ? uniqueNonEmpty(
            Array.isArray((payload as { models?: Array<{ name?: string; model?: string }> }).models)
              ? (
                  (payload as { models?: Array<{ name?: string; model?: string }> }).models ?? []
                ).flatMap((model) => [model.name ?? "", model.model ?? ""])
              : [],
          )
        : uniqueNonEmpty(
            Array.isArray((payload as { data?: Array<{ id?: string }> }).data)
              ? ((payload as { data?: Array<{ id?: string }> }).data ?? []).map(
                  (model) => model.id ?? "",
                )
              : [],
          );

    return rankDiscoveredLocalRuntimeModels(choice, {
      textModels: modelNames.filter((name) => !isEmbeddingModelName(name)),
      embeddingModels: modelNames.filter(isEmbeddingModelName),
    });
  } catch {
    return rankDiscoveredLocalRuntimeModels(choice, { textModels: [], embeddingModels: [] });
  }
}

async function promptModelSelection(params: {
  prompter: WizardPrompter;
  message: string;
  discoveredModels: string[];
  initialValue: string;
  placeholder: string;
}): Promise<string> {
  const options = uniqueNonEmpty([params.initialValue, ...params.discoveredModels]);
  if (options.length === 0) {
    return params.prompter.text({
      message: params.message,
      initialValue: params.initialValue,
      placeholder: params.placeholder,
      validate: (value) => (value.trim() ? undefined : "Required"),
    });
  }

  const selected = await params.prompter.select<string>({
    message: params.message,
    options: [
      ...options.map((model) => ({
        value: model,
        label: model,
        hint: "Detected from the local runtime",
      })),
      {
        value: MANUAL_MODEL_ENTRY,
        label: "Enter a model manually",
        hint: "Use a model name that is not listed here yet",
      },
    ],
    initialValue: options.includes(params.initialValue) ? params.initialValue : options[0],
  });

  if (selected !== MANUAL_MODEL_ENTRY) {
    return selected;
  }

  return params.prompter.text({
    message: `${params.message} (manual entry)`,
    initialValue: params.initialValue,
    placeholder: params.placeholder,
    validate: (value) => (value.trim() ? undefined : "Required"),
  });
}

export async function probeLocalRuntime(choice: "ollama" | "lmstudio"): Promise<{
  ok: boolean;
  detail: string;
}> {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return { ok: true, detail: "reachable" };
  }
  if (choice === "ollama") {
    return probeJson("http://127.0.0.1:11434/api/tags");
  }
  return probeJson("http://127.0.0.1:1234/v1/models");
}

export async function promptLocalRuntimeChoice(params: {
  config: ArgentConfig;
  prompter: WizardPrompter;
}): Promise<LocalRuntimeChoice> {
  const existingPrimary = resolveExistingPrimaryModel(params.config);
  const [ollamaProbe, lmstudioProbe] = await Promise.all([
    probeLocalRuntime("ollama"),
    probeLocalRuntime("lmstudio"),
  ]);

  const initialValue: LocalRuntimeChoice = existingPrimary.startsWith("lmstudio/")
    ? "lmstudio"
    : existingPrimary.startsWith("ollama/")
      ? "ollama"
      : "ollama";

  return params.prompter.select({
    message: "Where should Argent run its brain?",
    options: [
      {
        value: "ollama",
        label: "Ollama",
        hint: `${ollamaProbe.ok ? "Detected" : "Not detected"} · Qwen + Nomic on the local box`,
      },
      {
        value: "lmstudio",
        label: "LM Studio",
        hint: `${lmstudioProbe.ok ? "Detected" : "Not detected"} · Qwen + Nomic through the local OpenAI bridge`,
      },
      {
        value: "cloud",
        label: "Cloud / API providers",
        hint: "OpenAI, Anthropic, Google, MiniMax, and other hosted providers",
      },
    ],
    initialValue,
  });
}

export async function ensureLocalRuntimeAvailable(params: {
  choice: SupportedLocalRuntimeChoice;
  prompter: WizardPrompter;
}): Promise<void> {
  const probe = await probeLocalRuntime(params.choice);
  if (probe.ok) {
    return;
  }

  const message =
    params.choice === "ollama"
      ? [
          "Ollama is not reachable at http://127.0.0.1:11434.",
          "",
          "Expected local Argent stack:",
          "- Install Ollama",
          `- Pull ${DEFAULT_OLLAMA_TEXT_MODEL}`,
          `- Pull ${DEFAULT_EMBEDDING_MODEL}`,
          "- Start the local server",
        ].join("\n")
      : [
          "LM Studio is not reachable at http://127.0.0.1:1234/v1/models.",
          "",
          "Expected local Argent stack:",
          "- Install LM Studio",
          "- Load a Qwen chat model",
          `- Load ${DEFAULT_EMBEDDING_MODEL} for embeddings`,
          "- Start the local server",
        ].join("\n");

  await params.prompter.note(message, "Local runtime");
  const continueAnyway = await params.prompter.confirm({
    message: "Continue anyway and finish Argent setup before fixing the local runtime?",
    initialValue: false,
  });
  if (!continueAnyway) {
    throw new WizardCancelledError("local runtime not available");
  }
}

export function applyLocalRuntimeConfig(params: {
  choice: SupportedLocalRuntimeChoice;
  config: ArgentConfig;
  textModel: string;
  embeddingModel: string;
}): ArgentConfig {
  const preservedFallbacks = preserveFallbacks(params.config);
  const textModel = normalizeProviderScopedModel(params.textModel, params.choice);
  const embeddingModel = params.embeddingModel.trim() || DEFAULT_EMBEDDING_MODEL;

  if (params.choice === "ollama") {
    return {
      ...params.config,
      agents: {
        ...params.config.agents,
        defaults: {
          ...params.config.agents?.defaults,
          model: {
            ...preservedFallbacks,
            primary: `ollama/${textModel}`,
          },
          models: {
            ...params.config.agents?.defaults?.models,
            [`ollama/${textModel}`]: {
              ...params.config.agents?.defaults?.models?.[`ollama/${textModel}`],
              alias:
                params.config.agents?.defaults?.models?.[`ollama/${textModel}`]?.alias ??
                "Qwen Local",
            },
          },
          memorySearch: {
            ...params.config.agents?.defaults?.memorySearch,
            provider: "ollama",
            model: embeddingModel,
            fallback: "none",
          },
        },
      },
      models: {
        mode: params.config.models?.mode ?? "merge",
        providers: {
          ...params.config.models?.providers,
          ollama: {
            ...params.config.models?.providers?.ollama,
            baseUrl: "http://127.0.0.1:11434/v1",
            apiKey: params.config.models?.providers?.ollama?.apiKey ?? "ollama-local",
            api: "openai-completions",
            models: [
              {
                id: textModel,
                name: textModel,
                reasoning: /reason|qwq|r1/i.test(textModel),
                input: ["text"],
                cost: ZERO_COST,
                contextWindow: LOCAL_MODEL_CONTEXT_WINDOW,
                maxTokens: LOCAL_MODEL_MAX_TOKENS,
              },
            ],
          },
        },
      },
      memory: {
        ...params.config.memory,
        memu: {
          ...params.config.memory?.memu,
          llm: {
            ...params.config.memory?.memu?.llm,
            provider: "ollama",
            model: textModel,
          },
        },
      },
    };
  }

  return {
    ...params.config,
    agents: {
      ...params.config.agents,
      defaults: {
        ...params.config.agents?.defaults,
        model: {
          ...preservedFallbacks,
          primary: `lmstudio/${textModel}`,
        },
        models: {
          ...params.config.agents?.defaults?.models,
          [`lmstudio/${textModel}`]: {
            ...params.config.agents?.defaults?.models?.[`lmstudio/${textModel}`],
            alias:
              params.config.agents?.defaults?.models?.[`lmstudio/${textModel}`]?.alias ??
              "Qwen Local",
          },
        },
        memorySearch: {
          ...params.config.agents?.defaults?.memorySearch,
          provider: "openai",
          model: embeddingModel,
          fallback: "none",
          remote: {
            ...params.config.agents?.defaults?.memorySearch?.remote,
            baseUrl: "http://127.0.0.1:1234/v1",
            apiKey: params.config.agents?.defaults?.memorySearch?.remote?.apiKey ?? "lmstudio",
          },
        },
      },
    },
    models: {
      mode: params.config.models?.mode ?? "merge",
      providers: {
        ...params.config.models?.providers,
        lmstudio: {
          ...params.config.models?.providers?.lmstudio,
          baseUrl: "http://127.0.0.1:1234/v1",
          apiKey: params.config.models?.providers?.lmstudio?.apiKey ?? "lmstudio",
          api: "openai-completions",
          models: [
            {
              id: textModel,
              name: textModel,
              reasoning: /reason|qwq|r1/i.test(textModel),
              input: ["text"],
              cost: ZERO_COST,
              contextWindow: LOCAL_MODEL_CONTEXT_WINDOW,
              maxTokens: LOCAL_MODEL_MAX_TOKENS,
            },
          ],
        },
      },
    },
    memory: {
      ...params.config.memory,
      memu: {
        ...params.config.memory?.memu,
        llm: {
          ...params.config.memory?.memu?.llm,
          provider: "lmstudio",
          model: textModel,
        },
      },
    },
  };
}

export async function configureLocalRuntime(params: {
  choice: SupportedLocalRuntimeChoice;
  config: ArgentConfig;
  prompter: WizardPrompter;
}): Promise<ArgentConfig> {
  const existingPrimary = resolveExistingPrimaryModel(params.config);
  const existingEmbeddingModel =
    params.config.agents?.defaults?.memorySearch?.model?.trim() || DEFAULT_EMBEDDING_MODEL;
  const discovered = await discoverLocalRuntimeModels(params.choice);

  const initialTextModel = normalizeProviderScopedModel(
    existingPrimary.startsWith(`${params.choice}/`)
      ? existingPrimary
      : resolveDefaultLocalTextModel(params.choice),
    params.choice,
  );

  const textModel = normalizeProviderScopedModel(
    await promptModelSelection({
      prompter: params.prompter,
      message:
        params.choice === "ollama"
          ? "Choose Ollama's primary text model for Argent"
          : "Choose LM Studio's primary text model for Argent",
      discoveredModels: discovered.textModels,
      initialValue: initialTextModel,
      placeholder: resolveDefaultLocalTextModel(params.choice),
    }),
    params.choice,
  );

  const embeddingModel = await promptModelSelection({
    prompter: params.prompter,
    message:
      params.choice === "ollama"
        ? "Choose Ollama's embedding model for memory"
        : "Choose LM Studio's embedding model for memory",
    discoveredModels: discovered.embeddingModels,
    initialValue: existingEmbeddingModel,
    placeholder: DEFAULT_EMBEDDING_MODEL,
  });

  return applyLocalRuntimeConfig({
    choice: params.choice,
    config: params.config,
    textModel,
    embeddingModel,
  });
}
