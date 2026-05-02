export type RustGatewayParityLabel =
  | "exact"
  | "schema-compatible"
  | "mock-compatible"
  | "unsupported"
  | "unsafe";

export type RustGatewayFixtureSafety = "read-only" | "shadow-only" | "unsafe";

export type RustGatewayParityFixture = {
  id: string;
  surface:
    | "connect"
    | "health"
    | "status"
    | "presence"
    | "commands"
    | "config"
    | "catalog"
    | "models"
    | "nodes"
    | "sessions"
    | "timers"
    | "tools"
    | "workflows"
    | "channels"
    | "agent-run";
  method: string;
  params?: Record<string, unknown>;
  authTokenOverride?: string | null;
  redactionProbes?: string[];
  requiredMethods?: string[];
  timeoutMs?: number;
  safety: RustGatewayFixtureSafety;
  expectedParity: RustGatewayParityLabel;
  reason: string;
};

export type RustGatewayParitySummary = {
  total: number;
  replayable: number;
  unsafe: number;
  exact: number;
  schemaCompatible: number;
  mockCompatible: number;
  unsupported: number;
};

export const RUST_GATEWAY_INITIAL_PARITY_FIXTURES: RustGatewayParityFixture[] = [
  {
    id: "connect-v3-token",
    surface: "connect",
    method: "connect",
    requiredMethods: [
      "health",
      "status",
      "system-presence",
      "commands.list",
      "config.schema",
      "models.list",
      "sessions.list",
      "channels.status",
      "connectors.catalog",
      "cron.status",
      "cron.list",
      "tools.status",
    ],
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason: "Both gateways should negotiate protocol v3 and return a hello-ok envelope.",
  },
  {
    id: "connect-missing-token",
    surface: "connect",
    method: "connect",
    authTokenOverride: null,
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Both gateways should reject a missing token without leaking expected or received token material.",
  },
  {
    id: "connect-wrong-token",
    surface: "connect",
    method: "connect",
    authTokenOverride: "rust-gateway-parity-wrong-token",
    redactionProbes: ["rust-gateway-parity-wrong-token"],
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Both gateways should reject a mismatched token without leaking expected or received token material.",
  },
  {
    id: "rpc-health",
    surface: "health",
    method: "health",
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Health payloads may differ in detail, but the RPC envelope and health shape must validate.",
  },
  {
    id: "rpc-status",
    surface: "status",
    method: "status",
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Status must expose a schema-compatible read-only summary while Node remains live truth.",
  },
  {
    id: "rpc-system-presence",
    surface: "presence",
    method: "system-presence",
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason: "Presence must remain an array-shaped read surface for dashboard and Swift clients.",
  },
  {
    id: "rpc-commands-list",
    surface: "commands",
    method: "commands.list",
    params: {},
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Commands list must expose a schema-compatible read-only command array without granting Rust command authority.",
  },
  {
    id: "rpc-config-schema",
    surface: "config",
    method: "config.schema",
    params: {},
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason: "Config schema is a read-only shape surface and must not expose config secrets.",
  },
  {
    id: "rpc-models-list",
    surface: "models",
    method: "models.list",
    params: {},
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Models list must expose schema-compatible read-only model choices without granting Rust provider authority.",
  },
  {
    id: "rpc-channels-status",
    surface: "channels",
    method: "channels.status",
    params: {},
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Channels status must expose schema-compatible read-only channel summary metadata without granting Rust channel send/logout authority.",
  },
  {
    id: "rpc-connectors-catalog",
    surface: "catalog",
    method: "connectors.catalog",
    params: { executeAdapters: false },
    timeoutMs: 10_000,
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Connector catalog parity must use the no-exec snapshot contract so Rust can verify schema shape without running adapters.",
  },
  {
    id: "rpc-sessions-list",
    surface: "sessions",
    method: "sessions.list",
    params: {},
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Sessions list must expose schema-compatible read-only session rows without granting Rust live session authority.",
  },
  {
    id: "rpc-cron-status",
    surface: "timers",
    method: "cron.status",
    params: {},
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Cron status must expose scheduler state shape while Node remains the only live timer authority.",
  },
  {
    id: "rpc-cron-list",
    surface: "timers",
    method: "cron.list",
    params: {},
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Cron list must expose a read-only jobs array while Rust remains shadow-only and cannot mutate timers.",
  },
  {
    id: "rpc-node-list",
    surface: "nodes",
    method: "node.list",
    params: {},
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Node list must expose schema-compatible read-only node rows without granting Rust node invoke or pairing authority.",
  },
  {
    id: "rpc-tools-status",
    surface: "tools",
    method: "tools.status",
    params: {},
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Tools status must expose schema-compatible read-only tool metadata without granting Rust tool or connector execution authority.",
  },
  {
    id: "rpc-workflows-list",
    surface: "workflows",
    method: "workflows.list",
    params: { snapshot: "rust-parity-v1" },
    safety: "read-only",
    expectedParity: "schema-compatible",
    reason:
      "Workflow list parity uses the no-live-data rust-parity-v1 snapshot contract only; normal DB-backed workflows.list remains Node-owned live authority.",
  },
  {
    id: "rpc-chat-send",
    surface: "agent-run",
    method: "chat.send",
    params: { text: "shadow replay must not send this" },
    safety: "unsafe",
    expectedParity: "unsafe",
    reason: "Would create user-visible chat/run behavior if replayed against a live authority.",
  },
  {
    id: "rpc-cron-add",
    surface: "timers",
    method: "cron.add",
    params: { schedule: { kind: "every", everyMs: 60_000 }, payload: { kind: "systemEvent" } },
    safety: "unsafe",
    expectedParity: "unsafe",
    reason:
      "Would create a timer and risks duplicate scheduled work outside isolated canary state.",
  },
  {
    id: "rpc-workflows-run",
    surface: "workflows",
    method: "workflows.run",
    params: { workflowId: "shadow-replay-forbidden" },
    safety: "unsafe",
    expectedParity: "unsafe",
    reason: "Would dispatch workflow execution and must wait for isolated workflow canary gates.",
  },
];

