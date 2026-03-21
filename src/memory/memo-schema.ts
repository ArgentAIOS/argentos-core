/**
 * ArgentOS Observations Schema Extension
 * Extends the core memory schema with session observation capture
 */

import type { DatabaseSync } from "./sqlite.js";

export interface Session {
  id: number;
  session_key: string;
  project_path: string | null;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
}

export interface Observation {
  id: number;
  session_id: number;
  type: "tool_result" | "user_message" | "assistant_message" | "error" | "system";
  tool_name: string | null;
  input: string | null;
  output: string | null;
  summary: string | null;
  created_at: string;
  importance: number; // 1-10 scale
}

export interface ObservationSearchResult {
  id: number;
  session_id: number;
  type: string;
  tool_name: string | null;
  summary: string | null;
  created_at: string;
  importance: number;
  rank: number;
}

/**
 * Ensure observation tables exist in the database
 */
export function ensureObservationsSchema(params: { db: DatabaseSync; ftsEnabled: boolean }): {
  ftsAvailable: boolean;
  ftsError?: string;
} {
  // Sessions table - tracks agent sessions
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT UNIQUE NOT NULL,
      project_path TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      summary TEXT
    );
  `);

  // Observations table - captures events within sessions
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'tool_result',
      tool_name TEXT,
      input TEXT,
      output TEXT,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      importance INTEGER NOT NULL DEFAULT 5,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);

  // Indexes for efficient queries
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);`,
  );
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);`);
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at);`,
  );
  params.db.exec(
    `CREATE INDEX IF NOT EXISTS idx_observations_importance ON observations(importance);`,
  );
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(session_key);`);

  // FTS5 for observation search
  let ftsAvailable = false;
  let ftsError: string | undefined;

  if (params.ftsEnabled) {
    try {
      params.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
          summary,
          input,
          output,
          id UNINDEXED,
          session_id UNINDEXED,
          type UNINDEXED,
          tool_name UNINDEXED
        );
      `);
      ftsAvailable = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ftsError = message;
    }
  }

  return { ftsAvailable, ...(ftsError ? { ftsError } : {}) };
}

/**
 * Create or get a session
 */
export function getOrCreateSession(
  db: DatabaseSync,
  sessionKey: string,
  projectPath?: string,
): Session {
  // Try to get existing session
  const existing = db
    .prepare(`
    SELECT * FROM sessions WHERE session_key = ?
  `)
    .get(sessionKey) as Session | undefined;

  if (existing) {
    return existing;
  }

  // Create new session
  db.prepare(`
    INSERT INTO sessions (session_key, project_path)
    VALUES (?, ?)
  `).run(sessionKey, projectPath ?? null);

  return db
    .prepare(`
    SELECT * FROM sessions WHERE session_key = ?
  `)
    .get(sessionKey) as Session;
}

/**
 * Add an observation to a session
 */
export function addObservation(
  db: DatabaseSync,
  params: {
    sessionId: number;
    type: Observation["type"];
    toolName?: string;
    input?: string;
    output?: string;
    summary?: string;
    importance?: number;
  },
): Observation {
  const result = db
    .prepare(`
    INSERT INTO observations (session_id, type, tool_name, input, output, summary, importance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      params.sessionId,
      params.type,
      params.toolName ?? null,
      params.input ?? null,
      params.output ?? null,
      params.summary ?? null,
      params.importance ?? 5,
    );

  const observation = db
    .prepare(`
    SELECT * FROM observations WHERE id = ?
  `)
    .get(result.lastInsertRowid) as Observation;

  // Update FTS index
  try {
    db.prepare(`
      INSERT INTO observations_fts (id, session_id, type, tool_name, summary, input, output)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      observation.id,
      observation.session_id,
      observation.type,
      observation.tool_name,
      observation.summary,
      observation.input,
      observation.output,
    );
  } catch {
    // FTS might not be available
  }

  return observation;
}

