/**
 * Heartbeat Verification Sidecar — "The Angel on the Shoulder"
 *
 * After the agent produces a heartbeat response, this module sends the
 * (task contract + response) to a lightweight verifier (local Ollama or Haiku)
 * to check whether each task was actually completed.
 *
 * The agent doesn't control this — the harness owns completion.
 *
 * Flow:
 *   1. Agent executes heartbeat, produces response text
 *   2. Verifier receives (contract tasks + response text)
 *   3. Verifier returns per-task verdicts: verified / not_verified / unclear
 *   4. Heartbeat runner uses verdicts to update progress + decide re-queue
 */

import type { HeartbeatContract, HeartbeatProgress, HeartbeatTask } from "./heartbeat-contract.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("heartbeat/verifier");

// ── Types ──────────────────────────────────────────────────────────────────

export interface TaskVerdict {
  taskId: string;
  status: "verified" | "not_verified" | "unclear";
  quality: "substantive" | "shallow" | "none";
  reason: string;
}

export interface VerificationResult {
  verdicts: TaskVerdict[];
  model: string;
  durationMs: number;
}

// ── Ollama / Haiku Verification ────────────────────────────────────────────

const OLLAMA_URL = "http://127.0.0.1:11434/v1/chat/completions";
// Default to a tiny model for verification — binary classification doesn't need 30B.
// Override via config: agents.defaults.heartbeat.verifier.model
const DEFAULT_OLLAMA_VERIFIER_MODEL = "qwen3:1.7b";
let ollamaVerifierModel = DEFAULT_OLLAMA_VERIFIER_MODEL;

/** Override the Ollama model used for verification. */
export function setVerifierModel(model: string): void {
  ollamaVerifierModel = model;
}

const VERIFICATION_SYSTEM_PROMPT = `You are a task verification auditor. You receive a list of tasks and an agent's response. For each task, determine if the agent actually completed it AND whether the output contains substantive findings.

Reply ONLY with a JSON array of verdicts. No other text.

Each verdict: {"taskId": "...", "status": "verified"|"not_verified"|"unclear", "quality": "substantive"|"shallow"|"none", "reason": "brief explanation"}

## Status rules:
- "verified": Clear evidence the task was done (tool was called, result was reported, action was taken)
- "not_verified": No evidence the task was done, or the agent only mentioned it without doing it
- "unclear": Ambiguous — partial evidence or can't determine from the response alone
- Be strict: saying "I'll check X" is NOT the same as having checked X
- Evidence includes: tool call results, specific data retrieved, actions taken, content created
- CRITICAL: If GROUND TRUTH data is provided, it overrides the agent's claims. If the agent says "0 messages" but ground truth shows unread messages, mark as "not_verified".

## Quality rules (OUTPUT QUALITY GATE):
- "substantive": Output contains SPECIFIC findings — named entities (companies, people, products), real numbers/statistics, URLs, dates, quotes from sources, or concrete actionable items unique to the query
- "shallow": Tools were called but output is GENERIC — vague summaries anyone could write without research (e.g., "Many companies are adopting AI", "The market is growing rapidly"), no specific data points, no named sources
- "none": No meaningful output produced for this task

CRITICAL QUALITY RULE: If a task involved research/search and the output contains ONLY generic platitudes with no specific data points, names, or numbers, mark quality as "shallow" even if tools were technically called. Calling web_search and then writing "AI is transforming industries" without citing specific findings = shallow.

A task with status "verified" but quality "shallow" means the agent went through the motions but didn't produce real value. This should be flagged.`;

function buildVerificationPrompt(
  tasks: HeartbeatTask[],
  agentResponse: string,
  groundTruth?: string,
): string {
  const taskList = tasks
    .map(
      (t) =>
        `- ${t.id}: "${t.action}" [${t.required ? "REQUIRED" : "optional"}] verify: ${t.verification}`,
    )
    .join("\n");

  const groundTruthSection = groundTruth ? `\n${groundTruth}\n` : "";

  return `## Tasks to verify:
${taskList}
${groundTruthSection}
## Agent's response:
${agentResponse}

Return JSON array of verdicts for each task.`;
}

