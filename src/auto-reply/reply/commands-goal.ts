/**
 * /goal command handler.
 *
 * Subcommands:
 *   /goal <text>     — set a standing goal and immediately kick off turn 1
 *   /goal status     — show the current goal (bare `/goal` is an alias)
 *   /goal pause      — pause the auto-continuation loop (preserves goal)
 *   /goal resume     — resume (resets turn counter to zero)
 *   /goal clear      — mark the goal cleared (preserved for audit)
 *
 * Internals route through the shared GoalState helpers in
 * `src/agents/goal-runner.ts` so the CLI, every gateway (Telegram, Discord,
 * Slack, Matrix, Signal, WhatsApp, SMS, iMessage, webhook, dashboard) and
 * any future surface inherit the same behavior via the existing
 * `handleCommands` chokepoint.
 *
 * Port credits — see PR body. Codex CLI (Eric Traut, OpenAI) for the
 * original /goal user-facing contract; Hermes Agent (Nous Research) for the
 * persistence-via-session-meta + judge + FIFO-preemption shape.
 */

import type { CommandHandler, HandleCommandsParams } from "./commands-types.js";
import {
  buildClearedGoalState,
  buildPausedGoalState,
  buildResumedGoalState,
  buildSetGoalState,
  hasLiveGoal,
  persistGoalState,
} from "../../agents/goal-runner.js";
import { formatGoalStatusLine } from "../../agents/goal-state.js";
import { logVerbose } from "../../globals.js";
import { stripMentions, stripStructuralPrefixes } from "./mentions.js";

const GOAL_PREFIX = "/goal";
const STATUS_KEYWORDS = new Set(["", "status", "show"]);
const PAUSE_KEYWORDS = new Set(["pause", "stop"]);
const RESUME_KEYWORDS = new Set(["resume", "continue"]);
const CLEAR_KEYWORDS = new Set(["clear", "reset", "cancel", "delete"]);

/**
 * Parse the goal body text. Returns the subcommand and the remaining text.
 * - "/goal"            → { subcommand: "", text: "" }
 * - "/goal status"     → { subcommand: "status", text: "" }
 * - "/goal Write 4 files" → { subcommand: "set", text: "Write 4 files" }
 */
export function parseGoalBody(body: string): { subcommand: string; text: string } {
  const trimmed = (body ?? "").trim();
  if (!trimmed.toLowerCase().startsWith(GOAL_PREFIX)) {
    return { subcommand: "", text: "" };
  }
  const rest = trimmed.slice(GOAL_PREFIX.length).trim();
  if (!rest) {
    return { subcommand: "status", text: "" };
  }
  // Look at the first token to decide if it's a subcommand or the start of free text.
  const firstSpace = rest.search(/\s/);
  const firstToken = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
  const tail = firstSpace === -1 ? "" : rest.slice(firstSpace + 1).trim();
  const lower = firstToken.toLowerCase();
  if (STATUS_KEYWORDS.has(lower)) {
    return { subcommand: "status", text: tail };
  }
  if (PAUSE_KEYWORDS.has(lower)) {
    return { subcommand: "pause", text: tail };
  }
  if (RESUME_KEYWORDS.has(lower)) {
    return { subcommand: "resume", text: tail };
  }
  if (CLEAR_KEYWORDS.has(lower)) {
    return { subcommand: "clear", text: tail };
  }
  // Everything else is free-text goal content.
  return { subcommand: "set", text: rest };
}

function extractGoalBody(params: HandleCommandsParams): string {
  const raw = stripStructuralPrefixes(
    params.ctx.CommandBody ?? params.ctx.RawBody ?? params.ctx.Body ?? "",
  );
  return params.isGroup ? stripMentions(raw, params.ctx, params.cfg, params.agentId) : raw;
}

export const handleGoalCommand: CommandHandler = async (params) => {
  const normalized = params.command.commandBodyNormalized;
  const isGoalCmd = normalized === GOAL_PREFIX || normalized.startsWith(`${GOAL_PREFIX} `);
  if (!isGoalCmd) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /goal from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!params.storePath || !params.sessionKey) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Goal unavailable (no session store)." },
    };
  }

  const body = extractGoalBody(params);
  const { subcommand, text } = parseGoalBody(body);
  const current = params.sessionEntry?.goal;

  switch (subcommand) {
    case "status": {
      return { shouldContinue: false, reply: { text: formatGoalStatusLine(current) } };
    }

    case "pause": {
      if (!hasLiveGoal(current)) {
        return {
          shouldContinue: false,
          reply: { text: "No active goal to pause. Set one with /goal <text>." },
        };
      }
      if (current.status === "paused") {
        return {
          shouldContinue: false,
          reply: { text: `⏸ Goal already paused: ${current.goal}` },
        };
      }
      const next = buildPausedGoalState(current, "user-paused");
      await persistGoalState({
        storePath: params.storePath,
        sessionKey: params.sessionKey,
        state: next,
      });
      return { shouldContinue: false, reply: { text: `⏸ Goal paused: ${next.goal}` } };
    }

    case "resume": {
      if (!hasLiveGoal(current)) {
        return {
          shouldContinue: false,
          reply: { text: "No goal to resume. Set one with /goal <text>." },
        };
      }
      if (current.status === "active") {
        return {
          shouldContinue: false,
          reply: { text: `▶ Goal already active: ${current.goal}` },
        };
      }
      const next = buildResumedGoalState(current);
      await persistGoalState({
        storePath: params.storePath,
        sessionKey: params.sessionKey,
        state: next,
      });
      return {
        shouldContinue: false,
        reply: {
          text: `▶ Goal resumed (turn counter reset to 0/${next.maxTurns}): ${next.goal}`,
        },
      };
    }

    case "clear": {
      if (!current || current.status === "cleared") {
        return {
          shouldContinue: false,
          reply: { text: "No active goal to clear." },
        };
      }
      const next = buildClearedGoalState(current);
      await persistGoalState({
        storePath: params.storePath,
        sessionKey: params.sessionKey,
        state: next,
      });
      return {
        shouldContinue: false,
        reply: { text: `🧹 Goal cleared: ${next.goal}` },
      };
    }

    case "set": {
      const goalText = text.trim();
      if (!goalText) {
        return {
          shouldContinue: false,
          reply: { text: "Usage: /goal <text>   |   /goal status | pause | resume | clear" },
        };
      }
      let nextState;
      try {
        nextState = buildSetGoalState({ goal: goalText });
      } catch (err) {
        return {
          shouldContinue: false,
          reply: {
            text: `⚙️ Could not set goal: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
      await persistGoalState({
        storePath: params.storePath,
        sessionKey: params.sessionKey,
        state: nextState,
      });
      // The continuation hook in agent-runner kicks off turn 1 on the next
      // user-or-system message. We surface a confirmation here; the very next
      // turn the runner finalizes will judge progress and re-enter the loop.
      const summary =
        `⊙ Goal set (0/${nextState.maxTurns} turns): ${nextState.goal}\n` +
        `Argent will work toward this goal across turns. Use /goal pause | /goal clear to stop.`;
      return { shouldContinue: false, reply: { text: summary } };
    }

    default: {
      return {
        shouldContinue: false,
        reply: { text: "Usage: /goal <text>   |   /goal status | pause | resume | clear" },
      };
    }
  }
};
