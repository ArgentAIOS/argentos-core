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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-cron-slack-"));
  return {
    storePath: path.join(dir, "cron", "jobs.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

describe("CronService slackSignalScan payload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T12:00:00.000Z"));
    noopLogger.debug.mockClear();
    noopLogger.info.mockClear();
    noopLogger.warn.mockClear();
    noopLogger.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs deterministic slackSignalScan handler", async () => {
    const store = await makeStorePath();
    const runSlackSignalScan = vi.fn(async () => ({
      status: "ok" as const,
      summary: "Slack signal scan: 3 new events; alerts sent=2; tasks created=1",
    }));

    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
      runSlackSignalScan,
    });

    await cron.start();
    const added = await cron.add({
      name: "slack deterministic scan",
      enabled: true,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      executionMode: "live",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "slackSignalScan",
        emitAlerts: true,
        createTasks: true,
        accountId: "ops",
      },
      delivery: { mode: "none" },
    });

    await cron.run(added.id, "force");

    expect(runSlackSignalScan).toHaveBeenCalledTimes(1);
    expect(runSlackSignalScan).toHaveBeenCalledWith(
      expect.objectContaining({
        emitAlerts: true,
        createTasks: true,
        accountId: "ops",
      }),
    );

    const jobs = await cron.list({ includeDisabled: true });
    expect(jobs[0]?.state.lastStatus).toBe("ok");
    expect(jobs[0]?.enabled).toBe(true);

    cron.stop();
    await store.cleanup();
  });
});
