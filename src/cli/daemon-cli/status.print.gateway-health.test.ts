import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonStatus } from "./status.gather.js";

const logs: string[] = [];
const errors: string[] = [];

vi.mock("../../runtime.js", () => ({
  defaultRuntime: {
    log: (msg: string) => logs.push(msg),
    error: (msg: string) => errors.push(msg),
    exit: vi.fn(),
  },
}));

function buildStatus(overrides: Partial<DaemonStatus>): DaemonStatus {
  return {
    service: {
      label: "systemd",
      loaded: true,
      loadedText: "enabled",
      notLoadedText: "disabled",
      runtime: { status: "running", pid: 101 },
    },
    config: {
      cli: { path: "/tmp/argent.json", exists: true, valid: true },
    },
    gateway: {
      bindMode: "loopback",
      bindHost: "127.0.0.1",
      port: 18789,
      portSource: "env/config",
      probeUrl: "ws://127.0.0.1:18789",
    },
    port: {
      port: 18789,
      status: "busy",
      listeners: [{ pid: 101, commandLine: "argent gateway" }],
      hints: [],
    },
    rpc: { ok: true, url: "ws://127.0.0.1:18789" },
    extraServices: [],
    ...overrides,
  };
}

describe("printDaemonStatus gateway health classifications", () => {
  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
  });

  it("prints running+healthy", async () => {
    const { printDaemonStatus } = await import("./status.print.js");
    printDaemonStatus(buildStatus({}), { json: false });
    expect(
      logs.some((line) => line.includes("Gateway health:") && line.includes("running+healthy")),
    ).toBe(true);
  });

  it("prints running but not listening", async () => {
    const { printDaemonStatus } = await import("./status.print.js");
    printDaemonStatus(
      buildStatus({
        port: { port: 18789, status: "free", listeners: [], hints: [] },
        rpc: { ok: false, error: "connect failed", url: "ws://127.0.0.1:18789" },
      }),
      { json: false },
    );
    expect(
      logs.some(
        (line) => line.includes("Gateway health:") && line.includes("running but not listening"),
      ),
    ).toBe(true);
  });

  it("prints auth/config mismatch", async () => {
    const { printDaemonStatus } = await import("./status.print.js");
    printDaemonStatus(
      buildStatus({
        rpc: { ok: false, error: "unauthorized", url: "ws://127.0.0.1:18789" },
      }),
      { json: false },
    );
    expect(
      logs.some(
        (line) => line.includes("Gateway health:") && line.includes("auth/config mismatch"),
      ),
    ).toBe(true);
    expect(errors.some((line) => line.includes("Auth/config mismatch"))).toBe(true);
  });
});
