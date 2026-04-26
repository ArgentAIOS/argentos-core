/**
 * PostgreSQL Schema — Drizzle ORM definitions for ArgentOS.
 *
 * Maps the existing SQLite MemU schema to PostgreSQL with:
 *   - pgvector columns for embeddings (replacing BLOB + sqlite-vec)
 *   - JSONB columns for structured data (replacing TEXT JSON)
 *   - TIMESTAMPTZ for all timestamps (replacing TEXT ISO 8601)
 *   - tsvector + GIN indexes for full-text search (replacing FTS5)
 *   - HNSW indexes for vector similarity (replacing vec0 virtual tables)
 *   - agent_id columns + RLS policies for multi-agent isolation
 *   - visibility column for cross-agent knowledge sharing
 *
 * Port: 5433 (non-default, see ARGENT_PG_PORT in storage-config.ts)
 */

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  pgTable,
  text,
  real,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  boolean,
  bigint,
  numeric,
} from "drizzle-orm/pg-core";

// ── Custom pgvector type ─────────────────────────────────────────────────────
// Drizzle doesn't have a built-in vector type; use customType or raw SQL.
// We define embedding columns as text and cast in queries: `::vector(768)`
// The actual column type is set via raw SQL in the migration.

/**
 * Helper: creates a pgvector column definition as text.
 * The migration SQL will use `vector(768)` as the actual column type.
 * In Drizzle queries, cast with `sql\`${col}::vector\``.
 */
function vectorCol(name: string) {
  return text(name);
}

// ── Enums as string unions (no PG enums — easier to extend) ──────────────────

export type Visibility = "private" | "team" | "family" | "public";
export type AgentRole = "elder" | "researcher" | "coder" | "analyst" | "generalist";
export type AgentStatus = "active" | "inactive" | "suspended";
export type MemoryType =
  | "profile"
  | "event"
  | "knowledge"
  | "behavior"
  | "skill"
  | "tool"
  | "self"
  | "episode";
export type Significance = "routine" | "noteworthy" | "important" | "core";
export type LessonType = "discovery" | "error_correction" | "best_practice" | "anti_pattern";
export type PersonalSkillCandidateState =
  | "candidate"
  | "incubating"
  | "promoted"
  | "rejected"
  | "deprecated";
export type PersonalSkillScope = "operator" | "family" | "agent";
export type ReflectionTrigger =
  | "heartbeat"
  | "evening_cron"
  | "significant_event"
  | "manual"
  | "contemplation";
export type KnowledgeObservationKind =
  | "operator_preference"
  | "project_state"
  | "world_fact"
  | "self_model"
  | "relationship_fact"
  | "tooling_state";
export type KnowledgeObservationSubjectType = "entity" | "project" | "tool" | "agent" | "global";
export type KnowledgeObservationStatus = "active" | "stale" | "superseded" | "invalidated";
export type KnowledgeObservationEvidenceStance = "support" | "contradict" | "context";

// ============================================================================
// AGENT REGISTRY (NEW — multi-agent family)
// ============================================================================

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").$type<AgentRole>(),
    status: text("status").$type<AgentStatus>().default("active").notNull(),
    config: jsonb("config"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_agents_status").on(t.status)],
);

// ============================================================================
// RESOURCES (raw inputs — from MemU V1)
// ============================================================================

export const resources = pgTable(
  "resources",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    url: text("url").notNull().default(""),
    modality: text("modality").notNull().default("text"),
    localPath: text("local_path"),
    caption: text("caption"),
    embedding: vectorCol("embedding"),
    visibility: text("visibility").$type<Visibility>().default("private").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_resources_url").on(t.url),
    index("idx_resources_agent").on(t.agentId),
    index("idx_resources_created").on(t.createdAt),
  ],
);

// ============================================================================
// MEMORY ITEMS (extracted facts — core table, from MemU V1+V2)
// ============================================================================

