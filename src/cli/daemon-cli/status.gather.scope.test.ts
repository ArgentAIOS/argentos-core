import { afterEach, describe, expect, it, vi } from "vitest";

const auditGatewayServiceConfig = vi.fn(async () => ({ ok: true, issues: [] }));
const serviceIsLoaded = vi.fn(async () => true);
const serviceReadCommand = vi.fn(async () => null);
const serviceReadRuntime = vi.fn(async () => ({ status: "running", state: "active", pid: 123 }));
const readConfigFileSnapshot = vi.fn(async () => ({
  path: "/tmp/argent-status-scope/argent.json",
  exists: true,
  valid: true,
  issues: [],
}));
const loadConfig = vi.fn(() => ({
  gateway: {
    bind: "loopback",
    port: 19090,
    auth: { mode: "token", token: "tok" },
    controlUi: { enabled: true, basePath: "/" },
  },
}));
const probeGatewayStatus = vi.fn(async () => ({
  ok: false,
  error: "connect failed: ECONNREFUSED",
}));

vi.mock("../../config/config.js", () => ({
  createConfigIO: () => ({
    readConfigFileSnapshot: () => readConfigFileSnapshot(),
    loadConfig: () => loadConfig(),
  }),
  resolveConfigPath: () => "/tmp/argent-status-scope/argent.json",
  resolveGatewayPort: (cfg: { gateway?: { port?: number } }) => cfg.gateway?.port ?? 18789,
  resolveStateDir: () => "/tmp/argent-status-scope",
}));

vi.mock("../../daemon/diagnostics.js", () => ({
  readLastGatewayErrorLine: async () => null,
}));

vi.mock("../../daemon/inspect.js", () => ({
  findExtraGatewayServices: async () => [],
}));

vi.mock("../../daemon/service-audit.js", () => ({
  auditGatewayServiceConfig: (opts: unknown) => auditGatewayServiceConfig(opts),
}));

vi.mock("../../daemon/service.js", () => ({
  resolveGatewayService: () => ({
    label: "LaunchAgent",
    loadedText: "loaded",
    notLoadedText: "not loaded",
    isLoaded: () => serviceIsLoaded(),
    readCommand: () => serviceReadCommand(),
    readRuntime: () => serviceReadRuntime(),
  }),
}));

vi.mock("../../gateway/net.js", () => ({
  resolveGatewayBindHost: async () => "127.0.0.1",
}));

vi.mock("../../infra/ports.js", () => ({
  formatPortDiagnostics: () => [],
  inspectPortUsage: async (port: number) => ({
    port,
    status: "free",
    listeners: [],
    hints: [],
  }),
}));

vi.mock("../../infra/tailnet.js", () => ({
  pickPrimaryTailnetIPv4: () => null,
}));

vi.mock("./probe.js", () => ({
  probeGatewayStatus: (opts: unknown) => probeGatewayStatus(opts),
}));

vi.mock("./shared.js", () => ({
  normalizeListenerAddress: (value: string) => value,
  parsePortFromArgs: () => null,
  pickProbeHostForBind: () => "127.0.0.1",
}));

describe("gatherDaemonStatus scope handling", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    vi.clearAllMocks();
  });

  it("treats a loaded primary-home service as out of scope for alternate-home runs", async () => {
    process.env.HOME = "/tmp/argent-status-scope/home";

    const { gatherDaemonStatus } = await import("./status.gather.js");
    const status = await gatherDaemonStatus({
      rpc: { json: true, timeout: "1000" },
      probe: true,
    });

    expect(status.service.loaded).toBe(false);
    expect(status.service.command).toBeNull();
    expect(status.service.runtime).toBeUndefined();
    expect(auditGatewayServiceConfig).not.toHaveBeenCalled();
    expect(status.rpc?.diagnosis).toBe("rpc-unreachable");
  });
});
