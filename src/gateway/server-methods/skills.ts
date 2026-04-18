import type { ArgentConfig } from "../../config/config.js";
import type { PersonalSkillCandidate } from "../../memory/memu-types.js";
import type { GatewayRequestHandlers } from "./types.js";
import {
  listAgentIds,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { installSkill } from "../../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../../agents/skills-status.js";
import { loadWorkspaceSkillEntries, type SkillEntry } from "../../agents/skills.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { getMemoryAdapter } from "../../data/storage-factory.js";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSkillsBinsParams,
  validateSkillsInstallParams,
  validateSkillsStatusParams,
  validateSkillsUpdateParams,
} from "../protocol/index.js";

function listWorkspaceDirs(cfg: ArgentConfig): string[] {
  const dirs = new Set<string>();
  const list = cfg.agents?.list;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (entry && typeof entry === "object" && typeof entry.id === "string") {
        dirs.add(resolveAgentWorkspaceDir(cfg, entry.id));
      }
    }
  }
  dirs.add(resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg)));
  return [...dirs];
}

function collectSkillBins(entries: SkillEntry[]): string[] {
  const bins = new Set<string>();
  for (const entry of entries) {
    const required = entry.metadata?.requires?.bins ?? [];
    const anyBins = entry.metadata?.requires?.anyBins ?? [];
    const install = entry.metadata?.install ?? [];
    for (const bin of required) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const bin of anyBins) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const spec of install) {
      const specBins = spec?.bins ?? [];
      for (const bin of specBins) {
        const trimmed = String(bin).trim();
        if (trimmed) {
          bins.add(trimmed);
        }
      }
    }
  }
  return [...bins].toSorted();
}

function resolveRequestedAgentId(cfg: ArgentConfig, agentIdRaw: string | undefined): string {
  const trimmed = typeof agentIdRaw === "string" ? agentIdRaw.trim() : "";
  const agentId = trimmed ? normalizeAgentId(trimmed) : resolveDefaultAgentId(cfg);
  if (trimmed) {
    const knownAgents = listAgentIds(cfg);
    if (!knownAgents.includes(agentId)) {
      throw new Error(`unknown agent id "${trimmed}"`);
    }
  }
  return agentId;
}

function deriveDemotionRisk(candidate: PersonalSkillCandidate): "low" | "medium" | "high" {
  if (
    candidate.state === "promoted" &&
    (candidate.failureCount >= candidate.successCount + 2 ||
      candidate.strength < 0.35 ||
      candidate.confidence < 0.58 ||
      candidate.contradictionCount >= 2)
  ) {
    return "high";
  }
  if (
    candidate.failureCount > 0 ||
    candidate.contradictionCount > 0 ||
    candidate.strength < 0.55 ||
    candidate.state === "incubating"
  ) {
    return "medium";
  }
  return "low";
}

function isAllowedManualState(
  value: string,
): value is "candidate" | "incubating" | "promoted" | "rejected" | "deprecated" {
  return (
    value === "candidate" ||
    value === "incubating" ||
    value === "promoted" ||
    value === "rejected" ||
    value === "deprecated"
  );
}

