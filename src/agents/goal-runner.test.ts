/**
 * Unit tests for goal-runner — covers the pure evaluator (no provider mocks),
 * plus the post-turn hook with a stub provider/judge.
 *
 * Acceptance criteria coverage:
 *  - AC6 (judge JSON contract): exercised via parseJudgeResponse tests.
 *  - AC7 (fail-open on judge error): "continue on provider throw" test.
 *  - AC3/AC8 (turn budget): "auto-pauses when turn budget exhausted".
 *  - AC2 (done verdict): "stops the loop on done verdict".
 *  - "Auto-pauses after 3 consecutive parse failures".
 *  - "Pure evaluator does not write the store" (state is computed, not saved).
 */

import { describe, expect, it, vi } from "vitest";
import { parseJudgeResponse } from "./goal-judge.js";
import {
  applyJudgeResultToGoalState,
  buildClearedGoalState,
  buildDoneGoalState,
  buildPausedGoalState,
  buildResumedGoalState,
  buildSetGoalState,
  hasLiveGoal,
  isGoalActive,
  maybeEnqueueGoalContinuation,
} from "./goal-runner.js";
import { DEFAULT_GOAL_MAX_TURNS, type GoalState } from "./goal-state.js";

// Mock the session-store write helper so the evaluator/hook tests don't touch disk.
vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions.js")>();
  return {
    ...actual,
    updateSessionStoreEntry: vi.fn(async () => null),
  };
});

// Mock the FollowupRun queue helpers so we can assert without touching state.
vi.mock("../auto-reply/reply/queue.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auto-reply/reply/queue.js")>();
  return {
    ...actual,
    enqueueFollowupRun: vi.fn(() => true),
  };
});

import { enqueueFollowupRun } from "../auto-reply/reply/queue.js";

const baseState = (overrides: Partial<GoalState> = {}): GoalState => ({
  goal: "Write four files to /tmp",
  status: "active",
  turnsUsed: 0,
  maxTurns: DEFAULT_GOAL_MAX_TURNS,
  createdAt: 1_000,
  lastTurnAt: 0,
  consecutiveParseFailures: 0,
  subgoals: [],
  ...overrides,
});

describe("buildSetGoalState", () => {
  it("rejects empty goal text", () => {
    expect(() => buildSetGoalState({ goal: "  " })).toThrow();
  });

  it("uses the default turn budget when not specified", () => {
    const s = buildSetGoalState({ goal: "do the thing" });
    expect(s.maxTurns).toBe(DEFAULT_GOAL_MAX_TURNS);
    expect(s.status).toBe("active");
    expect(s.turnsUsed).toBe(0);
    expect(s.subgoals).toEqual([]);
  });

  it("honors maxTurns override", () => {
    const s = buildSetGoalState({ goal: "do the thing", maxTurns: 5 });
    expect(s.maxTurns).toBe(5);
  });
});

describe("hasLiveGoal / isGoalActive", () => {
  it("treats undefined as neither", () => {
    expect(isGoalActive(undefined)).toBe(false);
    expect(hasLiveGoal(undefined)).toBe(false);
  });
  it("active is active and live", () => {
    const s = baseState();
    expect(isGoalActive(s)).toBe(true);
    expect(hasLiveGoal(s)).toBe(true);
  });
  it("paused is live but not active", () => {
    const s = baseState({ status: "paused" });
    expect(isGoalActive(s)).toBe(false);
    expect(hasLiveGoal(s)).toBe(true);
  });
  it("cleared is neither", () => {
    const s = baseState({ status: "cleared" });
    expect(isGoalActive(s)).toBe(false);
    expect(hasLiveGoal(s)).toBe(false);
  });
});

describe("buildPaused/Resumed/Cleared/Done helpers", () => {
  it("paused preserves goal text and turn count", () => {
    const s = baseState({ turnsUsed: 5 });
    const next = buildPausedGoalState(s, "user-paused");
    expect(next.status).toBe("paused");
    expect(next.pausedReason).toBe("user-paused");
    expect(next.turnsUsed).toBe(5);
  });
  it("resumed resets turn budget and parse failures", () => {
    const s = baseState({
      status: "paused",
      turnsUsed: 10,
      consecutiveParseFailures: 2,
      pausedReason: "x",
    });
    const next = buildResumedGoalState(s);
    expect(next.status).toBe("active");
    expect(next.turnsUsed).toBe(0);
    expect(next.consecutiveParseFailures).toBe(0);
    expect(next.pausedReason).toBeUndefined();
  });
  it("cleared changes status but preserves goal for audit", () => {
    const s = baseState({ turnsUsed: 7 });
    const next = buildClearedGoalState(s);
    expect(next.status).toBe("cleared");
    expect(next.goal).toBe(s.goal);
    expect(next.turnsUsed).toBe(7);
  });
  it("done marks status and verdict", () => {
    const s = baseState();
    const next = buildDoneGoalState(s, "produced 4 files");
    expect(next.status).toBe("done");
    expect(next.lastVerdict).toBe("done");
    expect(next.lastReason).toBe("produced 4 files");
  });
});

