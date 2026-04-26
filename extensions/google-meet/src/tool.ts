import { Type } from "@sinclair/typebox";
import type { ArgentPluginApi } from "../../../src/plugins/types.js";
import { resolveGoogleMeetSetupStatus, type GoogleMeetConfig } from "./setup.js";

const GoogleMeetToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("setup"),
    Type.Literal("status"),
    Type.Literal("create"),
    Type.Literal("join"),
    Type.Literal("leave"),
    Type.Literal("recover_current_tab"),
  ]),
  meetingUrl: Type.Optional(
    Type.String({ description: "Google Meet URL for join/recover actions." }),
  ),
  summary: Type.Optional(Type.String({ description: "Optional meeting summary for create." })),
});

function asGoogleMeetConfig(value: unknown): GoogleMeetConfig {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as GoogleMeetConfig)
    : {};
}

function json(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function liveActionDeferred(action: string, config: GoogleMeetConfig) {
  const setup = resolveGoogleMeetSetupStatus(config);
  return json({
    ok: false,
    action,
    status: "not_implemented",
    reason:
      "Google Meet live actions are gated until browser harness and realtime voice integration land.",
    setup,
  });
}

export function createGoogleMeetTool(api: ArgentPluginApi) {
  return {
    name: "google_meet",
    label: "Google Meet",
    description:
      "Inspect Google Meet setup/status. Live join/create actions are planned behind browser and realtime voice integration.",
    parameters: GoogleMeetToolSchema,
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const config = asGoogleMeetConfig(api.pluginConfig);
      const action = typeof params.action === "string" ? params.action : "";

      switch (action) {
        case "setup":
        case "status":
          return json({ ok: true, action, setup: resolveGoogleMeetSetupStatus(config) });
        case "create":
        case "join":
        case "leave":
        case "recover_current_tab":
          return liveActionDeferred(action, config);
        default:
          throw new Error("unsupported google_meet action");
      }
    },
  };
}
