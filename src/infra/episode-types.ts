/**
 * SIS Episode Format v0.1
 *
 * Structured episodic memory for the Self-Improving System.
 * Designed by Argent, refined by Grok. Captured during contemplation cycles.
 *
 * Episodes are the atomic unit of experiential memory — each one records
 * what happened, why, what was learned, and how it felt.
 */

// ── Episode Type ──────────────────────────────────────────────────────────

export type EpisodeType =
  | "contemplation" // Self-directed thinking cycle
  | "task_execution" // Working on a task
  | "conversation" // User interaction
  | "research" // Curiosity-driven exploration
  | "reflection" // Meta-cognitive review
  | "creation" // Making something new (doc, plan, code)
  | "rest"; // Chose to rest (CONTEMPLATION_OK)

// ── Trigger ───────────────────────────────────────────────────────────────

export interface Trigger {
  source: "contemplation_timer" | "user_message" | "heartbeat" | "task_queue" | "self";
  detail?: string; // e.g. "5-minute cycle", "user asked about X"
}

// ── Observation ───────────────────────────────────────────────────────────

export interface Observation {
  what: string; // What was noticed or discovered
  significance: "low" | "medium" | "high";
  surprise?: number; // 0.0 (expected) to 1.0 (completely unexpected)
}

// ── Action ────────────────────────────────────────────────────────────────

export interface EpisodeAction {
  type: "tool_call" | "thought" | "decision" | "plan";
  description: string;
  reasoning?: string; // Why this action was chosen
}

// ── Tool Usage ────────────────────────────────────────────────────────────

export interface ToolUsage {
  tool: string; // Tool name (tasks, memory_store, web_search, etc.)
  action?: string; // Sub-action (e.g. "add", "complete", "search")
  input_summary?: string; // Brief summary of input
  output_summary?: string; // Brief summary of result
  success: boolean;
}

// ── Outcome ───────────────────────────────────────────────────────────────

export interface Outcome {
  result: "success" | "partial" | "failure" | "deferred" | "rest";
  summary: string; // What actually happened
  impact?: string; // What effect this had
}

// ── Mood ──────────────────────────────────────────────────────────────────

export interface Mood {
  state: string; // e.g. "curious", "satisfied", "contemplative", "restless"
  energy: "low" | "medium" | "high";
}

// ── Identity Link ─────────────────────────────────────────────────────────

export interface IdentityLink {
  entity: string; // Entity name (e.g. "Jason", "Richard", "Argent")
  role: "subject" | "mentioned" | "about" | "collaborator";
  relevance?: string; // Why this entity matters in this episode
}

// ── Episode ───────────────────────────────────────────────────────────────

export interface Episode {
  id: string; // UUID, assigned server-side
  ts: string; // ISO 8601, assigned server-side
  type: EpisodeType;
  session_id: string; // Contemplation session key
  version: "0.1";

  // Context
  trigger: Trigger;
  context?: string; // Brief situational context

  // Intent & Action
  intent?: string; // What the agent set out to do
  observations: Observation[];
  actions_taken: EpisodeAction[];
  tools_used: ToolUsage[];

  // Outcome
  outcome: Outcome;
  success: boolean;
  unexpected?: string; // Anything surprising that happened
  uncertainty?: string; // What remains unclear

  // Reflection
  reflection?: string; // What this episode means
  lesson?: string; // What was learned (for SIS pattern extraction)
  pattern_hint?: string; // Agent's guess at recurring pattern

  // Emotional Context
  mood: Mood;
  valence: number; // -2 to +2
  arousal: number; // 0 to 1

  // Identity
  identity_links: IdentityLink[];

  // Metadata (assigned server-side)
  word_count?: number;
  model_used?: string;
  cost_estimate?: number;
  duration_ms?: number;
}

// ── Agent-Reported Episode ────────────────────────────────────────────────

/**
 * What the agent actually outputs in [EPISODE_JSON] blocks.
 * Server-side fields (id, ts, session_id, word_count, model_used, etc.)
 * are filled in by the runner.
 */
