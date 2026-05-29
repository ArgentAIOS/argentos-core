/**
 * Capability Delegation — Opinionated helpers for primary operator self-building work.
 *
 * Phase 1 focus: Stronger / More Opinionated Delegation for Self-Building.
 * Extended for wf-1/wf-6 (Operator-Owned Continuous Self-Improvement via Workflows):
 *   - Workflow authoring/review delegation packets for goal-driven parallel work.
 *   - Workflows treated as first-class self-extension artifacts (ownerAgentId, versioned, publishable patterns).
 *
 * This module provides:
 * - Tuned tool allow/deny lists for "capability_work" / "build_for_me" tasks
 *   (skill authoring, Personal Skill candidate review/research/refinement, procedure building, *workflow authoring*).
 * - High-quality task framing with explicit handoff contracts and automatic knowledge return
 *   expectations (via family publish + family message back to operator).
 * - Reusable builders for "delegate review on this Personal Skill candidate", general
 *   capability building, and now workflow self-extension authoring.
 *
 * All usage is intended exclusively for the primary operator fast path (isPrimaryOperator / createLightOperatorTools).
 * No changes to default dispatch/spawn behavior for other agents or normal family use.
 *
 * Uses existing machinery: DispatchContract (via family dispatch_contracted when possible),
 * family shared knowledge (publish for return), family messages for handoff notification,
 * and the established review prompt + candidate machinery.
 *
 * Constraints respected:
 * - Zero impact on default behavior.
 * - Gated conceptually behind light operator tool surface / curator-tool / workflow-builder (operator mode).
 * - Leverages DispatchContract + family publish for provenance and return of artifacts (skills *and* workflows).
 */
import type { PersonalSkillCandidate } from "../../memory/memu-types.js";
import {
  buildPersonalSkillCandidateReviewPrompt,
} from "../skills/personal.js";

// ── Tuned Tool Grants for Capability / Self-Building Work ─────────────────────

/**
 * Recommended allowlist when delegating capability-building or Personal Skill review/refinement work.
 * Focused on research, analysis, memory access, skill authoring surface, and return of knowledge.
 * Conservative: excludes raw exec/bash, broad write/edit to FS, ticket mutation, etc.
 */
export const CAPABILITY_DELEGATION_TOOL_ALLOWLIST: string[] = [
  "personal_skill", // bidirectional authoring (create/patch/propose for candidates)
  "skills", // status + write actions for candidates
  "memory_recall",
  "memory_store",
  "memory_categories",
  "family", // critical: publish + message to return knowledge + handoff to operator
  "read",
  "web_search",
  "web_fetch",
  "doc_panel",
  "doc_panel_get",
  "doc_panel_list",
  "doc_panel_search",
  "os_docs",
  "sessions_send",
  "sessions_list",
  "sessions_history",
];

/**
 * Recommended denylist for capability delegation (defense in depth).
 * Prevents accidental high-risk actions during research/refinement work.
 */
export const CAPABILITY_DELEGATION_TOOL_DENY: string[] = [
  "exec",
  "bash",
  "write",
  "edit",
  "atera_ticket",
  "doc_panel_update",
  "doc_panel_delete",
  "tasks",
];

// ── Workflow-specific extension (wf-1) ────────────────────────────────────────

/**
 * Extended allowlist for workflow authoring / review delegation tasks.
 * Includes workflow_builder (the operator's primary authoring surface) plus the core capability list.
 * Used by workflow_builder.delegate_build and curator/general delegation when domain includes "workflow".
 */
export const WORKFLOW_DELEGATION_TOOL_ALLOWLIST: string[] = [
  ...CAPABILITY_DELEGATION_TOOL_ALLOWLIST,
  "workflow_builder", // direct access to create/edit/version/promote self-improvement workflows as owned artifacts
];

/**
 * Denylist for workflow delegation (same conservative baseline).
 */
export const WORKFLOW_DELEGATION_TOOL_DENY: string[] = [
  ...CAPABILITY_DELEGATION_TOOL_DENY,
];

// ── Task Framing & Handoff Contracts ──────────────────────────────────────────