export function getRustGatewayReplayableFixtures(
  fixtures: RustGatewayParityFixture[] = RUST_GATEWAY_INITIAL_PARITY_FIXTURES,
): RustGatewayParityFixture[] {
  return fixtures.filter((fixture) => fixture.safety !== "unsafe");
}

export function assertNoUnsafeRustGatewayReplayFixtures(
  fixtures: RustGatewayParityFixture[],
): void {
  const unsafe = fixtures.filter(
    (fixture) => fixture.safety === "unsafe" || fixture.expectedParity === "unsafe",
  );
  if (unsafe.length > 0) {
    throw new Error(
      `unsafe Rust gateway parity fixtures cannot be replayed: ${unsafe
        .map((fixture) => fixture.id)
        .join(", ")}`,
    );
  }
}

export function summarizeRustGatewayParityFixtures(
  fixtures: RustGatewayParityFixture[] = RUST_GATEWAY_INITIAL_PARITY_FIXTURES,
): RustGatewayParitySummary {
  return fixtures.reduce<RustGatewayParitySummary>(
    (summary, fixture) => {
      summary.total += 1;
      if (fixture.safety === "unsafe" || fixture.expectedParity === "unsafe") {
        summary.unsafe += 1;
      } else {
        summary.replayable += 1;
      }
      if (fixture.expectedParity === "exact") {
        summary.exact += 1;
      } else if (fixture.expectedParity === "schema-compatible") {
        summary.schemaCompatible += 1;
      } else if (fixture.expectedParity === "mock-compatible") {
        summary.mockCompatible += 1;
      } else if (fixture.expectedParity === "unsupported") {
        summary.unsupported += 1;
      }
      return summary;
    },
    {
      total: 0,
      replayable: 0,
      unsafe: 0,
      exact: 0,
      schemaCompatible: 0,
      mockCompatible: 0,
      unsupported: 0,
    },
  );
}

export function renderRustGatewayParityFixtureMarkdown(
  fixtures: RustGatewayParityFixture[] = RUST_GATEWAY_INITIAL_PARITY_FIXTURES,
): string {
  const rows = fixtures.map((fixture) =>
    [
      fixture.id,
      fixture.method,
      fixture.surface,
      fixture.safety,
      fixture.expectedParity,
      fixture.reason.replaceAll("|", "\\|"),
    ].join(" | "),
  );
  return [
    "| Fixture | Method | Surface | Safety | Expected Rust Parity | Reason |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
}
