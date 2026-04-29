import {
  deleteSpecforgeGuideSession,
  loadSpecforgeGuideSession,
  saveSpecforgeGuideSession,
  type PersistedSpecforgeGuideSession,
  type SpecforgeIntakeCoverage,
  type SpecforgeProjectType,
  type SpecforgeStage,
} from "./specforge-session-store.js";

type SpecforgeGuideSession = PersistedSpecforgeGuideSession;

type SpecforgeKickoffParams = {
  message: string;
  sessionKey: string;
  agentId: string;
};

type SpecforgeKickoffResult = {
  triggered: boolean;
  started: boolean;
  reused: boolean;
  summary?: string;
  guidance?: string;
  reason?: string;
};

type SpecforgeGuideStatus = {
  active: boolean;
  stage?: SpecforgeStage;
  projectType?: SpecforgeProjectType;
  draftVersion?: number;
  intakeCoverage?: SpecforgeIntakeCoverage;
  guidance?: string;
  lastTriggeredAt?: number;
};

const guideModeSessions = new Map<string, SpecforgeGuideSession>();

function hasDevelopmentKickoffSignal(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text || text.startsWith("/")) {
    return false;
  }
  if (
    text.includes("use spec forge") ||
    text.includes("spec forge this") ||
    text.includes("use specforge") ||
    text.includes("specforge this")
  ) {
    return true;
  }

  const starterMatch = [
    /^i need\b/,
    /^we need\b/,
    /^i have\b/,
    /^let'?s\b/,
    /^lets\b/,
    /^can you\b/,
    /^i want to\b/,
    /^i would like\b/,
    /^i'd like\b/,
  ].some((pattern) => pattern.test(text));
  const actionHits = ["build", "create", "plan", "spec", "architect", "design", "scope"].filter(
    (signal) => text.includes(signal),
  ).length;
  const domainHits = [
    "app",
    "tool",
    "api",
    "saas",
    "project",
    "software",
    "agent",
    "platform",
    "system",
  ].filter((signal) => text.includes(signal)).length;

  if (text.includes("new development application") || text.includes("new development app")) {
    return true;
  }
  if (starterMatch && domainHits > 0) {
    return true;
  }
  return actionHits > 0 && domainHits > 0;
}

function buildDefaultCoverage(): SpecforgeIntakeCoverage {
  return {
    problem: false,
    users: false,
    success: false,
    constraints: false,
    scope: false,
    nonScope: false,
    technicalContext: false,
  };
}

function createGuideSession(): SpecforgeGuideSession {
  const now = Date.now();
  return {
    startedAt: now,
    lastTriggeredAt: now,
    stage: "project_type_gate",
    projectType: "unknown",
    intakeCoverage: buildDefaultCoverage(),
    draftVersion: 0,
  };
}

function parseProjectType(message: string): SpecforgeProjectType {
  const text = message.toLowerCase();
  const brownfield = [
    "brownfield",
    "existing project",
    "existing app",
    "existing application",
    "existing code",
    "current codebase",
    "add feature",
    "update project",
    "legacy",
    "refactor",
    "already built",
  ].some((signal) => text.includes(signal));
  const greenfield = [
    "greenfield",
    "brand new",
    "from scratch",
    "new project",
    "new app",
    "new application",
    "start from zero",
  ].some((signal) => text.includes(signal));
  if (brownfield && !greenfield) {
    return "brownfield";
  }
  if (greenfield && !brownfield) {
    return "greenfield";
  }
  return "unknown";
}

function parseApprovalDecision(message: string): "approve" | "changes" | "none" {
  const text = message.toLowerCase();
  if (
    [
      "not approved",
      "deny",
      "denied",
      "reject",
      "changes needed",
      "needs changes",
      "revise",
      "not yet",
      "update prd",
    ].some((signal) => text.includes(signal))
  ) {
    return "changes";
  }
  if (
    ["approved", "approve", "sign off", "signed off", "ship it", "proceed", "go ahead"].some(
      (signal) => text.includes(signal),
    )
  ) {
    return "approve";
  }
  return "none";
}

