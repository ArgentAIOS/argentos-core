/**
 * Argent Agent — /goal command integration tests.
 *
 * Companion to `goal-runner.test.ts` (unit) and `commands-goal.test.ts` (unit).
 * Those exercise pure functions with mocked persistence; this file exercises
 * the full Ralph-loop end-to-end:
 *
 *  - Real session-store persistence on disk (atomic write + lock + reload).
 *  - Real `enqueueFollowupRun` writing into the in-process FollowupRun queue.
 *  - Real `goal-judge.ts` parse + fail-open paths (we stub the lowest-level
 *    Provider.execute(), not the judge function itself).
 *
 * Tests the implementation merged in PR #361. Each test simulates one or more
 * post-turn ticks of `maybeEnqueueGoalContinuation` — the single hook that
 * agent-runner.ts and followup-runner.ts both call after a finalized turn —
 * with a programmable canned-verdict provider, and asserts state transitions
 * on `SessionEntry.goal` AND on the FollowupRun queue depth.
 *
 * Mock pattern: a per-test programmable `Provider` whose `.execute()` returns
 * canned responses (raw judge JSON strings, malformed prose, or throws). The
 * real `judgeGoal()` parses these, so the parse + fail-open semantics are
 * exercised, not skipped.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelConfig, Provider, TurnRequest, TurnResponse } from "../argent-ai/types.js";
import type { FollowupRun, QueueSettings } from "../auto-reply/reply/queue/types.js";
import type { SessionEntry } from "../config/sessions/types.js";
import type { GoalState } from "./goal-state.js";
import { getFollowupQueueDepth } from "../auto-reply/reply/queue.js";
import { clearFollowupQueue } from "../auto-reply/reply/queue/state.js";
import {
  loadSessionStore,
  saveSessionStore,
  updateSessionStoreEntry,
} from "../config/sessions/store.js";
import {
  buildClearedGoalState,
  buildPausedGoalState,
  buildResumedGoalState,
  buildSetGoalState,
  isGoalActive,
  maybeEnqueueGoalContinuation,
  persistGoalState,
} from "./goal-runner.js";

// ============================================================================
// Test scaffolding
// ============================================================================

type CannedReply =
  | { kind: "json"; done: boolean; reason: string }
  | { kind: "raw"; raw: string }
  | { kind: "throw"; error: Error }
  | { kind: "providerError"; message: string };

/**
 * Programmable provider: returns canned `Provider.execute` results in sequence.
 * Stubs at the lowest level so the real `judgeGoal` exercises parse + fail-open.
 *
 * - `json`           → builds `{"done": ..., "reason": "..."}` and returns it as text.
 * - `raw`            → returns the raw string verbatim (use to test malformed input).
 * - `throw`          → causes `.execute()` to reject (transport error path).
 * - `providerError`  → returns stopReason="error" with errorMessage set.
 */
function makeProgrammableProvider(replies: CannedReply[]): Provider & { calls: number } {
  const provider = {
    name: "programmable-stub",
    calls: 0,
    async execute(_req: TurnRequest, _model: ModelConfig): Promise<TurnResponse> {
      const idx = provider.calls;
      provider.calls += 1;
      const reply = replies[idx];
      if (!reply) {
        throw new Error(
          `programmable provider out of canned replies at call ${idx} (configured ${replies.length})`,
        );
      }
      if (reply.kind === "throw") {
        throw reply.error;
      }
      const text =
        reply.kind === "json"
          ? JSON.stringify({ done: reply.done, reason: reply.reason })
          : reply.kind === "raw"
            ? reply.raw
            : "";
      return {
        text,
        toolCalls: [],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 2,
        },
        stopReason: reply.kind === "providerError" ? "error" : "stop",
        provider: "programmable-stub",
        model: "stub-model",
        errorMessage: reply.kind === "providerError" ? reply.message : undefined,
      };
    },
    // oxlint-disable-next-line typescript/no-explicit-any
    stream: (async function* () {})() as any,
    // oxlint-disable-next-line typescript/no-explicit-any
  } as any;
  return provider;
}

