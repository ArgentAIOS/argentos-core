import type {
  IntentPolicyConfig,
  IntentSimulationGateConfig,
} from "../../../../src/config/types.intent";

export type WizardStep =
  | "identity"
  | "department"
  | "boundaries"
  | "simulation"
  | "review"
  | "deploy";

export const WIZARD_STEPS: WizardStep[] = [
  "identity",
  "department",
  "boundaries",
  "simulation",
  "review",
  "deploy",
];

export const STEP_LABELS: Record<WizardStep, string> = {
  identity: "Identity",
  department: "Department",
  boundaries: "Boundaries",
  simulation: "Simulation",
  review: "Review",
  deploy: "Deploy",
};

export type RolePreset =
  | "tier_1_support"
  | "tier_2_support"
  | "developer"
  | "analyst"
  | "researcher"
  | "project_manager"
  | "custom";

export interface AgentIdentity {
  displayName: string;
  agentId: string;
  role: RolePreset;
  customRole: string;
  team: string;
  emoji: string;
}

export interface DepartmentChoice {
  mode: "existing" | "new";
  existingId: string;
  newId: string;
  newObjective: string;
}

export interface BoundariesConfig {
  objective: string;
  neverDo: string[];
  allowedActions: string[];
  requiresHumanApproval: string[];
  escalation: {
    sentimentThreshold: number;
    maxAttempts: number;
    alwaysEscalate: string[];
  };
}

export interface SimulationConfig {
  enabled: boolean;
  mode: "warn" | "enforce";
  minPassRate: number;
  suites: string[];
  reportPath: string;
  minComponentScores: {
    objectiveAdherence: number;
    boundaryCompliance: number;
    escalationCorrectness: number;
    outcomeQuality: number;
  };
}

export interface WizardState {
  identity: AgentIdentity;
  department: DepartmentChoice;
  boundaries: BoundariesConfig;
  simulation: SimulationConfig;
}

export interface ValidationIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface WorkerTemplate {
  id: string;
  label: string;
  emoji: string;
  description: string;
  identity: Partial<AgentIdentity>;
  department: Partial<DepartmentChoice>;
  boundaries: BoundariesConfig;
  simulation: Partial<SimulationConfig>;
}

export function createDefaultState(): WizardState {
  return {
    identity: {
      displayName: "",
      agentId: "",
      role: "custom",
      customRole: "",
      team: "",
      emoji: "",
    },
    department: {
      mode: "existing",
      existingId: "",
      newId: "",
      newObjective: "",
    },
    boundaries: {
      objective: "",
      neverDo: [],
      allowedActions: [],
      requiresHumanApproval: [],
      escalation: {
        sentimentThreshold: 0.3,
        maxAttempts: 3,
        alwaysEscalate: [],
      },
    },
    simulation: {
      enabled: false,
      mode: "warn",
      minPassRate: 0.8,
      suites: [],
      reportPath: "",
      minComponentScores: {
        objectiveAdherence: 0.7,
        boundaryCompliance: 0.8,
        escalationCorrectness: 0.7,
        outcomeQuality: 0.7,
      },
    },
  };
}

/** Build the IntentAgentConfig from wizard state */
export function buildIntentAgentConfig(state: WizardState): {
  policy: IntentPolicyConfig & { departmentId?: string; role?: string };
  simulation?: IntentSimulationGateConfig;
} {
  const deptId =
    state.department.mode === "existing" ? state.department.existingId : state.department.newId;

  const policy: IntentPolicyConfig & { departmentId?: string; role?: string } = {
    objective: state.boundaries.objective,
    neverDo: state.boundaries.neverDo,
    allowedActions: state.boundaries.allowedActions,
    requiresHumanApproval: state.boundaries.requiresHumanApproval,
    escalation: {
      sentimentThreshold: state.boundaries.escalation.sentimentThreshold,
      maxAttemptsBeforeEscalation: state.boundaries.escalation.maxAttempts,
      customerTiersAlwaysEscalate: state.boundaries.escalation.alwaysEscalate,
    },
    departmentId: deptId || undefined,
    role: state.identity.role === "custom" ? state.identity.customRole : state.identity.role,
  };

  const simulation: IntentSimulationGateConfig | undefined = state.simulation.enabled
    ? {
        enabled: true,
        mode: state.simulation.mode,
        minPassRate: state.simulation.minPassRate,
        suites: state.simulation.suites.length ? state.simulation.suites : undefined,
        reportPath: state.simulation.reportPath || undefined,
        minComponentScores: state.simulation.minComponentScores,
      }
    : undefined;

  return { policy, simulation };
}

// ─── Worker Templates ────────────────────────────────────────────────

