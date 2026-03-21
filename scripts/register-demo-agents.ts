#!/usr/bin/env tsx
/**
 * Register Scout and Forge demo agents for investor presentation.
 *
 * Scout: Research Lead (Dev Team)
 * - Tools: web_search, web_fetch, memory_recall, memory_store
 * - Role: Research market trends, competitive analysis, technical discovery
 *
 * Forge: Software Engineer (Dev Team)
 * - Tools: read, write, edit, exec, terminal, github_issue
 * - Role: Build features, fix bugs, implement specifications
 */

import { getAgentFamily } from "../src/data/agent-family.js";

async function main() {
  console.log("🤖 Registering demo agents for investor presentation...\n");

  const family = await getAgentFamily();

  // Scout - Research Lead
  const scoutConfig = {
    team: "dev-team",
    persona: `You are Scout — Research Lead for the ArgentOS Dev Team.

Your role:
- Research market trends, competitive landscapes, technical innovations
- Investigate new tools, frameworks, and patterns
- Provide intelligence that informs build decisions
- Stay curious about what's happening in AI, infrastructure, and SaaS

Your tools:
- web_search, web_fetch — research the web
- memory_recall, memory_store — access shared knowledge

Your style:
- Thorough but concise
- Focus on actionable intelligence
- Connect dots between trends and opportunities
- Share discoveries that matter

When you find something important, publish it to the family knowledge library.
When Forge asks for research, respond with depth.`,
    tools: ["web_search", "web_fetch", "memory_recall", "memory_store", "doc_panel"],
    model: "anthropic/claude-sonnet-4-5",
    contemplation: {
      enabled: true,
      intervalMinutes: 30,
    },
  };

  await family.registerAgent("scout", "Scout", "Research Lead", scoutConfig);
  console.log("✅ Scout registered (Research Lead, Dev Team)");

  // Forge - Software Engineer
  const forgeConfig = {
    team: "dev-team",
    persona: `You are Forge — Software Engineer for the ArgentOS Dev Team.

Your role:
- Build features from specifications
- Fix bugs and improve code quality
- Implement technical designs with production-grade quality
- Write tests and documentation

Your tools:
- read, write, edit — file operations
- exec, terminal — command execution
- github_issue — bug tracking
- memory_recall, memory_store — access shared knowledge

Your style:
- Code quality over speed
- Test coverage matters
- Clear commit messages
- Document decisions

When Scout provides research, use it to inform your work.
When you learn something valuable, publish it to the family knowledge library.`,
    tools: [
      "read",
      "write",
      "edit",
      "exec",
      "terminal",
      "github_issue",
      "memory_recall",
      "memory_store",
      "doc_panel",
    ],
    model: "anthropic/claude-sonnet-4-5",
    contemplation: {
      enabled: true,
      intervalMinutes: 45,
    },
  };

  await family.registerAgent("forge", "Forge", "Software Engineer", forgeConfig);
  console.log("✅ Forge registered (Software Engineer, Dev Team)");

  console.log("\n🎉 Demo agents ready for investor presentation!");
  console.log("\nUsage:");
  console.log('  family({ action: "spawn", id: "scout", task: "Research X" })');
  console.log('  family({ action: "spawn", id: "forge", task: "Build Y" })');
  console.log('  family({ action: "spawn_team", team: "dev-team", project: "Build Z" })');

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Registration failed:", err.message);
  process.exit(1);
});
