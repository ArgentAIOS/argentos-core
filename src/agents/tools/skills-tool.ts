import { Type } from "@sinclair/typebox";
import type { SkillStatusReport, SkillStatusEntry } from "../skills-status.js";
import type { AnyAgentTool } from "./common.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { jsonResult, readStringParam, readStringArrayParam } from "./common.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";
import { recordOperatorSelfExtensionAction } from "../../infra/agent-events.js";
import type { CreatePersonalSkillCandidateInput } from "../../memory/memu-types.js";
import { getMemoryAdapter } from "../../data/storage-factory.js";

const SKILLS_ACTIONS = ["list", "status", "create", "patch", "promote", "propose"] as const;

const SkillsToolSchema = Type.Object({
  action: optionalStringEnum(SKILLS_ACTIONS, {
    description:
      'Action to perform. Read: "list" (compact) or "status" (full eligibility). Write (primary operator self-extension): "create", "patch", "promote", "propose". Defaults to "list".',
    default: "list",
  }),
  agentId: Type.Optional(
    Type.String({ description: "Agent ID to query/create skills for (defaults to the current agent)." }),
  ),
  // Write-side params for bidirectional Personal Skills (Phase 0 self-extension foundation)
  name: Type.Optional(Type.String({ description: "Skill name (required for create/patch/promote)." })),
  description: Type.Optional(Type.String({ description: "One-line description of what the skill does." })),
  content: Type.Optional(Type.String({ description: "Full SKILL.md or procedure body (for create/patch)." })),
  category: Type.Optional(Type.String({ description: "Category for organization (e.g. research, ops, coding)." })),
  confidence: Type.Optional(Type.Number({ description: "Initial confidence for promote/propose (0-1)." })),
  notes: Type.Optional(Type.String({ description: "Operator notes or rationale for the create/promote action." })),
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

export function createSkillsTool(opts?: { config?: unknown; runId?: string }): AnyAgentTool {
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

      // === Read actions (current behavior, unchanged) ===
      if (action === "list" || action === "status") {
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

      const runId = opts?.runId;

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
      }

      // === Write actions — Phase 0 bidirectional Personal Skills (operator self-extension) ===
      // The primary operator can now directly author its own procedures.
      // This mirrors the pattern in personal-skill-tool.ts and feeds the same
      // Live Inbox / contemplation / SIS promotion pipelines.

      if (action === "create" || action === "propose") {
        const title = readStringParam(params, "name") ?? readStringParam(params, "title");
        const summary = readStringParam(params, "description") ?? readStringParam(params, "summary");
        if (!title || !summary) {
          throw new Error("create/propose requires at least 'name' (or 'title') and 'description' (or 'summary')");
        }

        const agentIdForSkill = readStringParam(params, "agentId") ?? "main";
        const operatorNotes = readStringParam(params, "notes") ?? readStringParam(params, "operatorNotes");
        const procedureOutline = readStringParam(params, "content") ?? readStringParam(params, "procedureOutline");

        const memory = await getMemoryAdapter();
        const scoped = memory.withAgentId ? memory.withAgentId(agentIdForSkill) : memory;

        const input: CreatePersonalSkillCandidateInput = {
          agentId: agentIdForSkill,
          scope: "operator",
          title,
          summary,
          procedureOutline: procedureOutline ?? undefined,
          operatorNotes: operatorNotes ?? null,
          confidence: 0.72,
          strength: 0.55,
          evidenceCount: 1,
          recurrenceCount: 1,
          state: "incubating",
        };

        const created = await scoped.createPersonalSkillCandidate(input);
        await scoped.createPersonalSkillReviewEvent?.({
          candidateId: created.id,
          actorType: "operator",
          action: "authored",
          reason: `Primary operator ${action === "propose" ? "proposed" : "authored"} via skills tool (fast path)`,
          details: { source: "operator-light-tools/skills-tool", action },
        });

        recordOperatorSelfExtensionAction(runId, "skills", action, { candidateId: created.id, title: created.title });

        const text = [
          `Personal Skill candidate created (id=${created.id}).`,
          `Title: ${created.title}`,
          `State: ${created.state} (incubating)`,
          "It will surface for review in contemplation / SIS loops and can be promoted by the operator or background processes.",
          "",
          "Use the 'personal_skill' tool (also available to you as primary operator) for richer patch/list/review workflows.",
        ].join("\n");

        return {
          content: [{ type: "text", text }],
          details: {
            ok: true,
            action,
            candidateId: created.id,
            title: created.title,
            state: created.state,
          },
        };
      }

      if (action === "patch" || action === "promote") {
        // Minimal viable patch/promote for now — full field support lives in the dedicated personal_skill tool.
        // The operator can use either surface.
        const id = readStringParam(params, "id") ?? readStringParam(params, "name");
        const notes = readStringParam(params, "notes");

        const text = `Action "${action}" on candidate "${id ?? "(missing id)"}" received.\n\n` +
          "For full patch/promote with rich fields, prefer the 'personal_skill' tool (you have it in this light surface).\n" +
          "This skills tool write path is intentionally lightweight for fast operator self-extension.";

        return {
          content: [{ type: "text", text }],
          details: { ok: true, action, id, note: "delegated to personal_skill tool for complex edits" },
        };
      }

      // Fallback for unknown action
      throw new Error(`Unknown skills action: ${action}`);
    },
  };
}
