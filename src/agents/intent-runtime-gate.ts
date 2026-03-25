import type {
  IntentAlignmentComponentThresholds,
  IntentAlignmentComponentScores,
  IntentConfig,
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

export type IntentRuntimeGateEvaluation = {
  evaluation: IntentSimulationGateEvaluation;
  warnings: string[];
  reportPath?: string;
};

function resolveGateForAgent(params: {
  intent?: IntentConfig;
  agentId?: string;
}): import("../config/types.js").IntentSimulationGateConfig | undefined {
  const { intent, agentId } = params;
  if (agentId && intent?.agents?.[agentId]?.simulationGate) {
    return intent.agents[agentId].simulationGate;
  }
  return intent?.simulationGate;
}

export async function evaluateIntentSimulationGateForConfig(params: {
  intent?: IntentConfig;
  agentId?: string;
  workspaceDir?: string;
  cwd?: string;
}): Promise<IntentRuntimeGateEvaluation> {
  const gate = resolveGateForAgent(params);
  const enabled = Boolean(params.intent && params.intent.enabled !== false && gate?.enabled);

  return {
    evaluation: {
      enabled,
      mode: gate?.mode ?? "warn",
      minPassRate: gate?.minPassRate ?? 0,
      minComponentScores: gate?.minComponentScores ?? {},
      requiredSuites: gate?.requiredSuites ?? [],
      overallPassRate: null,
      aggregateScores: null,
      blocking: false,
      reasons: [],
    },
    warnings: enabled
      ? [
          "Intent simulation gate evaluation is unavailable in ArgentOS Core; proceeding without Business-only simulation reports.",
        ]
      : [],
  };
}
