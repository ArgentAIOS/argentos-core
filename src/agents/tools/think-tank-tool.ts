import { Type } from "@sinclair/typebox";
import { randomUUID } from "node:crypto";
import type { AnyAgentTool } from "./common.js";
import { createDefaultDeps } from "../../cli/deps.js";
import { agentCommand } from "../../commands/agent.js";
import { loadConfig } from "../../config/config.js";
import { resolveAgentMainSessionKey } from "../../config/sessions.js";
import { defaultRuntime } from "../../runtime.js";
import { readStringArrayParam, readStringParam } from "./common.js";

const THINK_TANK_PANEL = ["dario", "sam", "elon", "jensen"] as const;

const PANELIST_META: Record<
  string,
  {
    name: string;
    emoji: string;
  }
> = {
  dario: { name: "Dario", emoji: "🧠" },
  sam: { name: "Sam", emoji: "⚡" },
  elon: { name: "Elon", emoji: "🚀" },
  jensen: { name: "Jensen", emoji: "🟢" },
};

const ThinkTankToolSchema = Type.Object({
  topic: Type.String({ minLength: 1, description: "Debate topic or question for the panel." }),
  panelists: Type.Optional(
    Type.Array(
      Type.String({
        description: "Specific panelist IDs. Default: dario, sam, elon, jensen.",
      }),
    ),
  ),
  thinking: Type.Optional(
    Type.Union([
      Type.Literal("off"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
    ]),
  ),
});

async function postThinkTankEvent(event: Record<string, unknown>): Promise<void> {
  try {
    await fetch("http://127.0.0.1:9242/api/think-tank/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {
    // Best-effort only: debate rendering should not block the underlying tool.
  }
}

export function createThinkTankTool(): AnyAgentTool {
  return {
    label: "Think Tank",
    name: "think_tank",
    description: `Convene the Think Tank roundtable with the four family panelists.

Use this when the operator asks for:
- think tank
- roundtable / panel / debate
- multi-perspective family analysis
- "ask Dario, Sam, Elon, and Jensen"

This is Argent's first-class internal debate tool. It is not an external send target.
If the dashboard is open, debate events are also broadcast to the Think Tank doc/canvas panel.`,
    parameters: ThinkTankToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const topic = readStringParam(params, "topic", { required: true });
      const panelists = readStringArrayParam(params, "panelists") ?? [...THINK_TANK_PANEL];
      const thinking = readStringParam(params, "thinking") ?? "low";
      const cfg = loadConfig();
      const debateId = `think-tank-${randomUUID()}`;

      await postThinkTankEvent({
        type: "debate_start",
        data: {
          debateId,
          challenge: topic,
          rounds: 1,
          panelists: panelists.map((agentId) => ({
            id: agentId,
            name: PANELIST_META[agentId]?.name ?? agentId,
            emoji: PANELIST_META[agentId]?.emoji ?? "🧠",
            model: "family-panelist",
          })),
        },
      });
      await postThinkTankEvent({
        type: "round_start",
        data: { debateId, round: 1, totalRounds: 1 },
      });

      const responses: string[] = [];
      for (const agentId of panelists) {
        const sessionKey = resolveAgentMainSessionKey({ cfg, agentId });
        await postThinkTankEvent({
          type: "panelist_thinking",
          data: {
            debateId,
            name: PANELIST_META[agentId]?.name ?? agentId,
            emoji: PANELIST_META[agentId]?.emoji ?? "🧠",
            round: 1,
          },
        });
        try {
          const result = await agentCommand(
            {
              message:
                `[THINK_TANK DEBATE]\n\nTopic: ${topic}\n\n` +
                "Provide your perspective based on your expertise and worldview. " +
                "Be direct, opinionated, and specific.",
              agentId,
              sessionKey,
              thinking,
              runId: `think-tank-${randomUUID()}`,
            },
            defaultRuntime,
            createDefaultDeps(),
          );
          const payloads = (result as { payloads?: Array<{ text?: string }> }).payloads ?? [];
          const text = payloads
            .map((payload) => payload.text)
            .filter(Boolean)
            .join("\n\n");
          const content = text || "(no response)";
          await postThinkTankEvent({
            type: "panelist_done",
            data: {
              debateId,
              name: PANELIST_META[agentId]?.name ?? agentId,
              emoji: PANELIST_META[agentId]?.emoji ?? "🧠",
              round: 1,
              content,
              model: "family-panelist",
            },
          });
          responses.push(`## ${PANELIST_META[agentId]?.name ?? agentId}\n\n${content}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await postThinkTankEvent({
            type: "panelist_done",
            data: {
              debateId,
              name: PANELIST_META[agentId]?.name ?? agentId,
              emoji: PANELIST_META[agentId]?.emoji ?? "🧠",
              round: 1,
              content: `Error: ${message}`,
              model: "family-panelist",
            },
          });
          responses.push(`## ${PANELIST_META[agentId]?.name ?? agentId}\n\nError: ${message}`);
        }
      }

      await postThinkTankEvent({
        type: "debate_complete",
        data: {
          debateId,
          reached: false,
          summary: `Think Tank completed for "${topic}"`,
        },
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Think Tank — ${panelists.length} panelists on "${topic}":\n\n${responses.join("\n\n---\n\n")}`,
          },
        ],
        details: {
          topic,
          panelists,
          debateId,
        },
      };
    },
  };
}
