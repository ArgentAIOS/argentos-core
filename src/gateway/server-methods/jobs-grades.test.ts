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

const OLD_NODE_ENV = process.env.NODE_ENV;

function request(method: string, params: Record<string, unknown>) {
  const respond = vi.fn();
  return {
    respond,
    call: async () =>
      jobsHandlers[method]({
        params,
        respond,
        req: { type: "req", id: "1", method },
        client: null,
        isWebchatConnect: () => false,
        context: {} as never,
      }),
  };
}

beforeEach(() => {
  mocks.getStorageAdapter.mockReset();
  mocks.resolveRuntimeStorageConfig.mockReset().mockReturnValue({
    backend: "postgres",
    readFrom: "postgres",
    writeTo: ["postgres"],
    postgres: { connectionString: "postgres://localhost:5433/argentos" },
    redis: null,
  });
  mocks.isStrictPostgresOnly.mockReset().mockReturnValue(true);
  process.env.NODE_ENV = "development";
});

afterEach(() => {
  if (OLD_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = OLD_NODE_ENV;
  }
});

describe("jobs.grades.record", () => {
  it("records a batch, defaulting the grader", async () => {
    const recordGrades = vi.fn(async (inputs: unknown[]) =>
      (inputs as Array<Record<string, unknown>>).map((g, i) => ({ ...g, id: `g-${i}` })),
    );
    mocks.getStorageAdapter.mockResolvedValue({
      jobs: { recordGrades, enqueueEvent: vi.fn(async () => ({ accepted: true })) },
    });

    const { respond, call } = request("jobs.grades.record", {
      grades: [
        { runId: "run-1", component: "classification", verdict: "correct" },
        { runId: "run-1", component: "draft", verdict: "needs_change", feedback: "too long" },
      ],
    });
    await call();

    expect(recordGrades).toHaveBeenCalledWith([
      expect.objectContaining({
        runId: "run-1",
        component: "classification",
        verdict: "correct",
        grader: "operator",
      }),
      expect.objectContaining({
        component: "draft",
        verdict: "needs_change",
        feedback: "too long",
      }),
    ]);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ grades: expect.any(Array) }),
      undefined,
    );
  });

  it("rejects an invalid verdict without touching storage writes", async () => {
    const recordGrades = vi.fn();
    mocks.getStorageAdapter.mockResolvedValue({ jobs: { recordGrades } });

    const { respond, call } = request("jobs.grades.record", {
      grades: [{ runId: "run-1", component: "draft", verdict: "meh" }],
    });
    await call();

    expect(recordGrades).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("verdict") }),
    );
  });
});

describe("jobs.grades.approveAll", () => {
  it("grades every gradable component correct — feedback only", async () => {
    const recordGrades = vi.fn(async (inputs: unknown[]) => inputs);
    mocks.getStorageAdapter.mockResolvedValue({
      jobs: {
        recordGrades,
        enqueueEvent: vi.fn(async () => ({ accepted: true })),
        listRuns: vi.fn(async () => [
          {
            id: "run-1",
            summary: "triaged",
            events: [{ ts: 1, type: "proposed_action", detail: { tool: "atera_write" } }],
          },
        ]),
      },
    });

    const { respond, call } = request("jobs.grades.approveAll", { runId: "run-1" });
    await call();

    expect(recordGrades).toHaveBeenCalledWith([
      expect.objectContaining({
        component: "proposed_action:atera_write",
        verdict: "correct",
        metadata: { approveAll: true },
      }),
      expect.objectContaining({ component: "report", verdict: "correct" }),
    ]);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ components: ["proposed_action:atera_write", "report"] }),
      undefined,
    );
  });

  it("unknown run → INVALID_REQUEST", async () => {
    mocks.getStorageAdapter.mockResolvedValue({
      jobs: { listRuns: vi.fn(async () => []), recordGrades: vi.fn() },
    });
    const { respond, call } = request("jobs.grades.approveAll", { runId: "nope" });
    await call();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "run not found" }),
    );
  });
});

describe("jobs.scorecard", () => {
  it("returns scorecard + promotion gate for a template", async () => {
    const now = Date.now();
    const grades = Array.from({ length: 60 }, (_, i) => ({
      id: `g-${i}`,
      runId: "run-1",
      assignmentId: "asg-1",
      templateId: "tpl-1",
      component: "classification",
      verdict: "correct" as const,
      grader: "operator",
      createdAt: now - 20 * 24 * 60 * 60 * 1000 + i * 1000,
    }));
    mocks.getStorageAdapter.mockResolvedValue({
      jobs: { listGrades: vi.fn(async () => grades) },
    });

    const { respond, call } = request("jobs.scorecard", { templateId: "tpl-1" });
    await call();

    const [ok, payload] = respond.mock.calls[0];
    expect(ok).toBe(true);
    expect(payload.scorecard.totals).toMatchObject({ total: 60, correct: 60, correctPct: 100 });
    // 60 corrects entered passing at grade 50, ~20 days ago → sustained past 14d.
    expect(payload.promotionGate.eligible).toBe(true);
    expect(payload.promotionGate.gate).toEqual({
      minGraded: 50,
      minCorrectPct: 95,
      sustainDays: 14,
    });
  });

  it("requires templateId or assignmentId", async () => {
    mocks.getStorageAdapter.mockResolvedValue({ jobs: { listGrades: vi.fn() } });
    const { respond, call } = request("jobs.scorecard", {});
    await call();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("requires templateId") }),
    );
  });
});
