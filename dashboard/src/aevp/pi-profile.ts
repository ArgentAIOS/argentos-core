/**
 * Pi Profile — low-intensity rendering mode for the Raspberry Pi or any
 * underpowered host running the ArgentOS dashboard.
 *
 * Activation: set any ONE of
 *   1. env var PI_PROFILE=1               (SSR / build time via Vite)
 *   2. env var VITE_PI_PROFILE=1          (Vite convention)
 *   3. localStorage "argent.piProfile" = "1"   (runtime toggle, no rebuild)
 *   4. URL param ?piProfile=1                  (one-shot try)
 *
 * Effect: the three AEVP perf levers all get tightened:
 *   - MAX particle count cap      180 → 60   (colorMapping runtime)
 *   - Runtime density multiplier  1.0 → 0.5  (colorMapping runtime)
 *   - Render tick frame interval  0  → 33ms  (renderer ~30fps)
 *
 * This keeps identity presets and personality modulation intact — the
 * character of the orb is preserved, only the per-frame cost drops.
 * Expected reduction: ~65% fewer GPU particle updates, ~50% fewer draw
 * calls on a display running at 60+ Hz.
 */

function envFlag(name: string): boolean {
  try {
    // Node / SSR
    const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    if (p?.env?.[name] && p.env[name] !== "0" && p.env[name] !== "") return true;
  } catch {
    /* ignore */
  }
  try {
    // Vite (import.meta.env is statically available only inside Vite-processed
    // modules; protect with a typeof check so this file compiles under raw tsc)
    const meta = (globalThis as { __ARGENT_VITE_ENV__?: Record<string, string | undefined> })
      .__ARGENT_VITE_ENV__;
    if (meta?.[name] && meta[name] !== "0" && meta[name] !== "") return true;
  } catch {
    /* ignore */
  }
  return false;
}

function localStorageFlag(key: string): boolean {
  try {
    const ls = (globalThis as { localStorage?: { getItem(k: string): string | null } }).localStorage;
    const v = ls?.getItem(key);
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

function urlParamFlag(key: string): boolean {
  try {
    const loc = (globalThis as { location?: { search?: string } }).location;
    if (!loc?.search) return false;
    const params = new URLSearchParams(loc.search);
    const v = params.get(key);
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

/** True if any Pi-profile signal is active. Computed once at module load. */
export const PI_PROFILE_ACTIVE: boolean =
  envFlag("PI_PROFILE") ||
  envFlag("VITE_PI_PROFILE") ||
  localStorageFlag("argent.piProfile") ||
  urlParamFlag("piProfile");

/**
 * Hard runtime cap on active particle count. Colour mapping applies this
 * in addition to identity preset density so low-end hardware gets a
 * predictable ceiling regardless of mood.
 */
export function getMaxParticlesCap(): number {
  return PI_PROFILE_ACTIVE ? 60 : 180;
}

/**
 * Multiplicative scale applied to presence.particleDensity at runtime.
 * Identity presets still express themselves (relative density is preserved),
 * but the absolute count lands lower.
 */
export function getDensityScale(): number {
  return PI_PROFILE_ACTIVE ? 0.5 : 1.0;
}

/**
 * Minimum milliseconds between tick renders. Zero means no gate (use
 * requestAnimationFrame cadence). 33 ≈ 30 fps, 50 = 20 fps.
 */
export function getFrameIntervalMs(): number {
  return PI_PROFILE_ACTIVE ? 33 : 0;
}
