import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../../config/sessions/types.js";
import {
  buildCrossChannelContextBlock,
  buildSessionBootstrapBlock,
  extractAssistantTextForContext,
  inferSessionChannelFromKey,
  resolveSessionBootstrapSnapshotFromStore,
  selectCrossChannelEventSummary,
} from "./session-context.js";

describe("session bootstrap context", () => {
  it("prefers freshest global interaction fields", () => {
    const store: Record<string, SessionEntry> = {
      __lastUserMessage: {
        sessionId: "global",
        updatedAt: 1000,
        previousLastUserMessageAt: 900,
        previousSessionKey: "agent:main:discord:dm:123",
        lastUserMessageAt: 1000,
        lastInteractionSessionKey: "agent:main:webchat-1",
        sessionClearedAt: 950,
        sessionClearedFromKey: "agent:main:webchat-1",
        sessionClearedReason: "sessions.reset",
      },
    };
    const snapshot = resolveSessionBootstrapSnapshotFromStore(store);
    expect(snapshot.lastInteractionAtMs).toBe(1000);
    expect(snapshot.lastSessionKey).toBe("agent:main:webchat-1");
    expect(snapshot.sessionClearedAtMs).toBe(950);
    expect(snapshot.sessionClearedFromKey).toBe("agent:main:webchat-1");
    expect(snapshot.sessionClearedReason).toBe("sessions.reset");
  });

  it("falls back to freshest per-session activity when global marker is stale", () => {
    const store: Record<string, SessionEntry> = {
      __lastUserMessage: {
        sessionId: "global",
        updatedAt: 1000,
        previousLastUserMessageAt: 900,
        previousSessionKey: "agent:main:discord:dm:123",
        lastUserMessageAt: 1000,
        lastInteractionSessionKey: "agent:main:webchat-1",
      },
      "agent:main:main": {
        sessionId: "s-main",
        updatedAt: 2_000,
        lastUserMessageAt: 1_900,
      },
    };
    const snapshot = resolveSessionBootstrapSnapshotFromStore(store);
    expect(snapshot.lastInteractionAtMs).toBe(1_900);
    expect(snapshot.lastSessionKey).toBe("agent:main:main");
  });

  it("falls back to best session entry when global key missing", () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:webchat": { sessionId: "s1", updatedAt: 1000, lastUserMessageAt: 900 },
      "agent:main:telegram:dm:42": { sessionId: "s2", updatedAt: 2000, lastUserMessageAt: 1900 },
    };
    const snapshot = resolveSessionBootstrapSnapshotFromStore(store);
    expect(snapshot.lastInteractionAtMs).toBe(1900);
    expect(snapshot.lastSessionKey).toBe("agent:main:telegram:dm:42");
  });

  it("builds a SESSION_BOOTSTRAP block", () => {
    const block = buildSessionBootstrapBlock({
      nowMs: Date.parse("2026-03-01T12:20:00.000Z"),
      status: "fresh",
      lastInteractionAtMs: Date.parse("2026-03-01T12:05:00.000Z"),
      lastSessionKey: "agent:main:webchat:dm:abc",
      sessionClearedAtMs: Date.parse("2026-03-01T12:19:30.000Z"),
      sessionClearedFromKey: "agent:main:webchat:dm:abc",
      sessionClearedReason: "sessions.reset",
    });
    expect(block).toContain("[SESSION_BOOTSTRAP]");
    expect(block).toContain("Status: fresh");
    expect(block).toContain("channel: webchat");
    expect(block).toContain("[SESSION_CLEARED]");
    expect(block).toContain("Reason: sessions.reset");
  });

  it("infers channel from agent session key", () => {
    expect(inferSessionChannelFromKey("agent:main:discord:dm:123")).toBe("discord");
    expect(inferSessionChannelFromKey("agent:main:main", "webchat")).toBe("webchat");
  });
});

describe("cross-channel context", () => {
  it("extracts assistant text from content blocks", () => {
    const text = extractAssistantTextForContext({
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    });
    expect(text).toBe("first second");
  });

  it("selects significant summary from tool activity", () => {
    const summary = selectCrossChannelEventSummary({
      assistantText: "Added comment and reassigned ticket #55335 to Alex.",
      toolMetas: [{ toolName: "atera_ticket", meta: "comment" }],
      messagingToolSentTexts: [],
    });
    expect(summary).toContain("#55335");
  });

  it("ignores non-significant chatter", () => {
    const summary = selectCrossChannelEventSummary({
      assistantText: "Sounds good.",
      toolMetas: [],
      messagingToolSentTexts: [],
    });
    expect(summary).toBeUndefined();
  });

  it("builds context block and excludes current session", () => {
    const block = buildCrossChannelContextBlock({
      currentSessionKey: "agent:main:webchat:dm:abc",
      events: [
        {
          timestampMs: 1000,
          sessionKey: "agent:main:webchat:dm:abc",
          channel: "webchat",
          summary: "same session",
        },
        {
          timestampMs: 2000,
          sessionKey: "agent:main:discord:dm:123",
          channel: "discord",
          summary: "Filed issue #37 and updated docs.",
        },
      ],
    });
    expect(block).toContain("[CROSS_CHANNEL_CONTEXT]");
    expect(block).toContain("discord");
    expect(block).not.toContain("same session");
  });
});
