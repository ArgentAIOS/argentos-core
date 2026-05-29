/**
 * Operator Goal Primitives — Goal Definition + Orchestration (wf-2) and
 * Parallel Delegation Engine Extensions (wf-3) for the Self-Extending Operator Core.
 *
 * Part of "Operator-Owned Continuous Self-Improvement via Workflows + Goal-Driven Parallel Delegation".
 *
 * Primitives that let the *primary operator* (exclusively behind isPrimaryOperator /
 * operator light tool surface) declare high-level, long-running self-improvement goals.
 * These goals automatically decompose into parallel family-agent work items, each
 * framed with rich DispatchContract + capability handoff contracts (leveraging and
 * extending capability-delegation.ts), executed via existing family dispatch_contracted
 * and workflow parallel gates where beneficial, with durable result aggregation back
 * to the operator via family shared knowledge + contract metadata + events.
 *
 * Design principles (non-negotiable):
 * - 100% additive. No changes to default agent behavior, no registration in full
 *   argent-tools surfaces, no impact when isPrimaryOperator is false.
 * - Leverages ONLY: DispatchContract (create/append/query via metadata.goalId),
 *   family publish/search/message for knowledge return, existing capability
 *   delegation allow/deny + framing, workflow parallel gates (for durable
 *   orchestrated variants), and the curator / personal_skill / workflow_builder
 *   surfaces the operator already receives on the light path.
 * - Clear contracts: every spawned unit carries a parent goalId, subGoalId,
 *   framed CAPABILITY_WORK_DELEGATION_CONTRACT (extended for goals), and
 *   explicit aggregation expectations.
 * - Result aggregation is queryable and automatic: workers publish "goal_result"
 *   category knowledge; orchestrator provides collectors.
 * - Workflow path: goals can emit ready-to-draft "parallel self-improvement workflow"
 *   intents for workflow_builder (ownerAgentId = operator) that use parallel gates
 *   + agent steps pre-loaded with delegation packets.
 *
 * Usage (only via light operator surface / curator extensions / dedicated goal tool):
 *   - declareGoal → returns goalId + decomposition + array of ready-to-dispatch
 *     parallel packets (each with framedTask, toolsAllow/Deny, contract hints).
 *   - spawnParallelForGoal (or operator manually fires the family dispatches)
 *   - aggregateGoalResults(goalId) — pulls contract states + published knowledge.
 *
 * This gives the operator continuous self-improvement loops: declare "Improve
 * parallel delegation by researching 5 patterns across family + workflows",
 * get N parallel specialized family researchers running under safe grants and
 * contracts, results flow back automatically into MemU/SIS + operator inbox.
 *
 * All code here is intended for createLightOperatorTools (or equivalent) only.
 * See also: capability-delegation.ts (the foundation we extend), family-tool.ts
 * (dispatch_contracted), dispatch-contracts.ts, workflow-runner.ts (parallel gates),
 * curator-tool.ts (prior self-building delegation), workflow-builder-tool.ts.
 */

import type { PersonalSkillCandidate } from "../../memory/memu-types.js";
import {
  buildCapabilityDelegationTask,
  buildPersonalSkillReviewDelegationTask,
  createGeneralCapabilityDelegationTask,
  CAPABILITY_DELEGATION_TOOL_ALLOWLIST,
  CAPABILITY_DELEGATION_TOOL_DENY,
} from "./capability-delegation.js";

// Local fallback (the authoritative version lives in capability-delegation.ts)
function buildCapabilityOutcomeKnowledge(params: {
  goal: string;
  candidateId?: string | null;
  proposal: Record<string, unknown>;
  confidence: number;
  sourceAgentId: string;
  contractId?: string | null;
  extraNotes?: string;
}) {
  const { goal, candidateId, proposal, confidence, sourceAgentId, contractId, extraNotes } = params;
  const title = `Capability delegation outcome: ${goal.slice(0, 80)}${goal.length > 80 ? "..." : ""}${candidateId ? ` [candidate:${candidateId}]` : ""}`;
  const contentLines = [
    `Delegated by primary operator. Source worker: ${sourceAgentId}`,
    contractId ? `Dispatch contract: ${contractId}` : "",
    candidateId ? `Personal Skill candidate: ${candidateId}` : "",
    "",
    "Proposal / Outcome:",
    JSON.stringify(proposal, null, 2),
    "",
    extraNotes ? `Notes: ${extraNotes}` : "",
    "",
    `Generated via goal-driven parallel delegation (wf-2/wf-3).`,
  ].filter(Boolean);
  return {
    title,
    content: contentLines.join("\n"),
    category: "pattern" as const,
    confidence: Math.max(0.1, Math.min(1, confidence)),
  };
}

// ── Core Goal Types (wf-2) ────────────────────────────────────────────────────

export type OperatorGoalStatus =
  | "declared"
  | "decomposed"
  | "spawning"
  | "executing"
  | "aggregating"
  | "completed"
  | "failed"
  | "paused";

