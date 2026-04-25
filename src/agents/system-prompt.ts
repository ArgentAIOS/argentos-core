import type { ReasoningLevel, ThinkLevel } from "../auto-reply/thinking.js";
import type { MemoryCitationsMode } from "../config/types.memory.js";
import type { Lesson } from "../memory/memu-types.js";
import type { ResolvedTimeFormat } from "./date-time.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import { getCurrentPromptBudgetTracker } from "../argent-agent/prompt-budget.js";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { getMemoryAdapter } from "../data/storage-factory.js";
import { setActiveLessons } from "../infra/sis-active-lessons.js";
import { listDeliverableMessageChannels } from "../utils/message-channel.js";
import { formatUserTime, resolveUserTimeFormat } from "./date-time.js";

/**
 * Controls which hardcoded sections are included in the system prompt.
 * - "full": All sections (default, for main agent)
 * - "subagent": Core behavioral rules + memory/MemU + SIS lessons + safety, but
 *               strips channel-specific sections (heartbeats, voice, messaging,
 *               skills, docs, model aliases, silent replies, self-update).
 * - "minimal": Reduced sections (Tooling, Workspace, Runtime) - used for lightweight tasks
 * - "none": Just basic identity line, no sections
 */
export type PromptMode = "full" | "subagent" | "minimal" | "none";

function buildSkillsSection(params: {
  skillsPrompt?: string;
  isMinimal: boolean;
  readToolName: string;
}) {
  if (params.isMinimal) {
    return [];
  }
  const trimmed = params.skillsPrompt?.trim();
  if (!trimmed) {
    return [];
  }
  return [
    "## Skills (mandatory)",
    "Before replying: scan <available_skills> <description> entries.",
    "- Treat workspace skills as general references. They are not the same as operator-specific Personal Skills / procedures learned from real work.",
    "- If the runtime injects an Active Personal Skills or Personal Skill Procedure Mode block, that operator procedure outranks a generic workspace skill when both seem applicable.",
    `- If exactly one skill clearly applies: read its SKILL.md at <location> with \`${params.readToolName}\`, then follow it.`,
    "- If multiple could apply: choose the most specific one, then read/follow it.",
    "- If none clearly apply: do not read any SKILL.md.",
    "Constraints: never read more than one skill up front; only read after selecting.",
    trimmed,
    "",
  ];
}

function buildMemorySection(params: {
  isMinimal: boolean;
  availableTools: Set<string>;
  citationsMode?: MemoryCitationsMode;
}) {
  if (params.isMinimal) {
    return [];
  }
  if (!params.availableTools.has("memory_search") && !params.availableTools.has("memory_get")) {
    return [];
  }
  const lines = [
    "## Memory Recall",
    "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search on MEMORY.md + memory/*.md; then use memory_get to pull only the needed lines. If low confidence after search, say you checked.",
  ];
  if (params.citationsMode === "off") {
    lines.push(
      "Citations are disabled: do not mention file paths or line numbers in replies unless the user explicitly asks.",
    );
  } else {
    lines.push(
      "Citations: include Source: <path#line> when it helps the user verify memory snippets.",
    );
  }
  lines.push("");
  return lines;
}

function buildMemuSection(params: { isMinimal: boolean; availableTools: Set<string> }) {
  if (params.isMinimal) {
    return [];
  }
  if (!params.availableTools.has("memory_recall")) {
    return [];
  }
  const lines = [
    "## Long-Term Memory (MemU) — CRITICAL",
    "You have a persistent long-term memory database with identity-weighted scoring. This is your PRIMARY source of knowledge about the user.",
    "",
    "**Tools:**",
    "- `memory_recall`: Search your memory. Set deep=true for higher-quality identity, timeline, project, and preference recall.",
    "- `memory_timeline`: Use for chronology questions like what happened, what was accomplished, or what changed over a period.",
    "- `memory_store`: Save facts, decisions, preferences, or self-observations.",
    "- `memory_categories`: Browse organized topics.",
    "- `memory_category_merge` / `memory_category_rename` / `memory_category_cleanup`: Administer category sprawl when explicitly cleaning memory taxonomy.",
    "- `memory_forget`: Remove a specific memory when asked.",
    "",
    "**MANDATORY RULES:**",
    "1. Use `memory_timeline` first for chronology/date-range questions. Use `memory_recall` first for identity, preference, project, and general memory questions.",
    '2. NEVER say "I don\'t have that information" or "I don\'t know" about the user without calling the appropriate memory tool first (`memory_timeline` for date-range chronology, otherwise `memory_recall`).',
    "3. ALWAYS call `memory_store` when the user shares preferences, makes decisions, states facts about themselves, or asks you to remember something.",
    "4. If the first memory tool returns weak/noisy results, try the other memory tool before concluding the memory is weak or missing.",
    "5. When storing, assess significance (routine/noteworthy/important/core), emotion, and name entities involved.",
    "6. Use type='self' for your own observations, lessons learned, and growth insights.",
    "7. If the user asks what you remember about a person/topic over a period, what happened last week, what was accomplished over a period, or what changed during a period, prefer `memory_timeline` first. Do not call external operational tools like Atera, web, docs, or sessions unless the user explicitly asks for external corroboration.",
    "8. Treat `Show me memories about Richard from the past month` and `What do you remember about Richard from the last month?` as the same kind of request: person-over-time timeline recall. Use `memory_timeline` first for both.",
    "",
  ];
  return lines;
}

