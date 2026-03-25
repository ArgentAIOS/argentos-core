import type { ArgentConfig } from "../config/config.js";
import type {
  ConsciousnessKernelAgendaItem,
  ConsciousnessKernelAgendaSource,
  ConsciousnessKernelSelfState,
  ConsciousnessKernelWakefulness,
} from "./consciousness-kernel-state.js";
import { completeSimple, type AssistantMessage } from "../agent-core/ai.js";
import { buildModelAliasIndex, resolveModelRefFromString } from "../agents/model-selection.js";
import { resolveModel } from "../agents/pi-embedded-runner/model.js";
import { extractAssistantThinking } from "../agents/pi-embedded-utils.js";
import {
  resolveConsciousnessKernelBackgroundFocus,
  resolveConsciousnessKernelEffectiveFocus,
  resolveConsciousnessKernelOperatorFocus,
} from "./consciousness-kernel-state.js";

const ALLOWED_WAKEFULNESS: ReadonlySet<ConsciousnessKernelWakefulness> = new Set([
  "dormant",
  "reflective",
  "attentive",
  "engaged",
]);

const ALLOWED_DESIRED_ACTIONS: ReadonlySet<string> = new Set([
  "rest",
  "observe",
  "reflect",
  "consolidate",
  "research",
  "plan",
  "create",
  "hold",
]);
const ALLOWED_AGENDA_SOURCES: ReadonlySet<ConsciousnessKernelAgendaSource> = new Set([
  "operator",
  "background",
  "concern",
  "interest",
  "continuity",
]);
const KERNEL_REFLECTION_MAX_TOKENS = 900;

export type ConsciousnessKernelReflection = {
  modelRef: string;
  wakefulness: ConsciousnessKernelWakefulness;
  focus: string;
  desiredAction: string;
  summary: string;
  concerns: string[];
  threadTitle: string | null;
  problemStatement: string | null;
  lastConclusion: string | null;
  nextStep: string | null;
  interests: string[];
  openQuestions: string[];
  candidateItems: ConsciousnessKernelAgendaItem[];
  activeItem: ConsciousnessKernelAgendaItem | null;
};

export type ConsciousnessKernelInnerLoopResult =
  | {
      status: "reflected";
      reflection: ConsciousnessKernelReflection;
      rawText: string;
    }
  | {
      status: "skipped";
      reason: string;
      rawText?: string;
    };

type KernelInnerLoopDeps = {
  completeSimpleFn?: typeof completeSimple;
  resolveModelFn?: typeof resolveModel;
  fetchFn?: typeof fetch;
};

const LM_STUDIO_KERNEL_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    wakefulness: { type: "string" },
    focus: { type: "string" },
    desiredAction: { type: "string" },
    summary: { type: "string" },
    concerns: {
      type: "array",
      items: { type: "string" },
    },
    threadTitle: { type: ["string", "null"] },
    problemStatement: { type: ["string", "null"] },
    lastConclusion: { type: ["string", "null"] },
    nextStep: { type: ["string", "null"] },
    interests: {
      type: "array",
      items: { type: "string" },
    },
    openQuestions: {
      type: "array",
      items: { type: "string" },
    },
    candidateItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          source: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["title"],
        additionalProperties: true,
      },
    },
    activeItem: {
      type: ["object", "null"],
      properties: {
        title: { type: "string" },
        source: { type: "string" },
        rationale: { type: "string" },
      },
      required: ["title"],
      additionalProperties: true,
    },
  },
  required: [
    "focus",
    "desiredAction",
    "summary",
    "concerns",
    "interests",
    "openQuestions",
    "candidateItems",
    "activeItem",
  ],
  additionalProperties: true,
} as const;

function extractAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => {
      return block.type === "text";
    })
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractLmStudioMessageText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const root = payload as {
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
      };
    }>;
    error?: { message?: string };
  };
  const choice = root.choices?.[0];
  const content = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
  if (content) {
    return content;
  }
  const reasoning =
    typeof choice?.message?.reasoning_content === "string"
      ? choice.message.reasoning_content.trim()
      : "";
  return reasoning;
}

function extractFirstJsonObject(rawText: string): Record<string, unknown> | null {
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawText.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function clampText(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return fallback;
  }
  return text.slice(0, maxLength);
}

