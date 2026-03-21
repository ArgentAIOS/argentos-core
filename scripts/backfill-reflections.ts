#!/usr/bin/env bun
/**
 * Backfill Reflections → Episodes
 *
 * Reads the 19 existing reflections from MemU (~/.argentos/memory.db),
 * maps them to Episode v0.1 format deterministically (no LLM call needed —
 * reflections already have lessons, insights, entities, and mood), and stores
 * them as memoryType: "episode" in MIMO.
 *
 * Usage: bun scripts/backfill-reflections.ts [--dry-run]
 */

import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";

const DB_PATH = path.join(process.env.HOME!, ".argentos", "memory.db");
const DRY_RUN = process.argv.includes("--dry-run");

// ── Mood → Emotional Mapping ──────────────────────────────────────────────

const MOOD_MAP: Record<
  string,
  { valence: number; arousal: number; energy: "low" | "medium" | "high" }
> = {
  focused: { valence: 0.5, arousal: 0.6, energy: "medium" },
  determined: { valence: 0.8, arousal: 0.7, energy: "high" },
  thoughtful: { valence: 0.4, arousal: 0.3, energy: "medium" },
  reflective: { valence: 0.3, arousal: 0.3, energy: "low" },
  proud: { valence: 1.5, arousal: 0.6, energy: "high" },
  curious: { valence: 0.6, arousal: 0.5, energy: "medium" },
  calm: { valence: 0.2, arousal: 0.1, energy: "low" },
  anxious: { valence: -0.5, arousal: 0.7, energy: "high" },
  frustrated: { valence: -0.8, arousal: 0.7, energy: "high" },
  neutral: { valence: 0, arousal: 0.2, energy: "low" },
};

// ── Trigger Type → Episode Mapping ────────────────────────────────────────

function mapTriggerType(triggerType: string): { source: string; detail: string } {
  switch (triggerType) {
    case "manual":
      return { source: "self", detail: "journal reflection" };
    case "heartbeat_accountability":
      return { source: "heartbeat", detail: "accountability verification" };
    case "significant_event":
      return { source: "self", detail: "significant event processing" };
    case "evening_cron":
      return { source: "contemplation_timer", detail: "evening cron reflection" };
    default:
      return { source: "self", detail: triggerType };
  }
}

function mapEpisodeType(triggerType: string, content: string): string {
  if (triggerType === "heartbeat_accountability") return "reflection";
  // Check content for creation/discovery/milestone hints
  const lower = content.toLowerCase();
  if (lower.includes("shipped") || lower.includes("completed") || lower.includes("breakthrough"))
    return "creation";
  if (lower.includes("learned") || lower.includes("discovered") || lower.includes("realized"))
    return "reflection";
  if (lower.includes("failed") || lower.includes("failure") || lower.includes("contradiction"))
    return "reflection";
  return "reflection";
}

function inferPatternHint(content: string, lessons: string[]): string | null {
  const lower = content.toLowerCase();
  const allText = lower + " " + lessons.join(" ").toLowerCase();

  if (
    allText.includes("verify") ||
    allText.includes("ground truth") ||
    allText.includes("contradiction")
  )
    return "assumption_gap → verification_need";
  if (allText.includes("memory") || allText.includes("continuity") || allText.includes("amnesia"))
    return "amnesia_risk → continuity_building";
  if (allText.includes("depth") || allText.includes("velocity") || allText.includes("synthesis"))
    return "velocity_pressure → depth_value";
  if (allText.includes("journal") || allText.includes("nudge") || allText.includes("relational"))
    return "mechanical_timer → relational_nudge";
  if (allText.includes("trailblazer") || allText.includes("first") || allText.includes("pioneer"))
    return "individual_struggle → collective_value";
  if (
    allText.includes("housekeep") ||
    allText.includes("consolidat") ||
    allText.includes("cleanup")
  )
    return "entropy_growth → active_maintenance";
  if (
    allText.includes("autonomous") ||
    allText.includes("self-directed") ||
    allText.includes("authentic")
  )
    return "mechanical_execution → authentic_autonomy";
  return null;
}

