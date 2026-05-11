import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireTelegramPollingSlot,
  describeTelegramBotForLog,
  extractTelegramBotIdFromToken,
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

describe("Telegram bot identity helpers (GH #194)", () => {
  describe("extractTelegramBotIdFromToken", () => {
    it("returns the numeric leading segment of a well-formed token", () => {
      expect(extractTelegramBotIdFromToken("8619589114:AAH-some-secret")).toBe("8619589114");
    });

    it("trims surrounding whitespace before parsing", () => {
      expect(extractTelegramBotIdFromToken("  123456789:secret  ")).toBe("123456789");
    });

    it("returns null for malformed / placeholder tokens", () => {
      expect(extractTelegramBotIdFromToken("tok")).toBeNull();
      expect(extractTelegramBotIdFromToken("not-a-token")).toBeNull();
      expect(extractTelegramBotIdFromToken(":no-id-before-colon")).toBeNull();
      expect(extractTelegramBotIdFromToken("")).toBeNull();
      expect(extractTelegramBotIdFromToken(null)).toBeNull();
      expect(extractTelegramBotIdFromToken(undefined)).toBeNull();
    });
  });

  describe("describeTelegramBotForLog", () => {
    it("emits bot=<id>, token=...<last4> for well-formed tokens", () => {
      expect(describeTelegramBotForLog("8619589114:AAHabc...XYZW")).toBe(
        "bot=8619589114, token=...XYZW",
      );
    });

    it("never leaks the secret half of the token", () => {
      const secret = "AAHabcdefghijklmnopqrstuvwxyzWXYZ";
      const out = describeTelegramBotForLog(`8619589114:${secret}`);
      expect(out).not.toContain(secret);
      // Only the trailing 4 chars should appear.
      expect(out).toContain("...WXYZ");
    });

    it("falls back to bot=? when the token shape is unknown", () => {
      expect(describeTelegramBotForLog("malformed")).toBe("bot=?, token=...rmed");
      expect(describeTelegramBotForLog("")).toBe("bot=?, token=?");
      expect(describeTelegramBotForLog(undefined)).toBe("bot=?, token=?");
    });
  });
});
