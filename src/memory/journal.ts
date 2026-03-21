/**
 * MemU Journaling — Capture heartbeat and cron events as Resources.
 *
 * This ensures that background agent actions (heartbeats, cron jobs)
 * are recorded in the MemU memory system as Resources, providing
 * context for extracted facts.
 *
 * Tool results from these runs are already captured by Memo hooks
 * (via onAgentEvent()). This module adds the higher-level context:
 * "A heartbeat ran at 2pm and did X" or "Cron job 'daily-report' ran".
 */

import type { ArgentConfig } from "../config/config.js";
import type { CronEvent } from "../cron/service.js";
import type { HeartbeatEventPayload } from "../infra/heartbeat-events.js";
import type { MemoryType } from "./memu-types.js";
import { getMemoryAdapter } from "../data/storage-factory.js";
import { onHeartbeatEvent } from "../infra/heartbeat-events.js";
import { queueExtraction } from "./extract/pipeline.js";

let _journalConfig: ArgentConfig | undefined;
let _heartbeatUnsub: (() => void) | null = null;
let _cronHandler: ((evt: CronEvent) => void) | null = null;

const OPERATIONAL_EXTRACTION_MEMORY_TYPES: readonly MemoryType[] = ["event", "knowledge"] as const;
const LOW_VALUE_CRON_SUMMARY_RE =
  /\b(?:done|ok|status(?: is)? ok|no new vip email(?:s)?|finished checking(?: for vip emails)?|completed successfully|next run|duration|unique id|active and connected|integrated with|is a vip email check|configured for next run)\b/i;
const MEANINGFUL_CRON_SUMMARY_RE =
  /\b(?:new vip email(?:s)?|pending vip email(?:s)?|alerts sent|task(?:s)? created|actionable mention(?:s)?|setup required|cooldown active|failed|error|warning|blocked|escalat(?:e|ion)|incident)\b/i;

function getJournalExtractionMemoryTypes(source: "heartbeat" | "cron"): MemoryType[] {
  if (source === "heartbeat" || source === "cron") {
    return [...OPERATIONAL_EXTRACTION_MEMORY_TYPES];
  }
  return ["knowledge"];
}

function shouldCaptureCronJournalEvent(evt: CronEvent): boolean {
  if (evt.action !== "finished") return false;
  if (evt.status === "error" || !!evt.error) return true;

  const summary = evt.summary?.trim() ?? "";
  if (!summary) return false;

  if (LOW_VALUE_CRON_SUMMARY_RE.test(summary)) {
    return false;
  }

  if (MEANINGFUL_CRON_SUMMARY_RE.test(summary)) {
    return true;
  }

  return false;
}

/**
 * Start journaling — register listeners for heartbeat and cron events.
 * Call once during gateway startup.
 */
export function startJournal(config: ArgentConfig): void {
  _journalConfig = config;

  // Heartbeat journaling
  if (!_heartbeatUnsub) {
    _heartbeatUnsub = onHeartbeatEvent(handleHeartbeatEvent);
  }

  // Cron journaling — returns a handler to be passed to CronService onEvent
  _cronHandler = handleCronEvent;
}

/**
 * Get the cron event handler for chaining into existing onEvent callback.
 * Returns null if journaling hasn't been started.
 */
export function getCronJournalHandler(): ((evt: CronEvent) => void) | null {
  return _cronHandler;
}

/**
 * Stop journaling — cleanup listeners.
 */
export function stopJournal(): void {
  if (_heartbeatUnsub) {
    _heartbeatUnsub();
    _heartbeatUnsub = null;
  }
  _cronHandler = null;
  _journalConfig = undefined;
}

// ── Heartbeat Handler ──

function handleHeartbeatEvent(evt: HeartbeatEventPayload): void {
  // Only journal heartbeats that actually did something
  if (evt.status === "skipped") return;

  void (async () => {
    try {
      const store = await getMemoryAdapter();
      const timestamp = new Date(evt.ts).toISOString();
      const statusLabel = evt.status === "sent" ? "sent response" : evt.status;

      const text = [
        `Heartbeat at ${timestamp}`,
        `Status: ${statusLabel}`,
        evt.channel ? `Channel: ${evt.channel}` : null,
        evt.to ? `To: ${evt.to}` : null,
        evt.reason ? `Reason: ${evt.reason}` : null,
        evt.preview ? `Preview: ${evt.preview}` : null,
        evt.durationMs ? `Duration: ${evt.durationMs}ms` : null,
        evt.silent ? `(silent — suppressed)` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const resource = await store.createResource({
        url: `heartbeat://${timestamp}`,
        modality: "text",
        caption: `Heartbeat: ${statusLabel}${evt.preview ? ` — ${evt.preview.slice(0, 100)}` : ""}`,
        text,
      });

      // Queue extraction for heartbeats that produced content
      if (evt.status === "sent" && evt.preview && _journalConfig) {
        queueExtraction({
          resourceId: resource.id,
          text,
          config: _journalConfig,
          memoryTypes: getJournalExtractionMemoryTypes("heartbeat"),
        });
      }
    } catch (err) {
      // Non-blocking — don't let journal failures break heartbeat flow
      console.error("[MemU Journal] Failed to capture heartbeat:", err);
    }
  })();
}

// ── Cron Handler ──

function handleCronEvent(evt: CronEvent): void {
  // Only journal completed cron runs (not add/update/remove)
  if (evt.action !== "finished") return;
  if (!shouldCaptureCronJournalEvent(evt)) return;

  void (async () => {
    try {
      const store = await getMemoryAdapter();
      const timestamp = new Date(evt.runAtMs ?? Date.now()).toISOString();

      const text = [
        `Cron job "${evt.jobId}" finished at ${timestamp}`,
        `Status: ${evt.status ?? "unknown"}`,
        evt.durationMs ? `Duration: ${evt.durationMs}ms` : null,
        evt.summary ? `Summary: ${evt.summary}` : null,
        evt.error ? `Error: ${evt.error}` : null,
        evt.nextRunAtMs ? `Next run: ${new Date(evt.nextRunAtMs).toISOString()}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const resource = await store.createResource({
        url: `cron://${evt.jobId}/${timestamp}`,
        modality: "text",
        caption: `Cron: ${evt.jobId} — ${evt.status ?? "done"}${evt.summary ? `: ${evt.summary.slice(0, 100)}` : ""}`,
        text,
      });

      // Queue extraction only for meaningful cron journal events.
      if (evt.summary && _journalConfig) {
        queueExtraction({
          resourceId: resource.id,
          text,
          config: _journalConfig,
          memoryTypes: getJournalExtractionMemoryTypes("cron"),
        });
      }
    } catch (err) {
      console.error("[MemU Journal] Failed to capture cron event:", err);
    }
  })();
}

export const __testing = {
  getJournalExtractionMemoryTypes,
  shouldCaptureCronJournalEvent,
};
