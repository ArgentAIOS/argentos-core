/**
 * Unified Search Module
 *
 * Search across all ArgentOS databases: tasks, memory, sessions.
 * Uses SQLite FTS5 for full-text search with cross-database ATTACH.
 */

import type { MemoryAdapter } from "./adapter.js";
import type { ConnectionManager } from "./connection.js";
import type { UnifiedSearchResult, UnifiedSearchOptions, SearchResultType } from "./types.js";
import { getInitializedMemoryAdapter, getMemoryAdapter } from "./storage-factory.js";

export class SearchModule {
  private conn: ConnectionManager;

  constructor(conn: ConnectionManager) {
    this.conn = conn;
  }

  /**
   * Search across all databases
   */
  async search(options: UnifiedSearchOptions): Promise<UnifiedSearchResult[]> {
    const results: UnifiedSearchResult[] = [];
    const types = options.types || ["task", "observation", "session"];

    // Search tasks
    if (types.includes("task")) {
      const taskResults = this.searchTasks(options);
      results.push(...taskResults);
    }

    // Search observations (memory)
    if (types.includes("observation")) {
      const memoryResults = await this.searchMemory(options);
      results.push(...memoryResults);
    }

    // Search sessions
    if (types.includes("session")) {
      const sessionResults = this.searchSessions(options);
      results.push(...sessionResults);
    }

    // Sort by score (descending) and apply overall limit
    results.sort((a, b) => b.score - a.score);

    if (options.limit) {
      return results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Search tasks using FTS
   */
  private searchTasks(options: UnifiedSearchOptions): UnifiedSearchResult[] {
    const db = this.conn.getDatabase("dashboard");

    try {
      // Check if FTS table exists
      const tableCheck = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks_fts'")
        .get();

      if (!tableCheck) {
        return this.searchTasksFallback(options);
      }

      let sql = `
        SELECT t.id, t.title, t.description, t.created_at,
               rank * -1 as score
        FROM tasks t
        JOIN tasks_fts fts ON t.id = fts.id
        WHERE tasks_fts MATCH ?
      `;
      const params: unknown[] = [options.query];

      if (options.agentId) {
        sql += " AND t.agent_id = ?";
        params.push(options.agentId);
      }
      if (options.channelId) {
        sql += " AND t.channel_id = ?";
        params.push(options.channelId);
      }
      if (options.since) {
        sql += " AND t.created_at >= ?";
        params.push(options.since);
      }
      if (options.until) {
        sql += " AND t.created_at <= ?";
        params.push(options.until);
      }

      sql += " ORDER BY rank LIMIT 50";

      const rows = db.prepare(sql).all(...params) as TaskSearchRow[];

      return rows.map((row) => ({
        type: "task" as SearchResultType,
        id: row.id,
        title: row.title,
        snippet: this.generateSnippet(row.description || row.title, options.query),
        score: row.score,
        timestamp: row.created_at,
        source: "dashboard",
      }));
    } catch {
      return this.searchTasksFallback(options);
    }
  }

  /**
   * Fallback task search using LIKE
   */
  private searchTasksFallback(options: UnifiedSearchOptions): UnifiedSearchResult[] {
    const db = this.conn.getDatabase("dashboard");
    const pattern = `%${options.query}%`;

    let sql = `
      SELECT id, title, description, created_at
      FROM tasks
      WHERE (title LIKE ? OR description LIKE ?)
    `;
    const params: unknown[] = [pattern, pattern];

    if (options.agentId) {
      sql += " AND agent_id = ?";
      params.push(options.agentId);
    }
    if (options.since) {
      sql += " AND created_at >= ?";
      params.push(options.since);
    }

    sql += " ORDER BY created_at DESC LIMIT 50";

    const rows = db.prepare(sql).all(...params) as TaskSearchRow[];

    return rows.map((row) => ({
      type: "task" as SearchResultType,
      id: row.id,
      title: row.title,
      snippet: this.generateSnippet(row.description || row.title, options.query),
      score: 0.5, // Default score for LIKE matches
      timestamp: row.created_at,
      source: "dashboard",
    }));
  }

  /**
   * Search memory/observations using FTS
   */
  private async searchMemory(options: UnifiedSearchOptions): Promise<UnifiedSearchResult[]> {
    const db = this.conn.getDatabase("memo");
    const results: UnifiedSearchResult[] = [];
    const memoryAdapter = getInitializedMemoryAdapter();

    if (memoryAdapter) {
      try {
        results.push(...(await this.searchStorageMemoryItems(memoryAdapter, options)));
      } catch {
        // Keep search resilient even if adapter backend errors.
      }
    }

    try {
      results.push(...this.searchObservationsFts(db, options));
    } catch {
      // Fallback for observations handled below.
    }

    try {
      results.push(...this.searchMemuItemsFts(db, options));
    } catch {
      // MemU item fallback handled below.
    }

    // Canonical MemU path (~/.argentos/memory.db) used by memory_recall.
    if (!memoryAdapter) {
      // Legacy fallback for deployments where storage adapter is not initialized yet.
      try {
        results.push(...(await this.searchMemuStoreItems(options)));
      } catch {
        // Keep search resilient even if MemU store is unavailable.
      }
    }

    if (results.length === 0) {
      results.push(...this.searchMemoryFallback(options));
    }

    const deduped = new Map<string, UnifiedSearchResult>();
    for (const result of results) {
      const dedupeKey = `${result.type}:${String(result.id)}`;
      const existing = deduped.get(dedupeKey);
      if (!existing || result.score > existing.score) {
        deduped.set(dedupeKey, result);
      }
    }

    // Keep memory-side limit bounded before global merge/sort in search().
    return Array.from(deduped.values())
      .toSorted((a, b) => b.score - a.score || b.timestamp - a.timestamp)
      .slice(0, 50);
  }

  private searchObservationsFts(
    db: ReturnType<ConnectionManager["getDatabase"]>,
    options: UnifiedSearchOptions,
  ): UnifiedSearchResult[] {
    const tableCheck = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'")
      .get();
    if (!tableCheck) {
      return [];
    }

    let sql = `
      SELECT o.id, o.type, o.summary, o.input, o.output, o.created_at, o.session_id,
             rank * -1 as score
      FROM observations o
      JOIN observations_fts fts ON o.id = fts.id
      WHERE observations_fts MATCH ?
    `;
    const params: unknown[] = [options.query];

    if (options.since) {
      sql += " AND o.created_at >= ?";
      params.push(this.toSqliteDateTime(options.since));
    }
    if (options.until) {
      sql += " AND o.created_at <= ?";
      params.push(this.toSqliteDateTime(options.until));
    }

    sql += " ORDER BY rank LIMIT 50";

    const rows = db.prepare(sql).all(...params) as MemorySearchRow[];
    return rows.map((row) => ({
      type: "observation" as SearchResultType,
      id: row.id,
      title: `[${row.type}] session ${String(row.session_id)}`,
      snippet: this.generateSnippet(this.buildObservationText(row), options.query),
      score: row.score,
      timestamp: this.normalizeTimestamp(row.created_at),
      source: "memo",
    }));
  }

  private searchMemuItemsFts(
    db: ReturnType<ConnectionManager["getDatabase"]>,
    options: UnifiedSearchOptions,
  ): UnifiedSearchResult[] {
    const tableCheck = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_items_fts'")
      .get();
    if (!tableCheck) {
      return [];
    }

    let sql = `
      SELECT mi.id, mi.memory_type, mi.summary, mi.reflection, mi.lesson, mi.created_at,
             bm25(memory_items_fts) as rank
      FROM memory_items mi
      JOIN memory_items_fts fts ON mi.rowid = fts.rowid
      WHERE memory_items_fts MATCH ?
    `;
    const params: unknown[] = [options.query];

    if (options.since) {
      sql += " AND mi.created_at >= ?";
      params.push(this.toSqliteDateTime(options.since));
    }
    if (options.until) {
      sql += " AND mi.created_at <= ?";
      params.push(this.toSqliteDateTime(options.until));
    }

    sql += " ORDER BY rank ASC LIMIT 50";

    const rows = db.prepare(sql).all(...params) as MemuSearchRow[];
    return rows.map((row) => {
      const rank = typeof row.rank === "number" && Number.isFinite(row.rank) ? row.rank : 1;
      return {
        type: "observation" as SearchResultType,
        id: `memu:${row.id}`,
        title: `[${row.memory_type}] long-term memory`,
        snippet: this.generateSnippet(this.buildMemuItemText(row), options.query),
        score: rank <= 0 ? 1 : 1 / (1 + rank),
        timestamp: this.normalizeTimestamp(row.created_at),
        source: "memo",
      };
    });
  }

  /**
   * Fallback memory search using LIKE
   */
  private searchMemoryFallback(options: UnifiedSearchOptions): UnifiedSearchResult[] {
    const db = this.conn.getDatabase("memo");
    const results: UnifiedSearchResult[] = [];

    try {
      const pattern = `%${options.query}%`;

      let sql = `
        SELECT id, type, summary, input, output, created_at, session_id
        FROM observations
        WHERE (summary LIKE ? OR input LIKE ? OR output LIKE ?)
      `;
      const params: unknown[] = [pattern, pattern, pattern];

      if (options.since) {
        sql += " AND created_at >= ?";
        params.push(this.toSqliteDateTime(options.since));
      }

      sql += " ORDER BY created_at DESC LIMIT 50";

      const rows = db.prepare(sql).all(...params) as MemorySearchRow[];

      results.push(
        ...rows.map((row) => ({
          type: "observation" as SearchResultType,
          id: row.id,
          title: `[${row.type}] session ${String(row.session_id)}`,
          snippet: this.generateSnippet(this.buildObservationText(row), options.query),
          score: 0.5,
          timestamp: this.normalizeTimestamp(row.created_at),
          source: "memo",
        })),
      );
    } catch {
      // Memo observations may not exist yet
    }

    // MemU fallback via LIKE for deployments where FTS triggers are stale/unavailable.
    try {
      const pattern = `%${options.query}%`;
      let sql = `
        SELECT id, memory_type, summary, reflection, lesson, created_at
        FROM memory_items
        WHERE (summary LIKE ? OR reflection LIKE ? OR lesson LIKE ?)
      `;
      const params: unknown[] = [pattern, pattern, pattern];

      if (options.since) {
        sql += " AND created_at >= ?";
        params.push(this.toSqliteDateTime(options.since));
      }
      if (options.until) {
        sql += " AND created_at <= ?";
        params.push(this.toSqliteDateTime(options.until));
      }

      sql += " ORDER BY created_at DESC LIMIT 50";

      const rows = db.prepare(sql).all(...params) as MemuSearchRow[];
      results.push(
        ...rows.map((row) => ({
          type: "observation" as SearchResultType,
          id: `memu:${row.id}`,
          title: `[${row.memory_type}] long-term memory`,
          snippet: this.generateSnippet(this.buildMemuItemText(row), options.query),
          score: 0.45,
          timestamp: this.normalizeTimestamp(row.created_at),
          source: "memo",
        })),
      );
    } catch {
      // MemU tables may not exist yet
    }

    return results.toSorted((a, b) => b.score - a.score || b.timestamp - a.timestamp).slice(0, 50);
  }

  private buildMemuItemText(row: MemuSearchRow): string {
    return [row.summary, row.reflection, row.lesson]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" ");
  }

  private async searchMemuStoreItems(
    options: UnifiedSearchOptions,
  ): Promise<UnifiedSearchResult[]> {
    const store = await getMemoryAdapter();
    const items = store.searchItemsByKeyword
      ? await store.searchItemsByKeyword(options.query, 50)
      : [];
    const since = options.since ?? null;
    const until = options.until ?? null;

    const filtered = items.filter((item) => {
      const ts = this.normalizeTimestamp(item.createdAt);
      if (since !== null && ts < since) {
        return false;
      }
      if (until !== null && ts > until) {
        return false;
      }
      return true;
    });

    return filtered.map((item, index) => {
      const text = [item.summary, item.reflection, item.lesson]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(" ");
      return {
        type: "observation" as SearchResultType,
        id: `memu:${item.id}`,
        title: `[${item.memoryType}] long-term memory`,
        snippet: this.generateSnippet(text, options.query),
        score: Math.max(0.2, 0.95 - index * 0.02),
        timestamp: this.normalizeTimestamp(item.createdAt),
        source: "memu",
      };
    });
  }

  private async searchStorageMemoryItems(
    adapter: MemoryAdapter,
    options: UnifiedSearchOptions,
  ): Promise<UnifiedSearchResult[]> {
    const since = options.since ?? null;
    const until = options.until ?? null;
    const hits = await adapter.searchByKeyword(options.query, 50);

    return hits
      .filter((hit) => {
        const ts = this.normalizeTimestamp(hit.item.createdAt);
        if (since !== null && ts < since) return false;
        if (until !== null && ts > until) return false;
        return true;
      })
      .map((hit) => {
        const text = [hit.item.summary, hit.item.reflection, hit.item.lesson]
          .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
          .join(" ");
        return {
          type: "observation" as SearchResultType,
          id: `memu:${hit.item.id}`,
          title: `[${hit.item.memoryType}] long-term memory`,
          snippet: this.generateSnippet(text, options.query),
          score: hit.score,
          timestamp: this.normalizeTimestamp(hit.item.createdAt),
          source: "storage",
        };
      });
  }

  /**
   * Search sessions
   */
  private searchSessions(options: UnifiedSearchOptions): UnifiedSearchResult[] {
    const db = this.conn.getDatabase("sessions");

    try {
      const pattern = `%${options.query}%`;

      let sql = `
        SELECT id, agent_id, channel_id, status, started_at, message_count
        FROM sessions
        WHERE (agent_id LIKE ? OR channel_id LIKE ? OR id LIKE ?)
      `;
      const params: unknown[] = [pattern, pattern, pattern];

      if (options.agentId) {
        sql += " AND agent_id = ?";
        params.push(options.agentId);
      }
      if (options.since) {
        sql += " AND started_at >= ?";
        params.push(options.since);
      }

      sql += " ORDER BY started_at DESC LIMIT 50";

      const rows = db.prepare(sql).all(...params) as SessionSearchRow[];

      return rows.map((row) => ({
        type: "session" as SearchResultType,
        id: row.id,
        title: `Session: ${row.agent_id}${row.channel_id ? ` (${row.channel_id})` : ""}`,
        snippet: `Status: ${row.status}, Messages: ${row.message_count}`,
        score: 0.3, // Sessions get lower priority in search
        timestamp: row.started_at,
        source: "sessions",
      }));
    } catch {
      // Sessions DB might not exist yet
      return [];
    }
  }

  /**
   * Generate a snippet with query highlights
   */
  private generateSnippet(text: string, query: string, maxLength = 150): string {
    if (!text) return "";

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);

    if (index === -1) {
      return text.slice(0, maxLength) + (text.length > maxLength ? "..." : "");
    }

    // Center the snippet around the match
    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, index + query.length + 100);

