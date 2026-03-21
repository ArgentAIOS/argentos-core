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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-cron-vip-"));
  return {
    storePath: path.join(dir, "cron", "jobs.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

describe("CronService vipEmailScan payload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-03T12:00:00.000Z"));
    noopLogger.debug.mockClear();
    noopLogger.info.mockClear();
    noopLogger.warn.mockClear();
    noopLogger.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs deterministic vipEmailScan handler", async () => {
    const store = await makeStorePath();
    const runVipEmailScan = vi.fn(async () => ({
      status: "ok" as const,
      summary: "VIP email scan: 2 new VIP emails",
    }));

    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
      runVipEmailScan,
    });

    await cron.start();
    const added = await cron.add({
      name: "vip deterministic scan",
      enabled: true,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      executionMode: "live",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "vipEmailScan",
        emitAlerts: true,
        maxResults: 25,
        lookbackDays: 7,
        accounts: ["ops@example.com"],
      },
      delivery: { mode: "none" },
    });

    await cron.run(added.id, "force");

    expect(runVipEmailScan).toHaveBeenCalledTimes(1);
    expect(runVipEmailScan).toHaveBeenCalledWith(
      expect.objectContaining({
        emitAlerts: true,
        maxResults: 25,
        lookbackDays: 7,
        accounts: ["ops@example.com"],
      }),
    );

    const jobs = await cron.list({ includeDisabled: true });
    expect(jobs[0]?.state.lastStatus).toBe("ok");
    expect(jobs[0]?.enabled).toBe(true);

    cron.stop();
    await store.cleanup();
  });

  it("paper_trade mode simulates vipEmailScan and skips external execution", async () => {
    const store = await makeStorePath();
    const runVipEmailScan = vi.fn(async () => ({
      status: "ok" as const,
      summary: "VIP email scan: 2 new VIP emails",
    }));

    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
      runVipEmailScan,
    });

    await cron.start();
    const added = await cron.add({
      name: "vip paper trade scan",
      enabled: true,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      executionMode: "paper_trade",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "vipEmailScan",
        emitAlerts: true,
      },
      delivery: { mode: "none" },
    });

    await cron.run(added.id, "force");

    expect(runVipEmailScan).not.toHaveBeenCalled();
    const jobs = await cron.list({ includeDisabled: true });
    expect(jobs[0]?.state.lastStatus).toBe("skipped");
    expect(jobs[0]?.state.lastGateDecision).toBe("simulated_paper_trade");
    expect(jobs[0]?.state.lastSimulationEvidence?.action).toBe("vip_email_scan");

    cron.stop();
    await store.cleanup();
  });
});
