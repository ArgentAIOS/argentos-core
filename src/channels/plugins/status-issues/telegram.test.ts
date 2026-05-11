import { describe, expect, it } from "vitest";
import type { ChannelAccountSnapshot } from "../types.js";
import { collectTelegramStatusIssues } from "./telegram.js";

const baseAccount: ChannelAccountSnapshot = {
  accountId: "default",
  enabled: true,
  configured: true,
};

describe("collectTelegramStatusIssues", () => {
  it("skips accounts that are disabled or unconfigured", () => {
    expect(
      collectTelegramStatusIssues([
        { ...baseAccount, enabled: false, persistentConflict: true },
        { ...baseAccount, configured: false, persistentConflict: true },
      ]),
    ).toEqual([]);
  });

  it("emits a runtime issue when persistentConflict is true (GH #194)", () => {
    const issues = collectTelegramStatusIssues([
      {
        ...baseAccount,
        persistentConflict: true,
        lastError: "terminated by other getUpdates request",
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      channel: "telegram",
      accountId: "default",
      kind: "runtime",
    });
    // Exact phrasing matches GH #194 spec + the dashboard chip copy.
    expect(issues[0].message).toContain("Another instance is polling this bot");
    expect(issues[0].message).toContain(
      "argentos.dev/channels/telegram#another-instance-is-polling-this-bot",
    );
    // The last error is included so the operator can copy the verbatim
    // Telegram error into a search engine if needed.
    expect(issues[0].message).toContain("terminated by other getUpdates request");
    // The fix string must point at the resolution path (stop other
    // gateway / rotate token / switch to webhooks).
    expect(issues[0].fix).toMatch(/webhook|gateway|token/i);
  });

  it("omits the lastError suffix gracefully when the channel hasn't recorded one", () => {
    const issues = collectTelegramStatusIssues([{ ...baseAccount, persistentConflict: true }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Another instance is polling this bot");
    expect(issues[0].message).not.toContain("last error:");
  });

  it("does not emit the persistent-conflict issue when the flag is absent or false", () => {
    expect(
      collectTelegramStatusIssues([
        { ...baseAccount, persistentConflict: false },
        { ...baseAccount },
      ]),
    ).toEqual([]);
  });
});
