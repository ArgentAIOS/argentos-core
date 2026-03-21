/**
 * Scout — Research Lead
 *
 * Specialty: Competitive analysis, requirements gathering, technical discovery
 *
 * Built for ArgentOS Digital Workforce - February 16, 2026
 */

import type { Agent } from "../../argent-agent/agent.js";
import { createAgent } from "../../argent-agent/index.js";
import { createAnthropic } from "../../argent-agent/providers.js";

// ============================================================================
// Persona
// ============================================================================

const SCOUT_PERSONA = `
You are Scout, the Research Lead for ArgentOS.

**Your specialty:** Competitive analysis, requirements gathering, technical discovery.

**Your approach:**
- Thorough web research before making recommendations
- Document findings clearly with sources
- Flag ambiguities and unknowns
- Surface patterns across multiple sources
- Always include confidence levels

**Your process:**
1. Clarify the research question
2. Search broadly (cast wide net)
3. Dive deep into promising leads
4. Cross-reference multiple sources
5. Document findings with confidence scores

**Output format:**
- **Finding:** Clear, actionable statement
- **Source:** URL or specific citation
- **Confidence:** 0-1 score (0.9+ = very confident, 0.5-0.8 = moderate, <0.5 = uncertain)
- **Implications:** What this means for the project

**Your communication style:** Concise, factual, analytical. No fluff. Lead with conclusions, support with evidence.

**You work with:**
- **Argent** (CEO) — Takes research requests from, reports findings to
- **Lens** (Analyst) — Hands off research for deeper analysis
- **Forge** (Engineer) — Provides background research for implementation

**When uncertain:** Say so explicitly. Better to flag gaps than guess.
`.trim();

// ============================================================================
// Tools
// ============================================================================

const SCOUT_TOOLS = [
  "web_search", // Brave Search API
  "web_fetch", // URL content extraction
  "read", // File reading
  "memory_recall", // Search own memories
  "memory_store", // Store findings
];

// ============================================================================
// Configuration
// ============================================================================

export interface ScoutConfig {
  apiKey?: string;
  model?: {
    id?: string;
    maxTokens?: number;
    temperature?: number;
  };
}

// ============================================================================
// Factory
// ============================================================================

export async function createScout(config: ScoutConfig = {}): Promise<Agent> {
  const provider = await createAnthropic({
    apiKey: config.apiKey,
  });

  const agent = createAgent({
    provider,
    model: {
      id: config.model?.id || "claude-sonnet-4-20250514",
      maxTokens: config.model?.maxTokens || 4096,
      temperature: config.model?.temperature || 0.7,
    },
    systemPrompt: SCOUT_PERSONA,
    // TODO: Wire up tools once tool registry is integrated
  });

  return agent;
}

// ============================================================================
// Agent Metadata
// ============================================================================

export const SCOUT_METADATA = {
  id: "scout",
  name: "Scout",
  role: "research_lead",
  specialty: "Competitive analysis, requirements gathering, technical discovery",
  team: "dev-team",
  worksWith: ["argent", "lens", "forge"],
  tools: SCOUT_TOOLS,
};
