/**
 * aos-lcm — Summary Store
 *
 * Manages the hierarchical DAG of summary nodes. Each summary links back
 * to its source material (messages at depth 0, other summaries at depth 1+).
 *
 * CRITICAL: Unlike the upstream lossless-claw (Bug #203), this implementation
 * properly removes compacted items from context_items when summaries replace them.
 */

import type Database from "better-sqlite3";
import type { SummaryNode, ContextItem, StoredMessage } from "../types.js";

export class SummaryStore {
  constructor(private db: Database.Database) {}

  /**
   * Create a leaf summary (depth 0) from a set of raw messages.
   * Removes the compacted messages from context_items and inserts the summary.
   */
  createLeafSummary(
    sessionId: string,
    content: string,
    tokenCount: number,
    sourceMessageIds: number[],
  ): SummaryNode {
    const node = this.db.transaction(() => {
      // Insert summary
      const result = this.db
        .prepare(`
        INSERT INTO summaries (session_id, depth, content, token_count)
        VALUES (?, 0, ?, ?)
      `)
        .run(sessionId, content, tokenCount);
      const summaryId = Number(result.lastInsertRowid);

      // Link to source messages
      const linkStmt = this.db.prepare(
        "INSERT INTO summary_messages (summary_id, message_id) VALUES (?, ?)",
      );
      for (const msgId of sourceMessageIds) {
        linkStmt.run(summaryId, msgId);
      }

      // Remove compacted messages from context_items
      const placeholders = sourceMessageIds.map(() => "?").join(",");
      this.db
        .prepare(`
        DELETE FROM context_items
        WHERE session_id = ? AND kind = 'message' AND ref_id IN (${placeholders})
      `)
        .run(sessionId, ...sourceMessageIds);

      // Insert summary as context item at the position of the first compacted message
      const nextPos = this.getNextContextPosition(sessionId);
      this.db
        .prepare(`
        INSERT INTO context_items (session_id, kind, ref_id, position)
        VALUES (?, 'summary', ?, ?)
      `)
        .run(sessionId, summaryId, nextPos);

      return this.getNode(summaryId)!;
    })();

    return node;
  }

  /**
   * Create a condensed summary (depth 1+) from lower-depth summaries.
   * Marks source summaries as condensed and swaps them out of context_items.
   */
  createCondensedSummary(
    sessionId: string,
    content: string,
    tokenCount: number,
    sourceSummaryIds: number[],
    depth: number,
  ): SummaryNode {
    const node = this.db.transaction(() => {
      // Insert higher-depth summary
      const result = this.db
        .prepare(`
        INSERT INTO summaries (session_id, depth, content, token_count)
        VALUES (?, ?, ?, ?)
      `)
        .run(sessionId, depth, content, tokenCount);
      const summaryId = Number(result.lastInsertRowid);

      // Link to source summaries
      const linkStmt = this.db.prepare(
        "INSERT INTO summary_sources (summary_id, source_id) VALUES (?, ?)",
      );
      for (const srcId of sourceSummaryIds) {
        linkStmt.run(summaryId, srcId);
      }

      // Mark sources as condensed
      const condensePlaceholders = sourceSummaryIds.map(() => "?").join(",");
      this.db
        .prepare(`
        UPDATE summaries SET condensed = 1
        WHERE id IN (${condensePlaceholders})
      `)
        .run(...sourceSummaryIds);

      // Remove condensed summaries from context_items
      this.db
        .prepare(`
        DELETE FROM context_items
        WHERE session_id = ? AND kind = 'summary' AND ref_id IN (${condensePlaceholders})
      `)
        .run(sessionId, ...sourceSummaryIds);

      // Insert new summary as context item
      const nextPos = this.getNextContextPosition(sessionId);
      this.db
        .prepare(`
        INSERT INTO context_items (session_id, kind, ref_id, position)
        VALUES (?, 'summary', ?, ?)
      `)
        .run(sessionId, summaryId, nextPos);

      return this.getNode(summaryId)!;
    })();

    return node;
  }

  /** Get a summary node by ID. */
  getNode(id: number): SummaryNode | null {
    const row = this.db.prepare("SELECT * FROM summaries WHERE id = ?").get(id) as
      | RawSummaryRow
      | undefined;
    if (!row) return null;
    return toSummaryNode(row, this.getSourceIds(row.id, row.depth));
  }

  /** Get uncondensed summaries at a given depth for a session. */
  getUncondensedAtDepth(sessionId: string, depth: number): SummaryNode[] {
    const rows = this.db
      .prepare(`
      SELECT * FROM summaries
      WHERE session_id = ? AND depth = ? AND condensed = 0
      ORDER BY id
    `)
      .all(sessionId, depth) as RawSummaryRow[];

    return rows.map((r) => toSummaryNode(r, this.getSourceIds(r.id, r.depth)));
  }

  /** Count uncondensed summaries at a given depth. */
  countUncondensedAtDepth(sessionId: string, depth: number): number {
    const row = this.db
      .prepare(`
      SELECT COUNT(*) as cnt FROM summaries
      WHERE session_id = ? AND depth = ? AND condensed = 0
    `)
      .get(sessionId, depth) as { cnt: number };
    return row.cnt;
  }

