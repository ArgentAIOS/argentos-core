import { describe, expect, it } from "vitest";
import { __testing } from "./slack-signal-monitor-tool.js";

const {
  cleanSlackText,
  summarizeMessage,
  extractMentionedUserIds,
  matchKeywords,
  isHighSignalKeywordHit,
  isActionableMention,
  isAllChannelsToken,
  normalizeWatchedChannels,
  includesAllChannelsToken,
  defaultState,
  normalizeState,
  selectCronMonitorJobs,
} = __testing;

describe("slack_signal_monitor helpers", () => {
  it("cleans slack markup from text", () => {
    const raw = "<@U123> check <#C999|ops> and <https://example.com|this link>";
    expect(cleanSlackText(raw)).toBe("@U123 check #ops and this link");
  });

  it("extracts mentioned slack user ids", () => {
    const ids = extractMentionedUserIds("ping <@UD3A8KLT0> and <@UD5UV7MR7>");
    expect(Array.from(ids)).toEqual(["UD3A8KLT0", "UD5UV7MR7"]);
  });

  it("matches keyword watchlist case-insensitively", () => {
    const hits = matchKeywords("Need DNS + DMARC updates", ["dns", "DMARC", "hosting"]);
    expect(hits).toEqual(["dns", "DMARC"]);
  });

  it("identifies high-signal keyword events", () => {
    expect(isHighSignalKeywordHit(["DNS"], "Can someone help?")).toBe(true);
    expect(isHighSignalKeywordHit(["urgent"], "heads up")).toBe(true);
    expect(isHighSignalKeywordHit(["DNS", "DMARC"], "status")).toBe(true);
    expect(isHighSignalKeywordHit(["DNS"], "FYI only")).toBe(false);
  });

  it("detects actionable mentions", () => {
    expect(isActionableMention("@jason can you review this?")).toBeTruthy();
    expect(isActionableMention("@jason please deploy this")).toBeTruthy();
    expect(isActionableMention("@jason urgent need your help")).toBeTruthy();
    expect(isActionableMention("@jason fyi website is live")).toBeFalsy();
  });

  it("normalizes persisted state safely", () => {
    const state = normalizeState({
      watchedChannels: [" C1 ", "C1", "C2"],
      mentionNames: ["Jason", "jason"],
      mentionUserIds: ["<@U123>", "u123"],
      keywordWatchlist: ["DNS", "", "DMARC"],
      lookbackMinutes: 999,
      intervalSeconds: 5,
    });
    expect(state.watchedChannels).toEqual(["C1", "C2"]);
    expect(state.monitorAllChannels).toBe(false);
    expect(state.mentionNames).toEqual(["jason"]);
    expect(state.mentionUserIds).toEqual(["U123"]);
    expect(state.keywordWatchlist).toEqual(["DNS", "DMARC"]);
    expect(state.lookbackMinutes).toBe(180);
    expect(state.intervalSeconds).toBe(10);
  });

  it("supports all-channels tokens in config", () => {
    expect(isAllChannelsToken("*")).toBe(true);
    expect(isAllChannelsToken("all_channels")).toBe(true);
    expect(isAllChannelsToken("ALL-CHANNELS")).toBe(true);
    expect(isAllChannelsToken("C123")).toBe(false);
    expect(includesAllChannelsToken(["general", "all"])).toBe(true);
    expect(normalizeWatchedChannels(["C1", "all", "C2", "*"])).toEqual(["C1", "C2"]);

    const state = normalizeState({
      watchedChannels: ["all", "C01", "C02"],
    });
    expect(state.monitorAllChannels).toBe(true);
    expect(state.watchedChannels).toEqual(["C01", "C02"]);
  });

  it("selects deterministic cron monitor candidate", () => {
    const jobs = [
      { id: "a", name: "legacy monitor", enabled: true, payloadKind: "agentTurn", updatedAtMs: 1 },
      {
        id: "b",
        name: "Slack Signal Monitor - Mention + Keyword Scan",
        enabled: true,
        payloadKind: "slackSignalScan",
        updatedAtMs: 2,
      },
      {
        id: "c",
        name: "Slack Signal Monitor duplicate",
        enabled: false,
        payloadKind: "slackSignalScan",
        updatedAtMs: 3,
      },
    ];
    const selected = selectCronMonitorJobs({ jobs, preferredId: "b" });
    expect(selected.selected?.id).toBe("b");
    expect(selected.duplicates.map((entry) => entry.id).toSorted()).toEqual(["c"]);
  });

  it("summary truncates long content", () => {
    const long = `${"x".repeat(400)} end`;
    const summary = summarizeMessage(long, 40);
    expect(summary.endsWith("...")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(40);
  });

  it("default state includes issue watchlist", () => {
    const state = defaultState();
    expect(state.monitorAllChannels).toBe(true);
    expect(state.keywordWatchlist).toContain("DNS");
    expect(state.keywordWatchlist).toContain("Barrett");
    expect(state.keywordWatchlist).toContain("urgent");
  });
});
