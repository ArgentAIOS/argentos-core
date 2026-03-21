/**
 * Tool Loop Detector
 *
 * Detects when an agent gets stuck calling the same tool repeatedly with
 * identical arguments. Tracks fingerprints in a sliding window and escalates
 * from warning to abort.
 *
 * @module agents/tool-loop-detector
 */

export interface ToolLoopConfig {
  enabled?: boolean;
  /** Consecutive identical calls before warning (default: 3). */
  threshold?: number;
  /** Consecutive identical calls before abort (default: 7). */
  abortThreshold?: number;
  /** Initial backoff delay in ms (default: 1000). */
  initialBackoffMs?: number;
  /** Backoff multiplier (default: 2.0). */
  backoffMultiplier?: number;
  /** Max backoff delay in ms (default: 30000). */
  maxBackoffMs?: number;
  /** Tools excluded from detection (default: ["read"]). */
  excludeTools?: string[];
  /** Sliding window size for fingerprint tracking (default: 20). */
  windowSize?: number;
  /**
   * Tools that should only run once per detector lifecycle (typically one run/session).
   * A second invocation aborts immediately, regardless of args.
   */
  singleAttemptTools?: string[];
  /**
   * Per-tool call budget per run, regardless of args.
   * Prevents the agent from calling the same tool many times with different args
   * (e.g., web_fetch with 8 different URLs in one turn).
   * Default: { web_fetch: 4, web_search: 3, exec: 5 }
   */
  perToolBudget?: Record<string, number>;
}

export type LoopAction =
  | { action: "allow" }
  | { action: "delay"; delayMs: number; count: number; toolName: string }
  | { action: "abort"; count: number; toolName: string };

const DEFAULT_PER_TOOL_BUDGET: Record<string, number> = {
  web_fetch: 4,
  web_search: 3,
  exec: 5,
};

const DEFAULT_CONFIG: Required<ToolLoopConfig> = {
  enabled: true,
  threshold: 3,
  abortThreshold: 7,
  initialBackoffMs: 1000,
  backoffMultiplier: 2.0,
  maxBackoffMs: 30000,
  excludeTools: ["read"],
  windowSize: 20,
  // Expensive multi-provider media generation should not re-run in the same cycle.
  singleAttemptTools: ["music_generate"],
  perToolBudget: DEFAULT_PER_TOOL_BUDGET,
};

export class ToolLoopDetector {
  private readonly config: Required<ToolLoopConfig>;
  private readonly window: string[] = [];
  private readonly toolCallCounts = new Map<string, number>();
  private consecutiveCount = 0;
  private lastFingerprint: string | null = null;

  constructor(config?: ToolLoopConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check whether a tool call should be allowed, delayed, or aborted.
   */
  check(toolName: string, args: unknown): LoopAction {
    if (!this.config.enabled) {
      return { action: "allow" };
    }

    const normalized = toolName.trim().toLowerCase();

    // Hard one-shot guard for selected tools.
    if (this.config.singleAttemptTools.includes(normalized)) {
      const nextCount = (this.toolCallCounts.get(normalized) ?? 0) + 1;
      this.toolCallCounts.set(normalized, nextCount);
      if (nextCount > 1) {
        return {
          action: "abort",
          count: nextCount,
          toolName: normalized,
        };
      }
      // First call is allowed — return early to skip budget/fingerprint tracking.
      return { action: "allow" };
    }

    if (this.config.excludeTools.includes(normalized)) {
      return { action: "allow" };
    }

    // Per-tool call budget: cap total calls regardless of args.
    // Prevents the agent from calling the same tool many times with different
    // args (e.g., web_fetch with 8 different URLs in one turn).
    const totalCount = (this.toolCallCounts.get(normalized) ?? 0) + 1;
    this.toolCallCounts.set(normalized, totalCount);
    const budget = this.config.perToolBudget[normalized];
    if (budget !== undefined && totalCount > budget) {
      return {
        action: "abort",
        count: totalCount,
        toolName: normalized,
      };
    }

    const fingerprint = `${normalized}:${stableStringify(args)}`;

    // Maintain sliding window
    this.window.push(fingerprint);
    if (this.window.length > this.config.windowSize) {
      this.window.shift();
    }

    // Track consecutive identical calls
    if (fingerprint === this.lastFingerprint) {
      this.consecutiveCount++;
    } else {
      this.consecutiveCount = 1;
      this.lastFingerprint = fingerprint;
    }

    if (this.consecutiveCount >= this.config.abortThreshold) {
      return {
        action: "abort",
        count: this.consecutiveCount,
        toolName: normalized,
      };
    }

    if (this.consecutiveCount >= this.config.threshold) {
      const exponent = this.consecutiveCount - this.config.threshold;
      const delayMs = Math.min(
        this.config.initialBackoffMs * Math.pow(this.config.backoffMultiplier, exponent),
        this.config.maxBackoffMs,
      );
      return {
        action: "delay",
        delayMs,
        count: this.consecutiveCount,
        toolName: normalized,
      };
    }

    return { action: "allow" };
  }

  /** Reset detector state (e.g., on new session). */
  reset(): void {
    this.window.length = 0;
    this.toolCallCounts.clear();
    this.consecutiveCount = 0;
    this.lastFingerprint = null;
  }
}

/** Deterministic JSON serialization for fingerprinting. */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value !== "object") {
    return String(value);
  }
  try {
    const sorted = JSON.stringify(value, Object.keys(value as object).toSorted());
    return sorted;
  } catch {
    return String(value);
  }
}