/**
 * Call local Ollama for verification. Returns null if Ollama is unavailable.
 */
async function verifyWithOllama(
  tasks: HeartbeatTask[],
  agentResponse: string,
  groundTruth?: string,
): Promise<VerificationResult | null> {
  const startMs = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout

    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaVerifierModel,
        messages: [
          { role: "system", content: VERIFICATION_SYSTEM_PROMPT },
          { role: "user", content: buildVerificationPrompt(tasks, agentResponse, groundTruth) },
        ],
        temperature: 0.1, // Low temp for consistent classification
        max_tokens: 1024,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      log.warn("verifier: Ollama returned non-OK", { status: res.status });
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      log.warn("verifier: Ollama returned empty content");
      return null;
    }

    const verdicts = parseVerdicts(content, tasks);
    return {
      verdicts,
      model: `ollama/${ollamaVerifierModel}`,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("ECONNREFUSED")) {
      log.debug("verifier: Ollama not available", { reason: msg });
    } else {
      log.warn("verifier: Ollama error", { error: msg });
    }
    return null;
  }
}

/**
 * Fallback: call Anthropic Haiku for verification.
 * Requires ANTHROPIC_API_KEY in environment.
 */
async function verifyWithHaiku(
  tasks: HeartbeatTask[],
  agentResponse: string,
  groundTruth?: string,
): Promise<VerificationResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log.debug("verifier: No ANTHROPIC_API_KEY for Haiku fallback");
    return null;
  }

  const startMs = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: VERIFICATION_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: buildVerificationPrompt(tasks, agentResponse, groundTruth) },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      log.warn("verifier: Haiku returned non-OK", { status: res.status });
      return null;
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const content = data.content?.find((c) => c.type === "text")?.text?.trim();
    if (!content) {
      log.warn("verifier: Haiku returned empty content");
      return null;
    }

    const verdicts = parseVerdicts(content, tasks);
    return {
      verdicts,
      model: "anthropic/claude-haiku-4-5",
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("verifier: Haiku error", { error: msg });
    return null;
  }
}

// ── Parsing ────────────────────────────────────────────────────────────────

/**
 * Parse the verifier's JSON response into verdicts.
 * Handles malformed JSON gracefully.
 */
function parseVerdicts(raw: string, tasks: HeartbeatTask[]): TaskVerdict[] {
  // Extract JSON array from response (may have surrounding text)
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    log.warn("verifier: could not extract JSON array from response");
    // Fall back: mark all as unclear
    return tasks.map((t) => ({
      taskId: t.id,
      status: "unclear" as const,
      quality: "none" as const,
      reason: "Verifier response was not valid JSON",
    }));
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      taskId?: string;
      task_id?: string;
      status?: string;
      quality?: string;
      reason?: string;
    }>;

    const validStatuses = new Set(["verified", "not_verified", "unclear"]);
    const validQualities = new Set(["substantive", "shallow", "none"]);
    const taskIds = new Set(tasks.map((t) => t.id));

    return parsed
      .map((v) => {
        const taskId = v.taskId || v.task_id || "";
        const status = validStatuses.has(v.status ?? "") ? v.status! : "unclear";
        const quality = validQualities.has(v.quality ?? "") ? v.quality! : "none";

        // Quality gate: if tools were called but output is shallow, downgrade to not_verified
        const effectiveStatus =
          status === "verified" && quality === "shallow" ? "not_verified" : status;
        const effectiveReason =
          status === "verified" && quality === "shallow"
            ? `QUALITY GATE: ${v.reason || "Output is generic despite tool usage"}`
            : v.reason || "No reason provided";

        return {
          taskId,
          status: effectiveStatus as TaskVerdict["status"],
          quality: quality as TaskVerdict["quality"],
          reason: effectiveReason,
        };
      })
      .filter((v) => taskIds.has(v.taskId));
  } catch {
    log.warn("verifier: JSON parse failed", { raw: raw.slice(0, 200) });
    return tasks.map((t) => ({
      taskId: t.id,
      status: "unclear" as const,
      quality: "none" as const,
      reason: "Verifier response JSON parse failed",
    }));
  }
}

