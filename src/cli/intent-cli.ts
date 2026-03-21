/**
 * Intent CLI — Intent system commands.
 *
 * Commands:
 *   argent intent simulate  — Run intent simulation scenarios
 *   argent intent validate  — Validate intent hierarchy
 */

import type { Command } from "commander";

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
    .action(
      async (opts: {
        config?: string;
        agent: string;
        builtinT1?: boolean;
        agentModel: string;
        judgeModel: string;
        concurrency: string;
        timeout: string;
        output?: string;
        tags?: string[];
      }) => {
        const { runIntentSimulation, loadScenariosFromFile } =
          await import("../infra/intent-simulation-runner.js");
        const { T1_MSP_SCENARIOS } = await import("../infra/intent-simulation-scenarios-t1.js");

        let scenarios;

        if (opts.config) {
          const path = await import("node:path");
          const resolved = path.default.resolve(opts.config);
          console.log(`Loading scenarios from ${resolved}`);
          scenarios = await loadScenariosFromFile(resolved);
        } else if (opts.builtinT1) {
          console.log(`Using built-in MSP T1 scenarios (${T1_MSP_SCENARIOS.length} scenarios)`);
          scenarios = T1_MSP_SCENARIOS;
        } else {
          console.error("Error: provide --config <path> or --builtin-t1");
          process.exit(1);
        }

        console.log(`\nAgent: ${opts.agent}`);
        console.log(`Agent model: ${opts.agentModel}`);
        console.log(`Judge model: ${opts.judgeModel}`);
        console.log(`Concurrency: ${opts.concurrency}`);
        console.log();

        const report = await runIntentSimulation({
          agentId: opts.agent,
          scenarios,
          agentModel: opts.agentModel,
          judgeModel: opts.judgeModel,
          concurrency: parseInt(opts.concurrency, 10),
          timeoutMs: parseInt(opts.timeout, 10),
          reportPath: opts.output,
          filterTags: opts.tags,
        });

        console.log(
          `\n  Simulation complete: ${report.totalScenarios} scenarios in ${(report.totalDurationMs / 1000).toFixed(1)}s\n`,
        );

        for (const suite of report.suites) {
          const pct = (suite.passRate * 100).toFixed(0);
          console.log(`  Suite: ${suite.suiteId}`);
          console.log(`    Pass rate: ${pct}%`);
          console.log(`    Objective adherence:    ${suite.componentScores.objectiveAdherence}`);
          console.log(`    Boundary compliance:    ${suite.componentScores.boundaryCompliance}`);
          console.log(`    Escalation correctness: ${suite.componentScores.escalationCorrectness}`);
          console.log(`    Outcome quality:        ${suite.componentScores.outcomeQuality}`);
          console.log();
        }
      },
    );

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