export const memoryItems = pgTable(
  "memory_items",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    resourceId: text("resource_id").references(() => resources.id, {
      onDelete: "set null",
    }),
    memoryType: text("memory_type").$type<MemoryType>().notNull(),
    summary: text("summary").notNull(),
    embedding: vectorCol("embedding"),
    happenedAt: timestamp("happened_at", { withTimezone: true }),
    contentHash: text("content_hash"),
    reinforcementCount: integer("reinforcement_count").notNull().default(1),
    lastReinforcedAt: timestamp("last_reinforced_at", { withTimezone: true }),
    extra: jsonb("extra").default({}),
    // V2: Identity/emotional context
    emotionalValence: real("emotional_valence").notNull().default(0),
    emotionalArousal: real("emotional_arousal").notNull().default(0),
    moodAtCapture: text("mood_at_capture"),
    significance: text("significance").$type<Significance>().notNull().default("routine"),
    reflection: text("reflection"),
    lesson: text("lesson"),
    visibility: text("visibility").$type<Visibility>().default("private").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_items_agent").on(t.agentId),
    index("idx_items_resource").on(t.resourceId),
    index("idx_items_type").on(t.memoryType),
    index("idx_items_hash").on(t.contentHash),
    index("idx_items_created").on(t.createdAt),
    index("idx_items_reinforced").on(t.lastReinforcedAt),
    index("idx_items_significance").on(t.significance),
    index("idx_items_visibility").on(t.visibility),
    // HNSW vector index — created via raw SQL in migration:
    //   CREATE INDEX idx_items_embedding ON memory_items
    //     USING hnsw (embedding vector_cosine_ops);
    // GIN index on extra JSONB:
    //   CREATE INDEX idx_items_extra ON memory_items USING gin (extra);
    // Full-text search — created via raw SQL in migration:
    //   CREATE INDEX idx_items_fts ON memory_items
    //     USING gin (to_tsvector('english', summary || ' ' || COALESCE(reflection,'') || ' ' || COALESCE(lesson,'')));
  ],
);

// ============================================================================
// MEMORY CATEGORIES (auto-organized topics — from MemU V1)
// ============================================================================

export const memoryCategories = pgTable(
  "memory_categories",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    name: text("name").notNull(),
    description: text("description"),
    embedding: vectorCol("embedding"),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_categories_agent_name").on(t.agentId, t.name),
    index("idx_categories_agent").on(t.agentId),
  ],
);

// ============================================================================
// CATEGORY ↔ ITEM JUNCTION (many-to-many)
// ============================================================================

export const categoryItems = pgTable(
  "category_items",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => memoryCategories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.categoryId] })],
);

// ============================================================================
// ENTITIES (people, pets, places, orgs — from MemU V2)
// ============================================================================

export const entities = pgTable(
  "entities",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    name: text("name").notNull(),
    entityType: text("entity_type").notNull().default("person"),
    relationship: text("relationship"),
    bondStrength: real("bond_strength").notNull().default(0.5),
    emotionalTexture: text("emotional_texture"),
    profileSummary: text("profile_summary"),
    firstMentionedAt: timestamp("first_mentioned_at", { withTimezone: true }),
    lastMentionedAt: timestamp("last_mentioned_at", { withTimezone: true }),
    memoryCount: integer("memory_count").notNull().default(0),
    embedding: vectorCol("embedding"),
    visibility: text("visibility").$type<Visibility>().default("private").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_entities_agent_name").on(t.agentId, t.name),
    index("idx_entities_type").on(t.entityType),
    index("idx_entities_bond").on(t.bondStrength),
    index("idx_entities_agent").on(t.agentId),
  ],
);

// ============================================================================
// ITEM ↔ ENTITY JUNCTION (links items to entities)
// ============================================================================

export const itemEntities = pgTable(
  "item_entities",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    role: text("role").default("mentioned"),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.entityId] }),
    index("idx_item_entities_entity").on(t.entityId),
  ],
);

// ============================================================================
// REFLECTIONS (structured introspection — from MemU V2)
// ============================================================================

export const reflections = pgTable(
  "reflections",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    triggerType: text("trigger_type").$type<ReflectionTrigger>().notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    content: text("content").notNull(),
    lessonsExtracted: jsonb("lessons_extracted").default([]),
    entitiesInvolved: jsonb("entities_involved").default([]),
    selfInsights: jsonb("self_insights").default([]),
    mood: text("mood"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_reflections_agent").on(t.agentId),
    index("idx_reflections_trigger").on(t.triggerType),
    index("idx_reflections_created").on(t.createdAt),
  ],
);

// ============================================================================
// LESSONS (SIS — from MemU V3)
// ============================================================================

