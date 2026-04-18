/**
 * MemU SQLite Schema
 *
 * Creates the three-layer memory hierarchy tables:
 * - resources (raw inputs)
 * - memory_items (extracted facts with emotional context)
 * - memory_categories (organized topics)
 * - category_items (junction)
 * - entities (people, pets, places, orgs, projects)
 * - item_entities (junction linking items to entities)
 * - reflections (structured introspection entries)
 *
 * Includes FTS5 for keyword search and triggers for sync.
 *
 * Schema versions:
 * - v1: Original three-layer hierarchy
 * - v2: Identity system — emotional fields, entities, reflections
 */

import crypto from "node:crypto";
import type { DatabaseSync } from "./sqlite.js";

const SCHEMA_VERSION = 11;

/** Create all MemU tables, indexes, FTS5, and triggers. */
export function ensureMemuSchema(db: DatabaseSync): { ftsAvailable: boolean } {
  // ── Meta table for schema versioning ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS memu_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const versionRow = db.prepare(`SELECT value FROM memu_meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;

  const currentVersion = versionRow ? parseInt(versionRow.value, 10) : 0;

  if (currentVersion >= SCHEMA_VERSION) {
    // Check FTS availability
    try {
      db.prepare(`SELECT count(*) FROM memory_items_fts LIMIT 0`).get();
      return { ftsAvailable: true };
    } catch {
      return { ftsAvailable: false };
    }
  }

  // ── Fresh install or v0 → create all v1 tables ──
  if (currentVersion < 1) {
    createV1Schema(db);
  }

  // ── v1 → v2 migration: identity system ──
  if (currentVersion < 2) {
    migrateV1ToV2(db);
  }

  // ── v2 → v3 migration: lessons (SIS) ──
  if (currentVersion < 3) {
    migrateV2ToV3(db);
  }

  // ── v3 → v4 migration: model feedback ──
  if (currentVersion < 4) {
    migrateV3ToV4(db);
  }

  // ── v4 → v5 migration: self-eval columns on model_feedback ──
  if (currentVersion < 5) {
    migrateV4ToV5(db);
  }

  // ── v5 → v6 migration: live memory inbox ──
  if (currentVersion < 6) {
    migrateV5ToV6(db);
  }

  // ── v6 → v7 migration: personal skill candidates ──
  if (currentVersion < 7) {
    migrateV6ToV7(db);
  }

  // ── v7 → v8 migration: personal skill schema + lineage ──
  if (currentVersion < 8) {
    migrateV7ToV8(db);
  }

  // ── v8 → v9 migration: personal skill lifecycle ──
  if (currentVersion < 9) {
    migrateV8ToV9(db);
  }
  if (currentVersion < 10) {
    migrateV9ToV10(db);
  }
  if (currentVersion < 11) {
    migrateV10ToV11(db);
  }

  // ── FTS5 ──
  const ftsAvailable = ensureFts(db);

  // ── Update schema version ──
  db.prepare(`INSERT OR REPLACE INTO memu_meta (key, value) VALUES ('schema_version', ?)`).run(
    String(SCHEMA_VERSION),
  );

  return { ftsAvailable };
}

// ── V1 Schema (original tables) ──

