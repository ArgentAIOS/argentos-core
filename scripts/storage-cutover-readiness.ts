/**
 * Storage Cutover Readiness (SQLite -> PostgreSQL)
 *
 * Purpose: verify PostgreSQL contains all SQLite records needed for cutover.
 * Unlike simple count parity, this treats PostgreSQL supersets as acceptable.
 *
 * Usage:
 *   node --import tsx scripts/storage-cutover-readiness.ts
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { resolvePostgresUrl } from "../src/data/storage-resolver.js";

type CheckResult = {
  name: string;
  sqliteCount: number;
  pgCount: number;
  missingInPg: number;
  notes?: string;
};

function resolveStateDir(): string {
  if (process.env.ARGENT_STATE_DIR) return process.env.ARGENT_STATE_DIR;
  return path.join(process.env.HOME ?? "", ".argentos");
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function dbContainsTable(dbPath: string, table: string): boolean {
  if (!fs.existsSync(dbPath)) return false;
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(table) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

function pickDbPath(candidates: string[], requiredTable: string): string | null {
  for (const p of candidates) {
    if (dbContainsTable(p, requiredTable)) return p;
  }
  return firstExisting(candidates);
}

function setDiffCount(source: Set<string>, target: Set<string>): number {
  let missing = 0;
  for (const key of source) {
    if (!target.has(key)) missing++;
  }
  return missing;
}

function rowsToSet(rows: Array<Record<string, unknown>>, key: string): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    const raw = row[key];
    if (raw !== null && raw !== undefined) out.add(String(raw));
  }
  return out;
}

async function main() {
  const stateDir = resolveStateDir();
  const memoryDbPath = pickDbPath(
    [path.join(stateDir, "data", "memo.db"), path.join(stateDir, "memory.db")],
    "memory_items",
  );
  const dashboardDbPath = pickDbPath(
    [path.join(stateDir, "data", "dashboard.db"), path.join(stateDir, "dashboard.db")],
    "tasks",
  );

  if (!memoryDbPath) throw new Error("memory.db not found");
  if (!dashboardDbPath) throw new Error("dashboard.db not found");

  const pgUrl = resolvePostgresUrl();

  const memoryDb = new Database(memoryDbPath, { readonly: true });
  const dashboardDb = new Database(dashboardDbPath, { readonly: true });
  const pg = postgres(pgUrl, { max: 3, idle_timeout: 5, connect_timeout: 5 });

  const results: CheckResult[] = [];

  try {
    await pg`SELECT 1`;

    // ID-keyed tables (exact row identity by ID)
    const idTables: Array<{ name: string; sqliteDb: Database.Database; pgTable: string }> = [
      { name: "resources", sqliteDb: memoryDb, pgTable: "resources" },
      { name: "memory_items", sqliteDb: memoryDb, pgTable: "memory_items" },
      { name: "memory_categories", sqliteDb: memoryDb, pgTable: "memory_categories" },
      { name: "reflections", sqliteDb: memoryDb, pgTable: "reflections" },
      { name: "lessons", sqliteDb: memoryDb, pgTable: "lessons" },
      { name: "model_feedback", sqliteDb: memoryDb, pgTable: "model_feedback" },
      { name: "tasks", sqliteDb: dashboardDb, pgTable: "tasks" },
      { name: "teams", sqliteDb: dashboardDb, pgTable: "teams" },
    ];

    for (const t of idTables) {
      const sqliteRows = t.sqliteDb.prepare(`SELECT id FROM ${t.name}`).all() as Array<{
        id: string;
      }>;
      const pgRows = (await pg`SELECT id FROM ${pg(t.pgTable)}`) as Array<{ id: string }>;
      const sqliteSet = new Set(sqliteRows.map((r) => String(r.id)));
      const pgSet = new Set(pgRows.map((r) => String(r.id)));
      results.push({
        name: t.name,
        sqliteCount: sqliteSet.size,
        pgCount: pgSet.size,
        missingInPg: setDiffCount(sqliteSet, pgSet),
      });
    }

    // entities: compare by semantic identity (name), not ID
    {
      const sqliteRows = memoryDb.prepare("SELECT name FROM entities").all() as Array<{
        name: string;
      }>;
      const pgRows = (await pg`SELECT name FROM entities`) as Array<{ name: string }>;
      const sqliteSet = new Set(sqliteRows.map((r) => String(r.name)));
      const pgSet = new Set(pgRows.map((r) => String(r.name)));
      results.push({
        name: "entities(name)",
        sqliteCount: sqliteSet.size,
        pgCount: pgSet.size,
        missingInPg: setDiffCount(sqliteSet, pgSet),
        notes: "semantic compare by name",
      });
    }

    // category_items: compare by composite key
    {
      const sqliteRows = memoryDb
        .prepare("SELECT item_id || '|' || category_id AS k FROM category_items")
        .all() as Array<Record<string, unknown>>;
      const pgRows =
        (await pg`SELECT item_id || '|' || category_id AS k FROM category_items`) as Array<
          Record<string, unknown>
        >;
      const sqliteSet = rowsToSet(sqliteRows, "k");
      const pgSet = rowsToSet(pgRows, "k");
      results.push({
        name: "category_items(item|category)",
        sqliteCount: sqliteSet.size,
        pgCount: pgSet.size,
        missingInPg: setDiffCount(sqliteSet, pgSet),
      });
    }

    // item_entities: compare by semantic identity (item_id + entity_name)
    {
      const sqliteRows = memoryDb
        .prepare(
          `SELECT ie.item_id || '|' || e.name AS k
           FROM item_entities ie
           JOIN entities e ON e.id = ie.entity_id`,
        )
        .all() as Array<Record<string, unknown>>;
      const pgRows = (await pg`
        SELECT ie.item_id || '|' || e.name AS k
        FROM item_entities ie
        JOIN entities e ON e.id = ie.entity_id
      `) as Array<Record<string, unknown>>;
      const sqliteSet = rowsToSet(sqliteRows, "k");
      const pgSet = rowsToSet(pgRows, "k");
      results.push({
        name: "item_entities(item|entity_name)",
        sqliteCount: sqliteSet.size,
        pgCount: pgSet.size,
        missingInPg: setDiffCount(sqliteSet, pgSet),
        notes: "semantic compare by entity name",
      });
    }
  } finally {
    memoryDb.close();
    dashboardDb.close();
    await pg.end({ timeout: 2 });
  }

  const failing = results.filter((r) => r.missingInPg > 0);

  console.log("=== Storage Cutover Readiness ===");
  console.log(`stateDir: ${stateDir}`);
  console.log(`memoryDb: ${memoryDbPath}`);
  console.log(`dashboardDb: ${dashboardDbPath}`);
  console.log(`pgUrl: ${pgUrl}`);
  console.log("");

  for (const r of results) {
    const tag = r.missingInPg === 0 ? "OK" : "MISS";
    const note = r.notes ? ` (${r.notes})` : "";
    console.log(
      `[${tag}] ${r.name.padEnd(32)} sqlite=${r.sqliteCount} pg=${r.pgCount} missing_in_pg=${r.missingInPg}${note}`,
    );
  }

  console.log("");
  console.log(`Summary: checks=${results.length} failing=${failing.length}`);
  console.log(`CUTOVER_READY=${failing.length === 0 ? "YES" : "NO"}`);

  process.exit(failing.length === 0 ? 0 : 2);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
