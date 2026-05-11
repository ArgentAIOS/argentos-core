import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../config/paths.js";

type ActiveTelegramPoller = {
  accountId: string;
  pid: number;
  tokenHash: string;
  startedAt: number;
};

export type TelegramPollingSlot =
  | {
      acquired: true;
      tokenHash: string;
      release: () => void;
    }
  | {
      acquired: false;
      tokenHash: string;
      existing: ActiveTelegramPoller;
    };

const activePollers = new Map<string, ActiveTelegramPoller>();
const DEFAULT_LOCK_ROOT =
  process.env.VITEST_WORKER_ID == null ? path.join(STATE_DIR, "telegram", "polling-locks") : null;

export function fingerprintTelegramToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
}

/**
 * Telegram bot tokens have the shape `<botId>:<secret>` where `<botId>` is
 * the numeric Telegram user id of the bot account. Extract the leading
 * numeric segment so we can include it in logs/status without ever
 * touching the secret half. Returns `null` if the token doesn't match the
 * expected shape (e.g. unconfigured or truncated tokens during tests).
 */
export function extractTelegramBotIdFromToken(token: string | undefined | null): string | null {
  if (typeof token !== "string") {
    return null;
  }
  const match = token.trim().match(/^(\d+):/);
  return match ? match[1] : null;
}

/**
 * Build a redacted identity string for log/status messages so future 409
 * cascades can be triaged without reading argent.json. Includes the bot
 * id (when derivable) and a non-reversible 4-char suffix of the token to
 * disambiguate when the same gateway holds tokens for multiple accounts.
 * Never returns the full token.
 *
 * Examples:
 *   describeTelegramBotForLog("8619589114:AAH...XYZW") → "bot=8619589114, token=...XYZW"
 *   describeTelegramBotForLog("malformed")            → "bot=?, token=...rmed"
 *   describeTelegramBotForLog("")                     → "bot=?, token=?"
 */
export function describeTelegramBotForLog(token: string | undefined | null): string {
  const trimmed = typeof token === "string" ? token.trim() : "";
  const botId = extractTelegramBotIdFromToken(trimmed);
  const suffix = trimmed.length >= 4 ? trimmed.slice(-4) : "";
  const botPart = botId ? `bot=${botId}` : "bot=?";
  const tokenPart = suffix ? `token=...${suffix}` : "token=?";
  return `${botPart}, ${tokenPart}`;
}

export function acquireTelegramPollingSlot(params: {
  token: string;
  accountId: string;
  now?: number;
  lockRoot?: string | null;
}): TelegramPollingSlot {
  const tokenHash = fingerprintTelegramToken(params.token);
  const existing = activePollers.get(tokenHash);
  if (existing) {
    return { acquired: false, tokenHash, existing };
  }

  const lockRoot = params.lockRoot === undefined ? DEFAULT_LOCK_ROOT : params.lockRoot;
  const lockPath = lockRoot ? path.join(lockRoot, `${tokenHash}.json`) : null;
  const fileLock = lockPath ? acquireFileLock({ lockPath, accountId: params.accountId }) : null;
  if (fileLock && !fileLock.acquired) {
    return { acquired: false, tokenHash, existing: { ...fileLock.existing, tokenHash } };
  }

  const entry: ActiveTelegramPoller = {
    accountId: params.accountId,
    pid: process.pid,
    tokenHash,
    startedAt: params.now ?? Date.now(),
  };
  activePollers.set(tokenHash, entry);

  let released = false;
  return {
    acquired: true,
    tokenHash,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      if (activePollers.get(tokenHash) === entry) {
        activePollers.delete(tokenHash);
      }
      fileLock?.release();
    },
  };
}

export function resetTelegramPollingSlotsForTest() {
  activePollers.clear();
}

function acquireFileLock(params: {
  lockPath: string;
  accountId: string;
}):
  | { acquired: true; release: () => void }
  | { acquired: false; existing: Omit<ActiveTelegramPoller, "tokenHash"> } {
  fs.mkdirSync(path.dirname(params.lockPath), { recursive: true });
  const entry = {
    accountId: params.accountId,
    pid: process.pid,
    startedAt: Date.now(),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(params.lockPath, JSON.stringify(entry), { flag: "wx" });
      return {
        acquired: true,
        release: () => {
          releaseFileLock(params.lockPath, entry.pid);
        },
      };
    } catch (err) {
      const code = typeof err === "object" && err ? (err as { code?: string }).code : undefined;
      if (code !== "EEXIST") {
        throw err;
      }
      const existing = readFileLock(params.lockPath);
      if (!existing || !isPidLive(existing.pid)) {
        try {
          fs.unlinkSync(params.lockPath);
        } catch (unlinkErr) {
          const unlinkCode =
            typeof unlinkErr === "object" && unlinkErr
              ? (unlinkErr as { code?: string }).code
              : undefined;
          if (unlinkCode !== "ENOENT") {
            throw unlinkErr;
          }
        }
        continue;
      }
      return { acquired: false, existing };
    }
  }
  return { acquired: false, existing: readFileLock(params.lockPath) ?? entry };
}

function readFileLock(lockPath: string): Omit<ActiveTelegramPoller, "tokenHash"> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
      accountId?: unknown;
      pid?: unknown;
      startedAt?: unknown;
    };
    const pid = typeof parsed.pid === "number" ? parsed.pid : Number(parsed.pid);
    const startedAt =
      typeof parsed.startedAt === "number" ? parsed.startedAt : Number(parsed.startedAt);
    if (!Number.isFinite(pid)) {
      return null;
    }
    return {
      accountId: typeof parsed.accountId === "string" ? parsed.accountId : "unknown",
      pid,
      startedAt: Number.isFinite(startedAt) ? startedAt : 0,
    };
  } catch {
    return null;
  }
}

function releaseFileLock(lockPath: string, pid: number) {
  const existing = readFileLock(lockPath);
  if (existing && existing.pid !== pid) {
    return;
  }
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
    const code = typeof err === "object" && err ? (err as { code?: string }).code : undefined;
    if (code !== "ENOENT") {
      throw err;
    }
  }
}

function isPidLive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
