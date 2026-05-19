/**
 * ModelHealthTracker
 *
 * Tracks per-model empty-response failures over a sliding window so the
 * routing engine can de-prioritize models that have recently flaked.
 *
 * Background: PR #279 (closes #254) added a reactive retry-fallback path
 * when `zai/glm-5*` returns empty content. PR #289 (closes #280) added an
 * adapter-layer `reasoning_content` extraction. This tracker is the
 * proactive piece — once a model exceeds the empty-response threshold in
 * the recent window, downstream routing should prefer alternates.
 *
 * Design:
 *   - In-memory only. Process-local singleton. Restart resets state.
 *     (Per #281: "no persistence layer" — flake state is short-lived signal.)
 *   - Per-model ring buffer of recent outcomes ("empty" | "ok").
 *   - Threshold + window tunable via env vars.
 *   - Recovery: a successful (non-empty) call **resets** the buffer for
 *     that model. Models recover quickly once they stop flaking.
 *   - Never blocks a model — only signals "flaking". The routing engine
 *     decides whether to prefer an alternate. User can still pick the
 *     model explicitly.
 *
 * Env vars:
 *   ARGENT_ROUTING_EMPTY_WINDOW       — sliding-window size (default 10)
 *   ARGENT_ROUTING_EMPTY_THRESHOLD    — empty count at which the model is
 *                                       considered flaking (default 3)
 */

export type ModelHealthOutcome = "empty" | "ok";

const DEFAULT_WINDOW = 10;
const DEFAULT_THRESHOLD = 3;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function readEnvConfig(): { window: number; threshold: number } {
  const window = parsePositiveInt(process.env.ARGENT_ROUTING_EMPTY_WINDOW, DEFAULT_WINDOW);
  const threshold = parsePositiveInt(process.env.ARGENT_ROUTING_EMPTY_THRESHOLD, DEFAULT_THRESHOLD);
  // threshold cannot exceed window — clamp to window so a single window of
  // all-empty calls is always sufficient to trip the flag.
  return { window, threshold: Math.min(threshold, window) };
}

function normalizeKey(provider: string, modelId: string): string {
  return `${String(provider ?? "")
    .trim()
    .toLowerCase()}/${String(modelId ?? "")
    .trim()
    .toLowerCase()}`;
}

export type ModelHealthTrackerOptions = {
  /** Sliding-window size (default: 10 or ARGENT_ROUTING_EMPTY_WINDOW). */
  window?: number;
  /** Empty-count threshold at which the model is considered flaking (default: 3 or ARGENT_ROUTING_EMPTY_THRESHOLD). */
  threshold?: number;
};

export class ModelHealthTracker {
  private readonly window: number;
  private readonly threshold: number;
  private readonly buffers = new Map<string, ModelHealthOutcome[]>();

  constructor(opts: ModelHealthTrackerOptions = {}) {
    const envCfg = readEnvConfig();
    const window = opts.window ?? envCfg.window;
    const threshold = opts.threshold ?? envCfg.threshold;
    this.window = Math.max(1, window);
    // threshold > window means "never trip" — clamp into a sensible range.
    this.threshold = Math.max(1, Math.min(threshold, this.window));
  }

  /** Record an observed call outcome for a given provider/model. */
  recordOutcome(provider: string, modelId: string, outcome: ModelHealthOutcome): void {
    if (!provider || !modelId) return;
    const key = normalizeKey(provider, modelId);
    // Recovery: a single successful (non-empty) call resets the counter.
    if (outcome === "ok") {
      if (this.buffers.has(key)) {
        this.buffers.delete(key);
      }
      return;
    }
    const buf = this.buffers.get(key) ?? [];
    buf.push(outcome);
    if (buf.length > this.window) {
      buf.splice(0, buf.length - this.window);
    }
    this.buffers.set(key, buf);
  }

  /** Number of "empty" outcomes recorded in the current window. */
  getEmptyCount(provider: string, modelId: string): number {
    if (!provider || !modelId) return 0;
    const buf = this.buffers.get(normalizeKey(provider, modelId));
    if (!buf) return 0;
    let count = 0;
    for (const entry of buf) {
      if (entry === "empty") count++;
    }
    return count;
  }

  /**
   * Returns true if the model has exceeded the empty-response threshold in
   * the current sliding window.
   */
  isFlaking(provider: string, modelId: string): boolean {
    return this.getEmptyCount(provider, modelId) >= this.threshold;
  }

  /** Clear tracker state. Mainly useful for tests. */
  reset(): void {
    this.buffers.clear();
  }

  /** Inspect current thresholds (for diagnostics / tests). */
  getConfig(): { window: number; threshold: number } {
    return { window: this.window, threshold: this.threshold };
  }

  /** Snapshot keys currently tracked (diagnostics / tests). */
  snapshotKeys(): string[] {
    return Array.from(this.buffers.keys());
  }
}

let _singleton: ModelHealthTracker | null = null;

/**
 * Process-local singleton tracker. The routing engine and the agent runner
 * share this instance so observations flow from one to the other without a
 * persistence layer.
 */
export function getModelHealthTracker(): ModelHealthTracker {
  if (!_singleton) {
    _singleton = new ModelHealthTracker();
  }
  return _singleton;
}

/** Replace the singleton (testing only). */
export function __setModelHealthTrackerForTests(tracker: ModelHealthTracker | null): void {
  _singleton = tracker;
}
