/**
 * Argent Agent — Session Store
 *
 * JSONL file persistence for session entries.
 * Each session is a `.jsonl` file — one JSON object per line.
 *
 * Built for Argent Core - February 16, 2026
 */

import { readFile, appendFile, readdir, unlink, mkdir, access } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { SessionMessage } from "./tokenizer.js";

// ============================================================================
// Types
// ============================================================================

export interface SessionEntry {
  id: string;
  parentId: string | null;
  type: "message" | "compaction" | "metadata";
  message?: SessionMessage;
  compactionSummary?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

// ============================================================================
// Store
// ============================================================================

export class SessionStore {
  private baseDir: string;
  private dirEnsured = false;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), ".argentos", "sessions");
  }

  /** Append an entry to a session file */
  async append(sessionId: string, entry: SessionEntry): Promise<void> {
    await this.ensureDir();
    const line = JSON.stringify(entry) + "\n";
    await appendFile(this.getPath(sessionId), line, "utf-8");
  }

  /** Read all entries from a session file */
  async read(sessionId: string): Promise<SessionEntry[]> {
    const path = this.getPath(sessionId);
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const entries: SessionEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as SessionEntry);
      } catch {
        // Skip corrupt lines
      }
    }
    return entries;
  }

  /** List all session IDs */
  async list(): Promise<string[]> {
    try {
      const files = await readdir(this.baseDir);
      return files.filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6)); // strip .jsonl
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  /** Delete a session file */
  async delete(sessionId: string): Promise<void> {
    try {
      await unlink(this.getPath(sessionId));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }

  /** Check if a session exists */
  async exists(sessionId: string): Promise<boolean> {
    try {
      await access(this.getPath(sessionId));
      return true;
    } catch {
      return false;
    }
  }

  /** Ensure the base directory exists (lazy creation) */
  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return;
    await mkdir(this.baseDir, { recursive: true });
    this.dirEnsured = true;
  }

  /** Get the file path for a session */
  private getPath(sessionId: string): string {
    return join(this.baseDir, `${sessionId}.jsonl`);
  }
}
