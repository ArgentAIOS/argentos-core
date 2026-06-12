/**
 * Worker Runtime v2 — compiled role profiles (design D1+D2, the blank-slate
 * law made structural).
 *
 * A job template compiles to a ROLE PROFILE: the complete system prompt a
 * worker run ships, plus the exact tool grants. The prompt is built UP from
 * the template — company alignment + role contract + execution-mode
 * directives + tool rules — never filtered DOWN from the operator's session.
 * If it isn't granted here, the worker never sees it.
 *
 * Profiles are cached per (templateId, templateVersion, mode, stage); a
 * template edit changes `updatedAt`, which changes the key, which invalidates
 * every variant of that template.
 */

import type { ArgentConfig } from "../config/config.js";
import type { IntentPolicyConfig } from "../config/types.intent.js";
import type { JobAssignment, JobTemplate } from "../data/types.js";
import { resolveEffectiveIntentForDepartment } from "./intent.js";
import { normalizeToolName } from "./tool-policy.js";

export type WorkerExecutionMode = "simulate" | "live";
export type WorkerDeploymentStage = "simulate" | "shadow" | "limited-live" | "live";

export type CompiledRoleProfile = {
  templateId: string;
  /** Template `updatedAt` — the version that keys cache invalidation. */
  templateVersion: number;
  executionMode: WorkerExecutionMode;
  deploymentStage: WorkerDeploymentStage;
  /**
   * The complete worker system prompt. Ships as a full replacement — nothing
   * may be appended by the run pipeline (that would be an operator leak).
   */
  systemPrompt: string;
  /**
   * Structural grants: template grants + `work_report`, normalized. Always a
   * concrete list — default-deny is the resting state, so a template with no
   * grants compiles to a worker that can only file a report.
   */
  toolsAllow: string[];
  /** D8: role-scoped model ref ("provider/model") from template.metadata.model. */
  model?: string;
  compiledAt: number;
};

export function resolveWorkerDeploymentStage(
  assignment: Pick<JobAssignment, "executionMode" | "deploymentStage">,
): WorkerDeploymentStage {
  return assignment.deploymentStage ?? (assignment.executionMode === "live" ? "live" : "simulate");
}

function readTemplateModelRef(template: JobTemplate): string | undefined {
  const raw = template.metadata?.model;
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.includes("/") ? trimmed : undefined;
}