  /** Get the maximum depth in the DAG for a session. */
  maxDepth(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(depth), -1) as d FROM summaries WHERE session_id = ?")
      .get(sessionId) as { d: number };
    return row.d;
  }

  // --------------------------------------------------------------------------
  // Context Items (what the model actually sees)
  // --------------------------------------------------------------------------

  /** Add a raw message to the active context window. */
  addMessageToContext(sessionId: string, messageId: number): void {
    const pos = this.getNextContextPosition(sessionId);
    this.db
      .prepare(`
      INSERT INTO context_items (session_id, kind, ref_id, position)
      VALUES (?, 'message', ?, ?)
    `)
      .run(sessionId, messageId, pos);
  }

  /**
   * Assemble the current context window for a session.
   * Returns items in position order (summaries first, then recent messages).
   */
  assembleContext(sessionId: string): ContextItem[] {
    const rows = this.db
      .prepare(`
      SELECT kind, ref_id FROM context_items
      WHERE session_id = ?
      ORDER BY position
    `)
      .all(sessionId) as Array<{ kind: string; ref_id: number }>;

    const items: ContextItem[] = [];
    for (const row of rows) {
      if (row.kind === "message") {
        const msg = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(row.ref_id) as
          | RawMessageRow
          | undefined;
        if (msg) {
          items.push({
            kind: "message",
            message: toStoredMessageFromRaw(msg),
          });
        }
      } else {
        const node = this.getNode(row.ref_id);
        if (node) {
          items.push({ kind: "summary", summary: node });
        }
      }
    }

    return items;
  }

  /** Count context items for a session. */
  contextItemCount(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM context_items WHERE session_id = ?")
      .get(sessionId) as { cnt: number };
    return row.cnt;
  }

  /** Sum token count of all context items. */
  contextTokenCount(sessionId: string): number {
    const row = this.db
      .prepare(`
      SELECT COALESCE(
        (SELECT SUM(m.token_count) FROM context_items ci
         JOIN messages m ON ci.ref_id = m.id
         WHERE ci.session_id = ? AND ci.kind = 'message'),
        0
      ) + COALESCE(
        (SELECT SUM(s.token_count) FROM context_items ci
         JOIN summaries s ON ci.ref_id = s.id
         WHERE ci.session_id = ? AND ci.kind = 'summary'),
        0
      ) as total
    `)
      .get(sessionId, sessionId) as { total: number };
    return row.total;
  }

  /** Clear all context items for a session (used during full reassembly). */
  clearContext(sessionId: string): void {
    this.db.prepare("DELETE FROM context_items WHERE session_id = ?").run(sessionId);
  }

  // --------------------------------------------------------------------------
  // DAG Expansion (for lcm_expand tool)
  // --------------------------------------------------------------------------

  /**
   * Expand a summary node back to its source material, recursively.
   * Returns all leaf messages reachable from this node.
   */
  expandToMessages(summaryId: number): StoredMessage[] {
    const node = this.getNode(summaryId);
    if (!node) return [];

    if (node.depth === 0) {
      // Leaf summary — source IDs are message IDs
      const placeholders = node.sourceIds.map(() => "?").join(",");
      const rows = this.db
        .prepare(`SELECT * FROM messages WHERE id IN (${placeholders}) ORDER BY id`)
        .all(...node.sourceIds) as RawMessageRow[];
      return rows.map(toStoredMessageFromRaw);
    }

    // Higher depth — recurse through source summaries
    const messages: StoredMessage[] = [];
    for (const srcId of node.sourceIds) {
      messages.push(...this.expandToMessages(srcId));
    }
    return messages;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private getSourceIds(summaryId: number, depth: number): number[] {
    if (depth === 0) {
      const rows = this.db
        .prepare("SELECT message_id FROM summary_messages WHERE summary_id = ? ORDER BY message_id")
        .all(summaryId) as Array<{ message_id: number }>;
      return rows.map((r) => r.message_id);
    }
    const rows = this.db
      .prepare("SELECT source_id FROM summary_sources WHERE summary_id = ? ORDER BY source_id")
      .all(summaryId) as Array<{ source_id: number }>;
    return rows.map((r) => r.source_id);
  }

  private getNextContextPosition(sessionId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM context_items WHERE session_id = ?",
      )
      .get(sessionId) as { next_pos: number };
    return row.next_pos;
  }
}

// ============================================================================
// Raw row types
// ============================================================================

type RawSummaryRow = {
  id: number;
  session_id: string;
  depth: number;
  content: string;
  token_count: number;
  condensed: number;
  created_at: string;
};

type RawMessageRow = {
  id: number;
  session_id: string;
  role: string;
  content: string;
  token_count: number;
  tool_call_id: string | null;
  content_blocks: string | null;
  created_at: string;
};

function toSummaryNode(row: RawSummaryRow, sourceIds: number[]): SummaryNode {
  return {
    id: row.id,
    sessionId: row.session_id,
    depth: row.depth,
    content: row.content,
    tokenCount: row.token_count,
    createdAt: row.created_at,
    sourceIds,
    condensed: row.condensed === 1,
  };
}

function toStoredMessageFromRaw(row: RawMessageRow): StoredMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as StoredMessage["role"],
    content: row.content,
    tokenCount: row.token_count,
    createdAt: row.created_at,
    toolCallId: row.tool_call_id ?? undefined,
    contentBlocks: row.content_blocks
      ? (JSON.parse(row.content_blocks) as import("../types.js").ContentBlock[])
      : undefined,
  };
}
