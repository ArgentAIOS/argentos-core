import { randomUUID } from "node:crypto";
import type { GatewayRequestHandlers } from "./types.js";
import { listAgentIds } from "../../agents/agent-scope.js";
import { isEmbeddedPiRunActive, queueEmbeddedPiMessage } from "../../agents/pi-embedded.js";
import { agentCommand } from "../../commands/agent.js";
import { loadConfig } from "../../config/config.js";
import {
  resolveAgentIdFromSessionKey,
  resolveExplicitAgentSessionKey,
  resolveAgentMainSessionKey,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { registerAgentRunContext } from "../../infra/agent-events.js";
import {
  resolveAgentDeliveryPlan,
  resolveAgentOutboundTarget,
} from "../../infra/outbound/agent-delivery.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { normalizeSessionDeliveryFields } from "../../utils/delivery-context.js";
import {
  INTERNAL_MESSAGE_CHANNEL,
  isDeliverableMessageChannel,
  isGatewayMessageChannel,
  normalizeMessageChannel,
} from "../../utils/message-channel.js";
import { resolveAssistantIdentity } from "../assistant-identity.js";
import { parseMessageWithAttachments } from "../chat-attachments.js";
import { resolveAssistantAvatarUrl } from "../control-ui-shared.js";
import { GATEWAY_CLIENT_CAPS, hasGatewayClientCap } from "../protocol/client-info.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAgentIdentityParams,
  validateAgentParams,
  validateAgentWaitParams,
} from "../protocol/index.js";
import { loadSessionEntry } from "../session-utils.js";
import { formatForLog } from "../ws-log.js";
import { waitForAgentJob } from "./agent-job.js";
import { injectTimestamp, timestampOptsFromConfig } from "./agent-timestamp.js";

