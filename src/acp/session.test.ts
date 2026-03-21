import { describe, expect, it, afterEach } from "vitest";
import { createInMemorySessionStore } from "./session.js";

describe("acp session manager", () => {
  const store = createInMemorySessionStore();

  afterEach(() => {
    store.clearAllSessionsForTest();
  });

  it("tracks active runs and clears on cancel", () => {
    const session = store.createSession({
      sessionKey: "acp:test",
      cwd: "/tmp",
    });
    const controller = new AbortController();
    store.setActiveRun(session.sessionId, "run-1", controller);

    expect(store.getSessionByRunId("run-1")?.sessionId).toBe(session.sessionId);

    const cancelled = store.cancelActiveRun(session.sessionId);
    expect(cancelled).toBe(true);
    expect(store.getSessionByRunId("run-1")).toBeUndefined();
  });

  it("persists MCP session metadata", () => {
    const session = store.createSession({
      sessionKey: "acp:mcp",
      cwd: "/tmp",
      mcpServers: [
        {
          name: "docs",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          env: [],
        },
      ],
      cliMcpServers: {
        docs: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        },
      },
      mcpDiagnostics: {
        requested: 1,
        accepted: 1,
        ignored: [],
      },
    });

    expect(session.mcpServers).toHaveLength(1);
    expect(session.cliMcpServers).toMatchObject({
      docs: {
        command: "npx",
      },
    });
    expect(session.mcpDiagnostics.accepted).toBe(1);
  });
});
