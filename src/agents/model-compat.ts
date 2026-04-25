import type { Api, Model } from "../agent-core/ai.js";

function isOpenAiCompletionsModel(model: Model<Api>): model is Model<"openai-completions"> {
  return model.api === "openai-completions";
}

function isMiniMaxM2Model(model: Model<Api>): boolean {
  return model.provider === "minimax" && /^MiniMax-M2(?:\.|$)/.test(model.id);
}

const ZAI_CODING_CHAT_COMPLETIONS_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";

function normalizeZaiBaseUrl(model: Model<"openai-completions">): string {
  const baseUrl = model.baseUrl?.trim() ?? "";
  if (!baseUrl || baseUrl.includes("open.bigmodel.cn")) {
    return ZAI_CODING_CHAT_COMPLETIONS_URL;
  }
  const withoutTrailingSlash = baseUrl.replace(/\/+$/, "");
  if (withoutTrailingSlash.includes("api.z.ai")) {
    if (withoutTrailingSlash.endsWith("/chat/completions")) {
      return withoutTrailingSlash;
    }
    if (
      withoutTrailingSlash.endsWith("/api/paas/v4") ||
      withoutTrailingSlash.endsWith("/api/coding/paas/v4")
    ) {
      return `${withoutTrailingSlash}/chat/completions`;
    }
  }
  return baseUrl;
}

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
    openaiModel.baseUrl = normalizeZaiBaseUrl(openaiModel);
  }
  if (compat?.supportsDeveloperRole === false) {
    return openaiModel;
  }

  openaiModel.compat = compat
    ? { ...compat, supportsDeveloperRole: false }
    : { supportsDeveloperRole: false };
  return openaiModel;
}
