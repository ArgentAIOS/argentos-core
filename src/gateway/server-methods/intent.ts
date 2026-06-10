import type { GatewayRequestHandlers } from "./types.js";
import { runIntentSimulation } from "../../infra/intent-simulation-runner.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

type SimulateIntentParams = {
  agentId?: string;
  agentModel?: string;
  judgeModel?: string;
};

export const intentHandlers: GatewayRequestHandlers = {
  "intent.simulate": async ({ params, respond, context }) => {
    try {
      const p = (params || {}) as SimulateIntentParams;
      const agentId = String(p.agentId || "main").trim();

      if (!agentId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId is required"));
        return;
      }

      // 1. Acknowledge the request immediately so the UI knows we started
      respond(true, { status: "starting", agentId }, undefined);

      // 2. We need scenarios. We'll use the builtin ones for zero-config out of the box.
      // In a real production environment, you might let the UI pass these, or load from a workspace file.
      const { T1_MSP_SCENARIOS } = await import("../../infra/intent-simulation-scenarios-t1.js");

      // 3. Optional: broadcast progress to UI
      const broadcastProgress = (message: string) => {
        context.broadcast("intent.simulation", {
          agentId,
          status: "running",
          message,
          timestamp: new Date().toISOString(),
        });
      };

      broadcastProgress(
        `Starting simulation for ${agentId} with ${T1_MSP_SCENARIOS.length} scenarios...`,
      );

      // 4. Run the simulation
      const report = await runIntentSimulation({
        agentId,
        scenarios: T1_MSP_SCENARIOS,
        agentModel: p.agentModel,
        judgeModel: p.judgeModel,
        // The runner automatically writes to the agent's reportPath
      });

      // 5. Broadcast completion
      context.broadcast("intent.simulation", {
        agentId,
        status: "complete",
        report,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      context.logGateway.error(`Intent simulation failed: ${err}`);
      context.broadcast("intent.simulation", {
        agentId: String((params as SimulateIntentParams)?.agentId || "main"),
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    }
  },
};
