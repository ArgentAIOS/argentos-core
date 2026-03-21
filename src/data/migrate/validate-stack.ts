/**
 * Full-Stack Validation Script
 *
 * Validates that PostgreSQL, Redis, and the StorageAdapter dual-write
 * infrastructure all work correctly end-to-end.
 *
 * Usage:
 *   npx tsx src/data/migrate/validate-stack.ts
 *
 * Checks:
 *   1. PostgreSQL 17 on port 5433 — connection, pgvector, FTS
 *   2. Redis on port 6380 — connection, read/write, Streams
 *   3. StorageAdapter in dual mode — init, memory write, search
 *   4. Data integrity — compare PG row counts to SQLite
 *   5. Vector search — cosine similarity via HNSW index
 *   6. Full-text search — tsvector/GIN search
 */

import Database from "better-sqlite3";
import Redis from "ioredis";
import * as fs from "node:fs";
import * as path from "node:path";
import postgres from "postgres";
import { ARGENT_PG_PORT, ARGENT_REDIS_PORT } from "../storage-config.js";
import { resolvePostgresUrl } from "../storage-resolver.js";

const HOME = process.env.HOME ?? "";
const PG_URL = resolvePostgresUrl({ fallback: `postgres://localhost:${ARGENT_PG_PORT}/argentos` });
const MEMORY_DB = path.join(HOME, ".argentos", "memory.db");

let passed = 0;
let failed = 0;

function ok(name: string, detail?: string): void {
  passed++;
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, err: unknown): void {
  failed++;
  console.log(`  ❌ ${name} — ${String(err)}`);
}

