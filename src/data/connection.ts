/**
 * Multi-Database Connection Manager
 *
 * Manages connections to multiple SQLite databases with ATTACH support
 * for cross-database queries.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabasePaths, DataAPIConfig } from "./types.js";

type BetterSqlite3Database = import("better-sqlite3").Database;
type BetterSqlite3Constructor = typeof import("better-sqlite3").default;

let cachedSqliteConstructor: BetterSqlite3Constructor | null = null;

function loadBetterSqlite3(): BetterSqlite3Constructor {
  if (cachedSqliteConstructor) return cachedSqliteConstructor;
  const require = createRequire(import.meta.url);
  cachedSqliteConstructor = require("better-sqlite3") as BetterSqlite3Constructor;
  return cachedSqliteConstructor;
}

export interface AttachedDatabase {
  name: string;
  path: string;
  db: BetterSqlite3Database;
}

export class ConnectionManager {
  private primary: BetterSqlite3Database | null = null;
  private attached: Map<string, AttachedDatabase> = new Map();
  private config: DataAPIConfig;
  private initialized = false;

  constructor(config: DataAPIConfig) {
    this.config = config;
  }

  /**
   * Initialize all database connections
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Ensure directories exist
    for (const dbPath of Object.values(this.config.paths)) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Open primary connection (dashboard DB)
    const BetterSqlite3 = loadBetterSqlite3();
    this.primary = new BetterSqlite3(this.config.paths.dashboard, {
      readonly: this.config.readOnly,
    });
    this.primary.pragma("journal_mode = WAL");
    this.primary.pragma("foreign_keys = ON");

    // Attach other databases
    await this.attachDatabase("memo", this.config.paths.memo);
    await this.attachDatabase("sessions", this.config.paths.sessions);

    this.initialized = true;
  }

  /**
   * Attach a database to the primary connection for cross-DB queries
   */
  private async attachDatabase(name: string, dbPath: string): Promise<void> {
    if (!this.primary) {
      throw new Error("Primary database not initialized");
    }

    // Create the database file if it doesn't exist
    if (!fs.existsSync(dbPath)) {
      const BetterSqlite3 = loadBetterSqlite3();
      const db = new BetterSqlite3(dbPath);
      db.pragma("journal_mode = WAL");
      db.close();
    }

    // Attach to primary
    this.primary.exec(`ATTACH DATABASE '${dbPath}' AS ${name}`);

    // Also keep a direct connection for schema operations
    const BetterSqlite3 = loadBetterSqlite3();
    const db = new BetterSqlite3(dbPath, { readonly: this.config.readOnly });
    db.pragma("journal_mode = WAL");

    this.attached.set(name, { name, path: dbPath, db });
  }

  /**
   * Get the primary database connection (with attached DBs)
   */
  getPrimary(): BetterSqlite3Database {
    if (!this.primary) {
      throw new Error("Database not initialized. Call init() first.");
    }
    return this.primary;
  }

  /**
   * Get a specific database connection by name
   */
  getDatabase(name: "dashboard" | "memo" | "sessions"): BetterSqlite3Database {
    if (name === "dashboard") {
      return this.getPrimary();
    }

    const attached = this.attached.get(name);
    if (!attached) {
      throw new Error(`Database '${name}' not found`);
    }
    return attached.db;
  }

  /**
   * Execute a query that spans multiple databases
   * Uses the primary connection with attached DBs
   */
  crossQuery<T>(sql: string, params?: unknown[]): T[] {
    const db = this.getPrimary();
    const stmt = db.prepare(sql);
    return (params ? stmt.all(...params) : stmt.all()) as T[];
  }

  /**
   * Execute a write operation on a specific database
   */
  execute(
    database: "dashboard" | "memo" | "sessions",
    sql: string,
    params?: unknown[],
  ): import("better-sqlite3").RunResult {
    const db = this.getDatabase(database);
    const stmt = db.prepare(sql);
    return params ? stmt.run(...params) : stmt.run();
  }

  /**
   * Run a transaction across the primary database
   */
  transaction<T>(fn: () => T): T {
    const db = this.getPrimary();
    return db.transaction(fn)();
  }

  /**
   * Close all database connections
   */
  close(): void {
    for (const attached of this.attached.values()) {
      attached.db.close();
    }
    this.attached.clear();

    if (this.primary) {
      this.primary.close();
      this.primary = null;
    }

    this.initialized = false;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Get default database paths based on ArgentOS state directory
 */
export function getDefaultDatabasePaths(stateDir?: string): DatabasePaths {
  const base =
    stateDir || process.env.ARGENT_STATE_DIR || path.join(process.env.HOME || "~", ".argentos");

  return {
    dashboard: path.join(base, "data", "dashboard.db"),
    memo: path.join(base, "data", "memo.db"),
    sessions: path.join(base, "data", "sessions.db"),
  };
}
