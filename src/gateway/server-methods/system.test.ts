import { describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import { systemHandlers } from "./system.js";

const noop = () => false;

describe("systemHandlers contemplation.runOnce", () => {
  it("runs one contemplation cycle through the runner", async () => {
    const respond = vi.fn();
    const runNow = vi.fn().mockResolvedValue({
      agentId: "argent",
      status: "ran",
      isOk: true,
      lastRunMs: 123,
      nextDueMs: 456,
    });

    await systemHandlers["contemplation.runOnce"]({
      params: { agentId: "argent" },
      respond,
      context: {
        contemplationRunner: { runNow, stop: vi.fn(), updateConfig: vi.fn() },
      } as Parameters<(typeof systemHandlers)["contemplation.runOnce"]>[0]["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "contemplation.runOnce" },
      isWebchatConnect: noop,
    });

    expect(runNow).toHaveBeenCalledWith("argent");
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        agentId: "argent",
        status: "ran",
        isOk: true,
        lastRunMs: 123,
        nextDueMs: 456,
      },
      undefined,
    );
  });

  it("fails cleanly when the contemplation runner is unavailable", async () => {
    const respond = vi.fn();

    await systemHandlers["contemplation.runOnce"]({
      params: {},
      respond,
      context: {} as Parameters<(typeof systemHandlers)["contemplation.runOnce"]>[0]["context"],
      client: null,
      req: { id: "req-2", type: "req", method: "contemplation.runOnce" },
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.INTERNAL_ERROR }),
    );
  });
});
