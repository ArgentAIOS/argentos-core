/**
 * Argent Agent — Goal judge call
 *
 * Asks a model whether an agent's last response satisfies the standing goal.
 * Strict JSON contract: `{"done": <bool>, "reason": "<one sentence>"}`.
 *
 * Fail-open semantics (ported from Hermes' `judge_goal` / `_parse_judge_response`):
 *
 *  - API/transport errors → verdict="continue", parseFailed=false (transient).
 *  - Empty or non-JSON judge replies → verdict="continue", parseFailed=true
 *    (caller increments `consecutiveParseFailures`; auto-pause after N).
 *  - Empty agent response → verdict="continue", parseFailed=false (nothing
 *    substantive to evaluate).
 *  - Empty goal text → verdict="skipped" (caller treats as no-op).
 *
 * The judge is intentionally toolless and single-shot — it runs against the
 * same Provider+ModelConfig that the caller already has handy (v1 uses the
 * session's main provider+model; v1.1 may route via a `judge.model` config
 * knob).
 */

import type { ModelConfig, Provider, TurnRequest } from "../argent-ai/types.js";
import {
  DEFAULT_JUDGE_MAX_TOKENS,
  DEFAULT_JUDGE_TIMEOUT_MS,
  JUDGE_RESPONSE_SNIPPET_CHARS,
  JUDGE_SYSTEM_PROMPT,
  JUDGE_USER_PROMPT_TEMPLATE,
  JUDGE_USER_PROMPT_WITH_SUBGOALS_TEMPLATE,
} from "./goal-state.js";

const GOAL_TEXT_LIMIT = 2000;
const SUBGOALS_BLOCK_LIMIT = 2000;
const JSON_OBJECT_RE = /\{[\s\S]*?\}/;

export type JudgeVerdict = "done" | "continue" | "skipped";

export type JudgeResult = {
  verdict: JudgeVerdict;
  reason: string;
  /**
   * True when the judge call completed but the body wasn't valid JSON. Used by
   * the caller to maintain a consecutive-parse-failure counter so a weak judge
   * model doesn't silently burn the turn budget.
   *
   * API/transport errors return parseFailed=false — those are transient and
   * shouldn't trip the auto-pause meant for bad judge models.
   */
  parseFailed: boolean;
};

export type JudgeGoalParams = {
  /** The user's standing goal. Empty/whitespace → verdict="skipped". */
  goal: string;
  /** The agent's most recent finalized assistant text. Empty → "continue". */
  lastResponse: string;
  /** Resolved Provider instance (session's main provider for v1). */
  provider: Provider;
  /** Model config (session's main model for v1). */
  model: ModelConfig;
  /** Optional user-added /subgoal criteria (stretch). */
  subgoals?: string[];
  /** Per-call timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Override the judge max_tokens budget. Default 4096 (reasoning-safe). */
  maxTokens?: number;
  /** Abort signal honored if the underlying provider respects it. */
  signal?: AbortSignal;
};

/**
 * Truncate `text` to `limit` chars, appending an ellipsis marker.
 */
function truncate(text: string, limit: number): string {
  if (!text) {
    return "";
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}… [truncated]`;
}

/**
 * Parse the judge's reply. Fail-open to `(verdict="continue", parseFailed=true)`
 * when the reply isn't a usable JSON object with a `done` field.
 *
 * Accepts:
 *  - Bare JSON: `{"done": true, "reason": "..."}`
 *  - Markdown-fenced JSON: ```json {"done": ...} ```
 *  - Prose-prefixed JSON: "Sure, here's my verdict: {"done": ...}"
 *
 * The `done` field is liberally coerced: bool or strings like "true"/"yes"/"1"
 * count as done.
 */
export function parseJudgeResponse(raw: string): {
  done: boolean;
  reason: string;
  parseFailed: boolean;
} {
  if (!raw || !raw.trim()) {
    return { done: false, reason: "judge returned empty response", parseFailed: true };
  }

  let text = raw.trim();

  // Strip markdown code fences if present.
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "");
    text = text.trim();
  }

  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    const match = text.match(JSON_OBJECT_RE);
    if (match) {
      try {
        data = JSON.parse(match[0]);
      } catch {
        data = null;
      }
    }
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      done: false,
      reason: `judge reply was not JSON: ${truncate(raw, 200)}`,
      parseFailed: true,
    };
  }

  const obj = data as Record<string, unknown>;
  const rawDone = obj.done;
  let done: boolean;
  if (typeof rawDone === "string") {
    done = ["true", "yes", "1", "done"].includes(rawDone.trim().toLowerCase());
  } else {
    done = Boolean(rawDone);
  }

  let reason = "";
  if (typeof obj.reason === "string") {
    reason = obj.reason.trim();
  }
  if (!reason) {
    reason = "no reason provided";
  }
  return { done, reason, parseFailed: false };
}

/**
 * Ask the judge whether the goal is satisfied. Fail-open to "continue" on
 * any error — the turn budget and consecutive-parse-failures counter are the
 * backstops.
 */
export async function judgeGoal(params: JudgeGoalParams): Promise<JudgeResult> {
  const goal = (params.goal ?? "").trim();
  if (!goal) {
    return { verdict: "skipped", reason: "empty goal", parseFailed: false };
  }
  const lastResponse = (params.lastResponse ?? "").trim();
  if (!lastResponse) {
    return {
      verdict: "continue",
      reason: "empty response (nothing to evaluate)",
      parseFailed: false,
    };
  }

  const cleanSubgoals = (params.subgoals ?? [])
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);

  let userPrompt: string;
  if (cleanSubgoals.length > 0) {
    const subgoalsBlock = cleanSubgoals.map((s, i) => `- ${i + 1}. ${s}`).join("\n");
    userPrompt = JUDGE_USER_PROMPT_WITH_SUBGOALS_TEMPLATE(
      truncate(goal, GOAL_TEXT_LIMIT),
      truncate(subgoalsBlock, SUBGOALS_BLOCK_LIMIT),
      truncate(lastResponse, JUDGE_RESPONSE_SNIPPET_CHARS),
    );
  } else {
    userPrompt = JUDGE_USER_PROMPT_TEMPLATE(
      truncate(goal, GOAL_TEXT_LIMIT),
      truncate(lastResponse, JUDGE_RESPONSE_SNIPPET_CHARS),
    );
  }

  const request: TurnRequest = {
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  };

  // Apply judge-specific overrides without mutating the caller's ModelConfig.
  const modelConfig: ModelConfig = {
    ...params.model,
    temperature: 0,
    maxTokens: params.maxTokens ?? DEFAULT_JUDGE_MAX_TOKENS,
  };

  const timeoutMs = params.timeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS;

  let response;
  try {
    response = await withTimeout(params.provider.execute(request, modelConfig), timeoutMs);
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    return {
      verdict: "continue",
      reason: `judge error: ${name}`,
      parseFailed: false,
    };
  }

  if (params.signal?.aborted) {
    return { verdict: "continue", reason: "judge aborted", parseFailed: false };
  }

  if (response.stopReason === "error") {
    return {
      verdict: "continue",
      reason: `judge error: ${response.errorMessage ?? "provider error"}`,
      parseFailed: false,
    };
  }

  const raw = (response.text ?? "").trim();
  const { done, reason, parseFailed } = parseJudgeResponse(raw);
  return {
    verdict: done ? "done" : "continue",
    reason,
    parseFailed,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`goal judge timed out after ${timeoutMs}ms`);
          err.name = "JudgeTimeoutError";
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