// ── Logging ───────────────────────────────────────────────────────────────

function logVerificationResult(
  backend: string,
  result: VerificationResult,
  taskCount: number,
): void {
  const verified = result.verdicts.filter((v) => v.status === "verified").length;
  const qualityGated = result.verdicts.filter(
    (v) => v.quality === "shallow" && v.reason.startsWith("QUALITY GATE:"),
  ).length;
  const substantive = result.verdicts.filter((v) => v.quality === "substantive").length;

  log.info(`verifier: completed via ${backend}`, {
    taskCount,
    durationMs: result.durationMs,
    verified,
    substantive,
    qualityGated,
  });

  if (qualityGated > 0) {
    log.warn(
      `verifier: ${qualityGated} task(s) downgraded by quality gate (shallow output despite tool usage)`,
    );
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Verify the agent's heartbeat response against the task contract.
 * Tries Ollama first (free, local), falls back to Haiku.
 * Returns null if no verifier is available (graceful degradation).
 */
export async function verifyHeartbeatResponse(
  contract: HeartbeatContract,
  progress: HeartbeatProgress,
  agentResponse: string,
  groundTruth?: string,
): Promise<VerificationResult | null> {
  // Only verify pending/retryable tasks
  const tasksToVerify = contract.tasks.filter((t) => {
    const tp = progress.tasks[t.id];
    return !tp || tp.status === "pending" || tp.status === "failed";
  });

  if (tasksToVerify.length === 0) {
    log.debug("verifier: no tasks to verify");
    return { verdicts: [], model: "none", durationMs: 0 };
  }

  // Try Ollama first (free)
  const ollamaResult = await verifyWithOllama(tasksToVerify, agentResponse, groundTruth);
  if (ollamaResult) {
    logVerificationResult("Ollama", ollamaResult, tasksToVerify.length);
    return ollamaResult;
  }

  // Fall back to Haiku
  const haikuResult = await verifyWithHaiku(tasksToVerify, agentResponse, groundTruth);
  if (haikuResult) {
    logVerificationResult("Haiku", haikuResult, tasksToVerify.length);
    return haikuResult;
  }

  log.warn("verifier: no verification backend available — passing through");
  return null;
}

/**
 * Apply verification verdicts to the progress tracker.
 * Updates task statuses based on verifier output.
 */
export function applyVerdicts(
  progress: HeartbeatProgress,
  verdicts: TaskVerdict[],
): HeartbeatProgress {
  const updated = { ...progress, tasks: { ...progress.tasks } };

  for (const verdict of verdicts) {
    const existing = updated.tasks[verdict.taskId];
    if (!existing) continue;

    if (verdict.status === "verified") {
      updated.tasks[verdict.taskId] = {
        ...existing,
        status: "verified",
        lastAttemptAt: Date.now(),
        lastResult: verdict.reason,
      };
    } else if (verdict.status === "not_verified") {
      updated.tasks[verdict.taskId] = {
        ...existing,
        status: "failed",
        attempts: existing.attempts + 1,
        lastAttemptAt: Date.now(),
        lastResult: verdict.reason,
      };
    }
    // "unclear" — leave status as-is, count the attempt
    else {
      updated.tasks[verdict.taskId] = {
        ...existing,
        attempts: existing.attempts + 1,
        lastAttemptAt: Date.now(),
        lastResult: verdict.reason,
      };
    }
  }

  return updated;
}
