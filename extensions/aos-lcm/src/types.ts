/**
 * aos-lcm — Core type definitions
 *
 * Adapted from Voltropy PBC's LCM architecture.
 * Original: github.com/Martian-Engineering/lossless-claw (MIT)
 */

// ============================================================================
// Configuration
// ============================================================================

export type LcmConfig = {
  enabled: boolean;
  freshTailCount: number;
  contextThreshold: number;
  summaryModel: string;
  leafChunkTokens: number;
  leafTargetTokens: number;
  condensedTargetTokens: number;
  incrementalMaxDepth: number;
  largeFileTokenThreshold: number;
  databasePath: string;
  expansionTimeoutMs: number;
};

export const LCM_DEFAULTS: LcmConfig = {
  enabled: true,
  freshTailCount: 32,
  contextThreshold: 0.75,
  summaryModel: "auto",
  leafChunkTokens: 20_000,
  leafTargetTokens: 1_200,
  condensedTargetTokens: 2_000,
  incrementalMaxDepth: -1,
  largeFileTokenThreshold: 25_000,
  databasePath: "", // resolved at runtime to ~/.argentos/lcm.db
  expansionTimeoutMs: 120_000,
};

// ============================================================================
// Immutable Message Store
// ============================================================================

/** A persisted message in the immutable store. */
export type StoredMessage = {
  id: number;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokenCount: number;
  createdAt: string; // ISO 8601
  /** Tool call ID if this is a tool_use or tool_result block. */
  toolCallId?: string;
  /** Structured content blocks (text, tool_use, tool_result, thinking). */
  contentBlocks?: ContentBlock[];
};

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string }
  | { type: "thinking"; thinking: string };

// ============================================================================
// Summary DAG
// ============================================================================

/** A summary node in the hierarchical DAG. */
export type SummaryNode = {
  id: number;
  sessionId: string;
  depth: number;
  content: string;
  tokenCount: number;
  createdAt: string;
  /** IDs of source messages (depth 0) or source summaries (depth 1+). */
  sourceIds: number[];
  /** Whether this node has been condensed into a higher-depth node. */
  condensed: boolean;
};

/**
 * A context item is either a raw message or a summary node,
 * assembled into the active context window for a given turn.
 */
export type ContextItem =
  | { kind: "message"; message: StoredMessage }
  | { kind: "summary"; summary: SummaryNode };

// ============================================================================
// Compaction
// ============================================================================

/** Escalation levels for guaranteed convergence. */
export enum CompactionLevel {
  /** Normal summarization — preserve details. */
  NORMAL = 1,
  /** Aggressive — bullet points, half tokens. */
  AGGRESSIVE = 2,
  /** Deterministic truncation — no LLM call, 512 tokens max. */
  TRUNCATE = 3,
}

export type CompactionResult = {
  summariesCreated: number;
  messagesCompacted: number;
  tokensBefore: number;
  tokensAfter: number;
  depth: number;
  level: CompactionLevel;
};

// ============================================================================
// Large File Storage
// ============================================================================

export type StoredFile = {
  id: number;
  sessionId: string;
  filePath: string;
  tokenCount: number;
  explorationSummary: string;
  storedAt: string;
};

// ============================================================================
// Retrieval
// ============================================================================

export type GrepResult = {
  messageId: number;
  role: string;
  snippet: string;
  createdAt: string;
  rank: number;
};

export type ExpandResult = {
  nodeId: number;
  depth: number;
  expandedContent: string;
  sourceMessages: StoredMessage[];
};

// ============================================================================
// Summarization
// ============================================================================

/** Interface for the summarization backend — decoupled from model routing. */
export type Summarizer = {
  summarize(messages: StoredMessage[], opts: SummarizeOpts): Promise<string>;
};

export type SummarizeOpts = {
  depth: number;
  targetTokens: number;
  level: CompactionLevel;
  sessionContext?: string;
};
