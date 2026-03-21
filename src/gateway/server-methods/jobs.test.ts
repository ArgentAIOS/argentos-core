import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStorageAdapter: vi.fn(),
  resolveRuntimeStorageConfig: vi.fn(),
  isStrictPostgresOnly: vi.fn(),
}));

vi.mock("../../data/storage-factory.js", () => ({
  getStorageAdapter: mocks.getStorageAdapter,
}));

vi.mock("../../data/storage-resolver.js", () => ({
  resolveRuntimeStorageConfig: (...args: unknown[]) => mocks.resolveRuntimeStorageConfig(...args),
}));

vi.mock("../../data/storage-config.js", () => ({
  isStrictPostgresOnly: (...args: unknown[]) => mocks.isStrictPostgresOnly(...args),
}));

import { jobsHandlers } from "./jobs.js";

type StorageConfigShape = {
  backend: "sqlite" | "dual" | "postgres";
  readFrom: "sqlite" | "postgres";
  writeTo: Array<"sqlite" | "postgres">;
  postgres: { connectionString: string } | null;
  redis: { host: string; port: number } | null;
};

const NON_PG_CONFIG: StorageConfigShape = {
  backend: "sqlite",
  readFrom: "sqlite",
  writeTo: ["sqlite"],
  postgres: null,
  redis: null,
};
const STRICT_PG_CONFIG: StorageConfigShape = {
  backend: "postgres",
  readFrom: "postgres",
  writeTo: ["postgres"],
  postgres: { connectionString: "postgres://localhost:5433/argentos" },
  redis: { host: "127.0.0.1", port: 6380 },
};

const OLD_NODE_ENV = process.env.NODE_ENV;
const OLD_ALLOW_NON_PG = process.env.ARGENT_ALLOW_NON_PG_WORKFORCE;
const OLD_VITEST = process.env.VITEST;

beforeEach(() => {
  mocks.getStorageAdapter.mockReset();
  mocks.resolveRuntimeStorageConfig.mockReset().mockReturnValue(NON_PG_CONFIG);
  mocks.isStrictPostgresOnly.mockReset().mockReturnValue(false);
  delete process.env.ARGENT_ALLOW_NON_PG_WORKFORCE;
  process.env.NODE_ENV = "production";
});

afterEach(() => {
  if (OLD_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = OLD_NODE_ENV;
  }
  if (OLD_ALLOW_NON_PG === undefined) {
    delete process.env.ARGENT_ALLOW_NON_PG_WORKFORCE;
  } else {
    process.env.ARGENT_ALLOW_NON_PG_WORKFORCE = OLD_ALLOW_NON_PG;
  }
  if (OLD_VITEST === undefined) {
    delete process.env.VITEST;
  } else {
    process.env.VITEST = OLD_VITEST;
  }
});

