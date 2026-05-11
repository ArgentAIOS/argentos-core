import { type RunOptions, run } from "@grammyjs/runner";
import type { ArgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { resolveAgentMaxConcurrent } from "../config/agent-limits.js";
import { loadConfig } from "../config/config.js";
import { computeBackoff, sleepWithAbort } from "../infra/backoff.js";
import { formatErrorMessage } from "../infra/errors.js";
import { formatDurationMs } from "../infra/format-duration.js";
import { registerUnhandledRejectionHandler } from "../infra/unhandled-rejections.js";
import { resolveTelegramAccount } from "./accounts.js";
import { resolveTelegramAllowedUpdates } from "./allowed-updates.js";
import { createTelegramBot } from "./bot.js";
import { isRecoverableTelegramNetworkError } from "./network-errors.js";
import { acquireTelegramPollingSlot, describeTelegramBotForLog } from "./polling-singleton.js";
import { makeProxyFetch } from "./proxy.js";
import { readTelegramUpdateOffset, writeTelegramUpdateOffset } from "./update-offset-store.js";
import { startTelegramWebhook } from "./webhook.js";

/**
 * State patch reported by the polling loop so the channel-runtime layer
 * (server-channels.ts → channels.status RPC → `argent channels status` /
 * `argent gateway status`) can surface what the Telegram poller is doing
 * without operator log diving. Mirrors the optional fields on
 * ChannelAccountSnapshot.
 */
export type TelegramMonitorStatusPatch = {
  state?: string;
  lastError?: string | null;
  nextRetryAt?: number | null;
  /**
   * Set to `true` when the poller has been stuck in a getUpdates 409
   * conflict cycle for longer than {@link TELEGRAM_PERSISTENT_CONFLICT_THRESHOLD_MS}
   * — i.e. another argent-gateway (or other client) has been holding the
   * polling lock for this bot for an extended period. The dashboard /
   * `argent channels status` surface uses this flag to render the
   * persistent-conflict UX warning (GH #194). Cleared (false) the moment
   * a poll succeeds.
   */
  persistentConflict?: boolean;
};

export type MonitorTelegramOpts = {
  token?: string;
  accountId?: string;
  config?: ArgentConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  useWebhook?: boolean;
  webhookPath?: string;
  webhookPort?: number;
  webhookSecret?: string;
  proxyFetch?: typeof fetch;
  webhookUrl?: string;
  /**
   * Invoked on poller lifecycle transitions. Optional; the monitor still
   * works without it. Wire this to ctx.setStatus from
   * ChannelGatewayContext to expose state on `argent channels status`.
   */
  onStatusChange?: (patch: TelegramMonitorStatusPatch) => void;
};

const TELEGRAM_LONG_POLL_TIMEOUT_SECONDS = 30;

export function createTelegramRunnerOptions(cfg: ArgentConfig): RunOptions<unknown> {
  return {
    sink: {
      concurrency: resolveAgentMaxConcurrent(cfg),
    },
    runner: {
      fetch: {
        // Match grammY defaults
        timeout: TELEGRAM_LONG_POLL_TIMEOUT_SECONDS,
        // Request reactions without dropping default update types.
        allowed_updates: resolveTelegramAllowedUpdates(),
      },
      // Suppress grammY getUpdates stack traces; we log concise errors ourselves.
      silent: true,
      // Retry transient failures for a limited window before surfacing errors.
      maxRetryTime: 5 * 60 * 1000,
      retryInterval: "exponential",
    },
  };
}

const TELEGRAM_POLL_RESTART_POLICY = {
  initialMs: 2000,
  maxMs: 30_000,
  factor: 1.8,
  jitter: 0.25,
};

/**
 * Conflict re-arm policy. After a 409 getUpdates collision, sleep before
 * trying again to allow the colliding instance time to release the lock.
 *
 * 60s → 120s → 240s → 480s → 960s → 1800s (cap) → ...
 *
 * No permanent exit: we keep polling indefinitely so a transient overlap
 * (e.g. a config-reload-driven gateway restart that briefly leaves a
 * legacy poller alive) self-recovers without manual `argent gateway
 * restart` intervention. The counter resets the moment a poll succeeds.
 */
const TELEGRAM_GET_UPDATES_CONFLICT_BACKOFF = {
  initialMs: 60_000,
  maxMs: 30 * 60 * 1000, // 30 min
  factor: 2,
  jitter: 0,
};

/**
 * After this many ms of unbroken getUpdates 409 conflicts, escalate the
 * status patch with `persistentConflict: true` so the dashboard / status
 * command can render a UX warning. Sized so brief overlaps during a
 * config-reload-driven gateway restart (typically <1 min) do not flip
 * the warning, while a real cross-instance polling race surfaces quickly
 * enough to save the operator the manual log dive (GH #194).
 */
export const TELEGRAM_PERSISTENT_CONFLICT_THRESHOLD_MS = 10 * 60 * 1000;

const waitForAbort = async (abortSignal?: AbortSignal) => {
  if (!abortSignal || abortSignal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    abortSignal.addEventListener("abort", () => resolve(), { once: true });
  });
};

