import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_KERNEL_FITNESS_CONFIG, type KernelFitnessConfig } from "./kernel-fitness-types.js";
import {
  computeFitnessEntry,
  type FitnessWriterPaths,
  startKernelFitnessWriter,
} from "./kernel-fitness-writer.js";

function makePaths(rootDir: string): FitnessWriterPaths {
  return {
    kernelRootDir: rootDir,
    decisionLogPath: path.join(rootDir, "decision-ledger.jsonl"),
    fitnessLedgerPath: path.join(rootDir, "fitness-ledger.jsonl"),
    innerLoopPromptPath: path.join(rootDir, "scaffold", "inner-loop-prompt.md"),
  };
}

function writeLedger(decisionLogPath: string, lines: Record<string, unknown>[]): void {
  fs.mkdirSync(path.dirname(decisionLogPath), { recursive: true });
  fs.writeFileSync(decisionLogPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");
}

describe("computeFitnessEntry", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-fitness-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("returns null composite with low_sample reason when the window has too few reflections", () => {
    const paths = makePaths(tmpRoot);
    writeLedger(paths.decisionLogPath, [
      { seq: 1, ts: "2026-05-24T12:00:00.000Z", kind: "tick", summary: "tick 1" },
      { seq: 2, ts: "2026-05-24T12:00:01.000Z", kind: "reflection", summary: "first" },
      // Only 1 reflection — below the default 5-reflection floor.
    ]);

    const entry = computeFitnessEntry({
      paths,
      config: DEFAULT_KERNEL_FITNESS_CONFIG,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });

    expect(entry.stallComposite).toBeNull();
    expect(entry.stallCompositeReason).toBe("low_sample");
    expect(entry.reflectionCount).toBe(1);
    expect(entry.tickCount).toBe(1);
  });

  it("computes a healthy stall composite when reflections are varied and executive acts regularly", () => {
    const paths = makePaths(tmpRoot);
    const lines: Record<string, unknown>[] = [];
    // 10 ticks, 10 unique reflections, 8 executive actions, 0 repeats.
    for (let i = 0; i < 10; i++) {
      const ts = new Date(Date.parse("2026-05-24T12:00:00.000Z") + i * 60_000).toISOString();
      lines.push({ seq: 3 * i, ts, kind: "tick", summary: `tick ${i}` });
      lines.push({
        seq: 3 * i + 1,
        ts,
        kind: "reflection",
        summary: `unique work ${i}`,
      });
      if (i < 8) {
        lines.push({ seq: 3 * i + 2, ts, kind: "executive-action", summary: `acted ${i}` });
      }
    }
    writeLedger(paths.decisionLogPath, lines);

    const entry = computeFitnessEntry({
      paths,
      config: DEFAULT_KERNEL_FITNESS_CONFIG,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });

    expect(entry.reflectionCount).toBe(10);
    expect(entry.reflectionRepeatCount).toBe(0);
    expect(entry.tickCount).toBe(10);
    expect(entry.executiveActionCount).toBe(8);
    expect(entry.components.reflectionRepeatRate).toBe(0);
    // 1 - 8/10 = 0.2
    expect(entry.components.executiveInactionRate).toBeCloseTo(0.2, 6);
    // 0.7 * 0 + 0.3 * 0.2 = 0.06
    expect(entry.stallComposite).toBeCloseTo(0.06, 6);
    expect(entry.stallCompositeReason).toBeUndefined();
  });

  it("computes a stalled composite when reflections keep returning unchanged", () => {
    const paths = makePaths(tmpRoot);
    const lines: Record<string, unknown>[] = [];
    // 10 ticks, 10 reflections, 8 of them "unchanged", 0 executive actions.
    for (let i = 0; i < 10; i++) {
      const ts = new Date(Date.parse("2026-05-24T12:00:00.000Z") + i * 60_000).toISOString();
      lines.push({ seq: 2 * i, ts, kind: "tick", summary: `tick ${i}` });
      lines.push({
        seq: 2 * i + 1,
        ts,
        kind: "reflection",
        summary: i < 8 ? "research: unchanged x2" : "research: unique focus",
      });
    }
    writeLedger(paths.decisionLogPath, lines);

    const entry = computeFitnessEntry({
      paths,
      config: DEFAULT_KERNEL_FITNESS_CONFIG,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });

    expect(entry.reflectionRepeatCount).toBe(8);
    expect(entry.components.reflectionRepeatRate).toBeCloseTo(0.8, 6);
    // 1 - 0/10 = 1.0 (no executive actions at all)
    expect(entry.components.executiveInactionRate).toBe(1);
    // 0.7 * 0.8 + 0.3 * 1.0 = 0.56 + 0.30 = 0.86
    expect(entry.stallComposite).toBeCloseTo(0.86, 6);
  });

  it("ignores ledger entries outside the requested window", () => {
    const paths = makePaths(tmpRoot);
    writeLedger(paths.decisionLogPath, [
      // Before window — ignored
      { seq: 1, ts: "2026-05-24T11:00:00.000Z", kind: "tick", summary: "early" },
      // Inside window
      { seq: 2, ts: "2026-05-24T12:30:00.000Z", kind: "tick", summary: "in1" },
      { seq: 3, ts: "2026-05-24T12:31:00.000Z", kind: "reflection", summary: "in1" },
      { seq: 4, ts: "2026-05-24T12:32:00.000Z", kind: "reflection", summary: "in2" },
      { seq: 5, ts: "2026-05-24T12:33:00.000Z", kind: "reflection", summary: "in3" },
      { seq: 6, ts: "2026-05-24T12:34:00.000Z", kind: "reflection", summary: "in4" },
      { seq: 7, ts: "2026-05-24T12:35:00.000Z", kind: "reflection", summary: "in5" },
      // After window — ignored (endTime is exclusive)
      { seq: 8, ts: "2026-05-24T13:00:00.000Z", kind: "tick", summary: "late" },
      { seq: 9, ts: "2026-05-24T14:00:00.000Z", kind: "tick", summary: "after" },
    ]);

    const entry = computeFitnessEntry({
      paths,
      config: DEFAULT_KERNEL_FITNESS_CONFIG,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });

    expect(entry.tickCount).toBe(1);
    expect(entry.reflectionCount).toBe(5);
  });

  it("emits engagement fields as null with not_yet_instrumented reason when engagementLedgerPath is absent", () => {
    const paths = makePaths(tmpRoot);
    // Intentionally omit engagementLedgerPath to simulate the pre-Phase-3a state.
    paths.engagementLedgerPath = undefined;
    writeLedger(paths.decisionLogPath, [
      { seq: 1, ts: "2026-05-24T12:00:00.000Z", kind: "tick", summary: "tick 1" },
    ]);

    const entry = computeFitnessEntry({
      paths,
      config: DEFAULT_KERNEL_FITNESS_CONFIG,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });

    expect(entry.engagementRate).toBeNull();
    expect(entry.engagementRateReason).toBe("not_yet_instrumented");
    expect(entry.engagementCounts).toEqual({
      acted: 0,
      acked: 0,
      ignored: 0,
      systemUnavailable: 0,
    });
  });

  it("emits engagement fields as null with missing_data reason when ledger path is set but file is missing", () => {
    const paths = makePaths(tmpRoot);
    paths.engagementLedgerPath = path.join(tmpRoot, "engagement-ledger.jsonl");
    writeLedger(paths.decisionLogPath, [
      { seq: 1, ts: "2026-05-24T12:00:00.000Z", kind: "tick", summary: "tick 1" },
    ]);

    const entry = computeFitnessEntry({
      paths,
      config: DEFAULT_KERNEL_FITNESS_CONFIG,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });

    expect(entry.engagementRate).toBeNull();
    expect(entry.engagementRateReason).toBe("missing_data");
  });

  it("emits engagementRate when enough outcomes are present and excludes system_unavailable from the denominator", () => {
    const paths = makePaths(tmpRoot);
    paths.engagementLedgerPath = path.join(tmpRoot, "engagement-ledger.jsonl");
    writeLedger(paths.decisionLogPath, [
      { seq: 1, ts: "2026-05-24T12:00:00.000Z", kind: "tick", summary: "tick 1" },
    ]);
    // Seed engagement ledger: 2 acted, 1 acked, 1 ignored, 5 system_unavailable.
    // engagementRate = 2 / (2+1+1) = 0.5; system_unavailable counted separately.
    const engagementPath = paths.engagementLedgerPath;
    const writeEntry = (entry: Record<string, unknown>) =>
      fs.appendFileSync(engagementPath, JSON.stringify(entry) + "\n", "utf-8");
    for (let i = 0; i < 9; i++) {
      const sid = `s${i}`;
      writeEntry({
        type: "surface_emitted",
        surfaceId: sid,
        agentId: "a",
        ts: `2026-05-24T12:0${i}:00.000Z`,
      });
    }
    writeEntry({
      type: "outcome",
      surfaceId: "s0",
      outcome: "acted",
      source: "dashboard_click",
      ts: "2026-05-24T12:30:00.000Z",
    });
    writeEntry({
      type: "outcome",
      surfaceId: "s1",
      outcome: "acted",
      source: "dashboard_click",
      ts: "2026-05-24T12:30:00.000Z",
    });
    writeEntry({
      type: "outcome",
      surfaceId: "s2",
      outcome: "acked",
      source: "dashboard_click",
      ts: "2026-05-24T12:30:00.000Z",
    });
    writeEntry({
      type: "outcome",
      surfaceId: "s3",
      outcome: "ignored",
      source: "timeout",
      ts: "2026-05-24T12:30:00.000Z",
    });
    for (let i = 4; i < 9; i++) {
      writeEntry({
        type: "outcome",
        surfaceId: `s${i}`,
        outcome: "system_unavailable",
        source: "gateway_shutdown",
        ts: "2026-05-24T12:30:00.000Z",
      });
    }

    const entry = computeFitnessEntry({
      paths,
      config: DEFAULT_KERNEL_FITNESS_CONFIG,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });

    expect(entry.engagementCounts).toEqual({
      acted: 2,
      acked: 1,
      ignored: 1,
      systemUnavailable: 5,
    });
    // 2 / (2+1+1) = 0.5
    expect(entry.engagementRate).toBeCloseTo(0.5, 6);
    expect(entry.engagementRateReason).toBeUndefined();
  });

  it("returns engagementRate null with low_sample when explicit outcomes are below mMin", () => {
    const paths = makePaths(tmpRoot);
    paths.engagementLedgerPath = path.join(tmpRoot, "engagement-ledger.jsonl");
    writeLedger(paths.decisionLogPath, [
      { seq: 1, ts: "2026-05-24T12:00:00.000Z", kind: "tick", summary: "tick 1" },
    ]);
    // Only 1 acted + 1 acked = 2 events, below mMin=3.
    fs.appendFileSync(
      paths.engagementLedgerPath,
      JSON.stringify({
        type: "surface_emitted",
        surfaceId: "s1",
        agentId: "a",
        ts: "2026-05-24T12:01:00.000Z",
      }) +
        "\n" +
        JSON.stringify({
          type: "outcome",
          surfaceId: "s1",
          outcome: "acted",
          source: "dashboard_click",
          ts: "2026-05-24T12:02:00.000Z",
        }) +
        "\n" +
        JSON.stringify({
          type: "surface_emitted",
          surfaceId: "s2",
          agentId: "a",
          ts: "2026-05-24T12:03:00.000Z",
        }) +
        "\n" +
        JSON.stringify({
          type: "outcome",
          surfaceId: "s2",
          outcome: "acked",
          source: "dashboard_click",
          ts: "2026-05-24T12:04:00.000Z",
        }) +
        "\n",
      "utf-8",
    );

    const entry = computeFitnessEntry({
      paths,
      config: DEFAULT_KERNEL_FITNESS_CONFIG,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });

    expect(entry.engagementRate).toBeNull();
    expect(entry.engagementRateReason).toBe("low_sample");
    expect(entry.engagementCounts.acted).toBe(1);
    expect(entry.engagementCounts.acked).toBe(1);
  });

  it("includes scaffold version from the inner-loop-prompt file mtime when present", () => {
    const paths = makePaths(tmpRoot);
    fs.mkdirSync(path.dirname(paths.innerLoopPromptPath), { recursive: true });
    fs.writeFileSync(paths.innerLoopPromptPath, "current scaffold", "utf-8");
    writeLedger(paths.decisionLogPath, []);

    const entry = computeFitnessEntry({
      paths,
      config: DEFAULT_KERNEL_FITNESS_CONFIG,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });

    expect(entry.scaffoldVersion).not.toBeNull();
    // Should look like an ISO timestamp.
    expect(entry.scaffoldVersion).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns scaffold version = null when the prompt file doesn't exist", () => {
    const paths = makePaths(tmpRoot);
    writeLedger(paths.decisionLogPath, []);
    const entry = computeFitnessEntry({
      paths,
      config: DEFAULT_KERNEL_FITNESS_CONFIG,
      windowStart: new Date("2026-05-24T12:00:00.000Z"),
      windowEnd: new Date("2026-05-24T13:00:00.000Z"),
    });
    expect(entry.scaffoldVersion).toBeNull();
  });
});

