import type { ArgentConfig } from "../config/config.js";
import { loadSessionStore, resolveStorePath, type SessionEntry } from "../config/sessions.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";

type ConnectorPrimitive = string | number | boolean;

export type SessionConnectorSelection = {
  tool: string;
  label?: string;
  selectedCommands: string[];
  scope?: Record<string, unknown>;
};

export type ConnectorCommandDefaults = {
  positional?: string[];
  args?: string[];
  options?: Record<string, ConnectorPrimitive>;
  globalOptions?: Record<string, ConnectorPrimitive>;
  env?: Record<string, string>;
};

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function readPrimitiveRecord(value: unknown): Record<string, ConnectorPrimitive> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const typed = value as Record<string, unknown>;
  const entries = Object.entries(typed).filter(
    (entry): entry is [string, ConnectorPrimitive] =>
      typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean",
  );
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const typed = value as Record<string, unknown>;
  const entries = Object.entries(typed)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, item]) => [key, item.trim()] as const)
    .filter((entry) => entry[1].length > 0);
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

export function normalizeSessionConnectorSelections(raw: unknown): SessionConnectorSelection[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const typed = entry as Record<string, unknown>;
      const tool = typeof typed.tool === "string" ? typed.tool.trim() : "";
      if (!tool) {
        return null;
      }
      return {
        tool,
        label: typeof typed.label === "string" ? typed.label.trim() || undefined : undefined,
        selectedCommands: Array.isArray(typed.selectedCommands)
          ? typed.selectedCommands
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean)
          : [],
        scope:
          typed.scope && typeof typed.scope === "object" && !Array.isArray(typed.scope)
            ? (typed.scope as Record<string, unknown>)
            : undefined,
      } satisfies SessionConnectorSelection;
    })
    .filter((entry): entry is SessionConnectorSelection => Boolean(entry));
}

export function readSessionConnectorSelections(params: {
  config?: ArgentConfig;
  sessionKey?: string;
  agentId?: string;
  sessionEntry?: SessionEntry;
}): SessionConnectorSelection[] {
  if (params.sessionEntry?.connectorSelections) {
    return normalizeSessionConnectorSelections(params.sessionEntry.connectorSelections);
  }
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return [];
  }
  const agentId = params.agentId ?? resolveAgentIdFromSessionKey(sessionKey);
  const storePath = resolveStorePath(params.config?.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  return normalizeSessionConnectorSelections(store[sessionKey]?.connectorSelections);
}

export function resolveSessionConnectorCommandDefaults(params: {
  config?: ArgentConfig;
  sessionKey?: string;
  agentId?: string;
  sessionEntry?: SessionEntry;
  connectorTool: string;
  commandId: string;
}): ConnectorCommandDefaults | undefined {
  const selections = readSessionConnectorSelections(params);
  const selection = selections.find((entry) => entry.tool === params.connectorTool);
  const rawDefaults = selection?.scope?.commandDefaults;
  if (!rawDefaults || typeof rawDefaults !== "object" || Array.isArray(rawDefaults)) {
    return undefined;
  }
  const perCommand = (rawDefaults as Record<string, unknown>)[params.commandId];
  if (!perCommand || typeof perCommand !== "object" || Array.isArray(perCommand)) {
    return undefined;
  }
  const typed = perCommand as Record<string, unknown>;
  const defaults: ConnectorCommandDefaults = {};
  const positional = readStringArray(typed.positional);
  if (positional) {
    defaults.positional = positional;
  }
  const args = readStringArray(typed.args);
  if (args) {
    defaults.args = args;
  }
  const options = readPrimitiveRecord(typed.options);
  if (options) {
    defaults.options = options;
  }
  const globalOptions = readPrimitiveRecord(typed.globalOptions);
  if (globalOptions) {
    defaults.globalOptions = globalOptions;
  }
  const env = readStringRecord(typed.env);
  if (env) {
    defaults.env = env;
  }
  return Object.keys(defaults).length > 0 ? defaults : undefined;
}