/**
 * Search observations using FTS5
 */
export function searchObservations(
  db: DatabaseSync,
  query: string,
  options?: {
    type?: string;
    since?: string;
    limit?: number;
  },
): ObservationSearchResult[] {
  const limit = options?.limit ?? 50;

  try {
    // Try FTS search first
    let sql = `
      SELECT
        o.id, o.session_id, o.type, o.tool_name, o.summary,
        o.created_at, o.importance,
        bm25(observations_fts) as rank
      FROM observations_fts f
      JOIN observations o ON f.id = o.id
      WHERE observations_fts MATCH ?
    `;

    const params: (string | number)[] = [query];

    if (options?.type) {
      sql += ` AND o.type = ?`;
      params.push(options.type);
    }

    if (options?.since) {
      sql += ` AND o.created_at >= ?`;
      params.push(options.since);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    return db.prepare(sql).all(...params) as ObservationSearchResult[];
  } catch {
    // Fallback to LIKE search if FTS not available
    let sql = `
      SELECT
        id, session_id, type, tool_name, summary,
        created_at, importance,
        0 as rank
      FROM observations
      WHERE (summary LIKE ? OR input LIKE ? OR output LIKE ?)
    `;

    const likeQuery = `%${query}%`;
    const params: (string | number)[] = [likeQuery, likeQuery, likeQuery];

    if (options?.type) {
      sql += ` AND type = ?`;
      params.push(options.type);
    }

    if (options?.since) {
      sql += ` AND created_at >= ?`;
      params.push(options.since);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    return db.prepare(sql).all(...params) as ObservationSearchResult[];
  }
}

/**
 * Get observations by IDs
 */
export function getObservationsByIds(db: DatabaseSync, ids: number[]): Observation[] {
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(`
    SELECT * FROM observations WHERE id IN (${placeholders})
    ORDER BY created_at
  `)
    .all(...ids) as Observation[];
}

/**
 * Get timeline around an observation
 */
export function getObservationTimeline(
  db: DatabaseSync,
  observationId: number,
  options?: {
    depthBefore?: number;
    depthAfter?: number;
  },
): Observation[] {
  const depthBefore = options?.depthBefore ?? 5;
  const depthAfter = options?.depthAfter ?? 5;

  // Get the anchor observation
  const anchor = db
    .prepare(`
    SELECT * FROM observations WHERE id = ?
  `)
    .get(observationId) as Observation | undefined;

  if (!anchor) return [];

  // Get observations before and after
  const before = db
    .prepare(`
    SELECT * FROM observations
    WHERE session_id = ? AND id < ?
    ORDER BY id DESC LIMIT ?
  `)
    .all(anchor.session_id, observationId, depthBefore) as Observation[];

  const after = db
    .prepare(`
    SELECT * FROM observations
    WHERE session_id = ? AND id > ?
    ORDER BY id ASC LIMIT ?
  `)
    .all(anchor.session_id, observationId, depthAfter) as Observation[];

  return [...before.reverse(), anchor, ...after];
}

/**
 * End a session
 */
export function endSession(db: DatabaseSync, sessionKey: string, summary?: string): void {
  db.prepare(`
    UPDATE sessions
    SET ended_at = datetime('now'), summary = ?
    WHERE session_key = ?
  `).run(summary ?? null, sessionKey);
}

/**
 * Get recent observations for context injection
 */
export function getRecentObservations(
  db: DatabaseSync,
  options?: {
    limit?: number;
    since?: string;
    minImportance?: number;
  },
): Observation[] {
  const limit = options?.limit ?? 20;
  const minImportance = options?.minImportance ?? 3;

  let sql = `
    SELECT * FROM observations
    WHERE importance >= ?
  `;
  const params: (string | number)[] = [minImportance];

  if (options?.since) {
    sql += ` AND created_at >= ?`;
    params.push(options.since);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(sql).all(...params) as Observation[];
}
