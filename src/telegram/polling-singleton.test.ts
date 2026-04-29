import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireTelegramPollingSlot,
  resetTelegramPollingSlotsForTest,
} from "./polling-singleton.js";

let lockRoot: string;

describe("Telegram polling singleton", () => {
  beforeEach(() => {
    resetTelegramPollingSlotsForTest();
    lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argent-telegram-lock-"));
  });

  afterEach(() => {
    resetTelegramPollingSlotsForTest();
    fs.rmSync(lockRoot, { recursive: true, force: true });
  });

  it("blocks duplicate pollers with a filesystem lock", () => {
    const first = acquireTelegramPollingSlot({
      token: "123:abc",
      accountId: "default",
      lockRoot,
    });
    expect(first.acquired).toBe(true);

    resetTelegramPollingSlotsForTest();
    const second = acquireTelegramPollingSlot({
      token: "123:abc",
      accountId: "default",
      lockRoot,
    });
    expect(second.acquired).toBe(false);

    if (first.acquired) {
      first.release();
    }

    const third = acquireTelegramPollingSlot({
      token: "123:abc",
      accountId: "default",
      lockRoot,
    });
    expect(third.acquired).toBe(true);
    if (third.acquired) {
      third.release();
    }
  });
});
