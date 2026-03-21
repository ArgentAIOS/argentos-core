import { describe, expect, it, vi } from "vitest";
import type {
  JobAdapter,
  MemoryAdapter,
  StorageAdapter,
  TaskAdapter,
  TeamAdapter,
} from "./adapter.js";
import type { StorageConfig } from "./storage-config.js";
import { DualAdapter } from "./dual-adapter.js";

function createJobAdapterMock(prefix: string): JobAdapter {
  return {
    createTemplate: vi.fn(async () => ({ id: `${prefix}-tpl` }) as never),
    listTemplates: vi.fn(async () => [{ id: `${prefix}-tpl` }] as never),
    getTemplate: vi.fn(async () => ({ id: `${prefix}-tpl` }) as never),
    createAssignment: vi.fn(async () => ({ id: `${prefix}-asn` }) as never),
    listAssignments: vi.fn(async () => [{ id: `${prefix}-asn` }] as never),
    getAssignment: vi.fn(async () => ({ id: `${prefix}-asn` }) as never),
    updateAssignment: vi.fn(async () => ({ id: `${prefix}-asn` }) as never),
    getContextForTask: vi.fn(async () => null),
    ensureDueTasks: vi.fn(async () => 0),
    createRun: vi.fn(async () => ({ id: `${prefix}-run` }) as never),
    reviewRun: vi.fn(async () => ({ id: `${prefix}-run` }) as never),
    completeRunForTask: vi.fn(async () => ({ id: `${prefix}-run` }) as never),
    listRuns: vi.fn(async () => [{ id: `${prefix}-run` }] as never),
    resolveSessionToolPolicyForAssignment: vi.fn(async () => ({})),
    enqueueEvent: vi.fn(async () => ({ accepted: true }) as never),
    listEvents: vi.fn(async () => []),
    ensureEventTasks: vi.fn(async () => ({ processedEvents: 0, createdTasks: 0 })),
  };
}

function createStorageAdapterMock(jobAdapter: JobAdapter): StorageAdapter {
  return {
    init: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    isReady: vi.fn(() => true),
    memory: {} as MemoryAdapter,
    tasks: {} as TaskAdapter,
    teams: {} as TeamAdapter,
    jobs: jobAdapter,
  };
}

describe("DualAdapter workforce jobs policy", () => {
  it("routes workforce jobs to PG only even when dual config reads/writes include sqlite", async () => {
    const sqliteJobs = createJobAdapterMock("sqlite");
    const pgJobs = createJobAdapterMock("pg");
    const sqlite = createStorageAdapterMock(sqliteJobs);
    const pg = createStorageAdapterMock(pgJobs);

    const dualConfig: StorageConfig = {
      backend: "dual",
      readFrom: "sqlite",
      writeTo: ["sqlite", "postgres"],
      postgres: { connectionString: "postgres://localhost:5433/argentos" },
      redis: null,
    };

    const dual = new DualAdapter(dualConfig, sqlite, pg);

    await dual.jobs.listTemplates();
    await dual.jobs.createTemplate({ name: "Tier 1", rolePrompt: "Handle tier 1" } as never);
    await dual.jobs.ensureDueTasks({ now: Date.now() });

    expect(pgJobs.listTemplates).toHaveBeenCalledTimes(1);
    expect(pgJobs.createTemplate).toHaveBeenCalledTimes(1);
    expect(pgJobs.ensureDueTasks).toHaveBeenCalledTimes(1);

    expect(sqliteJobs.listTemplates).not.toHaveBeenCalled();
    expect(sqliteJobs.createTemplate).not.toHaveBeenCalled();
    expect(sqliteJobs.ensureDueTasks).not.toHaveBeenCalled();
  });
});
