import { describe, expect, it } from "vitest";
import {
  collectRuntimeSecurityAuditFindings,
  type RuntimeAuditServiceReader,
} from "./audit-runtime.js";

describe("collectRuntimeSecurityAuditFindings", () => {
  it("maps gateway service config runtime issues into security findings", async () => {
    const findings = await collectRuntimeSecurityAuditFindings({
      env: { HOME: "/tmp" },
      platform: "darwin",
      includePort: false,
      serviceLoaded: true,
      serviceRuntime: { status: "running", pid: 123 },
      serviceCommand: {
        programArguments: ["/Users/test/.nvm/versions/node/v22.0.0/bin/node", "gateway"],
        environment: {
          PATH: "/usr/bin:/bin:/Users/test/.nvm/versions/node/v22.0.0/bin",
        },
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "service.gateway_runtime_node_version_manager",
          severity: "warn",
        }),
      ]),
    );
  });

  it("reports port mismatch, PID mismatch, and unreachable gateway evidence", async () => {
    const findings = await collectRuntimeSecurityAuditFindings({
      config: { gateway: { port: 18789 } },
      env: {},
      includeService: false,
      serviceLoaded: true,
      serviceRuntime: { status: "running", pid: 222 },
      serviceCommand: {
        programArguments: ["/usr/bin/node", "gateway", "--port", "19000"],
        environment: {},
      },
      portUsage: {
        port: 19000,
        status: "busy",
        listeners: [{ pid: 111, commandLine: "python -m http.server 19000" }],
        hints: [],
      },
      gatewayProbeResult: {
        ok: false,
        url: "ws://127.0.0.1:19000",
        error: "connect failed",
        close: null,
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkId: "runtime.gateway_port_mismatch" }),
        expect.objectContaining({ checkId: "runtime.gateway_pid_mismatch" }),
        expect.objectContaining({ checkId: "runtime.gateway_unreachable" }),
      ]),
    );
  });

  it("turns service inspection failures into findings instead of throwing", async () => {
    const service: RuntimeAuditServiceReader = {
      label: "test service",
      isLoaded: async () => {
        throw new Error("cannot inspect service");
      },
      readCommand: async () => {
        throw new Error("cannot read command");
      },
      readRuntime: async () => {
        throw new Error("cannot read runtime");
      },
    };

    const findings = await collectRuntimeSecurityAuditFindings({
      env: {},
      service,
      includePort: false,
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkId: "service.loaded_status_unavailable" }),
        expect.objectContaining({ checkId: "service.command_unavailable", severity: "warn" }),
        expect.objectContaining({ checkId: "service.runtime_unavailable" }),
      ]),
    );
  });
});
