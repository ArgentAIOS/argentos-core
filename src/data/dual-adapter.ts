/**
 * Dual Adapter — Routes reads and writes to SQLite and/or PostgreSQL
 * based on StorageConfig feature flags.
 *
 * In dual-write mode:
 *   - Writes go to ALL backends in writeTo[]
 *   - Reads come from the single backend in readFrom
 *   - Write failures on the secondary backend are logged but don't block
 *
 * This enables safe, reversible migration:
 *   1. backend: "dual", readFrom: "sqlite"  → both get writes, SQLite reads
 *   2. backend: "dual", readFrom: "postgres" → both get writes, PG reads
 *   3. backend: "postgres"                   → PG only, done
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
  KnowledgeObservation,
  KnowledgeObservationEvidence,
  KnowledgeObservationSearchOptions,
  KnowledgeObservationSearchResult,
  Lesson,
  LiveCandidate,
  MemoryCategory,
  MemoryItem,
  MemorySearchResult,
  PersonalSkillCandidate,
  PersonalSkillReviewEvent,
  PersonalSkillCandidateState,
  PersonalSkillScope,
  EntityType,
  RecordModelFeedbackInput,
  Reflection,
  Resource,
} from "../memory/memu-types.js";
import type {
  StorageAdapter,
  JobAdapter,
  MemoryAdapter,
  TaskAdapter,
  TeamAdapter,
  MemoryStats,
  MemoryEntityListFilter,
  MemoryItemListFilter,
  MemoryCategoryListFilter,
} from "./adapter.js";
import type { StorageConfig } from "./storage-config.js";
import type {
  JobAssignment,
  JobAssignmentCreateInput,
  JobEvent,
  JobEventEnqueueInput,
  JobExecutionMode,
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
import { createSubsystemLogger } from "../logging/subsystem.js";
import { shouldWriteTo, shouldReadFrom } from "./storage-config.js";

const log = createSubsystemLogger("data/dual-adapter");

/**
 * Fire a write to the secondary backend. Log errors but don't throw.
 */
