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

  it("summarizes fixture readiness by parity label", () => {
    const summary = summarizeRustGatewayParityFixtures();

    expect(summary.total).toBe(RUST_GATEWAY_INITIAL_PARITY_FIXTURES.length);
    expect(summary.schemaCompatible).toBeGreaterThan(0);
    expect(summary.mockCompatible).toBeGreaterThan(0);
    expect(summary.unsupported).toBeGreaterThan(0);
    expect(summary.unsafe).toBeGreaterThan(0);
    expect(summary.replayable + summary.unsafe).toBe(summary.total);
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
