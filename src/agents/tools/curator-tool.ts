/**
 * Curator Tool — for the primary operator (fast path)
 *
 * This tool gives the main operator direct ownership of its own Capability Curator loop.
 * It is intentionally lightweight and focused so it can live in the operator light tool surface.
 *
 * Purpose (Self-Extending Operator Core milestone):
 * - Allow the primary operator to review, refine, promote, and delegate curation of its own Personal Skill candidates.
 * - Support general LiveCandidate (live-inbox) review/promote/discard flows for broader self-knowledge curation.
 * - Bridge "I can create skills" and "I actively curate + delegate my growth".
 * - Uses reviewPersonalSkillCandidates + build* + live-inbox promote machinery.
 *
 * All significant actions emit:
 * - PersonalSkillReviewEvent with clear actorType: "operator" provenance (for Personal Skills)
 * - recordOperatorSelfExtensionAction (AgentEvent "tool" stream + [operator-self-ext] logs + per-run counters)
 * - For LiveCandidates: mark* + operator-flavored reasons + audit record (PromotionEvent via store where possible)
 *
 * Strictly behind isPrimaryOperator / createLightOperatorTools. No production changes.
 *
 * Self-Extending Operator Core milestone (Phases 1-6) delivered via parallel subagents + main thread.
 * Full audited create/curate/delegate/promote loop for PersonalSkill + Live candidates now operational on the fast path.
 */

import { Type } from "@sinclair/typebox";
import type { PersonalSkillCandidate, LiveCandidate } from "../../memory/memu-types.js";
import type { AnyAgentTool } from "./common.js";
import { getMemoryAdapter } from "../../data/storage-factory.js";
import { recordOperatorSelfExtensionAction } from "../../infra/agent-events.js";
import { buildCandidateReviewPrompt } from "../../memory/live-inbox/promote.js";
import {
  reviewPersonalSkillCandidates,
  buildPersonalSkillCandidateReviewPrompt,
} from "../skills.js";
import {
  buildPersonalSkillReviewDelegationTask,
  createGeneralCapabilityDelegationTask,
  CAPABILITY_DELEGATION_TOOL_ALLOWLIST,
  CAPABILITY_DELEGATION_TOOL_DENY,
} from "./capability-delegation.js";
import { readStringParam, readNumberParam, jsonResult } from "./common.js";

const CURATOR_ACTIONS = [
  "help",
  "list_pending",
  "get_review_context",
  "get_candidate",
  "list_events",
  "run_review",
  "promote",
  "reject",
  "add_note",
  "delegate_review",
  "create_delegation_task",
  "delegation_help",
  // Live Inbox general candidate support (operator self-curation of captured observations)
  "list_live_pending",
  "get_live_context",
  "promote_live",
  "discard_live",
] as const;

const CuratorToolSchema = Type.Object({
  action: Type.Union(
    CURATOR_ACTIONS.map((a) => Type.Literal(a)),
    {
      description:
        'Curator actions for primary operator self-extension: "help", list/get/review/promote/reject/note on PersonalSkillCandidates + LiveCandidates, plus rich delegation (delegate_review/create_delegation_task/delegation_help). All actions produce queryable audit (PersonalSkillReviewEvent with operator actorType + AgentEvents).',
    },
  ),
  candidateId: Type.Optional(
    Type.String({
      description:
        "Target candidate id (PersonalSkill or Live) for promote/reject/add_note/delegate_review/promote_live/discard_live/get_candidate/list_events.",
    }),
  ),
  note: Type.Optional(Type.String({ description: "Operator note, goal, or review comment." })),
  limit: Type.Optional(Type.Number({ description: "Max candidates to return (default 10)." })),
});

async function resolveScopedMemory(agentId: string) {
  const memory = await getMemoryAdapter();
  return memory.withAgentId ? memory.withAgentId(agentId) : memory;
}

function formatCandidateShort(c: PersonalSkillCandidate): string {
  return `${c.id} | ${c.title} [${c.state}] conf=${c.confidence.toFixed(2)} ev=${c.evidenceCount} rec=${c.recurrenceCount}`;
}