async function secondaryWrite<T>(label: string, fn: () => Promise<T>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.error(`dual-write secondary failed: ${label}`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Dual Memory Adapter ──────────────────────────────────────────────────

class DualMemoryAdapter implements MemoryAdapter {
  constructor(
    private config: StorageConfig,
    private sqlite: MemoryAdapter,
    private pg: MemoryAdapter,
  ) {}

  private reader(): MemoryAdapter {
    return shouldReadFrom(this.config, "postgres") ? this.pg : this.sqlite;
  }

  // --- Reads (from single backend) ---

  async getResource(id: string): Promise<Resource | null> {
    return this.reader().getResource(id);
  }

  async getItem(id: string): Promise<MemoryItem | null> {
    return this.reader().getItem(id);
  }

  async listItems(filter?: MemoryItemListFilter): Promise<MemoryItem[]> {
    return this.reader().listItems(filter);
  }

  async findItemByHash(hash: string): Promise<MemoryItem | null> {
    return this.reader().findItemByHash(hash);
  }

  async deleteItem(id: string): Promise<boolean> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.deleteItem(id);
      await secondaryWrite("deleteItem", () => this.pg.deleteItem(id));
      return result;
    }
    return writePg ? this.pg.deleteItem(id) : this.sqlite.deleteItem(id);
  }

  async updateItemEmbedding(id: string, embedding: number[]): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) {
      await this.sqlite.updateItemEmbedding(id, embedding);
    }
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("updateItemEmbedding", () => this.pg.updateItemEmbedding(id, embedding));
    }
  }

  async searchByVector(
    embedding: Float32Array,
    limit: number,
    agentId?: string,
  ): Promise<MemorySearchResult[]> {
    return this.reader().searchByVector(embedding, limit, agentId);
  }

  async searchByKeyword(query: string, limit: number): Promise<MemorySearchResult[]> {
    return this.reader().searchByKeyword(query, limit);
  }

  async searchByKeywordShared(query: string, limit: number): Promise<MemorySearchResult[]> {
    const reader = this.reader();
    if (reader.searchByKeywordShared) {
      return reader.searchByKeywordShared(query, limit);
    }
    return [];
  }

  async getCategory(id: string): Promise<MemoryCategory | null> {
    return this.reader().getCategory(id);
  }

  async getCategoryByName(name: string): Promise<MemoryCategory | null> {
    return this.reader().getCategoryByName(name);
  }

  async getOrCreateCategory(name: string, description?: string): Promise<MemoryCategory> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.getOrCreateCategory(name, description);
      await secondaryWrite("getOrCreateCategory", () =>
        this.pg.getOrCreateCategory(name, description),
      );
      return result;
    }
    return writePg
      ? this.pg.getOrCreateCategory(name, description)
      : this.sqlite.getOrCreateCategory(name, description);
  }

  async listCategories(filter?: MemoryCategoryListFilter): Promise<MemoryCategory[]> {
    return this.reader().listCategories(filter);
  }

  async getCategoryItems(categoryId: string, limit?: number): Promise<MemoryItem[]> {
    return this.reader().getCategoryItems(categoryId, limit);
  }

  async getCategoryItemCount(categoryId: string): Promise<number> {
    return this.reader().getCategoryItemCount(categoryId);
  }

  async getItemCategories(itemId: string): Promise<MemoryCategory[]> {
    return this.reader().getItemCategories(itemId);
  }

  async getEntity(id: string): Promise<Entity | null> {
    return this.reader().getEntity(id);
  }

  async findEntityByName(name: string): Promise<Entity | null> {
    return this.reader().findEntityByName(name);
  }

  async getOrCreateEntity(name: string, input?: Partial<CreateEntityInput>): Promise<Entity> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.getOrCreateEntity(name, input);
      await secondaryWrite("getOrCreateEntity", () => this.pg.getOrCreateEntity(name, input));
      return result;
    }
    return writePg
      ? this.pg.getOrCreateEntity(name, input)
      : this.sqlite.getOrCreateEntity(name, input);
  }

  async listEntities(filter?: MemoryEntityListFilter): Promise<Entity[]> {
    return this.reader().listEntities(filter);
  }

  async updateEntity(
    id: string,
    fields: Partial<{
      relationship: string;
      bondStrength: number;
      emotionalTexture: string;
      profileSummary: string;
      entityType: EntityType;
    }>,
  ): Promise<Entity | null> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.updateEntity(id, fields);
      await secondaryWrite("updateEntity", () => this.pg.updateEntity(id, fields));
      return result;
    }
    return writePg ? this.pg.updateEntity(id, fields) : this.sqlite.updateEntity(id, fields);
  }

  async getEntityItems(entityId: string, limit?: number): Promise<MemoryItem[]> {
    return this.reader().getEntityItems(entityId, limit);
  }

  async getItemEntities(itemId: string): Promise<Entity[]> {
    return this.reader().getItemEntities(itemId);
  }

  async listReflections(filter?: { triggerType?: string; limit?: number }): Promise<Reflection[]> {
    return this.reader().listReflections(filter);
  }

  async listLessons(filter?: { limit?: number }): Promise<Lesson[]> {
    return this.reader().listLessons(filter);
  }

  async searchLessons(query: string, limit: number): Promise<Lesson[]> {
    return this.reader().searchLessons(query, limit);
  }

  async searchLessonsByKeyword(query: string, limit: number): Promise<Lesson[]> {
    return this.reader().searchLessonsByKeyword(query, limit);
  }

  async getLessonsByTool(toolName: string, limit: number): Promise<Lesson[]> {
    return this.reader().getLessonsByTool(toolName, limit);
  }

  async getStats(): Promise<MemoryStats> {
    return this.reader().getStats();
  }

  async getKnowledgeObservation(id: string): Promise<KnowledgeObservation | null> {
    return this.reader().getKnowledgeObservation(id);
  }

  async listKnowledgeObservations(filter?: {
    kinds?: KnowledgeObservation["kind"][];
    subjectType?: KnowledgeObservation["subjectType"];
    subjectId?: string;
    status?: KnowledgeObservation["status"];
    limit?: number;
  }): Promise<KnowledgeObservation[]> {
    return this.reader().listKnowledgeObservations(filter);
  }

  async searchKnowledgeObservations(
    query: string,
    options?: KnowledgeObservationSearchOptions,
  ): Promise<KnowledgeObservationSearchResult[]> {
    return this.reader().searchKnowledgeObservations(query, options);
  }

  async getKnowledgeObservationEvidence(
    observationId: string,
  ): Promise<KnowledgeObservationEvidence[]> {
    return this.reader().getKnowledgeObservationEvidence(observationId);
  }

  // --- Writes (to all backends in writeTo[]) ---

  async createResource(input: CreateResourceInput): Promise<Resource> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.createResource(input);
      await secondaryWrite("createResource", () => this.pg.createResource(input));
      return result;
    }
    return writePg ? this.pg.createResource(input) : this.sqlite.createResource(input);
  }

  async createItem(input: CreateMemoryItemInput): Promise<MemoryItem> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.createItem(input);
      await secondaryWrite("createItem", () => this.pg.createItem(input));
      return result;
    }
    return writePg ? this.pg.createItem(input) : this.sqlite.createItem(input);
  }

  async reinforceItem(id: string): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) await this.sqlite.reinforceItem(id);
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("reinforceItem", () => this.pg.reinforceItem(id));
    }
  }

  async createCategory(input: CreateCategoryInput): Promise<MemoryCategory> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.createCategory(input);
      await secondaryWrite("createCategory", () => this.pg.createCategory(input));
      return result;
    }
    return writePg ? this.pg.createCategory(input) : this.sqlite.createCategory(input);
  }

  async linkItemToCategory(itemId: string, categoryId: string): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) {
      await this.sqlite.linkItemToCategory(itemId, categoryId);
    }
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("linkItemToCategory", () =>
        this.pg.linkItemToCategory(itemId, categoryId),
      );
    }
  }

  async unlinkItemFromCategory(itemId: string, categoryId: string): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) {
      await this.sqlite.unlinkItemFromCategory(itemId, categoryId);
    }
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("unlinkItemFromCategory", () =>
        this.pg.unlinkItemFromCategory(itemId, categoryId),
      );
    }
  }

  async updateCategoryName(categoryId: string, name: string): Promise<MemoryCategory | null> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.updateCategoryName(categoryId, name);
      await secondaryWrite("updateCategoryName", () =>
        this.pg.updateCategoryName(categoryId, name),
      );
      return result;
    }
    return writePg
      ? this.pg.updateCategoryName(categoryId, name)
      : this.sqlite.updateCategoryName(categoryId, name);
  }

  async updateCategorySummary(categoryId: string, summary: string): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) {
      await this.sqlite.updateCategorySummary(categoryId, summary);
    }
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("updateCategorySummary", () =>
        this.pg.updateCategorySummary(categoryId, summary),
      );
    }
  }

  async deleteCategory(categoryId: string): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) {
      await this.sqlite.deleteCategory(categoryId);
    }
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("deleteCategory", () => this.pg.deleteCategory(categoryId));
    }
  }

  async searchItemsByKeyword(query: string, limit: number): Promise<MemoryItem[]> {
    const reader = this.reader();
    if (reader.searchItemsByKeyword) {
      return reader.searchItemsByKeyword(query, limit);
    }
    // Fallback: use searchByKeyword and extract items
    const results = await reader.searchByKeyword(query, limit);
    return results.map((r) => r.item);
  }

  async createEntity(input: CreateEntityInput): Promise<Entity> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.createEntity(input);
      await secondaryWrite("createEntity", () => this.pg.createEntity(input));
      return result;
    }
    return writePg ? this.pg.createEntity(input) : this.sqlite.createEntity(input);
  }

  async linkItemToEntity(itemId: string, entityId: string, role: string): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) {
      await this.sqlite.linkItemToEntity(itemId, entityId, role);
    }
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("linkItemToEntity", () =>
        this.pg.linkItemToEntity(itemId, entityId, role),
      );
    }
  }

  async createReflection(input: CreateReflectionInput): Promise<Reflection> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.createReflection(input);
      await secondaryWrite("createReflection", () => this.pg.createReflection(input));
      return result;
    }
    return writePg ? this.pg.createReflection(input) : this.sqlite.createReflection(input);
  }

  async createLesson(input: CreateLessonInput): Promise<Lesson> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.createLesson(input);
      await secondaryWrite("createLesson", () => this.pg.createLesson(input));
      return result;
    }
    return writePg ? this.pg.createLesson(input) : this.sqlite.createLesson(input);
  }

  async reinforceLesson(id: string): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) await this.sqlite.reinforceLesson(id);
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("reinforceLesson", () => this.pg.reinforceLesson(id));
    }
  }

  async decayLesson(id: string, amount: number): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) await this.sqlite.decayLesson(id, amount);
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("decayLesson", () => this.pg.decayLesson(id, amount));
    }
  }

  async decayLessons(olderThanDays: number, amount: number): Promise<number> {
    const readFrom = shouldReadFrom(this.config, "postgres") ? "postgres" : "sqlite";
    let count: number;

    if (readFrom === "postgres") {
      count = await this.pg.decayLessons(olderThanDays, amount);
      if (shouldWriteTo(this.config, "sqlite")) {
        await secondaryWrite("decayLessons", () => this.sqlite.decayLessons(olderThanDays, amount));
      }
    } else {
      count = await this.sqlite.decayLessons(olderThanDays, amount);
      if (shouldWriteTo(this.config, "postgres")) {
        await secondaryWrite("decayLessons", () => this.pg.decayLessons(olderThanDays, amount));
      }
    }
    return count;
  }

  async mergeLessonOccurrences(
    keeperId: string,
    duplicateOccurrences: number,
    mergedTags: string[],
  ): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) {
      await this.sqlite.mergeLessonOccurrences(keeperId, duplicateOccurrences, mergedTags);
    }
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("mergeLessonOccurrences", () =>
        this.pg.mergeLessonOccurrences(keeperId, duplicateOccurrences, mergedTags),
      );
    }
  }

  async deleteLesson(id: string): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) await this.sqlite.deleteLesson(id);
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("deleteLesson", () => this.pg.deleteLesson(id));
    }
  }

  async upsertKnowledgeObservation(
    input: CreateKnowledgeObservationInput,
  ): Promise<KnowledgeObservation> {
    if (shouldWriteTo(this.config, "postgres")) {
      return this.pg.upsertKnowledgeObservation(input);
    }
    return this.sqlite.upsertKnowledgeObservation(input);
  }

  async supersedeKnowledgeObservation(params: {
    id: string;
    successor: CreateKnowledgeObservationInput;
  }): Promise<KnowledgeObservation> {
    if (shouldWriteTo(this.config, "postgres")) {
      return this.pg.supersedeKnowledgeObservation(params);
    }
    return this.sqlite.supersedeKnowledgeObservation(params);
  }

  async markKnowledgeObservationStale(id: string): Promise<void> {
    if (shouldWriteTo(this.config, "postgres")) {
      await this.pg.markKnowledgeObservationStale(id);
      return;
    }
    await this.sqlite.markKnowledgeObservationStale(id);
  }

  async invalidateKnowledgeObservation(id: string, reason?: string): Promise<void> {
    if (shouldWriteTo(this.config, "postgres")) {
      await this.pg.invalidateKnowledgeObservation(id, reason);
      return;
    }
    await this.sqlite.invalidateKnowledgeObservation(id, reason);
  }

  async recordModelFeedback(input: RecordModelFeedbackInput): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) await this.sqlite.recordModelFeedback(input);
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("recordModelFeedback", () => this.pg.recordModelFeedback(input));
    }
  }

  async getLatestModelFeedbackId(sessionKey: string): Promise<string | null> {
    return this.reader().getLatestModelFeedbackId(sessionKey);
  }

  async updateModelFeedbackSelfEval(id: string, score: number, reasoning: string): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) {
      await this.sqlite.updateModelFeedbackSelfEval(id, score, reasoning);
    }
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("updateModelFeedbackSelfEval", () =>
        this.pg.updateModelFeedbackSelfEval(id, score, reasoning),
      );
    }
  }

  async updateModelFeedbackUserRating(
    sessionKey: string,
    feedback: "up" | "down",
  ): Promise<number> {
    const readFrom = shouldReadFrom(this.config, "postgres") ? "postgres" : "sqlite";
    let count: number;

    if (readFrom === "postgres") {
      count = await this.pg.updateModelFeedbackUserRating(sessionKey, feedback);
      if (shouldWriteTo(this.config, "sqlite")) {
        await secondaryWrite("updateModelFeedbackUserRating", () =>
          this.sqlite.updateModelFeedbackUserRating(sessionKey, feedback),
        );
      }
    } else {
      count = await this.sqlite.updateModelFeedbackUserRating(sessionKey, feedback);
      if (shouldWriteTo(this.config, "postgres")) {
        await secondaryWrite("updateModelFeedbackUserRating", () =>
          this.pg.updateModelFeedbackUserRating(sessionKey, feedback),
        );
      }
    }
    return count;
  }

  // --- Live Inbox ---

  async createLiveCandidate(input: CreateLiveCandidateInput): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite") && this.sqlite.createLiveCandidate) {
      await this.sqlite.createLiveCandidate(input);
    }
    if (shouldWriteTo(this.config, "postgres") && this.pg.createLiveCandidate) {
      await secondaryWrite("createLiveCandidate", () => this.pg.createLiveCandidate!(input));
    }
  }

  async listLiveCandidates(filter: { status: string; limit: number }): Promise<LiveCandidate[]> {
    const reader = this.reader();
    return reader.listLiveCandidates ? reader.listLiveCandidates(filter) : [];
  }

  async markLiveCandidateMerged(id: string, mergedIntoItemId: string): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite") && this.sqlite.markLiveCandidateMerged) {
      await this.sqlite.markLiveCandidateMerged(id, mergedIntoItemId);
    }
    if (shouldWriteTo(this.config, "postgres") && this.pg.markLiveCandidateMerged) {
      await secondaryWrite("markLiveCandidateMerged", () =>
        this.pg.markLiveCandidateMerged!(id, mergedIntoItemId),
      );
    }
  }

  async markLiveCandidatePromoted(
    id: string,
    promotedToItemId: string,
    reason: string,
  ): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite") && this.sqlite.markLiveCandidatePromoted) {
      await this.sqlite.markLiveCandidatePromoted(id, promotedToItemId, reason);
    }
    if (shouldWriteTo(this.config, "postgres") && this.pg.markLiveCandidatePromoted) {
      await secondaryWrite("markLiveCandidatePromoted", () =>
        this.pg.markLiveCandidatePromoted!(id, promotedToItemId, reason),
      );
    }
  }

  async createPersonalSkillCandidate(
    input: CreatePersonalSkillCandidateInput,
  ): Promise<PersonalSkillCandidate> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.createPersonalSkillCandidate(input);
      await secondaryWrite("createPersonalSkillCandidate", () =>
        this.pg.createPersonalSkillCandidate(input),
      );
      return result;
    }

    return writePg
      ? this.pg.createPersonalSkillCandidate(input)
      : this.sqlite.createPersonalSkillCandidate(input);
  }

  async listPersonalSkillCandidates(filter?: {
    state?: PersonalSkillCandidateState;
    limit?: number;
  }): Promise<PersonalSkillCandidate[]> {
    return this.reader().listPersonalSkillCandidates(filter);
  }

  async updatePersonalSkillCandidate(
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
  ): Promise<PersonalSkillCandidate | null> {
    const readFrom = shouldReadFrom(this.config, "postgres") ? "postgres" : "sqlite";
    let updated: PersonalSkillCandidate | null;

    if (readFrom === "postgres") {
      updated = await this.pg.updatePersonalSkillCandidate(id, fields);
      if (shouldWriteTo(this.config, "sqlite")) {
        await secondaryWrite("updatePersonalSkillCandidate", () =>
          this.sqlite.updatePersonalSkillCandidate(id, fields),
        );
      }
    } else {
      updated = await this.sqlite.updatePersonalSkillCandidate(id, fields);
      if (shouldWriteTo(this.config, "postgres")) {
        await secondaryWrite("updatePersonalSkillCandidate", () =>
          this.pg.updatePersonalSkillCandidate(id, fields),
        );
      }
    }

    return updated;
  }

  async deletePersonalSkillCandidate(id: string): Promise<boolean> {
    const readFrom = shouldReadFrom(this.config, "postgres") ? "postgres" : "sqlite";
    let deleted = false;

    if (readFrom === "postgres") {
      deleted = await this.pg.deletePersonalSkillCandidate(id);
      if (shouldWriteTo(this.config, "sqlite")) {
        await secondaryWrite("deletePersonalSkillCandidate", () =>
          this.sqlite.deletePersonalSkillCandidate(id),
        );
      }
    } else {
      deleted = await this.sqlite.deletePersonalSkillCandidate(id);
      if (shouldWriteTo(this.config, "postgres")) {
        await secondaryWrite("deletePersonalSkillCandidate", () =>
          this.pg.deletePersonalSkillCandidate(id),
        );
      }
    }

    return deleted;
  }

  async createPersonalSkillReviewEvent(
    input: CreatePersonalSkillReviewEventInput,
  ): Promise<PersonalSkillReviewEvent> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.createPersonalSkillReviewEvent(input);
      await secondaryWrite("createPersonalSkillReviewEvent", () =>
        this.pg.createPersonalSkillReviewEvent(input),
      );
      return result;
    }

    return writePg
      ? this.pg.createPersonalSkillReviewEvent(input)
      : this.sqlite.createPersonalSkillReviewEvent(input);
  }

  async listPersonalSkillReviewEvents(filter: {
    candidateId: string;
    limit?: number;
  }): Promise<PersonalSkillReviewEvent[]> {
    return this.reader().listPersonalSkillReviewEvents(filter);
  }
}

