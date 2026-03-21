/**
 * Freeze Memory State Snapshot
 *
 * Creates a point-in-time backup for all memory surfaces before migration/cutover:
 * - SQLite state DBs (memory.db, dashboard.db, memo.db, observations.db)
 * - File-based memory trees (~/.argentos/memory, ~/argent/memory)
 * - Config snapshot (argent.json)
 * - PostgreSQL dump + row-count manifest (when configured)
 *
 * Usage:
 *   node --import tsx scripts/freeze-memory-state.ts
 *   node --import tsx scripts/freeze-memory-state.ts --skip-pg-dump
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";

type SnapshotEntry = {
  source: string;
  destination: string;
  type: "file" | "directory";
  bytes: number;
  sha256?: string;
};

type PgSnapshot = {
  enabled: boolean;
  connectionString?: string;
  dumpPath?: string;
  dumpError?: string;
  dumpCommand?: string;
  countsPath?: string;
  countError?: string;
};

function timestamp(): string {
  return new Date().toISOString().replace(/[:]/g, "-").replace(/\..+$/, "");
}

function exists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function safeMkdir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function fileSize(p: string): number {
  return fs.statSync(p).size;
}

function dirSize(p: string): number {
  let total = 0;
  const stack = [p];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const children = fs.readdirSync(current);
      for (const child of children) stack.push(path.join(current, child));
    } else {
      total += stat.size;
    }
  }
  return total;
}

function hashFileSha256(p: string): string {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(p);
  hash.update(data);
  return hash.digest("hex");
}

function copyFileIfExists(
  source: string,
  destination: string,
  entries: SnapshotEntry[],
  hash: boolean,
): void {
  if (!exists(source)) return;
  safeMkdir(path.dirname(destination));
  fs.copyFileSync(source, destination);
  entries.push({
    source,
    destination,
    type: "file",
    bytes: fileSize(destination),
    sha256: hash ? hashFileSha256(destination) : undefined,
  });
}

function copyDirIfExists(source: string, destination: string, entries: SnapshotEntry[]): void {
  if (!exists(source)) return;
  safeMkdir(path.dirname(destination));
  fs.cpSync(source, destination, { recursive: true, force: true });
  entries.push({
    source,
    destination,
    type: "directory",
    bytes: dirSize(destination),
  });
}

function copySqliteWithWalShm(
  dbPath: string,
  destBaseDir: string,
  entries: SnapshotEntry[],
  hash: boolean,
): void {
  const base = path.basename(dbPath);
  copyFileIfExists(dbPath, path.join(destBaseDir, base), entries, hash);
  copyFileIfExists(`${dbPath}-wal`, path.join(destBaseDir, `${base}-wal`), entries, hash);
  copyFileIfExists(`${dbPath}-shm`, path.join(destBaseDir, `${base}-shm`), entries, hash);
}

function readArgentConfig(stateDir: string): { configPath: string; raw: any | null } {
  const configPath = path.join(stateDir, "argent.json");
  if (!exists(configPath)) {
    return { configPath, raw: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return { configPath, raw: parsed };
  } catch {
    return { configPath, raw: null };
  }
}

function commandExists(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolvePgDumpCommand(): string | null {
  const preferred = [
    "/opt/homebrew/opt/postgresql@17/bin/pg_dump",
    "/usr/local/opt/postgresql@17/bin/pg_dump",
  ];
  for (const candidate of preferred) {
    if (exists(candidate)) return candidate;
  }
  if (commandExists("pg_dump")) return "pg_dump";
  return null;
}

async function snapshotPostgres(
  outputDir: string,
  config: any | null,
  skipPgDump: boolean,
): Promise<PgSnapshot> {
  const result: PgSnapshot = { enabled: false };
  const connectionString =
    process.env.ARGENT_PG_URL ??
    process.env.PG_URL ??
    config?.storage?.postgres?.connectionString ??
    null;

  if (!connectionString || typeof connectionString !== "string") {
    result.dumpError = "No PostgreSQL connection string configured";
    result.countError = "No PostgreSQL connection string configured";
    return result;
  }

  result.enabled = true;
  result.connectionString = connectionString;

  const pgDir = path.join(outputDir, "postgres");
  safeMkdir(pgDir);

  if (!skipPgDump) {
    const pgDumpCmd = resolvePgDumpCommand();
    if (!pgDumpCmd) {
      result.dumpError = "pg_dump not found in PATH";
    } else {
      const dumpPath = path.join(pgDir, "argentos.pg_dump");
      try {
        execFileSync(pgDumpCmd, ["--format=custom", "--file", dumpPath, connectionString], {
          stdio: "pipe",
        });
        result.dumpPath = dumpPath;
        result.dumpCommand = pgDumpCmd;
      } catch (err) {
        result.dumpCommand = pgDumpCmd;
        result.dumpError = String(err);
      }
    }
  }

  try {
    const sql = postgres(connectionString, { max: 2, idle_timeout: 5, connect_timeout: 5 });
    const tables = [
      "resources",
      "memory_items",
      "memory_categories",
      "entities",
      "item_entities",
      "category_items",
      "reflections",
      "lessons",
      "model_feedback",
      "tasks",
      "teams",
    ];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const rows = await sql`SELECT count(*)::int AS c FROM ${sql(table)}`;
      counts[table] = Number(rows[0]?.c ?? 0);
    }
    await sql.end({ timeout: 2 });
    const countsPath = path.join(pgDir, "row-counts.json");
    fs.writeFileSync(
      countsPath,
      JSON.stringify({ generatedAt: new Date().toISOString(), counts }, null, 2),
      "utf8",
    );
    result.countsPath = countsPath;
  } catch (err) {
    result.countError = String(err);
  }

  return result;
}

function parseArgs(argv: string[]): { skipPgDump: boolean; noHash: boolean } {
  return {
    skipPgDump: argv.includes("--skip-pg-dump"),
    noHash: argv.includes("--no-hash"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const home = process.env.HOME ?? os.homedir();
  const stateDir = process.env.ARGENT_STATE_DIR ?? path.join(home, ".argentos");
  const workspaceDir = process.env.ARGENT_WORKSPACE_DIR ?? path.join(home, "argent");

  const snapshotRoot = path.join(stateDir, "backups", "freeze");
  const snapshotId = `memory-freeze-${timestamp()}`;
  const snapshotDir = path.join(snapshotRoot, snapshotId);
  safeMkdir(snapshotDir);

  const entries: SnapshotEntry[] = [];
  const doHash = !args.noHash;

  const { configPath, raw: argentConfig } = readArgentConfig(stateDir);

  // Config snapshot
  copyFileIfExists(configPath, path.join(snapshotDir, "config", "argent.json"), entries, doHash);

  // SQLite surfaces
  const sqliteDir = path.join(snapshotDir, "sqlite");
  safeMkdir(sqliteDir);
  copySqliteWithWalShm(path.join(stateDir, "memory.db"), sqliteDir, entries, doHash);
  copySqliteWithWalShm(path.join(stateDir, "observations.db"), sqliteDir, entries, doHash);
  copySqliteWithWalShm(path.join(stateDir, "data", "dashboard.db"), sqliteDir, entries, doHash);
  copySqliteWithWalShm(path.join(stateDir, "data", "memo.db"), sqliteDir, entries, doHash);
  copySqliteWithWalShm(path.join(workspaceDir, "memory", "canvas.db"), sqliteDir, entries, doHash);

  // File-based memory surfaces
  copyDirIfExists(
    path.join(stateDir, "memory"),
    path.join(snapshotDir, "files", "state-memory"),
    entries,
  );
  copyDirIfExists(
    path.join(workspaceDir, "memory"),
    path.join(snapshotDir, "files", "workspace-memory"),
    entries,
  );

  // PG snapshot
  const pg = await snapshotPostgres(snapshotDir, argentConfig, args.skipPgDump);

  const totalBytes = entries.reduce((acc, entry) => acc + entry.bytes, 0);
  const manifest = {
    id: snapshotId,
    generatedAt: new Date().toISOString(),
    stateDir,
    workspaceDir,
    totalEntries: entries.length,
    totalBytes,
    hashAlgorithm: doHash ? "sha256" : null,
    entries,
    postgres: pg,
  };

  const manifestPath = path.join(snapshotDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log("Memory freeze snapshot complete");
  console.log(`snapshot: ${snapshotDir}`);
  console.log(`manifest: ${manifestPath}`);
  console.log(`entries: ${entries.length}`);
  console.log(`bytes: ${totalBytes}`);
  if (pg.enabled) {
    if (pg.dumpPath) console.log(`pg_dump: ${pg.dumpPath}`);
    if (pg.dumpError) console.log(`pg_dump_error: ${pg.dumpError}`);
    if (pg.countsPath) console.log(`pg_counts: ${pg.countsPath}`);
    if (pg.countError) console.log(`pg_count_error: ${pg.countError}`);
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