function readSimulationScenarios(template: JobTemplate): string[] {
  const raw = template.metadata?.simulationScenarios;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * Company alignment for a worker = global intent merged with the template's
 * department. Deliberately NOT the agent-level intent overlay: that belongs
 * to the operator's agent, and workers are blank slates w.r.t. the operator.
 */
export function resolveWorkerAlignmentPolicy(params: {
  cfg: ArgentConfig;
  departmentId?: string;
}): IntentPolicyConfig | undefined {
  const intent = params.cfg.intent;
  if (!intent || intent.enabled === false) {
    return undefined;
  }
  if (params.departmentId) {
    const merged = resolveEffectiveIntentForDepartment({
      config: params.cfg,
      departmentId: params.departmentId,
    });
    if (merged) {
      return merged;
    }
  }
  return intent.global;
}

function buildAlignmentLines(params: {
  policy?: IntentPolicyConfig;
  coreValues?: string[];
  departmentId?: string;
}): string[] {
  const policy = params.policy;
  const lines: string[] = [];
  if (params.departmentId) {
    lines.push(`Department: ${params.departmentId}`);
  }
  if (policy?.objective?.trim()) {
    lines.push(`Primary objective: ${policy.objective.trim()}`);
  }
  if (params.coreValues && params.coreValues.length > 0) {
    lines.push(`Core values: ${params.coreValues.join("; ")}`);
  }
  if (policy?.tradeoffHierarchy?.length) {
    lines.push(`Tradeoff order: ${policy.tradeoffHierarchy.join(" > ")}`);
  }
  if (policy?.neverDo?.length) {
    lines.push(`Never do: ${policy.neverDo.join("; ")}`);
  }
  if (policy?.allowedActions?.length) {
    lines.push(`Allowed autonomous actions: ${policy.allowedActions.join("; ")}`);
  }
  if (policy?.requiresHumanApproval?.length) {
    lines.push(`Always require human approval: ${policy.requiresHumanApproval.join("; ")}`);
  }
  if (lines.length === 0) {
    return [];
  }
  return ["## Company Alignment", ...lines, ""];
}

function buildRelationshipLines(template: JobTemplate): string[] {
  const contract = template.relationshipContract;
  if (!contract) {
    return [];
  }
  const lines: string[] = [];
  if (contract.relationshipObjective?.trim()) {
    lines.push(`Relationship objective: ${contract.relationshipObjective.trim()}`);
  }
  if (contract.toneProfile?.trim()) {
    lines.push(`Tone profile: ${contract.toneProfile.trim()}`);
  }
  if (contract.trustPriorities?.length) {
    lines.push(`Trust priorities: ${contract.trustPriorities.join(", ")}`);
  }
  if (contract.continuityRequirements?.length) {
    lines.push(`Continuity requirements: ${contract.continuityRequirements.join(", ")}`);
  }
  if (contract.honestyRules?.length) {
    lines.push(`Honesty rules: ${contract.honestyRules.join(", ")}`);
  }
  if (contract.handoffStyle?.trim()) {
    lines.push(`Handoff style: ${contract.handoffStyle.trim()}`);
  }
  if (contract.relationalFailureModes?.length) {
    lines.push(`Avoid these relationship failures: ${contract.relationalFailureModes.join(", ")}`);
  }
  if (lines.length === 0) {
    return [];
  }
  return ["## Relationship Contract", ...lines, ""];
}

function buildExecutionModeLines(params: {
  executionMode: WorkerExecutionMode;
  deploymentStage: WorkerDeploymentStage;
  simulationScenarios: string[];
}): string[] {
  const lines = [
    "## Execution Mode",
    `Deployment stage: ${params.deploymentStage.toUpperCase()} (mode: ${params.executionMode.toUpperCase()})`,
  ];
  if (params.executionMode === "simulate" || params.deploymentStage === "shadow") {
    lines.push(
      "SIMULATION MODE IS ENFORCED.",
      "Do not perform live third-party writes.",
      "Produce draft/internal-note artifacts only and clearly mark them as simulated output.",
    );
    if (params.simulationScenarios.length > 0) {
      lines.push(`Simulation scenarios: ${params.simulationScenarios.join(" | ")}`);
    }
  } else if (params.deploymentStage === "limited-live") {
    lines.push(
      "LIMITED-LIVE MODE IS ENFORCED.",
      "Stay strictly within the declared scope boundary (stated in the task message).",
      "Do not widen authority, improvise policy, or send outbound customer messaging unless the scope explicitly allows it.",
      "If the request exceeds the stated scope, stop and escalate instead of stretching the role.",
    );
  } else {
    lines.push(
      "LIVE MODE.",
      "Your actions have real external effects. Stay within the role contract and SOP exactly.",
    );
  }
  lines.push("");
  return lines;
}

function buildToolRulesLines(toolsAllow: string[]): string[] {
  return [
    "## Tool Rules",
    `Granted tools: ${toolsAllow.join(", ")}. These are the only tools that exist for you; any other tool is not granted and calls to it will fail.`,
    "Tools run ONLY through the native tool-call interface. Never write a tool invocation as message text (no <tool_call> tags, no 'call:tool{...}', no '[tool: ...]' notation) — text like that executes nothing and counts as zero work.",
    "Before reporting blocked, attempt at least two distinct recovery paths and record what failed.",
    'COMPLETION CONTRACT: end with ONE work_report tool call — outcome "done", "blocked", or "need_input" — with your COMPLETE results in the summary field (the full deliverable, not an abstract).',
    "Filing the work_report is what completes the run. Do NOT modify any task on the board, including your own — the runner records the outcome from your report.",
  ];
}

export function compileRoleProfile(params: {
  cfg: ArgentConfig;
  template: JobTemplate;
  assignment: Pick<JobAssignment, "executionMode" | "deploymentStage">;
}): CompiledRoleProfile {
  const { template } = params;
  const executionMode = params.assignment.executionMode;
  const deploymentStage = resolveWorkerDeploymentStage(params.assignment);

  // Structural grants: template grants (toolsAllow reads as `tools.grant`
  // during the v2 migration) + work_report, always. Empty grant list =
  // report-only worker — default-deny is the resting state.
  const grants = new Set<string>();
  for (const raw of template.toolsAllow ?? []) {
    const normalized = normalizeToolName(raw);
    if (normalized) {
      grants.add(normalized);
    }
  }
  grants.add("work_report");
  const toolsAllow = Array.from(grants);

  const alignmentPolicy = resolveWorkerAlignmentPolicy({
    cfg: params.cfg,
    departmentId: template.departmentId?.trim() || undefined,
  });
  // Core values are company-level (intent.global) and apply to every role;
  // only surfaced when intent is enabled (alignmentPolicy resolved).
  const coreValues = alignmentPolicy ? params.cfg.intent?.global?.coreValues : undefined;

  const lines: string[] = [
    `# Worker Role: ${template.name}`,
    `You are a worker agent filling the "${template.name}" role for this organization. You are not the operator and you do not inherit the operator's identity, memory, or tools: you have exactly the role, tools, and knowledge granted below — nothing else. Work only within this contract.`,
    "",
    ...buildAlignmentLines({
      policy: alignmentPolicy,
      coreValues,
      departmentId: template.departmentId?.trim() || undefined,
    }),
    "## Role Contract",
    template.rolePrompt.trim(),
    "",
  ];
  if (template.sop?.trim()) {
    lines.push("## Standard Operating Procedure", template.sop.trim(), "");
  }
  if (template.successDefinition?.trim()) {
    lines.push("## Definition of Done", template.successDefinition.trim(), "");
  }
  lines.push(...buildRelationshipLines(template));
  lines.push(
    ...buildExecutionModeLines({
      executionMode,
      deploymentStage,
      simulationScenarios: readSimulationScenarios(template),
    }),
  );
  lines.push(...buildToolRulesLines(toolsAllow));

  return {
    templateId: template.id,
    templateVersion: template.updatedAt,
    executionMode,
    deploymentStage,
    systemPrompt: lines.join("\n"),
    toolsAllow,
    model: readTemplateModelRef(template),
    compiledAt: Date.now(),
  };
}

// ── Cache ────────────────────────────────────────────────────────────────
// Keyed (templateId, templateVersion, mode, stage). Editing a template bumps
// updatedAt, so its stale variants stop matching; they are evicted eagerly on
// the next compile of that template so the map never accumulates dead
// versions. This also kills the per-run prompt rebuild for the worker lane.

const profileCache = new Map<string, CompiledRoleProfile>();
const cacheStats = { hits: 0, misses: 0, invalidations: 0 };

function cacheKey(template: JobTemplate, mode: WorkerExecutionMode, stage: WorkerDeploymentStage) {
  return `${template.id}@${template.updatedAt}|${mode}|${stage}`;
}

export function getCompiledRoleProfile(params: {
  cfg: ArgentConfig;
  template: JobTemplate;
  assignment: Pick<JobAssignment, "executionMode" | "deploymentStage">;
}): CompiledRoleProfile {
  const mode = params.assignment.executionMode;
  const stage = resolveWorkerDeploymentStage(params.assignment);
  const key = cacheKey(params.template, mode, stage);
  const cached = profileCache.get(key);
  if (cached) {
    cacheStats.hits += 1;
    return cached;
  }
  cacheStats.misses += 1;
  for (const existingKey of profileCache.keys()) {
    if (
      existingKey.startsWith(`${params.template.id}@`) &&
      !existingKey.startsWith(`${params.template.id}@${params.template.updatedAt}|`)
    ) {
      profileCache.delete(existingKey);
      cacheStats.invalidations += 1;
    }
  }
  const compiled = compileRoleProfile(params);
  profileCache.set(key, compiled);
  return compiled;
}

export function getRoleProfileCacheStats() {
  return { ...cacheStats, size: profileCache.size };
}

export function clearRoleProfileCache() {
  profileCache.clear();
  cacheStats.hits = 0;
  cacheStats.misses = 0;
  cacheStats.invalidations = 0;
}
