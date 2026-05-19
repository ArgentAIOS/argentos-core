/**
 * Seed Family Agent Memory (PostgreSQL)
 *
 * Backfills baseline memory items for family agents that currently have no
 * memory_items rows, using existing task/shared-knowledge evidence.
 *
 * Usage:
 *   pnpm -s tsx src/data/migrate/seed-family-memory.ts [--dry-run] [--agents=scout,sam]
 *
 * Behavior:
 *   - Targets agents with 0 memory_items by default (excluding "argent")
 *   - Seeds one profile summary + task-derived event memories + shared-knowledge memories
 *   - Skips duplicate seed records using deterministic content_hash checks
 */

import crypto from "node:crypto";
import postgres from "postgres";
import { resolvePostgresUrl } from "../storage-resolver.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const AGENTS_ARG = args.find((a) => a.startsWith("--agents="))?.split("=")[1] ?? "";
const EXPLICIT_AGENTS = AGENTS_ARG.split(",")
  .map((v) => v.trim())
  .filter((v) => v.length > 0);

const PG_URL = resolvePostgresUrl();
const MAX_TASK_ITEMS = 50;
const MAX_SHARED_ITEMS = 20;

function nowIso(): string {
  return new Date().toISOString();
}

function log(msg: string) {
  console.log(`[${nowIso().slice(11, 23)}] ${msg}`);
}

function hashContent(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toSignificance(priority?: string | null): "routine" | "noteworthy" | "important" | "core" {
  if (priority === "urgent") return "core";
  if (priority === "high") return "important";
  if (priority === "normal") return "noteworthy";
  return "routine";
}

async function ensureAgent(sql: ReturnType<typeof postgres>, id: string): Promise<void> {
  await sql`
    INSERT INTO agents (id, name, role, status, created_at, updated_at)
    VALUES (${id}, ${id}, 'generalist', 'active', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
}

async function contentHashExists(sql: ReturnType<typeof postgres>, hash: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM memory_items WHERE content_hash = ${hash} LIMIT 1
  `;
  return rows.length > 0;
}

async function insertMemoryItem(
  sql: ReturnType<typeof postgres>,
  input: {
    agentId: string;
    memoryType: "profile" | "event" | "knowledge";
    summary: string;
    significance: "routine" | "noteworthy" | "important" | "core";
    createdAt?: string;
    lesson?: string;
    extra?: Record<string, unknown>;
    visibility?: "private" | "team" | "family" | "public";
    hashSeed: string;
  },
): Promise<boolean> {
  const contentHash = hashContent(input.hashSeed);
  if (await contentHashExists(sql, contentHash)) return false;

  if (DRY_RUN) return true;

  const id = crypto.randomUUID();
  await sql`
    INSERT INTO memory_items (
      id, agent_id, memory_type, summary, content_hash, significance,
      emotional_valence, emotional_arousal, extra, lesson, visibility,
      created_at, updated_at
    )
    VALUES (
      ${id}, ${input.agentId}, ${input.memoryType}, ${input.summary}, ${contentHash}, ${input.significance},
      0, 0, ${JSON.stringify(input.extra ?? {})}::jsonb, ${input.lesson ?? null},
      ${input.visibility ?? "private"},
      ${input.createdAt ? new Date(input.createdAt) : new Date()},
      NOW()
    )
  `;
  return true;
}

async function seedAgent(
  sql: ReturnType<typeof postgres>,
  agentId: string,
): Promise<{
  profile: number;
  taskEvents: number;
  sharedKnowledge: number;
}> {
  await ensureAgent(sql, agentId);

  const [taskStats] = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
      COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
      COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
    FROM tasks
    WHERE agent_id = ${agentId}
  `;

  const profileSummary = [
    `Seeded baseline for agent ${agentId}.`,
    `Tasks total=${taskStats.total}, completed=${taskStats.completed}, in_progress=${taskStats.in_progress}, pending=${taskStats.pending}, blocked=${taskStats.blocked}, failed=${taskStats.failed}.`,
    "Source: PostgreSQL task history during PG17 cutover.",
  ].join(" ");

  const profileInserted = await insertMemoryItem(sql, {
    agentId,
    memoryType: "profile",
    summary: profileSummary,
    significance: "noteworthy",
    lesson: "Baseline memory seeded from preserved operational history.",
    extra: { seed: true, source: "tasks_profile_summary_v1" },
    hashSeed: `seed:profile:${agentId}:${taskStats.total}:${taskStats.completed}:${taskStats.pending}:${taskStats.blocked}:${taskStats.failed}`,
  });

  const taskRows = await sql`
    SELECT id, title, description, status, priority, source, created_at, updated_at
    FROM tasks
    WHERE agent_id = ${agentId}
    ORDER BY updated_at DESC
    LIMIT ${MAX_TASK_ITEMS}
  `;

  let taskInserted = 0;
  for (const task of taskRows as Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string | null;
    source: string | null;
    created_at: string;
    updated_at: string;
  }>) {
    const summary = [
      `[Task ${task.status}] ${task.title}`,
      task.description ? `— ${task.description}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const inserted = await insertMemoryItem(sql, {
      agentId,
      memoryType: "event",
      summary,
      significance: toSignificance(task.priority),
      createdAt: task.updated_at ?? task.created_at,
      extra: {
        seed: true,
        source: "tasks_event_v1",
        taskId: task.id,
        taskStatus: task.status,
        taskPriority: task.priority,
        taskSource: task.source,
      },
      hashSeed: `seed:task:${agentId}:${task.id}:${task.status}:${task.updated_at}`,
    });
    if (inserted) taskInserted++;
  }

  const knowledgeRows = await sql`
    SELECT id, title, content, confidence, created_at
    FROM shared_knowledge
    WHERE source_agent_id = ${agentId}
    ORDER BY created_at DESC
    LIMIT ${MAX_SHARED_ITEMS}
  `;

  let knowledgeInserted = 0;
  for (const row of knowledgeRows as Array<{
    id: string;
    title: string;
    content: string;
    confidence: number;
    created_at: string;
  }>) {
    const inserted = await insertMemoryItem(sql, {
      agentId,
      memoryType: "knowledge",
      summary: `${row.title}: ${row.content.slice(0, 500)}`,
      significance: row.confidence >= 0.85 ? "important" : "noteworthy",
      createdAt: row.created_at,
      visibility: "family",
      extra: {
        seed: true,
        source: "shared_knowledge_v1",
        sharedKnowledgeId: row.id,
        confidence: row.confidence,
      },
      hashSeed: `seed:shared:${agentId}:${row.id}`,
    });
    if (inserted) knowledgeInserted++;
  }

  return {
    profile: profileInserted ? 1 : 0,
    taskEvents: taskInserted,
    sharedKnowledge: knowledgeInserted,
  };
}

