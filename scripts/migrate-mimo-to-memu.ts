#!/usr/bin/env node
/**
 * Migrate MIMO observations → MemU memory items.
 *
 * Reads from the existing MIMO SQLite DB (~/.openclaw-mem/memory.db)
 * and inserts structured memory items into MemU (~/.argentos/memory.db).
 *
 * Usage:
 *   node scripts/migrate-mimo-to-memu.ts [--dry-run] [--min-length 30] [--min-importance 0]
 */

// @ts-nocheck — standalone script
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ── Config ──

const HOME = process.env.HOME || "/Users/sem";
const MIMO_DB_PATH = path.join(HOME, ".openclaw-mem/memory.db");
const MEMU_DB_PATH = path.join(HOME, ".argentos/memory.db");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MIN_LENGTH = parseInt(args.find((_, i, a) => a[i - 1] === "--min-length") || "30", 10);
const MIN_IMPORTANCE = parseFloat(args.find((_, i, a) => a[i - 1] === "--min-importance") || "0");

// ── Type Mapping ──

const MIMO_TO_MEMU_TYPE: Record<string, string> = {
  preference: "profile",
  bugfix: "knowledge",
  observation: "event",
  decision: "behavior",
  architecture: "knowledge",
  code_change: "event",
  test: "knowledge",
};

// Categories to auto-assign based on MIMO type
const MIMO_TYPE_CATEGORIES: Record<string, string[]> = {
  preference: ["User Preferences", "Profile"],
  bugfix: ["Bug Fixes", "Development"],
  observation: ["Observations", "Activity"],
  decision: ["Decisions"],
  architecture: ["Architecture", "Development"],
  code_change: ["Code Changes", "Development"],
  test: ["Testing", "Development"],
};

// ── Helpers ──

function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
}

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

/** Clean up MIMO summaries — strip markdown noise, message IDs, very short lines */
function cleanSummary(raw: string): string | null {
  if (!raw) return null;

  let text = raw
    // Strip [message_id: ...] lines
    .replace(/\[message_id:[^\]]+\]/g, "")
    // Strip emoji-heavy greetings that aren't informational
    .replace(/^(?:Morning|Hey|Hi|Hello|Good morning|Good evening)[^.!?\n]*[.!?\n]/i, "")
    .trim();

  // Skip if too short after cleaning
  if (text.length < MIN_LENGTH) return null;

  // Truncate very long entries to first meaningful chunk (500 chars)
  if (text.length > 500) {
    // Try to cut at sentence boundary
    const cutPoint = text.lastIndexOf(".", 500);
    text = cutPoint > 100 ? text.slice(0, cutPoint + 1) : text.slice(0, 500) + "...";
  }

  return text;
}

// ── MemU Schema (inline for standalone script) ──

const MEMU_SCHEMA = `
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  modality TEXT NOT NULL DEFAULT 'text',
  local_path TEXT,
  caption TEXT,
  embedding BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resources_url ON resources(url);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  resource_id TEXT,
  memory_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  embedding BLOB,
  happened_at TEXT,
  content_hash TEXT,
  reinforcement_count INTEGER NOT NULL DEFAULT 1,
  last_reinforced_at TEXT,
  extra TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (resource_id) REFERENCES resources(id)
);
CREATE INDEX IF NOT EXISTS idx_items_type ON memory_items(memory_type);
CREATE INDEX IF NOT EXISTS idx_items_hash ON memory_items(content_hash);
CREATE INDEX IF NOT EXISTS idx_items_created ON memory_items(created_at);
CREATE INDEX IF NOT EXISTS idx_items_reinforced ON memory_items(last_reinforced_at);

CREATE TABLE IF NOT EXISTS memory_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  embedding BLOB,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS category_items (
  item_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  PRIMARY KEY (item_id, category_id),
  FOREIGN KEY (item_id) REFERENCES memory_items(id),
  FOREIGN KEY (category_id) REFERENCES memory_categories(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(
  summary,
  content=memory_items,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_categories_fts USING fts5(
  name,
  summary,
  content=memory_categories,
  content_rowid=rowid,
  tokenize='porter unicode61'
);
`;

