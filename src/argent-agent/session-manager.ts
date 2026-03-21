/**
 * Argent Agent — Session Manager
 *
 * Tree-structured append-only conversation storage in JSONL files.
 * This is an Argent-native implementation matching Pi's SessionManager API.
 *
 * Key design decisions vs Pi:
 * - Same tree structure (id/parentId) for branching support
 * - Same append-only JSONL format for durability
 * - Cleaner compaction: tracks first-kept-entry explicitly
 * - Built-in index for O(1) entry lookups (Pi rebuilds on every access)
 * - Factory methods match Pi exactly for drop-in replacement
 *
 * @module argent-agent/session-manager
 */

import { randomUUID } from "crypto";
import { readFileSync, appendFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join, resolve, basename } from "path";
import type { TextContent, ImageContent } from "../argent-ai/types.js";
import type { AgentMessage } from "./pi-types.js";

// ============================================================================
// Constants
// ============================================================================

export const SESSION_FORMAT_VERSION = 3;

// ============================================================================
// Entry Types
// ============================================================================

export interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

export interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

export interface CompactionEntry<T = unknown> extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
  fromHook?: boolean;
}

export interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: T;
  fromHook?: boolean;
}

export interface CustomEntry<T = unknown> extends SessionEntryBase {
  type: "custom";
  customType: string;
  data?: T;
}

export interface CustomMessageEntry<T = unknown> extends SessionEntryBase {
  type: "custom_message";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  details?: T;
  display: boolean;
}

export interface LabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

export interface SessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  name?: string;
}

export type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry;

type SessionEntryInput = SessionEntry extends infer T
  ? T extends SessionEntry
    ? Omit<T, "id" | "parentId" | "timestamp">
    : never
  : never;

type FileEntry = SessionHeader | SessionEntry;

// ============================================================================
// Session Context (what the LLM sees)
// ============================================================================

export interface SessionContext {
  messages: AgentMessage[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}

// ============================================================================
// Session Info (for listing)
// ============================================================================

export interface SessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
  allMessagesText: string;
}

// ============================================================================
// Tree Node
// ============================================================================

export interface SessionTreeNode {
  entry: SessionEntry;
  children: SessionTreeNode[];
  label?: string;
}

// ============================================================================
// Standalone Helpers
// ============================================================================

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, SessionEntry>,
): SessionContext {
  const index = byId ?? new Map(entries.map((e) => [e.id, e]));
  const messages: AgentMessage[] = [];
  let thinkingLevel = "medium";
  let model: { provider: string; modelId: string } | null = null;

  // Walk from leaf to root collecting the branch
  const branch: SessionEntry[] = [];
  let currentId = leafId ?? (entries.length > 0 ? entries[entries.length - 1]!.id : null);
  while (currentId) {
    const entry = index.get(currentId);
    if (!entry) break;
    branch.unshift(entry);
    currentId = entry.parentId;
  }

  // Process branch entries
  let compactionSummary: string | null = null;
  for (const entry of branch) {
    if (entry.type === "compaction") {
      compactionSummary = (entry as CompactionEntry).summary;
      messages.length = 0; // Clear messages before compaction point
      if (compactionSummary) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: `Previous conversation summary:\n\n${compactionSummary}` },
          ],
        } as unknown as AgentMessage);
      }
    } else if (entry.type === "branch_summary") {
      const bs = entry as BranchSummaryEntry;
      messages.push({
        role: "user",
        content: [
          { type: "text", text: `Context from previous conversation path:\n\n${bs.summary}` },
        ],
      } as unknown as AgentMessage);
    } else if (entry.type === "message") {
      messages.push((entry as SessionMessageEntry).message);
    } else if (entry.type === "custom_message") {
      const cm = entry as CustomMessageEntry;
      const text =
        typeof cm.content === "string"
          ? cm.content
          : cm.content
              .map((b) => {
                if (b.type === "text") return (b as TextContent).text;
                return "[image]";
              })
              .join("");
      messages.push({
        role: "user",
        content: [{ type: "text", text }],
      } as unknown as AgentMessage);
    } else if (entry.type === "thinking_level_change") {
      thinkingLevel = (entry as ThinkingLevelChangeEntry).thinkingLevel;
    } else if (entry.type === "model_change") {
      const mc = entry as ModelChangeEntry;
      model = { provider: mc.provider, modelId: mc.modelId };
    }
  }

  return { messages, thinkingLevel, model };
}

