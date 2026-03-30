/**
 * aos-lcm — Large File Handler
 *
 * Files over the token threshold are stored externally with compact
 * exploration summaries injected into context instead of the full content.
 */

import type Database from "better-sqlite3";
import type { CompleteFn } from "./summarize.js";
import type { StoredFile, LcmConfig } from "./types.js";

export class LargeFileStore {
  constructor(
    private db: Database.Database,
    private complete: CompleteFn,
    private config: LcmConfig,
  ) {}

  /**
   * Check if content exceeds the large file threshold.
   */
  isLargeFile(tokenCount: number): boolean {
    return tokenCount > this.config.largeFileTokenThreshold;
  }

  /**
   * Store a large file and generate an exploration summary.
   * Returns the summary to inject in place of the full content.
   */
  async store(
    sessionId: string,
    filePath: string,
    content: string,
    tokenCount: number,
  ): Promise<string> {
    // Generate exploration summary
    const summary = await this.generateExplorationSummary(filePath, content, tokenCount);

    // Persist to database
    this.db
      .prepare(`
      INSERT INTO large_files (session_id, file_path, token_count, exploration_summary, content_hash)
      VALUES (?, ?, ?, ?, ?)
    `)
      .run(sessionId, filePath, tokenCount, summary, simpleHash(content));

    return this.formatReference(filePath, tokenCount, summary);
  }

  /**
   * Get a stored file's exploration summary by path.
   */
  get(sessionId: string, filePath: string): StoredFile | null {
    const row = this.db
      .prepare(`
      SELECT * FROM large_files
      WHERE session_id = ? AND file_path = ?
      ORDER BY stored_at DESC LIMIT 1
    `)
      .get(sessionId, filePath) as RawRow | undefined;

    return row ? toStoredFile(row) : null;
  }

  /**
   * List all large files stored for a session.
   */
  list(sessionId: string): StoredFile[] {
    const rows = this.db
      .prepare("SELECT * FROM large_files WHERE session_id = ? ORDER BY stored_at")
      .all(sessionId) as RawRow[];
    return rows.map(toStoredFile);
  }

  private async generateExplorationSummary(
    filePath: string,
    content: string,
    tokenCount: number,
  ): Promise<string> {
    // Take first and last portions for the LLM to summarize
    const previewSize = 8000; // chars
    const preview =
      content.length <= previewSize * 2
        ? content
        : content.slice(0, previewSize) +
          "\n\n[...middle omitted...]\n\n" +
          content.slice(-previewSize);

    const prompt = [
      `Generate a concise exploration summary for the file "${filePath}" (${tokenCount} tokens).`,
      "The summary should help an agent understand:",
      "- What the file contains (purpose, structure)",
      "- Key sections, functions, classes, or data structures",
      "- Important details that might be referenced later",
      "",
      "Be concise (200-400 words). Focus on what's useful for future reference.",
      "",
      "--- File Preview ---",
      preview,
    ].join("\n");

    return this.complete({
      prompt,
      temperature: 0.1,
      maxTokens: 800,
    });
  }

  private formatReference(filePath: string, tokenCount: number, summary: string): string {
    return [
      `[LCM: Large file stored externally — ${filePath} (${tokenCount} tokens)]`,
      "",
      "Exploration summary:",
      summary,
      "",
      `Use aos_lcm_describe to access specific sections of this file.`,
    ].join("\n");
  }
}

// ============================================================================
// Internal
// ============================================================================

type RawRow = {
  id: number;
  session_id: string;
  file_path: string;
  token_count: number;
  exploration_summary: string;
  content_hash: string | null;
  stored_at: string;
};

function toStoredFile(row: RawRow): StoredFile {
  return {
    id: row.id,
    sessionId: row.session_id,
    filePath: row.file_path,
    tokenCount: row.token_count,
    explorationSummary: row.exploration_summary,
    storedAt: row.stored_at,
  };
}

function simpleHash(content: string): string {
  // Quick non-crypto hash for change detection
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}