let tmpDir: string;
let storePath: string;
const SESSION_KEY_A = "integ-session-A";
const SESSION_KEY_B = "integ-session-B";

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-goal-integ-"));
  storePath = path.join(tmpDir, "sessions.json");
  // Disable session-store cache for deterministic re-reads across the test.
  process.env.ARGENT_SESSION_CACHE_TTL_MS = "0";
  // Seed an empty store so updateSessionStoreEntry has a file to update.
  await saveSessionStore(storePath, {});
  // Pristine FollowupRun queues.
  clearFollowupQueue(SESSION_KEY_A);
  clearFollowupQueue(SESSION_KEY_B);
});

afterEach(() => {
  clearFollowupQueue(SESSION_KEY_A);
  clearFollowupQueue(SESSION_KEY_B);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/**
 * Seed a SessionEntry on disk with the given goal state. Always upserts the
 * entry (creates if missing).
 */
async function seedSession(
  sessionKey: string,
  goal: GoalState | undefined,
  extra: Partial<SessionEntry> = {},
): Promise<SessionEntry> {
  const store = loadSessionStore(storePath, { skipCache: true });
  const next: SessionEntry = {
    sessionId: sessionKey,
    updatedAt: Date.now(),
    ...extra,
    goal,
  };
  store[sessionKey] = next;
  await saveSessionStore(storePath, store);
  return next;
}

/** Re-read the goal state for `sessionKey` from disk. */
function reloadGoal(sessionKey: string): GoalState | undefined {
  const store = loadSessionStore(storePath, { skipCache: true });
  return store[sessionKey]?.goal;
}

/** Re-read the SessionEntry for `sessionKey` from disk (followup-runner pattern). */
function reloadEntry(sessionKey: string): SessionEntry | undefined {
  const store = loadSessionStore(storePath, { skipCache: true });
  return store[sessionKey];
}

/** Minimal continuation context — the routing fields just need to round-trip. */
function makeContinuationCtx(sessionKey: string): {
  followupRunTemplate: FollowupRun;
  resolvedQueue: QueueSettings;
  queueKey: string;
  originatingChannel: undefined;
  originatingTo: undefined;
  originatingAccountId: undefined;
  originatingThreadId: undefined;
  originatingChatType: undefined;
} {
  return {
    queueKey: sessionKey,
    resolvedQueue: { mode: "followup", cap: 50, debounceMs: 0, dropPolicy: "summarize" },
    followupRunTemplate: {
      prompt: "",
      enqueuedAt: 0,
      run: {
        agentId: "integ-agent",
        agentDir: tmpDir,
        sessionId: sessionKey,
        sessionKey,
        sessionFile: path.join(tmpDir, `${sessionKey}.jsonl`),
        workspaceDir: tmpDir,
        // oxlint-disable-next-line typescript/no-explicit-any
        config: {} as any,
        provider: "programmable-stub",
        model: "stub-model",
        timeoutMs: 60_000,
        blockReplyBreak: "text_end",
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any,
    originatingChannel: undefined,
    originatingTo: undefined,
    originatingAccountId: undefined,
    originatingThreadId: undefined,
    originatingChatType: undefined,
  };
}

/**
 * Run one post-turn tick — reload the latest SessionEntry from disk (mirrors
 * the followup-runner code path), invoke the hook, return the result.
 */
async function tick(params: {
  sessionKey: string;
  provider: Provider;
  lastAssistantText: string;
}): ReturnType<typeof maybeEnqueueGoalContinuation> {
  const entry = reloadEntry(params.sessionKey);
  return await maybeEnqueueGoalContinuation({
    sessionKey: params.sessionKey,
    storePath,
    sessionEntry: entry,
    lastAssistantText: params.lastAssistantText,
    judgeProvider: params.provider,
    judgeModelId: "stub-model",
    continuation: makeContinuationCtx(params.sessionKey),
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("/goal Ralph-loop integration", () => {
  // --------------------------------------------------------------------------
  // 1. Happy path — goal achieved on turn 1
  // --------------------------------------------------------------------------
  it("happy path: goal achieved on turn 1 → status=done, no continuation queued", async () => {
    await seedSession(SESSION_KEY_A, buildSetGoalState({ goal: "write hello.txt" }));
    const provider = makeProgrammableProvider([
      { kind: "json", done: true, reason: "hello.txt written" },
    ]);

    const result = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "wrote hello.txt — done.",
    });

    expect(result.enqueued).toBe(false);
    expect(result.decision?.verdict).toBe("done");
    expect(result.decision?.nextState.status).toBe("done");
    expect(result.decision?.nextState.turnsUsed).toBe(1);
    expect(result.message).toContain("✓ Goal achieved");

    const persisted = reloadGoal(SESSION_KEY_A);
    expect(persisted?.status).toBe("done");
    expect(persisted?.turnsUsed).toBe(1);
    expect(persisted?.lastVerdict).toBe("done");

    expect(getFollowupQueueDepth(SESSION_KEY_A)).toBe(0);
    expect(provider.calls).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 2. Happy path — goal achieved on turn 5
  // --------------------------------------------------------------------------
  it("happy path: 4 continuations + done on turn 5 → 4 followup enqueues then stop", async () => {
    await seedSession(SESSION_KEY_A, buildSetGoalState({ goal: "write 4 files to /tmp" }));
    const provider = makeProgrammableProvider([
      { kind: "json", done: false, reason: "1 of 4 done" },
      { kind: "json", done: false, reason: "2 of 4 done" },
      { kind: "json", done: false, reason: "3 of 4 done" },
      { kind: "json", done: false, reason: "still on 4" },
      { kind: "json", done: true, reason: "all 4 files produced" },
    ]);

    const responses = [
      "wrote file 1",
      "wrote file 2",
      "wrote file 3",
      "wrote file 4 — pending verification",
      "all 4 files produced",
    ];

    for (let i = 0; i < 5; i++) {
      const result = await tick({
        sessionKey: SESSION_KEY_A,
        provider,
        lastAssistantText: responses[i],
      });
      if (i < 4) {
        expect(result.enqueued, `turn ${i + 1} should enqueue`).toBe(true);
        expect(result.decision?.nextState.status).toBe("active");
      } else {
        expect(result.enqueued, "turn 5 (done) should not enqueue").toBe(false);
        expect(result.decision?.nextState.status).toBe("done");
      }
      expect(result.decision?.nextState.turnsUsed).toBe(i + 1);
    }

    const persisted = reloadGoal(SESSION_KEY_A);
    expect(persisted?.status).toBe("done");
    expect(persisted?.turnsUsed).toBe(5);
    expect(provider.calls).toBe(5);

    // 4 continuations were enqueued during turns 1-4; nothing drained them in
    // this test, so they're still in the queue. Turn 5 (done) added none.
    expect(getFollowupQueueDepth(SESSION_KEY_A)).toBe(4);
  });

  // --------------------------------------------------------------------------
  // 3. Turn budget exhaustion
  // --------------------------------------------------------------------------
  it("turn budget exhaustion: max_turns=3, always continue → paused after turn 3", async () => {
    await seedSession(SESSION_KEY_A, buildSetGoalState({ goal: "infinite work", maxTurns: 3 }));
    const provider = makeProgrammableProvider([
      { kind: "json", done: false, reason: "still working 1" },
      { kind: "json", done: false, reason: "still working 2" },
      { kind: "json", done: false, reason: "still working 3" },
    ]);

    for (let i = 0; i < 3; i++) {
      const result = await tick({
        sessionKey: SESSION_KEY_A,
        provider,
        lastAssistantText: `assistant turn ${i + 1}`,
      });
      if (i < 2) {
        expect(result.enqueued).toBe(true);
        expect(result.decision?.nextState.status).toBe("active");
      } else {
        // Turn 3: turnsUsed becomes 3, which is >= maxTurns=3 → paused.
        expect(result.enqueued).toBe(false);
        expect(result.decision?.nextState.status).toBe("paused");
        expect(result.decision?.nextState.pausedReason).toContain("turn budget exhausted");
        expect(result.message).toContain("/goal resume");
      }
    }

    const persisted = reloadGoal(SESSION_KEY_A);
    expect(persisted?.status).toBe("paused");
    expect(persisted?.turnsUsed).toBe(3);
    expect(persisted?.maxTurns).toBe(3);
    expect(persisted?.pausedReason).toMatch(/3\/3/);
    // Note: existing enqueued continuations are not auto-cleared on pause.
    // The status flip is what stops *new* enqueues; in-flight items still
    // exist in the queue until drained or explicitly cleared by /goal clear.
    expect(getFollowupQueueDepth(SESSION_KEY_A)).toBe(2);
  });

  // --------------------------------------------------------------------------
  // 4. Fail-open on judge transport error
  // --------------------------------------------------------------------------
  it("fail-open: judge throws on turn 2 → loop continues, judge recovers on turn 3", async () => {
    await seedSession(SESSION_KEY_A, buildSetGoalState({ goal: "robust to transient errors" }));
    const provider = makeProgrammableProvider([
      { kind: "json", done: false, reason: "starting" },
      { kind: "throw", error: new Error("ECONNRESET: kaboom") },
      { kind: "json", done: true, reason: "recovered + finished" },
    ]);

    // Turn 1: normal continue.
    const r1 = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "starting work",
    });
    expect(r1.decision?.verdict).toBe("continue");
    expect(r1.enqueued).toBe(true);

    // Turn 2: judge throws → fail-open continue, still enqueues a continuation.
    // Parse-failure counter must NOT increment (transport errors are transient).
    const r2 = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "still working",
    });
    expect(r2.decision?.verdict).toBe("continue");
    expect(r2.enqueued).toBe(true);
    expect(r2.decision?.nextState.consecutiveParseFailures).toBe(0);

    // Turn 3: judge recovers and returns done.
    const r3 = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "finished",
    });
    expect(r3.decision?.verdict).toBe("done");
    expect(r3.enqueued).toBe(false);

    const persisted = reloadGoal(SESSION_KEY_A);
    expect(persisted?.status).toBe("done");
    expect(persisted?.turnsUsed).toBe(3);
  });

  // --------------------------------------------------------------------------
  // 5. Fail-open on malformed judge response (AC7 parse-fail counter)
  // --------------------------------------------------------------------------
  it("fail-open: malformed judge JSON → parseFailed counter increments per turn", async () => {
    await seedSession(SESSION_KEY_A, buildSetGoalState({ goal: "test parse-fail counter" }));
    const provider = makeProgrammableProvider([
      { kind: "raw", raw: "I think the goal is mostly done." },
      { kind: "raw", raw: "no JSON here either" },
      { kind: "raw", raw: "still no JSON, three in a row" },
    ]);

    const r1 = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "turn 1 response",
    });
    expect(r1.decision?.verdict).toBe("continue");
    expect(r1.decision?.nextState.consecutiveParseFailures).toBe(1);
    expect(r1.enqueued).toBe(true);

    const r2 = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "turn 2 response",
    });
    expect(r2.decision?.nextState.consecutiveParseFailures).toBe(2);
    expect(r2.enqueued).toBe(true);

    const r3 = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "turn 3 response",
    });
    // 3rd consecutive parse failure → auto-pause with judge-config hint.
    expect(r3.decision?.nextState.consecutiveParseFailures).toBe(3);
    expect(r3.decision?.nextState.status).toBe("paused");
    expect(r3.decision?.nextState.pausedReason).toContain("unparseable output");
    expect(r3.message).toContain("judge model");
    expect(r3.enqueued).toBe(false);

    const persisted = reloadGoal(SESSION_KEY_A);
    expect(persisted?.status).toBe("paused");
    expect(persisted?.consecutiveParseFailures).toBe(3);
  });

  // --------------------------------------------------------------------------
  // 6. User message preemption — user message satisfies goal mid-flight
  // --------------------------------------------------------------------------
  it("user preemption: user message satisfies goal → judge done, no new continuation", async () => {
    // Prime the goal at turn 2 with a continuation already in the queue.
    await seedSession(SESSION_KEY_A, buildSetGoalState({ goal: "deploy hello.txt" }));
    const provider = makeProgrammableProvider([
      { kind: "json", done: false, reason: "not yet" },
      { kind: "json", done: true, reason: "user said it was done" },
    ]);

    // Turn 1: normal continue — enqueues a continuation.
    const r1 = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "starting deploy",
    });
    expect(r1.enqueued).toBe(true);
    expect(getFollowupQueueDepth(SESSION_KEY_A)).toBe(1);

    // Turn 2: user-initiated turn (in real flow, agent-runner hook would fire
    // here because the user message preempted the queued continuation by
    // arriving in the same inbound FIFO). The assistant's response notes that
    // the user did the work themselves; judge marks done.
    const r2 = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "ack: you already deployed hello.txt — goal complete",
    });
    expect(r2.decision?.verdict).toBe("done");
    expect(r2.decision?.nextState.status).toBe("done");
    expect(r2.enqueued).toBe(false);

    // The previously queued continuation is still in the queue (we didn't
    // drain it), but the state is `done` — subsequent drains would observe
    // `isGoalActive=false` in their own post-turn hook and not re-enqueue.
    // The KEY assertion is that turn 2 did not append a new continuation.
    expect(getFollowupQueueDepth(SESSION_KEY_A)).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 7. Mid-run safety — second /goal documents observed overwrite behavior
  //    (spec said "reject the new goal"; current handler overwrites — see PR
  //    body finding "OBSERVED-1").
  // --------------------------------------------------------------------------
  it("mid-run: second /goal overwrites the active goal (observed; flagged as OBSERVED-1)", async () => {
    const goalX = buildSetGoalState({ goal: "goal X" });
    await seedSession(SESSION_KEY_A, goalX);
    const provider = makeProgrammableProvider([
      { kind: "json", done: false, reason: "X in progress" },
    ]);
    const r1 = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "working on X",
    });
    expect(r1.enqueued).toBe(true);
    expect(reloadGoal(SESSION_KEY_A)?.goal).toBe("goal X");

    // Simulate a second /goal Y call (the command-handler does this via
    // `buildSetGoalState` + `persistGoalState`).
    const goalY = buildSetGoalState({ goal: "goal Y" });
    await persistGoalState({
      storePath,
      sessionKey: SESSION_KEY_A,
      state: goalY,
    });

    // Observed: goal Y replaces goal X entirely (turnsUsed resets to 0).
    // If the spec intent is "reject", this should error instead — see
    // OBSERVED-1 in PR body.
    const persisted = reloadGoal(SESSION_KEY_A);
    expect(persisted?.goal).toBe("goal Y");
    expect(persisted?.turnsUsed).toBe(0);
    expect(persisted?.status).toBe("active");
  });

  // --------------------------------------------------------------------------
  // 8. /goal pause → /goal resume → continuation resumes with turn counter reset
  // --------------------------------------------------------------------------
  it("pause/resume: paused goal blocks enqueues; resume resets counter and re-engages", async () => {
    await seedSession(
      SESSION_KEY_A,
      buildSetGoalState({ goal: "pause/resume cycle", maxTurns: 5 }),
    );
    const provider = makeProgrammableProvider([
      { kind: "json", done: false, reason: "turn 1 incomplete" },
      { kind: "json", done: false, reason: "turn 2 incomplete" },
      { kind: "json", done: true, reason: "post-resume done" },
    ]);

    // 2 continuations advance the counter to 2.
    await tick({ sessionKey: SESSION_KEY_A, provider, lastAssistantText: "t1" });
    await tick({ sessionKey: SESSION_KEY_A, provider, lastAssistantText: "t2" });
    expect(reloadGoal(SESSION_KEY_A)?.turnsUsed).toBe(2);

    // User pauses — simulate /goal pause.
    const beforePause = reloadGoal(SESSION_KEY_A);
    expect(beforePause).toBeDefined();
    await persistGoalState({
      storePath,
      sessionKey: SESSION_KEY_A,
      state: buildPausedGoalState(beforePause!, "user-paused"),
    });
    expect(reloadGoal(SESSION_KEY_A)?.status).toBe("paused");

    // Hook is a no-op when goal is paused.
    const rPaused = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "tick while paused",
    });
    expect(rPaused.enqueued).toBe(false);
    expect(rPaused.decision).toBeUndefined();
    expect(provider.calls).toBe(2); // judge was NOT called

    // User resumes — simulate /goal resume (turnsUsed resets to 0).
    const beforeResume = reloadGoal(SESSION_KEY_A);
    expect(beforeResume).toBeDefined();
    await persistGoalState({
      storePath,
      sessionKey: SESSION_KEY_A,
      state: buildResumedGoalState(beforeResume!),
    });
    const resumed = reloadGoal(SESSION_KEY_A);
    expect(resumed?.status).toBe("active");
    expect(resumed?.turnsUsed).toBe(0);

    // Continuation resumes — judge finishes the goal.
    const rDone = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "post-resume work",
    });
    expect(rDone.decision?.verdict).toBe("done");
    expect(rDone.decision?.nextState.status).toBe("done");
    expect(rDone.decision?.nextState.turnsUsed).toBe(1); // resumed→1 (not 3)
  });

  // --------------------------------------------------------------------------
  // 9. /goal clear preserves audit trail
  // --------------------------------------------------------------------------
  it("clear: goal field flips to cleared (not deleted) — audit trail preserved", async () => {
    await seedSession(SESSION_KEY_A, buildSetGoalState({ goal: "audit-preserved goal" }));
    const provider = makeProgrammableProvider([
      { kind: "json", done: false, reason: "1 step done" },
    ]);

    // One continuation — turnsUsed=1, lastReason set.
    await tick({ sessionKey: SESSION_KEY_A, provider, lastAssistantText: "step 1" });
    const before = reloadGoal(SESSION_KEY_A);
    expect(before?.turnsUsed).toBe(1);
    expect(before?.lastReason).toBe("1 step done");

    // User clears — simulate /goal clear.
    await persistGoalState({
      storePath,
      sessionKey: SESSION_KEY_A,
      state: buildClearedGoalState(before!),
    });

    const after = reloadGoal(SESSION_KEY_A);
    expect(after?.status).toBe("cleared");
    // Audit fields survive — goal text, turn count, last verdict/reason intact.
    expect(after?.goal).toBe("audit-preserved goal");
    expect(after?.turnsUsed).toBe(1);
    expect(after?.lastReason).toBe("1 step done");

    // Hook is a no-op when cleared.
    const after2 = await tick({
      sessionKey: SESSION_KEY_A,
      provider,
      lastAssistantText: "post-clear tick",
    });
    expect(after2.enqueued).toBe(false);
    expect(after2.decision).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 10. Post-turn hook fires correctly from BOTH call sites
  //     (architectural critical — spec deviation #3)
  // --------------------------------------------------------------------------
  it("dual call-site: agent-runner pattern + followup-runner pattern produce identical state advance", async () => {
    await seedSession(SESSION_KEY_A, buildSetGoalState({ goal: "dual-callsite verify" }));
    const provider = makeProgrammableProvider([
      { kind: "json", done: false, reason: "post user-msg, halfway" },
      { kind: "json", done: true, reason: "post continuation, done" },
    ]);

    // ---- Agent-runner pattern: caller already has the SessionEntry in memory
    // from the inbound user-message path. It passes that object directly.
    const inMemoryEntry = reloadEntry(SESSION_KEY_A);
    expect(isGoalActive(inMemoryEntry?.goal)).toBe(true);
    const rAgent = await maybeEnqueueGoalContinuation({
      sessionKey: SESSION_KEY_A,
      storePath,
      sessionEntry: inMemoryEntry, // agent-runner: in-memory pass-through
      lastAssistantText: "responded to user message",
      judgeProvider: provider,
      judgeModelId: "stub-model",
      continuation: makeContinuationCtx(SESSION_KEY_A),
    });
    expect(rAgent.enqueued).toBe(true);
    expect(rAgent.decision?.verdict).toBe("continue");
    expect(rAgent.decision?.nextState.turnsUsed).toBe(1);

    // ---- Followup-runner pattern: caller re-reads the SessionEntry from disk
    // (because the followup-runner doesn't carry the entry between turns).
    // This must produce the same result given the same disk state.
    const reloadedEntry = reloadEntry(SESSION_KEY_A);
    expect(isGoalActive(reloadedEntry?.goal)).toBe(true);
    expect(reloadedEntry?.goal?.turnsUsed).toBe(1); // ← persisted by previous tick
    const rFollowup = await maybeEnqueueGoalContinuation({
      sessionKey: SESSION_KEY_A,
      storePath,
      sessionEntry: reloadedEntry, // followup-runner: freshly reloaded
      lastAssistantText: "responded to queued continuation",
      judgeProvider: provider,
      judgeModelId: "stub-model",
      continuation: makeContinuationCtx(SESSION_KEY_A),
    });
    expect(rFollowup.decision?.verdict).toBe("done");
    expect(rFollowup.decision?.nextState.status).toBe("done");
    expect(rFollowup.decision?.nextState.turnsUsed).toBe(2);

    // Final on-disk state must reflect both ticks (no lost write between
    // patterns).
    const final = reloadGoal(SESSION_KEY_A);
    expect(final?.status).toBe("done");
    expect(final?.turnsUsed).toBe(2);
    expect(provider.calls).toBe(2);
  });

  // --------------------------------------------------------------------------
  // 11. Goal state survives session-store round-trip
  // --------------------------------------------------------------------------
  it("disk round-trip: GoalState fields survive write → re-read", async () => {
    const originalGoal: GoalState = {
      goal: "round-trip me",
      status: "active",
      turnsUsed: 7,
      maxTurns: 25,
      createdAt: 1_700_000_000_000,
      lastTurnAt: 1_700_000_500_000,
      lastVerdict: "continue",
      lastReason: "still working",
      consecutiveParseFailures: 1,
      subgoals: ["alpha", "beta", "gamma"],
    };
    await seedSession(SESSION_KEY_A, originalGoal);
    // Force a second update via the lock+atomic path to mimic real usage.
    await updateSessionStoreEntry({
      storePath,
      sessionKey: SESSION_KEY_A,
      update: async () => ({ goal: originalGoal }),
    });

    const reread = reloadGoal(SESSION_KEY_A);
    expect(reread).toEqual(originalGoal);
  });

  // --------------------------------------------------------------------------
  // 12. Concurrent goals on different sessions don't interfere
  // --------------------------------------------------------------------------
  it("concurrent sessions: A and B advance independently — no cross-contamination", async () => {
    await seedSession(SESSION_KEY_A, buildSetGoalState({ goal: "goal A" }));
    await seedSession(SESSION_KEY_B, buildSetGoalState({ goal: "goal B" }));

    const providerA = makeProgrammableProvider([
      { kind: "json", done: false, reason: "A working" },
      { kind: "json", done: true, reason: "A done" },
    ]);
    const providerB = makeProgrammableProvider([
      { kind: "json", done: false, reason: "B working 1" },
      { kind: "json", done: false, reason: "B working 2" },
      { kind: "json", done: false, reason: "B working 3" },
    ]);

    // Interleave to exercise concurrent writes to the shared store file.
    await tick({ sessionKey: SESSION_KEY_A, provider: providerA, lastAssistantText: "A.t1" });
    await tick({ sessionKey: SESSION_KEY_B, provider: providerB, lastAssistantText: "B.t1" });
    await tick({ sessionKey: SESSION_KEY_B, provider: providerB, lastAssistantText: "B.t2" });
    await tick({ sessionKey: SESSION_KEY_A, provider: providerA, lastAssistantText: "A.t2" });
    await tick({ sessionKey: SESSION_KEY_B, provider: providerB, lastAssistantText: "B.t3" });

    const a = reloadGoal(SESSION_KEY_A);
    const b = reloadGoal(SESSION_KEY_B);
    expect(a?.goal).toBe("goal A");
    expect(a?.status).toBe("done");
    expect(a?.turnsUsed).toBe(2);
    expect(b?.goal).toBe("goal B");
    expect(b?.status).toBe("active");
    expect(b?.turnsUsed).toBe(3);

    // Queues are also keyed by sessionKey — A drained nothing extra, B has
    // one continuation per non-done turn.
    expect(getFollowupQueueDepth(SESSION_KEY_A)).toBe(1); // 1 continue (turn 1)
    expect(getFollowupQueueDepth(SESSION_KEY_B)).toBe(3); // 3 continues
  });
});