function encodeSessionDir(cwd: string): string {
  return cwd.replace(/[/\\:]/g, "_").replace(/^_+|_+$/g, "");
}

function defaultSessionDir(cwd: string): string {
  return join(homedir(), ".argentos", "sessions", encodeSessionDir(cwd));
}

// ============================================================================
// Session Manager
// ============================================================================

export class ArgentSessionManager {
  private sessionId: string;
  private sessionFile: string | undefined;
  private sessionDir: string;
  private cwd: string;
  private persist: boolean;
  private fileEntries: FileEntry[] = [];
  private byId = new Map<string, SessionEntry>();
  private labelsById = new Map<string, string>();
  private leafId: string | null = null;

  private constructor(cwd: string, sessionDir: string, persist: boolean) {
    this.sessionId = randomUUID();
    this.cwd = cwd;
    this.sessionDir = sessionDir;
    this.persist = persist;
  }

  // ==========================================================================
  // Static Factories (match Pi's API exactly)
  // ==========================================================================

  /** Create a new session for a working directory. */
  static create(cwd: string, sessionDir?: string): ArgentSessionManager {
    const dir = sessionDir ?? defaultSessionDir(cwd);
    const sm = new ArgentSessionManager(cwd, dir, true);
    mkdirSync(dir, { recursive: true });
    sm.sessionFile = join(dir, `${sm.sessionId}.jsonl`);
    sm._writeHeader();
    return sm;
  }

  /** Open an existing session file. */
  static open(path: string, sessionDir?: string): ArgentSessionManager {
    const resolved = resolve(path);
    const dir = sessionDir ?? resolve(resolved, "..");
    const sm = new ArgentSessionManager("", dir, true);
    sm.sessionFile = resolved;
    sm._loadFromFile(resolved);
    return sm;
  }

  /** Continue the most recent session, or create new if none exists. */
  static continueRecent(cwd: string, sessionDir?: string): ArgentSessionManager {
    const dir = sessionDir ?? defaultSessionDir(cwd);
    const recent = ArgentSessionManager._findMostRecent(dir);
    if (recent) {
      return ArgentSessionManager.open(recent, dir);
    }
    return ArgentSessionManager.create(cwd, dir);
  }

  /** Create an in-memory session (no file persistence). For testing. */
  static inMemory(cwd?: string): ArgentSessionManager {
    return new ArgentSessionManager(cwd ?? process.cwd(), "", false);
  }

  // ==========================================================================
  // Getters
  // ==========================================================================

  isPersisted(): boolean {
    return this.persist;
  }
  getCwd(): string {
    return this.cwd;
  }
  getSessionDir(): string {
    return this.sessionDir;
  }
  getSessionId(): string {
    return this.sessionId;
  }
  getSessionFile(): string | undefined {
    return this.sessionFile;
  }
  getLeafId(): string | null {
    return this.leafId;
  }

  getLeafEntry(): SessionEntry | undefined {
    return this.leafId ? this.byId.get(this.leafId) : undefined;
  }

  getEntry(id: string): SessionEntry | undefined {
    return this.byId.get(id);
  }

  getLabel(id: string): string | undefined {
    return this.labelsById.get(id);
  }

  getHeader(): SessionHeader | null {
    const first = this.fileEntries[0];
    return first && first.type === "session" ? (first as SessionHeader) : null;
  }

  getSessionName(): string | undefined {
    // Walk backwards to find latest session_info entry
    for (let i = this.fileEntries.length - 1; i >= 0; i--) {
      const entry = this.fileEntries[i];
      if (entry && "type" in entry && entry.type === "session_info") {
        return (entry as SessionInfoEntry).name;
      }
    }
    return undefined;
  }

  // ==========================================================================
  // Entries
  // ==========================================================================

  /** Get all session entries (excludes header). */
  getEntries(): SessionEntry[] {
    return this.fileEntries.filter((e): e is SessionEntry => e.type !== "session");
  }

