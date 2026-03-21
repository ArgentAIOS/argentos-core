/**
 * Storage Parity Report (SQLite vs PostgreSQL)
 *
 * One-command readiness gate for dual-write cutover.
 *
 * Usage:
 *   node --import tsx scripts/storage-parity-report.ts
 *   node --import tsx scripts/storage-parity-report.ts --agent main
 *   node --import tsx scripts/storage-parity-report.ts --json
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { resolvePostgresUrl } from "../src/data/storage-resolver.js";

type DbKind = "memo" | "dashboard";

type TableSpec = {
  name: string;
  db: DbKind;
};

type TableResult = {
  table: string;
  db: DbKind;
  status: "ok" | "diff" | "missing" | "error";
  sqliteCount?: number;
  pgCount?: number;
  delta?: number;
  sqliteLatest?: string | null;
  pgLatest?: string | null;
  detail?: string;
};

const TABLES: TableSpec[] = [
  { name: "resources", db: "memo" },
  { name: "memory_items", db: "memo" },
  { name: "memory_categories", db: "memo" },
  { name: "entities", db: "memo" },
  { name: "reflections", db: "memo" },
  { name: "lessons", db: "memo" },
  { name: "model_feedback", db: "memo" },
  { name: "category_items", db: "memo" },
  { name: "item_entities", db: "memo" },
  { name: "tasks", db: "dashboard" },
  { name: "teams", db: "dashboard" },
];

const TIME_COLUMNS = ["updated_at", "created_at", "last_reinforced_at", "last_seen"] as const;

function parseArgs(argv: string[]): { agent?: string; json: boolean } {
  let agent: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--agent" && argv[i + 1]) {
      agent = argv[i + 1];
      i++;
      continue;
    }
    if (arg.startsWith("--agent=")) {
      agent = arg.slice("--agent=".length);
    }
  }
  return { agent, json };
}

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

function selectBestSqlitePath(candidates: string[], requiredTable: string): string | null {
  for (const p of candidates) {
    if (dbContainsTable(p, requiredTable)) return p;
  }
  return firstExisting(candidates);
}

function resolveSqlitePaths(stateDir: string): { memo: string | null; dashboard: string | null } {
  // New layout first, then legacy layout.
  const memo = selectBestSqlitePath(
    [path.join(stateDir, "data", "memo.db"), path.join(stateDir, "memory.db")],
    "memory_items",
  );
  const dashboard = selectBestSqlitePath(
    [path.join(stateDir, "data", "dashboard.db"), path.join(stateDir, "dashboard.db")],
    "tasks",
  );
  return { memo, dashboard };
}

function sqliteColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function sqliteHasTable(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { name?: string } | undefined;
  return !!row?.name;
}

async function pgColumns(sql: ReturnType<typeof postgres>, table: string): Promise<Set<string>> {
  const rows = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return new Set(rows.map((r) => String((r as { column_name: string }).column_name)));
}

async function pgHasTable(sql: ReturnType<typeof postgres>, table: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${table}
    LIMIT 1
  `;
  return rows.length > 0;
}

function pickTimeColumn(columns: Set<string>): string | null {
  for (const col of TIME_COLUMNS) {
    if (columns.has(col)) return col;
  }
  return null;
}

function toNum(input: unknown): number {
  if (typeof input === "number") return input;
  if (typeof input === "bigint") return Number(input);
  if (typeof input === "string") return Number(input);
  return 0;
}

function fmtTs(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length > 0 ? s : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stateDir = resolveStateDir();
  const sqlitePaths = resolveSqlitePaths(stateDir);
  const pgUrl = resolvePostgresUrl();

  const memoDb = sqlitePaths.memo ? new Database(sqlitePaths.memo, { readonly: true }) : null;
  const dashboardDb = sqlitePaths.dashboard
    ? new Database(sqlitePaths.dashboard, { readonly: true })
    : null;
  const pg = postgres(pgUrl, { max: 3, idle_timeout: 5, connect_timeout: 5 });

  const results: TableResult[] = [];
  let infraError = false;

  try {
    try {
      await pg`SELECT 1`;
    } catch (err) {
      infraError = true;
      results.push({
        table: "_postgres",
        db: "memo",
        status: "error",
        detail: `postgres unavailable: ${String(err)}`,
      });
    }

    for (const spec of TABLES) {
      const sqliteDb = spec.db === "memo" ? memoDb : dashboardDb;
      if (!sqliteDb) {
        results.push({
          table: spec.name,
          db: spec.db,
          status: "missing",
          detail: `${spec.db}.db not found in state dir`,
        });
        continue;
      }

      try {
        const sqliteTableExists = sqliteHasTable(sqliteDb, spec.name);
        const pgTableExists = await pgHasTable(pg, spec.name);

        if (!sqliteTableExists || !pgTableExists) {
          results.push({
            table: spec.name,
            db: spec.db,
            status: "missing",
            detail: `table present sqlite=${sqliteTableExists} pg=${pgTableExists}`,
          });
          continue;
        }

        const sqliteCols = sqliteColumns(sqliteDb, spec.name);
        const pgCols = await pgColumns(pg, spec.name);
        const sqliteHasAgent = sqliteCols.has("agent_id");
        const pgHasAgent = pgCols.has("agent_id");
        const sqliteTimeCol = pickTimeColumn(sqliteCols);
        const pgTimeCol = pickTimeColumn(pgCols);

        let sqliteCount = 0;
        let sqliteLatest: string | null = null;
        if (args.agent && sqliteHasAgent) {
          sqliteCount = toNum(
            (
              sqliteDb
                .prepare(`SELECT COUNT(*) AS c FROM ${spec.name} WHERE agent_id = ?`)
                .get(args.agent) as { c: unknown }
            ).c,
          );
          if (sqliteTimeCol) {
            sqliteLatest = fmtTs(
              (
                sqliteDb
                  .prepare(
                    `SELECT MAX(${sqliteTimeCol}) AS ts FROM ${spec.name} WHERE agent_id = ?`,
                  )
                  .get(args.agent) as { ts: unknown }
              ).ts,
            );
          }
        } else {
          sqliteCount = toNum(
            (sqliteDb.prepare(`SELECT COUNT(*) AS c FROM ${spec.name}`).get() as { c: unknown }).c,
          );
          if (sqliteTimeCol) {
            sqliteLatest = fmtTs(
              (
                sqliteDb.prepare(`SELECT MAX(${sqliteTimeCol}) AS ts FROM ${spec.name}`).get() as {
                  ts: unknown;
                }
              ).ts,
            );
          }
        }

        let pgCount = 0;
        let pgLatest: string | null = null;
        if (args.agent && pgHasAgent) {
          const pgCountRow = await pg`
            SELECT COUNT(*)::bigint AS c
            FROM ${pg(spec.name)}
            WHERE agent_id = ${args.agent}
          `;
          pgCount = toNum((pgCountRow[0] as { c: unknown }).c);
          if (pgTimeCol) {
            const pgLatestRow = await pg`
              SELECT MAX(${pg(pgTimeCol)}) AS ts
              FROM ${pg(spec.name)}
              WHERE agent_id = ${args.agent}
            `;
            pgLatest = fmtTs((pgLatestRow[0] as { ts: unknown }).ts);
          }
        } else {
          const pgCountRow = await pg`
            SELECT COUNT(*)::bigint AS c
            FROM ${pg(spec.name)}
          `;
          pgCount = toNum((pgCountRow[0] as { c: unknown }).c);
          if (pgTimeCol) {
            const pgLatestRow = await pg`
              SELECT MAX(${pg(pgTimeCol)}) AS ts
              FROM ${pg(spec.name)}
            `;
            pgLatest = fmtTs((pgLatestRow[0] as { ts: unknown }).ts);
          }
        }

        const delta = pgCount - sqliteCount;
        results.push({
          table: spec.name,
          db: spec.db,
          status: delta === 0 ? "ok" : "diff",
          sqliteCount,
          pgCount,
          delta,
          sqliteLatest,
          pgLatest,
          detail:
            args.agent && !(sqliteHasAgent && pgHasAgent)
              ? "agent filter requested but no agent_id on one side (used global count)"
              : undefined,
        });
      } catch (err) {
        results.push({
          table: spec.name,
          db: spec.db,
          status: "error",
          detail: String(err),
        });
      }
    }
  } finally {
    memoDb?.close();
    dashboardDb?.close();
    await pg.end({ timeout: 2 });
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const diffCount = results.filter((r) => r.status === "diff").length;
  const missingCount = results.filter((r) => r.status === "missing").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const cutoverReady = !infraError && diffCount === 0 && missingCount === 0 && errorCount === 0;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          stateDir,
          sqlitePaths,
          pgUrl,
          agent: args.agent ?? null,
          summary: {
            ok: okCount,
            diff: diffCount,
            missing: missingCount,
            error: errorCount,
            cutoverReady,
          },
          results,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("=== Storage Parity Report (SQLite vs PostgreSQL) ===");
    console.log(`stateDir: ${stateDir}`);
    console.log(`memoDb: ${sqlitePaths.memo ?? "MISSING"}`);
    console.log(`dashboardDb: ${sqlitePaths.dashboard ?? "MISSING"}`);
    console.log(`pgUrl: ${pgUrl}`);
    if (args.agent) console.log(`agent filter: ${args.agent}`);
    console.log("");

    for (const r of results) {
      const tag =
        r.status === "ok"
          ? "OK"
          : r.status === "diff"
            ? "DIFF"
            : r.status === "missing"
              ? "MISS"
              : "ERR";
      const counts =
        typeof r.sqliteCount === "number" && typeof r.pgCount === "number"
          ? `sqlite=${r.sqliteCount} pg=${r.pgCount} delta=${r.delta}`
          : "";
      const latest =
        r.sqliteLatest !== undefined || r.pgLatest !== undefined
          ? ` latest(sqlite=${r.sqliteLatest ?? "-"}, pg=${r.pgLatest ?? "-"})`
          : "";
      const detail = r.detail ? ` ${r.detail}` : "";
      console.log(`[${tag}] ${r.table.padEnd(16)} ${counts}${latest}${detail}`.trimEnd());
    }

    console.log("");
    console.log(
      `Summary: ok=${okCount} diff=${diffCount} missing=${missingCount} error=${errorCount}`,
    );
    console.log(`CUTOVER_READY=${cutoverReady ? "YES" : "NO"}`);
  }

  process.exit(cutoverReady ? 0 : 2);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
