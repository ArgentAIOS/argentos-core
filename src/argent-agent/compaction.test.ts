import { describe, it, expect, vi } from "vitest";
import type { SessionMessage } from "./tokenizer.js";
import {
  compactMessages,
  needsCompaction,
  pruneHistory,
  type CompactionConfig,
} from "./compaction.js";

// ============================================================================
// Helpers
// ============================================================================

/** Build a message with roughly `tokenCount` tokens (chars/4 heuristic). */
function msg(role: SessionMessage["role"], tokenCount: number, label = ""): SessionMessage {
  const content = (label || role).padEnd(tokenCount * 4, "x");
  return { role, content, timestamp: Date.now() };
}

/** Mock provider that returns a canned summary. */
function mockProvider(summaryText = "Mock summary.") {
  return {
    name: "mock",
    execute: vi.fn().mockResolvedValue({
      text: summaryText,
      stopReason: "stop",
      thinking: "",
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
    stream: vi.fn(),
  };
}

/** Mock provider that fails on the first call, succeeds on retry. */
function failOnceThenSucceedProvider() {
  let calls = 0;
  return {
    name: "fail-once",
    execute: vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        throw new Error("Simulated LLM failure");
      }
      return {
        text: "Recovered summary.",
        stopReason: "stop",
        thinking: "",
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }),
    stream: vi.fn(),
  };
}

/** Mock provider that always fails. */
function alwaysFailProvider() {
  return {
    name: "always-fail",
    execute: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    stream: vi.fn(),
  };
}

function makeConfig(overrides: Partial<CompactionConfig> = {}): CompactionConfig {
  return {
    provider: mockProvider(),
    model: { id: "test-model", maxTokens: 4096 },
    maxContextTokens: 1000,
    thresholdRatio: 0.5,
    keepRecentMessages: 3,
    ...overrides,
  };
}

// ============================================================================
// needsCompaction
// ============================================================================

describe("needsCompaction", () => {
  it("returns false when under threshold", () => {
    const messages = [msg("user", 100)];
    expect(needsCompaction(messages, 1000, 0.8)).toBe(false);
  });

  it("returns true when over threshold", () => {
    const messages = [msg("user", 500), msg("assistant", 500)];
    expect(needsCompaction(messages, 1000, 0.8)).toBe(true);
  });

  it("uses default threshold of 0.8", () => {
    const messages = [msg("user", 750)];
    expect(needsCompaction(messages, 1000)).toBe(false);
    const bigger = [msg("user", 850)];
    expect(needsCompaction(bigger, 1000)).toBe(true);
  });
});

// ============================================================================
// compactMessages — basic
// ============================================================================