// ── Dual Task Adapter ────────────────────────────────────────────────────

class DualTaskAdapter implements TaskAdapter {
  constructor(
    private config: StorageConfig,
    private sqlite: TaskAdapter,
    private pg: TaskAdapter,
  ) {}

  private reader(): TaskAdapter {
    return shouldReadFrom(this.config, "postgres") ? this.pg : this.sqlite;
  }

  async get(id: string): Promise<Task | null> {
    return this.reader().get(id);
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    return this.reader().list(filter);
  }

  async create(input: TaskCreateInput): Promise<Task> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.create(input);
      await secondaryWrite("task.create", () => this.pg.create(input));
      return result;
    }
    return writePg ? this.pg.create(input) : this.sqlite.create(input);
  }

  async update(id: string, input: TaskUpdateInput): Promise<Task | null> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.update(id, input);
      await secondaryWrite("task.update", () => this.pg.update(id, input));
      return result;
    }
    return writePg ? this.pg.update(id, input) : this.sqlite.update(id, input);
  }

  async delete(id: string): Promise<boolean> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.delete(id);
      await secondaryWrite("task.delete", () => this.pg.delete(id));
      return result;
    }
    return writePg ? this.pg.delete(id) : this.sqlite.delete(id);
  }

  async start(id: string): Promise<Task | null> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.start(id);
      await secondaryWrite("task.start", () => this.pg.start(id));
      return result;
    }
    return writePg ? this.pg.start(id) : this.sqlite.start(id);
  }

  async complete(id: string): Promise<Task | null> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.complete(id);
      await secondaryWrite("task.complete", () => this.pg.complete(id));
      return result;
    }
    return writePg ? this.pg.complete(id) : this.sqlite.complete(id);
  }

  async block(id: string, reason?: string): Promise<Task | null> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.block(id, reason);
      await secondaryWrite("task.block", () => this.pg.block(id, reason));
      return result;
    }
    return writePg ? this.pg.block(id, reason) : this.sqlite.block(id, reason);
  }

  async fail(id: string, reason?: string): Promise<Task | null> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.fail(id, reason);
      await secondaryWrite("task.fail", () => this.pg.fail(id, reason));
      return result;
    }
    return writePg ? this.pg.fail(id, reason) : this.sqlite.fail(id, reason);
  }
}

