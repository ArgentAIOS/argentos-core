import type { ArgentConfig } from "../config/config.js";
import { normalizeToolList, normalizeToolName } from "./tool-policy.js";

export const PUBLIC_CORE_DEFAULT_TOOL_NAMES = [
  "agents_list",
  "apps",
  "argent_search",
  "browser",
  "canvas",
  "channel_config",
  "changelog",
  "connector_setup",
  "cron",
  "doc_panel",
  "doc_panel_delete",
  "doc_panel_get",
  "doc_panel_list",
  "doc_panel_search",
  "doc_panel_update",
  "edit_line_range",
  "edit_regex",
  "gateway",
  "knowledge_collections_list",
  "knowledge_search",
  "marketplace",
  "memory_categories",
  "memory_category_cleanup",
  "memory_category_merge",
  "memory_category_rename",
  "memory_entity",
  "memory_forget",
  "memory_graph",
  "memory_recall",
  "memory_reflect",
  "memory_store",
  "memory_timeline",
  "message",
  "nodes",
  "personal_skill",
  "session_status",
  "sessions_history",
  "sessions_list",
  "sessions_search",
  "sessions_send",
  "sessions_spawn",
  "specforge",
  "tasks",
  "terminal",
  "tool_search",
  "tts",
  "visual_presence",
  "web_fetch",
  "web_search",
] as const;

export const PUBLIC_CORE_POWER_USER_TOOL_NAMES = [
  "accountability_history",
  "audio_generate",
  "contemplation_history",
  "family",
  "github_issue",
  "image",
  "image_generate",
  "meeting_record",
  "music_generate",
  "os_docs",
  "plugin_builder",
  "skills_list",
  "tts_generate",
  "video_generate",
  "widgets",
  "youtube_metadata_generate",
  "youtube_notebooklm",
  "youtube_thumbnail_generate",
] as const;

export const PUBLIC_CORE_HOLD_TOOL_NAMES = [
  "audio_alert",
  "coolify_deploy",
  "discord_manage",
  "easydmarc",
  "email_delivery",
  "heygen_video",
  "namecheap_dns",
  "podcast_generate",
  "podcast_plan",
  "podcast_publish_pipeline",
  "railway_deploy",
  "send_payload",
  "service_keys",
  "slack_signal_monitor",
  "team_spawn",
  "team_status",
  "twilio_comm",
  "vercel_deploy",
  "vip_email",
] as const;

export const PUBLIC_CORE_BUSINESS_BLOCKED_TOOL_NAMES = [
  "copilot_system_tool",
  "intent_tool",
  "jobs_tool",
  "onboarding_pack",
  "workforce_setup_tool",
] as const;

export type ProductSurfaceProfile = "full" | "public-core";

export type PublicCorePluginRuntimeGate = {
  allowPlugins: Set<string>;
  denyPlugins: Set<string>;
  denyTools: Set<string>;
};

export function resolveProductSurfaceProfile(config?: ArgentConfig): ProductSurfaceProfile {
  return config?.distribution?.surfaceProfile === "public-core" ? "public-core" : "full";
}

function normalizeNameSet(list?: string[]): Set<string> {
  return new Set((list ?? []).map(normalizeToolName).filter(Boolean));
}

export function resolvePublicCorePluginRuntimeGate(
  config?: ArgentConfig,
): PublicCorePluginRuntimeGate | null {
  if (resolveProductSurfaceProfile(config) !== "public-core") {
    return null;
  }
  const publicCore = config?.distribution?.publicCore;
  return {
    allowPlugins: normalizeNameSet(publicCore?.allowPlugins),
    denyPlugins: normalizeNameSet(publicCore?.denyPlugins),
    denyTools: normalizeNameSet(publicCore?.denyTools),
  };
}

export function isPublicCorePluginAllowed(
  pluginId: string | null | undefined,
  gate: PublicCorePluginRuntimeGate | null,
): boolean {
  if (!gate) {
    return true;
  }
  const normalized = typeof pluginId === "string" ? normalizeToolName(pluginId) : "";
  if (!normalized) {
    return false;
  }
  if (gate.denyPlugins.has(normalized)) {
    return false;
  }
  return gate.allowPlugins.has(normalized);
}

export function isPublicCorePluginToolAllowed(
  toolName: string | null | undefined,
  gate: PublicCorePluginRuntimeGate | null,
): boolean {
  if (!gate) {
    return true;
  }
  const normalized = typeof toolName === "string" ? normalizeToolName(toolName) : "";
  if (!normalized) {
    return false;
  }
  return !gate.denyTools.has(normalized);
}

export function filterPublicCorePluginTools<T>(params: {
  tools: T[];
  gate: PublicCorePluginRuntimeGate | null;
  getPluginId: (tool: T) => string | null | undefined;
  getToolName: (tool: T) => string | null | undefined;
}): T[] {
  const { gate } = params;
  if (!gate) {
    return params.tools;
  }
  return params.tools.filter((tool) => {
    const pluginId = params.getPluginId(tool);
    if (!isPublicCorePluginAllowed(pluginId, gate)) {
      return false;
    }
    return isPublicCorePluginToolAllowed(params.getToolName(tool), gate);
  });
}

export function resolveBuiltinToolAllowlist(params?: {
  config?: ArgentConfig;
  explicitAllowlist?: string[];
}): Set<string> | null {
  const explicit = normalizeToolList(params?.explicitAllowlist);
  if (explicit.length > 0) {
    return new Set(explicit);
  }

  const config = params?.config;
  if (resolveProductSurfaceProfile(config) !== "public-core") {
    return null;
  }

  const allow = new Set<string>(PUBLIC_CORE_DEFAULT_TOOL_NAMES);
  for (const toolName of PUBLIC_CORE_POWER_USER_TOOL_NAMES) {
    allow.add(toolName);
  }
  for (const toolName of PUBLIC_CORE_HOLD_TOOL_NAMES) {
    allow.add(toolName);
  }
  const publicCore = config?.distribution?.publicCore;
  const businessBlocked = new Set<string>(PUBLIC_CORE_BUSINESS_BLOCKED_TOOL_NAMES);
  for (const toolName of businessBlocked) {
    allow.delete(toolName);
  }
  for (const toolName of publicCore?.alsoAllowTools ?? []) {
    const normalized = normalizeToolName(toolName);
    if (normalized && !businessBlocked.has(normalized)) {
      allow.add(normalized);
    }
  }
  for (const toolName of publicCore?.denyTools ?? []) {
    const normalized = normalizeToolName(toolName);
    if (normalized) {
      allow.delete(normalized);
    }
  }
  return allow;
}
