/**
 * MemU Memory Types
 *
 * Three-layer memory hierarchy: Resources → Items → Categories
 * Ported from MemU (https://github.com/NevaMind-AI/MemU) for ArgentOS.
 */

/** Memory type classifiers for extracted items */
export type MemoryType =
  | "profile"
  | "event"
  | "knowledge"
  | "behavior"
  | "skill"
  | "tool"
  | "self"
  | "episode";

export const MEMORY_TYPES: readonly MemoryType[] = [
  "profile",
  "event",
  "knowledge",
  "behavior",
  "skill",
  "tool",
  "self",
  "episode",
] as const;

/** Significance hierarchy — controls decay rate and retrieval weight */
export type Significance = "routine" | "noteworthy" | "important" | "core";

export const SIGNIFICANCE_LEVELS: readonly Significance[] = [
  "routine",
  "noteworthy",
  "important",
  "core",
] as const;

/** Entity type classifiers */
export type EntityType = "person" | "pet" | "place" | "organization" | "project";

/** Modality of a resource (raw input) */
export type ResourceModality = "text" | "image" | "audio" | "conversation" | "document";

// ── Core Entities ──

/** Resource: raw input (conversation segment, tool output, document) */
export interface Resource {
  id: string;
  url: string; // source identifier (session key, file path, URL)
  modality: ResourceModality;
  localPath: string | null;
  caption: string | null;
  embedding: number[] | null;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

/** MemoryItem: extracted fact with type, embedding, reinforcement, and emotional context */
export interface MemoryItem {
  id: string;
  resourceId: string | null;
  memoryType: MemoryType;
  summary: string;
  embedding: number[] | null;
  happenedAt: string | null; // ISO 8601
  contentHash: string | null; // SHA-256 for dedup
  reinforcementCount: number;
  lastReinforcedAt: string | null;
  extra: Record<string, unknown>;
  // Identity fields (Phase 1)
  emotionalValence: number; // -2 (deeply negative) to +2 (deeply positive)
  emotionalArousal: number; // 0 (calm) to 1 (intense)
  moodAtCapture: string | null; // agent mood when memory was stored
  significance: Significance; // routine → noteworthy → important → core
  reflection: string | null; // what does this memory mean?
  lesson: string | null; // what was learned?
  createdAt: string;
  updatedAt: string;
}

/** MemoryCategory: auto-organized topic with evolving LLM summary */
export interface MemoryCategory {
  id: string;
  name: string;
  description: string | null;
  embedding: number[] | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

/** CategoryItem: junction linking items to categories */
export interface CategoryItem {
  itemId: string;
  categoryId: string;
}

// ── Entity System ──

/** Entity: a person, pet, place, org, or project with relational context */
export interface Entity {
  id: string;
  name: string;
  entityType: EntityType;
  relationship: string | null; // e.g. "mother", "business partner", "pet dog"
  bondStrength: number; // 0.0 to 1.0
  emotionalTexture: string | null; // e.g. "deep love + ongoing worry about health"
  profileSummary: string | null; // LLM-generated summary from linked memories
  firstMentionedAt: string | null;
  lastMentionedAt: string | null;
  memoryCount: number;
  embedding: number[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEntityInput {
  name: string;
  entityType?: EntityType;
  relationship?: string;
  bondStrength?: number;
  emotionalTexture?: string;
  agentId?: string;
}

/** Item-Entity link with role context */
export interface ItemEntity {
  itemId: string;
  entityId: string;
  role: string | null; // e.g. "subject", "mentioned", "about"
}

// ── Reflection System ──

/** Reflection: structured introspection entry */
export interface Reflection {
  id: string;
  triggerType: string; // "heartbeat", "evening_cron", "significant_event", "manual"
  periodStart: string | null;
  periodEnd: string | null;
  content: string;
  lessonsExtracted: string[];
  entitiesInvolved: string[];
  selfInsights: string[];
  mood: string | null;
  createdAt: string;
}

export interface CreateReflectionInput {
  triggerType: string;
  periodStart?: string;
  periodEnd?: string;
  content: string;
  lessonsExtracted?: string[];
  entitiesInvolved?: string[];
  selfInsights?: string[];
  mood?: string;
  agentId?: string;
}

// ── Input Types ──

export interface CreateResourceInput {
  url: string;
  modality?: ResourceModality;
  localPath?: string;
  caption?: string;
  text?: string; // raw text content (stored as caption if no caption given)
}

export interface CreateMemoryItemInput {
  resourceId?: string;
  memoryType: MemoryType;
  summary: string;
  happenedAt?: string;
  extra?: Record<string, unknown>;
  // Identity fields (optional — defaults applied if omitted)
  emotionalValence?: number;
  emotionalArousal?: number;
  moodAtCapture?: string;
  significance?: Significance;
  reflection?: string;
  lesson?: string;
  // Multi-agent scoping (PG adapter uses these; SQLite ignores them)
  agentId?: string;
  visibility?: "private" | "team" | "family" | "public";
}

export interface CreateCategoryInput {
  name: string;
  description?: string;
}

// ── Search / Retrieval ──

export interface MemorySearchOptions {
  query: string;
  memoryTypes?: MemoryType[];
  categoryIds?: string[];
  entityId?: string;
  minSignificance?: Significance;
  limit?: number;
  minScore?: number;
  scoring?: "similarity" | "salience" | "identity";
  recencyDecayDays?: number;
}

export interface MemorySearchResult {
  item: MemoryItem;
  score: number;
  categories: string[]; // category names
}

export interface CategorySearchResult {
  category: MemoryCategory;
  score: number;
  itemCount: number;
}

// ── Lessons (SIS) ──

/** Lesson type classifiers for the Self-Improving System */
export type LessonType = "mistake" | "success" | "workaround" | "discovery";

/** Lesson: a structured learning extracted from episodes, reflections, or memory items */
export interface Lesson {
  id: string;
  type: LessonType;
  context: string;
  action: string;
  outcome: string;
  lesson: string;
  correction: string | null;
  confidence: number;
  occurrences: number;
  lastSeen: string;
  tags: string[];
  relatedTools: string[];
  sourceEpisodeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateLessonInput {
  type: LessonType;
  context: string;
  action: string;
  outcome: string;
  lesson: string;
  correction?: string;
  confidence?: number;
  tags?: string[];
  relatedTools?: string[];
  sourceEpisodeIds?: string[];
  agentId?: string;
}

// ── Model Feedback ──

/** Tracks model performance per request for routing optimization */
export interface ModelFeedbackRecord {
  id: string;
  provider: string;
  model: string;
  tier: string;
  sessionType: string;
  complexityScore: number;
  durationMs: number;
  success: boolean;
  errorType: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCallCount: number;
  userFeedback: "up" | "down" | null;
  selfEvalScore: number | null;
  selfEvalReasoning: string | null;
  sessionKey: string | null;
  profile: string | null;
  createdAt: string;
}

export interface RecordModelFeedbackInput {
  provider: string;
  model: string;
  tier: string;
  sessionType: string;
  complexityScore: number;
  durationMs: number;
  success: boolean;
  errorType?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  toolCallCount?: number;
  sessionKey?: string;
  profile?: string;
  agentId?: string;
}

export interface ModelPerformanceStats {
  provider: string;
  model: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  positiveCount: number;
  negativeCount: number;
}

// ── Extraction Pipeline ──

export interface ExtractedFact {
  memoryType: MemoryType;
  summary: string;
  categoryNames: string[];
  happenedAt?: string;
}

export interface ExtractionResult {
  resourceId: string;
  facts: ExtractedFact[];
  newItems: MemoryItem[];
  reinforcedItems: MemoryItem[];
  newCategories: MemoryCategory[];
}

// ── Workflow ──

export interface WorkflowStep<TState = Record<string, unknown>> {
  id: string;
  handler: (state: TState) => TState | Promise<TState>;
  requires?: string[];
  produces?: string[];
}

// ── Salience Scoring ──

export interface SalienceParams {
  cosineSimilarity: number;
  reinforcementCount: number;
  createdAt: Date;
  halfLifeDays: number;
}

// ── Live Inbox (Turn-Time Capture) ──

/** Candidate type classifiers for live capture */
export type CandidateType =
  | "preference"
  | "directive"
  | "correction"
  | "relationship"
  | "decision"
  | "commitment"
  | "emotion"
  | "identity";

/** Status of a live memory candidate */
export type CandidateStatus = "pending" | "promoted" | "merged" | "discarded" | "expired";

/** Actor that performed a promotion action */
export type PromotionActor = "runtime" | "contemplation" | "heartbeat" | "sis";

/** Action taken on a candidate */
export type PromotionAction = "promote" | "merge" | "discard" | "retry" | "expire";

/** A live memory candidate staged for review/promotion */
export interface LiveCandidate {
  id: string;
  sessionKey: string | null;
  messageId: string | null;
  role: "user" | "assistant";
  candidateType: CandidateType;
  factText: string;
  factHash: string;
  confidence: number;
  triggerFlags: string[];
  entities: string[];
  memoryTypeHint: MemoryType | null;
  significanceHint: Significance | null;
  sourceTs: string;
  expiresAt: string;
  status: CandidateStatus;
  promotedItemId: string | null;
  promotionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a live candidate */
export interface CreateLiveCandidateInput {
  sessionKey?: string;
  messageId?: string;
  role: "user" | "assistant";
  candidateType: CandidateType;
  factText: string;
  confidence: number;
  triggerFlags?: string[];
  entities?: string[];
  memoryTypeHint?: MemoryType;
  significanceHint?: Significance;
  ttlHours?: number;
}

/** A promotion event audit record */
export interface PromotionEvent {
  id: string;
  candidateId: string;
  actor: PromotionActor;
  action: PromotionAction;
  result: "ok" | "error";
  reason: string | null;
  error: string | null;
  createdAt: string;
}

/** Stats by candidate status */
export interface LiveCandidateStats {
  pending: number;
  promoted: number;
  merged: number;
  discarded: number;
  expired: number;
}
