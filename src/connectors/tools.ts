import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import {
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
} from "../agents/tools/common.js";
import {
  type ConnectorCatalogCommand,
  discoverConnectorRuntimeCatalogSync,
  runConnectorCommandJson,
} from "./catalog.js";

const CONNECTOR_MODE_RANK = new Map<string, number>([
  ["readonly", 0],
  ["write", 1],
  ["full", 2],
  ["admin", 3],
]);

const ConnectorToolSchema = Type.Object(
  {
    positional: Type.Optional(Type.Array(Type.String())),
    args: Type.Optional(Type.Array(Type.String())),
    options: Type.Optional(
      Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
    ),
    mode: Type.Optional(Type.String()),
    timeout_ms: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

type ConnectorToolMeta = {
  connectorTool: string;
  connectorLabel: string;
  connectorCommandId: string;
  requiredMode?: string;
  binaryPath?: string;
};

const connectorToolMeta = new WeakMap<AnyAgentTool, ConnectorToolMeta>();

function normalizeToolSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function connectorCommandToolName(connectorTool: string, commandId: string): string {
  return `connector_${normalizeToolSegment(connectorTool)}__${normalizeToolSegment(commandId)}`;
}

export function getConnectorToolMeta(tool: AnyAgentTool): ConnectorToolMeta | undefined {
  return connectorToolMeta.get(tool);
}

function resolveCommandMode(command: ConnectorCatalogCommand, requestedMode?: string): string {
  const requiredMode = command.requiredMode?.trim().toLowerCase() || "readonly";
  const normalizedRequested = requestedMode?.trim().toLowerCase();
  if (!normalizedRequested) {
    return requiredMode;
  }
  const requiredRank = CONNECTOR_MODE_RANK.get(requiredMode) ?? 0;
  const requestedRank = CONNECTOR_MODE_RANK.get(normalizedRequested);
  if (requestedRank === undefined) {
    throw new Error(
      `invalid connector mode "${requestedMode}". Use readonly, write, full, or admin.`,
    );
  }
  if (requestedRank < requiredRank) {
    throw new Error(
      `connector command "${command.id}" requires mode=${requiredMode}; received mode=${normalizedRequested}.`,
    );
  }
  return normalizedRequested;
}

function optionKeyToFlag(key: string): string {
  const normalized = key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
  return normalized.startsWith("--") ? normalized : `--${normalized}`;
}

function appendOptionArgs(argv: string[], options: Record<string, unknown>) {
  for (const [key, value] of Object.entries(options)) {
    const flag = optionKeyToFlag(key);
    if (typeof value === "boolean") {
      if (value) {
        argv.push(flag);
      }
      continue;
    }
    if (typeof value === "number") {
      argv.push(flag, String(value));
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      argv.push(flag, value);
    }
  }
}

export function createConnectorTools(): AnyAgentTool[] {
  const catalog = discoverConnectorRuntimeCatalogSync();
  const tools: AnyAgentTool[] = [];
  const existingNames = new Set<string>();

  for (const connector of catalog.connectors) {
    const binaryPath = connector.discovery.binaryPath?.trim();
    if (!binaryPath) {
      continue;
    }
    for (const command of connector.commands) {
      if (command.supportsJson === false) {
        continue;
      }
      const name = connectorCommandToolName(connector.tool, command.id);
      if (!name || existingNames.has(name)) {
        continue;
      }
      existingNames.add(name);
      const commandSegments = command.id
        .split(".")
        .map((segment) => segment.trim())
        .filter(Boolean);
      if (commandSegments.length === 0) {
        continue;
      }
      const tool: AnyAgentTool = {
        label: `${connector.label}: ${command.summary ?? command.id}`,
        name,
        description: [
          `Execute connector command "${command.id}" through ${connector.tool}.`,
          connector.description ? `Connector: ${connector.description}` : "",
          `Required mode: ${command.requiredMode ?? "readonly"}.`,
          "Use positional for command arguments, options for CLI flags, and args for any raw passthrough tokens.",
        ]
          .filter(Boolean)
          .join(" "),
        parameters: ConnectorToolSchema,
        execute: async (_toolCallId, rawArgs) => {
          const params = rawArgs as Record<string, unknown>;
          const positional = readStringArrayParam(params, "positional") ?? [];
          const passthrough = readStringArrayParam(params, "args") ?? [];
          const timeoutMs = Math.max(
            500,
            Math.min(60_000, readNumberParam(params, "timeout_ms") ?? 15_000),
          );
          const optionsRaw =
            params.options && typeof params.options === "object" && !Array.isArray(params.options)
              ? (params.options as Record<string, unknown>)
              : {};
          const argv = [
            "--json",
            "--mode",
            resolveCommandMode(command, readStringParam(params, "mode")),
            ...commandSegments,
            ...positional,
          ];
          appendOptionArgs(argv, optionsRaw);
          argv.push(...passthrough);

          const result = await runConnectorCommandJson({
            binaryPath,
            args: argv,
            cwd: connector.discovery.harnessDir,
            timeoutMs,
          });

          return jsonResult({
            ok: result.ok,
            connector: {
              tool: connector.tool,
              label: connector.label,
              commandId: command.id,
            },
            requested: {
              argv,
              positional,
              options: optionsRaw,
              args: passthrough,
            },
            ...(result.ok
              ? {
                  data: result.data,
                  meta: {
                    exitCode: result.exitCode,
                    stderr: result.stderr || undefined,
                  },
                }
              : {
                  error: {
                    detail: result.detail,
                    exitCode: result.exitCode,
                    stderr: result.stderr || undefined,
                    envelope: result.envelope,
                  },
                  data: result.data,
                }),
          });
        },
      };
      connectorToolMeta.set(tool, {
        connectorTool: connector.tool,
        connectorLabel: connector.label,
        connectorCommandId: command.id,
        requiredMode: command.requiredMode,
        binaryPath,
      });
      tools.push(tool);
    }
  }

  return tools;
}