const CAPABILITY_HANDOFF_EXPECTATIONS = `
## CAPABILITY WORK DELEGATION CONTRACT (PRIMARY OPERATOR)

You are performing self-extension / capability-building work on behalf of the primary operator (the "argent" / main system agent).

**Core Rules (non-negotiable):**
- Stay strictly within the tool grants provided for this run.
- Focus exclusively on the assigned goal (review, research, refinement, or creation of a durable Personal Skill, procedure, *workflow*, or pattern).
- Do not perform unrelated execution or high-risk actions.

**Handoff & Knowledge Return Expectations (complete before finishing):**
1. Produce a clear, structured final answer containing:
   - Summary of work performed and key findings/evidence reviewed.
   - Concrete proposal or artifact (e.g. improved procedureOutline, recommended state change, patch suggestions, new candidate details, or promotion rationale; *or a complete workflow draft/updated version with ownerAgentId*).
   - Confidence assessment and supporting evidence counts where relevant.
2. **Return knowledge to the family** (automatic visibility to operator):
   - Use the "family" tool with action="publish".
   - category: "pattern" or "lesson" (prefer "pattern" for reusable procedures; "workflow" or "pattern" for authored self-improvement workflows).
   - title: "Capability delegation outcome: <short goal summary> [candidate:<id if applicable> | workflow:<id if applicable>]"
   - content: concise but complete record of the proposal + evidence + recommended next action for the operator.
   - confidence: your assessed confidence (0-1).
   - source_agent_id: your own family agent id.
3. Notify the primary operator via family message:
   - Use family action="message", recipient="argent" (or the explicit requester if provided).
   - message_type: "lesson_shared" or "task_handoff".
   - content: JSON-like summary including any dispatch contract id, candidate id, your proposal headline, and reference to the published knowledge entry.
4. If a dispatch contract is active for this work, include its id in your final summary and (if the spawn context allows) append completion events where possible.

**Result Format Preference:**
End with a short machine-readable block the operator can parse:
CAPABILITY_DELEGATION_RESULT:
{
  "goal": "...",
  "candidateId": "..." | null,
  "workflowId": "..." | null,
  "proposal": { ... },
  "recommendedAction": "promote" | "incubate" | "patch" | "reject" | "more_research" | "save_workflow",
  "publishedKnowledgeId": "...",
  "contractId": "..." | null,
  "confidence": 0.0
}

This contract ensures the operator receives both immediate structured output *and* durable, searchable knowledge via the family library and MemU/SIS pipelines.
`.trim();

// ── Builders ──────────────────────────────────────────────────────────────────

/**
 * Build a fully framed task for capability-building delegation ("build_for_me" style).
 * Prepends the standard handoff contract + expectations.
 * Optionally injects Personal Skill candidate review context using the canonical prompt.
 */
