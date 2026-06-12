import { describe, expect, it } from "vitest";
import { decideTickSalience } from "./consciousness-kernel.js";

const T0 = Date.parse("2026-06-11T12:00:00.000Z");
const HOUR = 3_600_000;

function base(overrides: Partial<Parameters<typeof decideTickSalience>[0]> = {}) {
  return {
    nowMs: T0,
    lastSalientCognitionAt: new Date(T0 - HOUR).toISOString(),
    lastUserMessageAt: new Date(T0 - 2 * HOUR).toISOString(),
    lastBoardMaxUpdatedAt: T0 - 3 * HOUR,
    lastBoardTaskCount: 5,
    boardMaxUpdatedAt: T0 - 3 * HOUR,
    boardTaskCount: 5,
    salienceAnchorHours: 24,
    ...overrides,
  };
}

describe("decideTickSalience (LIMBIC law 3 — idle gateway burns zero inference)", () => {
  it("skips with a first-class reason when nothing happened", () => {
    const result = decideTickSalience(base());
    expect(result).toEqual({ salient: false, skipReason: "skip(no-salience)" });
  });

  it("admits the first-ever cognition to establish the baseline", () => {
    const result = decideTickSalience(base({ lastSalientCognitionAt: null }));
    expect(result).toEqual({ salient: true, reason: "first-cognition" });
  });

  it("fires on operator activity newer than the last cognition", () => {
    const result = decideTickSalience(
      base({ lastUserMessageAt: new Date(T0 - 60_000).toISOString() }),
    );
    expect(result).toEqual({ salient: true, reason: "operator-activity" });
  });

  it("does NOT fire on operator activity older than the last cognition (recency is not salience)", () => {
    const result = decideTickSalience(
      base({ lastUserMessageAt: new Date(T0 - 90 * 60_000).toISOString() }),
    );
    expect(result.salient).toBe(false);
  });

  it("fires when the task board advanced", () => {
    const result = decideTickSalience(base({ boardMaxUpdatedAt: T0 - 60_000 }));
    expect(result).toEqual({ salient: true, reason: "board-delta" });
  });

  it("fires when the task count changed (deletion-only deltas)", () => {
    const result = decideTickSalience(base({ boardTaskCount: 4 }));
    expect(result).toEqual({ salient: true, reason: "board-delta" });
  });

  it("treats an unobservable board (storage down) as no delta", () => {
    const result = decideTickSalience(base({ boardMaxUpdatedAt: null, boardTaskCount: null }));
    expect(result.salient).toBe(false);
  });

  it("fires the periodic anchor when due", () => {
    const result = decideTickSalience(
      base({
        lastSalientCognitionAt: new Date(T0 - 25 * HOUR).toISOString(),
        lastUserMessageAt: new Date(T0 - 30 * HOUR).toISOString(),
        boardMaxUpdatedAt: T0 - 30 * HOUR,
        lastBoardMaxUpdatedAt: T0 - 30 * HOUR,
      }),
    );
    expect(result).toEqual({ salient: true, reason: "anchor-due" });
  });

  it("never fires the anchor when disabled (0 = pure salience gating)", () => {
    const result = decideTickSalience(
      base({
        salienceAnchorHours: 0,
        lastSalientCognitionAt: new Date(T0 - 400 * HOUR).toISOString(),
        lastUserMessageAt: new Date(T0 - 500 * HOUR).toISOString(),
        boardMaxUpdatedAt: T0 - 500 * HOUR,
        lastBoardMaxUpdatedAt: T0 - 500 * HOUR,
      }),
    );
    expect(result.salient).toBe(false);
  });

  it("a quiet week is 100% skips after the daily anchors", () => {
    // Simulate 7 days of 2-minute ticks with zero activity: exactly the
    // anchor cognitions fire (1/day), everything else is arithmetic.
    let lastCognition = new Date(T0).toISOString();
    let cognitions = 0;
    let ticks = 0;
    for (let ms = T0 + 120_000; ms <= T0 + 7 * 24 * HOUR; ms += 120_000) {
      ticks += 1;
      const result = decideTickSalience(base({ nowMs: ms, lastSalientCognitionAt: lastCognition }));
      if (result.salient) {
        cognitions += 1;
        lastCognition = new Date(ms).toISOString();
      }
    }
    expect(cognitions).toBe(7);
    expect(ticks).toBeGreaterThan(5000);
  });
});
