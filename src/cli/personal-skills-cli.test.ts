import { describe, expect, it } from "vitest";
import { formatPersonalSkillsPurgeResult } from "./personal-skills-cli.js";

describe("formatPersonalSkillsPurgeResult", () => {
  it("renders a JSON envelope when --json is requested", () => {
    const out = formatPersonalSkillsPurgeResult(
      {
        scanned: 23,
        matched: [
          {
            id: "p1",
            title: "operator correction: [AUDIO_ENABLED] noise",
            previousState: "incubating",
            usageCount: 8662,
            successCount: 8500,
            failureCount: 12,
          },
        ],
        archived: 1,
        dryRun: false,
      },
      { kind: "audio-transcript", json: true },
    );
    const parsed = JSON.parse(out);
    expect(parsed.kind).toBe("audio-transcript");
    expect(parsed.archived).toBe(1);
    expect(parsed.matched[0]?.id).toBe("p1");
  });

  it("renders a human-readable summary in non-JSON mode and includes per-row counts", () => {
    const out = formatPersonalSkillsPurgeResult(
      {
        scanned: 23,
        matched: [
          {
            id: "p1",
            title:
              "operator correction: [AUDIO_ENABLED] so you didn't actually use the marketplace tool",
            previousState: "incubating",
            usageCount: 8662,
            successCount: 8500,
            failureCount: 12,
          },
          {
            id: "p2",
            title: "operator correction: did you actually verify?",
            previousState: "candidate",
            usageCount: 4140,
            successCount: 4000,
            failureCount: 5,
          },
        ],
        archived: 2,
        dryRun: false,
      },
      { kind: "audio-transcript" },
    );
    expect(out).toContain("Personal Skills purge (kind=audio-transcript)");
    expect(out).toContain("Scanned: 23");
    expect(out).toContain("Matched: 2 polluted row(s)");
    expect(out).toContain("p1");
    expect(out).toContain("usage=8662");
    expect(out).toContain("Archived 2 row(s)");
    expect(out).toContain("state -> deprecated");
  });

  it("renders dry-run mode with a 'Would archive' verb and a reminder to re-run", () => {
    const out = formatPersonalSkillsPurgeResult(
      {
        scanned: 23,
        matched: [
          {
            id: "p1",
            title: "operator correction: [AUDIO_ENABLED] noise",
            previousState: "incubating",
            usageCount: 1,
            successCount: 0,
            failureCount: 0,
          },
        ],
        archived: 0,
        dryRun: true,
      },
      { kind: "audio-transcript" },
    );
    expect(out).toContain("dry-run");
    expect(out).toContain("Would archive 0 row(s)");
    expect(out).toContain("Re-run without --dry-run");
  });

  it("renders the empty-match case with a friendly nothing-to-do message", () => {
    const out = formatPersonalSkillsPurgeResult(
      { scanned: 18, matched: [], archived: 0, dryRun: false },
      { kind: "audio-transcript" },
    );
    expect(out).toContain("Scanned: 18");
    expect(out).toContain("Nothing to clean up");
  });
});