function updateCoverage(
  coverage: SpecforgeIntakeCoverage,
  message: string,
): SpecforgeIntakeCoverage {
  const text = message.toLowerCase();
  return {
    problem: coverage.problem || /problem|pain|issue|challenge|goal/.test(text),
    users: coverage.users || /user|customer|operator|stakeholder|persona/.test(text),
    success: coverage.success || /success|kpi|metric|outcome|done means/.test(text),
    constraints:
      coverage.constraints ||
      /constraint|deadline|budget|compliance|security|risk|requirement/.test(text),
    scope: coverage.scope || /scope|must have|include|deliverable/.test(text),
    nonScope:
      coverage.nonScope || /non-scope|out of scope|won't|will not|do not include/.test(text),
    technicalContext:
      coverage.technicalContext ||
      /stack|framework|language|repo|repository|service|api|database|infra/.test(text),
  };
}

function missingCoverageKeys(coverage: SpecforgeIntakeCoverage): string[] {
  const entries: Array<[keyof SpecforgeIntakeCoverage, string]> = [
    ["problem", "problem statement"],
    ["users", "target users"],
    ["success", "success criteria/KPIs"],
    ["constraints", "constraints and deadlines"],
    ["scope", "in-scope deliverables"],
    ["nonScope", "out-of-scope boundaries"],
    ["technicalContext", "technical/repo context"],
  ];
  return entries.filter(([key]) => !coverage[key]).map(([, label]) => label);
}

function shouldMoveToDraft(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("draft prd") ||
    text.includes("generate prd") ||
    text.includes("write prd") ||
    text.includes("create the prd") ||
    text.includes("ready for prd")
  );
}

function hasDraftReadiness(coverage: SpecforgeIntakeCoverage): boolean {
  const filled = Object.values(coverage).filter(Boolean).length;
  return filled >= 4 && coverage.problem && coverage.users && coverage.scope;
}

function shouldExitSpecforge(message: string): boolean {
  const text = message.toLowerCase().trim();
  return (
    text === "exit specforge" ||
    text === "cancel specforge" ||
    text === "stop specforge" ||
    text === "specforge off"
  );
}

function buildGuidePrompt(session: SpecforgeGuideSession): string {
  const missing = missingCoverageKeys(session.intakeCoverage);
  const projectTypeNote =
    session.projectType === "unknown"
      ? "unknown"
      : `${session.projectType} (${session.projectType === "brownfield" ? "existing codebase" : "new build"})`;
  const executionHandoff = [
    "After approval, route code/project execution to the coding family team by default:",
    "- Use family.dispatch_contracted for auditable development work with explicit toolsAllow, timeout, and heartbeat_interval_ms.",
    "- Use family.dispatch for lighter development work; technical/code tasks auto-prefer the dev-team family specialists.",
    '- Use family.spawn with mode="family" only when a specific named coding family member is required.',
    "- Use team_spawn when the approved plan needs multiple coordinated agents with shared dependencies.",
    "- Use sessions_spawn only for a single isolated background task when family/team routing does not fit.",
    "- Keep each task contracted with files_to_edit, acceptance criteria, tests, non-scope, and docs impact.",
    "Orchestrator loop after handoff:",
    "- Check family.contract_history for active contracts and heartbeat/timeouts.",
    "- Check team_status for member/task/dependency state when team_spawn is used.",
    "- Send concise operator updates when work starts, blocks, completes, fails, or changes scope.",
    "- Escalate blocked or expired contracts instead of silently waiting.",
  ];
  const contract = [
    "SpecForge strict process (mandatory, no skipping):",
    "1. Confirm project type: GREENFIELD vs BROWNFIELD.",
    "2. Run intake interview one focused question at a time.",
    "3. Draft the PRD/spec and collect feedback plus explicit non-scope.",
    "4. Wait for explicit approval before implementation, scaffolding, or task assignment.",
    "5. After approval only, hand off contracted implementation work through family/team routing.",
  ];

  if (session.stage === "project_type_gate") {
    return [
      ...contract,
      `Current stage: ${session.stage}.`,
      `Current project type: ${projectTypeNote}.`,
      "Ask exactly this first: Is this GREENFIELD (new from scratch) or BROWNFIELD (existing project/codebase)?",
      "Do not ask any other intake question until project type is explicit.",
    ].join("\n");
  }

  if (session.stage === "intake_interview") {
    const nextGap = missing[0] ?? "final scope alignment";
    const typePrompt =
      session.projectType === "brownfield"
        ? "Because this is brownfield, ask for affected repos/services/files and current behavior first."
        : "Because this is greenfield, ask for target architecture and deployment baseline.";
    return [
      ...contract,
      `Current stage: ${session.stage}.`,
      `Project type: ${projectTypeNote}.`,
      typePrompt,
      `Missing intake fields: ${missing.length > 0 ? missing.join(", ") : "none"}.`,
      `Ask one focused question now about: ${nextGap}.`,
      "Summarize captured facts in 2-4 bullets after the user answers.",
      "Do not draft implementation tasks yet.",
    ].join("\n");
  }

  if (session.stage === "draft_review") {
    return [
      ...contract,
      `Current stage: ${session.stage}.`,
      `Project type: ${projectTypeNote}.`,
      "Generate/update the PRD/spec now using collected intake facts.",
      "Then ask for edits and call out non-scope explicitly.",
      "After presenting the draft, request an explicit approval decision.",
    ].join("\n");
  }

  if (session.stage === "awaiting_approval") {
    return [
      ...contract,
      `Current stage: ${session.stage}.`,
      `Project type: ${projectTypeNote}.`,
      "Hold here until explicit operator approval.",
      "Ask: Approve this PRD? Reply with APPROVE or REQUEST CHANGES.",
      "Do not implement, scaffold, or assign tasks yet.",
    ].join("\n");
  }

  return [
    ...contract,
    `Current stage: ${session.stage}.`,
    `Project type: ${projectTypeNote}.`,
    "Approval received. Implementation handoff is unlocked.",
    ...executionHandoff,
  ].join("\n");
}