describe("applyJudgeResultToGoalState — done verdict", () => {
  it("stops the loop on done verdict (AC2)", () => {
    const s = baseState();
    const d = applyJudgeResultToGoalState({
      state: s,
      judge: { verdict: "done", reason: "ok", parseFailed: false },
    });
    expect(d.shouldContinue).toBe(false);
    expect(d.continuationPrompt).toBeUndefined();
    expect(d.nextState.status).toBe("done");
    expect(d.message).toContain("✓ Goal achieved");
  });
});

describe("applyJudgeResultToGoalState — continue verdict", () => {
  it("emits a continuation prompt and increments turn counter", () => {
    const s = baseState({ turnsUsed: 0 });
    const d = applyJudgeResultToGoalState({
      state: s,
      judge: { verdict: "continue", reason: "still working", parseFailed: false },
    });
    expect(d.shouldContinue).toBe(true);
    expect(d.continuationPrompt).toContain("Continuing toward your standing goal");
    expect(d.continuationPrompt).toContain(s.goal);
    expect(d.nextState.turnsUsed).toBe(1);
    expect(d.nextState.status).toBe("active");
  });

  it("auto-pauses when turn budget exhausted (AC3/AC8)", () => {
    const s = baseState({ turnsUsed: 19, maxTurns: 20 });
    const d = applyJudgeResultToGoalState({
      state: s,
      judge: { verdict: "continue", reason: "more to do", parseFailed: false },
    });
    expect(d.shouldContinue).toBe(false);
    expect(d.nextState.status).toBe("paused");
    expect(d.nextState.pausedReason).toContain("turn budget exhausted");
    expect(d.message).toContain("/goal resume");
  });

  it("resets parse-failure counter on a successful parse", () => {
    const s = baseState({ consecutiveParseFailures: 2 });
    const d = applyJudgeResultToGoalState({
      state: s,
      judge: { verdict: "continue", reason: "ok", parseFailed: false },
    });
    expect(d.nextState.consecutiveParseFailures).toBe(0);
  });

  it("auto-pauses after 3 consecutive parse failures", () => {
    const s = baseState({ consecutiveParseFailures: 2 });
    const d = applyJudgeResultToGoalState({
      state: s,
      judge: { verdict: "continue", reason: "judge returned empty response", parseFailed: true },
    });
    expect(d.nextState.consecutiveParseFailures).toBe(3);
    expect(d.shouldContinue).toBe(false);
    expect(d.nextState.status).toBe("paused");
    expect(d.nextState.pausedReason).toContain("unparseable output");
    expect(d.message).toContain("judge model");
  });
});

describe("parseJudgeResponse — strict JSON variants", () => {
  it("parses clean JSON (done=true)", () => {
    const r = parseJudgeResponse('{"done": true, "reason": "great"}');
    expect(r.done).toBe(true);
    expect(r.reason).toBe("great");
    expect(r.parseFailed).toBe(false);
  });

  it("parses fenced JSON", () => {
    const r = parseJudgeResponse('```json\n{"done": false, "reason": "more to do"}\n```');
    expect(r.done).toBe(false);
    expect(r.reason).toBe("more to do");
    expect(r.parseFailed).toBe(false);
  });

  it("parses prose-prefixed JSON via regex fallback", () => {
    const r = parseJudgeResponse(
      'Here is my verdict: {"done": false, "reason": "not yet"} thanks!',
    );
    expect(r.done).toBe(false);
    expect(r.reason).toBe("not yet");
    expect(r.parseFailed).toBe(false);
  });

  it("flags empty body as parse failure (AC fail-open)", () => {
    const r = parseJudgeResponse("");
    expect(r.parseFailed).toBe(true);
    expect(r.done).toBe(false);
  });

  it("flags pure prose as parse failure", () => {
    const r = parseJudgeResponse("I think the goal is done.");
    expect(r.parseFailed).toBe(true);
    expect(r.done).toBe(false);
  });

  it('coerces stringy "true" → done', () => {
    const r = parseJudgeResponse('{"done": "true", "reason": "ok"}');
    expect(r.done).toBe(true);
    expect(r.parseFailed).toBe(false);
  });
});

