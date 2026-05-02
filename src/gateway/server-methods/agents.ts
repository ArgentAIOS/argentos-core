import fs from "node:fs/promises";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import type { TtsConfig, TtsPersonaConfig } from "../../config/types.tts.js";
import type { GatewayRequestHandlers } from "./types.js";
import {
  mergeTtsConfig,
  redactTtsConfig,
  resolveEffectiveAgentTtsProfile,
  summarizeAuthProfileStore,
} from "../../agents/agent-profile.js";
import {
  listAgentIds,
  resolveAgentConfig,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
} from "../../agents/agent-scope.js";
import {
  isProtectedAlignmentDocName,
  refreshAlignmentIntegrityManifest,
} from "../../agents/alignment-integrity.js";
import { ensureAuthProfileStore } from "../../agents/auth-profiles.js";
import { provisionFamilyWorker } from "../../agents/family-worker-provisioning.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
} from "../../agents/workspace.js";
import {
  loadConfig,
  validateConfigObjectWithPlugins,
  writeConfigFile,
} from "../../config/config.js";
import { getAgentFamily } from "../../data/agent-family.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAgentsFilesGetParams,
  validateAgentsFilesListParams,
  validateAgentsFilesSetParams,
  validateAgentsListParams,
} from "../protocol/index.js";
import { listAgentsForGateway } from "../session-utils.js";

const log = createSubsystemLogger("alignment-integrity");

const BOOTSTRAP_FILE_NAMES = [
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
] as const;

const MEMORY_FILE_NAMES = [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME] as const;

const ALLOWED_FILE_NAMES = new Set<string>([...BOOTSTRAP_FILE_NAMES, ...MEMORY_FILE_NAMES]);
const TTS_FALLBACK_POLICIES = new Set(["preserve-persona", "provider-defaults", "fail"]);

type FileMeta = {
  size: number;
  updatedAtMs: number;
};

async function statFile(filePath: string): Promise<FileMeta | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return null;
    }
    return {
      size: stat.size,
      updatedAtMs: Math.floor(stat.mtimeMs),
    };
  } catch {
    return null;
  }
}

async function listAgentFiles(workspaceDir: string) {
  const files: Array<{
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
  }> = [];

  for (const name of BOOTSTRAP_FILE_NAMES) {
    const filePath = path.join(workspaceDir, name);
    const meta = await statFile(filePath);
    if (meta) {
      files.push({
        name,
        path: filePath,
        missing: false,
        size: meta.size,
        updatedAtMs: meta.updatedAtMs,
      });
    } else {
      files.push({ name, path: filePath, missing: true });
    }
  }

  const primaryMemoryPath = path.join(workspaceDir, DEFAULT_MEMORY_FILENAME);
  const primaryMeta = await statFile(primaryMemoryPath);
  if (primaryMeta) {
    files.push({
      name: DEFAULT_MEMORY_FILENAME,
      path: primaryMemoryPath,
      missing: false,
      size: primaryMeta.size,
      updatedAtMs: primaryMeta.updatedAtMs,
    });
  } else {
    const altMemoryPath = path.join(workspaceDir, DEFAULT_MEMORY_ALT_FILENAME);
    const altMeta = await statFile(altMemoryPath);
    if (altMeta) {
      files.push({
        name: DEFAULT_MEMORY_ALT_FILENAME,
        path: altMemoryPath,
        missing: false,
        size: altMeta.size,
        updatedAtMs: altMeta.updatedAtMs,
      });
    } else {
      files.push({ name: DEFAULT_MEMORY_FILENAME, path: primaryMemoryPath, missing: true });
    }
  }

  return files;
}

function resolveAgentIdOrError(agentIdRaw: string, cfg: ReturnType<typeof loadConfig>) {
  const agentId = normalizeAgentId(agentIdRaw);
  const allowed = new Set(listAgentIds(cfg));
  if (!allowed.has(agentId)) {
    return null;
  }
  return agentId;
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function paramString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rows = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return rows.length > 0 ? rows : undefined;
}

