/**
 * System prompt builder for team member sessions.
 *
 * Gives each worker context about their team, role, teammates,
 * assigned tasks, and how to communicate laterally.
 */

import type { Task, TeamMember } from "../../data/types.js";

export function buildTeamMemberSystemPrompt(params: {
  teamId: string;
  teamName: string;
  role: "lead" | "worker";
  label?: string;
  sessionKey: string;
  teammates: Array<{ label?: string; sessionKey: string; role: string }>;
  assignedTasks?: Task[];
  task?: string;
}): string {
  const taskText =
    typeof params.task === "string" && params.task.trim()
      ? params.task.replace(/\s+/g, " ").trim()
      : undefined;

  const lines = [
    "# Team Agent Context",
    "",
    `You are a **team ${params.role}** in team "${params.teamName}".`,
    "",
    "## Your Role",
    params.label ? `- Label: **${params.label}**` : undefined,
    `- Role: ${params.role}`,
    taskText ? `- Your task: ${taskText}` : undefined,
    `- Team ID: ${params.teamId}`,
    `- Your session: ${params.sessionKey}`,
    "",
    "## Teammates",
  ];

  if (params.teammates.length > 0) {
    for (const tm of params.teammates) {
      const labelStr = tm.label ? ` (${tm.label})` : "";
      lines.push(`- ${tm.sessionKey}${labelStr} — ${tm.role}`);
    }
  } else {
    lines.push("- (no other team members yet)");
  }

  lines.push(
    "",
    "## Communication",
    "- To message a teammate: use `sessions_send` with their session key",
    "- To check team status: use `team_status`",
    "- To claim unassigned work: use `tasks` with `action=claim`",
    "- To list team tasks: use `tasks` with `action=team_list`",
    "",
    "## Rules",
    "1. **Complete your assigned task** — that's your primary purpose",
    "2. **Claim available work** — after finishing, check for unassigned pending tasks",
    "3. **Coordinate with teammates** — message them if you need input or have findings",
    "4. **Stay in scope** — you cannot spawn sub-agents or create new team members",
    "5. **Report completion** — your final message is relayed to the team lead",
  );

  if (params.assignedTasks && params.assignedTasks.length > 0) {
    lines.push("", "## Assigned Tasks");
    for (const task of params.assignedTasks) {
      const depStr =
        task.dependsOn && task.dependsOn.length > 0
          ? ` (blocked by: ${task.dependsOn.map((d) => d.slice(0, 8)).join(", ")})`
          : "";
      lines.push(`- [${task.id.slice(0, 8)}] ${task.title} — ${task.status}${depStr}`);
    }
  }

  lines.push("");

  return lines.filter((line): line is string => line !== undefined).join("\n");
}