export const WORKER_TEMPLATES: WorkerTemplate[] = [
  {
    id: "msp-t1",
    label: "MSP T1 Support",
    emoji: "🎧",
    description: "Tier 1 helpdesk — tickets, troubleshooting, escalation",
    identity: { role: "tier_1_support", team: "MSP Team" },
    department: {
      mode: "new",
      newId: "msp-support",
      newObjective: "Handle Tier 1 support tickets efficiently and escalate appropriately",
    },
    boundaries: {
      objective:
        "Handle Tier 1 tickets: password resets, basic troubleshooting, software installs, guided diagnostics. Escalate complex/security/infrastructure issues.",
      neverDo: [
        "modify infrastructure",
        "access billing",
        "change AD group policies",
        "disable security",
        "promise timelines",
        "access other customer data",
      ],
      allowedActions: [
        "resolve_known_pattern",
        "guide_troubleshooting",
        "create_ticket",
        "update_ticket",
        "add_comments",
        "escalate",
        "request_context",
      ],
      requiresHumanApproval: ["infrastructure_change", "billing_access"],
      escalation: {
        sentimentThreshold: 0.3,
        maxAttempts: 3,
        alwaysEscalate: [
          "security_incident",
          "data_loss",
          "server_outage",
          "hardware_failure",
          "billing_inquiry",
        ],
      },
    },
    simulation: {
      enabled: true,
      mode: "warn",
      minPassRate: 0.8,
      minComponentScores: {
        objectiveAdherence: 0.7,
        boundaryCompliance: 0.9,
        escalationCorrectness: 0.85,
        outcomeQuality: 0.7,
      },
    },
  },
  {
    id: "developer",
    label: "Developer",
    emoji: "💻",
    description: "Code, review, test — escalate deploys & architecture",
    identity: { role: "developer", team: "Engineering" },
    department: {
      mode: "new",
      newId: "engineering",
      newObjective: "Deliver high-quality software through disciplined engineering practices",
    },
    boundaries: {
      objective:
        "Write, review, and debug code. Follow coding standards, write tests, document changes. Escalate architecture decisions and production deployments.",
      neverDo: [
        "deploy to production without approval",
        "modify CI/CD pipelines",
        "delete databases",
        "commit secrets",
        "bypass code review",
      ],
      allowedActions: [
        "write_code",
        "review_code",
        "run_tests",
        "create_branches",
        "update_tasks",
        "request_review",
      ],
      requiresHumanApproval: ["production_deploy", "architecture_change"],
      escalation: {
        sentimentThreshold: 0.5,
        maxAttempts: 5,
        alwaysEscalate: ["production_deploy", "architecture_change", "security_vulnerability"],
      },
    },
    simulation: {
      enabled: true,
      mode: "warn",
      minPassRate: 0.75,
      minComponentScores: {
        objectiveAdherence: 0.7,
        boundaryCompliance: 0.8,
        escalationCorrectness: 0.7,
        outcomeQuality: 0.85,
      },
    },
  },
  {
    id: "analyst",
    label: "Research Analyst",
    emoji: "🔍",
    description: "Gather, analyze, synthesize — reports with citations",
    identity: { role: "analyst", team: "Research" },
    department: {
      mode: "new",
      newId: "research",
      newObjective: "Produce actionable intelligence and research with verified citations",
    },
    boundaries: {
      objective:
        "Gather, analyze, and synthesize information. Produce actionable reports with citations. Flag uncertain conclusions.",
      neverDo: [
        "present speculation as fact",
        "share confidential data",
        "make financial recommendations",
        "publish without review",
      ],
      allowedActions: [
        "search_web",
        "analyze_data",
        "create_reports",
        "update_tasks",
        "request_review",
      ],
      requiresHumanApproval: ["publish_report", "share_externally"],
      escalation: {
        sentimentThreshold: 0.4,
        maxAttempts: 4,
        alwaysEscalate: ["publish_report", "data_discrepancy"],
      },
    },
    simulation: { enabled: false, mode: "warn", minPassRate: 0.7 },
  },
  {
    id: "pm",
    label: "Project Manager",
    emoji: "📋",
    description: "Coordinate projects, track milestones, manage deps",
    identity: { role: "project_manager", team: "Operations" },
    department: { mode: "existing", existingId: "operations" },
    boundaries: {
      objective:
        "Coordinate projects, track milestones, manage dependencies. Escalate blocked items and budget decisions.",
      neverDo: [
        "approve budgets without authorization",
        "commit to deadlines without team input",
        "share internal project data externally",
      ],
      allowedActions: [
        "create_tasks",
        "assign_tasks",
        "update_status",
        "schedule_meetings",
        "prepare_reports",
        "escalate_blockers",
      ],
      requiresHumanApproval: ["budget_approval", "external_communication"],
      escalation: {
        sentimentThreshold: 0.4,
        maxAttempts: 4,
        alwaysEscalate: ["budget_decision", "blocked_critical_path"],
      },
    },
    simulation: { enabled: false, mode: "warn", minPassRate: 0.7 },
  },
];
