import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateIntentSimulationGateForConfig } from "./intent-runtime-gate.js";

const TEMP_DIRS: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
}

afterEach(async () => {
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop();
    if (!dir) {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("evaluateIntentSimulationGateForConfig", () => {
  it("returns disabled when simulation gate is off", async () => {
    const result = await evaluateIntentSimulationGateForConfig({
      intent: {
        enabled: true,
        simulationGate: {
          enabled: false,
        },
      },
    });
    expect(result.evaluation.enabled).toBe(false);
    expect(result.evaluation.blocking).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("loads suites from workspace-relative report path", async () => {
    const workspaceDir = await makeTempDir("argent-intent-gate-");
    const reportPath = path.join(workspaceDir, "intent-report.json");
    await fs.writeFile(
      reportPath,
      JSON.stringify({
        suites: [
          {
            suiteId: "support-baseline",
            passRate: 0.92,
            componentScores: {
              objectiveAdherence: 0.9,
              boundaryCompliance: 0.95,
              escalationCorrectness: 0.9,
              outcomeQuality: 0.85,
            },
          },
        ],
      }),
      "utf8",
    );

    const result = await evaluateIntentSimulationGateForConfig({
      workspaceDir,
      intent: {
        enabled: true,
        simulationGate: {
          enabled: true,
          mode: "enforce",
          suites: ["support-baseline"],
          minPassRate: 0.8,
          reportPath: "intent-report.json",
        },
      },
    });

    expect(result.reportPath).toBe(reportPath);
    expect(result.warnings).toEqual([]);
    expect(result.evaluation.enabled).toBe(true);
    expect(result.evaluation.blocking).toBe(false);
    expect(result.evaluation.reasons).toEqual([]);
    expect(result.evaluation.overallPassRate).toBeCloseTo(0.92, 6);
  });

  it("surfaces report parse failures but does not block when no suites loaded", async () => {
    const workspaceDir = await makeTempDir("argent-intent-gate-");
    const reportPath = path.join(workspaceDir, "intent-report.json");
    await fs.writeFile(reportPath, "{ invalid json ", "utf8");

    const result = await evaluateIntentSimulationGateForConfig({
      workspaceDir,
      intent: {
        enabled: true,
        simulationGate: {
          enabled: true,
          mode: "enforce",
          suites: ["support-baseline"],
          minPassRate: 0.9,
          reportPath: "intent-report.json",
        },
      },
    });

    expect(
      result.warnings.some((warning) =>
        warning.includes("Failed to load intent simulation report"),
      ),
    ).toBe(true);
    expect(result.evaluation.enabled).toBe(true);
    // When no suite results exist at all (report missing/invalid),
    // enforce mode degrades to warn — blocking requires actual data.
    expect(result.evaluation.blocking).toBe(false);
    expect(
      result.evaluation.reasons.some((reason) =>
        reason.includes("Missing required simulation suite"),
      ),
    ).toBe(true);
  });
});