export function buildCapabilityDelegationTask(params: {
  goal: string;
  context?: string;
  candidate?: PersonalSkillCandidate | null;
  candidateId?: string;
  expectedDeliverables?: string;
  requesterAgentId?: string; // for the message handoff target (usually "argent")
}): {
  framedTask: string;
  recommendedToolsAllow: string[];
  recommendedToolsDeny: string[];
  suggestedPurpose: string;
  handoffExpectations: string;
  metadata: Record<string, unknown>;
} {
  const {
    goal,
    context = "",
    candidate = null,
    candidateId,
    expectedDeliverables = "Structured proposal, evidence summary, recommended state change or patch, and published knowledge return.",
    requesterAgentId = "argent",
  } = params;

  let reviewBlock = "";
  if (candidate) {
    reviewBlock = "\n" + buildPersonalSkillCandidateReviewPrompt([candidate]);
  } else if (context && context.includes("Personal Skill")) {
    reviewBlock = `\n\n## Additional Context for Review\n${context}`;
  }

  const effectiveCandidateId = candidate?.id ?? candidateId ?? null;

  const framedTask = [
    CAPABILITY_HANDOFF_EXPECTATIONS,
    "",
    `## ASSIGNED GOAL`,
    goal.trim(),
    "",
    reviewBlock,
    context ? `\n## Supplementary Context\n${context}\n` : "",
    `## Expected Deliverables`,
    expectedDeliverables,
    "",
    `## Handoff Details`,
    `- Requester / return target: ${requesterAgentId}`,
    effectiveCandidateId ? `- Target candidateId: ${effectiveCandidateId}` : "",
    "",
    "Begin work. When complete, follow the return expectations exactly.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    framedTask,
    recommendedToolsAllow: [...CAPABILITY_DELEGATION_TOOL_ALLOWLIST],
    recommendedToolsDeny: [...CAPABILITY_DELEGATION_TOOL_DENY],
    suggestedPurpose: effectiveCandidateId ? "skill_review" : "capability_build",
    handoffExpectations: CAPABILITY_HANDOFF_EXPECTATIONS,
    metadata: {
      purpose: effectiveCandidateId ? "skill_review" : "capability_build",
      candidateId: effectiveCandidateId,
      requesterAgentId,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Convenience builder specifically for "delegate review/research on this Personal Skill candidate".
 * Pulls the canonical review prompt + candidate data and frames a high-signal delegation task.
 */
export function buildPersonalSkillReviewDelegationTask(params: {
  candidate: PersonalSkillCandidate;
  extraContext?: string;
  requesterAgentId?: string;
}): ReturnType<typeof buildCapabilityDelegationTask> {
  const { candidate, extraContext = "", requesterAgentId } = params;

  const goal = `Deeply review and research this Personal Skill candidate on behalf of the primary operator. Use the provided review prompt and all available evidence (memory, family knowledge, episodes if accessible via tools). Propose concrete refinements, state transitions (incubating/promoted/rejected), patches to procedure/outline/triggers, or promotion rationale. Return both immediate structured output and durable family knowledge.`;

  const context = [
    extraContext,
    `Candidate ID: ${candidate.id}`,
    `Current state: ${candidate.state}, confidence: ${candidate.confidence.toFixed(2)}, strength: ${candidate.strength.toFixed(2)}`,
    `Title: ${candidate.title}`,
    candidate.summary ? `Summary: ${candidate.summary}` : "",
    candidate.operatorNotes ? `Operator notes: ${candidate.operatorNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return buildCapabilityDelegationTask({
    goal,
    context,
    candidate,
    candidateId: candidate.id,
    expectedDeliverables:
      "Full review analysis, evidence-backed proposal (promote / incubate / patch / reject / more research), updated procedure outline or patch diff if applicable, published knowledge entry, and family message handoff to the primary operator.",
    requesterAgentId,
  });
}

/**
 * General-purpose "create_delegation_task" helper for any self-building work the operator wants to hand off.
 * (Used by curator-tool create_delegation_task action and directly by operator via light surface.)
 */
export function createGeneralCapabilityDelegationTask(params: {
  workDescription: string;
  domainHints?: string[]; // e.g. ["personal_skill", "workflow", "memory_pattern"]
  expectedOutputFormat?: string;
  requesterAgentId?: string;
}): ReturnType<typeof buildCapabilityDelegationTask> {
  const { workDescription, domainHints = [], expectedOutputFormat, requesterAgentId } = params;

  const goal = `Execute the following capability-building task for the primary operator:\n\n${workDescription}\n\nDomain focus: ${domainHints.length ? domainHints.join(", ") : "general self-extension"}. Produce durable, reviewable artifacts that can be promoted into Personal Skills or family patterns.`;

  return buildCapabilityDelegationTask({
    goal,
    expectedDeliverables:
      expectedOutputFormat ||
      "Structured proposal or artifact, supporting evidence, recommended follow-up actions for the operator, published knowledge return via family, and explicit handoff message.",
    requesterAgentId,
  });
}

// ── Workflow Authoring Delegation (wf-1 / continuous self-improvement) ───────

/**
 * Build a framed delegation task specifically for authoring or refining operator-owned
 * self-improvement workflows (the "continuous" and "parallel" part of the new goal).
 *
 * The delegated worker receives explicit instructions to produce versioned, owned workflows
 * (ownerAgentId) and to return them via the standard publish + message + contract path.
 * The operator retains ownership and can later promote_pattern / integrate with curator / goals.
 *
 * Uses existing DispatchContract, family publish/message, and the expanded workflow_builder
 * operator surface (when the delegate also has appropriate grants).
 */
export function buildWorkflowAuthoringDelegationTask(params: {
  goal: string;
  context?: string;
  targetOwnerAgentId?: string; // Primary operator id for the resulting workflow(s)
  expectedDeliverables?: string;
  requesterAgentId?: string;
}): ReturnType<typeof buildCapabilityDelegationTask> {
  const {
    goal,
    context = "",
    targetOwnerAgentId = "argent",
    expectedDeliverables = "One or more complete, reviewable, versioned workflow artifacts (draft or saved with explicit ownerAgentId set to the target), a published family knowledge entry (category 'pattern' or 'workflow') describing the workflow as a reusable self-extension artifact, family message handoff to the requester, and a machine-readable CAPABILITY_DELEGATION_RESULT block referencing any workflowId(s) and contract.",
    requesterAgentId = "argent",
  } = params;

  const framedGoal = [
    "Author or refine one or more durable, versioned ArgentOS workflows as first-class self-extension artifacts owned by the primary operator.",
    "",
    `PRIMARY OPERATOR GOAL: ${goal.trim()}`,
    "",
    "Requirements for every delivered workflow:",
    `- Set ownerAgentId to "${targetOwnerAgentId}" (or the explicit operator id provided).`,
    "- Prefer schedule or recurring triggers suitable for continuous/standing self-improvement (curator loops, goal judging, lesson synthesis, parallel delegation orchestration, workflow versioning, Personal Skill promotion).",
    "- Use the canonical graph format (nodes, edges, canvasLayout) so it can be directly saved to the operator's workflow board.",
    "- Include sensible checkpoints, result publishing back to family knowledge / MemU, and clear success criteria where possible.",
    "- The workflow itself should be a reusable pattern the operator (and future family members) can invoke for ongoing growth.",
    "",
    "Implementation path for the delegate:",
    "- Use the workflow_builder tool (actions: draft, save_draft, list, update, promote_pattern).",
    "- After authoring, follow the full CAPABILITY WORK DELEGATION CONTRACT return steps (family.publish + family.message + structured result block + contract linkage).",
    "",
    "This is parallelizable goal-driven work. Multiple such delegations can run concurrently under DispatchContract for high-volume self-improvement.",
  ].join("\n");

  const effectiveContext = [
    context,
    `Target workflow ownerAgentId: ${targetOwnerAgentId}`,
    "Domain: workflow authoring for operator continuous self-improvement.",
  ].filter(Boolean).join("\n");

  return buildCapabilityDelegationTask({
    goal: framedGoal,
    context: effectiveContext,
    expectedDeliverables,
    requesterAgentId,
  });
}
