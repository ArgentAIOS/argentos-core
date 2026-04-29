import crypto from "node:crypto";

type ActiveTelegramPoller = {
  accountId: string;
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

export function fingerprintTelegramToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function acquireTelegramPollingSlot(params: {
  token: string;
  accountId: string;
  now?: number;
}): TelegramPollingSlot {
  const tokenHash = fingerprintTelegramToken(params.token);
  const existing = activePollers.get(tokenHash);
  if (existing) {
    return { acquired: false, tokenHash, existing };
  }

  const entry: ActiveTelegramPoller = {
    accountId: params.accountId,
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
    },
  };
}

export function resetTelegramPollingSlotsForTest() {
  activePollers.clear();
}
