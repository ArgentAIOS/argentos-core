import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArgentConfig } from "../config/types.js";

const mocks = vi.hoisted(() => ({
  getStorageAdapter: vi.fn(),
  registerInternalHook: vi.fn(),
  unregisterInternalHook: vi.fn(),
}));

vi.mock("../data/storage-factory.js", () => ({
  getStorageAdapter: mocks.getStorageAdapter,
}));

vi.mock("../hooks/internal-hooks.js", () => ({
  registerInternalHook: mocks.registerInternalHook,
  unregisterInternalHook: mocks.unregisterInternalHook,
}));

import { startJobOrchestratorRunner } from "./job-orchestrator-runner.js";

describe("job orchestrator runner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getStorageAdapter.mockReset();
    mocks.registerInternalHook.mockReset();
    mocks.unregisterInternalHook.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("processes accepted events immediately and dispatches the execution worker", async () => {
    const enqueueEvent = vi.fn(async () => ({ accepted: true, event: { id: "evt-1" } }));
    const ensureDueTasks = vi.fn(async () => 0);
    const ensureEventTasks = vi.fn(async () => ({ processedEvents: 1, createdTasks: 1 }));
    const dispatchNow = vi.fn();

    mocks.getStorageAdapter.mockResolvedValue({
      jobs: {
        enqueueEvent,
        ensureDueTasks,
        ensureEventTasks,
      },
    });

    const runner = startJobOrchestratorRunner({
      cfg: {
        jobs: { orchestrator: { pollMs: 5_000 } },
      } as ArgentConfig,
      executionWorkerRunner: {
        dispatchNow,
        getStatus: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        resetMetrics: vi.fn(),
        stop: vi.fn(),
        updateConfig: vi.fn(),
      },
    });

    await runner.enqueueEvent({
      eventType: "customer-service:new-email",
      source: "manual",
    });
    await vi.advanceTimersByTimeAsync(1);

    expect(enqueueEvent).toHaveBeenCalledTimes(1);
    expect(ensureDueTasks).toHaveBeenCalledTimes(1);
    expect(ensureEventTasks).toHaveBeenCalledTimes(1);
    expect(dispatchNow).toHaveBeenCalledWith({ reason: "job-orchestrator-event" });

    runner.stop();
  });
});