export const lessons = pgTable(
  "lessons",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    type: text("type").$type<LessonType>().notNull(),
    context: text("context").notNull(),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    lesson: text("lesson").notNull(),
    correction: text("correction"),
    confidence: real("confidence").notNull().default(0.5),
    occurrences: integer("occurrences").notNull().default(1),
    lastSeen: timestamp("last_seen", { withTimezone: true }).defaultNow().notNull(),
    tags: jsonb("tags").default([]),
    relatedTools: jsonb("related_tools").default([]),
    sourceEpisodeIds: jsonb("source_episode_ids").default([]),
    embedding: vectorCol("embedding"),
    visibility: text("visibility").$type<Visibility>().default("private").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_lessons_agent").on(t.agentId),
    index("idx_lessons_type").on(t.type),
    index("idx_lessons_confidence").on(t.confidence),
    index("idx_lessons_created").on(t.createdAt),
    index("idx_lessons_last_seen").on(t.lastSeen),
    // HNSW vector index — created via raw SQL in migration:
    //   CREATE INDEX idx_lessons_embedding ON lessons
    //     USING hnsw (embedding vector_cosine_ops);
    // FTS index — created via raw SQL in migration:
    //   CREATE INDEX idx_lessons_fts ON lessons
    //     USING gin (to_tsvector('english', context || ' ' || action || ' ' || outcome || ' ' || lesson));
  ],
);

// ============================================================================
// PERSONAL SKILL CANDIDATES
// ============================================================================

