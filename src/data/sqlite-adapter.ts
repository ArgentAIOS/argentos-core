/**
 * SQLite Adapter — Bridges existing MemuStore + TasksModule + TeamsModule
 * behind the StorageAdapter interface.
 *
 * This is a thin pass-through wrapper. All existing behavior is preserved;
 * the adapter simply translates async interface calls to the underlying
 * synchronous SQLite operations.
 *
 * Used as the "known good" side during dual-write migration.
 */

import type { MemuStore } from "../memory/memu-store.js";
import type {
  CreateCategoryInput,
  CreateEntityInput,
  CreateLessonInput,
  CreateLiveCandidateInput,
  CreateMemoryItemInput,
  CreateReflectionInput,
  CreateResourceInput,
  Entity,
  EntityType,
  Lesson,
  LiveCandidate,
  MemoryCategory,
  MemoryItem,
  MemorySearchResult,
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
} from "./adapter.js";
import type { TasksModule } from "./tasks.js";
import type { TeamsModule } from "./teams.js";
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
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("data/sqlite-adapter");

// ── Memory Adapter (wraps MemuStore) ─────────────────────────────────────

class SQLiteMemoryAdapter implements MemoryAdapter {
  constructor(private store: MemuStore) {}

  async createResource(input: CreateResourceInput): Promise<Resource> {
    return this.store.createResource(input);
  }

  async getResource(id: string): Promise<Resource | null> {
    return this.store.getResource(id);
  }

  async createItem(input: CreateMemoryItemInput): Promise<MemoryItem> {
    return this.store.createItem(input);
  }

  async getItem(id: string): Promise<MemoryItem | null> {
    return this.store.getItem(id);
  }

  async listItems(filter?: MemoryItemListFilter): Promise<MemoryItem[]> {
    return this.store.listItems({
      memoryType: filter?.memoryType,
      resourceId: filter?.resourceId,
      significance: filter?.significance,
      limit: filter?.limit,
      offset: filter?.offset,
    });
  }

  async findItemByHash(hash: string): Promise<MemoryItem | null> {
    return this.store.findByHash(hash);
  }

  async deleteItem(id: string): Promise<boolean> {
    return this.store.deleteItem(id);
  }

  async updateItemEmbedding(id: string, embedding: number[]): Promise<void> {
    this.store.updateItemEmbedding(id, embedding);
  }

  async reinforceItem(id: string): Promise<void> {
    this.store.reinforceItem(id);
  }

  async searchByVector(
    embedding: Float32Array,
    limit: number,
    _agentId?: string,
  ): Promise<MemorySearchResult[]> {
    const results = this.store.searchItemsByVector(Array.from(embedding), { limit });
    return results.map((r) => ({
      item: r.item,
      score: r.score,
      categories: [],
    }));
  }

  async searchByKeyword(query: string, limit: number): Promise<MemorySearchResult[]> {
    const items = this.store.searchItemsByKeyword(query, limit);
    return items.map((item, i) => ({
      item,
      score: 1 - i * 0.05, // Approximate relevance decay by position
      categories: [],
    }));
  }

  async createCategory(input: CreateCategoryInput): Promise<MemoryCategory> {
    return this.store.createCategory(input);
  }

  async getCategory(id: string): Promise<MemoryCategory | null> {
    return this.store.getCategory(id);
  }

  async getCategoryByName(name: string): Promise<MemoryCategory | null> {
    return this.store.getCategoryByName(name);
  }

  async getOrCreateCategory(name: string, description?: string): Promise<MemoryCategory> {
    return this.store.getOrCreateCategory(name, description);
  }

  async listCategories(filter?: { query?: string; limit?: number }): Promise<MemoryCategory[]> {
    if (filter?.query) {
      return this.store.searchCategoriesByKeyword(filter.query, filter.limit ?? 20);
    }
    const categories = this.store.listCategories();
    return filter?.limit ? categories.slice(0, filter.limit) : categories;
  }

  async getCategoryItems(categoryId: string, limit = 100): Promise<MemoryItem[]> {
    return this.store.getCategoryItems(categoryId, limit);
  }

  async getCategoryItemCount(categoryId: string): Promise<number> {
    return this.store.getCategoryItemCount(categoryId);
  }

  async getItemCategories(itemId: string): Promise<MemoryCategory[]> {
    return this.store.getItemCategories(itemId);
  }

