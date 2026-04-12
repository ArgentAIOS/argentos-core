#!/usr/bin/env -S node --experimental-sqlite --no-warnings
/**
 * Backfill Identity Data for Existing Memories
 *
 * One-time script to enrich existing MemU memories with identity fields:
 * 1. Extract entities from high-reinforcement memories
 * 2. Assess significance for existing memories
 * 3. Create entity records for recognized people/places
 * 4. Identify candidate core memories
 *
 * Usage:
 *   node --experimental-sqlite scripts/backfill-identity.ts [--dry-run] [--limit N] [--batch N]
 *
 * Requires: Node 22+ with --experimental-sqlite
 * Note: LLM calls use the Anthropic API directly (not embedded Pi agent) for batch efficiency.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// ── Configuration ──

const DB_PATH = path.join(process.env.HOME || "~", ".argentos", "memory.db");

const SIGNIFICANCE_KEYWORDS: Record<string, string[]> = {
  core: [
    "always",
    "identity",
    "fundamental",
    "defining",
    "never forget",
    "who i am",
    "who he is",
    "foundation",
    "core",
    "deeply",
  ],
  important: [
    "important",
    "significant",
    "milestone",
    "birthday",
    "anniversary",
    "passed away",
    "died",
    "born",
    "married",
    "divorced",
    "promotion",
    "fired",
    "health",
    "surgery",
    "hospital",
    "diagnosis",
    "mother",
    "father",
    "wife",
    "husband",
    "son",
    "daughter",
    "love",
    "fear",
    "worried",
    "devastated",
    "overjoyed",
  ],
  noteworthy: [
    "project",
    "decision",
    "preference",
    "learned",
    "realized",
    "changed",
    "started",
    "stopped",
    "new",
    "first time",
    "partner",
    "friend",
    "colleague",
    "pet",
  ],
};

// Known entity names to look for (seed list — extend as needed)
const KNOWN_ENTITIES: Array<{
  name: string;
  type: "person" | "pet" | "place" | "organization" | "project";
  relationship?: string;
}> = [
  { name: "Jason", type: "person", relationship: "owner" },
  { name: "Richard", type: "person", relationship: "business partner" },
  { name: "Maggie", type: "person", relationship: "Jason's mother" },
  { name: "Leo", type: "pet", relationship: "Jason's dog" },
  { name: "ArgentOS", type: "project", relationship: "my operating system" },
];

// ── CLI Args ──

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
const batchIdx = args.indexOf("--batch");
const batchSize = batchIdx >= 0 ? parseInt(args[batchIdx + 1], 10) : 50;

// ── Helpers ──

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function assessSignificance(summary: string): "routine" | "noteworthy" | "important" | "core" {
  const lower = summary.toLowerCase();

  for (const keyword of SIGNIFICANCE_KEYWORDS.core) {
    if (lower.includes(keyword)) return "core";
  }
  for (const keyword of SIGNIFICANCE_KEYWORDS.important) {
    if (lower.includes(keyword)) return "important";
  }
  for (const keyword of SIGNIFICANCE_KEYWORDS.noteworthy) {
    if (lower.includes(keyword)) return "noteworthy";
  }

  return "routine";
}

function detectEntities(
  summary: string,
): Array<{ name: string; type: string; relationship?: string }> {
  const found: Array<{ name: string; type: string; relationship?: string }> = [];
  const lower = summary.toLowerCase();

  for (const entity of KNOWN_ENTITIES) {
    if (lower.includes(entity.name.toLowerCase())) {
      found.push(entity);
    }
  }

  return found;
}

function assessEmotion(summary: string): { valence: number; arousal: number } {
  const lower = summary.toLowerCase();

  // Simple keyword-based emotional assessment
  const positiveWords = [
    "love",
    "happy",
    "excited",
    "great",
    "awesome",
    "amazing",
    "wonderful",
    "proud",
    "grateful",
  ];
  const negativeWords = [
    "worried",
    "sad",
    "angry",
    "frustrated",
    "disappointed",
    "scared",
    "afraid",
    "anxious",
    "devastated",
  ];
  const intenseWords = [
    "extremely",
    "deeply",
    "very",
    "incredibly",
    "absolutely",
    "seriously",
    "urgently",
    "critical",
  ];

  let valence = 0;
  let arousal = 0.2; // baseline

  for (const word of positiveWords) {
    if (lower.includes(word)) {
      valence += 0.5;
      arousal += 0.1;
    }
  }
  for (const word of negativeWords) {
    if (lower.includes(word)) {
      valence -= 0.5;
      arousal += 0.1;
    }
  }
  for (const word of intenseWords) {
    if (lower.includes(word)) {
      arousal += 0.2;
    }
  }

  // Clamp values
  valence = Math.max(-2, Math.min(2, valence));
  arousal = Math.max(0, Math.min(1, arousal));

  return { valence, arousal };
}

// ── Main ──

console.log("=== MemU Identity Backfill ===");
console.log(`Database: ${DB_PATH}`);
console.log(`Dry run: ${dryRun}`);
console.log(`Limit: ${limit || "all"}`);
console.log(`Batch size: ${batchSize}`);
console.log("");

if (!fs.existsSync(DB_PATH)) {
  console.error(`Database not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// Count existing items
const totalRow = db.prepare("SELECT count(*) as cnt FROM memory_items").get() as { cnt: number };
console.log(`Total memory items: ${totalRow.cnt}`);

// Count items with default significance (routine, no emotional data)
const defaultRow = db
  .prepare(
    "SELECT count(*) as cnt FROM memory_items WHERE significance = 'routine' AND emotional_valence = 0 AND emotional_arousal = 0",
  )
  .get() as { cnt: number };
console.log(`Items with default identity data: ${defaultRow.cnt}`);

const entityCount = (db.prepare("SELECT count(*) as cnt FROM entities").get() as { cnt: number })
  .cnt;
console.log(`Existing entities: ${entityCount}`);
console.log("");

// Fetch items to backfill
let sql =
  "SELECT id, summary, memory_type, reinforcement_count, significance, emotional_valence, emotional_arousal, created_at FROM memory_items ORDER BY reinforcement_count DESC, created_at DESC";
if (limit > 0) sql += ` LIMIT ${limit}`;

const items = db.prepare(sql).all() as Array<{
  id: string;
  summary: string;
  memory_type: string;
  reinforcement_count: number;
  significance: string;
  emotional_valence: number;
  emotional_arousal: number;
  created_at: string;
}>;

console.log(`Processing ${items.length} items...`);
console.log("");

let updatedSignificance = 0;
let updatedEmotion = 0;
let entitiesCreated = 0;
let entityLinksCreated = 0;

// Prepare statements
const updateSigStmt = db.prepare(
  "UPDATE memory_items SET significance = ?, updated_at = ? WHERE id = ?",
);
const updateEmotionStmt = db.prepare(
  "UPDATE memory_items SET emotional_valence = ?, emotional_arousal = ?, updated_at = ? WHERE id = ?",
);
const insertEntityStmt = db.prepare(
  "INSERT OR IGNORE INTO entities (id, name, entity_type, relationship, bond_strength, first_mentioned_at, last_mentioned_at, memory_count, created_at, updated_at) VALUES (?, ?, ?, ?, 0.5, ?, ?, 0, ?, ?)",
);
const findEntityStmt = db.prepare("SELECT id FROM entities WHERE name = ? COLLATE NOCASE");
const linkEntityStmt = db.prepare(
  "INSERT OR IGNORE INTO item_entities (item_id, entity_id, role) VALUES (?, ?, 'mentioned')",
);
const updateEntityCountStmt = db.prepare(
  "UPDATE entities SET memory_count = (SELECT count(*) FROM item_entities WHERE entity_id = ?), last_mentioned_at = ?, updated_at = ? WHERE id = ?",
);

for (let i = 0; i < items.length; i++) {
  const item = items[i];
  const ts = now();

  // 1. Assess significance (only if currently routine)
  if (item.significance === "routine") {
    const newSig = assessSignificance(item.summary);
    if (newSig !== "routine") {
      if (!dryRun) {
        updateSigStmt.run(newSig, ts, item.id);
      }
      updatedSignificance++;
      if (i < 20 || newSig === "core" || newSig === "important") {
        console.log(`  [${newSig.toUpperCase()}] ${item.summary.slice(0, 80)}`);
      }
    }
  }

  // 2. Assess emotion (only if currently neutral)
  if (item.emotional_valence === 0 && item.emotional_arousal === 0) {
    const emotion = assessEmotion(item.summary);
    if (emotion.valence !== 0 || emotion.arousal > 0.2) {
      if (!dryRun) {
        updateEmotionStmt.run(emotion.valence, emotion.arousal, ts, item.id);
      }
      updatedEmotion++;
    }
  }

  // 3. Detect and link entities
  const detected = detectEntities(item.summary);
  for (const ent of detected) {
    // Find or create entity
    let entityRow = findEntityStmt.get(ent.name) as { id: string } | undefined;

    if (!entityRow) {
      const entityId = uuid();
      if (!dryRun) {
        insertEntityStmt.run(
          entityId,
          ent.name,
          ent.type,
          ent.relationship || null,
          ts,
          ts,
          ts,
          ts,
        );
      }
      entityRow = { id: entityId };
      entitiesCreated++;
      console.log(`  [ENTITY] Created: ${ent.name} (${ent.type})`);
    }

    // Link item to entity
    if (!dryRun) {
      linkEntityStmt.run(item.id, entityRow.id);
      updateEntityCountStmt.run(entityRow.id, ts, ts, entityRow.id);
    }
    entityLinksCreated++;
  }

  // Progress
  if ((i + 1) % batchSize === 0) {
    console.log(`  ... processed ${i + 1}/${items.length}`);
  }
}

console.log("");
console.log("=== Summary ===");
console.log(`Significance updated: ${updatedSignificance}`);
console.log(`Emotion assessed: ${updatedEmotion}`);
console.log(`Entities created: ${entitiesCreated}`);
console.log(`Entity links created: ${entityLinksCreated}`);
if (dryRun) {
  console.log("\n[DRY RUN] No changes were written to the database.");
}

db.close();
console.log("\nDone.");