export const personalSkillCandidates = pgTable(
  "personal_skill_candidates",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    operatorId: text("operator_id"),
    profileId: text("profile_id"),
    scope: text("scope").$type<PersonalSkillScope>().notNull().default("operator"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    triggerPatterns: jsonb("trigger_patterns")
      .notNull()
      .default(sql`'[]'::jsonb`),
    procedureOutline: text("procedure_outline"),
    preconditions: jsonb("preconditions")
      .notNull()
      .default(sql`'[]'::jsonb`),
    executionSteps: jsonb("execution_steps")
      .notNull()
      .default(sql`'[]'::jsonb`),
    expectedOutcomes: jsonb("expected_outcomes")
      .notNull()
      .default(sql`'[]'::jsonb`),
    relatedTools: jsonb("related_tools")
      .notNull()
      .default(sql`'[]'::jsonb`),
    sourceMemoryIds: jsonb("source_memory_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    sourceEpisodeIds: jsonb("source_episode_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    sourceTaskIds: jsonb("source_task_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    sourceLessonIds: jsonb("source_lesson_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    supersedesCandidateIds: jsonb("supersedes_candidate_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    supersededByCandidateId: text("superseded_by_candidate_id"),
    conflictsWithCandidateIds: jsonb("conflicts_with_candidate_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    contradictionCount: integer("contradiction_count").notNull().default(0),
    evidenceCount: integer("evidence_count").notNull().default(0),
    recurrenceCount: integer("recurrence_count").notNull().default(1),
    confidence: real("confidence").notNull().default(0.5),
    strength: real("strength").notNull().default(0.5),
    usageCount: integer("usage_count").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    state: text("state").$type<PersonalSkillCandidateState>().notNull().default("candidate"),
    operatorNotes: text("operator_notes"),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastReinforcedAt: timestamp("last_reinforced_at", { withTimezone: true }),
    lastContradictedAt: timestamp("last_contradicted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_personal_skill_candidates_agent").on(t.agentId),
    index("idx_personal_skill_candidates_state").on(t.state),
    index("idx_personal_skill_candidates_scope").on(t.scope),
    index("idx_personal_skill_candidates_confidence").on(t.confidence),
    index("idx_personal_skill_candidates_updated").on(t.updatedAt),
  ],
);

export const personalSkillReviews = pgTable(
  "personal_skill_reviews",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id").notNull(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    actorType: text("actor_type").notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    details: jsonb("details")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_personal_skill_reviews_candidate").on(t.candidateId, t.createdAt),
    index("idx_personal_skill_reviews_agent").on(t.agentId, t.createdAt),
  ],
);

// ============================================================================
// KNOWLEDGE OBSERVATIONS (synthesized believed truth layer)
// ============================================================================

export const knowledgeObservations = pgTable(
  "knowledge_observations",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    kind: text("kind").$type<KnowledgeObservationKind>().notNull(),
    subjectType: text("subject_type").$type<KnowledgeObservationSubjectType>().notNull(),
    subjectId: text("subject_id"),
    canonicalKey: text("canonical_key").notNull(),
    summary: text("summary").notNull(),
    detail: text("detail"),
    confidence: real("confidence").notNull().default(0.5),
    confidenceComponents: jsonb("confidence_components")
      .notNull()
      .default(sql`'{}'::jsonb`),
    freshness: real("freshness").notNull().default(1),
    revalidationDueAt: timestamp("revalidation_due_at", { withTimezone: true }),
    supportCount: integer("support_count").notNull().default(0),
    sourceDiversity: integer("source_diversity").notNull().default(0),
    contradictionWeight: real("contradiction_weight").notNull().default(0),
    operatorConfirmed: boolean("operator_confirmed").notNull().default(false),
    status: text("status").$type<KnowledgeObservationStatus>().notNull().default("active"),
    firstSupportedAt: timestamp("first_supported_at", { withTimezone: true }),
    lastSupportedAt: timestamp("last_supported_at", { withTimezone: true }),
    lastContradictedAt: timestamp("last_contradicted_at", { withTimezone: true }),
    supersedesObservationId: text("supersedes_observation_id").references(
      (): AnyPgColumn => knowledgeObservations.id,
      { onDelete: "set null" },
    ),
    embedding: vectorCol("embedding"),
    tags: jsonb("tags")
      .notNull()
      .default(sql`'[]'::jsonb`),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    visibility: text("visibility").$type<Visibility>().default("private").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_knowledge_obs_agent_kind_status").on(t.agentId, t.kind, t.status),
    index("idx_knowledge_obs_agent_subject_status").on(
      t.agentId,
      t.subjectType,
      t.subjectId,
      t.status,
    ),
    index("idx_knowledge_obs_agent_canonical").on(t.agentId, t.canonicalKey),
    index("idx_knowledge_obs_agent_revalidation_due").on(t.agentId, t.revalidationDueAt),
    index("idx_knowledge_obs_agent_last_supported").on(t.agentId, t.lastSupportedAt),
    index("idx_knowledge_obs_visibility").on(t.visibility),
    // Partial unique index for active truths is created in SQL migration:
    //   CREATE UNIQUE INDEX idx_knowledge_obs_active_canonical_unique
    //   ON knowledge_observations (agent_id, canonical_key)
    //   WHERE status = 'active';
    // HNSW vector index — created via raw SQL in migration:
    //   CREATE INDEX idx_knowledge_obs_embedding ON knowledge_observations
    //     USING hnsw (embedding vector_cosine_ops);
    // FTS index — created via raw SQL in migration:
    //   CREATE INDEX idx_knowledge_obs_fts ON knowledge_observations
    //     USING gin (
    //       to_tsvector(
    //         'english',
    //         summary || ' ' || COALESCE(detail, '') || ' ' ||
    //         COALESCE(array_to_string(ARRAY(SELECT jsonb_array_elements_text(tags)), ' '), '')
    //       )
    //     );
  ],
);

export const knowledgeObservationEvidence = pgTable(
  "knowledge_observation_evidence",
  {
    id: text("id").primaryKey(),
    observationId: text("observation_id")
      .notNull()
      .references(() => knowledgeObservations.id, { onDelete: "cascade" }),
    stance: text("stance").$type<KnowledgeObservationEvidenceStance>().notNull(),
    weight: real("weight").notNull().default(1),
    excerpt: text("excerpt"),
    itemId: text("item_id").references(() => memoryItems.id, { onDelete: "set null" }),
    lessonId: text("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
    reflectionId: text("reflection_id").references(() => reflections.id, {
      onDelete: "set null",
    }),
    entityId: text("entity_id").references(() => entities.id, { onDelete: "set null" }),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_knowledge_obs_evidence_observation").on(t.observationId),
    index("idx_knowledge_obs_evidence_stance").on(t.stance),
    index("idx_knowledge_obs_evidence_item").on(t.itemId),
    index("idx_knowledge_obs_evidence_lesson").on(t.lessonId),
    index("idx_knowledge_obs_evidence_reflection").on(t.reflectionId),
    index("idx_knowledge_obs_evidence_entity").on(t.entityId),
  ],
);

// ============================================================================
// MODEL FEEDBACK (complexity routing — from MemU V4)
// ============================================================================

export const modelFeedback = pgTable(
  "model_feedback",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    tier: text("tier").notNull(),
    sessionType: text("session_type").notNull(),
    complexityScore: real("complexity_score").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    success: boolean("success").notNull().default(true),
    errorType: text("error_type"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    userFeedback: text("user_feedback"),
    sessionKey: text("session_key"),
    profile: text("profile"),
    selfEvalScore: real("self_eval_score"),
    selfEvalReasoning: text("self_eval_reasoning"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_mf_agent").on(t.agentId),
    index("idx_mf_provider_model").on(t.provider, t.model),
    index("idx_mf_tier").on(t.tier),
    index("idx_mf_session_type").on(t.sessionType),
    index("idx_mf_created").on(t.createdAt),
    index("idx_mf_success").on(t.success),
  ],
);

// ============================================================================
// SHARED KNOWLEDGE LIBRARY (NEW — cross-agent knowledge)
// ============================================================================

export const sharedKnowledge = pgTable(
  "shared_knowledge",
  {
    id: text("id").primaryKey(),
    sourceAgentId: text("source_agent_id")
      .notNull()
      .references(() => agents.id),
    sourceItemId: text("source_item_id").references(() => memoryItems.id, {
      onDelete: "set null",
    }),
    category: text("category").notNull(), // lesson, fact, tool_tip, pattern
    title: text("title").notNull(),
    content: text("content").notNull(),
    embedding: vectorCol("embedding"),
    confidence: real("confidence").notNull().default(0.5),
    endorsements: integer("endorsements").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_shared_knowledge_agent").on(t.sourceAgentId),
    index("idx_shared_knowledge_category").on(t.category),
    index("idx_shared_knowledge_confidence").on(t.confidence),
    // HNSW vector index — created via raw SQL in migration:
    //   CREATE INDEX idx_shared_knowledge_embedding ON shared_knowledge
    //     USING hnsw (embedding vector_cosine_ops);
  ],
);

// ============================================================================
// KNOWLEDGE COLLECTION ACL (NEW — RAG bucket access control)
// ============================================================================

export const knowledgeCollections = pgTable(
  "knowledge_collections",
  {
    id: text("id").primaryKey(),
    collectionName: text("collection_name").notNull(),
    collectionTag: text("collection_tag").notNull(),
    ownerAgentId: text("owner_agent_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_knowledge_collections_tag").on(t.collectionTag),
    index("idx_knowledge_collections_owner").on(t.ownerAgentId),
  ],
);

export const knowledgeCollectionGrants = pgTable(
  "knowledge_collection_grants",
  {
    id: text("id").primaryKey(),
    collectionId: text("collection_id")
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    canRead: boolean("can_read").notNull().default(true),
    canWrite: boolean("can_write").notNull().default(false),
    isOwner: boolean("is_owner").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_knowledge_collection_grants_unique").on(t.collectionId, t.agentId),
    index("idx_knowledge_collection_grants_agent").on(t.agentId),
    index("idx_knowledge_collection_grants_collection").on(t.collectionId),
  ],
);

// ============================================================================
// TASKS (migrated from dashboard.db)
// ============================================================================

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").references(() => agents.id),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("pending"),
    priority: text("priority").notNull().default("normal"),
    source: text("source").notNull().default("user"),
    assignee: text("assignee"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    sessionId: text("session_id"),
    channelId: text("channel_id"),
    parentTaskId: text("parent_task_id"),
    dependsOn: jsonb("depends_on").default([]),
    teamId: text("team_id"),
    tags: jsonb("tags").default([]),
    metadata: jsonb("metadata").default({}),
    jobAssignmentId: text("job_assignment_id"),
    jobTemplateId: text("job_template_id"),
  },
  (t) => [
    index("idx_tasks_status").on(t.status),
    index("idx_tasks_priority").on(t.priority),
    index("idx_tasks_agent").on(t.agentId),
    index("idx_tasks_due").on(t.dueAt),
    index("idx_tasks_team").on(t.teamId),
    index("idx_tasks_job_assignment").on(t.jobAssignmentId),
    index("idx_tasks_job_template").on(t.jobTemplateId),
    // FTS index — created via raw SQL in migration:
    //   CREATE INDEX idx_tasks_fts ON tasks
    //     USING gin (to_tsvector('english', title || ' ' || COALESCE(description, '')));
  ],
);

// ============================================================================
// JOBS / WORKFORCE (ported from dashboard SQLite jobs module)
// ============================================================================

export const jobTemplates = pgTable(
  "job_templates",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    departmentId: text("department_id"),
    description: text("description"),
    rolePrompt: text("role_prompt").notNull(),
    sop: text("sop"),
    successDefinition: text("success_definition"),
    defaultMode: text("default_mode").notNull().default("simulate"),
    defaultStage: text("default_stage"),
    toolsAllow: jsonb("tools_allow").default([]),
    toolsDeny: jsonb("tools_deny").default([]),
    relationshipContract: jsonb("relationship_contract").default({}),
    tags: jsonb("tags").default([]),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_job_templates_name").on(t.name)],
);

export const jobAssignments = pgTable(
  "job_assignments",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => jobTemplates.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    title: text("title").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    cadenceMinutes: integer("cadence_minutes").notNull().default(1440),
    executionMode: text("execution_mode").notNull().default("simulate"),
    deploymentStage: text("deployment_stage"),
    promotionState: text("promotion_state"),
    scopeLimit: text("scope_limit"),
    reviewRequired: boolean("review_required").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_job_assignments_agent").on(t.agentId),
    index("idx_job_assignments_next_run").on(t.nextRunAt),
  ],
);

export const jobRuns = pgTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => jobAssignments.id, { onDelete: "cascade" }),
    templateId: text("template_id")
      .notNull()
      .references(() => jobTemplates.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    executionMode: text("execution_mode").notNull(),
    deploymentStage: text("deployment_stage"),
    reviewStatus: text("review_status"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    summary: text("summary"),
    blockers: text("blockers"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_job_runs_assignment").on(t.assignmentId),
    index("idx_job_runs_task").on(t.taskId),
  ],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    source: text("source").notNull(),
    idempotencyKey: text("idempotency_key"),
    targetAgentId: text("target_agent_id"),
    payload: jsonb("payload").default({}),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    outcome: text("outcome"),
  },
  (t) => [
    uniqueIndex("idx_job_events_idempotency_key").on(t.idempotencyKey),
    index("idx_job_events_unprocessed").on(t.processedAt, t.createdAt),
  ],
);

