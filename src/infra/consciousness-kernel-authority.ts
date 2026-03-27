import type { ArgentConfig } from "../config/config.js";
import type { ConsciousnessKernelMode } from "./consciousness-kernel-state.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";

export type ConsciousnessKernelAuthoritySnapshot = {
  configured: boolean;
  enabled: boolean;
  mode: ConsciousnessKernelMode;
  defaultAgentId: string | null;
  schedulerAuthorityActive: boolean;
  suppressesAutonomousContemplation: boolean;
  suppressesAutonomousSis: boolean;
};

function resolveConfiguredKernelMode(cfg: ArgentConfig): {
  configured: boolean;
  enabled: boolean;
  mode: ConsciousnessKernelMode;
} {
  const raw = cfg.agents?.defaults?.kernel;
  const configured = Boolean(raw && typeof raw === "object");
  const enabled = raw?.enabled === true;
  const rawMode = raw?.mode;
  const mode: ConsciousnessKernelMode =
    rawMode === "off" || rawMode === "shadow" || rawMode === "soft" || rawMode === "full"
      ? rawMode
      : enabled
        ? "shadow"
        : "off";
  return {
    configured,
    enabled,
    mode,
  };
}

export function resolveConsciousnessKernelAuthority(
  cfg: ArgentConfig,
): ConsciousnessKernelAuthoritySnapshot {
  const resolved = resolveConfiguredKernelMode(cfg);
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const schedulerAuthorityActive =
    resolved.enabled && resolved.mode === "shadow" && Boolean(defaultAgentId);
  return {
    ...resolved,
    defaultAgentId,
    schedulerAuthorityActive,
    suppressesAutonomousContemplation: schedulerAuthorityActive,
    suppressesAutonomousSis: schedulerAuthorityActive,
  };
}

export function isConsciousnessKernelSchedulerAuthorityActive(cfg: ArgentConfig): boolean {
  return resolveConsciousnessKernelAuthority(cfg).schedulerAuthorityActive;
}

export function isContemplationAutonomousSchedulingSuppressed(
  cfg: ArgentConfig,
  agentId: string,
): boolean {
  const authority = resolveConsciousnessKernelAuthority(cfg);
  return authority.suppressesAutonomousContemplation && authority.defaultAgentId === agentId;
}

export function isSisAutonomousSchedulingSuppressed(cfg: ArgentConfig): boolean {
  return resolveConsciousnessKernelAuthority(cfg).suppressesAutonomousSis;
}