  async linkItemToCategory(itemId: string, categoryId: string): Promise<void> {
    this.store.linkItemToCategory(itemId, categoryId);
  }

  async unlinkItemFromCategory(itemId: string, categoryId: string): Promise<void> {
    this.store.unlinkItemFromCategory(itemId, categoryId);
  }

  async updateCategorySummary(categoryId: string, summary: string): Promise<void> {
    this.store.updateCategorySummary(categoryId, summary);
  }

  async deleteCategory(categoryId: string): Promise<void> {
    this.store.deleteCategory(categoryId);
  }

  async searchItemsByKeyword(query: string, limit: number): Promise<MemoryItem[]> {
    return this.store.searchItemsByKeyword(query, limit);
  }

  async createEntity(input: CreateEntityInput): Promise<Entity> {
    return this.store.createEntity(input);
  }

  async getEntity(id: string): Promise<Entity | null> {
    return this.store.getEntity(id);
  }

  async findEntityByName(name: string): Promise<Entity | null> {
    return this.store.getEntityByName(name);
  }

  async getOrCreateEntity(name: string, input?: Partial<CreateEntityInput>): Promise<Entity> {
    return this.store.getOrCreateEntity(name, input);
  }

  async listEntities(filter?: MemoryEntityListFilter): Promise<Entity[]> {
    return this.store.listEntities({
      entityType: filter?.entityType,
      minBondStrength: filter?.minBondStrength,
      limit: filter?.limit,
    });
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
    return this.store.updateEntity(id, fields);
  }

  async getEntityItems(entityId: string, limit = 100): Promise<MemoryItem[]> {
    return this.store.getEntityItems(entityId, limit);
  }

  async getItemEntities(itemId: string): Promise<Entity[]> {
    return this.store.getItemEntities(itemId);
  }

  async linkItemToEntity(itemId: string, entityId: string, role: string): Promise<void> {
    this.store.linkItemToEntity(itemId, entityId, role);
  }

  async createReflection(input: CreateReflectionInput): Promise<Reflection> {
    return this.store.createReflection(input);
  }

  async listReflections(filter?: { triggerType?: string; limit?: number }): Promise<Reflection[]> {
    return this.store.listReflections({
      triggerType: filter?.triggerType as Reflection["triggerType"],
      limit: filter?.limit,
    });
  }

  async createLesson(input: CreateLessonInput): Promise<Lesson> {
    return this.store.createLesson(input);
  }

  async listLessons(filter?: { limit?: number }): Promise<Lesson[]> {
    return this.store.listLessons({ limit: filter?.limit });
  }

  async searchLessons(query: string, limit: number): Promise<Lesson[]> {
    return this.store.searchLessonsByKeyword(query, limit);
  }

  async searchLessonsByKeyword(query: string, limit: number): Promise<Lesson[]> {
    return this.store.searchLessonsByKeyword(query, limit);
  }

  async getLessonsByTool(toolName: string, limit: number): Promise<Lesson[]> {
    return this.store.getLessonsByTool(toolName, limit);
  }

  async reinforceLesson(id: string): Promise<void> {
    this.store.reinforceLesson(id);
  }

  async decayLesson(id: string, amount: number): Promise<void> {
    this.store.decayLesson(id, amount);
  }

  async decayLessons(olderThanDays: number, amount: number): Promise<number> {
    return this.store.decayLessons(olderThanDays, amount);
  }

