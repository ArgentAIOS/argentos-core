/**
 * aos-lcm — SQLite connection management
 *
 * LCM uses its own standalone SQLite database, separate from MemU's PG.
 * Path defaults to ~/.argentos/lcm.db.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

let _db: Database.Database | null = null;

export function resolveDbPath(configPath?: string): string {
  if (configPath) return resolve(configPath.replace(/^~/, homedir()));
  const stateDir = resolve(homedir(), ".argentos");
  mkdirSync(stateDir, { recursive: true });
  return resolve(stateDir, "lcm.db");
}

export function getDb(configPath?: string): Database.Database {
  if (_db) return _db;
  const dbPath = resolveDbPath(configPath);
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  runMigrations(_db);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lcm_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const version = getSchemaVersion(db);

  if (version < 1) {
    db.exec(MIGRATION_001);
    setSchemaVersion(db, 1);
  }
}

function getSchemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM lcm_meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

function setSchemaVersion(db: Database.Database, version: number): void {
  db.prepare("INSERT OR REPLACE INTO lcm_meta (key, value) VALUES ('schema_version', ?)").run(
    String(version),
  );
}

// ============================================================================
// Migration 001 — Initial schema
// ============================================================================

const MIGRATION_001 = `
  -- Immutable message store
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content     TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    tool_call_id TEXT,
    content_blocks TEXT,  -- JSON array of ContentBlock
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id, id);

  -- FTS5 over immutable messages for lcm_grep
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='id',
    tokenize='porter unicode61'
  );

  -- Triggers to keep FTS in sync
  CREATE TRIGGER IF NOT EXISTS messages_fts_insert
    AFTER INSERT ON messages
  BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_fts_delete
    AFTER DELETE ON messages
  BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
      VALUES ('delete', old.id, old.content);
  END;

  -- Summary DAG nodes
  CREATE TABLE IF NOT EXISTS summaries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    depth       INTEGER NOT NULL DEFAULT 0,
    content     TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    condensed   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_summaries_session_depth
    ON summaries(session_id, depth, condensed);

  -- Join table: summary → source messages (depth 0)
  CREATE TABLE IF NOT EXISTS summary_messages (
    summary_id  INTEGER NOT NULL REFERENCES summaries(id),
    message_id  INTEGER NOT NULL REFERENCES messages(id),
    PRIMARY KEY (summary_id, message_id)
  );

  -- Join table: summary → source summaries (depth 1+)
  CREATE TABLE IF NOT EXISTS summary_sources (
    summary_id  INTEGER NOT NULL REFERENCES summaries(id),
    source_id   INTEGER NOT NULL REFERENCES summaries(id),
    PRIMARY KEY (summary_id, source_id)
  );

  -- Context items: what's currently in the active context window
  CREATE TABLE IF NOT EXISTS context_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK(kind IN ('message', 'summary')),
    ref_id      INTEGER NOT NULL,  -- points to messages.id or summaries.id
    position    INTEGER NOT NULL,  -- ordering in the context window
    UNIQUE(session_id, position)
  );

  CREATE INDEX IF NOT EXISTS idx_context_items_session
    ON context_items(session_id, position);

  -- Large file external storage
  CREATE TABLE IF NOT EXISTS large_files (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id          TEXT NOT NULL,
    file_path           TEXT NOT NULL,
    token_count         INTEGER NOT NULL,
    exploration_summary TEXT NOT NULL,
    content_hash        TEXT,
    stored_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_large_files_session
    ON large_files(session_id);
`;
