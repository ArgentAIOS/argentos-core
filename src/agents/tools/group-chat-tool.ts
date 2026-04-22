import { Type } from "@sinclair/typebox";
import { randomUUID } from "node:crypto";
import type { AnyAgentTool } from "./common.js";
import { createDefaultDeps } from "../../cli/deps.js";
import { agentCommand } from "../../commands/agent.js";
import { loadConfig } from "../../config/config.js";
import { resolveAgentMainSessionKey } from "../../config/sessions.js";
import { getAgentFamily } from "../../data/agent-family.js";
import { defaultRuntime } from "../../runtime.js";
import { readStringArrayParam, readStringParam } from "./common.js";

const GroupChatToolSchema = Type.Object({
  message: Type.String({ minLength: 1, description: "Message to send to all selected agents." }),
  agentIds: Type.Optional(Type.Array(Type.String())),
  team: Type.Optional(Type.String({ description: "Team name such as dev-team or think-tank." })),
  thinking: Type.Optional(
    Type.Union([
      Type.Literal("off"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
    ]),
  ),
});

export function createGroupChatTool(): AnyAgentTool {
  return {
    label: "Group Chat",
    name: "group_chat",
    description: `Message multiple Argent family agents and collect all responses.

Use this for:
- group chat
- message the team
- ask the family
- send this to all panelists
- multi-agent response / multi-perspective response`,
    parameters: GroupChatToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const message = readStringParam(params, "message", { required: true });
      const explicitAgentIds = readStringArrayParam(params, "agentIds") ?? [];
      const team = readStringParam(params, "team");
      const thinking = readStringParam(params, "thinking") ?? "off";

      let targetIds = [...explicitAgentIds];
      if (team) {
        const family = await getAgentFamily();
        const members = await family.listMembers();
        const teamIds = members
          .filter((member) => member.team?.toLowerCase() === team.toLowerCase())
          .map((member) => member.id);
        targetIds = [...new Set([...targetIds, ...teamIds])];
      }

      if (targetIds.length === 0) {
        throw new Error("Provide either agentIds or team.");
      }

      const cfg = loadConfig();
      const responses: string[] = [];
      for (const agentId of targetIds) {
        const sessionKey = resolveAgentMainSessionKey({ cfg, agentId });
        try {
          const result = await agentCommand(
            {
              message,
              agentId,
              sessionKey,
              thinking,
              runId: `group-chat-${randomUUID()}`,
            },
            defaultRuntime,
            createDefaultDeps(),
          );
          const payloads = (result as { payloads?: Array<{ text?: string }> }).payloads ?? [];
          const text = payloads
            .map((payload) => payload.text)
            .filter(Boolean)
            .join("\n\n");
          responses.push(`## ${agentId}\n\n${text || "(no response)"}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          responses.push(`## ${agentId}\n\nError: ${message}`);
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Group chat with ${targetIds.length} agents:\n\n${responses.join("\n\n---\n\n")}`,
          },
        ],
        details: {
          message,
          agentIds: targetIds,
          team: team ?? null,
        },
      };
    },
  };
}
