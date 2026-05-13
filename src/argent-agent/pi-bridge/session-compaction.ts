/**
 * pi-bridge — `SessionCompactionResult` shape mapper (GH #303).
 *
 * Why this file exists
 * --------------------
 * pi-coding-agent 0.70 exposes `CompactionResult { summary, firstKeptEntryId,
 * tokensBefore, details? }` from `AgentSession.compact()`. The pi-ai #182
 * breakage catalog shows that 0.73+ drops `firstKeptEntryId` and `details`
 * from the public surface, but argent reads BOTH fields in
 * `src/agents/pi-embedded-runner/compact.ts:513-516` and threads them through
 * `EmbeddedPiCompactResult` into `session-manager.appendCompaction(...)` and
 * `compaction-safeguard.ts`.
 *
 * Rather than scatter optional chaining + version branches across every call
 * site, this mapper centralizes the drift: argent reads
 * `ArgentSessionCompactionResult` (stable shape — `firstKeptEntryId` always
 * present) and the mapper synthesizes any field pi drops upstream.
 *
 * Hard rule (matching the rest of pi-bridge):
 *   - argent code MUST consume `mapSessionCompactionResult(...)` rather than
 *     reach into pi's `CompactionResult` directly. When pi changes shape,
 *     only this file updates.
 *
 * @module argent-agent/pi-bridge/session-compaction
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Structural view of pi's `CompactionResult`. Both `firstKeptEntryId` and
 * `details` are optional here so the mapper compiles cleanly against pi 0.70
 * (which provides them) AND pi 0.73+ (which drops them). This is the only
 * place that needs touching when pi's `compact()` return type changes.
 */
export interface PiSessionCompactionResultLike {
  readonly summary: string;
  readonly tokensBefore: number;
  readonly firstKeptEntryId?: string;
  readonly details?: unknown;
}

/**
 * Minimal session surface the mapper needs to synthesize a fallback id when
 * pi drops `firstKeptEntryId`. Kept structural so it's satisfied by pi's
 * `AgentSession` (and any test double) without pulling the full identity.
 */
export interface SessionForCompactionMapping {
  readonly messages: ReadonlyArray<AgentMessage>;
}

/**
 * Argent's stable compaction-result shape. `firstKeptEntryId` is required so
 * downstream consumers (`appendCompaction`, `compaction-safeguard`,
 * `EmbeddedPiCompactResult`) don't have to branch on pi version. The mapper
 * guarantees this field is populated — synthesized from session messages when
 * pi drops it upstream.
 */
export interface ArgentSessionCompactionResult {
  readonly summary: string;
  readonly tokensBefore: number;
  readonly firstKeptEntryId: string;
  readonly details?: unknown;
}

/**
 * Translate pi's `CompactionResult` into argent's stable shape.
 *
 * - `summary`, `tokensBefore`: pass-through.
 * - `firstKeptEntryId`: pass-through when pi provides it (0.70 / 0.71 / 0.72).
 *   When dropped (pi 0.73+), synthesize from the session — see
 *   {@link synthesizeFirstKeptEntryId}. The synthesized id is a graceful
 *   fallback; downstream code (session snapshots, compaction-safeguard)
 *   tolerates a non-matching id by treating it as "no kept entry".
 * - `details`: pass-through (undefined when pi drops it). This already matches
 *   the optional shape in `EmbeddedPiCompactResult.result.details`.
 *
 * @param piResult — value returned by `AgentSession.compact()`
 * @param session  — the session the compaction ran on; used for fallback
 *                   synthesis. Pass the same `AgentSession` instance whose
 *                   `.compact()` produced `piResult`.
 */
export function mapSessionCompactionResult(
  piResult: PiSessionCompactionResultLike,
  session: SessionForCompactionMapping,
): ArgentSessionCompactionResult {
  const firstKeptEntryId =
    typeof piResult.firstKeptEntryId === "string" && piResult.firstKeptEntryId.length > 0
      ? piResult.firstKeptEntryId
      : synthesizeFirstKeptEntryId(session);
  return {
    summary: piResult.summary,
    tokensBefore: piResult.tokensBefore,
    firstKeptEntryId,
    details: piResult.details,
  };
}

/**
 * When pi 0.73+ drops `firstKeptEntryId` from its compaction result we still
 * need a non-empty id for downstream code. Pi keeps the "first kept entry" id
 * on session entries (not on `AgentMessage`), so we probe the message tail
 * for any stable id pi happens to surface:
 *
 *   1. A `responseId` on the most recent `AssistantMessage` — pi assigns
 *      these and they persist across reloads.
 *   2. An `.id` field on a custom message (pi extension messages carry one
 *      even though it isn't part of the public `AgentMessage` shape).
 *
 * Fallback: empty string. Downstream code treats this as "no kept entry"
 * (the session snapshot still saves; safeguards no-op). Intentionally
 * permissive — the mapper's job is to keep argent compiling and the happy
 * path working when pi drops the field; the real recovery path (likely
 * `sessionManager.entries` access) lands when we actually migrate to 0.73+.
 */
function synthesizeFirstKeptEntryId(session: SessionForCompactionMapping): string {
  const messages = session.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { responseId?: unknown; id?: unknown };
    if (typeof m.responseId === "string" && m.responseId.length > 0) return m.responseId;
    if (typeof m.id === "string" && m.id.length > 0) return m.id;
  }
  return "";
}
