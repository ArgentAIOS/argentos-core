import { describe, expect, it } from "vitest";
import { clearWorkReport, createWorkReportTool, takeWorkReport } from "./work-report-tool.js";

async function fileReport(runId: string, params: Record<string, unknown>) {
  const tool = createWorkReportTool({ runId });
  return tool.execute("call-1", params, undefined, undefined);
}

describe("work_report tool (v2 D5)", () => {
  it("files a report the runner can take exactly once by run id", async () => {
    await fileReport("run-take-once", {
      outcome: "done",
      summary: "Triaged 6 tickets; drafts attached.",
      evidence: ["6 tickets", "ticket-123"],
    });

    const report = takeWorkReport("run-take-once");
    expect(report?.outcome).toBe("done");
    expect(report?.summary).toContain("Triaged 6 tickets");
    expect(report?.evidence).toEqual(["6 tickets", "ticket-123"]);
    // take() clears — a second take returns nothing (stale reports can't
    // complete a later attempt).
    expect(takeWorkReport("run-take-once")).toBeUndefined();
  });

  it("records blocked and need_input outcomes verbatim", async () => {
    await fileReport("run-blocked", { outcome: "blocked", summary: "VPN creds missing" });
    await fileReport("run-input", { outcome: "need_input", summary: "Which client first?" });
    expect(takeWorkReport("run-blocked")?.outcome).toBe("blocked");
    expect(takeWorkReport("run-input")?.outcome).toBe("need_input");
  });

  it("clearWorkReport drops a stale report before dispatch", async () => {
    await fileReport("run-stale", { outcome: "done", summary: "old attempt" });
    clearWorkReport("run-stale");
    expect(takeWorkReport("run-stale")).toBeUndefined();
  });

  it("sanitizes evidence to non-empty strings", async () => {
    await fileReport("run-evidence", {
      outcome: "done",
      summary: "ok",
      evidence: ["real", "", 42, "  trimmed  "],
    });
    expect(takeWorkReport("run-evidence")?.evidence).toEqual(["real", "trimmed"]);
  });

  it("keeps the last report when filed twice in one run", async () => {
    await fileReport("run-twice", { outcome: "blocked", summary: "first" });
    await fileReport("run-twice", { outcome: "done", summary: "second" });
    const report = takeWorkReport("run-twice");
    expect(report?.outcome).toBe("done");
    expect(report?.summary).toBe("second");
  });

  it("caps unconsumed reports so non-worker filings age out", async () => {
    for (let i = 0; i < 60; i += 1) {
      await fileReport(`run-cap-${i}`, { outcome: "done", summary: `r${i}` });
    }
    expect(takeWorkReport("run-cap-0")).toBeUndefined();
    expect(takeWorkReport("run-cap-59")?.summary).toBe("r59");
  });
});
