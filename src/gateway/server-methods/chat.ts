import fs from "node:fs";
import path from "node:path";
import type { MsgContext } from "../../auto-reply/templating.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";
import { CURRENT_SESSION_VERSION, SessionManager } from "../../agent-core/coding.js";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { isModelProviderAvailableForAutomaticRouting } from "../../agents/model-auth.js";
import {
  buildAllowedModelSet,
  modelKey,
  normalizeProviderId,
  resolveBestReasoningModel,
  resolveThinkingDefault,
} from "../../agents/model-selection.js";
import { queueEmbeddedPiMessage } from "../../agents/pi-embedded.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { dispatchInboundMessage } from "../../auto-reply/dispatch.js";
import { createReplyDispatcher } from "../../auto-reply/reply/reply-dispatcher.js";
import { createReplyPrefixOptions } from "../../channels/reply-prefix.js";
import { updateSessionStore, type SessionEntry } from "../../config/sessions.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import { loadOptionalExport } from "../../utils/optional-module.js";
import {
  abortChatRunById,
  abortChatRunsForSessionKey,
  isChatStopCommandText,
  resolveChatRunExpiresAtMs,
} from "../chat-abort.js";
import { type ChatImageContent, parseMessageWithAttachments } from "../chat-attachments.js";
import { sanitizeChatHistoryMessages, sanitizeChatMessageForDisplay } from "../chat-sanitize.js";
import { GATEWAY_CLIENT_CAPS, hasGatewayClientCap } from "../protocol/client-info.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChatAbortParams,
  validateChatHistoryParams,
  validateChatInjectParams,
  validateChatSendParams,
} from "../protocol/index.js";
import { getMaxChatHistoryMessagesBytes } from "../server-constants.js";
import {
  capArrayByJsonBytes,
  loadSessionEntry,
  readSessionMessages,
  resolveSessionModelRef,
} from "../session-utils.js";
import { formatForLog } from "../ws-log.js";
import { injectTimestamp, timestampOptsFromConfig } from "./agent-timestamp.js";

type TranscriptAppendResult = {
  ok: boolean;
  messageId?: string;
  message?: Record<string, unknown>;
  error?: string;
};

type AppendMessageArg = Parameters<SessionManager["appendMessage"]>[0];

function resolveTranscriptPath(params: {
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
}): string | null {
  const { sessionId, storePath, sessionFile } = params;
  if (sessionFile) {
    return sessionFile;
  }
  if (!storePath) {
    return null;
  }
  return path.join(path.dirname(storePath), `${sessionId}.jsonl`);
}

