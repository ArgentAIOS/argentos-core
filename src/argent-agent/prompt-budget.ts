/**
 * Prompt Budget Auditor (diagnostic, opt-in)
 *
 * Purpose
 * -------
 * Track per-injector contributions to the system prompt that Argent assembles
 * for every agent turn. This is a pure measurement tool: no behavior changes,
 * no truncation, no removal. It runs only when the caller opts in by setting
 * the `ARGENT_PROMPT_BUDGET_LOG=1` environment variable.
 *
 * Why
 * ---
 * The "good morning" investigation found a 61,633-token prompt on a fresh
 * chat (~12× larger than expected). Prefill alone took 75s against the local
 * Qwen3 model. We need per-injector visibility before we can decide where to
 * trim. Once the numbers are visible, trimming is a separate task.
 *
 * How to use
 * ----------
 * Callers wrap the prompt-assembly step with `runWithPromptBudget(fn)` which
 * establishes an AsyncLocalStorage scope. Assembly code (e.g. `buildAgentSystemPrompt`
 * and `attempt.ts`) retrieves the active tracker via `getCurrentPromptBudgetTracker()`
 * and calls `record(name, content)` at each injection site.
 *
 * When logging is disabled (default), `getCurrentPromptBudgetTracker()` returns
 * undefined and all record() calls no-op via optional chaining at the call site.
 *
 * Log format
 * ----------
 *   Per-injector (when enabled):
 *     [prompt-budget] + <name> chars=<n> tokens≈<n>
 *
 *   One summary line per run:
 *     [prompt-budget] total=<tokens> chars=<n> ctx=<model> injectors=<name:tokens>,...
 *
 * Safety
 * ------
 * Only names and sizes are logged — NEVER prompt content.
 *
 * @module argent-agent/prompt-budget
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Name of the env var that enables per-turn prompt budget logging. */
export const ARGENT_PROMPT_BUDGET_LOG_ENV = "ARGENT_PROMPT_BUDGET_LOG";

/** True iff the env var is set to "1". Re-read each call so tests can toggle it. */
export function isPromptBudgetLoggingEnabled(): boolean {
  return process.env[ARGENT_PROMPT_BUDGET_LOG_ENV] === "1";
}

/** A single measured injector contribution. */
export interface PromptBudgetEntry {
  readonly name: string;
  readonly chars: number;
  /** Approximate token count: Math.ceil(chars / 4). Heuristic, not exact. */
  readonly tokens: number;
}

/**
 * Per-run tracker. Instances are scoped to one prompt assembly via
 * AsyncLocalStorage so concurrent agent runs don't cross-contaminate.
 */
export class PromptBudgetTracker {
  private entries: PromptBudgetEntry[] = [];

  /**
   * Record an injector contribution. The `content` may be a string, array of
   * strings (treated as newline-joined), or null/undefined (skipped).
   *
   * No-ops for empty content. Each accepted call also emits a per-injector
   * console log line if ARGENT_PROMPT_BUDGET_LOG=1.
   */
  record(name: string, content: string | readonly string[] | undefined | null): void {
    if (content == null) return;
    let chars: number;
    if (Array.isArray(content)) {
      // Measure as newline-joined (matches how system-prompt.ts concats lines).
      const arr = content as readonly string[];
      if (arr.length === 0) return;
      let sum = 0;
      for (const line of arr) sum += line?.length ?? 0;
      chars = sum + Math.max(arr.length - 1, 0);
    } else if (typeof content === "string") {
      chars = content.length;
    } else {
      return;
    }
    this.recordChars(name, chars);
  }

  /** Record a pre-computed char count (used when the caller already has the number). */
  recordChars(name: string, chars: number): void {
    if (!Number.isFinite(chars) || chars <= 0) return;
    const tokens = Math.ceil(chars / 4);
    this.entries.push({ name, chars, tokens });
    if (isPromptBudgetLoggingEnabled()) {
      // eslint-disable-next-line no-console
      console.log(`[prompt-budget] + ${name} chars=${chars} tokens≈${tokens}`);
    }
  }

  getEntries(): readonly PromptBudgetEntry[] {
    return this.entries;
  }

  totalChars(): number {
    let sum = 0;
    for (const e of this.entries) sum += e.chars;
    return sum;
  }

  totalTokens(): number {
    let sum = 0;
    for (const e of this.entries) sum += e.tokens;
    return sum;
  }

  /**
   * Emit the final one-line summary. Callers typically invoke this right before
   * the first model call, passing the model label and the overall prompt size
   * (system prompt + tools + history) so the log captures end-to-end context.
   */
  logSummary(opts?: {
    model?: string;
    /** Overall chars sent to the model (may exceed sum of tracked entries). */
    totalChars?: number;
  }): void {
    if (!isPromptBudgetLoggingEnabled()) return;
    if (this.entries.length === 0) return;
    const injectorSummary = this.entries.map((e) => `${e.name}:${e.tokens}`).join(",");
    const totalChars = opts?.totalChars ?? this.totalChars();
    const totalTokens =
      opts?.totalChars != null ? Math.ceil(opts.totalChars / 4) : this.totalTokens();
    // eslint-disable-next-line no-console
    console.log(
      `[prompt-budget] total=${totalTokens} chars=${totalChars} ctx=${
        opts?.model ?? "unknown"
      } injectors=${injectorSummary}`,
    );
  }
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage plumbing — scopes one tracker to one assembly
// ---------------------------------------------------------------------------

const storage = new AsyncLocalStorage<PromptBudgetTracker>();

/**
 * Retrieve the current prompt-budget tracker, if any. Returns undefined when
 * logging is disabled or no scope is active. Call sites should use optional
 * chaining: `getCurrentPromptBudgetTracker()?.record("name", str)`.
 */
export function getCurrentPromptBudgetTracker(): PromptBudgetTracker | undefined {
  if (!isPromptBudgetLoggingEnabled()) return undefined;
  return storage.getStore();
}

/**
 * Establish a new tracker scope and run `fn` inside it. Returns both the
 * function result and the tracker so the caller can emit the summary and
 * record additional post-assembly sections (e.g., tool schemas).
 *
 * When logging is disabled, this still runs the function but the tracker is
 * an inert instance — getCurrentPromptBudgetTracker() will return undefined
 * so record() calls are all skipped.
 */
export async function runWithPromptBudget<T>(
  fn: (tracker: PromptBudgetTracker) => Promise<T>,
): Promise<{ result: T; tracker: PromptBudgetTracker }> {
  const tracker = new PromptBudgetTracker();
  const result = await storage.run(tracker, () => fn(tracker));
  return { result, tracker };
}
