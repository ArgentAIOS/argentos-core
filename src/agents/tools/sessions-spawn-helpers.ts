/**
 * Shared spawn helper for creating sub-agent sessions.
 * Used by both sessions_spawn and team_spawn tools.
 */

import crypto from "node:crypto";
import type { DeliveryContext } from "../../utils/delivery-context.js";
import { formatThinkingLevels, normalizeThinkLevel } from "../../auto-reply/thinking.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import { resolveAgentConfig } from "../agent-scope.js";
import { AGENT_LANE_SUBAGENT } from "../lanes.js";
import { registerSubagentRun } from "../subagent-registry.js";
import { readStringParam } from "./common.js";

function splitModelRef(ref?: string) {
  if (!ref) return { provider: undefined, model: undefined };
  const trimmed = ref.trim();
  if (!trimmed) return { provider: undefined, model: undefined };
  const [provider, model] = trimmed.split("/", 2);
  if (model) return { provider, model };
  return { provider: undefined, model: trimmed };
}

function normalizeModelSelection(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const primary = (value as { primary?: unknown }).primary;
  if (typeof primary === "string" && primary.trim()) return primary.trim();
  return undefined;
}

function normalizeToolGrantList(list: string[] | undefined): string[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const deduped = new Set<string>();
  for (const item of list) {
    const normalized = String(item ?? "")
      .trim()
      .toLowerCase();
    if (!normalized) continue;
    deduped.add(normalized);
  }
  return deduped.size > 0 ? Array.from(deduped) : [];
}

export type SpawnSessionParams = {
  task: string;
  label?: string;
  modelOverride?: string;
  toolsAllow?: string[];
  toolsDeny?: string[];
  thinkingOverride?: string;
  runTimeoutSeconds?: number;
  cleanup?: "delete" | "keep";
  /** Custom system prompt (replaces default subagent prompt) */
  extraSystemPrompt?: string;
  /** Pre-generated session key (if not provided, auto-generated) */
  childSessionKey?: string;
  /** Requester context */
  requesterSessionKey?: string;
  requesterInternalKey: string;
  requesterDisplayKey: string;
  requesterOrigin?: DeliveryContext;
  requesterAgentIdOverride?: string;
  /** Target agent */
  requestedAgentId?: string;
  /** Gateway group routing */
  groupId?: string | null;
  groupChannel?: string | null;
  groupSpace?: string | null;
};

export type SpawnSessionResult =
  | {
      ok: true;
      childSessionKey: string;
      runId: string;
      modelApplied?: boolean;
      warning?: string;
    }
  | {
      ok: false;
      error: string;
      childSessionKey?: string;
      runId?: string;
    };

/**
 * Core logic for spawning a sub-agent session.
 * Returns either a success result with session key/runId, or an error.
 */