// ── Dual Team Adapter ────────────────────────────────────────────────────

class DualTeamAdapter implements TeamAdapter {
  constructor(
    private config: StorageConfig,
    private sqlite: TeamAdapter,
    private pg: TeamAdapter,
  ) {}

  private reader(): TeamAdapter {
    return shouldReadFrom(this.config, "postgres") ? this.pg : this.sqlite;
  }

  async get(id: string): Promise<TeamWithMembers | null> {
    return this.reader().get(id);
  }

  async list(): Promise<Team[]> {
    return this.reader().list();
  }

  async create(input: TeamCreateInput): Promise<Team> {
    const writeSqlite = shouldWriteTo(this.config, "sqlite");
    const writePg = shouldWriteTo(this.config, "postgres");

    if (writeSqlite && writePg) {
      const result = await this.sqlite.create(input);
      await secondaryWrite("team.create", () => this.pg.create(input));
      return result;
    }
    return writePg ? this.pg.create(input) : this.sqlite.create(input);
  }

  async addMember(teamId: string, member: Omit<TeamMember, "teamId">): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) {
      await this.sqlite.addMember(teamId, member);
    }
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("team.addMember", () => this.pg.addMember(teamId, member));
    }
  }

  async updateMemberStatus(
    teamId: string,
    sessionKey: string,
    status: TeamMember["status"],
  ): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) {
      await this.sqlite.updateMemberStatus(teamId, sessionKey, status);
    }
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("team.updateMemberStatus", () =>
        this.pg.updateMemberStatus(teamId, sessionKey, status),
      );
    }
  }

  async disband(id: string): Promise<void> {
    if (shouldWriteTo(this.config, "sqlite")) await this.sqlite.disband(id);
    if (shouldWriteTo(this.config, "postgres")) {
      await secondaryWrite("team.disband", () => this.pg.disband(id));
    }
  }
}