  async mergeLessonOccurrences(
    keeperId: string,
    duplicateOccurrences: number,
    mergedTags: string[],
  ): Promise<void> {
    const mergedTagsJson = JSON.stringify(mergedTags);
    this.store.db
      .prepare(
        `UPDATE lessons SET
           occurrences = occurrences + ?,
           tags = ?,
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(duplicateOccurrences, mergedTagsJson, keeperId);
  }

  async deleteLesson(id: string): Promise<void> {
    this.store.deleteLesson(id);
  }

  // --- Live Inbox ---

  async createLiveCandidate(input: CreateLiveCandidateInput): Promise<void> {
    this.store.createLiveCandidate(input);
  }

  async listLiveCandidates(filter: { status: string; limit: number }): Promise<LiveCandidate[]> {
    return this.store.listLiveCandidates({
      status: filter.status as import("../memory/memu-types.js").CandidateStatus,
      limit: filter.limit,
    });
  }

  async markLiveCandidateMerged(id: string, mergedIntoItemId: string): Promise<void> {
    this.store.markLiveCandidateMerged(id, mergedIntoItemId);
  }

  async markLiveCandidatePromoted(
    id: string,
    promotedToItemId: string,
    reason: string,
  ): Promise<void> {
    this.store.markLiveCandidatePromoted(id, promotedToItemId, reason);
  }

  async recordModelFeedback(input: RecordModelFeedbackInput): Promise<void> {
    this.store.recordModelFeedback(input);
  }

  async getLatestModelFeedbackId(sessionKey: string): Promise<string | null> {
    return this.store.getLatestModelFeedbackId(sessionKey);
  }

  async updateModelFeedbackSelfEval(id: string, score: number, reasoning: string): Promise<void> {
    this.store.updateModelFeedbackSelfEval(id, score, reasoning);
  }

  async updateModelFeedbackUserRating(
    sessionKey: string,
    feedback: "up" | "down",
  ): Promise<number> {
    return this.store.updateModelFeedbackUserRating(sessionKey, feedback);
  }

  async getStats(): Promise<MemoryStats> {
    const stats = this.store.getStats();
    return {
      resources: stats.resources,
      items: stats.items,
      categories: stats.categories,
      entities: stats.entities,
      reflections: stats.reflections,
      lessons: stats.lessons,
      modelFeedback: stats.modelFeedback,
      itemsByType: stats.itemsByType,
      vecAvailable: stats.vecAvailable,
    };
  }
}

// ── Task Adapter (wraps TasksModule) ─────────────────────────────────────

class SQLiteTaskAdapter implements TaskAdapter {
  constructor(private tasks: TasksModule) {}

  async create(input: TaskCreateInput): Promise<Task> {
    return this.tasks.create(input);
  }

  async get(id: string): Promise<Task | null> {
    return this.tasks.get(id);
  }

  async update(id: string, input: TaskUpdateInput): Promise<Task | null> {
    return this.tasks.update(id, input);
  }

  async delete(id: string): Promise<boolean> {
    return this.tasks.delete(id);
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    return this.tasks.list(filter);
  }

  async start(id: string): Promise<Task | null> {
    return this.tasks.start(id);
  }

  async complete(id: string): Promise<Task | null> {
    const { task } = this.tasks.completeAndResolve(id);
    return task;
  }

  async block(id: string, reason?: string): Promise<Task | null> {
    return this.tasks.block(id, reason);
  }

  async fail(id: string, reason?: string): Promise<Task | null> {
    return this.tasks.fail(id, reason);
  }
}

// ── Team Adapter (wraps TeamsModule) ─────────────────────────────────────

class SQLiteTeamAdapter implements TeamAdapter {
  constructor(private teamsModule: TeamsModule) {}

  async create(input: TeamCreateInput): Promise<Team> {
    return this.teamsModule.createTeam(input);
  }

  async get(id: string): Promise<TeamWithMembers | null> {
    return this.teamsModule.getTeamWithMembers(id);
  }

  async list(): Promise<Team[]> {
    return this.teamsModule.listActiveTeams();
  }

  async addMember(teamId: string, member: Omit<TeamMember, "teamId">): Promise<void> {
    this.teamsModule.addMember({
      teamId,
      sessionKey: member.sessionKey,
      role: member.role,
      label: member.label,
    });
  }

  async updateMemberStatus(
    teamId: string,
    sessionKey: string,
    status: TeamMember["status"],
  ): Promise<void> {
    this.teamsModule.updateMemberStatus(teamId, sessionKey, status);
  }

  async disband(id: string): Promise<void> {
    this.teamsModule.disbandTeam(id);
  }
}

/**
 * @deprecated Workforce feature development should target PgJobAdapter.
 * SQLite workforce paths are removed. Use PgJobAdapter for jobs/workforce.
 */
class SQLiteJobsAdapter implements JobAdapter {
  private unsupported(operation: string): never {
    throw new Error(
      `workforce operation "${operation}" is not supported on SQLite adapters. Use PostgreSQL-canonical storage (backend=postgres, readFrom=postgres, writeTo=[postgres]).`,
    );
  }

  async createTemplate(input: JobTemplateCreateInput): Promise<JobTemplate> {
    void input;
    return this.unsupported("createTemplate");
  }

  async listTemplates(): Promise<JobTemplate[]> {
    return this.unsupported("listTemplates");
  }

  async getTemplate(id: string): Promise<JobTemplate | null> {
    void id;
    return this.unsupported("getTemplate");
  }

  async updateTemplate(
    id: string,
    input: Partial<JobTemplateCreateInput>,
  ): Promise<JobTemplate | null> {
    void id;
    void input;
    return this.unsupported("updateTemplate");
  }

  async createAssignment(input: JobAssignmentCreateInput): Promise<JobAssignment> {
    void input;
    return this.unsupported("createAssignment");
  }

  async listAssignments(filter?: {
    agentId?: string;
    enabled?: boolean;
  }): Promise<JobAssignment[]> {
    void filter;
    return this.unsupported("listAssignments");
  }

  async getAssignment(id: string): Promise<JobAssignment | null> {
    void id;
    return this.unsupported("getAssignment");
  }

  async updateAssignment(
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
  ): Promise<JobAssignment | null> {
    void id;
    void input;
    return this.unsupported("updateAssignment");
  }

  async getContextForTask(taskId: string): Promise<JobTaskContext | null> {
    void taskId;
    return this.unsupported("getContextForTask");
  }

  async ensureDueTasks(params?: { agentId?: string; now?: number }): Promise<number> {
    void params;
    return this.unsupported("ensureDueTasks");
  }

  async createRun(input: JobRunCreateInput): Promise<JobRun> {
    void input;
    return this.unsupported("createRun");
  }

  async reviewRun(id: string, input: JobRunReviewInput): Promise<JobRun | null> {
    void id;
    void input;
    return this.unsupported("reviewRun");
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
    void taskId;
    void input;
    return this.unsupported("completeRunForTask");
  }

  async listRuns(filter?: {
    assignmentId?: string;
    taskId?: string;
    limit?: number;
  }): Promise<JobRun[]> {
    void filter;
    return this.unsupported("listRuns");
  }

  async resolveSessionToolPolicyForAssignment(params: {
    assignment: JobAssignment;
    template: JobTemplate;
  }): Promise<{ toolsAllow?: string[]; toolsDeny?: string[] }> {
    void params;
    return this.unsupported("resolveSessionToolPolicyForAssignment");
  }

  async enqueueEvent(
    input: JobEventEnqueueInput,
  ): Promise<{ accepted: boolean; event?: JobEvent }> {
    void input;
    return this.unsupported("enqueueEvent");
  }

  async listEvents(filter?: {
    eventType?: string;
    processed?: boolean;
    limit?: number;
  }): Promise<JobEvent[]> {
    void filter;
    return this.unsupported("listEvents");
  }

  async ensureEventTasks(params?: {
    now?: number;
    agentId?: string;
    limit?: number;
  }): Promise<{ processedEvents: number; createdTasks: number }> {
    void params;
    return this.unsupported("ensureEventTasks");
  }
}

// ── Top-Level SQLite Adapter ─────────────────────────────────────────────

export class SQLiteAdapter implements StorageAdapter {
  public memory: MemoryAdapter;
  public tasks: TaskAdapter;
  public teams: TeamAdapter;
  public jobs: JobAdapter;
  private _ready = false;

  constructor(
    private memuStore: MemuStore,
    private tasksModule: TasksModule,
    private teamsModule: TeamsModule,
  ) {
    this.memory = new SQLiteMemoryAdapter(memuStore);
    this.tasks = new SQLiteTaskAdapter(tasksModule);
    this.teams = new SQLiteTeamAdapter(teamsModule);
    this.jobs = new SQLiteJobsAdapter();
  }

  async init(): Promise<void> {
    // MemuStore initializes on construction; TasksModule and TeamsModule
    // need explicit init for schema migrations.
    await this.tasksModule.init();
    await this.teamsModule.init();
    this._ready = true;
    log.info("sqlite adapter: initialized");
  }

  async close(): Promise<void> {
    // MemuStore close is handled externally via closeMemuStore()
    // (it does WAL checkpoint + db.close)
    this._ready = false;
    log.info("sqlite adapter: closed");
  }

  isReady(): boolean {
    return this._ready;
  }
}
