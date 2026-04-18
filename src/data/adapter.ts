/**
 * StorageAdapter — Unified interface for database backends.
 *
 * Both SQLite and PostgreSQL implementations conform to this interface,
 * enabling dual-write mode and zero-downtime migration.
 *
 * The adapter mirrors the existing MemuStore + DataAPI public APIs so
 * callers don't need to change. During migration, a DualAdapter wraps
 * both backends and routes reads/writes based on StorageConfig.
 */

import type {
  CreateCategoryInput,
  CreateEntityInput,
  CreateKnowledgeObservationInput,
  CreateLessonInput,
  CreateLiveCandidateInput,
  CreateMemoryItemInput,
  CreatePersonalSkillCandidateInput,
  CreatePersonalSkillReviewEventInput,
  CreateReflectionInput,
  CreateResourceInput,
  Entity,
  EntityType,
  KnowledgeObservation,
  KnowledgeObservationEvidence,
  KnowledgeObservationSearchOptions,
  KnowledgeObservationSearchResult,
  Lesson,
  LiveCandidate,
  MemoryCategory,
  MemoryItem,
  MemorySearchResult,
  MemoryType,
  PersonalSkillCandidate,
  PersonalSkillReviewEvent,
  PersonalSkillCandidateState,
  PersonalSkillScope,
  RecordModelFeedbackInput,
  Reflection,
  Resource,
  Significance,
} from "../memory/memu-types.js";
import type {
  JobAssignment,
  JobAssignmentCreateInput,
  JobDeploymentStage,
  JobEvent,
  JobEventEnqueueInput,
  JobExecutionMode,
  JobPromotionState,
  JobRun,
  JobRunCreateInput,
  JobRunReviewInput,
  JobRunStatus,
  JobTaskContext,
  JobTemplate,
  JobTemplateCreateInput,
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TaskFilter,
  Team,
  TeamCreateInput,
  TeamMember,
  TeamWithMembers,
} from "./types.js";

// ── Memory Adapter ────────────────────────────────────────────────────────

export interface MemorySearchQuery {
  query?: string;
  embedding?: Float32Array;
  memoryType?: MemoryType;
  significance?: Significance;
  agentId?: string;
  limit?: number;
}

export interface MemoryStats {
  resources: number;
  items: number;
  categories: number;
  entities: number;
  reflections: number;
  lessons: number;
  modelFeedback: number;
  itemsByType: Record<string, number>;
  vecAvailable: boolean;
}

export interface MemoryItemListFilter {
  memoryType?: MemoryType;
  resourceId?: string;
  significance?: Significance;
  limit?: number;
  offset?: number;
}

export interface MemoryEntityListFilter {
  entityType?: EntityType;
  minBondStrength?: number;
  limit?: number;
}

export interface MemoryAdapter {
  // Resources
  createResource(input: CreateResourceInput): Promise<Resource>;
  getResource(id: string): Promise<Resource | null>;

  // Memory Items
  createItem(input: CreateMemoryItemInput): Promise<MemoryItem>;
  getItem(id: string): Promise<MemoryItem | null>;
  listItems(filter?: MemoryItemListFilter): Promise<MemoryItem[]>;
  findItemByHash(hash: string): Promise<MemoryItem | null>;
  deleteItem(id: string): Promise<boolean>;
  updateItemEmbedding(id: string, embedding: number[]): Promise<void>;
  reinforceItem(id: string): Promise<void>;
  searchByVector(
    embedding: Float32Array,
    limit: number,
    agentId?: string,
  ): Promise<MemorySearchResult[]>;
  searchByKeyword(query: string, limit: number): Promise<MemorySearchResult[]>;
  searchByKeywordShared?(query: string, limit: number): Promise<MemorySearchResult[]>;
  searchItemsByKeyword?(query: string, limit: number): Promise<MemoryItem[]>;

  // Categories
  createCategory(input: CreateCategoryInput): Promise<MemoryCategory>;
  getCategory(id: string): Promise<MemoryCategory | null>;
  getCategoryByName(name: string): Promise<MemoryCategory | null>;
  getOrCreateCategory(name: string, description?: string): Promise<MemoryCategory>;
  listCategories(filter?: { query?: string; limit?: number }): Promise<MemoryCategory[]>;
  getCategoryItems(categoryId: string, limit?: number): Promise<MemoryItem[]>;
  getCategoryItemCount(categoryId: string): Promise<number>;
  getItemCategories(itemId: string): Promise<MemoryCategory[]>;
  linkItemToCategory(itemId: string, categoryId: string): Promise<void>;
  unlinkItemFromCategory(itemId: string, categoryId: string): Promise<void>;
  updateCategorySummary(categoryId: string, summary: string): Promise<void>;
  deleteCategory(categoryId: string): Promise<void>;

