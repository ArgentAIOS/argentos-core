/**
 * MemU Store — CRUD + search operations for the three-layer memory hierarchy.
 *
 * All operations use node:sqlite DatabaseSync for synchronous I/O.
 * Embeddings stored as binary BLOBs (Float32Array).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  CategoryItem,
  CategorySearchResult,
  CreateCategoryInput,
  CreateEntityInput,
  CreateLessonInput,
  CreateLiveCandidateInput,
  CreateMemoryItemInput,
  CreatePersonalSkillCandidateInput,
  CreatePersonalSkillReviewEventInput,
  CreateReflectionInput,
  CreateResourceInput,
  Entity,
  EntityType,
  Lesson,
  LessonType,
  LiveCandidate,
  LiveCandidateStats,
  MemoryCategory,
  ModelFeedbackRecord,
  ModelPerformanceStats,
  MemoryItem,
  MemorySearchResult,
  MemoryType,
  PersonalSkillCandidate,
  PersonalSkillReviewEvent,
  PersonalSkillCandidateState,
  PromotionAction,
  PromotionActor,
  PromotionEvent,
  Reflection,
  RecordModelFeedbackInput,
  Resource,
  SalienceParams,
  Significance,
  CandidateStatus,
} from "./memu-types.js";
import type { DatabaseSync } from "./sqlite.js";
import { resolveUserPath } from "../utils.js";
import { ensureMemuSchema } from "./memu-schema.js";
import {
  loadSqliteVec,
  ensureVecTables,
  syncVecTable,
  upsertVec,
  deleteVec,
  vecKnnSearch,
  vecToUint8Array,
  getRowidForId,
} from "./memu-vec.js";
import { openDatabase, closeDatabase } from "./sqlite.js";

// ── Helpers ──

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

/** SHA-256 hash for dedup */
export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
}

/** Convert number[] to BLOB for SQLite storage */
function vecToBlob(vec: number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer);
}

/** Convert BLOB back to number[] */
function blobToVec(blob: Buffer | null): number[] | null {
  if (!blob || blob.length === 0) return null;
  return Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
}

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom < 1e-10 ? 0 : dot / denom;
}

/** Recency decay: exponential half-life */
export function recencyDecay(createdAt: Date, halfLifeDays: number): number {
  const daysSince = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp((-Math.LN2 * daysSince) / halfLifeDays);
}

/** Salience score: similarity × reinforcement × recency */
export function salienceScore(params: SalienceParams): number {
  const decay = recencyDecay(params.createdAt, params.halfLifeDays);
  const reinforcement = Math.log2(params.reinforcementCount + 1);
  return params.cosineSimilarity * reinforcement * decay;
}

// ── Identity Scoring ──

const SIGNIFICANCE_HALF_LIFE: Record<Significance, number> = {
  routine: 30,
  noteworthy: 90,
  important: 365,
  core: Infinity,
};

const SIGNIFICANCE_MULTIPLIER: Record<Significance, number> = {
  routine: 1.0,
  noteworthy: 1.5,
  important: 2.5,
  core: 5.0,
};

export interface IdentityScoringParams {
  cosineSimilarity: number;
  reinforcementCount: number;
  createdAt: Date;
  emotionalValence: number;
  emotionalArousal: number;
  significance: Significance;
  bondStrengths: number[];
}

/**
 * Identity-weighted scoring:
 * similarity² × reinforcement × recency × emotionalWeight × significanceMultiplier × bondBoost
 *
 * Similarity is squared so that low-relevance items can't win on metadata alone.
 * Core memories never decay. High-emotion memories score higher.
 * Memories linked to high-bond entities get a boost.
 */
export function identityScore(params: IdentityScoringParams): number {
  const halfLife = SIGNIFICANCE_HALF_LIFE[params.significance];
  const recency = halfLife === Infinity ? 1.0 : recencyDecay(params.createdAt, halfLife);

  const reinforcement = Math.log2(params.reinforcementCount + 1);

  // Emotional weight: abs(valence) × arousal, scaled so neutral emotion = 1.0
  const emotionalWeight = 1 + Math.abs(params.emotionalValence) * params.emotionalArousal * 0.5;

  const significanceMultiplier = SIGNIFICANCE_MULTIPLIER[params.significance];

  // Bond boost: highest bond strength among linked entities
  const maxBond = params.bondStrengths.length > 0 ? Math.max(...params.bondStrengths) : 0;
  const bondBoost = 1 + maxBond * 0.3;

  // Square similarity so low-relevance items can't dominate on metadata alone.
  // sim=0.5 → 0.25, sim=0.1 → 0.01 — a 5× similarity gap becomes 25×.
  const simWeight = params.cosineSimilarity * params.cosineSimilarity;

  return simWeight * reinforcement * recency * emotionalWeight * significanceMultiplier * bondBoost;
}

// ── Row mappers ──

