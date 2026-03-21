import fs from "node:fs";
import path from "node:path";
import { getAgentFamily } from "../data/agent-family.js";

const ARGENTOS_HOME = path.join(process.env.HOME ?? "", ".argentos");
const ARGENT_WORKSPACE = path.join(process.env.HOME ?? "", "argent");
const TEMPLATE_DIR = path.join(ARGENTOS_HOME, "templates", "family");
const TEMPLATE_FILES = [
  "SOUL.md",
  "IDENTITY.md",
  "AGENTS.md",
  "CONTEMPLATION.md",
  "TOOLS.md",
  "HEARTBEAT.md",
];

export interface FamilyWorkerProvisionParams {
  id: string;
  name: string;
  role: string;
  persona?: string;
  tools?: string[];
  model?: string;
  team?: string;
  provider?: string;
  callerAgentId?: string;
}

export interface FamilyWorkerProvisionResult {
  id: string;
  name: string;
  role: string;
  team: string;
  model: string;
  provider: string | null;
  identityDir: string;
  rootDir: string;
  redis: boolean;
}

interface IdentityParams {
  id: string;
  name: string;
  role: string;
  persona?: string;
  tools?: string[];
  model?: string;
  team?: string;
  provider?: string;
}

function buildTemplateVars(p: IdentityParams): Record<string, string> {
  const toolsList = p.tools?.length
    ? p.tools.map((t) => `- \`${t}\``).join("\n")
    : "- (configured at runtime)";

  const persona = p.persona
    ? p.persona
    : `You are ${p.name}, a specialized AI agent in the ArgentOS family.\n\n**Your role:** ${p.role}\n**Your approach:** Be direct, be competent, deliver results.`;

  return {
    name: p.name,
    id: p.id,
    role: p.role,
    team: p.team ?? "unassigned",
    model: p.model ?? "default (inherited from config)",
    persona,
    tools_list: toolsList,
  };
}

function renderTemplate(filename: string, vars: Record<string, string>): string {
  const templatePath = path.join(TEMPLATE_DIR, filename);
  let template: string;
  if (fs.existsSync(templatePath)) {
    template = fs.readFileSync(templatePath, "utf-8");
  } else {
    template = `# ${filename}\n\n{{persona}}\n`;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? "");
}

function copyIfSourceExists(src: string, dest: string): void {
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
  }
}

function bootstrapIdentity(params: IdentityParams): { agentDir: string; rootDir: string } {
  const rootDir = path.join(ARGENTOS_HOME, "agents", params.id);
  const agentDir = path.join(rootDir, "agent");
  const memoryDir = path.join(agentDir, "memory");

  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });

  const vars = buildTemplateVars(params);
  for (const filename of TEMPLATE_FILES) {
    const dest = path.join(agentDir, filename);
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, renderTemplate(filename, vars), "utf-8");
    }
  }

  copyIfSourceExists(path.join(ARGENT_WORKSPACE, "USER.md"), path.join(agentDir, "USER.md"));
  copyIfSourceExists(
    path.join(ARGENT_WORKSPACE, "SECURITY.md"),
    path.join(agentDir, "SECURITY.md"),
  );

  const identityJsonPath = path.join(rootDir, "identity.json");
  const identityPayload = {
    id: params.id,
    name: params.name,
    role: params.role,
    team: params.team ?? "unassigned",
    ...(params.model ? { model: params.model } : {}),
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.tools?.length ? { tools: params.tools } : {}),
  };
  fs.writeFileSync(identityJsonPath, JSON.stringify(identityPayload, null, 2), "utf-8");

  return { agentDir, rootDir };
}

function inferProvider(model: string | undefined): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return undefined;
  return trimmed.slice(0, slash).trim() || undefined;
}

export async function provisionFamilyWorker(
  params: FamilyWorkerProvisionParams,
): Promise<FamilyWorkerProvisionResult> {
  const config: Record<string, unknown> = {};
  if (params.persona) config.persona = params.persona;
  if (params.tools?.length) config.tools = params.tools;
  if (params.model) config.model = params.model;
  if (params.team) config.team = params.team;
  const provider = params.provider ?? inferProvider(params.model);
  if (provider) config.provider = provider;

  const family = await getAgentFamily();
  await family.registerAgent(params.id, params.name, params.role, config);

  const { agentDir, rootDir } = bootstrapIdentity({
    id: params.id,
    name: params.name,
    role: params.role,
    persona: params.persona,
    tools: params.tools,
    model: params.model,
    team: params.team,
    provider,
  });

  let redisOk = false;
  try {
    const { refreshPresence, setAgentState, publishDashboardEvent } =
      await import("../data/redis-client.js");
    const redis = family.getRedis();
    if (redis) {
      await refreshPresence(redis, params.id);
      await setAgentState(redis, params.id, {
        status: "idle",
        lastActivity: new Date().toISOString(),
      });
      await publishDashboardEvent(redis, {
        type: "agent_status",
        agentId: params.id,
        data: {
          event: "agent_registered",
          name: params.name,
          role: params.role,
          team: params.team ?? "unassigned",
          registeredBy: params.callerAgentId ?? "argent",
        },
      });
      redisOk = true;
    }
  } catch {
    // Redis is optional.
  }

  return {
    id: params.id,
    name: params.name,
    role: params.role,
    team: params.team ?? "unassigned",
    model: params.model ?? "default",
    provider: provider ?? null,
    identityDir: agentDir,
    rootDir,
    redis: redisOk,
  };
}
