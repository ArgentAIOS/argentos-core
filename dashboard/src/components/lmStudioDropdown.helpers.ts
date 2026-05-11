/**
 * GH #220 — pure helpers for the local-model dropdown.
 *
 * The dropdown distinguishes LM Studio models that are currently resident in
 * memory (`loaded === true`) from registered-but-not-loaded models
 * (`loaded === false`) so users don't accidentally trigger a slow on-demand
 * load (15–25 GB allocation, several-second latency, possible OOM under
 * memory pressure).
 *
 * This module isolates the partitioning + warning logic from the JSX render
 * so it can be unit-tested in vitest without spinning up jsdom.
 */

export interface LocalRuntimeModel {
  id: string;
  ref: string;
  label: string;
  /**
   * `true` → currently loaded in memory (resident).
   * `false` → registered but not loaded; selecting will trigger on-demand load.
   * `null`/`undefined` → unknown state (legacy /v1/models endpoint).
   */
  loaded?: boolean | null;
}

export interface LocalRuntime {
  provider: string;
  label: string;
  running: boolean;
  baseUrl?: string;
  /** `"v0"` when /api/v0/models was used (load state is trustworthy). */
  source?: "v0" | "v1" | null;
  models: LocalRuntimeModel[];
}

export interface PartitionedRuntime {
  /** Models currently in memory — safe to pick without any load cost. */
  loaded: LocalRuntimeModel[];
  /** Registered but not loaded — picking triggers on-demand load. */
  unloaded: LocalRuntimeModel[];
  /** Load state unknown (legacy endpoint or non-LM-Studio runtimes). */
  unknown: LocalRuntimeModel[];
  /**
   * True only when the runtime has a trustworthy load-state signal AND there
   * is at least one model whose state we know. Falls back to false for v1
   * legacy responses (which only see "registered" models) and for Ollama
   * (whose probe surface doesn't distinguish loaded vs disk-resident).
   */
  hasLoadStateSignal: boolean;
}

/**
 * Split a runtime's models into loaded / unloaded / unknown buckets and decide
 * whether the UI should render the loaded-vs-not-loaded distinction.
 *
 * The `hasLoadStateSignal` flag is what the dropdown should branch on:
 *  - `true` → render two optgroups ("Loaded in memory", "Loads on demand")
 *  - `false` → render the legacy flat list (no state badges)
 */
export function partitionRuntimeByLoadState(runtime: LocalRuntime): PartitionedRuntime {
  const loaded: LocalRuntimeModel[] = [];
  const unloaded: LocalRuntimeModel[] = [];
  const unknown: LocalRuntimeModel[] = [];
  for (const m of runtime.models) {
    if (m.loaded === true) {
      loaded.push(m);
    } else if (m.loaded === false) {
      unloaded.push(m);
    } else {
      unknown.push(m);
    }
  }
  const hasLoadStateSignal = runtime.source === "v0" && (loaded.length > 0 || unloaded.length > 0);
  return { loaded, unloaded, unknown, hasLoadStateSignal };
}

/**
 * Return true when the currently-selected model ref is known to be registered
 * but not loaded — the case where the dropdown should surface a warning that
 * picking it will trigger an on-demand load.
 *
 * Only true when (a) we have a trustworthy load-state signal for the runtime
 * containing this ref AND (b) that model reports loaded === false.
 */
export function isSelectedModelNotLoaded(runtimes: LocalRuntime[], selectedRef: string): boolean {
  const trimmed = String(selectedRef || "").trim();
  if (!trimmed) {
    return false;
  }
  for (const runtime of runtimes) {
    if (runtime.source !== "v0") {
      continue;
    }
    for (const model of runtime.models) {
      if (model.ref === trimmed && model.loaded === false) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Format a per-runtime label for the detection summary line.
 *
 * When v0 load-state is available, surfaces "(N loaded / M registered)";
 * otherwise reports the registered count only (legacy behavior).
 */
export function formatRuntimeSummary(runtime: LocalRuntime): string {
  const { loaded, unloaded, hasLoadStateSignal } = partitionRuntimeByLoadState(runtime);
  if (hasLoadStateSignal) {
    const total = runtime.models.length;
    return `${runtime.label} (${loaded.length} loaded / ${total} registered)`;
  }
  void unloaded;
  return `${runtime.label} (${runtime.models.length})`;
}
