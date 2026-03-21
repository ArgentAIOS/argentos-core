export type IntentValidationMode = "off" | "warn" | "enforce";

export type IntentRuntimeMode = "off" | "advisory" | "enforce";

export type IntentEscalationConfig = {
  /**
   * Sentiment threshold where escalation is required.
   * Range: -1 (very negative) .. 1 (very positive).
   * Stricter children should use a higher value (escalate sooner).
   */
  sentimentThreshold?: number;
  /**
   * Maximum autonomous attempts before escalation.
   * Stricter children should use a lower value.
   */
  maxAttemptsBeforeEscalation?: number;
  /**
   * Maximum conversation minutes before escalation.
   * Stricter children should use a lower value.
   */
  timeInConversationMinutes?: number;
  /**
   * Customer tiers that must always escalate.
   * Child layers may add tiers but must not remove inherited tiers.
   */
  customerTiersAlwaysEscalate?: string[];
};

export type IntentPolicyConfig = {
  objective?: string;
  tradeoffHierarchy?: string[];
  /**
   * Hard prohibitions. Child layers may only add to this list.
   */
  neverDo?: string[];
  /**
   * Actions the agent may autonomously take.
   * Child layers may only narrow this allowlist.
   */
  allowedActions?: string[];
  /**
   * Actions that require human approval.
   * Child layers may only add to this list.
   */
  requiresHumanApproval?: string[];
  requireAcknowledgmentBeforeClose?: boolean;
  usePersistentHistory?: boolean;
  weightPreviousEscalations?: boolean;
  escalation?: IntentEscalationConfig;
};

export type IntentGlobalConfig = IntentPolicyConfig & {
  version?: string;
  owner?: string;
  coreValues?: string[];
};

export type IntentDepartmentConfig = IntentPolicyConfig & {
  version?: string;
  owner?: string;
  /**
   * Optional explicit parent pointer for auditability.
   * If set, must match intent.global.version.
   */
  parentGlobalVersion?: string;
};

export type IntentAgentConfig = IntentPolicyConfig & {
  version?: string;
  owner?: string;
  departmentId?: string;
  role?: string;
  /**
   * Optional explicit parent pointer for auditability.
   * If set, must match intent.global.version.
   */
  parentGlobalVersion?: string;
  /**
   * Optional explicit parent pointer for auditability.
   * If set, requires departmentId and must match the selected department version.
   */
  parentDepartmentVersion?: string;
  /**
   * Per-agent simulation gate. Overrides the global simulationGate when set.
   * Each agent can have its own suites, report path, and pass thresholds.
   */
  simulationGate?: IntentSimulationGateConfig;
};

export type IntentSimulationGateConfig = {
  enabled?: boolean;
  mode?: "warn" | "enforce";
  suites?: string[];
  minPassRate?: number;
  minComponentScores?: IntentAlignmentComponentThresholds;
  reportPath?: string;
};

export type IntentAlignmentComponentScores = {
  objectiveAdherence: number;
  boundaryCompliance: number;
  escalationCorrectness: number;
  outcomeQuality: number;
};

export type IntentAlignmentComponentThresholds = Partial<IntentAlignmentComponentScores>;

export type IntentSimulationSuiteResult = {
  suiteId: string;
  passRate: number;
  componentScores: IntentAlignmentComponentScores;
  notes?: string[];
};

export type IntentConfig = {
  enabled?: boolean;
  validationMode?: IntentValidationMode;
  runtimeMode?: IntentRuntimeMode;
  global?: IntentGlobalConfig;
  departments?: Record<string, IntentDepartmentConfig>;
  agents?: Record<string, IntentAgentConfig>;
  simulationGate?: IntentSimulationGateConfig;
};
