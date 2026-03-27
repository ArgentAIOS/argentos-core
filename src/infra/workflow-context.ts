/**
 * Workflow Context Builder — TOON-encoded prompt injection for agent steps.
 *
 * When an agent node executes within a workflow pipeline, it needs to know:
 * - What workflow it's part of and where it is in the pipeline
 * - What previous steps have produced (summarized)
 * - What its specific task is
 *
 * This module builds that context and encodes it as TOON for ~40% token
 * savings compared to JSON or verbose text.
 *
 * @see docs/argent/WORKFLOWS_ARCHITECTURE.md — "Context Injection via TOON"
 * @module infra/workflow-context
 */

import type { PipelineContext, AgentConfig, ItemSet, StepRecord } from "./workflow-types.js";
import { encodePipelineContext } from "../utils/toon-encoding.js";

/** Maximum characters for a step output summary before truncation. */
const MAX_OUTPUT_SUMMARY_CHARS = 500;

/** Maximum characters for artifact title in summaries. */
const MAX_ARTIFACT_TITLE_CHARS = 80;

/**
 * Build the TOON-encoded prompt for an agent step, injecting pipeline context.
 *
 * The resulting string is prepended to the agent's conversation as system-level
 * context so the agent understands its position in the pipeline and what
 * previous steps have produced.
 */
export function buildAgentStepPrompt(agentConfig: AgentConfig, context: PipelineContext): string {
  const toonContext = encodePipelineContext({
    workflow: {
      id: context.workflowId,
      name: context.workflowName,
      runId: context.runId,
      currentStep: context.currentStepIndex,
      totalSteps: context.totalSteps,
    },
    steps: context.history.map((s) => ({
      step: s.stepIndex,
      agent: s.agentId ?? s.nodeKind,
      status: s.status,
      duration: formatDuration(s.durationMs),
      output: summarizeOutput(s.output),
      artifact: extractFirstArtifactId(s),
    })),
    task: agentConfig.rolePrompt,
    variables: Object.keys(context.variables).length > 0 ? context.variables : undefined,
  });

  return toonContext;
}

/**
 * Build a retry-aware prompt that includes attempt information.
 * Used when a step is retried after failure.
 */
export function buildRetryPrompt(
  agentConfig: AgentConfig,
  context: PipelineContext,
  retryAttempt: number,
  previousError?: string,
): string {
  const basePrompt = buildAgentStepPrompt(agentConfig, context);
  const retryNotice = [
    `\n[RETRY_CONTEXT]`,
    `attempt: ${retryAttempt}`,
    previousError ? `previousError: ${truncate(previousError, 300)}` : "",
    `hint: Adjust your approach based on the previous failure.`,
    `[/RETRY_CONTEXT]`,
  ]
    .filter(Boolean)
    .join("\n");

  return basePrompt + retryNotice;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Summarize an ItemSet's text output for context injection.
 * Truncates long responses to keep token usage bounded.
 */
function summarizeOutput(output: ItemSet): string {
  if (output.items.length === 0) return "(no output)";

  const texts: string[] = [];
  for (const item of output.items) {
    if (item.text) {
      texts.push(item.text);
    } else if (Object.keys(item.json).length > 0) {
      // For structured data, summarize key names and values
      const keys = Object.keys(item.json);
      const preview = keys.slice(0, 5).map((k) => {
        const v = item.json[k];
        const vs = typeof v === "string" ? truncate(v, 60) : String(v);
        return `${k}: ${vs}`;
      });
      if (keys.length > 5) preview.push(`... +${keys.length - 5} fields`);
      texts.push(preview.join(", "));
    }
  }

  const combined = texts.join(" | ");
  return truncate(combined, MAX_OUTPUT_SUMMARY_CHARS);
}

/**
 * Extract the first artifact ID from a step record for the summary table.
 */
function extractFirstArtifactId(step: StepRecord): string {
  for (const item of step.output.items) {
    if (item.artifacts && item.artifacts.length > 0) {
      const a = item.artifacts[0];
      const label = a.title ? truncate(a.title, MAX_ARTIFACT_TITLE_CHARS) : a.id;
      return `${a.type}:${label}`;
    }
  }
  return "";
}

/**
 * Format duration in human-readable form for step summaries.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return remainSecs > 0 ? `${mins}m${remainSecs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hours}h${remainMins}m` : `${hours}h`;
}

/**
 * Truncate a string with ellipsis if it exceeds maxLen.
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

export { formatDuration, summarizeOutput, truncate };
