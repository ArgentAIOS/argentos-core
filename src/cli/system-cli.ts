import type { Command } from "commander";
import type { GatewayRpcOpts } from "./gateway-rpc.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { danger } from "../globals.js";
import { recomputeScoreStateFromJournal, saveScoreState } from "../infra/heartbeat-score.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { addGatewayClientOptions, callGatewayFromCli } from "./gateway-rpc.js";

type SystemEventOpts = GatewayRpcOpts & { text?: string; mode?: string; json?: boolean };

const normalizeWakeMode = (raw: unknown) => {
  const mode = typeof raw === "string" ? raw.trim() : "";
  if (!mode) {
    return "next-heartbeat" as const;
  }
  if (mode === "now" || mode === "next-heartbeat") {
    return mode;
  }
  throw new Error("--mode must be now or next-heartbeat");
};

export function registerSystemCli(program: Command) {
  const system = program
    .command("system")
    .description("System tools (events, heartbeat, presence)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/system", "docs.argent.ai/cli/system")}\n`,
    );

  addGatewayClientOptions(
    system
      .command("event")
      .description("Enqueue a system event and optionally trigger a heartbeat")
      .requiredOption("--text <text>", "System event text")
      .option("--mode <mode>", "Wake mode (now|next-heartbeat)", "next-heartbeat")
      .option("--json", "Output JSON", false),
  ).action(async (opts: SystemEventOpts) => {
    try {
      const text = typeof opts.text === "string" ? opts.text.trim() : "";
      if (!text) {
        throw new Error("--text is required");
      }
      const mode = normalizeWakeMode(opts.mode);
      const result = await callGatewayFromCli("wake", opts, { mode, text }, { expectFinal: false });
      if (opts.json) {
        defaultRuntime.log(JSON.stringify(result, null, 2));
      } else {
        defaultRuntime.log("ok");
      }
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  const heartbeat = system.command("heartbeat").description("Heartbeat controls");

  addGatewayClientOptions(
    heartbeat
      .command("last")
      .description("Show the last heartbeat event")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli("last-heartbeat", opts, undefined, {
        expectFinal: false,
      });
      defaultRuntime.log(JSON.stringify(result, null, 2));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  addGatewayClientOptions(
    heartbeat
      .command("enable")
      .description("Enable heartbeats")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli(
        "set-heartbeats",
        opts,
        { enabled: true },
        { expectFinal: false },
      );
      defaultRuntime.log(JSON.stringify(result, null, 2));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  addGatewayClientOptions(
    heartbeat
      .command("disable")
      .description("Disable heartbeats")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli(
        "set-heartbeats",
        opts,
        { enabled: false },
        { expectFinal: false },
      );
      defaultRuntime.log(JSON.stringify(result, null, 2));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  heartbeat
    .command("recompute-score")
    .description("Recompute heartbeat accountability score from journal history")
    .option("--agent <id>", "Agent id (defaults to configured default agent)")
    .option("--dry-run", "Compute without writing heartbeat-score.json", false)
    .option("--json", "Output JSON", false)
    .action(async (opts: { agent?: string; dryRun?: boolean; json?: boolean }) => {
      try {
        const cfg = loadConfig();
        const agentId =
          (typeof opts.agent === "string" && opts.agent.trim()) || resolveDefaultAgentId(cfg);
        const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
        const result = await recomputeScoreStateFromJournal(workspaceDir);

        if (!opts.dryRun) {
          await saveScoreState(workspaceDir, result.state);
        }

        if (opts.json) {
          defaultRuntime.log(
            JSON.stringify(
              {
                agentId,
                workspaceDir,
                dryRun: Boolean(opts.dryRun),
                summary: result.summary,
                today: result.state.today,
                lifetime: result.state.lifetime,
              },
              null,
              2,
            ),
          );
          return;
        }

        defaultRuntime.log(
          [
            `heartbeat score recompute (${opts.dryRun ? "dry-run" : "written"})`,
            `agent: ${agentId}`,
            `workspace: ${workspaceDir}`,
            `files: ${result.summary.filesProcessed}`,
            `entries: ${result.summary.entriesProcessed}`,
            `window: ${result.summary.firstDate ?? "n/a"} → ${result.summary.lastDate ?? "n/a"}`,
            `today: ${result.state.today.score} (${result.state.today.verifiedCount} verified, ${result.state.today.failedCount} failed)`,
            `lifetime: verified=${result.state.lifetime.totalVerified}, failed=${result.state.lifetime.totalFailed}, days=${result.state.lifetime.daysTracked}`,
          ].join("\n"),
        );
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  addGatewayClientOptions(
    system
      .command("presence")
      .description("List system presence entries")
      .option("--json", "Output JSON", false),
  ).action(async (opts: GatewayRpcOpts & { json?: boolean }) => {
    try {
      const result = await callGatewayFromCli("system-presence", opts, undefined, {
        expectFinal: false,
      });
      defaultRuntime.log(JSON.stringify(result, null, 2));
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });
}