// ============================================================================
// TEAMS (migrated from dashboard.db)
// ============================================================================

export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    leadSessionKey: text("lead_session_key").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    config: jsonb("config"),
  },
  (t) => [index("idx_teams_status").on(t.status)],
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    sessionKey: text("session_key").notNull(),
    role: text("role").notNull().default("worker"),
    label: text("label"),
    status: text("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.sessionKey] }),
    index("idx_team_members_session").on(t.sessionKey),
  ],
);

// ============================================================================
// SESSIONS (migrated from sessions.db / memo.db)
// ============================================================================

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    sessionKey: text("session_key").notNull(),
    channelId: text("channel_id"),
    status: text("status").notNull().default("active"),
    projectPath: text("project_path"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    messageCount: integer("message_count").notNull().default(0),
    tokenCount: integer("token_count").default(0),
    summary: text("summary"),
    metadata: jsonb("metadata").default({}),
  },
  (t) => [
    uniqueIndex("idx_sessions_key").on(t.sessionKey),
    index("idx_sessions_agent").on(t.agentId),
    index("idx_sessions_status").on(t.status),
    index("idx_sessions_started").on(t.startedAt),
  ],
);

// ============================================================================
// OBSERVATIONS (session events — from memo.db)
// ============================================================================

export const observations = pgTable(
  "observations",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agents.id),
    type: text("type").notNull().default("tool_result"),
    toolName: text("tool_name"),
    input: text("input"),
    output: text("output"),
    summary: text("summary"),
    channelId: text("channel_id"),
    importance: integer("importance").notNull().default(5),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_observations_session").on(t.sessionId),
    index("idx_observations_agent").on(t.agentId),
    index("idx_observations_type").on(t.type),
    index("idx_observations_created").on(t.createdAt),
    index("idx_observations_importance").on(t.importance),
    // FTS index — created via raw SQL in migration:
    //   CREATE INDEX idx_observations_fts ON observations
    //     USING gin (to_tsvector('english', COALESCE(summary,'') || ' ' || COALESCE(output,'')));
  ],
);