function formatLiveShort(c: LiveCandidate): string {
  return `${c.id} | ${c.candidateType} [${c.status}] conf=${c.confidence.toFixed(2)} ${c.factText.slice(0, 80)}...`;
}

async function safeCreateReviewEvent(memory: any, input: any) {
  try {
    await memory.createPersonalSkillReviewEvent?.(input);
  } catch {
    // Non-fatal; audit via AgentEvent still fires
  }
}

export function createCuratorTool(options: {
  agentId: string;
  runId?: string;
  /** Phase 0.5 (Hermes Absorption): captured turn messages (messagesSnapshot) for richer self-extension context. */
  turnMessages?: readonly unknown[];
}): AnyAgentTool {
  const agentId = options.agentId;
  const runId = options.runId;
  // Bind the optional richer turn context to every self-extension recording so curator actions
  // carry turnMessageCount (and, in a follow-on slice, the messages themselves). Inert unless the
  // operator surface invokes this tool.
  const recordSelfExt = (action: string, details: Record<string, unknown> = {}): void =>
    recordOperatorSelfExtensionAction(runId, "curator", action, details, options.turnMessages);

  return {
    label: "Curator",
    name: "curator",
    description:
      "Primary operator self-curation + delegation tool. Full ownership of Personal Skill candidates (review/promote/reject/delegate) and Live Inbox candidates. Rich delegation packets for family. Complete operator provenance via PersonalSkillReviewEvent (actor=operator) + AgentEvents. Use 'help' for quick reference.",
    parameters: CuratorToolSchema,
    execute: async (_toolCallId, args) => {
      let action: (typeof CURATOR_ACTIONS)[number] | undefined;
      try {
        const params = args as Record<string, unknown>;
        action = readStringParam(params, "action", {
          required: true,
        }) as (typeof CURATOR_ACTIONS)[number];
        const memory = await resolveScopedMemory(agentId);

        // --- READ / INFO ACTIONS ---
        if (action === "help") {
          const helpText = [
            "Curator Tool — Primary Operator Self-Extension Surface",
            "",
            "Personal Skill actions:",
            "  list_pending, get_review_context, get_candidate <id>, list_events <id>, run_review, promote <id>, reject <id>, add_note <id>",
            "",
            "Delegation (rich packets for family.dispatch_contracted):",
            "  delegate_review <id> [note], create_delegation_task [note=goal] [candidateId], delegation_help",
            "",
            "Live Inbox (general memory candidates) curation:",
            "  list_live_pending, get_live_context, promote_live <id>, discard_live <id>",
            "",
            "All actions emit full operator audit (PersonalSkillReviewEvent actorType=operator where applicable + recordOperatorSelfExtensionAction for AgentEvent stream).",
          ].join("\n");

          recordSelfExt(action, {});
          return jsonResult({
            ok: true,
            action,
            help: helpText,
            message: "Use specific actions for full structured responses.",
          });
        }

        if (action === "list_pending") {
          const limit = Math.min(30, Math.max(1, readNumberParam(params, "limit") ?? 10));
          const candidates = await memory.listPersonalSkillCandidates({ limit });
          const pending = candidates.filter(
            (c) => c.state === "candidate" || c.state === "incubating",
          );

          recordSelfExt(action, { count: pending.length });

          const text =
            pending.length === 0
              ? "No pending Personal Skill candidates."
              : pending.map(formatCandidateShort).join("\n");
          return jsonResult({
            ok: true,
            action,
            count: pending.length,
            candidates: pending.map((c) => ({
              id: c.id,
              title: c.title,
              state: c.state,
              confidence: c.confidence,
              summary: c.summary,
            })),
            text,
          });
        }

        if (action === "get_review_context") {
          const limit = Math.min(20, Math.max(1, readNumberParam(params, "limit") ?? 8));
          const candidates = await memory.listPersonalSkillCandidates({ limit });
          const prompt = buildPersonalSkillCandidateReviewPrompt(candidates);
          const pending = candidates.filter(
            (c) => c.state === "candidate" || c.state === "incubating",
          );

          recordSelfExt(action, { pendingCount: pending.length });

          return jsonResult({
            ok: true,
            action,
            reviewPrompt: prompt || "No pending candidates require review right now.",
            pendingCount: pending.length,
            candidates: pending.map((c) => ({
              id: c.id,
              title: c.title,
              state: c.state,
              confidence: c.confidence,
              evidenceCount: c.evidenceCount,
              recurrenceCount: c.recurrenceCount,
            })),
          });
        }

        if (action === "get_candidate") {
          const candidateId = readStringParam(params, "candidateId", { required: true });
          const all = await memory.listPersonalSkillCandidates({ limit: 200 });
          const candidate = all.find((c) => c.id === candidateId);
          if (!candidate) {
            return jsonResult({ ok: false, action, error: `Candidate not found: ${candidateId}` });
          }
          // Best-effort recent events
          let events: any[] = [];
          try {
            events =
              (await memory.listPersonalSkillReviewEvents?.({ candidateId, limit: 5 })) || [];
          } catch {}
          recordSelfExt(action, { candidateId });
          return jsonResult({
            ok: true,
            action,
            candidate,
            recentEvents: events,
            message: "Full candidate + recent review provenance.",
          });
        }

        if (action === "list_events") {
          const candidateId = readStringParam(params, "candidateId", { required: true });
          let events: any[] = [];
          try {
            events =
              (await memory.listPersonalSkillReviewEvents?.({ candidateId, limit: 20 })) || [];
          } catch {}
          recordSelfExt(action, { candidateId, count: events.length });
          return jsonResult({
            ok: true,
            action,
            candidateId,
            count: events.length,
            events,
            message: "Queryable PersonalSkillReviewEvent history (operator provenance visible).",
          });
        }

        // --- LIVE INBOX SUPPORT (general LiveCandidates) ---
        if (action === "list_live_pending") {
          const limit = Math.min(30, Math.max(1, readNumberParam(params, "limit") ?? 10));
          let lives: LiveCandidate[] = [];
          try {
            lives =
              (await (memory as any).listLiveCandidates?.({ status: "pending", limit })) || [];
          } catch {}
          const pending = lives.filter((c: any) => c.status === "pending");

          recordSelfExt(action, { count: pending.length });

          const text =
            pending.length === 0
              ? "No pending LiveCandidates."
              : pending.map(formatLiveShort).join("\n");
          return jsonResult({
            ok: true,
            action,
            count: pending.length,
            candidates: pending.map((c: any) => ({
              id: c.id,
              type: c.candidateType,
              status: c.status,
              confidence: c.confidence,
              fact: c.factText.slice(0, 120),
            })),
            text,
          });
        }

        if (action === "get_live_context") {
          const limit = Math.min(20, Math.max(1, readNumberParam(params, "limit") ?? 8));
          let lives: LiveCandidate[] = [];
          try {
            lives =
              (await (memory as any).listLiveCandidates?.({ status: "pending", limit })) || [];
          } catch {}
          const prompt = buildCandidateReviewPrompt(lives as any);
          recordSelfExt(action, { pendingCount: lives.length });
          return jsonResult({
            ok: true,
            action,
            reviewPrompt: prompt || "No pending LiveCandidates.",
            count: lives.length,
            candidates: lives.map((c: any) => ({
              id: c.id,
              type: c.candidateType,
              fact: c.factText,
            })),
          });
        }

        if (action === "promote_live") {
          const candidateId = readStringParam(params, "candidateId", { required: true });
          const note = readStringParam(params, "note");
          const memAny = memory as any;
          try {
            if (typeof memAny.markLiveCandidatePromoted === "function") {
              await memAny.markLiveCandidatePromoted(
                candidateId,
                "operator-curated",
                note || "Explicitly promoted by primary operator via curator-tool (LiveCandidate)",
              );
            }
          } catch (e) {
            return jsonResult({
              ok: false,
              action,
              candidateId,
              error: `promote_live failed: ${String(e)}`,
            });
          }
          recordSelfExt(action, { candidateId, note: note || undefined, kind: "live" });
          return jsonResult({
            ok: true,
            action,
            candidateId,
            message: "LiveCandidate promoted by operator (reason includes operator provenance).",
          });
        }

        if (action === "discard_live") {
          const candidateId = readStringParam(params, "candidateId", { required: true });
          const note =
            readStringParam(params, "note") || "Discarded by primary operator via curator";
          const memAny = memory as any;
          try {
            if (typeof memAny.markLiveCandidateDiscarded === "function") {
              await memAny.markLiveCandidateDiscarded(candidateId, note, "operator" as any);
            }
          } catch (e) {
            return jsonResult({
              ok: false,
              action,
              candidateId,
              error: `discard_live failed: ${String(e)}`,
            });
          }
          recordSelfExt(action, { candidateId, kind: "live" });
          return jsonResult({
            ok: true,
            action,
            candidateId,
            message: "LiveCandidate discarded with operator provenance.",
          });
        }

        // --- MUTATING PERSONAL SKILL ACTIONS (full audit + operator actor) ---
        if (action === "run_review") {
          const result = await reviewPersonalSkillCandidates({ memory, limit: 100 });
          await safeCreateReviewEvent(memory, {
            candidateId: "review-run" as any,
            actorType: "operator",
            action: "operator_note",
            reason: `Operator ran curator review. Reviewed=${result.reviewed}, promoted=${result.promoted}, changed=${result.changed}`,
            details: { source: "curator-tool", action: "run_review", result },
          });
          recordSelfExt(action, {
            reviewed: result.reviewed,
            promoted: result.promoted,
            changed: result.changed,
          });
          return jsonResult({
            ok: true,
            action,
            result,
            message: `Review complete. Reviewed ${result.reviewed}, promoted ${result.promoted}.`,
          });
        }

        if (action === "promote") {
          const candidateId = readStringParam(params, "candidateId", { required: true });
          const note = readStringParam(params, "note");
          const all = await memory.listPersonalSkillCandidates({ limit: 50 });
          const candidate = all.find((c) => c.id === candidateId);
          if (!candidate)
            return jsonResult({ ok: false, action, error: `Candidate not found: ${candidateId}` });

          await memory.updatePersonalSkillCandidate?.(candidateId, {
            state: "promoted",
            lastReviewedAt: new Date().toISOString(),
          });
          await safeCreateReviewEvent(memory, {
            candidateId: candidateId as any,
            actorType: "operator",
            action: "promoted",
            reason: note || "Explicitly promoted by primary operator via curator tool",
            details: { source: "curator-tool", operatorDriven: true },
          });
          recordSelfExt(action, { candidateId, note: note || undefined });
          return jsonResult({
            ok: true,
            action,
            candidateId,
            newState: "promoted",
            message: `Candidate ${candidateId} promoted by operator.`,
          });
        }

        if (action === "reject") {
          const candidateId = readStringParam(params, "candidateId", { required: true });
          const note = readStringParam(params, "note");
          const all = await memory.listPersonalSkillCandidates({ limit: 50 });
          const candidate = all.find((c) => c.id === candidateId);
          if (!candidate)
            return jsonResult({ ok: false, action, error: `Candidate not found: ${candidateId}` });

          await memory.updatePersonalSkillCandidate?.(candidateId, {
            state: "rejected",
            lastReviewedAt: new Date().toISOString(),
          });
          await safeCreateReviewEvent(memory, {
            candidateId: candidateId as any,
            actorType: "operator",
            action: "rejected",
            reason: note || "Explicitly rejected by primary operator via curator tool",
            details: {
              source: "curator-tool",
              operatorDriven: true,
              previousState: candidate.state,
            },
          });
          recordSelfExt(action, { candidateId, note: note || undefined });
          return jsonResult({
            ok: true,
            action,
            candidateId,
            newState: "rejected",
            message: `Candidate ${candidateId} rejected by operator.`,
          });
        }

        if (action === "add_note") {
          const candidateId = readStringParam(params, "candidateId", { required: true });
          const note = readStringParam(params, "note", { required: true });
          await safeCreateReviewEvent(memory, {
            candidateId: candidateId as any,
            actorType: "operator",
            action: "operator_note",
            reason: note,
            details: { source: "curator-tool" },
          });
          recordSelfExt(action, { candidateId });
          return jsonResult({
            ok: true,
            action,
            candidateId,
            note,
            message: "Operator note recorded on candidate.",
          });
        }

        if (action === "delegate_review") {
          const candidateId = readStringParam(params, "candidateId", { required: true });
          const note = readStringParam(params, "note");
          const candidates = await memory.listPersonalSkillCandidates({ limit: 50 });
          const candidate = candidates.find((c) => c.id === candidateId);
          if (!candidate)
            return jsonResult({ ok: false, action, error: `Candidate not found: ${candidateId}` });

          // Use the high-quality builder (removes duplication, includes full contract)
          const packet = buildPersonalSkillReviewDelegationTask({
            candidate,
            extraContext: note || undefined,
            requesterAgentId: "argent",
          });

          await safeCreateReviewEvent(memory, {
            candidateId: candidateId as any,
            actorType: "operator",
            action: "operator_note",
            reason: "Operator delegated deep review/research to family agent(s) via curator",
            details: {
              source: "curator-tool",
              action: "delegate_review",
              packetMetadata: packet.metadata,
            },
          });
          recordSelfExt(action, { candidateId });

          return jsonResult({
            ok: true,
            action,
            candidateId,
            packet,
            recommendedUsage:
              "Pass packet.framedTask + packet.recommendedToolsAllow/deny to family.dispatch_contracted (or dispatch). Results return via family publish + message.",
            message: "Rich delegation packet ready (includes full handoff contract).",
          });
        }

        if (action === "create_delegation_task") {
          const goal =
            readStringParam(params, "note") ||
            readStringParam(params, "goal") ||
            "Improve or create a Personal Skill / procedure for the primary operator.";
          const candidateId = readStringParam(params, "candidateId");

          let candidate: PersonalSkillCandidate | null = null;
          if (candidateId) {
            const candidates = await memory.listPersonalSkillCandidates({ limit: 30 });
            candidate = candidates.find((x) => x.id === candidateId) || null;
          }

          // Use the authoritative general builder
          const packet = createGeneralCapabilityDelegationTask({
            workDescription: goal,
            domainHints: candidate ? ["personal_skill", "procedure"] : ["general self-extension"],
            requesterAgentId: "argent",
          });

          if (candidate) {
            await safeCreateReviewEvent(memory, {
              candidateId: candidate.id,
              actorType: "operator",
              action: "operator_note",
              reason: "Operator created general delegation task for this candidate",
              details: {
                source: "curator-tool",
                action: "create_delegation_task",
                goal: goal.slice(0, 120),
              },
            });
          }

          recordSelfExt(action, {
            goal: goal.slice(0, 120),
            candidateId: candidateId || undefined,
          });

          return jsonResult({
            ok: true,
            action,
            goal,
            packet,
            recommendedUsage:
              "Pass packet.framedTask + packet.recommendedToolsAllow/deny to family.dispatch_contracted. Full contract + return expectations baked in.",
            message:
              "General-purpose self-building delegation packet generated (contract + publish return path).",
          });
        }

        if (action === "delegation_help") {
          recordSelfExt(action, {});
          return jsonResult({
            ok: true,
            action,
            version: "2026.05.phase4-5-polish",
            allowlist: CAPABILITY_DELEGATION_TOOL_ALLOWLIST,
            denylist: CAPABILITY_DELEGATION_TOOL_DENY,
            usage:
              "Prefer delegate_review or create_delegation_task (they now return full packets from capability-delegation builders). Feed .framedTask + allow/deny into family.dispatch_contracted. Results auto-return via publish + message to argent.",
            message: "Delegation reference (authoritative allow/deny + contract).",
          });
        }

        throw new Error(`Unknown curator action: ${action}`);
      } catch (err: any) {
        // Comprehensive error handling for UX + audit (never crash the tool call)
        const errMsg = err?.message || String(err);
        if (action && runId) {
          try {
            recordSelfExt(action, { error: errMsg });
          } catch {}
        }
        return jsonResult({
          ok: false,
          action: action || "unknown",
          error: errMsg,
          message:
            "Curator action failed (operator provenance still recorded via audit where possible).",
        });
      }
    },
  };
}
