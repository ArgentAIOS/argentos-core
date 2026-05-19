/**
 * Argent Agent — Session Manager
 *
 * Ties together session storage, token counting, and compaction into a
 * single Session class that manages the lifecycle of a conversation.
 *
 * Built for Argent Core - February 16, 2026
 */

import type { SessionMessage } from "./tokenizer.js";
import { compactMessages, type CompactionConfig } from "./compaction.js";
import { SessionStore, type SessionEntry } from "./session-store.js";
import { estimateMessageTokens } from "./tokenizer.js";

// ============================================================================
// Session
// ============================================================================

export class Session {
  readonly id: string;
  private entries: SessionEntry[];
  private activeMessages: SessionMessage[];
  private store: SessionStore;

  private constructor(id: string, store: SessionStore, entries: SessionEntry[]) {
    this.id = id;
    this.store = store;
    this.entries = entries;
    this.activeMessages = [];
    this.rebuildMessages();
  }

  /** Create a new empty session */
  static create(id: string, store: SessionStore): Session {
    return new Session(id, store, []);
  }

  /** Load an existing session from storage */
  static async load(id: string, store: SessionStore): Promise<Session> {
    const entries = await store.read(id);
    return new Session(id, store, entries);
  }

  /** Append a message to the session */
  async append(message: SessionMessage): Promise<void> {
    const entry: SessionEntry = {
      id: crypto.randomUUID(),
      parentId: this.entries.length > 0 ? this.entries[this.entries.length - 1]!.id : null,
      type: "message",
      message,
      timestamp: message.timestamp ?? Date.now(),
    };
    this.entries.push(entry);
    this.activeMessages.push(message);
    await this.store.append(this.id, entry);
  }

  /** Get active messages (post-compaction) */
  getMessages(): SessionMessage[] {
    return this.activeMessages;
  }

  /** Get estimated token count */
  getTokenCount(): number {
    return estimateMessageTokens(this.activeMessages);
  }

  /**
   * Run compaction if needed.
   * Returns true if compaction was performed.
   */
  async compact(config: CompactionConfig): Promise<boolean> {
    const result = await compactMessages(this.activeMessages, config);
    if (!result.compacted) return false;

    // Store a compaction entry with the summary
    const entry: SessionEntry = {
      id: crypto.randomUUID(),
      parentId: this.entries.length > 0 ? this.entries[this.entries.length - 1]!.id : null,
      type: "compaction",
      compactionSummary: result.summary,
      metadata: {
        removedCount: result.removedCount,
        tokenSavings: result.tokenSavings,
      },
      timestamp: Date.now(),
    };
    this.entries.push(entry);
    await this.store.append(this.id, entry);

    // Store each kept message as new entries so replay works from compaction point
    for (const msg of result.messages) {
      const msgEntry: SessionEntry = {
        id: crypto.randomUUID(),
        parentId: this.entries[this.entries.length - 1]!.id,
        type: "message",
        message: msg,
        timestamp: msg.timestamp ?? Date.now(),
      };
      this.entries.push(msgEntry);
      await this.store.append(this.id, msgEntry);
    }

    this.rebuildMessages();
    return true;
  }

  /** Save current state — no-op since we append on every write */
  async save(): Promise<void> {
    // Entries are persisted on append/compact.
    // This method exists for API consistency if bulk writes are added later.
  }

  /** Get session metadata */
  getMetadata(): {
    id: string;
    entryCount: number;
    tokenCount: number;
    createdAt: number;
  } {
    return {
      id: this.id,
      entryCount: this.entries.length,
      tokenCount: this.getTokenCount(),
      createdAt: this.entries.length > 0 ? this.entries[0]!.timestamp : Date.now(),
    };
  }

  /**
   * Rebuild activeMessages from entries.
   *
   * Walks entries from the most recent "compaction" entry (if any) and
   * collects all "message" entries after it. This ensures that after
   * compaction, only the summary + recent messages are active.
   */
  private rebuildMessages(): void {
    // Find the last compaction entry
    let startIndex = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i]!.type === "compaction") {
        startIndex = i + 1;
        break;
      }
    }

    this.activeMessages = [];
    for (let i = startIndex; i < this.entries.length; i++) {
      const entry = this.entries[i]!;
      if (entry.type === "message" && entry.message) {
        this.activeMessages.push(entry.message);
      }
    }
  }
}
