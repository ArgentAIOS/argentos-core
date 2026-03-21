/**
 * aevp.presence — Gateway method for agent-initiated visual presence changes.
 *
 * Receives gesture/formation/symbol or identity updates from the visual_presence tool
 * and broadcasts them to all connected dashboards.
 */

import type { GatewayRequestHandlers } from "./types.js";

export const aevpHandlers: GatewayRequestHandlers = {
  "aevp.presence": ({ params, respond, context }) => {
    if (!params || typeof params !== "object") {
      respond(true, { ok: true, note: "no-op: empty params" });
      return;
    }

    const payload = params as Record<string, unknown>;
    const type = payload.type;

    if (
      type === "gesture" ||
      type === "set_identity" ||
      type === "formation_write" ||
      type === "symbol_express"
    ) {
      context.broadcast("aevp_presence", payload, { dropIfSlow: true });
      respond(true, { ok: true, type });
      return;
    }

    respond(true, { ok: true, note: `unknown type: ${type}` });
  },
};