function createV1Schema(db: DatabaseSync): void {
  // ── Resources ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL DEFAULT '',
      modality TEXT NOT NULL DEFAULT 'text',
      local_path TEXT,
      caption TEXT,
      embedding BLOB,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_resources_url ON resources(url);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_resources_created ON resources(created_at);`);

  // ── Memory Items ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
      memory_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      embedding BLOB,
      happened_at TEXT,
      content_hash TEXT,
      reinforcement_count INTEGER NOT NULL DEFAULT 1,
      last_reinforced_at TEXT,
      extra TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_items_resource ON memory_items(resource_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_items_type ON memory_items(memory_type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_items_hash ON memory_items(content_hash);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_items_created ON memory_items(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_items_reinforced ON memory_items(last_reinforced_at);`);

  // ── Memory Categories ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      embedding BLOB,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_categories_name ON memory_categories(name);`);

  // ── Category-Item Junction ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS category_items (
      item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES memory_categories(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, category_id)
    );
  `);
}

// ── V1 → V2 Migration: Identity System ──

function migrateV1ToV2(db: DatabaseSync): void {
  // Add emotional + identity columns to memory_items
  // SQLite ALTER TABLE ADD COLUMN requires DEFAULT for NOT NULL columns.
  const newColumns = [
    `ALTER TABLE memory_items ADD COLUMN emotional_valence REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE memory_items ADD COLUMN emotional_arousal REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE memory_items ADD COLUMN mood_at_capture TEXT DEFAULT NULL`,
    `ALTER TABLE memory_items ADD COLUMN significance TEXT NOT NULL DEFAULT 'routine'`,
    `ALTER TABLE memory_items ADD COLUMN reflection TEXT DEFAULT NULL`,
    `ALTER TABLE memory_items ADD COLUMN lesson TEXT DEFAULT NULL`,
  ];

  for (const sql of newColumns) {
    try {
      db.exec(sql);
    } catch {
      // Column may already exist if migration was partially applied
    }
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_items_significance ON memory_items(significance);`);

  // ── Entities table ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'person',
      relationship TEXT,
      bond_strength REAL NOT NULL DEFAULT 0.5,
      emotional_texture TEXT,
      profile_summary TEXT,
      first_mentioned_at TEXT,
      last_mentioned_at TEXT,
      memory_count INTEGER NOT NULL DEFAULT 0,
      embedding BLOB,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name ON entities(name);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_bond ON entities(bond_strength);`);

  // ── Item-Entity Junction ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_entities (
      item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'mentioned',
      PRIMARY KEY (item_id, entity_id)
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_item_entities_entity ON item_entities(entity_id);`);

  // ── Reflections table ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS reflections (
      id TEXT PRIMARY KEY,
      trigger_type TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      content TEXT NOT NULL,
      lessons_extracted TEXT DEFAULT '[]',
      entities_involved TEXT DEFAULT '[]',
      self_insights TEXT DEFAULT '[]',
      mood TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_reflections_trigger ON reflections(trigger_type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reflections_created ON reflections(created_at);`);

  // Rebuild FTS5 to include reflection and lesson columns
  // Drop ALL existing FTS triggers (both old-style and new-style names) and FTS table
  try {
    db.exec(`DROP TRIGGER IF EXISTS memu_items_ai;`);
    db.exec(`DROP TRIGGER IF EXISTS memu_items_ad;`);
    db.exec(`DROP TRIGGER IF EXISTS memu_items_au;`);
    // Old-style trigger names from v1 installations
    db.exec(`DROP TRIGGER IF EXISTS items_fts_ai;`);
    db.exec(`DROP TRIGGER IF EXISTS items_fts_ad;`);
    db.exec(`DROP TABLE IF EXISTS memory_items_fts;`);
  } catch {
    // FTS might not exist yet
  }
}

// ── V2 → V3 Migration: Lessons (SIS) ──

function migrateV2ToV3(db: DatabaseSync): void {
  // ── Lessons table ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      context TEXT NOT NULL,
      action TEXT NOT NULL,
      outcome TEXT NOT NULL,
      lesson TEXT NOT NULL,
      correction TEXT,
      confidence REAL NOT NULL DEFAULT 0.5,
      occurrences INTEGER NOT NULL DEFAULT 1,
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      tags TEXT NOT NULL DEFAULT '[]',
      related_tools TEXT NOT NULL DEFAULT '[]',
      source_episode_ids TEXT NOT NULL DEFAULT '[]',
      embedding BLOB,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_lessons_type ON lessons(type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lessons_confidence ON lessons(confidence);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lessons_created ON lessons(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lessons_last_seen ON lessons(last_seen);`);

  // Backfill lessons from existing reflections and memory_items
  backfillLessonsFromReflections(db);
}

