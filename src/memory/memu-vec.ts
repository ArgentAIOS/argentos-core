/**
 * MemU Vector Search — sqlite-vec Integration
 *
 * Uses sqlite-vec's vec0 virtual tables for native KNN vector search,
 * replacing the JS-side cosine similarity loop.
 *
 * When sqlite-vec is unavailable (missing package, extension load failure),
 * gracefully falls back to the existing JS cosine similarity in memu-store.ts.
 *
 * vec0 tables:
 * - vec_memory_items: mirrors memory_items embeddings
 * - vec_entities: mirrors entities embeddings
 * - vec_categories: mirrors memory_categories embeddings
 */

import type { DatabaseSync } from "./sqlite.js";

const EMBEDDING_DIMS = 768; // nomic-embed-text

/**
 * Try to load sqlite-vec extension into the database.
 * Returns true if loaded successfully, false otherwise.
 */
export function loadSqliteVec(db: DatabaseSync): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require("sqlite-vec");
    sqliteVec.load(db);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create vec0 virtual tables for existing embeddings.
 * Safe to call multiple times — uses IF NOT EXISTS.
 */
export function ensureVecTables(db: DatabaseSync, dims = EMBEDDING_DIMS): void {
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory_items USING vec0(embedding float[${dims}])`,
  );
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_entities USING vec0(embedding float[${dims}])`);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_categories USING vec0(embedding float[${dims}])`);
}

/**
 * Sync vec0 table from source table.
 * Copies all embeddings from source into vec0, skipping existing rowids.
 */
export function syncVecTable(
  db: DatabaseSync,
  sourceTable: string,
  vecTable: string,
): { synced: number; skipped: number } {
  // Get all rowids with embeddings from source
  const sourceRows = db
    .prepare(`SELECT rowid, embedding FROM ${sourceTable} WHERE embedding IS NOT NULL`)
    .all() as Array<{ rowid: number | bigint; embedding: Buffer }>;

  // Get existing rowids in vec table
  const existingSet = new Set<number>();
  try {
    const vecRows = db.prepare(`SELECT rowid FROM ${vecTable}`).all() as Array<{
      rowid: number | bigint;
    }>;
    for (const r of vecRows) {
      existingSet.add(Number(r.rowid));
    }
  } catch {
    // vec table might be empty
  }

  const insertStmt = db.prepare(`INSERT INTO ${vecTable}(rowid, embedding) VALUES (?, ?)`);

  let synced = 0;
  let skipped = 0;

  for (const row of sourceRows) {
    const rowid = Number(row.rowid);
    if (existingSet.has(rowid)) {
      skipped++;
      continue;
    }

    try {
      insertStmt.run(BigInt(rowid), row.embedding);
      synced++;
    } catch {
      skipped++;
    }
  }

  return { synced, skipped };
}

/**
 * Insert or replace a vector in a vec0 table.
 * vec0 doesn't support UPDATE, so we DELETE then INSERT.
 */
export function upsertVec(
  db: DatabaseSync,
  vecTable: string,
  rowid: number | bigint,
  embedding: Buffer,
): void {
  try {
    db.prepare(`DELETE FROM ${vecTable} WHERE rowid = ?`).run(BigInt(rowid));
  } catch {
    // May not exist — that's fine
  }
  db.prepare(`INSERT INTO ${vecTable}(rowid, embedding) VALUES (?, ?)`).run(
    BigInt(rowid),
    embedding,
  );
}

/**
 * Delete a vector from a vec0 table.
 */
export function deleteVec(db: DatabaseSync, vecTable: string, rowid: number | bigint): void {
  try {
    db.prepare(`DELETE FROM ${vecTable} WHERE rowid = ?`).run(BigInt(rowid));
  } catch {
    // May not exist
  }
}

/**
 * KNN search using vec0 virtual table.
 *
 * Returns rowids and L2 distances, sorted by distance ASC.
 * Caller must convert L2 distance to cosine similarity if needed.
 */
export function vecKnnSearch(
  db: DatabaseSync,
  vecTable: string,
  queryVec: Buffer | Uint8Array,
  limit: number,
): Array<{ rowid: number; distance: number }> {
  const rows = db
    .prepare(
      `SELECT rowid, distance FROM ${vecTable} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
    )
    .all(queryVec instanceof Uint8Array ? queryVec : new Uint8Array(queryVec), limit) as Array<{
    rowid: number | bigint;
    distance: number;
  }>;

  return rows.map((r) => ({
    rowid: Number(r.rowid),
    distance: r.distance,
  }));
}

/**
 * Calculate cosine distance between two vectors using sqlite-vec's built-in function.
 */
export function vecCosineDistance(
  db: DatabaseSync,
  a: Buffer | Uint8Array,
  b: Buffer | Uint8Array,
): number {
  const aBytes = a instanceof Uint8Array ? a : new Uint8Array(a);
  const bBytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  const row = db.prepare(`SELECT vec_distance_cosine(?, ?) as d`).get(aBytes, bBytes) as {
    d: number;
  };
  return row.d;
}

/**
 * Convert a number[] embedding to the Uint8Array format that sqlite-vec expects.
 */
export function vecToUint8Array(vec: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vec).buffer);
}

/**
 * Get the rowid for a memory_items record by its text ID.
 * SQLite rowid is different from our UUID-based id field.
 */
export function getRowidForId(db: DatabaseSync, table: string, id: string): number | null {
  const row = db.prepare(`SELECT rowid FROM ${table} WHERE id = ?`).get(id) as
    | { rowid: number | bigint }
    | undefined;
  return row ? Number(row.rowid) : null;
}
