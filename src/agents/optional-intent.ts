import type {
  ArgentConfig,
  IntentAlignmentComponentScores,
  IntentAlignmentComponentThresholds,
  IntentPolicyConfig,
  IntentRuntimeMode,
  IntentValidationMode,
} from "../config/types.js";
import { loadOptionalToolFactory } from "./optional-tool-factory.js";

export type OptionalIntentIssue = {
  path: string;
  message: string;
};

export type OptionalResolvedIntentForAgent = {
  agentId: string;
  departmentId?: string;
  runtimeMode: IntentRuntimeMode;
  validationMode: IntentValidationMode;
  policy: IntentPolicyConfig;
  issues: OptionalIntentIssue[];
};

export type OptionalIntentSimulationGateEvaluation = {
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

export type OptionalIntentRuntimeGateEvaluation = {
  evaluation: OptionalIntentSimulationGateEvaluation;
  warnings: string[];
  reportPath?: string;
};

type ResolveEffectiveIntentForAgentFn = (params: {
  config?: ArgentConfig;
  agentId: string;
}) => OptionalResolvedIntentForAgent | null;

type BuildIntentSystemPromptHintFn = (policy: IntentPolicyConfig) => string | undefined;

type EvaluateIntentSimulationGateForConfigFn = (params: {
  intent?: ArgentConfig["intent"];
  agentId?: string;
  workspaceDir?: string;
  cwd?: string;
}) => Promise<OptionalIntentRuntimeGateEvaluation>;

const resolveEffectiveIntentForAgentOptional =
  loadOptionalToolFactory<ResolveEffectiveIntentForAgentFn>(
    "./intent.js",
    "resolveEffectiveIntentForAgent",
  );
const buildIntentSystemPromptHintOptional = loadOptionalToolFactory<BuildIntentSystemPromptHintFn>(
  "./intent.js",
  "buildIntentSystemPromptHint",
);
const evaluateIntentSimulationGateForConfigOptional =
  loadOptionalToolFactory<EvaluateIntentSimulationGateForConfigFn>(
    "./intent-runtime-gate.js",
    "evaluateIntentSimulationGateForConfig",
  );

function createDisabledGateEvaluation(): OptionalIntentRuntimeGateEvaluation {
  return {
    evaluation: {
      enabled: false,
      mode: "warn",
      minPassRate: 0.8,
      minComponentScores: {},
      requiredSuites: [],
      overallPassRate: null,
      aggregateScores: null,
      blocking: false,
      reasons: [],
    },
    warnings: [],
  };
}

export function resolveEffectiveIntentForAgentIfAvailable(params: {
  config?: ArgentConfig;
  agentId?: string;
}): OptionalResolvedIntentForAgent | null {
  if (!resolveEffectiveIntentForAgentOptional || !params.agentId) {
    return null;
  }
  return resolveEffectiveIntentForAgentOptional({
    config: params.config,
    agentId: params.agentId,
  });
}

export function buildIntentSystemPromptHintIfAvailable(
  policy: IntentPolicyConfig | undefined,
): string | undefined {
  if (!buildIntentSystemPromptHintOptional || !policy) {
    return undefined;
  }
  return buildIntentSystemPromptHintOptional(policy);
}

export async function evaluateIntentSimulationGateForConfigIfAvailable(params: {
  intent?: ArgentConfig["intent"];
  agentId?: string;
  workspaceDir?: string;
  cwd?: string;
}): Promise<OptionalIntentRuntimeGateEvaluation> {
  if (!evaluateIntentSimulationGateForConfigOptional) {
    return createDisabledGateEvaluation();
  }
  return evaluateIntentSimulationGateForConfigOptional(params);
}
