import { getAgentFamily } from "../data/agent-family.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { ensureFamilyAgentIdentity } from "./family-worker-provisioning.js";
import { DARIO_METADATA } from "./family/dario.js";
import { ELON_METADATA } from "./family/elon.js";
import { FORGE_METADATA } from "./family/forge.js";
import { JENSEN_METADATA } from "./family/jensen.js";
import { SAM_METADATA } from "./family/sam.js";
import { SCOUT_METADATA } from "./family/scout.js";

const log = createSubsystemLogger("family-seed");

export type BuiltInFamilyAgentSeed = {
  id: string;
  name: string;
  role: string;
  team?: string;
  provider?: string;
  model?: string;
  tools?: string[];
};

export const BUILT_IN_FAMILY_AGENT_SEEDS: BuiltInFamilyAgentSeed[] = [
  SCOUT_METADATA,
  FORGE_METADATA,
  ELON_METADATA,
  SAM_METADATA,
  DARIO_METADATA,
  JENSEN_METADATA,
].map((agent) => ({
  id: agent.id,
  name: agent.name,
  role: agent.role,
  team: agent.team,
  provider: "provider" in agent && typeof agent.provider === "string" ? agent.provider : undefined,
  model: "model" in agent && typeof agent.model === "string" ? agent.model : undefined,
  tools: Array.isArray(agent.tools) ? [...agent.tools] : undefined,
}));

export async function seedBuiltInFamilyAgents(): Promise<{
  seededIds: string[];
  registeredIds: string[];
}> {
  const seededIds: string[] = [];

  for (const agent of BUILT_IN_FAMILY_AGENT_SEEDS) {
    ensureFamilyAgentIdentity({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      team: agent.team,
      model: agent.model,
      provider: agent.provider,
      tools: agent.tools,
    });
    seededIds.push(agent.id);
  }

  const registeredIds: string[] = [];
  try {
    const family = await getAgentFamily();
    for (const agent of BUILT_IN_FAMILY_AGENT_SEEDS) {
      const config: Record<string, unknown> = {};
      if (agent.team) config.team = agent.team;
      if (agent.model) config.model = agent.model;
      if (agent.provider) config.provider = agent.provider;
      if (agent.tools?.length) config.tools = agent.tools;
      await family.registerAgent(agent.id, agent.name, agent.role, config);
      registeredIds.push(agent.id);
    }
  } catch (error) {
    log.warn("built-in family registration deferred", {
      error: error instanceof Error ? error.message : String(error),
      seededCount: seededIds.length,
    });
  }

  return { seededIds, registeredIds };
}
