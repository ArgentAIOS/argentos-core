import type { GatewayRequestHandlers } from "./types.js";
import {
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveSessionAgentId,
} from "../../agents/agent-scope.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../agents/defaults.js";
import {
  abortEmbeddedPiRun,
  compactEmbeddedPiSession,
  isEmbeddedPiRunActive,
  waitForEmbeddedPiRunEnd,
} from "../../agents/pi-embedded.js";
import { getChatCommands } from "../../auto-reply/commands-registry.data.js";
import { normalizeThinkLevel } from "../../auto-reply/thinking.js";
import { loadConfig } from "../../config/config.js";
import { resolveSessionFilePath } from "../../config/sessions.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { loadSessionEntry, resolveSessionModelRef } from "../session-utils.js";

export const commandsHandlers: GatewayRequestHandlers = {
  /**
   * List all registered slash commands for dashboard autocomplete.
   */
  "commands.list": ({ respond }) => {
    const commands = getChatCommands();
    const list = commands
      .filter((cmd) => cmd.textAliases.length > 0)
      .map((cmd) => ({
        key: cmd.key,
        description: cmd.description,
        aliases: cmd.textAliases,
        category: cmd.category ?? "other",
        acceptsArgs: cmd.acceptsArgs ?? false,
      }));
    respond(true, { commands: list }, undefined);
  },

  /**
   * Perform LLM-based context compaction on a session.
   * This calls the embedded Pi agent to summarize the conversation context,
   * unlike sessions.compact which just truncates the transcript file.
   */
  "commands.compact": async ({ params, respond }) => {
    const sessionKey = String(params?.sessionKey ?? "").trim();
    if (!sessionKey) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey required"));
      return;
    }

    const customInstructions =
      typeof params?.instructions === "string"
        ? params.instructions.trim() || undefined
        : undefined;

    const cfg = loadConfig();
    const loaded = loadSessionEntry(sessionKey);
    const entry = loaded?.entry;
    if (!entry?.sessionId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "session not found or has no sessionId"),
      );
      return;
    }

    const sessionId = entry.sessionId;

    // Abort any active run before compacting
    if (isEmbeddedPiRunActive(sessionId)) {
      abortEmbeddedPiRun(sessionId);
      await waitForEmbeddedPiRunEnd(sessionId, 15_000);
    }

    // Resolve the SESSION's agent, not the default agent: a session key like
    // `agent:argent:main` belongs to agent "argent" — falling back to the
    // default (or worse, the literal DEFAULT_AGENT_ID "main") reads the wrong
    // agent's auth profiles and workspace.
    const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const agentDir = resolveAgentDir(cfg, agentId);

    // Resolve model/provider from session or config defaults
    const resolved = resolveSessionModelRef(cfg, entry, agentId);
    const provider = resolved.provider || DEFAULT_PROVIDER;
    const model = resolved.model || DEFAULT_MODEL;

    const result = await compactEmbeddedPiSession({
      sessionId,
      sessionKey,
      messageChannel: "internal",
      groupId: entry.groupId,
      groupChannel: entry.groupChannel,
      groupSpace: entry.space,
      spawnedBy: entry.spawnedBy,
      sessionFile: resolveSessionFilePath(sessionId, entry),
      workspaceDir,
      agentDir,
      config: cfg,
      skillsSnapshot: entry.skillsSnapshot,
      provider,
      model,
      thinkLevel: normalizeThinkLevel(entry.thinkingLevel),
      bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
      customInstructions,
      senderIsOwner: true,
      ownerNumbers: undefined,
    });

    respond(
      true,
      {
        ok: result.ok,
        compacted: result.compacted,
        reason: result.reason,
        tokensBefore: result.result?.tokensBefore,
        tokensAfter: result.result?.tokensAfter,
      },
      undefined,
    );
  },
};
