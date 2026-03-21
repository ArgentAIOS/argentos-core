import type { McpServer } from "@agentclientprotocol/sdk";

export type CliMcpServers = Record<string, Record<string, unknown>>;

export type AcpMcpIgnoredServer = {
  name?: string;
  reason: "missing_name" | "duplicate_name" | "invalid_stdio_command" | "unsupported_transport";
  detail?: string;
};

export type AcpMcpDiagnostics = {
  requested: number;
  accepted: number;
  ignored: AcpMcpIgnoredServer[];
};

export type NormalizeAcpMcpServersResult = {
  cliMcpServers?: CliMcpServers;
  diagnostics: AcpMcpDiagnostics;
};

const trimNonEmpty = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toNameValueMap = (
  entries: Array<{ name?: unknown; value?: unknown }> | undefined,
): Record<string, string> | undefined => {
  if (!entries || entries.length === 0) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const name = trimNonEmpty(entry?.name);
    if (!name) {
      continue;
    }
    out[name] = typeof entry?.value === "string" ? entry.value : String(entry?.value ?? "");
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

export function normalizeAcpMcpServers(mcpServers: McpServer[]): NormalizeAcpMcpServersResult {
  const diagnostics: AcpMcpDiagnostics = {
    requested: mcpServers.length,
    accepted: 0,
    ignored: [],
  };

  const normalized: CliMcpServers = {};
  for (const server of mcpServers) {
    const name = trimNonEmpty((server as { name?: unknown }).name);
    if (!name) {
      diagnostics.ignored.push({
        reason: "missing_name",
      });
      continue;
    }
    if (normalized[name]) {
      diagnostics.ignored.push({
        name,
        reason: "duplicate_name",
      });
      continue;
    }

    if ("command" in server) {
      const command = trimNonEmpty(server.command);
      if (!command) {
        diagnostics.ignored.push({
          name,
          reason: "invalid_stdio_command",
        });
        continue;
      }
      const args = Array.isArray(server.args)
        ? server.args.filter((arg) => typeof arg === "string")
        : [];
      const env = toNameValueMap(server.env);
      normalized[name] = {
        command,
        args,
        ...(env ? { env } : {}),
      };
      continue;
    }

    if ("url" in server) {
      const headers = toNameValueMap(server.headers);
      normalized[name] = {
        type: server.type,
        url: server.url,
        ...(headers ? { headers } : {}),
      };
      continue;
    }

    diagnostics.ignored.push({
      name,
      reason: "unsupported_transport",
      detail: "unknown MCP transport payload",
    });
  }

  diagnostics.accepted = Object.keys(normalized).length;
  return {
    cliMcpServers: diagnostics.accepted > 0 ? normalized : undefined,
    diagnostics,
  };
}

export function buildAcpMcpMeta(result: NormalizeAcpMcpServersResult): Record<string, unknown> {
  return {
    mcp: {
      requested: result.diagnostics.requested,
      accepted: result.diagnostics.accepted,
      ignored: result.diagnostics.ignored.length,
      ignoredDetails: result.diagnostics.ignored,
      serverNames: Object.keys(result.cliMcpServers ?? {}),
    },
  };
}
