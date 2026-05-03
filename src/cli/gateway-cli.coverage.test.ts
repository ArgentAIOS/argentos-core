import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

const callGateway = vi.fn(async () => ({ ok: true }));
const startGatewayServer = vi.fn(async () => ({
  close: vi.fn(async () => {}),
}));
const setVerbose = vi.fn();
const forceFreePortAndWait = vi.fn(async () => ({
  killed: [],
  waitedMs: 0,
  escalatedToSigkill: false,
}));
const serviceIsLoaded = vi.fn().mockResolvedValue(true);
const serviceInstall = vi.fn(async () => {});
const discoverGatewayBeacons = vi.fn(async () => []);
const gatewayStatusCommand = vi.fn(async () => {});
const gatewayAuthorityStatusCommand = vi.fn(async () => {});
const gatewayAuthorityLocalSmokeCommand = vi.fn(async () => {});
const gatewayAuthorityLocalRehearsalCommand = vi.fn(async () => {});
const gatewayAuthorityRollbackPlanCommand = vi.fn(async () => {});

const runtimeLogs: string[] = [];
const runtimeErrors: string[] = [];
const defaultRuntime = {
  log: (msg: string) => runtimeLogs.push(msg),
  error: (msg: string) => runtimeErrors.push(msg),
  exit: (code: number) => {
    throw new Error(`__exit__:${code}`);
  },
};

async function withEnvOverride<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  vi.resetModules();
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    vi.resetModules();
  }
}

vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGateway(opts),
  randomIdempotencyKey: () => "rk_test",
}));

vi.mock("../gateway/server.js", () => ({
  startGatewayServer: (port: number, opts?: unknown) => startGatewayServer(port, opts),
}));

vi.mock("../globals.js", () => ({
  info: (msg: string) => msg,
  isVerbose: () => false,
  setVerbose: (enabled: boolean) => setVerbose(enabled),
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime,
}));

vi.mock("./ports.js", () => ({
  forceFreePortAndWait: (port: number) => forceFreePortAndWait(port),
}));

vi.mock("../daemon/service.js", () => ({
  resolveGatewayService: () => ({
    label: "LaunchAgent",
    loadedText: "loaded",
    notLoadedText: "not loaded",
    install: serviceInstall,
    uninstall: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    isLoaded: serviceIsLoaded,
    readCommand: vi.fn(),
    readRuntime: vi.fn().mockResolvedValue({ status: "running" }),
  }),
}));

vi.mock("../daemon/program-args.js", () => ({
  resolveGatewayProgramArguments: async () => ({
    programArguments: ["/bin/node", "cli", "gateway", "--port", "18789"],
  }),
}));

vi.mock("../infra/bonjour-discovery.js", () => ({
  discoverGatewayBeacons: (opts: unknown) => discoverGatewayBeacons(opts),
}));

vi.mock("../commands/gateway-status.js", () => ({
  gatewayStatusCommand: (opts: unknown) => gatewayStatusCommand(opts),
}));

vi.mock("../commands/gateway-authority-status.js", () => ({
  gatewayAuthorityLocalSmokeCommand: (runtime: unknown, opts: unknown) =>
    gatewayAuthorityLocalSmokeCommand(runtime, opts),
  gatewayAuthorityLocalRehearsalCommand: (runtime: unknown, opts: unknown) =>
    gatewayAuthorityLocalRehearsalCommand(runtime, opts),
  gatewayAuthorityRollbackPlanCommand: (runtime: unknown, opts: unknown) =>
    gatewayAuthorityRollbackPlanCommand(runtime, opts),
  gatewayAuthorityStatusCommand: (runtime: unknown, opts: unknown) =>
    gatewayAuthorityStatusCommand(runtime, opts),
}));

