/**
 * PostgreSQL Adapter — Drizzle ORM implementation of StorageAdapter.
 *
 * Maps all MemoryAdapter, TaskAdapter, and TeamAdapter operations to
 * PostgreSQL queries via Drizzle ORM against the schema in pg/schema.ts.
 *
 * Key differences from SQLite:
 *   - pgvector HNSW for embeddings (cosine distance via raw SQL)
 *   - tsvector for full-text search (plainto_tsquery)
 *   - JSONB native (no JSON.parse/stringify)
 *   - TIMESTAMPTZ (Date objects, not ISO strings)
 *   - RLS via set_config('app.agent_id', ...) per connection
 *
 * Port: 5433 (non-default, see ARGENT_PG_PORT)
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { eq, desc, asc, sql, and, lt, lte, gte, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type {
  CreateCategoryInput,
  CreateEntityInput,
  CreateKnowledgeObservationEvidenceInput,
  CreateKnowledgeObservationInput,
  CreateLessonInput,
  CreatePersonalSkillCandidateInput,
  CreatePersonalSkillReviewEventInput,
  CreateMemoryItemInput,
  CreateReflectionInput,
  CreateResourceInput,
  Entity,
  Lesson,
  KnowledgeObservation,
  KnowledgeObservationEvidence,
  KnowledgeObservationSearchOptions,
  KnowledgeObservationSearchResult,
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
} from "./adapter.js";
import type { PostgresConfig } from "./storage-config.js";
import type {
  JobAssignment,
  JobAssignmentCreateInput,
  JobDeploymentStage,
  JobEvent,
  JobEventEnqueueInput,
  JobExecutionMode,
  JobPromotionState,
  JobRelationshipContract,
  JobRun,
  JobRunCreateInput,
  JobRunReviewInput,
  JobRunReviewStatus,
  JobRunStatus,
  JobTaskContext,
  JobTemplate,
  JobTemplateCreateInput,
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TaskFilter,
  TaskStatus,
  Team,
  TeamCreateInput,
  TeamMember,
  TeamWithMembers,
} from "./types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getPgClient, closePgClient, setAgentContext } from "./pg-client.js";
import * as schema from "./pg/schema.js";

const log = createSubsystemLogger("data/pg-adapter");
const PGVECTOR_DIMENSIONS = 768;

function requireVectorDimensions(values: ReadonlyArray<number>, context: string): number[] {
  const sanitized: number[] = [];
  for (const value of values) {
    if (Number.isFinite(value)) {
      sanitized.push(value);
    }
  }

  if (sanitized.length === PGVECTOR_DIMENSIONS) {
    return sanitized;
  }

  throw new Error(
    `[PG-VECTOR] Expected ${PGVECTOR_DIMENSIONS} dimensions for ${context}, got ${sanitized.length}. ` +
      "Use an embedding model that outputs 768 dimensions or migrate pgvector schema accordingly.",
  );
}

/** Generate a UUID-like ID matching MemU's format */
function genId(): string {
  return crypto.randomUUID();
}

const DEFAULT_SIMULATION_DENY_TOOLS = ["atera_ticket", "message", "send_payload"];
const DEFAULT_LIMITED_LIVE_DENY_TOOLS = ["message", "send_payload"];

function allowsLimitedLiveOutbound(scopeLimit: string | undefined | null): boolean {
  const normalized = String(scopeLimit ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("outbound") ||
    normalized.includes("customer reply") ||
    normalized.includes("customer-facing") ||
    normalized.includes("messaging allowed")
  );
}

function normalizeJobMode(raw: string | undefined | null): JobExecutionMode {
  return raw === "live" ? "live" : "simulate";
}

function normalizeJobStage(raw: string | undefined | null): JobDeploymentStage {
  switch (raw) {
    case "shadow":
    case "limited-live":
    case "live":
      return raw;
    default:
      return "simulate";
  }
}

function modeFromStage(stage: JobDeploymentStage | undefined): JobExecutionMode {
  return stage === "live" || stage === "limited-live" ? "live" : "simulate";
}

function stageFromMode(mode: JobExecutionMode | undefined): JobDeploymentStage {
  return mode === "live" ? "live" : "simulate";
}

function normalizePromotionState(raw: string | undefined | null): JobPromotionState {
  switch (raw) {
    case "in-review":
    case "approved-next-stage":
    case "held":
    case "rolled-back":
      return raw;
    default:
      return "draft";
  }
}

function normalizeRunReviewStatus(raw: string | undefined | null): JobRunReviewStatus {
  switch (raw) {
    case "approved":
    case "held":
    case "rolled-back":
      return raw;
    default:
      return "pending";
  }
}

function nextPromotionStage(stage: JobDeploymentStage): JobDeploymentStage {
  switch (stage) {
    case "simulate":
      return "shadow";
    case "shadow":
      return "limited-live";
    case "limited-live":
      return "live";
    default:
      return "live";
  }
}

function normalizeJobRunStatus(raw: string | undefined | null): JobRunStatus {
  switch (raw) {
    case "completed":
    case "blocked":
    case "failed":
      return raw;
    default:
      return "running";
  }
}

function normalizeJobEventSource(
  raw: string | undefined | null,
): "internal_hook" | "webhook" | "manual" | "system" {
  switch (raw) {
    case "internal_hook":
    case "webhook":
    case "manual":
      return raw;
    default:
      return "system";
  }
}

// ── PG Memory Adapter ────────────────────────────────────────────────────

class PgMemoryAdapter implements MemoryAdapter {
  private _isScoped = false;
  private db: PostgresJsDatabase<typeof schema>;
  private agentId: string;
  private sqlClient?: ReturnType<typeof postgres>;

  constructor(
    db: PostgresJsDatabase<typeof schema>,
    agentId: string,
    sqlClient?: ReturnType<typeof postgres>,
  ) {
    this.db = db;
    this.agentId = agentId;
    this.sqlClient = sqlClient;
  }

  /**
   * Return a new PgMemoryAdapter sharing the same DB connection but scoped
   * to a different agent. Used for multi-agent memory isolation.
   *
   * The returned adapter uses transaction-scoped set_config('app.agent_id', ..., true)
   * before search queries to enforce RLS without leaking context to other connections.
   */
  withAgentId(id: string): PgMemoryAdapter {
    const scoped = new PgMemoryAdapter(this.db, id, this.sqlClient);
    scoped._isScoped = true;
    return scoped;
  }

  /**
   * Set transaction-scoped RLS context before queries on scoped adapters.
   * Only needed for adapters created via withAgentId() — the main adapter
   * has session-level context set in PgAdapter.init().
   */
  private async ensureRlsContext(): Promise<void> {
    if (!this._isScoped || !this.sqlClient) return;
    await this.db.execute(sql`SELECT set_config('app.agent_id', ${this.agentId}, true)`);
  }