class DualJobAdapter implements JobAdapter {
  constructor(private pg: JobAdapter) {}

  async createTemplate(input: JobTemplateCreateInput): Promise<JobTemplate> {
    return this.pg.createTemplate(input);
  }

  async listTemplates(): Promise<JobTemplate[]> {
    return this.pg.listTemplates();
  }

  async getTemplate(id: string): Promise<JobTemplate | null> {
    return this.pg.getTemplate(id);
  }

  async updateTemplate(
    id: string,
    input: Partial<JobTemplateCreateInput>,
  ): Promise<JobTemplate | null> {
    return this.pg.updateTemplate(id, input);
  }

  async createAssignment(input: JobAssignmentCreateInput): Promise<JobAssignment> {
    return this.pg.createAssignment(input);
  }

  async listAssignments(filter?: {
    agentId?: string;
    enabled?: boolean;
  }): Promise<JobAssignment[]> {
    return this.pg.listAssignments(filter);
  }

  async getAssignment(id: string): Promise<JobAssignment | null> {
    return this.pg.getAssignment(id);
  }

  async updateAssignment(
    id: string,
    input: Partial<{
      enabled: boolean;
      cadenceMinutes: number;
      executionMode: JobExecutionMode;
      deploymentStage: "simulate" | "shadow" | "limited-live" | "live";
      promotionState: "draft" | "in-review" | "approved-next-stage" | "held" | "rolled-back";
      scopeLimit: string | null;
      reviewRequired: boolean;
      nextRunAt: number | null;
      title: string;
      metadata: Record<string, unknown>;
    }>,
  ): Promise<JobAssignment | null> {
    return this.pg.updateAssignment(id, input);
  }

