import type { KnowledgeObservationKind } from "../memory/memu-types.js";
import type { SessionSendPolicyConfig } from "./types.base.js";

export type MemoryBackend = "builtin" | "qmd";
export type MemoryCitationsMode = "auto" | "on" | "off";
export type MemoryMemuThinkLevel = "off" | "minimal" | "low" | "medium" | "high" | "max" | "xhigh";

export type MemoryConfig = {
  backend?: MemoryBackend;
  citations?: MemoryCitationsMode;
  memu?: MemoryMemuConfig;
  observations?: MemoryObservationsConfig;
  qmd?: MemoryQmdConfig;
  vault?: MemoryVaultConfig;
  cognee?: MemoryCogneeConfig;
};

export type MemoryObservationsConfig = {
  enabled?: boolean;
  consolidation?: MemoryObservationsConsolidationConfig;
  retrieval?: MemoryObservationsRetrievalConfig;
  revalidation?: MemoryObservationsRevalidationConfig;
};

export type MemoryObservationsConsolidationConfig = {
  enabled?: boolean;
  debounceMs?: number;
  interval?: string;
  maxScopesPerRun?: number;
};

export type MemoryObservationsRetrievalConfig = {
  enabled?: boolean;
  maxResults?: number;
  minConfidence?: number;
  minFreshness?: number;
};

export type MemoryObservationsRevalidationConfig = {
  enabled?: boolean;
  interval?: string;
  kindDays?: Partial<Record<KnowledgeObservationKind, number>>;
};

export type MemoryMemuConfig = {
  llm?: MemoryMemuLlmConfig;
  sanitizer?: MemoryMemuSanitizerConfig;
};

export type MemoryMemuLlmConfig = {
  provider?: string;
  model?: string;
  thinkLevel?: MemoryMemuThinkLevel;
  timeoutMs?: number;
};

export type MemoryMemuSanitizerPolicy = "log_only" | "drop" | "drop_and_alert";

export type MemoryMemuSanitizerConfig = {
  policy?: MemoryMemuSanitizerPolicy;
};

export type MemoryQmdConfig = {
  command?: string;
  includeDefaultMemory?: boolean;
  paths?: MemoryQmdIndexPath[];
  sessions?: MemoryQmdSessionConfig;
  update?: MemoryQmdUpdateConfig;
  limits?: MemoryQmdLimitsConfig;
  scope?: SessionSendPolicyConfig;
};

export type MemoryQmdIndexPath = {
  path: string;
  name?: string;
  pattern?: string;
};

export type MemoryQmdSessionConfig = {
  enabled?: boolean;
  exportDir?: string;
  retentionDays?: number;
};

export type MemoryQmdUpdateConfig = {
  interval?: string;
  debounceMs?: number;
  onBoot?: boolean;
  embedInterval?: string;
};

export type MemoryQmdLimitsConfig = {
  maxResults?: number;
  maxSnippetChars?: number;
  maxInjectedChars?: number;
  timeoutMs?: number;
};

export type MemoryVaultConfig = {
  enabled?: boolean;
  path?: string;
  knowledgeCollection?: string;
  ingest?: MemoryVaultIngestConfig;
};

export type MemoryVaultIngestConfig = {
  enabled?: boolean;
  interval?: string;
  debounceMs?: number;
  excludePaths?: string[];
};

export type MemoryCogneeConfig = {
  enabled?: boolean;
  retrieval?: MemoryCogneeRetrievalConfig;
  embeddingDimensions?: number;
};

export type MemoryCogneeRetrievalConfig = {
  enabled?: boolean;
  timeoutMs?: number;
  triggerOnSufficiencyFail?: boolean;
  triggerOnStructuralQuery?: boolean;
  searchModes?: MemoryCogneeSearchMode[];
  maxResultsPerQuery?: number;
};

export type MemoryCogneeSearchMode =
  | "SIMILARITY"
  | "GRAPH_COMPLETION"
  | "CHUNKS"
  | "SUMMARIES"
  | "INSIGHTS";