async function main() {
  log("=== Family memory seeding (PG) ===");
  log(`PG URL: ${PG_URL}`);
  log(`Dry run: ${DRY_RUN}`);

  const sql = postgres(PG_URL, { max: 5 });
  try {
    const agentsToSeed =
      EXPLICIT_AGENTS.length > 0
        ? EXPLICIT_AGENTS
        : (
            await sql`
              SELECT a.id
              FROM agents a
              LEFT JOIN (
                SELECT agent_id, COUNT(*)::int AS cnt
                FROM memory_items
                GROUP BY agent_id
              ) mi ON mi.agent_id = a.id
              WHERE a.id != 'argent'
                AND COALESCE(mi.cnt, 0) = 0
              ORDER BY a.id
            `
          ).map((row: { id: string }) => row.id);

    if (agentsToSeed.length === 0) {
      log("No family agents require seeding.");
      return;
    }

    log(`Target agents: ${agentsToSeed.join(", ")}`);

    let totalProfile = 0;
    let totalTasks = 0;
    let totalKnowledge = 0;
    for (const agentId of agentsToSeed) {
      const seeded = await seedAgent(sql, agentId);
      totalProfile += seeded.profile;
      totalTasks += seeded.taskEvents;
      totalKnowledge += seeded.sharedKnowledge;
      log(
        `Seeded ${agentId}: profile=${seeded.profile}, taskEvents=${seeded.taskEvents}, sharedKnowledge=${seeded.sharedKnowledge}`,
      );
    }

    log(
      `Done. Inserted profile=${totalProfile}, taskEvents=${totalTasks}, sharedKnowledge=${totalKnowledge}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
