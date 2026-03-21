import { describe, expect, it } from "vitest";
import type { CronServiceState } from "./service/state.js";
import type { CronJob, CronJobPatch } from "./types.js";
import { applyJobPatch, createJob } from "./service/jobs.js";

describe("applyJobPatch", () => {
  it("clears delivery when switching to main session", () => {
    const now = Date.now();
    const job: CronJob = {
      id: "job-1",
      name: "job-1",
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "do it" },
      delivery: { mode: "announce", channel: "telegram", to: "123" },
      state: {},
    };

    const patch: CronJobPatch = {
      sessionTarget: "main",
      payload: { kind: "systemEvent", text: "ping" },
    };

    expect(() => applyJobPatch(job, patch)).not.toThrow();
    expect(job.sessionTarget).toBe("main");
    expect(job.payload.kind).toBe("systemEvent");
    expect(job.delivery).toBeUndefined();
  });

  it("maps legacy payload delivery updates onto delivery", () => {
    const now = Date.now();
    const job: CronJob = {
      id: "job-2",
      name: "job-2",
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "do it" },
      delivery: { mode: "announce", channel: "telegram", to: "123" },
      state: {},
    };

    const patch: CronJobPatch = {
      payload: {
        kind: "agentTurn",
        deliver: false,
        channel: "Signal",
        to: "555",
        bestEffortDeliver: true,
      },
    };

    expect(() => applyJobPatch(job, patch)).not.toThrow();
    expect(job.payload.kind).toBe("agentTurn");
    if (job.payload.kind === "agentTurn") {
      expect(job.payload.deliver).toBe(false);
      expect(job.payload.channel).toBe("Signal");
      expect(job.payload.to).toBe("555");
      expect(job.payload.bestEffortDeliver).toBe(true);
    }
    expect(job.delivery).toEqual({
      mode: "none",
      channel: "signal",
      to: "555",
      bestEffort: true,
    });
  });

  it("treats legacy payload targets as announce requests", () => {
    const now = Date.now();
    const job: CronJob = {
      id: "job-3",
      name: "job-3",
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "do it" },
      delivery: { mode: "none", channel: "telegram" },
      state: {},
    };

    const patch: CronJobPatch = {
      payload: { kind: "agentTurn", to: " 999 " },
    };

    expect(() => applyJobPatch(job, patch)).not.toThrow();
    expect(job.delivery).toEqual({
      mode: "announce",
      channel: "telegram",
      to: "999",
      bestEffort: undefined,
    });
  });

  it("accepts isolated vipEmailScan payload patches", () => {
    const now = Date.now();
    const job: CronJob = {
      id: "job-4",
      name: "job-4",
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: { kind: "agentTurn", message: "do it" },
      delivery: { mode: "none" },
      state: {},
    };

    const patch: CronJobPatch = {
      payload: {
        kind: "vipEmailScan",
        emitAlerts: true,
        maxResults: 30,
        lookbackDays: 5,
        accounts: ["ops@example.com"],
      },
    };

    expect(() => applyJobPatch(job, patch)).not.toThrow();
    expect(job.payload).toEqual({
      kind: "vipEmailScan",
      emitAlerts: true,
      maxResults: 30,
      lookbackDays: 5,
      accounts: ["ops@example.com"],
    });
    expect(job.delivery).toEqual({ mode: "none" });
  });

  it("accepts main audioAlert payload patches", () => {
    const now = Date.now();
    const job: CronJob = {
      id: "job-audio",
      name: "job-audio",
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "ping" },
      state: {},
    };

    const patch: CronJobPatch = {
      payload: {
        kind: "audioAlert",
        message: "Meeting starts in two minutes.",
        title: "Morning huddle",
        urgency: "warning",
        voice: "jessica",
        mood: "serious",
      },
    };

    expect(() => applyJobPatch(job, patch)).not.toThrow();
    expect(job.payload).toEqual({
      kind: "audioAlert",
      message: "Meeting starts in two minutes.",
      title: "Morning huddle",
      urgency: "warning",
      voice: "jessica",
      mood: "serious",
    });
    expect(job.delivery).toBeUndefined();
  });

  it("accepts isolated slackSignalScan payload patches", () => {
    const now = Date.now();
    const job: CronJob = {
      id: "job-5",
      name: "job-5",
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: { kind: "agentTurn", message: "do it" },
      delivery: { mode: "none" },
      state: {},
    };

    const patch: CronJobPatch = {
      payload: {
        kind: "slackSignalScan",
        emitAlerts: true,
        createTasks: true,
        accountId: "ops",
      },
    };

    expect(() => applyJobPatch(job, patch)).not.toThrow();
    expect(job.payload).toEqual({
      kind: "slackSignalScan",
      emitAlerts: true,
      createTasks: true,
      accountId: "ops",
    });
    expect(job.delivery).toEqual({ mode: "none" });
  });

  it("updates execution mode via patch", () => {
    const now = Date.now();
    const job: CronJob = {
      id: "job-6",
      name: "job-6",
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      executionMode: "paper_trade",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "do it" },
      delivery: { mode: "none" },
      state: {},
    };

    const patch: CronJobPatch = {
      executionMode: "live",
    };

    expect(() => applyJobPatch(job, patch)).not.toThrow();
    expect(job.executionMode).toBe("live");
  });
});

describe("createJob", () => {
  it("defaults execution mode to live", () => {
    const state = {
      deps: { nowMs: () => 1_700_000_000_000 },
    } as unknown as CronServiceState;

    const job = createJob(state, {
      name: "default-live",
      enabled: true,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "do it" },
      delivery: { mode: "announce" },
    });

    expect(job.executionMode).toBe("live");
  });
});
