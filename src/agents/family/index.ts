/**
 * Agent Family — Multi-Agent Coordination
 *
 * Manages the specialized agent workforce:
 * - Dev Team: Scout, Forge, Lens, Scribe, Anvil, Weave, Vault
 * - Marketing Team: Quill, Canvas, Echo, Beacon, Prism
 * - Support Teams: Sage, Guide, Relay
 * - Office Teams: Dash, Draft, Tally
 * - Think Tank: Elon, Sam, Dario, Jensen
 *
 * Built for ArgentOS Digital Workforce - February 16, 2026
 */

import type { Agent } from "../../argent-agent/agent.js";
import { createDario, DARIO_METADATA } from "./dario.js";
import { createElon, ELON_METADATA } from "./elon.js";
import { createForge, FORGE_METADATA } from "./forge.js";
import { createJensen, JENSEN_METADATA } from "./jensen.js";
import { createSam, SAM_METADATA } from "./sam.js";
import { createScout, SCOUT_METADATA } from "./scout.js";

// ============================================================================
// Types
// ============================================================================

export interface AgentInstance {
  id: string;
  name: string;
  role: string;
  specialty: string;
  team: string;
  agent: Agent;
  metadata: {
    worksWith: string[];
    tools: string[];
  };
}

export interface FamilyConfig {
  apiKey?: string;
  enabledAgents?: string[]; // Default: ['scout', 'forge']
}

// ============================================================================
// Family Manager
// ============================================================================

export class AgentFamilyManager {
  private agents: Map<string, AgentInstance> = new Map();
  private config: FamilyConfig;

  constructor(config: FamilyConfig = {}) {
    this.config = config;
  }

  /**
   * Initialize the family (spawn enabled agents)
   */
  async initialize(): Promise<void> {
    const enabled = this.config.enabledAgents || ["scout", "forge"];

    for (const agentId of enabled) {
      await this.spawnAgent(agentId);
    }
  }

  /**
   * Spawn a specific agent
   */
  async spawnAgent(agentId: string): Promise<AgentInstance> {
    if (this.agents.has(agentId)) {
      return this.agents.get(agentId)!;
    }

    let agent: Agent;
    let metadata: any;

    switch (agentId) {
      case "scout":
        agent = await createScout({ apiKey: this.config.apiKey });
        metadata = SCOUT_METADATA;
        break;

      case "forge":
        agent = await createForge({ apiKey: this.config.apiKey });
        metadata = FORGE_METADATA;
        break;

      // Think Tank panelists
      case "elon":
        agent = await createElon({ apiKey: this.config.apiKey });
        metadata = ELON_METADATA;
        break;

      case "sam":
        agent = await createSam({ apiKey: this.config.apiKey });
        metadata = SAM_METADATA;
        break;

      case "dario":
        agent = await createDario({ apiKey: this.config.apiKey });
        metadata = DARIO_METADATA;
        break;

      case "jensen":
        agent = await createJensen({ apiKey: this.config.apiKey });
        metadata = JENSEN_METADATA;
        break;

      default:
        throw new Error(`Unknown agent: ${agentId}`);
    }

    const instance: AgentInstance = {
      id: metadata.id,
      name: metadata.name,
      role: metadata.role,
      specialty: metadata.specialty,
      team: metadata.team,
      agent,
      metadata: {
        worksWith: metadata.worksWith,
        tools: metadata.tools,
      },
    };

    this.agents.set(agentId, instance);
    return instance;
  }

  /**
   * Get an agent by ID
   */
  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /**
   * List all active agents
   */
  listAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * Send a task to an agent
   */
  async sendTask(agentId: string, task: string, context?: string): Promise<string> {
    const instance = this.agents.get(agentId);
    if (!instance) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const history = context
      ? [
          { role: "user" as const, content: context },
          { role: "assistant" as const, content: "Understood. I have the context." },
        ]
      : [];

    const result = await instance.agent.execute({
      content: task,
      history,
    });

    return result.text;
  }

  /**
   * Coordinate a multi-agent workflow
   *
   * Example: Research task → Scout → hands off to Forge
   */
  async coordinateWorkflow(workflow: { type: "research_to_code"; request: string }): Promise<{
    scoutFindings: string;
    forgeOutput: string;
  }> {
    if (workflow.type === "research_to_code") {
      // Step 1: Scout researches
      const scoutFindings = await this.sendTask("scout", workflow.request);

      // Step 2: Forge implements based on Scout's research
      const forgeOutput = await this.sendTask(
        "forge",
        "Implement based on the research findings.",
        scoutFindings,
      );

      return { scoutFindings, forgeOutput };
    }

    throw new Error(`Unknown workflow type: ${workflow.type}`);
  }
}

// ============================================================================
// Factory
// ============================================================================

export async function createAgentFamily(config: FamilyConfig = {}): Promise<AgentFamilyManager> {
  const family = new AgentFamilyManager(config);
  await family.initialize();
  return family;
}

// ============================================================================
// Exports
// ============================================================================

export { createScout, SCOUT_METADATA } from "./scout.js";
export { createForge, FORGE_METADATA } from "./forge.js";
export { createElon, ELON_METADATA, ELON_PERSONA } from "./elon.js";
export { createSam, SAM_METADATA, SAM_PERSONA } from "./sam.js";
export { createDario, DARIO_METADATA, DARIO_PERSONA } from "./dario.js";
export { createJensen, JENSEN_METADATA, JENSEN_PERSONA } from "./jensen.js";
