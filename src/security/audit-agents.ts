import type { ArgentConfig } from "../config/config.js";
import type { SecurityAuditFinding } from "./audit.js";

type AgentEntry = NonNullable<NonNullable<ArgentConfig["agents"]>["list"]>[number];

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function agentId(agent: AgentEntry): string {
  return asString((agent as { id?: unknown } | undefined)?.id);
}

function agentRole(agent: AgentEntry): string {
  return asString((agent as { role?: unknown } | undefined)?.role).toLowerCase();
}

function agentTeam(agent: AgentEntry): string {
  return asString((agent as { team?: unknown } | undefined)?.team).toLowerCase();
}

function isDevTeamCodingRole(agent: AgentEntry): boolean {
  if (agentTeam(agent) !== "dev-team") return false;
  const role = agentRole(agent);
  return /engineer|developer|implementer|coder|debug|review|verifier|qa|test|architect|planner/.test(
    role,
  );
}

function formatAgentLabel(agent: AgentEntry): string {
  const id = agentId(agent);
  const name = asString((agent as { name?: unknown } | undefined)?.name);
  return name && name !== id ? `${name} (${id})` : id || "(unknown)";
}

export function collectAgentProfileFindings(cfg: ArgentConfig): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  const agents = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  if (agents.length === 0) {
    return findings;
  }

  const byAgentDir = new Map<string, AgentEntry[]>();
  const missingDevTeamSkills: string[] = [];
  const elevatedToolAgents: string[] = [];

  for (const agent of agents) {
    if (!agent || typeof agent !== "object") continue;
    const agentDir = asString((agent as { agentDir?: unknown }).agentDir);
    if (agentDir) {
      const existing = byAgentDir.get(agentDir) ?? [];
      existing.push(agent);
      byAgentDir.set(agentDir, existing);
    }

    const skills = asStringList((agent as { skills?: unknown }).skills);
    const skillSource = asString((agent as { skillSource?: unknown }).skillSource);
    if (isDevTeamCodingRole(agent) && skills.length === 0 && !skillSource) {
      missingDevTeamSkills.push(formatAgentLabel(agent));
    }

    const tools = (agent as { tools?: unknown }).tools;
    if (tools && typeof tools === "object") {
      const allow = asStringList((tools as { allow?: unknown }).allow).map((tool) =>
        tool.toLowerCase(),
      );
      if (allow.some((tool) => tool === "*" || tool === "exec" || tool.includes("elevated"))) {
        elevatedToolAgents.push(formatAgentLabel(agent));
      }
    }
  }

  for (const [agentDir, entries] of byAgentDir) {
    if (entries.length < 2) continue;
    findings.push({
      checkId: "agents.agent_dir.shared",
      severity: "critical",
      domain: "agents",
      title: "Multiple agents share the same agentDir",
      detail:
        `agentDir=${agentDir} is shared by:\n` +
        entries.map((entry) => `- ${formatAgentLabel(entry)}`).join("\n") +
        "\nShared agent directories can cause auth/session collisions across identities.",
      remediation: "Give each family/profile agent a unique agentDir and auth-profiles.json.",
    });
  }

  if (missingDevTeamSkills.length > 0) {
    findings.push({
      checkId: "agents.dev_team.skills_missing",
      severity: "warn",
      domain: "agents",
      title: "Coding family agents have no skill mapping",
      detail:
        "These dev-team agents do not have explicit or default skill mapping metadata:\n" +
        missingDevTeamSkills.map((entry) => `- ${entry}`).join("\n"),
      remediation:
        "Re-register the coding family member or set agents.list[].skills / skillSource so SpecForge handoffs know which coding playbooks apply.",
    });
  }

  if (elevatedToolAgents.length > 0) {
    findings.push({
      checkId: "agents.tools.high_risk_allow",
      severity: "warn",
      domain: "agents",
      title: "Agent tool allowlist includes high-risk execution",
      detail:
        "These agents have allowlists that include wildcard, exec, or elevated-like tools:\n" +
        elevatedToolAgents.map((entry) => `- ${entry}`).join("\n"),
      remediation:
        "Prefer narrow tool grants and keep elevated/exec access behind approval or contracted dispatch.",
    });
  }

  return findings;
}