const isGetUpdatesConflict = (err: unknown) => {
  if (!err || typeof err !== "object") {
    return false;
  }
  const typed = err as {
    error_code?: number;
    errorCode?: number;
    description?: string;
    method?: string;
    message?: string;
  };
  const errorCode = typed.error_code ?? typed.errorCode;
  if (errorCode !== 409) {
    return false;
  }
  const haystack = [typed.method, typed.description, typed.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes("getupdates");
};

/** Check if error is a Grammy HttpError (used to scope unhandled rejection handling) */
const isGrammyHttpError = (err: unknown): boolean => {
  if (!err || typeof err !== "object") {
    return false;
  }
  return (err as { name?: string }).name === "HttpError";
};

export async function monitorTelegramProvider(opts: MonitorTelegramOpts = {}) {
  const log = opts.runtime?.error ?? console.error;
  const reportStatus = (patch: TelegramMonitorStatusPatch) => {
    if (!opts.onStatusChange) {
      return;
    }
    try {
      opts.onStatusChange(patch);
    } catch (err) {
      // Status reporting must never crash the polling loop.
      log(`[telegram] onStatusChange threw: ${formatErrorMessage(err)}`);
    }
  };

  // Register handler for Grammy HttpError unhandled rejections.
  // This catches network errors that escape the polling loop's try-catch
  // (e.g., from setMyCommands during bot setup).
  // We gate on isGrammyHttpError to avoid suppressing non-Telegram errors.
  const unregisterHandler = registerUnhandledRejectionHandler((err) => {
    if (isGrammyHttpError(err) && isRecoverableTelegramNetworkError(err, { context: "polling" })) {
      log(`[telegram] Suppressed network error: ${formatErrorMessage(err)}`);
      return true; // handled - don't crash
    }
    return false;
  });

  try {
    const cfg = opts.config ?? loadConfig();
    const account = resolveTelegramAccount({
      cfg,
      accountId: opts.accountId,
    });
    const token = opts.token?.trim() || account.token;
    if (!token) {
      throw new Error(
        `Telegram bot token missing for account "${account.accountId}" (set channels.telegram.accounts.${account.accountId}.botToken/tokenFile or TELEGRAM_BOT_TOKEN for default).`,
      );
    }

    const proxyFetch =
      opts.proxyFetch ?? (account.config.proxy ? makeProxyFetch(account.config.proxy) : undefined);

    let lastUpdateId = await readTelegramUpdateOffset({
      accountId: account.accountId,
    });
    const persistUpdateId = async (updateId: number) => {
      if (lastUpdateId !== null && updateId <= lastUpdateId) {
        return;
      }
      lastUpdateId = updateId;
      try {
        await writeTelegramUpdateOffset({
          accountId: account.accountId,
          updateId,
        });
      } catch (err) {
        (opts.runtime?.error ?? console.error)(
          `telegram: failed to persist update offset: ${String(err)}`,
        );
      }
    };

    const createBot = () =>
      createTelegramBot({
        token,
        runtime: opts.runtime,
        proxyFetch,
        config: cfg,
        accountId: account.accountId,
        updateOffset: {
          lastUpdateId,
          onUpdateId: persistUpdateId,
        },
      });

    if (opts.useWebhook) {
      await startTelegramWebhook({
        token,
        accountId: account.accountId,
        config: cfg,
        path: opts.webhookPath,
        port: opts.webhookPort,
        secret: opts.webhookSecret,
        runtime: opts.runtime as RuntimeEnv,
        fetch: proxyFetch,
        abortSignal: opts.abortSignal,
        publicUrl: opts.webhookUrl,
      });
      reportStatus({ state: "webhook", lastError: null, nextRetryAt: null });
      return;
    }

    const pollingSlot = acquireTelegramPollingSlot({
      token,
      accountId: account.accountId,
    });
    if (!pollingSlot.acquired) {
      log(
        `Telegram polling already active for token ${pollingSlot.tokenHash} (account "${pollingSlot.existing.accountId}"); skipping duplicate poller for account "${account.accountId}".`,
      );
      reportStatus({
        state: `duplicate (token already held by account "${pollingSlot.existing.accountId}")`,
      });
      await waitForAbort(opts.abortSignal);
      return;
    }

    // Use grammyjs/runner for concurrent update processing
    let restartAttempts = 0;
    let consecutiveGetUpdatesConflicts = 0;
    // Wall-clock timestamp of the first 409 in the current cycle. Reset
    // to null whenever a poll succeeds. Used to flag the cycle as
    // "persistent" once it crosses TELEGRAM_PERSISTENT_CONFLICT_THRESHOLD_MS
    // so the dashboard surfaces a UX warning (GH #194).
    let firstConflictAt: number | null = null;
    let persistentConflictReported = false;
    // Bot identity (id + last 4 token chars) baked into every 409 log
    // line so future cascades can be triaged without grepping argent.json
    // for the matching bot id (GH #194 root cause).
    const botIdentity = describeTelegramBotForLog(token);

    try {
      while (!opts.abortSignal?.aborted) {
        const bot = createBot();
        const runner = run(bot, createTelegramRunnerOptions(cfg));
        const stopOnAbort = () => {
          if (opts.abortSignal?.aborted) {
            void runner.stop();
          }
        };
        opts.abortSignal?.addEventListener("abort", stopOnAbort, { once: true });
        reportStatus({
          state: "polling",
          lastError: null,
          nextRetryAt: null,
          // Clear any prior persistent-conflict warning the moment we
          // attempt a fresh poll cycle; we'll re-raise it below if the
          // cycle is still failing past the threshold.
          ...(persistentConflictReported ? { persistentConflict: false } : {}),
        });
        try {
          // runner.task() returns a promise that resolves when the runner stops
          await runner.task();
          // A clean task() resolution without an abort means polling
          // ended of its own accord (rare; usually means runner.stop()
          // was called from elsewhere). Treat as success — clear any
          // pending backoff state before returning.
          if (!opts.abortSignal?.aborted) {
            consecutiveGetUpdatesConflicts = 0;
            restartAttempts = 0;
            firstConflictAt = null;
            persistentConflictReported = false;
          }
          return;
        } catch (err) {
          if (opts.abortSignal?.aborted) {
            throw err;
          }
          try {
            await runner.stop();
          } catch (stopErr) {
            (opts.runtime?.error ?? console.error)(
              `Telegram polling runner stop failed after error: ${formatErrorMessage(stopErr)}.`,
            );
          }
          const isConflict = isGetUpdatesConflict(err);
          const isRecoverable = isRecoverableTelegramNetworkError(err, { context: "polling" });
          if (!isConflict && !isRecoverable) {
            reportStatus({
              state: "exited (manual restart needed)",
              lastError: formatErrorMessage(err),
              nextRetryAt: null,
            });
            throw err;
          }
          restartAttempts += 1;
          const errMsg = formatErrorMessage(err);
          let delayMs: number;
          if (isConflict) {
            consecutiveGetUpdatesConflicts += 1;
            if (firstConflictAt === null) {
              firstConflictAt = Date.now();
            }
            delayMs = computeBackoff(
              TELEGRAM_GET_UPDATES_CONFLICT_BACKOFF,
              consecutiveGetUpdatesConflicts,
            );
          } else {
            consecutiveGetUpdatesConflicts = 0;
            firstConflictAt = null;
            delayMs = computeBackoff(TELEGRAM_POLL_RESTART_POLICY, restartAttempts);
          }
          const reason = isConflict ? "getUpdates conflict" : "network error";
          // Bot identity is included on conflict lines specifically (the
          // GH #194 manual-investigation pain point) so an operator
          // grepping `getUpdates conflict` across hosts immediately
          // knows which bot is racing without cross-referencing config.
          const identitySuffix = isConflict ? ` (${botIdentity})` : "";
          const conflictDurationMs =
            isConflict && firstConflictAt !== null ? Date.now() - firstConflictAt : 0;
          const isPersistent =
            isConflict && conflictDurationMs >= TELEGRAM_PERSISTENT_CONFLICT_THRESHOLD_MS;
          (opts.runtime?.error ?? console.error)(
            `Telegram ${reason}${identitySuffix}: ${errMsg}; retrying in ${formatDurationMs(delayMs)}` +
              (isConflict
                ? ` (consecutive conflicts: ${consecutiveGetUpdatesConflicts}; will keep retrying with exponential backoff capped at ${formatDurationMs(TELEGRAM_GET_UPDATES_CONFLICT_BACKOFF.maxMs)}).`
                : "."),
          );
          if (isPersistent && !persistentConflictReported) {
            // One-time WARN line that explicitly names the failure mode
            // ("another instance is polling this bot") so an operator
            // tailing logs sees it without having to interpret the 409
            // backoff math.
            (opts.runtime?.error ?? console.error)(
              `Telegram getUpdates conflict has persisted for ${formatDurationMs(conflictDurationMs)} (${botIdentity}); another argent-gateway (or other client) appears to be polling this bot. See https://argentos.dev/channels/telegram#another-instance-is-polling-this-bot to resolve.`,
            );
            persistentConflictReported = true;
          }
          reportStatus({
            state: isConflict
              ? `backing-off (next attempt in ${formatDurationMs(delayMs)}; consecutive 409 conflicts: ${consecutiveGetUpdatesConflicts})`
              : `recovering (next attempt in ${formatDurationMs(delayMs)})`,
            lastError: errMsg,
            nextRetryAt: Date.now() + delayMs,
            ...(isConflict
              ? { persistentConflict: isPersistent || persistentConflictReported }
              : persistentConflictReported
                ? { persistentConflict: false }
                : {}),
          });
          if (!isConflict) {
            // Recoverable network error broke the conflict streak — make
            // sure the warning flag is cleared for the next status patch.
            persistentConflictReported = false;
          }
          try {
            await sleepWithAbort(delayMs, opts.abortSignal);
          } catch (sleepErr) {
            if (opts.abortSignal?.aborted) {
              return;
            }
            throw sleepErr;
          }
        } finally {
          opts.abortSignal?.removeEventListener("abort", stopOnAbort);
        }
      }
    } finally {
      pollingSlot.release();
      reportStatus({ state: "stopped", nextRetryAt: null });
    }
  } finally {
    unregisterHandler();
  }
}
