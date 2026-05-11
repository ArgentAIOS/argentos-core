import { describe, expect, it } from "vitest";
import {
  analyzeRustGatewayShadowDuplicateObservations,
  RUST_GATEWAY_SHADOW_DUPLICATE_PROOF_FIXTURE,
  type RustGatewayShadowObservation,
} from "./rust-gateway-shadow-duplicates.js";

describe("analyzeRustGatewayShadowDuplicateObservations", () => {
  it("passes the synthetic proof when Rust only mirrors Node live observations", () => {
    const proof = analyzeRustGatewayShadowDuplicateObservations(
      RUST_GATEWAY_SHADOW_DUPLICATE_PROOF_FIXTURE,
    );

    expect(proof.status).toBe("passed");
    expect(proof.coveredSurfaces).toEqual(["channel", "run", "session", "timer", "workflow"]);
    expect(proof.missingSurfaces).toEqual([]);
    expect(proof.conflicts).toEqual([]);
    expect(proof.policy).toMatchObject({
      nodeRemainsLiveAuthority: true,
      rustMayOnlyObserve: true,
      duplicateLiveAuthorityBlocksPromotion: true,
      duplicateRustShadowObservationBlocksPromotion: true,
    });
  });

  it("blocks when Rust takes an action instead of observing", () => {
    const observations: RustGatewayShadowObservation[] = [
      { surface: "timer", id: "timer-1", role: "node-live", action: "schedule", observedAtMs: 1 },
      { surface: "timer", id: "timer-1", role: "rust-shadow", action: "schedule", observedAtMs: 2 },
    ];

    const proof = analyzeRustGatewayShadowDuplicateObservations(observations, ["timer"]);

    expect(proof.status).toBe("blocked");
    expect(proof.conflicts).toContainEqual(
      expect.objectContaining({
        key: "timer:timer-1",
        reason: "rust-non-observation-action",
      }),
    );
  });

  it("blocks repeated Rust shadow observations for the same live key", () => {
    const observations: RustGatewayShadowObservation[] = [
      { surface: "run", id: "run-1", role: "node-live", action: "execute", observedAtMs: 1 },
      { surface: "run", id: "run-1", role: "rust-shadow", action: "observe", observedAtMs: 2 },
      { surface: "run", id: "run-1", role: "rust-shadow", action: "observe", observedAtMs: 3 },
    ];

    const proof = analyzeRustGatewayShadowDuplicateObservations(observations, ["run"]);

    expect(proof.status).toBe("blocked");
    expect(proof.conflicts).toContainEqual(
      expect.objectContaining({
        key: "run:run-1",
        reason: "duplicate-rust-shadow-observation",
        count: 2,
      }),
    );
  });

  it("blocks missing surface coverage", () => {
    const proof = analyzeRustGatewayShadowDuplicateObservations([], ["workflow", "session"]);

    expect(proof.status).toBe("blocked");
    expect(proof.missingSurfaces).toEqual(["workflow", "session"]);
  });
});
