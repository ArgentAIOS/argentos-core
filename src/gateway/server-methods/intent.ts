import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const intentHandlers: GatewayRequestHandlers = {
  "intent.simulate": async ({ respond, context, params }) => {
    const agentId = String((params as { agentId?: string } | undefined)?.agentId || "main");
    const message =
      "Intent simulation is unavailable in ArgentOS Core. Simulation runners and built-in scenario packs remain Business-only.";

    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
    context.broadcast("intent.simulation", {
      agentId,
      status: "error",
      error: message,
      timestamp: new Date().toISOString(),
    });
  },
};
