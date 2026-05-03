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
import { acquireTelegramPollingSlot } from "./polling-singleton.js";
import { makeProxyFetch } from "./proxy.js";
import { readTelegramUpdateOffset, writeTelegramUpdateOffset } from "./update-offset-store.js";
import { startTelegramWebhook } from "./webhook.js";

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
const TELEGRAM_GET_UPDATES_CONFLICT_COOLDOWN_MS =
  (TELEGRAM_LONG_POLL_TIMEOUT_SECONDS * 2 + 5) * 1000;
const TELEGRAM_GET_UPDATES_CONFLICT_MAX_CONSECUTIVE = 3;

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
      await waitForAbort(opts.abortSignal);
      return;
    }

    // Use grammyjs/runner for concurrent update processing
    let restartAttempts = 0;
    let consecutiveGetUpdatesConflicts = 0;

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
        try {
          // runner.task() returns a promise that resolves when the runner stops
          await runner.task();
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
            throw err;
          }
          restartAttempts += 1;
          const errMsg = formatErrorMessage(err);
          if (isConflict) {
            consecutiveGetUpdatesConflicts += 1;
            if (consecutiveGetUpdatesConflicts >= TELEGRAM_GET_UPDATES_CONFLICT_MAX_CONSECUTIVE) {
              const message = `Telegram getUpdates conflict persisted for ${consecutiveGetUpdatesConflicts} consecutive attempts on account "${account.accountId}"; stopping polling until channel restart to avoid fighting another poller.`;
              (opts.runtime?.error ?? console.error)(`${message} Last error: ${errMsg}.`);
              throw new Error(message, { cause: err });
            }
          } else {
            consecutiveGetUpdatesConflicts = 0;
          }
          const retryDelayMs = computeBackoff(TELEGRAM_POLL_RESTART_POLICY, restartAttempts);
          const delayMs = isConflict
            ? Math.max(retryDelayMs, TELEGRAM_GET_UPDATES_CONFLICT_COOLDOWN_MS)
            : retryDelayMs;
          const reason = isConflict ? "getUpdates conflict" : "network error";
          (opts.runtime?.error ?? console.error)(
            `Telegram ${reason}: ${errMsg}; retrying in ${formatDurationMs(delayMs)}.`,
          );
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
    }
  } finally {
    unregisterHandler();
  }
}
