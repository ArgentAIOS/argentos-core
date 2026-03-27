import fs from "node:fs/promises";
import os from "node:os";
import type { ImageContent } from "../../../agent-core/ai.js";
import type { AgentMessage } from "../../../agent-core/core.js";
import type { EmbeddedRunAttemptParams, EmbeddedRunAttemptResult } from "./types.js";
import { streamSimple, createArgentStreamSimple } from "../../../agent-core/ai.js";
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "../../../agent-core/coding.js";
import {
  createAnthropic as createArgentAnthropic,
  createInception as createArgentInception,
  createOpenAI as createArgentOpenAI,
  createGoogle as createArgentGoogle,
  createXAI as createArgentXAI,
  createMiniMax as createArgentMiniMax,
  createZAI as createArgentZAI,
  createOpenAICodex as createArgentOpenAICodex,
} from "../../../agent-core/index.js";
import {
  allowsPiFallback,
  assertPiFallbackAllowed,
  isArgentRuntimeMode,
  resolveAgentCoreRuntimeMode,
  type AgentCoreRuntimeMode,
  type RuntimeEnv,
} from "../../../agent-core/runtime-policy.js";
import {
  ArgentSessionManager,
  ArgentSettingsManager,
  createArgentAgentSession,
} from "../../../argent-agent/index.js";
import { resolveHeartbeatPrompt } from "../../../auto-reply/heartbeat.js";
import { resolveChannelCapabilities } from "../../../config/channel-capabilities.js";
import {
  loadSessionStore,
  resolveStorePath,
  updateSessionStore,
} from "../../../config/sessions.js";
import {
  appendCrossChannelContextEvent,
  readCrossChannelContextEvents,
} from "../../../data/redis-shared-context.js";
import { getMachineDisplayName } from "../../../infra/machine-name.js";
import { MAX_IMAGE_BYTES } from "../../../media/constants.js";
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import { isSubagentSessionKey } from "../../../routing/session-key.js";
import { resolveSignalReactionLevel } from "../../../signal/reaction-level.js";
import { resolveTelegramInlineButtonsScope } from "../../../telegram/inline-buttons.js";
import { resolveTelegramReactionLevel } from "../../../telegram/reaction-level.js";
import { buildTtsSystemPromptHint } from "../../../tts/tts.js";
import { resolveUserPath } from "../../../utils.js";
import { normalizeMessageChannel } from "../../../utils/message-channel.js";
import { isReasoningTagProvider } from "../../../utils/provider-utils.js";
import { resolveArgentAgentDir } from "../../agent-paths.js";
import { resolveSessionAgentIds } from "../../agent-scope.js";
import { createAnthropicPayloadLogger } from "../../anthropic-payload-log.js";
import { makeBootstrapWarn, resolveBootstrapContextForRun } from "../../bootstrap-files.js";
import { createCacheTrace } from "../../cache-trace.js";
import {
  listChannelSupportedActions,
  resolveChannelMessageToolHints,
} from "../../channel-tools.js";
import { resolveArgentDocsPath } from "../../docs-path.js";
import { isTimeoutError } from "../../failover-error.js";
import { resolveModelAuthMode } from "../../model-auth.js";
import { resolveDefaultModelForAgent } from "../../model-selection.js";
import {
  buildIntentSystemPromptHintIfAvailable,
  evaluateIntentSimulationGateForConfigIfAvailable,
  resolveEffectiveIntentForAgentIfAvailable,
} from "../../optional-intent.js";
import {
  isCloudCodeAssistFormatError,
  resolveBootstrapMaxChars,
  validateAnthropicTurns,
  validateGeminiTurns,
} from "../../pi-embedded-helpers.js";
import { subscribeEmbeddedPiSession } from "../../pi-embedded-subscribe.js";
import {
  ensurePiCompactionReserveTokens,
  resolveCompactionReserveTokensFloor,
} from "../../pi-settings.js";
import { toClientToolDefinitions } from "../../pi-tool-definition-adapter.js";
import { createArgentCodingTools } from "../../pi-tools.js";
import { resolveSandboxContext } from "../../sandbox.js";
import { resolveSandboxRuntimeStatus } from "../../sandbox/runtime-status.js";
import { repairSessionFileIfNeeded } from "../../session-file-repair.js";
import { guardSessionManager } from "../../session-tool-result-guard-wrapper.js";
import { acquireSessionWriteLock } from "../../session-write-lock.js";
import {
  applySkillEnvOverrides,
  applySkillEnvOverridesFromSnapshot,
  loadWorkspaceSkillEntries,
  resolveSkillsPromptForRun,
} from "../../skills.js";
import { buildSystemPromptParams } from "../../system-prompt-params.js";
import { buildSystemPromptReport } from "../../system-prompt-report.js";
import { resolveTranscriptPolicy } from "../../transcript-policy.js";
import { DEFAULT_BOOTSTRAP_FILENAME } from "../../workspace.js";
import { isAbortError } from "../abort.js";
import { appendCacheTtlTimestamp, isCacheTtlEligibleProvider } from "../cache-ttl.js";
import { buildEmbeddedExtensionPaths } from "../extensions.js";
import { applyExtraParamsToAgent } from "../extra-params.js";
import {
  logToolSchemasForGoogle,
  sanitizeSessionHistory,
  sanitizeToolsForGoogle,
} from "../google.js";
import { getDmHistoryLimitFromSessionKey, limitHistoryTurns } from "../history.js";
import { log } from "../logger.js";
import { buildModelAliasLines } from "../model.js";
import {
  clearActiveEmbeddedRun,
  type EmbeddedPiQueueHandle,
  setActiveEmbeddedRun,
} from "../runs.js";
import { buildEmbeddedSandboxInfo } from "../sandbox-info.js";
import { prewarmSessionFile, trackSessionManagerAccess } from "../session-manager-cache.js";
import { prepareSessionManagerForRun } from "../session-manager-init.js";
import {
  applySystemPromptOverrideToSession,
  buildEmbeddedSystemPrompt,
  createSystemPromptOverride,
} from "../system-prompt.js";
import { splitSdkTools } from "../tool-split.js";
import { describeUnknownError, mapThinkingLevel } from "../utils.js";
import { detectAndLoadPromptImages, modelSupportsImages } from "./images.js";
import {
  buildCrossChannelContextBlock,
  buildSessionBootstrapBlock,
  extractAssistantTextForContext,
  inferSessionChannelFromKey,
  resolveSessionBootstrapSnapshotFromStore,
  selectCrossChannelEventSummary,
} from "./session-context.js";
import { applyVisionFallbackToMessages } from "./vision-fallback.js";

const seenIntentWarnings = new Set<string>();

