import { afterEach, describe, expect, it } from "vitest";
import {
  detectHeartbeatStaleness,
  evaluateCriticalServiceSignals,
  resetCriticalServiceTrackerForTest,
} from "./critical-observability.js";

describe("critical observability alerts", () => {
  afterEach(() => {
    resetCriticalServiceTrackerForTest();
  });

  it("generates critical service-down alerts with remediation commands", () => {
    const alerts = evaluateCriticalServiceSignals([
      {
        service: "postgres",
        healthy: false,
        severity: "critical",
        statusWhenFailing: "down",
        messageWhenFailing: "PostgreSQL is unreachable while configured as active storage backend.",
        operatorCommand: "bash scripts/setup-postgres.sh",
        detail: "connect ECONNREFUSED 127.0.0.1:5433",
        observedAtIso: "2026-03-06T00:00:00.000Z",
      },
    ]);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.service).toBe("postgres");
    expect(alerts[0]?.severity).toBe("critical");
    expect(alerts[0]?.operatorCommand).toBe("bash scripts/setup-postgres.sh");
    expect(alerts[0]?.lastSeenAt).toBe("2026-03-06T00:00:00.000Z");
  });

  it("detects stale heartbeat cycles against threshold", () => {
    const nowMs = Date.UTC(2026, 2, 6, 12, 0, 0);
    const stale = detectHeartbeatStaleness({
      lastCycleAtMs: nowMs - 30 * 60 * 60 * 1000,
      nowMs,
    });
    expect(stale.stale).toBe(true);
    expect(stale.staleHours).toBe(30);
    expect(stale.staleThresholdHours).toBe(24);
  });

  it("emits no critical alerts in healthy state (no false positives)", () => {
    const alerts = evaluateCriticalServiceSignals([
      {
        service: "postgres",
        healthy: true,
        severity: "critical",
        statusWhenFailing: "down",
        messageWhenFailing: "unused",
        operatorCommand: "bash scripts/setup-postgres.sh",
        observedAtIso: "2026-03-06T00:00:00.000Z",
      },
      {
        service: "gateway-auth-config",
        healthy: true,
        severity: "critical",
        statusWhenFailing: "invalid_config",
        messageWhenFailing: "unused",
        operatorCommand: "argent configure gateway-auth",
        observedAtIso: "2026-03-06T00:00:00.000Z",
      },
      {
        service: "heartbeat-runner",
        healthy: true,
        severity: "critical",
        statusWhenFailing: "stale",
        messageWhenFailing: "unused",
        operatorCommand: "argent system heartbeat recompute-score",
        observedAtIso: "2026-03-06T00:00:00.000Z",
      },
    ]);

    expect(alerts).toEqual([]);
  });
});