export const agentHandlers: GatewayRequestHandlers = {
  agent: async ({ params, respond, context, client }) => {
    const p = params;
    if (!validateAgentParams(p)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agent params: ${formatValidationErrors(validateAgentParams.errors)}`,
        ),
      );
      return;
    }
    const request = p as {
      message: string;
      agentId?: string;
      to?: string;
      replyTo?: string;
      sessionId?: string;
      sessionKey?: string;
      busyMode?: "cue" | "steer";
      thinking?: string;
      deliver?: boolean;
      attachments?: Array<{
        type?: string;
        mimeType?: string;
        fileName?: string;
        content?: unknown;
      }>;
      channel?: string;
      replyChannel?: string;
      accountId?: string;
      replyAccountId?: string;
      threadId?: string;
      groupId?: string;
      groupChannel?: string;
      groupSpace?: string;
      lane?: string;
      extraSystemPrompt?: string;
      idempotencyKey: string;
      timeout?: number;
      label?: string;
      spawnedBy?: string;
      silent?: boolean;
    };
    const cfg = loadConfig();
    const idem = request.idempotencyKey;
    const groupIdRaw = typeof request.groupId === "string" ? request.groupId.trim() : "";
    const groupChannelRaw =
      typeof request.groupChannel === "string" ? request.groupChannel.trim() : "";
    const groupSpaceRaw = typeof request.groupSpace === "string" ? request.groupSpace.trim() : "";
    let resolvedGroupId: string | undefined = groupIdRaw || undefined;
    let resolvedGroupChannel: string | undefined = groupChannelRaw || undefined;
    let resolvedGroupSpace: string | undefined = groupSpaceRaw || undefined;
    let spawnedByValue =
      typeof request.spawnedBy === "string" ? request.spawnedBy.trim() : undefined;
    const cached = context.dedupe.get(`agent:${idem}`);
    if (cached) {
      respond(cached.ok, cached.payload, cached.error, {
        cached: true,
      });
      return;
    }
    const normalizedAttachments =
      request.attachments
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

    let message = (request.message ?? "").trim();
    let images: Array<{ type: "image"; data: string; mimeType: string }> = [];
    if (normalizedAttachments.length > 0) {
      try {
        const parsed = await parseMessageWithAttachments(message, normalizedAttachments, {
          maxBytes: 5_000_000,
          log: context.logGateway,
        });
        message = parsed.message.trim();
        images = parsed.images;
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
        return;
      }
    }

    const isKnownGatewayChannel = (value: string): boolean => isGatewayMessageChannel(value);
    const channelHints = [request.channel, request.replyChannel]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const rawChannel of channelHints) {
      const normalized = normalizeMessageChannel(rawChannel);
      if (normalized && normalized !== "last" && !isKnownGatewayChannel(normalized)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid agent params: unknown channel: ${String(normalized)}`,
          ),
        );
        return;
      }
    }

    const agentIdRaw = typeof request.agentId === "string" ? request.agentId.trim() : "";
    const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : undefined;
    if (agentId) {
      const knownAgents = listAgentIds(cfg);
      if (!knownAgents.includes(agentId)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid agent params: unknown agent id "${request.agentId}"`,
          ),
        );
        return;
      }
    }

    const requestedSessionKeyRaw =
      typeof request.sessionKey === "string" && request.sessionKey.trim()
        ? request.sessionKey.trim()
        : undefined;
    let requestedSessionKey =
      requestedSessionKeyRaw ??
      resolveExplicitAgentSessionKey({
        cfg,
        agentId,
      });
    // Canonicalize bare session keys (e.g. "webchat-123") using the request's
    // agentId rather than the config default, so they resolve to the correct
    // stored session (e.g. "agent:main:webchat-123" not "agent:argent:webchat-123").
    if (requestedSessionKey && agentId && !requestedSessionKey.startsWith("agent:")) {
      requestedSessionKey = `agent:${agentId}:${requestedSessionKey}`;
    }
    let resolvedSessionId = request.sessionId?.trim() || undefined;
    let sessionEntry: SessionEntry | undefined;
    let bestEffortDeliver = false;
    let cfgForAgent: ReturnType<typeof loadConfig> | undefined;
    let prevLastUserMessageAt: number | undefined;
    let prevLastUserSessionKey: string | undefined;

    if (requestedSessionKey) {
      const { cfg, storePath, store, entry, canonicalKey } = loadSessionEntry(requestedSessionKey);
      cfgForAgent = cfg;
      const now = Date.now();
      // Capture previous lastUserMessageAt for elapsed-time awareness.
      // Fall back to the global "__lastUserMessage" entry so new sessions
      // still know how long it's been since the last interaction.
      prevLastUserMessageAt = entry?.lastUserMessageAt;
      prevLastUserSessionKey = canonicalKey;
      if (prevLastUserMessageAt === undefined && canonicalKey !== "__lastUserMessage") {
        const globalEntry = store["__lastUserMessage"] as SessionEntry | undefined;
        // For fresh sessions, use the most recent prior interaction in this
        // same agent store (not the default-agent store).
        prevLastUserMessageAt =
          globalEntry?.lastUserMessageAt ?? globalEntry?.previousLastUserMessageAt;
        prevLastUserSessionKey =
          globalEntry?.lastInteractionSessionKey ?? globalEntry?.previousSessionKey;
      }
      const sessionId = entry?.sessionId ?? randomUUID();
      const labelValue = request.label?.trim() || entry?.label;
      spawnedByValue = spawnedByValue || entry?.spawnedBy;
      let inheritedGroup:
        | { groupId?: string; groupChannel?: string; groupSpace?: string }
        | undefined;
      if (spawnedByValue && (!resolvedGroupId || !resolvedGroupChannel || !resolvedGroupSpace)) {
        try {
          const parentEntry = loadSessionEntry(spawnedByValue)?.entry;
          inheritedGroup = {
            groupId: parentEntry?.groupId,
            groupChannel: parentEntry?.groupChannel,
            groupSpace: parentEntry?.space,
          };
        } catch {
          inheritedGroup = undefined;
        }
      }
      resolvedGroupId = resolvedGroupId || inheritedGroup?.groupId;
      resolvedGroupChannel = resolvedGroupChannel || inheritedGroup?.groupChannel;
      resolvedGroupSpace = resolvedGroupSpace || inheritedGroup?.groupSpace;
      const deliveryFields = normalizeSessionDeliveryFields(entry);
      const nextEntry: SessionEntry = {
        sessionId,
        updatedAt: now,
        thinkingLevel: entry?.thinkingLevel,
        verboseLevel: entry?.verboseLevel,
        reasoningLevel: entry?.reasoningLevel,
        systemSent: entry?.systemSent,
        sendPolicy: entry?.sendPolicy,
        skillsSnapshot: entry?.skillsSnapshot,
        deliveryContext: deliveryFields.deliveryContext,
        lastChannel: deliveryFields.lastChannel ?? entry?.lastChannel,
        lastTo: deliveryFields.lastTo ?? entry?.lastTo,
        lastAccountId: deliveryFields.lastAccountId ?? entry?.lastAccountId,
        modelOverride: entry?.modelOverride,
        providerOverride: entry?.providerOverride,
        label: labelValue,
        spawnedBy: spawnedByValue,
        channel: entry?.channel ?? request.channel?.trim(),
        groupId: resolvedGroupId ?? entry?.groupId,
        groupChannel: resolvedGroupChannel ?? entry?.groupChannel,
        space: resolvedGroupSpace ?? entry?.space,
        cliSessionIds: entry?.cliSessionIds,
        claudeCliSessionId: entry?.claudeCliSessionId,
        // Track last user message time for temporal awareness
        lastUserMessageAt: now,
      };
      sessionEntry = nextEntry;
      const sendPolicy = resolveSendPolicy({
        cfg,
        entry,
        sessionKey: requestedSessionKey,
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
      resolvedSessionId = sessionId;
      const canonicalSessionKey = canonicalKey;
      const agentId = resolveAgentIdFromSessionKey(canonicalSessionKey);
      const mainSessionKey = resolveAgentMainSessionKey({ cfg, agentId });
      if (storePath) {
        await updateSessionStore(storePath, (store) => {
          store[canonicalSessionKey] = nextEntry;
          // Also persist lastUserMessageAt globally so new sessions know
          // the time gap since the last interaction from ANY session.
          const globalEntry = store["__lastUserMessage"] as SessionEntry | undefined;
          const previousLastAt =
            globalEntry?.lastUserMessageAt ?? prevLastUserMessageAt ?? globalEntry?.updatedAt;
          const previousSessionKey =
            globalEntry?.lastInteractionSessionKey ?? prevLastUserSessionKey;
          store["__lastUserMessage"] = {
            ...(globalEntry || {}),
            previousLastUserMessageAt: previousLastAt,
            previousSessionKey,
            lastUserMessageAt: now,
            lastInteractionSessionKey: canonicalSessionKey,
            sessionClearedAt: undefined,
            sessionClearedFromKey: undefined,
            sessionClearedReason: undefined,
            updatedAt: now,
          } as SessionEntry;
        });
      }
      if (canonicalSessionKey === mainSessionKey || canonicalSessionKey === "global") {
        context.addChatRun(idem, {
          sessionKey: requestedSessionKey,
          clientRunId: idem,
        });
        bestEffortDeliver = true;
      }
      registerAgentRunContext(idem, { sessionKey: requestedSessionKey });
    }

    // Extract prompt markers (e.g. [DEEP_THINK], [APP_FORGE]) before timestamp
    // injection so they stay at the front where run.ts detects them via startsWith.
    const PROMPT_MARKER_RE = /^\[(?:DEEP_THINK|APP_FORGE|AUDIO_ENABLED)\]\s*/;
    let promptMarkers = "";
    let markerMatch: RegExpMatchArray | null;
    while ((markerMatch = PROMPT_MARKER_RE.exec(message)) !== null) {
      promptMarkers += markerMatch[0];
      message = message.slice(markerMatch[0].length);
    }

    // Inject timestamp into messages that don't already have one.
    // Channel messages (Discord, Telegram, etc.) get timestamps via envelope
    // formatting in a separate code path — they never reach this handler.
    // See: https://github.com/ArgentAIOS/argentos/issues/3658
    // NOTE: Must happen after session load so we can read prevLastUserMessageAt
    // which was captured before the session entry was updated.
    message = injectTimestamp(message, timestampOptsFromConfig(cfg, prevLastUserMessageAt));

    // Re-prepend markers so they're detected by run.ts before the timestamp
    if (promptMarkers) {
      message = promptMarkers + message;
    }

    const runId = idem;
    if (request.busyMode === "steer") {
      if (images.length > 0) {
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
      const steerSessionId = resolvedSessionId?.trim();
      if (!steerSessionId) {
        const payload = {
          runId,
          status: "not_active" as const,
          reason: "no_session",
        };
        context.dedupe.set(`agent:${idem}`, {
          ts: Date.now(),
          ok: true,
          payload,
        });
        respond(true, payload, undefined, { runId });
        return;
      }
      if (!isEmbeddedPiRunActive(steerSessionId)) {
        const payload = {
          runId,
          status: "not_active" as const,
          sessionId: steerSessionId,
        };
        context.dedupe.set(`agent:${idem}`, {
          ts: Date.now(),
          ok: true,
          payload,
        });
        respond(true, payload, undefined, { runId });
        return;
      }
      const steered = queueEmbeddedPiMessage(steerSessionId, message);
      if (!steered) {
        const payload = {
          runId,
          status: "not_steerable" as const,
          sessionId: steerSessionId,
        };
        context.dedupe.set(`agent:${idem}`, {
          ts: Date.now(),
          ok: true,
          payload,
        });
        respond(true, payload, undefined, { runId });
        return;
      }
      const steeredPayload = {
        runId,
        status: "steered" as const,
        sessionId: steerSessionId,
      };
      context.dedupe.set(`agent:${idem}`, {
        ts: Date.now(),
        ok: true,
        payload: steeredPayload,
      });
      respond(true, steeredPayload, undefined, { runId });
      return;
    }

    const connId = typeof client?.connId === "string" ? client.connId : undefined;
    const wantsToolEvents = hasGatewayClientCap(
      client?.connect?.caps,
      GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
    );
    if (connId && wantsToolEvents) {
      context.registerToolEventRecipient(runId, connId);
    }

    const wantsDelivery = request.deliver === true;
    const explicitTo =
      typeof request.replyTo === "string" && request.replyTo.trim()
        ? request.replyTo.trim()
        : typeof request.to === "string" && request.to.trim()
          ? request.to.trim()
          : undefined;
    const explicitThreadId =
      typeof request.threadId === "string" && request.threadId.trim()
        ? request.threadId.trim()
        : undefined;
    // Webchat clients that don't specify a channel should stay on webchat —
    // not fall through to "last" which may resolve to Discord from a previous session.
    const clientId = client?.connect?.client?.id;
    const isWebchatClient = clientId === "webchat" || clientId === "webchat-ui";
    const requestedChannel =
      request.replyChannel ?? request.channel ?? (isWebchatClient ? "webchat" : undefined);
    const deliveryPlan = resolveAgentDeliveryPlan({
      sessionEntry,
      requestedChannel,
      explicitTo,
      explicitThreadId,
      accountId: request.replyAccountId ?? request.accountId,
      wantsDelivery,
    });

    const resolvedChannel = deliveryPlan.resolvedChannel;
    const deliveryTargetMode = deliveryPlan.deliveryTargetMode;
    const resolvedAccountId = deliveryPlan.resolvedAccountId;
    let resolvedTo = deliveryPlan.resolvedTo;

    if (!resolvedTo && isDeliverableMessageChannel(resolvedChannel)) {
      const cfgResolved = cfgForAgent ?? cfg;
      const fallback = resolveAgentOutboundTarget({
        cfg: cfgResolved,
        plan: deliveryPlan,
        targetMode: "implicit",
        validateExplicitTarget: false,
      });
      if (fallback.resolvedTarget?.ok) {
        resolvedTo = fallback.resolvedTo;
      }
    }

    const deliver = request.deliver === true && resolvedChannel !== INTERNAL_MESSAGE_CHANNEL;

    const accepted = {
      runId,
      status: "accepted" as const,
      acceptedAt: Date.now(),
    };
    // Store an in-flight ack so retries do not spawn a second run.
    context.dedupe.set(`agent:${idem}`, {
      ts: Date.now(),
      ok: true,
      payload: accepted,
    });
    respond(true, accepted, undefined, { runId });

    const resolvedThreadId = explicitThreadId ?? deliveryPlan.resolvedThreadId;

    context.agentStateBroadcaster?.markProcessing(`agent:${resolvedChannel ?? "message"}`);
    context.agentStateBroadcaster?.markActivity("thinking");
    void agentCommand(
      {
        message,
        images,
        to: resolvedTo,
        sessionId: resolvedSessionId,
        sessionKey: requestedSessionKey,
        thinking: request.thinking,
        deliver,
        deliveryTargetMode,
        channel: resolvedChannel,
        accountId: resolvedAccountId,
        threadId: resolvedThreadId,
        runContext: {
          messageChannel: resolvedChannel,
          accountId: resolvedAccountId,
          groupId: resolvedGroupId,
          groupChannel: resolvedGroupChannel,
          groupSpace: resolvedGroupSpace,
          currentThreadTs: resolvedThreadId != null ? String(resolvedThreadId) : undefined,
        },
        groupId: resolvedGroupId,
        groupChannel: resolvedGroupChannel,
        groupSpace: resolvedGroupSpace,
        spawnedBy: spawnedByValue,
        timeout: request.timeout?.toString(),
        bestEffortDeliver,
        messageChannel: resolvedChannel,
        runId,
        lane: request.lane,
        priority: true,
        extraSystemPrompt: request.extraSystemPrompt,
      },
      defaultRuntime,
      context.deps,
    )
      .then((result) => {
        const payload = {
          runId,
          status: "ok" as const,
          summary: "completed",
          result,
        };
        context.dedupe.set(`agent:${idem}`, {
          ts: Date.now(),
          ok: true,
          payload,
        });
        // Send a second res frame (same id) so TS clients with expectFinal can wait.
        // Swift clients will typically treat the first res as the result and ignore this.
        respond(true, payload, undefined, { runId });
      })
      .catch((err) => {
        const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
        const payload = {
          runId,
          status: "error" as const,
          summary: String(err),
        };
        context.dedupe.set(`agent:${idem}`, {
          ts: Date.now(),
          ok: false,
          payload,
          error,
        });
        respond(false, payload, error, {
          runId,
          error: formatForLog(err),
        });
      })
      .finally(() => {
        context.agentStateBroadcaster?.markDone();
      });
  },
  "agent.identity.get": ({ params, respond }) => {
    if (!validateAgentIdentityParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agent.identity.get params: ${formatValidationErrors(
            validateAgentIdentityParams.errors,
          )}`,
        ),
      );
      return;
    }
    const p = params;
    const agentIdRaw = typeof p.agentId === "string" ? p.agentId.trim() : "";
    const sessionKeyRaw = typeof p.sessionKey === "string" ? p.sessionKey.trim() : "";
    let agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : undefined;
    if (sessionKeyRaw) {
      const resolved = resolveAgentIdFromSessionKey(sessionKeyRaw);
      if (agentId && resolved !== agentId) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid agent.identity.get params: agent "${agentIdRaw}" does not match session key agent "${resolved}"`,
          ),
        );
        return;
      }
      agentId = resolved;
    }
    const cfg = loadConfig();
    const identity = resolveAssistantIdentity({ cfg, agentId });
    const avatarValue =
      resolveAssistantAvatarUrl({
        avatar: identity.avatar,
        agentId: identity.agentId,
        basePath: cfg.gateway?.controlUi?.basePath,
      }) ?? identity.avatar;
    respond(true, { ...identity, avatar: avatarValue }, undefined);
  },
  "agent.wait": async ({ params, respond }) => {
    if (!validateAgentWaitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agent.wait params: ${formatValidationErrors(validateAgentWaitParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const runId = p.runId.trim();
    const timeoutMs =
      typeof p.timeoutMs === "number" && Number.isFinite(p.timeoutMs)
        ? Math.max(0, Math.floor(p.timeoutMs))
        : 30_000;

    const snapshot = await waitForAgentJob({
      runId,
      timeoutMs,
    });
    if (!snapshot) {
      respond(true, {
        runId,
        status: "timeout",
      });
      return;
    }
    respond(true, {
      runId,
      status: snapshot.status,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt,
      error: snapshot.error,
    });
  },
};