  // Entities
  createEntity(input: CreateEntityInput): Promise<Entity>;
  getEntity(id: string): Promise<Entity | null>;
  findEntityByName(name: string): Promise<Entity | null>;
  getOrCreateEntity(name: string, input?: Partial<CreateEntityInput>): Promise<Entity>;
  listEntities(filter?: MemoryEntityListFilter): Promise<Entity[]>;
  updateEntity(
    id: string,
    fields: Partial<{
      relationship: string;
      bondStrength: number;
      emotionalTexture: string;
      profileSummary: string;
      entityType: EntityType;
    }>,
  ): Promise<Entity | null>;
  getEntityItems(entityId: string, limit?: number): Promise<MemoryItem[]>;
  getItemEntities(itemId: string): Promise<Entity[]>;
  linkItemToEntity(itemId: string, entityId: string, role: string): Promise<void>;

  // Reflections
  createReflection(input: CreateReflectionInput): Promise<Reflection>;
  listReflections(filter?: { triggerType?: string; limit?: number }): Promise<Reflection[]>;

  // Lessons (SIS)
  createLesson(input: CreateLessonInput): Promise<Lesson>;
  listLessons(filter?: { limit?: number }): Promise<Lesson[]>;
  searchLessons(query: string, limit: number): Promise<Lesson[]>;
  searchLessonsByKeyword(query: string, limit: number): Promise<Lesson[]>;
  getLessonsByTool(toolName: string, limit: number): Promise<Lesson[]>;
  reinforceLesson(id: string): Promise<void>;
  decayLesson(id: string, amount: number): Promise<void>;
  decayLessons(olderThanDays: number, amount: number): Promise<number>;
  mergeLessonOccurrences(
    keeperId: string,
    duplicateOccurrences: number,
    mergedTags: string[],
  ): Promise<void>;
  deleteLesson(id: string): Promise<void>;

  // Personal Skills
  createPersonalSkillCandidate(
    input: CreatePersonalSkillCandidateInput,
  ): Promise<PersonalSkillCandidate>;
  listPersonalSkillCandidates(filter?: {
    state?: PersonalSkillCandidateState;
    limit?: number;
  }): Promise<PersonalSkillCandidate[]>;
  updatePersonalSkillCandidate(
    id: string,
    fields: Partial<{
      scope: PersonalSkillScope;
      title: string;
      summary: string;
      triggerPatterns: string[];
      procedureOutline: string | null;
      preconditions: string[];
      executionSteps: string[];
      expectedOutcomes: string[];
      relatedTools: string[];
      sourceMemoryIds: string[];
      sourceEpisodeIds: string[];
      sourceTaskIds: string[];
      sourceLessonIds: string[];
      supersedesCandidateIds: string[];
      supersededByCandidateId: string | null;
      conflictsWithCandidateIds: string[];
      contradictionCount: number;
      evidenceCount: number;
      recurrenceCount: number;
      confidence: number;
      strength: number;
      usageCount: number;
      successCount: number;
      failureCount: number;
      state: PersonalSkillCandidateState;
      operatorNotes: string | null;
      lastReviewedAt: string | null;
      lastUsedAt: string | null;
      lastReinforcedAt: string | null;
      lastContradictedAt: string | null;
    }>,
  ): Promise<PersonalSkillCandidate | null>;
  deletePersonalSkillCandidate(id: string): Promise<boolean>;
  createPersonalSkillReviewEvent(
    input: CreatePersonalSkillReviewEventInput,
  ): Promise<PersonalSkillReviewEvent>;
  listPersonalSkillReviewEvents(filter: {
    candidateId: string;
    limit?: number;
  }): Promise<PersonalSkillReviewEvent[]>;

  // Knowledge observations
  getKnowledgeObservation(id: string): Promise<KnowledgeObservation | null>;
  listKnowledgeObservations(filter?: {
    kinds?: KnowledgeObservation["kind"][];
    subjectType?: KnowledgeObservation["subjectType"];
    subjectId?: string;
    status?: KnowledgeObservation["status"];
    limit?: number;
  }): Promise<KnowledgeObservation[]>;
  searchKnowledgeObservations(
    query: string,
    options?: KnowledgeObservationSearchOptions,
  ): Promise<KnowledgeObservationSearchResult[]>;
  getKnowledgeObservationEvidence(observationId: string): Promise<KnowledgeObservationEvidence[]>;
  upsertKnowledgeObservation(input: CreateKnowledgeObservationInput): Promise<KnowledgeObservation>;
  supersedeKnowledgeObservation(params: {
    id: string;
    successor: CreateKnowledgeObservationInput;
  }): Promise<KnowledgeObservation>;
  markKnowledgeObservationStale(id: string): Promise<void>;
  invalidateKnowledgeObservation(id: string, reason?: string): Promise<void>;

  // Live Inbox
  createLiveCandidate?(input: CreateLiveCandidateInput): Promise<void>;
  listLiveCandidates?(filter: { status: string; limit: number }): Promise<LiveCandidate[]>;
  markLiveCandidateMerged?(id: string, mergedIntoItemId: string): Promise<void>;
  markLiveCandidatePromoted?(id: string, promotedToItemId: string, reason: string): Promise<void>;

