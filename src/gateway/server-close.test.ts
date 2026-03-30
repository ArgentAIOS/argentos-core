import { describe, expect, it, vi } from "vitest";

vi.mock("../channels/plugins/index.js", () => ({
  listChannelPlugins: () => [],
}));

vi.mock("../data/storage-factory.js", () => ({
  closeStorageAdapter: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../hooks/gmail-watcher.js", () => ({
  stopGmailWatcher: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../memory/memu-store.js", () => ({
  closeMemuStore: vi.fn(),
}));

vi.mock("./server-dashboard-api.js", () => ({
  stopDashboardApiServer: vi.fn(),
}));

vi.mock("../data/redis-client.js", () => ({
  closeRedisClient: vi.fn().mockResolvedValue(undefined),
}));

import { createGatewayCloseHandler } from "./server-close.js";

describe("createGatewayCloseHandler", () => {
  it("tolerates missing runner handles during shutdown", async () => {
    const heartbeatStop = vi.fn();
    const clientClose = vi.fn();
    const broadcast = vi.fn();
    const configStop = vi.fn().mockResolvedValue(undefined);

    const close = createGatewayCloseHandler({
      bonjourStop: null,
      tailscaleCleanup: null,
      canvasHost: null,
      canvasHostServer: null,
      stopChannel: async () => {},
      pluginServices: null,
      cron: undefined,
      heartbeatRunner: { stop: heartbeatStop } as never,
      contemplationRunner: undefined,
      executionWorkerRunner: undefined,
      jobOrchestratorRunner: undefined,
      sisRunner: undefined,
      consciousnessKernelRunner: undefined,
      healthCheckInterval: undefined,
      nodePresenceTimers: new Map(),
      broadcast,
      tickInterval: setInterval(() => {}, 60_000),
      healthInterval: setInterval(() => {}, 60_000),
      dedupeCleanup: setInterval(() => {}, 60_000),
      agentUnsub: null,
      heartbeatUnsub: null,
      chatRunState: { clear: vi.fn() },
      clients: new Set([{ socket: { close: clientClose } }]),
      configReloader: { stop: configStop },
      browserControl: null,
      wss: { close: (cb: () => void) => cb() } as never,
      httpServer: { close: (cb: (err?: Error | null) => void) => cb(null) } as never,
    });

    await expect(close({ reason: "restart" })).resolves.toBeUndefined();
    expect(heartbeatStop).toHaveBeenCalledTimes(1);
    expect(clientClose).toHaveBeenCalledWith(1012, "service restart");
    expect(broadcast).toHaveBeenCalledWith(
      "shutdown",
      expect.objectContaining({ reason: "restart", restartExpectedMs: null }),
    );
    expect(configStop).toHaveBeenCalledTimes(1);
  });
});
