import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DataAPIConfig } from "./types.js";
import { ConnectionManager } from "./connection.js";
import { JobsModule } from "./jobs.js";
import { TasksModule } from "./tasks.js";

const tempRoots: string[] = [];

function createTempPaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argent-jobs-"));
  tempRoots.push(root);
  return {
    dashboard: path.join(root, "dashboard.db"),
    memo: path.join(root, "memo.db"),
    sessions: path.join(root, "sessions.db"),
  };
}

async function createJobsHarness() {
  const paths = createTempPaths();
  const config: DataAPIConfig = {
    paths,
    enableFTS: true,
    readOnly: false,
  };
  const conn = new ConnectionManager(config);
  const tasks = new TasksModule(conn);
  const jobs = new JobsModule(conn);
  await conn.init();
  await tasks.init();
  await jobs.init();
  return {
    jobs,
    listTasks: (agentId: string) => tasks.list({ source: "job", agentId }),
    close: () => conn.close(),
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("JobsModule", () => {
  it("creates templates/assignments and materializes due tasks", async () => {
    const api = await createJobsHarness();
    try {
      const template = api.jobs.createTemplate({
        name: "Tier 1 Ticket Triage",
        departmentId: "support",
        rolePrompt: "Act as Tier 1 technician and produce queue updates.",
        sop: "Review new tickets, draft internal notes, summarize blockers.",
        defaultMode: "simulate",
      });
      const assignment = api.jobs.createAssignment({
        templateId: template.id,
        agentId: "main",
        cadenceMinutes: 60,
      });
      const created = api.jobs.ensureDueTasks({ agentId: "main", now: Date.now() });
      expect(created).toBe(1);

      const tasks = api.listTasks("main");
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.title).toBe("Tier 1 Ticket Triage");

      const runs = api.jobs.listRuns({ assignmentId: assignment.id, limit: 10 });
      expect(runs.length).toBe(1);
      expect(runs[0]?.status).toBe("running");

      const context = api.jobs.getContextForTask(tasks[0]!.id);
      expect(context?.assignment.id).toBe(assignment.id);
      expect(context?.template.id).toBe(template.id);
      expect(context?.template.departmentId).toBe("support");
    } finally {
      api.close();
    }
  });

  it("adds simulation deny defaults to assignment policy", async () => {
    const api = await createJobsHarness();
    try {
      const template = api.jobs.createTemplate({
        name: "Ticket Simulation",
        rolePrompt: "Run ticket workflow in paper-trade mode.",
        defaultMode: "simulate",
      });
      const assignment = api.jobs.createAssignment({
        templateId: template.id,
        agentId: "main",
        executionMode: "simulate",
      });
      const resolved = api.jobs.resolveSessionToolPolicyForAssignment({
        assignment,
        template,
      });
      expect(resolved.toolsDeny).toContain("atera_ticket");
      expect(resolved.toolsDeny).toContain("message");
      expect(resolved.toolsDeny).toContain("send_payload");
    } finally {
      api.close();
    }
  });

  it("adds limited-live outbound guardrails unless scope explicitly allows it", async () => {
    const api = await createJobsHarness();
    try {
      const template = api.jobs.createTemplate({
        name: "Limited Live Support",
        rolePrompt: "Handle only narrow support follow-ups.",
        defaultMode: "live",
        defaultStage: "limited-live",
      });
      const guarded = api.jobs.createAssignment({
        templateId: template.id,
        agentId: "main",
        deploymentStage: "limited-live",
        scopeLimit: "internal notes only",
      });
      const guardedPolicy = api.jobs.resolveSessionToolPolicyForAssignment({
        assignment: guarded,
        template,
      });
      expect(guardedPolicy.toolsDeny).toContain("message");
      expect(guardedPolicy.toolsDeny).toContain("send_payload");

      const permitted = api.jobs.createAssignment({
        templateId: template.id,
        agentId: "main",
        deploymentStage: "limited-live",
        scopeLimit: "customer-facing outbound messaging allowed",
      });
      const permittedPolicy = api.jobs.resolveSessionToolPolicyForAssignment({
        assignment: permitted,
        template,
      });
      expect(permittedPolicy.toolsDeny ?? []).not.toContain("message");
      expect(permittedPolicy.toolsDeny ?? []).not.toContain("send_payload");
    } finally {
      api.close();
    }
  });

  it("materializes event-triggered tasks and enforces idempotency key dedupe", async () => {
    const api = await createJobsHarness();
    try {
      const template = api.jobs.createTemplate({
        name: "Atera Ticket Event Worker",
        rolePrompt: "Handle ticket update events for triage.",
        defaultMode: "simulate",
      });
      const assignment = api.jobs.createAssignment({
        templateId: template.id,
        agentId: "main",
        metadata: {
          eventTriggers: ["ticket.updated"],
        },
      });
      // Prevent time-scheduled materialization from interfering with event assertions.
      api.jobs.updateAssignment(assignment.id, {
        nextRunAt: Date.now() + 86_400_000,
      });

      const first = api.jobs.enqueueEvent({
        eventType: "ticket.updated",
        source: "manual",
        idempotencyKey: "evt-1",
        payload: { ticketId: "55335" },
      });
      const second = api.jobs.enqueueEvent({
        eventType: "ticket.updated",
        source: "manual",
        idempotencyKey: "evt-1",
        payload: { ticketId: "55335" },
      });
      expect(first.accepted).toBe(true);
      expect(second.accepted).toBe(false);

      const result = api.jobs.ensureEventTasks({ now: Date.now(), limit: 20 });
      expect(result.processedEvents).toBe(1);
      expect(result.createdTasks).toBe(1);

      const tasks = api.listTasks("main");
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.title).toContain("ticket.updated");

      const events = api.jobs.listEvents({ processed: true, limit: 10 });
      expect(events.length).toBe(1);
      expect(events[0]?.eventType).toBe("ticket.updated");
      expect(events[0]?.processedAt).toBeTypeOf("number");
    } finally {
      api.close();
    }
  });

  it("reviews runs and applies promote/rollback governance to assignments", async () => {
    const api = await createJobsHarness();
    try {
      const template = api.jobs.createTemplate({
        name: "Tier 1 Support Role",
        rolePrompt: "Represent support carefully and escalate honestly.",
        defaultStage: "simulate",
        relationshipContract: {
          relationshipObjective: "Preserve trust while reducing customer anxiety.",
        },
      });
      const assignment = api.jobs.createAssignment({
        templateId: template.id,
        agentId: "main",
        cadenceMinutes: 60,
      });
      api.jobs.ensureDueTasks({ agentId: "main", now: Date.now() });
      const firstRun = api.jobs.listRuns({ assignmentId: assignment.id, limit: 1 })[0];
      expect(firstRun?.reviewStatus).toBe("pending");

      const promoted = api.jobs.reviewRun(firstRun!.id, {
        reviewStatus: "approved",
        reviewedBy: "operator",
        action: "promote",
      });
      expect(promoted?.reviewStatus).toBe("approved");
      const promotedAssignment = api.jobs.getAssignment(assignment.id);
      expect(promotedAssignment?.deploymentStage).toBe("shadow");
      expect(promotedAssignment?.promotionState).toBe("approved-next-stage");

      const rollbackRun = api.jobs.createRun({
        assignmentId: assignment.id,
        templateId: template.id,
        agentId: "main",
        taskId: "task-rollback",
        executionMode: "simulate",
        deploymentStage: promotedAssignment?.deploymentStage,
      });
      const rolledBack = api.jobs.reviewRun(rollbackRun.id, {
        reviewStatus: "rolled-back",
        reviewedBy: "operator",
        action: "rollback",
      });
      expect(rolledBack?.reviewStatus).toBe("rolled-back");
      const rolledBackAssignment = api.jobs.getAssignment(assignment.id);
      expect(rolledBackAssignment?.deploymentStage).toBe("simulate");
      expect(rolledBackAssignment?.promotionState).toBe("rolled-back");
      expect(rolledBackAssignment?.enabled).toBe(false);
    } finally {
      api.close();
    }
  });
});
