/**
 * Memory Database Module (READ-ONLY)
 *
 * Provides read-only access to the MemU memory database for the dashboard.
 * Only the agent writes to this database — the console is purely observational.
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(process.env.HOME, ".argentos", "memory.db");

let db = null;

function getDb() {
  if (db) return db;
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`MemU database not found at ${DB_PATH}`);
  }
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  db.pragma("journal_mode = WAL");
  console.log("[MemoryDB] Opened read-only at", DB_PATH);
  return db;
}

// ============================================================================
// Stats
// ============================================================================

function getStats() {
  const d = getDb();

  const items = d.prepare("SELECT count(*) as cnt FROM memory_items").get().cnt;
  const resources = d.prepare("SELECT count(*) as cnt FROM resources").get().cnt;
  const entities = d.prepare("SELECT count(*) as cnt FROM entities").get().cnt;
  const reflections = d.prepare("SELECT count(*) as cnt FROM reflections").get().cnt;

  let categories = 0;
  try {
    categories = d.prepare("SELECT count(*) as cnt FROM memory_categories").get().cnt;
  } catch {
    // Table may not exist in older schemas
  }

  const typeRows = d
    .prepare("SELECT memory_type, count(*) as cnt FROM memory_items GROUP BY memory_type")
    .all();
  const byType = {};
  for (const row of typeRows) {
    byType[row.memory_type] = row.cnt;
  }

  const sigRows = d
    .prepare("SELECT significance, count(*) as cnt FROM memory_items GROUP BY significance")
    .all();
  const bySignificance = {};
  for (const row of sigRows) {
    bySignificance[row.significance || "routine"] = row.cnt;
  }

  return { items, resources, categories, entities, reflections, byType, bySignificance };
}

// ============================================================================
// Memory Items
// ============================================================================

function searchItems(query, opts = {}) {
  const d = getDb();
  const { type, significance, entity, limit = 50, offset = 0, sort = "created_at_desc" } = opts;

  let items;
  let countSql;
  const params = [];
  const countParams = [];

  if (query && query.trim()) {
    // FTS5 search
    try {
      const ftsQuery = normalizeFtsQuery(query);

      let sql = `SELECT mi.* FROM memory_items_fts fts
        JOIN memory_items mi ON mi.rowid = fts.rowid
        WHERE memory_items_fts MATCH ?`;
      params.push(ftsQuery);

      let csql = `SELECT count(*) as cnt FROM memory_items_fts fts
        JOIN memory_items mi ON mi.rowid = fts.rowid
        WHERE memory_items_fts MATCH ?`;
      countParams.push(ftsQuery);

      if (type) {
        sql += " AND mi.memory_type = ?";
        csql += " AND mi.memory_type = ?";
        params.push(type);
        countParams.push(type);
      }
      if (significance) {
        sql += " AND mi.significance = ?";
        csql += " AND mi.significance = ?";
        params.push(significance);
        countParams.push(significance);
      }
      if (entity) {
        sql += " AND mi.id IN (SELECT item_id FROM item_entities WHERE entity_id = ?)";
        csql += " AND mi.id IN (SELECT item_id FROM item_entities WHERE entity_id = ?)";
        params.push(entity);
        countParams.push(entity);
      }

      sql += ` ORDER BY ${sortClause(sort)} LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      items = d.prepare(sql).all(...params);
      const total = d.prepare(csql).get(...countParams).cnt;
      return { items, total };
    } catch {
      // FTS not available, fall through to LIKE
    }
  }

  // Standard query (no FTS or FTS failed)
  let sql = "SELECT * FROM memory_items WHERE 1=1";
  countSql = "SELECT count(*) as cnt FROM memory_items WHERE 1=1";
  params.length = 0;
  countParams.length = 0;

  if (query && query.trim()) {
    sql += " AND summary LIKE ?";
    countSql += " AND summary LIKE ?";
    const like = `%${query}%`;
    params.push(like);
    countParams.push(like);
  }
  if (type) {
    sql += " AND memory_type = ?";
    countSql += " AND memory_type = ?";
    params.push(type);
    countParams.push(type);
  }
  if (significance) {
    sql += " AND significance = ?";
    countSql += " AND significance = ?";
    params.push(significance);
    countParams.push(significance);
  }
  if (entity) {
    sql += " AND id IN (SELECT item_id FROM item_entities WHERE entity_id = ?)";
    countSql += " AND id IN (SELECT item_id FROM item_entities WHERE entity_id = ?)";
    params.push(entity);
    countParams.push(entity);
  }

  sql += ` ORDER BY ${sortClause(sort)} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  items = d.prepare(sql).all(...params);
  const total = d.prepare(countSql).get(...countParams).cnt;

  return { items, total };
}

function getItem(id) {
  const d = getDb();
  const item = d.prepare("SELECT * FROM memory_items WHERE id = ?").get(id);
  if (!item) return null;

  // Strip embedding BLOB from response (it's large and not useful in UI)
  delete item.embedding;

  const categories = d
    .prepare(
      `SELECT mc.* FROM memory_categories mc
       JOIN category_items ci ON ci.category_id = mc.id
       WHERE ci.item_id = ?
       ORDER BY mc.name`,
    )
    .all(id)
    .map((c) => {
      delete c.embedding;
      return c;
    });

  const entities = d
    .prepare(
      `SELECT e.*, ie.role FROM entities e
       JOIN item_entities ie ON ie.entity_id = e.id
       WHERE ie.item_id = ?
       ORDER BY e.bond_strength DESC`,
    )
    .all(id)
    .map((e) => {
      delete e.embedding;
      return e;
    });

  return { ...item, categories, entities };
}

// ============================================================================
// Entities
// ============================================================================

function listEntities(opts = {}) {
  const d = getDb();
  const { type, minBond, sort = "bond_desc", limit = 50, offset = 0 } = opts;

  let sql = "SELECT * FROM entities WHERE 1=1";
  let countSql = "SELECT count(*) as cnt FROM entities WHERE 1=1";
  const params = [];
  const countParams = [];

  if (type) {
    sql += " AND entity_type = ?";
    countSql += " AND entity_type = ?";
    params.push(type);
    countParams.push(type);
  }
  if (minBond !== undefined && minBond !== null) {
    sql += " AND bond_strength >= ?";
    countSql += " AND bond_strength >= ?";
    params.push(parseFloat(minBond));
    countParams.push(parseFloat(minBond));
  }

  const orderMap = {
    bond_desc: "bond_strength DESC, memory_count DESC",
    bond_asc: "bond_strength ASC",
    name_asc: "name ASC",
    memory_count_desc: "memory_count DESC",
    last_mentioned_desc: "last_mentioned_at DESC",
  };
  sql += ` ORDER BY ${orderMap[sort] || orderMap.bond_desc} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const entities = d
    .prepare(sql)
    .all(...params)
    .map((e) => {
      delete e.embedding;
      return e;
    });
  const total = d.prepare(countSql).get(...countParams).cnt;

  return { entities, total };
}

function getEntity(id) {
  const d = getDb();
  const entity = d.prepare("SELECT * FROM entities WHERE id = ?").get(id);
  if (!entity) return null;

  delete entity.embedding;

  const recentItems = d
    .prepare(
      `SELECT mi.* FROM memory_items mi
       JOIN item_entities ie ON ie.item_id = mi.id
       WHERE ie.entity_id = ?
       ORDER BY mi.created_at DESC
       LIMIT 10`,
    )
    .all(id)
    .map((i) => {
      delete i.embedding;
      return i;
    });

  return { ...entity, recentItems };
}

// ============================================================================
// Categories
// ============================================================================

function listCategories(opts = {}) {
  const d = getDb();
  const { limit = 50, offset = 0 } = opts;

  const categories = d
    .prepare(
      `SELECT mc.*,
         (SELECT count(*) FROM category_items ci WHERE ci.category_id = mc.id) as item_count
       FROM memory_categories mc
       ORDER BY item_count DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset)
    .map((c) => {
      delete c.embedding;
      return c;
    });

  const total = d.prepare("SELECT count(*) as cnt FROM memory_categories").get().cnt;

  return { categories, total };
}

function getCategory(id) {
  const d = getDb();
  const category = d.prepare("SELECT * FROM memory_categories WHERE id = ?").get(id);
  if (!category) return null;

  delete category.embedding;

  const items = d
    .prepare(
      `SELECT mi.* FROM memory_items mi
       JOIN category_items ci ON ci.item_id = mi.id
       WHERE ci.category_id = ?
       ORDER BY mi.created_at DESC
       LIMIT 50`,
    )
    .all(id)
    .map((i) => {
      delete i.embedding;
      return i;
    });

  return { ...category, items };
}

// ============================================================================
// Reflections
// ============================================================================

function listReflections(opts = {}) {
  const d = getDb();
  const { trigger, limit = 50, offset = 0 } = opts;

  let sql = "SELECT * FROM reflections WHERE 1=1";
  let countSql = "SELECT count(*) as cnt FROM reflections WHERE 1=1";
  const params = [];
  const countParams = [];

  if (trigger) {
    sql += " AND trigger_type = ?";
    countSql += " AND trigger_type = ?";
    params.push(trigger);
    countParams.push(trigger);
  }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const reflections = d.prepare(sql).all(...params);
  const total = d.prepare(countSql).get(...countParams).cnt;

  return { reflections, total };
}

// ============================================================================
// Timeline
// ============================================================================

function getTimeline(days = 30) {
  const d = getDb();

  const rows = d
    .prepare(
      `SELECT
         date(created_at) as date,
         count(*) as count,
         memory_type
       FROM memory_items
       WHERE created_at >= date('now', ?)
       GROUP BY date(created_at), memory_type
       ORDER BY date ASC`,
    )
    .all(`-${days} days`);

  // Aggregate by date
  const dateMap = {};
  for (const row of rows) {
    if (!dateMap[row.date]) {
      dateMap[row.date] = { date: row.date, count: 0, byType: {} };
    }
    dateMap[row.date].count += row.count;
    dateMap[row.date].byType[row.memory_type] = row.count;
  }

  return Object.values(dateMap);
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeFtsQuery(query) {
  const tokens = query
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return query;
  if (tokens.length === 1) return tokens[0];
  return tokens.join(" OR ");
}

function sortClause(sort) {
  const map = {
    created_at_desc: "created_at DESC",
    created_at_asc: "created_at ASC",
    reinforcement_desc: "reinforcement_count DESC",
    significance_desc:
      "CASE significance WHEN 'core' THEN 4 WHEN 'important' THEN 3 WHEN 'noteworthy' THEN 2 ELSE 1 END DESC",
  };
  return map[sort] || map.created_at_desc;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  getStats,
  searchItems,
  getItem,
  listEntities,
  getEntity,
  listCategories,
  getCategory,
  listReflections,
  getTimeline,
  DB_PATH,
};
