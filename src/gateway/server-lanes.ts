import type { loadConfig } from "../config/config.js";
import {
  resolveAgentMaxConcurrent,
  resolveBackgroundMaxConcurrent,
  resolveSubagentMaxConcurrent,
} from "../config/agent-limits.js";
import {
  setCommandLaneConcurrency,
  setLaneYieldsTo,
  setLaneResumes,
} from "../process/command-queue.js";
import { CommandLane } from "../process/lanes.js";

export function applyGatewayLaneConcurrency(cfg: ReturnType<typeof loadConfig>) {
  setCommandLaneConcurrency(CommandLane.Cron, cfg.cron?.maxConcurrentRuns ?? 2);
  setCommandLaneConcurrency(CommandLane.Main, resolveAgentMaxConcurrent(cfg));
  setCommandLaneConcurrency(CommandLane.Subagent, resolveSubagentMaxConcurrent(cfg));
  setCommandLaneConcurrency(CommandLane.Background, resolveBackgroundMaxConcurrent(cfg));

  // Background yields to Main: background tasks pause when interactive work is pending.
  setLaneYieldsTo(CommandLane.Background, CommandLane.Main);
  // When Main completes a task, kick the Background lane to check if it can resume.
  setLaneResumes(CommandLane.Main, [CommandLane.Background]);
}