function cleanPersonaConfig(value: unknown): TtsPersonaConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const promptRaw =
    raw.prompt && typeof raw.prompt === "object" && !Array.isArray(raw.prompt)
      ? (raw.prompt as Record<string, unknown>)
      : undefined;
  const fallbackPolicy = cleanOptionalString(raw.fallbackPolicy);
  const next: TtsPersonaConfig = {
    ...(cleanOptionalString(raw.label) ? { label: cleanOptionalString(raw.label) } : {}),
    ...(cleanOptionalString(raw.description)
      ? { description: cleanOptionalString(raw.description) }
      : {}),
    ...(cleanOptionalString(raw.provider) ? { provider: cleanOptionalString(raw.provider) } : {}),
    ...(fallbackPolicy && TTS_FALLBACK_POLICIES.has(fallbackPolicy)
      ? { fallbackPolicy: fallbackPolicy as TtsPersonaConfig["fallbackPolicy"] }
      : {}),
    ...(promptRaw
      ? {
          prompt: {
            ...(cleanOptionalString(promptRaw.profile)
              ? { profile: cleanOptionalString(promptRaw.profile) }
              : {}),
            ...(cleanOptionalString(promptRaw.scene)
              ? { scene: cleanOptionalString(promptRaw.scene) }
              : {}),
            ...(cleanOptionalString(promptRaw.sampleContext)
              ? { sampleContext: cleanOptionalString(promptRaw.sampleContext) }
              : {}),
            ...(cleanOptionalString(promptRaw.style)
              ? { style: cleanOptionalString(promptRaw.style) }
              : {}),
            ...(cleanOptionalString(promptRaw.accent)
              ? { accent: cleanOptionalString(promptRaw.accent) }
              : {}),
            ...(cleanOptionalString(promptRaw.pacing)
              ? { pacing: cleanOptionalString(promptRaw.pacing) }
              : {}),
            ...(cleanStringArray(promptRaw.constraints)
              ? { constraints: cleanStringArray(promptRaw.constraints) }
              : {}),
          },
        }
      : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

function cleanPersonaMap(value: unknown): Record<string, TtsPersonaConfig> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const next: Record<string, TtsPersonaConfig> = {};
  for (const [key, rawPersona] of Object.entries(value)) {
    const id = key.trim();
    if (!id) {
      continue;
    }
    const persona = cleanPersonaConfig(rawPersona);
    if (persona) {
      next[id] = persona;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function cleanAgentTtsPatch(raw: unknown): TtsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const value = raw as Record<string, unknown>;
  const elevenlabsRaw =
    value.elevenlabs && typeof value.elevenlabs === "object" && !Array.isArray(value.elevenlabs)
      ? (value.elevenlabs as Record<string, unknown>)
      : undefined;
  const openaiRaw =
    value.openai && typeof value.openai === "object" && !Array.isArray(value.openai)
      ? (value.openai as Record<string, unknown>)
      : undefined;
  const edgeRaw =
    value.edge && typeof value.edge === "object" && !Array.isArray(value.edge)
      ? (value.edge as Record<string, unknown>)
      : undefined;
  const personas = cleanPersonaMap(value.personas);
  const next: TtsConfig = {
    ...(cleanOptionalString(value.auto)
      ? { auto: cleanOptionalString(value.auto) as TtsConfig["auto"] }
      : {}),
    ...(cleanOptionalString(value.mode)
      ? { mode: cleanOptionalString(value.mode) as TtsConfig["mode"] }
      : {}),
    ...(cleanOptionalString(value.provider)
      ? { provider: cleanOptionalString(value.provider) }
      : {}),
    ...(cleanOptionalString(value.persona) ? { persona: cleanOptionalString(value.persona) } : {}),
    ...(cleanStringArray(value.fallbackOrder)
      ? { fallbackOrder: cleanStringArray(value.fallbackOrder) }
      : {}),
    ...(personas ? { personas } : {}),
    ...(elevenlabsRaw
      ? {
          elevenlabs: {
            ...(cleanOptionalString(elevenlabsRaw.voiceId)
              ? { voiceId: cleanOptionalString(elevenlabsRaw.voiceId) }
              : {}),
            ...(cleanOptionalString(elevenlabsRaw.modelId)
              ? { modelId: cleanOptionalString(elevenlabsRaw.modelId) }
              : {}),
          },
        }
      : {}),
    ...(openaiRaw
      ? {
          openai: {
            ...(cleanOptionalString(openaiRaw.voice)
              ? { voice: cleanOptionalString(openaiRaw.voice) }
              : {}),
            ...(cleanOptionalString(openaiRaw.model)
              ? { model: cleanOptionalString(openaiRaw.model) }
              : {}),
          },
        }
      : {}),
    ...(edgeRaw
      ? {
          edge: {
            ...(cleanOptionalString(edgeRaw.voice)
              ? { voice: cleanOptionalString(edgeRaw.voice) }
              : {}),
            ...(cleanOptionalString(edgeRaw.lang)
              ? { lang: cleanOptionalString(edgeRaw.lang) }
              : {}),
          },
        }
      : {}),
  };
  return next;
}

function upsertAgentTts(cfg: ArgentConfig, agentId: string, tts: TtsConfig): ArgentConfig {
  const list = Array.isArray(cfg.agents?.list) ? [...cfg.agents.list] : [];
  const index = list.findIndex((entry) => normalizeAgentId(entry.id) === agentId);
  if (index >= 0) {
    const existing = list[index];
    if (!existing) {
      list.push({ id: agentId, tts });
      return { ...cfg, agents: { ...cfg.agents, list } };
    }
    list[index] = { ...existing, tts: mergeTtsConfig(existing.tts, tts) };
  } else {
    list.push({ id: agentId, tts });
  }
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      list,
    },
  };
}

function buildAgentProfileResponse(cfg: ArgentConfig, agentId: string) {
  const resolved = resolveAgentConfig(cfg, agentId);
  const tts = resolveEffectiveAgentTtsProfile(cfg, agentId);
  const agentDir = resolveAgentDir(cfg, agentId);
  const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  return {
    agentId,
    defaultAgentId: listAgentsForGateway(cfg).defaultId,
    availableAgents: listAgentsForGateway(cfg).agents.map((agent) => ({
      id: agent.id,
      label: agent.name || agent.id,
    })),
    profile: {
      id: agentId,
      name: resolved?.name,
      identity: resolved?.identity,
      workspace: resolveAgentWorkspaceDir(cfg, agentId),
      agentDir,
    },
    tts: {
      source: tts.source,
      effective: redactTtsConfig(tts.effective) ?? {},
      global: redactTtsConfig(tts.global),
      agent: redactTtsConfig(tts.agent) ?? {},
    },
    auth: summarizeAuthProfileStore(authStore),
  };
}

export const agentsHandlers: GatewayRequestHandlers = {
  "agents.list": ({ params, respond }) => {
    if (!validateAgentsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.list params: ${formatValidationErrors(validateAgentsListParams.errors)}`,
        ),
      );
      return;
    }

    const cfg = loadConfig();
    const result = listAgentsForGateway(cfg);
    respond(true, result, undefined);
  },
  "agents.profile.get": ({ params, respond }) => {
    const cfg = loadConfig();
    const agentId = resolveAgentIdOrError(paramString(params.agentId), cfg);
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }
    respond(true, buildAgentProfileResponse(cfg, agentId), undefined);
  },
  "agents.profile.update": async ({ params, respond }) => {
    const cfg = loadConfig();
    const agentId = resolveAgentIdOrError(paramString(params.agentId), cfg);
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }
    const tts = cleanAgentTtsPatch((params as { tts?: unknown }).tts);
    const next = upsertAgentTts(cfg, agentId, tts);
    const validated = validateConfigObjectWithPlugins(next);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid agent profile update", {
          details: { issues: validated.issues },
        }),
      );
      return;
    }
    await writeConfigFile(validated.config);
    respond(true, buildAgentProfileResponse(validated.config, agentId), undefined);
  },
  "family.members": async ({ respond }) => {
    try {
      const family = await getAgentFamily();
      const members = await family.listMembers();
      respond(true, { members }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          error instanceof Error ? error.message : "failed to list family members",
        ),
      );
    }
  },
  "family.register": async ({ params, respond }) => {
    try {
      const idRaw = typeof params.id === "string" ? params.id.trim() : "";
      const nameRaw = typeof params.name === "string" ? params.name.trim() : "";
      const roleRaw = typeof params.role === "string" ? params.role.trim() : "";
      if (!idRaw || !nameRaw || !roleRaw) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "id, name, and role are required"),
        );
        return;
      }
      const toolValues = Array.isArray(params.tools)
        ? params.tools.filter((item): item is string => typeof item === "string")
        : undefined;
      const skillValues = Array.isArray(params.skills)
        ? params.skills.filter((item): item is string => typeof item === "string")
        : undefined;
      const result = await provisionFamilyWorker({
        id: idRaw,
        name: nameRaw,
        role: roleRaw,
        team: typeof params.team === "string" ? params.team.trim() || undefined : undefined,
        persona:
          typeof params.persona === "string" ? params.persona.trim() || undefined : undefined,
        model: typeof params.model === "string" ? params.model.trim() || undefined : undefined,
        provider:
          typeof params.provider === "string" ? params.provider.trim() || undefined : undefined,
        tools:
          toolValues?.map((item) => item.trim()).filter((item) => item.length > 0) ?? undefined,
        skills:
          skillValues?.map((item) => item.trim()).filter((item) => item.length > 0) ?? undefined,
        callerAgentId: "operator",
      });
      respond(true, { worker: result }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "failed to register worker",
        ),
      );
    }
  },
  "agents.files.list": async ({ params, respond }) => {
    if (!validateAgentsFilesListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.files.list params: ${formatValidationErrors(
            validateAgentsFilesListParams.errors,
          )}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentId = resolveAgentIdOrError(paramString(params.agentId), cfg);
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const files = await listAgentFiles(workspaceDir);
    respond(true, { agentId, workspace: workspaceDir, files }, undefined);
  },
  "agents.files.get": async ({ params, respond }) => {
    if (!validateAgentsFilesGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.files.get params: ${formatValidationErrors(
            validateAgentsFilesGetParams.errors,
          )}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentId = resolveAgentIdOrError(paramString(params.agentId), cfg);
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }
    const name = paramString(params.name);
    if (!ALLOWED_FILE_NAMES.has(name)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unsupported file "${name}"`),
      );
      return;
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const filePath = path.join(workspaceDir, name);
    const meta = await statFile(filePath);
    if (!meta) {
      respond(
        true,
        {
          agentId,
          workspace: workspaceDir,
          file: { name, path: filePath, missing: true },
        },
        undefined,
      );
      return;
    }
    const content = await fs.readFile(filePath, "utf-8");
    respond(
      true,
      {
        agentId,
        workspace: workspaceDir,
        file: {
          name,
          path: filePath,
          missing: false,
          size: meta.size,
          updatedAtMs: meta.updatedAtMs,
          content,
        },
      },
      undefined,
    );
  },
  "agents.files.set": async ({ params, respond }) => {
    if (!validateAgentsFilesSetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.files.set params: ${formatValidationErrors(
            validateAgentsFilesSetParams.errors,
          )}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentId = resolveAgentIdOrError(paramString(params.agentId), cfg);
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }
    const name = paramString(params.name);
    if (!ALLOWED_FILE_NAMES.has(name)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unsupported file "${name}"`),
      );
      return;
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    await fs.mkdir(workspaceDir, { recursive: true });
    const filePath = path.join(workspaceDir, name);
    const content = typeof params.content === "string" ? params.content : "";
    await fs.writeFile(filePath, content, "utf-8");
    if (isProtectedAlignmentDocName(name)) {
      try {
        const refreshed = await refreshAlignmentIntegrityManifest(workspaceDir);
        log.info(
          `audit: protected alignment file updated agent=${agentId} file=${name} manifest=${refreshed.manifestPath}`,
        );
      } catch (err) {
        log.warn(
          `audit: failed to refresh alignment manifest after protected write agent=${agentId} file=${name} error=${String(
            err,
          )}`,
        );
      }
    }
    const meta = await statFile(filePath);
    respond(
      true,
      {
        ok: true,
        agentId,
        workspace: workspaceDir,
        file: {
          name,
          path: filePath,
          missing: false,
          size: meta?.size,
          updatedAtMs: meta?.updatedAtMs,
          content,
        },
      },
      undefined,
    );
  },
};