function warnIntentOnce(message: string): void {
  if (seenIntentWarnings.has(message)) {
    return;
  }
  seenIntentWarnings.add(message);
  log.warn(message);
}

function isSystemSessionKey(sessionKey: string | undefined): boolean {
  const raw = (sessionKey ?? "").trim().toLowerCase();
  if (!raw) {
    return false;
  }
  return raw.includes("cron") || raw.includes("contemplation") || raw.includes("sis");
}

// ============================================================================
// Argent Runtime policy
// ============================================================================

type EmbeddedAttemptRuntimePolicy = {
  mode: AgentCoreRuntimeMode;
  argentRuntimeEnabled: boolean;
  piFallbackAllowed: boolean;
};

export function resolveEmbeddedAttemptRuntimePolicy(
  env: RuntimeEnv = process.env,
): EmbeddedAttemptRuntimePolicy {
  const mode = resolveAgentCoreRuntimeMode(env);
  return {
    mode,
    argentRuntimeEnabled: isArgentRuntimeMode(mode),
    piFallbackAllowed: allowsPiFallback(mode),
  };
}

export function applyPiStreamFallbackPolicy(
  runtimeMode: AgentCoreRuntimeMode,
  operation: string,
  applyFallback: () => void,
  err?: unknown,
): void {
  assertPiFallbackAllowed(runtimeMode, operation);
  if (err) {
    log.warn(
      `[argent-runtime] ${operation} failed; falling back to Pi stream (mode=${runtimeMode})`,
      { error: err },
    );
  } else {
    log.info(`[argent-runtime] ${operation}; using Pi stream fallback (mode=${runtimeMode})`);
  }
  applyFallback();
}

function messageHasInlineImages(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some(
    (block) =>
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "image" &&
      typeof (block as { data?: unknown }).data === "string" &&
      (block as { data?: string }).data.length > 0,
  );
}

export function resolveOpenAICodexTransport(
  context: { messages?: unknown[] } | undefined,
): "sse" | "websocket" {
  return context?.messages?.some((message) => messageHasInlineImages(message))
    ? "sse"
    : "websocket";
}

function modelHasDeclaredImageInput(model: { input?: string[] } | undefined): boolean {
  return model?.input?.includes("image") === true;
}

function buildOpenAICodexVisionFallbackOrder(modelId: string): string[] {
  const normalized = modelId.trim().toLowerCase();
  const baseId = normalized.replace(/-codex(?:-(?:spark|mini|max))?$/i, "");
  return [...new Set([baseId, "gpt-5.4", "gpt-5.2", "gpt-5.1"].filter(Boolean))];
}

type OpenAICodexModelRegistryLike = {
  find: (provider: string, modelId: string) => Model<Api> | null;
  getAll: () => Array<Model<Api>>;
};

type AuthStorageWithRuntimeOverrides = {
  runtimeOverrides?: Map<string, string>;
};

export function resolveOpenAICodexVisionModelId(params: {
  model: Pick<Model<Api>, "id" | "provider" | "input">;
  context: { messages?: unknown[] } | undefined;
  modelRegistry: OpenAICodexModelRegistryLike;
}): string | undefined {
  if (!params.context?.messages?.some((message) => messageHasInlineImages(message))) {
    return undefined;
  }
  if ((params.model.provider ?? "").trim().toLowerCase() !== "openai-codex") {
    return undefined;
  }
  if (modelHasDeclaredImageInput(params.model)) {
    return params.model.id;
  }

  const imageCapableIds = new Set(
    params.modelRegistry
      .getAll()
      .filter(
        (candidate) =>
          (candidate.provider ?? "").trim().toLowerCase() === "openai-codex" &&
          modelHasDeclaredImageInput(candidate),
      )
      .map((candidate) => candidate.id),
  );

  for (const candidateId of buildOpenAICodexVisionFallbackOrder(params.model.id)) {
    if (imageCapableIds.has(candidateId)) {
      return candidateId;
    }
  }

  return undefined;
}

/**
 * Resolve an Argent-native provider from a provider name string.
 * API keys are auto-loaded from the dashboard key store.
 */
