/**
 * Tool Search Registry — indexes deferred tools for on-demand discovery.
 *
 * Part of Project Tony Stark (latency reduction). Instead of sending 30-50 tool
 * schemas (6K-15K tokens) to the LLM on every call, we split tools into:
 *
 *   - **Core** (~12 tools, ~3K tokens): always sent
 *   - **Deferred** (~70+ tools): only sent after the agent discovers them via `tool_search`
 *
 * The registry indexes deferred tools by name, description, and keywords for
 * fast keyword-based search. Discovered tool names are tracked per session.
 */

import type { AnyAgentTool } from "./tools/common.js";

export type ToolGroup = "core" | "deferred";

export type ToolGroupEntry = {
  tool: AnyAgentTool;
  group: ToolGroup;
  keywords?: string[];
};

/**
 * Background subsystem identifiers — detected from sessionKey patterns.
 * Each gets a minimal core tool set to further reduce token overhead.
 */
export type BackgroundSubsystem = "heartbeat" | "sis" | "contemplation" | "execution-worker";

/**
 * Subsystem-specific core tool sets.
 * These are much smaller than the generic CORE_TOOL_NAMES (~20 tools).
 * Background loops only need 4-8 tools for their specific purpose.
 */
export const SUBSYSTEM_CORE_TOOLS: Record<BackgroundSubsystem, Set<string>> = {
  heartbeat: new Set([
    "memory_recall",
    "memory_store",
    "tasks",
    "session_status",
    "accountability",
    "message",
  ]),
  sis: new Set(["memory_recall", "memory_store", "session_status"]),
  contemplation: new Set(["memory_recall", "memory_store", "tasks", "session_status"]),
  "execution-worker": new Set([
    "memory_recall",
    "memory_store",
    "tasks",
    "session_status",
    "read",
    "write",
    "edit",
    "exec",
    "process",
    "apply_patch",
    "web_search",
    "web_fetch",
  ]),
};

/**
 * Detect background subsystem from session key patterns.
 * Returns undefined for interactive (non-background) sessions.
 */
export function detectSubsystem(sessionKey?: string): BackgroundSubsystem | undefined {
  if (!sessionKey) {
    return undefined;
  }
  const lower = sessionKey.toLowerCase();
  if (lower.includes(":contemplation")) {
    return "contemplation";
  }
  if (lower.includes(":sis")) {
    return "sis";
  }
  if (lower.includes(":execution-worker") || lower.includes(":exec-worker")) {
    return "execution-worker";
  }
  // Heartbeat is harder — it uses the main session key.
  // Detected via the isHeartbeat flag, not session key.
  return undefined;
}

/**
 * Core tools — always sent to the LLM on every call.
 * These are the tools used in virtually every interaction.
 */
export const CORE_TOOL_NAMES = new Set([
  // Memory
  "memory_recall",
  "memory_store",
  // Tasks
  "tasks",
  // Communication
  "message",
  // Web
  "web_search",
  "web_fetch",
  // Documents
  "doc_panel",
  // Discovery
  "tool_search",
  "marketplace",
  // Self-awareness
  "session_status",
  "agents_list",
  // Skills & docs
  "skills",
  "os_docs",
  // Coding tools (from pi-tools base, always included)
  "read",
  "write",
  "edit",
  "exec",
  "process",
  "apply_patch",
]);