export async function spawnSubagentSession(
  params: SpawnSessionParams,
): Promise<SpawnSessionResult> {
  const cfg = loadConfig();

  const requesterAgentId = normalizeAgentId(
    params.requesterAgentIdOverride ?? parseAgentSessionKey(params.requesterInternalKey)?.agentId,
  );
  const targetAgentId = params.requestedAgentId
    ? normalizeAgentId(params.requestedAgentId)
    : requesterAgentId;

  // Check agent allow list
  if (targetAgentId !== requesterAgentId) {
    // Try requester config first, then fall back to the default agent's config
    // (handles "main" → "argent" mismatch when DEFAULT_AGENT_ID differs from configured agent ID)
    const requesterConfig = resolveAgentConfig(cfg, requesterAgentId);
    const defaultAgentId = cfg.agents?.list?.[0]?.id;
    const fallbackConfig =
      !requesterConfig && defaultAgentId ? resolveAgentConfig(cfg, defaultAgentId) : undefined;
    const allowAgents =
      requesterConfig?.subagents?.allowAgents ?? fallbackConfig?.subagents?.allowAgents ?? [];
    const allowAny = allowAgents.some((v) => v.trim() === "*");
    const normalizedTargetId = targetAgentId.toLowerCase();
    const allowSet = new Set(
      allowAgents
        .filter((v) => v.trim() && v.trim() !== "*")
        .map((v) => normalizeAgentId(v).toLowerCase()),
    );
    if (!allowAny && !allowSet.has(normalizedTargetId)) {
      return { ok: false, error: "agentId is not allowed for spawn" };
    }
  }

  const childSessionKey =
    params.childSessionKey ?? `agent:${targetAgentId}:subagent:${crypto.randomUUID()}`;
  const spawnedByKey = params.requesterInternalKey;
  const targetAgentConfig = resolveAgentConfig(cfg, targetAgentId);
  const resolvedModel =
    normalizeModelSelection(params.modelOverride) ??
    normalizeModelSelection(targetAgentConfig?.subagents?.model) ??
    normalizeModelSelection(cfg.agents?.defaults?.subagents?.model);

  const resolvedThinkingDefaultRaw =
    readStringParam(targetAgentConfig?.subagents ?? {}, "thinking") ??
    readStringParam(cfg.agents?.defaults?.subagents ?? {}, "thinking");

  let thinkingOverride: string | undefined;
  const thinkingCandidateRaw = params.thinkingOverride || resolvedThinkingDefaultRaw;
  if (thinkingCandidateRaw) {
    const normalized = normalizeThinkLevel(thinkingCandidateRaw);
    if (!normalized) {
      const { provider, model } = splitModelRef(resolvedModel);
      const hint = formatThinkingLevels(provider, model);
      return {
        ok: false,
        error: `Invalid thinking level "${thinkingCandidateRaw}". Use one of: ${hint}.`,
      };
    }
    thinkingOverride = normalized;
  }

  let modelApplied = false;
  let modelWarning: string | undefined;
  const toolsAllow = normalizeToolGrantList(params.toolsAllow);
  const toolsDeny = normalizeToolGrantList(params.toolsDeny);

  if (resolvedModel || toolsAllow !== undefined || toolsDeny !== undefined) {
    const patchParams: Record<string, unknown> = { key: childSessionKey };
    if (resolvedModel) {
      patchParams.model = resolvedModel;
    }
    if (toolsAllow !== undefined) {
      patchParams.toolsAllow = toolsAllow;
    }
    if (toolsDeny !== undefined) {
      patchParams.toolsDeny = toolsDeny;
    }
    try {
      await callGateway({
        method: "sessions.patch",
        params: patchParams,
        timeoutMs: 10_000,
      });
      modelApplied = !!resolvedModel;
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "error";
      const recoverable =
        !!resolvedModel && (msg.includes("invalid model") || msg.includes("model not allowed"));
      if (!recoverable) {
        return { ok: false, error: msg, childSessionKey };
      }
      modelWarning = msg;
      // Model selection failed (allowlist/invalid model). Retry patch without model so
      // strict tool grants can still apply and the run can proceed on default routing.
      if (toolsAllow !== undefined || toolsDeny !== undefined) {
        const retryPatchParams: Record<string, unknown> = { key: childSessionKey };
        if (toolsAllow !== undefined) {
          retryPatchParams.toolsAllow = toolsAllow;
        }
        if (toolsDeny !== undefined) {
          retryPatchParams.toolsDeny = toolsDeny;
        }
        try {
          await callGateway({
            method: "sessions.patch",
            params: retryPatchParams,
            timeoutMs: 10_000,
          });
        } catch (retryErr) {
          const retryMsg =
            retryErr instanceof Error
              ? retryErr.message
              : typeof retryErr === "string"
                ? retryErr
                : "error";
          return { ok: false, error: retryMsg, childSessionKey };
        }
      }
    }
  }

  const runTimeoutSeconds = params.runTimeoutSeconds ?? 0;
  const childIdem = crypto.randomUUID();
  let childRunId: string = childIdem;

  try {
    const response = await callGateway<{ runId: string }>({
      method: "agent",
      params: {
        message: params.task,
        sessionKey: childSessionKey,
        channel: params.requesterOrigin?.channel,
        idempotencyKey: childIdem,
        deliver: false,
        lane: AGENT_LANE_SUBAGENT,
        extraSystemPrompt: params.extraSystemPrompt,
        thinking: thinkingOverride,
        timeout: runTimeoutSeconds > 0 ? runTimeoutSeconds : undefined,
        label: params.label || undefined,
        spawnedBy: spawnedByKey,
        groupId: params.groupId ?? undefined,
        groupChannel: params.groupChannel ?? undefined,
        groupSpace: params.groupSpace ?? undefined,
      },
      timeoutMs: 10_000,
    });
    if (typeof response?.runId === "string" && response.runId) {
      childRunId = response.runId;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "error";
    return { ok: false, error: msg, childSessionKey, runId: childRunId };
  }

  registerSubagentRun({
    runId: childRunId,
    childSessionKey,
    requesterSessionKey: params.requesterInternalKey,
    requesterOrigin: params.requesterOrigin,
    requesterDisplayKey: params.requesterDisplayKey,
    task: params.task,
    cleanup: params.cleanup ?? "keep",
    label: params.label || undefined,
    runTimeoutSeconds,
  });

  return {
    ok: true,
    childSessionKey,
    runId: childRunId,
    modelApplied: resolvedModel ? modelApplied : undefined,
    warning: modelWarning,
  };
}
