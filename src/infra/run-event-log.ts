/**
 * D7 (WR2 P4) — run-event log helpers.
 *
 * The runner is the single writer of a run's lifecycle events. Events accrue in an
 * in-memory buffer during the run (surfaced live via getStatus) and are flushed onto
 * the JobRun record at completion. Persistence rides the existing `metadata` JSONB
 * column under `metadata.events` — no schema migration — and mapRun lifts it back to
 * the first-class `JobRun.events` field on read.
 *
 * These are pure functions so the contract is unit-testable without the full runner.
 */
import type { GateReason, RunEvent, RunEventType } from "../data/types.js";

/** Keep the gate-reason log bounded — it's a "recent why-didn't-this-run" tail, not history. */
export const GATE_REASON_LOG_MAX = 25;

/**
 * D6 — append a skip's {ts, gate, reason} to a per-agent gate-reason ring buffer
 * (single writer = runner), trimming to the most recent GATE_REASON_LOG_MAX.
 */
export function appendGateReason(
  buffer: GateReason[],
  gate: string,
  reason?: string,
  now: number = Date.now(),
  max: number = GATE_REASON_LOG_MAX,
): GateReason {
  const entry: GateReason = reason ? { ts: now, gate, reason } : { ts: now, gate };
  buffer.push(entry);
  if (buffer.length > max) buffer.splice(0, buffer.length - max);
  return entry;
}

/** Build a single run event with a timestamp. */
export function makeRunEvent(
  type: RunEventType,
  detail?: Record<string, unknown>,
  now: number = Date.now(),
): RunEvent {
  return detail && Object.keys(detail).length > 0 ? { ts: now, type, detail } : { ts: now, type };
}

/** Append an event to a runner-owned buffer (single writer) and return it. */
export function appendRunEvent(
  buffer: RunEvent[],
  type: RunEventType,
  detail?: Record<string, unknown>,
  now: number = Date.now(),
): RunEvent {
  const event = makeRunEvent(type, detail, now);
  buffer.push(event);
  return event;
}

/** Lift persisted lifecycle events back out of a run's metadata, defensively. */
export function readRunEventsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): RunEvent[] {
  const raw = metadata?.events;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is RunEvent =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as RunEvent).ts === "number" &&
      typeof (e as RunEvent).type === "string",
  );
}

/** Merge a runner's event buffer into a metadata object for persistence (non-mutating). */
export function writeRunEventsToMetadata(
  metadata: Record<string, unknown> | null | undefined,
  events: RunEvent[],
): Record<string, unknown> {
  return { ...(metadata ?? {}), events };
}
