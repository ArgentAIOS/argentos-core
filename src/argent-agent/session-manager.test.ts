import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AgentMessage } from "./pi-types.js";
import {
  ArgentSessionManager,
  buildSessionContext,
  SESSION_FORMAT_VERSION,
  type SessionMessageEntry,
  type SessionContext,
} from "./session-manager.js";

function makeUserMsg(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }] } as unknown as AgentMessage;
}

function makeAssistantMsg(text: string): AgentMessage {
  return { role: "assistant", content: [{ type: "text", text }] } as unknown as AgentMessage;
}

describe("ArgentSessionManager", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "argent-session-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("create + append + persist", () => {
    it("creates a session file with header", () => {
      const sm = ArgentSessionManager.create("/test/cwd", tempDir);
      expect(sm.isPersisted()).toBe(true);
      expect(sm.getSessionFile()).toBeDefined();
      expect(sm.getSessionId()).toBeTruthy();

      const header = sm.getHeader();
      expect(header).not.toBeNull();
      expect(header!.type).toBe("session");
      expect(header!.version).toBe(SESSION_FORMAT_VERSION);
      expect(header!.cwd).toBe("/test/cwd");
    });

    it("appends messages and persists to JSONL", () => {
      const sm = ArgentSessionManager.create("/test/cwd", tempDir);

      const id1 = sm.appendMessage(makeUserMsg("hello"));
      const id2 = sm.appendMessage(makeAssistantMsg("hi there"));

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(sm.getLeafId()).toBe(id2);

      // Verify file contents
      const raw = readFileSync(sm.getSessionFile()!, "utf-8");
      const lines = raw.trim().split("\n");
      expect(lines.length).toBe(3); // header + 2 messages

      const parsed = lines.map((l) => JSON.parse(l));
      expect(parsed[0].type).toBe("session");
      expect(parsed[1].type).toBe("message");
      expect(parsed[2].type).toBe("message");
    });

    it("maintains tree structure with parentId", () => {
      const sm = ArgentSessionManager.create("/test/cwd", tempDir);

      const id1 = sm.appendMessage(makeUserMsg("first"));
      const id2 = sm.appendMessage(makeAssistantMsg("second"));

      const entry1 = sm.getEntry(id1)!;
      const entry2 = sm.getEntry(id2)!;

      expect(entry1.parentId).toBeNull(); // First entry has no parent
      expect(entry2.parentId).toBe(id1); // Second's parent is first
    });
  });

  describe("open + reload", () => {
    it("opens an existing session and restores state", () => {
      const sm1 = ArgentSessionManager.create("/test/cwd", tempDir);
      sm1.appendMessage(makeUserMsg("hello"));
      sm1.appendMessage(makeAssistantMsg("world"));
      const sessionFile = sm1.getSessionFile()!;
      const sessionId = sm1.getSessionId();

      // Open the same file
      const sm2 = ArgentSessionManager.open(sessionFile);
      expect(sm2.getSessionId()).toBe(sessionId);
      expect(sm2.getEntries().length).toBe(2);
      expect(sm2.getLeafId()).toBeTruthy();
    });
  });

  describe("continueRecent", () => {
    it("continues the most recent session", () => {
      const sm1 = ArgentSessionManager.create("/test/cwd", tempDir);
      sm1.appendMessage(makeUserMsg("session 1"));
      const id1 = sm1.getSessionId();

      const sm2 = ArgentSessionManager.continueRecent("/test/cwd", tempDir);
      expect(sm2.getSessionId()).toBe(id1);
      expect(sm2.getEntries().length).toBe(1);
    });

    it("creates new if no sessions exist", () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "argent-empty-"));
      const sm = ArgentSessionManager.continueRecent("/test/cwd", emptyDir);
      expect(sm.getEntries().length).toBe(0);
      rmSync(emptyDir, { recursive: true, force: true });
    });
  });

  describe("inMemory", () => {
    it("works without file persistence", () => {
      const sm = ArgentSessionManager.inMemory("/test");
      expect(sm.isPersisted()).toBe(false);

      sm.appendMessage(makeUserMsg("hello"));
      sm.appendMessage(makeAssistantMsg("world"));
      expect(sm.getEntries().length).toBe(2);
    });
  });

  describe("buildSessionContext", () => {
    it("returns messages from leaf to root", () => {
      const sm = ArgentSessionManager.inMemory();
      sm.appendMessage(makeUserMsg("first"));
      sm.appendMessage(makeAssistantMsg("second"));
      sm.appendMessage(makeUserMsg("third"));

      const ctx = sm.buildSessionContext();
      expect(ctx.messages.length).toBe(3);
      expect((ctx.messages[0] as { content: Array<{ text: string }> }).content[0].text).toBe(
        "first",
      );
      expect((ctx.messages[2] as { content: Array<{ text: string }> }).content[0].text).toBe(
        "third",
      );
    });

    it("tracks thinking level changes", () => {
      const sm = ArgentSessionManager.inMemory();
      sm.appendMessage(makeUserMsg("hello"));
      sm.appendThinkingLevelChange("high");

      const ctx = sm.buildSessionContext();
      expect(ctx.thinkingLevel).toBe("high");
    });

    it("tracks model changes", () => {
      const sm = ArgentSessionManager.inMemory();
      sm.appendModelChange("anthropic", "claude-3-5-sonnet");

      const ctx = sm.buildSessionContext();
      expect(ctx.model).toEqual({ provider: "anthropic", modelId: "claude-3-5-sonnet" });
    });

    it("handles compaction by clearing old messages", () => {
      const sm = ArgentSessionManager.inMemory();
      sm.appendMessage(makeUserMsg("old message 1"));
      sm.appendMessage(makeAssistantMsg("old reply"));
      const id3 = sm.appendMessage(makeUserMsg("recent"));

      sm.appendCompaction("Summary of old conversation", id3, 5000);
      sm.appendMessage(makeAssistantMsg("new reply"));

      const ctx = sm.buildSessionContext();
      // Compaction clears messages before it, then adds summary + new reply
      expect(ctx.messages.length).toBe(2); // summary + new reply
      const firstText = (ctx.messages[0] as { content: Array<{ text: string }> }).content[0].text;
      expect(firstText).toContain("Summary of old conversation");
    });
  });

  describe("branching", () => {
    it("branches from an earlier entry", () => {
      const sm = ArgentSessionManager.inMemory();
      const id1 = sm.appendMessage(makeUserMsg("shared"));
      sm.appendMessage(makeAssistantMsg("branch A reply"));

      // Branch from id1
      sm.branch(id1);
      sm.appendMessage(makeAssistantMsg("branch B reply"));

      const ctx = sm.buildSessionContext();
      expect(ctx.messages.length).toBe(2); // shared + branch B reply
      const lastText = (ctx.messages[1] as { content: Array<{ text: string }> }).content[0].text;
      expect(lastText).toBe("branch B reply");
    });

    it("branchWithSummary appends a summary entry", () => {
      const sm = ArgentSessionManager.inMemory();
      const id1 = sm.appendMessage(makeUserMsg("start"));
      sm.appendMessage(makeAssistantMsg("path A"));

      sm.branchWithSummary(id1, "Summarized path A content");
      sm.appendMessage(makeAssistantMsg("path B"));

      const ctx = sm.buildSessionContext();
      // Should have: start, branch summary, path B
      expect(ctx.messages.length).toBe(3);
    });
  });

  describe("getTree", () => {
    it("returns tree structure with children", () => {
      const sm = ArgentSessionManager.inMemory();
      const id1 = sm.appendMessage(makeUserMsg("root"));
      sm.appendMessage(makeAssistantMsg("child 1"));

      sm.branch(id1);
      sm.appendMessage(makeAssistantMsg("child 2"));

      const tree = sm.getTree();
      expect(tree.length).toBe(1); // One root node
      expect(tree[0].children.length).toBe(2); // Two children
    });
  });

  describe("labels", () => {
    it("sets and gets labels for entries", () => {
      const sm = ArgentSessionManager.inMemory();
      const id1 = sm.appendMessage(makeUserMsg("labeled message"));
      sm.appendLabelChange(id1, "important");

      expect(sm.getLabel(id1)).toBe("important");
    });

    it("removes labels when set to undefined", () => {
      const sm = ArgentSessionManager.inMemory();
      const id1 = sm.appendMessage(makeUserMsg("temp label"));
      sm.appendLabelChange(id1, "temp");
      sm.appendLabelChange(id1, undefined);

      expect(sm.getLabel(id1)).toBeUndefined();
    });
  });

  describe("newSession", () => {
    it("starts a fresh session within the same manager", () => {
      const sm = ArgentSessionManager.create("/test", tempDir);
      sm.appendMessage(makeUserMsg("old"));
      const oldId = sm.getSessionId();
      const oldFile = sm.getSessionFile();

      const newFile = sm.newSession();
      expect(sm.getSessionId()).not.toBe(oldId);
      expect(newFile).not.toBe(oldFile);
      expect(sm.getEntries().length).toBe(0);
    });
  });

  describe("list", () => {
    it("lists sessions sorted by modified time", async () => {
      ArgentSessionManager.create("/test/cwd", tempDir);
      ArgentSessionManager.create("/test/cwd", tempDir);

      const sessions = await ArgentSessionManager.list("/test/cwd", tempDir);
      expect(sessions.length).toBe(2);
      // Most recent first
      expect(sessions[0].modified.getTime()).toBeGreaterThanOrEqual(sessions[1].modified.getTime());
    });
  });

  describe("standalone buildSessionContext", () => {
    it("works with raw entries array", () => {
      const sm = ArgentSessionManager.inMemory();
      sm.appendMessage(makeUserMsg("hello"));
      sm.appendMessage(makeAssistantMsg("world"));

      const entries = sm.getEntries();
      const ctx = buildSessionContext(entries);
      expect(ctx.messages.length).toBe(2);
      expect(ctx.thinkingLevel).toBe("medium"); // default
    });
  });
});
