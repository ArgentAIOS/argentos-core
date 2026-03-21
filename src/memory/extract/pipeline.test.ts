import { describe, expect, it } from "vitest";
import type { ExtractedFact } from "../memu-types.js";
import { __testing } from "./pipeline.js";

describe("operational journal fact filtering", () => {
  it("drops low-value cron facts from cron journal resources", () => {
    const facts: ExtractedFact[] = [
      {
        memoryType: "event",
        summary: 'The Cron job "ba83" has a status of ok',
        categoryNames: [],
      },
      {
        memoryType: "knowledge",
        summary:
          "The VIP Email Check Cron job is active and connected to the Atera RMM/PSA platform",
        categoryNames: [],
      },
      {
        memoryType: "event",
        summary: "VIP email scan: 2 new VIP emails; alerts sent to 1 route",
        categoryNames: [],
      },
      {
        memoryType: "knowledge",
        summary: "Cron job action: VIP Email Check via vip_email with action='check_pending'",
        categoryNames: [],
      },
    ];

    const filtered = __testing.filterOperationalJournalFacts({
      facts,
      resourceText: `Cron job "vip-email" finished at 2026-03-14T19:00:00Z\nStatus: ok\nSummary: VIP email scan: no new VIP emails`,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.summary).toContain("2 new VIP emails");
  });

  it("does not filter non-cron resource facts", () => {
    const facts: ExtractedFact[] = [
      {
        memoryType: "knowledge",
        summary: "Cloudflare manages DNS for the client website",
        categoryNames: [],
      },
    ];

    const filtered = __testing.filterOperationalJournalFacts({
      facts,
      resourceText: "Project note: Cloudflare manages DNS for the client website",
    });

    expect(filtered).toEqual(facts);
  });
});