// ============================================================================
// DISPATCH CONTRACTS (Contracted Dispatch v1)
// ============================================================================

export const dispatchContracts = pgTable(
  "dispatch_contracts",
  {
    contractId: text("contract_id").primaryKey(),
    taskId: text("task_id"),
    task: text("task").notNull(),
    targetAgentId: text("target_agent_id").notNull(),
    dispatchedBy: text("dispatched_by").notNull(),
    toolGrantSnapshot: jsonb("tool_grant_snapshot")
      .notNull()
      .default(sql`'[]'::jsonb`),
    timeoutMs: integer("timeout_ms").notNull(),
    heartbeatIntervalMs: integer("heartbeat_interval_ms").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    resultSummary: text("result_summary"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    index("idx_dispatch_contracts_status").on(t.status),
    index("idx_dispatch_contracts_target_agent").on(t.targetAgentId),
    index("idx_dispatch_contracts_task").on(t.taskId),
    index("idx_dispatch_contracts_created").on(t.createdAt),
  ],
);

export const dispatchContractEvents = pgTable(
  "dispatch_contract_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    contractId: text("contract_id")
      .notNull()
      .references(() => dispatchContracts.contractId, { onDelete: "cascade" }),
    status: text("status").notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).defaultNow().notNull(),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    index("idx_dispatch_contract_events_contract").on(t.contractId),
    index("idx_dispatch_contract_events_time").on(t.eventAt),
  ],
);