describe("startKernelFitnessWriter", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-fitness-writer-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("appends one entry per forceTick to the fitness ledger", () => {
    const paths = makePaths(tmpRoot);
    writeLedger(paths.decisionLogPath, [
      { seq: 1, ts: "2026-05-24T12:00:00.000Z", kind: "tick", summary: "t1" },
      { seq: 2, ts: "2026-05-24T12:00:00.000Z", kind: "reflection", summary: "r1" },
      { seq: 3, ts: "2026-05-24T12:00:00.000Z", kind: "reflection", summary: "r2" },
      { seq: 4, ts: "2026-05-24T12:00:00.000Z", kind: "reflection", summary: "r3" },
      { seq: 5, ts: "2026-05-24T12:00:00.000Z", kind: "reflection", summary: "r4" },
      { seq: 6, ts: "2026-05-24T12:00:00.000Z", kind: "reflection", summary: "r5" },
    ]);

    const fakeNow = new Date("2026-05-24T13:00:00.000Z");
    const config: KernelFitnessConfig = {
      ...DEFAULT_KERNEL_FITNESS_CONFIG,
      windowSeconds: 3600,
    };
    const handle = startKernelFitnessWriter({
      paths,
      configOverride: config,
      now: () => fakeNow,
    });

    try {
      handle.forceTick();
      handle.forceTick();
      handle.forceTick();
    } finally {
      handle.stop();
    }

    const ledgerLines = fs
      .readFileSync(paths.fitnessLedgerPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(ledgerLines).toHaveLength(3);
    for (const line of ledgerLines) {
      const entry = JSON.parse(line) as { windowStart: string; windowEnd: string };
      expect(entry.windowStart).toBe("2026-05-24T12:00:00.000Z");
      expect(entry.windowEnd).toBe("2026-05-24T13:00:00.000Z");
    }
  });
});