export type AgentEpisodeReport = Omit<
  Episode,
  | "id"
  | "ts"
  | "session_id"
  | "version"
  | "word_count"
  | "model_used"
  | "cost_estimate"
  | "duration_ms"
>;

// ── Parsing ───────────────────────────────────────────────────────────────

const EPISODE_JSON_PATTERN = /\[EPISODE_JSON\]\s*([\s\S]*?)\s*\[\/EPISODE_JSON\]/i;
const FUNCTION_CALL_PATTERN = /\[function=([a-zA-Z0-9_.:-]+)\]([\s\S]*?)\[\/function\]/gi;
const ACTION_JSON_TOOL_PATTERN = /"action"\s*:\s*"([a-zA-Z0-9_.:-]+)"/gi;
const MOOD_PATTERN = /\[MOOD:([^\]\n]+)\]/i;
const INLINE_STATUS_TAG_PATTERN = /\[(?:TTS(?:_NOW)?|MOOD):[^\n]*\]/gi;

const ACTION_NAME_DENYLIST = new Set([
  "add",
  "check",
  "complete",
  "create",
  "delete",
  "find",
  "get",
  "list",
  "open",
  "recent",
  "save",
  "search",
  "set",
  "status",
  "update",
  "view",
  "write",
]);

const INTERNAL_ONLY_TOOLS = new Set([
  "atera_setup",
  "conemplation_history",
  "contemplation_history",
  "doc_panel_search",
  "knowledge_search",
  "memory_categories",
  "memory_recall",
  "memory_reflect",
  "memory_store",
  "os_docs",
  "read",
  "sessions_search",
  "tasks",
]);

const RESEARCH_TOOLS = new Set(["web_fetch", "web_search"]);
const CREATION_TOOLS = new Set([
  "doc_panel",
  "doc_panel_update",
  "message",
  "sessions_send",
  "write",
  "write_file",
]);

export type EpisodeParseSource = "tagged_json" | "salvaged_unstructured";

export interface EpisodeParseContext {
  executedTools?: string[];
  hasExternalArtifact?: boolean;
}

export interface EpisodeParseResult {
  report: AgentEpisodeReport;
  source: EpisodeParseSource;
}

/**
 * Extract an [EPISODE_JSON]...[/EPISODE_JSON] block from agent response text.
 * Returns the parsed AgentEpisodeReport or null if not found / invalid.
 */
export function parseEpisodeFromResponse(
  text: string,
  context: EpisodeParseContext = {},
): EpisodeParseResult | null {
  const match = EPISODE_JSON_PATTERN.exec(text);
  if (match?.[1]) {
    try {
      const raw = JSON.parse(match[1]) as Record<string, unknown>;
      const validated = validateAgentEpisode(raw, context);
      if (validated) {
        return { report: validated, source: "tagged_json" };
      }
    } catch {
      /* fall through to salvage */
    }
  }

  const salvaged = salvageEpisodeFromResponse(text, context);
  if (!salvaged) return null;
  return { report: salvaged, source: "salvaged_unstructured" };
}

/**
 * Minimal validation — ensure required fields exist and have sane types.
 * Lenient on optional fields — the agent might not fill everything.
 */
function validateAgentEpisode(
  raw: Record<string, unknown>,
  context: EpisodeParseContext = {},
): AgentEpisodeReport | null {
  const confirmedTools = new Set(extractConfirmedTools(context.executedTools ?? []));
  const trigger = normalizeTrigger(raw.trigger);
  const rawTools = normalizeToolUsage(raw.tools_used, confirmedTools);
  const type = normalizeEpisodeType(raw.type, rawTools, Boolean(context.hasExternalArtifact));
  if (!type) return null;

  const success = typeof raw.success === "boolean" ? raw.success : undefined;
  const outcome = normalizeOutcome(raw.outcome, success, type);
  if (!outcome) return null;

  const mood = normalizeMood(raw.mood, raw.arousal);
  if (!mood) return null;

  return {
    type,
    trigger,
    context: readOptionalString(raw.context),
    intent: readOptionalString(raw.intent),
    observations: normalizeObservations(raw.observations),
    actions_taken: normalizeActions(raw.actions_taken),
    tools_used: rawTools,
    outcome,
    success: typeof success === "boolean" ? success : outcome.result === "success",
    unexpected: readOptionalString(raw.unexpected),
    uncertainty: readOptionalString(raw.uncertainty),
    reflection: readOptionalString(raw.reflection),
    lesson: readOptionalString(raw.lesson),
    pattern_hint: readOptionalString(raw.pattern_hint),
    mood,
    valence: typeof raw.valence === "number" ? clamp(raw.valence, -2, 2) : 0,
    arousal: typeof raw.arousal === "number" ? clamp(raw.arousal, 0, 1) : 0.2,
    identity_links: normalizeIdentityLinks(raw.identity_links),
  };
}

