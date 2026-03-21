/**
 * Widgets Database Module
 *
 * SQLite-backed widget storage for the ArgentOS Dashboard.
 * Stores AI-generated custom widgets (HTML/CSS/JS) with metadata.
 * Also manages widget-to-slot assignments.
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

// Use the unified ArgentOS data directory
const DATA_DIR = path.join(process.env.HOME, ".argentos", "data");
const DB_PATH = path.join(DATA_DIR, "dashboard.db");
const CUSTOM_WIDGETS_DIR = path.join(process.env.HOME, ".argentos", "widgets", "custom");

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(CUSTOM_WIDGETS_DIR)) {
  fs.mkdirSync(CUSTOM_WIDGETS_DIR, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create schema
const initSchema = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS widgets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '📦',
      code TEXT,
      version INTEGER DEFAULT 1,
      creator TEXT DEFAULT 'ai',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      metadata TEXT
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_widgets_created ON widgets(created_at DESC)`);

  // Widget slot assignments (position 1-7 → widget id)
  db.exec(`
    CREATE TABLE IF NOT EXISTS widget_slots (
      position INTEGER PRIMARY KEY CHECK(position BETWEEN 1 AND 7),
      widget_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Add file_path column if it doesn't exist (migration)
  const cols = db.prepare("PRAGMA table_info(widgets)").all();
  if (!cols.some((c) => c.name === "file_path")) {
    db.exec("ALTER TABLE widgets ADD COLUMN file_path TEXT");
    console.log("[WidgetsDB] Added file_path column");
  }

  // Drop NOT NULL constraint on code column if present (allows filesystem-only storage)
  const codeCol = cols.find((c) => c.name === "code");
  if (codeCol && codeCol.notnull) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS widgets_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT DEFAULT '📦',
        code TEXT,
        version INTEGER DEFAULT 1,
        creator TEXT DEFAULT 'ai',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        metadata TEXT,
        file_path TEXT
      );
      INSERT INTO widgets_new SELECT id, name, description, icon, code, version, creator, created_at, updated_at, deleted_at, metadata, file_path FROM widgets;
      DROP TABLE widgets;
      ALTER TABLE widgets_new RENAME TO widgets;
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_widgets_created ON widgets(created_at DESC)");
    console.log("[WidgetsDB] Migrated code column to nullable");
  }

  console.log("[WidgetsDB] Schema initialized at", DB_PATH);
};

initSchema();

// ============================================================================
// Helper functions
// ============================================================================

function rowToWidget(row, includeCode = false) {
  if (!row) return null;

  const widget = {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    icon: row.icon || "📦",
    version: row.version,
    creator: row.creator,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    filePath: row.file_path || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };

  if (includeCode) {
    // Read code from filesystem if file_path is set, fall back to DB code column
    if (row.file_path && fs.existsSync(row.file_path)) {
      widget.code = fs.readFileSync(row.file_path, "utf-8");
    } else {
      widget.code = row.code;
    }
  }

  return widget;
}

// ============================================================================
// CRUD Operations
// ============================================================================

function listWidgets(options = {}) {
  const { limit = 100, includeDeleted = false } = options;

  let sql = "SELECT * FROM widgets";
  const params = [];

  if (!includeDeleted) {
    sql += " WHERE deleted_at IS NULL";
  }

  sql += " ORDER BY updated_at DESC";

  if (limit) {
    sql += " LIMIT ?";
    params.push(limit);
  }

  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => rowToWidget(row, false));
}

function getWidget(id) {
  const row = db.prepare("SELECT * FROM widgets WHERE id = ? AND deleted_at IS NULL").get(id);
  return rowToWidget(row, true);
}

function createWidget({ name, description, icon, code, creator = "ai", metadata }) {
  const id = randomUUID();
  const now = Date.now();

  // Write widget code to filesystem
  const widgetDir = path.join(CUSTOM_WIDGETS_DIR, id);
  fs.mkdirSync(widgetDir, { recursive: true });

  const htmlPath = path.join(widgetDir, "index.html");
  fs.writeFileSync(htmlPath, code, "utf-8");

  const manifest = {
    name,
    icon: icon || "📦",
    description: description || null,
    version: 1,
    creator,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  fs.writeFileSync(
    path.join(widgetDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );

  db.prepare(`
    INSERT INTO widgets (id, name, description, icon, code, creator, created_at, updated_at, metadata, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    description || null,
    icon || "📦",
    null,
    creator,
    now,
    now,
    metadata ? JSON.stringify(metadata) : null,
    htmlPath,
  );

  return getWidget(id);
}

function updateWidget(id, updates) {
  // Get raw row to check file_path
  const row = db.prepare("SELECT * FROM widgets WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) return null;

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
    params.push(updates.icon || "📦");
  }

  if (updates.code !== undefined) {
    if (row.file_path) {
      // Write updated code to filesystem
      fs.writeFileSync(row.file_path, updates.code, "utf-8");
      // Update manifest version/timestamps
      const manifestPath = path.join(path.dirname(row.file_path), "manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          manifest.version = (manifest.version || row.version) + 1;
          manifest.updatedAt = new Date(now).toISOString();
          if (updates.name !== undefined) manifest.name = updates.name;
          if (updates.icon !== undefined) manifest.icon = updates.icon || "📦";
          if (updates.description !== undefined) manifest.description = updates.description || null;
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
        } catch (_) {
          /* manifest update is best-effort */
        }
      }
    } else {
      sets.push("code = ?");
      params.push(updates.code);
    }
    sets.push("version = version + 1");
  }

  if (updates.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
  }

  params.push(id);

  db.prepare(`UPDATE widgets SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getWidget(id);
}

function deleteWidget(id) {
  // Check if widget has a file_path to move to trash
  const row = db
    .prepare("SELECT file_path FROM widgets WHERE id = ? AND deleted_at IS NULL")
    .get(id);

  const now = Date.now();
  const result = db
    .prepare(
      "UPDATE widgets SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    )
    .run(now, now, id);

  if (result.changes > 0 && row && row.file_path) {
    // Move widget directory to .trash for recovery
    const widgetDir = path.dirname(row.file_path);
    if (fs.existsSync(widgetDir)) {
      const trashDir = path.join(CUSTOM_WIDGETS_DIR, ".trash");
      fs.mkdirSync(trashDir, { recursive: true });
      const trashDest = path.join(trashDir, id);
      try {
        fs.renameSync(widgetDir, trashDest);
      } catch (_) {
        /* trash move is best-effort */
      }
    }
  }

  return result.changes > 0;
}

// ============================================================================
// Slot Assignment Operations
// ============================================================================

function assignSlot(position, widgetId) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO widget_slots (position, widget_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(position) DO UPDATE SET widget_id = ?, updated_at = ?
  `).run(position, widgetId, now, widgetId, now);
  return { position, widgetId };
}

