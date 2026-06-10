import fs from "node:fs/promises";
import path from "node:path";
import type { IntentConfig, IntentSimulationSuiteResult } from "../config/types.js";
import {
  evaluateIntentSimulationGate,
  type IntentSimulationGateEvaluation,
} from "./intent-simulation.js";

type IntentSimulationReportShape = {
  suites?: unknown;
};

export type IntentRuntimeGateEvaluation = {
  evaluation: IntentSimulationGateEvaluation;
  warnings: string[];
  reportPath?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function parseSuite(
  raw: unknown,
  index: number,
  warnings: string[],
): IntentSimulationSuiteResult | null {
  if (!isRecord(raw)) {
    warnings.push(`Ignoring suite at index ${index}: expected object.`);
    return null;
  }

  const suiteIdRaw = raw.suiteId;
  const suiteId = typeof suiteIdRaw === "string" ? suiteIdRaw.trim() : "";
  if (!suiteId) {
    warnings.push(`Ignoring suite at index ${index}: missing suiteId.`);
    return null;
  }

  const passRate = parseNumber(raw.passRate);
  if (passRate === undefined) {
    warnings.push(`Ignoring suite "${suiteId}": passRate must be a finite number.`);
    return null;
  }

  const componentScoresRaw = raw.componentScores;
  if (!isRecord(componentScoresRaw)) {
    warnings.push(`Ignoring suite "${suiteId}": componentScores must be an object.`);
    return null;
  }

  const objectiveAdherence = parseNumber(componentScoresRaw.objectiveAdherence);
  const boundaryCompliance = parseNumber(componentScoresRaw.boundaryCompliance);
  const escalationCorrectness = parseNumber(componentScoresRaw.escalationCorrectness);
  const outcomeQuality = parseNumber(componentScoresRaw.outcomeQuality);
  if (
    objectiveAdherence === undefined ||
    boundaryCompliance === undefined ||
    escalationCorrectness === undefined ||
    outcomeQuality === undefined
  ) {
    warnings.push(
      `Ignoring suite "${suiteId}": componentScores must include numeric objectiveAdherence, boundaryCompliance, escalationCorrectness, and outcomeQuality.`,
    );
    return null;
  }

  const notesRaw = raw.notes;
  const notes =
    Array.isArray(notesRaw) && notesRaw.length > 0
      ? notesRaw.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : undefined;

  return {
    suiteId,
    passRate,
    componentScores: {
      objectiveAdherence,
      boundaryCompliance,
      escalationCorrectness,
      outcomeQuality,
    },
    notes: notes && notes.length > 0 ? notes : undefined,
  };
}

function parseSuites(raw: unknown, warnings: string[]): IntentSimulationSuiteResult[] {
  const array = Array.isArray(raw)
    ? raw
    : isRecord(raw)
      ? (raw as IntentSimulationReportShape).suites
      : undefined;
  if (!Array.isArray(array)) {
    warnings.push('Simulation report must be an array or object with a "suites" array.');
    return [];
  }

  const suites: IntentSimulationSuiteResult[] = [];
  for (const [index, item] of array.entries()) {
    const parsed = parseSuite(item, index, warnings);
    if (parsed) {
      suites.push(parsed);
    }
  }
  return suites;
}

function resolveReportPath(params: {
  reportPath: string;
  workspaceDir?: string;
  cwd?: string;
}): string {
  const reportPath = params.reportPath.trim();
  if (path.isAbsolute(reportPath)) {
    return reportPath;
  }
  if (params.workspaceDir?.trim()) {
    return path.resolve(params.workspaceDir, reportPath);
  }
  return path.resolve(params.cwd ?? process.cwd(), reportPath);
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function resolveGateForAgent(params: {
  intent?: IntentConfig;
  agentId?: string;
}): import("../config/types.js").IntentSimulationGateConfig | undefined {
  const { intent, agentId } = params;
  // Agent-level gate takes priority over global
  if (agentId && intent?.agents?.[agentId]?.simulationGate) {
    return intent.agents[agentId].simulationGate;
  }
  return intent?.simulationGate;
}

async function loadSuitesFromReport(params: {
  intent?: IntentConfig;
  agentId?: string;
  workspaceDir?: string;
  cwd?: string;
}): Promise<{ suites: IntentSimulationSuiteResult[]; warnings: string[]; reportPath?: string }> {
  const gate = resolveGateForAgent(params);
  const warnings: string[] = [];
  if (!params.intent || params.intent.enabled === false || !gate || gate.enabled === false) {
    return { suites: [], warnings };
  }
  const rawPath = gate.reportPath?.trim();
  if (!rawPath) {
    return { suites: [], warnings };
  }

  const reportPath = resolveReportPath({
    reportPath: rawPath,
    workspaceDir: params.workspaceDir,
    cwd: params.cwd,
  });

  try {
    const raw = await fs.readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const suites = parseSuites(parsed, warnings);
    return { suites, warnings, reportPath };
  } catch (err) {
    warnings.push(`Failed to load intent simulation report "${reportPath}": ${describeError(err)}`);
    return { suites: [], warnings, reportPath };
  }
}

export async function evaluateIntentSimulationGateForConfig(params: {
  intent?: IntentConfig;
  agentId?: string;
  workspaceDir?: string;
  cwd?: string;
}): Promise<IntentRuntimeGateEvaluation> {
  const loaded = await loadSuitesFromReport(params);
  // When evaluating, use the agent-level gate config if available
  const gate = resolveGateForAgent(params);
  const intentForEval: IntentConfig | undefined = gate
    ? { ...params.intent, simulationGate: gate }
    : params.intent;
  return {
    evaluation: evaluateIntentSimulationGate({
      intent: intentForEval,
      suites: loaded.suites,
    }),
    warnings: loaded.warnings,
    reportPath: loaded.reportPath,
  };
}
