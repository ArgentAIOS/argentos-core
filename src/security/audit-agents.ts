import path from "node:path";
import type { ArgentConfig } from "../config/config.js";
import type { SecurityAuditFinding } from "./audit.js";
import { AUTH_PROFILE_FILENAME } from "../agents/auth-profiles/constants.js";
import { resolveUserPath } from "../utils.js";

type AgentEntry = NonNullable<NonNullable<ArgentConfig["agents"]>["list"]>[number];
type AgentRecord = AgentEntry & Record<string, unknown>;

const SMALL_MODEL_PARAM_B_MAX = 300;
const SOURCE_OF_TRUTH_FIELDS = [
  "profileSourceOfTruth",
  "sourceOfTruth",
  "identitySourceOfTruth",
  "profileSource",
  "identitySource",
];
const AUTH_PROFILE_PATH_FIELDS = [
  "authProfilesPath",
  "authProfilePath",
  "authStorePath",
  "authProfilesFile",
  "authProfileFile",
];
const AUTH_PROFILE_DIR_FIELDS = ["authProfilesDir", "authProfileDir", "authStoreDir"];
const HIGH_RISK_TOOL_LABELS: Record<string, string> = {
  "*": "wildcard tool access",
  exec: "host/runtime command execution",
  process: "runtime process control",
  bash: "host/runtime command execution",
  terminal: "terminal command execution",
  apply_patch: "file mutation",
  web_search: "external web search",
  web_fetch: "external web fetch",
  browser: "browser automation",
  cron: "scheduled automation",
  gateway: "gateway control",
  nodes: "device/node control",
  message: "external messaging",
  sessions_send: "cross-session messaging",
  sessions_spawn: "sub-agent spawning",
  sessions_history: "cross-session history access",
  "group:runtime": "runtime execution tool group",
  "group:web": "external web tool group",
  "group:ui": "browser/UI automation tool group",
  "group:automation": "automation/control tool group",
  "group:messaging": "external messaging tool group",
  "group:sessions": "session control tool group",
};
const HIGH_RISK_TOOL_PROFILES: Record<string, string> = {
  coding: "coding profile includes runtime/file/session tools",
  full: "full profile can expose high-risk tools",
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
  if (agentTeam(agent) !== "dev-team") {
    return false;
  }
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

function canonicalPath(raw: string): string {
  const resolved = resolveUserPath(raw);
  return process.platform === "darwin" || process.platform === "win32"
    ? resolved.toLowerCase()
    : resolved;
}

function authProfilePathFromAgentDir(agentDir: string): string {
  return path.join(resolveUserPath(agentDir), AUTH_PROFILE_FILENAME);
}

function collectAuthProfilePaths(agent: AgentRecord): Array<{ pathname: string; source: string }> {
  const paths: Array<{ pathname: string; source: string }> = [];
  const agentDir = asString(agent.agentDir);
  if (agentDir) {
    paths.push({
      pathname: authProfilePathFromAgentDir(agentDir),
      source: "agents.list[].agentDir/auth-profiles.json",
    });
  }

  for (const field of AUTH_PROFILE_PATH_FIELDS) {
    const pathname = asString(agent[field]);
    if (pathname) {
      paths.push({ pathname, source: `agents.list[].${field}` });
    }
  }

  for (const field of AUTH_PROFILE_DIR_FIELDS) {
    const dir = asString(agent[field]);
    if (dir) {
      paths.push({
        pathname: path.join(resolveUserPath(dir), AUTH_PROFILE_FILENAME),
        source: `agents.list[].${field}`,
      });
    }
  }

  const auth = asRecord(agent.auth);
  if (auth) {
    for (const field of AUTH_PROFILE_PATH_FIELDS) {
      const pathname = asString(auth[field]);
      if (pathname) {
        paths.push({ pathname, source: `agents.list[].auth.${field}` });
      }
    }
    for (const field of AUTH_PROFILE_DIR_FIELDS) {
      const dir = asString(auth[field]);
      if (dir) {
        paths.push({
          pathname: path.join(resolveUserPath(dir), AUTH_PROFILE_FILENAME),
          source: `agents.list[].auth.${field}`,
        });
      }
    }
  }

  return paths;
}

function addModel(models: string[], raw: unknown) {
  if (typeof raw !== "string") {
    return;
  }
  const model = raw.trim();
  if (model) {
    models.push(model);
  }
}

function addModelSelection(models: string[], raw: unknown) {
  if (typeof raw === "string") {
    addModel(models, raw);
    return;
  }
  const record = asRecord(raw);
  if (!record) {
    return;
  }
  addModel(models, record.primary);
  for (const fallback of asStringList(record.fallbacks)) {
    addModel(models, fallback);
  }
}

function collectEffectiveAgentModels(cfg: ArgentConfig, agent: AgentRecord): string[] {
  const models: string[] = [];
  if (agent.model !== undefined) {
    addModelSelection(models, agent.model);
  } else {
    addModelSelection(models, cfg.agents?.defaults?.model);
  }
  return Array.from(new Set(models));
}

function inferParamBFromModel(model: string): number | null {
  const matches = model
    .toLowerCase()
    .matchAll(/(?:^|[^a-z0-9])[a-z]?(\d+(?:\.\d+)?)b(?:[^a-z0-9]|$)/g);
  let best: number | null = null;
  for (const match of matches) {
    const raw = match[1];
    if (!raw) {
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    if (best === null || value > best) {
      best = value;
    }
  }
  return best;
}

function classifyWeakModel(model: string): string | null {
  const paramB = inferParamBFromModel(model);
  if (paramB !== null && paramB <= SMALL_MODEL_PARAM_B_MAX) {
    return `${paramB}B parameter model`;
  }
  if (/\bhaiku\b/i.test(model)) {
    return "Haiku/small-model tier";
  }
  if (/\b(mini|nano|flash|lite)\b/i.test(model)) {
    return "small/low-cost model tier";
  }
  if (/\bgpt-/i.test(model) && !/\bgpt-5(?:\b|[.-])/i.test(model)) {
    return "below GPT-5 family";
  }
  if (/\bclaude-/i.test(model) && !/\bclaude-[^\s/]*?(?:-4-?5\b|4\.5\b)/i.test(model)) {
    return "below Claude 4.5";
  }
  return null;
}

function normalizeToolName(tool: string): string {
  const normalized = tool.trim().toLowerCase();
  if (normalized === "apply-patch") {
    return "apply_patch";
  }
  return normalized;
}

function collectPolicyToolRisks(
  policy: unknown,
  source: string,
): Array<{ tool: string; reason: string; source: string }> {
  const record = asRecord(policy);
  if (!record) {
    return [];
  }
  const risks: Array<{ tool: string; reason: string; source: string }> = [];
  const profile = asString(record.profile).toLowerCase();
  const profileRisk = HIGH_RISK_TOOL_PROFILES[profile];
  if (profileRisk) {
    risks.push({ tool: `profile:${profile}`, reason: profileRisk, source: `${source}.profile` });
  }
  for (const field of ["allow", "alsoAllow"] as const) {
    for (const raw of asStringList(record[field])) {
      const tool = normalizeToolName(raw);
      const reason =
        HIGH_RISK_TOOL_LABELS[tool] ?? (tool.includes("elevated") ? "elevated tool access" : "");
      if (reason) {
        risks.push({ tool, reason, source: `${source}.${field}` });
      }
    }
  }
  return risks;
}

function modelPolicyKeys(model: string): string[] {
  const trimmed = model.trim();
  const slash = trimmed.indexOf("/");
  const provider = slash > 0 ? trimmed.slice(0, slash) : "";
  return [trimmed, provider].filter(Boolean).map((entry) => entry.toLowerCase());
}

function collectByProviderToolRisks(
  tools: unknown,
  model: string,
  source: string,
): Array<{ tool: string; reason: string; source: string }> {
  const record = asRecord(tools);
  const byProvider = asRecord(record?.byProvider);
  if (!byProvider) {
    return [];
  }
  const keys = new Set(modelPolicyKeys(model));
  const risks: Array<{ tool: string; reason: string; source: string }> = [];
  for (const [key, policy] of Object.entries(byProvider)) {
    if (!keys.has(key.toLowerCase())) {
      continue;
    }
    risks.push(...collectPolicyToolRisks(policy, `${source}.byProvider.${key}`));
  }
  return risks;
}

function dedupeRisks(
  risks: Array<{ tool: string; reason: string; source: string }>,
): Array<{ tool: string; reason: string; source: string }> {
  const seen = new Set<string>();
  const out: Array<{ tool: string; reason: string; source: string }> = [];
  for (const risk of risks) {
    const key = `${risk.tool}\0${risk.reason}\0${risk.source}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(risk);
  }
  return out;
}

export function collectAgentProfileFindings(cfg: ArgentConfig): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  const agents = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  if (agents.length === 0) {
    return findings;
  }

  const byAgentDir = new Map<string, AgentEntry[]>();
  const byAuthProfilePath = new Map<
    string,
    Array<{ agent: AgentEntry; pathname: string; source: string }>
  >();
  const missingDevTeamSkills: string[] = [];
  const elevatedToolAgents: string[] = [];
  const weakModelToolPairs: string[] = [];
  const sourceMismatches: string[] = [];

  for (const agent of agents) {
    if (!agent || typeof agent !== "object") {
      continue;
    }
    const agentRecord = agent as AgentRecord;
    const agentDir = asString(agentRecord.agentDir);
    if (agentDir) {
      const existing = byAgentDir.get(agentDir) ?? [];
      existing.push(agent);
      byAgentDir.set(agentDir, existing);
    }

    for (const ref of collectAuthProfilePaths(agentRecord)) {
      const key = canonicalPath(ref.pathname);
      const existing = byAuthProfilePath.get(key) ?? [];
      existing.push({ agent, pathname: ref.pathname, source: ref.source });
      byAuthProfilePath.set(key, existing);
    }

    const sourceFields = SOURCE_OF_TRUTH_FIELDS.map((field) => ({
      field,
      value: asString(agentRecord[field]),
    })).filter((entry) => entry.value);
    const distinctSources = Array.from(new Set(sourceFields.map((entry) => entry.value)));
    if (distinctSources.length > 1) {
      sourceMismatches.push(
        `- ${formatAgentLabel(agent)}: ` +
          sourceFields.map((entry) => `${entry.field}=${entry.value}`).join(", "),
      );
    }

    const skills = asStringList(agentRecord.skills);
    const skillSource = asString(agentRecord.skillSource);
    if (isDevTeamCodingRole(agent) && skills.length === 0 && !skillSource) {
      missingDevTeamSkills.push(formatAgentLabel(agent));
    }

    const tools = agentRecord.tools;
    if (tools && typeof tools === "object") {
      const allow = [
        ...asStringList((tools as { allow?: unknown }).allow),
        ...asStringList((tools as { alsoAllow?: unknown }).alsoAllow),
      ].map((tool) => tool.toLowerCase());
      if (allow.some((tool) => tool === "*" || tool === "exec" || tool.includes("elevated"))) {
        elevatedToolAgents.push(formatAgentLabel(agent));
      }
    }

    for (const model of collectEffectiveAgentModels(cfg, agentRecord)) {
      const modelRisk = classifyWeakModel(model);
      if (!modelRisk) {
        continue;
      }
      const toolRisks = dedupeRisks([
        ...collectPolicyToolRisks(cfg.tools, "tools"),
        ...collectByProviderToolRisks(cfg.tools, model, "tools"),
        ...collectPolicyToolRisks(tools, `agents.list.${agentId(agent) || "(unknown)"}.tools`),
        ...collectByProviderToolRisks(
          tools,
          model,
          `agents.list.${agentId(agent) || "(unknown)"}.tools`,
        ),
      ]);
      if (toolRisks.length === 0) {
        continue;
      }
      const riskLabel = toolRisks
        .slice(0, 4)
        .map((risk) => `${risk.tool} (${risk.reason} via ${risk.source})`)
        .join("; ");
      const more = toolRisks.length > 4 ? `; +${toolRisks.length - 4} more` : "";
      weakModelToolPairs.push(
        `- ${formatAgentLabel(agent)}: model=${model} (${modelRisk}); tools=${riskLabel}${more}`,
      );
    }
  }

  for (const [agentDir, entries] of byAgentDir) {
    if (entries.length < 2) {
      continue;
    }
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

  for (const entries of byAuthProfilePath.values()) {
    const uniqueAgents = new Set(entries.map((entry) => agentId(entry.agent)));
    if (uniqueAgents.size < 2) {
      continue;
    }
    const firstPath = entries[0]?.pathname ?? "(unknown)";
    findings.push({
      checkId: "agents.auth_profiles.shared",
      severity: "critical",
      domain: "agents",
      title: "Multiple agents share the same auth profile store",
      detail:
        `auth profile store=${firstPath} is shared by:\n` +
        entries.map((entry) => `- ${formatAgentLabel(entry.agent)} (${entry.source})`).join("\n") +
        "\nShared auth-profiles.json can mix provider tokens, cooldowns, and profile selection across agent identities.",
      remediation:
        "Give each agent a separate auth-profiles.json. If credentials must be reused, copy or re-authorize profiles into each agentDir instead of pointing multiple agents at the same store.",
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

  if (sourceMismatches.length > 0) {
    findings.push({
      checkId: "agents.profile.source_mismatch",
      severity: "warn",
      domain: "agents",
      title: "Agent profile source-of-truth metadata is inconsistent",
      detail:
        "These agents expose multiple profile source-of-truth fields with different values:\n" +
        sourceMismatches.join("\n"),
      remediation:
        "Pick one authoritative profile source for each agent and update the extra source-of-truth fields to match it, or remove stale metadata.",
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

  if (weakModelToolPairs.length > 0) {
    findings.push({
      checkId: "agents.models.high_risk_tools_on_weak_model",
      severity: "warn",
      domain: "agents",
      title: "Weak or small agent models have high-risk tools",
      detail:
        "These agents pair smaller/weaker models with external, elevated, or control-plane tools:\n" +
        weakModelToolPairs.slice(0, 12).join("\n") +
        (weakModelToolPairs.length > 12 ? `\n...${weakModelToolPairs.length - 12} more` : ""),
      remediation:
        "Move high-risk tools to a stronger model-backed agent, or narrow tools.allow/tools.alsoAllow/tools.profile so smaller models cannot call exec, web/browser, messaging, session, or automation tools without operator approval.",
    });
  }

  return findings;
}
