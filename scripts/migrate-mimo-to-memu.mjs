#!/usr/bin/env node
/**
 * Migrate MIMO observations → MemU memory items.
 *
 * Usage:
 *   node scripts/migrate-mimo-to-memu.mjs [--dry-run] [--min-length 30] [--min-importance 0]
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const HOME = process.env.HOME || "/Users/sem";
const MIMO_DB_PATH = path.join(HOME, ".openclaw-mem/memory.db");
const MEMU_DB_PATH = path.join(HOME, ".argentos/memory.db");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const mlIdx = args.indexOf("--min-length");
const miIdx = args.indexOf("--min-importance");
const MIN_LENGTH = mlIdx >= 0 ? parseInt(args[mlIdx + 1], 10) : 30;
const MIN_IMPORTANCE = miIdx >= 0 ? parseFloat(args[miIdx + 1]) : 0;

const MIMO_TO_MEMU_TYPE = {
  preference: "profile",
  bugfix: "knowledge",
  observation: "event",
  decision: "behavior",
  architecture: "knowledge",
  code_change: "event",
  test: "knowledge",
};

const MIMO_TYPE_CATEGORIES = {
  preference: ["User Preferences", "Profile"],
  bugfix: ["Bug Fixes", "Development"],
  observation: ["Observations", "Activity"],
  decision: ["Decisions"],
  architecture: ["Architecture", "Development"],
  code_change: ["Code Changes", "Development"],
  test: ["Testing", "Development"],
};

function contentHash(text) {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
}

function uuid() {
  return crypto.randomUUID();
}
function now() {
  return new Date().toISOString();
}

function cleanSummary(raw) {
  if (!raw) return null;
  let text = raw
    .replace(/\[message_id:[^\]]+\]/g, "")
    .replace(/^(?:Morning|Hey|Hi|Hello|Good morning|Good evening)[^.!?\n]*[.!?\n]/i, "")
    .trim();
  if (text.length < MIN_LENGTH) return null;
  if (text.length > 500) {
    const cut = text.lastIndexOf(".", 500);
    text = cut > 100 ? text.slice(0, cut + 1) : text.slice(0, 500) + "...";
  }
  return text;
}

const MEMU_SCHEMA = `
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY, url TEXT NOT NULL, modality TEXT NOT NULL DEFAULT 'text',
  local_path TEXT, caption TEXT, embedding BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resources_url ON resources(url);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY, resource_id TEXT, memory_type TEXT NOT NULL, summary TEXT NOT NULL,
  embedding BLOB, happened_at TEXT, content_hash TEXT,
  reinforcement_count INTEGER NOT NULL DEFAULT 1, last_reinforced_at TEXT,
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
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
  embedding BLOB, summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS category_items (
  item_id TEXT NOT NULL, category_id TEXT NOT NULL,
  PRIMARY KEY (item_id, category_id),
  FOREIGN KEY (item_id) REFERENCES memory_items(id),
  FOREIGN KEY (category_id) REFERENCES memory_categories(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(
  summary, content=memory_items, content_rowid=rowid, tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_categories_fts USING fts5(
  name, summary, content=memory_categories, content_rowid=rowid, tokenize='porter unicode61'
);
`;

function main() {
  console.log("=== MIMO → MemU Migration ===");
  console.log(`MIMO: ${MIMO_DB_PATH}`);
  console.log(`MemU: ${MEMU_DB_PATH}`);
  console.log(
    `Min length: ${MIN_LENGTH}, Min importance: ${MIN_IMPORTANCE}, Dry run: ${DRY_RUN}\n`,
  );

  if (!fs.existsSync(MIMO_DB_PATH)) {
    console.error("ERROR: MIMO database not found");
    process.exit(1);
  }

  const mimo = new DatabaseSync(MIMO_DB_PATH, { open: true, readOnly: true });

  const totalRow = mimo.prepare("SELECT COUNT(*) as cnt FROM observations").get();
  console.log(`Total MIMO observations: ${totalRow.cnt}`);

  const stmt = mimo.prepare(
    `SELECT id, type, summary, importance, created_at FROM observations
     WHERE summary IS NOT NULL AND length(summary) >= ? AND importance >= ?
     ORDER BY id ASC`,
  );
  const observations = stmt.all(MIN_LENGTH, MIN_IMPORTANCE);
  console.log(`With summaries: ${observations.length}`);

  const items = [];
  const seenHashes = new Set();

  for (const obs of observations) {
    const cleaned = cleanSummary(obs.summary);
    if (!cleaned) continue;
    const hash = contentHash(cleaned);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    items.push({
      mimoId: obs.id,
      mimoType: obs.type,
      memuType: MIMO_TO_MEMU_TYPE[obs.type] || "knowledge",
      summary: cleaned,
      hash,
      importance: obs.importance,
      createdAt: obs.created_at,
      categories: MIMO_TYPE_CATEGORIES[obs.type] || ["Uncategorized"],
    });
  }

  console.log(`After cleaning & dedup: ${items.length} items\n`);

  const typeCounts = {};
  for (const item of items) typeCounts[item.memuType] = (typeCounts[item.memuType] || 0) + 1;
  console.log("Type distribution:");
  for (const [t, c] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1]))
    console.log(`  ${t}: ${c}`);
  console.log();

  if (DRY_RUN) {
    console.log("[DRY RUN] Sample:");
    for (const item of items.slice(0, 10))
      console.log(
        `  #${item.mimoId} [${item.mimoType}→${item.memuType}] ${item.summary.slice(0, 80)}`,
      );
    console.log(`\nRun without --dry-run to execute.`);
    mimo.close();
    return;
  }

  // Create MemU DB
  fs.mkdirSync(path.dirname(MEMU_DB_PATH), { recursive: true });
  const memu = new DatabaseSync(MEMU_DB_PATH);
  memu.exec("PRAGMA journal_mode = WAL;");
  memu.exec("PRAGMA foreign_keys = ON;");
  memu.exec(MEMU_SCHEMA);

  // Migration resource
  const resourceId = uuid();
  const ts = now();
  memu
    .prepare(
      `INSERT INTO resources (id, url, modality, caption, created_at, updated_at) VALUES (?, ?, 'text', ?, ?, ?)`,
    )
    .run(resourceId, "mimo:migration", `Migrated ${items.length} items from MIMO`, ts, ts);

  // Category cache
  const catCache = new Map();
  const getCatStmt = memu.prepare("SELECT id FROM memory_categories WHERE name = ?");
  const insCatStmt = memu.prepare(
    `INSERT INTO memory_categories (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  );

  function getOrCreateCat(name) {
    if (catCache.has(name)) return catCache.get(name);
    const row = getCatStmt.get(name);
    if (row) {
      catCache.set(name, row.id);
      return row.id;
    }
    const id = uuid();
    insCatStmt.run(id, name, "Auto-created during MIMO migration", ts, ts);
    catCache.set(name, id);
    return id;
  }

  // Check existing (re-run safe)
  const existingHashes = new Set();
  for (const r of memu
    .prepare("SELECT content_hash FROM memory_items WHERE content_hash IS NOT NULL")
    .all()) {
    existingHashes.add(r.content_hash);
  }
  console.log(`Existing MemU items: ${existingHashes.size}`);

  const insItem = memu.prepare(
    `INSERT INTO memory_items (id, resource_id, memory_type, summary, happened_at, content_hash,
     reinforcement_count, last_reinforced_at, extra, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insCatItem = memu.prepare(
    "INSERT OR IGNORE INTO category_items (item_id, category_id) VALUES (?, ?)",
  );

  let inserted = 0,
    skipped = 0;

  // Transaction
  memu.exec("BEGIN");
  try {
    for (const item of items) {
      if (existingHashes.has(item.hash)) {
        skipped++;
        continue;
      }
      const itemId = uuid();
      const reinforcement = Math.max(1, Math.round(item.importance));
      insItem.run(
        itemId,
        resourceId,
        item.memuType,
        item.summary,
        item.createdAt,
        item.hash,
        reinforcement,
        item.createdAt,
        JSON.stringify({ mimoId: item.mimoId, mimoType: item.mimoType }),
        item.createdAt,
        ts,
      );
      for (const catName of item.categories) insCatItem.run(itemId, getOrCreateCat(catName));
      inserted++;
    }
    memu.exec("COMMIT");
  } catch (err) {
    memu.exec("ROLLBACK");
    throw err;
  }

  // Rebuild FTS
  console.log("Rebuilding FTS indexes...");
  memu.exec(`INSERT INTO memory_items_fts(memory_items_fts) VALUES('rebuild')`);
  memu.exec(`INSERT INTO memory_categories_fts(memory_categories_fts) VALUES('rebuild')`);

  const finalCount = memu.prepare("SELECT COUNT(*) as cnt FROM memory_items").get();
  const catCount = memu.prepare("SELECT COUNT(*) as cnt FROM memory_categories").get();

  console.log(`\n=== Migration Complete ===`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total MemU items: ${finalCount.cnt}`);
  console.log(`  Categories: ${catCount.cnt}`);
  console.log(`  DB: ${MEMU_DB_PATH}`);

  mimo.close();
  memu.close();
}

main();
