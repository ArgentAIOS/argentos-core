/**
 * Agent Core runtime policy resolver.
 *
 * Centralizes Pi vs Argent runtime selection so callers can use one
 * deterministic mode instead of ad-hoc boolean checks.
 */

export const AGENT_CORE_RUNTIME_MODE_ENV_VAR = "ARGENT_RUNTIME_MODE";
export const AGENT_CORE_RUNTIME_BOOL_ENV_VAR = "ARGENT_RUNTIME";

export type AgentCoreRuntimeMode = "pi_only" | "argent_with_fallback" | "argent_strict";

export type RuntimeEnv = Record<string, string | undefined>;

export function resolveAgentCoreRuntimeMode(env: RuntimeEnv = process.env): AgentCoreRuntimeMode {
  const explicit = parseExplicitMode(env[AGENT_CORE_RUNTIME_MODE_ENV_VAR]);
  if (explicit) {
    return explicit;
  }

  const legacy = parseLegacyBool(env[AGENT_CORE_RUNTIME_BOOL_ENV_VAR]);
  return legacy ? "argent_with_fallback" : "pi_only";
}

export function isArgentRuntimeMode(mode: AgentCoreRuntimeMode): boolean {
  return mode !== "pi_only";
}

export function allowsPiFallback(mode: AgentCoreRuntimeMode): boolean {
  return mode === "argent_with_fallback";
}

export function assertPiFallbackAllowed(
  mode: AgentCoreRuntimeMode,
  operation: string,
): asserts mode is "argent_with_fallback" {
  if (allowsPiFallback(mode)) {
    return;
  }

  if (mode === "argent_strict") {
    throw new Error(`[agent-core] Pi fallback blocked in argent_strict mode during ${operation}.`);
  }

  throw new Error(`[agent-core] Pi fallback unavailable in ${mode} mode during ${operation}.`);
}

function parseExplicitMode(raw: string | undefined): AgentCoreRuntimeMode | undefined {
  const value = normalize(raw);
  if (!value) {
    return undefined;
  }

  if (value === "pi_only" || value === "pi") {
    return "pi_only";
  }
  if (
    value === "argent_with_fallback" ||
    value === "argent" ||
    value === "argent_fallback" ||
    value === "fallback"
  ) {
    return "argent_with_fallback";
  }
  if (value === "argent_strict" || value === "strict") {
    return "argent_strict";
  }
  return undefined;
}

function parseLegacyBool(raw: string | undefined): boolean {
  const value = normalize(raw);
  if (!value) {
    return false;
  }
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function normalize(raw: string | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}
