import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyDefaultModelChoice } from "./auth-choice.default-model.js";
import {
  applyLmStudioConfig,
  applyLmStudioProviderConfig,
  applyOllamaConfig,
  applyOllamaProviderConfig,
  LM_STUDIO_DEFAULT_MODEL_REF,
  OLLAMA_DEFAULT_MODEL_ID,
} from "./onboard-auth.config-local.js";

const OLLAMA_MANUAL_VALUE = "__manual__";

export async function applyAuthChoiceLocal(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  let nextConfig = params.config;
  let agentModelOverride: string | undefined;
  const noteAgentModel = async (model: string) => {
    if (!params.agentId) {
      return;
    }
    await params.prompter.note(
      `Default model set to ${model} for agent "${params.agentId}".`,
      "Model configured",
    );
  };

  if (params.authChoice === "lmstudio") {
    await params.prompter.note(
      [
        "LM Studio selected.",
        "Make sure the LM Studio local server is running at http://127.0.0.1:1234/v1 and the model stays loaded.",
        "Recommended default: Qwen 3.5 35B A3B with Nomic local embeddings.",
      ].join("\n"),
      "Local models",
    );
    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: params.setDefaultModel,
      defaultModel: LM_STUDIO_DEFAULT_MODEL_REF,
      applyDefaultConfig: applyLmStudioConfig,
      applyProviderConfig: applyLmStudioProviderConfig,
      noteDefault: LM_STUDIO_DEFAULT_MODEL_REF,
      noteAgentModel,
      prompter: params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { config: nextConfig, agentModelOverride };
  }

  if (params.authChoice === "ollama") {
    const modelSelection = await params.prompter.select({
      message: "Default Ollama model",
      options: [
        {
          value: "qwen3:30b-a3b-instruct-2507-q4_K_M",
          label: "Qwen 3 30B A3B",
          hint: "Recommended local default",
        },
        {
          value: "llama3.3",
          label: "Llama 3.3",
          hint: "Simpler local fallback",
        },
        {
          value: OLLAMA_MANUAL_VALUE,
          label: "Enter model manually",
          hint: "Use any model you already pulled in Ollama",
        },
      ],
      initialValue: "qwen3:30b-a3b-instruct-2507-q4_K_M",
    });

    const modelId =
      modelSelection === OLLAMA_MANUAL_VALUE
        ? String(
            await params.prompter.text({
              message: "Enter Ollama model id",
              initialValue: OLLAMA_DEFAULT_MODEL_ID,
              validate: (value) => (value?.trim() ? undefined : "Required"),
            }),
          ).trim()
        : String(modelSelection).trim();

    const modelRef = `ollama/${modelId}`;
    await params.prompter.note(
      [
        "Ollama selected.",
        "Make sure Ollama is running locally and the model is already pulled.",
        `Selected model: ${modelId}`,
        "Recommended embeddings: nomic-embed-text.",
      ].join("\n"),
      "Local models",
    );
    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: params.setDefaultModel,
      defaultModel: modelRef,
      applyDefaultConfig: (config) => applyOllamaConfig(config, { modelId }),
      applyProviderConfig: (config) => applyOllamaProviderConfig(config, { modelId }),
      noteDefault: modelRef,
      noteAgentModel,
      prompter: params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { config: nextConfig, agentModelOverride };
  }

  return null;
}
