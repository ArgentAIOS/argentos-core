/**
 * TOON Encoding Layer for ArgentOS
 *
 * Token-Oriented Object Notation — compact LLM-friendly encoding
 * for structured data passing between agents, pipeline steps, and tools.
 *
 * Uses: pipeline context, agent handoffs, memory results, tool outputs,
 * SpecForge task breakdowns, family status, cron definitions.
 *
 * @see https://github.com/toon-format/toon
 */

import { encode as toonEncode, decode as toonDecode } from "@toon-format/toon";

/**
 * Encode structured data as TOON for injection into LLM prompts.
 * Falls back to JSON if TOON encoding fails.
 */
export function encodeForPrompt(data: unknown, label?: string): string {
  try {
    const toon = toonEncode(data);
    if (label) {
      return `[${label}]\n${toon}\n[/${label}]`;
    }
    return toon;
  } catch {
    // Fallback to compact JSON if TOON can't encode this structure
    const json = JSON.stringify(data, null, 2);
    if (label) {
      return `[${label}]\n${json}\n[/${label}]`;
    }
    return json;
  }
}

/**
 * Decode TOON back to structured data.
 * Falls back to JSON.parse if TOON decoding fails.
 */
export function decodeFromPrompt(text: string, label?: string): unknown {
  let content = text;
  if (label) {
    const startTag = `[${label}]`;
    const endTag = `[/${label}]`;
    const startIdx = content.indexOf(startTag);
    const endIdx = content.indexOf(endTag);
    if (startIdx >= 0 && endIdx > startIdx) {
      content = content.slice(startIdx + startTag.length, endIdx).trim();
    }
  }
  try {
    return toonDecode(content);
  } catch {
    try {
      return JSON.parse(content);
    } catch {
      return content;
    }
  }
}

// ── Pipeline Context Encoding ────────────────────────────────────

export interface PipelineStepSummary {
  step: number;
  agent: string;
  status: string;
  duration: string;
  output: string;
  artifact: string;
}

export interface PipelineContextData {
  workflow: {
    id: string;
    name?: string;
    runId: string;
    currentStep: number;
    totalSteps: number;
  };
  steps: PipelineStepSummary[];
  task: string;
  variables?: Record<string, unknown>;
}

/**
 * Encode pipeline context for injection into agent prompts.
 * Uses TOON for compact step history representation.
 */
export function encodePipelineContext(ctx: PipelineContextData): string {
  return encodeForPrompt(ctx, "PIPELINE_CONTEXT");
}

// ── Agent Handoff Encoding ───────────────────────────────────────

export interface AgentHandoff {
  from: string;
  to: string;
  artifact?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

/**
 * Encode agent-to-agent handoff data.
 */
export function encodeHandoff(handoff: AgentHandoff): string {
  return encodeForPrompt(handoff, "AGENT_HANDOFF");
}

// ── Memory Results Encoding ──────────────────────────────────────

export interface MemoryResultRow {
  id: string;
  type: string;
  significance: string;
  text: string;
  created: string;
}

/**
 * Encode memory recall results as TOON for compact injection.
 */
export function encodeMemoryResults(results: MemoryResultRow[]): string {
  return encodeForPrompt({ results }, "MEMORY_CONTEXT");
}

// ── Task Breakdown Encoding ──────────────────────────────────────

export interface AtomicTask {
  id: string;
  agent: string;
  title: string;
  deps: string;
  files: string;
  status: string;
  acceptance: string;
}

/**
 * Encode SpecForge atomic task breakdown as TOON.
 */
export function encodeTaskBreakdown(tasks: AtomicTask[], projectName?: string): string {
  const data: Record<string, unknown> = { tasks };
  if (projectName) {
    data.project = projectName;
  }
  return encodeForPrompt(data, "TASK_BREAKDOWN");
}

// ── Tool Results Encoding ────────────────────────────────────────

/**
 * Encode uniform tool results (search, knowledge, etc.) as TOON.
 * Only encodes as TOON if the data is a uniform array of objects.
 */
export function encodeToolResults(results: Record<string, unknown>[]): string {
  if (results.length === 0) return "";
  return encodeForPrompt({ results });
}

// ── Team Status Encoding ─────────────────────────────────────────

export interface TeamMemberStatus {
  agent: string;
  role: string;
  status: string;
  currentTask: string;
  lastActive: string;
}

/**
 * Encode family team status as TOON for compact context injection.
 */
export function encodeTeamStatus(members: TeamMemberStatus[]): string {
  return encodeForPrompt({ team: members }, "TEAM_STATUS");
}
