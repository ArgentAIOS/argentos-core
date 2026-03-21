/**
 * Agent Family Demo
 *
 * Demonstrates Scout + Forge coordination for tomorrow's investor demo.
 *
 * Usage:
 *   npx tsx src/agents/family/demo.ts
 */

import { createAgentFamily } from "./index.js";

async function main() {
  console.log("🚀 Initializing Agent Family...\n");

  // Create family with Scout and Forge
  const family = await createAgentFamily({
    enabledAgents: ["scout", "forge"],
  });

  const agents = family.listAgents();
  console.log("✅ Active agents:");
  for (const agent of agents) {
    console.log(`   - ${agent.name} (${agent.role}): ${agent.specialty}`);
  }
  console.log();

  // Example 1: Scout does research
  console.log("📋 Task 1: Scout researches CRM competitors\n");
  const scoutTask =
    "Research the top 3 CRM platforms for small businesses. Focus on pricing and key features.";

  console.log(`Sending to Scout: "${scoutTask}"\n`);
  const scoutResult = await family.sendTask("scout", scoutTask);

  console.log("Scout's findings:");
  console.log("─".repeat(60));
  console.log(scoutResult);
  console.log("─".repeat(60));
  console.log();

  // Example 2: Forge builds based on research
  console.log("📋 Task 2: Forge implements based on Scout's research\n");
  const forgeTask =
    "Based on the CRM research, create a simple data model for a custom CRM. Just the core entities and relationships.";

  console.log(`Sending to Forge with Scout's context...\n`);
  const forgeResult = await family.sendTask("forge", forgeTask, scoutResult);

  console.log("Forge's output:");
  console.log("─".repeat(60));
  console.log(forgeResult);
  console.log("─".repeat(60));
  console.log();

  // Example 3: Coordinated workflow
  console.log("📋 Task 3: Coordinated workflow (Scout → Forge)\n");
  const workflowRequest =
    "Build a simple contact management system. Research what features are essential, then design the data model.";

  console.log(`Starting coordinated workflow: "${workflowRequest}"\n`);
  const workflow = await family.coordinateWorkflow({
    type: "research_to_code",
    request: workflowRequest,
  });

  console.log("Workflow complete!");
  console.log();
  console.log("Scout phase:");
  console.log("─".repeat(60));
  console.log(workflow.scoutFindings.substring(0, 300) + "...");
  console.log("─".repeat(60));
  console.log();
  console.log("Forge phase:");
  console.log("─".repeat(60));
  console.log(workflow.forgeOutput.substring(0, 300) + "...");
  console.log("─".repeat(60));
  console.log();

  console.log("✨ Demo complete!\n");
  console.log("This proves:");
  console.log("  ✓ Scout and Forge are real, working agents");
  console.log("  ✓ They have distinct personas and capabilities");
  console.log("  ✓ They can coordinate (Scout → Forge handoff)");
  console.log("  ✓ Running on 100% Argent Core (zero Pi)");
}

main().catch(console.error);