/** Backfill lessons from existing reflections.lessonsExtracted and memory_items.lesson */
function backfillLessonsFromReflections(db: DatabaseSync): void {
  const now = new Date().toISOString();

  // 1. Scan reflections where lessonsExtracted is not empty
  const reflections = db
    .prepare(
      `SELECT id, lessons_extracted, content FROM reflections WHERE lessons_extracted != '[]'`,
    )
    .all() as Array<{ id: string; lessons_extracted: string; content: string }>;

  for (const row of reflections) {
    let lessons: string[];
    try {
      lessons = JSON.parse(row.lessons_extracted);
    } catch {
      continue;
    }
    if (!Array.isArray(lessons) || lessons.length === 0) continue;

    for (const lessonText of lessons) {
      if (typeof lessonText !== "string" || !lessonText.trim()) continue;
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO lessons (id, type, context, action, outcome, lesson, confidence, occurrences, last_seen, source_episode_ids, created_at, updated_at)
         VALUES (?, 'discovery', 'backfill from reflection', 'reflection', ?, ?, 0.6, 1, ?, ?, ?, ?)`,
      ).run(id, lessonText.trim(), lessonText.trim(), now, JSON.stringify([row.id]), now, now);
    }
  }

  // 2. Scan memory_items where lesson IS NOT NULL
  const items = db
    .prepare(
      `SELECT id, lesson, summary FROM memory_items WHERE lesson IS NOT NULL AND lesson != ''`,
    )
    .all() as Array<{ id: string; lesson: string; summary: string }>;

  for (const row of items) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO lessons (id, type, context, action, outcome, lesson, confidence, occurrences, last_seen, source_episode_ids, created_at, updated_at)
       VALUES (?, 'discovery', 'backfill from memory item', ?, ?, ?, 0.6, 1, ?, ?, ?, ?)`,
    ).run(id, row.summary, row.summary, row.lesson, now, JSON.stringify([row.id]), now, now);
  }
}

// ── V3 → V4 Migration: Model Feedback ──