  /** Get children of an entry. */
  getChildren(parentId: string): SessionEntry[] {
    return this.getEntries().filter((e) => e.parentId === parentId);
  }

  /** Walk from an entry to root, returning all entries in path order. */
  getBranch(fromId?: string): SessionEntry[] {
    const id = fromId ?? this.leafId;
    if (!id) return [];
    const branch: SessionEntry[] = [];
    let currentId: string | null = id;
    while (currentId) {
      const entry = this.byId.get(currentId);
      if (!entry) break;
      branch.unshift(entry);
      currentId = entry.parentId;
    }
    return branch;
  }

  /** Build the session context (what gets sent to the LLM). */
  buildSessionContext(): SessionContext {
    return buildSessionContext(this.getEntries(), this.leafId, this.byId);
  }

  /** Get session as a tree structure. */
  getTree(): SessionTreeNode[] {
    const entries = this.getEntries();
    const childrenMap = new Map<string | "root", SessionEntry[]>();
    childrenMap.set("root", []);

    for (const entry of entries) {
      const key = entry.parentId ?? "root";
      const list = childrenMap.get(key) ?? [];
      list.push(entry);
      childrenMap.set(key, list);
    }

    const buildNode = (entry: SessionEntry): SessionTreeNode => ({
      entry,
      children: (childrenMap.get(entry.id) ?? []).map(buildNode),
      label: this.labelsById.get(entry.id),
    });

    return (childrenMap.get("root") ?? []).map(buildNode);
  }

  // ==========================================================================
  // Append Operations
  // ==========================================================================

  appendMessage(message: AgentMessage): string {
    return this._appendEntry({
      type: "message",
      message,
    });
  }

  appendThinkingLevelChange(thinkingLevel: string): string {
    return this._appendEntry({
      type: "thinking_level_change",
      thinkingLevel,
    });
  }

  appendModelChange(provider: string, modelId: string): string {
    return this._appendEntry({
      type: "model_change",
      provider,
      modelId,
    });
  }

  appendCompaction<T = unknown>(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: T,
    fromHook?: boolean,
  ): string {
    return this._appendEntry({
      type: "compaction",
      summary,
      firstKeptEntryId,
      tokensBefore,
      details,
      fromHook,
    });
  }

  appendCustomEntry(customType: string, data?: unknown): string {
    return this._appendEntry({ type: "custom", customType, data });
  }

  appendSessionInfo(name: string): string {
    return this._appendEntry({ type: "session_info", name });
  }

  appendCustomMessageEntry<T = unknown>(
    customType: string,
    content: string | (TextContent | ImageContent)[],
    display: boolean,
    details?: T,
  ): string {
    return this._appendEntry({ type: "custom_message", customType, content, display, details });
  }

  appendLabelChange(targetId: string, label: string | undefined): string {
    if (label) {
      this.labelsById.set(targetId, label);
    } else {
      this.labelsById.delete(targetId);
    }
    return this._appendEntry({ type: "label", targetId, label });
  }

  // ==========================================================================
  // Branching
  // ==========================================================================

  /** Move the leaf pointer to an earlier entry (start a new branch). */
  branch(branchFromId: string): void {
    this.leafId = branchFromId;
  }

  /** Reset the leaf pointer to null (before any entries). */
  resetLeaf(): void {
    this.leafId = null;
  }

  /** Branch and append a summary of the abandoned path. */
  branchWithSummary(
    branchFromId: string | null,
    summary: string,
    details?: unknown,
    fromHook?: boolean,
  ): string {
    this.leafId = branchFromId;
    return this._appendEntry({
      type: "branch_summary",
      fromId: branchFromId ?? "",
      summary,
      details,
      fromHook,
    });
  }

  /** Switch to a different session file. */
  setSessionFile(sessionFile: string): void {
    this.sessionFile = sessionFile;
    this._loadFromFile(sessionFile);
  }

  /** Start a new session within the same manager. */
  newSession(options?: { parentSession?: string }): string | undefined {
    this.sessionId = randomUUID();
    this.fileEntries = [];
    this.byId.clear();
    this.labelsById.clear();
    this.leafId = null;

    if (this.persist) {
      this.sessionFile = join(this.sessionDir, `${this.sessionId}.jsonl`);
      this._writeHeader(options?.parentSession);
      return this.sessionFile;
    }
    return undefined;
  }