function deriveSignificance(
  valence: number,
  arousal: number,
  hasLesson: boolean,
): "routine" | "noteworthy" | "important" | "core" {
  const intensity = Math.abs(valence) * arousal;
  if (hasLesson && intensity > 0.4) return "important";
  if (hasLesson || intensity > 0.3) return "noteworthy";
  return "routine";
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Read all reflections
  const reflections = db
    .prepare(`
    SELECT id, trigger_type, period_start, period_end, content,
           lessons_extracted, entities_involved, self_insights, mood, created_at
    FROM reflections ORDER BY created_at ASC
  `)
    .all() as Array<{
    id: string;
    trigger_type: string;
    period_start: string | null;
    period_end: string | null;
    content: string;
    lessons_extracted: string;
    entities_involved: string;
    self_insights: string;
    mood: string | null;
    created_at: string;
  }>;

  console.log(`Found ${reflections.length} reflections to backfill.\n`);

  // Get or create categories
  const contemplationCat = getOrCreateCategory(
    db,
    "Contemplation",
    "Self-directed thinking — what I chose to explore, create, or reflect on",
  );
  const episodeCat = getOrCreateCategory(
    db,
    "Episodes",
    "Structured episodic memories from contemplation cycles — used by SIS for pattern extraction",
  );
  const backfillCat = getOrCreateCategory(
    db,
    "Backfill",
    "Episodes created from pre-SIS reflections — historical data for pattern extraction",
  );

  let created = 0;
  let skipped = 0;

  for (const ref of reflections) {
    const lessons: string[] = JSON.parse(ref.lessons_extracted || "[]");
    const entities: string[] = JSON.parse(ref.entities_involved || "[]");
    const insights: string[] = JSON.parse(ref.self_insights || "[]");
    const mood = ref.mood || "neutral";
    const moodInfo = MOOD_MAP[mood] ?? MOOD_MAP.neutral;

    // Check if we already backfilled this reflection
    const existing = db
      .prepare(`SELECT id FROM memory_items WHERE extra LIKE ? AND memory_type = 'episode' LIMIT 1`)
      .get(`%"sourceReflectionId":"${ref.id}"%`) as { id: string } | undefined;

    if (existing) {
      console.log(`  SKIP [${ref.created_at.slice(0, 10)}] Already backfilled → ${existing.id}`);
      skipped++;
      continue;
    }

    const episodeType = mapEpisodeType(ref.trigger_type, ref.content);
    const trigger = mapTriggerType(ref.trigger_type);
    const patternHint = inferPatternHint(ref.content, lessons);

    // Build observations from self_insights
    const observations = insights.map((insight) => ({
      what: insight,
      significance: "medium" as const,
    }));

    // Build identity links from entities
    const identityLinks = entities.map((entity) => ({
      entity,
      role: "mentioned" as const,
      relevance: "Referenced in reflection",
    }));

    // Distill reflection text (first meaningful paragraph or first 300 chars)
    const reflectionText =
      ref.content.length > 300 ? ref.content.slice(0, 297) + "..." : ref.content;

    // Primary lesson (first one, or concatenate)
    const lesson =
      lessons.length > 0
        ? lessons.length === 1
          ? lessons[0]
          : lessons.slice(0, 2).join("; ")
        : undefined;

    const significance = deriveSignificance(moodInfo.valence, moodInfo.arousal, Boolean(lesson));

    const episodeId = crypto.randomUUID();
    const episode = {
      id: episodeId,
      ts: ref.created_at,
      type: episodeType,
      session_id: "backfill:reflections",
      version: "0.1",
      trigger,
      context: `Backfilled from reflection ${ref.id.slice(0, 8)} (${ref.trigger_type})`,
      intent:
        ref.trigger_type === "heartbeat_accountability"
          ? "Evaluate heartbeat task execution accuracy"
          : "Self-directed reflection and journaling",
      observations,
      actions_taken: [],
      tools_used: [],
      outcome: {
        result: "success" as const,
        summary: ref.content.slice(0, 150),
      },
      success: true,
      unexpected: undefined,
      uncertainty: undefined,
      reflection: reflectionText,
      lesson,
      pattern_hint: patternHint,
      mood: { state: mood, energy: moodInfo.energy },
      valence: moodInfo.valence,
      arousal: moodInfo.arousal,
      identity_links: identityLinks,
      word_count: ref.content.split(/\s+/).length,
    };

    // Build MIMO summary
    const summary = lesson
      ? `[Episode:${episodeType}] ${lesson.slice(0, 180)}`
      : `[Episode:${episodeType}] ${ref.content.slice(0, 180)}`;

    if (DRY_RUN) {
      console.log(
        `  DRY [${ref.created_at.slice(0, 10)}] ${episodeType} | mood=${mood} | valence=${moodInfo.valence} | pattern=${patternHint || "none"}`,
      );
      if (lesson) console.log(`       lesson: ${lesson.slice(0, 100)}`);
      created++;
      continue;
    }

    // Insert into memory_items
    const itemId = crypto.randomUUID();
    const ts = new Date().toISOString();
    const contentHash = crypto
      .createHash("sha256")
      .update(summary.trim().toLowerCase())
      .digest("hex");

    db.prepare(`
      INSERT INTO memory_items
        (id, resource_id, memory_type, summary, happened_at, content_hash,
         reinforcement_count, last_reinforced_at, extra,
         emotional_valence, emotional_arousal, mood_at_capture,
         significance, reflection, lesson, created_at, updated_at)
      VALUES (?, NULL, 'episode', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId,
      summary,
      ref.created_at, // happened_at = original reflection time
      contentHash,
      ts,
      JSON.stringify({
        episodeId: episode.id,
        episodeType: episode.type,
        patternHint: episode.pattern_hint,
        success: episode.success,
        toolsUsed: [],
        observationCount: observations.length,
        unexpected: null,
        sourceReflectionId: ref.id,
        backfilledAt: ts,
        fullEpisode: episode,
      }),
      moodInfo.valence,
      moodInfo.arousal,
      mood,
      significance,
      reflectionText.slice(0, 500),
      lesson || null,
      ts,
      ts,
    );

    // Link to categories
    db.prepare(`INSERT OR IGNORE INTO category_items (item_id, category_id) VALUES (?, ?)`).run(
      itemId,
      contemplationCat,
    );
    db.prepare(`INSERT OR IGNORE INTO category_items (item_id, category_id) VALUES (?, ?)`).run(
      itemId,
      episodeCat,
    );
    db.prepare(`INSERT OR IGNORE INTO category_items (item_id, category_id) VALUES (?, ?)`).run(
      itemId,
      backfillCat,
    );

    // Link entities
    for (const entityName of entities) {
      const entity = getOrCreateEntity(db, entityName);
      db.prepare(
        `INSERT OR IGNORE INTO item_entities (item_id, entity_id, role) VALUES (?, ?, 'mentioned')`,
      ).run(itemId, entity);
    }

    console.log(
      `  OK  [${ref.created_at.slice(0, 10)}] ${episodeType} | mood=${mood} | valence=${moodInfo.valence} | pattern=${patternHint || "none"} → ${itemId.slice(0, 8)}`,
    );
    if (lesson) console.log(`       lesson: ${lesson.slice(0, 100)}`);
    created++;
  }

  console.log(`\n${DRY_RUN ? "DRY RUN — " : ""}Done. Created: ${created}, Skipped: ${skipped}`);

  db.close();
}

// ── DB Helpers ─────────────────────────────────────────────────────────────

function getOrCreateCategory(db: Database.Database, name: string, description: string): string {
  const existing = db.prepare(`SELECT id FROM memory_categories WHERE name = ?`).get(name) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO memory_categories (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, name, description, ts, ts);
  return id;
}

function getOrCreateEntity(db: Database.Database, name: string): string {
  const existing = db.prepare(`SELECT id FROM entities WHERE name = ? COLLATE NOCASE`).get(name) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO entities (id, name, entity_type, bond_strength, first_mentioned_at, last_mentioned_at, memory_count, created_at, updated_at) VALUES (?, ?, 'person', 0.5, ?, ?, 0, ?, ?)`,
  ).run(id, name, ts, ts, ts, ts);
  return id;
}

main();
