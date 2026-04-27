import type { ArgentConfig } from "../config/config.js";
import type { SkillsInstallPreferences } from "./skills/types.js";

export {
  hasBinary,
  isBundledSkillAllowed,
  isConfigPathTruthy,
  resolveBundledAllowlist,
  resolveConfigPath,
  resolveRuntimePlatform,
  resolveSkillConfig,
} from "./skills/config.js";
export {
  applySkillEnvOverrides,
  applySkillEnvOverridesFromSnapshot,
} from "./skills/env-overrides.js";
export type {
  ArgentSkillMetadata,
  SkillEligibilityContext,
  SkillCommandSpec,
  SkillEntry,
  SkillMatchCandidate,
  SkillInstallSpec,
  SkillSnapshot,
  RoomReaderActionMode,
  RoomReaderOpportunity,
  RoomReaderPatternId,
  SkillsInstallPreferences,
} from "./skills/types.js";
export {
  buildWorkspaceSkillSnapshot,
  buildWorkspaceSkillsPrompt,
  buildWorkspaceSkillCommandSpecs,
  clearSkillEntryCache,
  filterWorkspaceSkillEntries,
  loadWorkspaceSkillEntries,
  matchSkillCandidatesForPrompt,
  resolveSkillsPromptForRun,
  syncSkillsToWorkspace,
} from "./skills/workspace.js";
export {
  buildRoomReaderOpportunityPromptBlock,
  resolveRoomReaderOpportunity,
} from "./skills/room-reader.js";
export {
  buildPersonalSkillExecutionPlan,
  buildExecutablePersonalSkillContextBlock,
  evaluatePersonalSkillExecutionPlan,
  buildMatchedPersonalSkillsContextBlock,
  buildPersonalSkillCandidateReviewPrompt,
  matchPersonalSkillCandidatesForPrompt,
  mergeMatchedSkills,
  recordPersonalSkillUsage,
  reviewPersonalSkillCandidates,
  selectExecutablePersonalSkill,
} from "./skills/personal.js";

export function resolveSkillsInstallPreferences(config?: ArgentConfig): SkillsInstallPreferences {
  const raw = config?.skills?.install;
  const preferBrew = raw?.preferBrew ?? true;
  const managerRaw = typeof raw?.nodeManager === "string" ? raw.nodeManager.trim() : "";
  const manager = managerRaw.toLowerCase();
  const nodeManager: SkillsInstallPreferences["nodeManager"] =
    manager === "pnpm" || manager === "yarn" || manager === "bun" || manager === "npm"
      ? manager
      : "npm";
  return { preferBrew, nodeManager };
}