  // Model Feedback
  recordModelFeedback(input: RecordModelFeedbackInput): Promise<void>;
  getLatestModelFeedbackId(sessionKey: string): Promise<string | null>;
  updateModelFeedbackSelfEval(id: string, score: number, reasoning: string): Promise<void>;
  updateModelFeedbackUserRating(sessionKey: string, feedback: "up" | "down"): Promise<number>;

  // Stats
  getStats(): Promise<MemoryStats>;

  // Multi-agent scoping — returns a new adapter scoped to a different agent.
  // Optional: only PgMemoryAdapter implements this.
  withAgentId?(id: string): MemoryAdapter;
}

// ── Task Adapter ──────────────────────────────────────────────────────────

export interface TaskAdapter {
  create(input: TaskCreateInput): Promise<Task>;
  get(id: string): Promise<Task | null>;
  update(id: string, input: TaskUpdateInput): Promise<Task | null>;
  delete(id: string): Promise<boolean>;
  list(filter?: TaskFilter): Promise<Task[]>;
  start(id: string): Promise<Task | null>;
  complete(id: string): Promise<Task | null>;
  block(id: string, reason?: string): Promise<Task | null>;
  fail(id: string, reason?: string): Promise<Task | null>;
}

// ── Team Adapter ──────────────────────────────────────────────────────────

export interface TeamAdapter {
  create(input: TeamCreateInput): Promise<Team>;
  get(id: string): Promise<TeamWithMembers | null>;
  list(): Promise<Team[]>;
  addMember(teamId: string, member: Omit<TeamMember, "teamId">): Promise<void>;
  updateMemberStatus(
    teamId: string,
    sessionKey: string,
    status: TeamMember["status"],
  ): Promise<void>;
  disband(id: string): Promise<void>;
}

// ── Jobs Adapter ──────────────────────────────────────────────────────────

export interface JobAdapter {
  createTemplate(input: JobTemplateCreateInput): Promise<JobTemplate>;
  listTemplates(): Promise<JobTemplate[]>;
  getTemplate(id: string): Promise<JobTemplate | null>;
  updateTemplate(id: string, input: Partial<JobTemplateCreateInput>): Promise<JobTemplate | null>;

  createAssignment(input: JobAssignmentCreateInput): Promise<JobAssignment>;
  listAssignments(filter?: { agentId?: string; enabled?: boolean }): Promise<JobAssignment[]>;
  getAssignment(id: string): Promise<JobAssignment | null>;
  updateAssignment(
    id: string,
    input: Partial<{
      enabled: boolean;
      cadenceMinutes: number;
      executionMode: JobExecutionMode;
      deploymentStage: JobDeploymentStage;
      promotionState: JobPromotionState;
      scopeLimit: string | null;
      reviewRequired: boolean;
      nextRunAt: number | null;
      title: string;
      metadata: Record<string, unknown>;
    }>,
  ): Promise<JobAssignment | null>;

  getContextForTask(taskId: string): Promise<JobTaskContext | null>;
  ensureDueTasks(params?: { agentId?: string; now?: number }): Promise<number>;

  createRun(input: JobRunCreateInput): Promise<JobRun>;
  reviewRun(id: string, input: JobRunReviewInput): Promise<JobRun | null>;
  completeRunForTask(
    taskId: string,
    input: {
      status: Exclude<JobRunStatus, "running">;
      summary?: string;
      blockers?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<JobRun | null>;
  listRuns(filter?: { assignmentId?: string; taskId?: string; limit?: number }): Promise<JobRun[]>;

  resolveSessionToolPolicyForAssignment(params: {
    assignment: JobAssignment;
    template: JobTemplate;
  }): Promise<{ toolsAllow?: string[]; toolsDeny?: string[] }>;

  enqueueEvent(input: JobEventEnqueueInput): Promise<{ accepted: boolean; event?: JobEvent }>;
  listEvents(filter?: {
    eventType?: string;
    processed?: boolean;
    limit?: number;
  }): Promise<JobEvent[]>;
  ensureEventTasks(params?: { now?: number; agentId?: string; limit?: number }): Promise<{
    processedEvents: number;
    createdTasks: number;
  }>;
}

// ── Top-Level Storage Adapter ─────────────────────────────────────────────

export interface StorageAdapter {
  /** Initialize connections and run migrations */
  init(): Promise<void>;

  /** Close all connections cleanly */
  close(): Promise<void>;

  /** Whether the adapter is ready to accept queries */
  isReady(): boolean;

  /** Memory operations (MemU equivalent) */
  memory: MemoryAdapter;

  /** Task operations */
  tasks: TaskAdapter;

  /** Team operations */
  teams: TeamAdapter;

  /** Jobs/workforce operations */
  jobs: JobAdapter;
}
