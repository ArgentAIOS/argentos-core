import type { GatewayRequestHandlers } from "./types.js";
import {
  listAgentIds,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { createArgentCodingTools } from "../../agents/pi-tools.js";
import {
  isToolMatchedByPolicyList,
  resolveEffectiveToolPolicy,
} from "../../agents/pi-tools.policy.js";
import { APPROVAL_BACKED_TOOLS } from "../../agents/tool-approval.js";
import { loadConfig } from "../../config/config.js";
import { getConnectorToolMeta } from "../../connectors/tools.js";
import { getPluginToolMeta } from "../../plugins/tools.js";
import { buildAgentMainSessionKey, normalizeAgentId } from "../../routing/session-key.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateToolsStatusParams,
} from "../protocol/index.js";

export type ToolStatusEntry = {
  name: string;
  label?: string;
  description?: string;
  source: "core" | "plugin" | "connector";
  pluginId?: string;
  optional?: boolean;
  connectorTool?: string;
  connectorCommandId?: string;
  governance?: {
    mode: "allow" | "ask";
    approvalBacked: boolean;
    source?: "global" | "department" | "agent";
    note?: string;
  };
};

export function buildToolsStatusPayload(params: Record<string, unknown> = {}) {
  if (!validateToolsStatusParams(params)) {
    throw new Error(
      `invalid tools.status params: ${formatValidationErrors(validateToolsStatusParams.errors)}`,
    );
  }

  const cfg = loadConfig();
  const requestedAgentIdRaw = typeof params?.agentId === "string" ? params.agentId.trim() : "";
  const knownAgentIds = new Set(listAgentIds(cfg));
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const resolvedAgentId = normalizeAgentId(requestedAgentIdRaw || defaultAgentId);
  const agentId =
    requestedAgentIdRaw || knownAgentIds.has(resolvedAgentId) ? resolvedAgentId : defaultAgentId;
  const sessionKey = buildAgentMainSessionKey({ agentId });
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const agentDir = resolveAgentDir(cfg, agentId);

  const tools = createArgentCodingTools({
    config: cfg,
    sessionKey,
    workspaceDir,
    agentDir,
  });
  const effectivePolicy = resolveEffectiveToolPolicy({
    config: cfg,
    sessionKey,
  });

  const deduped = new Map<string, ToolStatusEntry>();
  for (const tool of tools) {
    if (!tool?.name || deduped.has(tool.name)) {
      continue;
    }
    const pluginMeta = getPluginToolMeta(tool);
    const connectorMeta = getConnectorToolMeta(tool);
    const source: "core" | "plugin" | "connector" = connectorMeta
      ? "connector"
      : pluginMeta
        ? "plugin"
        : "core";
    const label = typeof tool.label === "string" ? tool.label : undefined;
    const description = typeof tool.description === "string" ? tool.description : undefined;
    const approvalBacked = APPROVAL_BACKED_TOOLS.has(tool.name);
    const askMatchedAtAgent = isToolMatchedByPolicyList(tool.name, effectivePolicy.agentAsk);
    const askMatchedAtDepartment = isToolMatchedByPolicyList(
      tool.name,
      effectivePolicy.departmentAsk,
    );
    const askMatchedAtGlobal = isToolMatchedByPolicyList(tool.name, effectivePolicy.globalAsk);
    const askMatched = askMatchedAtAgent || askMatchedAtDepartment || askMatchedAtGlobal;
    const askSource = askMatchedAtAgent
      ? "agent"
      : askMatchedAtDepartment
        ? "department"
        : askMatchedAtGlobal
          ? "global"
          : undefined;
    deduped.set(tool.name, {
      name: tool.name,
      label,
      description,
      source,
      pluginId: pluginMeta?.pluginId,
      optional: pluginMeta?.optional,
      connectorTool: connectorMeta?.connectorTool,
      connectorCommandId: connectorMeta?.connectorCommandId,
      governance: {
        mode: askMatched ? "ask" : "allow",
        approvalBacked,
        source: askSource,
        note:
          askMatched && !approvalBacked
            ? "Approval intent recorded; runtime approval wiring pending for this tool."
            : undefined,
      },
    });
  }

  const entries = Array.from(deduped.values()).toSorted((a, b) => {
    if (a.source !== b.source) {
      return a.source.localeCompare(b.source);
    }
    return a.name.localeCompare(b.name);
  });

  return {
    agentId,
    sessionKey,
    total: entries.length,
    policy: {
      globalAsk: effectivePolicy.globalAsk ?? [],
      departmentId: effectivePolicy.departmentId,
      departmentAsk: effectivePolicy.departmentAsk ?? [],
      agentAsk: effectivePolicy.agentAsk ?? [],
    },
    tools: entries,
  };
}

export const toolsHandlers: GatewayRequestHandlers = {
  "tools.status": ({ params, respond }) => {
    try {
      respond(true, buildToolsStatusPayload(params), undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
};
