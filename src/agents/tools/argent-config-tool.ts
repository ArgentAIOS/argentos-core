/**
 * Argent Config Introspection Tool
 *
 * Lets the agent inspect its own configuration safely.
 * Never exposes API keys, tokens, or secrets.
 */

import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/types.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

type ConfigSection = "all" | "models" | "auth" | "agents" | "channels" | "memory";

const VALID_SECTIONS: ConfigSection[] = ["all", "models", "auth", "agents", "channels", "memory"];

// ============================================================================
// Schema
// ============================================================================

const ArgentConfigToolSchema = Type.Object({
  section: Type.Optional(
    Type.Union([
      Type.Literal("all"),
      Type.Literal("models"),
      Type.Literal("auth"),
      Type.Literal("agents"),
      Type.Literal("channels"),
      Type.Literal("memory"),
    ]),
  ),
});

// ============================================================================
// Safe extractors — strip all secrets
// ============================================================================

function extractModels(config: ArgentConfig) {
  const providers = config.models?.providers;
  if (!providers) return { mode: config.models?.mode ?? "merge", providers: {} };
  const safe: Record<string, { baseUrl: string; api?: string; models: string[] }> = {};
  for (const [id, provider] of Object.entries(providers)) {
    safe[id] = {
      baseUrl: provider.baseUrl,
      api: provider.api,
      models: provider.models.map((m) => m.name || m.id),
    };
  }
  return { mode: config.models?.mode ?? "merge", providers: safe };
}

function extractAuth(config: ArgentConfig) {
  const profiles = config.auth?.profiles;
  if (!profiles) return { profiles: {}, order: config.auth?.order ?? {} };
  const safe: Record<string, { provider: string; mode: string; email?: string }> = {};
  for (const [id, profile] of Object.entries(profiles)) {
    safe[id] = {
      provider: profile.provider,
      mode: profile.mode,
      email: profile.email,
    };
  }
  return {
    profiles: safe,
    order: config.auth?.order ?? {},
    cooldowns: config.auth?.cooldowns,
  };
}

function extractAgents(config: ArgentConfig) {
  const list = config.agents?.list;
  if (!list) return { defaults: {}, agents: [] };
  const safe = list.map((agent) => ({
    id: agent.id,
    name: agent.name,
    workspace: agent.workspace,
    default: agent.default,
    model: agent.model,
    skills: agent.skills,
    identity: agent.identity,
  }));
  return {
    defaults: config.agents?.defaults
      ? {
          heartbeat: config.agents.defaults.heartbeat,
          modelRouter: config.agents.defaults.modelRouter,
        }
      : {},
    agents: safe,
  };
}

function extractChannels(config: ArgentConfig) {
  const channels = config.channels;
  if (!channels) return {};
  const configured: string[] = [];
  for (const key of Object.keys(channels)) {
    if (key === "defaults") continue;
    const val = channels[key];
    if (val && typeof val === "object") {
      configured.push(key);
    }
  }
  return {
    defaults: channels.defaults,
    configured,
  };
}

function extractMemory(config: ArgentConfig) {
  return {
    backend: config.memory?.backend ?? "builtin",
    citations: config.memory?.citations,
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

export function createArgentConfigTool(options: { config?: ArgentConfig } = {}): AnyAgentTool {
  return {
    label: "ArgentConfig",
    name: "argent_config",
    description: `Inspect the current ArgentOS configuration safely (no secrets exposed).

SECTIONS:
- all: Overview of all configuration sections
- models: Model providers and available models
- auth: Auth profile IDs and rotation order (no keys)
- agents: Agent IDs, names, workspaces, model assignments
- channels: Which channels are configured
- memory: Memory backend and settings`,
    parameters: ArgentConfigToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const sectionRaw = readStringParam(params, "section") || "all";
      const section = VALID_SECTIONS.includes(sectionRaw as ConfigSection)
        ? (sectionRaw as ConfigSection)
        : "all";

      let config = options.config;
      if (!config) {
        const { loadConfig } = await import("../../config/config.js");
        config = loadConfig();
      }

      const extractors: Record<ConfigSection, () => unknown> = {
        models: () => extractModels(config),
        auth: () => extractAuth(config),
        agents: () => extractAgents(config),
        channels: () => extractChannels(config),
        memory: () => extractMemory(config),
        all: () => ({
          models: extractModels(config),
          auth: extractAuth(config),
          agents: extractAgents(config),
          channels: extractChannels(config),
          memory: extractMemory(config),
          gateway: config.gateway
            ? { port: config.gateway.port, bind: config.gateway.bind, mode: config.gateway.mode }
            : undefined,
        }),
      };

      return jsonResult(extractors[section]());
    },
  };
}