  async getContextForTask(taskId: string): Promise<JobTaskContext | null> {
    return this.pg.getContextForTask(taskId);
  }

  async ensureDueTasks(params?: { agentId?: string; now?: number }): Promise<number> {
    return this.pg.ensureDueTasks(params);
  }

  async createRun(input: JobRunCreateInput): Promise<JobRun> {
    return this.pg.createRun(input);
  }

  async reviewRun(id: string, input: JobRunReviewInput): Promise<JobRun | null> {
    return this.pg.reviewRun(id, input);
  }

  async completeRunForTask(
    taskId: string,
    input: {
      status: Exclude<JobRunStatus, "running">;
      summary?: string;
      blockers?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<JobRun | null> {
    return this.pg.completeRunForTask(taskId, input);
  }

  async listRuns(filter?: {
    assignmentId?: string;
    taskId?: string;
    limit?: number;
  }): Promise<JobRun[]> {
    return this.pg.listRuns(filter);
  }

  async resolveSessionToolPolicyForAssignment(params: {
    assignment: JobAssignment;
    template: JobTemplate;
  }): Promise<{ toolsAllow?: string[]; toolsDeny?: string[] }> {
    return this.pg.resolveSessionToolPolicyForAssignment(params);
  }

  async enqueueEvent(
    input: JobEventEnqueueInput,
  ): Promise<{ accepted: boolean; event?: JobEvent }> {
    return this.pg.enqueueEvent(input);
  }

  async listEvents(filter?: {
    eventType?: string;
    processed?: boolean;
    limit?: number;
  }): Promise<JobEvent[]> {
    return this.pg.listEvents(filter);
  }

  async ensureEventTasks(params?: {
    now?: number;
    agentId?: string;
    limit?: number;
  }): Promise<{ processedEvents: number; createdTasks: number }> {
    return this.pg.ensureEventTasks(params);
  }
}

// ── Top-Level Dual Adapter ───────────────────────────────────────────────

export class DualAdapter implements StorageAdapter {
  public memory: MemoryAdapter;
  public tasks: TaskAdapter;
  public teams: TeamAdapter;
  public jobs: JobAdapter;
  private _ready = false;

  constructor(
    private config: StorageConfig,
    private sqliteAdapter: StorageAdapter,
    private pgAdapter: StorageAdapter,
  ) {
    this.memory = new DualMemoryAdapter(config, sqliteAdapter.memory, pgAdapter.memory);
    this.tasks = new DualTaskAdapter(config, sqliteAdapter.tasks, pgAdapter.tasks);
    this.teams = new DualTeamAdapter(config, sqliteAdapter.teams, pgAdapter.teams);
    this.jobs = new DualJobAdapter(pgAdapter.jobs);
  }

  async init(): Promise<void> {
    // Initialize both backends
    await this.sqliteAdapter.init();
    await this.pgAdapter.init();
    this._ready = true;
    log.info("dual adapter: initialized", {
      readFrom: this.config.readFrom,
      writeTo: this.config.writeTo,
    });
  }

  async close(): Promise<void> {
    this._ready = false;
    await this.sqliteAdapter.close();
    await this.pgAdapter.close();
    log.info("dual adapter: closed");
  }

  isReady(): boolean {
    return this._ready;
  }
}
