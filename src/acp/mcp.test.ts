import { describe, expect, it } from "vitest";
import { buildAcpMcpMeta, normalizeAcpMcpServers } from "./mcp.js";

describe("acp mcp normalization", () => {
  it("normalizes stdio/http/sse servers to cli map", () => {
    const normalized = normalizeAcpMcpServers([
      {
        name: "docs",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        env: [
          { name: "DEBUG", value: "1" },
          { name: "TOKEN", value: "abc" },
        ],
      },
      {
        name: "remote-http",
        type: "http",
        url: "https://example.com/mcp",
        headers: [{ name: "authorization", value: "Bearer token" }],
      },
      {
        name: "remote-sse",
        type: "sse",
        url: "https://example.com/sse",
        headers: [],
      },
    ]);

    expect(normalized.diagnostics).toEqual({
      requested: 3,
      accepted: 3,
      ignored: [],
    });
    expect(normalized.cliMcpServers).toMatchObject({
      docs: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        env: { DEBUG: "1", TOKEN: "abc" },
      },
      "remote-http": {
        type: "http",
        url: "https://example.com/mcp",
        headers: { authorization: "Bearer token" },
      },
      "remote-sse": {
        type: "sse",
        url: "https://example.com/sse",
      },
    });
  });

  it("reports invalid and duplicate servers", () => {
    const normalized = normalizeAcpMcpServers([
      {
        name: "docs",
        command: "npx",
        args: [],
        env: [],
      },
      {
        name: "docs",
        type: "http",
        url: "https://example.com/mcp",
        headers: [],
      },
      {
        name: "   ",
        command: "node",
        args: [],
        env: [],
      },
      {
        name: "broken",
        command: "   ",
        args: [],
        env: [],
      },
    ]);

    expect(normalized.diagnostics.requested).toBe(4);
    expect(normalized.diagnostics.accepted).toBe(1);
    expect(normalized.diagnostics.ignored).toEqual([
      { name: "docs", reason: "duplicate_name" },
      { reason: "missing_name" },
      { name: "broken", reason: "invalid_stdio_command" },
    ]);
    expect(normalized.cliMcpServers).toMatchObject({
      docs: {
        command: "npx",
      },
    });
  });

  it("builds response _meta payload", () => {
    const normalized = normalizeAcpMcpServers([
      {
        name: "docs",
        command: "npx",
        args: [],
        env: [],
      },
    ]);

    expect(buildAcpMcpMeta(normalized)).toEqual({
      mcp: {
        requested: 1,
        accepted: 1,
        ignored: 0,
        ignoredDetails: [],
        serverNames: ["docs"],
      },
    });
  });
});
