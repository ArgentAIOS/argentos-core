/**
 * Team Status Tool
 *
 * Read-only tool showing team members, statuses, task progress,
 * and dependency state.
 */

import { Type } from "@sinclair/typebox";
import type { Task, TaskStatus } from "../../data/types.js";
import type { AnyAgentTool } from "./common.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import { readStringParam } from "./common.js";

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending: "⏳",
  in_progress: "🔄",
  blocked: "🚫",
  completed: "✅",
  failed: "❌",
  cancelled: "🚮",
};

const TeamStatusSchema = Type.Object({
  teamId: Type.Optional(
    Type.String({
      description: "Team ID to inspect. Defaults to the current session's team if omitted.",
    }),
  ),
});

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function createTeamStatusTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Teams",
    name: "team_status",
    description:
      "Show the status of a team: members, their states, task progress, and dependency graph. Defaults to the current session's team.",
    parameters: TeamStatusSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      let teamId = readStringParam(params, "teamId");

      const storage = await getStorageAdapter();

      // Resolve team from session if no teamId given
      if (!teamId && opts?.agentSessionKey) {
        const teamInfo = await findTeamForSession(storage, opts.agentSessionKey);
        if (teamInfo) {
          teamId = teamInfo.team.id;
        }
      }

      if (!teamId) {
        return textResult("No team found for this session. Provide a teamId or join a team first.");
      }

      const teamWithMembers = await storage.teams.get(teamId);
      if (!teamWithMembers) {
        return textResult(`Team not found: ${teamId}`);
      }

      const { team, members } = teamWithMembers;

      // Get all tasks for this team
      const tasks = await storage.tasks.list({ teamId: team.id });

      // Build output
      const lines: string[] = [];

      // Team header
      lines.push(`# Team: ${team.name}`);
      lines.push(`ID: ${team.id.slice(0, 8)} | Status: ${team.status}`);
      lines.push("");

      // Members
      lines.push("## Members");
      for (const m of members) {
        const roleIcon = m.role === "lead" ? "👑" : "🔧";
        const labelStr = m.label ? ` (${m.label})` : "";
        lines.push(`${roleIcon} ${m.sessionKey.slice(0, 30)}…${labelStr} — ${m.status}`);
      }
      lines.push("");

      // Task summary
      const statusCounts: Record<string, number> = {};
      for (const t of tasks) {
        statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      }

      lines.push("## Tasks");
      if (tasks.length === 0) {
        lines.push("No tasks created for this team.");
      } else {
        // Summary line
        const summaryParts = Object.entries(statusCounts).map(
          ([status, count]) => `${STATUS_ICONS[status as TaskStatus] || "?"} ${status}: ${count}`,
        );
        lines.push(summaryParts.join(" | "));
        lines.push("");

        // Task list
        for (const t of tasks) {
          const icon = STATUS_ICONS[t.status];
          const assigneeStr = t.assignee ? ` → ${t.assignee.slice(0, 20)}…` : " (unassigned)";
          const depStr =
            t.dependsOn && t.dependsOn.length > 0
              ? ` [deps: ${t.dependsOn.map((d) => d.slice(0, 8)).join(", ")}]`
              : "";
          lines.push(`${icon} [${t.id.slice(0, 8)}] ${t.title}${assigneeStr}${depStr}`);
        }
      }

      return textResult(lines.join("\n"));
    },
  };
}

async function findTeamForSession(
  storage: Awaited<ReturnType<typeof getStorageAdapter>>,
  sessionKey: string,
) {
  const teams = await storage.teams.list();
  for (const team of teams) {
    const full = await storage.teams.get(team.id);
    if (full?.members.some((member) => member.sessionKey === sessionKey)) {
      return full;
    }
  }
  return null;
}
