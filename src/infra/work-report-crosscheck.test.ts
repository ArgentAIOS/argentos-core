import { describe, expect, it } from "vitest";
import {
  crossCheckWorkReport,
  detectSimulationViolation,
  grantsAreWriteCapable,
  isExternalArtifactTool,
  isStaleWorkReport,
} from "./work-report-crosscheck.js";

describe("write-capability classification", () => {
  it("flags external-artifact tools as write-capable", () => {
    expect(isExternalArtifactTool("message")).toBe(true);
    expect(isExternalArtifactTool("web_fetch")).toBe(true);
    expect(isExternalArtifactTool("tasks")).toBe(false);
    expect(isExternalArtifactTool("memory_recall")).toBe(false);
  });

  it("grantsAreWriteCapable is true iff any grant is write-capable", () => {
    expect(grantsAreWriteCapable(["tasks", "memory_recall", "work_report"])).toBe(false);
    expect(grantsAreWriteCapable(["tasks", "message"])).toBe(true);
    expect(grantsAreWriteCapable([])).toBe(false);
  });
});

describe("crossCheckWorkReport (telemetry cross-check)", () => {
  const base = {
    outcome: "done" as const,
    isLiveMode: true,
    grantsWriteCapable: true,
    externalToolCount: 0,
  };

  it("rejects done on a live write-capable role with zero external tools", () => {
    const result = crossCheckWorkReport(base);
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toBe("report_telemetry_mismatch");
  });

  it("accepts done when external tools were executed", () => {
    expect(crossCheckWorkReport({ ...base, externalToolCount: 2 }).accepted).toBe(true);
  });

  it("accepts done on a read-only role (not write-capable) — no false reject", () => {
    // The conductor triage demo: done with zero external writes is legitimate.
    expect(crossCheckWorkReport({ ...base, grantsWriteCapable: false }).accepted).toBe(true);
  });

  it("accepts done in simulate mode (cross-check is live-only)", () => {
    expect(crossCheckWorkReport({ ...base, isLiveMode: false }).accepted).toBe(true);
  });

  it("accepts non-done outcomes regardless", () => {
    expect(crossCheckWorkReport({ ...base, outcome: "blocked" }).accepted).toBe(true);
    expect(crossCheckWorkReport({ ...base, outcome: "need_input" }).accepted).toBe(true);
  });
});

describe("isStaleWorkReport (late-report guard)", () => {
  const RUN = "worker-relay-task1-123";

  it("not stale when the run still holds the claim and the task is live", () => {
    expect(
      isStaleWorkReport({
        currentTask: { status: "in_progress", claimedBy: RUN },
        workerRunId: RUN,
      }),
    ).toBe(false);
  });

  it("stale when the task was cancelled (superseded by runNow fresh)", () => {
    expect(
      isStaleWorkReport({ currentTask: { status: "cancelled", claimedBy: RUN }, workerRunId: RUN }),
    ).toBe(true);
  });

  it("stale when the claim was reassigned to another run (lease takeover)", () => {
    expect(
      isStaleWorkReport({
        currentTask: { status: "in_progress", claimedBy: "worker-other-task1-999" },
        workerRunId: RUN,
      }),
    ).toBe(true);
  });

  it("stale when the task is gone", () => {
    expect(isStaleWorkReport({ currentTask: null, workerRunId: RUN })).toBe(true);
  });
});

describe("detectSimulationViolation (D9 × simulate tripwire)", () => {
  it("stubbed calls (proposed_action recorded) are NOT a violation", () => {
    const result = detectSimulationViolation({
      simulateMode: true,
      externalToolsExecuted: ["doc_panel"],
      proposedActions: [{ tool: "doc_panel" }],
    });
    expect(result.violation).toBe(false);
    expect(result.escapedTools).toEqual([]);
  });

  it("a tool that escaped the stub IS a violation, named precisely", () => {
    const result = detectSimulationViolation({
      simulateMode: true,
      externalToolsExecuted: ["doc_panel", "message"],
      proposedActions: [{ tool: "doc_panel" }],
    });
    expect(result.violation).toBe(true);
    expect(result.escapedTools).toEqual(["message"]);
  });

  it("live mode never trips this wire", () => {
    const result = detectSimulationViolation({
      simulateMode: false,
      externalToolsExecuted: ["message"],
      proposedActions: [],
    });
    expect(result.violation).toBe(false);
  });

  it("no external executions → no violation", () => {
    expect(
      detectSimulationViolation({
        simulateMode: true,
        externalToolsExecuted: [],
        proposedActions: [],
      }).violation,
    ).toBe(false);
  });
});
