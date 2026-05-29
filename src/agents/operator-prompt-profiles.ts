/**
 * Operator Prompt Profiles
 *
 * Phase 0 foundation for main operator evolution (Grok Enhancements plan).
 * Centralizes the "operator_fast" vs full ceremony decisions so the hot path
 * (pi-embedded-runner/run/attempt.ts + system prompt builders) can be stable,
 * measurable, and easy to evolve.
 *
 * Goals:
 * - Keep high-signal context for the primary operator (family state, active goals,
 *   high-confidence SIS lessons, promoted Personal Skills, memory recall surface).
 * - Ruthlessly strip per-turn bloat that Hermes avoids via frozen snapshots +
 *   background prefetch (full tool schema dumps, deep MemU DAG dumps, channel
 *   capability bloat, full skills eligibility scans every turn).
 * - Everything behind isPrimaryOperator flag. No behavior change for other agents.
 *
 * Related: the light tool surface (operator-light-tools.ts) now includes the
 * extended skills tool with create/patch/promote/propose actions (see skills-tool.ts
 * for the bidirectional seam and implementation TODOs).
 */

export type OperatorPromptProfile = "operator_fast" | "full" | "subagent" | "minimal";

export interface OperatorStrippingDecisions {
  /** Omit the giant per-tool schema / summary block in the prompt */
  skipHeavyToolSummary: boolean;
  /** Drop channel-specific runtime bloat (inline buttons, reactions, TTS voice hints, etc.) */
  skipChannelBloat: boolean;
  /** Skip the expensive "scan all available_skills + eligibility" block */
  skipFullSkillsEligibility: boolean;
  /** Use a shallow or cached MemU view instead of deep DAG injection */
  skipDeepMemUInjection: boolean;
  /** For SIS lessons, only surface high-confidence / recently revalidated ones */
  useHighConfidenceLessonsOnly: boolean;
  /** Skip heavy per-turn Personal Skill candidate matching / embedding work */
  skipPersonalSkillCandidateMatching: boolean;
  /** Preserve the small stable "core identity + safety + workspace" frozen block */
  keepFrozenCoreIdentity: boolean;
  /** Whether the light curated tool surface (instead of full createArgentCodingTools) is active */
  useLightToolSurface: boolean;
}

const OPERATOR_FAST_DECISIONS: OperatorStrippingDecisions = {
  skipHeavyToolSummary: true,
  skipChannelBloat: true,
  skipFullSkillsEligibility: true,
  skipDeepMemUInjection: true,
  useHighConfidenceLessonsOnly: true,
  skipPersonalSkillCandidateMatching: false, // keep for operator power; tighten in later phase if needed
  keepFrozenCoreIdentity: true,
  useLightToolSurface: true,
};

const FULL_DECISIONS: OperatorStrippingDecisions = {
  skipHeavyToolSummary: false,
  skipChannelBloat: false,
  skipFullSkillsEligibility: false,
  skipDeepMemUInjection: false,
  useHighConfidenceLessonsOnly: false,
  skipPersonalSkillCandidateMatching: false,
  keepFrozenCoreIdentity: true,
  useLightToolSurface: false,
};

const SUBAGENT_DECISIONS: OperatorStrippingDecisions = {
  skipHeavyToolSummary: true,
  skipChannelBloat: true,
  skipFullSkillsEligibility: true,
  skipDeepMemUInjection: false, // subagents still need decent memory/MemU to do work
  useHighConfidenceLessonsOnly: false,
  skipPersonalSkillCandidateMatching: true,
  keepFrozenCoreIdentity: true,
  useLightToolSurface: false,
};

export function resolveOperatorPromptProfile(
  isPrimaryOperator?: boolean,
  explicitPromptMode?: string,
): OperatorPromptProfile {
  if (isPrimaryOperator) {
    return "operator_fast";
  }
  if (explicitPromptMode === "subagent") return "subagent";
  if (explicitPromptMode === "minimal" || explicitPromptMode === "none") return "minimal";
  return "full";
}

export function getStrippingDecisions(profile: OperatorPromptProfile): OperatorStrippingDecisions {
  switch (profile) {
    case "operator_fast":
      return OPERATOR_FAST_DECISIONS;
    case "subagent":
      return SUBAGENT_DECISIONS;
    case "minimal":
    case "full":
    default:
      return FULL_DECISIONS;
  }
}

/**
 * Returns true when we should bypass the full createArgentCodingTools explosion
 * and use the curated light operator tool surface instead.
 */
export function shouldUseLightOperatorTools(profile: OperatorPromptProfile): boolean {
  return profile === "operator_fast";
}

/**
 * Returns the effective promptMode string to pass to the legacy builders.
 * Keeps backward compatibility during the transition.
 */
export function getEffectivePromptModeForBuilder(profile: OperatorPromptProfile): "full" | "subagent" | "minimal" | "none" {
  if (profile === "operator_fast") return "minimal";
  if (profile === "subagent") return "subagent";
  if (profile === "minimal") return "minimal";
  return "full";
}