function ensureTranscriptFile(params: { transcriptPath: string; sessionId: string }): {
  ok: boolean;
  error?: string;
} {
  if (fs.existsSync(params.transcriptPath)) {
    return { ok: true };
  }
  try {
    fs.mkdirSync(path.dirname(params.transcriptPath), { recursive: true });
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: params.sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    fs.writeFileSync(params.transcriptPath, `${JSON.stringify(header)}\n`, "utf-8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function appendAssistantTranscriptMessage(params: {
  message: string;
  label?: string;
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  createIfMissing?: boolean;
}): TranscriptAppendResult {
  const transcriptPath = resolveTranscriptPath({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
  });
  if (!transcriptPath) {
    return { ok: false, error: "transcript path not resolved" };
  }

  if (!fs.existsSync(transcriptPath)) {
    if (!params.createIfMissing) {
      return { ok: false, error: "transcript file not found" };
    }
    const ensured = ensureTranscriptFile({
      transcriptPath,
      sessionId: params.sessionId,
    });
    if (!ensured.ok) {
      return { ok: false, error: ensured.error ?? "failed to create transcript file" };
    }
  }

  const now = Date.now();
  const labelPrefix = params.label ? `[${params.label}]\n\n` : "";
  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
  const messageBody: AppendMessageArg & Record<string, unknown> = {
    role: "assistant",
    content: [{ type: "text", text: `${labelPrefix}${params.message}` }],
    timestamp: now,
    // Pi stopReason is a strict enum; this is not model output, but we still store it as a
    // normal assistant message so it participates in the session parentId chain.
    stopReason: "stop",
    usage,
    // Make these explicit so downstream tooling never treats this as model output.
    api: "openai-responses",
    provider: "argentos",
    model: "gateway-injected",
  };

  try {
    // IMPORTANT: Use SessionManager so the entry is attached to the current leaf via parentId.
    // Raw jsonl appends break the parent chain and can hide compaction summaries from context.
    const sessionManager = SessionManager.open(transcriptPath);
    const messageId = sessionManager.appendMessage(messageBody);
    return { ok: true, messageId, message: messageBody };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function nextChatSeq(context: { agentRunSeq: Map<string, number> }, runId: string) {
  const next = (context.agentRunSeq.get(runId) ?? 0) + 1;
  context.agentRunSeq.set(runId, next);
  return next;
}

function broadcastChatFinal(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession" | "agentRunSeq">;
  runId: string;
  sessionKey: string;
  message?: Record<string, unknown>;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const sanitizedMessage = sanitizeChatMessageForDisplay(params.message);
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    seq,
    state: "final" as const,
    message:
      sanitizedMessage && typeof sanitizedMessage === "object"
        ? (sanitizedMessage as Record<string, unknown>)
        : undefined,
  };
  params.context.broadcast("chat", payload);
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
}

function resolveRouterPowerfulModel(cfg: ReturnType<typeof loadSessionEntry>["cfg"]) {
  const router = cfg.agents?.defaults?.modelRouter;
  if (!router?.enabled) {
    return null;
  }
  const activeProfileName = router.activeProfile ?? "balanced";
  const activeProfile = router.profiles?.[activeProfileName];
  const powerful = activeProfile?.tiers?.powerful;
  const provider = normalizeProviderId(String(powerful?.provider ?? ""));
  const model = String(powerful?.model ?? "").trim();
  if (!provider || !model) {
    return null;
  }
  return { provider, model };
}

function broadcastChatError(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession" | "agentRunSeq">;
  runId: string;
  sessionKey: string;
  errorMessage?: string;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    seq,
    state: "error" as const,
    errorMessage: params.errorMessage,
  };
  params.context.broadcast("chat", payload);
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
}

function buildSpecforgeToolDirective(userMessage: string): string {
  return [
    "[SpecForge Directive]",
    "Before replying, call tool `specforge` with action=handle for this exact user message.",
    `Use payload: {"action":"handle","message":${JSON.stringify(userMessage)}}`,
    "Then continue the conversation using the tool result.",
  ].join("\n");
}

const shouldInvokeSpecforgeToolForMessageOptional = loadOptionalExport<
  (params: { sessionKey?: string; message: string }) => Promise<boolean>
>(import.meta.url, "../../infra/specforge-conductor.js", "shouldInvokeSpecforgeToolForMessage");

export const chatHandlers: GatewayRequestHandlers = {
  "chat.history": async ({ params, respond, context }) => {
    if (!validateChatHistoryParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.history params: ${formatValidationErrors(validateChatHistoryParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, limit } = params as {
      sessionKey: string;
      limit?: number;
    };
    const { cfg, storePath, entry } = loadSessionEntry(sessionKey);
    const sessionId = entry?.sessionId;
    const rawMessages =
      sessionId && storePath ? readSessionMessages(sessionId, storePath, entry?.sessionFile) : [];
    const hardMax = 1000;
    const defaultLimit = 200;
    const requested = typeof limit === "number" ? limit : defaultLimit;
    const max = Math.min(hardMax, requested);
    const sliced = rawMessages.length > max ? rawMessages.slice(-max) : rawMessages;
    const sanitized = sanitizeChatHistoryMessages(sliced);
    const capped = capArrayByJsonBytes(sanitized, getMaxChatHistoryMessagesBytes()).items;
    let thinkingLevel = entry?.thinkingLevel;
    if (!thinkingLevel) {
      const configured = cfg.agents?.defaults?.thinkingDefault;
      if (configured) {
        thinkingLevel = configured;
      } else {
        const sessionAgentId = resolveSessionAgentId({ sessionKey, config: cfg });
        const { provider, model } = resolveSessionModelRef(cfg, entry, sessionAgentId);
        const catalog = await context.loadGatewayModelCatalog();
        thinkingLevel = resolveThinkingDefault({
          cfg,
          provider,
          model,
          catalog,
        });
      }
    }
    const verboseLevel = entry?.verboseLevel ?? cfg.agents?.defaults?.verboseDefault;
    respond(true, {
      sessionKey,
      sessionId,
      messages: capped,
      thinkingLevel,
      verboseLevel,
    });
  },
  "chat.abort": ({ params, respond, context }) => {
    if (!validateChatAbortParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.abort params: ${formatValidationErrors(validateChatAbortParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, runId } = params as {
      sessionKey: string;
      runId?: string;
    };

    const ops = {
      chatAbortControllers: context.chatAbortControllers,
      chatRunBuffers: context.chatRunBuffers,
      chatDeltaSentAt: context.chatDeltaSentAt,
      chatAbortedRuns: context.chatAbortedRuns,
      removeChatRun: context.removeChatRun,
      agentRunSeq: context.agentRunSeq,
      broadcast: context.broadcast,
      nodeSendToSession: context.nodeSendToSession,
    };

    if (!runId) {
      const res = abortChatRunsForSessionKey(ops, {
        sessionKey,
        stopReason: "rpc",
      });
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }

    const active = context.chatAbortControllers.get(runId);
    if (!active) {
      respond(true, { ok: true, aborted: false, runIds: [] });
      return;
    }
    if (active.sessionKey !== sessionKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "runId does not match sessionKey"),
      );
      return;
    }

    const res = abortChatRunById(ops, {
      runId,
      sessionKey,
      stopReason: "rpc",
    });
    respond(true, {
      ok: true,
      aborted: res.aborted,
      runIds: res.aborted ? [runId] : [],
    });
  },
  "chat.send": async ({ params, respond, context, client }) => {
    if (!validateChatSendParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.send params: ${formatValidationErrors(validateChatSendParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      sessionKey: string;
      message: string;
      busyMode?: "cue" | "steer";
      thinking?: string;
      model?: string;
      deliver?: boolean;
      cliMcpServers?: Record<string, Record<string, unknown>>;
      attachments?: Array<{
        type?: string;
        mimeType?: string;
        fileName?: string;
        content?: unknown;
      }>;
      timeoutMs?: number;
      idempotencyKey: string;
    };
    const stopCommand = isChatStopCommandText(p.message);
    const normalizedAttachments =
      p.attachments
        ?.map((a) => ({
          type: typeof a?.type === "string" ? a.type : undefined,
          mimeType: typeof a?.mimeType === "string" ? a.mimeType : undefined,
          fileName: typeof a?.fileName === "string" ? a.fileName : undefined,
          content:
            typeof a?.content === "string"
              ? a.content
              : ArrayBuffer.isView(a?.content)
                ? Buffer.from(
                    a.content.buffer,
                    a.content.byteOffset,
                    a.content.byteLength,
                  ).toString("base64")
                : undefined,
        }))
        .filter((a) => a.content) ?? [];
    const rawMessage = p.message.trim();
    if (!rawMessage && normalizedAttachments.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "message or attachment required"),
      );
      return;
    }
    let parsedMessage = p.message;
    let parsedImages: ChatImageContent[] = [];
    if (normalizedAttachments.length > 0) {
      try {
        const parsed = await parseMessageWithAttachments(p.message, normalizedAttachments, {
          maxBytes: 5_000_000,
          log: context.logGateway,
        });
        parsedMessage = parsed.message;
        parsedImages = parsed.images;
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
        return;
      }
    }
    const { cfg, entry, storePath, canonicalKey, store } = loadSessionEntry(p.sessionKey);
    const timeoutMs = resolveAgentTimeoutMs({
      cfg,
      overrideMs: p.timeoutMs,
    });
    const now = Date.now();
    const clientRunId = p.idempotencyKey;
    let prevLastUserMessageAt: number | undefined = entry?.lastUserMessageAt;
    let prevLastUserSessionKey: string | undefined = canonicalKey;
    if (prevLastUserMessageAt === undefined && canonicalKey !== "__lastUserMessage") {
      const globalEntry = store["__lastUserMessage"] as SessionEntry | undefined;
      // Keep elapsed-time fallback scoped to the current agent store.
      prevLastUserMessageAt =
        globalEntry?.lastUserMessageAt ?? globalEntry?.previousLastUserMessageAt;
      prevLastUserSessionKey =
        globalEntry?.lastInteractionSessionKey ?? globalEntry?.previousSessionKey;
    }

    if (storePath && canonicalKey) {
      await updateSessionStore(storePath, (nextStore) => {
        const currentEntry = (nextStore[canonicalKey] ?? entry) as SessionEntry | undefined;
        const sessionId = currentEntry?.sessionId;
        if (sessionId) {
          nextStore[canonicalKey] = {
            ...currentEntry,
            sessionId,
            updatedAt: now,
            lastUserMessageAt: now,
          };
        }

        const globalEntry = nextStore["__lastUserMessage"] as SessionEntry | undefined;
        const previousLastAt =
          globalEntry?.lastUserMessageAt ?? prevLastUserMessageAt ?? globalEntry?.updatedAt;
        const previousSessionKey = globalEntry?.lastInteractionSessionKey ?? prevLastUserSessionKey;
        nextStore["__lastUserMessage"] = {
          ...globalEntry,
          sessionId: globalEntry?.sessionId ?? sessionId ?? entry?.sessionId ?? canonicalKey,
          previousLastUserMessageAt: previousLastAt,
          previousSessionKey,
          lastUserMessageAt: now,
          lastInteractionSessionKey: canonicalKey,
          sessionClearedAt: undefined,
          sessionClearedFromKey: undefined,
          sessionClearedReason: undefined,
          updatedAt: now,
        };
      });
    }

    const sendPolicy = resolveSendPolicy({
      cfg,
      entry,
      sessionKey: p.sessionKey,
      channel: entry?.channel,
      chatType: entry?.chatType,
    });
    if (sendPolicy === "deny") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "send blocked by session policy"),
      );
      return;
    }

    if (stopCommand) {
      const res = abortChatRunsForSessionKey(
        {
          chatAbortControllers: context.chatAbortControllers,
          chatRunBuffers: context.chatRunBuffers,
          chatDeltaSentAt: context.chatDeltaSentAt,
          chatAbortedRuns: context.chatAbortedRuns,
          removeChatRun: context.removeChatRun,
          agentRunSeq: context.agentRunSeq,
          broadcast: context.broadcast,
          nodeSendToSession: context.nodeSendToSession,
        },
        { sessionKey: p.sessionKey, stopReason: "stop" },
      );
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }

    const cached = context.dedupe.get(`chat:${clientRunId}`);
    if (cached) {
      respond(cached.ok, cached.payload, cached.error, {
        cached: true,
      });
      return;
    }

    const activeExisting = context.chatAbortControllers.get(clientRunId);
    if (activeExisting) {
      respond(true, { runId: clientRunId, status: "in_flight" as const }, undefined, {
        cached: true,
        runId: clientRunId,
      });
      return;
    }

    const busyMode = p.busyMode === "steer" ? "steer" : "cue";
    const activeRunForSession = Array.from(context.chatAbortControllers.entries()).find(
      ([, active]) => active.sessionKey === p.sessionKey,
    );
    if (busyMode === "steer") {
      if (parsedImages.length > 0) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "busyMode=steer does not support image attachments",
          ),
        );
        return;
      }
      const steerText = parsedMessage.trim();
      if (!steerText) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "busyMode=steer requires a text message"),
        );
        return;
      }
      if (!activeRunForSession) {
        const payload = {
          runId: clientRunId,
          status: "not_active" as const,
        };
        context.dedupe.set(`chat:${clientRunId}`, {
          ts: Date.now(),
          ok: true,
          payload,
        });
        respond(true, payload, undefined, { runId: clientRunId });
        return;
      }
      const [targetRunId, activeRun] = activeRunForSession;
      const steered = queueEmbeddedPiMessage(activeRun.sessionId, steerText);
      if (!steered) {
        const payload = {
          runId: clientRunId,
          status: "not_steerable" as const,
          targetRunId,
        };
        context.dedupe.set(`chat:${clientRunId}`, {
          ts: Date.now(),
          ok: true,
          payload,
        });
        respond(true, payload, undefined, { runId: clientRunId });
        return;
      }
      const payload = {
        runId: clientRunId,
        status: "steered" as const,
        targetRunId,
      };
      context.dedupe.set(`chat:${clientRunId}`, {
        ts: Date.now(),
        ok: true,
        payload,
      });
      respond(true, payload, undefined, { runId: clientRunId });
      return;
    }

    try {
      const abortController = new AbortController();
      context.chatAbortControllers.set(clientRunId, {
        controller: abortController,
        sessionId: entry?.sessionId ?? clientRunId,
        sessionKey: p.sessionKey,
        startedAtMs: now,
        expiresAtMs: resolveChatRunExpiresAtMs({ now, timeoutMs }),
      });
      const ackPayload = {
        runId: clientRunId,
        status: "started" as const,
      };
      respond(true, ackPayload, undefined, { runId: clientRunId });

      const trimmedMessage = parsedMessage.trim();
      const isCommand = trimmedMessage.startsWith("/");
      const injectThinking = Boolean(
        p.thinking && p.thinking !== "default" && trimmedMessage && !isCommand,
      );
      const resetThinking = p.thinking === "default" && trimmedMessage && !isCommand;
      let specforgeDirective = "";
      if (trimmedMessage && !isCommand && shouldInvokeSpecforgeToolForMessageOptional) {
        const shouldInvokeSpecforge = await shouldInvokeSpecforgeToolForMessageOptional({
          sessionKey: p.sessionKey,
          message: parsedMessage,
        });
        if (shouldInvokeSpecforge) {
          specforgeDirective = buildSpecforgeToolDirective(parsedMessage);
        }
      }

      // Resolve model override for deep-think. Prefer the operator's configured powerful tier
      // before falling back to the catalog so unconfigured hosted providers are not chosen.
      let modelOverridePrefix = "";
      if (injectThinking && p.thinking === "xhigh") {
        try {
          const catalog = await context.loadGatewayModelCatalog();
          const { cfg: innerCfg } = loadSessionEntry(p.sessionKey);
          const allowed = buildAllowedModelSet({
            cfg: innerCfg,
            catalog,
            defaultProvider: "anthropic",
          });
          const routerPowerful = resolveRouterPowerfulModel(innerCfg);
          const best =
            routerPowerful &&
            isModelProviderAvailableForAutomaticRouting({
              cfg: innerCfg,
              provider: routerPowerful.provider,
            }) &&
            (allowed.allowAny ||
              allowed.allowedKeys.has(modelKey(routerPowerful.provider, routerPowerful.model)))
              ? routerPowerful
              : resolveBestReasoningModel({
                  catalog,
                  allowedKeys: allowed.allowedKeys,
                  allowAny: allowed.allowAny,
                  providerEligible: (provider) =>
                    isModelProviderAvailableForAutomaticRouting({ cfg: innerCfg, provider }),
                });
          if (best) {
            modelOverridePrefix = `/model ${best.provider}/${best.model} `;
          }
        } catch {
          // Non-fatal: proceed without model override
        }
      }

      let commandBody = parsedMessage;
      if (specforgeDirective) {
        commandBody = `${commandBody}\n\n${specforgeDirective}`;
      }
      if (resetThinking) {
        commandBody = `/think off ${commandBody}`;
      } else if (injectThinking) {
        commandBody = `${modelOverridePrefix}/think ${p.thinking} ${commandBody}`;
      }
      const clientInfo = client?.connect?.client;
      // Inject timestamp so agents know the current date/time.
      // Only BodyForAgent gets the timestamp — Body stays raw for UI display.
      // See: https://github.com/ArgentAIOS/argentos/issues/3658
      const stampedMessage = injectTimestamp(
        parsedMessage,
        timestampOptsFromConfig(cfg, prevLastUserMessageAt),
      );
      const stampedForAgent = specforgeDirective
        ? `${stampedMessage}\n\n${specforgeDirective}`
        : stampedMessage;

      const ctx: MsgContext = {
        Body: parsedMessage,
        BodyForAgent: stampedForAgent,
        BodyForCommands: commandBody,
        RawBody: parsedMessage,
        CommandBody: commandBody,
        SessionKey: p.sessionKey,
        Provider: INTERNAL_MESSAGE_CHANNEL,
        Surface: INTERNAL_MESSAGE_CHANNEL,
        OriginatingChannel: INTERNAL_MESSAGE_CHANNEL,
        ChatType: "direct",
        CommandAuthorized: true,
        MessageSid: clientRunId,
        SenderId: clientInfo?.id,
        SenderName: clientInfo?.displayName,
        SenderUsername: clientInfo?.displayName,
        GatewayClientScopes: client?.connect?.scopes,
      };

      const agentId = resolveSessionAgentId({
        sessionKey: p.sessionKey,
        config: cfg,
      });
      const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
        cfg,
        agentId,
        channel: INTERNAL_MESSAGE_CHANNEL,
      });
      const finalReplyParts: string[] = [];
      const dispatcher = createReplyDispatcher({
        ...prefixOptions,
        onError: (err) => {
          context.logGateway.warn(`webchat dispatch failed: ${formatForLog(err)}`);
        },
        deliver: async (payload, info) => {
          if (info.kind !== "final") {
            return;
          }
          const text = payload.text?.trim() ?? "";
          if (!text) {
            return;
          }
          finalReplyParts.push(text);
        },
      });

      let agentRunStarted = false;
      void dispatchInboundMessage({
        ctx,
        cfg,
        dispatcher,
        replyOptions: {
          runId: clientRunId,
          abortSignal: abortController.signal,
          images: parsedImages.length > 0 ? parsedImages : undefined,
          cliMcpServers: p.cliMcpServers,
          disableBlockStreaming: true,
          onAgentRunStart: (runId) => {
            agentRunStarted = true;
            const connId = typeof client?.connId === "string" ? client.connId : undefined;
            const wantsToolEvents = hasGatewayClientCap(
              client?.connect?.caps,
              GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
            );
            if (connId && wantsToolEvents) {
              context.registerToolEventRecipient(runId, connId);
            }
          },
          onModelSelected,
        },
      })
        .then(() => {
          if (!agentRunStarted) {
            const combinedReply = finalReplyParts
              .map((part) => part.trim())
              .filter(Boolean)
              .join("\n\n")
              .trim();
            let message: Record<string, unknown> | undefined;
            if (combinedReply) {
              const { storePath: latestStorePath, entry: latestEntry } = loadSessionEntry(
                p.sessionKey,
              );
              const sessionId = latestEntry?.sessionId ?? entry?.sessionId ?? clientRunId;
              const appended = appendAssistantTranscriptMessage({
                message: combinedReply,
                sessionId,
                storePath: latestStorePath,
                sessionFile: latestEntry?.sessionFile,
                createIfMissing: true,
              });
              if (appended.ok) {
                message = appended.message;
              } else {
                context.logGateway.warn(
                  `webchat transcript append failed: ${appended.error ?? "unknown error"}`,
                );
                const fallbackTimestamp = Date.now();
                message = {
                  role: "assistant",
                  content: [{ type: "text", text: combinedReply }],
                  timestamp: fallbackTimestamp,
                  // Keep this compatible with Pi stopReason enums even though this message isn't
                  // persisted to the transcript due to the append failure.
                  stopReason: "stop",
                  usage: { input: 0, output: 0, totalTokens: 0 },
                };
              }
            }
            broadcastChatFinal({
              context,
              runId: clientRunId,
              sessionKey: p.sessionKey,
              message,
            });
          }
          context.dedupe.set(`chat:${clientRunId}`, {
            ts: Date.now(),
            ok: true,
            payload: { runId: clientRunId, status: "ok" as const },
          });
        })
        .catch((err) => {
          const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
          context.dedupe.set(`chat:${clientRunId}`, {
            ts: Date.now(),
            ok: false,
            payload: {
              runId: clientRunId,
              status: "error" as const,
              summary: String(err),
            },
            error,
          });
          broadcastChatError({
            context,
            runId: clientRunId,
            sessionKey: p.sessionKey,
            errorMessage: String(err),
          });
        })
        .finally(() => {
          context.chatAbortControllers.delete(clientRunId);
        });
    } catch (err) {
      const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
      const payload = {
        runId: clientRunId,
        status: "error" as const,
        summary: String(err),
      };
      context.dedupe.set(`chat:${clientRunId}`, {
        ts: Date.now(),
        ok: false,
        payload,
        error,
      });
      respond(false, payload, error, {
        runId: clientRunId,
        error: formatForLog(err),
      });
    }
  },
  "chat.inject": async ({ params, respond, context }) => {
    if (!validateChatInjectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.inject params: ${formatValidationErrors(validateChatInjectParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      sessionKey: string;
      message: string;
      label?: string;
    };

    // Load session to find transcript file
    const { storePath, entry } = loadSessionEntry(p.sessionKey);
    const sessionId = entry?.sessionId;
    if (!sessionId || !storePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session not found"));
      return;
    }

    const appended = appendAssistantTranscriptMessage({
      message: p.message,
      label: p.label,
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      createIfMissing: false,
    });
    if (!appended.ok || !appended.messageId || !appended.message) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to write transcript: ${appended.error ?? "unknown error"}`,
        ),
      );
      return;
    }

    // Broadcast to webchat for immediate UI update
    const sanitizedInjectedMessage = sanitizeChatMessageForDisplay(appended.message);
    const chatPayload = {
      runId: `inject-${appended.messageId}`,
      sessionKey: p.sessionKey,
      seq: 0,
      state: "final" as const,
      message:
        sanitizedInjectedMessage && typeof sanitizedInjectedMessage === "object"
          ? (sanitizedInjectedMessage as Record<string, unknown>)
          : undefined,
    };
    context.broadcast("chat", chatPayload);
    context.nodeSendToSession(p.sessionKey, "chat", chatPayload);

    respond(true, { ok: true, messageId: appended.messageId });
  },
};