function migrateV3ToV4(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_feedback (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      tier TEXT NOT NULL,
      session_type TEXT NOT NULL,
      complexity_score REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      error_type TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      user_feedback TEXT,
      session_key TEXT,
      profile TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_provider_model ON model_feedback(provider, model);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_tier ON model_feedback(tier);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_session_type ON model_feedback(session_type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_created ON model_feedback(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_success ON model_feedback(success);`);
}

function migrateV4ToV5(db: DatabaseSync): void {
  // Add self-evaluation columns to model_feedback
  const cols = db.prepare(`PRAGMA table_info(model_feedback)`).all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("self_eval_score")) {
    db.exec(`ALTER TABLE model_feedback ADD COLUMN self_eval_score REAL`);
  }
  if (!colNames.has("self_eval_reasoning")) {
    db.exec(`ALTER TABLE model_feedback ADD COLUMN self_eval_reasoning TEXT`);
  }
}

// ── V5 → V6 Migration: Live Memory Inbox ──

function migrateV5ToV6(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_memory_candidates (
      id TEXT PRIMARY KEY,
      session_key TEXT,
      message_id TEXT,
      role TEXT NOT NULL,
      candidate_type TEXT NOT NULL,
      fact_text TEXT NOT NULL,
      fact_hash TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      trigger_flags TEXT NOT NULL DEFAULT '[]',
      entities TEXT NOT NULL DEFAULT '[]',
      memory_type_hint TEXT,
      significance_hint TEXT,
      source_ts TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      promoted_item_id TEXT,
      promotion_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_live_candidates_status_expires ON live_memory_candidates(status, expires_at);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_live_candidates_session ON live_memory_candidates(session_key, created_at DESC);`,
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_live_candidates_dedupe ON live_memory_candidates(fact_hash, role, session_key);`,
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_promotion_events (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      result TEXT NOT NULL,
      reason TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function migrateV6ToV7(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_skill_candidates (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'main',
      operator_id TEXT,
      profile_id TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      trigger_patterns TEXT NOT NULL DEFAULT '[]',
      procedure_outline TEXT,
      related_tools TEXT NOT NULL DEFAULT '[]',
      source_memory_ids TEXT NOT NULL DEFAULT '[]',
      source_episode_ids TEXT NOT NULL DEFAULT '[]',
      source_task_ids TEXT NOT NULL DEFAULT '[]',
      source_lesson_ids TEXT NOT NULL DEFAULT '[]',
      evidence_count INTEGER NOT NULL DEFAULT 0,
      recurrence_count INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 0.5,
      state TEXT NOT NULL DEFAULT 'candidate',
      last_reviewed_at TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_personal_skill_candidates_agent ON personal_skill_candidates(agent_id);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_personal_skill_candidates_state ON personal_skill_candidates(state);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_personal_skill_candidates_confidence ON personal_skill_candidates(confidence);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_personal_skill_candidates_updated ON personal_skill_candidates(updated_at);`,
  );
}

function migrateV7ToV8(db: DatabaseSync): void {
  const alterStatements = [
    `ALTER TABLE personal_skill_candidates ADD COLUMN scope TEXT NOT NULL DEFAULT 'operator'`,
    `ALTER TABLE personal_skill_candidates ADD COLUMN preconditions TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE personal_skill_candidates ADD COLUMN execution_steps TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE personal_skill_candidates ADD COLUMN expected_outcomes TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE personal_skill_candidates ADD COLUMN supersedes_candidate_ids TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE personal_skill_candidates ADD COLUMN superseded_by_candidate_id TEXT`,
  ];

  for (const sql of alterStatements) {
    try {
      db.exec(sql);
    } catch {
      // Column may already exist if migration was partially applied
    }
  }

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_personal_skill_candidates_scope ON personal_skill_candidates(scope);`,
  );
}

function migrateV8ToV9(db: DatabaseSync): void {
  const alterStatements = [
    `ALTER TABLE personal_skill_candidates ADD COLUMN conflicts_with_candidate_ids TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE personal_skill_candidates ADD COLUMN contradiction_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE personal_skill_candidates ADD COLUMN strength REAL NOT NULL DEFAULT 0.5`,
    `ALTER TABLE personal_skill_candidates ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE personal_skill_candidates ADD COLUMN success_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE personal_skill_candidates ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE personal_skill_candidates ADD COLUMN last_reinforced_at TEXT`,
    `ALTER TABLE personal_skill_candidates ADD COLUMN last_contradicted_at TEXT`,
  ];

  for (const sql of alterStatements) {
    try {
      db.exec(sql);
    } catch {
      // Column may already exist if migration was partially applied
    }
  }
}

function migrateV9ToV10(db: DatabaseSync): void {
  const alterStatements = [`ALTER TABLE personal_skill_candidates ADD COLUMN operator_notes TEXT`];

  for (const sql of alterStatements) {
    try {
      db.exec(sql);
    } catch {
      // Column may already exist if migration was partially applied
    }
  }
}

function migrateV10ToV11(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_skill_reviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'main',
      actor_type TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_personal_skill_reviews_candidate ON personal_skill_reviews(candidate_id, created_at DESC);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_personal_skill_reviews_agent ON personal_skill_reviews(agent_id, created_at DESC);`,
  );
}

// ── FTS5 Setup (shared by v1, v2, and v3) ──

function ensureFts(db: DatabaseSync): boolean {
  try {
    // Items FTS — now includes reflection and lesson for richer keyword search
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(
        summary,
        reflection,
        lesson,
        content='memory_items',
        content_rowid='rowid',
        tokenize='porter unicode61'
      );
    `);

    // Triggers to keep FTS in sync
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memu_items_ai AFTER INSERT ON memory_items BEGIN
        INSERT INTO memory_items_fts(rowid, summary, reflection, lesson)
          VALUES (new.rowid, new.summary, new.reflection, new.lesson);
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memu_items_ad AFTER DELETE ON memory_items BEGIN
        INSERT INTO memory_items_fts(memory_items_fts, rowid, summary, reflection, lesson)
          VALUES('delete', old.rowid, old.summary, old.reflection, old.lesson);
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memu_items_au AFTER UPDATE ON memory_items BEGIN
        INSERT INTO memory_items_fts(memory_items_fts, rowid, summary, reflection, lesson)
          VALUES('delete', old.rowid, old.summary, old.reflection, old.lesson);
        INSERT INTO memory_items_fts(rowid, summary, reflection, lesson)
          VALUES (new.rowid, new.summary, new.reflection, new.lesson);
      END;
    `);

    // Reindex FTS from existing data (handles migration case where items exist)
    const count = db.prepare(`SELECT count(*) as cnt FROM memory_items`).get() as { cnt: number };
    const ftsCount = db.prepare(`SELECT count(*) as cnt FROM memory_items_fts`).get() as {
      cnt: number;
    };
    if (count.cnt > 0 && ftsCount.cnt === 0) {
      db.exec(`
        INSERT INTO memory_items_fts(rowid, summary, reflection, lesson)
          SELECT rowid, summary, reflection, lesson FROM memory_items;
      `);
    }

    // Categories FTS (unchanged from v1)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_categories_fts USING fts5(
        name,
        description,
        summary,
        content='memory_categories',
        content_rowid='rowid',
        tokenize='porter unicode61'
      );
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memu_cats_ai AFTER INSERT ON memory_categories BEGIN
        INSERT INTO memory_categories_fts(rowid, name, description, summary)
          VALUES (new.rowid, new.name, new.description, new.summary);
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memu_cats_ad AFTER DELETE ON memory_categories BEGIN
        INSERT INTO memory_categories_fts(memory_categories_fts, rowid, name, description, summary)
          VALUES('delete', old.rowid, old.name, old.description, old.summary);
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memu_cats_au AFTER UPDATE ON memory_categories BEGIN
        INSERT INTO memory_categories_fts(memory_categories_fts, rowid, name, description, summary)
          VALUES('delete', old.rowid, old.name, old.description, old.summary);
        INSERT INTO memory_categories_fts(rowid, name, description, summary)
          VALUES (new.rowid, new.name, new.description, new.summary);
      END;
    `);

    // Lessons FTS (v3)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS lessons_fts USING fts5(
        context,
        action,
        outcome,
        lesson,
        correction,
        tags,
        content='lessons',
        content_rowid='rowid',
        tokenize='porter unicode61'
      );
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memu_lessons_ai AFTER INSERT ON lessons BEGIN
        INSERT INTO lessons_fts(rowid, context, action, outcome, lesson, correction, tags)
          VALUES (new.rowid, new.context, new.action, new.outcome, new.lesson, new.correction, new.tags);
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memu_lessons_ad AFTER DELETE ON lessons BEGIN
        INSERT INTO lessons_fts(lessons_fts, rowid, context, action, outcome, lesson, correction, tags)
          VALUES('delete', old.rowid, old.context, old.action, old.outcome, old.lesson, old.correction, old.tags);
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memu_lessons_au AFTER UPDATE ON lessons BEGIN
        INSERT INTO lessons_fts(lessons_fts, rowid, context, action, outcome, lesson, correction, tags)
          VALUES('delete', old.rowid, old.context, old.action, old.outcome, old.lesson, old.correction, old.tags);
        INSERT INTO lessons_fts(rowid, context, action, outcome, lesson, correction, tags)
          VALUES (new.rowid, new.context, new.action, new.outcome, new.lesson, new.correction, new.tags);
      END;
    `);

    // Reindex lessons FTS from existing data (handles backfill case)
    const lessonsCount = db.prepare(`SELECT count(*) as cnt FROM lessons`).get() as { cnt: number };
    const lessonsFtsCount = db.prepare(`SELECT count(*) as cnt FROM lessons_fts`).get() as {
      cnt: number;
    };
    if (lessonsCount.cnt > 0 && lessonsFtsCount.cnt === 0) {
      db.exec(`
        INSERT INTO lessons_fts(rowid, context, action, outcome, lesson, correction, tags)
          SELECT rowid, context, action, outcome, lesson, correction, tags FROM lessons;
      `);
    }

    return true;
  } catch {
    // FTS5 not available — keyword search will fall back to LIKE
    return false;
  }
}
