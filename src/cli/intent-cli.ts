import type { Command } from "commander";

const SIMULATION_MESSAGE =
  "Intent simulation is unavailable in ArgentOS Core. Simulation runners and scenario packs stay on the Business side of the boundary.";

export function registerIntentCli(program: Command): void {
  const intent = program.command("intent").description("Intent system tools");

  intent
    .command("simulate")
    .description("Run intent simulation scenarios and generate a report")
    .option("-c, --config <path>", "Path to scenarios JSON file")
    .option("-a, --agent <id>", "Agent ID to resolve intent for", "main")
    .option("--builtin-t1", "Use built-in MSP T1 support scenarios")
    .option("--agent-model <model>", "Model for agent simulation", "claude-haiku-4-5")
    .option("--judge-model <model>", "Model for judge evaluation", "claude-haiku-4-5")
    .option("--concurrency <n>", "Max concurrent scenarios", "3")
    .option("--timeout <ms>", "Timeout per scenario in ms", "30000")
    .option("-o, --output <path>", "Report output path")
    .option("--tags <tags...>", "Filter scenarios by tags")
    .action(() => {
      console.error(SIMULATION_MESSAGE);
      process.exit(1);
    });

  intent
    .command("validate")
    .description("Validate intent hierarchy configuration")
    .action(async () => {
      const { loadConfig } = await import("../config/config.js");
      const { validateIntentHierarchy } = await import("../agents/intent.js");

      const config = await loadConfig();
      const issues = validateIntentHierarchy(config);

      if (issues.length === 0) {
        console.log("Intent hierarchy is valid. No issues found.");
      } else {
        console.log(`Intent hierarchy has ${issues.length} issue(s):\n`);
        for (const issue of issues) {
          console.log(`  ${issue.path}: ${issue.message}`);
        }
        process.exit(1);
      }
    });
}
