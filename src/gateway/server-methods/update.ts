import type { GatewayRequestHandlers } from "./types.js";
import { formatCliCommand } from "../../cli/command-format.js";
import { loadConfig } from "../../config/config.js";
import { resolveArgentPackageRoot } from "../../infra/argent-root.js";
import {
  checkUpdateStatus,
  compareSemverStrings,
  resolveNpmChannelTag,
} from "../../infra/update-check.js";
import {
  DEFAULT_PACKAGE_CHANNEL,
  normalizeUpdateChannel,
  resolveEffectiveUpdateChannel,
} from "../../infra/update-channels.js";
import {
  formatDoctorNonInteractiveHint,
  type RestartSentinelPayload,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { runGatewayUpdate } from "../../infra/update-runner.js";
import { VERSION } from "../../version.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateUpdateRunParams,
} from "../protocol/index.js";

export const updateHandlers: GatewayRequestHandlers = {
  "update.status": async ({ respond }) => {
    try {
      const config = loadConfig();
      const root =
        (await resolveArgentPackageRoot({
          moduleUrl: import.meta.url,
          argv1: process.argv[1],
          cwd: process.cwd(),
        })) ?? process.cwd();
      const status = await checkUpdateStatus({
        root,
        timeoutMs: 3500,
        fetchGit: false,
        includeRegistry: false,
      });
      const configuredChannel = normalizeUpdateChannel(config.update?.channel);
      const resolvedChannel = resolveEffectiveUpdateChannel({
        configChannel: configuredChannel,
        installKind: status.installKind,
        git: {
          tag: status.git?.tag ?? null,
          branch: status.git?.branch ?? null,
        },
      });
      const effectiveChannel =
        status.installKind === "package" && resolvedChannel.channel === "dev"
          ? DEFAULT_PACKAGE_CHANNEL
          : resolvedChannel.channel;

      let latestVersion: string | null = null;
      let available = false;
      let gitBehind: number | null = null;

      if (status.installKind === "git") {
        gitBehind = typeof status.git?.behind === "number" ? status.git.behind : null;
        available = Boolean(gitBehind && gitBehind > 0);
      } else {
        const resolved = await resolveNpmChannelTag({
          channel: effectiveChannel,
          timeoutMs: 3500,
        });
        latestVersion = resolved.version;
        const cmp = compareSemverStrings(VERSION, latestVersion);
        available = cmp != null && cmp < 0;
      }

      respond(
        true,
        {
          ok: true,
          installKind: status.installKind,
          root: status.root,
          channel: effectiveChannel,
          channelSource: resolvedChannel.source,
          currentVersion: VERSION,
          latestVersion,
          gitBehind,
          available,
          updateCommand: formatCliCommand("argent update"),
          releaseUrl: latestVersion
            ? `https://github.com/ArgentAIOS/argentos/releases/tag/v${latestVersion}`
            : "https://github.com/ArgentAIOS/argentos/releases",
        },
        undefined,
      );
    } catch (err) {
      respond(
        true,
        {
          ok: false,
          installKind: "unknown",
          root: null,
          channel: DEFAULT_PACKAGE_CHANNEL,
          channelSource: "default",
          currentVersion: VERSION,
          latestVersion: null,
          gitBehind: null,
          available: false,
          updateCommand: formatCliCommand("argent update"),
          releaseUrl: "https://github.com/ArgentAIOS/argentos/releases",
          error: err instanceof Error ? err.message : String(err),
        },
        undefined,
      );
    }
  },
  "update.run": async ({ params, respond }) => {
    if (!validateUpdateRunParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid update.run params: ${formatValidationErrors(validateUpdateRunParams.errors)}`,
        ),
      );
      return;
    }
    const sessionKey =
      typeof (params as { sessionKey?: unknown }).sessionKey === "string"
        ? (params as { sessionKey?: string }).sessionKey?.trim() || undefined
        : undefined;
    const note =
      typeof (params as { note?: unknown }).note === "string"
        ? (params as { note?: string }).note?.trim() || undefined
        : undefined;
    const restartDelayMsRaw = (params as { restartDelayMs?: unknown }).restartDelayMs;
    const restartDelayMs =
      typeof restartDelayMsRaw === "number" && Number.isFinite(restartDelayMsRaw)
        ? Math.max(0, Math.floor(restartDelayMsRaw))
        : undefined;
    const timeoutMsRaw = (params as { timeoutMs?: unknown }).timeoutMs;
    const timeoutMs =
      typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw)
        ? Math.max(1000, Math.floor(timeoutMsRaw))
        : undefined;

    let result: Awaited<ReturnType<typeof runGatewayUpdate>>;
    try {
      const config = loadConfig();
      const configChannel = normalizeUpdateChannel(config.update?.channel);
      const root =
        (await resolveArgentPackageRoot({
          moduleUrl: import.meta.url,
          argv1: process.argv[1],
          cwd: process.cwd(),
        })) ?? process.cwd();
      result = await runGatewayUpdate({
        timeoutMs,
        cwd: root,
        argv1: process.argv[1],
        channel: configChannel ?? undefined,
      });
    } catch (err) {
      result = {
        status: "error",
        mode: "unknown",
        reason: String(err),
        steps: [],
        durationMs: 0,
      };
    }

    const payload: RestartSentinelPayload = {
      kind: "update",
      status: result.status,
      ts: Date.now(),
      sessionKey,
      message: note ?? null,
      doctorHint: formatDoctorNonInteractiveHint(),
      stats: {
        mode: result.mode,
        root: result.root ?? undefined,
        before: result.before ?? null,
        after: result.after ?? null,
        steps: result.steps.map((step) => ({
          name: step.name,
          command: step.command,
          cwd: step.cwd,
          durationMs: step.durationMs,
          log: {
            stdoutTail: step.stdoutTail ?? null,
            stderrTail: step.stderrTail ?? null,
            exitCode: step.exitCode ?? null,
          },
        })),
        reason: result.reason ?? null,
        durationMs: result.durationMs,
      },
    };

    let sentinelPath: string | null = null;
    try {
      sentinelPath = await writeRestartSentinel(payload);
    } catch {
      sentinelPath = null;
    }

    // Only restart when the update completed successfully.
    // Restarting after a failed update can leave the runtime in a partial state.
    const restart =
      result.status === "ok"
        ? scheduleGatewaySigusr1Restart({
            delayMs: restartDelayMs,
            reason: "update.run",
          })
        : null;

    respond(
      true,
      {
        ok: result.status !== "error",
        result,
        restart,
        sentinel: {
          path: sentinelPath,
          payload,
        },
      },
      undefined,
    );
  },
};
