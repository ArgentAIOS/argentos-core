import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ARGENT_PROMPT_BUDGET_LOG_ENV,
  isPromptBudgetLoggingEnabled,
  PromptBudgetTracker,
  getCurrentPromptBudgetTracker,
  runWithPromptBudget,
} from "./prompt-budget.js";

describe("prompt-budget", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ARGENT_PROMPT_BUDGET_LOG_ENV];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env[ARGENT_PROMPT_BUDGET_LOG_ENV];
    } else {
      process.env[ARGENT_PROMPT_BUDGET_LOG_ENV] = savedEnv;
    }
  });

  it("defaults to disabled", () => {
    delete process.env[ARGENT_PROMPT_BUDGET_LOG_ENV];
    expect(isPromptBudgetLoggingEnabled()).toBe(false);
  });

  it("enables when env var is set to '1'", () => {
    process.env[ARGENT_PROMPT_BUDGET_LOG_ENV] = "1";
    expect(isPromptBudgetLoggingEnabled()).toBe(true);
  });

  it("stays disabled for any other value", () => {
    process.env[ARGENT_PROMPT_BUDGET_LOG_ENV] = "true";
    expect(isPromptBudgetLoggingEnabled()).toBe(false);
    process.env[ARGENT_PROMPT_BUDGET_LOG_ENV] = "0";
    expect(isPromptBudgetLoggingEnabled()).toBe(false);
  });

  it("record() accumulates char + token counts", () => {
    process.env[ARGENT_PROMPT_BUDGET_LOG_ENV] = "1";
    const t = new PromptBudgetTracker();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      t.record("soul.md", "hello");
      t.record("memory", ["one", "two", "three"]); // 3 + 3 + 5 + 2 newlines = 13
      expect(t.getEntries()).toEqual([
        { name: "soul.md", chars: 5, tokens: 2 },
        { name: "memory", chars: 13, tokens: 4 },
      ]);
      expect(t.totalChars()).toBe(18);
      expect(t.totalTokens()).toBe(6);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("record() no-ops for empty, nullish, or empty-array inputs", () => {
    const t = new PromptBudgetTracker();
    t.record("a", "");
    t.record("b", null);
    t.record("c", undefined);
    t.record("d", []);
    expect(t.getEntries()).toEqual([]);
  });

  it("getCurrentPromptBudgetTracker returns undefined when disabled", async () => {
    delete process.env[ARGENT_PROMPT_BUDGET_LOG_ENV];
    await runWithPromptBudget(async (tracker) => {
      expect(tracker).toBeInstanceOf(PromptBudgetTracker);
      // When disabled, the accessor should not leak the tracker to callers.
      expect(getCurrentPromptBudgetTracker()).toBeUndefined();
    });
  });

  it("getCurrentPromptBudgetTracker returns the active tracker when enabled", async () => {
    process.env[ARGENT_PROMPT_BUDGET_LOG_ENV] = "1";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { tracker } = await runWithPromptBudget(async (t) => {
        t.record("x", "hello");
        expect(getCurrentPromptBudgetTracker()).toBe(t);
        return t;
      });
      expect(tracker.getEntries()).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("logSummary emits one line with injector breakdown", () => {
    process.env[ARGENT_PROMPT_BUDGET_LOG_ENV] = "1";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const t = new PromptBudgetTracker();
      t.record("soul.md", "aaaa");
      t.record("memory", "bbbbbbbb");
      t.logSummary({ model: "qwen/qwen3", totalChars: 100 });
      const summaryCall = logSpy.mock.calls.find((c) =>
        String(c[0] ?? "").startsWith("[prompt-budget] total="),
      );
      expect(summaryCall?.[0]).toContain("total=25");
      expect(summaryCall?.[0]).toContain("ctx=qwen/qwen3");
      expect(summaryCall?.[0]).toContain("soul.md:1");
      expect(summaryCall?.[0]).toContain("memory:2");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("logSummary is a no-op when disabled", () => {
    delete process.env[ARGENT_PROMPT_BUDGET_LOG_ENV];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const t = new PromptBudgetTracker();
      t.record("x", "aaaa");
      t.logSummary();
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