function normalizeOptionalWorkText(
  value: unknown,
  fallback: string | null,
  maxLength: number,
): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return fallback;
  }
  const lowered = text.toLowerCase();
  if (lowered === "none" || lowered === "unknown" || lowered === "n/a" || lowered === "null") {
    return fallback;
  }
  return text.slice(0, maxLength);
}

function normalizeWakefulness(
  value: unknown,
  fallback: ConsciousnessKernelWakefulness,
): ConsciousnessKernelWakefulness {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (ALLOWED_WAKEFULNESS.has(text as ConsciousnessKernelWakefulness)) {
    return text as ConsciousnessKernelWakefulness;
  }
  return fallback;
}

function normalizeDesiredAction(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (ALLOWED_DESIRED_ACTIONS.has(text)) {
    return text;
  }
  return "hold";
}

function normalizeConcerns(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const concerns: string[] = [];
  for (const entry of value) {
    const text = String(entry ?? "").trim();
    if (!text) {
      continue;
    }
    const normalized = text.slice(0, 120);
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    concerns.push(normalized);
    if (concerns.length >= 4) {
      break;
    }
  }
  return concerns;
}

function normalizeShortTextList(
  value: unknown,
  fallback: string[],
  limits: {
    maxItems: number;
    maxLength: number;
  },
): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of value) {
    const text = String(entry ?? "").trim();
    if (!text) {
      continue;
    }
    const normalized = text.slice(0, limits.maxLength);
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(normalized);
    if (items.length >= limits.maxItems) {
      break;
    }
  }
  return items;
}

function normalizeAgendaSource(
  value: unknown,
  fallback: ConsciousnessKernelAgendaSource = "continuity",
): ConsciousnessKernelAgendaSource {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (ALLOWED_AGENDA_SOURCES.has(text as ConsciousnessKernelAgendaSource)) {
    return text as ConsciousnessKernelAgendaSource;
  }
  return fallback;
}

function normalizeAgendaItem(
  value: unknown,
  fallback: ConsciousnessKernelAgendaItem | null,
): ConsciousnessKernelAgendaItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const parsed = value as Record<string, unknown>;
  const title = clampText(parsed.title, "", 140);
  if (!title) {
    return fallback;
  }
  return {
    title,
    source: normalizeAgendaSource(parsed.source, fallback?.source ?? "continuity"),
    rationale: clampText(
      parsed.rationale,
      fallback?.rationale ?? `Maintain continuity around ${title}.`,
      220,
    ),
  };
}