async function hydrateGuideSession(
  sessionKey: string,
  inMemory: SpecforgeGuideSession | undefined,
): Promise<SpecforgeGuideSession | null> {
  if (inMemory) {
    return inMemory;
  }
  const persisted = await loadSpecforgeGuideSession(sessionKey);
  if (!persisted) {
    return null;
  }
  guideModeSessions.set(sessionKey, persisted);
  return persisted;
}

async function persistGuideSession(
  sessionKey: string,
  agentId: string,
  state: SpecforgeGuideSession,
): Promise<void> {
  guideModeSessions.set(sessionKey, state);
  await saveSpecforgeGuideSession({ sessionKey, agentId, state });
}

function toGuideStatus(state: SpecforgeGuideSession): SpecforgeGuideStatus {
  return {
    active: true,
    stage: state.stage,
    projectType: state.projectType,
    draftVersion: state.draftVersion,
    intakeCoverage: state.intakeCoverage,
    guidance: buildGuidePrompt(state),
    lastTriggeredAt: state.lastTriggeredAt,
  };
}

export async function getSpecforgeGuideStatus(sessionKey: string): Promise<SpecforgeGuideStatus> {
  const state = await hydrateGuideSession(sessionKey, guideModeSessions.get(sessionKey));
  return state ? toGuideStatus(state) : { active: false };
}

export async function clearSpecforgeGuideSession(sessionKey: string): Promise<void> {
  guideModeSessions.delete(sessionKey);
  await deleteSpecforgeGuideSession(sessionKey);
}

export async function shouldInvokeSpecforgeToolForMessage(params: {
  sessionKey: string;
  message: string;
}): Promise<boolean> {
  const text = params.message.trim();
  if (!text || text.startsWith("/")) {
    return false;
  }
  if (hasDevelopmentKickoffSignal(params.message)) {
    return true;
  }
  const state = await hydrateGuideSession(
    params.sessionKey,
    guideModeSessions.get(params.sessionKey),
  );
  return Boolean(state);
}

