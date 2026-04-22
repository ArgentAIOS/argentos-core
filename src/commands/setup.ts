import JSON5 from "json5";
import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import { DEFAULT_AGENT_WORKSPACE_DIR, ensureAgentWorkspace } from "../agents/workspace.js";
import { type ArgentConfig, createConfigIO, writeConfigFile } from "../config/config.js";
import { formatConfigPath, logConfigUpdated } from "../config/logging.js";
import { resolveSessionTranscriptsDir } from "../config/sessions.js";
import { defaultRuntime } from "../runtime.js";
import { shortenHomePath } from "../utils.js";
import { resolveUserPath } from "../utils.js";

type StarterFamilyAgent = {
  id: string;
  name: string;
  role: string;
  team: string;
  model?: string;
  provider?: string;
};

async function loadStarterFamily(): Promise<StarterFamilyAgent[]> {
  const candidates = [
    new URL("../agents/starter-family.json", import.meta.url),
    new URL("../src/agents/starter-family.json", import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as StarterFamilyAgent[];
      }
    } catch {
      // Try next location.
    }
  }
  throw new Error("starter-family.json not found in runtime snapshot");
}

async function seedStarterFamilyAgents(agentsRoot: string): Promise<number> {
  const starterFamily = await loadStarterFamily();
  let seeded = 0;
  for (const agent of starterFamily) {
    const rootDir = path.join(agentsRoot, agent.id);
    const agentDir = path.join(rootDir, "agent");
    const identityPath = path.join(agentDir, "IDENTITY.md");
    const identityJsonPath = path.join(rootDir, "identity.json");
    await ensureAgentWorkspace({
      dir: agentDir,
      ensureBootstrapFiles: true,
    });
    const identityMarkdown = [
      "# IDENTITY.md",
      "",
      `- **Name:** ${agent.name}`,
      `- **Role:** ${agent.role}`,
      `- **Team:** ${agent.team}`,
      "",
    ].join("\n");
    let touched = false;
    try {
      await fs.access(identityPath);
    } catch {
      await fs.writeFile(identityPath, `${identityMarkdown}\n`, "utf-8");
      touched = true;
    }
    try {
      await fs.access(identityJsonPath);
    } catch {
      await fs.writeFile(
        identityJsonPath,
        `${JSON.stringify(
          {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            team: agent.team,
            ...(agent.model ? { model: agent.model } : {}),
            ...(agent.provider ? { provider: agent.provider } : {}),
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );
      touched = true;
    }
    if (touched) {
      seeded += 1;
    }
  }
  return seeded;
}

async function readConfigFileRaw(configPath: string): Promise<{
  exists: boolean;
  parsed: ArgentConfig;
}> {
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON5.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { exists: true, parsed: parsed as ArgentConfig };
    }
    return { exists: true, parsed: {} };
  } catch {
    return { exists: false, parsed: {} };
  }
}

export async function setupCommand(
  opts?: { workspace?: string },
  runtime: RuntimeEnv = defaultRuntime,
) {
  const desiredWorkspace =
    typeof opts?.workspace === "string" && opts.workspace.trim()
      ? opts.workspace.trim()
      : undefined;

  const io = createConfigIO();
  const configPath = io.configPath;
  const existingRaw = await readConfigFileRaw(configPath);
  const cfg = existingRaw.parsed;
  const defaults = cfg.agents?.defaults ?? {};

  const workspace = desiredWorkspace ?? defaults.workspace ?? DEFAULT_AGENT_WORKSPACE_DIR;

  const next: ArgentConfig = {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...defaults,
        workspace,
      },
    },
  };

  if (!existingRaw.exists || defaults.workspace !== workspace) {
    await writeConfigFile(next);
    if (!existingRaw.exists) {
      runtime.log(`Wrote ${formatConfigPath(configPath)}`);
    } else {
      logConfigUpdated(runtime, { path: configPath, suffix: "(set agents.defaults.workspace)" });
    }
  } else {
    runtime.log(`Config OK: ${formatConfigPath(configPath)}`);
  }

  const ws = await ensureAgentWorkspace({
    dir: workspace,
    ensureBootstrapFiles: !next.agents?.defaults?.skipBootstrap,
  });
  runtime.log(`Workspace OK: ${shortenHomePath(ws.dir)}`);

  const workspaceMainAlias = path.join(path.dirname(ws.dir), "workspace-main");
  try {
    await fs.rm(workspaceMainAlias, { force: true, recursive: true });
  } catch {
    // ignore
  }
  try {
    await fs.symlink(ws.dir, workspaceMainAlias, "dir");
  } catch {
    try {
      await fs.cp(ws.dir, workspaceMainAlias, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
    } catch {
      // ignore fallback failures
    }
  }
  runtime.log(`Workspace alias OK: ${shortenHomePath(workspaceMainAlias)}`);

  const agentsRoot = path.join(
    resolveUserPath(path.join(process.env.HOME ?? "~", ".argentos")),
    "agents",
  );
  await fs.mkdir(agentsRoot, { recursive: true });
  const seededCount = await seedStarterFamilyAgents(agentsRoot);
  runtime.log(`Starter family OK: ${seededCount} agents`);

  const sessionsDir = resolveSessionTranscriptsDir();
  await fs.mkdir(sessionsDir, { recursive: true });
  runtime.log(`Sessions OK: ${shortenHomePath(sessionsDir)}`);
}
