/**
 * aos-lcm — LCM Context Engine
 *
 * Orchestrates the full lifecycle: ingest messages → check threshold →
 * compact into DAG → assemble context for next turn.
 *
 * This is the central coordinator. The plugin entry point creates one
 * instance and wires it into ArgentOS's hook system.
 */

import type Database from "better-sqlite3";
import type { ContextBudget } from "./assembler.js";
import type { CompleteFn } from "./summarize.js";
import type { LcmConfig, CompactionResult, StoredMessage, ContentBlock } from "./types.js";
import { ContextAssembler } from "./assembler.js";
import { CompactionEngine } from "./compaction.js";
import { LargeFileStore } from "./large-files.js";
import { ConversationStore } from "./store/conversation-store.js";
import { SummaryStore } from "./store/summary-store.js";
import { createSummarizer } from "./summarize.js";

export class LcmContextEngine {
  readonly conversationStore: ConversationStore;
  readonly summaryStore: SummaryStore;
  readonly compactionEngine: CompactionEngine;
  readonly assembler: ContextAssembler;
  readonly largeFiles: LargeFileStore;

  private currentSessionId: string = "";

  constructor(
    private db: Database.Database,
    private config: LcmConfig,
    complete: CompleteFn,
  ) {
    this.conversationStore = new ConversationStore(db);
    this.summaryStore = new SummaryStore(db);
    const summarizer = createSummarizer(complete);
    this.compactionEngine = new CompactionEngine(
      this.conversationStore,
      this.summaryStore,
      summarizer,
      config,
    );
    this.assembler = new ContextAssembler(this.summaryStore, config);
    this.largeFiles = new LargeFileStore(db, complete, config);
  }

  /** Set the active session. Called at session start / resume. */
  setSession(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  get sessionId(): string {
    return this.currentSessionId;
  }

  /**
   * Ingest a new message into the immutable store and add it to
   * the active context window.
   */
  ingest(
    role: "user" | "assistant" | "system",
    content: string,
    tokenCount: number,
    opts?: { toolCallId?: string; contentBlocks?: ContentBlock[] },
  ): StoredMessage {
    const id = this.conversationStore.ingest(
      this.currentSessionId,
      role,
      content,
      tokenCount,
      opts,
    );
    this.summaryStore.addMessageToContext(this.currentSessionId, id);
    return this.conversationStore.get(id)!;
  }

  /**
   * Run compaction if the context exceeds the threshold.
   * Called after each turn (via the after_compaction or agent_end hook).
   */
  async compactIfNeeded(maxContextTokens: number): Promise<CompactionResult | null> {
    return this.compactionEngine.compact(this.currentSessionId, maxContextTokens);
  }

  /**
   * Assemble the compressed context for injection.
   * Returns a string suitable for `prependContext` in before_agent_start.
   */
  assembleContext(): string {
    return this.assembler.assemble(this.currentSessionId);
  }

  /**
   * Get context budget diagnostics.
   */
  getBudget(maxContextTokens: number): ContextBudget {
    return this.assembler.getBudget(this.currentSessionId, maxContextTokens);
  }

  /**
   * Check if content is a large file and handle it.
   * Returns the replacement content (exploration summary) or null if not large.
   */
  async handleLargeFile(
    filePath: string,
    content: string,
    tokenCount: number,
  ): Promise<string | null> {
    if (!this.largeFiles.isLargeFile(tokenCount)) return null;
    return this.largeFiles.store(this.currentSessionId, filePath, content, tokenCount);
  }
}