function advanceGuideSession(
  state: SpecforgeGuideSession,
  message: string,
): { state: SpecforgeGuideSession; summary: string; reason: string } {
  const next: SpecforgeGuideSession = {
    ...state,
    lastTriggeredAt: Date.now(),
  };

  const detectedType = parseProjectType(message);
  if (next.projectType === "unknown" && detectedType !== "unknown") {
    next.projectType = detectedType;
    if (next.stage === "project_type_gate") {
      next.stage = "intake_interview";
      next.intakeCoverage = updateCoverage(next.intakeCoverage, message);
      return {
        state: next,
        summary: `SpecForge project type set to ${detectedType}. Intake interview is now active.`,
        reason: "guide_mode_project_type_captured",
      };
    }
  }

  if (next.stage === "project_type_gate") {
    return {
      state: next,
      summary: "SpecForge is waiting for project type classification (greenfield or brownfield).",
      reason: "guide_mode_waiting_for_project_type",
    };
  }

  if (next.stage === "intake_interview") {
    next.intakeCoverage = updateCoverage(next.intakeCoverage, message);
    if (shouldMoveToDraft(message)) {
      if (!hasDraftReadiness(next.intakeCoverage)) {
        return {
          state: next,
          summary:
            "SpecForge blocked draft transition because intake is incomplete. Continue interview before drafting PRD.",
          reason: "guide_mode_intake_incomplete_for_draft",
        };
      }
      next.stage = "draft_review";
      next.draftVersion += 1;
      return {
        state: next,
        summary: `SpecForge intake advanced to PRD draft review (v${next.draftVersion}).`,
        reason: "guide_mode_move_to_draft",
      };
    }
    return {
      state: next,
      summary: "SpecForge intake interview is still in progress.",
      reason: "guide_mode_intake_progress",
    };
  }

  if (next.stage === "draft_review") {
    next.stage = "awaiting_approval";
    return {
      state: next,
      summary: `SpecForge PRD draft v${next.draftVersion || 1} is in review; awaiting explicit approval.`,
      reason: "guide_mode_waiting_approval",
    };
  }

  if (next.stage === "awaiting_approval") {
    const decision = parseApprovalDecision(message);
    if (decision === "approve") {
      next.stage = "approved_execution";
      return {
        state: next,
        summary: "SpecForge approval captured. Execution handoff is now unlocked.",
        reason: "guide_mode_approved",
      };
    }
    if (decision === "changes") {
      next.stage = "intake_interview";
      next.draftVersion += 1;
      return {
        state: next,
        summary:
          "SpecForge approval denied/changes requested. Returning to intake + PRD revision flow.",
        reason: "guide_mode_changes_requested",
      };
    }
    return {
      state: next,
      summary: "SpecForge is blocked on explicit approval (APPROVE or REQUEST CHANGES).",
      reason: "guide_mode_still_waiting_approval",
    };
  }

  return {
    state: next,
    summary: "SpecForge execution handoff is active.",
    reason: "guide_mode_execution_active",
  };
}

async function startGuideSession(params: SpecforgeKickoffParams): Promise<SpecforgeKickoffResult> {
  const state = createGuideSession();
  await persistGuideSession(params.sessionKey, params.agentId, state);
  return {
    triggered: true,
    started: true,
    reused: false,
    reason: "guide_mode_started_strict",
    summary: "SpecForge strict guide mode activated for this chat.",
    guidance: buildGuidePrompt(state),
  };
}

export function resetSpecforgeGuideStateForTests(): void {
  guideModeSessions.clear();
}

export function getSpecforgeGuideStateForTests(sessionKey: string): {
  stage: SpecforgeStage;
  projectType: SpecforgeProjectType;
  draftVersion: number;
} | null {
  const state = guideModeSessions.get(sessionKey);
  if (!state) {
    return null;
  }
  return {
    stage: state.stage,
    projectType: state.projectType,
    draftVersion: state.draftVersion,
  };
}

export async function maybeKickoffSpecforgeFromMessage(
  params: SpecforgeKickoffParams,
): Promise<SpecforgeKickoffResult> {
  const text = params.message.trim();
  const current = await hydrateGuideSession(
    params.sessionKey,
    guideModeSessions.get(params.sessionKey),
  );
  const hasActiveGuide = Boolean(current);
  const hasKickoffSignal = hasDevelopmentKickoffSignal(params.message);

  if (hasActiveGuide && shouldExitSpecforge(text)) {
    await clearSpecforgeGuideSession(params.sessionKey);
    return {
      triggered: true,
      started: false,
      reused: true,
      reason: "guide_mode_exited",
      summary: "SpecForge guide mode exited for this chat.",
    };
  }

  if (!hasActiveGuide && !hasKickoffSignal) {
    return {
      triggered: false,
      started: false,
      reused: false,
      reason: "no_trigger",
    };
  }

  if (!hasActiveGuide) {
    return startGuideSession(params);
  }

  if (!current) {
    return startGuideSession(params);
  }

  const advanced = advanceGuideSession(current, params.message);
  await persistGuideSession(params.sessionKey, params.agentId, advanced.state);
  return {
    triggered: true,
    started: false,
    reused: true,
    reason: advanced.reason,
    summary: advanced.summary,
    guidance: buildGuidePrompt(advanced.state),
  };
}
