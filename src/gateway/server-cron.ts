import type { CliDeps } from "../cli/deps.js";
import { resolveAgentDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { ensureAuthProfileStore, isProviderInCooldown } from "../agents/auth-profiles.js";
import {
  buildInjectedAudioAlertMessage,
  createAudioAlertTool,
  extractAudioAlertToolText,
} from "../agents/tools/audio-alert-tool.js";
import { createSlackSignalMonitorTool } from "../agents/tools/slack-signal-monitor-tool.js";
import { createVipEmailTool } from "../agents/tools/vip-email-tool.js";
import { agentCommand } from "../commands/agent.js";
import { loadConfig } from "../config/config.js";
import {
  appendAssistantMessageToSessionTranscript,
  resolveAgentMainSessionKey,
} from "../config/sessions.js";
import { runCronIsolatedAgentTurn } from "../cron/isolated-agent.js";
import { appendCronRunLog, resolveCronRunLogPath } from "../cron/run-log.js";
import { CronService } from "../cron/service.js";
import { resolveCronStorePath } from "../cron/store.js";
import { runHeartbeatOnce } from "../infra/heartbeat-runner.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { getChildLogger } from "../logging.js";
import { getCronJournalHandler } from "../memory/journal.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { sanitizeChatMessageForDisplay } from "./chat-sanitize.js";
import { loadSessionEntry } from "./session-utils.js";

export type GatewayCronState = {
  cron: CronService;
  storePath: string;
  cronEnabled: boolean;
};

async function injectAssistantMessage(params: {
  sessionKey: string;
  message: string;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
  nodeSendToSession: (sessionKey: string, event: string, payload: unknown) => void;
}) {
  const { storePath, entry } = loadSessionEntry(params.sessionKey);
  if (!entry?.sessionId || !storePath) {
    throw new Error("session not found");
  }
  const appended = await appendAssistantMessageToSessionTranscript({
    sessionKey: params.sessionKey,
    text: params.message,
    storePath,
  });
  if (!appended.ok) {
    throw new Error(`failed to write transcript: ${appended.reason}`);
  }

  const sanitizedMessage = sanitizeChatMessageForDisplay({
    role: "assistant",
    content: [{ type: "text", text: params.message }],
    timestamp: Date.now(),
  });

  const chatPayload = {
    runId: `inject-${Date.now()}`,
    sessionKey: params.sessionKey,
    seq: 0,
    state: "final" as const,
    message:
      sanitizedMessage && typeof sanitizedMessage === "object"
        ? (sanitizedMessage as Record<string, unknown>)
        : undefined,
  };
  params.broadcast("chat", chatPayload);
  params.nodeSendToSession(params.sessionKey, "chat", chatPayload);
}

export function buildGatewayCronService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
  nodeSendToSession: (sessionKey: string, event: string, payload: unknown) => void;
}): GatewayCronState {
  const cronLogger = getChildLogger({ module: "cron" });
  const storePath = resolveCronStorePath(params.cfg.cron?.store);
  const cronEnabled = process.env.ARGENT_SKIP_CRON !== "1" && params.cfg.cron?.enabled !== false;

  const resolveCronAgent = (requested?: string | null) => {
    const runtimeConfig = loadConfig();
    const normalized =
      typeof requested === "string" && requested.trim() ? normalizeAgentId(requested) : undefined;
    const hasAgent =
      normalized !== undefined &&
      Array.isArray(runtimeConfig.agents?.list) &&
      runtimeConfig.agents.list.some(
        (entry) =>
          entry && typeof entry.id === "string" && normalizeAgentId(entry.id) === normalized,
      );
    const agentId = hasAgent ? normalized : resolveDefaultAgentId(runtimeConfig);
    return { agentId, cfg: runtimeConfig };
  };

  const cron = new CronService({
    storePath,
    cronEnabled,
    enqueueSystemEvent: (text, opts) => {
      const { agentId, cfg: runtimeConfig } = resolveCronAgent(opts?.agentId);
      const sessionKey = resolveAgentMainSessionKey({
        cfg: runtimeConfig,
        agentId,
      });
      enqueueSystemEvent(text, { sessionKey });
    },
    requestHeartbeatNow,
    runHeartbeatOnce: async (opts) => {
      const runtimeConfig = loadConfig();
      return await runHeartbeatOnce({
        cfg: runtimeConfig,
        reason: opts?.reason,
        deps: { ...params.deps, runtime: defaultRuntime },
      });
    },
    runIsolatedAgentJob: async ({ job, message }) => {
      const { agentId, cfg: runtimeConfig } = resolveCronAgent(job.agentId);
      const agentDir = resolveAgentDir(runtimeConfig, agentId);
      const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
      if (isProviderInCooldown(authStore, "anthropic")) {
        return {
          status: "skipped" as const,
          summary: "Skipped: Anthropic provider cooldown active",
        };
      }
      return await runCronIsolatedAgentTurn({
        cfg: runtimeConfig,
        deps: params.deps,
        job,
        message,
        agentId,
        sessionKey: `cron:${job.id}`,
        lane: "cron",
      });
    },
    runNudge: async ({ job, text, label }) => {
      const { agentId, cfg: runtimeConfig } = resolveCronAgent(job.agentId);
      const agentDir = resolveAgentDir(runtimeConfig, agentId);
      const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
      if (isProviderInCooldown(authStore, "anthropic")) {
        return {
          status: "skipped" as const,
          error: "Anthropic provider cooldown active",
        };
      }
      const sessionKey = resolveAgentMainSessionKey({
        cfg: runtimeConfig,
        agentId,
      });
      try {
        const nudgeMessage = `[NUDGE] ${text}`;
        await agentCommand(
          {
            message: nudgeMessage,
            sessionKey,
            runId: `nudge-${job.id}-${Date.now()}`,
            lane: "cron",
            bestEffortDeliver: false,
            extraSystemPrompt: label
              ? `This is a scheduled nudge: "${label}". Respond naturally.`
              : undefined,
          },
          defaultRuntime,
          params.deps,
        );
        return { status: "ok" as const };
      } catch (err) {
        return {
          status: "error" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    runAudioAlert: async ({ job, message, title, voice, mood, urgency }) => {
      const { agentId, cfg: runtimeConfig } = resolveCronAgent(job.agentId);
      const sessionKey = resolveAgentMainSessionKey({
        cfg: runtimeConfig,
        agentId,
      });
      try {
        const audioTool = createAudioAlertTool({
          config: runtimeConfig,
          agentSessionKey: sessionKey,
        });
        const resolvedTitle =
          typeof title === "string" && title.trim() ? title.trim() : job.name.trim();
        const audioResult = await audioTool.execute(`cron-audio-alert-${job.id}-${Date.now()}`, {
          message,
          title: resolvedTitle,
          voice,
          mood,
          urgency,
        });
        const toolText = extractAudioAlertToolText(audioResult);
        const injectMessage = buildInjectedAudioAlertMessage({
          toolText,
          title: resolvedTitle,
          summaryText: message,
          urgency,
        });
        await injectAssistantMessage({
          sessionKey,
          message: injectMessage,
          broadcast: params.broadcast,
          nodeSendToSession: params.nodeSendToSession,
        });
        return {
          status: "ok" as const,
          summary: resolvedTitle,
        };
      } catch (err) {
        return {
          status: "error" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    runVipEmailScan: async ({ job, emitAlerts, maxResults, lookbackDays, accounts }) => {
      const { agentId, cfg: runtimeConfig } = resolveCronAgent(job.agentId);
      const sessionKey = resolveAgentMainSessionKey({
        cfg: runtimeConfig,
        agentId,
      });
      const vipTool = createVipEmailTool({
        config: runtimeConfig,
        agentSessionKey: sessionKey,
      });

      const toolArgs: Record<string, unknown> = {
        action: "scan_now",
        emitAlerts: emitAlerts ?? true,
      };
      if (typeof maxResults === "number" && Number.isFinite(maxResults)) {
        toolArgs.maxResults = Math.max(1, Math.floor(maxResults));
      }
      if (typeof lookbackDays === "number" && Number.isFinite(lookbackDays)) {
        toolArgs.lookbackDays = Math.max(1, Math.floor(lookbackDays));
      }
      if (Array.isArray(accounts) && accounts.length > 0) {
        toolArgs.accounts = accounts.filter((value): value is string => typeof value === "string");
      }

      try {
        const result = await vipTool.execute(`cron-vip-email-${job.id}`, toolArgs);
        const details =
          result &&
          typeof result === "object" &&
          "details" in result &&
          !Array.isArray((result as { details?: unknown }).details)
            ? ((result as { details?: unknown }).details as Record<string, unknown> | undefined)
            : undefined;
        if (!details) {
          return {
            status: "error" as const,
            error: "vip_email scan returned no details",
          };
        }

        const ok = details.ok === true;
        const setupRequired = details.setupRequired === true;
        const reason =
          typeof details.reason === "string" && details.reason.trim()
            ? details.reason.trim()
            : "vip_email scan failed";

        if (!ok) {
          if (setupRequired) {
            return {
              status: "skipped" as const,
              summary: `VIP email setup required: ${reason}`,
              error: reason,
            };
          }
          return {
            status: "error" as const,
            error: reason,
          };
        }

        const newCount = typeof details.newCount === "number" ? Math.max(0, details.newCount) : 0;
        const scanErrors = Array.isArray(details.errors)
          ? details.errors.filter((entry): entry is string => typeof entry === "string").length
          : 0;
        const channelDispatch =
          details.channelDispatch &&
          typeof details.channelDispatch === "object" &&
          !Array.isArray(details.channelDispatch)
            ? (details.channelDispatch as { sent?: unknown })
            : undefined;
        const routesSent =
          channelDispatch && typeof channelDispatch.sent === "number"
            ? Math.max(0, Math.floor(channelDispatch.sent))
            : 0;

        const summaryParts = [
          newCount > 0
            ? `VIP email scan: ${newCount} new VIP email${newCount === 1 ? "" : "s"}`
            : "VIP email scan: no new VIP emails",
        ];
        if (routesSent > 0) {
          summaryParts.push(`alerts sent to ${routesSent} route${routesSent === 1 ? "" : "s"}`);
        }
        if (scanErrors > 0) {
          summaryParts.push(`${scanErrors} scan error${scanErrors === 1 ? "" : "s"}`);
        }

        return {
          status: "ok" as const,
          summary: summaryParts.join("; "),
        };
      } catch (err) {
        return {
          status: "error" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    runSlackSignalScan: async ({ job, emitAlerts, createTasks, accountId }) => {
      const { agentId, cfg: runtimeConfig } = resolveCronAgent(job.agentId);
      const sessionKey = resolveAgentMainSessionKey({
        cfg: runtimeConfig,
        agentId,
      });
      const slackTool = createSlackSignalMonitorTool({
        config: runtimeConfig,
        agentSessionKey: sessionKey,
      });

      const toolArgs: Record<string, unknown> = {
        action: "scan_now",
      };
      if (typeof emitAlerts === "boolean") {
        toolArgs.emitAlerts = emitAlerts;
      }
      if (typeof createTasks === "boolean") {
        toolArgs.createTasks = createTasks;
      }
      if (typeof accountId === "string" && accountId.trim()) {
        toolArgs.accountId = accountId.trim();
      }

      try {
        const result = await slackTool.execute(`cron-slack-signal-${job.id}`, toolArgs);
        const details =
          result &&
          typeof result === "object" &&
          "details" in result &&
          !Array.isArray((result as { details?: unknown }).details)
            ? ((result as { details?: unknown }).details as Record<string, unknown> | undefined)
            : undefined;
        if (!details) {
          return {
            status: "error" as const,
            error: "slack_signal_monitor scan returned no details",
          };
        }

        const ok = details.ok === true;
        const setupRequired = details.setupRequired === true;
        const reason =
          typeof details.reason === "string" && details.reason.trim()
            ? details.reason.trim()
            : "slack_signal_monitor scan failed";

        if (!ok) {
          if (setupRequired) {
            return {
              status: "skipped" as const,
              summary: `Slack signal setup required: ${reason}`,
              error: reason,
            };
          }
          return {
            status: "error" as const,
            error: reason,
          };
        }

        const newCount = typeof details.newCount === "number" ? Math.max(0, details.newCount) : 0;
        const mentionCount =
          typeof details.mentionCount === "number" ? Math.max(0, details.mentionCount) : 0;
        const actionableCount =
          typeof details.actionableCount === "number" ? Math.max(0, details.actionableCount) : 0;
        const audioDispatch =
          details.audioDispatch && typeof details.audioDispatch === "object"
            ? (details.audioDispatch as { sent?: unknown })
            : undefined;
        const alertsSent =
          audioDispatch && typeof audioDispatch.sent === "number"
            ? Math.max(0, Math.floor(audioDispatch.sent))
            : 0;
        const taskDispatch =
          details.taskDispatch && typeof details.taskDispatch === "object"
            ? (details.taskDispatch as { created?: unknown })
            : undefined;
        const tasksCreated =
          taskDispatch && typeof taskDispatch.created === "number"
            ? Math.max(0, Math.floor(taskDispatch.created))
            : 0;

        const summaryParts = [
          newCount > 0
            ? `Slack signal scan: ${newCount} new event${newCount === 1 ? "" : "s"}`
            : "Slack signal scan: no new events",
        ];
        if (mentionCount > 0) {
          summaryParts.push(`${mentionCount} mention${mentionCount === 1 ? "" : "s"}`);
        }
        if (alertsSent > 0) {
          summaryParts.push(`${alertsSent} alert${alertsSent === 1 ? "" : "s"} sent`);
        }
        if (tasksCreated > 0) {
          summaryParts.push(`${tasksCreated} task${tasksCreated === 1 ? "" : "s"} created`);
        } else if (actionableCount > 0) {
          summaryParts.push(
            `${actionableCount} actionable mention${actionableCount === 1 ? "" : "s"}`,
          );
        }

        return {
          status: "ok" as const,
          summary: summaryParts.join("; "),
        };
      } catch (err) {
        return {
          status: "error" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    log: getChildLogger({ module: "cron", storePath }),
    onEvent: (evt) => {
      params.broadcast("cron", evt, { dropIfSlow: true });
      // Chain MemU journal handler for cron event capture
      getCronJournalHandler()?.(evt);
      if (evt.action === "finished") {
        const logPath = resolveCronRunLogPath({
          storePath,
          jobId: evt.jobId,
        });
        void appendCronRunLog(logPath, {
          ts: Date.now(),
          jobId: evt.jobId,
          action: "finished",
          status: evt.status,
          error: evt.error,
          summary: evt.summary,
          runAtMs: evt.runAtMs,
          durationMs: evt.durationMs,
          nextRunAtMs: evt.nextRunAtMs,
          executionMode: evt.executionMode,
          gateDecision: evt.gateDecision,
          gateReason: evt.gateReason,
          simulationEvidence: evt.simulationEvidence,
        }).catch((err) => {
          cronLogger.warn({ err: String(err), logPath }, "cron: run log append failed");
        });
      }
    },
  });

  return { cron, storePath, cronEnabled };
}
