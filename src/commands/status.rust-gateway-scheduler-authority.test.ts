import { describe, expect, it } from "vitest";
import { getRustGatewaySchedulerAuthoritySummary } from "./status.rust-gateway-scheduler-authority.js";

describe("getRustGatewaySchedulerAuthoritySummary", () => {
  it("reports Node as the live scheduler authority without mutating timers", async () => {
    const summary = await getRustGatewaySchedulerAuthoritySummary({
      cronStorePath: "/tmp/argent-cron/jobs.json",
      loadStore: async () => ({
        version: 1,
        jobs: [
          {
            id: "job-1",
            name: "Workflow schedule",
            enabled: true,
            createdAtMs: 1,
            updatedAtMs: 1,
            schedule: { kind: "cron", expr: "* * * * *" },
            sessionTarget: "isolated",
            wakeMode: "next-heartbeat",
            payload: { kind: "workflowRun", workflowId: "wf-1" },
            state: { nextRunAtMs: 2_000 },
          },
          {
            id: "job-2",
            name: "Disabled job",
            enabled: false,
            createdAtMs: 1,
            updatedAtMs: 1,
            schedule: { kind: "every", everyMs: 60_000 },
            sessionTarget: "main",
            wakeMode: "next-heartbeat",
            payload: { kind: "systemEvent", text: "hello" },
            state: { nextRunAtMs: 1_000 },
          },
        ],
      }),
    });

    expect(summary.schedulerAuthority).toBe("node");
    expect(summary.rustSchedulerAuthority).toBe("shadow-only");
    expect(summary.authorityRecord).toBe("missing");
    expect(summary.cronJobs).toBe(2);
    expect(summary.enabledCronJobs).toBe(1);
    expect(summary.workflowRunCronJobs).toBe(1);
    expect(summary.nextWakeAtMs).toBe(2_000);
    expect(summary.notes.join(" ")).toContain("Node remains live scheduler authority");
  });

  it("treats an empty or missing cron store as current read-only state", async () => {
    const summary = await getRustGatewaySchedulerAuthoritySummary({
      loadStore: async () => ({ version: 1, jobs: [] }),
      cronEnabled: false,
    });

    expect(summary.cronEnabled).toBe(false);
    expect(summary.cronJobs).toBe(0);
    expect(summary.nextWakeAtMs).toBeNull();
  });
});
