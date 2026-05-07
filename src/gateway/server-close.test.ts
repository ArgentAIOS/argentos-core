import { describe, expect, it, vi } from "vitest";

const { mockListChannelPlugins } = vi.hoisted(() => ({
  mockListChannelPlugins: vi.fn<() => Array<{ id: string }>>(() => []),
}));

vi.mock("../channels/plugins/index.js", () => ({
  listChannelPlugins: () => mockListChannelPlugins(),
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

  it("aborts channels BEFORE running bonjour/tailscale/canvas teardown", async () => {
    // The Telegram 409 cascade originates here: if channel abort runs
    // late in shutdown, the legacy gateway holds the bot lock past the
    // 5s graceful-shutdown deadline and the new gateway races against
    // it. Ordering matters; pin it with a test.
    mockListChannelPlugins.mockReturnValue([{ id: "telegram" }, { id: "discord" }]);
    const callOrder: string[] = [];
    const stopChannel = vi.fn(async (channel: string) => {
      callOrder.push(`channel:${channel}`);
    });
    const bonjourStop = vi.fn(async () => {
      callOrder.push("bonjour");
    });
    const tailscaleCleanup = vi.fn(async () => {
      callOrder.push("tailscale");
    });

    const close = createGatewayCloseHandler({
      bonjourStop,
      tailscaleCleanup,
      canvasHost: null,
      canvasHostServer: null,
      stopChannel,
      pluginServices: null,
      cron: undefined,
      heartbeatRunner: null,
      contemplationRunner: undefined,
      executionWorkerRunner: undefined,
      jobOrchestratorRunner: undefined,
      sisRunner: undefined,
      consciousnessKernelRunner: undefined,
      healthCheckInterval: undefined,
      nodePresenceTimers: new Map(),
      broadcast: vi.fn(),
      tickInterval: setInterval(() => {}, 60_000),
      healthInterval: setInterval(() => {}, 60_000),
      dedupeCleanup: setInterval(() => {}, 60_000),
      agentUnsub: null,
      heartbeatUnsub: null,
      chatRunState: { clear: vi.fn() },
      clients: new Set(),
      configReloader: { stop: vi.fn().mockResolvedValue(undefined) },
      browserControl: null,
      wss: { close: (cb: () => void) => cb() } as never,
      httpServer: { close: (cb: (err?: Error | null) => void) => cb(null) } as never,
    });

    await close({ reason: "restart" });

    const firstChannel = callOrder.indexOf("channel:telegram");
    const firstBonjour = callOrder.indexOf("bonjour");
    const firstTailscale = callOrder.indexOf("tailscale");
    expect(firstChannel).toBeGreaterThanOrEqual(0);
    expect(firstBonjour).toBeGreaterThan(firstChannel);
    expect(firstTailscale).toBeGreaterThan(firstChannel);
    expect(stopChannel).toHaveBeenCalledWith("telegram");
    expect(stopChannel).toHaveBeenCalledWith("discord");
  });

  it("does not let one channel's stopChannel rejection block the rest of shutdown", async () => {
    // Sibling channels and the rest of shutdown must drain even if
    // one channel's stop hook throws (e.g., a channel runtime that
    // wedged on a network call).
    mockListChannelPlugins.mockReturnValue([{ id: "telegram" }, { id: "discord" }]);
    const stopChannel = vi.fn(async (channel: string) => {
      if (channel === "telegram") {
        throw new Error("simulated telegram-stop failure");
      }
    });
    const heartbeatStop = vi.fn();
    const broadcast = vi.fn();

    const close = createGatewayCloseHandler({
      bonjourStop: null,
      tailscaleCleanup: null,
      canvasHost: null,
      canvasHostServer: null,
      stopChannel,
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
      clients: new Set(),
      configReloader: { stop: vi.fn().mockResolvedValue(undefined) },
      browserControl: null,
      wss: { close: (cb: () => void) => cb() } as never,
      httpServer: { close: (cb: (err?: Error | null) => void) => cb(null) } as never,
    });

    await expect(close({ reason: "restart" })).resolves.toBeUndefined();
    expect(stopChannel).toHaveBeenCalledWith("telegram");
    expect(stopChannel).toHaveBeenCalledWith("discord");
    expect(heartbeatStop).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith(
      "shutdown",
      expect.objectContaining({ reason: "restart" }),
    );
  });
});