async function resolveArgentProvider(providerName: string, baseURL?: string, apiKey?: string) {
  const opts: Record<string, unknown> = {
    ...(baseURL ? { baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
  switch (providerName) {
    case "anthropic":
      return createArgentAnthropic(opts);
    case "openai":
    case "azure-openai":
      return createArgentOpenAI(opts);
    case "google":
    case "google-vertex":
      return createArgentGoogle(opts);
    case "xai":
      return createArgentXAI(opts);
    case "minimax":
      return createArgentMiniMax(opts);
    case "zai":
      return createArgentZAI(opts);
    case "nvidia":
    case "ollama":
      return createArgentOpenAI(opts);
    case "inception":
      return createArgentInception(opts);
    case "openai-codex":
      return createArgentOpenAICodex({ apiKey, baseURL });
    default:
      return null; // Unknown provider — fall back to Pi
  }
}

export function injectHistoryImagesIntoMessages(
  messages: AgentMessage[],
  historyImagesByIndex: Map<number, ImageContent[]>,
): boolean {
  if (historyImagesByIndex.size === 0) {
    return false;
  }
  let didMutate = false;

  for (const [msgIndex, images] of historyImagesByIndex) {
    // Bounds check: ensure index is valid before accessing
    if (msgIndex < 0 || msgIndex >= messages.length) {
      continue;
    }
    const msg = messages[msgIndex];
    if (msg && msg.role === "user") {
      // Convert string content to array format if needed
      if (typeof msg.content === "string") {
        msg.content = [{ type: "text", text: msg.content }];
        didMutate = true;
      }
      if (Array.isArray(msg.content)) {
        // Check for existing image content to avoid duplicates across turns
        const existingImageData = new Set(
          msg.content
            .filter(
              (c): c is ImageContent =>
                c != null &&
                typeof c === "object" &&
                c.type === "image" &&
                typeof c.data === "string",
            )
            .map((c) => c.data),
        );
        for (const img of images) {
          // Only add if this image isn't already in the message
          if (!existingImageData.has(img.data)) {
            msg.content.push(img);
            didMutate = true;
          }
        }
      }
    }
  }

  return didMutate;
}

export async function runEmbeddedAttempt(
  params: EmbeddedRunAttemptParams,
): Promise<EmbeddedRunAttemptResult> {
  const resolvedWorkspace = resolveUserPath(params.workspaceDir);
  const runtimePolicy = resolveEmbeddedAttemptRuntimePolicy(process.env);
  const prevCwd = process.cwd();
  const runAbortController = new AbortController();

  const t0 = Date.now();
  const phaseTimes: Record<string, number> = {};
  const markPhase = (name: string) => {
    phaseTimes[name] = Date.now() - t0;
  };

  log.debug(
    `embedded run start: runId=${params.runId} sessionId=${params.sessionId} provider=${params.provider} model=${params.modelId} thinking=${params.thinkLevel} messageChannel=${params.messageChannel ?? params.messageProvider ?? "unknown"}`,
  );

  await fs.mkdir(resolvedWorkspace, { recursive: true });

  const sandboxSessionKey = params.sessionKey?.trim() || params.sessionId;
  const sandbox = await resolveSandboxContext({
    config: params.config,
    sessionKey: sandboxSessionKey,
    workspaceDir: resolvedWorkspace,
  });
  markPhase("sandbox");
  const effectiveWorkspace = sandbox?.enabled
    ? sandbox.workspaceAccess === "rw"
      ? resolvedWorkspace
      : sandbox.workspaceDir
    : resolvedWorkspace;
  await fs.mkdir(effectiveWorkspace, { recursive: true });

  let restoreSkillEnv: (() => void) | undefined;
  process.chdir(effectiveWorkspace);
  try {
    const shouldLoadSkillEntries = !params.skillsSnapshot || !params.skillsSnapshot.resolvedSkills;
    const skillEntries = shouldLoadSkillEntries
      ? loadWorkspaceSkillEntries(effectiveWorkspace)
      : [];
    restoreSkillEnv = params.skillsSnapshot
      ? applySkillEnvOverridesFromSnapshot({
          snapshot: params.skillsSnapshot,
          config: params.config,
        })
      : applySkillEnvOverrides({
          skills: skillEntries ?? [],
          config: params.config,
        });

    const skillsPrompt = resolveSkillsPromptForRun({
      skillsSnapshot: params.skillsSnapshot,
      entries: shouldLoadSkillEntries ? skillEntries : undefined,
      config: params.config,
      workspaceDir: effectiveWorkspace,
    });

    const agentDir = params.agentDir ?? resolveArgentAgentDir();

    // Resolve session agent IDs early — needed for session store + intent + tools
    const { defaultAgentId, sessionAgentId } = resolveSessionAgentIds({
      sessionKey: params.sessionKey,
      config: params.config,
    });

    // Load session store early — discovered tools needed for tool creation
    let sessionBootstrapSnapshot:
      | ReturnType<typeof resolveSessionBootstrapSnapshotFromStore>
      | undefined;
    let sessionDiscoveredTools: Set<string> | undefined;
    try {
      const storePath = resolveStorePath(params.config?.session?.store, {
        agentId: sessionAgentId,
      });
      const store = loadSessionStore(storePath);
      sessionBootstrapSnapshot = resolveSessionBootstrapSnapshotFromStore(store);
      const sessionKey = params.sessionKey ?? params.sessionId;
      const entry = store[sessionKey];
      if (Array.isArray(entry?.discoveredTools) && entry.discoveredTools.length > 0) {
        sessionDiscoveredTools = new Set(entry.discoveredTools);
      }
    } catch (err) {
      log.debug(`session bootstrap snapshot unavailable: ${String(err)}`);
    }

    // QW-1: Start async I/O operations before sync CPU work (Project Tony Stark).
    // These operations are independent — they read from disk/network while we do
    // sync CPU work (tool creation, intent resolution) below. The kernel processes
    // the I/O in the background; we await all results after the sync work completes.
    const sessionLabel = params.sessionKey ?? params.sessionId;
    const bootstrapPromise = resolveBootstrapContextForRun({
      workspaceDir: effectiveWorkspace,
      config: params.config,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      warn: makeBootstrapWarn({ sessionLabel, warn: (message) => log.warn(message) }),
    });
    const machineNamePromise = getMachineDisplayName();
    const intentGatePromise = evaluateIntentSimulationGateForConfigIfAvailable({
      intent: params.config?.intent,
      workspaceDir: effectiveWorkspace,
    });
    const docsPathPromise = resolveArgentDocsPath({
      workspaceDir: effectiveWorkspace,
      argv1: process.argv[1],
      cwd: process.cwd(),
      moduleUrl: import.meta.url,
    });
    const crossChannelPromise = !isSystemSessionKey(params.sessionKey)
      ? readCrossChannelContextEvents({
          agentId: sessionAgentId,
          limit: 10,
          excludeSessionKey: params.sessionKey,
        })
      : undefined;

    markPhase("async_io_started");
    // Sync CPU work runs while I/O operations are in-flight
    const modelHasVision = modelSupportsImages(params.model);
    const discoveredToolsRef = { names: new Set(sessionDiscoveredTools ?? []) };
    const toolsRaw = params.disableTools
      ? []
      : createArgentCodingTools({
          exec: {
            ...params.execOverrides,
            elevated: params.bashElevated,
          },
          sandbox,
          messageProvider: params.messageChannel ?? params.messageProvider,
          agentAccountId: params.agentAccountId,
          messageTo: params.messageTo,
          messageThreadId: params.messageThreadId,
          groupId: params.groupId,
          groupChannel: params.groupChannel,
          groupSpace: params.groupSpace,
          spawnedBy: params.spawnedBy,
          senderId: params.senderId,
          senderName: params.senderName,
          senderUsername: params.senderUsername,
          senderE164: params.senderE164,
          senderIsOwner: params.senderIsOwner,
          sessionKey: params.sessionKey ?? params.sessionId,
          agentDir,
          workspaceDir: effectiveWorkspace,
          config: params.config,
          abortSignal: runAbortController.signal,
          runId: params.runId,
          modelProvider: params.model.provider,
          modelId: params.modelId,
          modelAuthMode: resolveModelAuthMode(params.model.provider, params.config),
          currentChannelId: params.currentChannelId,
          currentThreadTs: params.currentThreadTs,
          replyToMode: params.replyToMode,
          hasRepliedRef: params.hasRepliedRef,
          modelHasVision,
          requireExplicitMessageTarget:
            params.requireExplicitMessageTarget ?? isSubagentSessionKey(params.sessionKey),
          disableMessageTool: params.disableMessageTool,
          discoveredTools: sessionDiscoveredTools,
          discoveredToolsRef,
          isHeartbeat: params.isHeartbeat,
        });
    markPhase("tools_created");
    const tools = sanitizeToolsForGoogle({ tools: toolsRaw, provider: params.provider });
    logToolSchemasForGoogle({ tools, provider: params.provider });

    // Await async I/O results (started before sync tool creation)
    const [
      { bootstrapFiles: hookAdjustedBootstrapFiles, contextFiles },
      machineName,
      intentGate,
      docsPath,
      crossChannelEvents,
    ] = await Promise.all([
      bootstrapPromise,
      machineNamePromise,
      intentGatePromise,
      docsPathPromise,
      crossChannelPromise,
    ]);
    const workspaceNotes = hookAdjustedBootstrapFiles.some(
      (file) => file.name === DEFAULT_BOOTSTRAP_FILENAME && !file.missing,
    )
      ? ["Reminder: commit your changes in this workspace after edits."]
      : undefined;
    markPhase("async_io_done");
    const runtimeChannel = normalizeMessageChannel(params.messageChannel ?? params.messageProvider);
    let runtimeCapabilities = runtimeChannel
      ? (resolveChannelCapabilities({
          cfg: params.config,
          channel: runtimeChannel,
          accountId: params.agentAccountId,
        }) ?? [])
      : undefined;
    if (runtimeChannel === "telegram" && params.config) {
      const inlineButtonsScope = resolveTelegramInlineButtonsScope({
        cfg: params.config,
        accountId: params.agentAccountId ?? undefined,
      });
      if (inlineButtonsScope !== "off") {
        if (!runtimeCapabilities) {
          runtimeCapabilities = [];
        }
        if (
          !runtimeCapabilities.some((cap) => String(cap).trim().toLowerCase() === "inlinebuttons")
        ) {
          runtimeCapabilities.push("inlineButtons");
        }
      }
    }
    const reactionGuidance =
      runtimeChannel && params.config
        ? (() => {
            if (runtimeChannel === "telegram") {
              const resolved = resolveTelegramReactionLevel({
                cfg: params.config,
                accountId: params.agentAccountId ?? undefined,
              });
              const level = resolved.agentReactionGuidance;
              return level ? { level, channel: "Telegram" } : undefined;
            }
            if (runtimeChannel === "signal") {
              const resolved = resolveSignalReactionLevel({
                cfg: params.config,
                accountId: params.agentAccountId ?? undefined,
              });
              const level = resolved.agentReactionGuidance;
              return level ? { level, channel: "Signal" } : undefined;
            }
            return undefined;
          })()
        : undefined;
    const intentResolution = resolveEffectiveIntentForAgentIfAvailable({
      config: params.config,
      agentId: sessionAgentId,
    });
    if (intentResolution?.issues && intentResolution.issues.length > 0) {
      for (const issue of intentResolution.issues) {
        warnIntentOnce(`[intent] ${issue.path}: ${issue.message}`);
      }
      if (intentResolution.validationMode === "enforce") {
        throw new Error(
          `Intent hierarchy validation failed for agent "${sessionAgentId}" (${intentResolution.issues.length} issue(s)).`,
        );
      }
    }
    for (const warning of intentGate.warnings) {
      warnIntentOnce(`[intent] ${warning}`);
    }
    if (intentGate.evaluation.enabled) {
      if (intentGate.reportPath) {
        log.debug(`[intent] simulation gate report path: ${intentGate.reportPath}`);
      }
      if (intentGate.evaluation.aggregateScores) {
        const scores = intentGate.evaluation.aggregateScores;
        log.debug(
          `[intent] simulation components objective=${scores.objectiveAdherence.toFixed(2)} boundary=${scores.boundaryCompliance.toFixed(2)} escalation=${scores.escalationCorrectness.toFixed(2)} outcome=${scores.outcomeQuality.toFixed(2)}`,
        );
      }
      for (const reason of intentGate.evaluation.reasons) {
        warnIntentOnce(`[intent] simulation gate: ${reason}`);
      }
      if (intentGate.evaluation.blocking) {
        throw new Error(
          `Intent simulation gate blocked run for agent "${sessionAgentId}" (${intentGate.evaluation.reasons.length} reason(s)).`,
        );
      }
    }
    const intentPromptHint =
      intentResolution && intentResolution.runtimeMode !== "off"
        ? buildIntentSystemPromptHintIfAvailable(intentResolution.policy)
        : undefined;

    const crossChannelContextHint = crossChannelEvents
      ? buildCrossChannelContextBlock({
          currentSessionKey: params.sessionKey,
          events: crossChannelEvents,
        })
      : undefined;

    const effectiveExtraSystemPrompt = [
      params.extraSystemPrompt?.trim(),
      intentPromptHint?.trim(),
      crossChannelContextHint,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join("\n\n");
    const sandboxInfo = buildEmbeddedSandboxInfo(sandbox, params.bashElevated);
    const reasoningTagHint = isReasoningTagProvider(params.provider);
    // Resolve channel-specific message actions for system prompt
    const channelActions = runtimeChannel
      ? listChannelSupportedActions({
          cfg: params.config,
          channel: runtimeChannel,
        })
      : undefined;
    const messageToolHints = runtimeChannel
      ? resolveChannelMessageToolHints({
          cfg: params.config,
          channel: runtimeChannel,
          accountId: params.agentAccountId,
        })
      : undefined;

    const defaultModelRef = resolveDefaultModelForAgent({
      cfg: params.config ?? {},
      agentId: sessionAgentId,
    });
    const defaultModelLabel = `${defaultModelRef.provider}/${defaultModelRef.model}`;
    const { runtimeInfo, userTimezone, userTime, userTimeFormat } = buildSystemPromptParams({
      config: params.config,
      agentId: sessionAgentId,
      workspaceDir: effectiveWorkspace,
      cwd: process.cwd(),
      runtime: {
        host: machineName,
        os: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        node: process.version,
        model: `${params.provider}/${params.modelId}`,
        defaultModel: defaultModelLabel,
        channel: runtimeChannel,
        capabilities: runtimeCapabilities,
        channelActions,
      },
    });
    const isDefaultAgent = sessionAgentId === defaultAgentId;
    const promptMode = isSubagentSessionKey(params.sessionKey) ? "subagent" : "full";
    const ttsHint = params.config ? buildTtsSystemPromptHint(params.config) : undefined;

    const appendPrompt = await buildEmbeddedSystemPrompt({
      workspaceDir: effectiveWorkspace,
      defaultThinkLevel: params.thinkLevel,
      reasoningLevel: params.reasoningLevel ?? "off",
      extraSystemPrompt: effectiveExtraSystemPrompt || undefined,
      ownerNumbers: params.ownerNumbers,
      reasoningTagHint,
      heartbeatPrompt: isDefaultAgent
        ? resolveHeartbeatPrompt(params.config?.agents?.defaults?.heartbeat?.prompt)
        : undefined,
      skillsPrompt,
      docsPath: docsPath ?? undefined,
      ttsHint,
      workspaceNotes,
      reactionGuidance,
      promptMode,
      runtimeInfo,
      messageToolHints,
      sandboxInfo,
      tools,
      modelAliasLines: buildModelAliasLines(params.config),
      userTimezone,
      userTime,
      userTimeFormat,
      contextFiles,
      memoryCitationsMode: params.config?.memory?.citations,
      sessionKey: params.sessionKey,
    });
    const systemPromptReport = buildSystemPromptReport({
      source: "run",
      generatedAt: Date.now(),
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      provider: params.provider,
      model: params.modelId,
      workspaceDir: effectiveWorkspace,
      bootstrapMaxChars: resolveBootstrapMaxChars(params.config),
      sandbox: (() => {
        const runtime = resolveSandboxRuntimeStatus({
          cfg: params.config,
          sessionKey: params.sessionKey ?? params.sessionId,
        });
        return { mode: runtime.mode, sandboxed: runtime.sandboxed };
      })(),
      systemPrompt: appendPrompt,
      bootstrapFiles: hookAdjustedBootstrapFiles,
      injectedFiles: contextFiles,
      skillsPrompt,
      tools,
    });
    const systemPromptOverride = createSystemPromptOverride(appendPrompt);
    const systemPromptText = systemPromptOverride();

    const sessionLock = await acquireSessionWriteLock({
      sessionFile: params.sessionFile,
    });

    markPhase("pre_session");
    let sessionManager: ReturnType<typeof guardSessionManager> | undefined;
    let session:
      | Awaited<ReturnType<typeof createAgentSession>>["session"]
      | Awaited<ReturnType<typeof createArgentAgentSession>>["session"]
      | undefined;
    try {
      await repairSessionFileIfNeeded({
        sessionFile: params.sessionFile,
        warn: (message) => log.warn(message),
      });
      const hadSessionFile = await fs
        .stat(params.sessionFile)
        .then(() => true)
        .catch(() => false);

      const transcriptPolicy = resolveTranscriptPolicy({
        modelApi: params.model?.api,
        provider: params.provider,
        modelId: params.modelId,
      });

      await prewarmSessionFile(params.sessionFile);

      // Session manager: Argent-native when ARGENT_RUNTIME is enabled, Pi otherwise.
      // Both implement the same operations (appendMessage, getLeafEntry, branch, etc.)
      // so the guard wrapper and downstream code work with either.
      if (runtimePolicy.argentRuntimeEnabled) {
        const argentSm = ArgentSessionManager.open(params.sessionFile);
        sessionManager = guardSessionManager(argentSm as unknown as SessionManager, {
          agentId: sessionAgentId,
          sessionKey: params.sessionKey,
          allowSyntheticToolResults: transcriptPolicy.allowSyntheticToolResults,
        });
        log.info(`[argent-runtime] Using ArgentSessionManager for session`);
      } else {
        sessionManager = guardSessionManager(SessionManager.open(params.sessionFile), {
          agentId: sessionAgentId,
          sessionKey: params.sessionKey,
          allowSyntheticToolResults: transcriptPolicy.allowSyntheticToolResults,
        });
      }
      trackSessionManagerAccess(params.sessionFile);

      await prepareSessionManagerForRun({
        sessionManager,
        sessionFile: params.sessionFile,
        hadSessionFile,
        sessionId: params.sessionId,
        cwd: effectiveWorkspace,
      });

      // Settings manager: Argent-native when ARGENT_RUNTIME, Pi otherwise.
      let argentSettingsManager: ArgentSettingsManager | undefined;
      let piSettingsManager: SettingsManager | undefined;
      if (runtimePolicy.argentRuntimeEnabled) {
        argentSettingsManager = ArgentSettingsManager.create(effectiveWorkspace, agentDir);
        log.info(`[argent-runtime] Using ArgentSettingsManager`);
      } else {
        piSettingsManager = SettingsManager.create(effectiveWorkspace, agentDir);
        ensurePiCompactionReserveTokens({
          settingsManager: piSettingsManager,
          minReserveTokens: resolveCompactionReserveTokensFloor(params.config),
        });

        // Call for side effects (sets compaction/pruning runtime state on Pi session)
        buildEmbeddedExtensionPaths({
          cfg: params.config,
          sessionManager,
          provider: params.provider,
          modelId: params.modelId,
          model: params.model,
        });
      }

      const { builtInTools, customTools } = splitSdkTools({
        tools,
        sandboxEnabled: !!sandbox?.enabled,
      });

      // Add client tools (OpenResponses hosted tools) to customTools
      let clientToolCallDetected: { name: string; params: Record<string, unknown> } | null = null;
      const clientToolDefs = params.clientTools
        ? toClientToolDefinitions(
            params.clientTools,
            (toolName, toolParams) => {
              clientToolCallDetected = { name: toolName, params: toolParams };
            },
            {
              agentId: sessionAgentId,
              sessionKey: params.sessionKey,
            },
          )
        : [];

      const allCustomTools = [...customTools, ...clientToolDefs];

      // Agent session: Argent-native when ARGENT_RUNTIME, Pi otherwise.
      if (runtimePolicy.argentRuntimeEnabled) {
        ({ session } = await createArgentAgentSession({
          cwd: resolvedWorkspace,
          agentDir,
          sessionManager: sessionManager as unknown as ArgentSessionManager,
          settingsManager: argentSettingsManager as ArgentSettingsManager,
          model: params.model,
          thinkingLevel: mapThinkingLevel(params.thinkLevel),
          tools: tools,
        }));
        log.info(`[argent-runtime] Using createArgentAgentSession (tools=${tools.length})`);
      } else {
        ({ session } = await createAgentSession({
          cwd: resolvedWorkspace,
          agentDir,
          authStorage: params.authStorage,
          modelRegistry: params.modelRegistry,
          model: params.model,
          thinkingLevel: mapThinkingLevel(params.thinkLevel),
          tools: builtInTools,
          customTools: allCustomTools,
          sessionManager,
          settingsManager: piSettingsManager,
        }));
      }
      if (!session) {
        throw new Error("Embedded agent session missing");
      }
      // Cast to Pi's AgentSession for downstream compatibility — Argent session
      // implements the same runtime interface (setSystemPrompt, subscribe, prompt, etc.).
      const activeSession = session as AgentSession;
      const sessionBootstrapHint = buildSessionBootstrapBlock({
        nowMs: Date.now(),
        status: activeSession.messages.length > 0 ? "resumed" : "fresh",
        lastInteractionAtMs: sessionBootstrapSnapshot?.lastInteractionAtMs,
        lastSessionKey: sessionBootstrapSnapshot?.lastSessionKey,
        sessionClearedAtMs: sessionBootstrapSnapshot?.sessionClearedAtMs,
        sessionClearedFromKey: sessionBootstrapSnapshot?.sessionClearedFromKey,
        sessionClearedReason: sessionBootstrapSnapshot?.sessionClearedReason,
        fallbackChannel: runtimeChannel ?? undefined,
      });
      const effectiveSystemPromptText = [systemPromptText, sessionBootstrapHint]
        .filter((entry): entry is string => Boolean(entry))
        .join("\n\n");
      applySystemPromptOverrideToSession(activeSession, effectiveSystemPromptText);
      const cacheTrace = createCacheTrace({
        cfg: params.config,
        env: process.env,
        runId: params.runId,
        sessionId: activeSession.sessionId,
        sessionKey: params.sessionKey,
        provider: params.provider,
        modelId: params.modelId,
        modelApi: params.model.api,
        workspaceDir: params.workspaceDir,
      });
      const anthropicPayloadLogger = createAnthropicPayloadLogger({
        env: process.env,
        runId: params.runId,
        sessionId: activeSession.sessionId,
        sessionKey: params.sessionKey,
        provider: params.provider,
        modelId: params.modelId,
        modelApi: params.model.api,
        workspaceDir: params.workspaceDir,
      });

      // OpenAI Codex: Pi's streamSimple correctly dispatches to
      // streamSimpleOpenAICodexResponses (chatgpt.com/backend-api/codex/responses),
      // but it needs apiKey in options since getEnvApiKey has no mapping for openai-codex.
      // Wrap streamSimple to inject the OAuth JWT from authStorage.runtimeOverrides.
      const runtimeOverrides = (params.authStorage as AuthStorageWithRuntimeOverrides)
        .runtimeOverrides;
      const providerApiKey = runtimeOverrides?.get(params.provider);
      if (params.provider === "openai-codex") {
        const codexApiKey = providerApiKey;
        if (codexApiKey) {
          activeSession.agent.streamFn = (model, context, options) => {
            const effectiveModelId = resolveOpenAICodexVisionModelId({
              model,
              context,
              modelRegistry: params.modelRegistry,
            });
            const effectiveModel =
              effectiveModelId && effectiveModelId !== model.id
                ? ((params.modelRegistry.find(
                    "openai-codex",
                    effectiveModelId,
                  ) as Model<Api> | null) ?? model)
                : model;
            const transport = resolveOpenAICodexTransport(context);
            if (effectiveModel.id !== model.id) {
              log.info(
                `[openai-codex] Switching image-bearing turn ${model.id} -> ${effectiveModel.id}`,
              );
            }
            log.info(
              `[openai-codex] Using Pi streamSimple with injected OAuth JWT (${transport === "sse" ? "sse transport for inline images" : "websocket transport"})`,
            );
            return streamSimple(effectiveModel, context, {
              ...options,
              apiKey: codexApiKey,
              transport,
            });
          };
        } else {
          log.warn(
            `[openai-codex] No OAuth JWT found in runtimeOverrides, falling back to bare streamSimple`,
          );
          activeSession.agent.streamFn = streamSimple;
        }
      } else if (runtimePolicy.argentRuntimeEnabled) {
        try {
          const argentProvider = await resolveArgentProvider(
            params.provider,
            params.model.baseUrl,
            providerApiKey,
          );
          if (argentProvider) {
            activeSession.agent.streamFn = createArgentStreamSimple(argentProvider);
            log.info(`[argent-runtime] Using Argent provider for ${params.provider}`);
          } else {
            applyPiStreamFallbackPolicy(
              runtimePolicy.mode,
              `No Argent provider for "${params.provider}"`,
              () => {
                activeSession.agent.streamFn = streamSimple;
              },
            );
          }
        } catch (err) {
          applyPiStreamFallbackPolicy(
            runtimePolicy.mode,
            `Failed to create Argent provider for "${params.provider}"`,
            () => {
              activeSession.agent.streamFn = streamSimple;
            },
            err,
          );
        }
      } else {
        activeSession.agent.streamFn = streamSimple;
      }

      applyExtraParamsToAgent(
        activeSession.agent,
        params.config,
        params.provider,
        params.modelId,
        params.streamParams,
      );

      if (cacheTrace) {
        cacheTrace.recordStage("session:loaded", {
          messages: activeSession.messages,
          system: systemPromptText,
          note: "after session create",
        });
        activeSession.agent.streamFn = cacheTrace.wrapStreamFn(activeSession.agent.streamFn);
      }
      if (anthropicPayloadLogger) {
        activeSession.agent.streamFn = anthropicPayloadLogger.wrapStreamFn(
          activeSession.agent.streamFn,
        );
      }

      try {
        const prior = await sanitizeSessionHistory({
          messages: activeSession.messages,
          modelApi: params.model.api,
          modelId: params.modelId,
          provider: params.provider,
          sessionManager,
          sessionId: params.sessionId,
          policy: transcriptPolicy,
        });
        cacheTrace?.recordStage("session:sanitized", { messages: prior });
        const validatedGemini = transcriptPolicy.validateGeminiTurns
          ? validateGeminiTurns(prior)
          : prior;
        const validated = transcriptPolicy.validateAnthropicTurns
          ? validateAnthropicTurns(validatedGemini)
          : validatedGemini;
        const limited = limitHistoryTurns(
          validated,
          getDmHistoryLimitFromSessionKey(params.sessionKey, params.config),
        );
        cacheTrace?.recordStage("session:limited", { messages: limited });

        // Vision fallback: if model doesn't support images, describe inline images
        // via MiniMax VLM and replace them with text before sending to the LLM.
        const visionReady = await applyVisionFallbackToMessages(limited, {
          modelHasVision,
          minimaxBaseUrl: params.model.provider === "minimax" ? params.model.baseUrl : undefined,
        });

        if (visionReady.length > 0) {
          activeSession.agent.replaceMessages(visionReady);
        }
      } catch (err) {
        sessionManager.flushPendingToolResults?.();
        activeSession.dispose();
        throw err;
      }

      let aborted = Boolean(params.abortSignal?.aborted);
      let timedOut = false;
      const getAbortReason = (signal: AbortSignal): unknown =>
        "reason" in signal ? (signal as { reason?: unknown }).reason : undefined;
      const makeTimeoutAbortReason = (): Error => {
        const err = new Error("request timed out");
        err.name = "TimeoutError";
        return err;
      };
      const makeAbortError = (signal: AbortSignal): Error => {
        const reason = getAbortReason(signal);
        const err = reason ? new Error("aborted", { cause: reason }) : new Error("aborted");
        err.name = "AbortError";
        return err;
      };
      const abortRun = (isTimeout = false, reason?: unknown) => {
        aborted = true;
        if (isTimeout) {
          timedOut = true;
        }
        if (isTimeout) {
          runAbortController.abort(reason ?? makeTimeoutAbortReason());
        } else {
          runAbortController.abort(reason);
        }
        void activeSession.abort();
      };
      const abortable = <T>(promise: Promise<T>): Promise<T> => {
        const signal = runAbortController.signal;
        if (signal.aborted) {
          return Promise.reject(makeAbortError(signal));
        }
        return new Promise<T>((resolve, reject) => {
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(makeAbortError(signal));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          promise.then(
            (value) => {
              signal.removeEventListener("abort", onAbort);
              resolve(value);
            },
            (err) => {
              signal.removeEventListener("abort", onAbort);
              reject(err);
            },
          );
        });
      };

      markPhase("session_created");
      const subscription = subscribeEmbeddedPiSession({
        session: activeSession,
        runId: params.runId,
        verboseLevel: params.verboseLevel,
        reasoningMode: params.reasoningLevel ?? "off",
        toolResultFormat: params.toolResultFormat,
        shouldEmitToolResult: params.shouldEmitToolResult,
        shouldEmitToolOutput: params.shouldEmitToolOutput,
        onToolResult: params.onToolResult,
        onReasoningStream: params.onReasoningStream,
        onBlockReply: params.onBlockReply,
        onBlockReplyFlush: params.onBlockReplyFlush,
        blockReplyBreak: params.blockReplyBreak,
        blockReplyChunking: params.blockReplyChunking,
        onPartialReply: params.onPartialReply,
        onAssistantMessageStart: params.onAssistantMessageStart,
        onAgentEvent: params.onAgentEvent,
        enforceFinalTag: params.enforceFinalTag,
      });

      const {
        assistantTexts,
        toolMetas,
        unsubscribe,
        waitForCompactionRetry,
        getMessagingToolSentTexts,
        getMessagingToolSentTargets,
        getTaskMutationEvidence,
        didSendViaMessagingTool,
        getLastToolError,
      } = subscription;

      const queueHandle: EmbeddedPiQueueHandle = {
        queueMessage: async (text: string) => {
          await activeSession.steer(text);
        },
        isStreaming: () => activeSession.isStreaming,
        isCompacting: () => subscription.isCompacting(),
        abort: abortRun,
      };
      setActiveEmbeddedRun(params.sessionId, queueHandle);

      let abortWarnTimer: NodeJS.Timeout | undefined;
      const isProbeSession = params.sessionId?.startsWith("probe-") ?? false;
      const abortTimer = setTimeout(
        () => {
          if (!isProbeSession) {
            log.warn(
              `embedded run timeout: runId=${params.runId} sessionId=${params.sessionId} timeoutMs=${params.timeoutMs}`,
            );
          }
          abortRun(true);
          if (!abortWarnTimer) {
            abortWarnTimer = setTimeout(() => {
              if (!activeSession.isStreaming) {
                return;
              }
              if (!isProbeSession) {
                log.warn(
                  `embedded run abort still streaming: runId=${params.runId} sessionId=${params.sessionId}`,
                );
              }
            }, 10_000);
          }
        },
        Math.max(1, params.timeoutMs),
      );

      let messagesSnapshot: AgentMessage[] = [];
      let sessionIdUsed = activeSession.sessionId;
      const onAbort = () => {
        const reason = params.abortSignal ? getAbortReason(params.abortSignal) : undefined;
        const timeout = reason ? isTimeoutError(reason) : false;
        abortRun(timeout, reason);
      };
      if (params.abortSignal) {
        if (params.abortSignal.aborted) {
          onAbort();
        } else {
          params.abortSignal.addEventListener("abort", onAbort, {
            once: true,
          });
        }
      }

      // Get hook runner once for both before_agent_start and agent_end hooks
      const hookRunner = getGlobalHookRunner();
      // Track message boundary so fallback text only considers assistant output
      // produced by THIS run attempt (prevents replaying prior-turn assistant text).
      let promptStartMessageCount = activeSession.messages.length;

      markPhase("pre_prompt");
      let promptError: unknown = null;
      try {
        const promptStartedAt = Date.now();

        // Run before_agent_start hooks to allow plugins to inject context
        let effectivePrompt = params.prompt;
        if (hookRunner?.hasHooks("before_agent_start")) {
          try {
            const hookResult = await hookRunner.runBeforeAgentStart(
              {
                prompt: params.prompt,
                messages: activeSession.messages,
              },
              {
                agentId: params.sessionKey?.split(":")[0] ?? "main",
                sessionKey: params.sessionKey,
                workspaceDir: params.workspaceDir,
                messageProvider: params.messageProvider ?? undefined,
              },
            );
            if (hookResult?.prependContext) {
              effectivePrompt = `${hookResult.prependContext}\n\n${params.prompt}`;
              log.debug(
                `hooks: prepended context to prompt (${hookResult.prependContext.length} chars)`,
              );
            }
          } catch (hookErr) {
            log.warn(`before_agent_start hook failed: ${String(hookErr)}`);
          }
        }

        log.debug(`embedded run prompt start: runId=${params.runId} sessionId=${params.sessionId}`);
        cacheTrace?.recordStage("prompt:before", {
          prompt: effectivePrompt,
          messages: activeSession.messages,
        });

        // Repair orphaned trailing user messages so new prompts don't violate role ordering.
        const leafEntry = sessionManager.getLeafEntry();
        if (leafEntry?.type === "message" && leafEntry.message.role === "user") {
          if (leafEntry.parentId) {
            sessionManager.branch(leafEntry.parentId);
          } else {
            sessionManager.resetLeaf();
          }
          const sessionContext = sessionManager.buildSessionContext();
          activeSession.agent.replaceMessages(sessionContext.messages);
          log.warn(
            `Removed orphaned user message to prevent consecutive user turns. ` +
              `runId=${params.runId} sessionId=${params.sessionId}`,
          );
        }
        promptStartMessageCount = activeSession.messages.length;

        try {
          // Detect and load images referenced in the prompt for vision-capable models.
          // This eliminates the need for an explicit "view" tool call by injecting
          // images directly into the prompt when the model supports it.
          // Also scans conversation history to enable follow-up questions about earlier images.
          const imageResult = await detectAndLoadPromptImages({
            prompt: effectivePrompt,
            workspaceDir: effectiveWorkspace,
            model: params.model,
            existingImages: params.images,
            historyMessages: activeSession.messages,
            maxBytes: MAX_IMAGE_BYTES,
            // Enforce sandbox path restrictions when sandbox is enabled
            sandboxRoot: sandbox?.enabled ? sandbox.workspaceDir : undefined,
          });

          // Inject history images into their original message positions.
          // This ensures the model sees images in context (e.g., "compare to the first image").
          const didMutate = injectHistoryImagesIntoMessages(
            activeSession.messages,
            imageResult.historyImagesByIndex,
          );
          if (didMutate) {
            // Persist message mutations (e.g., injected history images) so we don't re-scan/reload.
            activeSession.agent.replaceMessages(activeSession.messages);
          }

          cacheTrace?.recordStage("prompt:images", {
            prompt: effectivePrompt,
            messages: activeSession.messages,
            note: `images: prompt=${imageResult.images.length} history=${imageResult.historyImagesByIndex.size}`,
          });

          const shouldTrackCacheTtl =
            params.config?.agents?.defaults?.contextPruning?.mode === "cache-ttl" &&
            isCacheTtlEligibleProvider(params.provider, params.modelId);
          if (shouldTrackCacheTtl) {
            appendCacheTtlTimestamp(sessionManager, {
              timestamp: Date.now(),
              provider: params.provider,
              modelId: params.modelId,
            });
          }

          // Only pass images option if there are actually images to pass
          // This avoids potential issues with models that don't expect the images parameter
          if (imageResult.images.length > 0) {
            await abortable(activeSession.prompt(effectivePrompt, { images: imageResult.images }));
          } else {
            await abortable(activeSession.prompt(effectivePrompt));
          }
        } catch (err) {
          promptError = err;
        } finally {
          markPhase("prompt_done");
          log.info(
            `[tony-stark] runId=${params.runId} phases: ${Object.entries(phaseTimes)
              .map(([k, v]) => `${k}=${v}ms`)
              .join(
                " ",
              )} total=${Date.now() - t0}ms provider=${params.provider} model=${params.modelId} tools=${tools.length}`,
          );
          log.debug(
            `embedded run prompt end: runId=${params.runId} sessionId=${params.sessionId} durationMs=${Date.now() - promptStartedAt}`,
          );
        }

        try {
          await waitForCompactionRetry();
        } catch (err) {
          if (isAbortError(err)) {
            if (!promptError) {
              promptError = err;
            }
          } else {
            throw err;
          }
        }

        messagesSnapshot = activeSession.messages.slice();
        sessionIdUsed = activeSession.sessionId;
        cacheTrace?.recordStage("session:after", {
          messages: messagesSnapshot,
          note: promptError ? "prompt error" : undefined,
        });
        anthropicPayloadLogger?.recordUsage(messagesSnapshot, promptError);

        // Run agent_end hooks to allow plugins to analyze the conversation
        // This is fire-and-forget, so we don't await
        if (hookRunner?.hasHooks("agent_end")) {
          hookRunner
            .runAgentEnd(
              {
                messages: messagesSnapshot,
                success: !aborted && !promptError,
                error: promptError ? describeUnknownError(promptError) : undefined,
                durationMs: Date.now() - promptStartedAt,
              },
              {
                agentId: params.sessionKey?.split(":")[0] ?? "main",
                sessionKey: params.sessionKey,
                workspaceDir: params.workspaceDir,
                messageProvider: params.messageProvider ?? undefined,
              },
            )
            .catch((err) => {
              log.warn(`agent_end hook failed: ${err}`);
            });
        }
      } finally {
        clearTimeout(abortTimer);
        if (abortWarnTimer) {
          clearTimeout(abortWarnTimer);
        }
        unsubscribe();
        clearActiveEmbeddedRun(params.sessionId, queueHandle);
        params.abortSignal?.removeEventListener?.("abort", onAbort);
      }

      const lastAssistant = messagesSnapshot
        .slice(promptStartMessageCount)
        .toReversed()
        .find((m) => m.role === "assistant");

      const toolMetasNormalized = toolMetas
        .filter(
          (entry): entry is { toolName: string; meta?: string } =>
            typeof entry.toolName === "string" && entry.toolName.trim().length > 0,
        )
        .map((entry) => ({ toolName: entry.toolName, meta: entry.meta }));

      const messagingToolSentTexts = getMessagingToolSentTexts();
      const messagingToolSentTargets = getMessagingToolSentTargets();
      const didSendViaMessaging = didSendViaMessagingTool();

      if (!aborted && !promptError && !isSystemSessionKey(params.sessionKey)) {
        const assistantTextCandidate =
          assistantTexts.at(-1)?.trim() || extractAssistantTextForContext(lastAssistant);
        const sharedSummary = selectCrossChannelEventSummary({
          assistantText: assistantTextCandidate,
          toolMetas: toolMetasNormalized,
          messagingToolSentTexts,
        });
        if (sharedSummary && params.sessionKey) {
          await appendCrossChannelContextEvent({
            agentId: sessionAgentId,
            sessionKey: params.sessionKey,
            sessionId: sessionIdUsed,
            runId: params.runId,
            channel: inferSessionChannelFromKey(params.sessionKey, runtimeChannel ?? undefined),
            summary: sharedSummary,
            timestampMs: Date.now(),
          });
        }
      }

      // Persist newly discovered deferred tools to session state
      if (
        discoveredToolsRef.names.size > 0 &&
        params.config?.agents?.defaults?.toolSearch?.enabled
      ) {
        const prevNames = sessionDiscoveredTools ?? new Set<string>();
        const hasNew = [...discoveredToolsRef.names].some((n) => !prevNames.has(n));
        if (hasNew) {
          try {
            const storePath = resolveStorePath(params.config?.session?.store, {
              agentId: sessionAgentId,
            });
            const sessionKey = params.sessionKey ?? params.sessionId;
            await updateSessionStore(storePath, (store) => {
              const entry = store[sessionKey];
              if (entry) {
                entry.discoveredTools = [...discoveredToolsRef.names];
              }
            });
          } catch (err) {
            log.debug(`failed to persist discovered tools: ${String(err)}`);
          }
        }
      }

      return {
        aborted,
        timedOut,
        promptError,
        sessionIdUsed,
        systemPromptReport,
        messagesSnapshot,
        assistantTexts,
        toolMetas: toolMetasNormalized,
        taskMutationEvidence: getTaskMutationEvidence(),
        lastAssistant,
        lastToolError: getLastToolError?.(),
        didSendViaMessagingTool: didSendViaMessaging,
        messagingToolSentTexts,
        messagingToolSentTargets,
        cloudCodeAssistFormatError: Boolean(
          lastAssistant?.errorMessage && isCloudCodeAssistFormatError(lastAssistant.errorMessage),
        ),
        // Client tool call detected (OpenResponses hosted tools)
        clientToolCall: clientToolCallDetected ?? undefined,
      };
    } finally {
      // Always tear down the session (and release the lock) before we leave this attempt.
      sessionManager?.flushPendingToolResults?.();
      session?.dispose();
      await sessionLock.release();
    }
  } finally {
    restoreSkillEnv?.();
    process.chdir(prevCwd);
  }
}
