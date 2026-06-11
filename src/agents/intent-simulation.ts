import type {
  IntentAlignmentComponentThresholds,
  IntentAlignmentComponentScores,
  IntentConfig,
  IntentSimulationSuiteResult,
} from "../config/types.js";

export type IntentSimulationGateEvaluation = {
  enabled: boolean;
  mode: "warn" | "enforce";
  minPassRate: number;
  minComponentScores: IntentAlignmentComponentThresholds;
  requiredSuites: string[];
  overallPassRate: number | null;
  aggregateScores: IntentAlignmentComponentScores | null;
  blocking: boolean;
  reasons: string[];
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function normalizeSuiteIds(ids: string[] | undefined): string[] {
  if (!ids || ids.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function computeAggregateScores(
  suites: IntentSimulationSuiteResult[],
): IntentAlignmentComponentScores | null {
  if (suites.length === 0) {
    return null;
  }
  return {
    objectiveAdherence: clampScore(
      average(suites.map((suite) => clampScore(suite.componentScores.objectiveAdherence))) ?? 0,
    ),
    boundaryCompliance: clampScore(
      average(suites.map((suite) => clampScore(suite.componentScores.boundaryCompliance))) ?? 0,
    ),
    escalationCorrectness: clampScore(
      average(suites.map((suite) => clampScore(suite.componentScores.escalationCorrectness))) ?? 0,
    ),
    outcomeQuality: clampScore(
      average(suites.map((suite) => clampScore(suite.componentScores.outcomeQuality))) ?? 0,
    ),
  };
}

function normalizeComponentThresholds(
  thresholds: IntentAlignmentComponentThresholds | undefined,
): IntentAlignmentComponentThresholds {
  if (!thresholds) {
    return {};
  }
  const normalized: IntentAlignmentComponentThresholds = {};
  if (thresholds.objectiveAdherence !== undefined) {
    normalized.objectiveAdherence = clampScore(thresholds.objectiveAdherence);
  }
  if (thresholds.boundaryCompliance !== undefined) {
    normalized.boundaryCompliance = clampScore(thresholds.boundaryCompliance);
  }
  if (thresholds.escalationCorrectness !== undefined) {
    normalized.escalationCorrectness = clampScore(thresholds.escalationCorrectness);
  }
  if (thresholds.outcomeQuality !== undefined) {
    normalized.outcomeQuality = clampScore(thresholds.outcomeQuality);
  }
  return normalized;
}

function evaluateComponentThresholds(params: {
  aggregateScores: IntentAlignmentComponentScores | null;
  minComponentScores: IntentAlignmentComponentThresholds;
}): string[] {
  const reasons: string[] = [];
  const { aggregateScores, minComponentScores } = params;
  const entries = Object.entries(minComponentScores) as Array<
    [keyof IntentAlignmentComponentThresholds, number]
  >;

  if (entries.length === 0) {
    return reasons;
  }
  if (!aggregateScores) {
    reasons.push("No aggregate component scores available to evaluate minComponentScores.");
    return reasons;
  }

  for (const [component, threshold] of entries) {
    if (threshold === undefined) {
      continue;
    }
    const value = aggregateScores[component];
    if (value < threshold) {
      reasons.push(
        `Aggregate component "${component}" score ${value.toFixed(2)} is below minimum ${threshold.toFixed(2)}.`,
      );
    }
  }

  return reasons;
}

export function evaluateIntentSimulationGate(params: {
  intent?: IntentConfig;
  suites?: IntentSimulationSuiteResult[];
}): IntentSimulationGateEvaluation {
  const intent = params.intent;
  const gate = intent?.simulationGate;
  if (!intent || intent.enabled === false || !gate || gate.enabled === false) {
    return {
      enabled: false,
      mode: gate?.mode ?? "warn",
      minPassRate: clampScore(gate?.minPassRate ?? 0.8),
      minComponentScores: normalizeComponentThresholds(gate?.minComponentScores),
      requiredSuites: normalizeSuiteIds(gate?.suites),
      overallPassRate: null,
      aggregateScores: null,
      blocking: false,
      reasons: [],
    };
  }

  const mode = gate.mode ?? "warn";
  const minPassRate = clampScore(gate.minPassRate ?? 0.8);
  const minComponentScores = normalizeComponentThresholds(gate.minComponentScores);
  const requiredSuites = normalizeSuiteIds(gate.suites);
  const suites = params.suites ?? [];
  const suiteById = new Map(suites.map((suite) => [suite.suiteId, suite]));
  const reasons: string[] = [];

  if (requiredSuites.length > 0) {
    for (const suiteId of requiredSuites) {
      const result = suiteById.get(suiteId);
      if (!result) {
        reasons.push(`Missing required simulation suite "${suiteId}".`);
        continue;
      }
      const passRate = clampScore(result.passRate);
      if (passRate < minPassRate) {
        reasons.push(
          `Suite "${suiteId}" pass rate ${passRate.toFixed(2)} is below minimum ${minPassRate.toFixed(2)}.`,
        );
      }
    }
  } else if (suites.length === 0) {
    reasons.push("No simulation suites provided.");
  } else {
    for (const suite of suites) {
      const passRate = clampScore(suite.passRate);
      if (passRate < minPassRate) {
        reasons.push(
          `Suite "${suite.suiteId}" pass rate ${passRate.toFixed(2)} is below minimum ${minPassRate.toFixed(2)}.`,
        );
      }
    }
  }

  const scopedSuites =
    requiredSuites.length > 0
      ? requiredSuites
          .map((suiteId) => suiteById.get(suiteId))
          .filter((suite): suite is IntentSimulationSuiteResult => Boolean(suite))
      : suites;
  const overallPassRate = average(scopedSuites.map((suite) => clampScore(suite.passRate)));
  const aggregateScores = computeAggregateScores(scopedSuites);
  reasons.push(...evaluateComponentThresholds({ aggregateScores, minComponentScores }));

  // Only hard-block when there are actual suite results to enforce against.
  // If no suites were provided at all (e.g. report file missing/empty),
  // degrade to warn — blocking the entire system because test suites haven't
  // been created yet is a footgun, not a safety feature.
  const hasAnySuiteResults = suites.length > 0;
  const blocking = mode === "enforce" && reasons.length > 0 && hasAnySuiteResults;

  return {
    enabled: true,
    mode,
    minPassRate,
    minComponentScores,
    requiredSuites,
    overallPassRate: overallPassRate === null ? null : clampScore(overallPassRate),
    aggregateScores,
    blocking,
    reasons,
  };
}