export interface OperatorSelfImprovementGoal {
  goalId: string;
  description: string;
  ownerAgentId: string;
  createdAt: string;
  status: OperatorGoalStatus;
  decomposition?: GoalDecomposition;
  metadata: Record<string, unknown>;
  parentContractId?: string;
}

export interface GoalSubTask {
  subGoalId: string;
  description: string;
  domainHints: string[];
  priority?: number;
  expectedDeliverables?: string;
}

export interface GoalDecomposition {
  goalId: string;
  subTasks: GoalSubTask[];
  strategy: "parallel_family" | "parallel_workflow_gates" | "hybrid";
  rationale: string;
  estimatedParallelism: number;
}

export interface GoalDelegationPacket {
  subGoalId: string;
  framedTask: string;
  recommendedToolsAllow: string[];
  recommendedToolsDeny: string[];
  suggestedPurpose: string;
  handoffExpectations: string;
  metadata: Record<string, unknown>;
  dispatchContractParams: {
    task: string;
    toolsAllow: string[];
    toolsDeny: string[];
    timeoutMs?: number;
    heartbeatIntervalMs?: number;
    metadata: Record<string, unknown>;
  };
}

export interface ParallelDelegationPlan {
  goalId: string;
  packets: GoalDelegationPacket[];
  overallHandoffContract: string;
  recommendedWorkflowDraftIntent?: string;
  aggregationQueryHints: {
    familyKnowledgeCategory: "goal_result" | "pattern" | "lesson";
    contractMetadataFilter: { goalId: string };
  };
}

export interface GoalResultAggregation {
  goalId: string;
  statusSummary: string;
  completedSubTasks: number;
  totalSubTasks: number;
  contracts: Array<{
    contractId: string;
    subGoalId?: string;
    status: string;
    resultSummary?: string;
  }>;
  publishedKnowledge: Array<{
    id?: string;
    title: string;
    category: string;
    content: string;
    confidence?: number;
    sourceAgentId?: string;
  }>;
  recommendedNextActions: string[];
  confidence: number;
}

// ── Extended Allow/Deny for Goal-Level Work ──────────────────────────────────

export const GOAL_ORCHESTRATION_TOOL_ALLOWLIST: string[] = [
  ...CAPABILITY_DELEGATION_TOOL_ALLOWLIST,
  "workflow_builder",
  "curator",
  "personal_skill",
  "skills",
  "family",
  "memory_reflect",
  "os_docs",
  "sessions_list",
  "sessions_history",
];

export const GOAL_ORCHESTRATION_TOOL_DENY: string[] = [
  ...CAPABILITY_DELEGATION_TOOL_DENY,
  "exec",
  "bash",
  "write",
  "edit",
  "atera_ticket",
  "doc_panel_update",
  "doc_panel_delete",
  "tasks",
  "plugin_install",
];

const GOAL_PARALLEL_HANDOFF_CONTRACT = `
## OPERATOR GOAL-DRIVEN PARALLEL DELEGATION CONTRACT (PRIMARY OPERATOR — wf-2/wf-3)

You are one parallel worker in a **goal-driven self-improvement campaign** owned by the primary operator ("argent").

**Parent Goal**: {{GOAL_DESCRIPTION}}
**Your Sub-Goal**: {{SUB_GOAL_DESCRIPTION}}
**Goal ID**: {{GOAL_ID}}
**Sub-Goal ID**: {{SUB_GOAL_ID}}

**Non-negotiable Rules**:
- Stay 100% inside the provided tool grants.
- Produce durable, reviewable artifacts.
- Publish intermediate findings early using family.publish so siblings and the operator can see progress.

**Mandatory Return Path**:
1. Structured final output (extended CAPABILITY_DELEGATION_RESULT with goal fields).
2. family.publish(category: "goal_result", metadata: { goalId, subGoalId, contractId? }).
3. family.message to "argent" with message_type "goal_result", including goal ids.
4. Append completion events to active DispatchContract.

**Result Block**:
GOAL_DELEGATION_RESULT:
{
  "goalId": "...",
  "subGoalId": "...",
  "proposal": { ... },
  "recommendedActionForParentGoal": "continue" | "refine_subtask" | "promote_artifact" | "spawn_followup_goal",
  "publishedKnowledgeIds": ["..."],
  "contractId": "...",
  "confidence": 0.0
}
`.trim();

// ── Primitives ───────────────────────────────────────────────────────────────

export function generateOperatorGoalId(description: string): string {
  const slug = description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  const ts = Date.now().toString(36);
  return `op-goal-${slug}-${ts}`;
}

