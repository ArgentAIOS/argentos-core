/**
 * SQLite → PostgreSQL Data Migration
 *
 * One-shot migration script that copies all data from SQLite (memory.db,
 * dashboard.db) into the PostgreSQL argentos database.
 *
 * Usage:
 *   bun src/data/migrate/sqlite-to-pg.ts [--dry-run] [--agent-id=argent]
 *
 * Steps:
 *   1. Backup memory.db → memory.db.pre-pg-migration
 *   2. Register agent in agents table
 *   3. Migrate resources → resources
 *   4. Migrate memory_items → memory_items (BLOB embeddings → vector(768))
 *   5. Migrate memory_categories + category_items
 *   6. Migrate entities + item_entities
 *   7. Migrate reflections
 *   8. Migrate lessons (BLOB embeddings → vector(768))
 *   9. Migrate model_feedback
 *  10. Migrate tasks (from dashboard.db)
 *  11. Migrate teams + team_members
 *  12. Verify row counts
 *
 * Requires:
 *   - PostgreSQL running on port 5433 with argentos database
 *   - pgvector extension installed
 *   - Schema already applied (drizzle-kit migrate)
 */

import Database from "better-sqlite3";
import { sql as dsql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import * as fs from "node:fs";
import * as path from "node:path";
import postgres from "postgres";
import * as schema from "../pg/schema.js";
import { resolvePostgresUrl } from "../storage-resolver.js";

// ── Config ───────────────────────────────────────────────────────────────

const HOME = process.env.HOME ?? "";
const ARGENT_DIR = path.join(HOME, ".argentos");
const MEMORY_DB_PATH = path.join(ARGENT_DIR, "memory.db");
const DASHBOARD_DB_PATH_CANDIDATES = [
  path.join(ARGENT_DIR, "data", "dashboard.db"), // current default
  path.join(ARGENT_DIR, "dashboard.db"), // legacy path
];
const BACKUP_SUFFIX = ".pre-pg-migration";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const AGENT_ID = args.find((a) => a.startsWith("--agent-id="))?.split("=")[1] ?? "argent";
const PG_URL = resolvePostgresUrl({
  explicit: args.find((a) => a.startsWith("--pg-url="))?.split("=")[1] ?? null,
});

function resolveDashboardDbPath(): string | null {
  for (const candidate of DASHBOARD_DB_PATH_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

/**
 * Convert a SQLite BLOB embedding to a pgvector string format: [0.1,0.2,...]
 * SQLite stores embeddings as Float32Array BLOBs.
 */
function blobToVectorString(blob: Buffer | null): string | null {
  if (!blob || blob.length === 0) return null;
  try {
    const floats = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    return `[${Array.from(floats).join(",")}]`;
  } catch {
    return null;
  }
}

/**
 * Convert SQLite TEXT timestamp to JS Date.
 * Handles ISO 8601 strings and epoch-ms integers.
 */
function toDate(val: string | number | null): Date | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return new Date(val);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/** Parse JSON text safely */
function parseJson(val: string | null, fallback: any = []): any {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function normalizeAgentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function ensureAgentRow(
  db: ReturnType<typeof drizzle>,
  id: string,
  role: "elder" | "worker" = "worker",
): Promise<void> {
  await db
    .insert(schema.agents)
    .values({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      role,
      status: "active",
    })
    .onConflictDoNothing();
}

// ── Main Migration ───────────────────────────────────────────────────────

async function main() {
  log(`=== ArgentOS SQLite → PostgreSQL Migration ===`);
  log(`Agent ID: ${AGENT_ID}`);
  log(`PG URL: ${PG_URL}`);
  log(`Dry run: ${DRY_RUN}`);
  log("");

  // 1. Verify source databases exist
  if (!fs.existsSync(MEMORY_DB_PATH)) {
    log(`ERROR: memory.db not found at ${MEMORY_DB_PATH}`);
    process.exit(1);
  }

  // 2. Backup
  const backupPath = MEMORY_DB_PATH + BACKUP_SUFFIX;
  if (!fs.existsSync(backupPath)) {
    log(`Backing up: ${MEMORY_DB_PATH} → ${backupPath}`);
    if (!DRY_RUN) fs.copyFileSync(MEMORY_DB_PATH, backupPath);
  } else {
    log(`Backup already exists: ${backupPath}`);
  }

  // 3. Open connections
  const memDb = new Database(MEMORY_DB_PATH, { readonly: true });
  const dashboardDbPath = resolveDashboardDbPath();
  const dashDb = dashboardDbPath ? new Database(dashboardDbPath, { readonly: true }) : null;
  if (dashboardDbPath) {
    log(`Dashboard DB: ${dashboardDbPath}`);
  } else {
    log(
      "Dashboard DB not found (tried ~/.argentos/data/dashboard.db and ~/.argentos/dashboard.db)",
    );
  }

  const sql = postgres(PG_URL, { max: 5 });
  const db = drizzle(sql, { schema });

  try {
    // 4. Register agent
    log("Registering agent...");
    if (!DRY_RUN) {
      await ensureAgentRow(db, AGENT_ID, "elder");
    }

    // 5. Migrate resources
    await migrateTable({
      name: "resources",
      db,
      rows: memDb.prepare("SELECT * FROM resources").all() as any[],
      insert: async (rows) => {
        for (const batch of chunk(rows, 100)) {
          await db
            .insert(schema.resources)
            .values(
              batch.map((r: any) => ({
                id: r.id,
                agentId: AGENT_ID,
                url: r.url ?? "",
                modality: r.modality ?? "text",
                localPath: r.local_path,
                caption: r.caption,
                embedding: blobToVectorString(r.embedding),
                createdAt: toDate(r.created_at) ?? new Date(),
                updatedAt: toDate(r.updated_at) ?? new Date(),
              })),
            )
            .onConflictDoNothing();
        }
      },
    });

    // 6. Migrate memory_items
    await migrateTable({
      name: "memory_items",
      db,
      rows: memDb.prepare("SELECT * FROM memory_items").all() as any[],
      insert: async (rows) => {
        for (const batch of chunk(rows, 100)) {
          await db
            .insert(schema.memoryItems)
            .values(
              batch.map((r: any) => ({
                id: r.id,
                agentId: AGENT_ID,
                resourceId: r.resource_id,
                memoryType: r.memory_type,
                summary: r.summary,
                embedding: blobToVectorString(r.embedding),
                happenedAt: toDate(r.happened_at),
                contentHash: r.content_hash,
                reinforcementCount: r.reinforcement_count ?? 1,
                lastReinforcedAt: toDate(r.last_reinforced_at),
                extra: parseJson(r.extra, {}),
                emotionalValence: r.emotional_valence ?? 0,
                emotionalArousal: r.emotional_arousal ?? 0,
                moodAtCapture: r.mood_at_capture,
                significance: r.significance ?? "routine",
                reflection: r.reflection,
                lesson: r.lesson,
                createdAt: toDate(r.created_at) ?? new Date(),
                updatedAt: toDate(r.updated_at) ?? new Date(),
              })),
            )
            .onConflictDoNothing();
        }
      },
    });

    // 7. Migrate memory_categories
    await migrateTable({
      name: "memory_categories",
      db,
      rows: memDb.prepare("SELECT * FROM memory_categories").all() as any[],
      insert: async (rows) => {
        for (const batch of chunk(rows, 100)) {
          await db
            .insert(schema.memoryCategories)
            .values(
              batch.map((r: any) => ({
                id: r.id,
                agentId: AGENT_ID,
                name: r.name,
                description: r.description,
                embedding: blobToVectorString(r.embedding),
                summary: r.summary,
                createdAt: toDate(r.created_at) ?? new Date(),
                updatedAt: toDate(r.updated_at) ?? new Date(),
              })),
            )
            .onConflictDoNothing();
        }
      },
    });

    // 8. Migrate category_items
    await migrateTable({
      name: "category_items",
      db,
      rows: memDb.prepare("SELECT * FROM category_items").all() as any[],
      insert: async (rows) => {
        for (const batch of chunk(rows, 100)) {
          await db
            .insert(schema.categoryItems)
            .values(
              batch.map((r: any) => ({
                itemId: r.item_id,
                categoryId: r.category_id,
              })),
            )
            .onConflictDoNothing();
        }
      },
    });

    // 9. Migrate entities
    // NOTE: entities has an additional unique index on (agent_id, name). If a row
    // already exists in PG with same name but different ID, ON CONFLICT DO NOTHING
    // skips insertion. We keep a remap table so item_entities can link to the
    // effective PG entity ID instead of failing FK checks or silently dropping links.
    const entityRows = memDb.prepare("SELECT * FROM entities").all() as any[];
    const entityIdRemap = new Map<string, string>();
    log(`entities: ${entityRows.length} rows`);
    const entitiesStartedAt = Date.now();
    let entityNameConflictRemaps = 0;
    if (!DRY_RUN) {
      for (const r of entityRows) {
        await db
          .insert(schema.entities)
          .values({
            id: r.id,
            agentId: AGENT_ID,
            name: r.name,
            entityType: r.entity_type ?? "person",
            relationship: r.relationship,
            bondStrength: r.bond_strength ?? 0.5,
            emotionalTexture: r.emotional_texture,
            profileSummary: r.profile_summary,
            firstMentionedAt: toDate(r.first_mentioned_at),
            lastMentionedAt: toDate(r.last_mentioned_at),
            memoryCount: r.memory_count ?? 0,
            embedding: blobToVectorString(r.embedding),
            createdAt: toDate(r.created_at) ?? new Date(),
            updatedAt: toDate(r.updated_at) ?? new Date(),
          })
          .onConflictDoNothing();

        // Resolve effective ID in PG.
        const byId = await sql`SELECT id FROM entities WHERE id = ${r.id} LIMIT 1`;
        if (byId.length > 0) {
          entityIdRemap.set(r.id, String(byId[0].id));
          continue;
        }

        const byName = await sql`
          SELECT id
          FROM entities
          WHERE agent_id = ${AGENT_ID} AND name = ${r.name}
          LIMIT 1
        `;
        if (byName.length > 0) {
          entityIdRemap.set(r.id, String(byName[0].id));
          entityNameConflictRemaps++;
        } else {
          // Fallback to source ID so downstream logging can surface any FK issues.
          entityIdRemap.set(r.id, r.id);
        }
      }
    } else {
      for (const r of entityRows) {
        entityIdRemap.set(r.id, r.id);
      }
    }
    log(
      `  inserted in ${Date.now() - entitiesStartedAt}ms (name conflict remaps: ${entityNameConflictRemaps})`,
    );

    // 10. Migrate item_entities
    await migrateTable({
      name: "item_entities",
      db,
      rows: memDb.prepare("SELECT * FROM item_entities").all() as any[],
      insert: async (rows) => {
        for (const batch of chunk(rows, 100)) {
          await db
            .insert(schema.itemEntities)
            .values(
              batch.map((r: any) => ({
                itemId: r.item_id,
                entityId: entityIdRemap.get(r.entity_id) ?? r.entity_id,
                role: r.role ?? "mentioned",
              })),
            )
            .onConflictDoNothing();
        }
      },
    });

    // 11. Migrate reflections
    await migrateTable({
      name: "reflections",
      db,
      rows: memDb.prepare("SELECT * FROM reflections").all() as any[],
      insert: async (rows) => {
        for (const batch of chunk(rows, 100)) {
          await db
            .insert(schema.reflections)
            .values(
              batch.map((r: any) => ({
                id: r.id,
                agentId: AGENT_ID,
                triggerType: r.trigger_type,
                periodStart: toDate(r.period_start),
                periodEnd: toDate(r.period_end),
                content: r.content,
                lessonsExtracted: parseJson(r.lessons_extracted, []),
                entitiesInvolved: parseJson(r.entities_involved, []),
                selfInsights: parseJson(r.self_insights, []),
                mood: r.mood,
                createdAt: toDate(r.created_at) ?? new Date(),
              })),
            )
            .onConflictDoNothing();
        }
      },
    });

    // 12. Migrate lessons
    await migrateTable({
      name: "lessons",
      db,
      rows: memDb.prepare("SELECT * FROM lessons").all() as any[],
      insert: async (rows) => {
        for (const batch of chunk(rows, 100)) {
          await db
            .insert(schema.lessons)
            .values(
              batch.map((r: any) => ({
                id: r.id,
                agentId: AGENT_ID,
                type: r.type,
                context: r.context,
                action: r.action,
                outcome: r.outcome,
                lesson: r.lesson,
                correction: r.correction,
                confidence: r.confidence ?? 0.5,
                occurrences: r.occurrences ?? 1,
                lastSeen: toDate(r.last_seen) ?? new Date(),
                tags: parseJson(r.tags, []),
                relatedTools: parseJson(r.related_tools, []),
                sourceEpisodeIds: parseJson(r.source_episode_ids, []),
                embedding: blobToVectorString(r.embedding),
                createdAt: toDate(r.created_at) ?? new Date(),
                updatedAt: toDate(r.updated_at) ?? new Date(),
              })),
            )
            .onConflictDoNothing();
        }
      },
    });

    // 13. Migrate model_feedback
    try {
      const feedbackRows = memDb.prepare("SELECT * FROM model_feedback").all() as any[];
      await migrateTable({
        name: "model_feedback",
        db,
        rows: feedbackRows,
        insert: async (rows) => {
          for (const batch of chunk(rows, 100)) {
            await db
              .insert(schema.modelFeedback)
              .values(
                batch.map((r: any) => ({
                  id: r.id,
                  agentId: AGENT_ID,
                  provider: r.provider,
                  model: r.model,
                  tier: r.tier,
                  sessionType: r.session_type,
                  complexityScore: r.complexity_score ?? 0,
                  durationMs: r.duration_ms ?? 0,
                  success: r.success === 1 || r.success === true,
                  errorType: r.error_type,
                  inputTokens: r.input_tokens ?? 0,
                  outputTokens: r.output_tokens ?? 0,
                  totalTokens: r.total_tokens ?? 0,
                  toolCallCount: r.tool_call_count ?? 0,
                  userFeedback: r.user_feedback,
                  sessionKey: r.session_key,
                  profile: r.profile,
                  selfEvalScore: r.self_eval_score,
                  selfEvalReasoning: r.self_eval_reasoning,
                  createdAt: toDate(r.created_at) ?? new Date(),
                })),
              )
              .onConflictDoNothing();
          }
        },
      });
    } catch {
      log("model_feedback table not found in SQLite — skipping");
    }

    // 14. Migrate tasks from dashboard.db
    if (dashDb) {
      try {
        const taskAgentIds = (
          dashDb
            .prepare(
              "SELECT DISTINCT agent_id FROM tasks WHERE agent_id IS NOT NULL AND TRIM(agent_id) != ''",
            )
            .all() as Array<{ agent_id: string }>
        )
          .map((row) => normalizeAgentId(row.agent_id))
          .filter((id): id is string => id !== null);

        if (taskAgentIds.length > 0) {
          log(`Registering ${taskAgentIds.length} task agent(s)...`);
          if (!DRY_RUN) {
            for (const taskAgentId of taskAgentIds) {
              await ensureAgentRow(db, taskAgentId, taskAgentId === AGENT_ID ? "elder" : "worker");
            }
          }
        }

        await migrateTable({
          name: "tasks",
          db,
          rows: dashDb.prepare("SELECT * FROM tasks").all() as any[],
          insert: async (rows) => {
            for (const batch of chunk(rows, 100)) {
              await db
                .insert(schema.tasks)
                .values(
                  batch.map((r: any) => ({
                    id: r.id,
                    agentId: r.agent_id ?? AGENT_ID,
                    title: r.title,
                    description: r.description,
                    status: r.status ?? "pending",
                    priority: r.priority ?? "normal",
                    source: r.source ?? "user",
                    assignee: r.assignee,
                    createdAt: toDate(r.created_at) ?? new Date(),
                    updatedAt: toDate(r.updated_at) ?? new Date(),
                    startedAt: toDate(r.started_at),
                    completedAt: toDate(r.completed_at),
                    dueAt: toDate(r.due_at),
                    sessionId: r.session_id,
                    channelId: r.channel_id,
                    parentTaskId: r.parent_task_id,
                    dependsOn: parseJson(r.depends_on, []),
                    teamId: r.team_id,
                    tags: parseJson(r.tags, []),
                    metadata: parseJson(r.metadata, {}),
                  })),
                )
                .onConflictDoNothing();
            }
          },
        });
      } catch (err) {
        log(`tasks migration error: ${err}`);
      }

      // 15. Migrate teams + team_members
      try {
        await migrateTable({
          name: "teams",
          db,
          rows: dashDb.prepare("SELECT * FROM teams").all() as any[],
          insert: async (rows) => {
            for (const batch of chunk(rows, 50)) {
              await db
                .insert(schema.teams)
                .values(
                  batch.map((r: any) => ({
                    id: r.id,
                    name: r.name,
                    leadSessionKey: r.lead_session_key,
                    status: r.status ?? "active",
                    config: parseJson(r.config, {}),
                    createdAt: toDate(r.created_at) ?? new Date(),
                    updatedAt: toDate(r.updated_at) ?? new Date(),
                  })),
                )
                .onConflictDoNothing();
            }
          },
        });

        await migrateTable({
          name: "team_members",
          db,
          rows: dashDb.prepare("SELECT * FROM team_members").all() as any[],
          insert: async (rows) => {
            for (const batch of chunk(rows, 50)) {
              await db
                .insert(schema.teamMembers)
                .values(
                  batch.map((r: any) => ({
                    teamId: r.team_id,
                    sessionKey: r.session_key,
                    role: r.role ?? "worker",
                    label: r.label,
                    status: r.status ?? "active",
                    joinedAt: toDate(r.joined_at) ?? new Date(),
                    lastActiveAt: toDate(r.last_active_at),
                  })),
                )
                .onConflictDoNothing();
            }
          },
        });
      } catch (err) {
        log(`teams migration error: ${err}`);
      }
    } else {
      log("dashboard.db not found — skipping tasks/teams migration");
    }

    // 16. Verification
    log("");
    log("=== Verification ===");
    await verify(memDb, dashDb, db);
  } finally {
    memDb.close();
    dashDb?.close();
    await sql.end();
  }

  log("");
  log("=== Migration Complete ===");
}

// ── Migration Helper ─────────────────────────────────────────────────────

interface MigrateOptions {
  name: string;
  db: any;
  rows: any[];
  insert: (rows: any[]) => Promise<void>;
}

async function migrateTable(opts: MigrateOptions): Promise<void> {
  const { name, rows, insert } = opts;
  log(`${name}: ${rows.length} rows`);

  if (DRY_RUN) {
    log(`  [dry-run] would insert ${rows.length} rows`);
    return;
  }

  if (rows.length === 0) return;

  const start = Date.now();
  await insert(rows);
  const elapsed = Date.now() - start;
  log(`  inserted in ${elapsed}ms`);
}

/** Split array into chunks */
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// ── Verification ─────────────────────────────────────────────────────────

async function verify(
  memDb: InstanceType<typeof Database>,
  dashDb: InstanceType<typeof Database> | null,
  db: ReturnType<typeof drizzle>,
) {
  const tables = [
    { name: "resources", sqliteDb: memDb, pgTable: schema.resources },
    { name: "memory_items", sqliteDb: memDb, pgTable: schema.memoryItems },
    { name: "memory_categories", sqliteDb: memDb, pgTable: schema.memoryCategories },
    { name: "entities", sqliteDb: memDb, pgTable: schema.entities },
    { name: "reflections", sqliteDb: memDb, pgTable: schema.reflections },
    { name: "lessons", sqliteDb: memDb, pgTable: schema.lessons },
  ];

  if (dashDb) {
    tables.push(
      { name: "tasks", sqliteDb: dashDb, pgTable: schema.tasks },
      { name: "teams", sqliteDb: dashDb, pgTable: schema.teams },
    );
  }

  for (const { name, sqliteDb, pgTable } of tables) {
    try {
      const sqliteCount = (sqliteDb.prepare(`SELECT COUNT(*) as c FROM ${name}`).get() as any).c;
      const [pgResult] = await (db as any).select({ count: dsql`count(*)` }).from(pgTable);
      const pgCount = Number(pgResult.count);

      const match = sqliteCount === pgCount ? "OK" : "MISMATCH";
      log(`  ${name}: SQLite=${sqliteCount} PG=${pgCount} [${match}]`);
    } catch (err) {
      log(`  ${name}: verification error — ${err}`);
    }
  }
}

// ── Run ──────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