  // ==========================================================================
  // Session Listing
  // ==========================================================================

  static async list(cwd: string, sessionDir?: string): Promise<SessionInfo[]> {
    const dir = sessionDir ?? defaultSessionDir(cwd);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      return [];
    }

    const infos: SessionInfo[] = [];
    for (const file of files) {
      const fullPath = join(dir, file);
      try {
        const st = statSync(fullPath);
        const raw = readFileSync(fullPath, "utf-8");
        const lines = raw.split("\n").filter((l) => l.trim());
        const entries = lines.map((l) => JSON.parse(l) as FileEntry);

        const header = entries[0]?.type === "session" ? (entries[0] as SessionHeader) : null;
        const messages = entries.filter(
          (e): e is SessionMessageEntry => "type" in e && e.type === "message",
        );
        const allText = messages
          .map((m) => {
            const msg = m.message;
            if (typeof msg === "string") return msg;
            if (msg && typeof msg === "object" && "content" in msg) {
              const c = msg.content;
              if (typeof c === "string") return c;
              if (Array.isArray(c)) {
                return c
                  .map((b: unknown) => {
                    if (b && typeof b === "object" && "text" in b)
                      return (b as { text: string }).text;
                    return "";
                  })
                  .join(" ");
              }
            }
            return "";
          })
          .join(" ");

        const firstMsg = messages.length > 0 ? allText.slice(0, 200) : "";

        infos.push({
          path: fullPath,
          id: header?.id ?? basename(file, ".jsonl"),
          cwd: header?.cwd ?? cwd,
          name: undefined,
          parentSessionPath: header?.parentSession,
          created: st.birthtime,
          modified: st.mtime,
          messageCount: messages.length,
          firstMessage: firstMsg,
          allMessagesText: allText,
        });
      } catch {
        // Skip corrupt files
      }
    }

    return infos.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private _writeHeader(parentSession?: string): void {
    const header: SessionHeader = {
      type: "session",
      version: SESSION_FORMAT_VERSION,
      id: this.sessionId,
      timestamp: new Date().toISOString(),
      cwd: this.cwd,
      parentSession,
    };
    this.fileEntries.push(header);
    if (this.persist && this.sessionFile) {
      writeFileSync(this.sessionFile, JSON.stringify(header) + "\n", "utf-8");
    }
  }

  private _appendEntry(partial: SessionEntryInput): string {
    const entry = {
      ...partial,
      id: randomUUID(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
    } as SessionEntry;

    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;

    if (entry.type === "label") {
      const label = (entry as LabelEntry).label;
      const targetId = (entry as LabelEntry).targetId;
      if (label) {
        this.labelsById.set(targetId, label);
      } else {
        this.labelsById.delete(targetId);
      }
    }

    if (this.persist && this.sessionFile) {
      appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n", "utf-8");
    }

    return entry.id;
  }

  private _loadFromFile(filePath: string): void {
    this.fileEntries = [];
    this.byId.clear();
    this.labelsById.clear();
    this.leafId = null;

    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch {
      return;
    }

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as FileEntry;
        this.fileEntries.push(entry);

        if (entry.type === "session") {
          const header = entry as SessionHeader;
          this.sessionId = header.id;
          this.cwd = header.cwd;
        } else {
          const se = entry as SessionEntry;
          this.byId.set(se.id, se);
          this.leafId = se.id; // Track the last entry as leaf

          if (se.type === "label") {
            const label = (se as LabelEntry).label;
            const targetId = (se as LabelEntry).targetId;
            if (label) {
              this.labelsById.set(targetId, label);
            } else {
              this.labelsById.delete(targetId);
            }
          }
        }
      } catch {
        // Skip corrupt lines
      }
    }
  }

  private static _findMostRecent(sessionDir: string): string | null {
    try {
      const files = readdirSync(sessionDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => {
          const full = join(sessionDir, f);
          const st = statSync(full);
          return { path: full, mtime: st.mtime.getTime() };
        })
        .sort((a, b) => b.mtime - a.mtime);

      return files.length > 0 ? files[0]!.path : null;
    } catch {
      return null;
    }
  }
}
