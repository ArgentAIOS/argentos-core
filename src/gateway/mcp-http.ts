/**
 * MCP Server Exposure — HTTP transport layer.
 *
 * External MCP clients (Claude Code, Cursor, Claude Desktop via mcp-remote)
 * connect to /mcp on the gateway. Tool definitions live in mcp-tools.ts.
 *
 * Uses Streamable HTTP transport (MCP SDK v1.28+) with per-session state.
 * Auth: same gateway Bearer token.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/config.js";
import { logInfo } from "../logger.js";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import { sendJson, sendMethodNotAllowed, sendUnauthorized } from "./http-common.js";
import { getBearerToken } from "./http-utils.js";
import { registerMcpTools } from "./mcp-tools.js";

// ============================================================================
// Session tracking
// ============================================================================

const transports: Map<string, StreamableHTTPServerTransport> = new Map();

// ============================================================================
// MCP Server factory — creates a new server instance per session
// ============================================================================

function createMcpServerInstance(allowedTools?: string[]): McpServer {
  const mcp = new McpServer(
    {
      name: "argentos",
      version: loadConfig().version ?? "2026.3.0",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  registerMcpTools(mcp, allowedTools, transports);
  return mcp;
}

// ============================================================================
// HTTP handler — chain-of-responsibility pattern matching gateway convention
// ============================================================================

export type McpHttpOptions = {
  auth: ResolvedGatewayAuth;
  trustedProxies?: string[];
  enabled?: boolean;
};

/**
 * Handle MCP HTTP requests on /mcp.
 *
 * Supports:
 * - POST /mcp — JSON-RPC messages (initialize, tools/list, tools/call)
 * - GET /mcp — SSE stream for server-to-client notifications
 * - DELETE /mcp — Close session
 *
 * Returns true if the request was handled, false to pass to next handler.
 */
export async function handleMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: McpHttpOptions,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/mcp") return false;
  if (!opts.enabled) return false;

  // CORS headers for browser-based MCP clients
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  // Authenticate
  const token = getBearerToken(req);
  const authResult = await authorizeGatewayConnect({
    auth: opts.auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies: opts.trustedProxies,
  });
  if (!authResult.ok) {
    sendUnauthorized(res);
    return true;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // ---- POST: JSON-RPC messages ----
  if (req.method === "POST") {
    const body = await readBody(req);
    if (!body) {
      sendJson(res, 400, { error: "Invalid request body" });
      return true;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
      return true;
    }

    // Existing session
    if (sessionId) {
      const transport = transports.get(sessionId);
      if (transport) {
        await transport.handleRequest(req, res, parsed);
        return true;
      }
    }

    // New session (initialize request)
    if (isInitializeRequest(parsed)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
          logInfo(`[mcp-server] Session created: ${id}`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
          logInfo(`[mcp-server] Session closed: ${transport.sessionId}`);
        }
      };

      const configSnapshot = loadConfig();
      const allowedTools = configSnapshot.gateway?.mcp?.allowedTools;
      const server = createMcpServerInstance(allowedTools);
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
      return true;
    }

    // Invalid: not an initialize request and no valid session
    sendJson(res, 400, {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid session. Send an initialize request first." },
      id: null,
    });
    return true;
  }

  // ---- GET: SSE stream ----
  if (req.method === "GET") {
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing Mcp-Session-Id header" });
      return true;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      sendJson(res, 404, { error: "Session not found" });
      return true;
    }
    await transport.handleRequest(req, res);
    return true;
  }

  // ---- DELETE: close session ----
  if (req.method === "DELETE") {
    if (sessionId) {
      const transport = transports.get(sessionId);
      if (transport) {
        await transport.close();
        transports.delete(sessionId);
        logInfo(`[mcp-server] Session deleted: ${sessionId}`);
      }
    }
    res.statusCode = 204;
    res.end();
    return true;
  }

  sendMethodNotAllowed(res, "GET, POST, DELETE, OPTIONS");
  return true;
}

// ============================================================================
// Helpers
// ============================================================================

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const maxBytes = 2 * 1024 * 1024; // 2MB

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    req.on("error", () => {
      resolve(null);
    });
  });
}
