import { describe, expect, it } from "vitest";
import type { ResponseFrame } from "../gateway/protocol/index.js";
import type { RustGatewayParityFixture } from "./rust-gateway-parity-fixtures.js";
import {
  runRustGatewayParityReplay,
  type RustGatewayParityReplayTransport,
} from "./rust-gateway-parity-runner.js";

const baseFixture = {
  surface: "health",
  params: {},
  reason: "test",
} satisfies Pick<RustGatewayParityFixture, "surface" | "params" | "reason">;

function frame(id: string, ok: boolean, payload?: unknown, message?: string): ResponseFrame {
  return ok
    ? { type: "res", id, ok: true, payload }
    : {
        type: "res",
        id,
        ok: false,
        error: { code: "INVALID_REQUEST", message: message ?? "failed" },
      };
}

describe("runRustGatewayParityReplay", () => {
  it("passes schema-compatible fixtures when response envelopes agree", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "health",
        method: "health",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async () =>
      frame("health", true, { ok: true, durationMs: 1, defaultAgentId: "main" });

    const report = await runRustGatewayParityReplay({ fixtures, transport, nowMs: () => 1 });

    expect(report.generatedAtMs).toBe(1);
    expect(report.totals).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(report.results[0]?.observedParity).toBe("schema-compatible");
    expect(report.results[0]?.notes.join(" ")).toContain("schema/payload");
  });

  it("fails schema-compatible fixtures when known payload shapes drift", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "health",
        method: "health",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      endpoint === "node"
        ? frame(endpoint, true, { ok: true, durationMs: 1, defaultAgentId: "main" })
        : frame(endpoint, true, { status: "ok" });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals.failed).toBe(1);
    expect(report.results[0]?.observedParity).toBe("failed");
    expect(report.results[0]?.notes.join(" ")).toContain("schema/payload");
  });

  it("passes connect fixtures when both gateways advertise required read-only methods", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "connect-methods",
        method: "connect",
        safety: "read-only",
        expectedParity: "schema-compatible",
        requiredMethods: ["health", "status", "commands.list"],
      },
    ];
    const transport: RustGatewayParityReplayTransport = async () =>
      frame("connect", true, {
        type: "hello-ok",
        protocol: 3,
        server: {},
        features: { methods: ["health", "status", "commands.list"] },
        snapshot: {},
      });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(report.results[0]?.notes.join(" ")).toContain(
      "both gateways advertise required read-only methods",
    );
  });

  it("fails connect fixtures when required method discovery drifts", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "connect-methods",
        method: "connect",
        safety: "read-only",
        expectedParity: "schema-compatible",
        requiredMethods: ["health", "status", "commands.list"],
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, true, {
        type: "hello-ok",
        protocol: 3,
        server: {},
        features: {
          methods:
            endpoint === "node" ? ["health", "status", "commands.list"] : ["health", "status"],
        },
        snapshot: {},
      });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals.failed).toBe(1);
    expect(report.results[0]?.notes.join(" ")).toContain("required discovery drift");
    expect(report.results[0]?.notes.join(" ")).toContain("rust missing commands.list");
  });

  it("passes failed-auth fixtures when structured errors are redacted", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "wrong-token",
        method: "connect",
        safety: "read-only",
        expectedParity: "schema-compatible",
        authTokenOverride: "rust-gateway-parity-wrong-token",
        redactionProbes: ["rust-gateway-parity-wrong-token"],
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, false, undefined, "unauthorized");

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(report.results[0]?.observedParity).toBe("schema-compatible");
    expect(report.results[0]?.notes.join(" ")).toContain("structured and redacted");
  });

  it("fails failed-auth fixtures when error envelopes leak token probes", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "wrong-token",
        method: "connect",
        safety: "read-only",
        expectedParity: "schema-compatible",
        authTokenOverride: "rust-gateway-parity-wrong-token",
        redactionProbes: ["rust-gateway-parity-wrong-token"],
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      endpoint === "node"
        ? frame(endpoint, false, undefined, "unauthorized")
        : frame(endpoint, false, undefined, "bad token rust-gateway-parity-wrong-token");

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals.failed).toBe(1);
    expect(report.results[0]?.observedParity).toBe("failed");
    expect(report.results[0]?.notes.join(" ")).toContain("leaked redaction probe");
  });

  it("passes status fixtures when read-only summary fields are present", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "status",
        method: "status",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, true, {
        heartbeat: { defaultAgentId: "main", agents: [] },
        sessions: { paths: [], count: 0, defaults: {}, recent: [], byAgent: [] },
        channelSummary: [],
        queuedSystemEvents: [],
      });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(report.results[0]?.observedParity).toBe("schema-compatible");
    expect(report.results[0]?.notes.join(" ")).toContain("status payload includes");
  });

  it("passes commands.list fixtures when a command array is present", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "commands",
        method: "commands.list",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, true, { commands: [{ key: "status", description: "Show status" }] });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(report.results[0]?.observedParity).toBe("schema-compatible");
    expect(report.results[0]?.notes.join(" ")).toContain(
      "commands.list payload includes a commands array",
    );
  });

  it("passes models.list fixtures when model choices match the protocol shape", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "models",
        method: "models.list",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, true, {
        models: [
          {
            id: "shadow-gpt-mini",
            name: "Shadow GPT Mini",
            provider: "openai",
            contextWindow: 32768,
            reasoning: false,
          },
        ],
      });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(report.results[0]?.observedParity).toBe("schema-compatible");
    expect(report.results[0]?.notes.join(" ")).toContain(
      "models.list payload includes schema-compatible model choices",
    );
  });

  it("fails models.list fixtures when a model choice field drifts", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "models",
        method: "models.list",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      endpoint === "node"
        ? frame(endpoint, true, {
            models: [{ id: "node-model", name: "Node Model", provider: "openai" }],
          })
        : frame(endpoint, true, {
            models: [
              { id: "rust-model", name: "Rust Model", provider: "openai", reasoning: "yes" },
            ],
          });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals.failed).toBe(1);
    expect(report.results[0]?.observedParity).toBe("failed");
    expect(report.results[0]?.notes.join(" ")).toContain("reasoning is not boolean");
  });

  it("passes sessions.list fixtures when session rows match the read-only shape", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "sessions",
        method: "sessions.list",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, true, {
        ts: 1,
        path: `${endpoint}-sessions.json`,
        count: 1,
        defaults: { model: "shadow-gpt-mini" },
        sessions: [{ key: "agent:argent:main", kind: "direct" }],
      });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(report.results[0]?.observedParity).toBe("schema-compatible");
    expect(report.results[0]?.notes.join(" ")).toContain(
      "sessions.list payload includes schema-compatible session rows",
    );
  });

  it("fails sessions.list fixtures when count drifts from returned rows", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "sessions",
        method: "sessions.list",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      endpoint === "node"
        ? frame(endpoint, true, {
            ts: 1,
            path: "node-sessions.json",
            count: 1,
            defaults: {},
            sessions: [{ key: "agent:argent:main", kind: "direct" }],
          })
        : frame(endpoint, true, {
            ts: 1,
            path: "rust-sessions.json",
            count: 2,
            defaults: {},
            sessions: [{ key: "agent:argent:main", kind: "direct" }],
          });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals.failed).toBe(1);
    expect(report.results[0]?.observedParity).toBe("failed");
    expect(report.results[0]?.notes.join(" ")).toContain("count does not match sessions length");
  });

  it("passes cron.status fixtures when scheduler status is read-only schema-compatible", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "cron-status",
        surface: "timers",
        method: "cron.status",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, true, {
        enabled: true,
        storePath: `${endpoint}/cron/jobs.json`,
        jobs: 1,
        nextWakeAtMs: 1_776_603_600_000,
      });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(report.results[0]?.observedParity).toBe("schema-compatible");
    expect(report.results[0]?.notes.join(" ")).toContain("cron.status payload includes");
  });

  it("fails cron.status fixtures when scheduler counts drift from the schema", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "cron-status",
        surface: "timers",
        method: "cron.status",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      endpoint === "node"
        ? frame(endpoint, true, {
            enabled: true,
            storePath: "node/cron/jobs.json",
            jobs: 1,
            nextWakeAtMs: null,
          })
        : frame(endpoint, true, {
            enabled: true,
            storePath: "rust/cron/jobs.json",
            jobs: 1.5,
          });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals.failed).toBe(1);
    expect(report.results[0]?.notes.join(" ")).toContain("jobs is not a non-negative integer");
  });

  it("passes cron.list fixtures when timer rows are read-only schema-compatible", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "cron-list",
        surface: "timers",
        method: "cron.list",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, true, {
        jobs: [
          {
            id: `${endpoint}-cron-1`,
            name: "daily",
            enabled: true,
            schedule: { kind: "every", everyMs: 60_000 },
            payload: { kind: "systemEvent", text: "hello" },
            nextRunAt: 1_776_603_600_000,
          },
        ],
      });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(report.results[0]?.observedParity).toBe("schema-compatible");
    expect(report.results[0]?.notes.join(" ")).toContain("cron.list payload includes");
  });

  it("fails cron.list fixtures when timer rows omit schedule shape", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "cron-list",
        surface: "timers",
        method: "cron.list",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      endpoint === "node"
        ? frame(endpoint, true, {
            jobs: [
              {
                id: "node-cron-1",
                name: "daily",
                enabled: true,
                schedule: { kind: "every", everyMs: 60_000 },
                payload: { kind: "systemEvent", text: "hello" },
              },
            ],
          })
        : frame(endpoint, true, {
            jobs: [
              {
                id: "rust-cron-1",
                name: "daily",
                enabled: true,
                payload: { kind: "systemEvent", text: "hello" },
              },
            ],
          });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals.failed).toBe(1);
    expect(report.results[0]?.notes.join(" ")).toContain("schedule is not an object");
  });

  it("passes mock-compatible fixtures but marks them as non-promotion evidence", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "channels",
        method: "channels.status",
        safety: "read-only",
        expectedParity: "mock-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, true, { source: endpoint });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.results[0]?.status).toBe("passed");
    expect(report.results[0]?.observedParity).toBe("mock-compatible");
    expect(report.results[0]?.notes.join(" ")).toContain("not promotion evidence");
  });

  it("passes unsupported fixtures when rust explicitly rejects the method", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "workflows-list",
        method: "workflows.list",
        safety: "read-only",
        expectedParity: "unsupported",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      endpoint === "node"
        ? frame(endpoint, true, { workflows: [] })
        : frame(endpoint, false, undefined, "unknown method: workflows.list");

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.results[0]?.status).toBe("passed");
    expect(report.results[0]?.observedParity).toBe("unsupported");
  });

  it("skips unsafe fixtures without calling transport", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "cron-add",
        method: "cron.add",
        safety: "unsafe",
        expectedParity: "unsafe",
      },
    ];
    let calls = 0;

    const report = await runRustGatewayParityReplay({
      fixtures,
      transport: async () => {
        calls += 1;
        return frame("never", true, {});
      },
    });

    expect(calls).toBe(0);
    expect(report.totals).toEqual({ passed: 0, failed: 0, skipped: 1 });
    expect(report.results[0]?.notes.join(" ")).toContain("blocked unsafe replay");
  });

  it("fails exact fixtures when payloads drift", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "exact-health",
        method: "health",
        safety: "read-only",
        expectedParity: "exact",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      frame(endpoint, true, { status: endpoint });

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals.failed).toBe(1);
    expect(report.results[0]?.observedParity).toBe("failed");
    expect(report.results[0]?.notes).toContain("payload/exact: node/rust payloads differ");
  });

  it("fails invalid response frames", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "bad-frame",
        method: "health",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) =>
      endpoint === "node" ? frame(endpoint, true, {}) : { type: "event", event: "health" };

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.results[0]?.status).toBe("failed");
    expect(report.results[0]?.notes.join(" ")).toContain("envelope/rust invalid");
  });

  it("records transport errors as fixture failures instead of aborting the report", async () => {
    const fixtures: RustGatewayParityFixture[] = [
      {
        ...baseFixture,
        id: "timeout",
        method: "status",
        safety: "read-only",
        expectedParity: "schema-compatible",
      },
    ];
    const transport: RustGatewayParityReplayTransport = async ({ endpoint }) => {
      if (endpoint === "rust") {
        throw new Error("timeout waiting for websocket message");
      }
      return frame(endpoint, true, {});
    };

    const report = await runRustGatewayParityReplay({ fixtures, transport });

    expect(report.totals).toEqual({ passed: 0, failed: 1, skipped: 0 });
    expect(report.results[0]?.notes).toEqual([
      "transport/rust: Error: timeout waiting for websocket message",
    ]);
  });
});
