import { describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.fn();
const serviceRestart = vi.fn();
const serviceIsLoaded = vi.fn();
const waitForGatewayHealthyRestart = vi.fn();
const runtimeError = vi.fn();
const runtimeExit = vi.fn((code: number) => {
  throw new Error(`__exit__:${code}`);
});

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
  resolveGatewayPort: () => 18_789,
}));

vi.mock("../../daemon/service.js", () => ({
  resolveGatewayService: () => ({
    label: "LaunchAgent",
    loadedText: "loaded",
    notLoadedText: "not loaded",
    restart: serviceRestart,
    isLoaded: serviceIsLoaded,
  }),
}));

vi.mock("./restart-health.js", () => ({
  DEFAULT_RESTART_HEALTH_ATTEMPTS: 1,
  DEFAULT_RESTART_HEALTH_DELAY_MS: 1,
  waitForGatewayHealthyRestart: (...args: unknown[]) => waitForGatewayHealthyRestart(...args),
  terminateStaleGatewayPids: vi.fn(async () => []),
  renderRestartDiagnostics: vi.fn(() => []),
}));

vi.mock("../../runtime.js", () => ({
  defaultRuntime: {
    error: runtimeError,
    exit: runtimeExit,
    log: vi.fn(),
  },
}));

describe("runDaemonRestart preflight", () => {
  it("blocks restart when gateway auth token mode is invalid", async () => {
    const { runDaemonRestart } = await import("./lifecycle.js");
    loadConfigMock.mockReturnValue({
      gateway: { auth: { mode: "token", token: "   " } },
    });
    serviceIsLoaded.mockResolvedValue(true);
    serviceRestart.mockReset();

    await expect(runDaemonRestart({ json: false })).rejects.toThrow("__exit__:1");
    expect(serviceRestart).not.toHaveBeenCalled();
  });

  it("allows restart when gateway auth config is valid", async () => {
    const { runDaemonRestart } = await import("./lifecycle.js");
    loadConfigMock.mockReturnValue({
      gateway: { auth: { mode: "token", token: "good-token" } },
    });
    serviceIsLoaded.mockResolvedValue(true);
    serviceRestart.mockResolvedValue(undefined);
    waitForGatewayHealthyRestart.mockResolvedValue({
      runtime: { status: "running", pid: 123 },
      portUsage: { port: 18_789, status: "busy", listeners: [], hints: [] },
      healthy: true,
      staleGatewayPids: [],
    });

    await expect(runDaemonRestart({ json: true })).resolves.toBe(true);
    expect(serviceRestart).toHaveBeenCalledTimes(1);
  });
});