describe("jobsHandlers workforce storage policy guard", () => {
  it("blocks jobs methods in production when storage is not strict PG", async () => {
    delete process.env.VITEST;
    const respond = vi.fn();
    await jobsHandlers["jobs.templates.list"]({
      params: {},
      respond,
      req: { type: "req", id: "1", method: "jobs.templates.list" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(mocks.getStorageAdapter).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        message: expect.stringContaining("workforce requires PostgreSQL-canonical storage"),
      }),
    );
  });

  it("allows development runtime to access jobs handlers even when non-PG", async () => {
    process.env.NODE_ENV = "development";
    mocks.getStorageAdapter.mockResolvedValue({
      jobs: {
        listTemplates: vi.fn(async () => [{ id: "t-1", name: "Template 1" }]),
      },
    });

    const respond = vi.fn();
    await jobsHandlers["jobs.templates.list"]({
      params: {},
      respond,
      req: { type: "req", id: "2", method: "jobs.templates.list" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(mocks.getStorageAdapter).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      { templates: [{ id: "t-1", name: "Template 1" }] },
      undefined,
    );
  });

  it("allows explicit override in production via ARGENT_ALLOW_NON_PG_WORKFORCE=1", async () => {
    process.env.NODE_ENV = "production";
    process.env.ARGENT_ALLOW_NON_PG_WORKFORCE = "1";
    mocks.getStorageAdapter.mockResolvedValue({
      jobs: {
        listTemplates: vi.fn(async () => [{ id: "t-2", name: "Template 2" }]),
      },
    });

    const respond = vi.fn();
    await jobsHandlers["jobs.templates.list"]({
      params: {},
      respond,
      req: { type: "req", id: "3", method: "jobs.templates.list" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(mocks.getStorageAdapter).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      { templates: [{ id: "t-2", name: "Template 2" }] },
      undefined,
    );
  });

  it("executes workforce handlers in strict PG production mode", async () => {
    delete process.env.VITEST;
    process.env.NODE_ENV = "production";
    mocks.resolveRuntimeStorageConfig.mockReturnValue(STRICT_PG_CONFIG);
    mocks.isStrictPostgresOnly.mockReturnValue(true);

    const createTemplate = vi.fn(async () => ({
      id: "tpl-pg-1",
      name: "Tier 1 Support",
      rolePrompt: "Handle tier 1 only",
    }));
    const updateTemplate = vi.fn(async () => ({
      id: "tpl-pg-1",
      name: "Tier 1 Support Updated",
      rolePrompt: "Handle tier 1 only",
      defaultMode: "simulate",
      metadata: {},
    }));
    const getTemplate = vi.fn(async () => ({
      id: "tpl-pg-1",
      name: "Tier 1 Support",
      rolePrompt: "Handle tier 1 only",
      defaultMode: "simulate",
      metadata: {},
    }));
    const createAssignment = vi.fn(async () => ({
      id: "asn-pg-1",
      templateId: "tpl-pg-1",
      agentId: "relay",
      title: "Tier 1 Support Simulation",
      cadenceMinutes: 1440,
      executionMode: "simulate",
      deploymentStage: "simulate",
      promotionState: "draft",
      enabled: true,
    }));
    const getAssignment = vi.fn(async () => ({
      id: "asn-pg-1",
      agentId: "relay",
    }));
    const updateAssignment = vi.fn(async () => ({
      id: "asn-pg-1",
      templateId: "tpl-pg-1",
      agentId: "relay",
      title: "Tier 1 Support Simulation",
      enabled: true,
      cadenceMinutes: 1440,
      executionMode: "simulate",
      deploymentStage: "simulate",
      promotionState: "draft",
      nextRunAt: Date.now(),
    }));
    const ensureDueTasks = vi.fn(async () => 1);
    const dispatchNow = vi.fn(() => ({
      ok: true,
      scope: "agent",
      agentId: "relay",
      dispatched: 1,
      paused: false,
      running: false,
    }));
    const reviewRun = vi.fn(async () => ({
      id: "run-pg-1",
      assignmentId: "asn-pg-1",
      templateId: "tpl-pg-1",
      reviewStatus: "approved",
      reviewedBy: "operator",
      status: "completed",
    }));
    const listRuns = vi.fn(async () => [
      {
        id: "run-pg-1",
        assignmentId: "asn-pg-1",
        templateId: "tpl-pg-1",
        taskId: "task-1",
        agentId: "relay",
        status: "failed",
        executionMode: "simulate",
      },
    ]);
    const enqueueEvent = vi.fn(async () => ({ accepted: true }));

    mocks.getStorageAdapter.mockResolvedValue({
      jobs: {
        createTemplate,
        getTemplate,
        updateTemplate,
        createAssignment,
        getAssignment,
        updateAssignment,
        ensureDueTasks,
        reviewRun,
        listRuns,
        enqueueEvent,
      },
    });

    const respondTemplate = vi.fn();
    await jobsHandlers["jobs.templates.create"]({
      params: {
        name: "Tier 1 Support",
        rolePrompt: "Handle tier 1 only",
        defaultMode: "simulate",
      },
      respond: respondTemplate,
      req: { type: "req", id: "4", method: "jobs.templates.create" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(createTemplate).toHaveBeenCalledTimes(1);
    expect(respondTemplate).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ template: expect.objectContaining({ id: "tpl-pg-1" }) }),
      undefined,
    );

    const respondTemplateUpdate = vi.fn();
    await jobsHandlers["jobs.templates.update"]({
      params: {
        templateId: "tpl-pg-1",
        name: "Tier 1 Support Updated",
      },
      respond: respondTemplateUpdate,
      req: { type: "req", id: "4b", method: "jobs.templates.update" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(updateTemplate).toHaveBeenCalledTimes(1);
    expect(getTemplate).toHaveBeenCalledWith("tpl-pg-1");
    expect(respondTemplateUpdate).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        template: expect.objectContaining({ id: "tpl-pg-1", name: "Tier 1 Support Updated" }),
      }),
      undefined,
    );
    expect(enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "template.updated",
        payload: expect.objectContaining({
          before: expect.objectContaining({ name: "Tier 1 Support" }),
          after: expect.objectContaining({ name: "Tier 1 Support Updated" }),
          diff: expect.objectContaining({
            name: expect.objectContaining({
              before: "Tier 1 Support",
              after: "Tier 1 Support Updated",
            }),
          }),
        }),
      }),
    );

    const respondAssignment = vi.fn();
    await jobsHandlers["jobs.assignments.create"]({
      params: {
        templateId: "tpl-pg-1",
        agentId: "relay",
        title: "Tier 1 Support Simulation",
        cadenceMinutes: 1440,
        executionMode: "simulate",
        deploymentStage: "simulate",
      },
      respond: respondAssignment,
      req: { type: "req", id: "5", method: "jobs.assignments.create" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(createAssignment).toHaveBeenCalledTimes(1);
    expect(respondAssignment).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ assignment: expect.objectContaining({ id: "asn-pg-1" }) }),
      undefined,
    );

    const respondReview = vi.fn();
    await jobsHandlers["jobs.runs.review"]({
      params: {
        runId: "run-pg-1",
        reviewStatus: "approved",
        reviewedBy: "operator",
        action: "promote",
      },
      respond: respondReview,
      req: { type: "req", id: "6", method: "jobs.runs.review" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(reviewRun).toHaveBeenCalledTimes(1);
    expect(respondReview).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ run: expect.objectContaining({ id: "run-pg-1" }) }),
      undefined,
    );
    expect(enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "run.reviewed",
        payload: expect.objectContaining({
          before: expect.objectContaining({ status: "failed", reviewStatus: "pending" }),
          after: expect.objectContaining({ status: "completed", reviewStatus: "approved" }),
          diff: expect.objectContaining({
            status: expect.objectContaining({ before: "failed", after: "completed" }),
            reviewStatus: expect.objectContaining({ before: "pending", after: "approved" }),
          }),
        }),
      }),
    );
    const respondRunNow = vi.fn();
    await jobsHandlers["jobs.assignments.runNow"]({
      params: {
        assignmentId: "asn-pg-1",
      },
      respond: respondRunNow,
      req: { type: "req", id: "7", method: "jobs.assignments.runNow" },
      client: null,
      isWebchatConnect: () => false,
      context: {
        executionWorkerRunner: {
          dispatchNow,
        },
      } as never,
    });
    expect(getAssignment).toHaveBeenCalledTimes(1);
    expect(updateAssignment).toHaveBeenCalledTimes(1);
    expect(ensureDueTasks).toHaveBeenCalledTimes(1);
    expect(dispatchNow).toHaveBeenCalledWith({
      agentId: "relay",
      reason: "assignment-run-now",
    });
    expect(respondRunNow).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        assignmentId: "asn-pg-1",
        queuedTasks: 1,
        dispatched: true,
      }),
      undefined,
    );
    const respondRetry = vi.fn();
    await jobsHandlers["jobs.runs.retry"]({
      params: {
        runId: "run-pg-1",
      },
      respond: respondRetry,
      req: { type: "req", id: "8", method: "jobs.runs.retry" },
      client: null,
      isWebchatConnect: () => false,
      context: {
        executionWorkerRunner: {
          dispatchNow,
        },
      } as never,
    });
    expect(listRuns).toHaveBeenCalledTimes(2);
    expect(dispatchNow).toHaveBeenCalledWith({
      agentId: "relay",
      reason: "run-retry",
    });
    expect(respondRetry).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        runId: "run-pg-1",
        assignmentId: "asn-pg-1",
        dispatched: true,
      }),
      undefined,
    );
    expect(mocks.getStorageAdapter).toHaveBeenCalledTimes(6);
  });

  it("returns filtered event timeline and run trace", async () => {
    process.env.NODE_ENV = "development";
    const run = {
      id: "run-1",
      assignmentId: "asn-1",
      templateId: "tpl-1",
      taskId: "task-1",
      agentId: "relay",
      status: "completed",
      executionMode: "simulate",
      startedAt: Date.now(),
    };
    const listEvents = vi.fn(async () => [
      {
        id: "evt-1",
        eventType: "run.completed",
        source: "system",
        targetAgentId: "relay",
        createdAt: Date.now(),
        metadata: { runId: "run-1", assignmentId: "asn-1", taskId: "task-1" },
      },
      {
        id: "evt-2",
        eventType: "assignment.triggered",
        source: "manual",
        targetAgentId: "relay",
        createdAt: Date.now() - 1000,
        metadata: { assignmentId: "asn-1" },
      },
      {
        id: "evt-3",
        eventType: "other",
        source: "system",
        targetAgentId: "main",
        createdAt: Date.now() - 2000,
      },
    ]);
    const listRuns = vi.fn(async () => [run]);
    mocks.getStorageAdapter.mockResolvedValue({
      jobs: {
        listEvents,
        listRuns,
        getAssignment: vi.fn(async () => ({ id: "asn-1", title: "Tier 1 Support" })),
        getTemplate: vi.fn(async () => ({ id: "tpl-1", name: "Tier 1 Template" })),
      },
      tasks: {
        get: vi.fn(async () => ({ id: "task-1", status: "completed" })),
      },
    });

    const respondEvents = vi.fn();
    await jobsHandlers["jobs.events.list"]({
      params: { source: "system", runId: "run-1" },
      respond: respondEvents,
      req: { type: "req", id: "9", method: "jobs.events.list" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(respondEvents).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        events: [expect.objectContaining({ id: "evt-1" })],
      }),
      undefined,
    );

    const respondTrace = vi.fn();
    await jobsHandlers["jobs.runs.trace"]({
      params: { runId: "run-1" },
      respond: respondTrace,
      req: { type: "req", id: "10", method: "jobs.runs.trace" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(respondTrace).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        run: expect.objectContaining({ id: "run-1" }),
        assignment: expect.objectContaining({ id: "asn-1" }),
        template: expect.objectContaining({ id: "tpl-1" }),
        task: expect.objectContaining({ id: "task-1" }),
      }),
      undefined,
    );
  });

  it("retires template with force and disables linked assignments", async () => {
    process.env.NODE_ENV = "development";
    const updateAssignment = vi.fn(async () => ({ id: "asn-1", enabled: false }));
    const updateTemplate = vi.fn(async () => ({
      id: "tpl-1",
      name: "Tier 1",
      metadata: { lifecycleStatus: "retired" },
    }));
    const enqueueEvent = vi.fn(async () => ({ accepted: true }));
    mocks.getStorageAdapter.mockResolvedValue({
      jobs: {
        getTemplate: vi.fn(async () => ({ id: "tpl-1", name: "Tier 1", metadata: {} })),
        listAssignments: vi.fn(async () => [
          { id: "asn-1", templateId: "tpl-1", enabled: true, metadata: {} },
          { id: "asn-2", templateId: "tpl-1", enabled: false, metadata: {} },
        ]),
        updateAssignment,
        updateTemplate,
        enqueueEvent,
      },
    });

    const respond = vi.fn();
    await jobsHandlers["jobs.templates.retire"]({
      params: { templateId: "tpl-1", force: true, disableLinkedAssignments: true },
      respond,
      req: { type: "req", id: "11", method: "jobs.templates.retire" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(updateAssignment).toHaveBeenCalledTimes(1);
    expect(updateTemplate).toHaveBeenCalledTimes(1);
    expect(enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "template.retired",
        payload: expect.objectContaining({
          before: expect.any(Object),
          after: expect.any(Object),
          diff: expect.any(Object),
        }),
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        disabledAssignments: 1,
        linkedAssignments: 2,
      }),
      undefined,
    );
  });

  it("retires assignment and blocks when running without force", async () => {
    process.env.NODE_ENV = "development";
    const updateAssignment = vi.fn(async () => ({ id: "asn-1", enabled: false, metadata: {} }));
    const enqueueEvent = vi.fn(async () => ({ accepted: true }));
    mocks.getStorageAdapter.mockResolvedValue({
      jobs: {
        getAssignment: vi.fn(async () => ({ id: "asn-1", title: "Tier 1 Support", metadata: {} })),
        listRuns: vi.fn(async () => [{ id: "run-1", assignmentId: "asn-1", status: "running" }]),
        updateAssignment,
        enqueueEvent,
      },
    });

    const respondBlocked = vi.fn();
    await jobsHandlers["jobs.assignments.retire"]({
      params: { assignmentId: "asn-1" },
      respond: respondBlocked,
      req: { type: "req", id: "12", method: "jobs.assignments.retire" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(updateAssignment).not.toHaveBeenCalled();
    expect(respondBlocked).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: expect.stringContaining("running run"),
      }),
    );

    const respondForced = vi.fn();
    await jobsHandlers["jobs.assignments.retire"]({
      params: { assignmentId: "asn-1", force: true },
      respond: respondForced,
      req: { type: "req", id: "13", method: "jobs.assignments.retire" },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(updateAssignment).toHaveBeenCalledTimes(1);
    expect(enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "assignment.retired",
        payload: expect.objectContaining({
          before: expect.any(Object),
          after: expect.any(Object),
          diff: expect.any(Object),
        }),
      }),
    );
    expect(respondForced).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        assignment: expect.objectContaining({ id: "asn-1" }),
        runningRuns: 1,
      }),
      undefined,
    );
  });
});