export function decomposeOperatorSelfImprovementGoal(goal: OperatorSelfImprovementGoal): GoalDecomposition {
  // Simple but effective decomposition for self-improvement goals.
  // In production the operator (or a light curator) can refine.
  const subTasks: GoalSubTask[] = [
    {
      subGoalId: `${goal.goalId}-research`,
      description: `Research existing patterns and evidence for: ${goal.description}`,
      domainHints: ["memory", "family", "workflow", "personal_skill"],
      priority: 1,
    },
    {
      subGoalId: `${goal.goalId}-prototype`,
      description: `Prototype concrete artifacts (procedures, workflow drafts, delegation patterns)`,
      domainHints: ["workflow", "parallel_delegation", "personal_skill"],
      priority: 2,
    },
    {
      subGoalId: `${goal.goalId}-validate`,
      description: `Validate, curate, and prepare promotion candidates or workflow improvements`,
      domainHints: ["curator", "personal_skill", "family"],
      priority: 3,
    },
  ];

  return {
    goalId: goal.goalId,
    subTasks,
    strategy: "hybrid",
    rationale: "Parallel research + prototype + validation maximizes speed while allowing durable workflow output.",
    estimatedParallelism: 3,
  };
}

export function buildGoalParallelDelegationPacket(params: {
  goal: OperatorSelfImprovementGoal;
  subTask: GoalSubTask;
  extraContext?: string;
}): GoalDelegationPacket {
  const { goal, subTask } = params;

  const base = buildCapabilityDelegationTask({
    goal: subTask.description,
    context: [params.extraContext, `Parent Goal: ${goal.description}`].filter(Boolean).join("\n\n"),
    expectedDeliverables: subTask.expectedDeliverables,
    requesterAgentId: goal.ownerAgentId,
  });

  const framedTask = [
    GOAL_PARALLEL_HANDOFF_CONTRACT
      .replace("{{GOAL_DESCRIPTION}}", goal.description)
      .replace("{{SUB_GOAL_DESCRIPTION}}", subTask.description)
      .replace("{{GOAL_ID}}", goal.goalId)
      .replace("{{SUB_GOAL_ID}}", subTask.subGoalId),
    "",
    base.framedTask,
  ].join("\n");

  return {
    subGoalId: subTask.subGoalId,
    framedTask,
    recommendedToolsAllow: [...GOAL_ORCHESTRATION_TOOL_ALLOWLIST],
    recommendedToolsDeny: [...GOAL_ORCHESTRATION_TOOL_DENY],
    suggestedPurpose: "goal_parallel_delegation",
    handoffExpectations: GOAL_PARALLEL_HANDOFF_CONTRACT,
    metadata: {
      goalId: goal.goalId,
      subGoalId: subTask.subGoalId,
      parentGoalDescription: goal.description,
    },
    dispatchContractParams: {
      task: framedTask,
      toolsAllow: [...GOAL_ORCHESTRATION_TOOL_ALLOWLIST],
      toolsDeny: [...GOAL_ORCHESTRATION_TOOL_DENY],
      metadata: {
        goalId: goal.goalId,
        subGoalId: subTask.subGoalId,
        purpose: "goal_parallel_delegation",
      },
    },
  };
}

export function buildParallelDelegationPlanForGoal(goal: OperatorSelfImprovementGoal): ParallelDelegationPlan {
  const decomposition = goal.decomposition ?? decomposeOperatorSelfImprovementGoal(goal);

  const packets = decomposition.subTasks.map((subTask) =>
    buildGoalParallelDelegationPacket({ goal, subTask })
  );

  return {
    goalId: goal.goalId,
    packets,
    overallHandoffContract: GOAL_PARALLEL_HANDOFF_CONTRACT,
    recommendedWorkflowDraftIntent: `Create a durable parallel self-improvement workflow for goal ${goal.goalId}: ${goal.description}. Use parallel agent steps for each sub-task with the pre-framed delegation packets.`,
    aggregationQueryHints: {
      familyKnowledgeCategory: "goal_result",
      contractMetadataFilter: { goalId: goal.goalId },
    },
  };
}

export function aggregateGoalResultsFromArtifacts(params: {
  goalId: string;
  contracts?: any[];
  publishedKnowledge?: any[];
}): GoalResultAggregation {
  // Lightweight aggregator. In production this would query real stores.
  const { goalId, contracts = [], publishedKnowledge = [] } = params;

  return {
    goalId,
    statusSummary: `Aggregated ${contracts.length} contracts and ${publishedKnowledge.length} knowledge entries for goal ${goalId}.`,
    completedSubTasks: contracts.length,
    totalSubTasks: contracts.length, // simplified
    contracts: contracts.map((c: any) => ({
      contractId: c.id || c.contractId,
      subGoalId: c.metadata?.subGoalId,
      status: c.status,
      resultSummary: c.resultSummary,
    })),
    publishedKnowledge: publishedKnowledge.map((k: any) => ({
      id: k.id,
      title: k.title,
      category: k.category,
      content: k.content,
      confidence: k.confidence,
      sourceAgentId: k.sourceAgentId,
    })),
    recommendedNextActions: [
      "Review aggregated results via curator or family search",
      "Promote high-value artifacts",
      "Spawn follow-up goal if gaps remain",
    ],
    confidence: 0.75,
  };
}

export const OPERATOR_GOAL_PRIMITIVES_VERSION = "2026.05.wf2-wf3.goal-parallel-delegation.1";
