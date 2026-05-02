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
    expectedParity: "mock-compatible",
    reason: "Rust has no channel adapter authority; fixture only checks response envelope shape.",
  },
  {
    id: "rpc-connectors-catalog",
    surface: "catalog",
    method: "connectors.catalog",
    params: {},
    timeoutMs: 10_000,
    safety: "read-only",
    expectedParity: "mock-compatible",
    reason:
      "Rust does not discover live AOS manifests yet; fixture guards catalog envelope shape only.",
  },
  {
    id: "rpc-sessions-list",
    surface: "sessions",
    method: "sessions.list",
    params: {},
    safety: "read-only",
    expectedParity: "mock-compatible",
    reason: "Rust must not own live session state before migration; fixture is shape-only.",
  },
  {
    id: "rpc-cron-status",
    surface: "timers",
    method: "cron.status",
    params: {},
    safety: "read-only",
    expectedParity: "mock-compatible",
    reason: "Rust must not own timers yet; fixture is shape-only and does not execute schedules.",
  },
  {
    id: "rpc-cron-list",
    surface: "timers",
    method: "cron.list",
    params: {},
    safety: "read-only",
    expectedParity: "mock-compatible",
    reason: "Rust must not own schedules yet; fixture is shape-only and does not list live timers.",
  },
  {
    id: "rpc-node-list",
    surface: "nodes",
    method: "node.list",
    params: {},
    safety: "read-only",
    expectedParity: "mock-compatible",
    reason:
      "Rust reports synthetic node presence; fixture is shape-only until node registry parity exists.",
  },
  {
    id: "rpc-tools-status",
    surface: "tools",
    method: "tools.status",
    params: {},
    safety: "read-only",
    expectedParity: "mock-compatible",
    reason: "Rust has no dynamic tool/plugin registry yet; fixture is shape-only.",
  },
  {
    id: "rpc-workflows-list",
    surface: "workflows",
    method: "workflows.list",
    params: {},
    safety: "read-only",
    expectedParity: "unsupported",
    reason: "Rust gateway does not implement workflow authority or workflow read APIs yet.",
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