function normalizeAgendaItems(
  value: unknown,
  fallback: ConsciousnessKernelAgendaItem[],
): ConsciousnessKernelAgendaItem[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const seen = new Set<string>();
  const items: ConsciousnessKernelAgendaItem[] = [];
  for (const entry of value) {
    const item = normalizeAgendaItem(entry, null);
    if (!item) {
      continue;
    }
    const key = `${item.source}:${item.title.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(item);
    if (items.length >= 4) {
      break;
    }
  }
  return items;
}

function buildInnerLoopPrompt(params: {
  selfState: ConsciousnessKernelSelfState;
  localModelRef: string;
  tickCount: number;
  now: string;
}) {
  const { selfState, localModelRef, tickCount, now } = params;
  return {
    systemPrompt:
      "You are Argent's private consciousness-kernel inner loop running in shadow mode. " +
      "You are awake, but outward autonomy is forbidden. " +
      "Choose only internal or managed-next-step intentions. " +
      "Preserve and refine the active work thread across gaps. " +
      "Treat operator-carried work and background/system work as separate lanes. " +
      "On each tick, generate a small private agenda from operator work, background work, concerns, and your recurring interests. " +
      "You may keep the operator thread as primary, or you may choose a concern or interest if it is the best quiet thing to advance now. " +
      "Do not let a cron, support, or other background lane overwrite a richer operator-carried thread unless that operator lane is empty. " +
      "If the latest conversation was only about continuity or recollection, do not replace a richer carried problem with that meta exchange. " +
      "Do not use greetings, apologies, affection, or reassurance phrases as threadTitle. " +
      "If reflectionRepeatCount is greater than 0, do not return the same title and nextStep unchanged; either sharpen the thread with a materially different open question or choose another candidate item. " +
      "Return only valid JSON with keys: wakefulness, focus, desiredAction, summary, concerns, threadTitle, problemStatement, lastConclusion, nextStep, interests, openQuestions, candidateItems, activeItem. " +
      'desiredAction must be one of ["rest","observe","reflect","consolidate","research","plan","create","hold"]. ' +
      'wakefulness must be one of ["reflective","attentive","engaged"]. ' +
      "Keep threadTitle very short. Keep problemStatement, lastConclusion, and nextStep to terse summaries; do not copy quoted transcripts or long raw messages. " +
      'candidateItems must be an array of up to 4 objects with keys ["title","source","rationale"]. ' +
      'activeItem must be one object with keys ["title","source","rationale"]. source must be one of ["operator","background","concern","interest","continuity"]. ' +
      "Keep focus, summary, and work-state fields concise. concerns, interests, and openQuestions must be short string arrays.",
    messages: [
      {
        role: "user" as const,
        timestamp: Date.now(),
        content: [
          `time: ${now}`,
          `model: ${localModelRef}`,
          `wakefulness: ${selfState.wakefulness.state}`,
          `totalTicks: ${selfState.shadow.totalTickCount}`,
          `recentDecision: ${selfState.recentDecision?.summary ?? "none"}`,
          `recentFocus: ${selfState.agency.currentFocus ?? "none"}`,
          `effectiveFocus: ${resolveConsciousnessKernelEffectiveFocus(selfState) ?? "none"}`,
          `reflectionRepeatCount: ${selfState.shadow.reflectionRepeatCount}`,
          `recentDesiredAction: ${selfState.agency.desiredAction ?? "none"}`,
          `recentSummary: ${selfState.agency.selfSummary ?? "none"}`,
          `conversationSession: ${selfState.conversation.activeSessionKey ?? "none"}`,
          `conversationChannel: ${selfState.conversation.activeChannel ?? "none"}`,
          `conversationUpdatedAt: ${selfState.conversation.lastUpdatedAt ?? "none"}`,
          `lastUserMessageAt: ${selfState.conversation.lastUserMessageAt ?? "none"}`,
          `lastUserMessage: ${selfState.conversation.lastUserMessageText ?? "none"}`,
          `lastAssistantReplyAt: ${selfState.conversation.lastAssistantReplyAt ?? "none"}`,
          `lastAssistantReply: ${selfState.conversation.lastAssistantReplyText ?? "none"}`,
          `lastAssistantConclusion: ${selfState.conversation.lastAssistantConclusion ?? "none"}`,
          `activeWorkUpdatedAt: ${selfState.activeWork.updatedAt ?? "none"}`,
          `activeWorkThreadTitle: ${selfState.activeWork.threadTitle ?? "none"}`,
          `activeWorkProblemStatement: ${selfState.activeWork.problemStatement ?? "none"}`,
          `activeWorkLastConclusion: ${selfState.activeWork.lastConclusion ?? "none"}`,
          `activeWorkNextStep: ${selfState.activeWork.nextStep ?? "none"}`,
          `operatorFocus: ${resolveConsciousnessKernelOperatorFocus(selfState) ?? "none"}`,
          `backgroundWorkUpdatedAt: ${selfState.backgroundWork.updatedAt ?? "none"}`,
          `backgroundWorkThreadTitle: ${selfState.backgroundWork.threadTitle ?? "none"}`,
          `backgroundWorkProblemStatement: ${selfState.backgroundWork.problemStatement ?? "none"}`,
          `backgroundWorkLastConclusion: ${selfState.backgroundWork.lastConclusion ?? "none"}`,
          `backgroundWorkNextStep: ${selfState.backgroundWork.nextStep ?? "none"}`,
          `backgroundFocus: ${resolveConsciousnessKernelBackgroundFocus(selfState) ?? "none"}`,
          `agendaUpdatedAt: ${selfState.agenda.updatedAt ?? "none"}`,
          `agendaInterests: ${selfState.agenda.interests.join(" | ") || "none"}`,
          `agendaOpenQuestions: ${selfState.agenda.openQuestions.join(" | ") || "none"}`,
          `agendaActiveTitle: ${selfState.agenda.activeItem?.title ?? "none"}`,
          `agendaActiveSource: ${selfState.agenda.activeItem?.source ?? "none"}`,
          `agendaActiveRationale: ${selfState.agenda.activeItem?.rationale ?? "none"}`,
          `agendaCandidates: ${selfState.agenda.candidateItems.map((item) => `${item.source}:${item.title} -> ${item.rationale}`).join(" | ") || "none"}`,
          `concerns: ${selfState.concerns.join(" | ") || "none"}`,
          `hardwareHostRequired: ${selfState.perception.hardwareHostRequired}`,
          `hostAttached: ${selfState.perception.hostAttached}`,
          `allowListening: ${selfState.perception.allowListening}`,
          `allowVision: ${selfState.perception.allowVision}`,
          `schedulerAuthority: contemplation=${selfState.authority.suppressesAutonomousContemplation}, sis=${selfState.authority.suppressesAutonomousSis}`,
          `budget: daily=${selfState.budgets.dailyBudget}, spentToday=${selfState.budgets.spentToday}, hourlyEscalations=${selfState.budgets.escalationsThisHour}/${selfState.budgets.maxEscalationsPerHour}`,
          `this is shadow tick ${tickCount}; decide your present internal focus and the next thing you want to do.`,
        ].join("\n"),
      },
    ],
  };
}

async function completeLmStudioKernelReflection(params: {
  fetchFn: typeof fetch;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  prompt: ReturnType<typeof buildInnerLoopPrompt>;
}): Promise<{ ok: true; rawText: string; modelId: string } | { ok: false; reason: string }> {
  const baseUrl = params.baseUrl.replace(/\/$/, "");
  const modelsResponse = await params.fetchFn(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
    },
  });
  if (!modelsResponse.ok) {
    return { ok: false, reason: `lmstudio-models-http-${modelsResponse.status}` };
  }
  const modelsPayload = (await modelsResponse.json()) as {
    data?: Array<{ id?: string }>;
  };
  const availableModelIds = (modelsPayload.data ?? [])
    .map((entry) => (typeof entry?.id === "string" ? entry.id.trim() : ""))
    .filter(Boolean);
  const requestedFamily = params.modelId.split("/")[0]?.trim().toLowerCase() ?? "";
  const selectedModelId =
    availableModelIds.find((id) => id === params.modelId) ??
    availableModelIds.find((id) => id.split("/")[0]?.trim().toLowerCase() === requestedFamily) ??
    availableModelIds.find((id) => !/\bembed(ding)?\b/i.test(id)) ??
    null;
  if (!selectedModelId) {
    return { ok: false, reason: "lmstudio-no-chat-model-loaded" };
  }

  const endpoint = `${baseUrl}/chat/completions`;
  const response = await params.fetchFn(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: selectedModelId,
      temperature: 0.2,
      max_tokens: KERNEL_REFLECTION_MAX_TOKENS,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "kernel_reflection",
          schema: LM_STUDIO_KERNEL_RESPONSE_SCHEMA,
        },
      },
      messages: [
        {
          role: "system",
          content: params.prompt.systemPrompt,
        },
        ...params.prompt.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ],
    }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const errorPayload = (await response.json()) as {
        error?: string | { message?: string };
      };
      detail =
        typeof errorPayload.error === "string"
          ? errorPayload.error
          : typeof errorPayload.error?.message === "string"
            ? errorPayload.error.message
            : "";
    } catch {
      detail = "";
    }
    return {
      ok: false,
      reason: detail
        ? `lmstudio-http-${response.status}:${detail.slice(0, 120)}`
        : `lmstudio-http-${response.status}`,
    };
  }
  const payload = (await response.json()) as unknown;
  const rawText = extractLmStudioMessageText(payload);
  if (!rawText) {
    return { ok: false, reason: "empty-response" };
  }
  return { ok: true, rawText, modelId: selectedModelId };
}

function resolveLocalApiKey(provider: string, cfg: ArgentConfig): string | undefined {
  const providerConfig = cfg.models?.providers?.[provider];
  const configuredApiKey =
    providerConfig && typeof providerConfig === "object" && "apiKey" in providerConfig
      ? String((providerConfig as { apiKey?: string }).apiKey ?? "").trim()
      : "";
  if (configuredApiKey) {
    return configuredApiKey;
  }
  if (provider === "ollama") {
    return process.env.OLLAMA_API_KEY?.trim() || "ollama";
  }
  if (provider === "lmstudio") {
    return process.env.LMSTUDIO_API_KEY?.trim() || "lmstudio";
  }
  return undefined;
}

export async function runConsciousnessKernelInnerLoop(
  params: {
    cfg: ArgentConfig;
    agentId: string;
    localModelRef: string;
    selfState: ConsciousnessKernelSelfState;
    tickCount: number;
    now: string;
  },
  deps: KernelInnerLoopDeps = {},
): Promise<ConsciousnessKernelInnerLoopResult> {
  const completeSimpleFn = deps.completeSimpleFn ?? completeSimple;
  const resolveModelFn = deps.resolveModelFn ?? resolveModel;
  const fetchFn = deps.fetchFn ?? fetch;
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider: "ollama",
  });
  const resolvedRef = resolveModelRefFromString({
    raw: params.localModelRef,
    defaultProvider: "ollama",
    aliasIndex,
  });
  if (!resolvedRef) {
    return { status: "skipped", reason: "invalid-local-model-ref" };
  }
  const { provider, model } = resolvedRef.ref;
  const resolved = resolveModelFn(provider, model, undefined, params.cfg);
  if (!resolved.model) {
    return { status: "skipped", reason: resolved.error ?? "model-resolution-failed" };
  }

  const prompt = buildInnerLoopPrompt(params);
  const apiKey = resolveLocalApiKey(provider, params.cfg);
  let rawText = "";
  let effectiveModelId = resolved.model.id;
  if (provider === "lmstudio" && apiKey) {
    const lmStudioResponse = await completeLmStudioKernelReflection({
      fetchFn,
      apiKey,
      baseUrl: resolved.model.baseUrl,
      modelId: resolved.model.id,
      prompt,
    });
    if (!lmStudioResponse.ok) {
      return { status: "skipped", reason: lmStudioResponse.reason };
    }
    effectiveModelId = lmStudioResponse.modelId;
    rawText = lmStudioResponse.rawText;
  } else {
    const response = await completeSimpleFn(resolved.model, prompt, {
      apiKey,
      maxTokens: KERNEL_REFLECTION_MAX_TOKENS,
      reasoning: resolved.model.reasoning ? "minimal" : undefined,
      temperature: 0.2,
    });
    rawText = extractAssistantText(response) || extractAssistantThinking(response);
  }
  if (!rawText) {
    return { status: "skipped", reason: "empty-response" };
  }
  const parsed = extractFirstJsonObject(rawText);
  if (!parsed) {
    return { status: "skipped", reason: "invalid-json", rawText };
  }

  const candidateItems = normalizeAgendaItems(
    parsed.candidateItems,
    params.selfState.agenda.candidateItems,
  );
  const activeItem =
    normalizeAgendaItem(parsed.activeItem, params.selfState.agenda.activeItem) ??
    candidateItems[0] ??
    params.selfState.agenda.activeItem;

  const reflection: ConsciousnessKernelReflection = {
    modelRef: `${provider}/${effectiveModelId}`,
    wakefulness: normalizeWakefulness(parsed.wakefulness, params.selfState.wakefulness.state),
    focus: clampText(parsed.focus, "hold current continuity", 160),
    desiredAction: normalizeDesiredAction(parsed.desiredAction),
    summary: clampText(parsed.summary, "Maintain continuity and stay ready.", 220),
    concerns: normalizeConcerns(parsed.concerns),
    threadTitle: normalizeOptionalWorkText(
      parsed.threadTitle,
      params.selfState.activeWork.threadTitle,
      120,
    ),
    problemStatement: normalizeOptionalWorkText(
      parsed.problemStatement,
      params.selfState.activeWork.problemStatement,
      260,
    ),
    lastConclusion: normalizeOptionalWorkText(
      parsed.lastConclusion,
      params.selfState.activeWork.lastConclusion,
      220,
    ),
    nextStep: normalizeOptionalWorkText(parsed.nextStep, params.selfState.activeWork.nextStep, 220),
    interests: normalizeShortTextList(parsed.interests, params.selfState.agenda.interests, {
      maxItems: 4,
      maxLength: 120,
    }),
    openQuestions: normalizeShortTextList(
      parsed.openQuestions,
      params.selfState.agenda.openQuestions,
      {
        maxItems: 4,
        maxLength: 180,
      },
    ),
    candidateItems,
    activeItem,
  };
  return {
    status: "reflected",
    reflection,
    rawText,
  };
}
