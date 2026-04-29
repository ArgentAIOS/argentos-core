import { Type } from "@sinclair/typebox";
import {
  clearSpecforgeGuideSession,
  getSpecforgeGuideStatus,
  maybeKickoffSpecforgeFromMessage,
} from "../../infra/specforge-conductor.js";
import { jsonResult, readStringParam, type AnyAgentTool } from "./common.js";

const SpecforgeToolSchema = Type.Object({
  action: Type.Union([Type.Literal("handle"), Type.Literal("status"), Type.Literal("exit")]),
  message: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Latest user message to process in the SpecForge workflow. Required for action=handle.",
    }),
  ),
});

type SpecforgeToolOptions = {
  agentSessionKey?: string;
  agentId?: string;
};

export function createSpecforgeTool(opts?: SpecforgeToolOptions): AnyAgentTool {
  return {
    label: "SpecForge",
    name: "specforge",
    description: `Run the strict SpecForge development-project workflow.

Use this tool whenever the user starts or continues a software/project build workflow, for example "I want to build a project".

Actions:
- handle: process the latest user message and advance the workflow
- status: inspect current workflow stage without mutation
- exit: clear active workflow state for this session

After SpecForge approval, route code/project execution through family.dispatch by
default so technical/code work reaches the dev-team family specialists. Prefer
family.dispatch_contracted for auditable work that needs heartbeat/timeout
tracking and include skillsRequired so the expected coding playbooks are visible
in contract history. Use team_spawn when the approved plan needs coordinated multi-agent
dependencies, then monitor team_status and family.contract_history while
coordinating live over Redis-backed family.message/family.inbox and mirroring
durable proof to the Threadmaster bus. Use Browser Use for Chrome-backed UI
proof instead of standalone Playwright. Report starts, blocks, completions,
failures, and scope changes.`,
    parameters: SpecforgeToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const sessionKey = opts?.agentSessionKey;
      const agentId = opts?.agentId ?? "argent";

      if (!sessionKey) {
        return jsonResult({
          ok: false,
          error: "specforge requires agentSessionKey context",
        });
      }

      if (action === "status") {
        return jsonResult({
          ok: true,
          ...(await getSpecforgeGuideStatus(sessionKey)),
        });
      }

      if (action === "exit") {
        await clearSpecforgeGuideSession(sessionKey);
        return jsonResult({
          ok: true,
          active: false,
          summary: "SpecForge session state cleared for this chat.",
        });
      }

      const message = readStringParam(params, "message", { required: true });
      return jsonResult({
        ok: true,
        ...(await maybeKickoffSpecforgeFromMessage({
          message,
          sessionKey,
          agentId,
        })),
      });
    },
  };
}
