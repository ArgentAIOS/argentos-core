/**
 * Live Inbox — Batch Promotion + Expiry
 *
 * Handles deferred promotion (from contemplation) and expiry sweeps.
 * Every candidate must reach a terminal state: promoted | merged | discarded | expired.
 */

import type { LiveCandidate, PromotionActor, Significance } from "../memu-types.js";
import { logVerbose } from "../../globals.js";
import { contentHash, type MemuStore } from "../memu-store.js";

// ── Contemplation Candidate Injection ──

/**
 * Build the prompt section for contemplation to review pending candidates.
 * Returns empty string if no candidates are pending.
 */
export function buildCandidateReviewPrompt(candidates: LiveCandidate[]): string {
  if (candidates.length === 0) return "";

  const lines = [
    "",
    "## Recent Unreviewed Observations",
    "",
    "The following moments were captured from recent conversations.",
    "For each, respond with exactly one of:",
    "  PROMOTE:<id> — Save this as a permanent memory",
    "  REJECT:<id>:<reason> — Discard this observation",
    "  MERGE:<id>:<existing_memory_summary> — This duplicates an existing memory, reinforce it",
    "",
  ];

  for (const c of candidates) {
    const entities = c.entities.length > 0 ? ` | entities: ${c.entities.join(", ")}` : "";
    lines.push(
      `- [${c.id}] (${c.candidateType}, conf=${c.confidence.toFixed(2)}${entities}) ${c.factText}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

// ── Contemplation Response Parsing ──

export interface PromotionDecision {
  action: "promote" | "reject" | "merge";
  candidateId: string;
  reason?: string;
}

/**
 * Parse PROMOTE/REJECT/MERGE decisions from contemplation response text.
 */
export function parsePromotionDecisions(text: string): PromotionDecision[] {
  const decisions: PromotionDecision[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const promoteMatch = line.match(/PROMOTE:([\w-]+)/i);
    if (promoteMatch) {
      decisions.push({ action: "promote", candidateId: promoteMatch[1] });
      continue;
    }

    const rejectMatch = line.match(/REJECT:([\w-]+):?(.*)/i);
    if (rejectMatch) {
      decisions.push({
        action: "reject",
        candidateId: rejectMatch[1],
        reason: rejectMatch[2]?.trim() || "rejected by contemplation",
      });
      continue;
    }

    const mergeMatch = line.match(/MERGE:([\w-]+):?(.*)/i);
    if (mergeMatch) {
      decisions.push({
        action: "merge",
        candidateId: mergeMatch[1],
        reason: mergeMatch[2]?.trim() || "merged with existing",
      });
    }
  }

  return decisions;
}

// ── Batch Promotion ──

export interface PromotionResult {
  promoted: number;
  merged: number;
  discarded: number;
  errors: number;
}

/**
 * Execute promotion decisions from contemplation.
 */
export function executePromotionDecisions(
  store: MemuStore,
  decisions: PromotionDecision[],
  actor: PromotionActor = "contemplation",
): PromotionResult {
  const result: PromotionResult = { promoted: 0, merged: 0, discarded: 0, errors: 0 };

  for (const decision of decisions) {
    try {
      const candidate = store.getLiveCandidate(decision.candidateId);
      if (!candidate || candidate.status !== "pending") {
        continue;
      }

      switch (decision.action) {
        case "promote": {
          // Check for dedup first
          const hash = contentHash(candidate.factText);
          const existing = store.findByHash(hash);
          if (existing) {
            store.reinforceItem(existing.id);
            store.markLiveCandidateMerged(candidate.id, existing.id);
            result.merged++;
          } else {
            const significanceMap: Record<string, Significance> = {
              identity: "important",
              correction: "important",
              directive: "important",
              commitment: "important",
              preference: "noteworthy",
              decision: "noteworthy",
              emotion: "noteworthy",
              relationship: "noteworthy",
            };

            const item = store.createItem({
              memoryType: candidate.memoryTypeHint ?? "knowledge",
              summary: candidate.factText,
              significance:
                candidate.significanceHint ??
                significanceMap[candidate.candidateType] ??
                "noteworthy",
              happenedAt: candidate.sourceTs,
              extra: {
                source: "live-inbox",
                candidateType: candidate.candidateType,
                promotedBy: actor,
                role: candidate.role,
                confidence: candidate.confidence,
              },
            });
            store.markLiveCandidatePromoted(candidate.id, item.id, `promoted by ${actor}`);
            // Update the actor in the promotion event
            store.recordPromotionEvent(
              candidate.id,
              actor,
              "promote",
              "ok",
              `promoted by ${actor}`,
            );
            result.promoted++;
          }
          break;
        }
        case "reject": {
          store.markLiveCandidateDiscarded(candidate.id, decision.reason ?? "rejected", actor);
          result.discarded++;
          break;
        }
        case "merge": {
          // Try to find existing memory matching the merge hint
          const hash = contentHash(candidate.factText);
          const existing = store.findByHash(hash);
          if (existing) {
            store.reinforceItem(existing.id);
            store.markLiveCandidateMerged(candidate.id, existing.id);
          } else {
            // If no exact match, still promote (contemplation said it's worth keeping)
            const item = store.createItem({
              memoryType: candidate.memoryTypeHint ?? "knowledge",
              summary: candidate.factText,
              significance: candidate.significanceHint ?? "noteworthy",
              happenedAt: candidate.sourceTs,
              extra: {
                source: "live-inbox",
                candidateType: candidate.candidateType,
                promotedBy: actor,
                mergeAttempt: true,
              },
            });
            store.markLiveCandidatePromoted(candidate.id, item.id, "merge-fallback");
          }
          result.merged++;
          break;
        }
      }
    } catch (err) {
      logVerbose(`live-inbox: promotion error for ${decision.candidateId}: ${String(err)}`);
      store.recordPromotionEvent(
        decision.candidateId,
        actor,
        decision.action === "reject" ? "discard" : "promote",
        "error",
        undefined,
        String(err),
      );
      result.errors++;
    }
  }

  return result;
}

// ── Expiry Sweep ──

/**
 * Expire pending candidates past their TTL.
 * Returns the number of expired candidates.
 */
export function sweepExpiredCandidates(store: MemuStore): number {
  const now = new Date().toISOString();
  const expired = store.listLiveCandidates({
    status: "pending",
    expiresBefore: now,
    limit: 200,
  });

  if (expired.length === 0) return 0;

  store.markLiveCandidateExpired(expired.map((c) => c.id));
  return expired.length;
}