// FTS triggers (can't use IF NOT EXISTS, so we wrap in try/catch)
const FTS_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS items_fts_ai AFTER INSERT ON memory_items BEGIN
  INSERT INTO memory_items_fts(rowid, summary)
  SELECT rowid, NEW.summary FROM memory_items WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS items_fts_ad AFTER DELETE ON memory_items BEGIN
  INSERT INTO memory_items_fts(memory_items_fts, rowid, summary)
  SELECT 'delete', rowid, OLD.summary FROM memory_items WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cats_fts_ai AFTER INSERT ON memory_categories BEGIN
  INSERT INTO memory_categories_fts(rowid, name, summary)
  SELECT rowid, NEW.name, NEW.summary FROM memory_categories WHERE id = NEW.id;
END;
`;

// ── Main ──

async function main() {
  console.log("=== MIMO → MemU Migration ===");
  console.log(`MIMO DB: ${MIMO_DB_PATH}`);
  console.log(`MemU DB: ${MEMU_DB_PATH}`);
  console.log(`Min length: ${MIN_LENGTH}, Min importance: ${MIN_IMPORTANCE}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log();

  // Open MIMO DB (read-only)
  if (!fs.existsSync(MIMO_DB_PATH)) {
    console.error("ERROR: MIMO database not found at", MIMO_DB_PATH);
    process.exit(1);
  }
  const mimo = new Database(MIMO_DB_PATH, { readonly: true });

  // Count total
  const totalRow = mimo.query("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number };
  console.log(`Total MIMO observations: ${totalRow.cnt}`);

  // Read all observations with summaries
  const observations = mimo
    .query(
      `SELECT id, type, summary, importance, created_at, metadata
       FROM observations
       WHERE summary IS NOT NULL AND length(summary) >= ?
       AND importance >= ?
       ORDER BY id ASC`,
    )
    .all(MIN_LENGTH, MIN_IMPORTANCE) as Array<{
    id: number;
    type: string;
    summary: string;
    importance: number;
    created_at: string;
    metadata: string | null;
  }>;

  console.log(
    `Observations with summaries (len >= ${MIN_LENGTH}, importance >= ${MIN_IMPORTANCE}): ${observations.length}`,
  );

  // Clean and filter
  const items: Array<{
    mimoId: number;
    mimoType: string;
    memuType: string;
    summary: string;
    hash: string;
    importance: number;
    createdAt: string;
    categories: string[];
  }> = [];

  const seenHashes = new Set<string>();

  for (const obs of observations) {
    const cleaned = cleanSummary(obs.summary);
    if (!cleaned) continue;

    const hash = contentHash(cleaned);
    if (seenHashes.has(hash)) continue; // dedup within migration
    seenHashes.add(hash);

    const memuType = MIMO_TO_MEMU_TYPE[obs.type] || "knowledge";
    const categories = MIMO_TYPE_CATEGORIES[obs.type] || ["Uncategorized"];

    items.push({
      mimoId: obs.id,
      mimoType: obs.type,
      memuType,
      summary: cleaned,
      hash,
      importance: obs.importance,
      createdAt: obs.created_at,
      categories,
    });
  }

  console.log(`After cleaning & dedup: ${items.length} items to migrate`);
  console.log();

  // Type breakdown
  const typeCounts: Record<string, number> = {};
  for (const item of items) {
    typeCounts[item.memuType] = (typeCounts[item.memuType] || 0) + 1;
  }
  console.log("Type distribution:");
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }
  console.log();

  if (DRY_RUN) {
    console.log("[DRY RUN] Would migrate these items. Sample:");
    for (const item of items.slice(0, 5)) {
      console.log(
        `  #${item.mimoId} [${item.mimoType}→${item.memuType}] ${item.summary.slice(0, 80)}...`,
      );
    }
    console.log(`\nRun without --dry-run to execute migration.`);
    mimo.close();
    return;
  }

  // Open/create MemU DB
  fs.mkdirSync(path.dirname(MEMU_DB_PATH), { recursive: true });
  const memu = new Database(MEMU_DB_PATH);
  memu.exec("PRAGMA journal_mode = WAL;");
  memu.exec("PRAGMA foreign_keys = ON;");

  // Create schema
  memu.exec(MEMU_SCHEMA);
  try {
    memu.exec(FTS_TRIGGERS);
  } catch {
    // Triggers may already exist
  }

  // Create a migration resource
  const resourceId = uuid();
  const migrationTs = now();
  memu
    .query(
      `INSERT INTO resources (id, url, modality, caption, created_at, updated_at)
       VALUES (?, ?, 'text', ?, ?, ?)`,
    )
    .run(
      resourceId,
      "mimo:migration",
      `Migrated from MIMO (${items.length} items)`,
      migrationTs,
      migrationTs,
    );

  // Prepare category cache
  const categoryCache = new Map<string, string>(); // name → id

  function getOrCreateCategory(name: string): string {
    if (categoryCache.has(name)) return categoryCache.get(name)!;

    const existing = memu.query("SELECT id FROM memory_categories WHERE name = ?").get(name) as {
      id: string;
    } | null;

    if (existing) {
      categoryCache.set(name, existing.id);
      return existing.id;
    }

    const catId = uuid();
    memu
      .query(
        `INSERT INTO memory_categories (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(catId, name, `Auto-created during MIMO migration`, migrationTs, migrationTs);

    // FTS insert
    const catRowid = memu.query("SELECT rowid FROM memory_categories WHERE id = ?").get(catId) as {
      rowid: number;
    } | null;
    if (catRowid) {
      memu
        .query("INSERT INTO memory_categories_fts(rowid, name, summary) VALUES (?, ?, ?)")
        .run(catRowid.rowid, name, null);
    }

    categoryCache.set(name, catId);
    return catId;
  }

  // Check for existing migrated items (in case we re-run)
  const existingHashes = new Set<string>();
  const existingRows = memu
    .query("SELECT content_hash FROM memory_items WHERE content_hash IS NOT NULL")
    .all() as Array<{ content_hash: string }>;
  for (const row of existingRows) {
    existingHashes.add(row.content_hash);
  }
  console.log(`Existing MemU items: ${existingRows.length}`);

  // Insert items
  let inserted = 0;
  let skipped = 0;

  const insertItem = memu.query(
    `INSERT INTO memory_items (id, resource_id, memory_type, summary, happened_at, content_hash, reinforcement_count, last_reinforced_at, extra, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertCatItem = memu.query(
    `INSERT OR IGNORE INTO category_items (item_id, category_id) VALUES (?, ?)`,
  );

  const insertFts = memu.query(
    `INSERT INTO memory_items_fts(rowid, summary)
     SELECT rowid, ? FROM memory_items WHERE id = ?`,
  );

  // Use a transaction for speed
  memu.exec("BEGIN");
  try {
    for (const item of items) {
      if (existingHashes.has(item.hash)) {
        skipped++;
        continue;
      }

      const itemId = uuid();
      const reinforcement = Math.max(1, Math.round(item.importance)); // Map importance 0-5 → reinforcement count
      const extra = JSON.stringify({ mimoId: item.mimoId, mimoType: item.mimoType });

      insertItem.run(
        itemId,
        resourceId,
        item.memuType,
        item.summary,
        item.createdAt,
        item.hash,
        reinforcement,
        item.createdAt,
        extra,
        item.createdAt,
        migrationTs,
      );

      // FTS
      insertFts.run(item.summary, itemId);

      // Link to categories
      for (const catName of item.categories) {
        const catId = getOrCreateCategory(catName);
        insertCatItem.run(itemId, catId);
      }

      inserted++;
    }
    memu.exec("COMMIT");
  } catch (err) {
    memu.exec("ROLLBACK");
    throw err;
  }

  // Final stats
  const finalCount = memu.query("SELECT COUNT(*) as cnt FROM memory_items").get() as {
    cnt: number;
  };
  const catCount = memu.query("SELECT COUNT(*) as cnt FROM memory_categories").get() as {
    cnt: number;
  };

  console.log();
  console.log("=== Migration Complete ===");
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Total MemU items: ${finalCount.cnt}`);
  console.log(`  Categories created: ${catCount.cnt}`);
  console.log(`  DB path: ${MEMU_DB_PATH}`);

  mimo.close();
  memu.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
