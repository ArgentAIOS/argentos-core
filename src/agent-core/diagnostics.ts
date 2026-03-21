import {
  AGENT_CORE_RUNTIME_BOOL_ENV_VAR,
  AGENT_CORE_RUNTIME_MODE_ENV_VAR,
  allowsPiFallback,
  isArgentRuntimeMode,
  resolveAgentCoreRuntimeMode,
  type AgentCoreRuntimeMode,
  type RuntimeEnv,
} from "./runtime-policy.js";

export type AgentCoreRuntimeDiagnostics = {
  mode: AgentCoreRuntimeMode;
  isArgentRuntime: boolean;
  piFallbackAllowed: boolean;
  source: "explicit_mode" | "legacy_bool" | "default";
  env: {
    runtimeModeRaw: string | undefined;
    runtimeBoolRaw: string | undefined;
  };
};

/**
 * Returns resolved runtime policy state for logging/health checks.
 *
 * This helper is pure and side-effect-free so it can be called from
 * command output, telemetry, and tests without changing behavior.
 */
export function getAgentCoreRuntimeDiagnostics(
  env: RuntimeEnv = process.env,
): AgentCoreRuntimeDiagnostics {
  const runtimeModeRaw = env[AGENT_CORE_RUNTIME_MODE_ENV_VAR];
  const runtimeBoolRaw = env[AGENT_CORE_RUNTIME_BOOL_ENV_VAR];
  const mode = resolveAgentCoreRuntimeMode(env);
  return {
    mode,
    isArgentRuntime: isArgentRuntimeMode(mode),
    piFallbackAllowed: allowsPiFallback(mode),
    source: resolveSource(runtimeModeRaw, runtimeBoolRaw),
    env: {
      runtimeModeRaw,
      runtimeBoolRaw,
    },
  };
}

function resolveSource(
  runtimeModeRaw: string | undefined,
  runtimeBoolRaw: string | undefined,
): "explicit_mode" | "legacy_bool" | "default" {
  const mode = (runtimeModeRaw ?? "").trim();
  if (mode.length > 0) {
    return "explicit_mode";
  }
  const legacy = (runtimeBoolRaw ?? "").trim();
  if (legacy.length > 0) {
    return "legacy_bool";
  }
  return "default";
}