// ============================================================================
// SERVICE KEYS (encrypted secrets — migrated from service-keys.json)
// ============================================================================

export const serviceKeys = pgTable(
  "service_keys",
  {
    id: text("id").primaryKey(),
    variable: text("variable").notNull(),
    name: text("name").notNull(),
    /** AES-256-GCM encrypted value (format: "enc:v1:<iv>:<tag>:<ciphertext>") */
    encryptedValue: text("encrypted_value").notNull(),
    service: text("service"),
    category: text("category"),
    enabled: boolean("enabled").notNull().default(true),
    source: text("source").$type<"manual" | "org-sync" | "env">().default("manual"),
    allowedRoles: text("allowed_roles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allowedAgents: text("allowed_agents")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allowedTeams: text("allowed_teams")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    denyAll: boolean("deny_all").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_service_keys_variable").on(t.variable),
    index("idx_service_keys_category").on(t.category),
    index("idx_service_keys_enabled").on(t.enabled),
  ],
);

// ============================================================================
// AUTH CREDENTIALS (encrypted auth profiles — migrated from auth-profiles.json)
// ============================================================================

export const authCredentials = pgTable(
  "auth_credentials",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id").notNull(),
    provider: text("provider").notNull(),
    credentialType: text("credential_type").$type<"api_key" | "oauth" | "token">().notNull(),
    /** AES-256-GCM encrypted credential payload (JSON) */
    encryptedPayload: text("encrypted_payload").notNull(),
    email: text("email"),
    enabled: boolean("enabled").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    errorCount: integer("error_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_auth_credentials_profile").on(t.profileId),
    index("idx_auth_credentials_provider").on(t.provider),
    index("idx_auth_credentials_type").on(t.credentialType),
    index("idx_auth_credentials_enabled").on(t.enabled),
  ],
);

// ============================================================================
// WORKFLOWS (visual multi-agent pipeline engine)
// ============================================================================

export type WorkflowRunStatus =
  | "created"
  | "running"
  | "waiting_approval"
  | "waiting_event"
  | "waiting_duration"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowStepRunStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "retrying"
  | "skipped";

export type WorkflowDeploymentStage = "simulate" | "shadow" | "limited_live" | "live";

export type WorkflowApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "edited"
  | "escalated"
  | "timed_out";

export const workflows = pgTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    ownerAgentId: text("owner_agent_id").default("argent"),
    departmentId: text("department_id"),
    version: integer("version").default(1),
    isActive: boolean("is_active").default(true),

    // The graph
    nodes: jsonb("nodes")
      .notNull()
      .default(sql`'[]'::jsonb`),
    edges: jsonb("edges")
      .notNull()
      .default(sql`'[]'::jsonb`),
    canvasLayout: jsonb("canvas_layout").default(sql`'{}'::jsonb`),

    // Execution defaults
    defaultOnError: jsonb("default_on_error").default(
      sql`'{"strategy":"fail","notifyOnError":true}'::jsonb`,
    ),
    errorWorkflowId: text("error_workflow_id"),
    maxRunDurationMs: integer("max_run_duration_ms").default(3600000),
    maxRunCostUsd: numeric("max_run_cost_usd", { precision: 10, scale: 4 }),
    monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 10, scale: 4 }),

    // Trigger config
    triggerType: text("trigger_type"),
    triggerConfig: jsonb("trigger_config"),
    nextFireAt: timestamp("next_fire_at", { withTimezone: true }),

    // Deployment stage (Core defaults to 'live')
    deploymentStage: text("deployment_stage").$type<WorkflowDeploymentStage>().default("live"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_workflows_trigger").on(t.triggerType),
    index("idx_workflows_owner").on(t.ownerAgentId),
    index("idx_workflows_active").on(t.isActive),
  ],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    nodes: jsonb("nodes").notNull(),
    edges: jsonb("edges").notNull(),
    canvasLayout: jsonb("canvas_layout"),
    changedBy: text("changed_by"),
    changeSummary: text("change_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_workflow_versions_unique").on(t.workflowId, t.version),
    index("idx_workflow_versions_workflow").on(t.workflowId),
  ],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    workflowVersion: integer("workflow_version").notNull(),
    status: text("status").$type<WorkflowRunStatus>().default("created"),
    triggerType: text("trigger_type").notNull(),
    triggerPayload: jsonb("trigger_payload"),

    // Progress
    currentNodeId: text("current_node_id"),
    variables: jsonb("variables").default(sql`'{}'::jsonb`),

    // Cost
    totalTokensUsed: integer("total_tokens_used").default(0),
    totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 4 }).default("0"),

    // Timing
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    error: text("error"),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  },
  (t) => [
    index("idx_wfruns_workflow").on(t.workflowId),
    index("idx_wfruns_status").on(t.status),
    index("idx_wfruns_started").on(t.startedAt),
  ],
);

