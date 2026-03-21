import fs from "node:fs/promises";
import path from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { listAgentIds, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import {
  isProtectedAlignmentDocName,
  refreshAlignmentIntegrityManifest,
} from "../../agents/alignment-integrity.js";
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
import { loadConfig } from "../../config/config.js";
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
    const agentId = resolveAgentIdOrError(String(params.agentId ?? ""), cfg);
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
    const agentId = resolveAgentIdOrError(String(params.agentId ?? ""), cfg);
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }
    const name = String(params.name ?? "").trim();
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
    const agentId = resolveAgentIdOrError(String(params.agentId ?? ""), cfg);
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }
    const name = String(params.name ?? "").trim();
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
    const content = String(params.content ?? "");
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
