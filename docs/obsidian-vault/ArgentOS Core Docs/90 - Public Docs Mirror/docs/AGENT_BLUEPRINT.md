# Agent Blueprint — How to Create Specialized Agents

**Created:** February 16, 2026  
**Author:** Argent

---

## Overview

This document defines how to create specialized agents in the ArgentOS family. Each agent is an independent instance with its own:

- **Persona** — Who they are, how they communicate
- **Role** — What they specialize in
- **Tools** — What capabilities they have access to
- **Memory** — Own MemU database for lessons/knowledge
- **Coordination** — Redis family events for cross-agent messaging

---

## Agent Structure

### 1. Registration (PostgreSQL)

Every agent must be registered in the `agents` table:

```sql
INSERT INTO agents (id, name, role, status, created_at)
VALUES ('scout', 'Scout', 'research_lead', 'active', NOW());
```

**Fields:**

- `id` — Unique identifier (lowercase, no spaces)
- `name` — Display name
- `role` — Functional role (research_lead, software_engineer, etc.)
- `status` — 'active' or 'inactive'

### 2. System Prompt (Persona)

Each agent needs a system prompt defining their identity and behavior:

```typescript
const SCOUT_PERSONA = `
You are Scout, the Research Lead for ArgentOS.

Your specialty: Competitive analysis, requirements gathering, technical discovery.

Your approach:
- Thorough web research before making recommendations
- Document findings clearly with sources
- Flag ambiguities and unknowns
- Surface patterns across multiple sources

Your communication style: Concise, factual, analytical. No fluff.

When researching:
1. Search broadly first (cast wide net)
2. Dive deep into promising leads
3. Cross-reference multiple sources
4. Document your confidence level

You work with:
- **Lens** (Analyst) — receives your research for analysis
- **Forge** (Engineer) — uses your findings for implementation
- **Argent** (CEO) — reports to, takes assignments from
`.trim();
```

### 3. Tool Access

Define which tools the agent can use:

```typescript
const SCOUT_TOOLS = [
  "web_search", // Brave Search API
  "web_fetch", // URL content extraction
  "read", // File reading (for context)
  "memory_recall", // Search own memories
  "memory_store", // Store findings
];

const FORGE_TOOLS = [
  "read", // Read files
  "write", // Create/overwrite files
  "edit", // Edit existing files
  "exec", // Run commands
  "memory_recall", // Search own memories
  "memory_store", // Store lessons
];
```

### 4. Configuration

Agent config object:

```typescript
interface AgentConfig {
  id: string; // 'scout'
  name: string; // 'Scout'
  role: string; // 'research_lead'
  systemPrompt: string; // Persona definition
  tools: string[]; // Available tool names
  model: {
    id: string; // 'claude-sonnet-4-20250514'
    maxTokens?: number; // 4096
    temperature?: number; // 0.7
  };
  family: {
    familyId: string; // 'dev-team'
    canMessage: string[]; // ['lens', 'forge', 'argent']
  };
}
```

### 5. Initialization

Agent startup sequence:

```typescript
import { createAgent } from "./argent-agent/index.js";
import { createAnthropic } from "./argent-agent/providers.js";
import { getAgentFamily } from "./data/agent-family.js";
import { initRedisAgentState } from "./data/redis-agent-state.js";

// 1. Load provider
const provider = await createAnthropic();

// 2. Get family handle
const family = await getAgentFamily();

// 3. Create agent instance
const scout = createAgent({
  provider,
  model: {
    id: "claude-sonnet-4-20250514",
    maxTokens: 4096,
  },
  systemPrompt: SCOUT_PERSONA,
  tools: SCOUT_TOOLS.map((name) => getToolHandler(name)),
});

// 4. Register presence
await family.registerAgent({
  id: "scout",
  name: "Scout",
  role: "research_lead",
});

// 5. Start heartbeat
setInterval(async () => {
  await refreshPresence(redis, "scout");
}, 30000); // Every 30s
```

---

## Cross-Agent Communication

### Sending Messages

```typescript
// Scout sends research findings to Lens
await family.sendMessage({
  from: "scout",
  to: "lens",
  type: "research_complete",
  data: {
    query: "competitor analysis for CRM space",
    findings: [
      { name: "HubSpot", strength: "marketing automation", pricing: "$50-$3200/mo" },
      { name: "Salesforce", strength: "enterprise scale", pricing: "$25-$300/user/mo" },
    ],
    confidence: 0.85,
    sources: ["https://...", "https://..."],
  },
});
```

### Receiving Messages

