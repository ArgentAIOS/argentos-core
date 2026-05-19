/**
 * SIS Self-Evaluation — Agent evaluates its own response quality.
 *
 * After each successful agent response, runs a brief self-eval using:
 *   1. Ollama (local, free) — primary
 *   2. Haiku (Anthropic API) — fallback if Ollama unavailable
 *
 * Scores feed into model_feedback records and lesson confidence adjustments.
 * Entirely non-blocking — failures are silently ignored.
 */

import { resolveArgentAgentDir } from "../agents/agent-paths.js";
import { ensureAuthProfileStore, isProviderInCooldown } from "../agents/auth-profiles.js";
import { getMemoryAdapter } from "../data/storage-factory.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getActiveLessons } from "./sis-active-lessons.js";

const log = createSubsystemLogger("gateway/sis-self-eval");

const OLLAMA_CHAT_URL = "http://127.0.0.1:11434/api/chat";
const OLLAMA_EVAL_MODEL = "qwen3:1.7b";
const OLLAMA_TIMEOUT_MS = 10_000;
const HAIKU_TIMEOUT_MS = 12_000;
const HAIKU_MODEL = "claude-haiku-4-5";

const EVAL_SYSTEM_PROMPT =
  "You evaluate AI agent responses for quality. " +
  "Score 1-5 (1=poor, 2=below average, 3=adequate, 4=good, 5=excellent). " +
  "Consider: accuracy, helpfulness, completeness, and appropriateness. " +
  "Output ONLY this format on two lines:\nSCORE: <number>\nREASON: <one sentence>";

function buildEvalUserPrompt(userPrompt: string, agentResponse: string): string {
  // Truncate to keep eval lightweight
  const p = userPrompt.length > 500 ? userPrompt.slice(0, 500) + "..." : userPrompt;
  const r = agentResponse.length > 1000 ? agentResponse.slice(0, 1000) + "..." : agentResponse;
  return `User prompt: ${p}\n\nAgent response: ${r}\n\nRate the quality of this response.`;
}

interface SelfEvalResult {
  score: number; // 1-5
  reasoning: string;
  source: "ollama" | "haiku";
  durationMs: number;
}

function parseEvalResponse(text: string): { score: number; reasoning: string } | null {
  // Try SCORE: N / REASON: ... format
  const scoreMatch = text.match(/SCORE:\s*(\d(?:\.\d)?)/i);
  const reasonMatch = text.match(/REASON:\s*(.+)/i);
  if (scoreMatch) {
    const score = parseFloat(scoreMatch[1]);
    if (score >= 1 && score <= 5) {
      return {
        score: Math.round(score * 10) / 10,
        reasoning: reasonMatch?.[1]?.trim() ?? "No reasoning provided",
      };
    }
  }
  // Fallback: look for any number 1-5 at start
  const numMatch = text.trim().match(/^(\d(?:\.\d)?)/);
  if (numMatch) {
    const score = parseFloat(numMatch[1]);
    if (score >= 1 && score <= 5) {
      return { score, reasoning: text.trim() };
    }
  }
  return null;
}

async function evalWithOllama(
  userPrompt: string,
  agentResponse: string,
): Promise<SelfEvalResult | null> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

    const res = await fetch(OLLAMA_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_EVAL_MODEL,
        messages: [
          { role: "system", content: EVAL_SYSTEM_PROMPT },
          { role: "user", content: buildEvalUserPrompt(userPrompt, agentResponse) },
        ],
        stream: false,
        think: false,
        options: { temperature: 0.3, num_predict: 80 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as { message?: { content?: string } };
    const text = data.message?.content?.trim();
    if (!text) return null;

    const parsed = parseEvalResponse(text);
    if (!parsed) return null;

    return {
      score: parsed.score,
      reasoning: parsed.reasoning,
      source: "ollama",
      durationMs: Date.now() - start,
    };
  } catch {
    return null;
  }
}

async function evalWithHaiku(
  userPrompt: string,
  agentResponse: string,
): Promise<SelfEvalResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HAIKU_TIMEOUT_MS);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 80,
        system: EVAL_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildEvalUserPrompt(userPrompt, agentResponse) }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text?.trim();
    if (!text) return null;

    const parsed = parseEvalResponse(text);
    if (!parsed) return null;

    return {
      score: parsed.score,
      reasoning: parsed.reasoning,
      source: "haiku",
      durationMs: Date.now() - start,
    };
  } catch {
    return null;
  }
}

export interface SelfEvalParams {
  userPrompt: string;
  agentResponse: string;
  sessionKey: string;
  modelFeedbackId?: string;
}

/**
 * Run self-evaluation on an agent response. Tries Ollama first, falls back to Haiku.
 * Updates model_feedback with the score and adjusts lesson confidence.
 * Fire-and-forget — never throws.
 */
export async function runSelfEvaluation(params: SelfEvalParams): Promise<void> {
  try {
    // Try Ollama first. Fall back to Haiku only when Anthropic isn't in provider cooldown.
    const ollamaResult = await evalWithOllama(params.userPrompt, params.agentResponse);
    const authStore = ensureAuthProfileStore(resolveArgentAgentDir(), {
      allowKeychainPrompt: false,
    });
    const skipHaiku = isProviderInCooldown(authStore, "anthropic");
    const result =
      ollamaResult ??
      (skipHaiku ? null : await evalWithHaiku(params.userPrompt, params.agentResponse));

    if (!result) {
      log.debug(
        `self-eval: ${skipHaiku ? "haiku skipped (provider cooldown) and ollama unavailable" : "both Ollama and Haiku unavailable"}, skipping`,
      );
      return;
    }

    log.info(
      `[SIS] Self-eval: score=${result.score} source=${result.source} ` +
        `duration=${result.durationMs}ms session=${params.sessionKey}`,
    );

    const store = await getMemoryAdapter();

    // Update model_feedback record with self-eval score
    const feedbackId =
      params.modelFeedbackId ?? (await store.getLatestModelFeedbackId(params.sessionKey));
    if (feedbackId) {
      await store.updateModelFeedbackSelfEval(feedbackId, result.score, result.reasoning);
    }

    // Adjust lesson confidence based on self-eval score
    const activeLessonIds = getActiveLessons(params.sessionKey);
    if (activeLessonIds.length > 0) {
      if (result.score >= 4) {
        // Good response — reinforce active lessons
        for (const id of activeLessonIds) {
          await store.reinforceLesson(id);
        }
        log.debug(
          `[SIS] Self-eval: reinforced ${activeLessonIds.length} lesson(s) (score=${result.score})`,
        );
      } else if (result.score <= 2) {
        // Poor response — decay active lessons slightly
        for (const id of activeLessonIds) {
          await store.decayLesson(id, 0.03);
        }
        log.debug(
          `[SIS] Self-eval: decayed ${activeLessonIds.length} lesson(s) (score=${result.score})`,
        );
      }
      // Score 3 = neutral, no adjustment
    }
  } catch (err) {
    log.debug("self-eval: error (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
