import {
  getExecutiveShadowSummary,
  type ExecutiveShadowSummary,
} from "../commands/status.executive-shadow.js";
import {
  getConsciousnessKernelSnapshot,
  type ConsciousnessKernelSnapshot,
} from "./consciousness-kernel.js";

export type ExecutiveShadowKernelInspection = {
  kernelAvailable: boolean;
  executiveReachable: boolean;
  comparable: boolean;
  laneMatch: boolean | null;
  kernelActiveLane: string | null;
  executiveActiveLane: string | null;
  kernelFocus: string | null;
  executiveLastEventSummary: string | null;
  notes: string[];
};

export async function inspectExecutiveShadowAgainstKernel(
  deps: {
    getKernelSnapshot?: () => ConsciousnessKernelSnapshot | null;
    getExecutiveSummary?: () => Promise<ExecutiveShadowSummary>;
  } = {},
): Promise<ExecutiveShadowKernelInspection> {
  const kernelSnapshot = (deps.getKernelSnapshot ?? getConsciousnessKernelSnapshot)();
  const executiveSummary = await (deps.getExecutiveSummary ?? getExecutiveShadowSummary)();

  const notes: string[] = [];
  const kernelAvailable = Boolean(kernelSnapshot);
  const executiveReachable = executiveSummary.reachable;
  const kernelActiveLane = kernelSnapshot?.activeLane ?? null;
  const executiveActiveLane = executiveSummary.activeLane ?? null;
  const kernelFocus = kernelSnapshot?.effectiveFocus ?? kernelSnapshot?.currentFocus ?? null;
  const executiveLastEventSummary = executiveSummary.lastEventSummary ?? null;

  if (!kernelAvailable) {
    notes.push("kernel snapshot unavailable");
  }
  if (!executiveReachable) {
    notes.push(
      executiveSummary.error
        ? `executive shadow unavailable: ${executiveSummary.error}`
        : "executive shadow unavailable",
    );
  }

  if (kernelAvailable && executiveReachable) {
    if (kernelActiveLane === executiveActiveLane) {
      notes.push("active lane aligned");
    } else {
      notes.push(
        `active lane differs: kernel=${kernelActiveLane ?? "none"} shadow=${executiveActiveLane ?? "none"}`,
      );
    }
    if (kernelFocus) {
      notes.push(`kernel focus: ${kernelFocus}`);
    }
    if (executiveLastEventSummary) {
      notes.push(`shadow event: ${executiveLastEventSummary}`);
    }
  }

  return {
    kernelAvailable,
    executiveReachable,
    comparable: kernelAvailable && executiveReachable,
    laneMatch:
      kernelAvailable && executiveReachable ? kernelActiveLane === executiveActiveLane : null,
    kernelActiveLane,
    executiveActiveLane,
    kernelFocus,
    executiveLastEventSummary,
    notes,
  };
}
