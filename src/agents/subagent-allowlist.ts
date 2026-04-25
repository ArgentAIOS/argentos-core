import type { ArgentConfig } from "../config/config.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveProductSurfaceProfile } from "./public-core-tools.js";

type AgentEntry = NonNullable<NonNullable<ArgentConfig["agents"]>["list"]>[number];
type AgentSubagentConfig = NonNullable<AgentEntry["subagents"]>;

function listConfiguredAgents(cfg: ArgentConfig): AgentEntry[] {
  const list = cfg.agents?.list;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((entry): entry is AgentEntry => Boolean(entry && typeof entry === "object"));
}

function isBusinessWorkerLikeAgent(entry: AgentEntry): boolean {
  const haystack = `${entry.id ?? ""} ${entry.name ?? ""}`.toLowerCase();
  return /\b(?:worker|workforce|job|jobs)\b/.test(haystack) || /tier-?1/.test(haystack);
}

export function resolveSubagentAllowAgents(params: {
  config: ArgentConfig;
  requesterSubagents?: AgentSubagentConfig;
  fallbackSubagents?: AgentSubagentConfig;
  requesterAgentId: string;
}): string[] {
  const explicit = params.requesterSubagents?.allowAgents ?? params.fallbackSubagents?.allowAgents;
  if (Array.isArray(explicit)) {
    return explicit;
  }

  if (resolveProductSurfaceProfile(params.config) !== "public-core") {
    return [];
  }

  const requesterAgentId = normalizeAgentId(params.requesterAgentId);
  return listConfiguredAgents(params.config)
    .map((entry) => ({
      id: normalizeAgentId(entry.id),
      entry,
    }))
    .filter(({ id, entry }) => id && id !== requesterAgentId && !isBusinessWorkerLikeAgent(entry))
    .map(({ id }) => id);
}