describe("maybeEnqueueGoalContinuation — fail-open integration", () => {
  it("returns enqueued=false when no goal is active", async () => {
    const result = await maybeEnqueueGoalContinuation({
      sessionKey: "k",
      storePath: "/tmp/store.json",
      sessionEntry: {
        sessionId: "s1",
        updatedAt: 0,
      },
      lastAssistantText: "hi",
      judgeProvider: makeStubProvider("should-not-be-called"),
      judgeModelId: "test",
      continuation: makeContinuationCtx(),
    });
    expect(result.enqueued).toBe(false);
    expect(result.decision).toBeUndefined();
  });

  it("returns enqueued=true and enqueues followup on continue verdict", async () => {
    vi.mocked(enqueueFollowupRun).mockClear();
    const result = await maybeEnqueueGoalContinuation({
      sessionKey: "k",
      storePath: "/tmp/store.json",
      sessionEntry: {
        sessionId: "s1",
        updatedAt: 0,
        goal: baseState(),
      },
      lastAssistantText: "made progress on file 1",
      judgeProvider: makeStubProvider('{"done": false, "reason": "1 of 4 done"}'),
      judgeModelId: "test",
      continuation: makeContinuationCtx(),
    });
    expect(result.enqueued).toBe(true);
    expect(result.decision?.shouldContinue).toBe(true);
    expect(enqueueFollowupRun).toHaveBeenCalledOnce();
  });

  it("does NOT enqueue on done verdict (AC2 — stops the loop)", async () => {
    vi.mocked(enqueueFollowupRun).mockClear();
    const result = await maybeEnqueueGoalContinuation({
      sessionKey: "k",
      storePath: "/tmp/store.json",
      sessionEntry: {
        sessionId: "s1",
        updatedAt: 0,
        goal: baseState(),
      },
      lastAssistantText: "all four files produced",
      judgeProvider: makeStubProvider('{"done": true, "reason": "4 files written"}'),
      judgeModelId: "test",
      continuation: makeContinuationCtx(),
    });
    expect(result.enqueued).toBe(false);
    expect(result.decision?.shouldContinue).toBe(false);
    expect(result.decision?.nextState.status).toBe("done");
    expect(enqueueFollowupRun).not.toHaveBeenCalled();
  });

  it("treats provider throws as continue (fail-open, AC7)", async () => {
    vi.mocked(enqueueFollowupRun).mockClear();
    const provider = {
      name: "stub",
      execute: vi.fn(() => Promise.reject(new Error("kaboom"))),
      stream: vi.fn(),
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any;
    const result = await maybeEnqueueGoalContinuation({
      sessionKey: "k",
      storePath: "/tmp/store.json",
      sessionEntry: {
        sessionId: "s1",
        updatedAt: 0,
        goal: baseState(),
      },
      lastAssistantText: "some text",
      judgeProvider: provider,
      judgeModelId: "test",
      continuation: makeContinuationCtx(),
    });
    expect(result.decision?.verdict).toBe("continue");
    expect(result.enqueued).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function makeStubProvider(returnText: string) {
  return {
    name: "stub",
    execute: vi.fn(async () => ({
      text: returnText,
      toolCalls: [],
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 2,
      },
      stopReason: "stop" as const,
      provider: "stub",
      model: "stub",
    })),
    stream: vi.fn(),
    // oxlint-disable-next-line typescript/no-explicit-any
  } as any;
}

function makeContinuationCtx() {
  return {
    queueKey: "k",
    resolvedQueue: { mode: "followup" as const },
    followupRunTemplate: {
      prompt: "",
      enqueuedAt: 0,
      run: {
        agentId: "a",
        agentDir: "/tmp",
        sessionId: "s1",
        sessionKey: "k",
        sessionFile: "/tmp/s.jsonl",
        workspaceDir: "/tmp",
        // oxlint-disable-next-line typescript/no-explicit-any
        config: {} as any,
        provider: "stub",
        model: "stub",
        timeoutMs: 60_000,
        blockReplyBreak: "text_end" as const,
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any,
  };
}
