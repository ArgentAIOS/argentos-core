/**
 * Apps Database Module
 *
 * SQLite-backed app storage for the ArgentOS App Forge.
 * Stores AI-generated micro-apps (HTML/JS/CSS) with metadata.
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

// Use the unified ArgentOS data directory
const DATA_DIR = path.join(process.env.HOME, ".argentos", "data");
const DB_PATH = path.join(DATA_DIR, "dashboard.db");

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create schema
const initSchema = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      code TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      creator TEXT DEFAULT 'ai',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_opened_at INTEGER,
      open_count INTEGER DEFAULT 0,
      pinned INTEGER DEFAULT 0,
      deleted_at INTEGER,
      metadata TEXT
    )
  `);

  // Indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_apps_created ON apps(created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_apps_pinned ON apps(pinned DESC, updated_at DESC)`);

  // FTS for app search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS apps_fts USING fts5(
      app_id,
      name,
      description
    )
  `);

  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS apps_ai AFTER INSERT ON apps BEGIN
      INSERT INTO apps_fts(app_id, name, description)
      VALUES (new.id, new.name, new.description);
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS apps_ad AFTER DELETE ON apps BEGIN
      DELETE FROM apps_fts WHERE app_id = old.id;
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS apps_au AFTER UPDATE ON apps BEGIN
      UPDATE apps_fts SET
        name = new.name,
        description = new.description
      WHERE app_id = old.id;
    END
  `);

  console.log("[AppsDB] Schema initialized at", DB_PATH);
};

initSchema();

// ============================================================================
// Helper functions
// ============================================================================

function rowToApp(row, includeCode = false) {
  if (!row) return null;

  const app = {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    icon: row.icon || undefined,
    version: row.version,
    creator: row.creator,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    lastOpenedAt: row.last_opened_at ? new Date(row.last_opened_at).toISOString() : undefined,
    openCount: row.open_count || 0,
    pinned: row.pinned === 1,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };

  if (includeCode) {
    app.code = row.code;
  }

  return app;
}

// ============================================================================
// CRUD Operations
// ============================================================================

// List all apps (without code field for speed)
function listApps(options = {}) {
  const { limit = 100, includeDeleted = false, includeCode = false } = options;

  let sql = "SELECT * FROM apps";
  const params = [];

  if (!includeDeleted) {
    sql += " WHERE deleted_at IS NULL";
  }

  sql += " ORDER BY pinned DESC, updated_at DESC";

  if (limit) {
    sql += " LIMIT ?";
    params.push(limit);
  }

  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => rowToApp(row, includeCode));
}

// Get a single app (with full code)
function getApp(id) {
  const row = db.prepare("SELECT * FROM apps WHERE id = ? AND deleted_at IS NULL").get(id);
  return rowToApp(row, true);
}

// Create a new app
function createApp({ name, description, icon, code, creator = "ai", metadata }) {
  const id = randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO apps (id, name, description, icon, code, creator, created_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    description || null,
    icon || null,
    code,
    creator,
    now,
    now,
    metadata ? JSON.stringify(metadata) : null,
  );

  return getApp(id);
}

// Update an app
function updateApp(id, updates) {
  const existing = getApp(id);
  if (!existing) return null;

  const now = Date.now();
  const sets = ["updated_at = ?"];
  const params = [now];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }

  if (updates.description !== undefined) {
    sets.push("description = ?");
    params.push(updates.description || null);
  }

  if (updates.icon !== undefined) {
    sets.push("icon = ?");
    params.push(updates.icon || null);
  }

  if (updates.code !== undefined) {
    sets.push("code = ?");
    params.push(updates.code);
    // Increment version on code change
    sets.push("version = version + 1");
  }

  if (updates.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
  }

  params.push(id);

  db.prepare(`UPDATE apps SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getApp(id);
}

// Soft delete an app
function deleteApp(id) {
  const now = Date.now();
  const result = db
    .prepare("UPDATE apps SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .run(now, now, id);
  return result.changes > 0;
}

// Record an app open (increment counter + update timestamp)
function recordOpen(id) {
  const now = Date.now();
  const result = db
    .prepare(
      "UPDATE apps SET open_count = open_count + 1, last_opened_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    )
    .run(now, now, id);
  return result.changes > 0;
}

// Toggle pin status
function pinApp(id) {
  const app = getApp(id);
  if (!app) return null;

  const newPinned = app.pinned ? 0 : 1;
  const now = Date.now();
  db.prepare("UPDATE apps SET pinned = ?, updated_at = ? WHERE id = ?").run(newPinned, now, id);

  return getApp(id);
}

// Search apps via FTS
function searchApps(query, limit = 20) {
  try {
    const sql = `
      SELECT a.* FROM apps a
      JOIN apps_fts fts ON a.id = fts.app_id
      WHERE apps_fts MATCH ? AND a.deleted_at IS NULL
      ORDER BY rank
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(query, limit);
    return rows.map((row) => rowToApp(row, false));
  } catch (err) {
    // Fallback to LIKE search
    const pattern = `%${query}%`;
    const rows = db
      .prepare(`
      SELECT * FROM apps
      WHERE (name LIKE ? OR description LIKE ?) AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT ?
    `)
      .all(pattern, pattern, limit);
    return rows.map((row) => rowToApp(row, false));
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  db,
  listApps,
  getApp,
  createApp,
  updateApp,
  deleteApp,
  recordOpen,
  pinApp,
  searchApps,
  DB_PATH,
};