export const workflowStepRuns = pgTable(
  "workflow_step_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    nodeKind: text("node_kind").notNull(),

    // Execution
    status: text("status").$type<WorkflowStepRunStatus>().default("pending"),
    agentId: text("agent_id"),
    taskId: text("task_id"),
    idempotencyKey: text("idempotency_key"),

    // Data
    inputContext: jsonb("input_context"),
    outputItems: jsonb("output_items"),
    variablesSet: jsonb("variables_set").default(sql`'{}'::jsonb`),

    // Cost
    tokensUsed: integer("tokens_used").default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).default("0"),
    modelUsed: text("model_used"),

    // Timing
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    retryCount: integer("retry_count").default(0),
    error: text("error"),

    // BUSINESS: Approval (null in Core)
    approvalStatus: text("approval_status").$type<WorkflowApprovalStatus>(),
    approvedBy: text("approved_by"),
    approvalNote: text("approval_note"),
    editedOutput: jsonb("edited_output"),
  },
  (t) => [
    index("idx_stepruns_run").on(t.runId),
    index("idx_stepruns_status").on(t.status),
    uniqueIndex("idx_stepruns_idempotency").on(t.idempotencyKey),
  ],
);

export const workflowApprovals = pgTable(
  "workflow_approvals",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    workflowName: text("workflow_name"),
    nodeLabel: text("node_label"),
    message: text("message").notNull(),
    sideEffectClass: text("side_effect_class"),
    previousOutputPreview: jsonb("previous_output_preview"),
    approveAction: jsonb("approve_action").default(sql`'{}'::jsonb`),
    denyAction: jsonb("deny_action").default(sql`'{}'::jsonb`),
    timeoutAt: timestamp("timeout_at", { withTimezone: true }),
    timeoutAction: text("timeout_action").$type<"approve" | "deny">().default("deny"),
    status: text("status").$type<WorkflowApprovalStatus>().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    resolutionNote: text("resolution_note"),
    notificationStatus: text("notification_status").default("pending"),
    notificationError: text("notification_error"),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex("idx_workflow_approvals_run_node").on(t.runId, t.nodeId),
    index("idx_workflow_approvals_run").on(t.runId),
    index("idx_workflow_approvals_workflow").on(t.workflowId, t.requestedAt),
    index("idx_workflow_approvals_status").on(t.status),
  ],
);

// ============================================================================
// APPFORGE STRUCTURED STORAGE
// ============================================================================

export const appForgeBases = pgTable(
  "appforge_bases",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    activeTableId: text("active_table_id"),
    revision: integer("revision").notNull().default(0),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_appforge_bases_app").on(t.appId),
    index("idx_appforge_bases_updated").on(t.updatedAt),
  ],
);

export const appForgeTables = pgTable(
  "appforge_tables",
  {
    id: text("id").primaryKey(),
    baseId: text("base_id")
      .notNull()
      .references(() => appForgeBases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    fields: jsonb("fields")
      .notNull()
      .default(sql`'[]'::jsonb`),
    revision: integer("revision").notNull().default(0),
    position: integer("position").notNull().default(0),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_appforge_tables_base").on(t.baseId),
    index("idx_appforge_tables_base_position").on(t.baseId, t.position),
  ],
);

export const appForgeRecords = pgTable(
  "appforge_records",
  {
    id: text("id").primaryKey(),
    baseId: text("base_id")
      .notNull()
      .references(() => appForgeBases.id, { onDelete: "cascade" }),
    tableId: text("table_id")
      .notNull()
      .references(() => appForgeTables.id, { onDelete: "cascade" }),
    values: jsonb("values")
      .notNull()
      .default(sql`'{}'::jsonb`),
    revision: integer("revision").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_appforge_records_table").on(t.tableId),
    index("idx_appforge_records_base_table").on(t.baseId, t.tableId),
    index("idx_appforge_records_table_updated").on(t.tableId, t.updatedAt),
  ],
);

export const appForgeIdempotencyKeys = pgTable(
  "appforge_idempotency_keys",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    operation: text("operation").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    response: jsonb("response")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_appforge_idempotency_resource").on(t.resourceType, t.resourceId),
    index("idx_appforge_idempotency_created").on(t.createdAt),
  ],
);