function getLayout() {
  const rows = db.prepare("SELECT * FROM widget_slots ORDER BY position").all();
  return rows.map((row) => ({
    position: row.position,
    widgetId: row.widget_id,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

function getSlot(position) {
  const row = db.prepare("SELECT * FROM widget_slots WHERE position = ?").get(position);
  if (!row) return null;
  return { position: row.position, widgetId: row.widget_id };
}

// ============================================================================
// Migration: move inline code to filesystem
// ============================================================================

/**
 * Migrate existing widgets that have inline code but no file_path
 * to the filesystem. Idempotent — safe to call on every startup.
 */
function migrateInlineWidgetsToFilesystem() {
  const rows = db
    .prepare(
      "SELECT * FROM widgets WHERE code IS NOT NULL AND file_path IS NULL AND deleted_at IS NULL",
    )
    .all();

  if (rows.length === 0) return 0;

  let migrated = 0;
  for (const row of rows) {
    try {
      const widgetDir = path.join(CUSTOM_WIDGETS_DIR, row.id);
      fs.mkdirSync(widgetDir, { recursive: true });

      const htmlPath = path.join(widgetDir, "index.html");
      fs.writeFileSync(htmlPath, row.code, "utf-8");

      const manifest = {
        name: row.name,
        icon: row.icon || "📦",
        description: row.description || null,
        version: row.version || 1,
        creator: row.creator || "ai",
        createdAt: row.created_at
          ? new Date(row.created_at).toISOString()
          : new Date().toISOString(),
        updatedAt: row.updated_at
          ? new Date(row.updated_at).toISOString()
          : new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(widgetDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf-8",
      );

      db.prepare("UPDATE widgets SET file_path = ?, code = NULL WHERE id = ?").run(
        htmlPath,
        row.id,
      );
      migrated++;
    } catch (err) {
      console.error(`[WidgetsDB] Failed to migrate widget ${row.id}:`, err.message);
    }
  }

  if (migrated > 0) {
    console.log(
      `[WidgetsDB] Migrated ${migrated} widget(s) to filesystem at ${CUSTOM_WIDGETS_DIR}`,
    );
  }
  return migrated;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  db,
  listWidgets,
  getWidget,
  createWidget,
  updateWidget,
  deleteWidget,
  assignSlot,
  getLayout,
  getSlot,
  migrateInlineWidgetsToFilesystem,
  DB_PATH,
  CUSTOM_WIDGETS_DIR,
};