function mapResource(row: Record<string, unknown>): Resource {
  return {
    id: row.id as string,
    url: row.url as string,
    modality: row.modality as Resource["modality"],
    localPath: (row.local_path as string) ?? null,
    caption: (row.caption as string) ?? null,
    embedding: blobToVec(row.embedding as Buffer | null),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapItem(row: Record<string, unknown>): MemoryItem {
  return {
    id: row.id as string,
    resourceId: (row.resource_id as string) ?? null,
    memoryType: row.memory_type as MemoryType,
    summary: row.summary as string,
    embedding: blobToVec(row.embedding as Buffer | null),
    happenedAt: (row.happened_at as string) ?? null,
    contentHash: (row.content_hash as string) ?? null,
    reinforcementCount: (row.reinforcement_count as number) ?? 1,
    lastReinforcedAt: (row.last_reinforced_at as string) ?? null,
    extra: JSON.parse((row.extra as string) || "{}"),
    emotionalValence: (row.emotional_valence as number) ?? 0,
    emotionalArousal: (row.emotional_arousal as number) ?? 0,
    moodAtCapture: (row.mood_at_capture as string) ?? null,
    significance: ((row.significance as string) ?? "routine") as Significance,
    reflection: (row.reflection as string) ?? null,
    lesson: (row.lesson as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapEntity(row: Record<string, unknown>): Entity {
  return {
    id: row.id as string,
    name: row.name as string,
    entityType: (row.entity_type as string as EntityType) ?? "person",
    relationship: (row.relationship as string) ?? null,
    bondStrength: (row.bond_strength as number) ?? 0.5,
    emotionalTexture: (row.emotional_texture as string) ?? null,
    profileSummary: (row.profile_summary as string) ?? null,
    firstMentionedAt: (row.first_mentioned_at as string) ?? null,
    lastMentionedAt: (row.last_mentioned_at as string) ?? null,
    memoryCount: (row.memory_count as number) ?? 0,
    embedding: blobToVec(row.embedding as Buffer | null),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapReflection(row: Record<string, unknown>): Reflection {
  return {
    id: row.id as string,
    triggerType: row.trigger_type as string,
    periodStart: (row.period_start as string) ?? null,
    periodEnd: (row.period_end as string) ?? null,
    content: row.content as string,
    lessonsExtracted: JSON.parse((row.lessons_extracted as string) || "[]"),
    entitiesInvolved: JSON.parse((row.entities_involved as string) || "[]"),
    selfInsights: JSON.parse((row.self_insights as string) || "[]"),
    mood: (row.mood as string) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapLesson(row: Record<string, unknown>): Lesson {
  return {
    id: row.id as string,
    type: row.type as LessonType,
    context: row.context as string,
    action: row.action as string,
    outcome: row.outcome as string,
    lesson: row.lesson as string,
    correction: (row.correction as string) ?? null,
    confidence: (row.confidence as number) ?? 0.5,
    occurrences: (row.occurrences as number) ?? 1,
    lastSeen: row.last_seen as string,
    tags: JSON.parse((row.tags as string) || "[]"),
    relatedTools: JSON.parse((row.related_tools as string) || "[]"),
    sourceEpisodeIds: JSON.parse((row.source_episode_ids as string) || "[]"),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapCategory(row: Record<string, unknown>): MemoryCategory {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    embedding: blobToVec(row.embedding as Buffer | null),
    summary: (row.summary as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapLiveCandidate(row: Record<string, unknown>): LiveCandidate {
  return {
    id: row.id as string,
    sessionKey: (row.session_key as string) ?? null,
    messageId: (row.message_id as string) ?? null,
    role: row.role as "user" | "assistant",
    candidateType: row.candidate_type as LiveCandidate["candidateType"],
    factText: row.fact_text as string,
    factHash: row.fact_hash as string,
    confidence: (row.confidence as number) ?? 0,
    triggerFlags: JSON.parse((row.trigger_flags as string) || "[]"),
    entities: JSON.parse((row.entities as string) || "[]"),
    memoryTypeHint: (row.memory_type_hint as string as LiveCandidate["memoryTypeHint"]) ?? null,
    significanceHint:
      (row.significance_hint as string as LiveCandidate["significanceHint"]) ?? null,
    sourceTs: row.source_ts as string,
    expiresAt: row.expires_at as string,
    status: row.status as LiveCandidate["status"],
    promotedItemId: (row.promoted_item_id as string) ?? null,
    promotionReason: (row.promotion_reason as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapPersonalSkillCandidate(row: Record<string, unknown>): PersonalSkillCandidate {
  return {
    id: row.id as string,
    agentId: (row.agent_id as string) ?? "main",
    operatorId: (row.operator_id as string) ?? null,
    profileId: (row.profile_id as string) ?? null,
    scope: ((row.scope as string) ?? "operator") as PersonalSkillCandidate["scope"],
    title: row.title as string,
    summary: row.summary as string,
    triggerPatterns: JSON.parse((row.trigger_patterns as string) || "[]"),
    procedureOutline: (row.procedure_outline as string) ?? null,
    preconditions: JSON.parse((row.preconditions as string) || "[]"),
    executionSteps: JSON.parse((row.execution_steps as string) || "[]"),
    expectedOutcomes: JSON.parse((row.expected_outcomes as string) || "[]"),
    relatedTools: JSON.parse((row.related_tools as string) || "[]"),
    sourceMemoryIds: JSON.parse((row.source_memory_ids as string) || "[]"),
    sourceEpisodeIds: JSON.parse((row.source_episode_ids as string) || "[]"),
    sourceTaskIds: JSON.parse((row.source_task_ids as string) || "[]"),
    sourceLessonIds: JSON.parse((row.source_lesson_ids as string) || "[]"),
    supersedesCandidateIds: JSON.parse((row.supersedes_candidate_ids as string) || "[]"),
    supersededByCandidateId: (row.superseded_by_candidate_id as string) ?? null,
    conflictsWithCandidateIds: JSON.parse((row.conflicts_with_candidate_ids as string) || "[]"),
    contradictionCount: (row.contradiction_count as number) ?? 0,
    evidenceCount: (row.evidence_count as number) ?? 0,
    recurrenceCount: (row.recurrence_count as number) ?? 1,
    confidence: (row.confidence as number) ?? 0.5,
    strength: (row.strength as number) ?? 0.5,
    usageCount: (row.usage_count as number) ?? 0,
    successCount: (row.success_count as number) ?? 0,
    failureCount: (row.failure_count as number) ?? 0,
    state: (row.state as PersonalSkillCandidateState) ?? "candidate",
    operatorNotes: (row.operator_notes as string) ?? null,
    lastReviewedAt: (row.last_reviewed_at as string) ?? null,
    lastUsedAt: (row.last_used_at as string) ?? null,
    lastReinforcedAt: (row.last_reinforced_at as string) ?? null,
    lastContradictedAt: (row.last_contradicted_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapPersonalSkillReviewEvent(row: Record<string, unknown>): PersonalSkillReviewEvent {
  return {
    id: row.id as string,
    candidateId: row.candidate_id as string,
    agentId: (row.agent_id as string) ?? "main",
    actorType: ((row.actor_type as string) ?? "system") as PersonalSkillReviewEvent["actorType"],
    action: row.action as PersonalSkillReviewEvent["action"],
    reason: (row.reason as string) ?? null,
    details: JSON.parse((row.details as string) || "{}"),
    createdAt: row.created_at as string,
  };
}

// ── MemuStore ──

export class MemuStore {
  readonly db: DatabaseSync;
  readonly ftsAvailable: boolean;
  readonly vecAvailable: boolean;

  constructor(db: DatabaseSync) {
    const result = ensureMemuSchema(db);
    this.db = db;
    this.ftsAvailable = result.ftsAvailable;

    // Try to load sqlite-vec for native vector search
    this.vecAvailable = loadSqliteVec(db);
    if (this.vecAvailable) {
      try {
        ensureVecTables(db);
        // Sync existing embeddings into vec0 tables (fast — skips already-synced)
        syncVecTable(db, "memory_items", "vec_memory_items");
        syncVecTable(db, "entities", "vec_entities");
        syncVecTable(db, "memory_categories", "vec_categories");
      } catch (err) {
        console.warn("[MemU] sqlite-vec tables setup failed:", String(err));
        (this as { vecAvailable: boolean }).vecAvailable = false;
      }
    }
  }

  // ── Resources ──

  createResource(input: CreateResourceInput): Resource {
    const id = uuid();
    const ts = now();
    const caption = input.caption || input.text || null;

    this.db
      .prepare(
        `INSERT INTO resources (id, url, modality, local_path, caption, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.url, input.modality ?? "text", input.localPath ?? null, caption, ts, ts);

    return this.getResource(id)!;
  }

  getResource(id: string): Resource | null {
    const row = this.db.prepare(`SELECT * FROM resources WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapResource(row) : null;
  }

  updateResourceEmbedding(id: string, embedding: number[]): void {
    this.db
      .prepare(`UPDATE resources SET embedding = ?, updated_at = ? WHERE id = ?`)
      .run(vecToBlob(embedding), now(), id);
  }

  listResources(limit = 50, offset = 0): Resource[] {
    const rows = this.db
      .prepare(`SELECT * FROM resources ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as Record<string, unknown>[];
    return rows.map(mapResource);
  }

  deleteResource(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM resources WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  // ── Memory Items ──

  createItem(input: CreateMemoryItemInput): MemoryItem {
    const id = uuid();
    const ts = now();
    const hash = contentHash(input.summary);

    this.db
      .prepare(
        `INSERT INTO memory_items
           (id, resource_id, memory_type, summary, happened_at, content_hash,
            reinforcement_count, last_reinforced_at, extra,
            emotional_valence, emotional_arousal, mood_at_capture,
            significance, reflection, lesson,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.resourceId ?? null,
        input.memoryType,
        input.summary,
        input.happenedAt ?? null,
        hash,
        ts,
        JSON.stringify(input.extra ?? {}),
        input.emotionalValence ?? 0,
        input.emotionalArousal ?? 0,
        input.moodAtCapture ?? null,
        input.significance ?? "routine",
        input.reflection ?? null,
        input.lesson ?? null,
        ts,
        ts,
      );

    return this.getItem(id)!;
  }

  getItem(id: string): MemoryItem | null {
    const row = this.db.prepare(`SELECT * FROM memory_items WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapItem(row) : null;
  }

  /** Find an existing item by content hash (for dedup) */
  findByHash(hash: string): MemoryItem | null {
    const row = this.db
      .prepare(`SELECT * FROM memory_items WHERE content_hash = ? LIMIT 1`)
      .get(hash) as Record<string, unknown> | undefined;
    return row ? mapItem(row) : null;
  }

  /** Reinforce an item — increment count and update timestamp */
  reinforceItem(id: string): MemoryItem | null {
    const ts = now();
    this.db
      .prepare(
        `UPDATE memory_items
         SET reinforcement_count = reinforcement_count + 1,
             last_reinforced_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(ts, ts, id);
    return this.getItem(id);
  }

  updateItemEmbedding(id: string, embedding: number[]): void {
    const blob = vecToBlob(embedding);
    this.db
      .prepare(`UPDATE memory_items SET embedding = ?, updated_at = ? WHERE id = ?`)
      .run(blob, now(), id);

    // Keep vec0 table in sync
    if (this.vecAvailable) {
      const rowid = getRowidForId(this.db, "memory_items", id);
      if (rowid !== null) {
        try {
          upsertVec(this.db, "vec_memory_items", rowid, blob);
        } catch {
          // Non-fatal — vec search will fall back to JS cosine
        }
      }
    }
  }

  updateItemSummary(id: string, summary: string): void {
    const hash = contentHash(summary);
    this.db
      .prepare(`UPDATE memory_items SET summary = ?, content_hash = ?, updated_at = ? WHERE id = ?`)
      .run(summary, hash, now(), id);
  }

  listItems(options?: {
    memoryType?: MemoryType;
    resourceId?: string;
    significance?: Significance;
    limit?: number;
    offset?: number;
  }): MemoryItem[] {
    let sql = `SELECT * FROM memory_items WHERE 1=1`;
    const params: unknown[] = [];

    if (options?.memoryType) {
      sql += ` AND memory_type = ?`;
      params.push(options.memoryType);
    }
    if (options?.resourceId) {
      sql += ` AND resource_id = ?`;
      params.push(options.resourceId);
    }
    if (options?.significance) {
      sql += ` AND significance = ?`;
      params.push(options.significance);
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(options?.limit ?? 50, options?.offset ?? 0);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(mapItem);
  }

  deleteItem(id: string): boolean {
    // Clean up vec0 entry first (before the row is gone)
    if (this.vecAvailable) {
      const rowid = getRowidForId(this.db, "memory_items", id);
      if (rowid !== null) {
        deleteVec(this.db, "vec_memory_items", rowid);
      }
    }
    const result = this.db.prepare(`DELETE FROM memory_items WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  /** Count total items, optionally filtered by type */
  countItems(memoryType?: MemoryType): number {
    if (memoryType) {
      const row = this.db
        .prepare(`SELECT count(*) as cnt FROM memory_items WHERE memory_type = ?`)
        .get(memoryType) as { cnt: number };
      return row.cnt;
    }
    const row = this.db.prepare(`SELECT count(*) as cnt FROM memory_items`).get() as {
      cnt: number;
    };
    return row.cnt;
  }

  // ── Categories ──

  createCategory(input: CreateCategoryInput): MemoryCategory {
    const id = uuid();
    const ts = now();

    this.db
      .prepare(
        `INSERT INTO memory_categories (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.description ?? null, ts, ts);

    return this.getCategory(id)!;
  }

  getCategory(id: string): MemoryCategory | null {
    const row = this.db.prepare(`SELECT * FROM memory_categories WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapCategory(row) : null;
  }

  getCategoryByName(name: string): MemoryCategory | null {
    const row = this.db.prepare(`SELECT * FROM memory_categories WHERE name = ?`).get(name) as
      | Record<string, unknown>
      | undefined;
    return row ? mapCategory(row) : null;
  }

  /** Get or create a category by name */
  getOrCreateCategory(name: string, description?: string): MemoryCategory {
    const existing = this.getCategoryByName(name);
    if (existing) return existing;
    return this.createCategory({ name, description });
  }

  updateCategoryEmbedding(id: string, embedding: number[]): void {
    const blob = vecToBlob(embedding);
    this.db
      .prepare(`UPDATE memory_categories SET embedding = ?, updated_at = ? WHERE id = ?`)
      .run(blob, now(), id);

    if (this.vecAvailable) {
      const rowid = getRowidForId(this.db, "memory_categories", id);
      if (rowid !== null) {
        try {
          upsertVec(this.db, "vec_categories", rowid, blob);
        } catch {
          /* non-fatal */
        }
      }
    }
  }

  updateCategorySummary(id: string, summary: string): void {
    this.db
      .prepare(`UPDATE memory_categories SET summary = ?, updated_at = ? WHERE id = ?`)
      .run(summary, now(), id);
  }

  listCategories(): MemoryCategory[] {
    const rows = this.db.prepare(`SELECT * FROM memory_categories ORDER BY name`).all() as Record<
      string,
      unknown
    >[];
    return rows.map(mapCategory);
  }

  deleteCategory(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM memory_categories WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  // ── Category-Item Links ──

  linkItemToCategory(itemId: string, categoryId: string): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO category_items (item_id, category_id) VALUES (?, ?)`)
      .run(itemId, categoryId);
  }

  unlinkItemFromCategory(itemId: string, categoryId: string): void {
    this.db
      .prepare(`DELETE FROM category_items WHERE item_id = ? AND category_id = ?`)
      .run(itemId, categoryId);
  }

  getCategoryItems(categoryId: string, limit = 100): MemoryItem[] {
    const rows = this.db
      .prepare(
        `SELECT mi.* FROM memory_items mi
         JOIN category_items ci ON ci.item_id = mi.id
         WHERE ci.category_id = ?
         ORDER BY mi.created_at DESC
         LIMIT ?`,
      )
      .all(categoryId, limit) as Record<string, unknown>[];
    return rows.map(mapItem);
  }

  getItemCategories(itemId: string): MemoryCategory[] {
    const rows = this.db
      .prepare(
        `SELECT mc.* FROM memory_categories mc
         JOIN category_items ci ON ci.category_id = mc.id
         WHERE ci.item_id = ?
         ORDER BY mc.name`,
      )
      .all(itemId) as Record<string, unknown>[];
    return rows.map(mapCategory);
  }

  getCategoryItemCount(categoryId: string): number {
    const row = this.db
      .prepare(`SELECT count(*) as cnt FROM category_items WHERE category_id = ?`)
      .get(categoryId) as { cnt: number };
    return row.cnt;
  }

  // ── Search: FTS5 Keyword ──

  /** Normalize a query for FTS5: join tokens with OR so partial matches work. */
  private normalizeFtsQuery(query: string): string {
    const tokens = query
      .replace(/[^\w\s]/g, " ") // strip punctuation
      .split(/\s+/)
      .filter((t) => t.length >= 2); // drop single-char tokens
    if (tokens.length === 0) return query;
    if (tokens.length === 1) return tokens[0];
    return tokens.join(" OR ");
  }

  searchItemsByKeyword(query: string, limit = 20): MemoryItem[] {
    if (this.ftsAvailable) {
      try {
        const ftsQuery = this.normalizeFtsQuery(query);
        const rows = this.db
          .prepare(
            `SELECT mi.* FROM memory_items_fts fts
             JOIN memory_items mi ON mi.rowid = fts.rowid
             WHERE memory_items_fts MATCH ?
             ORDER BY bm25(memory_items_fts)
             LIMIT ?`,
          )
          .all(ftsQuery, limit) as Record<string, unknown>[];
        return rows.map(mapItem);
      } catch {
        // Fall through to LIKE
      }
    }

    // Fallback: LIKE search
    const likeQuery = `%${query}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_items
         WHERE summary LIKE ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(likeQuery, limit) as Record<string, unknown>[];
    return rows.map(mapItem);
  }

  searchCategoriesByKeyword(query: string, limit = 10): MemoryCategory[] {
    if (this.ftsAvailable) {
      try {
        const ftsQuery = this.normalizeFtsQuery(query);
        const rows = this.db
          .prepare(
            `SELECT mc.* FROM memory_categories_fts fts
             JOIN memory_categories mc ON mc.rowid = fts.rowid
             WHERE memory_categories_fts MATCH ?
             ORDER BY bm25(memory_categories_fts)
             LIMIT ?`,
          )
          .all(ftsQuery, limit) as Record<string, unknown>[];
        return rows.map(mapCategory);
      } catch {
        // Fall through
      }
    }

    const likeQuery = `%${query}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_categories
         WHERE name LIKE ? OR description LIKE ? OR summary LIKE ?
         ORDER BY name
         LIMIT ?`,
      )
      .all(likeQuery, likeQuery, likeQuery, limit) as Record<string, unknown>[];
    return rows.map(mapCategory);
  }

  // ── Search: Vector (in-process cosine) ──

  /**
   * Search items by vector similarity.
   * Uses sqlite-vec KNN when available (native, fast), falls back to JS cosine scan.
   */
  searchItemsByVector(
    queryVec: number[],
    options?: {
      memoryTypes?: MemoryType[];
      limit?: number;
      scoring?: "similarity" | "salience" | "identity";
      halfLifeDays?: number;
    },
  ): Array<{ item: MemoryItem; score: number }> {
    const limit = options?.limit ?? 20;
    const scoring = options?.scoring ?? "similarity";
    const halfLife = options?.halfLifeDays ?? 30;

    // Try sqlite-vec KNN first (much faster — no full table scan)
    if (this.vecAvailable) {
      try {
        return this._searchItemsByVec(queryVec, options);
      } catch {
        // Fall through to JS cosine
      }
    }

    // Fallback: JS cosine similarity scan
    return this._searchItemsByJsCosine(queryVec, options);
  }

  /** Native sqlite-vec KNN search */
  private _searchItemsByVec(
    queryVec: number[],
    options?: {
      memoryTypes?: MemoryType[];
      limit?: number;
      scoring?: "similarity" | "salience" | "identity";
      halfLifeDays?: number;
    },
  ): Array<{ item: MemoryItem; score: number }> {
    const limit = options?.limit ?? 20;
    const scoring = options?.scoring ?? "similarity";
    const halfLife = options?.halfLifeDays ?? 30;

    // KNN returns top candidates by L2 distance — fetch extra for post-filtering/scoring
    const knnLimit = scoring === "similarity" ? limit : limit * 3;
    const queryBlob = vecToUint8Array(queryVec);
    const knnResults = vecKnnSearch(this.db, "vec_memory_items", queryBlob, knnLimit);

    if (knnResults.length === 0) return [];

    // Build rowid → distance map
    const distanceMap = new Map<number, number>();
    const rowids: number[] = [];
    for (const r of knnResults) {
      distanceMap.set(r.rowid, r.distance);
      rowids.push(r.rowid);
    }

    // Fetch full items by rowid
    const placeholders = rowids.map(() => "?").join(",");
    let sql = `SELECT * FROM memory_items WHERE rowid IN (${placeholders})`;
    const params: unknown[] = [...rowids];

    if (options?.memoryTypes && options.memoryTypes.length > 0) {
      const typePlaceholders = options.memoryTypes.map(() => "?").join(",");
      sql += ` AND memory_type IN (${typePlaceholders})`;
      params.push(...options.memoryTypes);
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const items = rows.map(mapItem);

    // Get rowid for each item (needed for distance lookup)
    const itemRowids = new Map<string, number>();
    for (const item of items) {
      const rowid = getRowidForId(this.db, "memory_items", item.id);
      if (rowid !== null) itemRowids.set(item.id, rowid);
    }

    // Pre-load entity bonds for identity scoring
    let entityBonds: Map<string, number[]> | null = null;
    if (scoring === "identity") {
      entityBonds = this.getItemEntityBondMap(items.map((i) => i.id));
    }

    // Score and sort
    const scored = items
      .map((item) => {
        const rowid = itemRowids.get(item.id);
        const l2Distance = rowid !== undefined ? (distanceMap.get(rowid) ?? Infinity) : Infinity;
        // Convert L2 distance to approximate cosine similarity
        // For normalized vectors: cosine_distance ≈ L2²/2, so sim ≈ 1 - L2²/2
        const sim = Math.max(0, 1 - (l2Distance * l2Distance) / 2);

        let score: number;
        if (scoring === "identity") {
          score = identityScore({
            cosineSimilarity: sim,
            reinforcementCount: item.reinforcementCount,
            createdAt: new Date(item.createdAt),
            emotionalValence: item.emotionalValence,
            emotionalArousal: item.emotionalArousal,
            significance: item.significance,
            bondStrengths: entityBonds?.get(item.id) ?? [],
          });
        } else if (scoring === "salience") {
          score = salienceScore({
            cosineSimilarity: sim,
            reinforcementCount: item.reinforcementCount,
            createdAt: new Date(item.createdAt),
            halfLifeDays: halfLife,
          });
        } else {
          score = sim;
        }

        return { item, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options?.limit ?? 20);

    return scored;
  }

  /** Fallback: JS cosine similarity scan (loads all embeddings into memory) */
  private _searchItemsByJsCosine(
    queryVec: number[],
    options?: {
      memoryTypes?: MemoryType[];
      limit?: number;
      scoring?: "similarity" | "salience" | "identity";
      halfLifeDays?: number;
    },
  ): Array<{ item: MemoryItem; score: number }> {
    let sql = `SELECT * FROM memory_items WHERE embedding IS NOT NULL`;
    const params: unknown[] = [];

    if (options?.memoryTypes && options.memoryTypes.length > 0) {
      const placeholders = options.memoryTypes.map(() => "?").join(",");
      sql += ` AND memory_type IN (${placeholders})`;
      params.push(...options.memoryTypes);
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const items = rows.map(mapItem);
    const limit = options?.limit ?? 20;
    const scoring = options?.scoring ?? "similarity";
    const halfLife = options?.halfLifeDays ?? 30;

    // Pre-load entity bonds for identity scoring
    let entityBonds: Map<string, number[]> | null = null;
    if (scoring === "identity") {
      entityBonds = this.getItemEntityBondMap(items.map((i) => i.id));
    }

    const scored = items
      .map((item) => {
        const sim = cosineSimilarity(queryVec, item.embedding!);
        let score: number;

        if (scoring === "identity") {
          score = identityScore({
            cosineSimilarity: sim,
            reinforcementCount: item.reinforcementCount,
            createdAt: new Date(item.createdAt),
            emotionalValence: item.emotionalValence,
            emotionalArousal: item.emotionalArousal,
            significance: item.significance,
            bondStrengths: entityBonds?.get(item.id) ?? [],
          });
        } else if (scoring === "salience") {
          score = salienceScore({
            cosineSimilarity: sim,
            reinforcementCount: item.reinforcementCount,
            createdAt: new Date(item.createdAt),
            halfLifeDays: halfLife,
          });
        } else {
          score = sim;
        }

        return { item, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  /** Search categories by vector similarity. */
  searchCategoriesByVector(
    queryVec: number[],
    limit = 10,
  ): Array<{ category: MemoryCategory; score: number }> {
    // Try sqlite-vec KNN first
    if (this.vecAvailable) {
      try {
        const queryBlob = vecToUint8Array(queryVec);
        const knnResults = vecKnnSearch(this.db, "vec_categories", queryBlob, limit);
        if (knnResults.length > 0) {
          const rowids = knnResults.map((r) => r.rowid);
          const placeholders = rowids.map(() => "?").join(",");
          const rows = this.db
            .prepare(`SELECT * FROM memory_categories WHERE rowid IN (${placeholders})`)
            .all(...rowids) as Record<string, unknown>[];
          const cats = rows.map(mapCategory);

          const distMap = new Map(knnResults.map((r) => [r.rowid, r.distance]));
          return cats
            .map((category) => {
              const rowid = getRowidForId(this.db, "memory_categories", category.id);
              const l2 = rowid !== null ? (distMap.get(rowid) ?? Infinity) : Infinity;
              return { category, score: Math.max(0, 1 - (l2 * l2) / 2) };
            })
            .filter((r) => r.score > 0)
            .sort((a, b) => b.score - a.score);
        }
      } catch {
        // Fall through to JS cosine
      }
    }

    // Fallback: JS cosine
    const rows = this.db
      .prepare(`SELECT * FROM memory_categories WHERE embedding IS NOT NULL`)
      .all() as Record<string, unknown>[];
    const categories = rows.map(mapCategory);

    return categories
      .map((category) => ({
        category,
        score: cosineSimilarity(queryVec, category.embedding!),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ── Combined Search (keyword + vector hybrid) ──

  searchItems(
    queryVec: number[] | null,
    queryText: string,
    options?: {
      memoryTypes?: MemoryType[];
      limit?: number;
      scoring?: "similarity" | "salience" | "identity";
      halfLifeDays?: number;
      vectorWeight?: number;
    },
  ): Array<{ item: MemoryItem; score: number }> {
    const limit = options?.limit ?? 20;
    const vectorWeight = options?.vectorWeight ?? 0.7;
    const textWeight = 1 - vectorWeight;

    // Collect results from both sources
    const scoreMap = new Map<string, { item: MemoryItem; score: number }>();

    // Vector results
    if (queryVec) {
      const vecResults = this.searchItemsByVector(queryVec, {
        memoryTypes: options?.memoryTypes,
        limit: limit * 2,
        scoring: options?.scoring,
        halfLifeDays: options?.halfLifeDays,
      });
      for (const r of vecResults) {
        scoreMap.set(r.item.id, { item: r.item, score: r.score * vectorWeight });
      }
    }

    // Keyword results
    if (queryText.trim()) {
      const kwResults = this.searchItemsByKeyword(queryText, limit * 2);
      for (let i = 0; i < kwResults.length; i++) {
        const item = kwResults[i];
        // BM25 score approximation: rank-based (1.0 for best, decaying)
        const kwScore = 1.0 / (1 + i * 0.2);
        const existing = scoreMap.get(item.id);
        if (existing) {
          existing.score += kwScore * textWeight;
        } else {
          scoreMap.set(item.id, { item, score: kwScore * textWeight });
        }
      }
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ── Stats ──

  getStats(): {
    resources: number;
    items: number;
    categories: number;
    entities: number;
    reflections: number;
    lessons: number;
    modelFeedback: number;
    itemsByType: Record<string, number>;
    vecAvailable: boolean;
  } {
    const resources = (
      this.db.prepare(`SELECT count(*) as cnt FROM resources`).get() as { cnt: number }
    ).cnt;
    const items = (
      this.db.prepare(`SELECT count(*) as cnt FROM memory_items`).get() as { cnt: number }
    ).cnt;
    const categories = (
      this.db.prepare(`SELECT count(*) as cnt FROM memory_categories`).get() as {
        cnt: number;
      }
    ).cnt;
    const entities = (
      this.db.prepare(`SELECT count(*) as cnt FROM entities`).get() as { cnt: number }
    ).cnt;
    const reflections = (
      this.db.prepare(`SELECT count(*) as cnt FROM reflections`).get() as { cnt: number }
    ).cnt;
    const lessons = (
      this.db.prepare(`SELECT count(*) as cnt FROM lessons`).get() as { cnt: number }
    ).cnt;
    let modelFeedback = 0;
    try {
      modelFeedback = (
        this.db.prepare(`SELECT count(*) as cnt FROM model_feedback`).get() as { cnt: number }
      ).cnt;
    } catch {
      /* table may not exist yet */
    }

    const typeRows = this.db
      .prepare(`SELECT memory_type, count(*) as cnt FROM memory_items GROUP BY memory_type`)
      .all() as Array<{ memory_type: string; cnt: number }>;

    const itemsByType: Record<string, number> = {};
    for (const row of typeRows) {
      itemsByType[row.memory_type] = row.cnt;
    }

    return {
      resources,
      items,
      categories,
      entities,
      reflections,
      lessons,
      modelFeedback,
      itemsByType,
      vecAvailable: this.vecAvailable,
    };
  }

  // ── Entities ──

  createEntity(input: CreateEntityInput): Entity {
    const id = uuid();
    const ts = now();

    this.db
      .prepare(
        `INSERT INTO entities
           (id, name, entity_type, relationship, bond_strength, emotional_texture,
            first_mentioned_at, last_mentioned_at, memory_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.entityType ?? "person",
        input.relationship ?? null,
        input.bondStrength ?? 0.5,
        input.emotionalTexture ?? null,
        ts,
        ts,
        ts,
        ts,
      );

    return this.getEntity(id)!;
  }

  getEntity(id: string): Entity | null {
    const row = this.db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapEntity(row) : null;
  }

  getEntityByName(name: string): Entity | null {
    const row = this.db.prepare(`SELECT * FROM entities WHERE name = ? COLLATE NOCASE`).get(name) as
      | Record<string, unknown>
      | undefined;
    return row ? mapEntity(row) : null;
  }

  getOrCreateEntity(name: string, input?: Partial<CreateEntityInput>): Entity {
    const existing = this.getEntityByName(name);
    if (existing) return existing;
    return this.createEntity({ name, ...input });
  }

  updateEntity(
    id: string,
    fields: Partial<{
      relationship: string;
      bondStrength: number;
      emotionalTexture: string;
      profileSummary: string;
      entityType: EntityType;
    }>,
  ): Entity | null {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (fields.relationship !== undefined) {
      sets.push(`relationship = ?`);
      params.push(fields.relationship);
    }
    if (fields.bondStrength !== undefined) {
      sets.push(`bond_strength = ?`);
      params.push(fields.bondStrength);
    }
    if (fields.emotionalTexture !== undefined) {
      sets.push(`emotional_texture = ?`);
      params.push(fields.emotionalTexture);
    }
    if (fields.profileSummary !== undefined) {
      sets.push(`profile_summary = ?`);
      params.push(fields.profileSummary);
    }
    if (fields.entityType !== undefined) {
      sets.push(`entity_type = ?`);
      params.push(fields.entityType);
    }

    if (sets.length === 0) return this.getEntity(id);

    sets.push(`updated_at = ?`);
    params.push(now());
    params.push(id);

    this.db.prepare(`UPDATE entities SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    return this.getEntity(id);
  }

  updateEntityEmbedding(id: string, embedding: number[]): void {
    const blob = vecToBlob(embedding);
    this.db
      .prepare(`UPDATE entities SET embedding = ?, updated_at = ? WHERE id = ?`)
      .run(blob, now(), id);

    if (this.vecAvailable) {
      const rowid = getRowidForId(this.db, "entities", id);
      if (rowid !== null) {
        try {
          upsertVec(this.db, "vec_entities", rowid, blob);
        } catch {
          /* non-fatal */
        }
      }
    }
  }

  listEntities(options?: {
    entityType?: EntityType;
    minBondStrength?: number;
    limit?: number;
  }): Entity[] {
    let sql = `SELECT * FROM entities WHERE 1=1`;
    const params: unknown[] = [];

    if (options?.entityType) {
      sql += ` AND entity_type = ?`;
      params.push(options.entityType);
    }
    if (options?.minBondStrength !== undefined) {
      sql += ` AND bond_strength >= ?`;
      params.push(options.minBondStrength);
    }

    sql += ` ORDER BY bond_strength DESC, memory_count DESC`;
    if (options?.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(mapEntity);
  }

  deleteEntity(id: string): boolean {
    if (this.vecAvailable) {
      const rowid = getRowidForId(this.db, "entities", id);
      if (rowid !== null) {
        deleteVec(this.db, "vec_entities", rowid);
      }
    }
    const result = this.db.prepare(`DELETE FROM entities WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  searchEntitiesByKeyword(query: string, limit = 10): Entity[] {
    const likeQuery = `%${query}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM entities
         WHERE name LIKE ? OR relationship LIKE ? OR profile_summary LIKE ?
         ORDER BY bond_strength DESC
         LIMIT ?`,
      )
      .all(likeQuery, likeQuery, likeQuery, limit) as Record<string, unknown>[];
    return rows.map(mapEntity);
  }

  searchEntitiesByVector(queryVec: number[], limit = 10): Array<{ entity: Entity; score: number }> {
    // Try sqlite-vec KNN first
    if (this.vecAvailable) {
      try {
        const queryBlob = vecToUint8Array(queryVec);
        const knnResults = vecKnnSearch(this.db, "vec_entities", queryBlob, limit);
        if (knnResults.length > 0) {
          const rowids = knnResults.map((r) => r.rowid);
          const placeholders = rowids.map(() => "?").join(",");
          const rows = this.db
            .prepare(`SELECT * FROM entities WHERE rowid IN (${placeholders})`)
            .all(...rowids) as Record<string, unknown>[];
          const ents = rows.map(mapEntity);

          const distMap = new Map(knnResults.map((r) => [r.rowid, r.distance]));
          return ents
            .map((entity) => {
              const rowid = getRowidForId(this.db, "entities", entity.id);
              const l2 = rowid !== null ? (distMap.get(rowid) ?? Infinity) : Infinity;
              return { entity, score: Math.max(0, 1 - (l2 * l2) / 2) };
            })
            .filter((r) => r.score > 0)
            .sort((a, b) => b.score - a.score);
        }
      } catch {
        // Fall through to JS cosine
      }
    }

    // Fallback: JS cosine
    const rows = this.db
      .prepare(`SELECT * FROM entities WHERE embedding IS NOT NULL`)
      .all() as Record<string, unknown>[];
    const entities = rows.map(mapEntity);

    return entities
      .map((entity) => ({
        entity,
        score: cosineSimilarity(queryVec, entity.embedding!),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ── Item-Entity Links ──

  linkItemToEntity(itemId: string, entityId: string, role = "mentioned"): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO item_entities (item_id, entity_id, role) VALUES (?, ?, ?)`)
      .run(itemId, entityId, role);

    // Update entity stats
    const ts = now();
    this.db
      .prepare(
        `UPDATE entities SET
           memory_count = (SELECT count(*) FROM item_entities WHERE entity_id = ?),
           last_mentioned_at = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(entityId, ts, ts, entityId);
  }

  unlinkItemFromEntity(itemId: string, entityId: string): void {
    this.db
      .prepare(`DELETE FROM item_entities WHERE item_id = ? AND entity_id = ?`)
      .run(itemId, entityId);

    // Update entity memory_count
    this.db
      .prepare(
        `UPDATE entities SET
           memory_count = (SELECT count(*) FROM item_entities WHERE entity_id = ?),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(entityId, now(), entityId);
  }

  getEntityItems(entityId: string, limit = 100): MemoryItem[] {
    const rows = this.db
      .prepare(
        `SELECT mi.* FROM memory_items mi
         JOIN item_entities ie ON ie.item_id = mi.id
         WHERE ie.entity_id = ?
         ORDER BY mi.created_at DESC
         LIMIT ?`,
      )
      .all(entityId, limit) as Record<string, unknown>[];
    return rows.map(mapItem);
  }

  getItemEntities(itemId: string): Entity[] {
    const rows = this.db
      .prepare(
        `SELECT e.* FROM entities e
         JOIN item_entities ie ON ie.entity_id = e.id
         WHERE ie.item_id = ?
         ORDER BY e.bond_strength DESC`,
      )
      .all(itemId) as Record<string, unknown>[];
    return rows.map(mapEntity);
  }

  /** Get a map of itemId → bondStrengths[] for scoring. Pre-loads to avoid N+1. */
  getItemEntityBondMap(itemIds: string[]): Map<string, number[]> {
    if (itemIds.length === 0) return new Map();

    const placeholders = itemIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT ie.item_id, e.bond_strength FROM item_entities ie
         JOIN entities e ON e.id = ie.entity_id
         WHERE ie.item_id IN (${placeholders})`,
      )
      .all(...itemIds) as Array<{ item_id: string; bond_strength: number }>;

    const map = new Map<string, number[]>();
    for (const row of rows) {
      const existing = map.get(row.item_id);
      if (existing) {
        existing.push(row.bond_strength);
      } else {
        map.set(row.item_id, [row.bond_strength]);
      }
    }
    return map;
  }

  // ── Reflections ──

  createReflection(input: CreateReflectionInput): Reflection {
    const id = uuid();
    const ts = now();

    this.db
      .prepare(
        `INSERT INTO reflections
           (id, trigger_type, period_start, period_end, content,
            lessons_extracted, entities_involved, self_insights, mood, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.triggerType,
        input.periodStart ?? null,
        input.periodEnd ?? null,
        input.content,
        JSON.stringify(input.lessonsExtracted ?? []),
        JSON.stringify(input.entitiesInvolved ?? []),
        JSON.stringify(input.selfInsights ?? []),
        input.mood ?? null,
        ts,
      );

    return this.getReflection(id)!;
  }

  getReflection(id: string): Reflection | null {
    const row = this.db.prepare(`SELECT * FROM reflections WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapReflection(row) : null;
  }

  listReflections(options?: { triggerType?: string; limit?: number }): Reflection[] {
    let sql = `SELECT * FROM reflections WHERE 1=1`;
    const params: unknown[] = [];

    if (options?.triggerType) {
      sql += ` AND trigger_type = ?`;
      params.push(options.triggerType);
    }

    sql += ` ORDER BY created_at DESC`;
    if (options?.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(mapReflection);
  }

  getRecentReflections(limit = 5): Reflection[] {
    return this.listReflections({ limit });
  }

  // ── Lessons (SIS) ──

  createLesson(input: CreateLessonInput): Lesson {
    const id = uuid();
    const ts = now();

    this.db
      .prepare(
        `INSERT INTO lessons
           (id, type, context, action, outcome, lesson, correction,
            confidence, occurrences, last_seen, tags, related_tools,
            source_episode_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.type,
        input.context,
        input.action,
        input.outcome,
        input.lesson,
        input.correction ?? null,
        input.confidence ?? 0.5,
        ts,
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.relatedTools ?? []),
        JSON.stringify(input.sourceEpisodeIds ?? []),
        ts,
        ts,
      );

    return this.getLesson(id)!;
  }

  getLesson(id: string): Lesson | null {
    const row = this.db.prepare(`SELECT * FROM lessons WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapLesson(row) : null;
  }

  searchLessonsByKeyword(query: string, limit = 20): Lesson[] {
    if (this.ftsAvailable) {
      try {
        const ftsQuery = this.normalizeFtsQuery(query);
        const rows = this.db
          .prepare(
            `SELECT l.* FROM lessons_fts fts
             JOIN lessons l ON l.rowid = fts.rowid
             WHERE lessons_fts MATCH ?
             ORDER BY bm25(lessons_fts)
             LIMIT ?`,
          )
          .all(ftsQuery, limit) as Record<string, unknown>[];
        return rows.map(mapLesson);
      } catch {
        // Fall through to LIKE
      }
    }

    const likeQuery = `%${query}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM lessons
         WHERE context LIKE ? OR action LIKE ? OR outcome LIKE ? OR lesson LIKE ?
         ORDER BY confidence DESC, last_seen DESC
         LIMIT ?`,
      )
      .all(likeQuery, likeQuery, likeQuery, likeQuery, limit) as Record<string, unknown>[];
    return rows.map(mapLesson);
  }

  getLessonsByTool(toolName: string, limit = 20): Lesson[] {
    // related_tools is stored as JSON array, use LIKE for matching
    const likeQuery = `%"${toolName}"%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM lessons
         WHERE related_tools LIKE ?
         ORDER BY confidence DESC, last_seen DESC
         LIMIT ?`,
      )
      .all(likeQuery, limit) as Record<string, unknown>[];
    return rows.map(mapLesson);
  }

  getLessonsByTag(tag: string, limit = 20): Lesson[] {
    const likeQuery = `%"${tag}"%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM lessons
         WHERE tags LIKE ?
         ORDER BY confidence DESC, last_seen DESC
         LIMIT ?`,
      )
      .all(likeQuery, limit) as Record<string, unknown>[];
    return rows.map(mapLesson);
  }

  /** Increment occurrences, boost confidence by 0.1 (cap 1.0), update last_seen */
  reinforceLesson(id: string): void {
    const ts = now();
    this.db
      .prepare(
        `UPDATE lessons SET
           occurrences = occurrences + 1,
           confidence = MIN(1.0, confidence + 0.1),
           last_seen = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(ts, ts, id);
  }

  /** Reduce confidence on a single lesson by ID (e.g. negative feedback). */
  decayLesson(id: string, amount: number): void {
    this.db
      .prepare(
        `UPDATE lessons SET
           confidence = MAX(0.0, confidence - ?),
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(amount, id);
  }

  /** Reduce confidence on stale lessons. Returns count of affected rows. */
  decayLessons(olderThanDays: number, decayAmount: number): number {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db
      .prepare(
        `UPDATE lessons SET
           confidence = MAX(0.0, confidence - ?),
           updated_at = datetime('now')
         WHERE last_seen < ? AND confidence > 0`,
      )
      .run(decayAmount, cutoff);
    return result.changes;
  }

  /** Combined tool + keyword search, sorted by confidence * recency */
  getRelevantLessons(params: { toolNames?: string[]; query?: string; limit?: number }): Lesson[] {
    const limit = params.limit ?? 10;
    const scoreMap = new Map<string, { lesson: Lesson; score: number }>();

    // Tool-based results
    if (params.toolNames && params.toolNames.length > 0) {
      for (const tool of params.toolNames) {
        const toolLessons = this.getLessonsByTool(tool, limit * 2);
        for (const lesson of toolLessons) {
          if (!scoreMap.has(lesson.id)) {
            scoreMap.set(lesson.id, { lesson, score: 0 });
          }
          // Tool match boost
          scoreMap.get(lesson.id)!.score += 0.5;
        }
      }
    }

    // Keyword-based results
    if (params.query?.trim()) {
      const kwLessons = this.searchLessonsByKeyword(params.query, limit * 2);
      for (let i = 0; i < kwLessons.length; i++) {
        const lesson = kwLessons[i];
        if (!scoreMap.has(lesson.id)) {
          scoreMap.set(lesson.id, { lesson, score: 0 });
        }
        // BM25 rank-based score
        scoreMap.get(lesson.id)!.score += 1.0 / (1 + i * 0.2);
      }
    }

    // Weight by confidence and recency
    const nowMs = Date.now();
    const results = Array.from(scoreMap.values()).map(({ lesson, score }) => {
      const daysSinceLastSeen =
        (nowMs - new Date(lesson.lastSeen).getTime()) / (1000 * 60 * 60 * 24);
      const recency = Math.exp((-Math.LN2 * daysSinceLastSeen) / 90); // 90-day half-life
      return { lesson, score: score * lesson.confidence * recency };
    });

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.lesson);
  }

  listLessons(options?: { type?: LessonType; limit?: number; offset?: number }): Lesson[] {
    let sql = `SELECT * FROM lessons WHERE 1=1`;
    const params: unknown[] = [];

    if (options?.type) {
      sql += ` AND type = ?`;
      params.push(options.type);
    }

    sql += ` ORDER BY confidence DESC, last_seen DESC LIMIT ? OFFSET ?`;
    params.push(options?.limit ?? 50, options?.offset ?? 0);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(mapLesson);
  }

  countLessons(type?: LessonType): number {
    if (type) {
      const row = this.db
        .prepare(`SELECT count(*) as cnt FROM lessons WHERE type = ?`)
        .get(type) as { cnt: number };
      return row.cnt;
    }
    const row = this.db.prepare(`SELECT count(*) as cnt FROM lessons`).get() as { cnt: number };
    return row.cnt;
  }

  deleteLesson(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM lessons WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  // ── Item Significance / Emotional Updates ──

  updateItemSignificance(id: string, significance: Significance): void {
    this.db
      .prepare(`UPDATE memory_items SET significance = ?, updated_at = ? WHERE id = ?`)
      .run(significance, now(), id);
  }

  updateItemEmotion(id: string, valence: number, arousal: number): void {
    this.db
      .prepare(
        `UPDATE memory_items SET emotional_valence = ?, emotional_arousal = ?, updated_at = ? WHERE id = ?`,
      )
      .run(valence, arousal, now(), id);
  }

  updateItemReflection(id: string, reflection: string, lesson?: string): void {
    if (lesson !== undefined) {
      this.db
        .prepare(`UPDATE memory_items SET reflection = ?, lesson = ?, updated_at = ? WHERE id = ?`)
        .run(reflection, lesson, now(), id);
    } else {
      this.db
        .prepare(`UPDATE memory_items SET reflection = ?, updated_at = ? WHERE id = ?`)
        .run(reflection, now(), id);
    }
  }

  // ── Model Feedback ──

  recordModelFeedback(input: RecordModelFeedbackInput): ModelFeedbackRecord {
    const id = crypto.randomUUID();
    const createdAt = now();
    this.db
      .prepare(
        `INSERT INTO model_feedback (id, provider, model, tier, session_type, complexity_score, duration_ms, success, error_type, input_tokens, output_tokens, total_tokens, tool_call_count, session_key, profile, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.provider,
        input.model,
        input.tier,
        input.sessionType,
        input.complexityScore,
        input.durationMs,
        input.success ? 1 : 0,
        input.errorType ?? null,
        input.inputTokens ?? 0,
        input.outputTokens ?? 0,
        input.totalTokens ?? 0,
        input.toolCallCount ?? 0,
        input.sessionKey ?? null,
        input.profile ?? null,
        createdAt,
      );
    return {
      id,
      provider: input.provider,
      model: input.model,
      tier: input.tier,
      sessionType: input.sessionType,
      complexityScore: input.complexityScore,
      durationMs: input.durationMs,
      success: input.success,
      errorType: input.errorType ?? null,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      totalTokens: input.totalTokens ?? 0,
      toolCallCount: input.toolCallCount ?? 0,
      userFeedback: null,
      sessionKey: input.sessionKey ?? null,
      profile: input.profile ?? null,
      createdAt,
    };
  }

  updateModelFeedbackUserRating(sessionKey: string, feedback: "up" | "down"): number {
    const result = this.db
      .prepare(
        `UPDATE model_feedback SET user_feedback = ? WHERE session_key = ? AND user_feedback IS NULL`,
      )
      .run(feedback, sessionKey);
    return (result as { changes?: number }).changes ?? 0;
  }

  updateModelFeedbackSelfEval(id: string, score: number, reasoning: string): void {
    this.db
      .prepare(
        `UPDATE model_feedback SET self_eval_score = ?, self_eval_reasoning = ? WHERE id = ?`,
      )
      .run(score, reasoning, id);
  }

  getLatestModelFeedbackId(sessionKey: string): string | null {
    const row = this.db
      .prepare(
        `SELECT id FROM model_feedback WHERE session_key = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(sessionKey) as { id: string } | undefined;
    return row?.id ?? null;
  }

  getModelPerformanceStats(options?: {
    provider?: string;
    model?: string;
    sessionType?: string;
    sinceDaysAgo?: number;
  }): ModelPerformanceStats[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.provider) {
      conditions.push("provider = ?");
      params.push(options.provider);
    }
    if (options?.model) {
      conditions.push("model = ?");
      params.push(options.model);
    }
    if (options?.sessionType) {
      conditions.push("session_type = ?");
      params.push(options.sessionType);
    }
    if (options?.sinceDaysAgo) {
      conditions.push("created_at > datetime('now', ?)");
      params.push(`-${options.sinceDaysAgo} days`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = this.db
      .prepare(
        `SELECT
          provider,
          model,
          count(*) as total_requests,
          sum(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
          sum(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count,
          avg(duration_ms) as avg_duration_ms,
          avg(input_tokens) as avg_input_tokens,
          avg(output_tokens) as avg_output_tokens,
          sum(CASE WHEN user_feedback = 'up' THEN 1 ELSE 0 END) as positive_count,
          sum(CASE WHEN user_feedback = 'down' THEN 1 ELSE 0 END) as negative_count
        FROM model_feedback
        ${where}
        GROUP BY provider, model
        ORDER BY total_requests DESC`,
      )
      .all(...params) as Array<{
      provider: string;
      model: string;
      total_requests: number;
      success_count: number;
      failure_count: number;
      avg_duration_ms: number;
      avg_input_tokens: number;
      avg_output_tokens: number;
      positive_count: number;
      negative_count: number;
    }>;

    return rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      totalRequests: r.total_requests,
      successCount: r.success_count,
      failureCount: r.failure_count,
      successRate: r.total_requests > 0 ? r.success_count / r.total_requests : 0,
      avgDurationMs: Math.round(r.avg_duration_ms ?? 0),
      avgInputTokens: Math.round(r.avg_input_tokens ?? 0),
      avgOutputTokens: Math.round(r.avg_output_tokens ?? 0),
      positiveCount: r.positive_count,
      negativeCount: r.negative_count,
    }));
  }

  getModelPerformanceByTier(options?: { sinceDaysAgo?: number }): Array<{
    tier: string;
    provider: string;
    model: string;
    totalRequests: number;
    successRate: number;
    avgDurationMs: number;
    avgTokens: number;
  }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.sinceDaysAgo) {
      conditions.push("created_at > datetime('now', ?)");
      params.push(`-${options.sinceDaysAgo} days`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = this.db
      .prepare(
        `SELECT
          tier,
          provider,
          model,
          count(*) as total_requests,
          avg(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
          avg(duration_ms) as avg_duration_ms,
          avg(total_tokens) as avg_tokens
        FROM model_feedback
        ${where}
        GROUP BY tier, provider, model
        ORDER BY tier, total_requests DESC`,
      )
      .all(...params) as Array<{
      tier: string;
      provider: string;
      model: string;
      total_requests: number;
      success_rate: number;
      avg_duration_ms: number;
      avg_tokens: number;
    }>;

    return rows.map((r) => ({
      tier: r.tier,
      provider: r.provider,
      model: r.model,
      totalRequests: r.total_requests,
      successRate: r.success_rate,
      avgDurationMs: Math.round(r.avg_duration_ms ?? 0),
      avgTokens: Math.round(r.avg_tokens ?? 0),
    }));
  }

  countModelFeedback(): number {
    try {
      return (
        this.db.prepare(`SELECT count(*) as cnt FROM model_feedback`).get() as { cnt: number }
      ).cnt;
    } catch {
      return 0;
    }
  }

  // ── Live Memory Candidates ──

  createLiveCandidate(input: CreateLiveCandidateInput): LiveCandidate | null {
    const id = uuid();
    const ts = now();
    const hash = contentHash(input.factText);
    const ttlHours = input.ttlHours ?? 24;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

    try {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO live_memory_candidates
             (id, session_key, message_id, role, candidate_type, fact_text, fact_hash,
              confidence, trigger_flags, entities, memory_type_hint, significance_hint,
              source_ts, expires_at, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          id,
          input.sessionKey ?? null,
          input.messageId ?? null,
          input.role,
          input.candidateType,
          input.factText,
          hash,
          input.confidence,
          JSON.stringify(input.triggerFlags ?? []),
          JSON.stringify(input.entities ?? []),
          input.memoryTypeHint ?? null,
          input.significanceHint ?? null,
          ts,
          expiresAt,
          ts,
          ts,
        );

      // INSERT OR IGNORE may skip on dedupe — check if our row was inserted
      return this.getLiveCandidate(id);
    } catch {
      return null;
    }
  }

  getLiveCandidate(id: string): LiveCandidate | null {
    const row = this.db.prepare(`SELECT * FROM live_memory_candidates WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapLiveCandidate(row) : null;
  }

  listLiveCandidates(options?: {
    status?: CandidateStatus;
    limit?: number;
    sessionKey?: string;
    expiresBefore?: string;
  }): LiveCandidate[] {
    let sql = `SELECT * FROM live_memory_candidates WHERE 1=1`;
    const params: unknown[] = [];

    if (options?.status) {
      sql += ` AND status = ?`;
      params.push(options.status);
    }
    if (options?.sessionKey) {
      sql += ` AND session_key = ?`;
      params.push(options.sessionKey);
    }
    if (options?.expiresBefore) {
      sql += ` AND expires_at < ?`;
      params.push(options.expiresBefore);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(options?.limit ?? 50);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(mapLiveCandidate);
  }

  markLiveCandidatePromoted(id: string, memoryItemId: string, reason?: string): void {
    const ts = now();
    this.db
      .prepare(
        `UPDATE live_memory_candidates
         SET status = 'promoted', promoted_item_id = ?, promotion_reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(memoryItemId, reason ?? null, ts, id);

    this.recordPromotionEvent(id, "runtime", "promote", "ok", reason);
  }

  markLiveCandidateMerged(id: string, targetItemId: string): void {
    const ts = now();
    this.db
      .prepare(
        `UPDATE live_memory_candidates
         SET status = 'merged', promoted_item_id = ?, promotion_reason = 'dedup-reinforce', updated_at = ?
         WHERE id = ?`,
      )
      .run(targetItemId, ts, id);

    this.recordPromotionEvent(id, "runtime", "merge", "ok", "dedup-reinforce");
  }

  markLiveCandidateDiscarded(id: string, reason: string, actor: PromotionActor = "runtime"): void {
    const ts = now();
    this.db
      .prepare(
        `UPDATE live_memory_candidates
         SET status = 'discarded', promotion_reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(reason, ts, id);

    this.recordPromotionEvent(id, actor, "discard", "ok", reason);
  }

  markLiveCandidateExpired(ids: string[]): void {
    if (ids.length === 0) return;
    const ts = now();
    const placeholders = ids.map(() => "?").join(",");
    this.db
      .prepare(
        `UPDATE live_memory_candidates SET status = 'expired', updated_at = ? WHERE id IN (${placeholders}) AND status = 'pending'`,
      )
      .run(ts, ...ids);

    for (const id of ids) {
      this.recordPromotionEvent(id, "runtime", "expire", "ok");
    }
  }

  recordPromotionEvent(
    candidateId: string,
    actor: PromotionActor,
    action: PromotionAction,
    result: "ok" | "error",
    reason?: string,
    error?: string,
  ): void {
    const id = uuid();
    try {
      this.db
        .prepare(
          `INSERT INTO memory_promotion_events (id, candidate_id, actor, action, result, reason, error, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, candidateId, actor, action, result, reason ?? null, error ?? null, now());
    } catch {
      // Non-fatal — audit logging should never break the pipeline
    }
  }

  getLiveCandidateStats(): LiveCandidateStats {
    try {
      const rows = this.db
        .prepare(`SELECT status, count(*) as cnt FROM live_memory_candidates GROUP BY status`)
        .all() as Array<{ status: string; cnt: number }>;

      const stats: LiveCandidateStats = {
        pending: 0,
        promoted: 0,
        merged: 0,
        discarded: 0,
        expired: 0,
      };
      for (const row of rows) {
        if (row.status in stats) {
          stats[row.status as CandidateStatus] = row.cnt;
        }
      }
      return stats;
    } catch {
      return { pending: 0, promoted: 0, merged: 0, discarded: 0, expired: 0 };
    }
  }

  createPersonalSkillCandidate(
    input: CreatePersonalSkillCandidateInput,
  ): PersonalSkillCandidate | null {
    const id = uuid();
    const ts = now();
    try {
      this.db
        .prepare(
          `INSERT INTO personal_skill_candidates
             (id, agent_id, operator_id, profile_id, scope, title, summary, trigger_patterns,
              procedure_outline, preconditions, execution_steps, expected_outcomes, related_tools,
              source_memory_ids, source_episode_ids, source_task_ids, source_lesson_ids,
              supersedes_candidate_ids, superseded_by_candidate_id, conflicts_with_candidate_ids,
              contradiction_count, evidence_count, recurrence_count, confidence, strength, usage_count,
              success_count, failure_count, state, operator_notes, last_reviewed_at, last_used_at, last_reinforced_at,
              last_contradicted_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.agentId ?? "main",
          input.operatorId ?? null,
          input.profileId ?? null,
          input.scope ?? "operator",
          input.title,
          input.summary,
          JSON.stringify(input.triggerPatterns ?? []),
          input.procedureOutline ?? null,
          JSON.stringify(input.preconditions ?? []),
          JSON.stringify(input.executionSteps ?? []),
          JSON.stringify(input.expectedOutcomes ?? []),
          JSON.stringify(input.relatedTools ?? []),
          JSON.stringify(input.sourceMemoryIds ?? []),
          JSON.stringify(input.sourceEpisodeIds ?? []),
          JSON.stringify(input.sourceTaskIds ?? []),
          JSON.stringify(input.sourceLessonIds ?? []),
          JSON.stringify(input.supersedesCandidateIds ?? []),
          input.supersededByCandidateId ?? null,
          JSON.stringify(input.conflictsWithCandidateIds ?? []),
          input.contradictionCount ?? 0,
          input.evidenceCount ?? 0,
          input.recurrenceCount ?? 1,
          input.confidence ?? 0.5,
          input.strength ?? 0.5,
          input.usageCount ?? 0,
          input.successCount ?? 0,
          input.failureCount ?? 0,
          input.state ?? "candidate",
          input.operatorNotes ?? null,
          null,
          null,
          null,
          null,
          ts,
          ts,
        );
      return this.getPersonalSkillCandidate(id);
    } catch {
      return null;
    }
  }

  getPersonalSkillCandidate(id: string): PersonalSkillCandidate | null {
    const row = this.db.prepare(`SELECT * FROM personal_skill_candidates WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapPersonalSkillCandidate(row) : null;
  }

  listPersonalSkillCandidates(options?: {
    state?: PersonalSkillCandidateState;
    limit?: number;
  }): PersonalSkillCandidate[] {
    let sql = `SELECT * FROM personal_skill_candidates WHERE 1=1`;
    const params: unknown[] = [];

    if (options?.state) {
      sql += ` AND state = ?`;
      params.push(options.state);
    }

    sql += ` ORDER BY confidence DESC, updated_at DESC LIMIT ?`;
    params.push(options?.limit ?? 50);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(mapPersonalSkillCandidate);
  }

  updatePersonalSkillCandidate(
    id: string,
    fields: Partial<{
      scope: PersonalSkillCandidate["scope"];
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
  ): PersonalSkillCandidate | null {
    const existing = this.getPersonalSkillCandidate(id);
    if (!existing) return null;
    const next = {
      ...existing,
      ...fields,
      scope: fields.scope ?? existing.scope,
      triggerPatterns: fields.triggerPatterns ?? existing.triggerPatterns,
      preconditions: fields.preconditions ?? existing.preconditions,
      executionSteps: fields.executionSteps ?? existing.executionSteps,
      expectedOutcomes: fields.expectedOutcomes ?? existing.expectedOutcomes,
      relatedTools: fields.relatedTools ?? existing.relatedTools,
      sourceMemoryIds: fields.sourceMemoryIds ?? existing.sourceMemoryIds,
      sourceEpisodeIds: fields.sourceEpisodeIds ?? existing.sourceEpisodeIds,
      sourceTaskIds: fields.sourceTaskIds ?? existing.sourceTaskIds,
      sourceLessonIds: fields.sourceLessonIds ?? existing.sourceLessonIds,
      supersedesCandidateIds: fields.supersedesCandidateIds ?? existing.supersedesCandidateIds,
      supersededByCandidateId: fields.supersededByCandidateId ?? existing.supersededByCandidateId,
      conflictsWithCandidateIds:
        fields.conflictsWithCandidateIds ?? existing.conflictsWithCandidateIds,
      contradictionCount: fields.contradictionCount ?? existing.contradictionCount,
      strength: fields.strength ?? existing.strength,
      usageCount: fields.usageCount ?? existing.usageCount,
      successCount: fields.successCount ?? existing.successCount,
      failureCount: fields.failureCount ?? existing.failureCount,
      operatorNotes: fields.operatorNotes ?? existing.operatorNotes,
      lastReinforcedAt: fields.lastReinforcedAt ?? existing.lastReinforcedAt,
      lastContradictedAt: fields.lastContradictedAt ?? existing.lastContradictedAt,
      updatedAt: now(),
    };

    this.db
      .prepare(
        `UPDATE personal_skill_candidates SET
           scope = ?, title = ?, summary = ?, trigger_patterns = ?, procedure_outline = ?, preconditions = ?,
           execution_steps = ?, expected_outcomes = ?, related_tools = ?, source_memory_ids = ?,
           source_episode_ids = ?, source_task_ids = ?, source_lesson_ids = ?, supersedes_candidate_ids = ?,
           superseded_by_candidate_id = ?, conflicts_with_candidate_ids = ?, contradiction_count = ?,
           evidence_count = ?, recurrence_count = ?, confidence = ?, strength = ?, usage_count = ?,
           success_count = ?, failure_count = ?, state = ?, operator_notes = ?, last_reviewed_at = ?, last_used_at = ?,
           last_reinforced_at = ?, last_contradicted_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.scope,
        next.title,
        next.summary,
        JSON.stringify(next.triggerPatterns),
        next.procedureOutline,
        JSON.stringify(next.preconditions),
        JSON.stringify(next.executionSteps),
        JSON.stringify(next.expectedOutcomes),
        JSON.stringify(next.relatedTools),
        JSON.stringify(next.sourceMemoryIds),
        JSON.stringify(next.sourceEpisodeIds),
        JSON.stringify(next.sourceTaskIds),
        JSON.stringify(next.sourceLessonIds),
        JSON.stringify(next.supersedesCandidateIds),
        next.supersededByCandidateId,
        JSON.stringify(next.conflictsWithCandidateIds),
        next.contradictionCount,
        next.evidenceCount,
        next.recurrenceCount,
        next.confidence,
        next.strength,
        next.usageCount,
        next.successCount,
        next.failureCount,
        next.state,
        next.operatorNotes,
        next.lastReviewedAt,
        next.lastUsedAt,
        next.lastReinforcedAt,
        next.lastContradictedAt,
        next.updatedAt,
        id,
      );

    return this.getPersonalSkillCandidate(id);
  }

  deletePersonalSkillCandidate(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM personal_skill_candidates WHERE id = ?`)
      .run(id) as {
      changes?: number;
    };
    return Number(result?.changes ?? 0) > 0;
  }

  createPersonalSkillReviewEvent(
    input: CreatePersonalSkillReviewEventInput,
  ): PersonalSkillReviewEvent | null {
    const id = uuid();
    const ts = now();
    try {
      this.db
        .prepare(
          `INSERT INTO personal_skill_reviews
             (id, candidate_id, agent_id, actor_type, action, reason, details, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.candidateId,
          input.agentId ?? "main",
          input.actorType,
          input.action,
          input.reason ?? null,
          JSON.stringify(input.details ?? {}),
          ts,
        );
      const row = this.db.prepare(`SELECT * FROM personal_skill_reviews WHERE id = ?`).get(id) as
        | Record<string, unknown>
        | undefined;
      return row ? mapPersonalSkillReviewEvent(row) : null;
    } catch {
      return null;
    }
  }

  listPersonalSkillReviewEvents(options: {
    candidateId: string;
    limit?: number;
  }): PersonalSkillReviewEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM personal_skill_reviews
         WHERE candidate_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(options.candidateId, options.limit ?? 20) as Record<string, unknown>[];
    return rows.map(mapPersonalSkillReviewEvent);
  }
}

// ── Factory ──

let _store: MemuStore | null = null;
let _storePath: string | null = null;

/** Get or create the global MemuStore instance */
export function getMemuStore(dbPath?: string): MemuStore {
  const resolvedPath = dbPath ? resolveUserPath(dbPath) : resolveUserPath("~/.argentos/memory.db");

  if (_store && _storePath === resolvedPath) {
    return _store;
  }

  // Ensure directory exists
  const dir = path.dirname(resolvedPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = openDatabase(resolvedPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  _store = new MemuStore(db);
  _storePath = resolvedPath;
  return _store;
}

/** Close the global store — checkpoints WAL and closes the connection */
export function closeMemuStore(): void {
  if (_store) {
    closeDatabase(_store.db);
    _store = null;
    _storePath = null;
  }
}