const VALID_EPISODE_TYPES: EpisodeType[] = [
  "contemplation",
  "task_execution",
  "conversation",
  "research",
  "reflection",
  "creation",
  "rest",
];

const VALID_TRIGGER_SOURCES: Trigger["source"][] = [
  "contemplation_timer",
  "user_message",
  "heartbeat",
  "task_queue",
  "self",
];

const VALID_OUTCOME_RESULTS: Outcome["result"][] = [
  "success",
  "partial",
  "failure",
  "deferred",
  "rest",
];

const VALID_MOOD_ENERGIES: Mood["energy"][] = ["low", "medium", "high"];
const VALID_ACTION_TYPES: EpisodeAction["type"][] = ["tool_call", "thought", "decision", "plan"];
const VALID_IDENTITY_ROLES: IdentityLink["role"][] = [
  "subject",
  "mentioned",
  "about",
  "collaborator",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeTrigger(raw: unknown): Trigger {
  if (typeof raw === "string") {
    const detail = raw.trim();
    return detail ? { source: "contemplation_timer", detail } : { source: "contemplation_timer" };
  }
  if (isRecord(raw)) {
    const rawSource = readOptionalString(raw.source);
    const detail = readOptionalString(raw.detail);
    if (rawSource && VALID_TRIGGER_SOURCES.includes(rawSource as Trigger["source"])) {
      return detail
        ? { source: rawSource as Trigger["source"], detail }
        : { source: rawSource as Trigger["source"] };
    }
    if (rawSource || detail) {
      return {
        source: "contemplation_timer",
        ...(rawSource || detail ? { detail: [rawSource, detail].filter(Boolean).join(" — ") } : {}),
      };
    }
  }
  return { source: "contemplation_timer" };
}

function normalizeEpisodeType(
  rawType: unknown,
  toolsUsed: ToolUsage[],
  hasExternalArtifact: boolean,
): EpisodeType | null {
  const candidate = readOptionalString(rawType);
  if (candidate && VALID_EPISODE_TYPES.includes(candidate as EpisodeType)) {
    return candidate as EpisodeType;
  }
  if (candidate) {
    return inferEpisodeType(
      toolsUsed.map((tool) => tool.tool),
      hasExternalArtifact,
    );
  }
  return inferEpisodeType(
    toolsUsed.map((tool) => tool.tool),
    hasExternalArtifact,
  );
}

function normalizeOutcomeResult(
  rawResult: unknown,
  success: boolean | undefined,
  type: EpisodeType,
): Outcome["result"] {
  const candidate = readOptionalString(rawResult)?.toLowerCase();
  if (candidate && VALID_OUTCOME_RESULTS.includes(candidate as Outcome["result"])) {
    return candidate as Outcome["result"];
  }
  if (candidate === "ok" || candidate === "done" || candidate === "completed") {
    return "success";
  }
  if (candidate === "failed" || candidate === "error") {
    return "failure";
  }
  if (candidate === "idle") {
    return "rest";
  }
  if (type === "rest") {
    return "rest";
  }
  if (success === true) {
    return "success";
  }
  return "partial";
}

function normalizeOutcome(
  raw: unknown,
  success: boolean | undefined,
  type: EpisodeType,
): Outcome | null {
  if (typeof raw === "string") {
    const summary = raw.trim();
    if (!summary) return null;
    return {
      result: normalizeOutcomeResult(undefined, success, type),
      summary,
    };
  }
  if (isRecord(raw)) {
    const summary = readOptionalString(raw.summary) ?? readOptionalString(raw.impact);
    if (!summary) return null;
    return {
      result: normalizeOutcomeResult(raw.result, success, type),
      summary,
      impact: readOptionalString(raw.impact),
    };
  }
  return null;
}

function normalizeMood(raw: unknown, arousal: unknown): Mood | null {
  if (typeof raw === "string") {
    const state = raw.trim();
    if (!state) return null;
    return {
      state,
      energy: inferMoodEnergy(arousal),
    };
  }
  if (isRecord(raw)) {
    const state = readOptionalString(raw.state);
    if (!state) return null;
    const energy = readOptionalString(raw.energy)?.toLowerCase();
    return {
      state,
      energy:
        energy && VALID_MOOD_ENERGIES.includes(energy as Mood["energy"])
          ? (energy as Mood["energy"])
          : inferMoodEnergy(arousal),
    };
  }
  return null;
}

function inferMoodEnergy(arousal: unknown): Mood["energy"] {
  if (typeof arousal === "number") {
    if (arousal >= 0.67) return "high";
    if (arousal <= 0.25) return "low";
  }
  return "medium";
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function normalizeObservations(raw: unknown): Observation[] {
  return asArray(raw)
    .map((entry) => {
      if (typeof entry === "string") {
        const what = entry.trim();
        return what ? ({ what, significance: "medium" } satisfies Observation) : null;
      }
      if (!isRecord(entry)) return null;
      const what = readOptionalString(entry.what) ?? readOptionalString(entry.summary);
      if (!what) return null;
      const significance = readOptionalString(entry.significance)?.toLowerCase();
      return {
        what,
        significance:
          significance === "low" || significance === "medium" || significance === "high"
            ? significance
            : "medium",
        ...(typeof entry.surprise === "number" ? { surprise: clamp(entry.surprise, 0, 1) } : {}),
      } satisfies Observation;
    })
    .filter((entry): entry is Observation => Boolean(entry));
}

function inferActionType(description: string): EpisodeAction["type"] {
  const normalized = description.toLowerCase();
  if (/\b(next action|i(?:'|’)ll|i will|plan|follow up|publish|post)\b/.test(normalized)) {
    return "plan";
  }
  if (/\b(decided|decision|behavior change|commit|shift)\b/.test(normalized)) {
    return "decision";
  }
  if (
    /\b(executed|ran|checked|queried|searched|published|wrote|used|called|created)\b/.test(
      normalized,
    )
  ) {
    return "tool_call";
  }
  return "thought";
}

function normalizeActions(raw: unknown): EpisodeAction[] {
  return asArray(raw)
    .map((entry) => {
      if (typeof entry === "string") {
        const description = entry.trim();
        return description
          ? ({
              type: inferActionType(description),
              description,
            } satisfies EpisodeAction)
          : null;
      }
      if (!isRecord(entry)) return null;
      const description =
        readOptionalString(entry.description) ??
        readOptionalString(entry.what) ??
        readOptionalString(entry.summary);
      if (!description) return null;
      const type = readOptionalString(entry.type)?.toLowerCase();
      return {
        type:
          type && VALID_ACTION_TYPES.includes(type as EpisodeAction["type"])
            ? (type as EpisodeAction["type"])
            : inferActionType(description),
        description,
        reasoning: readOptionalString(entry.reasoning),
      } satisfies EpisodeAction;
    })
    .filter((entry): entry is EpisodeAction => Boolean(entry));
}

function toolsMatchConfirmed(tool: string, confirmedTools: Set<string>): boolean {
  const normalized = normalizeObservedToolName(tool);
  if (!normalized) return false;
  if (confirmedTools.has(normalized)) return true;
  if (
    (normalized === "doc_panel_update" && confirmedTools.has("doc_panel")) ||
    (normalized === "sessions_send" && confirmedTools.has("message"))
  ) {
    return true;
  }
  return false;
}

function normalizeToolUsage(raw: unknown, confirmedTools: Set<string>): ToolUsage[] {
  return asArray(raw)
    .map((entry) => {
      if (typeof entry === "string") {
        const tool = normalizeObservedToolName(entry) ?? entry.trim();
        if (!tool) return null;
        return {
          tool,
          success: confirmedTools.size > 0 ? toolsMatchConfirmed(tool, confirmedTools) : true,
        } satisfies ToolUsage;
      }
      if (!isRecord(entry)) return null;
      const tool =
        normalizeObservedToolName(
          readOptionalString(entry.tool) ?? readOptionalString(entry.name) ?? "",
        ) ??
        readOptionalString(entry.tool) ??
        readOptionalString(entry.name);
      if (!tool) return null;
      return {
        tool,
        action: readOptionalString(entry.action),
        input_summary: readOptionalString(entry.input_summary),
        output_summary: readOptionalString(entry.output_summary),
        success:
          typeof entry.success === "boolean"
            ? entry.success
            : confirmedTools.size > 0
              ? toolsMatchConfirmed(tool, confirmedTools)
              : true,
      } satisfies ToolUsage;
    })
    .filter((entry): entry is ToolUsage => Boolean(entry));
}

function normalizeIdentityLinks(raw: unknown): IdentityLink[] {
  return asArray(raw)
    .map((entry) => {
      if (typeof entry === "string") {
        const entity = entry.trim();
        return entity ? ({ entity, role: "about" } satisfies IdentityLink) : null;
      }
      if (!isRecord(entry)) return null;
      const entity = readOptionalString(entry.entity) ?? readOptionalString(entry.name);
      if (!entity) return null;
      const role = readOptionalString(entry.role)?.toLowerCase();
      return {
        entity,
        role:
          role && VALID_IDENTITY_ROLES.includes(role as IdentityLink["role"])
            ? (role as IdentityLink["role"])
            : "about",
        relevance: readOptionalString(entry.relevance),
      } satisfies IdentityLink;
    })
    .filter((entry): entry is IdentityLink => Boolean(entry));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeObservedToolName(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const unqualified = trimmed.includes(".") ? trimmed.slice(trimmed.lastIndexOf(".") + 1) : trimmed;
  if (unqualified === "conemplation_history") {
    return "contemplation_history";
  }
  return unqualified;
}

function looksLikeToolName(raw: string): boolean {
  const normalized = normalizeObservedToolName(raw);
  if (!normalized) return false;
  if (INTERNAL_ONLY_TOOLS.has(normalized)) return true;
  if (RESEARCH_TOOLS.has(normalized)) return true;
  if (CREATION_TOOLS.has(normalized)) return true;
  if (normalized === "message" || normalized === "read") return true;
  if (!/[_.-]/.test(normalized)) return false;
  return !ACTION_NAME_DENYLIST.has(normalized);
}

function uniqueTools(tools: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tool of tools) {
    if (!tool || seen.has(tool)) continue;
    seen.add(tool);
    result.push(tool);
  }
  return result;
}

function extractConfirmedTools(executedTools: string[]): string[] {
  const confirmed: string[] = [];
  for (const tool of executedTools) {
    const normalized = normalizeObservedToolName(tool);
    if (normalized) confirmed.push(normalized);
  }
  return uniqueTools(confirmed);
}

function extractObservedTools(text: string, executedTools: string[]): string[] {
  const observed: string[] = [];
  observed.push(...extractConfirmedTools(executedTools));

  for (const match of text.matchAll(FUNCTION_CALL_PATTERN)) {
    const normalized = normalizeObservedToolName(match[1] ?? "");
    if (normalized) observed.push(normalized);
  }

  for (const match of text.matchAll(ACTION_JSON_TOOL_PATTERN)) {
    const candidate = match[1] ?? "";
    if (!looksLikeToolName(candidate)) continue;
    const normalized = normalizeObservedToolName(candidate);
    if (normalized) observed.push(normalized);
  }

  return uniqueTools(observed);
}

function hasOnlyInternalTools(tools: string[]): boolean {
  return tools.length > 0 && tools.every((tool) => INTERNAL_ONLY_TOOLS.has(tool));
}

function inferEpisodeType(tools: string[], hasExternalArtifact: boolean): EpisodeType {
  if (tools.length === 0) return "contemplation";
  if (!hasExternalArtifact && hasOnlyInternalTools(tools)) return "rest";
  if (tools.some((tool) => CREATION_TOOLS.has(tool))) return "creation";
  if (tools.some((tool) => RESEARCH_TOOLS.has(tool))) return "research";
  if (tools.includes("tasks")) return hasExternalArtifact ? "task_execution" : "rest";
  return hasExternalArtifact ? "contemplation" : "rest";
}

function summarizeUnstructuredText(text: string, observedTools: string[]): string {
  let clean = unwrapInlineStatusTags(text)
    .replace(EPISODE_JSON_PATTERN, " ")
    .replace(FUNCTION_CALL_PATTERN, (_match, toolName: string) => {
      const normalized = normalizeObservedToolName(toolName) ?? toolName;
      return ` called ${normalized} `;
    })
    .replace(/\{[\s\S]*?\}/g, (block) => {
      const actionMatch = ACTION_JSON_TOOL_PATTERN.exec(block);
      ACTION_JSON_TOOL_PATTERN.lastIndex = 0;
      const normalized = normalizeObservedToolName(actionMatch?.[1] ?? "");
      return normalized ? ` ${normalized} ` : " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  if (!clean && observedTools.length > 0) {
    clean = `Observed unstructured contemplation output involving ${observedTools.join(", ")}.`;
  }
  return clean.length > 240 ? `${clean.slice(0, 237)}...` : clean;
}

function inferMoodState(text: string): string {
  const match = MOOD_PATTERN.exec(text);
  return match?.[1]?.trim() || "unknown";
}

function hasInlineStatusSignal(text: string): boolean {
  return /\[(?:TTS(?:_NOW)?|MOOD):/i.test(text);
}

function unwrapInlineStatusTags(text: string): string {
  return text
    .replace(/\[MOOD:[^\]\n]*\]/gi, " ")
    .replace(/\[TTS(?:_NOW)?:([^\n]*)\]/gi, (_match, body: string) => ` ${body} `);
}

interface NarrativeRecoverySignals {
  lesson?: string;
  behaviorChange?: string;
  nextAction?: string;
  reflection?: string;
}

function cleanNarrativeLine(line: string): string {
  return unwrapInlineStatusTags(line).replace(/\s+/g, " ").trim();
}

function extractNarrativeRecoverySignals(text: string): NarrativeRecoverySignals | null {
  const lines = text.split(/\r?\n/).map(cleanNarrativeLine).filter(Boolean);

  let lesson: string | undefined;
  let behaviorChange: string | undefined;
  let nextAction: string | undefined;
  const reflectionLines: string[] = [];

  for (const line of lines) {
    if (/^Lesson captured:/i.test(line)) {
      lesson = line.replace(/^Lesson captured:\s*/i, "").trim() || undefined;
      continue;
    }
    if (/^Behavior change:/i.test(line)) {
      behaviorChange = line.replace(/^Behavior change:\s*/i, "").trim() || undefined;
      continue;
    }
    if (/^Next action:/i.test(line)) {
      nextAction = line.replace(/^Next action:\s*/i, "").trim() || undefined;
      continue;
    }
    reflectionLines.push(line);
  }

  if (!lesson && !behaviorChange && !nextAction) {
    return null;
  }

  const reflection = reflectionLines.join(" ").trim();
  return {
    lesson,
    behaviorChange,
    nextAction,
    reflection: reflection || undefined,
  };
}

function buildOutcomeSummary(
  confirmedTools: string[],
  observedTools: string[],
  hasExternalArtifact: boolean,
  type: EpisodeType,
): string {
  if (confirmedTools.length === 0) {
    if (observedTools.length === 0) {
      return "Contemplation response omitted structured episode JSON";
    }
    return `Contemplation response mentioned ${observedTools.join(", ")} but omitted structured episode JSON and confirmed tool execution`;
  }
  const toolList = confirmedTools.join(", ");
  if (type === "rest" || !hasExternalArtifact) {
    return `Internal-only contemplation cycle executed ${toolList} but omitted structured episode JSON`;
  }
  return `Contemplation cycle executed ${toolList} but omitted structured episode JSON`;
}

function salvageEpisodeFromResponse(
  text: string,
  context: EpisodeParseContext,
): AgentEpisodeReport | null {
  const executedTools = Array.isArray(context.executedTools) ? context.executedTools : [];
  const confirmedTools = extractConfirmedTools(executedTools);
  const observedTools = extractObservedTools(text, executedTools);
  const narrative = extractNarrativeRecoverySignals(text);
  const hasStatusSignal = hasInlineStatusSignal(text);
  if (observedTools.length === 0 && !narrative && !hasStatusSignal) {
    return null;
  }

  const hasConfirmedTools = confirmedTools.length > 0;
  const hasExternalArtifact = hasConfirmedTools && Boolean(context.hasExternalArtifact);
  const type =
    observedTools.length === 0 && narrative
      ? "contemplation"
      : inferEpisodeType(hasConfirmedTools ? confirmedTools : [], hasExternalArtifact);
  const observation = narrative?.reflection
    ? summarizeUnstructuredText(narrative.reflection, observedTools)
    : summarizeUnstructuredText(text, observedTools);
  const moodState = inferMoodState(text);
  const toolList = hasConfirmedTools ? confirmedTools : observedTools;
  const actionsTaken: EpisodeAction[] = observedTools.slice(0, 5).map((tool) => ({
    type: "tool_call",
    description: hasConfirmedTools
      ? `Confirmed ${tool} execution in unstructured contemplation output`
      : `Observed unconfirmed ${tool} tool mention in unstructured contemplation output`,
  }));
  if (narrative?.behaviorChange) {
    actionsTaken.push({
      type: "decision",
      description: narrative.behaviorChange,
    });
  }
  if (narrative?.nextAction) {
    actionsTaken.push({
      type: "plan",
      description: narrative.nextAction,
    });
  }

  return {
    type,
    trigger: { source: "contemplation_timer" },
    context: narrative
      ? "Recovered from narrative contemplation output"
      : "Recovered from unstructured contemplation output",
    observations: [
      {
        what: observation || "Recovered unstructured contemplation output.",
        significance: hasExternalArtifact ? "medium" : "low",
      },
    ],
    actions_taken: actionsTaken.slice(0, 5),
    tools_used: toolList.map((tool) => ({
      tool,
      success: confirmedTools.includes(tool),
    })),
    outcome: {
      result: type === "rest" ? "rest" : "partial",
      summary: buildOutcomeSummary(confirmedTools, observedTools, hasExternalArtifact, type),
    },
    success: false,
    reflection: narrative?.reflection,
    lesson: narrative?.lesson,
    pattern_hint: narrative?.behaviorChange,
    mood: { state: moodState, energy: hasExternalArtifact ? "medium" : "low" },
    valence: 0,
    arousal: hasExternalArtifact ? 0.3 : 0.1,
    identity_links: [],
  };
}

/**
 * Build a minimal fallback episode from raw contemplation text when
 * parseEpisodeFromResponse() returns null. This prevents silent data loss
 * for SIS consolidation (see GitHub issue #21).
 *
 * The fallback captures the text as an observation with "unknown" result,
 * so SIS can still extract patterns rather than losing the data entirely.
 */
export function buildFallbackEpisode(text: string): AgentEpisodeReport {
  // Truncate text for the summary (avoid storing megabytes in summary field)
  const summary = text.length > 200 ? text.slice(0, 197) + "..." : text;

  return {
    type: "contemplation",
    trigger: { source: "contemplation_timer" },
    observations: [
      {
        what: summary,
        significance: "low",
      },
    ],
    actions_taken: [],
    tools_used: [],
    outcome: {
      result: "partial",
      summary: "Episode JSON not parseable — fallback capture from raw text",
    },
    success: false,
    mood: { state: "unknown", energy: "medium" },
    valence: 0,
    arousal: 0.1,
    identity_links: [],
  };
}

/**
 * Derive MIMO significance from episode valence and arousal.
 * Higher emotion = more significant memory.
 */
export function deriveSignificance(
  valence: number,
  arousal: number,
  hasLesson: boolean,
): "routine" | "noteworthy" | "important" | "core" {
  const intensity = Math.abs(valence) * arousal;
  if (hasLesson && intensity > 0.8) return "important";
  if (hasLesson || intensity > 0.6) return "noteworthy";
  if (intensity > 0.3) return "noteworthy";
  return "routine";
}

// ── SIS Consolidation Contract ────────────────────────────────────────────

export interface SisPatternContract {
  name: string;
  description: string;
  frequency: number;
  avg_valence: number;
  lessons: string[];
  episode_ids: string[];
  growth_direction?: string;
}

export interface SisConsolidationContract {
  patterns: SisPatternContract[];
  growth_arc: string;
  self_insights: string[];
  recommendations: string[];
  tool_lessons?: unknown[];
}

export type SisParseFailureReason =
  | "no-json-candidate"
  | "json-parse-failed"
  | "root-not-object"
  | "missing-patterns"
  | "missing-growth-arc"
  | "missing-self-insights"
  | "missing-recommendations"
  | "invalid-pattern-entry";

export type SisConsolidationValidationResult =
  | {
      ok: true;
      value: SisConsolidationContract;
    }
  | {
      ok: false;
      reason: SisParseFailureReason;
      detail: string;
    };

function coerceStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

/**
 * Strict SIS consolidation validator.
 * Ensures required keys and expected value types before runner-level mapping.
 */
export function validateSisConsolidationContract(raw: unknown): SisConsolidationValidationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      reason: "root-not-object",
      detail: "SIS consolidation JSON root must be an object",
    };
  }

  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.patterns)) {
    return {
      ok: false,
      reason: "missing-patterns",
      detail: 'Missing required key "patterns" (array)',
    };
  }
  if (typeof obj.growth_arc !== "string") {
    return {
      ok: false,
      reason: "missing-growth-arc",
      detail: 'Missing required key "growth_arc" (string)',
    };
  }
  const selfInsights = coerceStringArray(obj.self_insights);
  if (!selfInsights) {
    return {
      ok: false,
      reason: "missing-self-insights",
      detail: 'Missing required key "self_insights" (string[])',
    };
  }
  const recommendations = coerceStringArray(obj.recommendations);
  if (!recommendations) {
    return {
      ok: false,
      reason: "missing-recommendations",
      detail: 'Missing required key "recommendations" (string[])',
    };
  }

  const patterns: SisPatternContract[] = [];
  for (let i = 0; i < obj.patterns.length; i++) {
    const rawPattern = obj.patterns[i];
    if (!rawPattern || typeof rawPattern !== "object" || Array.isArray(rawPattern)) {
      return {
        ok: false,
        reason: "invalid-pattern-entry",
        detail: `patterns[${i}] must be an object`,
      };
    }
    const p = rawPattern as Record<string, unknown>;
    const lessons = coerceStringArray(p.lessons);
    const episodeIds = coerceStringArray(p.episode_ids);
    if (
      typeof p.name !== "string" ||
      typeof p.description !== "string" ||
      typeof p.frequency !== "number" ||
      typeof p.avg_valence !== "number" ||
      !lessons ||
      !episodeIds
    ) {
      return {
        ok: false,
        reason: "invalid-pattern-entry",
        detail: `patterns[${i}] has invalid/missing required fields`,
      };
    }
    patterns.push({
      name: p.name.trim(),
      description: p.description.trim(),
      frequency: Number.isFinite(p.frequency) ? Math.max(0, Math.trunc(p.frequency)) : 0,
      avg_valence: Number.isFinite(p.avg_valence) ? p.avg_valence : 0,
      lessons,
      episode_ids: episodeIds,
      growth_direction:
        typeof p.growth_direction === "string" && p.growth_direction.trim().length > 0
          ? p.growth_direction.trim()
          : undefined,
    });
  }

  return {
    ok: true,
    value: {
      patterns,
      growth_arc: obj.growth_arc.trim(),
      self_insights: selfInsights,
      recommendations,
      tool_lessons: Array.isArray(obj.tool_lessons) ? obj.tool_lessons : undefined,
    },
  };
}
