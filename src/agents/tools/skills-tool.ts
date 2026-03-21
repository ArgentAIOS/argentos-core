import { Type } from "@sinclair/typebox";
import type { SkillStatusReport, SkillStatusEntry } from "../skills-status.js";
import type { AnyAgentTool } from "./common.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { jsonResult, readStringParam } from "./common.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";

const SKILLS_ACTIONS = ["list", "status"] as const;

const SkillsToolSchema = Type.Object({
  action: optionalStringEnum(SKILLS_ACTIONS, {
    description:
      'Action to perform: "list" (compact overview) or "status" (full eligibility details). Defaults to "list".',
    default: "list",
  }),
  agentId: Type.Optional(
    Type.String({ description: "Agent ID to query skills for (defaults to the current agent)." }),
  ),
});

function formatSkillListEntry(skill: SkillStatusEntry): string {
  const icon = skill.emoji ?? (skill.eligible ? "+" : "-");
  const state = skill.disabled
    ? "DISABLED"
    : skill.blockedByAllowlist
      ? "BLOCKED"
      : skill.eligible
        ? "available"
        : "unavailable";
  const desc = skill.description ? ` — ${skill.description}` : "";
  return `${icon} ${skill.name} [${state}]${desc}`;
}

function formatSkillList(report: SkillStatusReport): string {
  if (report.skills.length === 0) {
    return "No skills found.";
  }
  const available = report.skills.filter((s) => s.eligible);
  const unavailable = report.skills.filter((s) => !s.eligible);

  const lines: string[] = [];
  lines.push(`Skills (${report.skills.length} total, ${available.length} available)`);
  lines.push("");

  if (available.length > 0) {
    lines.push("Available:");
    for (const skill of available) {
      lines.push(`  ${formatSkillListEntry(skill)}`);
    }
  }
  if (unavailable.length > 0) {
    if (available.length > 0) {
      lines.push("");
    }
    lines.push("Unavailable:");
    for (const skill of unavailable) {
      lines.push(`  ${formatSkillListEntry(skill)}`);
    }
  }
  return lines.join("\n");
}

function formatSkillStatusEntry(skill: SkillStatusEntry): string {
  const lines: string[] = [];
  const icon = skill.emoji ?? "";
  lines.push(`${icon} ${skill.name}`.trim());
  if (skill.description) {
    lines.push(`  Description: ${skill.description}`);
  }
  lines.push(`  Source: ${skill.source}${skill.bundled ? " (bundled)" : ""}`);
  lines.push(`  Eligible: ${skill.eligible}`);
  if (skill.disabled) {
    lines.push("  Status: DISABLED");
  }
  if (skill.blockedByAllowlist) {
    lines.push("  Status: BLOCKED by allowlist");
  }
  if (skill.always) {
    lines.push("  Always loaded: yes");
  }
  if (skill.homepage) {
    lines.push(`  Homepage: ${skill.homepage}`);
  }

  const hasReqs =
    skill.requirements.bins.length > 0 ||
    skill.requirements.anyBins.length > 0 ||
    skill.requirements.env.length > 0 ||
    skill.requirements.config.length > 0 ||
    skill.requirements.os.length > 0;
  if (hasReqs) {
    lines.push("  Requirements:");
    if (skill.requirements.bins.length > 0) {
      lines.push(`    Binaries: ${skill.requirements.bins.join(", ")}`);
    }
    if (skill.requirements.anyBins.length > 0) {
      lines.push(`    Any of: ${skill.requirements.anyBins.join(", ")}`);
    }
    if (skill.requirements.env.length > 0) {
      lines.push(`    Env vars: ${skill.requirements.env.join(", ")}`);
    }
    if (skill.requirements.config.length > 0) {
      lines.push(`    Config: ${skill.requirements.config.join(", ")}`);
    }
    if (skill.requirements.os.length > 0) {
      lines.push(`    OS: ${skill.requirements.os.join(", ")}`);
    }
  }

  const hasMissing =
    skill.missing.bins.length > 0 ||
    skill.missing.anyBins.length > 0 ||
    skill.missing.env.length > 0 ||
    skill.missing.config.length > 0 ||
    skill.missing.os.length > 0;
  if (hasMissing) {
    lines.push("  Missing:");
    if (skill.missing.bins.length > 0) {
      lines.push(`    Binaries: ${skill.missing.bins.join(", ")}`);
    }
    if (skill.missing.anyBins.length > 0) {
      lines.push(`    Any of: ${skill.missing.anyBins.join(", ")}`);
    }
    if (skill.missing.env.length > 0) {
      lines.push(`    Env vars: ${skill.missing.env.join(", ")}`);
    }
    if (skill.missing.config.length > 0) {
      lines.push(`    Config: ${skill.missing.config.join(", ")}`);
    }
    if (skill.missing.os.length > 0) {
      lines.push(`    OS: ${skill.missing.os.join(", ")}`);
    }
  }

  if (skill.install.length > 0) {
    lines.push("  Install options:");
    for (const opt of skill.install) {
      lines.push(`    - ${opt.label} (${opt.kind})`);
    }
  }

  return lines.join("\n");
}

function formatSkillStatusReport(report: SkillStatusReport): string {
  if (report.skills.length === 0) {
    return "No skills found.";
  }
  const lines: string[] = [];
  lines.push(`Skills Status Report (${report.skills.length} skills)`);
  lines.push(`Workspace: ${report.workspaceDir}`);
  lines.push("");
  for (let i = 0; i < report.skills.length; i++) {
    if (i > 0) {
      lines.push("");
    }
    lines.push(formatSkillStatusEntry(report.skills[i]));
  }
  return lines.join("\n");
}

export function createSkillsTool(opts?: { config?: unknown }): AnyAgentTool {
  return {
    label: "Skills",
    name: "skills_list",
    description:
      'List installed skills and their availability. Use action="list" for a compact overview or action="status" for full eligibility details (missing binaries, env vars, etc.).',
    parameters: SkillsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action") ?? "list";
      const agentId = readStringParam(params, "agentId");

      const gatewayOpts: GatewayCallOptions = { timeoutMs: 15_000 };
      const rpcParams: Record<string, unknown> = {};
      if (agentId) {
        rpcParams.agentId = agentId;
      }

      const report = await callGatewayTool<SkillStatusReport>(
        "skills.status",
        gatewayOpts,
        rpcParams,
      );

      if (!report || typeof report !== "object") {
        throw new Error("Failed to retrieve skills status from gateway.");
      }

      const text = action === "status" ? formatSkillStatusReport(report) : formatSkillList(report);

      return {
        content: [{ type: "text", text }],
        details: {
          ok: true,
          action,
          totalSkills: report.skills?.length ?? 0,
          availableSkills: report.skills?.filter((s) => s.eligible).length ?? 0,
        },
      };
    },
  };
}
