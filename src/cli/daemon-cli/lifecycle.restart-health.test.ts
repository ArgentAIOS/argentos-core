import { beforeEach, describe, expect, it, vi } from "vitest";

const service = {
  isLoaded: vi.fn(),
  restart: vi.fn(),
  readCommand: vi.fn(),
};

const waitForGatewayHealthyRestart = vi.fn();
const terminateStaleGatewayPids = vi.fn();
const renderRestartDiagnostics = vi.fn(() => ["diag: unhealthy runtime"]);
const resolveGatewayPort = vi.fn(() => 18789);
const loadConfig = vi.fn(() => ({}));

const runtimeErrors: string[] = [];
const runtimeLogs: string[] = [];

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfig(),
  resolveGatewayPort: (cfg: unknown, env?: unknown) => resolveGatewayPort(cfg, env),
}));

vi.mock("../../daemon/service.js", () => ({
  resolveGatewayService: () => ({
    label: "systemd",
    loadedText: "enabled",
    notLoadedText: "disabled",
    isLoaded: service.isLoaded,
    restart: service.restart,
    readCommand: service.readCommand,
  }),
}));

vi.mock("../../runtime.js", () => ({
  defaultRuntime: {
    log: (msg: string) => runtimeLogs.push(msg),
    error: (msg: string) => runtimeErrors.push(msg),
    exit: (code: number) => {
      throw new Error(`__exit__:${code}`);
    },
  },
}));

vi.mock("./restart-health.js", () => ({
  DEFAULT_RESTART_HEALTH_ATTEMPTS: 2,
  DEFAULT_RESTART_HEALTH_DELAY_MS: 5,
  waitForGatewayHealthyRestart: (params: unknown) => waitForGatewayHealthyRestart(params),
  terminateStaleGatewayPids: (pids: number[]) => terminateStaleGatewayPids(pids),
  renderRestartDiagnostics: (snapshot: unknown) => renderRestartDiagnostics(snapshot),
}));

describe("runDaemonRestart restart-health integration", () => {
  beforeEach(() => {
    runtimeErrors.length = 0;
    runtimeLogs.length = 0;
    service.isLoaded.mockReset();
    service.restart.mockReset();
    service.readCommand.mockReset();
    waitForGatewayHealthyRestart.mockReset();
    terminateStaleGatewayPids.mockReset();
    renderRestartDiagnostics.mockReset();
    resolveGatewayPort.mockReset();
    loadConfig.mockReset();

    loadConfig.mockReturnValue({});
    resolveGatewayPort.mockReturnValue(18789);
    service.isLoaded.mockResolvedValue(true);
    service.restart.mockResolvedValue(undefined);
    service.readCommand.mockResolvedValue({
      programArguments: ["argent", "gateway", "--port", "18789"],
      environment: {},
    });
    renderRestartDiagnostics.mockReturnValue(["diag: unhealthy runtime"]);
  });

  it("kills stale pids and retries before succeeding", async () => {
    waitForGatewayHealthyRestart
      .mockResolvedValueOnce({
        healthy: false,
        staleGatewayPids: [1993],
        runtime: { status: "stopped" },
        portUsage: { port: 18789, status: "busy", listeners: [], hints: [] },
      })
      .mockResolvedValueOnce({
        healthy: true,
        staleGatewayPids: [],
        runtime: { status: "running" },
        portUsage: { port: 18789, status: "busy", listeners: [], hints: [] },
      });

    const { runDaemonRestart } = await import("./lifecycle.js");
    const result = await runDaemonRestart({ json: true });

    expect(result).toBe(true);
    expect(terminateStaleGatewayPids).toHaveBeenCalledWith([1993]);
    expect(service.restart).toHaveBeenCalledTimes(2);
    expect(waitForGatewayHealthyRestart).toHaveBeenCalledTimes(2);
  });

  it("fails with timeout diagnostics when still unhealthy", async () => {
    waitForGatewayHealthyRestart.mockResolvedValue({
      healthy: false,
      staleGatewayPids: [],
      runtime: { status: "stopped" },
      portUsage: { port: 18789, status: "free", listeners: [], hints: [] },
    });

    const { runDaemonRestart } = await import("./lifecycle.js");
    await expect(runDaemonRestart({ json: true })).rejects.toThrow("__exit__:1");
    expect(renderRestartDiagnostics).toHaveBeenCalledTimes(1);
  });
});
