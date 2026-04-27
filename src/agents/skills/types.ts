import type { Skill } from "../../agent-core/coding.js";

export type SkillInstallSpec = {
  id?: string;
  kind: "brew" | "node" | "go" | "uv" | "download";
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: string;
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
};

export type ArgentSkillMetadata = {
  always?: boolean;
  skillKey?: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  os?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  install?: SkillInstallSpec[];
};

export type SkillInvocationPolicy = {
  userInvocable: boolean;
  disableModelInvocation: boolean;
};

export type SkillCommandDispatchSpec = {
  kind: "tool";
  /** Name of the tool to invoke (AnyAgentTool.name). */
  toolName: string;
  /**
   * How to forward user-provided args to the tool.
   * - raw: forward the raw args string (no core parsing).
   */
  argMode?: "raw";
};

export type SkillCommandSpec = {
  name: string;
  skillName: string;
  description: string;
  /** Optional deterministic dispatch behavior for this command. */
  dispatch?: SkillCommandDispatchSpec;
};

export type SkillsInstallPreferences = {
  preferBrew: boolean;
  nodeManager: "npm" | "pnpm" | "yarn" | "bun";
};

export type ParsedSkillFrontmatter = Record<string, string>;

export type SkillEntry = {
  skill: Skill;
  frontmatter: ParsedSkillFrontmatter;
  metadata?: ArgentSkillMetadata;
  invocation?: SkillInvocationPolicy;
};

export type SkillEligibilityContext = {
  remote?: {
    platforms: string[];
    hasBin: (bin: string) => boolean;
    hasAnyBin: (bins: string[]) => boolean;
    note?: string;
  };
};

export type SkillSnapshot = {
  prompt: string;
  skills: Array<{ name: string; primaryEnv?: string }>;
  resolvedSkills?: Skill[];
  version?: number;
};

export type SkillMatchCandidate = {
  id?: string;
  name: string;
  source: string;
  kind: "generic" | "personal";
  state?: string;
  score: number;
  confidence?: number;
  provenanceCount?: number;
  reasons: string[];
};

export type RoomReaderPatternId =
  | "podcast"
  | "article"
  | "data_collection"
  | "research"
  | "workflow_automation"
  | "project_build";

export type RoomReaderActionMode = "observe" | "offer" | "activate";

export type RoomReaderOpportunity = {
  mode: RoomReaderActionMode;
  patterns: Array<{
    id: RoomReaderPatternId;
    confidence: number;
  }>;
  confidence: number;
  reasons: string[];
  recommended?: {
    kind: "skill" | "workflow";
    name: string;
    source?: string;
  };
};
