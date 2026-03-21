import type { McpServer, SessionId } from "@agentclientprotocol/sdk";
import type { AcpMcpDiagnostics, CliMcpServers } from "./mcp.js";
import { VERSION } from "../version.js";

export type AcpSession = {
  sessionId: SessionId;
  sessionKey: string;
  cwd: string;
  createdAt: number;
  mcpServers: McpServer[];
  cliMcpServers?: CliMcpServers;
  mcpDiagnostics: AcpMcpDiagnostics;
  abortController: AbortController | null;
  activeRunId: string | null;
};

export type AcpServerOptions = {
  gatewayUrl?: string;
  gatewayToken?: string;
  gatewayPassword?: string;
  defaultSessionKey?: string;
  defaultSessionLabel?: string;
  requireExistingSession?: boolean;
  resetSession?: boolean;
  prefixCwd?: boolean;
  verbose?: boolean;
};

export const ACP_AGENT_INFO = {
  name: "argent-acp",
  title: "Argent ACP Gateway",
  version: VERSION,
};
