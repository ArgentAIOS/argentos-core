const path = require("path");
const fs = require("fs");
const postgres = require("postgres");

const DB_PATH = path.join(process.env.HOME || "", "argent", "memory", "canvas.db");
const DB_DIR = path.dirname(DB_PATH);
const ARGENT_CONFIG_PATH = path.join(process.env.HOME || "", ".argentos", "argent.json");
const DEFAULT_PG_URL = "postgres://localhost:5433/argentos";

const LEGACY_SQLITE_ERROR =
  "Canvas SQLite backend is disabled. DocPanel/Canvas storage is PG knowledge-only.";

let sqliteDb = null;
let pgClient = null;
let pgInitPromise = null;

function ensureSqliteDir() {
  throw new Error(LEGACY_SQLITE_ERROR);
}

function parseJsonSafe(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function parseVectorText(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  if (Buffer.isBuffer(value)) return bufferToEmbedding(value);
  const raw = String(value).trim();
  if (!raw.startsWith("[") || !raw.endsWith("]")) return null;
  const body = raw.slice(1, -1).trim();
  if (!body) return [];
  return body
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((n) => Number.isFinite(n));
}

function toVectorLiteral(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  const values = embedding.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  return `[${values.join(",")}]`;
}

function normalizeDocRow(row, includeEmbedding = false) {
  const createdRaw = row.created_at ?? row.createdAt ?? Date.now();
  const createdDate = createdRaw instanceof Date ? createdRaw : new Date(createdRaw);
  const tagsValue = parseJsonSafe(row.tags, []);
  const metadataValue = parseJsonSafe(row.metadata, null);
  const normalized = {
    ...row,
    tags: Array.isArray(tagsValue) ? tagsValue : [],
    metadata: metadataValue,
    createdAt: createdDate,
    created_at: createdDate,
  };
  if (!includeEmbedding) {
    normalized.embedding = undefined;
  } else {
    normalized.embedding = parseVectorText(row.embedding);
  }
  return normalized;
}

function readStorageConfig() {
  try {
    if (!fs.existsSync(ARGENT_CONFIG_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(ARGENT_CONFIG_PATH, "utf-8"));
    return raw && typeof raw === "object" ? raw.storage || {} : {};
  } catch {
    return {};
  }
}

function resolvePgConnectionString() {
  const fromEnv = process.env.ARGENT_PG_URL || process.env.PG_URL;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  const storage = readStorageConfig();
  if (storage?.postgres?.connectionString && String(storage.postgres.connectionString).trim()) {
    return String(storage.postgres.connectionString).trim();
  }
  return DEFAULT_PG_URL;
}

function shouldUsePg() {
  return true;
}

function isStrictPgBackend() {
  return true;
}

function getSqliteDb() {
  throw new Error(LEGACY_SQLITE_ERROR);
}

function embeddingToBuffer(embedding) {
  const buffer = Buffer.allocUnsafe(embedding.length * 4);
  for (let i = 0; i < embedding.length; i += 1) {
    buffer.writeFloatLE(embedding[i], i * 4);
  }
  return buffer;
}

function bufferToEmbedding(buffer) {
  const embedding = [];
  for (let i = 0; i < buffer.length; i += 4) {
    embedding.push(buffer.readFloatLE(i));
  }
  return embedding;
}

function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function backfillSqliteToPg(sql) {
  // Intentionally disabled: DocPanel/Canvas is PG knowledge-backed only.
  // Legacy canvas.db backfill is no longer permitted.
  return;
}

async function initPg() {
  if (!shouldUsePg()) return null;
  if (pgClient) return pgClient;
  if (pgInitPromise) return pgInitPromise;

  pgInitPromise = (async () => {
    const connectionString = resolvePgConnectionString();
    const sql = postgres(connectionString, {
      max: 2,
      idle_timeout: 10,
      connect_timeout: 5,
      prepare: false,
    });
    try {
      await sql`SELECT 1`;
      await sql`CREATE EXTENSION IF NOT EXISTS vector`;
      await sql`
        CREATE TABLE IF NOT EXISTS canvas_documents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT NOT NULL,
          language TEXT,
          tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          embedding vector,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at TIMESTAMPTZ,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `;
      try {
        await sql`
          ALTER TABLE canvas_documents
          ALTER COLUMN embedding TYPE vector
          USING embedding::vector
        `;
      } catch {
        // If this fails on older installs, continue and rely on fallback behavior.
      }
      await sql`CREATE INDEX IF NOT EXISTS idx_canvas_documents_created ON canvas_documents (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_canvas_documents_deleted ON canvas_documents (deleted_at)`;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_canvas_documents_fts
        ON canvas_documents
        USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(tags::text, '')))
      `;
      try {
        await sql`
          CREATE INDEX IF NOT EXISTS idx_canvas_documents_embedding_hnsw
          ON canvas_documents
          USING hnsw (embedding vector_cosine_ops)
        `;
      } catch {
        // Optional index; continue without it if unavailable.
      }

      await backfillSqliteToPg(sql);
      pgClient = sql;
      return sql;
    } catch (err) {
      if (isStrictPgBackend()) {
        throw err;
      }
      console.warn(
        "[CanvasDB] PostgreSQL unavailable, falling back to SQLite:",
        err?.message || err,
      );
      try {
        await sql.end({ timeout: 1 });
      } catch {}
      return null;
    }
  })();

  const client = await pgInitPromise;
  pgInitPromise = null;
  return client;
}

async function withBackend(pgFn, sqliteFn) {
  const sql = await initPg();
  if (sql) {
    try {
      return await pgFn(sql);
    } catch (err) {
      if (isStrictPgBackend()) {
        throw err;
      }
      console.warn("[CanvasDB] PostgreSQL op failed, using SQLite fallback:", err?.message || err);
    }
  }
  if (isStrictPgBackend()) {
    throw new Error(
      "Canvas database backend is configured as postgres/dual with PG-required mode, but no PostgreSQL connection is available",
    );
  }
  return sqliteFn(getSqliteDb());
}

const canvasDb = {
  async save(doc, embedding = null) {
    return withBackend(
      async (sql) => {
        const tags = Array.isArray(doc.tags) ? doc.tags : [];
        const metadata = doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
        const createdAt = new Date(doc.createdAt || Date.now());
        const embeddingLiteral = toVectorLiteral(embedding);
        const runUpsert = async (embeddingExpr) =>
          sql`
            INSERT INTO canvas_documents (
              id, title, content, type, language, tags, embedding, created_at, metadata
            )
            VALUES (
              ${doc.id},
              ${doc.title},
              ${doc.content},
              ${doc.type},
              ${doc.language || null},
              ${JSON.stringify(tags)}::jsonb,
              ${embeddingExpr},
              ${createdAt},
              ${JSON.stringify(metadata)}::jsonb
            )
            ON CONFLICT (id)
            DO UPDATE SET
              title = EXCLUDED.title,
              content = EXCLUDED.content,
              type = EXCLUDED.type,
              language = EXCLUDED.language,
              tags = EXCLUDED.tags,
              embedding = EXCLUDED.embedding,
              metadata = EXCLUDED.metadata,
              deleted_at = NULL
          `;

        const embeddingExpr = embeddingLiteral ? sql`${embeddingLiteral}::vector` : sql`NULL`;
        try {
          await runUpsert(embeddingExpr);
        } catch (err) {
          const message = String(err?.message || err).toLowerCase();
          if (message.includes("dimension")) {
            console.warn(
              "[CanvasDB] Embedding dimension mismatch; saving document without embedding",
            );
            await runUpsert(sql`NULL`);
          } else {
            throw err;
          }
        }
      },
      (db) => {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO documents
          (id, title, content, type, language, tags, embedding, created_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const tags = doc.tags ? JSON.stringify(doc.tags) : null;
        const embeddingBlob = embedding ? embeddingToBuffer(embedding) : null;
        const createdAt = new Date(doc.createdAt || Date.now()).getTime();
        stmt.run(
          doc.id,
          doc.title,
          doc.content,
          doc.type,
          doc.language || null,
          tags,
          embeddingBlob,
          createdAt,
          null,
        );
      },
    );
  },

  async getAll() {
    return withBackend(
      async (sql) => {
        const rows = await sql`
          SELECT id, title, content, type, language, tags, metadata, created_at, deleted_at
          FROM canvas_documents
          WHERE deleted_at IS NULL
          ORDER BY created_at DESC
        `;
        return rows.map((row) => normalizeDocRow(row, false));
      },
      (db) => {
        const stmt = db.prepare(`
          SELECT * FROM documents
          WHERE deleted_at IS NULL
          ORDER BY created_at DESC
        `);
        return stmt.all().map((row) => normalizeDocRow(row, false));
      },
    );
  },

  async getById(id) {
    return withBackend(
      async (sql) => {
        const rows = await sql`
          SELECT id, title, content, type, language, tags, embedding, metadata, created_at, deleted_at
          FROM canvas_documents
          WHERE id = ${id} AND deleted_at IS NULL
          LIMIT 1
        `;
        if (!rows[0]) return null;
        return normalizeDocRow(rows[0], true);
      },
      (db) => {
        const stmt = db.prepare(`
          SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL
        `);
        const row = stmt.get(id);
        if (!row) return null;
        return normalizeDocRow(row, true);
      },
    );
  },

  async searchKeyword(query, limit = 20) {
    return withBackend(
      async (sql) => {
        const q = String(query || "").trim();
        if (!q) return [];
        const rows = await sql`
          SELECT
            id, title, content, type, language, tags, metadata, created_at, deleted_at,
            ts_rank_cd(
              to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(tags::text, '')),
              plainto_tsquery('english', ${q})
            ) AS rank
          FROM canvas_documents
          WHERE deleted_at IS NULL
            AND to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(tags::text, ''))
                @@ plainto_tsquery('english', ${q})
          ORDER BY rank DESC, created_at DESC
          LIMIT ${Math.max(1, Number(limit) || 20)}
        `;
        return rows.map((row) => normalizeDocRow(row, false));
      },
      (db) => {
        const stmt = db.prepare(`
          SELECT d.*
          FROM documents d
          JOIN documents_fts fts ON d.rowid = fts.rowid
          WHERE documents_fts MATCH ?
            AND d.deleted_at IS NULL
          ORDER BY rank
          LIMIT ?
        `);
        return stmt
          .all(String(query || ""), Math.max(1, Number(limit) || 20))
          .map((row) => normalizeDocRow(row, false));
      },
    );
  },

  async searchSemantic(queryEmbedding, limit = 20) {
    return withBackend(
      async (sql) => {
        const vector = toVectorLiteral(queryEmbedding);
        if (!vector) return [];
        const rows = await sql`
          SELECT
            id, title, content, type, language, tags, metadata, created_at, deleted_at,
            (1 - (embedding <=> ${vector}::vector)) AS similarity
          FROM canvas_documents
          WHERE embedding IS NOT NULL
            AND vector_dims(embedding) = vector_dims(${vector}::vector)
            AND deleted_at IS NULL
          ORDER BY embedding <=> ${vector}::vector
          LIMIT ${Math.max(1, Number(limit) || 20)}
        `;
        return rows.map((row) => {
          const normalized = normalizeDocRow(row, false);
          normalized.similarity = Number(row.similarity);
          return normalized;
        });
      },
      (db) => {
        const stmt = db.prepare(`
          SELECT * FROM documents
          WHERE embedding IS NOT NULL
            AND deleted_at IS NULL
        `);
        const docs = stmt.all();
        const results = [];
        for (const doc of docs) {
          const docEmbedding = bufferToEmbedding(doc.embedding);
          const similarity = cosineSimilarity(queryEmbedding, docEmbedding);
          const normalized = normalizeDocRow(doc, false);
          normalized.similarity = similarity;
          results.push(normalized);
        }
        results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        return results.slice(0, Math.max(1, Number(limit) || 20));
      },
    );
  },

  async searchHybrid(query, queryEmbedding, limit = 20) {
    const keywordResults = await canvasDb.searchKeyword(query, Math.max(2, limit * 2));
    const semanticResults = await canvasDb.searchSemantic(queryEmbedding, Math.max(2, limit * 2));
    const combined = new Map();

    keywordResults.forEach((doc, idx) => {
      combined.set(doc.id, {
        ...doc,
        keywordScore: 1 - idx / Math.max(1, keywordResults.length),
        semanticScore: 0,
      });
    });

    semanticResults.forEach((doc) => {
      if (combined.has(doc.id)) {
        combined.get(doc.id).semanticScore = Number(doc.similarity || 0);
      } else {
        combined.set(doc.id, {
          ...doc,
          keywordScore: 0,
          semanticScore: Number(doc.similarity || 0),
        });
      }
    });

    const ranked = Array.from(combined.values()).map((doc) => ({
      ...doc,
      score: Number(doc.semanticScore || 0) * 0.6 + Number(doc.keywordScore || 0) * 0.4,
    }));
    ranked.sort((a, b) => (b.score || 0) - (a.score || 0));
    return ranked.slice(0, Math.max(1, Number(limit) || 20));
  },

  async delete(id) {
    return withBackend(
      async (sql) => {
        await sql`
          UPDATE canvas_documents
          SET deleted_at = NOW()
          WHERE id = ${id}
        `;
      },
      (db) => {
        const stmt = db.prepare(`
          UPDATE documents
          SET deleted_at = ?
          WHERE id = ?
        `);
        stmt.run(Date.now(), id);
      },
    );
  },

  async deleteHard(id) {
    return withBackend(
      async (sql) => {
        await sql`DELETE FROM canvas_documents WHERE id = ${id}`;
      },
      (db) => {
        const stmt = db.prepare(`DELETE FROM documents WHERE id = ?`);
        stmt.run(id);
      },
    );
  },

  async getStats() {
    return withBackend(
      async (sql) => {
        const total = await sql`
          SELECT COUNT(*)::int AS count
          FROM canvas_documents
          WHERE deleted_at IS NULL
        `;
        const withEmbeddings = await sql`
          SELECT COUNT(*)::int AS count
          FROM canvas_documents
          WHERE embedding IS NOT NULL
            AND deleted_at IS NULL
        `;
        return {
          total: Number(total[0]?.count || 0),
          withEmbeddings: Number(withEmbeddings[0]?.count || 0),
          backend: "postgres",
        };
      },
      (db) => {
        const total = db
          .prepare(`SELECT COUNT(*) as count FROM documents WHERE deleted_at IS NULL`)
          .get();
        const withEmbeddings = db
          .prepare(
            `SELECT COUNT(*) as count FROM documents WHERE embedding IS NOT NULL AND deleted_at IS NULL`,
          )
          .get();
        return {
          total: Number(total.count || 0),
          withEmbeddings: Number(withEmbeddings.count || 0),
          backend: "sqlite",
        };
      },
    );
  },
};

module.exports = canvasDb;
