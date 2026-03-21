import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronService } from "./service.js";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

async function makeStorePath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-cron-audio-"));
  return {
    storePath: path.join(dir, "cron", "jobs.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

describe("CronService audioAlert payload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-17T12:00:00.000Z"));
    noopLogger.debug.mockClear();
    noopLogger.info.mockClear();
    noopLogger.warn.mockClear();
    noopLogger.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs deterministic audioAlert handler", async () => {
    const store = await makeStorePath();
    const runAudioAlert = vi.fn(async () => ({
      status: "ok" as const,
      summary: "Morning huddle",
    }));

    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
      runAudioAlert,
    });

    await cron.start();
    const added = await cron.add({
      name: "morning-huddle",
      enabled: true,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "main",
      executionMode: "live",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "audioAlert",
        message: "Stop what you're doing. Your meeting starts in two minutes.",
        title: "Morning huddle",
        urgency: "warning",
      },
    });

    await cron.run(added.id, "force");

    expect(runAudioAlert).toHaveBeenCalledTimes(1);
    expect(runAudioAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Stop what you're doing. Your meeting starts in two minutes.",
        title: "Morning huddle",
        urgency: "warning",
      }),
    );

    const jobs = await cron.list({ includeDisabled: true });
    expect(jobs[0]?.state.lastStatus).toBe("ok");
    expect(jobs[0]?.enabled).toBe(true);

    cron.stop();
    await store.cleanup();
  });

  it("paper_trade mode simulates audioAlert and skips live delivery", async () => {
    const store = await makeStorePath();
    const runAudioAlert = vi.fn(async () => ({
      status: "ok" as const,
      summary: "Morning huddle",
    }));

    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
      runAudioAlert,
    });

    await cron.start();
    const added = await cron.add({
      name: "morning-huddle-paper",
      enabled: true,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "main",
      executionMode: "paper_trade",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "audioAlert",
        message: "Meeting starts in two minutes.",
        title: "Morning huddle",
      },
    });

    await cron.run(added.id, "force");

    expect(runAudioAlert).not.toHaveBeenCalled();
    const jobs = await cron.list({ includeDisabled: true });
    expect(jobs[0]?.state.lastStatus).toBe("skipped");
    expect(jobs[0]?.state.lastGateDecision).toBe("simulated_paper_trade");
    expect(jobs[0]?.state.lastSimulationEvidence?.action).toBe("audio_alert_dispatch");

    cron.stop();
    await store.cleanup();
  });
});
