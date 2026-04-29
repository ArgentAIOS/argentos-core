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
