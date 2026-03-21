/**
 * AEVP Phase 3 — Tool Category Mapping
 *
 * Maps tool names from aevp_activity events to visual categories,
 * each driving a distinct particle behavior and element resonance target.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ToolCategory =
  | "search"
  | "memory"
  | "code"
  | "communicate"
  | "analyze"
  | "create"
  | "generic";

// ── Tool → Category Mapping ──────────────────────────────────────────────────

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // Search & Discovery
  web_search: "search",
  web_fetch: "search",
  browser: "search",
  argent_search: "search",
  sessions_search: "search",
  doc_panel_search: "search",
  os_docs: "search",
  skills_list: "search",

  // Memory & Knowledge
  memory_search: "memory",
  memory_get: "memory",
  memory_recall: "memory",
  memory_store: "memory",
  memory_categories: "memory",
  memory_forget: "memory",
  memory_entity: "memory",
  memory_reflect: "memory",
  memory_graph: "memory",
  memory_timeline: "memory",

  // Code & File Editing
  read: "code",
  write: "code",
  edit_line_range: "code",
  edit_regex: "code",
  file_edit: "code",
  terminal: "code",
  exec: "code",
  process: "code",
  plugin_builder: "code",
  github_issue: "code",
  apply_patch: "code",
  argent_config: "code",
  service_keys: "code",
  gateway: "code",

  // Communication
  message: "communicate",
  sessions_send: "communicate",
  send_payload: "communicate",
  tts: "communicate",
  tts_generate: "communicate",
  audio_generate: "communicate",
  audio_alert: "communicate",
  discord_manage: "communicate",
  vip_email: "communicate",

  // Analysis & Planning
  tasks: "analyze",
  onboarding_pack: "analyze",
  contemplation_history: "analyze",
  accountability_history: "analyze",
  canvas: "analyze",
  doc_panel: "analyze",
  doc_panel_get: "analyze",
  doc_panel_list: "analyze",
  doc_panel_update: "analyze",
  doc_panel_delete: "analyze",
  cron: "analyze",
  nodes: "analyze",
  apps: "analyze",
  agents_list: "analyze",
  sessions_list: "analyze",
  sessions_history: "analyze",
  session_status: "analyze",
  team_status: "analyze",

  // Creative Generation
  image: "create",
  image_generate: "create",
  video_generate: "create",
  widgets: "create",
  widget_builder: "create",
  sessions_spawn: "create",
  team_spawn: "create",
};

/**
 * Classify a tool name into a visual category.
 * Handles prefix matching for tool families (e.g., memory_*).
 */
export function classifyTool(toolName?: string): ToolCategory {
  if (!toolName) return "generic";

  const lower = toolName.toLowerCase().trim();

  // Exact match
  const exact = TOOL_CATEGORIES[lower];
  if (exact) return exact;

  // Prefix matching for tool families
  if (lower.startsWith("memory_")) return "memory";
  if (lower.startsWith("doc_panel")) return "analyze";
  if (lower.startsWith("tts")) return "communicate";
  if (lower.startsWith("audio_")) return "communicate";
  if (lower.startsWith("image")) return "create";
  if (lower.startsWith("session")) return "analyze";
  if (lower.startsWith("edit_")) return "code";

  return "generic";
}

// ── Resonance Targets ────────────────────────────────────────────────────────
// CSS selectors for dashboard elements that should glow when a category is active.

const RESONANCE_TARGETS: Record<ToolCategory, string[]> = {
  search: ["[data-panel='browser']", "[data-panel='search']", "[data-panel='web']"],
  memory: ["[data-panel='memory']", "[data-panel='knowledge']", "[data-panel='recall']"],
  code: ["[data-panel='terminal']", "[data-panel='editor']", "[data-panel='code']"],
  communicate: ["[data-panel='chat']", "[data-panel='messages']", "[data-panel='voice']"],
  analyze: ["[data-panel='tasks']", "[data-panel='canvas']", "[data-panel='docs']"],
  create: ["[data-panel='canvas']", "[data-panel='media']", "[data-panel='widgets']"],
  generic: [],
};

/**
 * Get CSS selectors for dashboard elements that should resonate
 * when a given tool category is active.
 */
export function getResonanceTargets(category: ToolCategory): string[] {
  return RESONANCE_TARGETS[category];
}