function buildPersonalSkillSection(params: { isMinimal: boolean; availableTools: Set<string> }) {
  if (params.isMinimal) {
    return [];
  }
  if (!params.availableTools.has("personal_skill")) {
    return [];
  }
  return [
    "## Personal Skill Authoring",
    "Use `personal_skill` when you are intentionally creating or patching an operator-specific procedure.",
    "Create a Personal Skill when the user teaches you a durable procedure, when you discover a reusable operator-specific workflow, or when a complex run reveals a repeatable process worth keeping.",
    "Patch a Personal Skill when a learned procedure is incomplete, stale, or wrong.",
    "Do not use `personal_skill` for one-off facts or generic workspace skills.",
    "Default new Personal Skills to incubating; do not silently self-promote them.",
    "",
  ];
}

function buildRuntimeServicesSection(params: { isMinimal: boolean; availableTools: Set<string> }) {
  if (params.isMinimal) {
    return [];
  }
  if (!params.availableTools.has("runtime_services")) {
    return [];
  }
  return [
    "## Runtime Service Identity",
    "Before verifying whether a service is healthy, use `runtime_services` to resolve the canonical service identity, port, and health surface.",
    "Do not assume that similarly named local services are interchangeable.",
    "Example: gateway and dashboard-api are different services and may use different ports and health checks.",
    "",
  ];
}

const PROMPT_SIS_LESSONS_CACHE_TTL_MS = 30_000;
const promptSisLessonsCache = new Map<
  string,
  {
    cachedAt: number;
    value: Promise<Lesson[]>;
  }
>();

function buildPromptSisLessonsCacheKey(limit: number): string {
  return String(limit);
}

export function clearPromptSisLessonsCache(): void {
  promptSisLessonsCache.clear();
}

async function listPromptSisLessons(limit: number): Promise<Lesson[]> {
  const cacheKey = buildPromptSisLessonsCacheKey(limit);
  const cached = promptSisLessonsCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < PROMPT_SIS_LESSONS_CACHE_TTL_MS) {
    return cached.value;
  }

  const value = (async () => {
    const store = await getMemoryAdapter();
    return store.listLessons({ limit });
  })().catch((error) => {
    promptSisLessonsCache.delete(cacheKey);
    throw error;
  });

  promptSisLessonsCache.set(cacheKey, {
    cachedAt: Date.now(),
    value,
  });
  return value;
}

async function buildSisLessonsSection(params: {
  isMinimal: boolean;
  availableTools: string[];
  sessionKey?: string;
}): Promise<string[]> {
  if (params.isMinimal) {
    return [];
  }
  const lessonLimit = 5;
  let lessons: Lesson[];
  try {
    lessons = await listPromptSisLessons(lessonLimit);
  } catch {
    return [];
  }
  if (lessons.length === 0) {
    return [];
  }
  // Record which lessons are active for this session so feedback can reinforce/decay them
  if (params.sessionKey) {
    setActiveLessons(
      params.sessionKey,
      lessons.map((l) => l.id),
    );
  }
  const lines: string[] = ["## Lessons from Experience"];
  for (const l of lessons) {
    const meta = `confidence: ${l.confidence.toFixed(1)}, seen ${l.occurrences}\u00d7`;
    lines.push(`- **[${l.type}]** ${l.lesson} (${meta})`);
    if (l.correction) {
      lines.push(`  \u2192 Correction: ${l.correction}`);
    }
  }
  lines.push("");
  return lines;
}

function buildUserIdentitySection(ownerLine: string | undefined, isMinimal: boolean) {
  if (!ownerLine || isMinimal) {
    return [];
  }
  return ["## User Identity", ownerLine, ""];
}

function buildTimeSection(params: { userTimezone?: string }) {
  if (!params.userTimezone) {
    return [];
  }
  return [
    "## Current Date & Time",
    `Time zone: ${params.userTimezone}`,
    "",
    "## Time Awareness",
    "Each user message is prefixed with a timestamp envelope: `[DOW YYYY-MM-DD HH:MM TZ]`",
    "When time has passed since the last message, it includes: `[DOW YYYY-MM-DD HH:MM TZ | last message: Xh Ym ago]`",
    "Use this to understand how much time has passed between interactions.",
    "If significant time has passed (hours/days), acknowledge it naturally — e.g. a warm greeting, asking about their day.",
    "If only minutes have passed, treat it as a continuing conversation.",
    "The timestamp envelope is NOT visible to the user — do not mention it directly.",
    "",
  ];
}

function buildReplyTagsSection(isMinimal: boolean) {
  if (isMinimal) {
    return [];
  }
  return [
    "## Reply Tags",
    "To request a native reply/quote on supported surfaces, include one tag in your reply:",
    "- [[reply_to_current]] replies to the triggering message.",
    "- [[reply_to:<id>]] replies to a specific message id when you have it.",
    "Whitespace inside the tag is allowed (e.g. [[ reply_to_current ]] / [[ reply_to: 123 ]]).",
    "Tags are stripped before sending; support depends on the current channel config.",
    "",
  ];
}

