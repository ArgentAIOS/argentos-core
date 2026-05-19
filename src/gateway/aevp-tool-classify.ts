/**
 * AEVP Phase 3 — Backend Tool Activity Classification
 *
 * Classifies tool invocations into visual categories using both the tool name
 * AND its arguments (file paths, commands, etc.) for context-aware categorization.
 *
 * Categories: search | memory | code | communicate | analyze | create | generic
 */

export type AEVPToolCategory =
  | "search"
  | "memory"
  | "code"
  | "communicate"
  | "analyze"
  | "create"
  | "generic";

// ── File Extension → Category ────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".swift",
  ".kt",
  ".cs",
  ".php",
  ".lua",
  ".zig",
  ".asm",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".graphql",
  ".gql",
  ".css",
  ".scss",
  ".less",
  ".sass",
  ".html",
  ".htm",
  ".vue",
  ".svelte",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".env",
  ".dockerfile",
  ".tf",
  ".hcl",
  ".vert",
  ".frag",
  ".glsl",
  ".wgsl",
]);

const DOC_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".adoc",
  ".org",
  ".pdf",
  ".doc",
  ".docx",
]);

const MEDIA_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".mp3",
  ".wav",
  ".ogg",
  ".mp4",
  ".webm",
  ".mov",
  ".xlsx",
  ".xls",
  ".csv",
  ".pptx",
]);

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return "";
  return filePath.slice(dot).toLowerCase();
}

function classifyByPath(filePath: string): AEVPToolCategory | null {
  const ext = getExtension(filePath);
  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (DOC_EXTENSIONS.has(ext)) return "create";
  if (MEDIA_EXTENSIONS.has(ext)) return "create";
  // Path-based heuristics
  const lower = filePath.toLowerCase();
  if (lower.includes("/src/") || lower.includes("/lib/") || lower.includes("/test")) return "code";
  if (lower.includes("/docs/") || lower.includes("/doc/")) return "create";
  return null;
}

// ── Command → Category ──────────────────────────────────────────────────────

const CODE_COMMANDS = [
  /^(npm|pnpm|yarn|bun|deno|cargo|go|make|cmake|gradle|mvn)\b/,
  /^(node|python|ruby|php|java|rustc|gcc|g\+\+|clang)\b/,
  /^(tsc|eslint|prettier|vitest|jest|pytest|mocha)\b/,
  /^(git|gh)\b/,
  /^(docker|kubectl|terraform)\b/,
  /^(mkdir|cp|mv|chmod|chown|ln)\b/,
];

const SEARCH_COMMANDS = [
  /^(curl|wget|http|fetch)\b/,
  /^(ping|dig|nslookup|traceroute|whois)\b/,
  /^(grep|rg|find|fd|ag)\b/,
];

const ANALYZE_COMMANDS = [
  /^(ls|cat|head|tail|wc|du|df|top|htop|ps|stat)\b/,
  /^(jq|yq|awk|sed|sort|uniq|cut)\b/,
];

function classifyByCommand(command: string): AEVPToolCategory | null {
  const trimmed = command.trim();
  for (const re of SEARCH_COMMANDS) {
    if (re.test(trimmed)) return "search";
  }
  for (const CODE_COMMAND of CODE_COMMANDS) {
    if (CODE_COMMAND.test(trimmed)) return "code";
  }
  for (const re of ANALYZE_COMMANDS) {
    if (re.test(trimmed)) return "analyze";
  }
  return null;
}

// ── Unambiguous Tool Name → Category ─────────────────────────────────────────
// Tools that are ALWAYS one category regardless of arguments.

const FIXED_CATEGORIES: Record<string, AEVPToolCategory> = {
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
  memory_category_cleanup: "memory",
  memory_category_merge: "memory",
  memory_category_rename: "memory",
  memory_forget: "memory",
  memory_entity: "memory",
  memory_reflect: "memory",
  memory_graph: "memory",
  memory_timeline: "memory",

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

  // Unambiguous Code
  edit_line_range: "code",
  edit_regex: "code",
  file_edit: "code",
  terminal: "code",
  plugin_builder: "code",
  github_issue: "code",
  apply_patch: "code",
  argent_config: "code",
  service_keys: "code",
  gateway: "code",
};

// ── Main Classifier ──────────────────────────────────────────────────────────

/**
 * Classify a tool invocation using name + args for context-aware categorization.
 *
 * Priority: fixed category (unambiguous tools) → arg-based heuristic → generic fallback.
 */
export function classifyToolActivity(
  toolName: string,
  args?: Record<string, unknown>,
): AEVPToolCategory {
  const lower = toolName.toLowerCase().trim();

  // 1. Unambiguous tools — always the same category
  const fixed = FIXED_CATEGORIES[lower];
  if (fixed) return fixed;

  // Prefix matching for tool families
  if (lower.startsWith("memory_")) return "memory";
  if (lower.startsWith("doc_panel")) return "analyze";
  if (lower.startsWith("tts")) return "communicate";
  if (lower.startsWith("audio_")) return "communicate";
  if (lower.startsWith("image")) return "create";
  if (lower.startsWith("edit_")) return "code";

  // 2. Context-aware tools — classify by arguments
  if (args) {
    // read/write: classify by file path
    if (lower === "read" || lower === "write") {
      const filePath =
        typeof args.path === "string"
          ? args.path
          : typeof args.file === "string"
            ? args.file
            : typeof args.file_path === "string"
              ? args.file_path
              : null;
      if (filePath) {
        const pathCategory = classifyByPath(filePath);
        if (pathCategory) return pathCategory;
      }
      // No recognizable path — default read to analyze, write to create
      return lower === "read" ? "analyze" : "create";
    }

    // exec/process: classify by command
    if (lower === "exec" || lower === "process") {
      const command =
        typeof args.command === "string"
          ? args.command
          : typeof args.cmd === "string"
            ? args.cmd
            : typeof args.script === "string"
              ? args.script
              : null;
      if (command) {
        const cmdCategory = classifyByCommand(command);
        if (cmdCategory) return cmdCategory;
      }
      return "code"; // exec without recognizable command is probably code
    }

    // sessions_spawn / team_spawn — could be communicate or create
    if (lower === "sessions_spawn" || lower === "team_spawn") return "create";
  }

  return "generic";
}
