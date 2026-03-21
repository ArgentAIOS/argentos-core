import type { GatewayRequestHandlers } from "./types.js";
import { getFamilyTelemetrySnapshot } from "../../agents/tools/family-tool.js";

export const familyTelemetryHandlers: GatewayRequestHandlers = {
  "family.telemetry": async ({ respond }) => {
    respond(
      true,
      {
        ok: true,
        telemetry: getFamilyTelemetrySnapshot(),
      },
      undefined,
    );
  },
};