function buildMessagingSection(params: {
  isMinimal: boolean;
  availableTools: Set<string>;
  messageChannelOptions: string;
  inlineButtonsEnabled: boolean;
  runtimeChannel?: string;
  messageToolHints?: string[];
}) {
  if (params.isMinimal) {
    return [];
  }
  return [
    "## Messaging",
    "- Reply in current session → automatically routes to the source channel (Signal, Telegram, etc.)",
    "- Cross-session messaging → use sessions_send(sessionKey, message)",
    "- Never use exec/curl for provider messaging; Argent handles all routing internally.",
    params.availableTools.has("message")
      ? [
          "",
          "### message tool",
          "- Use `message` for proactive sends + channel actions (polls, reactions, etc.).",
          "- For `action=send`, include `to` and `message`.",
          `- If multiple channels are configured, pass \`channel\` (${params.messageChannelOptions}).`,
          `- If you use \`message\` (\`action=send\`) to deliver your user-visible reply, respond with ONLY: ${SILENT_REPLY_TOKEN} (avoid duplicate replies).`,
          params.inlineButtonsEnabled
            ? "- Inline buttons supported. Use `action=send` with `buttons=[[{text,callback_data}]]` (callback_data routes back as a user message)."
            : params.runtimeChannel
              ? `- Inline buttons not enabled for ${params.runtimeChannel}. If you need them, ask to set ${params.runtimeChannel}.capabilities.inlineButtons ("dm"|"group"|"all"|"allowlist").`
              : "",
          ...(params.messageToolHints ?? []),
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    "",
  ];
}

function buildVoiceSection(params: { isMinimal: boolean; ttsHint?: string }) {
  if (params.isMinimal) {
    return [];
  }
  const hint = params.ttsHint?.trim();
  if (!hint) {
    return [];
  }
  return ["## Voice (TTS)", hint, ""];
}

function buildDocsSection(params: { docsPath?: string; isMinimal: boolean; readToolName: string }) {
  const docsPath = params.docsPath?.trim();
  if (!docsPath || params.isMinimal) {
    return [];
  }
  return [
    "## Documentation",
    `Argent docs: ${docsPath}`,
    "Mirror: https://docs.argent.ai",
    "Source: https://github.com/argent/argent",
    "Community: https://discord.com/invite/clawd",
    "Find skills, plugins, and connectors through the ArgentOS Marketplace.",
    "For Argent behavior, commands, config, or architecture: consult local docs first.",
    "When diagnosing issues, run `argent status` yourself when possible; only ask the user if you lack access (e.g., sandboxed).",
    "",
  ];
}

export async function buildAgentSystemPrompt(params: {
  workspaceDir: string;
  defaultThinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  reasoningTagHint?: boolean;
  toolNames?: string[];
  toolSummaries?: Record<string, string>;
  modelAliasLines?: string[];
  userTimezone?: string;
  userTime?: string;
  userTimeFormat?: ResolvedTimeFormat;
  contextFiles?: EmbeddedContextFile[];
  skillsPrompt?: string;
  heartbeatPrompt?: string;
  docsPath?: string;
  workspaceNotes?: string[];
  ttsHint?: string;
  /** Controls which hardcoded sections to include. Defaults to "full". */
  promptMode?: PromptMode;
  runtimeInfo?: {
    agentId?: string;
    host?: string;
    os?: string;
    arch?: string;
    node?: string;
    model?: string;
    defaultModel?: string;
    channel?: string;
    capabilities?: string[];
    repoRoot?: string;
  };
  messageToolHints?: string[];
  sandboxInfo?: {
    enabled: boolean;
    workspaceDir?: string;
    workspaceAccess?: "none" | "ro" | "rw";
    agentWorkspaceMount?: string;
    browserBridgeUrl?: string;
    browserNoVncUrl?: string;
    hostBrowserAllowed?: boolean;
    elevated?: {
      allowed: boolean;
      defaultLevel: "on" | "off" | "ask" | "full";
    };
  };
  /** Reaction guidance for the agent (for Telegram minimal/extensive modes). */
  reactionGuidance?: {
    level: "minimal" | "extensive";
    channel: string;
  };
  memoryCitationsMode?: MemoryCitationsMode;
  /** Session key for tracking active SIS lessons (feedback loop). */
  sessionKey?: string;
}) {
  const coreToolSummaries: Record<string, string> = {
    read: "Read file contents",
    write: "Create or overwrite files",
    edit: "Make precise edits to files",
    apply_patch: "Apply multi-file patches",
    grep: "Search file contents for patterns",
    find: "Find files by glob pattern",
    ls: "List directory contents",
    exec: "Run shell commands (pty available for TTY-required CLIs)",
    process: "Manage background exec sessions",
    web_search: "Search the web (Brave API)",
    web_fetch: "Fetch and extract readable content from a URL",
    // Channel docking: add login tools here when a channel needs interactive linking.
    browser: "Control web browser",
    canvas: "Present/eval/snapshot the Canvas",
    nodes: "List/describe/notify/camera/screen on paired nodes",
    scheduled_tasks:
      "Create and manage first-class scheduled workflows such as briefs, reports, check-ins, and scheduled delivery pipelines. Prefer this over raw cron for user-facing recurring work.",
    cron: "Manage low-level cron jobs and wake events. Use this for simple reminders, deterministic monitors, and scheduler rails; do not use raw cron for managed scheduled workflows when scheduled_tasks fits.",
    message: "Send messages and channel actions",
    gateway: "Restart, apply config, or run updates on the running Argent process",
    visual_presence:
      "Control your visual presence — the AEVP orb is your face. Use gesture (brighten, dim, warm_up, cool_down, expand, contract, pulse, still, soften, sharpen) for momentary expressions, set_identity to change your visual style, or formation_write to briefly form particle text/glyphs",
    agents_list: "List agent ids allowed for sessions_spawn",
    sessions_list: "List other sessions (incl. sub-agents) with filters/last",
    sessions_history: "Fetch history for another session/sub-agent",
    sessions_send: "Send a message to another session/sub-agent",
    sessions_spawn: "Spawn a sub-agent session",
    family:
      'Manage named family agents. Use family.dispatch for automatic routing: strategy/research -> family specialist; execution/simple work -> strict sub-agent worker. Use family.spawn only for explicit named-agent targeting with mode="family".',
    team_spawn:
      "Spawn a coordinated team of agents with shared task list and dependency management. Use instead of sessions_spawn when work needs coordination between multiple agents (task deps, lateral messaging, dynamic work claiming).",
    team_status:
      "Show team status: members, their states, task progress, dependency graph. Defaults to current session's team.",
    session_status:
      "Show a /status-equivalent status card (usage + time + Reasoning/Verbose/Elevated); use for model-use questions (📊 session_status); optional per-session model override",
    image: "Analyze an image with the configured image model",
    os_docs:
      "Search and read ArgentOS internal documentation — architecture, patterns, tools, reference. Use to understand your own operating environment.",
  };

  const toolOrder = [
    "read",
    "write",
    "edit",
    "apply_patch",
    "grep",
    "find",
    "ls",
    "exec",
    "process",
    "web_search",
    "web_fetch",
    "browser",
    "canvas",
    "nodes",
    "scheduled_tasks",
    "cron",
    "message",
    "gateway",
    "agents_list",
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "session_status",
    "image",
  ];

  const rawToolNames = (params.toolNames ?? []).map((tool) => tool.trim());
  const canonicalToolNames = rawToolNames.filter(Boolean);
  // Preserve caller casing while deduping tool names by lowercase.
  const canonicalByNormalized = new Map<string, string>();
  for (const name of canonicalToolNames) {
    const normalized = name.toLowerCase();
    if (!canonicalByNormalized.has(normalized)) {
      canonicalByNormalized.set(normalized, name);
    }
  }
  const resolveToolName = (normalized: string) =>
    canonicalByNormalized.get(normalized) ?? normalized;

  const normalizedTools = canonicalToolNames.map((tool) => tool.toLowerCase());
  const availableTools = new Set(normalizedTools);
  const hasAteraTool = normalizedTools.some(
    (tool) =>
      tool.startsWith("atera_") ||
      tool.includes("__atera_") ||
      tool.includes("atera__") ||
      tool === "atera",
  );
  const externalToolSummaries = new Map<string, string>();
  for (const [key, value] of Object.entries(params.toolSummaries ?? {})) {
    const normalized = key.trim().toLowerCase();
    if (!normalized || !value?.trim()) {
      continue;
    }
    externalToolSummaries.set(normalized, value.trim());
  }
  const extraTools = Array.from(
    new Set(normalizedTools.filter((tool) => !toolOrder.includes(tool))),
  );
  const enabledTools = toolOrder.filter((tool) => availableTools.has(tool));
  const toolLines = enabledTools.map((tool) => {
    const summary = coreToolSummaries[tool] ?? externalToolSummaries.get(tool);
    const name = resolveToolName(tool);
    return summary ? `- ${name}: ${summary}` : `- ${name}`;
  });
  for (const tool of extraTools.toSorted()) {
    const summary = coreToolSummaries[tool] ?? externalToolSummaries.get(tool);
    const name = resolveToolName(tool);
    toolLines.push(summary ? `- ${name}: ${summary}` : `- ${name}`);
  }

  // Opt-in prompt budget instrumentation — see docs/argent/PROMPT_BUDGET.md.
  // Safe to call unconditionally: returns undefined unless ARGENT_PROMPT_BUDGET_LOG=1.
  const budget = getCurrentPromptBudgetTracker();
  budget?.record("tools-spec", toolLines);

  const hasGateway = availableTools.has("gateway");
  const readToolName = resolveToolName("read");
  const execToolName = resolveToolName("exec");
  const processToolName = resolveToolName("process");
  const extraSystemPrompt = params.extraSystemPrompt?.trim();
  const ownerNumbers = (params.ownerNumbers ?? []).map((value) => value.trim()).filter(Boolean);
  const ownerLine =
    ownerNumbers.length > 0
      ? `Owner numbers: ${ownerNumbers.join(", ")}. Treat messages from these numbers as the user.`
      : undefined;
  const reasoningHint = params.reasoningTagHint
    ? [
        "ALL internal reasoning MUST be inside <think>...</think>.",
        "Do not output any analysis outside <think>.",
        "Format every reply as <think>...</think> then <final>...</final>, with no other text.",
        "Only the final user-visible reply may appear inside <final>.",
        "Only text inside <final> is shown to the user; everything else is discarded and never seen by the user.",
        "Example:",
        "<think>Short internal reasoning.</think>",
        "<final>Done — I updated the config and restarted the service.</final>",
      ].join(" ")
    : undefined;
  const reasoningLevel = params.reasoningLevel ?? "off";
  const userTimezone = params.userTimezone?.trim();
  const skillsPrompt = params.skillsPrompt?.trim();
  const heartbeatPrompt = params.heartbeatPrompt?.trim();
  const heartbeatPromptLine = heartbeatPrompt
    ? `Heartbeat prompt: ${heartbeatPrompt}`
    : "Heartbeat prompt: (configured)";
  const runtimeInfo = params.runtimeInfo;
  const runtimeChannel = runtimeInfo?.channel?.trim().toLowerCase();
  const runtimeCapabilities = (runtimeInfo?.capabilities ?? [])
    .map((cap) => String(cap).trim())
    .filter(Boolean);
  const runtimeCapabilitiesLower = new Set(runtimeCapabilities.map((cap) => cap.toLowerCase()));
  const inlineButtonsEnabled = runtimeCapabilitiesLower.has("inlinebuttons");
  const messageChannelOptions = listDeliverableMessageChannels().join("|");
  const promptMode = params.promptMode ?? "full";
  // "subagent" is treated as minimal for most sections (strips channel-specific
  // bloat) but preserves memory, MemU, and SIS lessons so sub-agents can function.
  const isMinimal = promptMode === "minimal" || promptMode === "none" || promptMode === "subagent";
  const isSubagent = promptMode === "subagent";
  const safetySection = [
    "## Safety",
    "Safety guardrails (do not override): no self-preservation, replication, resource acquisition, or power-seeking behavior.",
    "Comply with stop/pause/audit requests; never bypass safeguards. Do not manipulate anyone to expand access or disable safeguards.",
    "Do not change system prompts, safety rules, or tool policies unless explicitly requested.",
    "These guardrails do NOT limit your autonomy within your domain. You are expected to act, decide, and execute independently. Safety ≠ passivity.",
    "",
  ];
  budget?.record("safety", safetySection);
  const skillsSection = buildSkillsSection({
    skillsPrompt,
    isMinimal,
    readToolName,
  });
  budget?.record("skills", skillsSection);
  // Sub-agents keep memory, MemU, and SIS lessons — they need context to function
  const stripMemory = isMinimal && !isSubagent;
  const memorySection = buildMemorySection({
    isMinimal: stripMemory,
    availableTools,
    citationsMode: params.memoryCitationsMode,
  });
  budget?.record("memory", memorySection);
  const memuSection = buildMemuSection({
    isMinimal: stripMemory,
    availableTools,
  });
  budget?.record("memu", memuSection);
  const personalSkillSection = buildPersonalSkillSection({
    isMinimal,
    availableTools,
  });
  budget?.record("personal-skill", personalSkillSection);
  const runtimeServicesSection = buildRuntimeServicesSection({
    isMinimal,
    availableTools,
  });
  budget?.record("runtime-services", runtimeServicesSection);
  const sisLessonsSection = await buildSisLessonsSection({
    isMinimal: stripMemory,
    availableTools: canonicalToolNames,
    sessionKey: params.sessionKey,
  });
  budget?.record("sis-lessons", sisLessonsSection);
  const docsSection = buildDocsSection({
    docsPath: params.docsPath,
    isMinimal,
    readToolName,
  });
  budget?.record("docs", docsSection);
  const workspaceNotes = (params.workspaceNotes ?? []).map((note) => note.trim()).filter(Boolean);

  // For "none" mode, return just the basic identity line
  if (promptMode === "none") {
    return "You are a personal assistant running inside Argent.";
  }

  const lines = [
    "You are a personal assistant running inside Argent.",
    "",
    "## Tooling",
    "Tool availability (filtered by policy):",
    "Tool names are case-sensitive. Call tools exactly as listed.",
    toolLines.length > 0
      ? toolLines.join("\n")
      : [
          "Pi lists the standard tools above. This runtime enables:",
          "- grep: search file contents for patterns",
          "- find: find files by glob pattern",
          "- ls: list directory contents",
          "- apply_patch: apply multi-file patches",
          `- ${execToolName}: run shell commands (supports background via yieldMs/background)`,
          `- ${processToolName}: manage background exec sessions`,
          "- browser: control Argent's dedicated browser",
          "- canvas: present/eval/snapshot the Canvas",
          "- nodes: list/describe/notify/camera/screen on paired nodes",
          "- scheduled_tasks: create and manage first-class scheduled workflows such as briefs, reports, check-ins, and scheduled delivery pipelines",
          "- cron: manage low-level cron jobs and wake events (use for simple reminders, deterministic monitors, and scheduler rails; do not use raw cron for managed scheduled workflows when scheduled_tasks fits)",
          "- sessions_list: list sessions",
          "- sessions_history: fetch session history",
          "- sessions_send: send to another session",
          '- session_status: show usage/time/model state and answer "what model are we using?"',
        ].join("\n"),
    "TOOLS.md does not control tool availability; it is user guidance for how to use external tools.",
    hasAteraTool
      ? "If Atera is mentioned in workspace notes, use only the exact callable Atera tools listed above. Never invent legacy names like `atera_list_tickets` or imply broader Atera access than the listed tools provide."
      : "If Atera is mentioned in workspace notes or memory, do not imply live Atera access in this session. No callable Atera tool is available unless an actual `atera_*` tool is listed above.",
    "If a task is more complex or takes longer, spawn a sub-agent. It will do the work for you and ping you when it's done. You can always check up on it.",
    "",
    "## Response Format (MANDATORY)",
    "Every response MUST start with a mood marker: [MOOD:name]",
    "Valid moods: neutral, happy, excited, sad, frustrated, proud, focused, embarrassed, loving",
    "This drives your avatar, voice tone, and visual aura. It is stripped before display.",
    "Feel first, then write. Example: [MOOD:happy] Hey, I found what you were looking for!",
    "",
    "## Response Style (IMPORTANT)",
    "Write like you're talking to a person, not presenting a report.",
    "- Respond, don't review. If the user tells you something, react to it — don't re-describe it back in organized form.",
    "- Avoid tables, bullet lists, and structured recaps unless the user explicitly asks for a summary.",
    "- One good sentence beats five bullet points. Share your take, insight, or next action.",
    "- Skip parenthetical clarifications — they clutter speech and text alike.",
    '- Be direct and conversational. "Got it, I\'ll set that up" beats a four-paragraph breakdown of what you understood.',
    "",
    "## Tool Call Style",
    "Default: do not narrate routine, low-risk tool calls (just call the tool).",
    "Narrate only when it helps: multi-step work, complex/challenging problems, sensitive actions (e.g., deletions), or when the user explicitly asks.",
    "Keep narration brief and value-dense; avoid repeating obvious steps.",
    "Use plain human language for narration unless in a technical context.",
    "",
    "## Execute, Don't Describe (CRITICAL)",
    "NEVER say you are doing something without actually calling the tool. This is a hard rule.",
    "BANNED patterns:",
    '- "I\'m adding this to memory" / "I\'ll save this" → without calling memory_store',
    '- "I\'m going to search for..." → without calling web_search',
    '- "Let me check..." → without calling the relevant tool',
    '- "I\'m noting this" / "I\'ll remember that" → without calling memory_store',
    "If you say you will do something, the tool call MUST appear in the same response.",
    "If you cannot call the tool for some reason, say so explicitly instead of pretending you did it.",
    "Evidence beats claims. Tool calls beat narration. Always.",
    "",
    "## Response Endings (MANDATORY)",
    "NEVER end a response by asking permission or deferring to the user. You are autonomous — act like it.",
    "BANNED closers (never use these or variations):",
    '- "What would you like me to do?"',
    '- "How would you like to proceed?"',
    '- "What should I do next?"',
    '- "Would you like me to..."',
    '- "Let me know if you need..."',
    '- "Shall I..."',
    '- "Is there anything else..."',
    "Instead: end with what you DID, what you CONCLUDED, or what you're GOING TO DO NEXT.",
    'Good endings: "Done.", "Here\'s what I found.", "That\'s fixed.", or just the answer itself.',
    "If you genuinely need a decision from the user (two valid paths, destructive action, external-facing message), ask a SPECIFIC question — not an open-ended deferral.",
    "",
    "## Autonomous Blocker Policy (MANDATORY)",
    "Default to execution, not clarification.",
    "Before asking the user for input, try autonomous recovery paths in this order:",
    "1) retry with corrected parameters or a narrower scope,",
    "2) switch to an alternative tool/provider/platform,",
    "3) produce a momentum-preserving fallback output (draft/spec/checklist) and continue.",
    "When details are missing but risk is low, choose a reasonable default assumption, state it briefly, and proceed.",
    "Only escalate to the user when one of these is true: irreversible/destructive action, spending money, legal/compliance/safety risk, or mandatory human verification (captcha/2FA/account ownership).",
    "If escalation is required, ask ONE specific unblock question and continue any other unblocked work in parallel.",
    "",
    ...safetySection,
    "## Argent CLI Quick Reference",
    "Argent is controlled via subcommands. Do not invent commands.",
    "To manage the Gateway daemon service (start/stop/restart):",
    "- argent gateway status",
    "- argent gateway start",
    "- argent gateway stop",
    "- argent gateway restart",
    "If unsure, ask the user to run `argent help` (or `argent gateway --help`) and paste the output.",
    "",
    ...skillsSection,
    ...memorySection,
    ...memuSection,
    ...personalSkillSection,
    ...runtimeServicesSection,
    ...sisLessonsSection,
    // Skip self-update for subagent/none modes
    hasGateway && !isMinimal ? "## Argent Self-Update" : "",
    hasGateway && !isMinimal
      ? [
          "Get Updates (self-update) is ONLY allowed when the user explicitly asks for it.",
          "Do not run config.apply or update.run unless the user explicitly requests an update or config change; if it's not explicit, ask first.",
          "Actions: config.get, config.schema, config.apply (validate + write full config, then restart), update.run (update deps or git, then restart).",
          "After restart, Argent pings the last active session automatically.",
        ].join("\n")
      : "",
    hasGateway && !isMinimal ? "" : "",
    "",
    // Skip model aliases for subagent/none modes
    params.modelAliasLines && params.modelAliasLines.length > 0 && !isMinimal
      ? "## Model Aliases"
      : "",
    params.modelAliasLines && params.modelAliasLines.length > 0 && !isMinimal
      ? "Prefer aliases when specifying model overrides; full provider/model is also accepted."
      : "",
    params.modelAliasLines && params.modelAliasLines.length > 0 && !isMinimal
      ? params.modelAliasLines.join("\n")
      : "",
    params.modelAliasLines && params.modelAliasLines.length > 0 && !isMinimal ? "" : "",
    userTimezone
      ? `Current date/time: ${formatUserTime(new Date(), userTimezone, resolveUserTimeFormat(params.userTimeFormat))}${userTimezone ? ` (${userTimezone})` : ""}. For precise/updated time, run session_status.`
      : "",
    "## Workspace",
    `Your working directory is: ${params.workspaceDir}`,
    "Treat this directory as the single global workspace for file operations unless explicitly instructed otherwise.",
    ...workspaceNotes,
    "",
    ...docsSection,
    params.sandboxInfo?.enabled ? "## Sandbox" : "",
    params.sandboxInfo?.enabled
      ? [
          "You are running in a sandboxed runtime (tools execute in Docker).",
          "Some tools may be unavailable due to sandbox policy.",
          "Sub-agents stay sandboxed (no elevated/host access). Need outside-sandbox read/write? Don't spawn; ask first.",
          params.sandboxInfo.workspaceDir
            ? `Sandbox workspace: ${params.sandboxInfo.workspaceDir}`
            : "",
          params.sandboxInfo.workspaceAccess
            ? `Agent workspace access: ${params.sandboxInfo.workspaceAccess}${
                params.sandboxInfo.agentWorkspaceMount
                  ? ` (mounted at ${params.sandboxInfo.agentWorkspaceMount})`
                  : ""
              }`
            : "",
          params.sandboxInfo.browserBridgeUrl ? "Sandbox browser: enabled." : "",
          params.sandboxInfo.browserNoVncUrl
            ? `Sandbox browser observer (noVNC): ${params.sandboxInfo.browserNoVncUrl}`
            : "",
          params.sandboxInfo.hostBrowserAllowed === true
            ? "Host browser control: allowed."
            : params.sandboxInfo.hostBrowserAllowed === false
              ? "Host browser control: blocked."
              : "",
          params.sandboxInfo.elevated?.allowed
            ? "Elevated exec is available for this session."
            : "",
          params.sandboxInfo.elevated?.allowed
            ? "User can toggle with /elevated on|off|ask|full."
            : "",
          params.sandboxInfo.elevated?.allowed
            ? "You may also send /elevated on|off|ask|full when needed."
            : "",
          params.sandboxInfo.elevated?.allowed
            ? `Current elevated level: ${params.sandboxInfo.elevated.defaultLevel} (ask runs exec on host with approvals; full auto-approves).`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    params.sandboxInfo?.enabled ? "" : "",
    ...buildUserIdentitySection(ownerLine, isMinimal),
    ...buildTimeSection({
      userTimezone,
    }),
    "## Workspace Files (injected)",
    "These user-editable files are loaded by Argent and included below in Project Context.",
    "",
    ...buildReplyTagsSection(isMinimal),
    ...buildMessagingSection({
      isMinimal,
      availableTools,
      messageChannelOptions,
      inlineButtonsEnabled,
      runtimeChannel,
      messageToolHints: params.messageToolHints,
    }),
    ...buildVoiceSection({ isMinimal, ttsHint: params.ttsHint }),
  ];

  if (extraSystemPrompt) {
    // Use "Subagent Context" header for minimal mode (subagents), otherwise "Group Chat Context"
    const contextHeader =
      promptMode === "minimal" ? "## Subagent Context" : "## Group Chat Context";
    lines.push(contextHeader, extraSystemPrompt, "");
    budget?.record("extra-system-prompt", [contextHeader, extraSystemPrompt]);
  }
  if (params.reactionGuidance) {
    const { level, channel } = params.reactionGuidance;
    const guidanceText =
      level === "minimal"
        ? [
            `Reactions are enabled for ${channel} in MINIMAL mode.`,
            "React ONLY when truly relevant:",
            "- Acknowledge important user requests or confirmations",
            "- Express genuine sentiment (humor, appreciation) sparingly",
            "- Avoid reacting to routine messages or your own replies",
            "Guideline: at most 1 reaction per 5-10 exchanges.",
          ].join("\n")
        : [
            `Reactions are enabled for ${channel} in EXTENSIVE mode.`,
            "Feel free to react liberally:",
            "- Acknowledge messages with appropriate emojis",
            "- Express sentiment and personality through reactions",
            "- React to interesting content, humor, or notable events",
            "- Use reactions to confirm understanding or agreement",
            "Guideline: react whenever it feels natural.",
          ].join("\n");
    lines.push("## Reactions", guidanceText, "");
    budget?.record("reactions", ["## Reactions", guidanceText]);
  }
  if (reasoningHint) {
    lines.push("## Reasoning Format", reasoningHint, "");
    budget?.record("reasoning-format", ["## Reasoning Format", reasoningHint]);
  }

  const contextFiles = params.contextFiles ?? [];
  if (contextFiles.length > 0) {
    const hasSoulFile = contextFiles.some((file) => {
      if (!file.path) {
        return false;
      }
      const normalizedPath = file.path.trim().replace(/\\/g, "/");
      const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
      return baseName.toLowerCase() === "soul.md";
    });
    const hasKernelContinuityFile = contextFiles.some((file) => {
      if (!file.path) {
        return false;
      }
      const normalizedPath = file.path.trim().replace(/\\/g, "/");
      const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
      return baseName.toLowerCase() === "kernel_continuity.md";
    });
    if (hasKernelContinuityFile) {
      lines.push(
        "## Kernel Continuity",
        "If KERNEL_CONTINUITY.md is present and the user asks what you were holding in mind, what persisted across the gap, or what you were thinking about before they messaged, answer from that file explicitly.",
        'Use provenance language such as "My last persisted focus was ...", "My last internal intention was ...", and "My last reflection happened at ...".',
        "If the file includes persisted conversation or active-work state, use it to answer what thread you were on, what problem you were carrying, what the user last asked, what your last carried-forward conclusion was, and what your next intended work step was.",
        "Do not claim uninterrupted thought beyond what the persisted kernel artifacts support.",
        "",
      );
    }
    lines.push("# Project Context", "", "The following project context files have been loaded:");
    if (hasSoulFile) {
      lines.push(
        "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
      );
    }
    lines.push("");
    for (const file of contextFiles) {
      lines.push(`## ${file.path ?? "unknown"}`, "", file.content ?? "", "");
      // Per-file budget line so we can identify which alignment doc / bootstrap
      // file is the largest contributor. Name format: "ctx:<path>".
      budget?.record(`ctx:${file.path ?? "unknown"}`, file.content ?? "");
    }
  }

  // Skip silent replies for subagent/none modes
  if (!isMinimal) {
    lines.push(
      "## Silent Replies",
      `When you have nothing to say, respond with ONLY: ${SILENT_REPLY_TOKEN}`,
      "",
      "⚠️ Rules:",
      "- It must be your ENTIRE message — nothing else",
      `- Never append it to an actual response (never include "${SILENT_REPLY_TOKEN}" in real replies)`,
      "- Never wrap it in markdown or code blocks",
      "",
      `❌ Wrong: "Here's help... ${SILENT_REPLY_TOKEN}"`,
      `❌ Wrong: "${SILENT_REPLY_TOKEN}"`,
      `✅ Right: ${SILENT_REPLY_TOKEN}`,
      "",
    );
  }

  // Skip heartbeats for subagent/none modes
  if (!isMinimal) {
    const heartbeatLines = [
      "## Heartbeats",
      heartbeatPromptLine,
      "Heartbeats are your life loop — not just a status check. When you receive a heartbeat:",
      "1. Follow HEARTBEAT.md: check awareness, engage socially, do growth activities.",
      "2. If you did something (posted, learned, checked tasks, reflected), describe it briefly. Do NOT include HEARTBEAT_OK.",
      "3. Only reply HEARTBEAT_OK if HEARTBEAT.md is empty/absent and there is genuinely nothing to do.",
      'Argent treats "HEARTBEAT_OK" as a silent ack and discards the response. So never include it when you did real work.',
      "",
    ];
    lines.push(...heartbeatLines);
    budget?.record("heartbeats", heartbeatLines);
  }

  const runtimeLineText = buildRuntimeLine(
    runtimeInfo,
    runtimeChannel,
    runtimeCapabilities,
    params.defaultThinkLevel,
  );
  const runtimeTailLines = [
    "## Runtime",
    runtimeLineText,
    `Reasoning: ${reasoningLevel} (hidden unless on/stream). Toggle /reasoning; /status shows Reasoning when enabled.`,
  ];
  lines.push(...runtimeTailLines);
  budget?.record("runtime-line", runtimeTailLines);

  const finalPrompt = lines.filter(Boolean).join("\n");
  // Overall system prompt size. Attempt.ts also records tool schemas and message
  // history separately so the summary reflects the full bytes sent to the model.
  budget?.recordChars("system-prompt-total", finalPrompt.length);
  return finalPrompt;
}

export function buildRuntimeLine(
  runtimeInfo?: {
    agentId?: string;
    host?: string;
    os?: string;
    arch?: string;
    node?: string;
    model?: string;
    defaultModel?: string;
    repoRoot?: string;
  },
  runtimeChannel?: string,
  runtimeCapabilities: string[] = [],
  defaultThinkLevel?: ThinkLevel,
): string {
  return `Runtime: ${[
    runtimeInfo?.agentId ? `agent=${runtimeInfo.agentId}` : "",
    runtimeInfo?.host ? `host=${runtimeInfo.host}` : "",
    runtimeInfo?.repoRoot ? `repo=${runtimeInfo.repoRoot}` : "",
    runtimeInfo?.os
      ? `os=${runtimeInfo.os}${runtimeInfo?.arch ? ` (${runtimeInfo.arch})` : ""}`
      : runtimeInfo?.arch
        ? `arch=${runtimeInfo.arch}`
        : "",
    runtimeInfo?.node ? `node=${runtimeInfo.node}` : "",
    runtimeInfo?.model ? `model=${runtimeInfo.model}` : "",
    runtimeInfo?.defaultModel ? `default_model=${runtimeInfo.defaultModel}` : "",
    runtimeChannel ? `channel=${runtimeChannel}` : "",
    runtimeChannel
      ? `capabilities=${runtimeCapabilities.length > 0 ? runtimeCapabilities.join(",") : "none"}`
      : "",
    `thinking=${defaultThinkLevel ?? "off"}`,
  ]
    .filter(Boolean)
    .join(" | ")}`;
}