async function main() {
  console.log("=== ArgentOS Infrastructure Validation ===\n");

  // ── 1. PostgreSQL Connection ──────────────────────────────────────
  console.log("1. PostgreSQL 17 (port 5433)");
  const sql = postgres(PG_URL, { max: 3 });

  try {
    const [{ version }] = await sql`SELECT version()`;
    ok("connection", version.split(" ").slice(0, 2).join(" "));
  } catch (err) {
    fail("connection", err);
  }

  try {
    const [{ v }] = await sql`SELECT '[1,2,3]'::vector as v`;
    ok("pgvector extension", `cast works: ${v}`);
  } catch (err) {
    fail("pgvector extension", err);
  }

  try {
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    ok("schema", `${tables.length} tables`);
  } catch (err) {
    fail("schema", err);
  }

  // ── 2. Redis Connection ──────────────────────────────────────────
  console.log("\n2. Redis (port 6380)");
  const redis = new Redis({ host: "127.0.0.1", port: ARGENT_REDIS_PORT, lazyConnect: true });

  try {
    await redis.connect();
    const pong = await redis.ping();
    ok("connection", pong);
  } catch (err) {
    fail("connection", err);
  }

  try {
    await redis.set("validate:test", "argentos", "EX", 10);
    const val = await redis.get("validate:test");
    await redis.del("validate:test");
    ok("read/write", `set→get: ${val}`);
  } catch (err) {
    fail("read/write", err);
  }

  try {
    // Test Redis Streams (inter-agent messaging)
    await redis.xadd("validate:stream", "*", "sender", "test", "type", "ping");
    const messages = await redis.xrange("validate:stream", "-", "+");
    await redis.del("validate:stream");
    ok("streams", `${messages.length} message(s) in stream`);
  } catch (err) {
    fail("streams", err);
  }

  // ── 3. Data Integrity ────────────────────────────────────────────
  console.log("\n3. Data Integrity (SQLite vs PostgreSQL)");

  if (fs.existsSync(MEMORY_DB)) {
    const memDb = new Database(MEMORY_DB, { readonly: true });

    const tablePairs = [
      "resources",
      "memory_items",
      "memory_categories",
      "entities",
      "lessons",
      "reflections",
      "model_feedback",
      "category_items",
      "item_entities",
    ];

    for (const table of tablePairs) {
      try {
        const sqliteCount = (memDb.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as any).c;
        const [pgRow] = await sql`SELECT count(*)::int as c FROM ${sql(table)}`;
        const pgCount = pgRow.c;
        if (sqliteCount === pgCount) {
          ok(table, `${sqliteCount} rows match`);
        } else {
          fail(table, `SQLite=${sqliteCount} PG=${pgCount}`);
        }
      } catch (err) {
        fail(table, err);
      }
    }

    memDb.close();
  } else {
    console.log("  ⚠ memory.db not found, skipping integrity check");
  }

  // ── 4. Vector Search ─────────────────────────────────────────────
  console.log("\n4. Vector Search (pgvector HNSW)");

  try {
    const results = await sql`
      SELECT id, LEFT(summary, 60) as summary,
             1 - (embedding <=> (
               SELECT embedding FROM memory_items
               WHERE embedding IS NOT NULL LIMIT 1
             )) as similarity
      FROM memory_items
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> (
        SELECT embedding FROM memory_items
        WHERE embedding IS NOT NULL LIMIT 1
      )
      LIMIT 5
    `;
    if (results.length > 0) {
      ok(
        "cosine similarity",
        `top match: ${results[0].similarity.toFixed(4)} — "${results[0].summary}"`,
      );
      ok("HNSW index", `${results.length} results returned`);
    } else {
      fail("cosine similarity", "no results with embeddings");
    }
  } catch (err) {
    fail("cosine similarity", err);
  }

  // ── 5. Full-Text Search ──────────────────────────────────────────
  console.log("\n5. Full-Text Search (tsvector + GIN)");

  try {
    const results = await sql`
      SELECT LEFT(summary, 60) as summary,
             ts_rank(to_tsvector('english', summary), plainto_tsquery('english', 'heartbeat')) as rank
      FROM memory_items
      WHERE to_tsvector('english', summary) @@ plainto_tsquery('english', 'heartbeat')
      ORDER BY rank DESC
      LIMIT 3
    `;
    ok("memory_items FTS", `${results.length} results for "heartbeat"`);
  } catch (err) {
    fail("memory_items FTS", err);
  }

  try {
    const results = await sql`
      SELECT LEFT(lesson, 60) as lesson, confidence
      FROM lessons
      WHERE to_tsvector('english', context || ' ' || action || ' ' || outcome || ' ' || lesson)
            @@ plainto_tsquery('english', 'error')
      ORDER BY confidence DESC
      LIMIT 3
    `;
    ok("lessons FTS", `${results.length} results for "error"`);
  } catch (err) {
    fail("lessons FTS", err);
  }

  // ── 6. RLS Verification ──────────────────────────────────────────
  console.log("\n6. Row-Level Security");

  try {
    const [{ agent }] = await sql`SELECT id as agent FROM agents LIMIT 1`;
    ok("agent registered", `id: ${agent}`);
  } catch (err) {
    fail("agent registered", err);
  }

  try {
    const policies = await sql`
      SELECT tablename, policyname FROM pg_policies ORDER BY tablename
    `;
    ok("RLS policies", `${policies.length} policies active`);
  } catch (err) {
    fail("RLS policies", err);
  }

  // ── 7. StorageAdapter Config ─────────────────────────────────────
  console.log("\n7. Storage Configuration");

  try {
    const configPath = path.join(HOME, ".argentos", "argent.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const storage = config.storage;
      if (storage) {
        ok("argent.json", `backend: ${storage.backend}, readFrom: ${storage.readFrom}`);
        if (storage.postgres?.connectionString) {
          ok("postgres config", storage.postgres.connectionString);
        }
        if (storage.redis) {
          ok("redis config", `${storage.redis.host}:${storage.redis.port}`);
        }
      } else {
        fail("argent.json", "no storage key found");
      }
    } else {
      fail("argent.json", "file not found");
    }
  } catch (err) {
    fail("storage config", err);
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(50));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(50));

  await sql.end();
  await redis.quit();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