describe("compactMessages", () => {
  it("returns unchanged when below threshold", async () => {
    const messages = [msg("user", 50), msg("assistant", 50)];
    const config = makeConfig({ maxContextTokens: 10000 });
    const result = await compactMessages(messages, config);
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("summarizes old messages and keeps recent", async () => {
    const messages = [
      msg("user", 200, "old1"),
      msg("assistant", 200, "old2"),
      msg("user", 50, "recent1"),
      msg("assistant", 50, "recent2"),
      msg("user", 50, "recent3"),
    ];
    const provider = mockProvider("Summarized old conversation.");
    const config = makeConfig({ provider });

    const result = await compactMessages(messages, config);

    expect(result.compacted).toBe(true);
    expect(result.removedCount).toBe(2); // old1 + old2
    expect(result.messages[0].content).toContain("Summarized old conversation.");
    expect(result.messages.length).toBe(4); // summary + 3 recent
    expect(result.tokenSavings).toBeGreaterThan(0);
  });

  it("preserves tool call / tool result pairs at split boundary", async () => {
    const messages = [
      msg("user", 200, "old"),
      msg("assistant", 200, "old-response"),
      msg("user", 50, "trigger"),
      {
        role: "assistant" as const,
        content: "calling tool",
        toolCalls: [{ id: "1", name: "read", arguments: {} }],
        timestamp: Date.now(),
      },
      { role: "tool" as const, content: "file contents", toolCallId: "1", timestamp: Date.now() },
      msg("assistant", 50, "final"),
    ];
    const config = makeConfig({ provider: mockProvider(), keepRecentMessages: 3 });

    const result = await compactMessages(messages, config);

    // The tool result at index 4 should pull in the assistant at index 3
    // So the split should not break the pair
    expect(result.compacted).toBe(true);
    const keptRoles = result.messages.slice(1).map((m) => m.role);
    // No orphaned tool result without its assistant
    for (let i = 0; i < keptRoles.length; i++) {
      if (keptRoles[i] === "tool") {
        expect(i).toBeGreaterThan(0);
        expect(keptRoles[i - 1]).toBe("assistant");
      }
    }
  });
});

// ============================================================================
// compactMessages — multi-stage
// ============================================================================

describe("compactMessages — multi-stage", () => {
  it("calls provider multiple times for large conversations", async () => {
    // Create enough messages to trigger multi-stage (>4 messages, tokens > maxChunkTokens)
    const messages: SessionMessage[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(msg(i % 2 === 0 ? "user" : "assistant", 100, `msg${i}`));
    }
    // Add 3 recent to keep
    messages.push(msg("user", 20, "recent1"));
    messages.push(msg("assistant", 20, "recent2"));
    messages.push(msg("user", 20, "recent3"));

    const provider = mockProvider("Partial summary.");
    const config = makeConfig({
      provider,
      maxContextTokens: 500, // Low threshold to trigger compaction
      thresholdRatio: 0.1,
      parts: 3,
    });

    const result = await compactMessages(messages, config);

    expect(result.compacted).toBe(true);
    // Provider should be called multiple times (parts + merge)
    const callCount = (provider.execute as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCount).toBeGreaterThan(1);
  });
});

// ============================================================================
// compactMessages — progressive fallback
// ============================================================================

describe("compactMessages — progressive fallback", () => {
  it("falls back to partial summarization when full fails", async () => {
    const messages = [
      msg("user", 200, "normal"),
      msg("assistant", 200, "normal-response"),
      msg("user", 50, "recent1"),
      msg("assistant", 50, "recent2"),
      msg("user", 50, "recent3"),
    ];

    const provider = failOnceThenSucceedProvider();
    const config = makeConfig({ provider });

    // Suppress console.warn during test
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await compactMessages(messages, config);

    expect(result.compacted).toBe(true);
    expect(result.summary).toContain("Recovered summary.");
    warnSpy.mockRestore();
  });

  it("falls back to bare note when all summarization fails", async () => {
    const messages = [
      msg("user", 200, "old1"),
      msg("assistant", 200, "old2"),
      msg("user", 50, "recent1"),
      msg("assistant", 50, "recent2"),
      msg("user", 50, "recent3"),
    ];

    const provider = alwaysFailProvider();
    const config = makeConfig({ provider });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await compactMessages(messages, config);

    expect(result.compacted).toBe(true);
    expect(result.summary).toContain("Context contained");
    expect(result.summary).toContain("Summary unavailable");
    warnSpy.mockRestore();
  });
});

// ============================================================================
// pruneHistory
// ============================================================================

describe("pruneHistory", () => {
  it("returns unchanged when under budget", () => {
    const messages = [msg("user", 50), msg("assistant", 50)];
    const result = pruneHistory({
      messages,
      maxContextTokens: 10000,
    });
    expect(result.droppedCount).toBe(0);
    expect(result.messages.length).toBe(2);
  });

  it("drops oldest chunks to fit budget", () => {
    const messages = [
      msg("user", 200, "old1"),
      msg("assistant", 200, "old2"),
      msg("user", 200, "mid1"),
      msg("assistant", 200, "mid2"),
      msg("user", 100, "recent1"),
      msg("assistant", 100, "recent2"),
    ];

    const result = pruneHistory({
      messages,
      maxContextTokens: 600, // budget = 300 (50% share)
      maxHistoryShare: 0.5,
    });

    expect(result.droppedCount).toBeGreaterThan(0);
    expect(result.keptTokens).toBeLessThanOrEqual(result.budgetTokens);
    // Recent messages should be preserved
    const keptContents = result.messages.map((m) => m.content);
    expect(keptContents.some((c) => c.startsWith("recent"))).toBe(true);
  });

  it("respects maxHistoryShare parameter", () => {
    const messages = [msg("user", 200), msg("assistant", 200)];

    const generous = pruneHistory({
      messages,
      maxContextTokens: 1000,
      maxHistoryShare: 0.9,
    });
    const strict = pruneHistory({
      messages,
      maxContextTokens: 1000,
      maxHistoryShare: 0.1,
    });

    expect(strict.droppedCount).toBeGreaterThanOrEqual(generous.droppedCount);
  });
});
