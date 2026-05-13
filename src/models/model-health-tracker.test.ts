import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ModelHealthTracker,
  __setModelHealthTrackerForTests,
  getModelHealthTracker,
} from "./model-health-tracker.js";

describe("ModelHealthTracker", () => {
  let tracker: ModelHealthTracker;

  beforeEach(() => {
    tracker = new ModelHealthTracker({ window: 10, threshold: 3 });
  });

  it("accumulates empty outcomes per (provider, model)", () => {
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    expect(tracker.getEmptyCount("zai", "glm-5-turbo")).toBe(2);
    expect(tracker.isFlaking("zai", "glm-5-turbo")).toBe(false);
  });

  it("treats provider/model keys as case-insensitive", () => {
    tracker.recordOutcome("ZAI", "GLM-5-Turbo", "empty");
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    expect(tracker.getEmptyCount("zai", "glm-5-turbo")).toBe(2);
    expect(tracker.getEmptyCount("ZAI", "Glm-5-Turbo")).toBe(2);
  });

  it("isolates outcomes between different models", () => {
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    expect(tracker.isFlaking("zai", "glm-5-turbo")).toBe(true);
    expect(tracker.isFlaking("zai", "glm-4.7")).toBe(false);
    expect(tracker.getEmptyCount("zai", "glm-4.7")).toBe(0);
  });

  it("flags the model as flaking once empties >= threshold", () => {
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    expect(tracker.isFlaking("zai", "glm-5-turbo")).toBe(false);
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    expect(tracker.isFlaking("zai", "glm-5-turbo")).toBe(true);
  });

  it("resets the counter on a successful non-empty call", () => {
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    tracker.recordOutcome("zai", "glm-5-turbo", "empty");
    expect(tracker.isFlaking("zai", "glm-5-turbo")).toBe(true);
    tracker.recordOutcome("zai", "glm-5-turbo", "ok");
    expect(tracker.getEmptyCount("zai", "glm-5-turbo")).toBe(0);
    expect(tracker.isFlaking("zai", "glm-5-turbo")).toBe(false);
  });

  it("keeps the sliding window bounded to the configured size", () => {
    const small = new ModelHealthTracker({ window: 3, threshold: 2 });
    // Push 5 entries — only the last 3 survive.
    small.recordOutcome("zai", "glm-5-turbo", "empty");
    small.recordOutcome("zai", "glm-5-turbo", "empty");
    small.recordOutcome("zai", "glm-5-turbo", "empty");
    small.recordOutcome("zai", "glm-5-turbo", "empty");
    small.recordOutcome("zai", "glm-5-turbo", "empty");
    expect(small.getEmptyCount("zai", "glm-5-turbo")).toBe(3);
    expect(small.isFlaking("zai", "glm-5-turbo")).toBe(true);
  });

  it("clamps threshold to window when configured higher", () => {
    const t = new ModelHealthTracker({ window: 5, threshold: 99 });
    expect(t.getConfig()).toEqual({ window: 5, threshold: 5 });
  });

  it("ignores blank provider/model", () => {
    tracker.recordOutcome("", "glm-5-turbo", "empty");
    tracker.recordOutcome("zai", "", "empty");
    expect(tracker.snapshotKeys()).toEqual([]);
    expect(tracker.getEmptyCount("", "glm-5-turbo")).toBe(0);
    expect(tracker.isFlaking("zai", "")).toBe(false);
  });

  it("singleton instance returns the same object", () => {
    __setModelHealthTrackerForTests(null);
    const a = getModelHealthTracker();
    const b = getModelHealthTracker();
    expect(a).toBe(b);
  });

  afterEach(() => {
    __setModelHealthTrackerForTests(null);
  });
});
