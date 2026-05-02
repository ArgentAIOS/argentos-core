import { describe, expect, it } from "vitest";
import {
  assertNoUnsafeRustGatewayReplayFixtures,
  getRustGatewayReplayableFixtures,
  renderRustGatewayParityFixtureMarkdown,
  RUST_GATEWAY_INITIAL_PARITY_FIXTURES,
  summarizeRustGatewayParityFixtures,
  type RustGatewayParityFixture,
} from "./rust-gateway-parity-fixtures.js";

describe("rust gateway parity fixtures", () => {
  it("keeps initial replay fixtures free of unsafe live side effects", () => {
    const replayable = getRustGatewayReplayableFixtures();

    expect(replayable.length).toBeGreaterThan(0);
    expect(replayable.every((fixture) => fixture.safety !== "unsafe")).toBe(true);
    expect(replayable.every((fixture) => fixture.expectedParity !== "unsafe")).toBe(true);
    assertNoUnsafeRustGatewayReplayFixtures(replayable);
  });

  it("marks mutating live surfaces as unsafe until isolated canary gates exist", () => {
    const unsafeMethods = RUST_GATEWAY_INITIAL_PARITY_FIXTURES.filter(
      (fixture) => fixture.safety === "unsafe",
    ).map((fixture) => fixture.method);

    expect(unsafeMethods).toContain("chat.send");
    expect(unsafeMethods).toContain("cron.add");
    expect(unsafeMethods).toContain("workflows.run");
  });

  it("includes failed-auth fixtures without storing real operator tokens", () => {
    const connectFixtures = RUST_GATEWAY_INITIAL_PARITY_FIXTURES.filter((fixture) =>
      fixture.id.startsWith("connect-"),
    );

    expect(connectFixtures.map((fixture) => fixture.id)).toEqual([
      "connect-v3-token",
      "connect-missing-token",
      "connect-wrong-token",
    ]);
    expect(connectFixtures.every((fixture) => fixture.safety === "read-only")).toBe(true);
    expect(connectFixtures.map((fixture) => fixture.authTokenOverride)).toEqual([
      undefined,
      null,
      "rust-gateway-parity-wrong-token",
    ]);
    expect(connectFixtures[0]?.requiredMethods).toEqual(
      expect.arrayContaining(["health", "status", "commands.list", "sessions.list"]),
    );
    expect(connectFixtures.map((fixture) => fixture.redactionProbes ?? [])).toEqual([
      [],
      [],
      ["rust-gateway-parity-wrong-token"],
    ]);
    expect(JSON.stringify(connectFixtures)).not.toContain("ARGENT_GATEWAY_TOKEN");
  });

  it("summarizes fixture readiness by parity label", () => {
    const summary = summarizeRustGatewayParityFixtures();

    expect(summary.total).toBe(RUST_GATEWAY_INITIAL_PARITY_FIXTURES.length);
    expect(summary.schemaCompatible).toBeGreaterThan(0);
    expect(summary.mockCompatible).toBeGreaterThan(0);
    expect(summary.unsupported).toBeGreaterThan(0);
    expect(summary.unsafe).toBeGreaterThan(0);
    expect(summary.replayable + summary.unsafe).toBe(summary.total);
  });

  it("promotes read-only status, commands, channels, models, sessions, timers, and node surfaces to schema-compatible evidence", () => {
    const fixtures = Object.fromEntries(
      RUST_GATEWAY_INITIAL_PARITY_FIXTURES.map((fixture) => [fixture.id, fixture]),
    );

    expect(fixtures["rpc-status"]).toMatchObject({
      method: "status",
      safety: "read-only",
      expectedParity: "schema-compatible",
    });
    expect(fixtures["rpc-commands-list"]).toMatchObject({
      method: "commands.list",
      safety: "read-only",
      expectedParity: "schema-compatible",
    });
    expect(fixtures["rpc-channels-status"]).toMatchObject({
      method: "channels.status",
      safety: "read-only",
      expectedParity: "schema-compatible",
    });
    expect(fixtures["rpc-models-list"]).toMatchObject({
      method: "models.list",
      safety: "read-only",
      expectedParity: "schema-compatible",
    });
    expect(fixtures["rpc-sessions-list"]).toMatchObject({
      method: "sessions.list",
      safety: "read-only",
      expectedParity: "schema-compatible",
    });
    expect(fixtures["rpc-cron-status"]).toMatchObject({
      method: "cron.status",
      safety: "read-only",
      expectedParity: "schema-compatible",
    });
    expect(fixtures["rpc-cron-list"]).toMatchObject({
      method: "cron.list",
      safety: "read-only",
      expectedParity: "schema-compatible",
    });
    expect(fixtures["rpc-node-list"]).toMatchObject({
      method: "node.list",
      safety: "read-only",
      expectedParity: "schema-compatible",
    });
  });

  it("refuses to replay unsafe fixtures", () => {
    const unsafe: RustGatewayParityFixture[] = [
      {
        id: "unsafe-test",
        surface: "agent-run",
        method: "send",
        safety: "unsafe",
        expectedParity: "unsafe",
        reason: "test fixture",
      },
    ];

    expect(() => assertNoUnsafeRustGatewayReplayFixtures(unsafe)).toThrow(/unsafe-test/);
  });

  it("renders a markdown fixture table for ops handoffs", () => {
    const markdown = renderRustGatewayParityFixtureMarkdown([
      RUST_GATEWAY_INITIAL_PARITY_FIXTURES[0],
    ]);

    expect(markdown).toContain("| Fixture | Method | Surface | Safety | Expected Rust Parity |");
    expect(markdown).toContain("connect-v3-token");
  });
});
