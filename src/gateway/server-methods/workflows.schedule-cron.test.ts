import { describe, expect, it, vi } from "vitest";
import type { CronJob } from "../../cron/types.js";
import type { WorkflowRow } from "../../infra/workflow-execution-service.js";
import {
  activeWorkflowScheduleConflictIssues,
  duplicatedWorkflowShouldStartActive,
  syncWorkflowScheduleCronJob,
} from "./workflows.js";

function workflowRow(overrides: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: "wf-morning-brief",
    name: "AI Morning Brief Podcast Workflow",
    version: 3,
    is_active: true,
    description: "Daily AI brief",
    trigger_type: "schedule",
    trigger_config: { cronExpression: "30 6 * * *", timezone: "America/Chicago" },
    nodes: [],
    edges: [],
    canvas_layout: {},
    default_on_error: {},
    max_run_duration_ms: 3_600_000,
    max_run_cost_usd: null,
    deployment_stage: "live",
    ...overrides,
  } as unknown as WorkflowRow;
}

function cronJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "cron-existing",
    name: "Workflow: AI Morning Brief Podcast Workflow",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    schedule: { kind: "cron", expr: "0 7 * * *" },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "workflowRun", workflowId: "wf-morning-brief" },
    delivery: { mode: "none" },
    state: {},
    ...overrides,
  };
}

function fakeSql() {
  return vi.fn(async () => []) as unknown as ReturnType<typeof import("postgres").default>;
}

describe("syncWorkflowScheduleCronJob", () => {
  it("adds an isolated workflowRun cron job for active schedule triggers", async () => {
    const added = cronJob({
      id: "cron-added",
      state: { nextRunAtMs: Date.parse("2026-04-28T11:30:00.000Z") },
    });
    const cron = {
      list: vi.fn(async () => []),
      add: vi.fn(async () => added),
      update: vi.fn(),
      remove: vi.fn(),
    };

    const result = await syncWorkflowScheduleCronJob({
      sql: fakeSql(),
      cron: cron as never,
      workflow: workflowRow(),
    });

    expect(result).toMatchObject({ action: "added", jobId: "cron-added" });
    expect(cron.add).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        schedule: { kind: "cron", expr: "30 6 * * *", tz: "America/Chicago" },
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        payload: expect.objectContaining({
          kind: "workflowRun",
          workflowId: "wf-morning-brief",
        }),
        delivery: { mode: "none" },
      }),
    );
  });

  it("updates one existing workflowRun job and removes duplicates", async () => {
    const primary = cronJob({ id: "cron-primary" });
    const duplicate = cronJob({ id: "cron-duplicate" });
    const updated = cronJob({
      id: "cron-primary",
      schedule: { kind: "cron", expr: "30 6 * * *", tz: "America/Chicago" },
      state: { nextRunAtMs: Date.parse("2026-04-29T11:30:00.000Z") },
    });
    const cron = {
      list: vi.fn(async () => [primary, duplicate]),
      add: vi.fn(),
      update: vi.fn(async () => updated),
      remove: vi.fn(),
    };

    const result = await syncWorkflowScheduleCronJob({
      sql: fakeSql(),
      cron: cron as never,
      workflow: workflowRow(),
    });

    expect(result).toMatchObject({ action: "updated", jobId: "cron-primary" });
    expect(cron.update).toHaveBeenCalledWith(
      "cron-primary",
      expect.objectContaining({
        schedule: { kind: "cron", expr: "30 6 * * *", tz: "America/Chicago" },
        sessionTarget: "isolated",
      }),
    );
    expect(cron.remove).toHaveBeenCalledWith("cron-duplicate");
  });

  it("removes workflowRun cron jobs when a schedule workflow is paused", async () => {
    const existing = cronJob({ id: "cron-paused" });
    const cron = {
      list: vi.fn(async () => [existing]),
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };

    const result = await syncWorkflowScheduleCronJob({
      sql: fakeSql(),
      cron: cron as never,
      workflow: workflowRow({ is_active: false }),
    });

    expect(result).toMatchObject({ action: "removed", jobId: null });
    expect(cron.remove).toHaveBeenCalledWith("cron-paused");
  });
});

describe("duplicatedWorkflowShouldStartActive", () => {
  it("starts manual workflow duplicates active", () => {
    expect(
      duplicatedWorkflowShouldStartActive(
        workflowRow({ trigger_type: "manual", trigger_config: { timezone: "America/Chicago" } }),
      ),
    ).toBe(true);
  });

  it("starts scheduled workflow duplicates inactive", () => {
    expect(duplicatedWorkflowShouldStartActive(workflowRow())).toBe(false);
  });
});

describe("activeWorkflowScheduleConflictIssues", () => {
  it("warns when another active workflow shares the same cron schedule", async () => {
    const sql = vi.fn(async () => [
      {
        id: "wf-legacy",
        name: "Legacy Morning Brief",
        trigger_type: "schedule",
        trigger_config: { cronExpr: "30 6 * * *", timezone: "America/Chicago" },
      },
    ]) as unknown as ReturnType<typeof import("postgres").default>;

    const issues = await activeWorkflowScheduleConflictIssues({
      sql,
      workflow: workflowRow(),
    });

    expect(issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "schedule_conflict_active_workflow",
        message: expect.stringContaining("Legacy Morning Brief"),
      }),
    ]);
  });

  it("ignores workflows that do not share the same cron expression and timezone", async () => {
    const sql = vi.fn(async () => [
      {
        id: "wf-other",
        name: "Different Schedule",
        trigger_type: "schedule",
        trigger_config: { cronExpr: "0 9 * * *", timezone: "America/Chicago" },
      },
    ]) as unknown as ReturnType<typeof import("postgres").default>;

    const issues = await activeWorkflowScheduleConflictIssues({
      sql,
      workflow: workflowRow(),
    });

    expect(issues).toEqual([]);
  });
});
