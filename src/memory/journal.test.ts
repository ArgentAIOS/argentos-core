import { describe, expect, it } from "vitest";
import { __testing } from "./journal.js";

describe("memory journal extraction gating", () => {
  it("restricts heartbeat extraction to low-fanout memory types", () => {
    expect(__testing.getJournalExtractionMemoryTypes("heartbeat")).toEqual(["event", "knowledge"]);
  });

  it("restricts cron extraction to low-fanout memory types", () => {
    expect(__testing.getJournalExtractionMemoryTypes("cron")).toEqual(["event", "knowledge"]);
  });

  it("skips low-value successful cron journal events", () => {
    expect(
      __testing.shouldCaptureCronJournalEvent({
        jobId: "vip-email",
        action: "finished",
        status: "ok",
        summary: "VIP email scan: no new VIP emails",
      }),
    ).toBe(false);
    expect(
      __testing.shouldCaptureCronJournalEvent({
        jobId: "vip-email",
        action: "finished",
        status: "ok",
        summary: 'The Cron job "ba83" has a status of ok',
      }),
    ).toBe(false);
  });

  it("captures meaningful or failing cron journal events", () => {
    expect(
      __testing.shouldCaptureCronJournalEvent({
        jobId: "vip-email",
        action: "finished",
        status: "ok",
        summary: "VIP email scan: 2 new VIP emails; alerts sent to 1 route",
      }),
    ).toBe(true);
    expect(
      __testing.shouldCaptureCronJournalEvent({
        jobId: "vip-email",
        action: "finished",
        status: "error",
        error: "SMTP auth failed",
      }),
    ).toBe(true);
  });
});