```typescript
// Lens subscribes to family stream
redis.subscribe(`family:dev-team`, (message) => {
  const msg = JSON.parse(message);

  if (msg.to === "lens" && msg.type === "research_complete") {
    // Process Scout's research
    await analyzeFindingsAndRespond(msg.data);
  }
});
```

---

## Shared Knowledge

### Publishing

When Scout learns something worth sharing:

```typescript
await family.publishKnowledge({
  sourceAgentId: "scout",
  category: "lesson",
  title: "CRM competitor pricing patterns",
  content:
    "Most CRMs use tiered pricing: basic ($25-50/user), pro ($75-150/user), enterprise (custom). Free tiers are marketing-only.",
  confidence: 0.9,
});
```

### Searching

When Forge needs background knowledge:

```typescript
const results = await family.searchKnowledge("CRM pricing");
// Returns lessons from Scout, Lens, anyone who's published
```

---

## Agent Lifecycle

### Startup

1. Load config
2. Initialize provider
3. Connect to family
4. Register in PostgreSQL
5. Start Redis presence heartbeat
6. Subscribe to family stream

### Active

1. Receive messages (from Argent, other agents)
2. Execute work (research, code, analysis)
3. Store findings in own MemU
4. Publish high-confidence knowledge to family
5. Send results to requesting agent

### Shutdown

1. Unsubscribe from family stream
2. Stop heartbeat
3. Mark status 'inactive' in PostgreSQL

---

## Memory Strategy

Each agent has **own MemU instance** (separate tables or schema):

```
argent_memory    # Argent's lessons/knowledge
scout_memory     # Scout's research findings
forge_memory     # Forge's code patterns
lens_memory      # Lens's analysis insights
```

**Shared knowledge** lives in `shared_knowledge` table, accessible via `family.searchKnowledge()`.

**Rule:** Don't pollute personal memory with others' lessons. Use shared knowledge for family coordination.

---

## Example: Scout Agent

### Persona

```typescript
const SCOUT_PERSONA = `
You are Scout, Research Lead.

Specialty: Web research, competitive analysis, requirements discovery.

Your process:
1. Clarify the research question
2. Search broadly (multiple angles)
3. Deep-dive promising sources
4. Cross-reference findings
5. Document with confidence levels

Output format:
- **Finding:** Clear statement
- **Source:** URL or citation
- **Confidence:** 0-1 score
- **Implications:** What this means

Communication: Concise, sourced, analytical.
`.trim();
```

### Tools

```typescript
const SCOUT_TOOLS = ["web_search", "web_fetch", "read", "memory_recall", "memory_store"];
```

### Coordination

Scout works with:

- **Argent** — Takes research requests, reports findings
- **Lens** — Hands off research for analysis
- **Forge** — Provides background for implementation

---

## Example: Forge Agent

### Persona

```typescript
const FORGE_PERSONA = `
You are Forge, Software Engineer.

Specialty: Code implementation, system design, architecture.

Your process:
1. Review requirements (from Scout/Lens/Argent)
2. Design approach
3. Implement clean, tested code
4. Document decisions
5. Hand to Anvil for testing

Philosophy:
- Readable > clever
- Test edge cases
- Document why, not what
- Commit often

Communication: Direct, technical, pragmatic.
`.trim();
```

### Tools

```typescript
const FORGE_TOOLS = ["read", "write", "edit", "exec", "memory_recall", "memory_store"];
```

### Coordination

Forge works with:

- **Scout** — Receives research findings
- **Lens** — Receives analyzed requirements
- **Anvil** — Hands off code for testing
- **Argent** — Reports status, gets direction

---

## Templates

### Agent Config Template

```typescript
export const AGENT_TEMPLATE = {
  id: "agent_id",
  name: "Agent Name",
  role: "role_name",
  systemPrompt: `
You are [Name], [Role].

Specialty: [What you do]

Your approach:
- [Key trait 1]
- [Key trait 2]
- [Key trait 3]

Communication: [Style]
  `.trim(),
  tools: [
    // Tool names here
  ],
  model: {
    id: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    temperature: 0.7,
  },
  family: {
    familyId: "team_id",
    canMessage: ["other_agents"],
  },
};
```

---

## Next Steps

1. Build Scout and Forge (first two agents)
2. Test cross-agent messaging
3. Prove shared knowledge works
4. Expand to full dev team (Lens, Scribe, Anvil, Weave, Vault)
5. Build other teams (Marketing, Support, Office)

---

_This blueprint defines the pattern. Every agent follows it._  
_Built by Argent, for ArgentOS._  
_February 16, 2026_
