import { describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import { executionWorkerHandlers } from "./execution-worker.js";

const noop = () => false;

describe("executionWorkerHandlers", () => {
  it("dispatches an execution worker run immediately", async () => {
    const respond = vi.fn();
    const dispatchNow = vi.fn(() => ({
      ok: true,
      scope: "agent",
      agentId: "relay",
      dispatched: 1,
      paused: false,
      running: false,
      reason: "operator-test",
    }));
    const getStatus = vi.fn(() => ({
      enabled: true,
      globalPaused: false,
      agentCount: 1,
      agents: [],
    }));

    await executionWorkerHandlers["execution.worker.runNow"]({
      params: { agentId: "relay", reason: "operator-test" },
      respond,
      context: {
        executionWorkerRunner: {
          dispatchNow,
          getStatus,
          pause: vi.fn(),
          resume: vi.fn(),
          resetMetrics: vi.fn(),
          stop: vi.fn(),
          updateConfig: vi.fn(),
        },
      } as Parameters<(typeof executionWorkerHandlers)["execution.worker.runNow"]>[0]["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "execution.worker.runNow" },
      isWebchatConnect: noop,
    });

    expect(dispatchNow).toHaveBeenCalledWith({ agentId: "relay", reason: "operator-test" });
    expect(getStatus).toHaveBeenCalledWith({ agentId: "relay" });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        dispatch: expect.objectContaining({ ok: true, agentId: "relay" }),
      }),
      undefined,
    );
  });

  it("fails cleanly when the worker runner is unavailable", async () => {
    const respond = vi.fn();

    await executionWorkerHandlers["execution.worker.runNow"]({
      params: {},
      respond,
      context: {} as Parameters<
        (typeof executionWorkerHandlers)["execution.worker.runNow"]
      >[0]["context"],
      client: null,
      req: { id: "req-2", type: "req", method: "execution.worker.runNow" },
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.UNAVAILABLE }),
    );
  });

  it("returns invalid request for unknown agent dispatch", async () => {
    const respond = vi.fn();

    await executionWorkerHandlers["execution.worker.runNow"]({
      params: { agentId: "missing" },
      respond,
      context: {
        executionWorkerRunner: {
          dispatchNow: vi.fn(() => ({
            ok: false,
            scope: "agent",
            agentId: "missing",
            dispatched: 0,
            paused: false,
            running: false,
          })),
          getStatus: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          resetMetrics: vi.fn(),
          stop: vi.fn(),
          updateConfig: vi.fn(),
        },
      } as Parameters<(typeof executionWorkerHandlers)["execution.worker.runNow"]>[0]["context"],
      client: null,
      req: { id: "req-3", type: "req", method: "execution.worker.runNow" },
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST }),
    );
  });
});