  private async ensureAgentExists(agentId: string): Promise<void> {
    const now = new Date();
    await this.db
      .insert(schema.agents)
      .values({
        id: agentId,
        name: agentId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  // --- Resources ---

  async createResource(input: CreateResourceInput): Promise<Resource> {
    const id = genId();
    const now = new Date();
    await this.ensureAgentExists(this.agentId);
    const [row] = await this.db
      .insert(schema.resources)
      .values({
        id,
        agentId: this.agentId,
        url: input.url ?? "",
        modality: input.modality ?? "text",
        localPath: input.localPath,
        caption: input.caption,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.mapResource(row);
  }

  async getResource(id: string): Promise<Resource | null> {
    const [row] = await this.db
      .select()
      .from(schema.resources)
      .where(eq(schema.resources.id, id))
      .limit(1);
    return row ? this.mapResource(row) : null;
  }

  // --- Memory Items ---

  async createItem(input: CreateMemoryItemInput): Promise<MemoryItem> {
    const id = genId();
    const now = new Date();
    const contentHash = (input as { contentHash?: string }).contentHash ?? null;
    const agentId = input.agentId ?? this.agentId;
    await this.ensureAgentExists(agentId);

    const [row] = await this.db
      .insert(schema.memoryItems)
      .values({
        id,
        agentId,
        resourceId: input.resourceId,
        memoryType: input.memoryType,
        summary: input.summary,
        happenedAt: input.happenedAt ? new Date(input.happenedAt) : null,
        contentHash,
        extra: input.extra ?? {},
        emotionalValence: input.emotionalValence ?? 0,
        emotionalArousal: input.emotionalArousal ?? 0,
        moodAtCapture: input.moodAtCapture,
        significance: input.significance ?? "routine",
        reflection: input.reflection,
        lesson: input.lesson,
        ...(input.visibility ? { visibility: input.visibility } : {}),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.mapItem(row);
  }

  async getItem(id: string): Promise<MemoryItem | null> {
    const [row] = await this.db
      .select()
      .from(schema.memoryItems)
      .where(eq(schema.memoryItems.id, id))
      .limit(1);
    return row ? this.mapItem(row) : null;
  }

  async listItems(filter?: MemoryItemListFilter): Promise<MemoryItem[]> {
    const conditions = [eq(schema.memoryItems.agentId, this.agentId)];
    if (filter?.memoryType) {
      conditions.push(eq(schema.memoryItems.memoryType, filter.memoryType));
    }
    if (filter?.resourceId) {
      conditions.push(eq(schema.memoryItems.resourceId, filter.resourceId));
    }
    if (filter?.significance) {
      conditions.push(eq(schema.memoryItems.significance, filter.significance));
    }

    const query = this.db
      .select()
      .from(schema.memoryItems)
      .where(and(...conditions))
      .orderBy(desc(schema.memoryItems.createdAt))
      .limit(filter?.limit ?? 100);
    if (filter?.offset) {
      (query as any).offset(filter.offset);
    }
    const rows = await query;
    return rows.map((r) => this.mapItem(r));
  }

  async findItemByHash(hash: string): Promise<MemoryItem | null> {
    const [row] = await this.db
      .select()
      .from(schema.memoryItems)
      .where(
        and(eq(schema.memoryItems.agentId, this.agentId), eq(schema.memoryItems.contentHash, hash)),
      )
      .limit(1);
    return row ? this.mapItem(row) : null;
  }

  async deleteItem(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(schema.memoryItems)
      .where(and(eq(schema.memoryItems.id, id), eq(schema.memoryItems.agentId, this.agentId)))
      .returning({ id: schema.memoryItems.id });
    return deleted.length > 0;
  }

  async updateItemEmbedding(id: string, embedding: number[]): Promise<void> {
    const validated = requireVectorDimensions(embedding, "memory_items.embedding");
    const vecStr = `[${validated.join(",")}]`;
    await this.db.execute(sql`
      UPDATE memory_items
      SET embedding = ${vecStr}::vector,
          updated_at = NOW()
      WHERE id = ${id}
        AND agent_id = ${this.agentId}
    `);
  }

  async reinforceItem(id: string): Promise<void> {
    await this.db
      .update(schema.memoryItems)
      .set({
        reinforcementCount: sql`${schema.memoryItems.reinforcementCount} + 1`,
        lastReinforcedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.memoryItems.id, id));
  }

  async searchByVector(
    embedding: Float32Array,
    limit: number,
    _agentId?: string,
  ): Promise<MemorySearchResult[]> {
    await this.ensureRlsContext();
    // pgvector cosine distance: embedding <=> query_vector
    const validated = requireVectorDimensions(Array.from(embedding), "query embedding");
    const vecStr = `[${validated.join(",")}]`;
    const rows = await this.db.execute(sql`
      SELECT *,
        1 - (embedding <=> ${vecStr}::vector) AS score
      FROM memory_items
      WHERE agent_id = ${this.agentId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vecStr}::vector
      LIMIT ${limit}
    `);

    return (rows as any[]).map((r) => ({
      item: this.mapItemFromRaw(r),
      score: Number(r.score ?? 0),
      categories: [],
    }));
  }

  async searchByKeyword(query: string, limit: number): Promise<MemorySearchResult[]> {
    await this.ensureRlsContext();
    // PostgreSQL full-text search using plainto_tsquery
    const rows = await this.db.execute(sql`
      SELECT *,
        ts_rank(
          to_tsvector('english', summary || ' ' || COALESCE(reflection, '') || ' ' || COALESCE(lesson, '')),
          plainto_tsquery('english', ${query})
        ) AS score
      FROM memory_items
      WHERE agent_id = ${this.agentId}
        AND to_tsvector('english', summary || ' ' || COALESCE(reflection, '') || ' ' || COALESCE(lesson, ''))
            @@ plainto_tsquery('english', ${query})
      ORDER BY score DESC
      LIMIT ${limit}
    `);

    return (rows as any[]).map((r) => ({
      item: this.mapItemFromRaw(r),
      score: Number(r.score ?? 0),
      categories: [],
    }));
  }

  /**
   * Search across agents for family/public memories. Used for cross-agent sharing.
   * Returns items where visibility is 'family' or 'public' from ANY agent.
   */
  async searchByKeywordShared(query: string, limit: number): Promise<MemorySearchResult[]> {
    await this.ensureRlsContext();
    const rows = await this.db.execute(sql`
      SELECT *,
        ts_rank(
          to_tsvector('english', summary || ' ' || COALESCE(reflection, '') || ' ' || COALESCE(lesson, '')),
          plainto_tsquery('english', ${query})
        ) AS score
      FROM memory_items
      WHERE agent_id != ${this.agentId}
        AND visibility IN ('family', 'public')
        AND to_tsvector('english', summary || ' ' || COALESCE(reflection, '') || ' ' || COALESCE(lesson, ''))
            @@ plainto_tsquery('english', ${query})
      ORDER BY score DESC
      LIMIT ${limit}
    `);

    return (rows as any[]).map((r) => ({
      item: this.mapItemFromRaw(r),
      score: Number(r.score ?? 0),
      categories: [],
    }));
  }

  // --- Categories ---

  async createCategory(input: CreateCategoryInput): Promise<MemoryCategory> {
    const id = genId();
    const now = new Date();
    const [row] = await this.db
      .insert(schema.memoryCategories)
      .values({
        id,
        agentId: this.agentId,
        name: input.name,
        description: input.description,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.mapCategory(row);
  }

  async getCategory(id: string): Promise<MemoryCategory | null> {
    const [row] = await this.db
      .select()
      .from(schema.memoryCategories)
      .where(
        and(eq(schema.memoryCategories.id, id), eq(schema.memoryCategories.agentId, this.agentId)),
      )
      .limit(1);
    return row ? this.mapCategory(row) : null;
  }

  async getCategoryByName(name: string): Promise<MemoryCategory | null> {
    const [row] = await this.db
      .select()
      .from(schema.memoryCategories)
      .where(
        and(
          eq(schema.memoryCategories.agentId, this.agentId),
          sql`LOWER(${schema.memoryCategories.name}) = LOWER(${name})`,
        ),
      )
      .limit(1);
    return row ? this.mapCategory(row) : null;
  }

  async getOrCreateCategory(name: string, description?: string): Promise<MemoryCategory> {
    const existing = await this.getCategoryByName(name);
    if (existing) return existing;
    try {
      return await this.createCategory({ name, description });
    } catch {
      const afterRace = await this.getCategoryByName(name);
      if (afterRace) return afterRace;
      throw new Error(`failed to getOrCreateCategory: ${name}`);
    }
  }

  async listCategories(filter?: { query?: string; limit?: number }): Promise<MemoryCategory[]> {
    const limit = filter?.limit ?? 50;
    if (filter?.query) {
      const pattern = `%${filter.query.toLowerCase()}%`;
      const rows = await this.db
        .select()
        .from(schema.memoryCategories)
        .where(
          and(
            eq(schema.memoryCategories.agentId, this.agentId),
            or(
              sql`LOWER(${schema.memoryCategories.name}) LIKE ${pattern}`,
              sql`LOWER(COALESCE(${schema.memoryCategories.description}, '')) LIKE ${pattern}`,
              sql`LOWER(COALESCE(${schema.memoryCategories.summary}, '')) LIKE ${pattern}`,
            ),
          ),
        )
        .orderBy(asc(schema.memoryCategories.name))
        .limit(limit);
      return rows.map((r) => this.mapCategory(r));
    }

    const rows = await this.db
      .select()
      .from(schema.memoryCategories)
      .where(eq(schema.memoryCategories.agentId, this.agentId))
      .orderBy(asc(schema.memoryCategories.name))
      .limit(limit);
    return rows.map((r) => this.mapCategory(r));
  }

  async getCategoryItems(categoryId: string, limit = 100): Promise<MemoryItem[]> {
    const rows = await this.db
      .select({ item: schema.memoryItems })
      .from(schema.categoryItems)
      .innerJoin(schema.memoryItems, eq(schema.categoryItems.itemId, schema.memoryItems.id))
      .where(
        and(
          eq(schema.categoryItems.categoryId, categoryId),
          eq(schema.memoryItems.agentId, this.agentId),
        ),
      )
      .orderBy(desc(schema.memoryItems.createdAt))
      .limit(limit);
    return rows.map((r) => this.mapItem(r.item));
  }

  async getCategoryItemCount(categoryId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.categoryItems)
      .innerJoin(schema.memoryItems, eq(schema.categoryItems.itemId, schema.memoryItems.id))
      .where(
        and(
          eq(schema.categoryItems.categoryId, categoryId),
          eq(schema.memoryItems.agentId, this.agentId),
        ),
      );
    return Number(row?.count ?? 0);
  }

  async getItemCategories(itemId: string): Promise<MemoryCategory[]> {
    const rows = await this.db
      .select({ category: schema.memoryCategories })
      .from(schema.categoryItems)
      .innerJoin(
        schema.memoryCategories,
        eq(schema.categoryItems.categoryId, schema.memoryCategories.id),
      )
      .where(
        and(
          eq(schema.categoryItems.itemId, itemId),
          eq(schema.memoryCategories.agentId, this.agentId),
        ),
      )
      .orderBy(asc(schema.memoryCategories.name));
    return rows.map((r) => this.mapCategory(r.category));
  }

  async linkItemToCategory(itemId: string, categoryId: string): Promise<void> {
    // Same FK race as linkItemToEntity — retry up to 3 times
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.db
          .insert(schema.categoryItems)
          .values({ itemId, categoryId })
          .onConflictDoNothing();
        return;
      } catch (err) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }

  async unlinkItemFromCategory(itemId: string, categoryId: string): Promise<void> {
    await this.db
      .delete(schema.categoryItems)
      .where(
        and(
          eq(schema.categoryItems.itemId, itemId),
          eq(schema.categoryItems.categoryId, categoryId),
        ),
      );
  }

  async updateCategorySummary(categoryId: string, summary: string): Promise<void> {
    await this.db
      .update(schema.memoryCategories)
      .set({ summary, updatedAt: new Date() })
      .where(eq(schema.memoryCategories.id, categoryId));
  }

  async deleteCategory(categoryId: string): Promise<void> {
    await this.db
      .delete(schema.categoryItems)
      .where(eq(schema.categoryItems.categoryId, categoryId));
    await this.db.delete(schema.memoryCategories).where(eq(schema.memoryCategories.id, categoryId));
  }

  async searchItemsByKeyword(query: string, limit: number): Promise<MemoryItem[]> {
    const results = await this.searchByKeyword(query, limit);
    return results.map((r) => r.item);
  }

  // --- Entities ---

  async createEntity(input: CreateEntityInput): Promise<Entity> {
    const id = genId();
    const now = new Date();
    const agentId = input.agentId ?? this.agentId;
    await this.ensureAgentExists(agentId);
    const [row] = await this.db
      .insert(schema.entities)
      .values({
        id,
        agentId,
        name: input.name,
        entityType: input.entityType ?? "person",
        relationship: input.relationship,
        bondStrength: input.bondStrength ?? 0.5,
        emotionalTexture: input.emotionalTexture,
        profileSummary: (input as { profileSummary?: string }).profileSummary,
        firstMentionedAt: now,
        lastMentionedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.mapEntity(row);
  }

  async getEntity(id: string): Promise<Entity | null> {
    const [row] = await this.db
      .select()
      .from(schema.entities)
      .where(eq(schema.entities.id, id))
      .limit(1);
    return row ? this.mapEntity(row) : null;
  }

  async findEntityByName(name: string): Promise<Entity | null> {
    const [row] = await this.db
      .select()
      .from(schema.entities)
      .where(
        and(
          eq(schema.entities.agentId, this.agentId),
          sql`LOWER(${schema.entities.name}) = LOWER(${name})`,
        ),
      )
      .limit(1);
    return row ? this.mapEntity(row) : null;
  }

  async getOrCreateEntity(name: string, input?: Partial<CreateEntityInput>): Promise<Entity> {
    const existing = await this.findEntityByName(name);
    if (existing) return existing;
    try {
      return await this.createEntity({
        name,
        entityType: input?.entityType,
        relationship: input?.relationship,
        bondStrength: input?.bondStrength,
        emotionalTexture: input?.emotionalTexture,
        agentId: input?.agentId,
      });
    } catch {
      const afterRace = await this.findEntityByName(name);
      if (afterRace) return afterRace;
      throw new Error(`failed to getOrCreateEntity: ${name}`);
    }
  }

  async listEntities(filter?: MemoryEntityListFilter): Promise<Entity[]> {
    const conditions = [eq(schema.entities.agentId, this.agentId)];
    if (filter?.entityType) {
      conditions.push(eq(schema.entities.entityType, filter.entityType));
    }
    if (filter?.minBondStrength !== undefined) {
      conditions.push(gte(schema.entities.bondStrength, filter.minBondStrength));
    }
    const rows = await this.db
      .select()
      .from(schema.entities)
      .where(and(...conditions))
      .orderBy(desc(schema.entities.bondStrength), desc(schema.entities.memoryCount))
      .limit(filter?.limit ?? 100);
    return rows.map((r) => this.mapEntity(r));
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
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (fields.relationship !== undefined) updates.relationship = fields.relationship;
    if (fields.bondStrength !== undefined) updates.bondStrength = fields.bondStrength;
    if (fields.emotionalTexture !== undefined) updates.emotionalTexture = fields.emotionalTexture;
    if (fields.profileSummary !== undefined) updates.profileSummary = fields.profileSummary;
    if (fields.entityType !== undefined) updates.entityType = fields.entityType;

    const [row] = await this.db
      .update(schema.entities)
      .set(updates as any)
      .where(and(eq(schema.entities.id, id), eq(schema.entities.agentId, this.agentId)))
      .returning();
    return row ? this.mapEntity(row) : null;
  }

  async getEntityItems(entityId: string, limit = 100): Promise<MemoryItem[]> {
    const rows = await this.db
      .select({ item: schema.memoryItems })
      .from(schema.itemEntities)
      .innerJoin(schema.memoryItems, eq(schema.itemEntities.itemId, schema.memoryItems.id))
      .where(
        and(
          eq(schema.itemEntities.entityId, entityId),
          eq(schema.memoryItems.agentId, this.agentId),
        ),
      )
      .orderBy(desc(schema.memoryItems.createdAt))
      .limit(limit);
    return rows.map((r) => this.mapItem(r.item));
  }

  async getItemEntities(itemId: string): Promise<Entity[]> {
    const rows = await this.db
      .select({ entity: schema.entities })
      .from(schema.itemEntities)
      .innerJoin(schema.entities, eq(schema.itemEntities.entityId, schema.entities.id))
      .where(and(eq(schema.itemEntities.itemId, itemId), eq(schema.entities.agentId, this.agentId)))
      .orderBy(desc(schema.entities.bondStrength));
    return rows.map((r) => this.mapEntity(r.entity));
  }

  async linkItemToEntity(itemId: string, entityId: string, role: string): Promise<void> {
    // The PG write mirror fires createItem, createEntity, and linkItemToEntity as
    // independent async operations. The FK references (item_id, entity_id) may not
    // exist yet when this runs. Retry up to 3 times with increasing delays.
    // We catch ANY error on non-final attempts because postgres.js wraps FK violations
    // as "Failed query: ..." rather than including "violates foreign key" in the message.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.db
          .insert(schema.itemEntities)
          .values({ itemId, entityId, role })
          .onConflictDoNothing();

        // Update entity memory count + last mentioned
        await this.db
          .update(schema.entities)
          .set({
            memoryCount: sql`${schema.entities.memoryCount} + 1`,
            lastMentionedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.entities.id, entityId));
        return;
      } catch (err) {
        if (attempt < 2) {
          // FK reference likely not written yet — wait and retry
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }

  // --- Reflections ---

  async createReflection(input: CreateReflectionInput): Promise<Reflection> {
    const id = genId();
    const agentId = input.agentId ?? this.agentId;
    await this.ensureAgentExists(agentId);
    const [row] = await this.db
      .insert(schema.reflections)
      .values({
        id,
        agentId,
        triggerType: input.triggerType as any,
        periodStart: input.periodStart ? new Date(input.periodStart) : null,
        periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
        content: input.content,
        lessonsExtracted: input.lessonsExtracted ?? [],
        entitiesInvolved: input.entitiesInvolved ?? [],
        selfInsights: input.selfInsights ?? [],
        mood: input.mood,
        createdAt: new Date(),
      })
      .returning();
    return this.mapReflection(row);
  }

  async listReflections(filter?: { triggerType?: string; limit?: number }): Promise<Reflection[]> {
    const conditions = [eq(schema.reflections.agentId, this.agentId)];
    if (filter?.triggerType) {
      conditions.push(eq(schema.reflections.triggerType, filter.triggerType as any));
    }

    const rows = await this.db
      .select()
      .from(schema.reflections)
      .where(and(...conditions))
      .orderBy(desc(schema.reflections.createdAt))
      .limit(filter?.limit ?? 50);
    return rows.map((r) => this.mapReflection(r));
  }

  // --- Lessons (SIS) ---

  async createLesson(input: CreateLessonInput): Promise<Lesson> {
    const id = genId();
    const now = new Date();
    const agentId = input.agentId ?? this.agentId;
    await this.ensureAgentExists(agentId);
    const [row] = await this.db
      .insert(schema.lessons)
      .values({
        id,
        agentId,
        type: input.type as any,
        context: input.context,
        action: input.action,
        outcome: input.outcome,
        lesson: input.lesson,
        correction: input.correction,
        confidence: input.confidence ?? 0.5,
        occurrences: 1,
        lastSeen: now,
        tags: input.tags ?? [],
        relatedTools: input.relatedTools ?? [],
        sourceEpisodeIds: input.sourceEpisodeIds ?? [],
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.mapLesson(row);
  }

  async listLessons(filter?: { limit?: number }): Promise<Lesson[]> {
    const rows = await this.db
      .select()
      .from(schema.lessons)
      .where(eq(schema.lessons.agentId, this.agentId))
      .orderBy(desc(schema.lessons.confidence))
      .limit(filter?.limit ?? 100);
    return rows.map((r) => this.mapLesson(r));
  }

  async searchLessons(query: string, limit: number): Promise<Lesson[]> {
    await this.ensureRlsContext();
    const rows = await this.db.execute(sql`
      SELECT *,
        ts_rank(
          to_tsvector('english', context || ' ' || action || ' ' || outcome || ' ' || lesson || ' ' || COALESCE(correction, '')),
          plainto_tsquery('english', ${query})
        ) AS rank
      FROM lessons
      WHERE agent_id = ${this.agentId}
        AND to_tsvector('english', context || ' ' || action || ' ' || outcome || ' ' || lesson || ' ' || COALESCE(correction, ''))
            @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `);
    return (rows as any[]).map((r) => this.mapLessonFromRaw(r));
  }

  async searchLessonsByKeyword(query: string, limit: number): Promise<Lesson[]> {
    return this.searchLessons(query, limit);
  }

  async getLessonsByTool(toolName: string, limit: number): Promise<Lesson[]> {
    await this.ensureRlsContext();
    const likePattern = `%"${toolName}"%`;
    const rows = await this.db.execute(sql`
      SELECT * FROM lessons
      WHERE agent_id = ${this.agentId}
        AND related_tools::text LIKE ${likePattern}
      ORDER BY confidence DESC, last_seen DESC
      LIMIT ${limit}
    `);
    return (rows as any[]).map((r) => this.mapLessonFromRaw(r));
  }

  async reinforceLesson(id: string): Promise<void> {
    await this.db
      .update(schema.lessons)
      .set({
        occurrences: sql`${schema.lessons.occurrences} + 1`,
        confidence: sql`LEAST(${schema.lessons.confidence} + 0.05, 1.0)`,
        lastSeen: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.lessons.id, id));
  }

  async decayLesson(id: string, amount: number): Promise<void> {
    await this.db
      .update(schema.lessons)
      .set({
        confidence: sql`GREATEST(${schema.lessons.confidence} - ${amount}, 0.0)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.lessons.id, id));
  }

  async decayLessons(olderThanDays: number, amount: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const result = await this.db
      .update(schema.lessons)
      .set({
        confidence: sql`GREATEST(${schema.lessons.confidence} - ${amount}, 0.0)`,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.lessons.agentId, this.agentId), lt(schema.lessons.lastSeen, cutoff)))
      .returning({ id: schema.lessons.id });
    return result.length;
  }

  async mergeLessonOccurrences(
    keeperId: string,
    duplicateOccurrences: number,
    mergedTags: string[],
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE lessons SET
        occurrences = occurrences + ${duplicateOccurrences},
        tags = ${JSON.stringify(mergedTags)}::jsonb,
        updated_at = now()
      WHERE id = ${keeperId}
    `);
  }

  async deleteLesson(id: string): Promise<void> {
    await this.db.delete(schema.lessons).where(eq(schema.lessons.id, id));
  }

  async createPersonalSkillCandidate(
    input: CreatePersonalSkillCandidateInput,
  ): Promise<PersonalSkillCandidate> {
    const id = genId();
    const now = new Date();
    const agentId = input.agentId ?? this.agentId;
    await this.ensureAgentExists(agentId);
    const [row] = await this.db
      .insert(schema.personalSkillCandidates)
      .values({
        id,
        agentId,
        operatorId: input.operatorId ?? null,
        profileId: input.profileId ?? null,
        scope: input.scope ?? "operator",
        title: input.title,
        summary: input.summary,
        triggerPatterns: input.triggerPatterns ?? [],
        procedureOutline: input.procedureOutline ?? null,
        preconditions: input.preconditions ?? [],
        executionSteps: input.executionSteps ?? [],
        expectedOutcomes: input.expectedOutcomes ?? [],
        relatedTools: input.relatedTools ?? [],
        sourceMemoryIds: input.sourceMemoryIds ?? [],
        sourceEpisodeIds: input.sourceEpisodeIds ?? [],
        sourceTaskIds: input.sourceTaskIds ?? [],
        sourceLessonIds: input.sourceLessonIds ?? [],
        supersedesCandidateIds: input.supersedesCandidateIds ?? [],
        supersededByCandidateId: input.supersededByCandidateId ?? null,
        conflictsWithCandidateIds: input.conflictsWithCandidateIds ?? [],
        contradictionCount: input.contradictionCount ?? 0,
        evidenceCount: input.evidenceCount ?? 0,
        recurrenceCount: input.recurrenceCount ?? 1,
        confidence: input.confidence ?? 0.5,
        strength: input.strength ?? 0.5,
        usageCount: input.usageCount ?? 0,
        successCount: input.successCount ?? 0,
        failureCount: input.failureCount ?? 0,
        state: input.state ?? "candidate",
        operatorNotes: input.operatorNotes ?? null,
        lastReinforcedAt: null,
        lastContradictedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.mapPersonalSkillCandidate(row);
  }

  async listPersonalSkillCandidates(filter?: {
    state?: PersonalSkillCandidateState;
    limit?: number;
  }): Promise<PersonalSkillCandidate[]> {
    const conditions = [eq(schema.personalSkillCandidates.agentId, this.agentId)];
    if (filter?.state) {
      conditions.push(eq(schema.personalSkillCandidates.state, filter.state as any));
    }
    const rows = await this.db
      .select()
      .from(schema.personalSkillCandidates)
      .where(and(...conditions))
      .orderBy(
        desc(schema.personalSkillCandidates.confidence),
        desc(schema.personalSkillCandidates.updatedAt),
      )
      .limit(filter?.limit ?? 50);
    return rows.map((row) => this.mapPersonalSkillCandidate(row));
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
    const [row] = await this.db
      .update(schema.personalSkillCandidates)
      .set({
        ...(fields.scope !== undefined ? { scope: fields.scope as any } : {}),
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        ...(fields.summary !== undefined ? { summary: fields.summary } : {}),
        ...(fields.triggerPatterns !== undefined
          ? { triggerPatterns: fields.triggerPatterns }
          : {}),
        ...(fields.procedureOutline !== undefined
          ? { procedureOutline: fields.procedureOutline }
          : {}),
        ...(fields.preconditions !== undefined ? { preconditions: fields.preconditions } : {}),
        ...(fields.executionSteps !== undefined ? { executionSteps: fields.executionSteps } : {}),
        ...(fields.expectedOutcomes !== undefined
          ? { expectedOutcomes: fields.expectedOutcomes }
          : {}),
        ...(fields.relatedTools !== undefined ? { relatedTools: fields.relatedTools } : {}),
        ...(fields.sourceMemoryIds !== undefined
          ? { sourceMemoryIds: fields.sourceMemoryIds }
          : {}),
        ...(fields.sourceEpisodeIds !== undefined
          ? { sourceEpisodeIds: fields.sourceEpisodeIds }
          : {}),
        ...(fields.sourceTaskIds !== undefined ? { sourceTaskIds: fields.sourceTaskIds } : {}),
        ...(fields.sourceLessonIds !== undefined
          ? { sourceLessonIds: fields.sourceLessonIds }
          : {}),
        ...(fields.supersedesCandidateIds !== undefined
          ? { supersedesCandidateIds: fields.supersedesCandidateIds }
          : {}),
        ...(fields.supersededByCandidateId !== undefined
          ? { supersededByCandidateId: fields.supersededByCandidateId }
          : {}),
        ...(fields.conflictsWithCandidateIds !== undefined
          ? { conflictsWithCandidateIds: fields.conflictsWithCandidateIds }
          : {}),
        ...(fields.contradictionCount !== undefined
          ? { contradictionCount: fields.contradictionCount }
          : {}),
        ...(fields.evidenceCount !== undefined ? { evidenceCount: fields.evidenceCount } : {}),
        ...(fields.recurrenceCount !== undefined
          ? { recurrenceCount: fields.recurrenceCount }
          : {}),
        ...(fields.confidence !== undefined ? { confidence: fields.confidence } : {}),
        ...(fields.strength !== undefined ? { strength: fields.strength } : {}),
        ...(fields.usageCount !== undefined ? { usageCount: fields.usageCount } : {}),
        ...(fields.successCount !== undefined ? { successCount: fields.successCount } : {}),
        ...(fields.failureCount !== undefined ? { failureCount: fields.failureCount } : {}),
        ...(fields.state !== undefined ? { state: fields.state as any } : {}),
        ...(fields.operatorNotes !== undefined ? { operatorNotes: fields.operatorNotes } : {}),
        ...(fields.lastReviewedAt !== undefined
          ? { lastReviewedAt: fields.lastReviewedAt ? new Date(fields.lastReviewedAt) : null }
          : {}),
        ...(fields.lastUsedAt !== undefined
          ? { lastUsedAt: fields.lastUsedAt ? new Date(fields.lastUsedAt) : null }
          : {}),
        ...(fields.lastReinforcedAt !== undefined
          ? {
              lastReinforcedAt: fields.lastReinforcedAt ? new Date(fields.lastReinforcedAt) : null,
            }
          : {}),
        ...(fields.lastContradictedAt !== undefined
          ? {
              lastContradictedAt: fields.lastContradictedAt
                ? new Date(fields.lastContradictedAt)
                : null,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.personalSkillCandidates.id, id),
          eq(schema.personalSkillCandidates.agentId, this.agentId),
        ),
      )
      .returning();
    return row ? this.mapPersonalSkillCandidate(row) : null;
  }

  async deletePersonalSkillCandidate(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.personalSkillCandidates)
      .where(
        and(
          eq(schema.personalSkillCandidates.id, id),
          eq(schema.personalSkillCandidates.agentId, this.agentId),
        ),
      )
      .returning({ id: schema.personalSkillCandidates.id });
    return rows.length > 0;
  }

  async createPersonalSkillReviewEvent(
    input: CreatePersonalSkillReviewEventInput,
  ): Promise<PersonalSkillReviewEvent> {
    const id = genId();
    const now = new Date();
    const agentId = input.agentId ?? this.agentId;
    await this.ensureAgentExists(agentId);
    const [row] = await this.db
      .insert(schema.personalSkillReviews)
      .values({
        id,
        candidateId: input.candidateId,
        agentId,
        actorType: input.actorType,
        action: input.action,
        reason: input.reason ?? null,
        details: input.details ?? {},
        createdAt: now,
      })
      .returning();
    return this.mapPersonalSkillReviewEvent(row);
  }

  async listPersonalSkillReviewEvents(filter: {
    candidateId: string;
    limit?: number;
  }): Promise<PersonalSkillReviewEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.personalSkillReviews)
      .where(
        and(
          eq(schema.personalSkillReviews.candidateId, filter.candidateId),
          eq(schema.personalSkillReviews.agentId, this.agentId),
        ),
      )
      .orderBy(desc(schema.personalSkillReviews.createdAt))
      .limit(filter.limit ?? 20);
    return rows.map((row) => this.mapPersonalSkillReviewEvent(row));
  }

  // --- Knowledge observations ---

  async getKnowledgeObservation(id: string): Promise<KnowledgeObservation | null> {
    await this.ensureRlsContext();
    const [row] = await this.db
      .select()
      .from(schema.knowledgeObservations)
      .where(
        and(
          eq(schema.knowledgeObservations.id, id),
          eq(schema.knowledgeObservations.agentId, this.agentId),
        ),
      )
      .limit(1);
    return row ? this.mapKnowledgeObservation(row) : null;
  }

  async listKnowledgeObservations(filter?: {
    kinds?: KnowledgeObservation["kind"][];
    subjectType?: KnowledgeObservation["subjectType"];
    subjectId?: string;
    status?: KnowledgeObservation["status"];
    limit?: number;
  }): Promise<KnowledgeObservation[]> {
    await this.ensureRlsContext();
    const conditions = [eq(schema.knowledgeObservations.agentId, this.agentId)];
    if (filter?.kinds?.length) {
      conditions.push(inArray(schema.knowledgeObservations.kind, filter.kinds as any[]));
    }
    if (filter?.subjectType) {
      conditions.push(eq(schema.knowledgeObservations.subjectType, filter.subjectType));
    }
    if (typeof filter?.subjectId === "string") {
      conditions.push(eq(schema.knowledgeObservations.subjectId, filter.subjectId));
    }
    if (filter?.status) {
      conditions.push(eq(schema.knowledgeObservations.status, filter.status));
    }

    const rows = await this.db
      .select()
      .from(schema.knowledgeObservations)
      .where(and(...conditions))
      .orderBy(
        desc(schema.knowledgeObservations.lastSupportedAt),
        desc(schema.knowledgeObservations.confidence),
        desc(schema.knowledgeObservations.updatedAt),
      )
      .limit(filter?.limit ?? 50);
    return rows.map((row) => this.mapKnowledgeObservation(row));
  }

  async searchKnowledgeObservations(
    query: string,
    options?: KnowledgeObservationSearchOptions,
  ): Promise<KnowledgeObservationSearchResult[]> {
    await this.ensureRlsContext();
    const limit = Math.max(1, options?.limit ?? 8);
    const statuses = options?.statuses?.length ? options.statuses : (["active"] as const);
    const conditions: ReturnType<typeof sql>[] = [sql`agent_id = ${this.agentId}`];

    if (statuses.length > 0) {
      conditions.push(
        sql`status IN (${sql.join(
          statuses.map((status) => sql`${status}`),
          sql`, `,
        )})`,
      );
    }
    if (options?.kinds?.length) {
      conditions.push(
        sql`kind IN (${sql.join(
          options.kinds.map((kind) => sql`${kind}`),
          sql`, `,
        )})`,
      );
    }
    if (options?.subjectType) {
      conditions.push(sql`subject_type = ${options.subjectType}`);
    }
    if (typeof options?.subjectId === "string") {
      conditions.push(sql`subject_id = ${options.subjectId}`);
    }
    if (typeof options?.minConfidence === "number") {
      conditions.push(sql`confidence >= ${options.minConfidence}`);
    }
    if (typeof options?.minFreshness === "number") {
      conditions.push(sql`freshness >= ${options.minFreshness}`);
    }

    const trimmed = query.trim();
    const textVector = sql`
      to_tsvector(
        'english',
        summary || ' ' || COALESCE(detail, '') || ' ' || translate(COALESCE(tags::text, ''), '[]\"', '    ')
      )
    `;

    const rows =
      trimmed.length > 0
        ? await this.db.execute(sql`
            SELECT *,
              ts_rank(${textVector}, plainto_tsquery('english', ${trimmed})) AS score
            FROM knowledge_observations
            WHERE ${sql.join(
              [...conditions, sql`${textVector} @@ plainto_tsquery('english', ${trimmed})`],
              sql` AND `,
            )}
            ORDER BY score DESC, confidence DESC, freshness DESC, updated_at DESC
            LIMIT ${limit}
          `)
        : await this.db.execute(sql`
            SELECT *,
              0::real AS score
            FROM knowledge_observations
            WHERE ${sql.join(conditions, sql` AND `)}
            ORDER BY confidence DESC, freshness DESC, updated_at DESC
            LIMIT ${limit}
          `);

    const searchResults: KnowledgeObservationSearchResult[] = [];
    for (const row of rows as any[]) {
      const observation = this.mapKnowledgeObservationFromRaw(row);
      const topEvidence = await this.getKnowledgeObservationEvidence(observation.id);
      searchResults.push({
        observation,
        score: Number(row.score ?? 0),
        topEvidence: topEvidence.slice(0, 3),
      });
    }
    return searchResults;
  }

  async getKnowledgeObservationEvidence(
    observationId: string,
  ): Promise<KnowledgeObservationEvidence[]> {
    await this.ensureRlsContext();
    const observation = await this.getKnowledgeObservation(observationId);
    if (!observation) return [];
    const rows = await this.db
      .select()
      .from(schema.knowledgeObservationEvidence)
      .where(eq(schema.knowledgeObservationEvidence.observationId, observationId))
      .orderBy(
        desc(schema.knowledgeObservationEvidence.weight),
        desc(schema.knowledgeObservationEvidence.createdAt),
      );
    return rows.map((row) => this.mapKnowledgeObservationEvidence(row));
  }

  async upsertKnowledgeObservation(
    input: CreateKnowledgeObservationInput,
  ): Promise<KnowledgeObservation> {
    await this.ensureRlsContext();
    const now = new Date();
    const agentId = input.agentId ?? this.agentId;
    await this.ensureAgentExists(agentId);

    const values = this.buildKnowledgeObservationValues(input, now);

    const observation = await this.db.transaction(async (tx) => {
      await this.acquireKnowledgeObservationCanonicalLock(tx, agentId, input.canonicalKey);
      const existing = await tx
        .select()
        .from(schema.knowledgeObservations)
        .where(
          and(
            eq(schema.knowledgeObservations.agentId, agentId),
            eq(schema.knowledgeObservations.canonicalKey, input.canonicalKey),
            eq(schema.knowledgeObservations.status, "active"),
          ),
        )
        .limit(1);

      let row: any;
      if (existing[0]) {
        [row] = await tx
          .update(schema.knowledgeObservations)
          .set({
            ...values,
            updatedAt: now,
          })
          .where(eq(schema.knowledgeObservations.id, existing[0].id))
          .returning();
        if (input.evidence) {
          await tx
            .delete(schema.knowledgeObservationEvidence)
            .where(eq(schema.knowledgeObservationEvidence.observationId, existing[0].id));
          await this.insertKnowledgeObservationEvidence(tx, existing[0].id, input.evidence, now);
        }
      } else {
        const id = genId();
        [row] = await tx
          .insert(schema.knowledgeObservations)
          .values({
            id,
            agentId,
            ...values,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (input.evidence?.length) {
          await this.insertKnowledgeObservationEvidence(tx, id, input.evidence, now);
        }
      }
      return row;
    });

    return this.mapKnowledgeObservation(observation);
  }

  async supersedeKnowledgeObservation(params: {
    id: string;
    successor: CreateKnowledgeObservationInput;
  }): Promise<KnowledgeObservation> {
    await this.ensureRlsContext();
    const now = new Date();
    const agentId = params.successor.agentId ?? this.agentId;
    await this.ensureAgentExists(agentId);

    const successorRow = await this.db.transaction(async (tx) => {
      await this.acquireKnowledgeObservationCanonicalLock(
        tx,
        agentId,
        params.successor.canonicalKey,
      );
      const [current] = await tx
        .select()
        .from(schema.knowledgeObservations)
        .where(
          and(
            eq(schema.knowledgeObservations.id, params.id),
            eq(schema.knowledgeObservations.agentId, this.agentId),
          ),
        )
        .limit(1);

      if (!current) {
        throw new Error(`Knowledge observation not found: ${params.id}`);
      }

      const values = this.buildKnowledgeObservationValues(
        {
          ...params.successor,
          supersedesObservationId: current.id,
          status: params.successor.status ?? "active",
        },
        now,
      );

      await tx
        .update(schema.knowledgeObservations)
        .set({
          status: "superseded",
          updatedAt: now,
        })
        .where(eq(schema.knowledgeObservations.id, current.id));

      const successorId = genId();
      const [row] = await tx
        .insert(schema.knowledgeObservations)
        .values({
          id: successorId,
          agentId,
          ...values,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (params.successor.evidence?.length) {
        await this.insertKnowledgeObservationEvidence(
          tx,
          successorId,
          params.successor.evidence,
          now,
        );
      }
      return row;
    });

    return this.mapKnowledgeObservation(successorRow);
  }

  async markKnowledgeObservationStale(id: string): Promise<void> {
    await this.ensureRlsContext();
    await this.db
      .update(schema.knowledgeObservations)
      .set({
        status: "stale",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.knowledgeObservations.id, id),
          eq(schema.knowledgeObservations.agentId, this.agentId),
        ),
      );
  }

  async invalidateKnowledgeObservation(id: string, reason?: string): Promise<void> {
    await this.ensureRlsContext();
    const existing = await this.getKnowledgeObservation(id);
    if (!existing) return;
    await this.db
      .update(schema.knowledgeObservations)
      .set({
        status: "invalidated",
        metadata: {
          ...existing.metadata,
          ...(reason ? { invalidationReason: reason } : {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.knowledgeObservations.id, id));
  }

  // --- Live Inbox ---

  async createLiveCandidate(): Promise<void> {
    // Live inbox table not yet in PG schema — silently skip
  }

  async listLiveCandidates(): Promise<never[]> {
    // Live inbox table not yet in PG schema — return empty
    return [];
  }

  async markLiveCandidateMerged(): Promise<void> {
    // Live inbox table not yet in PG schema — silently skip
  }

  async markLiveCandidatePromoted(): Promise<void> {
    // Live inbox table not yet in PG schema — silently skip
  }

  // --- Model Feedback ---

  async recordModelFeedback(input: RecordModelFeedbackInput): Promise<void> {
    const id = genId();
    const agentId = input.agentId ?? this.agentId;
    await this.ensureAgentExists(agentId);
    await this.db.insert(schema.modelFeedback).values({
      id,
      agentId,
      provider: input.provider,
      model: input.model,
      tier: input.tier,
      sessionType: input.sessionType,
      complexityScore: input.complexityScore ?? 0,
      durationMs: input.durationMs ?? 0,
      success: input.success ?? true,
      errorType: input.errorType,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      totalTokens: input.totalTokens ?? 0,
      toolCallCount: input.toolCallCount ?? 0,
      userFeedback: (input as { userFeedback?: "up" | "down" | null }).userFeedback,
      sessionKey: input.sessionKey,
      profile: input.profile,
      createdAt: new Date(),
    });
  }

  async getLatestModelFeedbackId(sessionKey: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: schema.modelFeedback.id })
      .from(schema.modelFeedback)
      .where(eq(schema.modelFeedback.sessionKey, sessionKey))
      .orderBy(desc(schema.modelFeedback.createdAt))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async updateModelFeedbackSelfEval(id: string, score: number, reasoning: string): Promise<void> {
    await this.db
      .update(schema.modelFeedback)
      .set({
        selfEvalScore: score,
        selfEvalReasoning: reasoning,
      })
      .where(eq(schema.modelFeedback.id, id));
  }

  async updateModelFeedbackUserRating(
    sessionKey: string,
    feedback: "up" | "down",
  ): Promise<number> {
    const result = await this.db
      .update(schema.modelFeedback)
      .set({ userFeedback: feedback })
      .where(
        and(
          eq(schema.modelFeedback.sessionKey, sessionKey),
          sql`${schema.modelFeedback.userFeedback} IS NULL`,
        ),
      )
      .returning({ id: schema.modelFeedback.id });
    return result.length;
  }

  // --- Stats ---

  async getStats(): Promise<MemoryStats> {
    const agentFilter = eq(schema.memoryItems.agentId, this.agentId);
    const [itemCount] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.memoryItems)
      .where(agentFilter);
    const [resourceCount] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.resources)
      .where(eq(schema.resources.agentId, this.agentId));
    const [categoryCount] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.memoryCategories)
      .where(eq(schema.memoryCategories.agentId, this.agentId));
    const [entityCount] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.entities)
      .where(eq(schema.entities.agentId, this.agentId));
    const [reflectionCount] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.reflections)
      .where(eq(schema.reflections.agentId, this.agentId));
    const [lessonCount] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.lessons)
      .where(eq(schema.lessons.agentId, this.agentId));
    const [feedbackCount] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.modelFeedback)
      .where(eq(schema.modelFeedback.agentId, this.agentId));
    const typeRows = await this.db
      .select({ memoryType: schema.memoryItems.memoryType, count: sql<number>`count(*)` })
      .from(schema.memoryItems)
      .where(eq(schema.memoryItems.agentId, this.agentId))
      .groupBy(schema.memoryItems.memoryType);
    const itemsByType: Record<string, number> = {};
    for (const row of typeRows) {
      itemsByType[row.memoryType] = Number(row.count);
    }

    return {
      resources: Number(resourceCount.count),
      items: Number(itemCount.count),
      categories: Number(categoryCount.count),
      entities: Number(entityCount.count),
      reflections: Number(reflectionCount.count),
      lessons: Number(lessonCount.count),
      modelFeedback: Number(feedbackCount.count),
      itemsByType,
      vecAvailable: true,
    };
  }

  // --- Row Mappers (PG row → MemU type) ---

  private mapResource(row: any): Resource {
    return {
      id: row.id,
      url: row.url,
      modality: row.modality,
      localPath: row.localPath ?? undefined,
      caption: row.caption ?? undefined,
      embedding: null, // Embeddings returned separately when needed
      createdAt: row.createdAt?.toISOString() ?? "",
      updatedAt: row.updatedAt?.toISOString() ?? "",
    };
  }

  private mapItem(row: any): MemoryItem {
    return {
      id: row.id,
      resourceId: row.resourceId ?? undefined,
      memoryType: row.memoryType,
      summary: row.summary,
      embedding: null,
      happenedAt: row.happenedAt?.toISOString() ?? undefined,
      contentHash: row.contentHash ?? undefined,
      reinforcementCount: row.reinforcementCount ?? 1,
      lastReinforcedAt: row.lastReinforcedAt?.toISOString() ?? undefined,
      extra: row.extra ?? {},
      emotionalValence: row.emotionalValence ?? 0,
      emotionalArousal: row.emotionalArousal ?? 0,
      moodAtCapture: row.moodAtCapture ?? undefined,
      significance: row.significance ?? "routine",
      reflection: row.reflection ?? undefined,
      lesson: row.lesson ?? undefined,
      createdAt: row.createdAt?.toISOString() ?? "",
      updatedAt: row.updatedAt?.toISOString() ?? "",
    };
  }

  private mapItemFromRaw(row: any): MemoryItem {
    return {
      id: row.id,
      resourceId: row.resource_id ?? undefined,
      memoryType: row.memory_type,
      summary: row.summary,
      embedding: null,
      happenedAt: row.happened_at ?? undefined,
      contentHash: row.content_hash ?? undefined,
      reinforcementCount: row.reinforcement_count ?? 1,
      lastReinforcedAt: row.last_reinforced_at ?? undefined,
      extra: typeof row.extra === "string" ? JSON.parse(row.extra) : (row.extra ?? {}),
      emotionalValence: row.emotional_valence ?? 0,
      emotionalArousal: row.emotional_arousal ?? 0,
      moodAtCapture: row.mood_at_capture ?? undefined,
      significance: row.significance ?? "routine",
      reflection: row.reflection ?? undefined,
      lesson: row.lesson ?? undefined,
      createdAt: row.created_at ?? "",
      updatedAt: row.updated_at ?? "",
    };
  }

  private mapCategory(row: any): MemoryCategory {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      embedding: null,
      summary: row.summary ?? undefined,
      createdAt: row.createdAt?.toISOString() ?? "",
      updatedAt: row.updatedAt?.toISOString() ?? "",
    };
  }

  private mapEntity(row: any): Entity {
    return {
      id: row.id,
      name: row.name,
      entityType: row.entityType ?? "person",
      relationship: row.relationship ?? undefined,
      bondStrength: row.bondStrength ?? 0.5,
      emotionalTexture: row.emotionalTexture ?? undefined,
      profileSummary: row.profileSummary ?? undefined,
      firstMentionedAt: row.firstMentionedAt?.toISOString() ?? undefined,
      lastMentionedAt: row.lastMentionedAt?.toISOString() ?? undefined,
      memoryCount: row.memoryCount ?? 0,
      embedding: null,
      createdAt: row.createdAt?.toISOString() ?? "",
      updatedAt: row.updatedAt?.toISOString() ?? "",
    };
  }

  private mapReflection(row: any): Reflection {
    return {
      id: row.id,
      triggerType: row.triggerType,
      periodStart: row.periodStart?.toISOString() ?? undefined,
      periodEnd: row.periodEnd?.toISOString() ?? undefined,
      content: row.content,
      lessonsExtracted: row.lessonsExtracted ?? [],
      entitiesInvolved: row.entitiesInvolved ?? [],
      selfInsights: row.selfInsights ?? [],
      mood: row.mood ?? undefined,
      createdAt: row.createdAt?.toISOString() ?? "",
    };
  }

  private mapKnowledgeObservation(row: any): KnowledgeObservation {
    return {
      id: row.id,
      kind: row.kind,
      subjectType: row.subjectType,
      subjectId: row.subjectId ?? null,
      canonicalKey: row.canonicalKey,
      summary: row.summary,
      detail: row.detail ?? null,
      confidence: row.confidence ?? 0.5,
      confidenceComponents: row.confidenceComponents ?? {},
      freshness: row.freshness ?? 1,
      revalidationDueAt: row.revalidationDueAt?.toISOString() ?? null,
      supportCount: row.supportCount ?? 0,
      sourceDiversity: row.sourceDiversity ?? 0,
      contradictionWeight: row.contradictionWeight ?? 0,
      operatorConfirmed: row.operatorConfirmed ?? false,
      status: row.status ?? "active",
      firstSupportedAt: row.firstSupportedAt?.toISOString() ?? null,
      lastSupportedAt: row.lastSupportedAt?.toISOString() ?? null,
      lastContradictedAt: row.lastContradictedAt?.toISOString() ?? null,
      supersedesObservationId: row.supersedesObservationId ?? null,
      embedding: null,
      tags: row.tags ?? [],
      metadata: row.metadata ?? {},
      visibility: row.visibility ?? "private",
      createdAt: row.createdAt?.toISOString() ?? "",
      updatedAt: row.updatedAt?.toISOString() ?? "",
    };
  }

  private mapKnowledgeObservationFromRaw(row: any): KnowledgeObservation {
    return {
      id: row.id,
      kind: row.kind,
      subjectType: row.subject_type,
      subjectId: row.subject_id ?? null,
      canonicalKey: row.canonical_key,
      summary: row.summary,
      detail: row.detail ?? null,
      confidence: row.confidence ?? 0.5,
      confidenceComponents:
        typeof row.confidence_components === "string"
          ? JSON.parse(row.confidence_components)
          : (row.confidence_components ?? {}),
      freshness: row.freshness ?? 1,
      revalidationDueAt: row.revalidation_due_at ?? null,
      supportCount: row.support_count ?? 0,
      sourceDiversity: row.source_diversity ?? 0,
      contradictionWeight: row.contradiction_weight ?? 0,
      operatorConfirmed: row.operator_confirmed ?? false,
      status: row.status ?? "active",
      firstSupportedAt: row.first_supported_at ?? null,
      lastSupportedAt: row.last_supported_at ?? null,
      lastContradictedAt: row.last_contradicted_at ?? null,
      supersedesObservationId: row.supersedes_observation_id ?? null,
      embedding: null,
      tags: typeof row.tags === "string" ? JSON.parse(row.tags) : (row.tags ?? []),
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? {}),
      visibility: row.visibility ?? "private",
      createdAt: row.created_at ?? "",
      updatedAt: row.updated_at ?? "",
    };
  }

  private mapKnowledgeObservationEvidence(row: any): KnowledgeObservationEvidence {
    return {
      id: row.id,
      observationId: row.observationId,
      stance: row.stance,
      weight: row.weight ?? 1,
      excerpt: row.excerpt ?? null,
      itemId: row.itemId ?? null,
      lessonId: row.lessonId ?? null,
      reflectionId: row.reflectionId ?? null,
      entityId: row.entityId ?? null,
      sourceCreatedAt: row.sourceCreatedAt?.toISOString() ?? null,
      metadata: row.metadata ?? {},
      createdAt: row.createdAt?.toISOString() ?? "",
    };
  }

  private buildKnowledgeObservationValues(input: CreateKnowledgeObservationInput, now: Date) {
    const embedding = input.embedding
      ? requireVectorDimensions(input.embedding, "observation")
      : null;
    const vecStr = embedding ? `[${embedding.join(",")}]` : null;
    return {
      kind: input.kind,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      canonicalKey: input.canonicalKey,
      summary: input.summary,
      detail: input.detail ?? null,
      confidence: input.confidence ?? 0.5,
      confidenceComponents: input.confidenceComponents ?? {},
      freshness: input.freshness ?? 1,
      revalidationDueAt: input.revalidationDueAt ? new Date(input.revalidationDueAt) : null,
      supportCount: input.supportCount ?? 0,
      sourceDiversity: input.sourceDiversity ?? 0,
      contradictionWeight: input.contradictionWeight ?? 0,
      operatorConfirmed: input.operatorConfirmed ?? false,
      status: input.status ?? "active",
      firstSupportedAt: input.firstSupportedAt ? new Date(input.firstSupportedAt) : null,
      lastSupportedAt: input.lastSupportedAt ? new Date(input.lastSupportedAt) : null,
      lastContradictedAt: input.lastContradictedAt ? new Date(input.lastContradictedAt) : null,
      supersedesObservationId: input.supersedesObservationId ?? null,
      embedding: vecStr ? sql`${vecStr}::vector` : sql`NULL`,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      visibility: input.visibility ?? "private",
      updatedAt: now,
    };
  }

  private async acquireKnowledgeObservationCanonicalLock(
    tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
    agentId: string,
    canonicalKey: string,
  ): Promise<void> {
    const scopeKey = `${agentId}:${canonicalKey}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`);
  }

  private async insertKnowledgeObservationEvidence(
    tx: any,
    observationId: string,
    evidence: CreateKnowledgeObservationEvidenceInput[],
    now: Date,
  ): Promise<void> {
    if (evidence.length === 0) return;
    const values = evidence.map((entry) => {
      const sourceRefs = [entry.itemId, entry.lessonId, entry.reflectionId, entry.entityId].filter(
        Boolean,
      );
      if (sourceRefs.length === 0) {
        throw new Error("Knowledge observation evidence requires a raw source reference");
      }
      return {
        id: genId(),
        observationId,
        stance: entry.stance,
        weight: entry.weight ?? 1,
        excerpt: entry.excerpt ?? null,
        itemId: entry.itemId ?? null,
        lessonId: entry.lessonId ?? null,
        reflectionId: entry.reflectionId ?? null,
        entityId: entry.entityId ?? null,
        sourceCreatedAt: entry.sourceCreatedAt ? new Date(entry.sourceCreatedAt) : null,
        metadata: entry.metadata ?? {},
        createdAt: now,
      };
    });
    await tx.insert(schema.knowledgeObservationEvidence).values(values);
  }

  private mapLesson(row: any): Lesson {
    return {
      id: row.id,
      type: row.type,
      context: row.context,
      action: row.action,
      outcome: row.outcome,
      lesson: row.lesson,
      correction: row.correction ?? undefined,
      confidence: row.confidence ?? 0.5,
      occurrences: row.occurrences ?? 1,
      lastSeen: row.lastSeen?.toISOString() ?? "",
      tags: row.tags ?? [],
      relatedTools: row.relatedTools ?? [],
      sourceEpisodeIds: row.sourceEpisodeIds ?? [],
      createdAt: row.createdAt?.toISOString() ?? "",
      updatedAt: row.updatedAt?.toISOString() ?? "",
    };
  }

  private mapLessonFromRaw(row: any): Lesson {
    return {
      id: row.id,
      type: row.type,
      context: row.context,
      action: row.action,
      outcome: row.outcome,
      lesson: row.lesson,
      correction: row.correction ?? undefined,
      confidence: row.confidence ?? 0.5,
      occurrences: row.occurrences ?? 1,
      lastSeen: row.last_seen ?? "",
      tags: typeof row.tags === "string" ? JSON.parse(row.tags) : (row.tags ?? []),
      relatedTools:
        typeof row.related_tools === "string"
          ? JSON.parse(row.related_tools)
          : (row.related_tools ?? []),
      sourceEpisodeIds:
        typeof row.source_episode_ids === "string"
          ? JSON.parse(row.source_episode_ids)
          : (row.source_episode_ids ?? []),
      createdAt: row.created_at ?? "",
      updatedAt: row.updated_at ?? "",
    };
  }

  private mapPersonalSkillCandidate(row: any): PersonalSkillCandidate {
    return {
      id: row.id,
      agentId: row.agentId ?? row.agent_id,
      operatorId: row.operatorId ?? row.operator_id ?? null,
      profileId: row.profileId ?? row.profile_id ?? null,
      scope: (row.scope ?? "operator") as PersonalSkillScope,
      title: row.title,
      summary: row.summary,
      triggerPatterns: row.triggerPatterns ?? row.trigger_patterns ?? [],
      procedureOutline: row.procedureOutline ?? row.procedure_outline ?? null,
      preconditions:
        typeof row.preconditions === "string"
          ? JSON.parse(row.preconditions)
          : (row.preconditions ?? []),
      executionSteps:
        typeof row.executionSteps === "string"
          ? JSON.parse(row.executionSteps)
          : (row.executionSteps ?? row.execution_steps ?? []),
      expectedOutcomes:
        typeof row.expectedOutcomes === "string"
          ? JSON.parse(row.expectedOutcomes)
          : (row.expectedOutcomes ?? row.expected_outcomes ?? []),
      relatedTools: row.relatedTools ?? row.related_tools ?? [],
      sourceMemoryIds: row.sourceMemoryIds ?? row.source_memory_ids ?? [],
      sourceEpisodeIds: row.sourceEpisodeIds ?? row.source_episode_ids ?? [],
      sourceTaskIds: row.sourceTaskIds ?? row.source_task_ids ?? [],
      sourceLessonIds: row.sourceLessonIds ?? row.source_lesson_ids ?? [],
      supersedesCandidateIds:
        typeof row.supersedesCandidateIds === "string"
          ? JSON.parse(row.supersedesCandidateIds)
          : (row.supersedesCandidateIds ?? row.supersedes_candidate_ids ?? []),
      supersededByCandidateId:
        row.supersededByCandidateId ?? row.superseded_by_candidate_id ?? null,
      conflictsWithCandidateIds:
        typeof row.conflictsWithCandidateIds === "string"
          ? JSON.parse(row.conflictsWithCandidateIds)
          : (row.conflictsWithCandidateIds ?? row.conflicts_with_candidate_ids ?? []),
      contradictionCount: row.contradictionCount ?? row.contradiction_count ?? 0,
      evidenceCount: row.evidenceCount ?? row.evidence_count ?? 0,
      recurrenceCount: row.recurrenceCount ?? row.recurrence_count ?? 1,
      confidence: row.confidence ?? 0.5,
      strength: row.strength ?? 0.5,
      usageCount: row.usageCount ?? row.usage_count ?? 0,
      successCount: row.successCount ?? row.success_count ?? 0,
      failureCount: row.failureCount ?? row.failure_count ?? 0,
      state: (row.state as PersonalSkillCandidateState) ?? "candidate",
      operatorNotes: row.operatorNotes ?? row.operator_notes ?? null,
      lastReviewedAt: row.lastReviewedAt?.toISOString?.() ?? row.last_reviewed_at ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString?.() ?? row.last_used_at ?? null,
      lastReinforcedAt: row.lastReinforcedAt?.toISOString?.() ?? row.last_reinforced_at ?? null,
      lastContradictedAt:
        row.lastContradictedAt?.toISOString?.() ?? row.last_contradicted_at ?? null,
      createdAt: row.createdAt?.toISOString?.() ?? row.created_at ?? "",
      updatedAt: row.updatedAt?.toISOString?.() ?? row.updated_at ?? "",
    };
  }

  private mapPersonalSkillReviewEvent(row: any): PersonalSkillReviewEvent {
    return {
      id: row.id,
      candidateId: row.candidateId ?? row.candidate_id,
      agentId: row.agentId ?? row.agent_id,
      actorType: row.actorType ?? row.actor_type,
      action: row.action,
      reason: row.reason ?? null,
      details: typeof row.details === "string" ? JSON.parse(row.details) : (row.details ?? {}),
      createdAt: row.createdAt?.toISOString?.() ?? row.created_at ?? "",
    };
  }
}

// ── PG Task Adapter ──────────────────────────────────────────────────────

class PgTaskAdapter implements TaskAdapter {
  private db: PostgresJsDatabase<typeof schema>;
  private agentId: string;

  constructor(db: PostgresJsDatabase<typeof schema>, agentId: string) {
    this.db = db;
    this.agentId = agentId;
  }

  async create(input: TaskCreateInput): Promise<Task> {
    const id = genId();
    const now = new Date();
    const hasDeps = Array.isArray(input.dependsOn) && input.dependsOn.length > 0;
    const initialStatus: TaskStatus = hasDeps ? "blocked" : "pending";
    const [row] = await this.db
      .insert(schema.tasks)
      .values({
        id,
        agentId: input.agentId ?? this.agentId,
        title: input.title,
        description: input.description,
        status: initialStatus,
        priority: input.priority ?? "normal",
        source: input.source ?? "user",
        assignee: input.assignee,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        channelId: input.channelId,
        parentTaskId: input.parentTaskId,
        dependsOn: input.dependsOn ?? [],
        teamId: input.teamId,
        tags: input.tags ?? [],
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.mapTask(row);
  }

  async get(id: string): Promise<Task | null> {
    // Support UUID prefix matching (like SQLite adapter)
    const rows = await this.db
      .select()
      .from(schema.tasks)
      .where(like(schema.tasks.id, `${id}%`))
      .limit(2);

    if (rows.length === 1) return this.mapTask(rows[0]);
    if (rows.length === 0) return null;
    // Ambiguous prefix — try exact match
    const exact = rows.find((r) => r.id === id);
    return exact ? this.mapTask(exact) : null;
  }

  async update(id: string, input: TaskUpdateInput): Promise<Task | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.status !== undefined) {
      updates.status = input.status;
      if (input.status === "in_progress" && !existing.startedAt) {
        updates.startedAt = new Date();
      }
      if (input.status === "completed") {
        updates.completedAt = new Date();
      }
    }
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.assignee !== undefined) updates.assignee = input.assignee;
    if (input.dueAt !== undefined) updates.dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (input.dependsOn !== undefined) updates.dependsOn = input.dependsOn;
    if (input.teamId !== undefined) updates.teamId = input.teamId;
    if (input.tags !== undefined) updates.tags = input.tags;
    if (input.metadata !== undefined) updates.metadata = input.metadata;

    const [row] = await this.db
      .update(schema.tasks)
      .set(updates)
      .where(eq(schema.tasks.id, existing.id))
      .returning();
    return this.mapTask(row);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;

    await this.db.delete(schema.tasks).where(eq(schema.tasks.id, existing.id));
    return true;
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    const conditions: any[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(inArray(schema.tasks.status, statuses));
    }
    if (filter?.priority) {
      const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
      conditions.push(inArray(schema.tasks.priority, priorities));
    }
    if (filter?.source) {
      const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
      conditions.push(inArray(schema.tasks.source, sources));
    }
    if (filter?.assignee !== undefined) {
      if (filter.assignee === null) {
        conditions.push(sql`${schema.tasks.assignee} IS NULL`);
      } else {
        conditions.push(eq(schema.tasks.assignee, filter.assignee));
      }
    }
    if (filter?.agentId) conditions.push(eq(schema.tasks.agentId, filter.agentId));
    if (filter?.channelId) conditions.push(eq(schema.tasks.channelId, filter.channelId));
    if (filter?.teamId) conditions.push(eq(schema.tasks.teamId, filter.teamId));
    if (filter?.parentTaskId) conditions.push(eq(schema.tasks.parentTaskId, filter.parentTaskId));
    if (typeof filter?.dueBefore === "number") {
      conditions.push(lte(schema.tasks.dueAt, new Date(filter.dueBefore)));
    }
    if (typeof filter?.dueAfter === "number") {
      conditions.push(gte(schema.tasks.dueAt, new Date(filter.dueAfter)));
    }

    const query = this.db
      .select()
      .from(schema.tasks)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.tasks.createdAt))
      .limit(filter?.limit ?? 100);

    if (filter?.offset) (query as any).offset(filter.offset);

    const rows = await query;
    return rows.map((r) => this.mapTask(r));
  }

  async start(id: string): Promise<Task | null> {
    const task = await this.get(id);
    if (!task) return null;
    if (await this.hasUnresolvedDependencies(task)) {
      return this.update(task.id, {
        status: "blocked" as TaskStatus,
        metadata: {
          ...(task.metadata ?? {}),
          blockedReason: "Waiting on dependencies",
        },
      });
    }
    return this.update(id, { status: "in_progress" as TaskStatus });
  }

  async complete(id: string): Promise<Task | null> {
    const task = await this.update(id, { status: "completed" as TaskStatus });
    if (!task) return null;
    await this.resolveUnblockedDependents(task);
    return task;
  }

  async block(id: string, reason?: string): Promise<Task | null> {
    const updates: TaskUpdateInput = { status: "blocked" as TaskStatus };
    if (reason) updates.metadata = { blockReason: reason };
    return this.update(id, updates);
  }

  async fail(id: string, reason?: string): Promise<Task | null> {
    const updates: TaskUpdateInput = { status: "failed" as TaskStatus };
    if (reason) updates.metadata = { failReason: reason };
    return this.update(id, updates);
  }

  private async hasUnresolvedDependencies(task: Task): Promise<boolean> {
    if (!task.dependsOn || task.dependsOn.length === 0) return false;
    for (const depId of task.dependsOn) {
      const dep = await this.get(depId);
      if (dep?.status !== "completed") return true;
    }
    return false;
  }

  private async resolveUnblockedDependents(completedTask: Task): Promise<void> {
    const blockedCandidates = await this.list({
      status: "blocked",
      teamId: completedTask.teamId,
      limit: 1000,
    });

    for (const candidate of blockedCandidates) {
      if (!candidate.dependsOn || candidate.dependsOn.length === 0) continue;
      if (!candidate.dependsOn.includes(completedTask.id)) continue;
      const unresolved = await this.hasUnresolvedDependencies(candidate);
      if (unresolved) continue;

      const nextMetadata: Record<string, unknown> = { ...(candidate.metadata ?? {}) };
      if ("blockedReason" in nextMetadata) {
        delete nextMetadata.blockedReason;
      }
      await this.update(candidate.id, {
        status: "pending" as TaskStatus,
        metadata: nextMetadata,
      });
    }
  }

  private mapTask(row: any): Task {
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      status: row.status,
      priority: row.priority,
      source: row.source,
      assignee: row.assignee ?? undefined,
      createdAt: row.createdAt?.getTime() ?? Date.now(),
      updatedAt: row.updatedAt?.getTime() ?? Date.now(),
      startedAt: row.startedAt?.getTime() ?? undefined,
      completedAt: row.completedAt?.getTime() ?? undefined,
      dueAt: row.dueAt?.getTime() ?? undefined,
      agentId: row.agentId ?? undefined,
      sessionId: row.sessionId ?? undefined,
      channelId: row.channelId ?? undefined,
      parentTaskId: row.parentTaskId ?? undefined,
      dependsOn: row.dependsOn ?? [],
      teamId: row.teamId ?? undefined,
      tags: row.tags ?? [],
      metadata: row.metadata ?? {},
    };
  }
}

// ── PG Team Adapter ──────────────────────────────────────────────────────

class PgTeamAdapter implements TeamAdapter {
  private db: PostgresJsDatabase<typeof schema>;

  constructor(db: PostgresJsDatabase<typeof schema>) {
    this.db = db;
  }

  async create(input: TeamCreateInput): Promise<Team> {
    const id = genId();
    const now = new Date();
    const [row] = await this.db
      .insert(schema.teams)
      .values({
        id,
        name: input.name,
        leadSessionKey: input.leadSessionKey,
        status: "active",
        config: input.config ?? {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Add leader as first member
    await this.db.insert(schema.teamMembers).values({
      teamId: id,
      sessionKey: input.leadSessionKey,
      role: "lead",
      status: "active",
      joinedAt: now,
    });

    return this.mapTeam(row);
  }

  async get(id: string): Promise<TeamWithMembers | null> {
    const [team] = await this.db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, id))
      .limit(1);
    if (!team) return null;

    const members = await this.db
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, id));

    return {
      team: this.mapTeam(team),
      members: members.map((m) => this.mapMember(m)),
    };
  }

  async list(): Promise<Team[]> {
    const rows = await this.db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.status, "active"))
      .orderBy(desc(schema.teams.createdAt));
    return rows.map((r) => this.mapTeam(r));
  }

  async addMember(teamId: string, member: Omit<TeamMember, "teamId">): Promise<void> {
    await this.db
      .insert(schema.teamMembers)
      .values({
        teamId,
        sessionKey: member.sessionKey,
        role: member.role,
        label: member.label,
        status: member.status ?? "active",
        joinedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  async updateMemberStatus(
    teamId: string,
    sessionKey: string,
    status: TeamMember["status"],
  ): Promise<void> {
    await this.db
      .update(schema.teamMembers)
      .set({
        status,
        lastActiveAt: new Date(),
      })
      .where(
        and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.sessionKey, sessionKey)),
      );
  }

  async disband(id: string): Promise<void> {
    await this.db
      .update(schema.teams)
      .set({ status: "disbanded", updatedAt: new Date() })
      .where(eq(schema.teams.id, id));
  }

  private mapTeam(row: any): Team {
    return {
      id: row.id,
      name: row.name,
      leadSessionKey: row.leadSessionKey,
      status: row.status,
      createdAt: row.createdAt?.getTime() ?? Date.now(),
      updatedAt: row.updatedAt?.getTime() ?? Date.now(),
      config: row.config ?? undefined,
    };
  }

  private mapMember(row: any): TeamMember {
    return {
      teamId: row.teamId,
      sessionKey: row.sessionKey,
      role: row.role,
      label: row.label ?? undefined,
      status: row.status,
      joinedAt: row.joinedAt?.getTime() ?? Date.now(),
      lastActiveAt: row.lastActiveAt?.getTime() ?? undefined,
    };
  }
}

class PgJobAdapter implements JobAdapter {
  private db: PostgresJsDatabase<typeof schema>;

  constructor(db: PostgresJsDatabase<typeof schema>) {
    this.db = db;
  }

  async init(): Promise<void> {
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS job_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        department_id TEXT,
        description TEXT,
        role_prompt TEXT NOT NULL,
        sop TEXT,
        success_definition TEXT,
        default_mode TEXT NOT NULL DEFAULT 'simulate',
        default_stage TEXT,
        tools_allow JSONB NOT NULL DEFAULT '[]'::jsonb,
        tools_deny JSONB NOT NULL DEFAULT '[]'::jsonb,
        relationship_contract JSONB NOT NULL DEFAULT '{}'::jsonb,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_job_templates_name ON job_templates(name);`,
    );
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS job_assignments (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES job_templates(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        cadence_minutes INTEGER NOT NULL DEFAULT 1440,
        execution_mode TEXT NOT NULL DEFAULT 'simulate',
        deployment_stage TEXT,
        promotion_state TEXT,
        scope_limit TEXT,
        review_required BOOLEAN NOT NULL DEFAULT TRUE,
        next_run_at TIMESTAMPTZ,
        last_run_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_job_assignments_agent ON job_assignments(agent_id);`,
    );
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_assignments_next_run ON job_assignments(next_run_at);
    `);
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS job_runs (
        id TEXT PRIMARY KEY,
        assignment_id TEXT NOT NULL REFERENCES job_assignments(id) ON DELETE CASCADE,
        template_id TEXT NOT NULL REFERENCES job_templates(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        execution_mode TEXT NOT NULL,
        deployment_stage TEXT,
        review_status TEXT,
        reviewed_by TEXT,
        reviewed_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'running',
        summary TEXT,
        blockers TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ
      );
    `);
    await this.db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_job_runs_assignment ON job_runs(assignment_id);`,
    );
    await this.db.execute(sql`CREATE INDEX IF NOT EXISTS idx_job_runs_task ON job_runs(task_id);`);
    await this.db.execute(
      sql`ALTER TABLE job_templates ADD COLUMN IF NOT EXISTS department_id TEXT;`,
    );
    await this.db.execute(
      sql`ALTER TABLE job_templates ADD COLUMN IF NOT EXISTS default_stage TEXT;`,
    );
    await this.db.execute(
      sql`ALTER TABLE job_templates ADD COLUMN IF NOT EXISTS relationship_contract JSONB NOT NULL DEFAULT '{}'::jsonb;`,
    );
    await this.db.execute(
      sql`ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS deployment_stage TEXT;`,
    );
    await this.db.execute(
      sql`ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS promotion_state TEXT;`,
    );
    await this.db.execute(
      sql`ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS scope_limit TEXT;`,
    );
    await this.db.execute(
      sql`ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS review_required BOOLEAN NOT NULL DEFAULT TRUE;`,
    );
    await this.db.execute(
      sql`ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS deployment_stage TEXT;`,
    );
    await this.db.execute(sql`ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS review_status TEXT;`);
    await this.db.execute(sql`ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS reviewed_by TEXT;`);
    await this.db.execute(
      sql`ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;`,
    );
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS job_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        source TEXT NOT NULL,
        idempotency_key TEXT,
        target_agent_id TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        outcome TEXT
      );
    `);
    await this.db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_job_events_idempotency_key
      ON job_events(idempotency_key);
    `);
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_events_unprocessed
      ON job_events(processed_at, created_at);
    `);
    await this.db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS job_assignment_id TEXT;`);
    await this.db.execute(sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS job_template_id TEXT;`);
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_tasks_job_assignment_id ON tasks(job_assignment_id);
    `);
  }

  async createTemplate(input: JobTemplateCreateInput): Promise<JobTemplate> {
    const id = genId();
    const now = new Date();
    const defaultMode = input.defaultMode === "live" ? "live" : "simulate";
    const defaultStage = input.defaultStage ?? stageFromMode(defaultMode);
    const [row] = await this.db
      .insert(schema.jobTemplates)
      .values({
        id,
        name: input.name.trim(),
        departmentId: input.departmentId?.trim() || null,
        description: input.description?.trim() || null,
        rolePrompt: input.rolePrompt.trim(),
        sop: input.sop?.trim() || null,
        successDefinition: input.successDefinition?.trim() || null,
        defaultMode,
        defaultStage,
        toolsAllow: input.toolsAllow?.length ? Array.from(new Set(input.toolsAllow)) : [],
        toolsDeny: input.toolsDeny?.length ? Array.from(new Set(input.toolsDeny)) : [],
        relationshipContract: input.relationshipContract ?? {},
        tags: input.tags?.length ? Array.from(new Set(input.tags)) : [],
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.mapTemplate(row);
  }

  async listTemplates(): Promise<JobTemplate[]> {
    const rows = await this.db
      .select()
      .from(schema.jobTemplates)
      .orderBy(desc(schema.jobTemplates.updatedAt));
    return rows.map((row) => this.mapTemplate(row));
  }

  async getTemplate(id: string): Promise<JobTemplate | null> {
    const [row] = await this.db
      .select()
      .from(schema.jobTemplates)
      .where(eq(schema.jobTemplates.id, id))
      .limit(1);
    return row ? this.mapTemplate(row) : null;
  }

  async updateTemplate(
    id: string,
    input: Partial<JobTemplateCreateInput>,
  ): Promise<JobTemplate | null> {
    const existing = await this.getTemplate(id);
    if (!existing) return null;
    const updates: Partial<typeof schema.jobTemplates.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof input.name === "string") {
      updates.name = input.name.trim() || existing.name;
    }
    if (input.departmentId !== undefined) {
      updates.departmentId = input.departmentId?.trim() || null;
    }
    if (input.description !== undefined) {
      updates.description = input.description?.trim() || null;
    }
    if (typeof input.rolePrompt === "string") {
      updates.rolePrompt = input.rolePrompt.trim() || existing.rolePrompt;
    }
    if (input.sop !== undefined) {
      updates.sop = input.sop?.trim() || null;
    }
    if (input.successDefinition !== undefined) {
      updates.successDefinition = input.successDefinition?.trim() || null;
    }
    if (input.defaultMode !== undefined) {
      updates.defaultMode = input.defaultMode === "live" ? "live" : "simulate";
    }
    if (input.defaultStage !== undefined) {
      updates.defaultStage = input.defaultStage;
      if (updates.defaultMode === undefined) {
        updates.defaultMode = modeFromStage(input.defaultStage);
      }
    }
    if (input.toolsAllow !== undefined) {
      updates.toolsAllow = input.toolsAllow?.length ? Array.from(new Set(input.toolsAllow)) : [];
    }
    if (input.toolsDeny !== undefined) {
      updates.toolsDeny = input.toolsDeny?.length ? Array.from(new Set(input.toolsDeny)) : [];
    }
    if (input.relationshipContract !== undefined) {
      updates.relationshipContract = input.relationshipContract ?? {};
    }
    if (input.tags !== undefined) {
      updates.tags = input.tags?.length ? Array.from(new Set(input.tags)) : [];
    }
    if (input.metadata !== undefined) {
      updates.metadata = input.metadata ?? {};
    }

    const [row] = await this.db
      .update(schema.jobTemplates)
      .set(updates)
      .where(eq(schema.jobTemplates.id, id))
      .returning();
    return row ? this.mapTemplate(row) : null;
  }

  async createAssignment(input: JobAssignmentCreateInput): Promise<JobAssignment> {
    const template = await this.getTemplate(input.templateId);
    if (!template) throw new Error(`job template not found: ${input.templateId}`);
    const id = genId();
    const now = new Date();
    const cadenceMinutes =
      Number.isFinite(input.cadenceMinutes) && (input.cadenceMinutes ?? 0) > 0
        ? Math.floor(input.cadenceMinutes ?? 0)
        : 1440;
    const deploymentStage =
      input.deploymentStage ?? template.defaultStage ?? stageFromMode(template.defaultMode);
    const executionMode = input.executionMode ?? modeFromStage(deploymentStage);
    const [row] = await this.db
      .insert(schema.jobAssignments)
      .values({
        id,
        templateId: input.templateId,
        agentId: input.agentId.trim(),
        title: input.title?.trim() || template.name,
        enabled: input.enabled ?? true,
        cadenceMinutes,
        executionMode,
        deploymentStage,
        promotionState: input.promotionState ?? "draft",
        scopeLimit: input.scopeLimit?.trim() || null,
        reviewRequired: input.reviewRequired ?? true,
        nextRunAt: input.nextRunAt ? new Date(input.nextRunAt) : now,
        lastRunAt: null,
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return this.mapAssignment(row);
  }

  async listAssignments(filter?: {
    agentId?: string;
    enabled?: boolean;
  }): Promise<JobAssignment[]> {
    const conditions = [];
    if (filter?.agentId) conditions.push(eq(schema.jobAssignments.agentId, filter.agentId));
    if (typeof filter?.enabled === "boolean") {
      conditions.push(eq(schema.jobAssignments.enabled, filter.enabled));
    }
    const rows = await this.db
      .select()
      .from(schema.jobAssignments)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.jobAssignments.updatedAt));
    return rows.map((row) => this.mapAssignment(row));
  }

  async getAssignment(id: string): Promise<JobAssignment | null> {
    const [row] = await this.db
      .select()
      .from(schema.jobAssignments)
      .where(eq(schema.jobAssignments.id, id))
      .limit(1);
    return row ? this.mapAssignment(row) : null;
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
    const existing = await this.getAssignment(id);
    if (!existing) return null;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof input.enabled === "boolean") updates.enabled = input.enabled;
    if (typeof input.cadenceMinutes === "number" && Number.isFinite(input.cadenceMinutes)) {
      updates.cadenceMinutes = Math.max(1, Math.floor(input.cadenceMinutes));
    }
    if (input.executionMode) updates.executionMode = input.executionMode;
    if (input.deploymentStage) {
      updates.deploymentStage = input.deploymentStage;
      if (!input.executionMode) {
        updates.executionMode = modeFromStage(input.deploymentStage);
      }
    }
    if (input.promotionState) updates.promotionState = input.promotionState;
    if (input.scopeLimit !== undefined) updates.scopeLimit = input.scopeLimit;
    if (typeof input.reviewRequired === "boolean") updates.reviewRequired = input.reviewRequired;
    if (input.nextRunAt !== undefined) {
      updates.nextRunAt = input.nextRunAt === null ? null : new Date(input.nextRunAt);
    }
    if (typeof input.title === "string") updates.title = input.title.trim() || existing.title;
    if (input.metadata !== undefined) updates.metadata = input.metadata;
    const [row] = await this.db
      .update(schema.jobAssignments)
      .set(updates)
      .where(eq(schema.jobAssignments.id, id))
      .returning();
    return row ? this.mapAssignment(row) : null;
  }

  async getContextForTask(taskId: string): Promise<JobTaskContext | null> {
    const [task] = await this.db
      .select({
        jobAssignmentId: schema.tasks.jobAssignmentId,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .limit(1);
    if (!task?.jobAssignmentId) return null;
    const assignment = await this.getAssignment(task.jobAssignmentId);
    if (!assignment) return null;
    const template = await this.getTemplate(assignment.templateId);
    if (!template) return null;
    return { assignment, template };
  }

  async ensureDueTasks(params?: { agentId?: string; now?: number }): Promise<number> {
    const now = params?.now ?? Date.now();
    const assignments = (
      await this.listAssignments({
        agentId: params?.agentId,
        enabled: true,
      })
    ).filter((item) => (item.nextRunAt ?? now) <= now);
    let createdCount = 0;

    for (const assignment of assignments) {
      const template = await this.getTemplate(assignment.templateId);
      if (!template) continue;
      const [open] = await this.db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.jobAssignmentId, assignment.id),
            inArray(schema.tasks.status, ["pending", "in_progress", "blocked"]),
          ),
        )
        .limit(1);
      if (open?.id) {
        await this.bumpAssignmentSchedule(assignment.id, assignment.cadenceMinutes, now, false);
        continue;
      }

      const taskId = genId();
      const descriptionBlocks = [
        template.description?.trim() ?? "",
        `Role: ${template.rolePrompt}`,
        template.sop ? `SOP:\n${template.sop}` : "",
        template.successDefinition ? `Definition of done: ${template.successDefinition}` : "",
        `Deployment stage: ${(assignment.deploymentStage ?? stageFromMode(assignment.executionMode)).toUpperCase()}`,
        `Execution mode: ${assignment.executionMode.toUpperCase()}`,
        template.relationshipContract?.relationshipObjective
          ? `Relationship objective: ${template.relationshipContract.relationshipObjective}`
          : "",
      ].filter(Boolean);
      const metadata = {
        type: "job",
        jobTemplateId: template.id,
        jobAssignmentId: assignment.id,
        jobExecutionMode: assignment.executionMode,
        jobDeploymentStage: assignment.deploymentStage ?? stageFromMode(assignment.executionMode),
      };
      await this.db.insert(schema.tasks).values({
        id: taskId,
        title: assignment.title,
        description: descriptionBlocks.join("\n\n"),
        status: "pending",
        priority: "normal",
        source: "job",
        assignee: assignment.agentId,
        agentId: assignment.agentId,
        dueAt: new Date(now + assignment.cadenceMinutes * 60_000),
        dependsOn: [],
        tags: template.tags ?? [],
        metadata,
        createdAt: new Date(now),
        updatedAt: new Date(now),
        jobAssignmentId: assignment.id,
        jobTemplateId: template.id,
      });
      await this.createRun({
        assignmentId: assignment.id,
        templateId: template.id,
        agentId: assignment.agentId,
        taskId,
        executionMode: assignment.executionMode,
        deploymentStage: assignment.deploymentStage ?? stageFromMode(assignment.executionMode),
      });
      await this.bumpAssignmentSchedule(assignment.id, assignment.cadenceMinutes, now, true);
      createdCount += 1;
    }
    return createdCount;
  }

  async createRun(input: JobRunCreateInput): Promise<JobRun> {
    const id = genId();
    const now = new Date();
    const [row] = await this.db
      .insert(schema.jobRuns)
      .values({
        id,
        assignmentId: input.assignmentId,
        templateId: input.templateId,
        agentId: input.agentId,
        taskId: input.taskId,
        executionMode: input.executionMode,
        deploymentStage: input.deploymentStage ?? stageFromMode(input.executionMode),
        reviewStatus:
          input.reviewStatus ?? (input.executionMode === "live" ? "approved" : "pending"),
        reviewedBy: input.reviewedBy ?? null,
        reviewedAt: input.reviewedAt ? new Date(input.reviewedAt) : null,
        status: input.status ?? "running",
        summary: input.summary ?? null,
        blockers: input.blockers ?? null,
        metadata: input.metadata ?? {},
        createdAt: now,
        startedAt: now,
        endedAt: null,
      })
      .returning();
    return this.mapRun(row);
  }

  async reviewRun(id: string, input: JobRunReviewInput): Promise<JobRun | null> {
    const [row] = await this.db
      .select()
      .from(schema.jobRuns)
      .where(eq(schema.jobRuns.id, id))
      .limit(1);
    if (!row) return null;
    const now = new Date();
    const existingMetadata = ((row.metadata as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >;
    const existingReviewHistoryRaw = existingMetadata.reviewHistory;
    const existingReviewHistory = Array.isArray(existingReviewHistoryRaw)
      ? existingReviewHistoryRaw.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
      : [];
    const reviewEntry = {
      status: input.reviewStatus,
      reviewedBy: input.reviewedBy ?? null,
      reviewedAt: now.toISOString(),
      notes: input.notes ?? null,
      action: input.action ?? null,
      targetStage: input.targetStage ?? null,
    };
    const metadata = {
      ...((row.metadata as Record<string, unknown> | null) ?? {}),
      review: reviewEntry,
      reviewHistory: [...existingReviewHistory, reviewEntry].slice(-25),
    };
    const [updatedRun] = await this.db
      .update(schema.jobRuns)
      .set({
        reviewStatus: input.reviewStatus,
        reviewedBy: input.reviewedBy ?? null,
        reviewedAt: now,
        metadata,
      })
      .where(eq(schema.jobRuns.id, id))
      .returning();
    const assignment = await this.getAssignment(row.assignmentId);
    if (assignment && input.action) {
      if (input.action === "promote") {
        const targetStage =
          input.targetStage ??
          nextPromotionStage(assignment.deploymentStage ?? stageFromMode(assignment.executionMode));
        await this.updateAssignment(assignment.id, {
          deploymentStage: targetStage,
          promotionState: "approved-next-stage",
          reviewRequired: targetStage !== "live",
          enabled: true,
        });
      } else if (input.action === "hold") {
        await this.updateAssignment(assignment.id, {
          promotionState: "held",
          reviewRequired: true,
        });
      } else if (input.action === "rollback") {
        await this.updateAssignment(assignment.id, {
          deploymentStage: "simulate",
          promotionState: "rolled-back",
          reviewRequired: true,
          enabled: false,
        });
      }
    }
    return updatedRun ? this.mapRun(updatedRun) : null;
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
    const [row] = await this.db
      .select()
      .from(schema.jobRuns)
      .where(and(eq(schema.jobRuns.taskId, taskId), eq(schema.jobRuns.status, "running")))
      .orderBy(desc(schema.jobRuns.startedAt))
      .limit(1);
    if (!row) return null;
    const [updated] = await this.db
      .update(schema.jobRuns)
      .set({
        status: input.status,
        summary: input.summary ?? row.summary,
        blockers: input.blockers ?? row.blockers,
        metadata: input.metadata ?? row.metadata ?? {},
        endedAt: new Date(),
      })
      .where(eq(schema.jobRuns.id, row.id))
      .returning();
    return updated ? this.mapRun(updated) : null;
  }

  async listRuns(filter?: {
    assignmentId?: string;
    taskId?: string;
    limit?: number;
  }): Promise<JobRun[]> {
    const conditions = [];
    if (filter?.assignmentId) conditions.push(eq(schema.jobRuns.assignmentId, filter.assignmentId));
    if (filter?.taskId) conditions.push(eq(schema.jobRuns.taskId, filter.taskId));
    const rows = await this.db
      .select()
      .from(schema.jobRuns)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.jobRuns.startedAt))
      .limit(
        Number.isFinite(filter?.limit) && (filter?.limit ?? 0) > 0
          ? Math.floor(filter?.limit ?? 0)
          : 50,
      );
    return rows.map((row) => this.mapRun(row));
  }

  async resolveSessionToolPolicyForAssignment(params: {
    assignment: JobAssignment;
    template: JobTemplate;
  }): Promise<{ toolsAllow?: string[]; toolsDeny?: string[] }> {
    const toolsAllow = params.template.toolsAllow?.length ? params.template.toolsAllow : undefined;
    const deny = new Set<string>(params.template.toolsDeny ?? []);
    const stage =
      params.assignment.deploymentStage ?? stageFromMode(params.assignment.executionMode);
    if (params.assignment.executionMode === "simulate" || stage === "shadow") {
      for (const tool of DEFAULT_SIMULATION_DENY_TOOLS) deny.add(tool);
    }
    if (stage === "limited-live" && !allowsLimitedLiveOutbound(params.assignment.scopeLimit)) {
      for (const tool of DEFAULT_LIMITED_LIVE_DENY_TOOLS) deny.add(tool);
    }
    return {
      toolsAllow,
      toolsDeny: deny.size > 0 ? Array.from(deny) : undefined,
    };
  }

  async enqueueEvent(
    input: JobEventEnqueueInput,
  ): Promise<{ accepted: boolean; event?: JobEvent }> {
    const eventType = input.eventType.trim();
    if (!eventType) throw new Error("eventType is required");
    const id = genId();
    try {
      const [row] = await this.db
        .insert(schema.jobEvents)
        .values({
          id,
          eventType,
          source: normalizeJobEventSource(input.source),
          idempotencyKey: input.idempotencyKey?.trim() || null,
          targetAgentId: input.targetAgentId?.trim() || null,
          payload: input.payload ?? {},
          metadata: input.metadata ?? {},
          createdAt: new Date(),
          processedAt: null,
          outcome: null,
        })
        .returning();
      return { accepted: true, event: this.mapEvent(row) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("idx_job_events_idempotency_key")) {
        return { accepted: false };
      }
      throw err;
    }
  }

  async listEvents(filter?: {
    eventType?: string;
    processed?: boolean;
    limit?: number;
  }): Promise<JobEvent[]> {
    const conditions = [];
    if (filter?.eventType) conditions.push(eq(schema.jobEvents.eventType, filter.eventType));
    if (typeof filter?.processed === "boolean") {
      conditions.push(
        filter.processed
          ? sql`${schema.jobEvents.processedAt} IS NOT NULL`
          : sql`${schema.jobEvents.processedAt} IS NULL`,
      );
    }
    const rows = await this.db
      .select()
      .from(schema.jobEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.jobEvents.createdAt))
      .limit(
        Number.isFinite(filter?.limit) && (filter?.limit ?? 0) > 0
          ? Math.floor(filter?.limit ?? 0)
          : 100,
      );
    return rows.map((row) => this.mapEvent(row));
  }

  async ensureEventTasks(params?: {
    now?: number;
    agentId?: string;
    limit?: number;
  }): Promise<{ processedEvents: number; createdTasks: number }> {
    const now = params?.now ?? Date.now();
    const rows = await this.db
      .select()
      .from(schema.jobEvents)
      .where(sql`${schema.jobEvents.processedAt} IS NULL`)
      .orderBy(asc(schema.jobEvents.createdAt))
      .limit(
        Number.isFinite(params?.limit) && (params?.limit ?? 0) > 0
          ? Math.floor(params?.limit ?? 0)
          : 50,
      );
    let processedEvents = 0;
    let createdTasks = 0;
    for (const row of rows) {
      const event = this.mapEvent(row);
      const assignments = (
        await this.listAssignments({
          agentId: params?.agentId,
          enabled: true,
        })
      ).filter((assignment) => {
        if (event.targetAgentId && assignment.agentId !== event.targetAgentId) return false;
        const triggers = Array.isArray(assignment.metadata?.eventTriggers)
          ? assignment.metadata.eventTriggers.filter(
              (item): item is string => typeof item === "string",
            )
          : [];
        return triggers.includes(event.eventType);
      });

      let matchedAssignments = 0;
      let skippedOpenTask = 0;
      let createdForEvent = 0;
      for (const assignment of assignments) {
        matchedAssignments += 1;
        const template = await this.getTemplate(assignment.templateId);
        if (!template) continue;
        const [open] = await this.db
          .select({ id: schema.tasks.id })
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.jobAssignmentId, assignment.id),
              inArray(schema.tasks.status, ["pending", "in_progress", "blocked"]),
            ),
          )
          .limit(1);
        if (open?.id) {
          skippedOpenTask += 1;
          continue;
        }
        const taskId = genId();
        const payloadPreview = event.payload ? JSON.stringify(event.payload, null, 2) : "{}";
        const descriptionBlocks = [
          template.description?.trim() ?? "",
          `Role: ${template.rolePrompt}`,
          template.sop ? `SOP:\n${template.sop}` : "",
          template.successDefinition ? `Definition of done: ${template.successDefinition}` : "",
          `Deployment stage: ${(assignment.deploymentStage ?? stageFromMode(assignment.executionMode)).toUpperCase()}`,
          `Execution mode: ${assignment.executionMode.toUpperCase()}`,
          template.relationshipContract?.relationshipObjective
            ? `Relationship objective: ${template.relationshipContract.relationshipObjective}`
            : "",
          `Trigger event: ${event.eventType} (${event.source})`,
          `Event payload:\n${payloadPreview}`,
        ].filter(Boolean);
        await this.db.insert(schema.tasks).values({
          id: taskId,
          title: `${assignment.title} [${event.eventType}]`,
          description: descriptionBlocks.join("\n\n"),
          status: "pending",
          priority: "normal",
          source: "job",
          assignee: assignment.agentId,
          agentId: assignment.agentId,
          dueAt: new Date(now),
          dependsOn: [],
          tags: template.tags ?? [],
          metadata: {
            type: "job",
            triggerType: "event",
            triggerEventType: event.eventType,
            jobTemplateId: template.id,
            jobAssignmentId: assignment.id,
            jobExecutionMode: assignment.executionMode,
            jobDeploymentStage:
              assignment.deploymentStage ?? stageFromMode(assignment.executionMode),
            jobEventId: event.id,
          },
          createdAt: new Date(now),
          updatedAt: new Date(now),
          jobAssignmentId: assignment.id,
          jobTemplateId: template.id,
        });
        await this.createRun({
          assignmentId: assignment.id,
          templateId: template.id,
          agentId: assignment.agentId,
          taskId,
          executionMode: assignment.executionMode,
          deploymentStage: assignment.deploymentStage ?? stageFromMode(assignment.executionMode),
          metadata: {
            triggerType: "event",
            triggerEventType: event.eventType,
            eventId: event.id,
          },
        });
        await this.bumpAssignmentSchedule(assignment.id, assignment.cadenceMinutes, now, true);
        createdTasks += 1;
        createdForEvent += 1;
      }
      await this.db
        .update(schema.jobEvents)
        .set({
          processedAt: new Date(now),
          outcome: JSON.stringify({
            matchedAssignments,
            skippedOpenTask,
            createdTasks: createdForEvent,
          }),
        })
        .where(eq(schema.jobEvents.id, event.id));
      processedEvents += 1;
    }
    return { processedEvents, createdTasks };
  }

  private async bumpAssignmentSchedule(
    assignmentId: string,
    cadenceMinutes: number,
    now: number,
    markLastRun: boolean,
  ): Promise<void> {
    await this.db
      .update(schema.jobAssignments)
      .set({
        updatedAt: new Date(now),
        nextRunAt: new Date(now + cadenceMinutes * 60_000),
        lastRunAt: markLastRun ? new Date(now) : null,
      })
      .where(eq(schema.jobAssignments.id, assignmentId));
  }

  private mapTemplate(row: typeof schema.jobTemplates.$inferSelect): JobTemplate {
    return {
      id: row.id,
      name: row.name,
      departmentId: row.departmentId ?? undefined,
      description: row.description ?? undefined,
      rolePrompt: row.rolePrompt,
      sop: row.sop ?? undefined,
      successDefinition: row.successDefinition ?? undefined,
      defaultMode: normalizeJobMode(row.defaultMode),
      defaultStage: normalizeJobStage(row.defaultStage ?? row.defaultMode),
      toolsAllow: Array.isArray(row.toolsAllow) ? (row.toolsAllow as string[]) : undefined,
      toolsDeny: Array.isArray(row.toolsDeny) ? (row.toolsDeny as string[]) : undefined,
      relationshipContract: ((row.relationshipContract as Record<string, unknown> | null) ??
        undefined) as JobRelationshipContract | undefined,
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      createdAt: row.createdAt?.getTime() ?? Date.now(),
      updatedAt: row.updatedAt?.getTime() ?? Date.now(),
    };
  }

  private mapAssignment(row: typeof schema.jobAssignments.$inferSelect): JobAssignment {
    return {
      id: row.id,
      templateId: row.templateId,
      agentId: row.agentId,
      title: row.title,
      enabled: row.enabled,
      cadenceMinutes: row.cadenceMinutes,
      executionMode: normalizeJobMode(row.executionMode),
      deploymentStage: normalizeJobStage(row.deploymentStage ?? row.executionMode),
      promotionState: normalizePromotionState(row.promotionState),
      scopeLimit: row.scopeLimit ?? undefined,
      reviewRequired: row.reviewRequired,
      nextRunAt: row.nextRunAt?.getTime() ?? undefined,
      lastRunAt: row.lastRunAt?.getTime() ?? undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      createdAt: row.createdAt?.getTime() ?? Date.now(),
      updatedAt: row.updatedAt?.getTime() ?? Date.now(),
    };
  }

  private mapRun(row: typeof schema.jobRuns.$inferSelect): JobRun {
    return {
      id: row.id,
      assignmentId: row.assignmentId,
      templateId: row.templateId,
      agentId: row.agentId,
      taskId: row.taskId,
      executionMode: normalizeJobMode(row.executionMode),
      deploymentStage: normalizeJobStage(row.deploymentStage ?? row.executionMode),
      reviewStatus: normalizeRunReviewStatus(row.reviewStatus),
      reviewedBy: row.reviewedBy ?? undefined,
      reviewedAt: row.reviewedAt?.getTime() ?? undefined,
      status: normalizeJobRunStatus(row.status),
      summary: row.summary ?? undefined,
      blockers: row.blockers ?? undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      createdAt: row.createdAt?.getTime() ?? Date.now(),
      startedAt: row.startedAt?.getTime() ?? Date.now(),
      endedAt: row.endedAt?.getTime() ?? undefined,
    };
  }

  private mapEvent(row: typeof schema.jobEvents.$inferSelect): JobEvent {
    return {
      id: row.id,
      eventType: row.eventType,
      source: normalizeJobEventSource(row.source),
      idempotencyKey: row.idempotencyKey ?? undefined,
      targetAgentId: row.targetAgentId ?? undefined,
      payload: (row.payload as Record<string, unknown>) ?? undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      createdAt: row.createdAt?.getTime() ?? Date.now(),
      processedAt: row.processedAt?.getTime() ?? undefined,
      outcome: row.outcome ?? undefined,
    };
  }
}

// ── Top-Level PG Adapter ─────────────────────────────────────────────────

export class PgAdapter implements StorageAdapter {
  public memory: MemoryAdapter;
  public tasks: TaskAdapter;
  public teams: TeamAdapter;
  public jobs: JobAdapter;
  private _ready = false;
  private sqlClient: ReturnType<typeof postgres>;
  private db: PostgresJsDatabase<typeof schema>;
  private jobAdapter: PgJobAdapter;

  constructor(pgConfig: PostgresConfig, agentId: string = "argent") {
    this.agentId = agentId;
    this.sqlClient = getPgClient(pgConfig);
    this.db = drizzle(this.sqlClient, { schema });
    this.memory = new PgMemoryAdapter(this.db, agentId, this.sqlClient);
    this.tasks = new PgTaskAdapter(this.db, agentId);
    this.teams = new PgTeamAdapter(this.db);
    this.jobAdapter = new PgJobAdapter(this.db);
    this.jobs = this.jobAdapter;
  }

  async init(): Promise<void> {
    // Set RLS agent context for this connection
    await setAgentContext(this.sqlClient, this.agentId);
    await this.jobAdapter.init();
    this._ready = true;
    log.info("pg adapter: initialized", { agentId: this.agentId });
  }

  async close(): Promise<void> {
    this._ready = false;
    await closePgClient();
    log.info("pg adapter: closed");
  }

  isReady(): boolean {
    return this._ready;
  }
}
