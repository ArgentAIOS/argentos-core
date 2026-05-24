import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeEngagementCountsInWindow,
  markUnresolvedSurfacesUnavailable,
  recordEngagement,
  recordSurfaceEmitted,
} from "./engagement-tracker.js";

describe("engagement-tracker", () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "engagement-tracker-test-"));
    ledgerPath = path.join(tmpDir, "engagement-ledger.jsonl");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("counts zero outcomes when the ledger doesn't exist", () => {
    const counts = computeEngagementCountsInWindow({
      ledgerPath: path.join(tmpDir, "nonexistent.jsonl"),
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });
    expect(counts).toEqual({ acted: 0, acked: 0, ignored: 0, systemUnavailable: 0 });
  });

  it("counts explicit outcomes resolved within the window", () => {
    recordSurfaceEmitted({ ledgerPath, surfaceId: "s1", agentId: "a", ts: "2026-05-24T12:05:00Z" });
    recordSurfaceEmitted({ ledgerPath, surfaceId: "s2", agentId: "a", ts: "2026-05-24T12:10:00Z" });
    recordSurfaceEmitted({ ledgerPath, surfaceId: "s3", agentId: "a", ts: "2026-05-24T12:15:00Z" });
    recordEngagement({
      ledgerPath,
      surfaceId: "s1",
      outcome: "acted",
      source: "dashboard_click",
      ts: "2026-05-24T12:20:00Z",
    });
    recordEngagement({
      ledgerPath,
      surfaceId: "s2",
      outcome: "acked",
      source: "dashboard_click",
      ts: "2026-05-24T12:25:00Z",
    });

    const counts = computeEngagementCountsInWindow({
      ledgerPath,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });

    expect(counts).toMatchObject({ acted: 1, acked: 1, systemUnavailable: 0 });
    // s3 has no explicit outcome and timeout hasn't passed yet → not implicitly ignored.
    expect(counts.ignored).toBe(0);
  });

  it("implicitly counts surfaces as ignored once the timeout deadline passes within the window", () => {
    // Emitted yesterday, no outcome, timeout 24h.
    recordSurfaceEmitted({
      ledgerPath,
      surfaceId: "stale",
      agentId: "a",
      ts: "2026-05-23T11:30:00Z",
    });

    // Window is today 12:00–13:00. Deadline = emission + 24h = today 11:30,
    // which is BEFORE the window starts → NOT counted as ignored in this window.
    const before = computeEngagementCountsInWindow({
      ledgerPath,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
      now: () => new Date("2026-05-24T13:00:00.000Z"),
    });
    expect(before.ignored).toBe(0);

    // Window of 11:00–12:00 contains the deadline → counted.
    const within = computeEngagementCountsInWindow({
      ledgerPath,
      windowStart: new Date("2026-05-24T11:00:00.000Z"),
      windowEnd: new Date("2026-05-24T12:00:00.000Z"),
      now: () => new Date("2026-05-24T13:00:00.000Z"),
    });
    expect(within.ignored).toBe(1);
  });

  it("does not implicitly mark surfaces ignored before the deadline elapses in wall-clock", () => {
    // Emitted 2h ago, timeout 24h, "now" is only 2h after emission.
    recordSurfaceEmitted({
      ledgerPath,
      surfaceId: "fresh",
      agentId: "a",
      ts: "2026-05-24T10:00:00Z",
    });

    const counts = computeEngagementCountsInWindow({
      ledgerPath,
      windowStart: new Date("2026-05-24T09:00:00.000Z"),
      windowEnd: new Date("2026-05-25T15:00:00.000Z"), // wide window
      now: () => new Date("2026-05-24T12:00:00.000Z"),
    });
    expect(counts.ignored).toBe(0);
  });

  it("tracks system_unavailable separately from the other outcomes", () => {
    recordSurfaceEmitted({ ledgerPath, surfaceId: "s1", agentId: "a", ts: "2026-05-24T12:05:00Z" });
    recordEngagement({
      ledgerPath,
      surfaceId: "s1",
      outcome: "system_unavailable",
      source: "gateway_shutdown",
      ts: "2026-05-24T12:10:00Z",
      aliveSeconds: 300,
    });

    const counts = computeEngagementCountsInWindow({
      ledgerPath,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });
    expect(counts).toEqual({ acted: 0, acked: 0, ignored: 0, systemUnavailable: 1 });
  });

  it("uses the earliest non-system_unavailable outcome when a surface has multiple", () => {
    recordSurfaceEmitted({ ledgerPath, surfaceId: "s1", agentId: "a", ts: "2026-05-24T12:00:00Z" });
    recordEngagement({
      ledgerPath,
      surfaceId: "s1",
      outcome: "acked",
      source: "dashboard_click",
      ts: "2026-05-24T12:10:00Z",
    });
    // Later same surface gets "acted" — should NOT downgrade the earlier acked.
    recordEngagement({
      ledgerPath,
      surfaceId: "s1",
      outcome: "acted",
      source: "dashboard_click",
      ts: "2026-05-24T12:20:00Z",
    });

    const counts = computeEngagementCountsInWindow({
      ledgerPath,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });
    expect(counts.acked).toBe(1);
    expect(counts.acted).toBe(0);
  });

  describe("markUnresolvedSurfacesUnavailable", () => {
    it("returns 0 when the ledger doesn't exist", () => {
      const marked = markUnresolvedSurfacesUnavailable({
        ledgerPath: path.join(tmpDir, "nonexistent.jsonl"),
        shutdownTime: new Date("2026-05-24T13:00:00Z"),
      });
      expect(marked).toBe(0);
    });

    it("writes system_unavailable for every emitted surface without an outcome", () => {
      recordSurfaceEmitted({
        ledgerPath,
        surfaceId: "s1",
        agentId: "a",
        ts: "2026-05-24T12:00:00Z",
      });
      recordSurfaceEmitted({
        ledgerPath,
        surfaceId: "s2",
        agentId: "a",
        ts: "2026-05-24T12:05:00Z",
      });
      recordSurfaceEmitted({
        ledgerPath,
        surfaceId: "s3",
        agentId: "a",
        ts: "2026-05-24T12:10:00Z",
      });
      // s2 already resolved — should NOT be re-marked.
      recordEngagement({
        ledgerPath,
        surfaceId: "s2",
        outcome: "acked",
        source: "dashboard_click",
        ts: "2026-05-24T12:06:00Z",
      });

      const marked = markUnresolvedSurfacesUnavailable({
        ledgerPath,
        shutdownTime: new Date("2026-05-24T13:00:00Z"),
      });

      // Only s1 and s3 are unresolved.
      expect(marked).toBe(2);

      // Verify the ledger now has two system_unavailable entries for s1 and s3.
      const counts = computeEngagementCountsInWindow({
        ledgerPath,
        windowStart: new Date("2026-05-24T12:00:00.000Z"),
        windowEnd: new Date("2026-05-24T14:00:00.000Z"),
      });
      expect(counts.systemUnavailable).toBe(2);
      expect(counts.acked).toBe(1);
    });

    it("records aliveSeconds reflecting how long each surface was visible before shutdown", () => {
      recordSurfaceEmitted({
        ledgerPath,
        surfaceId: "short-lived",
        agentId: "a",
        ts: "2026-05-24T12:59:00Z",
      });
      recordSurfaceEmitted({
        ledgerPath,
        surfaceId: "long-lived",
        agentId: "a",
        ts: "2026-05-24T12:00:00Z",
      });

      markUnresolvedSurfacesUnavailable({
        ledgerPath,
        shutdownTime: new Date("2026-05-24T13:00:00Z"),
      });

      const raw = fs.readFileSync(ledgerPath, "utf-8").trim().split("\n").filter(Boolean);
      const outcomes = raw
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((e) => e.type === "outcome");
      expect(outcomes).toHaveLength(2);
      const byId = new Map(outcomes.map((o) => [o.surfaceId, o.aliveSeconds]));
      expect(byId.get("short-lived")).toBe(60);
      expect(byId.get("long-lived")).toBe(3600);
    });

    it("is idempotent — running twice doesn't double-mark", () => {
      recordSurfaceEmitted({
        ledgerPath,
        surfaceId: "s1",
        agentId: "a",
        ts: "2026-05-24T12:00:00Z",
      });
      markUnresolvedSurfacesUnavailable({
        ledgerPath,
        shutdownTime: new Date("2026-05-24T13:00:00Z"),
      });
      const markedSecond = markUnresolvedSurfacesUnavailable({
        ledgerPath,
        shutdownTime: new Date("2026-05-24T13:01:00Z"),
      });
      expect(markedSecond).toBe(0);
    });
  });

  it("disables implicit-ignore when timeoutHours = 0", () => {
    recordSurfaceEmitted({
      ledgerPath,
      surfaceId: "stale",
      agentId: "a",
      ts: "2026-04-01T00:00:00Z",
    });

    const counts = computeEngagementCountsInWindow({
      ledgerPath,
      windowStart: new Date("2026-04-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-25T00:00:00.000Z"),
      timeoutHours: 0,
      now: () => new Date("2026-05-25T00:00:00.000Z"),
    });
    expect(counts.ignored).toBe(0);
  });
});
