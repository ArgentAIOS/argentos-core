/**
 * SQLite Database — better-sqlite3 wrapper
 *
 * Replaces the previous node:sqlite DatabaseSync usage which caused WAL journal
 * corruption during heavy read-write-delete operations (SIS maintenance cycle).
 *
 * better-sqlite3 is battle-tested, supports WAL checkpoints on close, and
 * handles extension loading (sqlite-vec) without the instabilities of the
 * experimental node:sqlite module.
 */

import Database from "better-sqlite3";

/**
 * Re-export better-sqlite3 Database type as DatabaseSync for backward
 * compatibility with existing code that used node:sqlite's DatabaseSync.
 */
export type DatabaseSync = InstanceType<typeof Database>;

export { Database };

/**
 * Open a SQLite database using better-sqlite3.
 *
 * @param filePath - Path to the .db file
 * @param options - better-sqlite3 options (readonly, fileMustExist, etc.)
 */
export function openDatabase(filePath: string, options?: Database.Options): DatabaseSync {
  return new Database(filePath, options);
}

/**
 * Checkpoint and close a database cleanly.
 * Forces a WAL checkpoint before closing to prevent journal corruption.
 */
export function closeDatabase(db: DatabaseSync): void {
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // May fail if not in WAL mode — that's fine
  }
  try {
    db.close();
  } catch {
    // Already closed
  }
}
