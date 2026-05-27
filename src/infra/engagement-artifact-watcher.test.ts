import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { artifactSurfaceId, scanArtifactsForEngagement } from "./engagement-artifact-watcher.js";
import { recordEngagement, recordSurfaceEmitted } from "./engagement-tracker.js";

describe("engagement-artifact-watcher", () => {
  let tmpDir: string;
  let artifactLedgerPath: string;
  let engagementLedgerPath: string;
  let artifactsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-watcher-test-"));
    artifactLedgerPath = path.join(tmpDir, "artifact-ledger.jsonl");
    engagementLedgerPath = path.join(tmpDir, "engagement-ledger.jsonl");
    artifactsDir = path.join(tmpDir, "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  function writeArtifact(
    artifactPath: string,
    contents: string,
    opts?: { mtimeMsAgo?: number; atimeMsAgo?: number },
  ): void {
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, contents, "utf-8");
    if (opts) {
      const now = Date.now();
      const mtime = new Date(now - (opts.mtimeMsAgo ?? 0));
      const atime = new Date(now - (opts.atimeMsAgo ?? opts.mtimeMsAgo ?? 0));
      fs.utimesSync(artifactPath, atime, mtime);
    }
  }

  function appendArtifactLedger(entry: Record<string, unknown>): void {
    fs.appendFileSync(artifactLedgerPath, JSON.stringify(entry) + "\n", "utf-8");
  }

  it("returns zero counts when no artifact ledger exists", () => {
    const result = scanArtifactsForEngagement({
      artifactLedgerPath: path.join(tmpDir, "nonexistent.jsonl"),
      engagementLedgerPath,
      agentId: "argent",
    });
    expect(result).toEqual({ scannedArtifacts: 0, newEmissions: 0, newActed: 0 });
  });

  it("emits surface_emitted on first scan for every artifact in the ledger", () => {
    const a1 = path.join(artifactsDir, "a1.md");
    const a2 = path.join(artifactsDir, "a2.md");
    writeArtifact(a1, "artifact 1");
    writeArtifact(a2, "artifact 2");
    appendArtifactLedger({ ts: "2026-05-24T12:00:00Z", artifactPath: a1, workTitle: "thing 1" });
    appendArtifactLedger({ ts: "2026-05-24T12:01:00Z", artifactPath: a2, workTitle: "thing 2" });

    const result = scanArtifactsForEngagement({
      artifactLedgerPath,
      engagementLedgerPath,
      agentId: "argent",
    });

    expect(result.scannedArtifacts).toBe(2);
    expect(result.newEmissions).toBe(2);
    // mtime ≈ atime for just-written files → no "acted" outcome yet.
    expect(result.newActed).toBe(0);

    const ledgerLines = fs
      .readFileSync(engagementLedgerPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; surfaceId: string });
    const emitted = ledgerLines.filter((e) => e.type === "surface_emitted");
    expect(emitted).toHaveLength(2);
  });

  it("does not re-emit surface_emitted on subsequent scans of the same artifact", () => {
    const a1 = path.join(artifactsDir, "a1.md");
    writeArtifact(a1, "artifact 1");
    appendArtifactLedger({ ts: "2026-05-24T12:00:00Z", artifactPath: a1, workTitle: "thing 1" });

    scanArtifactsForEngagement({ artifactLedgerPath, engagementLedgerPath, agentId: "argent" });
    const second = scanArtifactsForEngagement({
      artifactLedgerPath,
      engagementLedgerPath,
      agentId: "argent",
    });

    expect(second.newEmissions).toBe(0);
  });

  it("records 'acted' when atime is meaningfully later than mtime", () => {
    const a1 = path.join(artifactsDir, "a1.md");
    writeArtifact(a1, "artifact 1", { mtimeMsAgo: 60_000, atimeMsAgo: 10_000 });
    appendArtifactLedger({ ts: "2026-05-24T12:00:00Z", artifactPath: a1, workTitle: "thing 1" });

    const result = scanArtifactsForEngagement({
      artifactLedgerPath,
      engagementLedgerPath,
      agentId: "argent",
    });
    expect(result.newActed).toBe(1);

    const ledgerLines = fs
      .readFileSync(engagementLedgerPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const actedOutcomes = ledgerLines.filter((e) => e.type === "outcome" && e.outcome === "acted");
    expect(actedOutcomes).toHaveLength(1);
    expect((actedOutcomes[0] as { source?: string }).source).toBe("artifact_file_open");
  });

  it("does NOT record 'acted' when atime is within the 1-second threshold of mtime", () => {
    const a1 = path.join(artifactsDir, "a1.md");
    // mtime and atime both 60s ago — same instant. Below threshold → no acted.
    writeArtifact(a1, "artifact 1", { mtimeMsAgo: 60_000, atimeMsAgo: 60_000 });
    appendArtifactLedger({ ts: "2026-05-24T12:00:00Z", artifactPath: a1, workTitle: "thing 1" });

    const result = scanArtifactsForEngagement({
      artifactLedgerPath,
      engagementLedgerPath,
      agentId: "argent",
    });
    expect(result.newActed).toBe(0);
  });

  it("does not double-record 'acted' for a surface that already has one", () => {
    const a1 = path.join(artifactsDir, "a1.md");
    writeArtifact(a1, "artifact 1", { mtimeMsAgo: 60_000, atimeMsAgo: 10_000 });
    appendArtifactLedger({ ts: "2026-05-24T12:00:00Z", artifactPath: a1, workTitle: "thing 1" });

    // Pre-seed an acted outcome for this surface.
    const surfaceId = artifactSurfaceId("argent", a1, "2026-05-24T12:00:00Z");
    recordSurfaceEmitted({
      ledgerPath: engagementLedgerPath,
      surfaceId,
      agentId: "argent",
      ts: "2026-05-24T12:00:00Z",
    });
    recordEngagement({
      ledgerPath: engagementLedgerPath,
      surfaceId,
      outcome: "acted",
      source: "dashboard_click",
      ts: "2026-05-24T12:01:00Z",
    });

    const result = scanArtifactsForEngagement({
      artifactLedgerPath,
      engagementLedgerPath,
      agentId: "argent",
    });
    expect(result.newActed).toBe(0);
  });

  it("skips deleted artifact files without crashing", () => {
    const missing = path.join(artifactsDir, "deleted.md");
    appendArtifactLedger({ ts: "2026-05-24T12:00:00Z", artifactPath: missing, workTitle: "gone" });
    const result = scanArtifactsForEngagement({
      artifactLedgerPath,
      engagementLedgerPath,
      agentId: "argent",
    });
    expect(result.scannedArtifacts).toBe(1);
    expect(result.newEmissions).toBe(1); // still emitted for the surface
    expect(result.newActed).toBe(0); // can't stat the file
  });
});