    let snippet = text.slice(start, end);
    if (start > 0) snippet = "..." + snippet;
    if (end < text.length) snippet = snippet + "...";

    return snippet;
  }

  private buildObservationText(row: MemorySearchRow): string {
    return [row.summary, row.input, row.output]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" ");
  }

  private normalizeTimestamp(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const asNumber = Number(value);
      if (Number.isFinite(asNumber) && asNumber > 0) {
        return asNumber;
      }
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return Date.now();
  }

  private toSqliteDateTime(timestamp: number): string {
    return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19);
  }

  /**
   * Get search suggestions based on recent content
   */
  getSuggestions(prefix: string, limit = 10): string[] {
    const suggestions: Set<string> = new Set();

    // Get recent task titles
    try {
      const db = this.conn.getDatabase("dashboard");
      const rows = db
        .prepare(
          "SELECT DISTINCT title FROM tasks WHERE title LIKE ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(`${prefix}%`, limit) as Array<{ title: string }>;
      for (const row of rows) {
        suggestions.add(row.title);
      }
    } catch {
      // Ignore
    }

    // Get recent observation types
    try {
      const db = this.conn.getDatabase("memo");
      const rows = db
        .prepare("SELECT DISTINCT type FROM observations WHERE type LIKE ? LIMIT ?")
        .all(`${prefix}%`, limit) as Array<{ type: string }>;
      for (const row of rows) {
        suggestions.add(row.type);
      }
    } catch {
      // Ignore
    }

    return Array.from(suggestions).slice(0, limit);
  }
}

interface TaskSearchRow {
  id: string;
  title: string;
  description: string | null;
  created_at: number;
  score: number;
}

interface MemorySearchRow {
  id: number;
  type: string;
  summary: string | null;
  input: string | null;
  output: string | null;
  created_at: string | number;
  session_id: string | number;
  score: number;
}

interface MemuSearchRow {
  id: string;
  memory_type: string;
  summary: string | null;
  reflection: string | null;
  lesson: string | null;
  created_at: string | number;
  rank?: number;
}

interface SessionSearchRow {
  id: string;
  agent_id: string;
  channel_id: string | null;
  status: string;
  started_at: number;
  message_count: number;
}