export const skillsHandlers: GatewayRequestHandlers = {
  "skills.status": ({ params, respond }) => {
    if (!validateSkillsStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.status params: ${formatValidationErrors(validateSkillsStatusParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentIdRaw = typeof params?.agentId === "string" ? params.agentId.trim() : "";
    const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : resolveDefaultAgentId(cfg);
    if (agentIdRaw) {
      const knownAgents = listAgentIds(cfg);
      if (!knownAgents.includes(agentId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent id "${agentIdRaw}"`),
        );
        return;
      }
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const report = buildWorkspaceSkillStatus(workspaceDir, {
      config: cfg,
      eligibility: { remote: getRemoteSkillEligibility() },
    });
    respond(true, report, undefined);
  },
  "skills.bins": ({ params, respond }) => {
    if (!validateSkillsBinsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.bins params: ${formatValidationErrors(validateSkillsBinsParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const workspaceDirs = listWorkspaceDirs(cfg);
    const bins = new Set<string>();
    for (const workspaceDir of workspaceDirs) {
      const entries = loadWorkspaceSkillEntries(workspaceDir, { config: cfg });
      for (const bin of collectSkillBins(entries)) {
        bins.add(bin);
      }
    }
    respond(true, { bins: [...bins].toSorted() }, undefined);
  },
  "skills.install": async ({ params, respond }) => {
    if (!validateSkillsInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.install params: ${formatValidationErrors(validateSkillsInstallParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      name: string;
      installId: string;
      timeoutMs?: number;
    };
    const cfg = loadConfig();
    const workspaceDirRaw = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const result = await installSkill({
      workspaceDir: workspaceDirRaw,
      skillName: p.name,
      installId: p.installId,
      timeoutMs: p.timeoutMs,
      config: cfg,
    });
    respond(
      result.ok,
      result,
      result.ok ? undefined : errorShape(ErrorCodes.UNAVAILABLE, result.message),
    );
  },
  "skills.update": async ({ params, respond }) => {
    if (!validateSkillsUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.update params: ${formatValidationErrors(validateSkillsUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      skillKey: string;
      enabled?: boolean;
      apiKey?: string;
      env?: Record<string, string>;
    };
    const cfg = loadConfig();
    const skills = cfg.skills ? { ...cfg.skills } : {};
    const entries = skills.entries ? { ...skills.entries } : {};
    const current = entries[p.skillKey] ? { ...entries[p.skillKey] } : {};
    if (typeof p.enabled === "boolean") {
      current.enabled = p.enabled;
    }
    if (typeof p.apiKey === "string") {
      const trimmed = p.apiKey.trim();
      if (trimmed) {
        current.apiKey = trimmed;
      } else {
        delete current.apiKey;
      }
    }
    if (p.env && typeof p.env === "object") {
      const nextEnv = current.env ? { ...current.env } : {};
      for (const [key, value] of Object.entries(p.env)) {
        const trimmedKey = key.trim();
        if (!trimmedKey) {
          continue;
        }
        const trimmedVal = value.trim();
        if (!trimmedVal) {
          delete nextEnv[trimmedKey];
        } else {
          nextEnv[trimmedKey] = trimmedVal;
        }
      }
      current.env = nextEnv;
    }
    entries[p.skillKey] = current;
    skills.entries = entries;
    const nextConfig: ArgentConfig = {
      ...cfg,
      skills,
    };
    await writeConfigFile(nextConfig);
    respond(true, { ok: true, skillKey: p.skillKey, config: current }, undefined);
  },
  "skills.personal": async ({ params, respond }) => {
    try {
      const cfg = loadConfig();
      const agentId = resolveRequestedAgentId(
        cfg,
        typeof params?.agentId === "string" ? params.agentId : undefined,
      );
      const memory = await getMemoryAdapter();
      const scopedMemory = memory.withAgentId ? memory.withAgentId(agentId) : memory;
      const candidates = await scopedMemory.listPersonalSkillCandidates({ limit: 200 });
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const rows = candidates
        .slice()
        .sort((a, b) => {
          const stateOrder = (state: string) =>
            state === "promoted"
              ? 0
              : state === "incubating"
                ? 1
                : state === "candidate"
                  ? 2
                  : state === "deprecated"
                    ? 3
                    : 4;
          return (
            stateOrder(a.state) - stateOrder(b.state) ||
            b.confidence - a.confidence ||
            b.strength - a.strength ||
            b.updatedAt.localeCompare(a.updatedAt)
          );
        })
        .map((candidate) => ({
          reviewHistory: [],
          id: candidate.id,
          title: candidate.title,
          summary: candidate.summary,
          scope: candidate.scope,
          state: candidate.state,
          confidence: candidate.confidence,
          strength: candidate.strength,
          usageCount: candidate.usageCount,
          successCount: candidate.successCount,
          failureCount: candidate.failureCount,
          contradictionCount: candidate.contradictionCount,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
          operatorNotes: candidate.operatorNotes,
          lastUsedAt: candidate.lastUsedAt,
          lastReviewedAt: candidate.lastReviewedAt,
          lastReinforcedAt: candidate.lastReinforcedAt,
          lastContradictedAt: candidate.lastContradictedAt,
          executionReady:
            candidate.state === "promoted" &&
            candidate.executionSteps.length > 0 &&
            !candidate.supersededByCandidateId,
          demotionRisk: deriveDemotionRisk(candidate),
          preconditions: candidate.preconditions,
          executionSteps: candidate.executionSteps,
          expectedOutcomes: candidate.expectedOutcomes,
          relatedTools: candidate.relatedTools,
          supersedes: candidate.supersedesCandidateIds
            .map((id) => byId.get(id)?.title ?? id)
            .filter(Boolean),
          supersedesEntries: candidate.supersedesCandidateIds
            .map((id) => {
              const peer = byId.get(id);
              return peer
                ? { id: peer.id, title: peer.title, state: peer.state }
                : { id, title: id };
            })
            .filter(Boolean),
          supersededBy: candidate.supersededByCandidateId
            ? (byId.get(candidate.supersededByCandidateId)?.title ??
              candidate.supersededByCandidateId)
            : null,
          supersededByEntry: candidate.supersededByCandidateId
            ? (() => {
                const peer = byId.get(candidate.supersededByCandidateId);
                return peer
                  ? { id: peer.id, title: peer.title, state: peer.state }
                  : {
                      id: candidate.supersededByCandidateId!,
                      title: candidate.supersededByCandidateId!,
                      state: "unknown",
                    };
              })()
            : null,
          conflicts: candidate.conflictsWithCandidateIds
            .map((id) => byId.get(id)?.title ?? id)
            .filter(Boolean),
          conflictEntries: candidate.conflictsWithCandidateIds
            .map((id) => {
              const peer = byId.get(id);
              return peer
                ? { id: peer.id, title: peer.title, state: peer.state }
                : { id, title: id, state: "unknown" };
            })
            .filter(Boolean),
        }));
      const rowsWithHistory = await Promise.all(
        rows.map(async (row) => ({
          ...row,
          reviewHistory: await scopedMemory.listPersonalSkillReviewEvents({
            candidateId: row.id,
            limit: 12,
          }),
        })),
      );
      respond(
        true,
        {
          agentId,
          generatedAt: new Date().toISOString(),
          rows: rowsWithHistory,
        },
        undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
  "skills.personal.update": async ({ params, respond }) => {
    try {
      const cfg = loadConfig();
      const id = typeof params?.id === "string" ? params.id.trim() : "";
      const stateRaw = typeof params?.state === "string" ? params.state.trim().toLowerCase() : "";
      const operatorNotes =
        typeof params?.operatorNotes === "string" ? params.operatorNotes.trim() : undefined;
      const agentId = resolveRequestedAgentId(
        cfg,
        typeof params?.agentId === "string" ? params.agentId : undefined,
      );
      if (!id) {
        throw new Error("skills.personal.update requires id");
      }
      if (!isAllowedManualState(stateRaw)) {
        throw new Error("skills.personal.update requires a valid state");
      }
      const memory = await getMemoryAdapter();
      const scopedMemory = memory.withAgentId ? memory.withAgentId(agentId) : memory;
      const updated = await scopedMemory.updatePersonalSkillCandidate(id, {
        state: stateRaw,
        ...(operatorNotes !== undefined ? { operatorNotes } : {}),
        lastReviewedAt: new Date().toISOString(),
      });
      if (!updated) {
        throw new Error(`personal skill "${id}" not found`);
      }
      await scopedMemory.createPersonalSkillReviewEvent({
        candidateId: id,
        actorType: "operator",
        action:
          operatorNotes !== undefined
            ? "operator_note"
            : stateRaw === "promoted"
              ? "promoted"
              : stateRaw === "deprecated"
                ? "deprecated"
                : "demoted",
        reason:
          operatorNotes !== undefined
            ? "Operator updated review notes"
            : `Operator set Personal Skill state to ${stateRaw}`,
        details: {
          state: updated.state,
          operatorNotes: operatorNotes ?? undefined,
        },
      });
      respond(true, { ok: true, id, state: updated.state }, undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
  "skills.personal.resolveConflict": async ({ params, respond }) => {
    try {
      const cfg = loadConfig();
      const winnerId = typeof params?.winnerId === "string" ? params.winnerId.trim() : "";
      const loserId = typeof params?.loserId === "string" ? params.loserId.trim() : "";
      const agentId = resolveRequestedAgentId(
        cfg,
        typeof params?.agentId === "string" ? params.agentId : undefined,
      );
      if (!winnerId || !loserId) {
        throw new Error("skills.personal.resolveConflict requires winnerId and loserId");
      }
      if (winnerId === loserId) {
        throw new Error("winnerId and loserId must differ");
      }
      const memory = await getMemoryAdapter();
      const scopedMemory = memory.withAgentId ? memory.withAgentId(agentId) : memory;
      const all = await scopedMemory.listPersonalSkillCandidates({ limit: 200 });
      const winner = all.find((entry) => entry.id === winnerId);
      const loser = all.find((entry) => entry.id === loserId);
      if (!winner || !loser) {
        throw new Error("winner or loser personal skill not found");
      }
      const now = new Date().toISOString();
      await scopedMemory.updatePersonalSkillCandidate(winnerId, {
        supersedesCandidateIds: [...new Set([...winner.supersedesCandidateIds, loserId])],
        conflictsWithCandidateIds: winner.conflictsWithCandidateIds.filter((id) => id !== loserId),
        lastReviewedAt: now,
      });
      await scopedMemory.updatePersonalSkillCandidate(loserId, {
        state: "deprecated",
        supersededByCandidateId: winnerId,
        conflictsWithCandidateIds: loser.conflictsWithCandidateIds.filter((id) => id !== winnerId),
        lastContradictedAt: now,
        lastReviewedAt: now,
      });
      await scopedMemory.createPersonalSkillReviewEvent({
        candidateId: winnerId,
        actorType: "operator",
        action: "conflict_resolved",
        reason: `Operator selected ${winner.title} over ${loser.title}`,
        details: {
          winnerId,
          loserId,
        },
      });
      await scopedMemory.createPersonalSkillReviewEvent({
        candidateId: loserId,
        actorType: "operator",
        action: "conflict_resolved",
        reason: `Operator resolved conflict in favor of ${winner.title}`,
        details: {
          winnerId,
          loserId,
        },
      });
      respond(true, { ok: true, winnerId, loserId }, undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
  "skills.personal.delete": async ({ params, respond }) => {
    try {
      const cfg = loadConfig();
      const id = typeof params?.id === "string" ? params.id.trim() : "";
      const agentId = resolveRequestedAgentId(
        cfg,
        typeof params?.agentId === "string" ? params.agentId : undefined,
      );
      if (!id) {
        throw new Error("skills.personal.delete requires id");
      }
      const memory = await getMemoryAdapter();
      const scopedMemory = memory.withAgentId ? memory.withAgentId(agentId) : memory;
      await scopedMemory.createPersonalSkillReviewEvent({
        candidateId: id,
        actorType: "operator",
        action: "deleted",
        reason: "Operator deleted Personal Skill",
      });
      const deleted = await scopedMemory.deletePersonalSkillCandidate(id);
      if (!deleted) {
        throw new Error(`personal skill "${id}" not found`);
      }
      respond(true, { ok: true, id }, undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
};
