/**
 * Loads `{agentDir}/kernel/fitness-config.json` — the kernel-fitness writer's
 * runtime config. Defaults to `DEFAULT_KERNEL_FITNESS_CONFIG` (Section 13
 * locked decisions in HANDOFF-kernel-fitness.md).
 *
 * The kernel runner has no write path to this file — changes are operator-
 * driven (edit + restart). Phase 2 doesn't yet implement validation beyond
 * "load and shallow-merge with defaults"; future phases may add stricter
 * validation when more knobs are added.
 */

import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { DEFAULT_KERNEL_FITNESS_CONFIG, type KernelFitnessConfig } from "./kernel-fitness-types.js";

const log = createSubsystemLogger("gateway/consciousness-kernel/fitness-config");

/**
 * Load the fitness config from `{kernelRootDir}/fitness-config.json`. Missing
 * file or malformed JSON falls back to defaults with a warning. Partial files
 * are shallow-merged so the operator can override just the knobs they care
 * about without rewriting the full schema.
 */
export function loadKernelFitnessConfig(kernelRootDir: string): KernelFitnessConfig {
  const configPath = path.join(kernelRootDir, "fitness-config.json");
  if (!fs.existsSync(configPath)) {
    return DEFAULT_KERNEL_FITNESS_CONFIG;
  }
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<KernelFitnessConfig>;
    return mergeFitnessConfig(DEFAULT_KERNEL_FITNESS_CONFIG, parsed);
  } catch (err) {
    log.warn(
      `fitness-config: failed to read ${configPath}; falling back to defaults: ${String(err)}`,
    );
    return DEFAULT_KERNEL_FITNESS_CONFIG;
  }
}

function mergeFitnessConfig(
  base: KernelFitnessConfig,
  override: Partial<KernelFitnessConfig>,
): KernelFitnessConfig {
  return {
    windowSeconds:
      typeof override.windowSeconds === "number" && override.windowSeconds > 0
        ? override.windowSeconds
        : base.windowSeconds,
    minReflectionsForValidWindow:
      typeof override.minReflectionsForValidWindow === "number" &&
      override.minReflectionsForValidWindow >= 0
        ? override.minReflectionsForValidWindow
        : base.minReflectionsForValidWindow,
    mMin: typeof override.mMin === "number" && override.mMin >= 0 ? override.mMin : base.mMin,
    kWindows:
      typeof override.kWindows === "number" && override.kWindows >= 1
        ? override.kWindows
        : base.kWindows,
    delta: typeof override.delta === "number" && override.delta >= 0 ? override.delta : base.delta,
    weights: mergeWeights(base.weights, override.weights),
  };
}

function mergeWeights(
  base: KernelFitnessConfig["weights"],
  override?: Partial<KernelFitnessConfig["weights"]>,
): KernelFitnessConfig["weights"] {
  if (!override) return base;
  const repeat =
    typeof override.reflectionRepeat === "number" && override.reflectionRepeat >= 0
      ? override.reflectionRepeat
      : base.reflectionRepeat;
  const inaction =
    typeof override.executiveInaction === "number" && override.executiveInaction >= 0
      ? override.executiveInaction
      : base.executiveInaction;
  return { reflectionRepeat: repeat, executiveInaction: inaction };
}