describe("gateway-cli coverage", () => {
  it("registers call/health commands and routes to callGateway", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    callGateway.mockClear();

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await program.parseAsync(["gateway", "call", "health", "--params", '{"x":1}', "--json"], {
      from: "user",
    });

    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(runtimeLogs.join("\n")).toContain('"ok": true');
  }, 30_000);

  it("registers gateway probe and routes to gatewayStatusCommand", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    gatewayStatusCommand.mockClear();

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await program.parseAsync(["gateway", "probe", "--json"], { from: "user" });

    expect(gatewayStatusCommand).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("registers gateway authority status and routes to read-only status command", async () => {
    gatewayAuthorityStatusCommand.mockClear();

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await program.parseAsync(["gateway", "authority", "status", "--json"], { from: "user" });

    expect(gatewayAuthorityStatusCommand).toHaveBeenCalledTimes(1);
    expect(gatewayAuthorityStatusCommand.mock.calls[0]?.[1]).toEqual({ json: true });
  }, 30_000);

  it("routes explicit installed canary status options without enabling them by default", async () => {
    gatewayAuthorityStatusCommand.mockClear();

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await program.parseAsync(
      [
        "gateway",
        "authority",
        "status",
        "--json",
        "--installed-canary-url",
        "ws://127.0.0.1:18789",
        "--installed-canary-token",
        "test-token",
        "--installed-canary-timeout",
        "1250",
      ],
      { from: "user" },
    );

    expect(gatewayAuthorityStatusCommand).toHaveBeenCalledTimes(1);
    expect(gatewayAuthorityStatusCommand.mock.calls[0]?.[1]).toEqual({
      json: true,
      installedCanary: {
        url: "ws://127.0.0.1:18789",
        token: "test-token",
        password: undefined,
        timeoutMs: 1250,
      },
    });
  }, 30_000);

  it("registers gateway authority smoke-local as a read-only operator smoke", async () => {
    gatewayAuthorityLocalSmokeCommand.mockClear();

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await program.parseAsync(
      [
        "gateway",
        "authority",
        "smoke-local",
        "--reason",
        "dev.20 operator smoke",
        "--confirm-local-only",
        "--installed-canary-url",
        "ws://127.0.0.1:18789",
        "--installed-canary-token",
        "test-token",
        "--installed-canary-timeout",
        "1250",
        "--json",
      ],
      { from: "user" },
    );

    expect(gatewayAuthorityLocalSmokeCommand).toHaveBeenCalledTimes(1);
    expect(gatewayAuthorityLocalSmokeCommand.mock.calls[0]?.[1]).toEqual({
      json: true,
      reason: "dev.20 operator smoke",
      confirmLocalOnly: true,
      installedCanary: {
        url: "ws://127.0.0.1:18789",
        token: "test-token",
        password: undefined,
        timeoutMs: 1250,
      },
    });
  }, 30_000);

  it("registers gateway authority rollback-node as a read-only plan command", async () => {
    gatewayAuthorityRollbackPlanCommand.mockClear();

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await program.parseAsync(
      ["gateway", "authority", "rollback-node", "--reason", "canary drift", "--json"],
      { from: "user" },
    );

    expect(gatewayAuthorityRollbackPlanCommand).toHaveBeenCalledTimes(1);
    expect(gatewayAuthorityRollbackPlanCommand.mock.calls[0]?.[1]).toEqual({
      json: true,
      reason: "canary drift",
    });
  }, 30_000);

  it("registers gateway authority rehearse-local as an explicit local-only test path", async () => {
    gatewayAuthorityLocalRehearsalCommand.mockClear();

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await program.parseAsync(
      [
        "gateway",
        "authority",
        "rehearse-local",
        "--reason",
        "local canary rehearsal",
        "--confirm-local-only",
        "--installed-canary-url",
        "ws://127.0.0.1:18789",
        "--installed-canary-token",
        "test-token",
        "--json",
      ],
      { from: "user" },
    );

    expect(gatewayAuthorityLocalRehearsalCommand).toHaveBeenCalledTimes(1);
    expect(gatewayAuthorityLocalRehearsalCommand.mock.calls[0]?.[1]).toEqual({
      json: true,
      reason: "local canary rehearsal",
      confirmLocalOnly: true,
      installedCanary: {
        url: "ws://127.0.0.1:18789",
        token: "test-token",
        password: undefined,
        timeoutMs: undefined,
      },
    });
  }, 30_000);

  it("registers gateway discover and prints JSON", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    discoverGatewayBeacons.mockReset();
    discoverGatewayBeacons.mockResolvedValueOnce([
      {
        instanceName: "Studio (Argent)",
        displayName: "Studio",
        domain: "local.",
        host: "studio.local",
        lanHost: "studio.local",
        tailnetDns: "studio.tailnet.ts.net",
        gatewayPort: 18789,
        sshPort: 22,
      },
    ]);

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await program.parseAsync(["gateway", "discover", "--json"], {
      from: "user",
    });

    expect(discoverGatewayBeacons).toHaveBeenCalledTimes(1);
    expect(runtimeLogs.join("\n")).toContain('"beacons"');
    expect(runtimeLogs.join("\n")).toContain('"wsUrl"');
    expect(runtimeLogs.join("\n")).toContain("ws://");
  });

  it("registers gateway discover and prints human output with details on new lines", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    discoverGatewayBeacons.mockReset();
    discoverGatewayBeacons.mockResolvedValueOnce([
      {
        instanceName: "Studio (Argent)",
        displayName: "Studio",
        domain: "argent.internal.",
        host: "studio.argent.internal",
        lanHost: "studio.local",
        tailnetDns: "studio.tailnet.ts.net",
        gatewayPort: 18789,
        sshPort: 22,
      },
    ]);

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await program.parseAsync(["gateway", "discover", "--timeout", "1"], {
      from: "user",
    });

    const out = runtimeLogs.join("\n");
    expect(out).toContain("Gateway Discovery");
    expect(out).toContain("Found 1 gateway(s)");
    expect(out).toContain("- Studio argent.internal.");
    expect(out).toContain("  tailnet: studio.tailnet.ts.net");
    expect(out).toContain("  host: studio.argent.internal");
    expect(out).toContain("  ws: ws://studio.tailnet.ts.net:18789");
  });

  it("validates gateway discover timeout", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    discoverGatewayBeacons.mockReset();

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await expect(
      program.parseAsync(["gateway", "discover", "--timeout", "0"], {
        from: "user",
      }),
    ).rejects.toThrow("__exit__:1");

    expect(runtimeErrors.join("\n")).toContain("gateway discover failed:");
    expect(discoverGatewayBeacons).not.toHaveBeenCalled();
  });

  it("fails gateway call on invalid params JSON", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    callGateway.mockClear();

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await expect(
      program.parseAsync(["gateway", "call", "status", "--params", "not-json"], { from: "user" }),
    ).rejects.toThrow("__exit__:1");

    expect(callGateway).not.toHaveBeenCalled();
    expect(runtimeErrors.join("\n")).toContain("Gateway call failed:");
  });

  it("validates gateway ports and handles force/start errors", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;

    const { registerGatewayCli } = await import("./gateway-cli.js");

    // Invalid port
    const programInvalidPort = new Command();
    programInvalidPort.exitOverride();
    registerGatewayCli(programInvalidPort);
    await expect(
      programInvalidPort.parseAsync(["gateway", "run", "--port", "0", "--token", "test-token"], {
        from: "user",
      }),
    ).rejects.toThrow("__exit__:1");

    // Force free failure
    forceFreePortAndWait.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const programForceFail = new Command();
    programForceFail.exitOverride();
    registerGatewayCli(programForceFail);
    await expect(
      programForceFail.parseAsync(
        [
          "gateway",
          "run",
          "--port",
          "18789",
          "--token",
          "test-token",
          "--force",
          "--allow-unconfigured",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow("__exit__:1");

    // Start failure (generic)
    startGatewayServer.mockRejectedValueOnce(new Error("nope"));
    const programStartFail = new Command();
    programStartFail.exitOverride();
    registerGatewayCli(programStartFail);
    const beforeSigterm = new Set(process.listeners("SIGTERM"));
    const beforeSigint = new Set(process.listeners("SIGINT"));
    await expect(
      programStartFail.parseAsync(
        ["gateway", "run", "--port", "18789", "--token", "test-token", "--allow-unconfigured"],
        {
          from: "user",
        },
      ),
    ).rejects.toThrow("__exit__:1");
    for (const listener of process.listeners("SIGTERM")) {
      if (!beforeSigterm.has(listener)) {
        process.removeListener("SIGTERM", listener);
      }
    }
    for (const listener of process.listeners("SIGINT")) {
      if (!beforeSigint.has(listener)) {
        process.removeListener("SIGINT", listener);
      }
    }
  });

  it.skip("passes parent gateway options through to install subcommand", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    serviceInstall.mockClear();
    serviceIsLoaded.mockResolvedValue(false);

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await program.parseAsync(["gateway", "--token", "test-token", "--force", "install", "--json"], {
      from: "user",
    });

    expect(serviceInstall).toHaveBeenCalledTimes(1);
    expect(serviceInstall.mock.calls[0]?.[0]?.environment?.ARGENT_GATEWAY_TOKEN).toBe("test-token");
    serviceIsLoaded.mockResolvedValue(true);
  });

  it("passes gateway parent options supplied after the subcommand to install", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    serviceInstall.mockClear();
    serviceIsLoaded.mockResolvedValue(false);

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await program.parseAsync(
      ["gateway", "install", "--token", "after-token", "--force", "--json"],
      {
        from: "user",
      },
    );

    expect(serviceInstall).toHaveBeenCalledTimes(1);
    expect(serviceInstall.mock.calls[0]?.[0]?.environment?.ARGENT_GATEWAY_TOKEN).toBe(
      "after-token",
    );
    serviceIsLoaded.mockResolvedValue(true);
  });

  it("prints stop hints on GatewayLockError when service is loaded", async () => {
    runtimeLogs.length = 0;
    runtimeErrors.length = 0;
    serviceIsLoaded.mockResolvedValue(true);
    startGatewayServer.mockReset();

    const { GatewayLockError } = await import("../infra/gateway-lock.js");
    startGatewayServer.mockRejectedValueOnce(
      new GatewayLockError("another gateway instance is already listening"),
    );

    const { registerGatewayCli } = await import("./gateway-cli.js");
    const program = new Command();
    program.exitOverride();
    registerGatewayCli(program);

    await expect(
      program.parseAsync(["gateway", "--token", "test-token", "--allow-unconfigured"], {
        from: "user",
      }),
    ).rejects.toThrow("__exit__:1");

    expect(startGatewayServer).toHaveBeenCalled();
    expect(runtimeErrors.join("\n")).toContain("Gateway failed to start:");
    expect(runtimeErrors.join("\n")).toContain("gateway stop");
  });

  it("uses env/config port when --port is omitted", async () => {
    await withEnvOverride({ ARGENT_GATEWAY_PORT: "19001" }, async () => {
      runtimeLogs.length = 0;
      runtimeErrors.length = 0;
      startGatewayServer.mockClear();

      const { registerGatewayCli } = await import("./gateway-cli.js");
      const program = new Command();
      program.exitOverride();
      registerGatewayCli(program);

      startGatewayServer.mockRejectedValueOnce(new Error("nope"));
      await expect(
        program.parseAsync(["gateway", "--token", "test-token", "--allow-unconfigured"], {
          from: "user",
        }),
      ).rejects.toThrow("__exit__:1");

      expect(startGatewayServer).toHaveBeenCalledWith(19001, expect.anything());
    });
  });
});
