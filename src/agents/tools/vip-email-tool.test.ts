import { describe, expect, it } from "vitest";
import { __testing } from "./vip-email-tool.js";

describe("vip email cron monitor helpers", () => {
  it("normalizes punctuation variants in cron names", () => {
    const name = `VIP Email Alert \u2014 Process Pending`;
    expect(__testing.normalizeCronNameForMatch(name)).toBe("vip email alert - process pending");
  });

  it("identifies legacy vip monitor payloads", () => {
    const fromLegacyAgentTurn = __testing.toCronMonitorCandidate({
      id: "legacy-agent",
      enabled: true,
      name: "VIP Email Monitor",
      payload: {
        kind: "agentTurn",
        message: "Run vip_email scan_now and alert me",
      },
    });
    expect(fromLegacyAgentTurn).not.toBeNull();
    if (!fromLegacyAgentTurn) {
      throw new Error("expected legacy agentTurn candidate");
    }
    expect(__testing.isVipMonitorCandidate(fromLegacyAgentTurn)).toBe(true);

    const fromLegacySystemEvent = __testing.toCronMonitorCandidate({
      id: "legacy-main",
      enabled: false,
      payload: {
        kind: "systemEvent",
        text: "VIP Email Alert System: process pending emails",
      },
    });
    expect(fromLegacySystemEvent).not.toBeNull();
    if (!fromLegacySystemEvent) {
      throw new Error("expected legacy systemEvent candidate");
    }
    expect(__testing.isVipMonitorCandidate(fromLegacySystemEvent)).toBe(true);
  });

  it("prefers deterministic vipEmailScan jobs over legacy monitor jobs", () => {
    const canonical = __testing.toCronMonitorCandidate({
      id: "canonical",
      enabled: true,
      name: "VIP Email Alert - Monitor Inbox",
      updatedAtMs: 10,
      payload: {
        kind: "vipEmailScan",
      },
    });
    const legacy = __testing.toCronMonitorCandidate({
      id: "legacy",
      enabled: true,
      name: "VIP Email Monitor - Dustin",
      updatedAtMs: 20,
      payload: {
        kind: "agentTurn",
        message: "Run vip_email scan_now to check for new emails",
      },
    });

    expect(canonical).not.toBeNull();
    expect(legacy).not.toBeNull();
    if (!canonical || !legacy) {
      throw new Error("expected candidates");
    }

    const selected = __testing.selectCronMonitorJobs({
      jobs: [legacy, canonical],
      preferredId: "legacy",
    });
    expect(selected.selected?.id).toBe("canonical");
    expect(selected.duplicates.map((job) => job.id)).toEqual(["legacy"]);
  });

  it("formats single-email main-session audio summary", () => {
    const payload = __testing.formatMainSessionAudioAlert([
      {
        key: "a",
        id: "a",
        account: "ops@example.com",
        senderEmail: "ceo@example.com",
        senderName: "Dustin",
        from: "Dustin <ceo@example.com>",
        subject: "Need quick update",
        snippet: "Can you call me back in 10 minutes?",
        date: "2026-03-04T00:00:00.000Z",
      },
    ]);
    expect(payload.title).toBe("VIP email: Dustin");
    expect(payload.message).toContain("Dustin just emailed you");
    expect(payload.message).toContain("Need quick update");
  });

  it("formats multi-email main-session audio summary", () => {
    const payload = __testing.formatMainSessionAudioAlert([
      {
        key: "a",
        id: "a",
        account: "ops@example.com",
        senderEmail: "ceo@example.com",
        senderName: "Dustin",
        from: "Dustin <ceo@example.com>",
        subject: "Need quick update",
        snippet: "",
        date: "2026-03-04T00:00:00.000Z",
      },
      {
        key: "b",
        id: "b",
        account: "ops@example.com",
        senderEmail: "cto@example.com",
        senderName: "Alex",
        from: "Alex <cto@example.com>",
        subject: "FYI",
        snippet: "",
        date: "2026-03-04T00:00:01.000Z",
      },
    ]);
    expect(payload.title).toBe("VIP emails: 2 new");
    expect(payload.message).toContain("2 new VIP emails");
    expect(payload.message).toContain("Latest is from Dustin");
  });
});