/** Extra keywords for deferred tool search beyond name+description. */
const DEFERRED_TOOL_KEYWORDS: Record<string, string[]> = {
  // Memory extended
  memory_categories: ["memory", "category", "categories", "organize"],
  memory_category_cleanup: ["memory", "category", "cleanup", "dedupe", "merge", "empty"],
  memory_category_merge: ["memory", "category", "merge", "dedupe", "cleanup"],
  memory_category_rename: ["memory", "category", "rename", "clean"],
  memory_forget: ["memory", "forget", "delete", "remove"],
  memory_entity: ["memory", "entity", "person", "contact", "identity"],
  memory_reflect: ["memory", "reflect", "reflection", "introspect"],
  memory_timeline: ["memory", "timeline", "history", "chronology"],
  memory_graph: ["memory", "graph", "connections", "relationships"],
  // Doc panel extended
  doc_panel_update: ["document", "update", "edit", "modify"],
  doc_panel_delete: ["document", "delete", "remove"],
  doc_panel_list: ["document", "list", "browse"],
  doc_panel_search: ["document", "search", "find"],
  doc_panel_get: ["document", "get", "read", "view"],
  // Sessions
  sessions_list: ["session", "conversation", "list"],
  sessions_history: ["session", "history", "transcript"],
  sessions_send: ["session", "send", "reply"],
  sessions_spawn: ["session", "spawn", "create", "new"],
  sessions_search: ["session", "search", "find"],
  // Teams
  team_spawn: ["team", "spawn", "delegate", "create"],
  team_status: ["team", "status", "progress"],
  // Media
  image_generation: ["image", "generate", "picture", "create"],
  video_generation: ["video", "generate", "create"],
  audio_generation: ["audio", "generate", "sound", "create"],
  music_generation: ["music", "generate", "song", "create"],
  tts: ["tts", "speech", "voice", "speak", "text-to-speech"],
  tts_generate: ["tts", "speech", "voice", "generate", "audio"],
  audio_alert: ["audio", "alert", "notification", "sound"],
  heygen_video: ["heygen", "avatar", "video", "ai"],
  podcast_plan: ["podcast", "plan", "outline"],
  podcast_generate: ["podcast", "generate", "create"],
  podcast_publish_pipeline: ["podcast", "publish", "pipeline"],
  // Deployment
  coolify_deploy: ["deploy", "coolify", "hosting", "server"],
  railway_deploy: ["deploy", "railway", "hosting", "cloud"],
  vercel_deploy: ["deploy", "vercel", "hosting", "serverless"],
  // DNS & Email
  namecheap_dns: ["dns", "domain", "nameserver", "namecheap"],
  easydmarc: ["dmarc", "email", "dns", "deliverability"],
  email_delivery: ["email", "send", "deliver"],
  vip_email: ["email", "vip", "priority", "important"],
  // Channels
  discord: ["discord", "server", "channel", "bot"],
  twilio_comm: ["twilio", "sms", "call", "phone"],
  slack_signal_monitor: ["slack", "signal", "monitor"],
  // DevOps
  browser: ["browser", "web", "navigate", "scrape"],
  terminal: ["terminal", "shell", "command"],
  github_issue: ["github", "issue", "bug", "pr"],
  gateway: ["gateway", "server", "restart", "status"],
  argent_config: ["config", "settings", "configuration"],
  service_keys: ["keys", "secrets", "credentials", "api"],
  // Knowledge
  knowledge_search: ["knowledge", "library", "rag", "search"],
  knowledge_collections_list: ["knowledge", "collection", "library", "list"],
  // Projects
  specforge: ["specforge", "project", "intake", "workflow"],
  jobs: ["job", "queue", "orchestrator"],
  workforce_setup: ["workforce", "team", "setup", "agents"],
  accountability: ["accountability", "heartbeat", "checklist"],
  scheduled_tasks: [
    "schedule",
    "scheduled",
    "workflow",
    "recurring",
    "brief",
    "report",
    "check-in",
    "morning brief",
  ],
  // Canvas & Nodes
  canvas: ["canvas", "device", "screen"],
  nodes: ["node", "device", "remote"],
  // Family
  family: ["family", "agent", "register", "shared"],
  // YouTube
  youtube_metadata: ["youtube", "video", "metadata"],
  youtube_notebooklm: ["youtube", "notebook", "summary"],
  youtube_thumbnail: ["youtube", "thumbnail", "image"],
  // File editing
  edit_line_range: ["edit", "file", "line", "range"],
  edit_regex: ["edit", "file", "regex", "replace"],
  // Misc
  cron: ["cron", "wake", "timer", "reminder"],
  apps: ["app", "build", "forge", "create"],
  marketplace: ["marketplace", "extension", "plugin"],
  plugin_builder: ["plugin", "build", "create"],
  widget_builder: ["widget", "build", "create"],
  onboarding_pack: ["onboarding", "setup", "welcome"],
  contemplation: ["contemplation", "thinking", "reflection"],
  visual_presence: ["visual", "presence", "avatar", "aevp"],
  meeting_recorder: ["meeting", "record", "transcribe", "capture"],
  search: ["search", "find", "query"],
  send_payload: ["send", "payload", "raw"],
  image: ["image", "view", "display", "screenshot"],
  intent: ["intent", "policy", "constraint"],
  copilot_system: ["copilot", "system", "assistant"],
};

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export class ToolSearchRegistry {
  private entries: ToolGroupEntry[] = [];

  register(tool: AnyAgentTool, group: ToolGroup, keywords?: string[]): void {
    this.entries.push({ tool, group, keywords });
  }

  registerAll(tools: AnyAgentTool[]): void {
    for (const tool of tools) {
      const name = normalize(tool.name);
      const group: ToolGroup = CORE_TOOL_NAMES.has(name) ? "core" : "deferred";
      const keywords = DEFERRED_TOOL_KEYWORDS[name];
      this.register(tool, group, keywords);
    }
  }

  getCoreTools(): AnyAgentTool[] {
    return this.entries.filter((e) => e.group === "core").map((e) => e.tool);
  }

  getDeferredTools(): AnyAgentTool[] {
    return this.entries.filter((e) => e.group === "deferred").map((e) => e.tool);
  }

  getAllTools(): AnyAgentTool[] {
    return this.entries.map((e) => e.tool);
  }

  /**
   * Resolve tools for a given set of discovered tool names.
   * Returns core tools + any deferred tools whose name is in the discovered set.
   */
  resolveToolsForSession(discoveredNames: Set<string>): AnyAgentTool[] {
    return this.entries
      .filter((e) => e.group === "core" || discoveredNames.has(normalize(e.tool.name)))
      .map((e) => e.tool);
  }

  /**
   * Search deferred tools by keyword query. Returns matches ranked by relevance.
   */
  search(query: string, limit = 5): Array<{ tool: AnyAgentTool; score: number }> {
    const terms = query
      .split(/\s+/g)
      .map(normalize)
      .filter((t) => t.length > 0);
    if (terms.length === 0) {
      return [];
    }

    const scored = this.entries
      .filter((e) => e.group === "deferred")
      .map((entry) => ({
        tool: entry.tool,
        score: this.scoreMatch(entry, terms),
      }))
      .filter((e) => e.score > 0)
      .toSorted((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));

    return scored.slice(0, limit);
  }

  private scoreMatch(entry: ToolGroupEntry, terms: string[]): number {
    const name = normalize(entry.tool.name);
    const desc = normalize(entry.tool.description ?? "");
    const label = normalize((entry.tool as { label?: string }).label ?? "");
    const kwSet = new Set((entry.keywords ?? []).map(normalize));
    let score = 0;

    for (const term of terms) {
      if (name === term) {
        score += 10;
      } else if (name.includes(term)) {
        score += 6;
      }
      if (label.includes(term)) {
        score += 4;
      }
      if (desc.includes(term)) {
        score += 2;
      }
      if (kwSet.has(term)) {
        score += 5;
      }
    }
    return score;
  }

  get size(): number {
    return this.entries.length;
  }

  get coreCount(): number {
    return this.entries.filter((e) => e.group === "core").length;
  }

  get deferredCount(): number {
    return this.entries.filter((e) => e.group === "deferred").length;
  }
}
