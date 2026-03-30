/**
 * aos-lcm — Conversation Store
 *
 * Immutable message persistence. Every message ingested is stored verbatim
 * and never modified or deleted. This is the ground truth that summaries
 * compress and that lcm_grep searches over.
 */

import type Database from "better-sqlite3";
import type { StoredMessage, ContentBlock, GrepResult } from "../types.js";

export class ConversationStore {
  constructor(private db: Database.Database) {}

  /** Persist a message to the immutable store. Returns the assigned ID. */
  ingest(
    sessionId: string,
    role: "user" | "assistant" | "system",
    content: string,
    tokenCount: number,
    opts?: { toolCallId?: string; contentBlocks?: ContentBlock[] },
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO messages (session_id, role, content, token_count, tool_call_id, content_blocks)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      sessionId,
      role,
      content,
      tokenCount,
      opts?.toolCallId ?? null,
      opts?.contentBlocks ? JSON.stringify(opts.contentBlocks) : null,
    );
    return Number(result.lastInsertRowid);
  }

  /** Get a message by ID. */
  get(id: number): StoredMessage | null {
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
      | RawRow
      | undefined;
    return row ? toStoredMessage(row) : null;
  }

  /** Get messages by ID range (inclusive). */
  getRange(sessionId: string, fromId: number, toId: number): StoredMessage[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE session_id = ? AND id >= ? AND id <= ? ORDER BY id")
      .all(sessionId, fromId, toId) as RawRow[];
    return rows.map(toStoredMessage);
  }

  /** Get the N most recent messages for a session. */
  getRecent(sessionId: string, limit: number): StoredMessage[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?")
      .all(sessionId, limit) as RawRow[];
    return rows.map(toStoredMessage).reverse();
  }

  /** Count messages in a session. */
  count(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?")
      .get(sessionId) as { cnt: number };
    return row.cnt;
  }

  /** Sum token count for a session. */
  totalTokens(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(token_count), 0) as total FROM messages WHERE session_id = ?")
      .get(sessionId) as { total: number };
    return row.total;
  }

  /**
   * FTS5 grep over immutable message history.
   * Returns ranked results with snippets.
   */
  grep(sessionId: string, query: string, limit = 20): GrepResult[] {
    // Sanitize query for FTS5 — strip operators that could cause syntax errors
    const safeQuery = sanitizeFts5Query(query);
    if (!safeQuery) return [];

    const rows = this.db
      .prepare(`
      SELECT
        m.id,
        m.role,
        snippet(messages_fts, 0, '>>>', '<<<', '...', 48) as snippet,
        m.created_at,
        rank
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      WHERE messages_fts MATCH ?
        AND m.session_id = ?
      ORDER BY rank
      LIMIT ?
    `)
      .all(safeQuery, sessionId, limit) as Array<{
      id: number;
      role: string;
      snippet: string;
      created_at: string;
      rank: number;
    }>;

    return rows.map((r) => ({
      messageId: r.id,
      role: r.role,
      snippet: r.snippet,
      createdAt: r.created_at,
      rank: r.rank,
    }));
  }

  /** Get all message IDs in a session, ordered. */
  getMessageIds(sessionId: string): number[] {
    const rows = this.db
      .prepare("SELECT id FROM messages WHERE session_id = ? ORDER BY id")
      .all(sessionId) as Array<{ id: number }>;
    return rows.map((r) => r.id);
  }

  /** Get messages by a list of IDs (preserves order). */
  getByIds(ids: number[]): StoredMessage[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM messages WHERE id IN (${placeholders}) ORDER BY id`)
      .all(...ids) as RawRow[];
    return rows.map(toStoredMessage);
  }
}

// ============================================================================
// Internal helpers
// ============================================================================

type RawRow = {
  id: number;
  session_id: string;
  role: string;
  content: string;
  token_count: number;
  tool_call_id: string | null;
  content_blocks: string | null;
  created_at: string;
};

function toStoredMessage(row: RawRow): StoredMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as StoredMessage["role"],
    content: row.content,
    tokenCount: row.token_count,
    createdAt: row.created_at,
    toolCallId: row.tool_call_id ?? undefined,
    contentBlocks: row.content_blocks
      ? (JSON.parse(row.content_blocks) as ContentBlock[])
      : undefined,
  };
}

/**
 * Sanitize a query string for FTS5.
 * Strips characters that cause syntax errors and wraps bare terms.
 */
function sanitizeFts5Query(raw: string): string {
  // Remove FTS5 operators that could break queries
  let q = raw.replace(/[(){}[\]^~*:]/g, " ");
  // Collapse whitespace
  q = q.replace(/\s+/g, " ").trim();
  if (!q) return "";
  // Wrap individual terms in quotes if they contain special chars
  const terms = q.split(" ").filter(Boolean);
  if (terms.length === 1) return `"${terms[0]}"`;
  // Multiple terms: OR them for broader results
  return terms.map((t) => `"${t}"`).join(" OR ");
}
