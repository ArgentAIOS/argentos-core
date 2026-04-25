import type { Api, Model } from "../agent-core/ai.js";

function isOpenAiCompletionsModel(model: Model<Api>): model is Model<"openai-completions"> {
  return model.api === "openai-completions";
}

function isMiniMaxM2Model(model: Model<Api>): boolean {
  return model.provider === "minimax" && /^MiniMax-M2(?:\.|$)/.test(model.id);
}

const ZAI_CODING_CHAT_COMPLETIONS_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";

export function normalizeModelCompat(model: Model<Api>): Model<Api> {
  if (isMiniMaxM2Model(model)) {
    return {
      ...model,
      api: "anthropic-messages",
      baseUrl: "https://api.minimax.io/anthropic",
    } as Model<Api>;
  }

  const baseUrl = model.baseUrl ?? "";
  const isZai = model.provider === "zai" || baseUrl.includes("api.z.ai");
  const isMiniMax = model.provider === "minimax" || baseUrl.includes("api.minimax");
  if ((!isZai && !isMiniMax) || !isOpenAiCompletionsModel(model)) {
    return model;
  }

  const openaiModel = model;
  const compat = openaiModel.compat ?? undefined;
  if (isZai) {
    openaiModel.baseUrl = ZAI_CODING_CHAT_COMPLETIONS_URL;
  }
  if (compat?.supportsDeveloperRole === false) {
    return openaiModel;
  }

  openaiModel.compat = compat
    ? { ...compat, supportsDeveloperRole: false }
    : { supportsDeveloperRole: false };
  return openaiModel;
}
